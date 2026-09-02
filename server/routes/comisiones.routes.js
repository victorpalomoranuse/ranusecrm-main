import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';

const router = express.Router();
const requireFinanzas = requirePermission('finanzas');

const TIPOS_PERIODO = ['mes', 'trimestre', 'año'];

// req.user.id es el id de la tabla "users" (login), no el de "employees"
// (donde vive equipo_comisiones.employee_id) — son tablas distintas con ids
// distintos. El email es el único dato fiable que los conecta.
async function resolveMiConfig(req) {
  const { data: employee } = await supabase.from('employees').select('id').eq('email', req.user.email).maybeSingle();
  if (!employee) return null;
  const { data: miConfig } = await supabase.from('equipo_comisiones').select('nombre').eq('employee_id', employee.id).maybeSingle();
  if (!miConfig) return null;
  return { ...miConfig, employeeId: employee.id };
}

// Si un admin asigna una comisión por proyecto a un empleado que todavía no
// está en Finanzas → Comisiones, le crea automáticamente su fila (con 0%
// de respaldo) para que aparezca en el panel de admin y en su autoservicio.
async function ensureEquipoComisionRow(employeeId, employeeName) {
  const { data: existing } = await supabase.from('equipo_comisiones').select('id').eq('employee_id', employeeId).maybeSingle();
  if (existing) return;
  await supabase.from('equipo_comisiones').insert({ nombre: employeeName, porcentaje: 0, employee_id: employeeId, activo: true });
}

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

  const [{ data: equipo, error: errEq }, { data: movimientos, error: errMov }, { data: ventasEjecucion, error: errVentas }] = await Promise.all([
    supabase.from('equipo_comisiones').select('*').eq('activo', true).order('nombre'),
    supabase.from('finanzas_movimientos').select('tipo, monto, categoria, beneficiario, fecha, venta_id').gte('fecha', desde).lte('fecha', hasta),
    supabase.from('ventas').select('id, valor, prevision_gastos, client_project_id, cerrada').eq('tipo_proyecto', 'con_ejecucion').not('prevision_gastos', 'is', null),
  ]);
  if (errEq) throw errEq;
  if (errMov) throw errMov;
  if (errVentas) throw errVentas;

  const ingresos = movimientos.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + Number(m.monto), 0);
  const gastosOperativos = movimientos.filter(m => m.tipo === 'gasto' && m.categoria !== 'Comisiones').reduce((s, m) => s + Number(m.monto), 0);
  const comisionesYaPagadasTotal = movimientos.filter(m => m.tipo === 'gasto' && m.categoria === 'Comisiones').reduce((s, m) => s + Number(m.monto), 0);
  const beneficioNeto = ingresos - gastosOperativos;

  // Reserva: para cada venta con ejecución con coste estimado, cuánto de ese
  // coste todavía no se ha registrado como gasto real (en toda su vida) y su
  // proyecto de ejecución no está "Entregado".
  let reservaPendiente = 0;
  if (ventasEjecucion.length > 0) {
    const ventaIds = ventasEjecucion.map(v => v.id);
    const projectIds = [...new Set(ventasEjecucion.map(v => v.client_project_id).filter(Boolean))];
    const [{ data: gastosPorVenta }, { data: proyectosLigados }] = await Promise.all([
      supabase.from('finanzas_movimientos').select('venta_id, monto').eq('tipo', 'gasto').in('venta_id', ventaIds),
      projectIds.length ? supabase.from('client_projects').select('id, phase').in('id', projectIds) : Promise.resolve({ data: [] }),
    ]);
    const gastosAcum = {};
    (gastosPorVenta || []).forEach(g => { gastosAcum[g.venta_id] = (gastosAcum[g.venta_id] || 0) + Number(g.monto); });
    const faseDeProyecto = {};
    (proyectosLigados || []).forEach(p => { faseDeProyecto[p.id] = p.phase; });
    const faseDeVenta = {};
    ventasEjecucion.forEach(v => { if (v.client_project_id) faseDeVenta[v.id] = faseDeProyecto[v.client_project_id]; });

    ventasEjecucion.forEach(v => {
      const fase = faseDeVenta[v.id];
      if (fase === 5 || v.cerrada) return; // entregado o cerrada a mano: ya no reservamos
      const gastado = gastosAcum[v.id] || 0;
      const pendienteDeCoste = Math.max(Number(v.prevision_gastos) - gastado, 0);
      reservaPendiente += pendienteDeCoste;
    });
  }

  const beneficioDistribuible = Math.max(beneficioNeto - reservaPendiente, 0);

  // Si un miembro tiene proyectos asignados (venta_comisiones), su cifra ya
  // no sale del % único sobre el beneficio global del periodo, sino de sumar
  // lo devengado en cada uno de sus proyectos según lo que se ha ido
  // cobrando — acumulado desde siempre, no solo de este periodo, porque el
  // pago mensual es simplemente "lo que quede pendiente de cobrar hoy".
  const porMiembro = await Promise.all(equipo.map(async miembro => {
    const porVenta = miembro.employee_id ? await calcularComisionesPorVenta(miembro.employee_id) : [];
    if (porVenta.length > 0) {
      const comisionCalculada = porVenta.reduce((s, v) => s + v.devengada, 0);
      const { data: pagosLifetime } = await supabase
        .from('finanzas_movimientos')
        .select('monto')
        .eq('tipo', 'gasto').eq('categoria', 'Comisiones').eq('beneficiario', miembro.nombre);
      const yaPagado = (pagosLifetime || []).reduce((s, m) => s + Number(m.monto), 0);
      return {
        nombre: miembro.nombre,
        employeeId: miembro.employee_id || null,
        porcentaje: null,
        modelo: 'por_proyecto',
        comisionCalculada,
        yaPagado,
        pendiente: Math.max(comisionCalculada - yaPagado, 0),
      };
    }
    const comisionCalculada = beneficioDistribuible * (Number(miembro.porcentaje) / 100);
    const yaPagado = movimientos
      .filter(m => m.tipo === 'gasto' && m.categoria === 'Comisiones' && m.beneficiario === miembro.nombre)
      .reduce((s, m) => s + Number(m.monto), 0);
    return {
      nombre: miembro.nombre,
      employeeId: miembro.employee_id || null,
      porcentaje: Number(miembro.porcentaje),
      modelo: 'global',
      comisionCalculada,
      yaPagado,
      pendiente: Math.max(comisionCalculada - yaPagado, 0),
    };
  }));

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
 * Calcula, para una lista de asignaciones venta_comisiones (opcionalmente
 * filtradas por nombre), cuánto de esa comisión ya está "devengado" (según
 * lo que el cliente ha pagado de esa venta hasta ahora) y cuánto queda
 * pendiente para cuando pague más.
 */
async function calcularComisionesPorVenta(employeeIdFiltro) {
  let query = supabase.from('venta_comisiones').select('*, venta:ventas(id, nombre, valor, tipo_proyecto, prevision_ingresos, prevision_gastos, cerrada)');
  if (employeeIdFiltro) query = query.eq('employee_id', employeeIdFiltro);
  const { data: asignaciones, error } = await query;
  if (error) throw error;
  if (asignaciones.length === 0) return [];

  const ventaIds = [...new Set(asignaciones.map(a => a.venta_id))];
  const { data: movimientos } = await supabase.from('finanzas_movimientos').select('venta_id, tipo, monto, categoria').in('venta_id', ventaIds);
  const cobradoPorVenta = {};
  const gastosPorVenta = {};
  (movimientos || []).forEach(m => {
    if (m.tipo === 'ingreso') cobradoPorVenta[m.venta_id] = (cobradoPorVenta[m.venta_id] || 0) + Number(m.monto);
    else if (m.categoria === 'Devolución') cobradoPorVenta[m.venta_id] = (cobradoPorVenta[m.venta_id] || 0) - Number(m.monto);
    else gastosPorVenta[m.venta_id] = (gastosPorVenta[m.venta_id] || 0) + Number(m.monto);
  });

  return asignaciones.map(a => {
    const v = a.venta;
    const valor = Number(v?.valor || 0);
    const presupuesto = Number(v?.prevision_ingresos ?? v?.valor ?? 0);
    const previsionGastos = v?.prevision_gastos != null ? Number(v.prevision_gastos) : null;
    const gastosReales = gastosPorVenta[a.venta_id] || 0;
    // Igual que en ventas.routes.js: mientras la venta sigue abierta se usa
    // el mayor entre lo previsto y lo gastado; una vez "cerrada" se usa solo
    // el gasto real definitivo.
    let costes = null;
    if (v?.cerrada) costes = gastosReales;
    else if (previsionGastos != null) costes = Math.max(previsionGastos, gastosReales);
    else if (gastosReales > 0) costes = gastosReales;
    else if (v?.tipo_proyecto === 'solo_diseno') costes = 0;
    const beneficioPrevisto = costes != null ? valor - costes : 0;
    const cobrado = Math.max(cobradoPorVenta[a.venta_id] || 0, 0);
    const proporcionCobrada = presupuesto > 0 ? Math.min(cobrado / presupuesto, 1) : 0;

    const comisionTotal = a.tipo === 'fijo' ? Number(a.valor) : beneficioPrevisto * (Number(a.valor) / 100);
    const devengada = comisionTotal * proporcionCobrada;
    const pendiente = comisionTotal - devengada;

    return {
      id: a.id,
      ventaId: a.venta_id,
      ventaNombre: v?.nombre || '—',
      employeeId: a.employee_id || null,
      nombre: a.nombre,
      tipo: a.tipo,
      valor: Number(a.valor),
      notas: a.notas,
      comisionTotal,
      proporcionCobradaPct: Math.round(proporcionCobrada * 100),
      devengada,
      pendiente,
    };
  });
}

/**
 * Como calcularComisionesPorVenta, pero en vez de devolver un total
 * acumulado por asignación, descompone cada ingreso (y devolución) real de
 * Finanzas en su propio "evento" con fecha — para poder trocear la
 * comisión devengada mes a mes según cuándo entró el dinero, en vez de
 * solo un acumulado desde siempre. Respeta el % (o importe fijo) que se
 * haya introducido a mano en cada asignación.
 */
async function eventosComisionPorVenta(employeeIdFiltro) {
  let query = supabase.from('venta_comisiones').select('*, venta:ventas(id, nombre, valor, tipo_proyecto, prevision_ingresos, prevision_gastos, cerrada)');
  if (employeeIdFiltro) query = query.eq('employee_id', employeeIdFiltro);
  const { data: asignaciones, error } = await query;
  if (error) throw error;
  if (asignaciones.length === 0) return [];

  const ventaIds = [...new Set(asignaciones.map(a => a.venta_id))];
  const { data: movimientos } = await supabase
    .from('finanzas_movimientos')
    .select('venta_id, tipo, monto, categoria, fecha')
    .in('venta_id', ventaIds);

  // Gastos de toda la vida de la venta, para calcular el margen previsto
  // igual que en calcularComisionesPorVenta (no depende del periodo).
  const gastosPorVenta = {};
  (movimientos || []).forEach(m => { if (m.tipo === 'gasto') gastosPorVenta[m.venta_id] = (gastosPorVenta[m.venta_id] || 0) + Number(m.monto); });

  const eventos = [];
  asignaciones.forEach(a => {
    const v = a.venta;
    const valor = Number(v?.valor || 0);
    const presupuesto = Number(v?.prevision_ingresos ?? v?.valor ?? 0);
    const previsionGastos = v?.prevision_gastos != null ? Number(v.prevision_gastos) : null;
    const gastosReales = gastosPorVenta[a.venta_id] || 0;
    let costes = null;
    if (v?.cerrada) costes = gastosReales;
    else if (previsionGastos != null) costes = Math.max(previsionGastos, gastosReales);
    else if (gastosReales > 0) costes = gastosReales;
    else if (v?.tipo_proyecto === 'solo_diseno') costes = 0;
    const beneficioPrevisto = costes != null ? valor - costes : 0;
    const comisionTotal = a.tipo === 'fijo' ? Number(a.valor) : beneficioPrevisto * (Number(a.valor) / 100);
    if (presupuesto <= 0) return;

    // Igual que calcularComisionesPorVenta, la proporción cobrada nunca pasa
    // del 100% del presupuesto (si el cliente paga de más, ese exceso no
    // genera más comisión) ni baja de 0% — pero aquí hace falta repartir ese
    // límite ENTRE los pagos, en el orden en que fueron entrando, para que
    // cada pago se lleve solo la parte de comisión que "quedaba libre" en ese
    // momento. Se procesan en orden cronológico llevando un acumulado.
    let acumuladoAntes = 0;
    (movimientos || [])
      .filter(m => m.venta_id === a.venta_id && (m.tipo === 'ingreso' || m.categoria === 'Devolución'))
      .sort((m1, m2) => (m1.fecha || '').localeCompare(m2.fecha || ''))
      .forEach(m => {
        const signo = m.categoria === 'Devolución' ? -1 : 1;
        const montoCobrado = signo * Number(m.monto);
        const acumuladoDespues = acumuladoAntes + montoCobrado;
        const fraccionAntes = Math.min(Math.max(acumuladoAntes, 0), presupuesto) / presupuesto;
        const fraccionDespues = Math.min(Math.max(acumuladoDespues, 0), presupuesto) / presupuesto;
        const devengado = comisionTotal * (fraccionDespues - fraccionAntes);
        acumuladoAntes = acumuladoDespues;
        if (devengado !== 0) {
          eventos.push({
            employeeId: a.employee_id, nombre: a.nombre, ventaId: a.venta_id, ventaNombre: v?.nombre || '—', fecha: m.fecha, devengado,
            // Datos para explicar el cálculo al usuario: qué % (o fijo) tiene
            // asignado, cuánto cobró el cliente en este pago concreto, y sobre
            // qué beneficio/presupuesto se calculó.
            tipo: a.tipo, valorConfig: Number(a.valor), montoCobrado, presupuesto, beneficioPrevisto,
          });
        }
      });
  });
  return eventos;
}

/**
 * Agrupa, para una persona (por employeeId + su nombre en equipo_comisiones),
 * lo devengado (según eventosComisionPorVenta) por periodo — mes, trimestre
 * o año, según la fecha de cada evento. Lo "pagado" de este desglose NO sale
 * de los movimientos reales de Finanzas (ahí hay pagos antiguos donde el
 * importe mezclaba la comisión con otro concepto, así que no son fiables
 * para esto) — sale de comisiones_pagos_periodo, un registro aparte que tú
 * introduces a mano por persona y periodo. El histórico de "Ya pagado" de
 * Finanzas sigue funcionando igual que siempre, sin tocarlo.
 *
 * Los periodos ya pasados se CONGELAN la primera vez que se consultan (se
 * guardan en comisiones_devengado_congelado) y a partir de ahí ya no
 * cambian, aunque después se cierre esa venta o cambie su coste real. Si el
 * recálculo en vivo dice que el total de un proyecto en un periodo pasado
 * debería ser distinto al que quedó congelado, la diferencia no se aplica
 * a ese mes — se acumula y aparece como una única línea "Ajuste por cambios
 * en ventas de meses anteriores" dentro del periodo ACTUAL (siempre en
 * vivo, nunca congelado), para que el total siga cuadrando sin mover lo que
 * ya se vio o se pagó en meses anteriores.
 */
async function periodosDeComision(employeeId, nombre, tipo) {
  const eventos = employeeId ? await eventosComisionPorVenta(employeeId) : [];

  // Agrupar eventos en vivo por periodo+venta (con el estado ACTUAL de cada
  // venta, ej. si ya está cerrada).
  const gruposPorPeriodoVenta = {};
  eventos.forEach(ev => {
    const periodo = claveDePeriodo(ev.fecha, tipo);
    const clave = `${periodo}|${ev.ventaId}`;
    if (!gruposPorPeriodoVenta[clave]) {
      gruposPorPeriodoVenta[clave] = {
        periodo, ventaId: ev.ventaId, ventaNombre: ev.ventaNombre, devengado: 0, montoCobrado: 0,
        tipo: ev.tipo, valorConfig: ev.valorConfig, presupuesto: ev.presupuesto, beneficioPrevisto: ev.beneficioPrevisto,
      };
    }
    gruposPorPeriodoVenta[clave].devengado += ev.devengado;
    gruposPorPeriodoVenta[clave].montoCobrado += ev.montoCobrado;
  });

  const periodoActual = claveDePeriodo(new Date().toISOString(), tipo);
  const grupos = Object.values(gruposPorPeriodoVenta);
  const pasados = grupos.filter(g => g.periodo < periodoActual);
  const actuales = grupos.filter(g => g.periodo >= periodoActual);

  const porPeriodo = {};
  const ensure = (clave) => { if (!porPeriodo[clave]) porPeriodo[clave] = { periodo: clave, devengado: 0, pagado: 0, porVenta: {} }; return porPeriodo[clave]; };
  const addPorVenta = (p, g, devengado) => {
    if (!p.porVenta[g.ventaId]) {
      p.porVenta[g.ventaId] = {
        ventaId: g.ventaId, ventaNombre: g.ventaNombre, devengado: 0, montoCobrado: g.montoCobrado,
        tipo: g.tipo, valorConfig: g.valorConfig, presupuesto: g.presupuesto, beneficioPrevisto: g.beneficioPrevisto,
      };
    }
    p.porVenta[g.ventaId].devengado += devengado;
  };

  // Ajustes por venta (no un único número agregado) — así se puede explicar
  // exactamente qué venta cambió y por cuánto.
  const ajustesPorVenta = {};
  if (pasados.length > 0) {
    const { data: congelados } = await supabase
      .from('comisiones_devengado_congelado')
      .select('venta_id, periodo, devengado')
      .eq('nombre', nombre).eq('periodo_tipo', tipo);
    const congeladoMap = {};
    (congelados || []).forEach(c => { congeladoMap[`${c.periodo}|${c.venta_id}`] = Number(c.devengado); });

    const porCongelar = [];
    pasados.forEach(g => {
      const clave = `${g.periodo}|${g.ventaId}`;
      const p = ensure(g.periodo);
      if (Object.prototype.hasOwnProperty.call(congeladoMap, clave)) {
        // Ya estaba congelado: se usa ese valor tal cual, y la diferencia con
        // lo que el cálculo en vivo dice ahora se manda al periodo actual,
        // marcada con la venta que la causó.
        const frozenVal = congeladoMap[clave];
        const delta = g.devengado - frozenVal;
        if (Math.abs(delta) > 0.005) {
          if (!ajustesPorVenta[g.ventaId]) ajustesPorVenta[g.ventaId] = { ventaId: g.ventaId, ventaNombre: g.ventaNombre, devengado: 0 };
          ajustesPorVenta[g.ventaId].devengado += delta;
        }
        p.devengado += frozenVal;
        addPorVenta(p, g, frozenVal);
      } else {
        // Primera vez que se ve este periodo+proyecto ya pasado: se congela
        // con el valor de hoy.
        porCongelar.push({ nombre, venta_id: g.ventaId, periodo_tipo: tipo, periodo: g.periodo, devengado: g.devengado });
        p.devengado += g.devengado;
        addPorVenta(p, g, g.devengado);
      }
    });
    if (porCongelar.length > 0) {
      await supabase.from('comisiones_devengado_congelado').upsert(porCongelar, { onConflict: 'nombre,venta_id,periodo_tipo,periodo' });
    }
  }

  actuales.forEach(g => {
    const p = ensure(g.periodo);
    p.devengado += g.devengado;
    addPorVenta(p, g, g.devengado);
  });

  Object.values(ajustesPorVenta).forEach(aj => {
    const p = ensure(periodoActual);
    p.devengado += aj.devengado;
    p.porVenta[`__ajuste_${aj.ventaId}__`] = {
      ventaId: `__ajuste_${aj.ventaId}__`,
      ventaNombre: `Ajuste — ${aj.ventaNombre}`,
      devengado: aj.devengado,
      esAjuste: true,
    };
  });

  const { data: pagos } = await supabase.from('comisiones_pagos_periodo').select('periodo, monto').eq('nombre', nombre).eq('periodo_tipo', tipo);
  (pagos || []).forEach(p => { ensure(p.periodo).pagado += Number(p.monto); });

  // El "pendiente" es un saldo ACUMULADO, no el devengado-pagado de cada mes
  // aislado: si un mes se paga de más, ese sobrante se resta del pendiente
  // del mes siguiente (y si se paga de menos, el déficit se suma), igual
  // que cuadrarías una cuenta corriente.
  let cumDevengado = 0;
  let cumPagado = 0;
  const conPendienteAcumulado = Object.values(porPeriodo)
    .sort((a, b) => a.periodo.localeCompare(b.periodo))
    .map(p => {
      cumDevengado += p.devengado;
      cumPagado += p.pagado;
      return {
        ...p,
        pendiente: cumDevengado - cumPagado,
        porVenta: Object.values(p.porVenta).sort((a, b) => b.devengado - a.devengado),
      };
    });

  return conPendienteAcumulado.sort((a, b) => b.periodo.localeCompare(a.periodo));
}

/**
 * GET /api/comisiones/mia/periodos?tipo=mes
 * Autoservicio: desglose mensual/trimestral/anual de lo devengado, pagado
 * y pendiente, calculado según la fecha real de cada ingreso cobrado en
 * sus proyectos asignados (modelo por_proyecto).
 */
router.get('/mia/periodos', authenticateToken, async (req, res) => {
  try {
    const miConfig = await resolveMiConfig(req);
    if (!miConfig) return res.json({ encontrado: false, periodos: [] });
    const tipo = TIPOS_PERIODO.includes(req.query.tipo) ? req.query.tipo : 'mes';
    const periodos = await periodosDeComision(miConfig.employeeId, miConfig.nombre, tipo);
    res.json({ encontrado: true, nombre: miConfig.nombre, tipo, periodos });
  } catch (error) {
    console.error('Error al calcular tus periodos de comisión:', error);
    res.status(500).json({ error: 'Error al calcular tus periodos de comisión' });
  }
});

/**
 * PUT /api/comisiones/periodo-pago
 * Fija (upsert) cuánto se le ha pagado a una persona en un periodo
 * concreto del desglose mes a mes — independiente de los movimientos
 * reales de Finanzas. Body: { nombre, periodo_tipo, periodo, monto }
 */
router.put('/periodo-pago', authenticateToken, requireFinanzas, async (req, res) => {
  try {
    const { nombre, periodo_tipo, periodo, monto } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'nombre requerido' });
    if (!TIPOS_PERIODO.includes(periodo_tipo)) return res.status(400).json({ error: 'periodo_tipo inválido' });
    if (!periodo?.trim()) return res.status(400).json({ error: 'periodo requerido' });
    if (monto === undefined || isNaN(parseFloat(monto)) || parseFloat(monto) < 0) return res.status(400).json({ error: 'monto inválido' });

    const { data, error } = await supabase
      .from('comisiones_pagos_periodo')
      .upsert(
        { nombre: nombre.trim(), periodo_tipo, periodo: periodo.trim(), monto: parseFloat(monto), updated_at: new Date().toISOString() },
        { onConflict: 'nombre,periodo_tipo,periodo' }
      )
      .select()
      .single();
    if (error) throw error;
    res.json({ pago: data });
  } catch (error) {
    console.error('Error al guardar el pago del periodo:', error);
    res.status(500).json({ error: 'Error al guardar el pago del periodo', detalle: error.message });
  }
});

/**
 * GET /api/comisiones/equipo/periodos?tipo=mes
 * Admin/finanzas: mismo desglose mensual/trimestral/anual, pero de todo el
 * equipo (modelo por_proyecto) — para ver lo que le sale a cada persona.
 */
router.get('/equipo/periodos', authenticateToken, requireFinanzas, async (req, res) => {
  try {
    const tipo = TIPOS_PERIODO.includes(req.query.tipo) ? req.query.tipo : 'mes';
    const { data: equipo, error } = await supabase.from('equipo_comisiones').select('*').eq('activo', true).order('nombre');
    if (error) throw error;

    const { data: asignaciones } = await supabase.from('venta_comisiones').select('employee_id');
    const conProyectos = new Set((asignaciones || []).map(a => a.employee_id));

    const resultado = await Promise.all(equipo.map(async miembro => {
      const tieneProyectos = miembro.employee_id && conProyectos.has(miembro.employee_id);
      const periodos = tieneProyectos ? await periodosDeComision(miembro.employee_id, miembro.nombre, tipo) : [];
      return { nombre: miembro.nombre, employeeId: miembro.employee_id || null, modelo: tieneProyectos ? 'por_proyecto' : 'global', periodos };
    }));

    res.json({ tipo, equipo: resultado });
  } catch (error) {
    console.error('Error al calcular los periodos del equipo:', error);
    res.status(500).json({ error: 'Error al calcular los periodos del equipo' });
  }
});

/**
 * GET /api/comisiones/venta/:ventaId
 * Comisiones asignadas a una venta concreta (admin).
 */
router.get('/venta/:ventaId', authenticateToken, requireFinanzas, async (req, res) => {
  try {
    const { data, error } = await supabase.from('venta_comisiones').select('*').eq('venta_id', req.params.ventaId).order('created_at');
    if (error) throw error;
    const calculadas = await calcularComisionesPorVenta(null);
    const deEstaVenta = calculadas.filter(c => c.ventaId === req.params.ventaId);
    res.json({ comisiones: data.map(d => ({ ...d, calculo: deEstaVenta.find(c => c.id === d.id) || null })) });
  } catch (error) {
    console.error('Error al listar comisiones de la venta:', error);
    res.status(500).json({ error: 'Error al listar comisiones de la venta' });
  }
});

/**
 * GET /api/comisiones/venta/:ventaId/mia
 * Autoservicio: cualquier persona autenticada puede ver SU PROPIA fila de
 * comisión en esta venta (si tiene alguna), en solo lectura — nunca las de
 * sus compañeros. Pensado para cuando alguien sin permiso de Finanzas abre
 * una venta desde Ventas o Proyectos.
 */
router.get('/venta/:ventaId/mia', authenticateToken, async (req, res) => {
  try {
    const miConfig = await resolveMiConfig(req);
    if (!miConfig) return res.json({ comisiones: [] });
    const calculadas = await calcularComisionesPorVenta(miConfig.employeeId);
    res.json({ comisiones: calculadas.filter(c => c.ventaId === req.params.ventaId) });
  } catch (error) {
    console.error('Error al listar mi comisión de la venta:', error);
    res.status(500).json({ error: 'Error al listar tu comisión de esta venta' });
  }
});

/**
 * POST /api/comisiones/venta/:ventaId
 * Añade una asignación de comisión a una venta. Body: { nombre, tipo, valor, notas }
 */
router.post('/venta/:ventaId', authenticateToken, requireFinanzas, async (req, res) => {
  try {
    const { employee_id, tipo = 'porcentaje', valor, notas } = req.body;
    if (!employee_id) return res.status(400).json({ error: 'employee_id requerido' });
    if (!['porcentaje', 'fijo'].includes(tipo)) return res.status(400).json({ error: 'tipo inválido' });
    if (valor === undefined || isNaN(parseFloat(valor))) return res.status(400).json({ error: 'valor inválido' });

    const { data: employee, error: errEmp } = await supabase.from('employees').select('id, name').eq('id', employee_id).single();
    if (errEmp || !employee) return res.status(400).json({ error: 'Empleado no encontrado' });

    const { data, error } = await supabase
      .from('venta_comisiones')
      .insert({ venta_id: req.params.ventaId, employee_id, nombre: employee.name, tipo, valor: parseFloat(valor), notas: notas?.trim() || null })
      .select()
      .single();
    if (error) throw error;

    await ensureEquipoComisionRow(employee.id, employee.name);

    res.status(201).json({ comision: data });
  } catch (error) {
    console.error('Error al asignar comisión:', error);
    res.status(500).json({ error: 'Error al asignar comisión', detalle: error.message });
  }
});

router.put('/venta/:ventaId/:comisionId', authenticateToken, requireFinanzas, async (req, res) => {
  try {
    const { nombre, tipo, valor, notas } = req.body;
    const updates = {};
    if (nombre !== undefined) updates.nombre = nombre.trim();
    if (tipo !== undefined && ['porcentaje', 'fijo'].includes(tipo)) updates.tipo = tipo;
    if (valor !== undefined) updates.valor = parseFloat(valor);
    if (notas !== undefined) updates.notas = notas?.trim() || null;
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase.from('venta_comisiones').update(updates).eq('id', req.params.comisionId).select().single();
    if (error) throw error;
    res.json({ comision: data });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar comisión' });
  }
});

router.delete('/venta/:ventaId/:comisionId', authenticateToken, requireFinanzas, async (req, res) => {
  try {
    const { error } = await supabase.from('venta_comisiones').delete().eq('id', req.params.comisionId);
    if (error) throw error;
    res.json({ message: 'Eliminada' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar' });
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
    const miConfig = await resolveMiConfig(req);
    if (!miConfig) {
      return res.json({ encontrado: false, mensaje: 'Todavía no tienes una comisión configurada. Pídele a tu admin que te enlace en Finanzas → Comisiones.' });
    }

    const porVenta = await calcularComisionesPorVenta(miConfig.employeeId);

    // Modelo por proyecto: si tiene proyectos asignados, el total sale de
    // sumarlos (acumulado desde siempre, según lo que se ha ido cobrando de
    // cada uno), no de un % único sobre el beneficio global del periodo.
    if (porVenta.length > 0) {
      const totalDevengado = porVenta.reduce((s, v) => s + v.devengada, 0);
      const { data: pagosData } = await supabase
        .from('finanzas_movimientos')
        .select('monto')
        .eq('tipo', 'gasto').eq('categoria', 'Comisiones').eq('beneficiario', miConfig.nombre);
      const yaPagado = (pagosData || []).reduce((s, m) => s + Number(m.monto), 0);
      return res.json({
        encontrado: true,
        modelo: 'por_proyecto',
        nombre: miConfig.nombre,
        comisionEstimada: totalDevengado,
        yaPagado,
        pendiente: Math.max(totalDevengado - yaPagado, 0),
        porVenta,
        nota: null,
      });
    }

    // Sin proyectos asignados todavía: modelo antiguo de % único sobre el
    // beneficio de la empresa del periodo, como respaldo.
    const periodo_tipo = TIPOS_PERIODO.includes(req.query.periodo_tipo) ? req.query.periodo_tipo : 'mes';
    const periodo = req.query.periodo;
    if (!periodo) return res.status(400).json({ error: 'periodo requerido' });

    const calculo = await calcularComisiones(periodo_tipo, periodo);
    const miFila = calculo.porMiembro.find(m => m.nombre === miConfig.nombre);
    if (!miFila) {
      return res.json({ encontrado: false, mensaje: 'Todavía no tienes una comisión configurada. Pídele a tu admin que te enlace en Finanzas → Comisiones.' });
    }

    res.json({
      encontrado: true,
      modelo: 'global',
      periodo_tipo,
      periodo,
      nombre: miFila.nombre,
      porcentaje: miFila.porcentaje,
      comisionEstimada: miFila.comisionCalculada,
      yaPagado: miFila.yaPagado,
      pendiente: miFila.pendiente,
      porVenta: [],
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
    const miConfig = await resolveMiConfig(req);
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
