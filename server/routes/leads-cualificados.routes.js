import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.middleware.js';

const router = express.Router();

/**
 * GET /api/leads-cualificados
 */
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('leads_cualificados')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ leads: data });

  } catch (error) {
    console.error('Error al listar leads cualificados:', error);
    res.status(500).json({ error: 'Error al listar leads cualificados' });
  }
});

/**
 * GET /api/leads-cualificados/:id
 */
router.get('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('leads_cualificados')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Lead cualificado no encontrado' });
    res.json({ lead: data });

  } catch (error) {
    console.error('Error al obtener lead cualificado:', error);
    res.status(500).json({ error: 'Error al obtener lead cualificado' });
  }
});

/**
 * POST /api/leads-cualificados
 */
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { nombre } = req.body;

    if (!nombre) {
      return res.status(400).json({ error: 'El nombre es requerido' });
    }

    const payload = { ...req.body, created_by: req.user.id };
    if (payload.inversion_min) payload.inversion_min = parseFloat(payload.inversion_min);
    if (payload.inversion_max) payload.inversion_max = parseFloat(payload.inversion_max);
    if (payload.metros_cuadrados) payload.metros_cuadrados = parseFloat(payload.metros_cuadrados);

    const { data, error } = await supabase
      .from('leads_cualificados')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ message: 'Ficha creada exitosamente', lead: data });

  } catch (error) {
    console.error('Error al crear lead cualificado:', error);
    res.status(500).json({ error: 'Error al crear lead cualificado' });
  }
});

/**
 * PUT /api/leads-cualificados/:id
 */
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.id;
    delete updates.created_at;
    delete updates.created_by;

    if (updates.inversion_min !== undefined && updates.inversion_min !== '')
      updates.inversion_min = parseFloat(updates.inversion_min);
    if (updates.inversion_max !== undefined && updates.inversion_max !== '')
      updates.inversion_max = parseFloat(updates.inversion_max);
    if (updates.metros_cuadrados !== undefined && updates.metros_cuadrados !== '')
      updates.metros_cuadrados = parseFloat(updates.metros_cuadrados);

    const { data, error } = await supabase
      .from('leads_cualificados')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;

    res.json({ message: 'Ficha actualizada exitosamente', lead: data });

  } catch (error) {
    console.error('Error al actualizar lead cualificado:', error);
    res.status(500).json({ error: 'Error al actualizar lead cualificado' });
  }
});

/**
 * DELETE /api/leads-cualificados/:id
 */
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase
      .from('leads_cualificados')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ message: 'Ficha eliminada exitosamente' });

  } catch (error) {
    console.error('Error al eliminar lead cualificado:', error);
    res.status(500).json({ error: 'Error al eliminar lead cualificado' });
  }
});

export default router;
