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
    if (req.query.alcance && ['equipo', 'propio'].includes(req.query.alcance)) {
      query = query.eq('alcance', req.query.alcance);
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
 * Upsert de un objetivo (periodo_tipo + periodo + escenario + alcance es
 * único). Body: { periodo_tipo, periodo, escenario, importe, alcance }
 * alcance: 'equipo' (lo que ve el equipo en Ventas) o 'propio' (solo tú, en Finanzas). Por defecto 'equipo'.
 */
router.put('/', authenticateToken, requireFinanzas, async (req, res) => {
  try {
    const { periodo_tipo, periodo, escenario, importe, alcance = 'equipo' } = req.body;

    if (!TIPOS_PERIODO.includes(periodo_tipo)) return res.status(400).json({ error: 'periodo_tipo inválido' });
    if (!periodo?.trim()) return res.status(400).json({ error: 'periodo requerido' });
    if (!ESCENARIOS.includes(escenario)) return res.status(400).json({ error: 'escenario inválido' });
    if (!['equipo', 'propio'].includes(alcance)) return res.status(400).json({ error: 'alcance inválido' });
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
          alcance,
          importe: parseFloat(importe),
          created_by: req.user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'periodo_tipo,periodo,escenario,alcance' }
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
    const alcance = ['equipo', 'propio'].includes(req.query.alcance) ? req.query.alcance : 'equipo';
    if (!periodo) return res.status(400).json({ error: 'periodo requerido (ej. 2026-08, 2026-Q3, 2026)' });

    const [{ data: objetivos, error: errObj }, { data: ventas, error: errVentas }, { data: movimientos, error: errMov }, { data: movVenta, error: errMovVenta }] =
      await Promise.all([
        supabase.from('objetivos_financieros').select('*').eq('periodo_tipo', periodo_tipo).eq('periodo', periodo).eq('alcance', alcance),
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
    // BENEFICIO COBRADO (visible al equipo): de cada venta cerrada en el
    // periodo, la parte de lo YA cobrado (hasta hoy) que corresponde a
    // beneficio, según su margen previsto (venta − costes directos) / venta.
    // Si aún no hay coste previsto, se asume 100% margen (todo lo cobrado es
    // beneficio, como en un proyecto "limpio").
    let beneficioCobradoPeriodo = 0;
    ventas.forEach(v => {
      if (!v.fecha || claveDePeriodo(v.fecha, periodo_tipo) !== periodo) return;
      beneficioLimpioPorProyecto += (cobradoPorVenta[v.id] || 0) - (gastosPorVenta[v.id] || 0);

      const valor = Number(v.valor || 0);
      const costesDirectos = v.prevision_gastos != null ? Number(v.prevision_gastos) : null;
      const margenPct = valor > 0 && costesDirectos != null ? (valor - costesDirectos) / valor : 1;
      beneficioCobradoPeriodo += (cobradoPorVenta[v.id] || 0) * margenPct;
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
        restaBeneficioCobrado: importeObjetivo !== null ? Math.max(importeObjetivo - beneficioCobradoPeriodo, 0) : null,
        cumplidoVendidoPct: importeObjetivo ? Math.round((facturacionVendida / importeObjetivo) * 100) : null,
        cumplidoCobradoPct: importeObjetivo ? Math.round((facturacionCobrada / importeObjetivo) * 100) : null,
        cumplidoBeneficioPrevistoPct: importeObjetivo ? Math.round((beneficioPrevistoPeriodo / importeObjetivo) * 100) : null,
        cumplidoBeneficioCobradoPct: importeObjetivo ? Math.round((beneficioCobradoPeriodo / importeObjetivo) * 100) : null,
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
      alcance,
      beneficioPrevistoPeriodo,
      beneficioCobradoPeriodo,
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

/**
 * GET /api/objetivos/ritmo?año=2026&alcance=equipo
 * Para el objetivo ANUAL: cuánto lleváis generado de media al mes/trimestre
 * hasta ahora, y cuánto hace falta generar de aquí a fin de año para
 * cumplirlo — según lo vendido y según lo cobrado.
 */
router.get('/ritmo', authenticateToken, requireVentasOFinanzas, async (req, res) => {
  try {
    const año = req.query.año || String(new Date().getFullYear());
    const alcance = ['equipo', 'propio'].includes(req.query.alcance) ? req.query.alcance : 'equipo';

    const [{ data: objetivosAño, error: errObj }, { data: ventas, error: errVentas }] = await Promise.all([
      supabase.from('objetivos_financieros').select('*').eq('periodo_tipo', 'año').eq('periodo', año).eq('alcance', alcance),
      supabase.from('ventas').select('id, valor, fecha, prevision_gastos').gte('fecha', `${año}-01-01`).lte('fecha', `${año}-12-31`),
    ]);
    if (errObj) throw errObj;
    if (errVentas) throw errVentas;

    const ventaIds = ventas.map(v => v.id);
    const { data: movVenta } = ventaIds.length
      ? await supabase.from('finanzas_movimientos').select('venta_id, tipo, monto').in('venta_id', ventaIds)
      : { data: [] };
    const cobradoPorVenta = {};
    (movVenta || []).forEach(m => {
      if (m.tipo === 'ingreso') cobradoPorVenta[m.venta_id] = (cobradoPorVenta[m.venta_id] || 0) + Number(m.monto);
    });

    // Meses transcurridos del año: si es el año en curso, hasta el mes actual;
    // si ya pasó, los 12; si es futuro, 0.
    const hoy = new Date();
    const añoActualNum = hoy.getFullYear();
    const mesesTranscurridos = Number(año) < añoActualNum ? 12 : Number(año) > añoActualNum ? 0 : hoy.getMonth() + 1;
    const mesesRestantes = 12 - mesesTranscurridos;
    const trimestreActual = Math.ceil(mesesTranscurridos / 3);
    const trimestresCompletos = mesesTranscurridos % 3 === 0 ? trimestreActual : trimestreActual - 1;
    const trimestresRestantes = 4 - trimestresCompletos;

    let generadoPrevisto = 0;
    let generadoCobrado = 0;
    ventas.forEach(v => {
      const mesVenta = Number(v.fecha.slice(5, 7));
      if (mesVenta > mesesTranscurridos) return; // todavía no ha llegado ese mes
      const valor = Number(v.valor || 0);
      const costes = v.prevision_gastos != null ? Number(v.prevision_gastos) : null;
      const margenPct = valor > 0 && costes != null ? (valor - costes) / valor : 1;
      generadoPrevisto += (valor - (costes || 0));
      generadoCobrado += (cobradoPorVenta[v.id] || 0) * margenPct;
    });

    const porEscenario = {};
    ESCENARIOS.forEach(esc => {
      const obj = objetivosAño.find(o => o.escenario === esc);
      const objetivoAnual = obj ? Number(obj.importe) : null;
      if (objetivoAnual === null) { porEscenario[esc] = null; return; }

      const restaPrevisto = Math.max(objetivoAnual - generadoPrevisto, 0);
      const restaCobrado = Math.max(objetivoAnual - generadoCobrado, 0);

      porEscenario[esc] = {
        objetivoAnual,
        ritmoActualMensualPrevisto: mesesTranscurridos > 0 ? generadoPrevisto / mesesTranscurridos : null,
        ritmoActualMensualCobrado: mesesTranscurridos > 0 ? generadoCobrado / mesesTranscurridos : null,
        ritmoNecesarioMensualPrevisto: mesesRestantes > 0 ? restaPrevisto / mesesRestantes : (restaPrevisto > 0 ? null : 0),
        ritmoNecesarioMensualCobrado: mesesRestantes > 0 ? restaCobrado / mesesRestantes : (restaCobrado > 0 ? null : 0),
        ritmoNecesarioTrimestralPrevisto: trimestresRestantes > 0 ? restaPrevisto / trimestresRestantes : (restaPrevisto > 0 ? null : 0),
        ritmoNecesarioTrimestralCobrado: trimestresRestantes > 0 ? restaCobrado / trimestresRestantes : (restaCobrado > 0 ? null : 0),
      };
    });

    res.json({
      año,
      mesesTranscurridos,
      mesesRestantes,
      trimestresRestantes,
      generadoPrevisto,
      generadoCobrado,
      porEscenario,
    });
  } catch (error) {
    console.error('Error al calcular ritmo de objetivos:', error);
    res.status(500).json({ error: 'Error al calcular ritmo de objetivos' });
  }
});

export default router;
