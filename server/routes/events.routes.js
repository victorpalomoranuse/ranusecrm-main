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
    const { data, error } = await supabase.from('events').insert({ title: title.trim(), description: description?.trim() || null, date, time: time || null, color: color || '#beb0a2' }).select('*').single();
    if (error) throw error;
    res.status(201).json({ event: data });
  } catch (err) { res.status(500).json({ error: 'Error al crear evento' }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('events').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Evento eliminado' });
  } catch (err) { res.status(500).json({ error: 'Error al eliminar evento' }); }
});

export default router;
