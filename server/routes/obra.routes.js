import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';

const router = express.Router();
const requireFinanzas = requirePermission('finanzas');

// Lectura visible para quien tenga 'ventas' o 'finanzas' (el equipo comercial
// también puede ver los movimientos de ingresos y gastos de la obra); editar
// (previsto, añadir/borrar pagos) sigue siendo solo de finanzas.
const requireVentasOFinanzas = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Autenticación requerida' });
  if (req.user.role === 'admin_superior') return next();
  if (req.user.role === 'trabajador' && (req.user.permissions?.ventas === true || req.user.permissions?.finanzas === true)) {
    return next();
  }
  return res.status(403).json({ error: 'Acceso denegado. No tienes permiso para esta sección.' });
};

// Coste real (lo que le pagas al proveedor) de una partida del presupuesto,
// igual que en budgets.routes.js: en modo PVP+Dto es el pvp con el
// descuento de compra aplicado; en modo Coste+% es el coste directamente.
function lineCost(item) {
  const qty = parseFloat(item.quantity) || 1;
  if ((item.pricing_mode || 'margin') === 'pvp') {
    const pvp = parseFloat(item.pvp_ref) || 0;
    const dto = parseFloat(item.purchase_dto) || 0;
    return pvp * (1 - dto / 100) * qty;
  }
  return (parseFloat(item.unit_cost) || 0) * qty;
}

function effectiveProvider(item) {
  return item.provider?.trim() || item.brand?.trim() || 'Sin proveedor';
}

/**
 * Junta, para una venta con ejecución, lo presupuestado por proveedor
 * (del presupuesto aprobado del proyecto enlazado) con lo realmente
 * pagado por proveedor (movimientos de Finanzas de tipo gasto con esa
 * venta_id, agrupados por su campo "proveedor").
 */
async function relacionDeObra(ventaId) {
  const { data: venta, error: errVenta } = await supabase
    .from('ventas')
    .select('id, nombre, cliente_nombre, tipo_proyecto, valor, client_project_id')
    .eq('id', ventaId)
    .single();
  if (errVenta || !venta) return null;

  const { data: proyecto } = venta.client_project_id
    ? await supabase.from('client_projects').select('id, project_name, phase').eq('id', venta.client_project_id).maybeSingle()
    : { data: null };

  let items = [];
  if (proyecto) {
    const { data: budget } = await supabase
      .from('budgets')
      .select('id, status, items:budget_items(name, provider, brand, quantity, unit_cost, pvp_ref, purchase_dto, pricing_mode)')
      .eq('project_id', proyecto.id)
      .eq('status', 'aprobado')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    items = budget?.items || [];
  }

  const { data: pagos } = await supabase
    .from('finanzas_movimientos')
    .select('id, proveedor, monto, concepto, fecha, categoria')
    .eq('venta_id', ventaId)
    .eq('tipo', 'gasto')
    .order('fecha', { ascending: false });

  const { data: ingresos } = await supabase
    .from('finanzas_movimientos')
    .select('id, monto, concepto, fecha, categoria, metodo_pago')
    .eq('venta_id', ventaId)
    .eq('tipo', 'ingreso')
    .order('fecha', { ascending: false });

  const { data: previsiones } = await supabase
    .from('obra_previsiones')
    .select('proveedor, monto')
    .eq('venta_id', ventaId);
  const previstoPorProveedor = {};
  (previsiones || []).forEach(p => { previstoPorProveedor[p.proveedor] = Number(p.monto); });

  const porProveedor = {};
  items.forEach(item => {
    const prov = effectiveProvider(item);
    if (!porProveedor[prov]) porProveedor[prov] = { proveedor: prov, presupuestado: 0, pagado: 0 };
    porProveedor[prov].presupuestado += lineCost(item);
  });
  (pagos || []).forEach(p => {
    const prov = p.proveedor?.trim() || 'Sin proveedor asignado';
    if (!porProveedor[prov]) porProveedor[prov] = { proveedor: prov, presupuestado: 0, pagado: 0 };
    porProveedor[prov].pagado += Number(p.monto);
  });
  // Un proveedor puede tener previsión propia (renegociada) aunque no
  // tenga líneas en el presupuesto ni pagos todavía.
  Object.keys(previstoPorProveedor).forEach(prov => {
    if (!porProveedor[prov]) porProveedor[prov] = { proveedor: prov, presupuestado: 0, pagado: 0 };
  });

  const proveedores = Object.values(porProveedor)
    .map(p => {
      // Si no se ha renegociado, el previsto por defecto es el presupuestado.
      const previsto = previstoPorProveedor[p.proveedor] != null ? previstoPorProveedor[p.proveedor] : p.presupuestado;
      return { ...p, previsto, previstoEditado: previstoPorProveedor[p.proveedor] != null, diferencia: previsto - p.pagado };
    })
    .sort((a, b) => b.presupuestado - a.presupuestado);

  const presupuestoTotal = proveedores.reduce((s, p) => s + p.presupuestado, 0);
  const previstoTotal = proveedores.reduce((s, p) => s + p.previsto, 0);
  const pagadoTotal = proveedores.reduce((s, p) => s + p.pagado, 0);
  const ingresoTotal = (ingresos || []).reduce((s, i) => s + Number(i.monto), 0);

  return {
    venta: { id: venta.id, nombre: venta.nombre, clienteNombre: venta.cliente_nombre, valor: Number(venta.valor) },
    proyecto: proyecto ? { id: proyecto.id, nombre: proyecto.project_name, fase: proyecto.phase } : null,
    proveedores,
    pagos: pagos || [],
    ingresos: ingresos || [],
    ingresoTotal,
    presupuestoTotal,
    previstoTotal,
    pagadoTotal,
    diferenciaTotal: previstoTotal - pagadoTotal,
  };
}

/**
 * GET /api/obra
 * Lista de obras (ventas con ejecución) con sus totales, para la vista
 * general de "Relación de obra".
 */
router.get('/', authenticateToken, requireVentasOFinanzas, async (req, res) => {
  try {
    const { data: ventas, error } = await supabase
      .from('ventas')
      .select('id, nombre, cliente_nombre, fecha')
      .eq('tipo_proyecto', 'con_ejecucion')
      .order('fecha', { ascending: false });
    if (error) throw error;

    const lista = await Promise.all((ventas || []).map(async v => {
      const rel = await relacionDeObra(v.id);
      if (!rel) return null;
      return {
        ventaId: v.id,
        nombre: v.nombre,
        clienteNombre: v.cliente_nombre,
        fecha: v.fecha,
        proyecto: rel.proyecto,
        presupuestoTotal: rel.presupuestoTotal,
        previstoTotal: rel.previstoTotal,
        pagadoTotal: rel.pagadoTotal,
        diferenciaTotal: rel.diferenciaTotal,
        ingresoTotal: rel.ingresoTotal,
      };
    }));

    res.json({ obras: lista.filter(Boolean) });
  } catch (err) {
    console.error('Error al listar relación de obra:', err);
    res.status(500).json({ error: 'Error al listar relación de obra' });
  }
});

/**
 * GET /api/obra/:ventaId
 * Detalle: presupuestado vs pagado por proveedor, y el listado de pagos.
 */
router.get('/:ventaId', authenticateToken, requireVentasOFinanzas, async (req, res) => {
  try {
    const rel = await relacionDeObra(req.params.ventaId);
    if (!rel) return res.status(404).json({ error: 'Venta no encontrada' });
    res.json(rel);
  } catch (err) {
    console.error('Error al cargar relación de obra:', err);
    res.status(500).json({ error: 'Error al cargar relación de obra' });
  }
});

/**
 * PUT /api/obra/:ventaId/previsto
 * Fija (o borra, si monto es null) la previsión renegociada de un
 * proveedor para esta obra. Body: { proveedor, monto }
 */
router.put('/:ventaId/previsto', authenticateToken, requireFinanzas, async (req, res) => {
  try {
    const { proveedor, monto } = req.body;
    if (!proveedor?.trim()) return res.status(400).json({ error: 'proveedor es requerido' });

    if (monto === null || monto === '') {
      const { error } = await supabase.from('obra_previsiones').delete().eq('venta_id', req.params.ventaId).eq('proveedor', proveedor.trim());
      if (error) throw error;
      return res.json({ ok: true, borrado: true });
    }

    if (isNaN(parseFloat(monto))) return res.status(400).json({ error: 'monto inválido' });

    const { data, error } = await supabase
      .from('obra_previsiones')
      .upsert(
        { venta_id: req.params.ventaId, proveedor: proveedor.trim(), monto: parseFloat(monto), updated_at: new Date().toISOString() },
        { onConflict: 'venta_id,proveedor' }
      )
      .select('*')
      .single();
    if (error) throw error;
    res.json({ prevision: data });
  } catch (err) {
    console.error('Error al guardar previsión:', err);
    res.status(500).json({ error: 'Error al guardar previsión' });
  }
});

export default router;
