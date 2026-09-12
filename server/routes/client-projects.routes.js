import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission, requireAdminSuperior } from '../middleware/auth.middleware.js';

const requireProyectos = requirePermission('proyectos');
const requireTrabajos = requirePermission('trabajos');
import { uploadProjectRender, deleteProjectRender, uploadProjectDocument, deleteProjectDocument, uploadDiagnosisImage, deleteDiagnosisImage, uploadMoodboardImage, deleteMoodboardImage } from '../utils/storage.js';
import { uploadRenderFile, uploadDocumentFile, uploadDiagnosisImageFile, uploadMoodboardImages, handleMulterError } from '../middleware/upload.middleware.js';
import { callClaude } from '../utils/anthropic.js';

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
 * Genera las tareas de la plantilla de checklist de una fase para un proyecto,
 * saltándose las plantillas que ya se hayan aplicado antes (para que ir y
 * volver de una fase no duplique tareas).
 */
async function applyPhaseTaskTemplates(projectId, phaseNumber) {
  try {
    const { data: templates } = await supabase
      .from('phase_task_templates')
      .select('*')
      .eq('phase_number', phaseNumber);
    if (!templates?.length) return;

    const { data: existing } = await supabase
      .from('tasks')
      .select('template_id')
      .eq('project_id', projectId)
      .not('template_id', 'is', null);
    const existingTemplateIds = new Set((existing || []).map(t => t.template_id));

    const toInsert = templates
      .filter(t => !existingTemplateIds.has(t.id))
      .map(t => ({
        title: t.title,
        description: t.description,
        project_id: projectId,
        phase_number: phaseNumber,
        template_id: t.id,
        priority: 'normal',
      }));

    if (toInsert.length) await supabase.from('tasks').insert(toInsert);
  } catch (err) {
    console.error('Error al generar checklist de fase:', err);
  }
}

// Categorías con las que arranca cada proyecto nuevo, para no tener que
// crearlas a mano cada vez — se pueden renombrar, reordenar o borrar
// después en cualquier proyecto sin que afecte a los demás.
const DEFAULT_CATEGORIES = [
  {
    name: 'Diseño previo',
    intro_text: 'En esta fase definimos el concepto estético del proyecto, la distribución del espacio y una primera orientación de acabados (paredes, iluminación, etc.) — aquí encontrarás la presentación y los renders de tu diseño.',
  },
  {
    name: 'Proyecto de ejecución',
    intro_text: 'Aquí encontrarás toda la documentación técnica para ejecutar el proyecto: planos, instalaciones, materiales y equipamiento definitivo.',
  },
];

async function applyDefaultCategories(projectId) {
  try {
    const toInsert = DEFAULT_CATEGORIES.map((c, i) => ({
      project_id: projectId,
      name: c.name,
      intro_text: c.intro_text,
      display_order: i,
    }));
    await supabase.from('project_categories').insert(toInsert);
  } catch (err) {
    console.error('Error al crear categorías por defecto:', err);
  }
}

/**
 * GET /api/client-projects
 * Listar todos los proyectos de clientes
 */
router.get('/', authenticateToken, requireProyectos, async (req, res) => {
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
      .select('client_projects(id, client_name, project_name, phase, access_code, cover_image_url)')
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
router.post('/generate-code', authenticateToken, requireProyectos, async (req, res) => {
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
router.get('/all-renders', authenticateToken, requireProyectos, async (req, res) => {
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
      .select('id, client_name, project_name, phase, cover_image_url, moodboard_description, listados_intro_text, listados_title, responsible:employees!responsible_id(name, email)')
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
      categoriesResult,
      moodboardImagesResult,
      catalogTypesResult,
    ] = await Promise.all([
      supabase.from('project_renders').select('*').eq('project_id', projectId).order('display_order', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false }),
      supabase.from('project_documents').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
      supabase.from('project_diagnosis').select('*').eq('project_id', projectId).single(),
      supabase.from('project_material_selections').select('*').eq('project_id', projectId).order('display_order', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false }),
      supabase.from('project_equipment_selections').select('*').eq('project_id', projectId).order('display_order', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false }),
      supabase.from('project_notes').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
      supabase.from('project_tours').select('*').eq('project_id', projectId).order('created_at', { ascending: true }),
      supabase.from('project_categories').select('*').eq('project_id', projectId).order('display_order', { ascending: true }),
      supabase.from('project_moodboard_images').select('*').eq('project_id', projectId).order('display_order', { ascending: true }),
      // Tipos de catálogo (Materiales, Mobiliario, Iluminación...) — para agrupar
      // los "Listados" del cliente en un desplegable por tipo, con su nombre y orden.
      supabase.from('catalog_types').select('name, slug, display_order').order('display_order', { ascending: true, nullsFirst: false }),
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

    const allRenders = rendersResult.data || [];
    const allTours = toursResult.data || [];
    const allMaterials = materialsResult.data || [];
    const allEquipment = equipmentResult.data || [];
    const allCategories = categoriesResult.data || [];

    const categoryIds = allCategories.map(c => c.id);
    const { data: allCategoryItems } = categoryIds.length
      ? await supabase.from('category_items').select('*').in('category_id', categoryIds).order('display_order', { ascending: true })
      : { data: [] };

    const categories = allCategories.map(c => ({
      ...c,
      items: (allCategoryItems || []).filter(i => i.category_id === c.id),
      materials: allMaterials.filter(m => m.category_id === c.id),
      equipment: allEquipment.filter(e => e.category_id === c.id),
    }));

    res.json({
      project: {
        ...project,
        responsible_name,
        responsible_email,
        renders: allRenders,
        documents: documentsResult.data || [],
        diagnosis: diagnosisData
          ? { ...diagnosisData, images: diagnosisImages }
          : null,
        materials: allMaterials,
        equipment: allEquipment,
        catalog_types: catalogTypesResult.data || [],
        notes: notesResult.data || [],
        tours: allTours,
        categories,
        moodboard: {
          description: project.moodboard_description || '',
          images: moodboardImagesResult.data || [],
        },
      },
    });
  } catch (err) {
    console.error('by-code exception:', err);
    res.status(500).json({ error: 'Error al buscar proyecto' });
  }
});

// ══════════════════════════════════════════════════════════════════════
// TRABAJOS (portfolio público) — proyectos reales con portfolio_published
// = true. Solo se devuelven campos seguros: nunca cliente, contacto,
// presupuesto ni notas internas.
// ══════════════════════════════════════════════════════════════════════

router.get('/public/portfolio', async (req, res) => {
  try {
    // Los trabajos antiguos (tabla portfolio_projects, sueltos) se siguen
    // enseñando tal cual para no romper lo que ya hay publicado — se
    // enseñan primero, en su orden de siempre, y los proyectos nuevos
    // conectados van después. Con el tiempo, todo pasará a ser conectado.
    const [{ data: legacy }, { data: linked, error }] = await Promise.all([
      supabase.from('portfolio_projects').select('id, title, slug, description, cover_url, images, display_order').order('display_order', { ascending: true }),
      supabase.from('client_projects')
        .select('id, project_name, portfolio_slug, portfolio_concept, cover_image_url, portfolio_order')
        .eq('portfolio_published', true)
        .not('portfolio_slug', 'is', null)
        .order('created_at', { ascending: false }),
    ]);
    if (error) throw error;

    const legacyProjects = (legacy || []).map(p => ({
      id: p.id,
      type: 'legacy',
      slug: p.slug,
      title: p.title,
      description: p.description || '',
      cover_url: (p.cover_url && !p.cover_url.startsWith('blob:')) ? p.cover_url : (p.images || []).find(u => u && !u.startsWith('blob:')) || null,
      order: p.display_order ?? Infinity,
    }));
    const linkedProjects = (linked || []).map(p => ({
      id: p.id,
      type: 'linked',
      slug: p.portfolio_slug,
      title: p.project_name,
      description: p.portfolio_concept ? p.portfolio_concept.slice(0, 160) : '',
      cover_url: p.cover_image_url,
      order: p.portfolio_order ?? Infinity,
    }));
    // Orden único: si tiene un orden guardado (por arrastrar/flechas en el
    // panel) se respeta ese; si no, los antiguos van primero (como siempre)
    // y los nuevos conectados detrás, por fecha de creación.
    const merged = [...legacyProjects, ...linkedProjects]
      .sort((a, b) => a.order - b.order)
      .map(({ order, ...p }) => p);
    res.json({ projects: merged });
  } catch (err) {
    console.error('Error al listar trabajos:', err);
    res.status(500).json({ error: 'Error al listar trabajos' });
  }
});

// PUT /client-projects/portfolio/reorder — guarda el orden único de Trabajos
// (mezcla proyectos antiguos sueltos y nuevos conectados). Recibe la lista
// completa en el orden deseado: [{id, type: 'legacy'|'linked'}, ...].
router.put('/portfolio/reorder', authenticateToken, requireTrabajos, async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'Formato inválido' });

    await Promise.all(items.map((item, i) => {
      if (item.type === 'legacy') {
        return supabase.from('portfolio_projects').update({ display_order: i }).eq('id', item.id);
      }
      return supabase.from('client_projects').update({ portfolio_order: i }).eq('id', item.id);
    }));

    res.json({ message: 'Orden guardado' });
  } catch (err) {
    console.error('Error al guardar el orden de trabajos:', err);
    res.status(500).json({ error: 'Error al guardar el orden' });
  }
});

router.get('/public/portfolio/:slug', async (req, res) => {
  try {
    const { data: project, error } = await supabase
      .from('client_projects')
      .select('id, project_name, portfolio_slug, portfolio_concept, cover_image_url, testimonial_video_url')
      .eq('portfolio_slug', req.params.slug)
      .eq('portfolio_published', true)
      .maybeSingle();
    if (error) throw error;

    if (!project) {
      // Trabajo antiguo (tabla suelta portfolio_projects) — se enseña tal
      // cual, solo con la sección "El resultado" (sus fotos de siempre).
      const { data: legacy } = await supabase.from('portfolio_projects').select('*').eq('slug', req.params.slug).maybeSingle();
      if (!legacy) return res.status(404).json({ error: 'No encontrado' });
      return res.json({
        project: {
          slug: legacy.slug,
          title: legacy.title,
          concept: legacy.description || '',
          cover_url: (legacy.cover_url && !legacy.cover_url.startsWith('blob:')) ? legacy.cover_url : null,
          moodboard_images: [],
          before_photos: [],
          result_images: (legacy.images || []).filter(u => u && !u.startsWith('blob:')),
          is_result: true,
          testimonial_video_url: null,
        },
      });
    }

    const [{ data: moodboardImgs }, { data: renders }, needsForm] = await Promise.all([
      supabase.from('project_moodboard_images').select('url').eq('project_id', project.id).order('display_order', { ascending: true }),
      supabase.from('project_renders').select('url, kind').eq('project_id', project.id).order('display_order', { ascending: true, nullsFirst: false }),
      supabase.from('project_needs_forms').select('id').eq('project_id', project.id).maybeSingle().then(r => r.data),
    ]);

    let beforePhotos = [];
    if (needsForm) {
      const { data: photos } = await supabase.from('project_needs_form_photos').select('url').eq('form_id', needsForm.id).order('display_order', { ascending: true });
      beforePhotos = (photos || []).map(p => p.url);
    }

    const allRenders = renders || [];
    const resultado = allRenders.filter(r => r.kind === 'resultado').map(r => r.url);
    const rendersOnly = allRenders.filter(r => r.kind !== 'resultado').map(r => r.url);

    res.json({
      project: {
        slug: project.portfolio_slug,
        title: project.project_name,
        concept: project.portfolio_concept || '',
        cover_url: project.cover_image_url,
        moodboard_images: (moodboardImgs || []).map(m => m.url),
        before_photos: beforePhotos,
        result_images: resultado.length ? resultado : rendersOnly,
        is_result: resultado.length > 0,
        testimonial_video_url: project.testimonial_video_url || null,
      },
    });
  } catch (err) {
    console.error('Error al cargar trabajo público:', err);
    res.status(500).json({ error: 'Error al cargar el proyecto' });
  }
});

/**
 * POST /api/client-projects
 * Crear un nuevo proyecto de cliente
 */
router.post('/', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { client_name, project_name, client_email, access_code, phase = 0, urgency = 'normal', responsible_id, notes, lead_id, venta_id } = req.body;

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
        lead_id: lead_id || null,
        venta_id: venta_id || null,
      })
      .select('*, responsible:employees!responsible_id(id, name)')
      .single();

    if (error) throw error;
    await applyPhaseTaskTemplates(data.id, data.phase);
    await applyDefaultCategories(data.id);
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
router.put('/:id', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { client_name, project_name, client_email, phase, urgency, responsible_id, notes, active, lead_id, venta_id, status, cover_image_url, memoria_intro, portfolio_published, portfolio_slug, portfolio_concept, testimonial_video_url } = req.body;

    const updates = {};
    if (memoria_intro !== undefined) updates.memoria_intro = memoria_intro?.trim() || null;
    if (portfolio_published !== undefined) updates.portfolio_published = !!portfolio_published;
    if (portfolio_slug !== undefined) updates.portfolio_slug = portfolio_slug?.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || null;
    if (portfolio_concept !== undefined) updates.portfolio_concept = portfolio_concept?.trim() || null;
    if (testimonial_video_url !== undefined) updates.testimonial_video_url = testimonial_video_url?.trim() || null;
    if (client_name !== undefined) updates.client_name = client_name.trim();
    if (project_name !== undefined) updates.project_name = project_name.trim();
    if (client_email !== undefined) updates.client_email = client_email?.trim() || null;
    if (phase !== undefined) updates.phase = parseInt(phase);
    if (urgency !== undefined) updates.urgency = urgency;
    if (responsible_id !== undefined) updates.responsible_id = responsible_id || null;
    if (notes !== undefined) updates.notes = notes?.trim() || null;
    if (active !== undefined) updates.active = active;
    if (lead_id !== undefined) updates.lead_id = lead_id || null;
    if (venta_id !== undefined) updates.venta_id = venta_id || null;
    if (status !== undefined) updates.status = status;
    if (cover_image_url !== undefined) updates.cover_image_url = cover_image_url?.trim() || null;

    const { data, error } = await supabase
      .from('client_projects')
      .update(updates)
      .eq('id', req.params.id)
      .select('*, responsible:employees!responsible_id(id, name)')
      .single();

    if (error) throw error;
    if (updates.phase !== undefined) await applyPhaseTaskTemplates(req.params.id, updates.phase);
    res.json({ project: data });
  } catch (error) {
    if (error.code === '23505' && error.message?.includes('portfolio_slug')) {
      return res.status(400).json({ error: 'Esa URL de Trabajos ya la usa otro proyecto — elige otra.' });
    }
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

/**
 * POST /api/client-projects/:id/cover
 * Sube (o reemplaza) la portada del proyecto
 */
router.post('/:id/cover', authenticateToken, requireProyectos, uploadRenderFile, handleMulterError, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });
    const url = await uploadProjectRender(req.file.buffer, req.file.originalname, req.file.mimetype, req.params.id);
    const { data, error } = await supabase
      .from('client_projects')
      .update({ cover_image_url: url })
      .eq('id', req.params.id)
      .select('cover_image_url')
      .single();
    if (error) throw error;
    res.json({ cover_image_url: data.cover_image_url });
  } catch (error) {
    console.error('Error al subir portada:', error);
    res.status(500).json({ error: 'Error al subir portada' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// RENDERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/client-projects/:id/renders
 */
router.put('/:id/renders/reorder', authenticateToken, requireProyectos, async (req, res) => {
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

router.get('/:id/renders', authenticateToken, requireProyectos, async (req, res) => {
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
router.post('/:id/renders', authenticateToken, requireProyectos, uploadRenderFile, handleMulterError, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ningún archivo' });
    }

    const { name, version, phase_number, kind } = req.body;
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
        phase_number: phase_number != null && phase_number !== '' ? parseInt(phase_number) : null,
        kind: kind === 'resultado' ? 'resultado' : 'render',
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
 * PUT /api/client-projects/:id/renders/:renderId
 * Solo para marcar si es un render (visualización 3D) o una foto real del
 * resultado ya ejecutado — se usa en Trabajos para decidir qué enseñar.
 */
router.put('/:id/renders/:renderId', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { kind } = req.body;
    if (!['render', 'resultado'].includes(kind)) return res.status(400).json({ error: 'kind inválido' });
    const { data, error } = await supabase
      .from('project_renders')
      .update({ kind })
      .eq('id', req.params.renderId)
      .eq('project_id', req.params.id)
      .select('*')
      .single();
    if (error) throw error;
    res.json({ render: data });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar el render' });
  }
});

/**
 * POST /api/client-projects/:id/portfolio-concept-ai
 * Genera (no guarda) un texto de concepto para Trabajos a partir del
 * moodboard y el planteamiento interno — nunca menciona datos
 * confidenciales. Se revisa y se guarda a mano con PUT /:id.
 */
router.post('/:id/portfolio-concept-ai', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { data: project } = await supabase.from('client_projects').select('project_name, moodboard_description, moodboard_palette, memoria_intro').eq('id', req.params.id).single();
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const paletteText = (project.moodboard_palette || []).length ? project.moodboard_palette.join(', ') : 'No hay.';

    const system = `Eres el redactor de la web de Ranuse Design, un estudio de diseño de espacios deportivos (home gyms) en España. Te paso información interna de un proyecto ya diseñado, incluida su paleta de colores (códigos hex). Escribe un texto de CONCEPTO breve (3-5 frases) para la página pública de "Trabajos" de este proyecto, en tono profesional e inspirador, centrado en la idea de diseño, la paleta de colores y el resultado buscado — NUNCA menciones nombres de clientes, direcciones, precios ni ningún dato confidencial o personal, aunque aparezcan en la información que te paso. Responde solo con el texto del concepto, sin títulos ni comillas.`;
    const userMsg = `PROYECTO: ${project.project_name || '—'}\n\nDESCRIPCIÓN DE ESTILO/MOODBOARD:\n${project.moodboard_description?.trim() || 'No hay.'}\n\nPALETA DE COLORES (hex):\n${paletteText}\n\nPLANTEAMIENTO INTERNO:\n${project.memoria_intro?.trim() || 'No hay.'}`;

    const response = await callClaude({ system, messages: [{ role: 'user', content: userMsg }], maxTokens: 400 });
    const textBlock = (response.content || []).find(b => b.type === 'text');
    const concept = textBlock?.text?.trim();
    if (!concept) return res.status(502).json({ error: 'La IA no devolvió texto' });
    res.json({ concept });
  } catch (err) {
    console.error('Error al generar concepto IA:', err);
    res.status(500).json({ error: err.message || 'Error al generar el concepto' });
  }
});

/**
 * DELETE /api/client-projects/:id/renders/:renderId
 */
router.delete('/:id/renders/:renderId', authenticateToken, requireProyectos, async (req, res) => {
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
// MOODBOARD (imágenes + descripción del estilo, a nivel de proyecto entero —
// se muestra al cliente justo después del Programa de Necesidades)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/client-projects/:id/moodboard
 */
router.get('/:id/moodboard', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const [{ data: project, error: errProject }, { data: images, error: errImages }] = await Promise.all([
      supabase.from('client_projects').select('moodboard_description, moodboard_palette').eq('id', req.params.id).single(),
      supabase.from('project_moodboard_images').select('*').eq('project_id', req.params.id).order('display_order', { ascending: true }),
    ]);
    if (errProject) throw errProject;
    if (errImages) throw errImages;
    res.json({ description: project?.moodboard_description || '', palette: project?.moodboard_palette || [], images: images || [] });
  } catch (error) {
    console.error('Error al obtener moodboard:', error);
    res.status(500).json({ error: 'Error al obtener el moodboard' });
  }
});

/**
 * PUT /api/client-projects/:id/moodboard
 * Body: { description, palette }
 * palette: array de códigos hex, ej. ["#0a0a0a", "#beb0a2"]
 */
router.put('/:id/moodboard', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { description, palette } = req.body;
    const updates = {};
    if (description !== undefined) updates.moodboard_description = description?.trim() || null;
    if (palette !== undefined) updates.moodboard_palette = Array.isArray(palette) ? palette.filter(c => /^#[0-9a-fA-F]{3,8}$/.test(c)) : [];
    const { error } = await supabase
      .from('client_projects')
      .update(updates)
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Moodboard actualizado' });
  } catch (error) {
    console.error('Error al actualizar moodboard:', error);
    res.status(500).json({ error: 'Error al actualizar el moodboard' });
  }
});

/**
 * PUT /api/client-projects/:id/listados-intro
 * Texto de introducción de la sección "Listados" que ve el cliente. Si se
 * deja vacío, el cliente ve un texto genérico por defecto (definido en el
 * frontend), igual que ya pasa con el intro_text de las categorías.
 */
router.put('/:id/listados-intro', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { intro, title } = req.body;
    const updates = {};
    if (intro !== undefined) updates.listados_intro_text = intro?.trim() || null;
    if (title !== undefined) updates.listados_title = title?.trim() || null;
    const { error } = await supabase
      .from('client_projects')
      .update(updates)
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Listados actualizado' });
  } catch (error) {
    console.error('Error al actualizar la introducción de Listados:', error);
    res.status(500).json({ error: 'Error al actualizar la introducción' });
  }
});

/**
 * POST /api/client-projects/:id/moodboard/images
 * Acepta una o varias imágenes a la vez (campo "images").
 */
router.post('/:id/moodboard/images', authenticateToken, requireProyectos, uploadMoodboardImages, handleMulterError, async (req, res) => {
  try {
    const files = req.files || [];
    if (files.length === 0) return res.status(400).json({ error: 'No se recibió ninguna imagen' });

    const projectId = req.params.id;
    const { data: maxRow } = await supabase
      .from('project_moodboard_images')
      .select('display_order')
      .eq('project_id', projectId)
      .order('display_order', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    let nextOrder = (maxRow?.display_order ?? -1) + 1;

    const inserted = [];
    for (const file of files) {
      const url = await uploadMoodboardImage(file.buffer, file.originalname, file.mimetype, projectId);
      const { data, error } = await supabase
        .from('project_moodboard_images')
        .insert({ project_id: projectId, url, display_order: nextOrder })
        .select('*')
        .single();
      if (error) throw error;
      inserted.push(data);
      nextOrder += 1;
    }

    res.status(201).json({ images: inserted });
  } catch (error) {
    console.error('Error al subir imagen del moodboard:', error);
    res.status(500).json({ error: 'Error al subir la imagen' });
  }
});

/**
 * POST /api/client-projects/:id/moodboard/images/from-url
 * Añade al moodboard una imagen que ya existe en otro sitio (p.ej. tu
 * biblioteca de Referencias), sin volver a subirla — solo guarda la URL.
 * Body: { urls: [url, url, ...] }
 */
router.post('/:id/moodboard/images/from-url', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const urls = (req.body.urls || []).filter(Boolean);
    if (urls.length === 0) return res.status(400).json({ error: 'No se recibió ninguna URL' });

    const projectId = req.params.id;
    const { data: maxRow } = await supabase
      .from('project_moodboard_images')
      .select('display_order')
      .eq('project_id', projectId)
      .order('display_order', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    let nextOrder = (maxRow?.display_order ?? -1) + 1;

    const toInsert = urls.map(url => ({ project_id: projectId, url, display_order: nextOrder++ }));
    const { data, error } = await supabase.from('project_moodboard_images').insert(toInsert).select('*');
    if (error) throw error;

    res.status(201).json({ images: data });
  } catch (error) {
    console.error('Error al añadir imagen al moodboard:', error);
    res.status(500).json({ error: 'Error al añadir la imagen' });
  }
});

/**
 * PUT /api/client-projects/:id/moodboard/images/reorder
 * Body: { ids: [imageId, imageId, ...] }
 */
router.put('/:id/moodboard/images/reorder', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids debe ser un array' });
    await Promise.all(
      ids.map((imageId, index) =>
        supabase.from('project_moodboard_images').update({ display_order: index }).eq('id', imageId).eq('project_id', req.params.id)
      )
    );
    res.json({ message: 'Orden guardado' });
  } catch (error) {
    console.error('Error al reordenar moodboard:', error);
    res.status(500).json({ error: 'Error al reordenar el moodboard' });
  }
});

/**
 * DELETE /api/client-projects/:id/moodboard/images/:imageId
 */
router.delete('/:id/moodboard/images/:imageId', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { data: image, error: fetchError } = await supabase
      .from('project_moodboard_images')
      .select('url')
      .eq('id', req.params.imageId)
      .eq('project_id', req.params.id)
      .single();
    if (fetchError || !image) return res.status(404).json({ error: 'Imagen no encontrada' });

    await deleteMoodboardImage(image.url);

    const { error } = await supabase.from('project_moodboard_images').delete().eq('id', req.params.imageId);
    if (error) throw error;
    res.json({ message: 'Imagen eliminada' });
  } catch (error) {
    console.error('Error al eliminar imagen del moodboard:', error);
    res.status(500).json({ error: 'Error al eliminar la imagen' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/client-projects/:id/documents
 */
router.get('/:id/documents', authenticateToken, requireProyectos, async (req, res) => {
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
router.post('/:id/documents', authenticateToken, requireProyectos, uploadDocumentFile, handleMulterError, async (req, res) => {
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
router.delete('/:id/documents/:docId', authenticateToken, requireProyectos, async (req, res) => {
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
// PHASE DOCUMENTS (documentos con código, agrupados por fase 0-5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/client-projects/:id/phase-documents
 */
router.get('/:id/phase-documents', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('project_phase_documents')
      .select('*')
      .eq('project_id', req.params.id)
      .order('phase_number', { ascending: true })
      .order('display_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ documents: data });
  } catch (error) {
    console.error('Error al obtener documentos de fase:', error);
    res.status(500).json({ error: 'Error al obtener documentos de fase' });
  }
});

/**
 * POST /api/client-projects/:id/phase-documents
 */
router.post('/:id/phase-documents', authenticateToken, requireProyectos, uploadDocumentFile, handleMulterError, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ningún archivo' });
    }

    const { name, code, phase_number } = req.body;
    const projectId = req.params.id;

    if (!code?.trim() || phase_number === undefined || phase_number === '') {
      return res.status(400).json({ error: 'Código y fase son requeridos' });
    }

    const url = await uploadProjectDocument(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      projectId
    );

    const { data, error } = await supabase
      .from('project_phase_documents')
      .insert({
        project_id: projectId,
        phase_number: parseInt(phase_number),
        code: code.trim(),
        name: name?.trim() || req.file.originalname,
        file_url: url,
      })
      .select('*')
      .single();

    if (error) throw error;
    res.status(201).json({ document: data });
  } catch (error) {
    console.error('Error al subir documento de fase:', error);
    res.status(500).json({ error: 'Error al subir documento de fase' });
  }
});

/**
 * PUT /api/client-projects/:id/phase-documents/:docId
 */
router.put('/:id/phase-documents/:docId', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { name, code, phase_number } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (code !== undefined) updates.code = code.trim();
    if (phase_number !== undefined) updates.phase_number = parseInt(phase_number);

    const { data, error } = await supabase
      .from('project_phase_documents')
      .update(updates)
      .eq('id', req.params.docId)
      .eq('project_id', req.params.id)
      .select('*')
      .single();

    if (error) throw error;
    res.json({ document: data });
  } catch (error) {
    console.error('Error al actualizar documento de fase:', error);
    res.status(500).json({ error: 'Error al actualizar documento de fase' });
  }
});

/**
 * DELETE /api/client-projects/:id/phase-documents/:docId
 */
router.delete('/:id/phase-documents/:docId', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { data: doc, error: fetchError } = await supabase
      .from('project_phase_documents')
      .select('file_url')
      .eq('id', req.params.docId)
      .eq('project_id', req.params.id)
      .single();

    if (fetchError || !doc) {
      return res.status(404).json({ error: 'Documento no encontrado' });
    }

    await deleteProjectDocument(doc.file_url);

    const { error } = await supabase
      .from('project_phase_documents')
      .delete()
      .eq('id', req.params.docId);

    if (error) throw error;
    res.json({ message: 'Documento eliminado' });
  } catch (error) {
    console.error('Error al eliminar documento de fase:', error);
    res.status(500).json({ error: 'Error al eliminar documento de fase' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE CONTENT (texto de introducción editable por fase)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/client-projects/:id/phase-content
 */
router.get('/:id/phase-content', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('project_phase_content')
      .select('*')
      .eq('project_id', req.params.id);

    if (error) throw error;
    res.json({ content: data });
  } catch (error) {
    console.error('Error al obtener contenido de fase:', error);
    res.status(500).json({ error: 'Error al obtener contenido de fase' });
  }
});

/**
 * PUT /api/client-projects/:id/phase-content/:phaseNumber
 * Upsert del intro_text de una fase
 */
router.put('/:id/phase-content/:phaseNumber', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { intro_text } = req.body;
    const projectId = req.params.id;
    const phaseNumber = parseInt(req.params.phaseNumber);

    const { data, error } = await supabase
      .from('project_phase_content')
      .upsert(
        { project_id: projectId, phase_number: phaseNumber, intro_text: intro_text ?? '', updated_at: new Date().toISOString() },
        { onConflict: 'project_id,phase_number' }
      )
      .select('*')
      .single();

    if (error) throw error;
    res.json({ content: data });
  } catch (error) {
    console.error('Error al actualizar contenido de fase:', error);
    res.status(500).json({ error: 'Error al actualizar contenido de fase' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DIAGNOSIS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/client-projects/:id/diagnosis
 */
router.get('/:id/diagnosis', authenticateToken, requireProyectos, async (req, res) => {
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
router.put('/:id/diagnosis', authenticateToken, requireProyectos, async (req, res) => {
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
router.post('/:id/diagnosis/images', authenticateToken, requireProyectos, uploadDiagnosisImageFile, handleMulterError, async (req, res) => {
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
router.delete('/:id/diagnosis/images/:imgId', authenticateToken, requireProyectos, async (req, res) => {
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
router.put('/:id/materials/reorder', authenticateToken, requireProyectos, async (req, res) => {
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

router.get('/:id/materials', authenticateToken, requireProyectos, async (req, res) => {
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
router.post('/:id/materials', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { name, brand, category, category_type, location, notes, image_url, catalog_product_id, phase_number, category_id, code, datasheet_url, quantity, purchase_link, show_purchase_link, lumens, watts, color_temperature, color } = req.body;

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
        category_type: category_type?.trim() || 'material',
        location: location?.trim() || null,
        notes: notes?.trim() || null,
        image_url: image_url?.trim() || null,
        catalog_product_id: catalog_product_id || null,
        phase_number: phase_number != null && phase_number !== '' ? parseInt(phase_number) : null,
        category_id: category_id || null,
        code: code?.trim() || null,
        datasheet_url: datasheet_url?.trim() || null,
        quantity: quantity != null && quantity !== '' ? parseFloat(quantity) : 1,
        purchase_link: purchase_link?.trim() || null,
        show_purchase_link: !!show_purchase_link,
        lumens: lumens ? parseInt(lumens) : null,
        watts: watts ? parseFloat(watts) : null,
        color_temperature: color_temperature?.trim() || null,
        color: color?.trim() || null,
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
 * PUT /api/client-projects/:id/materials/:selId
 */
router.put('/:id/materials/:selId', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { brand, category, location, notes, phase_number, code, datasheet_url, quantity, purchase_link, show_purchase_link, lumens, watts, color_temperature, color } = req.body;

    const updates = {};
    if (brand !== undefined) updates.brand = brand?.trim() || null;
    if (category !== undefined) updates.category = category?.trim() || null;
    if (location !== undefined) updates.location = location?.trim() || null;
    if (notes !== undefined) updates.notes = notes?.trim() || null;
    if (phase_number !== undefined) updates.phase_number = phase_number != null && phase_number !== '' ? parseInt(phase_number) : null;
    if (code !== undefined) updates.code = code?.trim() || null;
    if (datasheet_url !== undefined) updates.datasheet_url = datasheet_url?.trim() || null;
    if (quantity !== undefined) updates.quantity = quantity != null && quantity !== '' ? parseFloat(quantity) : 1;
    if (purchase_link !== undefined) updates.purchase_link = purchase_link?.trim() || null;
    if (show_purchase_link !== undefined) updates.show_purchase_link = !!show_purchase_link;
    if (lumens !== undefined) updates.lumens = lumens ? parseInt(lumens) : null;
    if (watts !== undefined) updates.watts = watts ? parseFloat(watts) : null;
    if (color_temperature !== undefined) updates.color_temperature = color_temperature?.trim() || null;
    if (color !== undefined) updates.color = color?.trim() || null;

    const { data, error } = await supabase
      .from('project_material_selections')
      .update(updates)
      .eq('id', req.params.selId)
      .eq('project_id', req.params.id)
      .select('*')
      .single();

    if (error) throw error;
    res.json({ material: data });
  } catch (error) {
    console.error('Error al actualizar material:', error);
    res.status(500).json({ error: 'Error al actualizar material' });
  }
});

/**
 * DELETE /api/client-projects/:id/materials/:selId
 */
router.delete('/:id/materials/:selId', authenticateToken, requireProyectos, async (req, res) => {
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
router.put('/:id/equipment/reorder', authenticateToken, requireProyectos, async (req, res) => {
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

router.get('/:id/equipment', authenticateToken, requireProyectos, async (req, res) => {
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
router.post('/:id/equipment', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { name, brand, category, category_type, quantity, color, notes, catalog_product_id, image_url, purchase_link, show_purchase_link, show_quantity, phase_number, category_id, code, datasheet_url, location, lumens, watts, color_temperature } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'El nombre del equipo es requerido' });
    }

    // Si viene de un producto del catálogo y no se indica enlace propio, se hereda el suyo
    let resolvedLink = purchase_link?.trim() || null;
    if (!resolvedLink && catalog_product_id) {
      const { data: catalogProduct } = await supabase
        .from('catalog_products')
        .select('link')
        .eq('id', catalog_product_id)
        .single();
      resolvedLink = catalogProduct?.link || null;
    }

    const { data, error } = await supabase
      .from('project_equipment_selections')
      .insert({
        project_id: req.params.id,
        name: name.trim(),
        brand: brand?.trim() || null,
        category: category?.trim() || null,
        category_type: category_type?.trim() || 'mobiliario',
        quantity: quantity != null ? parseInt(quantity) : 1,
        color: color?.trim() || null,
        notes: notes?.trim() || null,
        catalog_product_id: catalog_product_id || null,
        image_url: image_url?.trim() || null,
        purchase_link: resolvedLink,
        show_purchase_link: show_purchase_link === true,
        show_quantity: show_quantity !== undefined ? show_quantity === true : true,
        phase_number: phase_number != null && phase_number !== '' ? parseInt(phase_number) : null,
        category_id: category_id || null,
        code: code?.trim() || null,
        datasheet_url: datasheet_url?.trim() || null,
        location: location?.trim() || null,
        lumens: lumens ? parseInt(lumens) : null,
        watts: watts ? parseFloat(watts) : null,
        color_temperature: color_temperature?.trim() || null,
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
router.delete('/:id/equipment/:selId', authenticateToken, requireProyectos, async (req, res) => {
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
router.get('/:id/tours', authenticateToken, requireProyectos, async (req, res) => {
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
router.post('/:id/tours', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { name, url, phase_number } = req.body;
    if (!name?.trim() || !url?.trim()) {
      return res.status(400).json({ error: 'Nombre y URL son requeridos' });
    }
    const { data, error } = await supabase
      .from('project_tours')
      .insert({
        project_id: req.params.id,
        name: name.trim(),
        url: url.trim(),
        phase_number: phase_number != null && phase_number !== '' ? parseInt(phase_number) : null,
      })
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
router.put('/:id/tours/:tourId', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { name, url, phase_number } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (url !== undefined) updates.url = url.trim();
    if (phase_number !== undefined) updates.phase_number = phase_number != null && phase_number !== '' ? parseInt(phase_number) : null;

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
router.delete('/:id/tours/:tourId', authenticateToken, requireProyectos, async (req, res) => {
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
router.get('/:id/notes', authenticateToken, requireProyectos, async (req, res) => {
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
router.post('/:id/notes', authenticateToken, requireProyectos, async (req, res) => {
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
router.delete('/:id/notes/:noteId', authenticateToken, requireProyectos, async (req, res) => {
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
router.put('/:id/equipment/:selId', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { quantity, youtube_url, extra_images, purchase_link, show_purchase_link, show_quantity, phase_number, code, datasheet_url, location, lumens, watts, color_temperature, color } = req.body;

    const updates = {};
    if (quantity !== undefined) updates.quantity = parseInt(quantity);
    if (youtube_url !== undefined) updates.youtube_url = youtube_url?.trim() || null;
    if (extra_images !== undefined) updates.extra_images = Array.isArray(extra_images) ? extra_images : [];
    if (purchase_link !== undefined) updates.purchase_link = purchase_link?.trim() || null;
    if (show_purchase_link !== undefined) updates.show_purchase_link = show_purchase_link === true;
    if (show_quantity !== undefined) updates.show_quantity = show_quantity === true;
    if (phase_number !== undefined) updates.phase_number = phase_number != null && phase_number !== '' ? parseInt(phase_number) : null;
    if (code !== undefined) updates.code = code?.trim() || null;
    if (datasheet_url !== undefined) updates.datasheet_url = datasheet_url?.trim() || null;
    if (location !== undefined) updates.location = location?.trim() || null;
    if (lumens !== undefined) updates.lumens = lumens ? parseInt(lumens) : null;
    if (watts !== undefined) updates.watts = watts ? parseFloat(watts) : null;
    if (color_temperature !== undefined) updates.color_temperature = color_temperature?.trim() || null;
    if (color !== undefined) updates.color = color?.trim() || null;

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
router.get('/:id/pdf-materiales', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { data: project, error } = await supabase
      .from('client_projects')
      .select('*, responsible:employees!responsible_id(name)')
      .eq('id', req.params.id)
      .single();
    if (error || !project) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const [matsRes, equipRes] = await Promise.all([
      supabase.from('project_material_selections').select('*').eq('project_id', req.params.id).order('display_order', { ascending: true, nullsFirst: false }),
      supabase.from('project_equipment_selections').select('*').eq('project_id', req.params.id).order('display_order', { ascending: true, nullsFirst: false }),
    ]);

    const materials = matsRes.data || [];
    const equipment = equipRes.data || [];

    const PDFDocument = (await import('pdfkit')).default;
    const https = await import('https');
    const http = await import('http');
    const path = await import('path');
    const { fileURLToPath } = await import('url');

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    function fetchBuf(url) {
      return new Promise((resolve) => {
        try {
          const urlObj = new URL(url);
          const client = urlObj.protocol === 'https:' ? https.default : http.default;
          const req2 = client.get(url, { timeout: 5000 }, (r) => {
            if (r.statusCode !== 200) { resolve(null); return; }
            const chunks = [];
            r.on('data', c => chunks.push(c));
            r.on('end', () => resolve(Buffer.concat(chunks)));
            r.on('error', () => resolve(null));
          });
          req2.on('error', () => resolve(null));
          req2.on('timeout', () => { req2.destroy(); resolve(null); });
        } catch { resolve(null); }
      });
    }

    const BRAND = {
      primary: '#beb0a2', dark: '#0a0a0a',
      contact: 'Víctor Palomo Díaz', name: 'Ranuse Design',
      address: 'Calle de la Constitución 100, 2ºC', city: 'Alcobendas, 28100 Madrid',
      nif: '53853605W', phone: '657 589 503', email: 'victor.palomo@ranusedesign.com',
    };

    const doc = new PDFDocument({ margin: 0, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="materiales-' + project.client_name.replace(/\s+/g, '-') + '.pdf"');
    doc.pipe(res);

    const W = 595, H = 842, margin = 45;
    const dateStr = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
    const logoPath = path.join(__dirname, '..', 'Icono Blanco.png');

    // HEADER
    doc.rect(0, 0, W, 70).fill(BRAND.dark);
    try { doc.image(logoPath, margin, 12, { height: 46 }); } catch {}
    doc.fillColor('#999999').fontSize(8).font('Helvetica').text('LISTA DE MATERIALES', 0, 14, { align: 'right', width: W - margin });
    doc.fillColor('#ffffff').fontSize(11).font('Helvetica-Bold').text(project.client_name, 0, 27, { align: 'right', width: W - margin });
    doc.fillColor('#999999').fontSize(8).font('Helvetica').text(project.project_name + '  ·  ' + dateStr, 0, 44, { align: 'right', width: W - margin });

    let y = 90;

    const drawSection = async (title, items, showQty) => {
      if (items.length === 0) return;

      if (y > H - 100) { doc.addPage(); y = margin; }

      // Section title
      doc.rect(margin, y, W - margin * 2, 22).fill('#f5f3f0');
      doc.fillColor(BRAND.dark).fontSize(8).font('Helvetica-Bold').text(title.toUpperCase(), margin + 8, y + 7);
      y += 28;

      for (const item of items) {
        const imgH = 42;
        const rowH = imgH + 12;

        if (y + rowH > H - 60) { doc.addPage(); y = margin; }

        if (items.indexOf(item) % 2 === 1) doc.rect(margin, y, W - margin * 2, rowH).fill('#faf9f8');

        // Image
        const imgX = margin + 8;
        if (item.image_url) {
          const buf = await fetchBuf(item.image_url);
          if (buf) { try { doc.image(buf, imgX, y + 6, { width: imgH, height: imgH, cover: [imgH, imgH] }); } catch {} }
        } else {
          doc.rect(imgX, y + 6, imgH, imgH).fill('#eeeeee');
        }

        // Info
        const textX = imgX + imgH + 10;
        const textW = W - margin - textX - (showQty ? 80 : 20);
        doc.fillColor(BRAND.dark).fontSize(9).font('Helvetica-Bold').text(item.name, textX, y + 10, { width: textW, lineBreak: false });
        let subY = y + 22;
        if (item.brand) { doc.fillColor('#777777').fontSize(8).font('Helvetica').text(item.brand, textX, subY, { width: textW }); subY += 11; }
        if (item.category) { doc.fillColor('#aaaaaa').fontSize(7.5).font('Helvetica').text(item.category, textX, subY, { width: textW }); }

        // Quantity
        if (showQty) {
          const qty = item.quantity || 1;
          doc.fillColor(BRAND.primary).fontSize(11).font('Helvetica-Bold').text('x' + qty, W - margin - 70, y + rowH / 2 - 7, { width: 60, align: 'right' });
        }

        doc.moveTo(margin, y + rowH).lineTo(W - margin, y + rowH).strokeColor('#eeeeee').lineWidth(0.3).stroke();
        y += rowH;
      }
      y += 12;
    };

    await drawSection('Materiales', materials, false);
    await drawSection('Mobiliario y Equipamiento', equipment, true);

    // FOOTER
    doc.rect(0, H - 42, W, 42).fill(BRAND.dark);
    try { doc.image(logoPath, W / 2 - 15, H - 36, { height: 24 }); } catch {}

    doc.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: 'Error al generar PDF' });
  }
});
export default router;
