import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdminSuperior, requirePermission } from '../middleware/auth.middleware.js';

const router = express.Router();
const requireFinanzas = requirePermission('finanzas');

const TIPOS_VALIDOS = ['ingreso', 'gasto'];

/**
 * GET /api/finanzas
 * Lista movimientos (opcionalmente filtrados por mes 'YYYY-MM' o tipo).
 */
router.get('/', authenticateToken, requireFinanzas, async (req, res) => {
  try {
    let query = supabase
      .from('finanzas_movimientos')
      .select('*, ventas(nombre)')
      .order('fecha', { ascending: false });

    if (req.query.tipo && TIPOS_VALIDOS.includes(req.query.tipo)) {
      query = query.eq('tipo', req.query.tipo);
    }
    if (req.query.mes) {
      const [y, m] = req.query.mes.split('-');
      if (y && m) {
        const desde = `${y}-${m}-01`;
        const hasta = new Date(Number(y), Number(m), 0).toISOString().slice(0, 10); // último día del mes
        query = query.gte('fecha', desde).lte('fecha', hasta);
      }
    }

    const { data: movimientos, error } = await query;
    if (error) throw error;

    res.json({ movimientos });
  } catch (error) {
    console.error('Error al listar movimientos:', error);
    res.status(500).json({ error: 'Error al listar movimientos' });
  }
});

/**
 * GET /api/finanzas/resumen
 * Caja total (todos los movimientos) + desglose mensual e ingresos/gastos por categoría.
 */
router.get('/resumen', authenticateToken, requireFinanzas, async (req, res) => {
  try {
    const { data: movimientos, error } = await supabase
      .from('finanzas_movimientos')
      .select('*')
      .order('fecha', { ascending: true });

    if (error) throw error;

    const ingresosTotales = movimientos.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + Number(m.monto), 0);
    const gastosTotales   = movimientos.filter(m => m.tipo === 'gasto').reduce((s, m) => s + Number(m.monto), 0);
    const caja = ingresosTotales - gastosTotales;

    const porMes = {};
    movimientos.forEach(m => {
      const mes = m.fecha.slice(0, 7); // YYYY-MM
      if (!porMes[mes]) porMes[mes] = { mes, ingresos: 0, gastos: 0, balance: 0 };
      if (m.tipo === 'ingreso') porMes[mes].ingresos += Number(m.monto);
      else porMes[mes].gastos += Number(m.monto);
      porMes[mes].balance = porMes[mes].ingresos - porMes[mes].gastos;
    });

    const porCategoriaGasto = {};
    movimientos.filter(m => m.tipo === 'gasto').forEach(m => {
      const c = m.categoria || 'otros';
      porCategoriaGasto[c] = (porCategoriaGasto[c] || 0) + Number(m.monto);
    });

    const porCategoriaIngreso = {};
    movimientos.filter(m => m.tipo === 'ingreso').forEach(m => {
      const c = m.categoria || 'otros';
      porCategoriaIngreso[c] = (porCategoriaIngreso[c] || 0) + Number(m.monto);
    });

    res.json({
      ingresosTotales,
      gastosTotales,
      caja,
      porMes: Object.values(porMes).sort((a, b) => b.mes.localeCompare(a.mes)),
      porCategoriaGasto,
      porCategoriaIngreso,
    });
  } catch (error) {
    console.error('Error al calcular resumen financiero:', error);
    res.status(500).json({ error: 'Error al calcular resumen financiero' });
  }
});

/**
 * POST /api/finanzas
 * Crea un movimiento (ingreso o gasto), opcionalmente enlazado a una Venta.
 */
router.post('/', authenticateToken, requireFinanzas, async (req, res) => {
  try {
    const { tipo, categoria, concepto, monto, fecha, metodo_pago, venta_id, beneficiario, notas, proveedor } = req.body;

    if (!TIPOS_VALIDOS.includes(tipo)) return res.status(400).json({ error: 'Tipo inválido (ingreso o gasto)' });
    if (!categoria?.trim()) return res.status(400).json({ error: 'La categoría es requerida' });
    if (!concepto?.trim()) return res.status(400).json({ error: 'El concepto es requerido' });
    if (monto === undefined || isNaN(parseFloat(monto)) || parseFloat(monto) < 0) {
      return res.status(400).json({ error: 'El monto debe ser un número válido' });
    }

    const { data, error } = await supabase
      .from('finanzas_movimientos')
      .insert({
        tipo,
        categoria: categoria.trim(),
        concepto: concepto.trim(),
        monto: parseFloat(monto),
        fecha: fecha || new Date().toISOString().slice(0, 10),
        metodo_pago: metodo_pago?.trim() || null,
        venta_id: venta_id || null,
        beneficiario: beneficiario?.trim() || null,
        notas: notas?.trim() || null,
        proveedor: proveedor?.trim() || null,
        created_by: req.user.id,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ message: 'Movimiento registrado', movimiento: data });
  } catch (error) {
    console.error('Error al crear movimiento:', error);
    res.status(500).json({ error: 'Error al crear movimiento', detalle: error.message });
  }
});

router.put('/:id', authenticateToken, requireFinanzas, async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.id;
    delete updates.created_at;
    delete updates.created_by;

    if (updates.tipo !== undefined && !TIPOS_VALIDOS.includes(updates.tipo)) delete updates.tipo;
    if (updates.monto !== undefined) updates.monto = parseFloat(updates.monto);
    if (updates.categoria !== undefined) updates.categoria = updates.categoria?.trim() || null;
    if (updates.concepto !== undefined) updates.concepto = updates.concepto?.trim() || null;
    if (updates.metodo_pago !== undefined) updates.metodo_pago = updates.metodo_pago?.trim() || null;
    if (updates.notas !== undefined) updates.notas = updates.notas?.trim() || null;
    if (updates.venta_id !== undefined) updates.venta_id = updates.venta_id || null;
    if (updates.beneficiario !== undefined) updates.beneficiario = updates.beneficiario?.trim() || null;
    if (updates.proveedor !== undefined) updates.proveedor = updates.proveedor?.trim() || null;

    const { data, error } = await supabase
      .from('finanzas_movimientos')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ message: 'Movimiento actualizado', movimiento: data });
  } catch (error) {
    console.error('Error al actualizar movimiento:', error);
    res.status(500).json({ error: 'Error al actualizar movimiento', detalle: error.message });
  }
});

router.delete('/:id', authenticateToken, requireAdminSuperior, async (req, res) => {
  try {
    const { error } = await supabase.from('finanzas_movimientos').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Movimiento eliminado' });
  } catch (error) {
    console.error('Error al eliminar movimiento:', error);
    res.status(500).json({ error: 'Error al eliminar movimiento' });
  }
});

export default router;
