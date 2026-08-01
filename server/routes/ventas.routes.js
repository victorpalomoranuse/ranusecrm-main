import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';
import { clavesIdentidad } from '../utils/identidad.js';

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
      .select('id, nombre, perfil, deporte, canal, origen, estado, tipo_diseño, tipo_proyecto, valor_estimado, valor_diseño, fecha_venta, fecha_venta_diseño_1, assigned_to, employees:assigned_to(name)')
      .or('estado.eq.venta,tipo_diseño.eq.diseño_venta');

    if (error) throw error;

    const ventas = [];
    leads.forEach(l => {
      const comercial = l.employees?.name || null;
      const tipoProyecto = l.tipo_proyecto || 'solo_diseno';
      const base = { leadId: l.id, nombre: l.nombre, perfil: l.perfil, deporte: l.deporte, canal: l.canal, origen: l.origen, comercial, tipoProyecto };

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
      if (!porMes[mes]) porMes[mes] = { mes, total: 0, totalLimpio: 0, totalEjecucion: 0, count: 0, ventas: [] };
      porMes[mes].total += v.valor;
      if (v.tipoProyecto === 'con_ejecucion') porMes[mes].totalEjecucion += v.valor;
      else porMes[mes].totalLimpio += v.valor;
      porMes[mes].count += 1;
      porMes[mes].ventas.push(v);
    });

    const valorTotal = ventas.reduce((s, v) => s + v.valor, 0);
    const valorLimpio = ventas.filter(v => v.tipoProyecto !== 'con_ejecucion').reduce((s, v) => s + v.valor, 0);
    const valorEjecucion = ventas.filter(v => v.tipoProyecto === 'con_ejecucion').reduce((s, v) => s + v.valor, 0);
    const valorMedio = ventas.length ? valorTotal / ventas.length : 0;
    const totalDiseño1 = ventas.filter(v => v.tipo === 'diseño_1').length;
    const totalDiseño2 = ventas.filter(v => v.tipo === 'diseño_2').length;

    res.json({
      ventas,
      porMes: Object.values(porMes).sort((a, b) => b.mes.localeCompare(a.mes)),
      resumen: { total: ventas.length, valorTotal, valorLimpio, valorEjecucion, valorMedio, totalDiseño1, totalDiseño2 },
    });
  } catch (error) {
    console.error('Error al listar ventas:', error);
    res.status(500).json({ error: 'Error al listar ventas' });
  }
});

/**
 * GET /api/ventas/clientes
 * Agrupa todas las ventas por cliente (misma persona detectada por
 * instagram/email/teléfono), con el total histórico vendido y cobrado.
 * No hay tabla de "clientes" — se agrupa en caliente sobre `leads`.
 */
router.get('/clientes', authenticateToken, requireVentas, async (req, res) => {
  try {
    const { data: leads, error: errLeads } = await supabase
      .from('leads')
      .select('id, nombre, instagram, email, telefono, canal, tipo_proyecto, estado, tipo_diseño, valor_estimado, valor_diseño, fecha_venta, fecha_venta_diseño_1, assigned_to, employees:assigned_to(name)')
      .or('estado.eq.venta,tipo_diseño.eq.diseño_venta');
    if (errLeads) throw errLeads;

    const leadIds = leads.map(l => l.id);
    const { data: movimientos, error: errMov } = leadIds.length
      ? await supabase.from('finanzas_movimientos').select('lead_id, tipo, monto').in('lead_id', leadIds)
      : { data: [], error: null };
    if (errMov) throw errMov;

    const cobradoPorLead = {};
    (movimientos || []).forEach(m => {
      if (m.tipo !== 'ingreso') return;
      cobradoPorLead[m.lead_id] = (cobradoPorLead[m.lead_id] || 0) + Number(m.monto);
    });

    // Cada lead puede aportar hasta 2 "compras" (diseño 1 y venta final)
    const compras = [];
    leads.forEach(l => {
      const cobrado = cobradoPorLead[l.id] || 0;
      if (l.tipo_diseño === 'diseño_venta' && l.fecha_venta_diseño_1) {
        compras.push({ leadId: l.id, lead: l, tipo: 'diseño_1', tipoLabel: 'Venta Diseño 1', valor: l.valor_diseño || 0, fecha: l.fecha_venta_diseño_1, cobrado: 0 });
      }
      if (l.estado === 'venta' && l.fecha_venta) {
        compras.push({ leadId: l.id, lead: l, tipo: 'diseño_2', tipoLabel: 'Venta Diseño 2', valor: l.valor_estimado || 0, fecha: l.fecha_venta, cobrado });
      }
    });

    // Agrupar por identidad (instagram/email/teléfono)
    const grupos = []; // [{ claves:Set, compras:[...] }]
    compras.forEach(c => {
      const claves = clavesIdentidad(c.lead);
      let grupo = claves.length ? grupos.find(g => claves.some(k => g.claves.has(k))) : null;
      if (!grupo) {
        grupo = { claves: new Set(claves), compras: [] };
        grupos.push(grupo);
      } else {
        claves.forEach(k => grupo.claves.add(k));
      }
      grupo.compras.push(c);
    });

    const clientes = grupos.map((g, i) => {
      const comprasOrdenadas = g.compras.sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
      const ultima = comprasOrdenadas[comprasOrdenadas.length - 1].lead;
      const totalVendido = comprasOrdenadas.reduce((s, c) => s + c.valor, 0);
      const totalCobrado = comprasOrdenadas.reduce((s, c) => s + c.cobrado, 0);
      return {
        clienteId: `cli-${i}`,
        nombre: ultima.nombre,
        instagram: ultima.instagram || null,
        email: ultima.email || null,
        telefono: ultima.telefono || null,
        numCompras: comprasOrdenadas.length,
        totalVendido,
        totalCobrado,
        compras: comprasOrdenadas.map(c => ({ leadId: c.leadId, tipo: c.tipo, tipoLabel: c.tipoLabel, valor: c.valor, fecha: c.fecha, cobrado: c.cobrado, tipoProyecto: c.lead.tipo_proyecto || 'solo_diseno', canal: c.lead.canal })),
      };
    });

    clientes.sort((a, b) => b.totalVendido - a.totalVendido);
    res.json({ clientes });
  } catch (error) {
    console.error('Error al agrupar ventas por cliente:', error);
    res.status(500).json({ error: 'Error al agrupar ventas por cliente' });
  }
});

export default router;
