import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdminSuperior } from '../middleware/auth.middleware.js';

const router = express.Router();
router.use(authenticateToken, requireAdminSuperior);

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('phase_task_templates').select('*')
      .order('phase_number', { ascending: true })
      .order('display_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json({ templates: data });
  } catch (err) { res.status(500).json({ error: 'Error al obtener plantillas' }); }
});

router.post('/', async (req, res) => {
  try {
    const { phase_number, title, description } = req.body;
    if (phase_number === undefined || phase_number === '' || !title?.trim()) {
      return res.status(400).json({ error: 'Fase y título son requeridos' });
    }
    const { data: maxRow } = await supabase.from('phase_task_templates').select('display_order')
      .eq('phase_number', phase_number).order('display_order', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
    const nextOrder = (maxRow?.display_order ?? -1) + 1;
    const { data, error } = await supabase.from('phase_task_templates').insert({
      phase_number: parseInt(phase_number),
      title: title.trim(),
      description: description?.trim() || null,
      display_order: nextOrder,
    }).select('*').single();
    if (error) throw error;
    res.status(201).json({ template: data });
  } catch (err) { res.status(500).json({ error: 'Error al crear plantilla' }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { title, description, phase_number } = req.body;
    const updates = {};
    if (title !== undefined) updates.title = title.trim();
    if (description !== undefined) updates.description = description?.trim() || null;
    if (phase_number !== undefined) updates.phase_number = parseInt(phase_number);
    const { data, error } = await supabase.from('phase_task_templates').update(updates).eq('id', req.params.id).select('*').single();
    if (error) throw error;
    res.json({ template: data });
  } catch (err) { res.status(500).json({ error: 'Error al actualizar plantilla' }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('phase_task_templates').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Plantilla eliminada' });
  } catch (err) { res.status(500).json({ error: 'Error al eliminar plantilla' }); }
});

export default router;
