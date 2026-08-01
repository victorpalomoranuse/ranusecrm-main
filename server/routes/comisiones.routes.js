import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';

const router = express.Router();
const requireFinanzas = requirePermission('finanzas');
router.use(authenticateToken, requireFinanzas); // todo lo de comisiones es solo del admin/finanzas

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
 * GET /api/comisiones/config
 * Lista los miembros del equipo con su % de comisión configurado.
 */
router.get('/config', async (req, res) => {
  try {
    const { data, error } = await supabase.from('equipo_comisiones').select('*').order('nombre', { ascending: true });
    if (error) throw error;
    res.json({ equipo: data });
  } catch (error) {
    console.error('Error al listar comisiones:', error);
    res.status(500).json({ error: 'Error al listar comisiones' });
  }
});

/**
 * PUT /api/comisiones/config
 * Upsert de un miembro del equipo (por nombre). Body: { nombre, porcentaje, notas, activo }
 */
router.put('/config', async (req, res) => {
  try {
    const { nombre, porcentaje, notas, activo = true } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'nombre requerido' });
    if (porcentaje === undefined || isNaN(parseFloat(porcentaje))) return res.status(400).json({ error: 'porcentaje inválido' });

    const { data, error } = await supabase
      .from('equipo_comisiones')
      .upsert({ nombre: nombre.trim(), porcentaje: parseFloat(porcentaje), notas: notas?.trim() || null, activo, updated_at: new Date().toISOString() }, { onConflict: 'nombre' })
      .select()
      .single();
    if (error) throw error;
    res.json({ miembro: data });
  } catch (error) {
    console.error('Error al guardar comisión:', error);
    res.status(500).json({ error: 'Error al guardar comisión', detalle: error.message });
  }
});

router.delete('/config/:id', async (req, res) => {
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
 * Beneficio neto del periodo (cobrado - gastos, excluyendo las propias
 * comisiones para no comerse el beneficio antes de repartirlo) y, para cada
 * miembro del equipo, cuánto le corresponde, cuánto ya se le pagó de ese
 * periodo, y cuánto queda pendiente.
 */
router.get('/calculo', async (req, res) => {
  try {
    const periodo_tipo = TIPOS_PERIODO.includes(req.query.periodo_tipo) ? req.query.periodo_tipo : 'mes';
    const periodo = req.query.periodo;
    if (!periodo) return res.status(400).json({ error: 'periodo requerido' });
    const { desde, hasta } = rangoDePeriodo(periodo_tipo, periodo);

    const [{ data: equipo, error: errEq }, { data: movimientos, error: errMov }] = await Promise.all([
      supabase.from('equipo_comisiones').select('*').eq('activo', true).order('nombre'),
      supabase.from('finanzas_movimientos').select('tipo, monto, categoria, beneficiario, fecha').gte('fecha', desde).lte('fecha', hasta),
    ]);
    if (errEq) throw errEq;
    if (errMov) throw errMov;

    const ingresos = movimientos.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + Number(m.monto), 0);
    // Gastos operativos, SIN contar comisiones (para calcular el beneficio sobre el que se reparte)
    const gastosOperativos = movimientos.filter(m => m.tipo === 'gasto' && m.categoria !== 'Comisiones').reduce((s, m) => s + Number(m.monto), 0);
    const comisionesYaPagadasTotal = movimientos.filter(m => m.tipo === 'gasto' && m.categoria === 'Comisiones').reduce((s, m) => s + Number(m.monto), 0);

    const beneficioNeto = ingresos - gastosOperativos;
    const cajaActual = ingresos - gastosOperativos - comisionesYaPagadasTotal; // caja del periodo, tras pagar lo ya pagado

    const porMiembro = equipo.map(miembro => {
      const comisionCalculada = Math.max(beneficioNeto, 0) * (Number(miembro.porcentaje) / 100);
      const yaPagado = movimientos
        .filter(m => m.tipo === 'gasto' && m.categoria === 'Comisiones' && m.beneficiario === miembro.nombre)
        .reduce((s, m) => s + Number(m.monto), 0);
      return {
        nombre: miembro.nombre,
        porcentaje: Number(miembro.porcentaje),
        comisionCalculada,
        yaPagado,
        pendiente: Math.max(comisionCalculada - yaPagado, 0),
      };
    });

    const totalPendiente = porMiembro.reduce((s, m) => s + m.pendiente, 0);

    res.json({
      periodo_tipo,
      periodo,
      ingresos,
      gastosOperativos,
      beneficioNeto,
      comisionesYaPagadasTotal,
      cajaAntesDePagarEquipo: beneficioNeto - comisionesYaPagadasTotal,
      cajaDespuesDePagarEquipo: beneficioNeto - comisionesYaPagadasTotal - totalPendiente,
      totalPendiente,
      porMiembro,
    });
  } catch (error) {
    console.error('Error al calcular comisiones:', error);
    res.status(500).json({ error: 'Error al calcular comisiones' });
  }
});

/**
 * POST /api/comisiones/pagar
 * Registra el pago de una comisión: crea un gasto real en Finanzas
 * (categoría "Comisiones", con beneficiario), para que la caja se actualice
 * y quede un histórico real de qué se pagó a quién y cuándo.
 * Body: { nombre, monto, periodo_label, fecha }
 */
router.post('/pagar', async (req, res) => {
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
 * Todo lo que se le ha pagado a esa persona a lo largo del tiempo (o a
 * todos si no se especifica nombre), agrupado por persona.
 */
router.get('/historico', async (req, res) => {
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

export default router;
