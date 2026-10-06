import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';
import { sendEmail } from '../services/email.service.js';
import { madridToUtcDate } from '../utils/timezone.js';
import { avisarLlamada } from '../utils/aviso-llamada.js';
import { ESTADOS_VALIDOS } from './setting.routes.js';

const router = express.Router();
// Mismo permiso que Setting — es la misma gente (comerciales/closer) la que
// usa el calendario de llamadas.
const requireCalendario = requirePermission('leads');
router.use(authenticateToken, requireCalendario);

// El JWT solo lleva el id de la fila de `users`, no el de `employees` — se
// resuelve por email cada vez que hace falta saber "quién soy" como empleado
// (para crear/gestionar solo mis propios huecos).
async function empleadoActual(req) {
  if (!req.user.email) return null;
  const { data } = await supabase.from('employees').select('id, name, email').eq('email', req.user.email).maybeSingle();
  return data;
}

/**
 * GET /api/call-slots
 * Query: employee_id (opcional), disponibles=true (solo libres), from/to (fecha).
 * Sin employee_id, devuelve los de todos — así Franco puede ver huecos
 * libres de cualquier closer al reservar.
 */
router.get('/', async (req, res) => {
  try {
    const { employee_id, disponibles, from, to } = req.query;
    let query = supabase
      .from('call_slots')
      .select('*, empleado:employees(id, name, email), lead:setting_leads(id, nombre, telefono, instagram, estado)')
      .order('fecha', { ascending: true })
      .order('hora_inicio', { ascending: true });
    if (employee_id) query = query.eq('employee_id', employee_id);
    if (disponibles === 'true') query = query.eq('ocupado', false);
    if (from) query = query.gte('fecha', from);
    if (to) query = query.lte('fecha', to);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ slots: data });
  } catch (error) {
    console.error('Error al listar huecos de llamada:', error);
    res.status(500).json({ error: 'Error al listar huecos de llamada' });
  }
});

/**
 * POST /api/call-slots
 * Crea uno o varios huecos libres propios. Body: { slots: [{ fecha, hora_inicio, hora_fin }, ...] }
 * (o un solo hueco suelto con esos mismos campos en el body directamente).
 */
router.post('/', async (req, res) => {
  try {
    const empleado = await empleadoActual(req);
    if (!empleado) return res.status(403).json({ error: 'No se ha encontrado tu ficha de empleado' });

    const lista = Array.isArray(req.body.slots) ? req.body.slots : [req.body];
    const filas = [];
    for (const s of lista) {
      if (!s.fecha || !s.hora_inicio || !s.hora_fin) {
        return res.status(400).json({ error: 'Cada hueco necesita fecha, hora_inicio y hora_fin' });
      }
      if (s.hora_fin <= s.hora_inicio) {
        return res.status(400).json({ error: `La hora de fin debe ser posterior a la de inicio (${s.fecha})` });
      }
      filas.push({ employee_id: empleado.id, fecha: s.fecha, hora_inicio: s.hora_inicio, hora_fin: s.hora_fin });
    }

    const { data, error } = await supabase.from('call_slots').insert(filas).select('*, empleado:employees(id, name, email)');
    if (error) throw error;
    res.status(201).json({ slots: data });
  } catch (error) {
    console.error('Error al crear hueco de llamada:', error);
    res.status(500).json({ error: 'Error al crear hueco de llamada' });
  }
});

/**
 * GET /api/call-slots/rules
 * Reglas de disponibilidad recurrente. Sin employee_id, todas (para que
 * Franco vea de quién son al reservar); con employee_id, las de uno.
 */
router.get('/rules', async (req, res) => {
  try {
    const { employee_id } = req.query;
    let query = supabase.from('call_availability_rules').select('*, empleado:employees(id, name, email)').order('dia_semana', { ascending: true }).order('hora_inicio', { ascending: true });
    if (employee_id) query = query.eq('employee_id', employee_id);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ reglas: data });
  } catch (error) {
    console.error('Error al listar reglas de disponibilidad:', error);
    res.status(500).json({ error: 'Error al listar reglas de disponibilidad' });
  }
});

/**
 * POST /api/call-slots/rules
 * Crea una regla recurrente propia (ej. "Lunes 10:00-14:00, llamadas de
 * 30 min") y genera de inmediato los huecos reales de las próximas semanas
 * para que Franco los vea sin esperar al barrido automático.
 */
router.post('/rules', async (req, res) => {
  try {
    const empleado = await empleadoActual(req);
    if (!empleado) return res.status(403).json({ error: 'No se ha encontrado tu ficha de empleado' });

    const { dia_semana, hora_inicio, hora_fin, duracion_llamada_min } = req.body;
    if (dia_semana === undefined || !hora_inicio || !hora_fin) {
      return res.status(400).json({ error: 'Faltan dia_semana, hora_inicio y hora_fin' });
    }
    if (hora_fin <= hora_inicio) return res.status(400).json({ error: 'La hora de fin debe ser posterior a la de inicio' });
    const duracion = parseInt(duracion_llamada_min, 10) || 30;
    if (duracion < 5) return res.status(400).json({ error: 'La duración de la llamada debe ser de al menos 5 minutos' });

    const { data, error } = await supabase
      .from('call_availability_rules')
      .insert({ employee_id: empleado.id, dia_semana, hora_inicio, hora_fin, duracion_llamada_min: duracion })
      .select('*, empleado:employees(id, name, email)')
      .single();
    if (error) throw error;

    await generarSlotsDesdeReglas();
    res.status(201).json({ regla: data });
  } catch (error) {
    console.error('Error al crear regla de disponibilidad:', error);
    res.status(500).json({ error: 'Error al crear regla de disponibilidad' });
  }
});

/**
 * PUT /api/call-slots/rules/:id — activar/desactivar o editar una regla propia.
 */
router.put('/rules/:id', async (req, res) => {
  try {
    const empleado = await empleadoActual(req);
    const { data: regla } = await supabase.from('call_availability_rules').select('employee_id').eq('id', req.params.id).maybeSingle();
    if (!regla) return res.status(404).json({ error: 'Regla no encontrada' });
    if (!(empleado && regla.employee_id === empleado.id) && req.user.role !== 'admin_superior') {
      return res.status(403).json({ error: 'Solo el dueño de la regla puede editarla' });
    }
    const { activo, hora_inicio, hora_fin, duracion_llamada_min } = req.body;
    const updates = {};
    if (activo !== undefined) updates.activo = activo;
    if (hora_inicio !== undefined) updates.hora_inicio = hora_inicio;
    if (fecha !== undefined || hora_inicio !== undefined) Object.assign(updates, { recordatorio_enviado: false, recordatorio_30_enviado: false, recordatorio_5_enviado: false });
    if (hora_fin !== undefined) updates.hora_fin = hora_fin;
    if (duracion_llamada_min !== undefined) updates.duracion_llamada_min = parseInt(duracion_llamada_min, 10) || 30;

    const { data, error } = await supabase.from('call_availability_rules').update(updates).eq('id', req.params.id).select('*, empleado:employees(id, name, email)').single();
    if (error) throw error;
    if (activo === false) {
      // Al desactivar, quita los huecos futuros que esa regla había generado
      // y que TODAVÍA nadie reservó (los ya reservados se quedan intactos).
      await supabase.from('call_slots').delete().eq('employee_id', data.employee_id).eq('generado_por_regla', req.params.id).eq('ocupado', false).gte('fecha', new Date().toISOString().slice(0, 10));
    } else {
      await generarSlotsDesdeReglas();
    }
    res.json({ regla: data });
  } catch (error) {
    console.error('Error al actualizar regla de disponibilidad:', error);
    res.status(500).json({ error: 'Error al actualizar regla de disponibilidad' });
  }
});

/**
 * DELETE /api/call-slots/rules/:id
 */
router.delete('/rules/:id', async (req, res) => {
  try {
    const empleado = await empleadoActual(req);
    const { data: regla } = await supabase.from('call_availability_rules').select('employee_id').eq('id', req.params.id).maybeSingle();
    if (!regla) return res.status(404).json({ error: 'Regla no encontrada' });
    if (!(empleado && regla.employee_id === empleado.id) && req.user.role !== 'admin_superior') {
      return res.status(403).json({ error: 'Solo el dueño de la regla puede eliminarla' });
    }
    await supabase.from('call_slots').delete().eq('generado_por_regla', req.params.id).eq('ocupado', false).gte('fecha', new Date().toISOString().slice(0, 10));
    const { error } = await supabase.from('call_availability_rules').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Regla eliminada' });
  } catch (error) {
    console.error('Error al eliminar regla de disponibilidad:', error);
    res.status(500).json({ error: 'Error al eliminar regla de disponibilidad' });
  }
});

/**
 * POST /api/call-slots/:id/reservar
 * Franco reserva un hueco libre para un lead concreto de Setting — deja el
 * hueco como ocupado y actualiza fecha_llamada/estado del lead a la vez,
 * para que las dos vistas (Setting y el calendario) queden sincronizadas.
 */
router.post('/:id/reservar', async (req, res) => {
  try {
    const { setting_lead_id } = req.body;
    if (!setting_lead_id) return res.status(400).json({ error: 'Falta setting_lead_id' });

    const { data: slot, error: errSlot } = await supabase.from('call_slots').select('*').eq('id', req.params.id).maybeSingle();
    if (errSlot) throw errSlot;
    if (!slot) return res.status(404).json({ error: 'Hueco no encontrado' });
    if (slot.ocupado) return res.status(409).json({ error: 'Este hueco ya está reservado — elige otro.' });

    const { data: updatedSlot, error: errUpd } = await supabase
      .from('call_slots')
      .update({ ocupado: true, setting_lead_id, recordatorio_enviado: false, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('ocupado', false) // evita condición de carrera: si otro ya lo reservó entre medias, esto no actualiza nada
      .select('*, empleado:employees(id, name, email), lead:setting_leads(id, nombre, telefono, instagram, estado)')
      .maybeSingle();
    if (errUpd) throw errUpd;
    if (!updatedSlot) return res.status(409).json({ error: 'Este hueco se acaba de reservar — elige otro.' });

    // fecha/hora_inicio están en hora de España (Hernán las elige mirando su
    // reloj) — madridToUtcDate evita que el servidor (UTC en Railway) las
    // interprete mal y desfase la hora guardada 1-2h.
    const fechaLlamadaISO = madridToUtcDate(slot.fecha, slot.hora_inicio).toISOString();
    const { data: lead, error: errLead } = await supabase
      .from('setting_leads')
      .update({ fecha_llamada: fechaLlamadaISO, estado: 'agendado', updated_at: new Date().toISOString() })
      .eq('id', setting_lead_id)
      .select('id, nombre')
      .maybeSingle();
    if (errLead) console.error('Aviso: hueco reservado pero no se pudo actualizar el lead:', errLead);

    // Email inmediato al dueño del hueco, salvo que se lo haya reservado él mismo.
    if (updatedSlot.empleado?.email && updatedSlot.empleado.email !== req.user.email) {
      const { data: l } = await supabase.from('setting_leads').select('nombre, telefono, instagram, objetivo').eq('id', updatedSlot.setting_lead_id).maybeSingle();
      avisarLlamada({ empleado: updatedSlot.empleado, lead: l, fecha: updatedSlot.fecha, hora: updatedSlot.hora_inicio, tipo: 'nueva' });
    }
    res.json({ slot: updatedSlot, lead });
  } catch (error) {
    console.error('Error al reservar hueco de llamada:', error);
    res.status(500).json({ error: 'Error al reservar hueco de llamada' });
  }
});

/**
 * POST /api/call-slots/agendar
 * Agenda una llamada directamente desde el calendario del equipo: se elige
 * persona, día y hora, y un lead existente (setting_lead_id) o uno nuevo
 * (nuevo_lead). Si esa persona tenía un hueco libre a esa hora se reserva; si
 * no, se crea uno ya ocupado. Body: { employee_id, fecha, hora_inicio,
 * duracion_min?, setting_lead_id? | nuevo_lead: { nombre, telefono?, instagram?, canal? } }
 */
router.post('/agendar', async (req, res) => {
  try {
    const { employee_id, fecha, hora_inicio, duracion_min, setting_lead_id, nuevo_lead } = req.body;
    if (!employee_id) return res.status(400).json({ error: 'Elige con quién es la llamada' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) return res.status(400).json({ error: 'Fecha no válida' });
    if (!/^\d{2}:\d{2}/.test(hora_inicio || '')) return res.status(400).json({ error: 'Hora no válida' });
    const hora = hora_inicio.slice(0, 5) + ':00';
    const inicio = madridToUtcDate(fecha, hora);
    if (isNaN(inicio.getTime())) return res.status(400).json({ error: 'Fecha u hora no válidas' });

    const { data: emp } = await supabase.from('employees').select('id, name, email').eq('id', employee_id).maybeSingle();
    if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });

    let leadId = setting_lead_id;
    if (!leadId) {
      if (!nuevo_lead?.nombre?.trim()) return res.status(400).json({ error: 'Elige un lead o escribe el nombre del nuevo' });
      const { data: creado, error: errNuevo } = await supabase.from('setting_leads').insert({
        nombre: nuevo_lead.nombre.trim(),
        telefono: nuevo_lead.telefono?.trim() || null,
        instagram: nuevo_lead.instagram?.trim().replace(/^@+/, '') || null,
        canal: nuevo_lead.canal?.trim() || null,
        estado: 'agendado',
        created_by: req.user.id,
      }).select('id').single();
      if (errNuevo) throw errNuevo;
      leadId = creado.id;
    }

    // Si ese lead ya tenía otra llamada reservada, se libera (una por lead).
    const { data: previos } = await supabase.from('call_slots').select('id, generado_por_regla').eq('setting_lead_id', leadId).eq('ocupado', true);
    for (const p of previos || []) {
      if (p.generado_por_regla) await supabase.from('call_slots').update({ ocupado: false, setting_lead_id: null, recordatorio_enviado: false, recordatorio_30_enviado: false, recordatorio_5_enviado: false, updated_at: new Date().toISOString() }).eq('id', p.id);
      else await supabase.from('call_slots').delete().eq('id', p.id);
    }

    const SELECT = '*, empleado:employees(id, name, email), lead:setting_leads(id, nombre, telefono, instagram, estado)';
    const { data: libre } = await supabase.from('call_slots').select('id').eq('employee_id', emp.id).eq('fecha', fecha).eq('hora_inicio', hora).eq('ocupado', false).limit(1).maybeSingle();
    let slot;
    if (libre) {
      const { data, error } = await supabase.from('call_slots').update({ ocupado: true, setting_lead_id: leadId, updated_at: new Date().toISOString() }).eq('id', libre.id).select(SELECT).single();
      if (error) throw error;
      slot = data;
    } else {
      const dur = Math.min(Math.max(parseInt(duracion_min) || 30, 5), 240);
      const [h, m] = hora.split(':').map(Number);
      const fin = h * 60 + m + dur;
      const horaFin = `${String(Math.floor(fin / 60) % 24).padStart(2, '0')}:${String(fin % 60).padStart(2, '0')}:00`;
      const { data, error } = await supabase.from('call_slots').insert({ employee_id: emp.id, fecha, hora_inicio: hora, hora_fin: horaFin, ocupado: true, setting_lead_id: leadId }).select(SELECT).single();
      if (error) throw error;
      slot = data;
    }

    await supabase.from('setting_leads').update({ estado: 'agendado', fecha_llamada: inicio.toISOString() }).eq('id', leadId);
    if (emp.email && emp.email !== req.user.email) {
      const { data: l } = await supabase.from('setting_leads').select('nombre, telefono, instagram, objetivo').eq('id', leadId).maybeSingle();
      avisarLlamada({ empleado: emp, lead: l, fecha, hora, tipo: 'nueva' });
    }
    res.status(201).json({ slot });
  } catch (error) {
    console.error('Error al agendar llamada:', error);
    res.status(500).json({ error: 'Error al agendar la llamada' });
  }
});

/**
 * PUT /api/call-slots/:id
 * Rellenar el resumen de la llamada (o, si aún no está ocupado, editar el
 * propio horario). Solo el dueño del hueco o un admin puede tocarlo.
 */
router.put('/:id', async (req, res) => {
  try {
    const { resumen_llamada, fecha, hora_inicio, hora_fin, fathom_url, estado_lead } = req.body;
    const empleado = await empleadoActual(req);

    const { data: slot } = await supabase.from('call_slots').select('employee_id').eq('id', req.params.id).maybeSingle();
    if (!slot) return res.status(404).json({ error: 'Hueco no encontrado' });
    const esDueño = empleado && slot.employee_id === empleado.id;
    if (!esDueño && req.user.role !== 'admin_superior') {
      return res.status(403).json({ error: 'Solo el dueño del hueco puede editarlo' });
    }

    const updates = { updated_at: new Date().toISOString() };
    if (resumen_llamada !== undefined) updates.resumen_llamada = resumen_llamada?.trim() || null;
    if (fecha !== undefined) updates.fecha = fecha;
    if (hora_inicio !== undefined) updates.hora_inicio = hora_inicio;
    if (hora_fin !== undefined) updates.hora_fin = hora_fin;
    if (fathom_url !== undefined) {
      const url = (fathom_url || '').trim();
      if (url && !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'El enlace de Fathom tiene que empezar por http:// o https://' });
      updates.fathom_url = url || null;
    }

    // Cambiar el estado del lead de esta llamada desde la propia agenda (con
    // las mismas marcas de fecha de venta que el resto del CRM).
    if (estado_lead !== undefined) {
      if (!ESTADOS_VALIDOS.includes(estado_lead)) return res.status(400).json({ error: 'Estado no válido' });
      const { data: sl } = await supabase.from('call_slots').select('setting_lead_id').eq('id', req.params.id).single();
      if (!sl?.setting_lead_id) return res.status(400).json({ error: 'Este hueco no tiene ningún lead reservado' });
      const cambios = { estado: estado_lead };
      // La fecha de venta se estampa solo si el lead no la tenía ya (si no,
      // cada cambio de estado la movería a hoy y se falsearían las métricas)
      const { data: previo } = await supabase.from('setting_leads').select('fecha_venta_1, fecha_venta_2, fecha_venta_extra').eq('id', sl.setting_lead_id).maybeSingle();
      if (estado_lead === 'venta_1' && !previo?.fecha_venta_1) cambios.fecha_venta_1 = new Date().toISOString();
      if (estado_lead === 'venta_2' && !previo?.fecha_venta_2) cambios.fecha_venta_2 = new Date().toISOString();
      if (estado_lead === 'venta_extra' && !previo?.fecha_venta_extra) cambios.fecha_venta_extra = new Date().toISOString();
      const { error: errLead } = await supabase.from('setting_leads').update(cambios).eq('id', sl.setting_lead_id);
      if (errLead) throw errLead;
    }

    const { data, error } = await supabase.from('call_slots').update(updates).eq('id', req.params.id).select('*, empleado:employees(id, name, email), lead:setting_leads(id, nombre, telefono, instagram, estado)').single();
    if (error) throw error;
    res.json({ slot: data });
  } catch (error) {
    console.error('Error al actualizar hueco de llamada:', error);
    res.status(500).json({ error: 'Error al actualizar hueco de llamada' });
  }
});

/**
 * PUT /api/call-slots/:id/reprogramar
 * Body: { fecha: 'YYYY-MM-DD', hora_inicio: 'HH:MM' }
 * Cambia la fecha/hora de una llamada ya agendada (o de un hueco libre) desde
 * el panel de Agenda. Mantiene la duración, sincroniza la fecha del lead en
 * Setting, reinicia los recordatorios y avisa por email al dueño del hueco
 * ("llamada cambiada de hora"). El hueco de origen vuelve a quedar libre si
 * venía de una regla de disponibilidad (si era suelto, se borra).
 */
router.put('/:id/reprogramar', async (req, res) => {
  try {
    const { fecha, hora_inicio } = req.body;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) return res.status(400).json({ error: 'Fecha no válida' });
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(hora_inicio || '')) return res.status(400).json({ error: 'Hora no válida' });
    const hora = hora_inicio.length === 5 ? `${hora_inicio}:00` : hora_inicio;

    const empleado = await empleadoActual(req);
    const SELECT = '*, empleado:employees(id, name, email), lead:setting_leads(id, nombre, telefono, instagram, objetivo, estado)';
    const { data: slot } = await supabase.from('call_slots').select(SELECT).eq('id', req.params.id).maybeSingle();
    if (!slot) return res.status(404).json({ error: 'Llamada no encontrada' });
    const esDueño = empleado && slot.employee_id === empleado.id;
    if (!esDueño && req.user.role !== 'admin_superior') return res.status(403).json({ error: 'Solo el dueño de la llamada o un administrador puede cambiarla de hora' });

    const [h0, m0] = slot.hora_inicio.split(':').map(Number);
    const [h1, m1] = slot.hora_fin.split(':').map(Number);
    const duracion = Math.max((h1 * 60 + m1) - (h0 * 60 + m0), 5);
    const horaFin = sumarMinutos(hora, duracion);
    if (fecha === slot.fecha && hora === slot.hora_inicio) return res.json({ slot });

    // Choques con otros huecos del mismo empleado ese día
    const { data: delDia } = await supabase.from('call_slots').select('id, hora_inicio, hora_fin, ocupado').eq('employee_id', slot.employee_id).eq('fecha', fecha).neq('id', slot.id);
    const solapan = (delDia || []).filter(o => o.hora_inicio < horaFin && o.hora_fin > hora);
    if (solapan.some(o => o.ocupado)) return res.status(409).json({ error: 'A esa hora ya hay otra llamada agendada. Elige otra hora.' });

    const ahora = new Date().toISOString();
    const reinicio = { recordatorio_enviado: false, recordatorio_30_enviado: false, recordatorio_5_enviado: false, updated_at: ahora };

    // Hueco libre: simplemente se mueve
    if (!slot.ocupado) {
      for (const o of solapan) await supabase.from('call_slots').delete().eq('id', o.id);
      const { data, error } = await supabase.from('call_slots').update({ fecha, hora_inicio: hora, hora_fin: horaFin, ...reinicio }).eq('id', slot.id).select(SELECT).single();
      if (error) throw error;
      return res.json({ slot: data });
    }

    // Llamada reservada: se ocupa el hueco nuevo (libre si existe, si no uno nuevo) y se libera/borra el antiguo
    const exacto = solapan.find(o => !o.ocupado && o.hora_inicio === hora && o.hora_fin === horaFin);
    for (const o of solapan) if (!exacto || o.id !== exacto.id) await supabase.from('call_slots').delete().eq('id', o.id);
    let nuevo;
    if (exacto) {
      const { data, error } = await supabase.from('call_slots').update({ ocupado: true, setting_lead_id: slot.setting_lead_id, resumen_llamada: slot.resumen_llamada, fathom_url: slot.fathom_url, ...reinicio }).eq('id', exacto.id).select(SELECT).single();
      if (error) throw error;
      nuevo = data;
    } else {
      const { data, error } = await supabase.from('call_slots').insert({ employee_id: slot.employee_id, fecha, hora_inicio: hora, hora_fin: horaFin, ocupado: true, setting_lead_id: slot.setting_lead_id, resumen_llamada: slot.resumen_llamada, fathom_url: slot.fathom_url }).select(SELECT).single();
      if (error) throw error;
      nuevo = data;
    }
    if (slot.generado_por_regla) await supabase.from('call_slots').update({ ocupado: false, setting_lead_id: null, resumen_llamada: null, fathom_url: null, ...reinicio }).eq('id', slot.id);
    else await supabase.from('call_slots').delete().eq('id', slot.id);

    if (slot.setting_lead_id) {
      await supabase.from('setting_leads').update({ fecha_llamada: madridToUtcDate(fecha, hora).toISOString(), updated_at: ahora }).eq('id', slot.setting_lead_id);
      if (slot.empleado?.email && slot.empleado.email !== req.user.email) {
        avisarLlamada({ empleado: slot.empleado, lead: slot.lead, fecha, hora, tipo: 'cambiada' });
      }
    }
    res.json({ slot: nuevo });
  } catch (error) {
    console.error('Error al reprogramar la llamada:', error);
    res.status(500).json({ error: 'Error al cambiar la hora de la llamada' });
  }
});

/**
 * DELETE /api/call-slots/:id
 * Solo huecos SIN reservar, y solo el dueño (o admin) — para no borrar una
 * llamada ya agendada con un lead sin querer.
 */
router.delete('/:id', async (req, res) => {
  try {
    const empleado = await empleadoActual(req);
    const { data: slot } = await supabase.from('call_slots').select('employee_id, ocupado').eq('id', req.params.id).maybeSingle();
    if (!slot) return res.status(404).json({ error: 'Hueco no encontrado' });
    const esDueño = empleado && slot.employee_id === empleado.id;
    if (!esDueño && req.user.role !== 'admin_superior') {
      return res.status(403).json({ error: 'Solo el dueño del hueco puede eliminarlo' });
    }
    if (slot.ocupado && req.user.role !== 'admin_superior') {
      return res.status(409).json({ error: 'Este hueco ya tiene una llamada agendada — cancélala primero desde Setting.' });
    }
    const { error } = await supabase.from('call_slots').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Hueco eliminado' });
  } catch (error) {
    console.error('Error al eliminar hueco de llamada:', error);
    res.status(500).json({ error: 'Error al eliminar hueco de llamada' });
  }
});

export default router;

/**
 * Genera los huecos REALES (call_slots) para las próximas 6 semanas a
 * partir de las reglas de disponibilidad recurrente activas — idempotente
 * (no duplica huecos que ya existan). Se llama al crear/reactivar una
 * regla, y periódicamente desde index.js, para que siempre haya huecos
 * disponibles varias semanas por delante sin que nadie tenga que acordarse
 * de generarlos a mano.
 */
const SEMANAS_A_GENERAR = 6;

function sumarMinutos(hhmmss, minutos) {
  const [h, m] = hhmmss.split(':').map(Number);
  const total = h * 60 + m + minutos;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
}

export async function generarSlotsDesdeReglas() {
  try {
    const { data: reglas, error: errReglas } = await supabase.from('call_availability_rules').select('*').eq('activo', true);
    if (errReglas) throw errReglas;
    if (!reglas?.length) return;

    const hoy = new Date();
    const fechaFin = new Date(hoy.getTime() + SEMANAS_A_GENERAR * 7 * 24 * 60 * 60 * 1000);
    const desde = hoy.toISOString().slice(0, 10);
    const hasta = fechaFin.toISOString().slice(0, 10);

    const employeeIds = [...new Set(reglas.map(r => r.employee_id))];
    const { data: existentes, error: errExist } = await supabase
      .from('call_slots')
      .select('employee_id, fecha, hora_inicio')
      .in('employee_id', employeeIds)
      .gte('fecha', desde)
      .lte('fecha', hasta);
    if (errExist) throw errExist;
    const yaExisten = new Set((existentes || []).map(s => `${s.employee_id}|${s.fecha}|${s.hora_inicio}`));

    const nuevos = [];
    for (let i = 0; i <= SEMANAS_A_GENERAR * 7; i++) {
      const dia = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + i);
      const diaSemana = dia.getDay(); // cálculo puramente de calendario, no depende de zona horaria
      const fechaStr = `${dia.getFullYear()}-${String(dia.getMonth() + 1).padStart(2, '0')}-${String(dia.getDate()).padStart(2, '0')}`;

      for (const regla of reglas.filter(r => r.dia_semana === diaSemana)) {
        let cursor = regla.hora_inicio;
        while (cursor < regla.hora_fin) {
          const finTramo = sumarMinutos(cursor, regla.duracion_llamada_min);
          if (finTramo > regla.hora_fin) break; // no cabe un tramo completo más
          const clave = `${regla.employee_id}|${fechaStr}|${cursor}`;
          if (!yaExisten.has(clave)) {
            nuevos.push({ employee_id: regla.employee_id, fecha: fechaStr, hora_inicio: cursor, hora_fin: finTramo, generado_por_regla: regla.id });
            yaExisten.add(clave);
          }
          cursor = finTramo;
        }
      }
    }

    if (nuevos.length) {
      const { error: errInsert } = await supabase.from('call_slots').insert(nuevos);
      if (errInsert) throw errInsert;
      console.log(`[agenda] Generados ${nuevos.length} huecos nuevos desde reglas de disponibilidad.`);
    }
  } catch (error) {
    console.error('Error al generar huecos desde reglas de disponibilidad:', error);
  }
}

/**
 * Recordatorio por email a quien tiene la llamada (ej. Hernán), para las
 * que caen dentro de las próximas ~24h y todavía no se ha avisado. Se llama
 * periódicamente desde index.js (setInterval) — no es una ruta HTTP.
 */
export async function enviarRecordatoriosLlamadas() {
  try {
    const ahora = new Date();
    const { data: slots, error } = await supabase
      .from('call_slots')
      .select('id, fecha, hora_inicio, hora_fin, recordatorio_enviado, recordatorio_30_enviado, recordatorio_5_enviado, empleado:employees(name, email), lead:setting_leads(nombre, telefono, instagram, objetivo)')
      .eq('ocupado', true)
      .gte('fecha', ahora.toISOString().slice(0, 10));
    if (error) throw error;
    if (!slots?.length) return;

    for (const s of slots) {
      const inicio = madridToUtcDate(s.fecha, s.hora_inicio);
      const min = (inicio - ahora) / 60000; // minutos que faltan; negativo = ya empezó
      if (min < 0 || min > 24 * 60) continue;
      if (!s.empleado?.email) continue;

      // Cuál toca ahora: de más lejano a más cercano. Si el aviso grande ya
      // no tiene sentido (la llamada está más cerca que su ventana, ej. se
      // agendó con 20 min de margen), se marca como hecho sin mandarlo, para
      // no soltar tres emails seguidos.
      let tipo = null, columna = null;
      if (min <= 5 && !s.recordatorio_5_enviado) { tipo = '5'; columna = 'recordatorio_5_enviado'; }
      else if (min <= 30 && min > 5 && !s.recordatorio_30_enviado) { tipo = '30'; columna = 'recordatorio_30_enviado'; }
      else if (min > 30 && !s.recordatorio_enviado) { tipo = '24h'; columna = 'recordatorio_enviado'; }
      const marcarSaltados = {};
      if (min <= 30 && !s.recordatorio_enviado) marcarSaltados.recordatorio_enviado = true;
      if (min <= 5 && !s.recordatorio_30_enviado) marcarSaltados.recordatorio_30_enviado = true;
      if (Object.keys(marcarSaltados).length) await supabase.from('call_slots').update(marcarSaltados).eq('id', s.id);
      if (!tipo) continue;

      // timeZone explícito — el servidor formatea en su propia zona (UTC en
      // Railway) si no se lo decimos, y saldría la hora equivocada en el email.
      const fechaFmt = inicio.toLocaleDateString('es-ES', { weekday: 'long', day: '2-digit', month: 'long', timeZone: 'Europe/Madrid' });
      const horaFmt = inicio.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
      const nombreLead = s.lead?.nombre || 'Prospecto sin nombre';
      const titulo = tipo === '5' ? 'Tu llamada empieza en 5 minutos' : tipo === '30' ? 'Tu llamada es en 30 minutos' : 'Recordatorio: llamada mañana';
      const asunto = tipo === '5' ? `⏰ En 5 min: llamada con ${nombreLead}` : tipo === '30' ? `En 30 min: llamada con ${nombreLead}` : `Recordatorio: llamada con ${nombreLead} — ${fechaFmt} ${horaFmt}`;
      const html = `
        <div style="font-family: sans-serif; color: #222;">
          <h2>${titulo}</h2>
          <p>Hola ${s.empleado.name || ''},</p>
          <ul>
            <li><strong>Con:</strong> ${nombreLead}</li>
            <li><strong>Cuándo:</strong> ${fechaFmt} a las ${horaFmt}</li>
            ${s.lead?.telefono ? `<li><strong>Teléfono:</strong> ${s.lead.telefono}</li>` : ''}
            ${s.lead?.instagram ? `<li><strong>Instagram:</strong> @${s.lead.instagram}</li>` : ''}
            ${s.lead?.objetivo ? `<li><strong>Objetivo:</strong> ${s.lead.objetivo}</li>` : ''}
          </ul>
          <p>Puedes ver el historial completo en Setting antes de la llamada.</p>
        </div>
      `;
      const resultado = await sendEmail({ to: s.empleado.email, subject: asunto, html });
      if (resultado.sent) await supabase.from('call_slots').update({ [columna]: true }).eq('id', s.id);
    }
  } catch (error) {
    console.error('Error al enviar recordatorios de llamadas:', error);
  }
}
