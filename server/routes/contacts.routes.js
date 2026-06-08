import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.middleware.js';

const router = express.Router();
router.use(authenticateToken, requireAdmin);

router.get('/', async (req, res) => {
  try {
    const { sector } = req.query;
    let query = supabase
      .from('contacts')
      .select('*')
      .order('name', { ascending: true });
    if (sector) query = query.eq('sector', sector);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ contacts: data });
  } catch {
    res.status(500).json({ error: 'Error al listar contactos' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, phone, email, sector, company_url, description } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Nombre requerido' });
    const { data, error } = await supabase
      .from('contacts')
      .insert({
        name: name.trim(),
        phone: phone?.trim() || null,
        email: email?.trim() || null,
        sector: sector?.trim() || null,
        company_url: company_url?.trim() || null,
        description: description?.trim() || null,
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ contact: data });
  } catch {
    res.status(500).json({ error: 'Error al crear contacto' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, phone, email, sector, company_url, description } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (phone !== undefined) updates.phone = phone?.trim() || null;
    if (email !== undefined) updates.email = email?.trim() || null;
    if (sector !== undefined) updates.sector = sector?.trim() || null;
    if (company_url !== undefined) updates.company_url = company_url?.trim() || null;
    if (description !== undefined) updates.description = description?.trim() || null;
    const { data, error } = await supabase
      .from('contacts')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ contact: data });
  } catch {
    res.status(500).json({ error: 'Error al actualizar contacto' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('contacts')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Contacto eliminado' });
  } catch {
    res.status(500).json({ error: 'Error al eliminar contacto' });
  }
});

export default router;
