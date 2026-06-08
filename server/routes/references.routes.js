import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.middleware.js';

const router = express.Router();
router.use(authenticateToken, requireAdmin);

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('inspiration_references')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ references: data });
  } catch {
    res.status(500).json({ error: 'Error al listar referencias' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { title, url, description, category, image_url } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Título requerido' });
    const { data, error } = await supabase
      .from('inspiration_references')
      .insert({
        title: title.trim(),
        url: url?.trim() || null,
        description: description?.trim() || null,
        category: category?.trim() || null,
        image_url: image_url?.trim() || null,
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ reference: data });
  } catch {
    res.status(500).json({ error: 'Error al crear referencia' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { title, url, description, category, image_url } = req.body;
    const updates = {};
    if (title !== undefined) updates.title = title.trim();
    if (url !== undefined) updates.url = url?.trim() || null;
    if (description !== undefined) updates.description = description?.trim() || null;
    if (category !== undefined) updates.category = category?.trim() || null;
    if (image_url !== undefined) updates.image_url = image_url?.trim() || null;
    const { data, error } = await supabase
      .from('inspiration_references')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ reference: data });
  } catch {
    res.status(500).json({ error: 'Error al actualizar referencia' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('inspiration_references')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Referencia eliminada' });
  } catch {
    res.status(500).json({ error: 'Error al eliminar referencia' });
  }
});

export default router;
