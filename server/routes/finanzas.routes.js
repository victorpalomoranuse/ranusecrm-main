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
      .select('*, leads(nombre)')
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
 * GET /api/finanzas/proyectos
 * Un proyecto (lead vendido) por fila, con: presupuesto aceptado, cobrado,
 * pendiente de cobro, gastos asociados y margen real. Sirve para la tabla
 * "lo que gano realmente en cada proyecto".
 */
router.get('/proyectos', authenticateToken, requireFinanzas, async (req, res) => {
  try {
    const { data: leads, error: errLeads } = await supabase
      .from('leads')
      .select('id, nombre, tipo_proyecto, valor_estimado, fecha_venta, employees:assigned_to(name)')
      .eq('estado', 'venta');
    if (errLeads) throw errLeads;

    const { data: movimientos, error: errMov } = await supabase
      .from('finanzas_movimientos')
      .select('lead_id, tipo, monto')
      .not('lead_id', 'is', null);
    if (errMov) throw errMov;

    const proyectos = leads.map(l => {
      const movs = movimientos.filter(m => m.lead_id === l.id);
      const cobrado = movs.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + Number(m.monto), 0);
      const gastos = movs.filter(m => m.tipo === 'gasto').reduce((s, m) => s + Number(m.monto), 0);
      const presupuesto = Number(l.valor_estimado || 0);
      return {
        leadId: l.id,
        nombre: l.nombre,
        tipoProyecto: l.tipo_proyecto || 'solo_diseno',
        comercial: l.employees?.name || null,
        fechaVenta: l.fecha_venta,
        presupuesto,
        cobrado,
        pendiente: Math.max(presupuesto - cobrado, 0),
        gastos,
        margenReal: cobrado - gastos,
      };
    });

    proyectos.sort((a, b) => (b.fechaVenta || '').localeCompare(a.fechaVenta || ''));
    res.json({ proyectos });
  } catch (error) {
    console.error('Error al listar proyectos financieros:', error);
    res.status(500).json({ error: 'Error al listar proyectos financieros' });
  }
});

/**
 * GET /api/finanzas/proyecto/:leadId
 * Ficha financiera de un proyecto concreto: presupuesto vs cobrado (previsión
 * vs real), pagos individuales del cliente, gastos y margen real.
 */
router.get('/proyecto/:leadId', authenticateToken, requireFinanzas, async (req, res) => {
  try {
    const { data: lead, error: errLead } = await supabase
      .from('leads')
      .select('id, nombre, instagram, email, telefono, canal, campaña, tipo_proyecto, valor_estimado, costes_estimados, fecha_venta, fecha_contacto, notas, assigned_to, employees:assigned_to(name)')
      .eq('id', req.params.leadId)
      .single();
    if (errLead) throw errLead;

    const [{ data: movimientos, error: errMov }, { data: clientProject, error: errCP }] = await Promise.all([
      supabase.from('finanzas_movimientos').select('*').eq('lead_id', req.params.leadId).order('fecha', { ascending: true }),
      supabase.from('client_projects').select('id, project_name, phase, urgency, access_code, notes, responsible:employees!responsible_id(name)').eq('lead_id', req.params.leadId).maybeSingle(),
    ]);
    if (errMov) throw errMov;
    if (errCP) throw errCP;

    const pagos = movimientos.filter(m => m.tipo === 'ingreso');
    const gastos = movimientos.filter(m => m.tipo === 'gasto');
    const cobrado = pagos.reduce((s, m) => s + Number(m.monto), 0);
    const totalGastos = gastos.reduce((s, m) => s + Number(m.monto), 0);
    const presupuesto = Number(lead.valor_estimado || 0);

    res.json({
      proyecto: {
        leadId: lead.id,
        nombre: lead.nombre,
        instagram: lead.instagram,
        email: lead.email,
        telefono: lead.telefono,
        canal: lead.canal,
        campaña: lead.campaña,
        tipoProyecto: lead.tipo_proyecto || 'solo_diseno',
        fechaVenta: lead.fecha_venta,
        fechaContacto: lead.fecha_contacto,
        comercial: lead.employees?.name || null,
        notas: lead.notas,
        presupuesto,
        costesEstimados: lead.costes_estimados !== null && lead.costes_estimados !== undefined ? Number(lead.costes_estimados) : null,
      },
      ejecucion: clientProject ? {
        nombre: clientProject.project_name,
        fase: clientProject.phase,
        urgencia: clientProject.urgency,
        codigoAcceso: clientProject.access_code,
        responsable: clientProject.responsible?.name || null,
        notas: clientProject.notes,
      } : null,
      pagos,
      gastos,
      resumen: {
        cobrado,
        pendiente: Math.max(presupuesto - cobrado, 0),
        totalGastos,
        margenReal: cobrado - totalGastos,
        previsionVsReal: presupuesto - cobrado,
        ...(lead.tipo_proyecto === 'con_ejecucion' && lead.costes_estimados != null ? {
          margenEstimado: presupuesto - Number(lead.costes_estimados),
        } : {}),
      },
    });
  } catch (error) {
    console.error('Error al obtener ficha financiera del proyecto:', error);
    res.status(500).json({ error: 'Error al obtener ficha financiera del proyecto' });
  }
});

router.post('/', authenticateToken, requireFinanzas, async (req, res) => {
  try {
    const { tipo, categoria, concepto, monto, fecha, metodo_pago, lead_id, notas } = req.body;

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
        lead_id: lead_id || null,
        notas: notas?.trim() || null,
        created_by: req.user.id,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ message: 'Movimiento registrado', movimiento: data });
  } catch (error) {
    console.error('Error al crear movimiento:', error);
    res.status(500).json({ error: 'Error al crear movimiento' });
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
    if (updates.lead_id !== undefined) updates.lead_id = updates.lead_id || null;

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
    res.status(500).json({ error: 'Error al actualizar movimiento' });
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
