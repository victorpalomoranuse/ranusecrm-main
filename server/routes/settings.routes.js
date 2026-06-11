import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdminSuperior } from '../middleware/auth.middleware.js';

const router = express.Router();
router.use(authenticateToken, requireAdminSuperior);

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('settings').select('*').eq('id', 1).single();
    if (error && error.code !== 'PGRST116') throw error;
    res.json({ settings: data || {} });
  } catch (err) { res.status(500).json({ error: 'Error al obtener ajustes' }); }
});

router.put('/', async (req, res) => {
  try {
    const { bank_iban, bank_name, payment_methods, payment_notes } = req.body;
    const updates = {};
    if (bank_iban !== undefined) updates.bank_iban = bank_iban?.trim() || null;
    if (bank_name !== undefined) updates.bank_name = bank_name?.trim() || null;
    if (payment_methods !== undefined) updates.payment_methods = payment_methods?.trim() || null;
    if (payment_notes !== undefined) updates.payment_notes = payment_notes?.trim() || null;
    const { data, error } = await supabase.from('settings').upsert({ id: 1, ...updates }).select('*').single();
    if (error) throw error;
    res.json({ settings: data });
  } catch (err) { res.status(500).json({ error: 'Error al guardar ajustes' }); }
});

export default router;
