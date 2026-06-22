import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.middleware.js';

const router = express.Router();

const ESTADOS_VALIDOS = ['contacto', 'respuesta_chat', 'llamada_descubrimiento', 'diseño', 'venta', 'rechazo', 'enfriado', 'descartado'];

/**
 * GET /api/leads
 * Listar todos los leads con métricas completas
 */
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { data: leads, error } = await supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const total    = leads.length;
    const activos  = leads.filter(l => !['venta','rechazo','descartado'].includes(l.estado)).length;
    const inbound  = leads.filter(l => l.origen === 'inbound').length;
    const outbound = leads.filter(l => l.origen === 'outbound').length;
    const ventas   = leads.filter(l => l.estado === 'venta').length;

    // Conteo por estado
    const porEstado = {};
    ESTADOS_VALIDOS.forEach(e => { porEstado[e] = 0; });
    leads.forEach(l => { if (porEstado[l.estado] !== undefined) porEstado[l.estado]++; });

    // Tasas de conversión entre fases
    const contacto            = leads.filter(l => l.estado !== 'descartado').length;
    const respuesta           = leads.filter(l => ['respuesta_chat','llamada_descubrimiento','diseño','venta','rechazo','enfriado'].includes(l.estado)).length;
    const llamada             = leads.filter(l => ['llamada_descubrimiento','diseño','venta','rechazo'].includes(l.estado)).length;
    const diseño              = leads.filter(l => ['diseño','venta','rechazo'].includes(l.estado)).length;

    const tasaRespuesta       = contacto  > 0 ? Math.round((respuesta / contacto) * 100) : 0;
    const tasaLlamada         = respuesta > 0 ? Math.round((llamada   / respuesta) * 100) : 0;
    const tasaDiseño          = llamada   > 0 ? Math.round((diseño    / llamada)   * 100) : 0;
    const tasaVenta           = diseño    > 0 ? Math.round((ventas    / diseño)    * 100) : 0;
    const tasaCierreGlobal    = total     > 0 ? Math.round((ventas    / total)     * 100) : 0;

    // Por canal
    const porCanal = {};
    leads.forEach(l => {
      const c = l.canal || 'otro';
      if (!porCanal[c]) porCanal[c] = { total: 0, ventas: 0 };
      porCanal[c].total++;
      if (l.estado === 'venta') porCanal[c].ventas++;
    });

    // Pipeline ponderado
    const valorPipeline = leads
      .filter(l => !['rechazo','descartado'].includes(l.estado))
      .reduce((sum, l) => sum + ((l.valor_estimado || 0) * (l.pct_cierre || 0) / 100), 0);

    // Valor total ventas cerradas
    const valorVentas = leads
      .filter(l => l.estado === 'venta')
      .reduce((sum, l) => sum + (l.valor_estimado || 0), 0);

    res.json({
      leads,
      metricas: {
        total, activos, inbound, outbound, ventas,
        valorPipeline, valorVentas,
        tasaRespuesta, tasaLlamada, tasaDiseño, tasaVenta, tasaCierreGlobal,
      },
      porEstado,
      porCanal,
    });

  } catch (error) {
    console.error('Error al listar leads:', error);
    res.status(500).json({ error: 'Error al listar leads' });
  }
});

/**
 * GET /api/leads/:id
 */
router.get('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Lead no encontrado' });
    res.json({ lead: data });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener lead' });
  }
});

/**
 * POST /api/leads
 */
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      nombre, perfil, deporte, liga, instagram, telefono, email,
      origen = 'outbound', canal, estado = 'contacto',
      valor_estimado, pct_cierre = 20, notas,
      fecha_contacto, fecha_respuesta, fecha_llamada, fecha_diseño, fecha_venta
    } = req.body;

    if (!nombre) return res.status(400).json({ error: 'El nombre es requerido' });

    const { data, error } = await supabase
      .from('leads')
      .insert({
        nombre: nombre.trim(), perfil, deporte, liga,
        instagram, telefono, email, origen, canal,
        estado: ESTADOS_VALIDOS.includes(estado) ? estado : 'contacto',
        valor_estimado: valor_estimado ? parseFloat(valor_estimado) : null,
        pct_cierre: pct_cierre ? parseInt(pct_cierre) : 20,
        notas, fecha_contacto, fecha_respuesta, fecha_llamada, fecha_diseño, fecha_venta,
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

/**
 * PUT /api/leads/:id
 */
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.id;
    delete updates.created_at;
    delete updates.created_by;

    if (updates.valor_estimado !== undefined)
      updates.valor_estimado = updates.valor_estimado ? parseFloat(updates.valor_estimado) : null;
    if (updates.pct_cierre !== undefined)
      updates.pct_cierre = parseInt(updates.pct_cierre);
    if (updates.estado && !ESTADOS_VALIDOS.includes(updates.estado))
      delete updates.estado;

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
 * DELETE /api/leads/:id
 */
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
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
