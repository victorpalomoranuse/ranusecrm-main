import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';
import { uploadCategoryItemFile, uploadCategoryItemImages, uploadCategoryItemCreate, handleMulterError } from '../middleware/upload.middleware.js';
import { uploadProjectDocument, deleteProjectDocument, uploadProjectRender, deleteProjectRender } from '../utils/storage.js';

const requireProyectos = requirePermission('proyectos');
const router = express.Router();

/**
 * GET /api/categories/templates
 * Catálogo de categorías sugeridas para añadir rápido a un proyecto
 */
router.get('/templates', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { data, error } = await supabase.from('category_templates').select('*').order('display_order', { ascending: true, nullsFirst: false });
    if (error) throw error;
    res.json({ templates: data || [] });
  } catch (err) {
    console.error('Error al listar plantillas de categoría:', err);
    res.status(500).json({ error: 'Error al listar plantillas' });
  }
});

/**
 * GET /api/categories/project/:projectId
 * Categorías de un proyecto con sus apartados, ordenadas
 */
router.get('/project/:projectId', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { data: categories, error: catError } = await supabase
      .from('project_categories')
      .select('*')
      .eq('project_id', req.params.projectId)
      .order('display_order', { ascending: true });
    if (catError) throw catError;

    const categoryIds = (categories || []).map(c => c.id);
    const { data: items, error: itemsError } = categoryIds.length
      ? await supabase.from('category_items').select('*').in('category_id', categoryIds).order('display_order', { ascending: true })
      : { data: [] };
    if (itemsError) throw itemsError;

    const result = (categories || []).map(c => ({
      ...c,
      items: (items || []).filter(i => i.category_id === c.id),
    }));

    res.json({ categories: result });
  } catch (err) {
    console.error('Error al listar categorías del proyecto:', err);
    res.status(500).json({ error: 'Error al listar categorías' });
  }
});

/**
 * POST /api/categories
 * Crear categoría en un proyecto (desde plantilla o con nombre libre)
 */
router.post('/', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { project_id, name, template_id } = req.body;
    if (!project_id || !name?.trim()) {
      return res.status(400).json({ error: 'project_id y name son requeridos' });
    }

    const { data: maxRow } = await supabase
      .from('project_categories')
      .select('display_order')
      .eq('project_id', project_id)
      .order('display_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextOrder = (maxRow?.display_order ?? -1) + 1;

    const { data, error } = await supabase
      .from('project_categories')
      .insert({
        project_id,
        name: name.trim(),
        display_order: nextOrder,
        template_id: template_id || null,
      })
      .select('*')
      .single();
    if (error) throw error;

    // Si la plantilla trae checklist, generamos las tareas automáticas de esta categoría
    if (template_id) {
      const { data: template } = await supabase.from('category_templates').select('checklist').eq('id', template_id).single();
      const checklist = template?.checklist || [];
      if (checklist.length) {
        await supabase.from('tasks').insert(
          checklist.map(item => ({
            title: item.title || item,
            project_id,
            category_id: data.id,
            priority: 'normal',
          }))
        );
      }
    }

    res.status(201).json({ category: { ...data, items: [] } });
  } catch (err) {
    console.error('Error al crear categoría:', err);
    res.status(500).json({ error: 'Error al crear categoría' });
  }
});

/**
 * PUT /api/categories/reorder
 * body: { project_id, ids: [uuid...] } en el orden deseado
 */
router.put('/reorder', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { project_id, ids } = req.body;
    if (!project_id || !Array.isArray(ids)) {
      return res.status(400).json({ error: 'project_id e ids son requeridos' });
    }
    await Promise.all(
      ids.map((id, index) =>
        supabase.from('project_categories').update({ display_order: index }).eq('id', id).eq('project_id', project_id)
      )
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Error al reordenar categorías:', err);
    res.status(500).json({ error: 'Error al reordenar categorías' });
  }
});

/**
 * PUT /api/categories/:id
 * Renombrar / editar intro / cambiar estado de una categoría
 */
router.put('/:id', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { name, intro_text, status, materials_label, equipment_label } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (intro_text !== undefined) updates.intro_text = intro_text;
    if (status !== undefined) updates.status = status;
    if (materials_label !== undefined) updates.materials_label = materials_label?.trim() || null;
    if (equipment_label !== undefined) updates.equipment_label = equipment_label?.trim() || null;

    const { data, error } = await supabase.from('project_categories').update(updates).eq('id', req.params.id).select('*').single();
    if (error) throw error;
    res.json({ category: data });
  } catch (err) {
    console.error('Error al actualizar categoría:', err);
    res.status(500).json({ error: 'Error al actualizar categoría' });
  }
});

/**
 * DELETE /api/categories/:id
 * Borra la categoría y sus apartados (documentos en Storage incluidos)
 */
router.delete('/:id', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { data: items } = await supabase.from('category_items').select('type, file_url, images').eq('category_id', req.params.id);
    for (const item of items || []) {
      if (item.type === 'documento' && item.file_url) await deleteProjectDocument(item.file_url);
      if (Array.isArray(item.images)) {
        for (const img of item.images) if (img?.url) await deleteProjectRender(img.url);
      }
    }
    const { error } = await supabase.from('project_categories').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('Error al borrar categoría:', err);
    res.status(500).json({ error: 'Error al borrar categoría' });
  }
});

/**
 * PUT /api/categories/:id/items/reorder
 * body: { ids: [uuid...] }
 */
router.put('/:id/items/reorder', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids es requerido' });
    await Promise.all(
      ids.map((id, index) =>
        supabase.from('category_items').update({ display_order: index }).eq('id', id).eq('category_id', req.params.id)
      )
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Error al reordenar apartados:', err);
    res.status(500).json({ error: 'Error al reordenar apartados' });
  }
});

/**
 * POST /api/categories/:id/items
 * Crea un apartado. multipart/form-data:
 *  - type: 'documento' | 'bloque'
 *  - title
 *  - file (si type=documento)
 *  - images[] (si type=bloque, opcional, hasta 10)
 *  - body_text, links (JSON string [{url,label}]) (si type=bloque)
 */
router.post('/:id/items', authenticateToken, requireProyectos, uploadCategoryItemCreate, handleMulterError, async (req, res) => {
  try {
    const categoryId = req.params.id;
    const { type, title, body_text, links, code } = req.body;
    if (!type || !title?.trim()) return res.status(400).json({ error: 'type y title son requeridos' });

    const { data: category } = await supabase.from('project_categories').select('project_id').eq('id', categoryId).single();
    if (!category) return res.status(404).json({ error: 'Categoría no encontrada' });

    const { data: maxRow } = await supabase
      .from('category_items')
      .select('display_order')
      .eq('category_id', categoryId)
      .order('display_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextOrder = (maxRow?.display_order ?? -1) + 1;

    const insert = { category_id: categoryId, type, title: title.trim(), display_order: nextOrder };

    if (type === 'bloque') {
      insert.body_text = body_text || null;
      insert.links = links ? JSON.parse(links) : [];
      const images = [];
      for (const file of req.files?.images || []) {
        const url = await uploadProjectRender(file.buffer, file.originalname, file.mimetype, category.project_id);
        images.push({ url, name: file.originalname });
      }
      insert.images = images;
    } else {
      insert.code = code || null;
      const docFile = req.files?.file?.[0];
      if (docFile) {
        insert.file_url = await uploadProjectDocument(docFile.buffer, docFile.originalname, docFile.mimetype, category.project_id);
      }
    }

    const { data, error } = await supabase.from('category_items').insert(insert).select('*').single();
    if (error) throw error;
    res.status(201).json({ item: data });
  } catch (err) {
    console.error('Error al crear apartado:', err);
    res.status(500).json({ error: 'Error al crear apartado' });
  }
});

/**
 * POST /api/categories/items/:itemId/file
 * Sube (o reemplaza) el documento de un apartado tipo "documento"
 */
router.post('/items/:itemId/file', authenticateToken, requireProyectos, uploadCategoryItemFile, handleMulterError, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
    const { data: item } = await supabase
      .from('category_items')
      .select('*, category:project_categories!category_id(project_id)')
      .eq('id', req.params.itemId)
      .single();
    if (!item) return res.status(404).json({ error: 'Apartado no encontrado' });

    if (item.file_url) await deleteProjectDocument(item.file_url);
    const url = await uploadProjectDocument(req.file.buffer, req.file.originalname, req.file.mimetype, item.category.project_id);

    const { data, error } = await supabase.from('category_items').update({ file_url: url }).eq('id', req.params.itemId).select('*').single();
    if (error) throw error;
    res.json({ item: data });
  } catch (err) {
    console.error('Error al subir documento del apartado:', err);
    res.status(500).json({ error: 'Error al subir documento' });
  }
});

/**
 * POST /api/categories/items/:itemId/images
 * Añade más imágenes a un apartado tipo "bloque"
 */
router.post('/items/:itemId/images', authenticateToken, requireProyectos, uploadCategoryItemImages, handleMulterError, async (req, res) => {
  try {
    const { data: item } = await supabase
      .from('category_items')
      .select('*, category:project_categories!category_id(project_id)')
      .eq('id', req.params.itemId)
      .single();
    if (!item) return res.status(404).json({ error: 'Apartado no encontrado' });

    const newImages = [];
    for (const file of req.files || []) {
      const url = await uploadProjectRender(file.buffer, file.originalname, file.mimetype, item.category.project_id);
      newImages.push({ url, name: file.originalname });
    }

    const images = [...(item.images || []), ...newImages];
    const { data, error } = await supabase.from('category_items').update({ images }).eq('id', req.params.itemId).select('*').single();
    if (error) throw error;
    res.json({ item: data });
  } catch (err) {
    console.error('Error al añadir imágenes:', err);
    res.status(500).json({ error: 'Error al añadir imágenes' });
  }
});

/**
 * PUT /api/categories/items/:itemId
 * body: { title, body_text, links: [{url,label}], code, remove_image_url }
 */
router.put('/items/:itemId', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { title, body_text, links, code, remove_image_url } = req.body;
    const updates = {};
    if (title !== undefined) updates.title = title.trim();
    if (body_text !== undefined) updates.body_text = body_text;
    if (links !== undefined) updates.links = links;
    if (code !== undefined) updates.code = code;

    if (remove_image_url) {
      const { data: item } = await supabase.from('category_items').select('images').eq('id', req.params.itemId).single();
      const images = (item?.images || []).filter(img => img.url !== remove_image_url);
      updates.images = images;
      await deleteProjectRender(remove_image_url);
    }

    const { data, error } = await supabase.from('category_items').update(updates).eq('id', req.params.itemId).select('*').single();
    if (error) throw error;
    res.json({ item: data });
  } catch (err) {
    console.error('Error al actualizar apartado:', err);
    res.status(500).json({ error: 'Error al actualizar apartado' });
  }
});

/**
 * DELETE /api/categories/items/:itemId
 */
router.delete('/items/:itemId', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { data: item } = await supabase.from('category_items').select('type, file_url, images').eq('id', req.params.itemId).single();
    if (item?.type === 'documento' && item.file_url) await deleteProjectDocument(item.file_url);
    if (Array.isArray(item?.images)) {
      for (const img of item.images) if (img?.url) await deleteProjectRender(img.url);
    }
    const { error } = await supabase.from('category_items').delete().eq('id', req.params.itemId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('Error al borrar apartado:', err);
    res.status(500).json({ error: 'Error al borrar apartado' });
  }
});

export default router;
