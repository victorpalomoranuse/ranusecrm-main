import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdminSuperior, requirePermission } from '../middleware/auth.middleware.js';

const router = express.Router();
// Misma sección de la que ya disponen los que gestionan Leads (mismo
// permiso) — Setting es un embudo previo, independiente del de Leads.
const requireSetting = requirePermission('leads');

// "nuevo" (antes llamado "ads") es la etapa inicial del embudo, antes de
// cualquier interacción real — se renombró para no confundirse con el
// CANAL "Ads" (origen del contacto), que es un concepto aparte.
// "agendado" = ya tiene fecha/hora de llamada confirmada con Hernán (viene
// justo después de "pitcheo_agenda", que es cuando se está intentando
// conseguir esa cita todavía).
// "venta_1"/"venta_2" = compró el servicio 1 / el servicio 2 — son dos
// ventas independientes, no excluyentes (se puede comprar solo una, o las
// dos, en cualquier orden) — ver fecha_venta_1/fecha_venta_2 más abajo, que
// es de donde salen los % de cierre por separado/combinado. "rechazo" y
// "seguimiento_futuro" son dos desenlaces más de la llamada, aparte de
// "no_responde"/"no_califica" (que son de antes de llegar a hablar).
export const ESTADOS_VALIDOS = ['nuevo', 'interesado', 'no_califica', 'contacto_nuevo', 'pitcheo_agenda', 'agendado', 'recolectando_info', 'prioridad', 'venta_1', 'venta_2', 'rechazo', 'seguimiento_futuro', 'no_responde'];

// Origen del contacto — usado tanto en el formulario manual como por el
// Asistente Setter (que debe preguntar cuál aplica cuando no lo tenga claro,
// en vez de adivinarlo).
export const CANALES_VALIDOS = ['Instagram (nos escriben)', 'Instagram (prospección)', 'Ads', 'Referido', 'WhatsApp', 'Otro'];

router.get('/', authenticateToken, requireSetting, async (req, res) => {
  try {
    const { data: registros, error } = await supabase
      .from('setting_leads')
      .select('*, empleado:employees(id, name)')
      .order('created_at', { ascending: false });
    if (error) throw error;

    const total = registros.length;
    const porEstado = {};
    ESTADOS_VALIDOS.forEach(e => { porEstado[e] = 0; });
    registros.forEach(r => { if (porEstado[r.estado] !== undefined) porEstado[r.estado]++; });

    // Venta 1 y Venta 2 son independientes entre sí (fecha_venta_1/2), no el
    // estado actual del kanban — así un lead que ya está en "venta_2" pero
    // también compró antes el servicio 1 sigue contando en ambos lados.
    const compraron1 = registros.filter(r => r.fecha_venta_1).length;
    const compraron2 = registros.filter(r => r.fecha_venta_2).length;
    const compraronAmbos = registros.filter(r => r.fecha_venta_1 && r.fecha_venta_2).length;
    const soloVenta1 = registros.filter(r => r.fecha_venta_1 && !r.fecha_venta_2).length;
    const soloVenta2 = registros.filter(r => r.fecha_venta_2 && !r.fecha_venta_1).length;
    const ventas = registros.filter(r => r.fecha_venta_1 || r.fecha_venta_2).length; // nº de leads que han comprado algo
    const tasaCrossSell = compraron1 > 0 ? Math.round((compraronAmbos / compraron1) * 100) : 0; // de los que compraron 1, % que también compró 2
    // % de cierre de CADA venta por separado (sobre el total de leads), sin
    // mezclarlas entre sí — independiente del % cruzado de arriba.
    const tasaVenta1 = total > 0 ? Math.round((compraron1 / total) * 100) : 0;
    const tasaVenta2 = total > 0 ? Math.round((compraron2 / total) * 100) : 0;

    const rechazo = porEstado.rechazo || 0;
    const seguimientoFuturo = porEstado.seguimiento_futuro || 0;
    const noResponde = porEstado.no_responde || 0;
    const noCalifica = porEstado.no_califica || 0;
    const cerrados = ventas + noResponde + noCalifica + rechazo;
    const activos = total - cerrados;
    const tasaCierre = total > 0 ? Math.round((ventas / total) * 100) : 0;
    const tasaCalificacion = total > 0 ? Math.round(((total - noCalifica) / total) * 100) : 0;

    // Tasa de cierre DE LLAMADAS (distinta de la tasa de cierre general):
    // de los que llegaron a tener una llamada agendada (fecha_llamada), qué
    // % acabó comprando algo — mide específicamente cómo de bien se cierra
    // en la llamada, no todo el embudo desde el primer contacto.
    const conLlamada = registros.filter(r => r.fecha_llamada).length;
    const tasaCierreLlamadas = conLlamada > 0 ? Math.round((ventas / conLlamada) * 100) : 0;

    // Normalizado sin distinguir mayúsculas/minúsculas — el Asistente Setter
    // guarda "Instagram"/"WhatsApp"/"Ads" con mayúscula inicial, pero el
    // formulario manual ofrece las mismas opciones en minúscula, así que sin
    // normalizar aparecían como canales distintos en el desglose.
    const porCanal = {};
    registros.forEach(r => {
      const raw = (r.canal || 'otro').trim();
      const c = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
      if (!porCanal[c]) porCanal[c] = { total: 0, ventas: 0 };
      porCanal[c].total++;
      if (r.fecha_venta_1 || r.fecha_venta_2) porCanal[c].ventas++;
    });

    res.json({
      registros,
      metricas: {
        total, activos, ventas, noResponde, noCalifica, rechazo, seguimientoFuturo,
        tasaCierre, tasaCalificacion, tasaCierreLlamadas, conLlamada,
        compraron1, compraron2, soloVenta1, soloVenta2, compraronAmbos, tasaCrossSell, tasaVenta1, tasaVenta2,
      },
      porEstado,
      porCanal,
    });
  } catch (error) {
    console.error('Error al listar setting:', error);
    res.status(500).json({ error: 'Error al listar setting' });
  }
});

router.get('/:id', authenticateToken, requireSetting, async (req, res) => {
  try {
    const { data, error } = await supabase.from('setting_leads').select('*, empleado:employees(id, name)').eq('id', req.params.id).single();
    if (error || !data) return res.status(404).json({ error: 'Registro no encontrado' });
    res.json({ registro: data });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener registro' });
  }
});

router.post('/', authenticateToken, requireSetting, async (req, res) => {
  try {
    const { nombre, telefono, instagram, email, canal, estado, objetivo, medidas, maquinarias, notas, assigned_to, fecha_llamada, fecha_venta_1, fecha_venta_2, created_at } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es requerido' });

    const estadoFinal = ESTADOS_VALIDOS.includes(estado) ? estado : 'nuevo';
    const { data, error } = await supabase
      .from('setting_leads')
      .insert({
        nombre: nombre.trim(),
        telefono: telefono?.trim() || null,
        instagram: instagram?.trim().replace(/^@+/, '') || null,
        email: email?.trim() || null,
        canal: canal?.trim() || null,
        estado: estadoFinal,
        objetivo: objetivo?.trim() || null,
        medidas: medidas?.trim() || null,
        maquinarias: maquinarias?.trim() || null,
        notas: notas?.trim() || null,
        assigned_to: assigned_to || null,
        fecha_llamada: fecha_llamada || null,
        // Si se da una fecha de venta a mano (ej. al dar de alta un lead
        // retroactivo que ya sabes que compró), se respeta esa; si no, se
        // estampa sola solo cuando el estado inicial ya es venta_1/venta_2.
        fecha_venta_1: fecha_venta_1 || (estadoFinal === 'venta_1' ? new Date().toISOString() : null),
        fecha_venta_2: fecha_venta_2 || (estadoFinal === 'venta_2' ? new Date().toISOString() : null),
        // Permite dar de alta un lead con la fecha real en la que entró
        // (ej. datos históricos que se cargan más tarde) en vez de "ahora".
        ...(created_at ? { created_at } : {}),
        created_by: req.user.id,
      })
      .select('*, empleado:employees(id, name)')
      .single();
    if (error) throw error;
    res.status(201).json({ registro: data });
  } catch (error) {
    console.error('Error al crear registro de setting:', error);
    res.status(500).json({ error: 'Error al crear registro' });
  }
});

router.put('/:id', authenticateToken, requireSetting, async (req, res) => {
  try {
    const { nombre, telefono, instagram, email, canal, estado, objetivo, medidas, maquinarias, notas, nota_nueva, assigned_to, fecha_llamada, fecha_venta_1, fecha_venta_2, created_at } = req.body;
    const updates = { updated_at: new Date().toISOString() };
    if (nombre !== undefined) updates.nombre = nombre.trim();
    if (telefono !== undefined) updates.telefono = telefono?.trim() || null;
    if (instagram !== undefined) updates.instagram = instagram?.trim().replace(/^@+/, '') || null;
    if (email !== undefined) updates.email = email?.trim() || null;
    if (canal !== undefined) updates.canal = canal?.trim() || null;
    if (estado !== undefined && ESTADOS_VALIDOS.includes(estado)) {
      updates.estado = estado;
      // Al mover el lead a "venta_1"/"venta_2" se estampa la fecha
      // automáticamente (si no la tenía ya) — así no hace falta que nadie
      // rellene la fecha a mano, y los % de cierre salen bien solos.
      if (estado === 'venta_1') updates.fecha_venta_1 = new Date().toISOString();
      if (estado === 'venta_2') updates.fecha_venta_2 = new Date().toISOString();
    }
    if (objetivo !== undefined) updates.objetivo = objetivo?.trim() || null;
    if (medidas !== undefined) updates.medidas = medidas?.trim() || null;
    if (maquinarias !== undefined) updates.maquinarias = maquinarias?.trim() || null;
    if (notas !== undefined) updates.notas = notas?.trim() || null;
    if (assigned_to !== undefined) updates.assigned_to = assigned_to || null;
    if (fecha_llamada !== undefined) updates.fecha_llamada = fecha_llamada || null;
    // Permite corregir/quitar la fecha de venta a mano si hiciera falta
    // (ej. se marcó por error, o se quiere poner la fecha real de cobro).
    if (fecha_venta_1 !== undefined) updates.fecha_venta_1 = fecha_venta_1 || null;
    if (fecha_venta_2 !== undefined) updates.fecha_venta_2 = fecha_venta_2 || null;
    // Fecha de creación editable a mano (ej. para corregir un lead
    // registrado tarde con la fecha real en la que entró de verdad).
    if (created_at) updates.created_at = created_at;

    // nota_nueva: añade una línea con fecha al final del historial en vez de
    // sobrescribir todo el campo "notas" — así Hernán (o quien sea) puede
    // dejar un comentario rápido de avance sin tener que copiar/pegar todo
    // lo que ya había escrito antes.
    if (nota_nueva?.trim()) {
      // El JWT no lleva el nombre (solo id/email/permisos) — se busca aparte
      // por email para poder firmar el comentario con quién lo dejó.
      const [{ data: actual }, { data: autorEmp }] = await Promise.all([
        supabase.from('setting_leads').select('notas').eq('id', req.params.id).maybeSingle(),
        req.user.email ? supabase.from('employees').select('name').eq('email', req.user.email).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      const fecha = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const autor = autorEmp?.name ? ` — ${autorEmp.name}` : '';
      const linea = `[${fecha}${autor}] ${nota_nueva.trim()}`;
      updates.notas = actual?.notas ? `${actual.notas}\n${linea}` : linea;
    }

    const { data, error } = await supabase.from('setting_leads').update(updates).eq('id', req.params.id).select('*, empleado:employees(id, name)').single();
    if (error) throw error;
    res.json({ registro: data });
  } catch (error) {
    console.error('Error al actualizar registro de setting:', error);
    res.status(500).json({ error: 'Error al actualizar registro' });
  }
});

router.delete('/:id', authenticateToken, requireAdminSuperior, async (req, res) => {
  try {
    const { error } = await supabase.from('setting_leads').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Registro eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar registro' });
  }
});

export default router;
