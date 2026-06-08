import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdmin, requireAdminSuperior } from '../middleware/auth.middleware.js';
import { uploadProjectRender, deleteProjectRender, uploadProjectDocument, deleteProjectDocument, uploadDiagnosisImage, deleteDiagnosisImage } from '../utils/storage.js';
import { uploadRenderFile, uploadDocumentFile, uploadDiagnosisImageFile, handleMulterError } from '../middleware/upload.middleware.js';

const router = express.Router();

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function generateUniqueCode() {
  let code, exists;
  do {
    code = generateCode();
    const { data } = await supabase
      .from('client_projects')
      .select('id')
      .eq('access_code', code)
      .single();
    exists = !!data;
  } while (exists);
  return code;
}

/**
 * GET /api/client-projects
 * Listar todos los proyectos de clientes
 */
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('client_projects')
      .select('*, responsible:employees!responsible_id(id, name)')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ projects: data });
  } catch (error) {
    console.error('Error al listar proyectos:', error);
    res.status(500).json({ error: 'Error al listar proyectos' });
  }
});

/**
 * GET /api/client-projects/my-projects
 * Proyectos asignados al cliente autenticado
 */
router.get('/my-projects', authenticateToken, async (req, res) => {
  if (req.user.role !== 'cliente') {
    return res.status(403).json({ error: 'Acceso solo para clientes' });
  }
  try {
    const { data, error } = await supabase
      .from('client_user_projects')
      .select('client_projects(id, client_name, project_name, phase, access_code)')
      .eq('user_id', req.user.id);

    if (error) throw error;
    const projects = data.map(r => r.client_projects).filter(Boolean);
    res.json({ projects });
  } catch (err) {
    console.error('Error al obtener proyectos del cliente:', err);
    res.status(500).json({ error: 'Error al obtener proyectos' });
  }
});

/**
 * POST /api/client-projects/generate-code
 * Generar un código único (para usar en el formulario del admin)
 */
router.post('/generate-code', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const code = await generateUniqueCode();
    res.json({ code });
  } catch (error) {
    res.status(500).json({ error: 'Error al generar código' });
  }
});

/**
 * GET /api/client-projects/all-renders
 * Todos los renders de todos los proyectos (para la biblioteca de renders)
 */
router.get('/all-renders', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('project_renders')
      .select('*, project:client_projects!project_id(id, client_name, project_name)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ renders: data });
  } catch (err) {
    console.error('Error al obtener renders:', err);
    res.status(500).json({ error: 'Error al obtener renders' });
  }
});

/**
 * GET /api/client-projects/by-code/:code
 * Buscar proyecto por código de acceso (sin autenticación, para el portal del cliente)
 * Returns project + responsible email + renders + documents + diagnosis (with images) + materials + equipment
 */
router.get('/by-code/:code', async (req, res) => {
  try {
    const { data: project, error } = await supabase
      .from('client_projects')
      .select('id, client_name, project_name, phase, responsible:employees!responsible_id(name, email)')
      .eq('access_code', req.params.code.toUpperCase())
      .single();

    if (error || !project) {
      console.error('by-code error:', error);
      return res.status(404).json({ error: 'Código no válido' });
    }

    const projectId = project.id;

    const [
      rendersResult,
      documentsResult,
      diagnosisResult,
      materialsResult,
      equipmentResult,
      notesResult,
      toursResult,
    ] = await Promise.all([
      supabase.from('project_renders').select('*').eq('project_id', projectId).order('display_order', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false }),
      supabase.from('project_documents').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
      supabase.from('project_diagnosis').select('*').eq('project_id', projectId).single(),
      supabase.from('project_material_selections').select('*').eq('project_id', projectId).order('display_order', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false }),
      supabase.from('project_equipment_selections').select('*').eq('project_id', projectId).order('display_order', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false }),
      supabase.from('project_notes').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
      supabase.from('project_tours').select('*').eq('project_id', projectId).order('created_at', { ascending: true }),
    ]);

    let diagnosisData = diagnosisResult.data || null;
    let diagnosisImages = [];

    if (diagnosisData) {
      const { data: imgs } = await supabase
        .from('project_diagnosis_images')
        .select('*')
        .eq('diagnosis_id', diagnosisData.id)
        .order('created_at', { ascending: false });
      diagnosisImages = imgs || [];
    }

    const responsible_email = project.responsible?.email || null;
    const responsible_name = project.responsible?.name || null;

    res.json({
      project: {
        ...project,
        responsible_name,
        responsible_email,
        renders: rendersResult.data || [],
        documents: documentsResult.data || [],
        diagnosis: diagnosisData
          ? { ...diagnosisData, images: diagnosisImages }
          : null,
        materials: materialsResult.data || [],
        equipment: equipmentResult.data || [],
        notes: notesResult.data || [],
        tours: toursResult.data || [],
      },
    });
  } catch (err) {
    console.error('by-code exception:', err);
    res.status(500).json({ error: 'Error al buscar proyecto' });
  }
});

/**
 * POST /api/client-projects
 * Crear un nuevo proyecto de cliente
 */
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { client_name, project_name, client_email, access_code, phase = 1, urgency = 'normal', responsible_id, notes } = req.body;

    if (!client_name || !project_name || !access_code) {
      return res.status(400).json({ error: 'Nombre del cliente, proyecto y código son requeridos' });
    }

    const { data: existing } = await supabase
      .from('client_projects')
      .select('id')
      .eq('access_code', access_code.toUpperCase())
      .single();

    if (existing) {
      return res.status(400).json({ error: 'Este código ya está en uso' });
    }

    const { data, error } = await supabase
      .from('client_projects')
      .insert({
        client_name: client_name.trim(),
        project_name: project_name.trim(),
        client_email: client_email?.trim() || null,
        access_code: access_code.toUpperCase(),
        phase: parseInt(phase),
        urgency,
        responsible_id: responsible_id || null,
        notes: notes?.trim() || null,
      })
      .select('*, responsible:employees!responsible_id(id, name)')
      .single();

    if (error) throw error;
    res.status(201).json({ project: data });
  } catch (error) {
    console.error('Error al crear proyecto:', error);
    res.status(500).json({ error: 'Error al crear proyecto' });
  }
});

/**
 * PUT /api/client-projects/:id
 * Actualizar un proyecto de cliente
 */
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { client_name, project_name, client_email, phase, urgency, responsible_id, notes, active } = req.body;

    const updates = {};
    if (client_name !== undefined) updates.client_name = client_name.trim();
    if (project_name !== undefined) updates.project_name = project_name.trim();
    if (client_email !== undefined) updates.client_email = client_email?.trim() || null;
    if (phase !== undefined) updates.phase = parseInt(phase);
    if (urgency !== undefined) updates.urgency = urgency;
    if (responsible_id !== undefined) updates.responsible_id = responsible_id || null;
    if (notes !== undefined) updates.notes = notes?.trim() || null;
    if (active !== undefined) updates.active = active;

    const { data, error } = await supabase
      .from('client_projects')
      .update(updates)
      .eq('id', req.params.id)
      .select('*, responsible:employees!responsible_id(id, name)')
      .single();

    if (error) throw error;
    res.json({ project: data });
  } catch (error) {
    console.error('Error al actualizar proyecto:', error);
    res.status(500).json({ error: 'Error al actualizar proyecto' });
  }
});

/**
 * DELETE /api/client-projects/:id
 * Eliminar un proyecto (solo admin_superior)
 */
router.delete('/:id', authenticateToken, requireAdminSuperior, async (req, res) => {
  try {
    const { error } = await supabase
      .from('client_projects')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ message: 'Proyecto eliminado' });
  } catch (error) {
    console.error('Error al eliminar proyecto:', error);
    res.status(500).json({ error: 'Error al eliminar proyecto' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// RENDERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/client-projects/:id/renders
 */
router.put('/:id/renders/reorder', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids requeridos' });
    }
    await Promise.all(
      ids.map((renderId, index) =>
        supabase.from('project_renders').update({ display_order: index }).eq('id', renderId).eq('project_id', req.params.id)
      )
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al reordenar renders' });
  }
});

router.get('/:id/renders', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('project_renders')
      .select('*')
      .eq('project_id', req.params.id)
      .order('display_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ renders: data });
  } catch (error) {
    console.error('Error al obtener renders:', error);
    res.status(500).json({ error: 'Error al obtener renders' });
  }
});

/**
 * POST /api/client-projects/:id/renders
 */
router.post('/:id/renders', authenticateToken, requireAdmin, uploadRenderFile, handleMulterError, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ningún archivo' });
    }

    const { name, version } = req.body;
    const projectId = req.params.id;

    const url = await uploadProjectRender(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      projectId
    );

    const { data: maxRow } = await supabase
      .from('project_renders')
      .select('display_order')
      .eq('project_id', projectId)
      .order('display_order', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    const nextOrder = (maxRow?.display_order ?? -1) + 1;

    const { data, error } = await supabase
      .from('project_renders')
      .insert({
        project_id: projectId,
        url,
        name: name?.trim() || req.file.originalname,
        version: version?.trim() || null,
        display_order: nextOrder,
      })
      .select('*')
      .single();

    if (error) throw error;
    res.status(201).json({ render: data });
  } catch (error) {
    console.error('Error al subir render:', error);
    res.status(500).json({ error: 'Error al subir render' });
  }
});

/**
 * DELETE /api/client-projects/:id/renders/:renderId
 */
router.delete('/:id/renders/:renderId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { data: render, error: fetchError } = await supabase
      .from('project_renders')
      .select('url')
      .eq('id', req.params.renderId)
      .eq('project_id', req.params.id)
      .single();

    if (fetchError || !render) {
      return res.status(404).json({ error: 'Render no encontrado' });
    }

    await deleteProjectRender(render.url);

    const { error } = await supabase
      .from('project_renders')
      .delete()
      .eq('id', req.params.renderId);

    if (error) throw error;
    res.json({ message: 'Render eliminado' });
  } catch (error) {
    console.error('Error al eliminar render:', error);
    res.status(500).json({ error: 'Error al eliminar render' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/client-projects/:id/documents
 */
router.get('/:id/documents', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('project_documents')
      .select('*')
      .eq('project_id', req.params.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ documents: data });
  } catch (error) {
    console.error('Error al obtener documentos:', error);
    res.status(500).json({ error: 'Error al obtener documentos' });
  }
});

/**
 * POST /api/client-projects/:id/documents
 */
router.post('/:id/documents', authenticateToken, requireAdmin, uploadDocumentFile, handleMulterError, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ningún archivo' });
    }

    const { name, doc_type } = req.body;
    const projectId = req.params.id;

    const url = await uploadProjectDocument(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      projectId
    );

    const { data, error } = await supabase
      .from('project_documents')
      .insert({
        project_id: projectId,
        url,
        name: name?.trim() || req.file.originalname,
        doc_type: doc_type?.trim() || 'otro',
      })
      .select('*')
      .single();

    if (error) throw error;
    res.status(201).json({ document: data });
  } catch (error) {
    console.error('Error al subir documento:', error);
    res.status(500).json({ error: 'Error al subir documento' });
  }
});

/**
 * DELETE /api/client-projects/:id/documents/:docId
 */
router.delete('/:id/documents/:docId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { data: doc, error: fetchError } = await supabase
      .from('project_documents')
      .select('url')
      .eq('id', req.params.docId)
      .eq('project_id', req.params.id)
      .single();

    if (fetchError || !doc) {
      return res.status(404).json({ error: 'Documento no encontrado' });
    }

    await deleteProjectDocument(doc.url);

    const { error } = await supabase
      .from('project_documents')
      .delete()
      .eq('id', req.params.docId);

    if (error) throw error;
    res.json({ message: 'Documento eliminado' });
  } catch (error) {
    console.error('Error al eliminar documento:', error);
    res.status(500).json({ error: 'Error al eliminar documento' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DIAGNOSIS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/client-projects/:id/diagnosis
 */
router.get('/:id/diagnosis', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { data: diagnosis, error } = await supabase
      .from('project_diagnosis')
      .select('*')
      .eq('project_id', req.params.id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    if (!diagnosis) {
      return res.json({ diagnosis: null });
    }

    const { data: images, error: imgError } = await supabase
      .from('project_diagnosis_images')
      .select('*')
      .eq('diagnosis_id', diagnosis.id)
      .order('created_at', { ascending: false });

    if (imgError) throw imgError;

    res.json({ diagnosis: { ...diagnosis, images: images || [] } });
  } catch (error) {
    console.error('Error al obtener diagnóstico:', error);
    res.status(500).json({ error: 'Error al obtener diagnóstico' });
  }
});

/**
 * PUT /api/client-projects/:id/diagnosis
 * Upsert diagnosis content (text)
 */
router.put('/:id/diagnosis', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { content } = req.body;
    const projectId = req.params.id;

    const { data, error } = await supabase
      .from('project_diagnosis')
      .upsert(
        { project_id: projectId, content: content ?? '', updated_at: new Date().toISOString() },
        { onConflict: 'project_id' }
      )
      .select('*')
      .single();

    if (error) throw error;
    res.json({ diagnosis: data });
  } catch (error) {
    console.error('Error al actualizar diagnóstico:', error);
    res.status(500).json({ error: 'Error al actualizar diagnóstico' });
  }
});

/**
 * POST /api/client-projects/:id/diagnosis/images
 */
router.post('/:id/diagnosis/images', authenticateToken, requireAdmin, uploadDiagnosisImageFile, handleMulterError, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ningún archivo' });
    }

    const projectId = req.params.id;

    // Ensure diagnosis row exists
    const { data: existing } = await supabase
      .from('project_diagnosis')
      .select('id')
      .eq('project_id', projectId)
      .single();

    let diagnosisId;
    if (existing) {
      diagnosisId = existing.id;
    } else {
      const { data: created, error: createError } = await supabase
        .from('project_diagnosis')
        .insert({ project_id: projectId, content: '' })
        .select('id')
        .single();
      if (createError) throw createError;
      diagnosisId = created.id;
    }

    const url = await uploadDiagnosisImage(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      projectId
    );

    const { data, error } = await supabase
      .from('project_diagnosis_images')
      .insert({ diagnosis_id: diagnosisId, url })
      .select('*')
      .single();

    if (error) throw error;
    res.status(201).json({ image: data });
  } catch (error) {
    console.error('Error al subir imagen de diagnóstico:', error);
    res.status(500).json({ error: 'Error al subir imagen de diagnóstico' });
  }
});

/**
 * DELETE /api/client-projects/:id/diagnosis/images/:imgId
 */
router.delete('/:id/diagnosis/images/:imgId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { data: img, error: fetchError } = await supabase
      .from('project_diagnosis_images')
      .select('url')
      .eq('id', req.params.imgId)
      .single();

    if (fetchError || !img) {
      return res.status(404).json({ error: 'Imagen no encontrada' });
    }

    await deleteDiagnosisImage(img.url);

    const { error } = await supabase
      .from('project_diagnosis_images')
      .delete()
      .eq('id', req.params.imgId);

    if (error) throw error;
    res.json({ message: 'Imagen eliminada' });
  } catch (error) {
    console.error('Error al eliminar imagen de diagnóstico:', error);
    res.status(500).json({ error: 'Error al eliminar imagen de diagnóstico' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// MATERIALS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/client-projects/:id/materials
 */
router.put('/:id/materials/reorder', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids requeridos' });
    }
    await Promise.all(
      ids.map((selId, index) =>
        supabase.from('project_material_selections').update({ display_order: index }).eq('id', selId).eq('project_id', req.params.id)
      )
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al reordenar materiales' });
  }
});

router.get('/:id/materials', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('project_material_selections')
      .select('*')
      .eq('project_id', req.params.id)
      .order('display_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ materials: data });
  } catch (error) {
    console.error('Error al obtener materiales:', error);
    res.status(500).json({ error: 'Error al obtener materiales' });
  }
});

/**
 * POST /api/client-projects/:id/materials
 */
router.post('/:id/materials', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, brand, category, location, notes, image_url, catalog_product_id } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'El nombre del material es requerido' });
    }

    const { data, error } = await supabase
      .from('project_material_selections')
      .insert({
        project_id: req.params.id,
        name: name.trim(),
        brand: brand?.trim() || null,
        category: category?.trim() || null,
        location: location?.trim() || null,
        notes: notes?.trim() || null,
        image_url: image_url?.trim() || null,
        catalog_product_id: catalog_product_id || null,
      })
      .select('*')
      .single();

    if (error) throw error;
    res.status(201).json({ material: data });
  } catch (error) {
    console.error('Error al crear material:', error);
    res.status(500).json({ error: 'Error al crear material' });
  }
});

/**
 * DELETE /api/client-projects/:id/materials/:selId
 */
router.delete('/:id/materials/:selId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase
      .from('project_material_selections')
      .delete()
      .eq('id', req.params.selId)
      .eq('project_id', req.params.id);

    if (error) throw error;
    res.json({ message: 'Material eliminado' });
  } catch (error) {
    console.error('Error al eliminar material:', error);
    res.status(500).json({ error: 'Error al eliminar material' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// EQUIPMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/client-projects/:id/equipment
 */
router.put('/:id/equipment/reorder', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids requeridos' });
    }
    await Promise.all(
      ids.map((selId, index) =>
        supabase.from('project_equipment_selections').update({ display_order: index }).eq('id', selId).eq('project_id', req.params.id)
      )
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al reordenar equipamiento' });
  }
});

router.get('/:id/equipment', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('project_equipment_selections')
      .select('*')
      .eq('project_id', req.params.id)
      .order('display_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ equipment: data });
  } catch (error) {
    console.error('Error al obtener equipamiento:', error);
    res.status(500).json({ error: 'Error al obtener equipamiento' });
  }
});

/**
 * POST /api/client-projects/:id/equipment
 */
router.post('/:id/equipment', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, brand, category, quantity, color, notes, catalog_product_id, image_url } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'El nombre del equipo es requerido' });
    }

    const { data, error } = await supabase
      .from('project_equipment_selections')
      .insert({
        project_id: req.params.id,
        name: name.trim(),
        brand: brand?.trim() || null,
        category: category?.trim() || null,
        quantity: quantity != null ? parseInt(quantity) : 1,
        color: color?.trim() || null,
        notes: notes?.trim() || null,
        catalog_product_id: catalog_product_id || null,
        image_url: image_url?.trim() || null,
      })
      .select('*')
      .single();

    if (error) throw error;
    res.status(201).json({ equipment: data });
  } catch (error) {
    console.error('Error al crear equipo:', error);
    res.status(500).json({ error: 'Error al crear equipo' });
  }
});

/**
 * DELETE /api/client-projects/:id/equipment/:selId
 */
router.delete('/:id/equipment/:selId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase
      .from('project_equipment_selections')
      .delete()
      .eq('id', req.params.selId)
      .eq('project_id', req.params.id);

    if (error) throw error;
    res.json({ message: 'Equipo eliminado' });
  } catch (error) {
    console.error('Error al eliminar equipo:', error);
    res.status(500).json({ error: 'Error al eliminar equipo' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TOURS 3D
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/client-projects/:id/tours
 */
router.get('/:id/tours', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('project_tours')
      .select('*')
      .eq('project_id', req.params.id)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json({ tours: data });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener tours' });
  }
});

/**
 * POST /api/client-projects/:id/tours
 */
router.post('/:id/tours', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, url } = req.body;
    if (!name?.trim() || !url?.trim()) {
      return res.status(400).json({ error: 'Nombre y URL son requeridos' });
    }
    const { data, error } = await supabase
      .from('project_tours')
      .insert({ project_id: req.params.id, name: name.trim(), url: url.trim() })
      .select('*')
      .single();
    if (error) throw error;
    res.status(201).json({ tour: data });
  } catch (error) {
    res.status(500).json({ error: 'Error al crear tour' });
  }
});

/**
 * PUT /api/client-projects/:id/tours/:tourId
 */
router.put('/:id/tours/:tourId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, url } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (url !== undefined) updates.url = url.trim();

    const { data, error } = await supabase
      .from('project_tours')
      .update(updates)
      .eq('id', req.params.tourId)
      .eq('project_id', req.params.id)
      .select('*')
      .single();
    if (error) throw error;
    res.json({ tour: data });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar tour' });
  }
});

/**
 * DELETE /api/client-projects/:id/tours/:tourId
 */
router.delete('/:id/tours/:tourId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase
      .from('project_tours')
      .delete()
      .eq('id', req.params.tourId)
      .eq('project_id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Tour eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar tour' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// NOTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/client-projects/:id/notes
 */
router.get('/:id/notes', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('project_notes')
      .select('*')
      .eq('project_id', req.params.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ notes: data });
  } catch (error) {
    console.error('Error al obtener notas:', error);
    res.status(500).json({ error: 'Error al obtener notas' });
  }
});

/**
 * POST /api/client-projects/:id/notes
 */
router.post('/:id/notes', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'El contenido es requerido' });
    const { data, error } = await supabase
      .from('project_notes')
      .insert({ project_id: req.params.id, content: content.trim() })
      .select('*')
      .single();
    if (error) throw error;
    res.status(201).json({ note: data });
  } catch (error) {
    console.error('Error al crear nota:', error);
    res.status(500).json({ error: 'Error al crear nota' });
  }
});

/**
 * DELETE /api/client-projects/:id/notes/:noteId
 */
router.delete('/:id/notes/:noteId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase
      .from('project_notes')
      .delete()
      .eq('id', req.params.noteId)
      .eq('project_id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Nota eliminada' });
  } catch (error) {
    console.error('Error al eliminar nota:', error);
    res.status(500).json({ error: 'Error al eliminar nota' });
  }
});
router.put('/:id/equipment/:selId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { quantity, youtube_url, extra_images } = req.body;

    const updates = {};
    if (quantity !== undefined) updates.quantity = parseInt(quantity);
    if (youtube_url !== undefined) updates.youtube_url = youtube_url?.trim() || null;
    if (extra_images !== undefined) updates.extra_images = Array.isArray(extra_images) ? extra_images : [];

    const { data, error } = await supabase
      .from('project_equipment_selections')
      .update(updates)
      .eq('id', req.params.selId)
      .eq('project_id', req.params.id)
      .select('*')
      .single();

    if (error) throw error;
    res.json({ equipment: data });
  } catch (error) {
    console.error('Error al actualizar equipo:', error);
    res.status(500).json({ error: 'Error al actualizar equipo' });
  }
});
export default router;
