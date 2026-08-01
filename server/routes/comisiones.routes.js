import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';

const router = express.Router();
const requireFinanzas = requirePermission('finanzas');

const TIPOS_PERIODO = ['mes', 'trimestre', 'año'];

function claveDePeriodo(fechaISO, tipo) {
  const [y, m] = fechaISO.slice(0, 7).split('-');
  if (tipo === 'año') return y;
  if (tipo === 'trimestre') return `${y}-Q${Math.ceil(Number(m) / 3)}`;
  return `${y}-${m}`;
}

// Rango de fechas [desde, hasta] que cubre un periodo, para poder filtrar en SQL
function rangoDePeriodo(periodo_tipo, periodo) {
  if (periodo_tipo === 'año') {
    const y = Number(periodo);
    return { desde: `${y}-01-01`, hasta: `${y}-12-31` };
  }
  if (periodo_tipo === 'trimestre') {
    const [y, q] = periodo.split('-Q');
    const mIni = (Number(q) - 1) * 3 + 1;
    const desde = `${y}-${String(mIni).padStart(2, '0')}-01`;
    const hastaDate = new Date(Number(y), mIni + 2, 0);
    return { desde, hasta: hastaDate.toISOString().slice(0, 10) };
  }
  const [y, m] = periodo.split('-');
  const desde = `${y}-${m}-01`;
  const hasta = new Date(Number(y), Number(m), 0).toISOString().slice(0, 10);
  return { desde, hasta };
}

/**
 * Calcula el beneficio del periodo y lo que corresponde a cada miembro,
 * descontando una "reserva" por costes ya estimados de proyectos con
 * ejecución que todavía no han terminado y cuyo gasto real aún no está
 * completamente registrado. Así no se reparte como beneficio dinero que
 * en realidad está reservado para materiales/mano de obra pendientes.
 */
async function calcularComisiones(periodo_tipo, periodo) {
  const { desde, hasta } = rangoDePeriodo(periodo_tipo, periodo);

  const [{ data: equipo, error: errEq }, { data: movimientos, error: errMov }, { data: leadsEjecucion, error: errLeads }] = await Promise.all([
    supabase.from('equipo_comisiones').select('*').eq('activo', true).order('nombre'),
    supabase.from('finanzas_movimientos').select('tipo, monto, categoria, beneficiario, fecha, lead_id').gte('fecha', desde).lte('fecha', hasta),
    supabase.from('leads').select('id, valor_estimado, costes_estimados').eq('estado', 'venta').eq('tipo_proyecto', 'con_ejecucion').not('costes_estimados', 'is', null),
  ]);
  if (errEq) throw errEq;
  if (errMov) throw errMov;
  if (errLeads) throw errLeads;

  const ingresos = movimientos.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + Number(m.monto), 0);
  const gastosOperativos = movimientos.filter(m => m.tipo === 'gasto' && m.categoria !== 'Comisiones').reduce((s, m) => s + Number(m.monto), 0);
  const comisionesYaPagadasTotal = movimientos.filter(m => m.tipo === 'gasto' && m.categoria === 'Comisiones').reduce((s, m) => s + Number(m.monto), 0);
  const beneficioNeto = ingresos - gastosOperativos;

  // Reserva: para cada proyecto con ejecución con coste estimado, cuánto de
  // ese coste estimado todavía no se ha registrado como gasto real (a lo
  // largo de TODA su vida, no solo este periodo) y su fase no está "Entregado".
  let reservaPendiente = 0;
  if (leadsEjecucion.length > 0) {
    const leadIds = leadsEjecucion.map(l => l.id);
    const [{ data: gastosPorLead }, { data: fasesPorLead }] = await Promise.all([
      supabase.from('finanzas_movimientos').select('lead_id, monto').eq('tipo', 'gasto').in('lead_id', leadIds),
      supabase.from('client_projects').select('lead_id, phase').in('lead_id', leadIds),
    ]);
    const gastosAcum = {};
    (gastosPorLead || []).forEach(g => { gastosAcum[g.lead_id] = (gastosAcum[g.lead_id] || 0) + Number(g.monto); });
    const faseDeLead = {};
    (fasesPorLead || []).forEach(p => { faseDeLead[p.lead_id] = p.phase; });

    leadsEjecucion.forEach(l => {
      const fase = faseDeLead[l.id];
      if (fase === 5) return; // entregado: ya no reservamos, el gasto real ya debería estar todo registrado
      const gastado = gastosAcum[l.id] || 0;
      const pendienteDeCoste = Math.max(Number(l.costes_estimados) - gastado, 0);
      reservaPendiente += pendienteDeCoste;
    });
  }

  const beneficioDistribuible = Math.max(beneficioNeto - reservaPendiente, 0);

  const porMiembro = equipo.map(miembro => {
    const comisionCalculada = beneficioDistribuible * (Number(miembro.porcentaje) / 100);
    const yaPagado = movimientos
      .filter(m => m.tipo === 'gasto' && m.categoria === 'Comisiones' && m.beneficiario === miembro.nombre)
      .reduce((s, m) => s + Number(m.monto), 0);
    return {
      nombre: miembro.nombre,
      employeeId: miembro.employee_id || null,
      porcentaje: Number(miembro.porcentaje),
      comisionCalculada,
      yaPagado,
      pendiente: Math.max(comisionCalculada - yaPagado, 0),
    };
  });

  const totalPendiente = porMiembro.reduce((s, m) => s + m.pendiente, 0);

  return {
    periodo_tipo,
    periodo,
    ingresos,
    gastosOperativos,
    beneficioNeto,
    reservaPendiente,
    beneficioDistribuible,
    comisionesYaPagadasTotal,
    cajaAntesDePagarEquipo: beneficioNeto - comisionesYaPagadasTotal,
    cajaDespuesDePagarEquipo: beneficioNeto - comisionesYaPagadasTotal - totalPendiente,
    totalPendiente,
    porMiembro,
  };
}

/**
 * GET /api/comisiones/config
 */
router.get('/config', authenticateToken, requireFinanzas, async (req, res) => {
  try {
    const { data, error } = await supabase.from('equipo_comisiones').select('*, employee:employees(id, name)').order('nombre', { ascending: true });
    if (error) throw error;
    res.json({ equipo: data });
  } catch (error) {
    console.error('Error al listar comisiones:', error);
    res.status(500).json({ error: 'Error al listar comisiones' });
  }
});

/**
 * PUT /api/comisiones/config
 * Upsert de un miembro del equipo (por nombre). Body: { nombre, porcentaje, notas, activo, employee_id }
 */
router.put('/config', authenticateToken, requireFinanzas, async (req, res) => {
  try {
    const { nombre, porcentaje, notas, activo = true, employee_id } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'nombre requerido' });
    if (porcentaje === undefined || isNaN(parseFloat(porcentaje))) return res.status(400).json({ error: 'porcentaje inválido' });

    const { data, error } = await supabase
      .from('equipo_comisiones')
      .upsert({ nombre: nombre.trim(), porcentaje: parseFloat(porcentaje), notas: notas?.trim() || null, activo, employee_id: employee_id || null, updated_at: new Date().toISOString() }, { onConflict: 'nombre' })
      .select()
      .single();
    if (error) throw error;
    res.json({ miembro: data });
  } catch (error) {
    console.error('Error al guardar comisión:', error);
    res.status(500).json({ error: 'Error al guardar comisión', detalle: error.message });
  }
});

router.delete('/config/:id', authenticateToken, requireFinanzas, async (req, res) => {
  try {
    const { error } = await supabase.from('equipo_comisiones').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

/**
 * GET /api/comisiones/calculo?periodo_tipo=mes&periodo=2026-08
 * Vista completa para admin/finanzas: beneficio, reserva pendiente y el
 * desglose de todos los miembros.
 */
router.get('/calculo', authenticateToken, requireFinanzas, async (req, res) => {
  try {
    const periodo_tipo = TIPOS_PERIODO.includes(req.query.periodo_tipo) ? req.query.periodo_tipo : 'mes';
    const periodo = req.query.periodo;
    if (!periodo) return res.status(400).json({ error: 'periodo requerido' });
    res.json(await calcularComisiones(periodo_tipo, periodo));
  } catch (error) {
    console.error('Error al calcular comisiones:', error);
    res.status(500).json({ error: 'Error al calcular comisiones' });
  }
});

/**
 * GET /api/comisiones/mia?periodo_tipo=mes&periodo=2026-08
 * Autoservicio: cualquier persona autenticada (no requiere permiso de
 * finanzas) puede ver SOLO su propia fila, si un admin la enlazó a su
 * cuenta de empleado en la configuración. No expone el resto de la empresa.
 */
router.get('/mia', authenticateToken, async (req, res) => {
  try {
    const periodo_tipo = TIPOS_PERIODO.includes(req.query.periodo_tipo) ? req.query.periodo_tipo : 'mes';
    const periodo = req.query.periodo;
    if (!periodo) return res.status(400).json({ error: 'periodo requerido' });

    const calculo = await calcularComisiones(periodo_tipo, periodo);
    const miFila = calculo.porMiembro.find(m => m.employeeId === req.user.id);

    if (!miFila) {
      return res.json({ encontrado: false, mensaje: 'Todavía no tienes una comisión configurada. Pídele a tu admin que te enlace en Finanzas → Comisiones.' });
    }

    res.json({
      encontrado: true,
      periodo_tipo,
      periodo,
      nombre: miFila.nombre,
      porcentaje: miFila.porcentaje,
      comisionEstimada: miFila.comisionCalculada,
      yaPagado: miFila.yaPagado,
      pendiente: miFila.pendiente,
      nota: calculo.reservaPendiente > 0
        ? 'Esta cifra ya descuenta una reserva por proyectos con ejecución que aún no han terminado (su coste final todavía no se conoce del todo), así que puede subir un poco más adelante.'
        : null,
    });
  } catch (error) {
    console.error('Error al calcular mi comisión:', error);
    res.status(500).json({ error: 'Error al calcular tu comisión' });
  }
});

/**
 * POST /api/comisiones/pagar
 */
router.post('/pagar', authenticateToken, requireFinanzas, async (req, res) => {
  try {
    const { nombre, monto, periodo_label, fecha } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'nombre requerido' });
    if (!monto || isNaN(parseFloat(monto)) || parseFloat(monto) <= 0) return res.status(400).json({ error: 'monto inválido' });

    const { data, error } = await supabase
      .from('finanzas_movimientos')
      .insert({
        tipo: 'gasto',
        categoria: 'Comisiones',
        concepto: `Comisión ${nombre}${periodo_label ? ` — ${periodo_label}` : ''}`,
        monto: parseFloat(monto),
        fecha: fecha || new Date().toISOString().slice(0, 10),
        beneficiario: nombre.trim(),
        created_by: req.user.id,
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ movimiento: data });
  } catch (error) {
    console.error('Error al registrar pago de comisión:', error);
    res.status(500).json({ error: 'Error al registrar pago de comisión', detalle: error.message });
  }
});

/**
 * GET /api/comisiones/historico?nombre=Dani
 */
router.get('/historico', authenticateToken, requireFinanzas, async (req, res) => {
  try {
    let query = supabase.from('finanzas_movimientos').select('monto, fecha, beneficiario, concepto').eq('tipo', 'gasto').eq('categoria', 'Comisiones').not('beneficiario', 'is', null);
    if (req.query.nombre) query = query.eq('beneficiario', req.query.nombre);
    const { data, error } = await query.order('fecha', { ascending: false });
    if (error) throw error;

    const porPersona = {};
    data.forEach(m => {
      if (!porPersona[m.beneficiario]) porPersona[m.beneficiario] = { nombre: m.beneficiario, total: 0, pagos: [] };
      porPersona[m.beneficiario].total += Number(m.monto);
      porPersona[m.beneficiario].pagos.push({ monto: Number(m.monto), fecha: m.fecha, concepto: m.concepto });
    });

    res.json({ historico: Object.values(porPersona).sort((a, b) => b.total - a.total) });
  } catch (error) {
    console.error('Error al obtener histórico de comisiones:', error);
    res.status(500).json({ error: 'Error al obtener histórico de comisiones' });
  }
});

/**
 * GET /api/comisiones/mi-historico
 * Autoservicio del histórico total propio (todo lo que se le ha pagado).
 */
router.get('/mi-historico', authenticateToken, async (req, res) => {
  try {
    const { data: miConfig } = await supabase.from('equipo_comisiones').select('nombre').eq('employee_id', req.user.id).maybeSingle();
    if (!miConfig) return res.json({ encontrado: false, total: 0, pagos: [] });

    const { data, error } = await supabase
      .from('finanzas_movimientos')
      .select('monto, fecha, concepto')
      .eq('tipo', 'gasto').eq('categoria', 'Comisiones').eq('beneficiario', miConfig.nombre)
      .order('fecha', { ascending: false });
    if (error) throw error;

    res.json({ encontrado: true, total: data.reduce((s, m) => s + Number(m.monto), 0), pagos: data });
  } catch (error) {
    console.error('Error al obtener mi histórico:', error);
    res.status(500).json({ error: 'Error al obtener tu histórico' });
  }
});

export default router;
