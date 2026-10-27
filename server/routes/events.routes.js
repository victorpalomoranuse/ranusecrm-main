import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdminSuperior } from '../middleware/auth.middleware.js';

const router = express.Router();
router.use(authenticateToken, requireAdminSuperior);

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('events').select('*').order('date', { ascending: true });
    if (error) throw error;
    res.json({ events: data });
  } catch (err) { res.status(500).json({ error: 'Error al obtener eventos' }); }
});

router.post('/', async (req, res) => {
  try {
    const { title, description, date, time, color } = req.body;
    if (!title?.trim() || !date) return res.status(400).json({ error: 'Título y fecha requeridos' });
    const fila = { title: title.trim(), description: description?.trim() || null, date, time: time || null, color: color || '#beb0a2' };
    const dur = Number(req.body.duration_min);
    let { data, error } = await supabase.from('events').insert(dur > 0 ? { ...fila, duration_min: Math.round(dur) } : fila).select('*').single();
    // si aún no existe la columna de duración (SQL v81), se guarda igualmente sin ella
    if (error && dur > 0) ({ data, error } = await supabase.from('events').insert(fila).select('*').single());
    if (error) throw error;
    res.status(201).json({ event: data });
  } catch (err) { res.status(500).json({ error: 'Error al crear evento' }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { title, description, date, time, color, done } = req.body;
    const updates = {};
    if (req.body.duration_min !== undefined) updates.duration_min = Number(req.body.duration_min) > 0 ? Math.round(Number(req.body.duration_min)) : null;
    if (title !== undefined) updates.title = title.trim();
    if (description !== undefined) updates.description = description?.trim() || null;
    if (date !== undefined) updates.date = date;
    if (time !== undefined) updates.time = time || null;
    if (color !== undefined) updates.color = color;
    if (done !== undefined) updates.done = done === true;
    const { data, error } = await supabase.from('events').update(updates).eq('id', req.params.id).select('*').single();
    if (error) throw error;
    res.json({ event: data });
  } catch (err) { res.status(500).json({ error: 'Error al actualizar evento' }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('events').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Evento eliminado' });
  } catch (err) { res.status(500).json({ error: 'Error al eliminar evento' }); }
});

export default router;
