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
/**
 * GET /api/ventas
 * Todos los eventos de venta, agrupados por mes. Un lead puede generar hasta
 * dos eventos independientes:
 *  - "diseño_1": se vendió el diseño (tipo_diseño = 'diseño_venta'), fecha_venta_diseño_1 / valor_diseño
 *  - "diseño_2": venta final del proyecto (estado = 'venta'), fecha_venta / valor_estimado
 */
router.get('/', authenticateToken, requireVentas, async (req, res) => {
  try {
    const { data: leads, error } = await supabase
      .from('leads')
      .select('id, nombre, perfil, deporte, canal, origen, estado, tipo_diseño, valor_estimado, valor_diseño, fecha_venta, fecha_venta_diseño_1, assigned_to, employees:assigned_to(name)')
      .or('estado.eq.venta,tipo_diseño.eq.diseño_venta');

    if (error) throw error;

    const ventas = [];
    leads.forEach(l => {
      const comercial = l.employees?.name || null;
      const base = { leadId: l.id, nombre: l.nombre, perfil: l.perfil, deporte: l.deporte, canal: l.canal, origen: l.origen, comercial };

      if (l.tipo_diseño === 'diseño_venta' && l.fecha_venta_diseño_1) {
        ventas.push({ ...base, id: `${l.id}-d1`, tipo: 'diseño_1', tipoLabel: 'Venta Diseño 1', valor: l.valor_diseño || 0, fecha: l.fecha_venta_diseño_1 });
      }
      if (l.estado === 'venta' && l.fecha_venta) {
        ventas.push({ ...base, id: `${l.id}-d2`, tipo: 'diseño_2', tipoLabel: 'Venta Diseño 2', valor: l.valor_estimado || 0, fecha: l.fecha_venta });
      }
    });

    ventas.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

    const porMes = {};
    ventas.forEach(v => {
      const mes = v.fecha ? v.fecha.slice(0, 7) : 'sin_fecha';
      if (!porMes[mes]) porMes[mes] = { mes, total: 0, count: 0, ventas: [] };
      porMes[mes].total += v.valor;
      porMes[mes].count += 1;
      porMes[mes].ventas.push(v);
    });

    const valorTotal = ventas.reduce((s, v) => s + v.valor, 0);
    const valorMedio = ventas.length ? valorTotal / ventas.length : 0;
    const totalDiseño1 = ventas.filter(v => v.tipo === 'diseño_1').length;
    const totalDiseño2 = ventas.filter(v => v.tipo === 'diseño_2').length;

    res.json({
      ventas,
      porMes: Object.values(porMes).sort((a, b) => b.mes.localeCompare(a.mes)),
      resumen: { total: ventas.length, valorTotal, valorMedio, totalDiseño1, totalDiseño2 },
    });
  } catch (error) {
    console.error('Error al listar ventas:', error);
    res.status(500).json({ error: 'Error al listar ventas' });
  }
});

export default router;
