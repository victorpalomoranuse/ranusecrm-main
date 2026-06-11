import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdminSuperior } from '../middleware/auth.middleware.js';

const router = express.Router();
router.use(authenticateToken, requireAdminSuperior);

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('saved_items').select('*').order('name', { ascending: true });
    if (error) throw error;
    res.json({ items: data });
  } catch (err) { res.status(500).json({ error: 'Error al obtener partidas' }); }
});

router.post('/', async (req, res) => {
  try {
    const { name, category, unit, unit_cost, markup_pct, unit_price, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Nombre requerido' });
    const cost = parseFloat(unit_cost) || 0;
    const markup = parseFloat(markup_pct) ?? 20;
    const price = unit_price !== undefined ? parseFloat(unit_price) || 0 : parseFloat((cost * (1 + markup / 100)).toFixed(2));
    const { data, error } = await supabase.from('saved_items').insert({
      name: name.trim(), category: category || 'material', unit: unit || 'ud',
      unit_cost: cost, markup_pct: markup, unit_price: price, notes: notes?.trim() || null
    }).select('*').single();
    if (error) throw error;
    res.status(201).json({ item: data });
  } catch (err) { res.status(500).json({ error: 'Error al guardar partida' }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('saved_items').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Partida eliminada' });
  } catch (err) { res.status(500).json({ error: 'Error al eliminar partida' }); }
});

export default router;
