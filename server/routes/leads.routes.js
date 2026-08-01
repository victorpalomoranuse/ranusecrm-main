import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdminSuperior, requirePermission } from '../middleware/auth.middleware.js';

const router = express.Router();
const requireLeads = requirePermission('leads');

const ESTADOS_VALIDOS = ['contacto', 'respuesta_chat', 'llamada_descubrimiento', 'diseño_0', 'diseño_1', 'llamada_venta', 'no_show', 'venta', 'rechazo', 'enfriado', 'descartado'];
const TIPOS_DISEÑO_VALIDOS = ['diseño_gratis', 'diseño_venta'];

// El estado diseño_0/diseño_1 y el campo tipo_diseño deben ir siempre coordinados:
// si el estado dice diseño_1, tipo_diseño tiene que ser 'diseño_venta' (y viceversa).
function resolverTipoDiseño(estadoFinal, tipoDiseñoInput) {
  if (estadoFinal === 'diseño_0') return 'diseño_gratis';
  if (estadoFinal === 'diseño_1') return 'diseño_venta';
  return TIPOS_DISEÑO_VALIDOS.includes(tipoDiseñoInput) ? tipoDiseñoInput : 'diseño_gratis';
}

router.get('/', authenticateToken, requireLeads, async (req, res) => {
  try {
    const { data: leads, error } = await supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const total    = leads.length;
    const activos  = leads.filter(l => !['venta','rechazo','no_show','descartado'].includes(l.estado)).length;
    const inbound  = leads.filter(l => l.origen === 'inbound').length;
    const outbound = leads.filter(l => l.origen === 'outbound').length;
    const ventas   = leads.filter(l => l.estado === 'venta').length;
    const noShow   = leads.filter(l => l.estado === 'no_show').length;

    const porEstado = {};
    ESTADOS_VALIDOS.forEach(e => { porEstado[e] = 0; });
    leads.forEach(l => { if (porEstado[l.estado] !== undefined) porEstado[l.estado]++; });

    const contacto     = leads.filter(l => l.estado !== 'descartado').length;
    const respuesta    = leads.filter(l => ['respuesta_chat','llamada_descubrimiento','diseño','llamada_venta','no_show','venta','rechazo','enfriado'].includes(l.estado)).length;
    const llamada      = leads.filter(l => ['llamada_descubrimiento','diseño','llamada_venta','no_show','venta','rechazo'].includes(l.estado)).length;
    const diseño       = leads.filter(l => ['diseño','llamada_venta','no_show','venta','rechazo'].includes(l.estado)).length;
    const llamadaVenta = leads.filter(l => ['llamada_venta','venta','rechazo'].includes(l.estado)).length;

    const tasaRespuesta    = contacto     > 0 ? Math.round((respuesta    / contacto)               * 100) : 0;
    const tasaLlamada      = respuesta    > 0 ? Math.round((llamada      / respuesta)               * 100) : 0;
    const tasaDiseño       = llamada      > 0 ? Math.round((diseño       / llamada)                 * 100) : 0;
    const tasaLlamadaVenta = diseño       > 0 ? Math.round(((llamadaVenta + noShow) / diseño)       * 100) : 0;
    const tasaNoShow       = (llamadaVenta + noShow) > 0 ? Math.round((noShow / (llamadaVenta + noShow)) * 100) : 0;
    const tasaVenta        = llamadaVenta > 0 ? Math.round((ventas       / llamadaVenta)            * 100) : 0;
    const tasaRechazo      = llamadaVenta > 0 ? Math.round((leads.filter(l => l.estado === 'rechazo').length / llamadaVenta) * 100) : 0;
    const tasaCierreGlobal = total        > 0 ? Math.round((ventas       / total)                   * 100) : 0;

    const porCanal = {};
    leads.forEach(l => {
      const c = l.canal || 'otro';
      if (!porCanal[c]) porCanal[c] = { total: 0, ventas: 0 };
      porCanal[c].total++;
      if (l.estado === 'venta') porCanal[c].ventas++;
    });

    const valorPipeline = leads
      .filter(l => !['rechazo','no_show','descartado'].includes(l.estado))
      .reduce((sum, l) => sum + ((l.valor_estimado || 0) * (l.pct_cierre || 0) / 100), 0);

    const valorVentas = leads
      .filter(l => l.estado === 'venta')
      .reduce((sum, l) => sum + (l.valor_estimado || 0), 0);

    res.json({
      leads,
      metricas: {
        total, activos, inbound, outbound, ventas, noShow,
        valorPipeline, valorVentas,
        tasaRespuesta, tasaLlamada, tasaDiseño, tasaLlamadaVenta,
        tasaNoShow, tasaVenta, tasaRechazo, tasaCierreGlobal,
      },
      porEstado,
      porCanal,
    });

  } catch (error) {
    console.error('Error al listar leads:', error);
    res.status(500).json({ error: 'Error al listar leads' });
  }
});

router.get('/:id', authenticateToken, requireLeads, async (req, res) => {
  try {
    const { data, error } = await supabase.from('leads').select('*').eq('id', req.params.id).single();
    if (error || !data) return res.status(404).json({ error: 'Lead no encontrado' });
    res.json({ lead: data });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener lead' });
  }
});

router.post('/', authenticateToken, requireLeads, async (req, res) => {
  try {
    const {
      nombre, perfil, deporte, liga, instagram, telefono, email,
      origen = 'outbound', canal, estado = 'contacto',
      valor_estimado, pct_cierre = 20, notas,
      fecha_contacto, fecha_respuesta, fecha_llamada, fecha_diseño, fecha_llamada_venta, fecha_venta,
      fecha_venta_diseño_1,
      tipo_diseño = 'diseño_gratis', valor_diseño, link_fathom, assigned_to,
      valor_comisiones, notas_comisiones, tipo_proyecto = 'solo_diseno'
    } = req.body;

    if (!nombre) return res.status(400).json({ error: 'El nombre es requerido' });

    const estadoFinal = ESTADOS_VALIDOS.includes(estado) ? estado : 'contacto';

    const { data, error } = await supabase
      .from('leads')
      .insert({
        nombre: nombre.trim(), perfil: perfil || null, deporte: deporte || null,
        liga: liga || null, instagram: instagram || null, telefono: telefono || null,
        email: email || null, origen, canal: canal || null,
        estado: estadoFinal,
        valor_estimado: valor_estimado ? parseFloat(valor_estimado) : null,
        pct_cierre: pct_cierre ? parseInt(pct_cierre) : 20,
        notas: notas || null,
        fecha_contacto: fecha_contacto || null,
        fecha_respuesta: fecha_respuesta || null,
        fecha_llamada: fecha_llamada || null,
        fecha_diseño: fecha_diseño || null,
        fecha_llamada_venta: fecha_llamada_venta || null,
        fecha_venta_diseño_1: fecha_venta_diseño_1 || null,
        fecha_venta: fecha_venta || null,
        tipo_diseño: resolverTipoDiseño(estadoFinal, tipo_diseño),
        valor_diseño: valor_diseño ? parseFloat(valor_diseño) : null,
        tipo_proyecto: ['solo_diseno', 'con_ejecucion'].includes(tipo_proyecto) ? tipo_proyecto : 'solo_diseno',
        link_fathom: link_fathom?.trim() || null,
        assigned_to: assigned_to || null,
        valor_comisiones: valor_comisiones ? parseFloat(valor_comisiones) : null,
        notas_comisiones: notas_comisiones?.trim() || null,
        created_by: req.user.id
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ message: 'Lead creado exitosamente', lead: data });

  } catch (error) {
    console.error('Error al crear lead:', error);
    res.status(500).json({ error: 'Error al crear lead' });
  }
});

router.put('/:id', authenticateToken, requireLeads, async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.id;
    delete updates.created_at;
    delete updates.created_by;

    if (updates.valor_estimado !== undefined)
      updates.valor_estimado = updates.valor_estimado ? parseFloat(updates.valor_estimado) : null;
    if (updates.valor_diseño !== undefined)
      updates.valor_diseño = updates.valor_diseño ? parseFloat(updates.valor_diseño) : null;
    if (updates.valor_comisiones !== undefined)
      updates.valor_comisiones = updates.valor_comisiones ? parseFloat(updates.valor_comisiones) : null;
    if (updates.notas_comisiones !== undefined)
      updates.notas_comisiones = updates.notas_comisiones?.trim() || null;
    if (updates.pct_cierre !== undefined)
      updates.pct_cierre = parseInt(updates.pct_cierre);
    if (updates.link_fathom !== undefined)
      updates.link_fathom = updates.link_fathom?.trim() || null;
    if (updates.assigned_to !== undefined)
      updates.assigned_to = updates.assigned_to || null;

    ['fecha_contacto','fecha_respuesta','fecha_llamada','fecha_diseño','fecha_llamada_venta','fecha_venta','fecha_venta_diseño_1'].forEach(f => {
      if (updates[f] !== undefined) updates[f] = updates[f] || null;
    });

    if (updates.estado && !ESTADOS_VALIDOS.includes(updates.estado))
      delete updates.estado;

    if (updates.tipo_diseño && !TIPOS_DISEÑO_VALIDOS.includes(updates.tipo_diseño))
      delete updates.tipo_diseño;

    if (updates.tipo_proyecto && !['solo_diseno', 'con_ejecucion'].includes(updates.tipo_proyecto))
      delete updates.tipo_proyecto;

    // Si el estado pasa a diseño_0 o diseño_1, sincroniza tipo_diseño automáticamente
    // (por ejemplo, al cambiar el estado desde el tablero Kanban sin abrir el formulario)
    if (updates.estado === 'diseño_0' || updates.estado === 'diseño_1') {
      updates.tipo_diseño = resolverTipoDiseño(updates.estado);
    }

    const { data, error } = await supabase
      .from('leads')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ message: 'Lead actualizado exitosamente', lead: data });

  } catch (error) {
    console.error('Error al actualizar lead:', error);
    res.status(500).json({ error: 'Error al actualizar lead' });
  }
});

/**
 * PUT /api/leads/:id/asignarme
 * El propio comercial (o admin) se autoasigna un lead.
 */
router.put('/:id/asignarme', authenticateToken, requireLeads, async (req, res) => {
  try {
    const { data: employee, error: empError } = await supabase
      .from('employees')
      .select('id')
      .eq('email', req.user.email)
      .single();

    if (empError || !employee) {
      return res.status(400).json({ error: 'No se encontró tu perfil de empleado para asignarte el lead' });
    }

    const { data, error } = await supabase
      .from('leads')
      .update({ assigned_to: employee.id })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ message: 'Lead asignado', lead: data });
  } catch (error) {
    console.error('Error al autoasignar lead:', error);
    res.status(500).json({ error: 'Error al asignarte el lead' });
  }
});

router.delete('/:id', authenticateToken, requireAdminSuperior, async (req, res) => {
  try {
    const { error } = await supabase.from('leads').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Lead eliminado exitosamente' });
  } catch (error) {
    console.error('Error al eliminar lead:', error);
    res.status(500).json({ error: 'Error al eliminar lead' });
  }
});

export default router;
