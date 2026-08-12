import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission, requireAdminSuperior } from '../middleware/auth.middleware.js';
import { clavesIdentidad } from '../utils/identidad.js';

const router = express.Router();
const requireVentas = requirePermission('ventas');
const requireFinanzas = requirePermission('finanzas');

// Lectura visible para quien tenga 'ventas' o 'finanzas' (el equipo comercial
// ve lo comercial; el detalle de gastos/margen sigue siendo solo finanzas).
const requireVentasOFinanzas = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Autenticación requerida' });
  if (req.user.role === 'admin_superior') return next();
  if (req.user.role === 'trabajador' && ['ventas', 'finanzas', 'leads'].some(k => req.user.permissions?.[k] === true)) {
    return next();
  }
  return res.status(403).json({ error: 'Acceso denegado. No tienes permiso para esta sección.' });
};

const FASE_LABELS = { 1: 'Diagnóstico', 2: 'Diseño', 3: 'Producción', 4: 'Instalación', 5: 'Entregado' };

/**
 * GET /api/ventas
 * Listado de ventas con resumen y agrupación por mes.
 */
router.get('/', authenticateToken, requireVentasOFinanzas, async (req, res) => {
  try {
    let query = supabase.from('ventas').select('*, comercial:employees(name)').order('fecha', { ascending: false });
    if (req.query.lead_id) query = query.eq('lead_id', req.query.lead_id);
    const { data: ventas, error } = await query;
    if (error) throw error;

    const ventaIds = ventas.map(v => v.id);
    const { data: movimientos } = ventaIds.length
      ? await supabase.from('finanzas_movimientos').select('venta_id, tipo, monto').in('venta_id', ventaIds)
      : { data: [] };
    const cobradoPorVenta = {};
    const gastosRealesPorVenta = {};
    (movimientos || []).forEach(m => {
      if (m.tipo === 'ingreso') cobradoPorVenta[m.venta_id] = (cobradoPorVenta[m.venta_id] || 0) + Number(m.monto);
      else gastosRealesPorVenta[m.venta_id] = (gastosRealesPorVenta[m.venta_id] || 0) + Number(m.monto);
    });

    const lista = ventas.map(v => {
      const valor = Number(v.valor || 0);
      const previsionGastos = v.prevision_gastos != null ? Number(v.prevision_gastos) : null;
      const gastosReales = gastosRealesPorVenta[v.id] || 0;
      // El coste que se usa para calcular el beneficio es siempre el mayor
      // entre lo previsto a mano y lo que ya se ha gastado de verdad en
      // Finanzas — así un gasto real ya registrado nunca se ignora, aunque
      // nunca hayas rellenado "costes previstos".
      let costesEfectivos = null;
      if (previsionGastos != null) costesEfectivos = Math.max(previsionGastos, gastosReales);
      else if (gastosReales > 0) costesEfectivos = gastosReales;
      else if (v.tipo_proyecto === 'solo_diseno') costesEfectivos = 0;
      // con_ejecucion sin previsión y sin gasto real todavía: costesEfectivos queda null (desconocido)

      const costesConocidos = costesEfectivos != null;
      const beneficioPrevisto = costesConocidos ? valor - costesEfectivos : 0;
      const presupuesto = Number(v.prevision_ingresos ?? v.valor ?? 0);
      const cobrado = cobradoPorVenta[v.id] || 0;
      // Proporción del cobrado que es beneficio real, según el margen previsto
      // de la venta (ej. si el margen previsto es 12%, de cada pago recibido
      // el 12% se considera ya beneficio; el resto sigue "reservado" para costes).
      const margenPct = valor > 0 && costesConocidos ? beneficioPrevisto / valor : 0;
      const beneficioPagado = cobrado * margenPct;
      return {
        id: v.id,
        nombre: v.nombre,
        clienteNombre: v.cliente_nombre,
        canal: v.canal,
        campaña: v.campaña,
        tipoProyecto: v.tipo_proyecto,
        valor,
        previsionGastos,
        gastosReales,
        costesConocidos,
        beneficioPrevisto,
        cobrado,
        beneficioPagado,
        pendiente: Math.max(presupuesto - cobrado, 0),
        fecha: v.fecha,
        comercial: v.comercial?.name || null,
        leadId: v.lead_id,
      };
    });

    const porMes = {};
    lista.forEach(v => {
      const mes = v.fecha ? v.fecha.slice(0, 7) : 'sin_fecha';
      if (!porMes[mes]) porMes[mes] = { mes, total: 0, totalLimpio: 0, totalEjecucion: 0, totalBeneficioPrevisto: 0, totalCobrado: 0, totalBeneficioPagado: 0, totalPendiente: 0, count: 0, ventas: [] };
      porMes[mes].total += v.valor;
      if (v.tipoProyecto === 'con_ejecucion') porMes[mes].totalEjecucion += v.valor;
      else porMes[mes].totalLimpio += v.valor;
      porMes[mes].totalBeneficioPrevisto += v.beneficioPrevisto;
      porMes[mes].totalCobrado += v.cobrado;
      porMes[mes].totalBeneficioPagado += v.beneficioPagado;
      porMes[mes].totalPendiente += v.pendiente;
      porMes[mes].count += 1;
      porMes[mes].ventas.push(v);
    });

    const valorTotal = lista.reduce((s, v) => s + v.valor, 0);
    const valorLimpio = lista.filter(v => v.tipoProyecto !== 'con_ejecucion').reduce((s, v) => s + v.valor, 0);
    const valorEjecucion = lista.filter(v => v.tipoProyecto === 'con_ejecucion').reduce((s, v) => s + v.valor, 0);
    const valorMedio = lista.length ? valorTotal / lista.length : 0;
    // Beneficio ya cobrado de verdad, sumado sobre todas las ventas (no solo
    // el valor vendido "de papel") — la parte del dinero ya recibido que,
    // según el margen previsto de cada venta, ya cuenta como beneficio real.
    const beneficioPagadoTotal = lista.reduce((s, v) => s + v.beneficioPagado, 0);

    res.json({
      ventas: lista,
      porMes: Object.values(porMes).sort((a, b) => b.mes.localeCompare(a.mes)),
      resumen: { total: lista.length, valorTotal, valorLimpio, valorEjecucion, valorMedio, beneficioPagadoTotal },
    });
  } catch (error) {
    console.error('Error al listar ventas:', error);
    res.status(500).json({ error: 'Error al listar ventas' });
  }
});

/**
 * GET /api/ventas/clientes
 * Agrupa las ventas por cliente (misma persona detectada por instagram/
 * email/teléfono), con el total histórico vendido y cobrado.
 */
router.get('/clientes', authenticateToken, requireVentasOFinanzas, async (req, res) => {
  try {
    const { data: ventas, error: errVentas } = await supabase.from('ventas').select('*');
    if (errVentas) throw errVentas;

    const ventaIds = ventas.map(v => v.id);
    const { data: movimientos, error: errMov } = ventaIds.length
      ? await supabase.from('finanzas_movimientos').select('venta_id, tipo, monto').in('venta_id', ventaIds)
      : { data: [], error: null };
    if (errMov) throw errMov;

    const cobradoPorVenta = {};
    (movimientos || []).forEach(m => {
      if (m.tipo !== 'ingreso') return;
      cobradoPorVenta[m.venta_id] = (cobradoPorVenta[m.venta_id] || 0) + Number(m.monto);
    });

    const grupos = [];
    ventas.forEach(v => {
      const identidad = { instagram: v.cliente_instagram, email: v.cliente_email, telefono: v.cliente_telefono };
      const claves = clavesIdentidad(identidad);
      let grupo = claves.length ? grupos.find(g => claves.some(k => g.claves.has(k))) : null;
      if (!grupo) {
        grupo = { claves: new Set(claves), ventas: [] };
        grupos.push(grupo);
      } else {
        claves.forEach(k => grupo.claves.add(k));
      }
      grupo.ventas.push(v);
    });

    const clientes = grupos.map((g, i) => {
      const ordenadas = g.ventas.sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
      const ultima = ordenadas[ordenadas.length - 1];
      const totalVendido = ordenadas.reduce((s, v) => s + Number(v.valor || 0), 0);
      const totalCobrado = ordenadas.reduce((s, v) => s + (cobradoPorVenta[v.id] || 0), 0);
      return {
        clienteId: `cli-${i}`,
        nombre: ultima.cliente_nombre || ultima.nombre,
        instagram: ultima.cliente_instagram || null,
        email: ultima.cliente_email || null,
        telefono: ultima.cliente_telefono || null,
        numCompras: ordenadas.length,
        totalVendido,
        totalCobrado,
        compras: ordenadas.map(v => ({
          ventaId: v.id, nombre: v.nombre, valor: Number(v.valor || 0), fecha: v.fecha,
          cobrado: cobradoPorVenta[v.id] || 0, tipoProyecto: v.tipo_proyecto, canal: v.canal,
        })),
      };
    });

    clientes.sort((a, b) => b.totalVendido - a.totalVendido);
    res.json({ clientes });
  } catch (error) {
    console.error('Error al agrupar ventas por cliente:', error);
    res.status(500).json({ error: 'Error al agrupar ventas por cliente' });
  }
});

/**
 * POST /api/ventas
 * Crea una venta manualmente — no depende de que exista un lead.
 */
router.post('/', authenticateToken, requireVentas, async (req, res) => {
  try {
    const {
      nombre, cliente_nombre, cliente_instagram, cliente_email, cliente_telefono,
      valor, fecha, canal, campaña, tipo_proyecto = 'solo_diseno',
      prevision_ingresos, prevision_gastos, comercial_id, lead_id, notas,
    } = req.body;

    if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre de la venta es obligatorio' });
    if (valor === undefined || isNaN(parseFloat(valor))) return res.status(400).json({ error: 'El valor de la venta es obligatorio' });

    const { data, error } = await supabase
      .from('ventas')
      .insert({
        nombre: nombre.trim(),
        cliente_nombre: cliente_nombre?.trim() || nombre.trim(),
        cliente_instagram: cliente_instagram?.trim() || null,
        cliente_email: cliente_email?.trim() || null,
        cliente_telefono: cliente_telefono?.trim() || null,
        valor: parseFloat(valor),
        fecha: fecha || new Date().toISOString().slice(0, 10),
        canal: canal || null,
        campaña: campaña?.trim() || null,
        tipo_proyecto: ['solo_diseno', 'con_ejecucion'].includes(tipo_proyecto) ? tipo_proyecto : 'solo_diseno',
        prevision_ingresos: prevision_ingresos ? parseFloat(prevision_ingresos) : null,
        prevision_gastos: prevision_gastos ? parseFloat(prevision_gastos) : null,
        comercial_id: comercial_id || null,
        lead_id: lead_id || null,
        notas: notas?.trim() || null,
        created_by: req.user.id,
      })
      .select('*, comercial:employees(name)')
      .single();
    if (error) throw error;

    res.status(201).json({ venta: data });
  } catch (error) {
    console.error('Error al crear venta:', error);
    res.status(500).json({ error: 'Error al crear la venta', detalle: error.message });
  }
});

/**
 * PUT /api/ventas/:id
 */
router.put('/:id', authenticateToken, requireVentas, async (req, res) => {
  try {
    const campos = ['nombre', 'cliente_nombre', 'cliente_instagram', 'cliente_email', 'cliente_telefono', 'valor', 'fecha', 'canal', 'campaña', 'tipo_proyecto', 'prevision_ingresos', 'prevision_gastos', 'comercial_id', 'notas'];
    const updates = {};
    campos.forEach(c => { if (req.body[c] !== undefined) updates[c] = req.body[c]; });

    if (updates.valor !== undefined) updates.valor = parseFloat(updates.valor) || 0;
    if (updates.prevision_ingresos !== undefined) updates.prevision_ingresos = updates.prevision_ingresos === '' || updates.prevision_ingresos === null ? null : parseFloat(updates.prevision_ingresos);
    if (updates.prevision_gastos !== undefined) updates.prevision_gastos = updates.prevision_gastos === '' || updates.prevision_gastos === null ? null : parseFloat(updates.prevision_gastos);
    if (updates.tipo_proyecto && !['solo_diseno', 'con_ejecucion'].includes(updates.tipo_proyecto)) delete updates.tipo_proyecto;
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase.from('ventas').update(updates).eq('id', req.params.id).select('*, comercial:employees(name)').single();
    if (error) throw error;
    res.json({ venta: data });
  } catch (error) {
    console.error('Error al actualizar venta:', error);
    res.status(500).json({ error: 'Error al actualizar la venta', detalle: error.message });
  }
});

router.delete('/:id', authenticateToken, requireAdminSuperior, async (req, res) => {
  try {
    const { error } = await supabase.from('ventas').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Venta eliminada' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar la venta' });
  }
});

/**
 * GET /api/ventas/:id/ficha
 * Vista team-safe: cobrado/pendiente y fase de ejecución, sin gastos ni margen.
 */
router.get('/:id/ficha', authenticateToken, requireVentasOFinanzas, async (req, res) => {
  try {
    const { data: venta, error: errVenta } = await supabase.from('ventas').select('*').eq('id', req.params.id).single();
    if (errVenta || !venta) return res.status(404).json({ error: 'Venta no encontrada' });

    const [{ data: movimientos, error: errMov }, { data: proyecto, error: errProy }] = await Promise.all([
      supabase.from('finanzas_movimientos').select('monto, tipo').eq('venta_id', req.params.id),
      supabase.from('client_projects').select('id, project_name, phase, urgency, access_code').eq('venta_id', req.params.id).maybeSingle(),
    ]);
    if (errMov) throw errMov;
    if (errProy) throw errProy;

    const cobrado = (movimientos || []).filter(m => m.tipo === 'ingreso').reduce((s, m) => s + Number(m.monto), 0);
    const presupuesto = Number(venta.prevision_ingresos ?? venta.valor ?? 0);

    res.json({
      venta: { id: venta.id, nombre: venta.nombre, fecha: venta.fecha },
      presupuesto,
      cobrado,
      pendiente: Math.max(presupuesto - cobrado, 0),
      proyecto: proyecto || null,
    });
  } catch (error) {
    console.error('Error al obtener ficha de venta:', error);
    res.status(500).json({ error: 'Error al obtener ficha de venta' });
  }
});

/**
 * GET /api/ventas/:id/completo
 * Ficha completa (admin/finanzas): pagos, gastos, margen real y estimado,
 * previsión, proyecto de ejecución enlazado.
 */
router.get('/:id/completo', authenticateToken, requireFinanzas, async (req, res) => {
  try {
    const { data: venta, error: errVenta } = await supabase
      .from('ventas').select('*, comercial:employees(name)').eq('id', req.params.id).single();
    if (errVenta || !venta) return res.status(404).json({ error: 'Venta no encontrada' });

    const [{ data: movimientos, error: errMov }, { data: proyecto, error: errProy }] = await Promise.all([
      supabase.from('finanzas_movimientos').select('*').eq('venta_id', req.params.id).order('fecha', { ascending: true }),
      supabase.from('client_projects').select('id, project_name, phase, urgency, access_code, notes, responsible:employees!responsible_id(name)').eq('venta_id', req.params.id).maybeSingle(),
    ]);
    if (errMov) throw errMov;
    if (errProy) throw errProy;

    const pagos = movimientos.filter(m => m.tipo === 'ingreso');
    const gastos = movimientos.filter(m => m.tipo === 'gasto');
    const cobrado = pagos.reduce((s, m) => s + Number(m.monto), 0);
    const totalGastos = gastos.reduce((s, m) => s + Number(m.monto), 0);
    const presupuesto = Number(venta.prevision_ingresos ?? venta.valor ?? 0);

    res.json({
      venta: {
        id: venta.id, nombre: venta.nombre, clienteNombre: venta.cliente_nombre,
        instagram: venta.cliente_instagram, email: venta.cliente_email, telefono: venta.cliente_telefono,
        canal: venta.canal, campaña: venta.campaña, tipoProyecto: venta.tipo_proyecto,
        fecha: venta.fecha, comercial: venta.comercial?.name || null, notas: venta.notas,
        presupuesto, previsionGastos: venta.prevision_gastos != null ? Number(venta.prevision_gastos) : null,
      },
      ejecucion: proyecto ? {
        nombre: proyecto.project_name, fase: proyecto.phase, urgencia: proyecto.urgency,
        codigoAcceso: proyecto.access_code, responsable: proyecto.responsible?.name || null, notas: proyecto.notes,
      } : null,
      pagos,
      gastos,
      resumen: {
        cobrado,
        pendiente: Math.max(presupuesto - cobrado, 0),
        totalGastos,
        margenReal: cobrado - totalGastos,
        previsionVsReal: presupuesto - cobrado,
        ...(venta.tipo_proyecto === 'con_ejecucion' && venta.prevision_gastos != null ? {
          margenEstimado: presupuesto - Number(venta.prevision_gastos),
        } : {}),
      },
    });
  } catch (error) {
    console.error('Error al obtener ficha completa de venta:', error);
    res.status(500).json({ error: 'Error al obtener ficha completa de venta' });
  }
});

/**
 * GET /api/ventas/resumen-financiero
 * Tabla "lo que gano por venta" para Finanzas: presupuesto, cobrado,
 * pendiente, gastos, margen real de cada venta.
 */
router.get('/resumen/financiero', authenticateToken, requireFinanzas, async (req, res) => {
  try {
    const { data: ventas, error: errVentas } = await supabase.from('ventas').select('*, comercial:employees(name)');
    if (errVentas) throw errVentas;

    const ventaIds = ventas.map(v => v.id);
    const { data: movimientos, error: errMov } = ventaIds.length
      ? await supabase.from('finanzas_movimientos').select('venta_id, tipo, monto').in('venta_id', ventaIds)
      : { data: [], error: null };
    if (errMov) throw errMov;

    const proyectos = ventas.map(v => {
      const movs = (movimientos || []).filter(m => m.venta_id === v.id);
      const cobrado = movs.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + Number(m.monto), 0);
      const gastos = movs.filter(m => m.tipo === 'gasto').reduce((s, m) => s + Number(m.monto), 0);
      const presupuesto = Number(v.prevision_ingresos ?? v.valor ?? 0);
      return {
        ventaId: v.id,
        nombre: v.nombre,
        clienteNombre: v.cliente_nombre,
        tipoProyecto: v.tipo_proyecto,
        comercial: v.comercial?.name || null,
        fecha: v.fecha,
        presupuesto,
        cobrado,
        pendiente: Math.max(presupuesto - cobrado, 0),
        gastos,
        margenReal: cobrado - gastos,
      };
    });

    proyectos.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    res.json({ proyectos });
  } catch (error) {
    console.error('Error al listar resumen financiero de ventas:', error);
    res.status(500).json({ error: 'Error al listar resumen financiero de ventas' });
  }
});

export default router;
