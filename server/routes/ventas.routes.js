import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';

const router = express.Router();
const requireVentas = requirePermission('ventas');

/**
 * GET /api/ventas
 * Todos los leads con estado = 'venta', agrupados por mes (según fecha_venta),
 * con el valor de cada uno. Es una vista de solo lectura sobre `leads`.
 */
router.get('/', authenticateToken, requireVentas, async (req, res) => {
  try {
    const { data: leads, error } = await supabase
      .from('leads')
      .select('id, nombre, perfil, deporte, canal, origen, valor_estimado, fecha_venta, assigned_to, employees:assigned_to(name)')
      .eq('estado', 'venta')
      .order('fecha_venta', { ascending: false });

    if (error) throw error;

    const ventas = leads.map(l => ({
      id: l.id,
      nombre: l.nombre,
      perfil: l.perfil,
      deporte: l.deporte,
      canal: l.canal,
      origen: l.origen,
      valor: l.valor_estimado || 0,
      fecha_venta: l.fecha_venta,
      comercial: l.employees?.name || null,
    }));

    const porMes = {};
    ventas.forEach(v => {
      const mes = v.fecha_venta ? v.fecha_venta.slice(0, 7) : 'sin_fecha';
      if (!porMes[mes]) porMes[mes] = { mes, total: 0, count: 0, ventas: [] };
      porMes[mes].total += v.valor;
      porMes[mes].count += 1;
      porMes[mes].ventas.push(v);
    });

    const valorTotal = ventas.reduce((s, v) => s + v.valor, 0);
    const valorMedio = ventas.length ? valorTotal / ventas.length : 0;

    res.json({
      ventas,
      porMes: Object.values(porMes).sort((a, b) => b.mes.localeCompare(a.mes)),
      resumen: { total: ventas.length, valorTotal, valorMedio },
    });
  } catch (error) {
    console.error('Error al listar ventas:', error);
    res.status(500).json({ error: 'Error al listar ventas' });
  }
});

export default router;
