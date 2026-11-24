import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { estadoVisible, totalesHitos, hoyISO, avisosHitos } from '../utils/cobros.js';

const router = express.Router();
// Cobros del cliente: solo administración y quien tenga el permiso de finanzas.
router.use(authenticateToken, (req, res, next) => {
  if (req.user?.role === 'admin_superior' || (req.user?.role === 'trabajador' && req.user.permissions?.finanzas === true)) return next();
  res.status(403).json({ error: 'Acceso denegado. Los cobros son de administración o finanzas.' });
});

const SELECT = 'id, project_id, budget_id, orden, concepto, porcentaje, importe, fecha_prevista, fecha_cobro, metodo, num_factura, estado, disparador, avance_minimo, movimiento_id';
const aVista = (h, avance, hoy) => ({ ...h, importe: Number(h.importe), porcentaje: Number(h.porcentaje), estado_visible: estadoVisible(h, hoy), listo: h.estado !== 'cobrado' && (h.disparador === 'avance_obra' ? (avance || 0) >= (h.avance_minimo ?? 101) : true) });

async function proyectoCompleto(projectId) {
  const hoy = hoyISO();
  const [{ data: hitos }, { data: pr }, { data: bu }] = await Promise.all([
    supabase.from('payment_milestones').select(SELECT).eq('project_id', projectId).order('budget_id').order('orden'),
    supabase.from('client_projects').select('id, project_name, client_name, avance_obra').eq('id', projectId).maybeSingle(),
    supabase.from('budgets').select('id, budget_number, budget_name, status').eq('project_id', projectId),
  ]);
  const avance = pr?.avance_obra || 0;
  const lista = (hitos || []).map(h => aVista(h, avance, hoy));
  const t = totalesHitos(lista);
  return { proyecto: pr, presupuestos: bu || [], hitos: lista, ...t, avance, aviso: avance > t.pct ? { avance, cobradoPct: t.pct, texto: `La obra va al ${avance}% y solo se ha cobrado el ${t.pct}%.` } : null };
}

// Hitos de un proyecto (suman todos sus presupuestos aprobados)
router.get('/proyecto/:id', async (req, res) => {
  try { res.json(await proyectoCompleto(req.params.id)); }
  catch (e) { res.status(500).json({ error: 'No se pudieron cargar los cobros' }); }
});

// Hitos de un presupuesto
router.get('/presupuesto/:id', async (req, res) => {
  try {
    const { data: b } = await supabase.from('budgets').select('id, project_id, status').eq('id', req.params.id).maybeSingle();
    if (!b) return res.status(404).json({ error: 'Presupuesto no encontrado' });
    const { data: pr } = b.project_id ? await supabase.from('client_projects').select('avance_obra').eq('id', b.project_id).maybeSingle() : { data: null };
    const { data: hitos } = await supabase.from('payment_milestones').select(SELECT).eq('budget_id', b.id).order('orden');
    const hoy = hoyISO(), lista = (hitos || []).map(h => aVista(h, pr?.avance_obra || 0, hoy));
    res.json({ hitos: lista, ...totalesHitos(lista), project_id: b.project_id, avance: pr?.avance_obra || 0, aprobado: b.status === 'aprobado' });
  } catch (e) { res.status(500).json({ error: 'No se pudieron cargar los cobros' }); }
});

// Editar un hito (concepto, %, fecha prevista, factura…) o marcarlo cobrado / facturado
router.put('/hito/:id', async (req, res) => {
  try {
    const { data: h } = await supabase.from('payment_milestones').select('*').eq('id', req.params.id).maybeSingle();
    if (!h) return res.status(404).json({ error: 'Hito no encontrado' });
    const b = req.body || {}, up = {};
    if (b.concepto !== undefined) up.concepto = String(b.concepto).trim().slice(0, 160) || h.concepto;
    if (b.importe !== undefined) up.importe = Math.max(0, Number(b.importe) || 0);
    if (b.porcentaje !== undefined) up.porcentaje = Math.max(0, Math.min(100, Number(b.porcentaje) || 0));
    if (b.fecha_prevista !== undefined) up.fecha_prevista = b.fecha_prevista || null;
    if (b.metodo !== undefined) up.metodo = String(b.metodo || '').trim().slice(0, 40) || null;
    if (b.num_factura !== undefined) up.num_factura = String(b.num_factura || '').trim().slice(0, 60) || null;
    if (b.disparador !== undefined && ['manual', 'aprobacion', 'avance_obra'].includes(b.disparador)) up.disparador = b.disparador;
    if (b.avance_minimo !== undefined) up.avance_minimo = b.avance_minimo === null || b.avance_minimo === '' ? null : Math.max(0, Math.min(100, parseInt(b.avance_minimo) || 0));
    if (b.fecha_cobro !== undefined) up.fecha_cobro = b.fecha_cobro || null;
    if (b.estado !== undefined && ['pendiente', 'facturado', 'cobrado'].includes(b.estado)) up.estado = b.estado;

    const importe = up.importe ?? Number(h.importe);
    // cobrado: apunta el ingreso en Finanzas (una sola vez) con la venta del proyecto si existe
    if (up.estado === 'cobrado' && h.estado !== 'cobrado') {
      up.fecha_cobro = up.fecha_cobro || hoyISO();
      const { data: v } = await supabase.from('ventas').select('id').eq('client_project_id', h.project_id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      const { data: pr } = await supabase.from('client_projects').select('project_name, client_name').eq('id', h.project_id).maybeSingle();
      const { data: mov, error: em } = await supabase.from('finanzas_movimientos').insert({
        tipo: 'ingreso', categoria: h.orden === 1 ? 'Anticipo' : 'Venta proyecto', concepto: `${h.concepto} · ${pr?.project_name || pr?.client_name || 'proyecto'}`,
        monto: importe, fecha: up.fecha_cobro, metodo_pago: up.metodo ?? h.metodo ?? null, venta_id: v?.id || null, created_by: req.user.id,
        notas: up.num_factura ?? h.num_factura ? 'Factura ' + (up.num_factura ?? h.num_factura) : null,
      }).select('id').single();
      if (!em) up.movimiento_id = mov.id;
    }
    // deshacer un cobro: quita el ingreso que se creó
    if (up.estado && up.estado !== 'cobrado' && h.estado === 'cobrado') {
      if (h.movimiento_id) await supabase.from('finanzas_movimientos').delete().eq('id', h.movimiento_id);
      up.movimiento_id = null; up.fecha_cobro = null;
    }
    const { data, error } = await supabase.from('payment_milestones').update(up).eq('id', h.id).select(SELECT).single();
    if (error) throw error;
    res.json({ hito: data });
  } catch (e) { console.error('cobros hito:', e); res.status(500).json({ error: 'No se pudo guardar el hito' }); }
});

// Añadir un hito a un presupuesto
router.post('/presupuesto/:id/hitos', async (req, res) => {
  try {
    const { data: b } = await supabase.from('budgets').select('id, project_id').eq('id', req.params.id).maybeSingle();
    if (!b?.project_id) return res.status(400).json({ error: 'El presupuesto debe estar vinculado a un proyecto' });
    const { data: u } = await supabase.from('payment_milestones').select('orden').eq('budget_id', b.id).order('orden', { ascending: false }).limit(1).maybeSingle();
    const x = req.body || {};
    const { data, error } = await supabase.from('payment_milestones').insert({
      project_id: b.project_id, budget_id: b.id, orden: (u?.orden || 0) + 1, concepto: String(x.concepto || 'Nuevo pago').slice(0, 160),
      porcentaje: Math.max(0, Math.min(100, Number(x.porcentaje) || 0)), importe: Math.max(0, Number(x.importe) || 0), fecha_prevista: x.fecha_prevista || null,
    }).select(SELECT).single();
    if (error) throw error;
    res.status(201).json({ hito: data });
  } catch (e) { res.status(500).json({ error: 'No se pudo crear el hito' }); }
});

router.delete('/hito/:id', async (req, res) => {
  try {
    const { data: h } = await supabase.from('payment_milestones').select('estado').eq('id', req.params.id).maybeSingle();
    if (h?.estado === 'cobrado') return res.status(400).json({ error: 'Un hito cobrado no se borra: primero deshaz el cobro.' });
    await supabase.from('payment_milestones').delete().eq('id', req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'No se pudo borrar' }); }
});

// Avance de obra del proyecto (%)
router.put('/proyecto/:id/avance', async (req, res) => {
  try {
    const avance = Math.max(0, Math.min(100, parseInt(req.body?.avance) || 0));
    const { error } = await supabase.from('client_projects').update({ avance_obra: avance }).eq('id', req.params.id);
    if (error) throw error;
    res.json(await proyectoCompleto(req.params.id));
  } catch (e) { res.status(500).json({ error: 'No se pudo guardar el avance' }); }
});

// Finanzas: cobros del mes, pendientes de facturar, vencidos y previsión de caja a 30/60 días + avisos de obra
router.get('/resumen', async (req, res) => {
  try {
    const hoy = hoyISO(), mes = hoy.slice(0, 7);
    const mas = d => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
    const { data } = await supabase.from('payment_milestones').select(SELECT + ', project:client_projects(project_name, client_name, avance_obra)');
    const hitos = data || [], n = h => Number(h.importe);
    const abiertos = hitos.filter(h => h.estado !== 'cobrado');
    const suma = l => Math.round(l.reduce((s, h) => s + n(h), 0) * 100) / 100;
    const vencidos = abiertos.filter(h => h.fecha_prevista && h.fecha_prevista < hoy);
    const previsto = dias => abiertos.filter(h => h.fecha_prevista && h.fecha_prevista >= hoy && h.fecha_prevista <= mas(dias));
    const porProy = {};
    hitos.forEach(h => { (porProy[h.project_id] = porProy[h.project_id] || { h: [], p: h.project }).h.push(h); });
    const avisos = Object.entries(porProy).map(([id, v]) => { const t = totalesHitos(v.h), av = v.p?.avance_obra || 0; return { project_id: id, nombre: v.p?.project_name || v.p?.client_name || 'Proyecto', avance: av, cobradoPct: t.pct, pendiente: t.pendiente }; }).filter(a => a.avance > a.cobradoPct);
    res.json({
      cobradoMes: suma(hitos.filter(h => h.estado === 'cobrado' && (h.fecha_cobro || '').startsWith(mes))),
      pendienteFacturar: suma(abiertos.filter(h => h.estado === 'pendiente')),
      porCobrar: suma(abiertos),
      vencido: suma(vencidos), nVencidos: vencidos.length,
      prevision30: suma(previsto(30)), prevision60: suma(previsto(60)),
      vencidos: vencidos.slice(0, 20).map(h => ({ id: h.id, concepto: h.concepto, importe: n(h), fecha_prevista: h.fecha_prevista, proyecto: h.project?.project_name || h.project?.client_name || '' })),
      avisos,
    });
  } catch (e) { console.error('cobros resumen:', e); res.status(500).json({ error: 'No se pudo calcular el resumen de cobros' }); }
});

// Punto de enganche para los recordatorios al cliente (no envía nada todavía)
router.get('/avisos', async (req, res) => { try { res.json({ avisos: await avisosHitos(parseInt(req.query.dias) || 7) }); } catch { res.status(500).json({ error: 'Error' }); } });

export default router;
