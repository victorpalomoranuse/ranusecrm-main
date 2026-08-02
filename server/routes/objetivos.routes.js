import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';

const router = express.Router();
const requireFinanzas = requirePermission('finanzas');

// Lectura del progreso de objetivos: visible para quien tenga 'ventas' o
// 'finanzas' (el equipo comercial ve facturación/objetivo, no gastos ni
// margen — eso sigue exclusivamente bajo 'finanzas').
const requireVentasOFinanzas = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Autenticación requerida' });
  if (req.user.role === 'admin_superior') return next();
  if (req.user.role === 'trabajador' && (req.user.permissions?.ventas === true || req.user.permissions?.finanzas === true)) {
    return next();
  }
  return res.status(403).json({ error: 'Acceso denegado. No tienes permiso para esta sección.' });
};

const TIPOS_PERIODO = ['mes', 'trimestre', 'año'];
const ESCENARIOS = ['pesimista', 'realista', 'optimista'];

/**
 * GET /api/objetivos?periodo_tipo=mes&año=2026
 * Lista objetivos, opcionalmente filtrados por tipo de periodo y/o año.
 */
router.get('/', authenticateToken, requireVentasOFinanzas, async (req, res) => {
  try {
    let query = supabase.from('objetivos_financieros').select('*').order('periodo', { ascending: true });

    if (req.query.periodo_tipo && TIPOS_PERIODO.includes(req.query.periodo_tipo)) {
      query = query.eq('periodo_tipo', req.query.periodo_tipo);
    }
    if (req.query.año) {
      query = query.like('periodo', `${req.query.año}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json({ objetivos: data });
  } catch (error) {
    console.error('Error al listar objetivos:', error);
    res.status(500).json({ error: 'Error al listar objetivos' });
  }
});

/**
 * PUT /api/objetivos
 * Upsert de un objetivo (periodo_tipo + periodo + escenario es única).
 * Body: { periodo_tipo, periodo, escenario, importe }
 */
router.put('/', authenticateToken, requireFinanzas, async (req, res) => {
  try {
    const { periodo_tipo, periodo, escenario, importe } = req.body;

    if (!TIPOS_PERIODO.includes(periodo_tipo)) return res.status(400).json({ error: 'periodo_tipo inválido' });
    if (!periodo?.trim()) return res.status(400).json({ error: 'periodo requerido' });
    if (!ESCENARIOS.includes(escenario)) return res.status(400).json({ error: 'escenario inválido' });
    if (importe === undefined || isNaN(parseFloat(importe)) || parseFloat(importe) < 0) {
      return res.status(400).json({ error: 'importe inválido' });
    }

    const { data, error } = await supabase
      .from('objetivos_financieros')
      .upsert(
        {
          periodo_tipo,
          periodo: periodo.trim(),
          escenario,
          importe: parseFloat(importe),
          created_by: req.user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'periodo_tipo,periodo,escenario' }
      )
      .select()
      .single();

    if (error) throw error;
    res.json({ message: 'Objetivo guardado', objetivo: data });
  } catch (error) {
    console.error('Error al guardar objetivo:', error);
    res.status(500).json({ error: 'Error al guardar objetivo', detalle: error.message || String(error) });
  }
});

router.delete('/:id', authenticateToken, requireFinanzas, async (req, res) => {
  try {
    const { error } = await supabase.from('objetivos_financieros').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Objetivo eliminado' });
  } catch (error) {
    console.error('Error al eliminar objetivo:', error);
    res.status(500).json({ error: 'Error al eliminar objetivo' });
  }
});

// Convierte una fecha 'YYYY-MM-DD' a la clave de periodo correspondiente
function claveDePeriodo(fechaISO, tipo) {
  const [y, m] = fechaISO.slice(0, 7).split('-');
  if (tipo === 'año') return y;
  if (tipo === 'trimestre') return `${y}-Q${Math.ceil(Number(m) / 3)}`;
  return `${y}-${m}`; // mes
}

/**
 * GET /api/objetivos/progreso?periodo_tipo=mes&periodo=2026-08
 * Compara la facturación real (vendida y cobrada) del periodo con los
 * 3 escenarios definidos, y calcula lo que resta para cada uno.
 */
router.get('/progreso', authenticateToken, requireVentasOFinanzas, async (req, res) => {
  try {
    const periodo_tipo = TIPOS_PERIODO.includes(req.query.periodo_tipo) ? req.query.periodo_tipo : 'mes';
    const periodo = req.query.periodo;
    if (!periodo) return res.status(400).json({ error: 'periodo requerido (ej. 2026-08, 2026-Q3, 2026)' });

    const [{ data: objetivos, error: errObj }, { data: ventas, error: errVentas }, { data: movimientos, error: errMov }, { data: movVenta, error: errMovVenta }] =
      await Promise.all([
        supabase.from('objetivos_financieros').select('*').eq('periodo_tipo', periodo_tipo).eq('periodo', periodo),
        supabase.from('ventas').select('id, valor, fecha, tipo_proyecto, prevision_gastos'),
        supabase.from('finanzas_movimientos').select('tipo, monto, fecha'),
        supabase.from('finanzas_movimientos').select('venta_id, tipo, monto').not('venta_id', 'is', null),
      ]);
    if (errObj) throw errObj;
    if (errVentas) throw errVentas;
    if (errMov) throw errMov;
    if (errMovVenta) throw errMovVenta;

    // Facturación VENDIDA: importe de cada venta en la fecha en que se cerró,
    // desglosada entre "limpia" (solo diseño, sin gastos) y "con ejecución"
    let facturacionVendida = 0;
    let facturacionVendidaLimpia = 0;
    let facturacionVendidaEjecucion = 0;
    // BENEFICIO PREVISTO (venta − costes directos previstos del proyecto, SIN
    // contar gastos operativos de empresa). Esta es la métrica del objetivo
    // que ve el equipo en Ventas: se sabe en el momento de la venta, no hace
    // falta esperar a cobrar ni a que termine el proyecto.
    let beneficioPrevistoPeriodo = 0;
    ventas.forEach(v => {
      if (!v.fecha || claveDePeriodo(v.fecha, periodo_tipo) !== periodo) return;
      const importe = Number(v.valor || 0);
      facturacionVendida += importe;
      if (v.tipo_proyecto === 'con_ejecucion') facturacionVendidaEjecucion += importe;
      else facturacionVendidaLimpia += importe;
      const costesDirectos = v.prevision_gastos != null ? Number(v.prevision_gastos) : 0;
      beneficioPrevistoPeriodo += (importe - costesDirectos);
    });

    // Facturación COBRADA: ingresos reales registrados en caja durante el periodo
    let facturacionCobrada = 0;
    let gastosPeriodo = 0;
    movimientos.forEach(m => {
      if (claveDePeriodo(m.fecha, periodo_tipo) !== periodo) return;
      if (m.tipo === 'ingreso') facturacionCobrada += Number(m.monto);
      else gastosPeriodo += Number(m.monto);
    });
    const facturacionNeta = facturacionCobrada - gastosPeriodo;

    // BENEFICIO LIMPIO POR VENTA en caja (cobrado − gastos directos, en toda
    // su vida) — solo referencia tuya en Finanzas, no es lo que ve el equipo.
    const cobradoPorVenta = {};
    const gastosPorVenta = {};
    (movVenta || []).forEach(m => {
      if (m.tipo === 'ingreso') cobradoPorVenta[m.venta_id] = (cobradoPorVenta[m.venta_id] || 0) + Number(m.monto);
      else gastosPorVenta[m.venta_id] = (gastosPorVenta[m.venta_id] || 0) + Number(m.monto);
    });
    let beneficioLimpioPorProyecto = 0;
    ventas.forEach(v => {
      if (!v.fecha || claveDePeriodo(v.fecha, periodo_tipo) !== periodo) return;
      beneficioLimpioPorProyecto += (cobradoPorVenta[v.id] || 0) - (gastosPorVenta[v.id] || 0);
    });

    const puedeVerFinanzas = req.user.role === 'admin_superior' || req.user.permissions?.finanzas === true;

    const porEscenario = {};
    ESCENARIOS.forEach(esc => {
      const obj = objetivos.find(o => o.escenario === esc);
      const importeObjetivo = obj ? Number(obj.importe) : null;
      porEscenario[esc] = {
        objetivo: importeObjetivo,
        restaVendido: importeObjetivo !== null ? Math.max(importeObjetivo - facturacionVendida, 0) : null,
        restaCobrado: importeObjetivo !== null ? Math.max(importeObjetivo - facturacionCobrada, 0) : null,
        restaBeneficioPrevisto: importeObjetivo !== null ? Math.max(importeObjetivo - beneficioPrevistoPeriodo, 0) : null,
        cumplidoVendidoPct: importeObjetivo ? Math.round((facturacionVendida / importeObjetivo) * 100) : null,
        cumplidoCobradoPct: importeObjetivo ? Math.round((facturacionCobrada / importeObjetivo) * 100) : null,
        cumplidoBeneficioPrevistoPct: importeObjetivo ? Math.round((beneficioPrevistoPeriodo / importeObjetivo) * 100) : null,
        ...(puedeVerFinanzas ? {
          restaBeneficioLimpio: importeObjetivo !== null ? Math.max(importeObjetivo - beneficioLimpioPorProyecto, 0) : null,
          cumplidoBeneficioLimpioPct: importeObjetivo ? Math.round((beneficioLimpioPorProyecto / importeObjetivo) * 100) : null,
          restaNeto: importeObjetivo !== null ? Math.max(importeObjetivo - facturacionNeta, 0) : null,
          cumplidoNetoPct: importeObjetivo ? Math.round((facturacionNeta / importeObjetivo) * 100) : null,
        } : {}),
      };
    });

    res.json({
      periodo_tipo,
      periodo,
      beneficioPrevistoPeriodo,
      beneficioLimpioPorProyecto,
      facturacionVendida,
      facturacionVendidaLimpia,
      facturacionVendidaEjecucion,
      facturacionCobrada,
      ...(puedeVerFinanzas ? { gastosPeriodo, balanceCobrado: facturacionNeta, facturacionNeta } : {}),
      porEscenario,
    });
  } catch (error) {
    console.error('Error al calcular progreso de objetivos:', error);
    res.status(500).json({ error: 'Error al calcular progreso de objetivos' });
  }
});

export default router;
