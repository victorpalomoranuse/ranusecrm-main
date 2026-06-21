import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.middleware.js';

const router = express.Router();

/**
 * GET /api/leads
 * Listar todos los leads con métricas
 */
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { data: leads, error } = await supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Métricas
    const total         = leads.length;
    const inbound       = leads.filter(l => l.origen === 'inbound').length;
    const outbound      = leads.filter(l => l.origen === 'outbound').length;
    const ganados       = leads.filter(l => l.estado === 'ganado').length;
    const activos       = leads.filter(l => !['ganado', 'perdido', 'descartado'].includes(l.estado)).length;
    const valorPipeline = leads
      .filter(l => !['perdido', 'descartado'].includes(l.estado))
      .reduce((sum, l) => sum + ((l.valor_estimado || 0) * (l.pct_cierre || 0) / 100), 0);

    // Por canal
    const porCanal = {};
    leads.forEach(l => {
      const c = l.canal || 'otro';
      if (!porCanal[c]) porCanal[c] = { total: 0, ganados: 0 };
      porCanal[c].total++;
      if (l.estado === 'ganado') porCanal[c].ganados++;
    });

    res.json({
      leads,
      metricas: { total, inbound, outbound, ganados, activos, valorPipeline },
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
    console.error('Error al obtener lead:', error);
    res.status(500).json({ error: 'Error al obtener lead' });
  }
});

/**
 * POST /api/leads
 * Crear un nuevo lead
 */
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      nombre, perfil, deporte, liga, instagram, telefono, email,
      origen = 'outbound', canal, estado = 'nuevo',
      valor_estimado, pct_cierre = 20, notas,
      fecha_contacto, fecha_seguimiento
    } = req.body;

    if (!nombre) {
      return res.status(400).json({ error: 'El nombre es requerido' });
    }

    const { data, error } = await supabase
      .from('leads')
      .insert({
        nombre: nombre.trim(), perfil, deporte, liga,
        instagram, telefono, email, origen, canal, estado,
        valor_estimado: valor_estimado ? parseFloat(valor_estimado) : null,
        pct_cierre: pct_cierre ? parseInt(pct_cierre) : 20,
        notas, fecha_contacto, fecha_seguimiento,
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
 * Actualizar un lead
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
    const { error } = await supabase
      .from('leads')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ message: 'Lead eliminado exitosamente' });

  } catch (error) {
    console.error('Error al eliminar lead:', error);
    res.status(500).json({ error: 'Error al eliminar lead' });
  }
});

export default router;
