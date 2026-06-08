import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.middleware.js';
import { uploadPortfolioImages, handleMulterError } from '../middleware/upload.middleware.js';
import { uploadPortfolioImage, deletePortfolioImage } from '../utils/storage.js';

const router = express.Router();

// GET /api/portfolio — público, sin auth
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('portfolio_projects')
      .select('*')
      .order('display_order', { ascending: true });

    if (error) throw error;
    res.json({ projects: data });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener proyectos' });
  }
});

// POST /api/portfolio — crear proyecto con imágenes
router.post('/', authenticateToken, requireAdmin, uploadPortfolioImages, handleMulterError, async (req, res) => {
  try {
    const { title, description, slug } = req.body;
    const files = req.files || [];

    if (!title || !slug) {
      return res.status(400).json({ error: 'Título y slug son requeridos' });
    }

    const imageUrls = await Promise.all(
      files.map(f => uploadPortfolioImage(f.buffer, f.originalname, f.mimetype, slug))
    );

    const { data, error } = await supabase
      .from('portfolio_projects')
      .insert({
        title: title.trim(),
        description: description?.trim() || null,
        slug: slug.trim(),
        cover_url: imageUrls[0] || null,
        images: imageUrls,
        created_by: req.user.id
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') return res.status(400).json({ error: 'El slug ya existe' });
      throw error;
    }

    res.status(201).json({ project: data });
  } catch (err) {
    console.error('Error al crear proyecto portfolio:', err);
    res.status(500).json({ error: 'Error al crear proyecto' });
  }
});

// PUT /api/portfolio/:id — editar texto
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, slug, display_order, cover_url } = req.body;

    const updates = {};
    if (title !== undefined) updates.title = title.trim();
    if (description !== undefined) updates.description = description?.trim() || null;
    if (slug !== undefined) updates.slug = slug.trim();
    if (display_order !== undefined) updates.display_order = parseInt(display_order);
    if (cover_url !== undefined) updates.cover_url = cover_url;

    const { data, error } = await supabase
      .from('portfolio_projects')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json({ project: data });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar proyecto' });
  }
});

// POST /api/portfolio/:id/images — añadir imágenes a proyecto existente
router.post('/:id/images', authenticateToken, requireAdmin, uploadPortfolioImages, handleMulterError, async (req, res) => {
  try {
    const { id } = req.params;
    const files = req.files || [];

    if (!files.length) return res.status(400).json({ error: 'No se enviaron imágenes' });

    const { data: project, error: fetchErr } = await supabase
      .from('portfolio_projects')
      .select('slug, images, cover_url')
      .eq('id', id)
      .single();

    if (fetchErr || !project) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const newUrls = await Promise.all(
      files.map(f => uploadPortfolioImage(f.buffer, f.originalname, f.mimetype, project.slug))
    );

    const updatedImages = [...(project.images || []), ...newUrls];

    const { data, error } = await supabase
      .from('portfolio_projects')
      .update({
        images: updatedImages,
        cover_url: project.cover_url || newUrls[0]
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json({ project: data });
  } catch (err) {
    console.error('Error al añadir imágenes:', err);
    res.status(500).json({ error: 'Error al subir imágenes' });
  }
});

// DELETE /api/portfolio/:id/images — eliminar una imagen
router.delete('/:id/images', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { imageUrl } = req.body;

    const { data: project, error: fetchErr } = await supabase
      .from('portfolio_projects')
      .select('images, cover_url')
      .eq('id', id)
      .single();

    if (fetchErr || !project) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const updatedImages = project.images.filter(u => u !== imageUrl);
    const coverUrl = project.cover_url === imageUrl ? (updatedImages[0] || null) : project.cover_url;

    await deletePortfolioImage(imageUrl);

    const { data, error } = await supabase
      .from('portfolio_projects')
      .update({ images: updatedImages, cover_url: coverUrl })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json({ project: data });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar imagen' });
  }
});

// DELETE /api/portfolio/:id — eliminar proyecto completo
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: project } = await supabase
      .from('portfolio_projects')
      .select('images')
      .eq('id', id)
      .single();

    if (project?.images?.length) {
      await Promise.all(project.images.map(url => deletePortfolioImage(url)));
    }

    const { error } = await supabase.from('portfolio_projects').delete().eq('id', id);
    if (error) throw error;

    res.json({ message: 'Proyecto eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar proyecto' });
  }
});

export default router;
