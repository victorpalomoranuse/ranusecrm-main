import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdminSuperior } from '../middleware/auth.middleware.js';

const router = express.Router();
router.use(authenticateToken, requireAdminSuperior);

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('tasks').select('*').order('done', { ascending: true }).order('due_date', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ tasks: data });
  } catch (err) { res.status(500).json({ error: 'Error al obtener tareas' }); }
});

router.post('/', async (req, res) => {
  try {
    const { title, description, priority, due_date } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Título requerido' });
    const { data, error } = await supabase.from('tasks').insert({ title: title.trim(), description: description?.trim() || null, priority: priority || 'normal', due_date: due_date || null }).select('*').single();
    if (error) throw error;
    res.status(201).json({ task: data });
  } catch (err) { res.status(500).json({ error: 'Error al crear tarea' }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { title, description, done, priority, due_date } = req.body;
    const updates = {};
    if (title !== undefined) updates.title = title.trim();
    if (description !== undefined) updates.description = description?.trim() || null;
    if (done !== undefined) updates.done = done;
    if (priority !== undefined) updates.priority = priority;
    if (due_date !== undefined) updates.due_date = due_date || null;
    const { data, error } = await supabase.from('tasks').update(updates).eq('id', req.params.id).select('*').single();
    if (error) throw error;
    res.json({ task: data });
  } catch (err) { res.status(500).json({ error: 'Error al actualizar tarea' }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('tasks').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Tarea eliminada' });
  } catch (err) { res.status(500).json({ error: 'Error al eliminar tarea' }); }
});

export default router;
