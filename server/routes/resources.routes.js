import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdminSuperior, requirePermission } from '../middleware/auth.middleware.js';

const router = express.Router();
const requireRecursos = requirePermission('recursos');

/**
 * GET /api/resources
 * Listar recursos de empresa (manuales, guías, enlaces internos, etc.)
 * Accesible por admin_superior o por cualquier empleado con permiso "recursos"
 */
router.get('/', authenticateToken, requireRecursos, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('company_resources')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ resources: data });
  } catch (error) {
    console.error('Error al listar recursos:', error);
    res.status(500).json({ error: 'Error al listar recursos' });
  }
});

/**
 * POST /api/resources
 * Crear un recurso — solo admin_superior gestiona el contenido
 */
router.post('/', authenticateToken, requireAdminSuperior, async (req, res) => {
  try {
    const { title, category, description, url, file_url } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'El título es requerido' });

    const { data, error } = await supabase
      .from('company_resources')
      .insert({
        title: title.trim(),
        category: category?.trim() || null,
        description: description?.trim() || null,
        url: url?.trim() || null,
        file_url: file_url?.trim() || null,
        created_by: req.user.id,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ resource: data });
  } catch (error) {
    console.error('Error al crear recurso:', error);
    res.status(500).json({ error: 'Error al crear recurso' });
  }
});

/**
 * PUT /api/resources/:id
 * Editar un recurso — solo admin_superior
 */
router.put('/:id', authenticateToken, requireAdminSuperior, async (req, res) => {
  try {
    const { title, category, description, url, file_url } = req.body;
    const updates = {};
    if (title !== undefined) updates.title = title.trim();
    if (category !== undefined) updates.category = category?.trim() || null;
    if (description !== undefined) updates.description = description?.trim() || null;
    if (url !== undefined) updates.url = url?.trim() || null;
    if (file_url !== undefined) updates.file_url = file_url?.trim() || null;

    const { data, error } = await supabase
      .from('company_resources')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ resource: data });
  } catch (error) {
    console.error('Error al actualizar recurso:', error);
    res.status(500).json({ error: 'Error al actualizar recurso' });
  }
});

/**
 * DELETE /api/resources/:id
 * Eliminar un recurso — solo admin_superior
 */
router.delete('/:id', authenticateToken, requireAdminSuperior, async (req, res) => {
  try {
    const { error } = await supabase.from('company_resources').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Recurso eliminado' });
  } catch (error) {
    console.error('Error al eliminar recurso:', error);
    res.status(500).json({ error: 'Error al eliminar recurso' });
  }
});

export default router;
