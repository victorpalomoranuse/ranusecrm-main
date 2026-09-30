import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';
import { sendEmail } from '../services/email.service.js';
import { madridToUtcDate } from '../utils/timezone.js';

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
      .select('*, empleado:employees(id, name, email), lead:setting_leads(id, nombre, telefono, instagram)')
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
      .select('*, empleado:employees(id, name, email), lead:setting_leads(id, nombre, telefono, instagram)')
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

    res.json({ slot: updatedSlot, lead });
  } catch (error) {
    console.error('Error al reservar hueco de llamada:', error);
    res.status(500).json({ error: 'Error al reservar hueco de llamada' });
  }
});

/**
 * PUT /api/call-slots/:id
 * Rellenar el resumen de la llamada (o, si aún no está ocupado, editar el
 * propio horario). Solo el dueño del hueco o un admin puede tocarlo.
 */
router.put('/:id', async (req, res) => {
  try {
    const { resumen_llamada, fecha, hora_inicio, hora_fin } = req.body;
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

    const { data, error } = await supabase.from('call_slots').update(updates).eq('id', req.params.id).select('*, empleado:employees(id, name, email), lead:setting_leads(id, nombre, telefono, instagram)').single();
    if (error) throw error;
    res.json({ slot: data });
  } catch (error) {
    console.error('Error al actualizar hueco de llamada:', error);
    res.status(500).json({ error: 'Error al actualizar hueco de llamada' });
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
 * Recordatorio por email a quien tiene la llamada (ej. Hernán), para las
 * que caen dentro de las próximas ~24h y todavía no se ha avisado. Se llama
 * periódicamente desde index.js (setInterval) — no es una ruta HTTP.
 */
export async function enviarRecordatoriosLlamadas() {
  try {
    const ahora = new Date();
    const en24h = new Date(ahora.getTime() + 24 * 60 * 60 * 1000);
    const { data: slots, error } = await supabase
      .from('call_slots')
      .select('id, fecha, hora_inicio, hora_fin, empleado:employees(name, email), lead:setting_leads(nombre, telefono, instagram, objetivo)')
      .eq('ocupado', true)
      .eq('recordatorio_enviado', false)
      .gte('fecha', ahora.toISOString().slice(0, 10));
    if (error) throw error;
    if (!slots?.length) return;

    for (const s of slots) {
      const inicio = madridToUtcDate(s.fecha, s.hora_inicio);
      if (inicio < ahora || inicio > en24h) continue; // fuera de la ventana de 24h, o ya pasó

      if (!s.empleado?.email) continue;
      // timeZone explícito — el servidor formatea en su propia zona (UTC en
      // Railway) si no se lo decimos, y saldría la hora equivocada en el email.
      const fechaFmt = inicio.toLocaleDateString('es-ES', { weekday: 'long', day: '2-digit', month: 'long', timeZone: 'Europe/Madrid' });
      const horaFmt = inicio.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
      const nombreLead = s.lead?.nombre || 'Prospecto sin nombre';
      const html = `
        <div style="font-family: sans-serif; color: #222;">
          <h2>Recordatorio: llamada mañana</h2>
          <p>Hola ${s.empleado.name || ''},</p>
          <p>Tienes una llamada agendada:</p>
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
      const resultado = await sendEmail({ to: s.empleado.email, subject: `Recordatorio: llamada con ${nombreLead} — ${fechaFmt} ${horaFmt}`, html });
      if (resultado.sent) {
        await supabase.from('call_slots').update({ recordatorio_enviado: true }).eq('id', s.id);
      }
    }
  } catch (error) {
    console.error('Error al enviar recordatorios de llamadas:', error);
  }
}
