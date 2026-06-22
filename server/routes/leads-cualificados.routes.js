import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.middleware.js';
import { uploadRenderFile, uploadDocumentFile, handleMulterError } from '../middleware/upload.middleware.js';
import { uploadLcRender, deleteLcRender, uploadLcDocument, deleteLcDocument } from '../utils/storage.js';

const router = express.Router();

// ── CRUD Principal ────────────────────────────────────────────────────

router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('leads_cualificados')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ leads: data });
  } catch (error) {
    res.status(500).json({ error: 'Error al listar leads cualificados' });
  }
});

router.get('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('leads_cualificados')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error || !data) return res.status(404).json({ error: 'No encontrado' });
    res.json({ lead: data });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener lead cualificado' });
  }
});

router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { nombre } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es requerido' });

    const payload = { ...req.body, created_by: req.user.id };
    if (payload.inversion_min) payload.inversion_min = parseFloat(payload.inversion_min);
    if (payload.inversion_max) payload.inversion_max = parseFloat(payload.inversion_max);
    if (payload.metros_cuadrados) payload.metros_cuadrados = parseFloat(payload.metros_cuadrados);

    const { data, error } = await supabase
      .from('leads_cualificados')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ message: 'Ficha creada exitosamente', lead: data });
  } catch (error) {
    console.error('Error al crear lead cualificado:', error);
    res.status(500).json({ error: 'Error al crear lead cualificado' });
  }
});

router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.id; delete updates.created_at; delete updates.created_by;
    if (updates.inversion_min !== undefined && updates.inversion_min !== '') updates.inversion_min = parseFloat(updates.inversion_min);
    if (updates.inversion_max !== undefined && updates.inversion_max !== '') updates.inversion_max = parseFloat(updates.inversion_max);
    if (updates.metros_cuadrados !== undefined && updates.metros_cuadrados !== '') updates.metros_cuadrados = parseFloat(updates.metros_cuadrados);

    const { data, error } = await supabase
      .from('leads_cualificados')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ message: 'Ficha actualizada', lead: data });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar lead cualificado' });
  }
});

router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase.from('leads_cualificados').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Ficha eliminada' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar lead cualificado' });
  }
});

// ── Renders ───────────────────────────────────────────────────────────

router.get('/:id/renders', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('lc_renders')
      .select('*')
      .eq('lc_id', req.params.id)
      .order('display_order', { ascending: true });
    if (error) throw error;
    res.json({ renders: data });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener renders' });
  }
});

router.post('/:id/renders', authenticateToken, requireAdmin, uploadRenderFile, handleMulterError, async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No se envió ningún archivo' });

    const { name, version } = req.body;
    const url = await uploadLcRender(file.buffer, file.originalname, file.mimetype, req.params.id);

    const { data: existing } = await supabase.from('lc_renders').select('id').eq('lc_id', req.params.id);
    const display_order = existing?.length || 0;

    const { data, error } = await supabase
      .from('lc_renders')
      .insert({ lc_id: req.params.id, name: name || file.originalname, version: version || null, url, display_order })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ render: data });
  } catch (error) {
    console.error('Error al subir render:', error);
    res.status(500).json({ error: 'Error al subir render' });
  }
});

router.put('/:id/renders/reorder', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { ids } = req.body;
    await Promise.all(ids.map((rid, i) => supabase.from('lc_renders').update({ display_order: i }).eq('id', rid)));
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al reordenar renders' });
  }
});

router.delete('/:id/renders/:renderId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { data: render } = await supabase.from('lc_renders').select('url').eq('id', req.params.renderId).single();
    if (render) await deleteLcRender(render.url);
    await supabase.from('lc_renders').delete().eq('id', req.params.renderId);
    res.json({ message: 'Render eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar render' });
  }
});

// ── Documentos ────────────────────────────────────────────────────────

router.get('/:id/documents', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('lc_documents')
      .select('*')
      .eq('lc_id', req.params.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ documents: data });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener documentos' });
  }
});

router.post('/:id/documents', authenticateToken, requireAdmin, uploadDocumentFile, handleMulterError, async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No se envió ningún archivo' });

    const { name, doc_type } = req.body;
    const url = await uploadLcDocument(file.buffer, file.originalname, file.mimetype, req.params.id);

    const { data, error } = await supabase
      .from('lc_documents')
      .insert({ lc_id: req.params.id, name: name || file.originalname, doc_type: doc_type || 'otro', url })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ document: data });
  } catch (error) {
    res.status(500).json({ error: 'Error al subir documento' });
  }
});

router.delete('/:id/documents/:docId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { data: doc } = await supabase.from('lc_documents').select('url').eq('id', req.params.docId).single();
    if (doc) await deleteLcDocument(doc.url);
    await supabase.from('lc_documents').delete().eq('id', req.params.docId);
    res.json({ message: 'Documento eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar documento' });
  }
});

// ── Tours ─────────────────────────────────────────────────────────────

router.get('/:id/tours', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('lc_tours')
      .select('*')
      .eq('lc_id', req.params.id)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json({ tours: data });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener tours' });
  }
});

router.post('/:id/tours', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, url } = req.body;
    if (!name || !url) return res.status(400).json({ error: 'Nombre y URL son requeridos' });

    const { data, error } = await supabase
      .from('lc_tours')
      .insert({ lc_id: req.params.id, name, url })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ tour: data });
  } catch (error) {
    res.status(500).json({ error: 'Error al añadir tour' });
  }
});

router.put('/:id/tours/:tourId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, url } = req.body;
    const { data, error } = await supabase
      .from('lc_tours')
      .update({ name, url })
      .eq('id', req.params.tourId)
      .select()
      .single();
    if (error) throw error;
    res.json({ tour: data });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar tour' });
  }
});

router.delete('/:id/tours/:tourId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await supabase.from('lc_tours').delete().eq('id', req.params.tourId);
    res.json({ message: 'Tour eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar tour' });
  }
});

// ── Notas ─────────────────────────────────────────────────────────────

router.get('/:id/notes', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('lc_notes')
      .select('*')
      .eq('lc_id', req.params.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ notes: data });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener notas' });
  }
});

router.post('/:id/notes', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'El contenido es requerido' });

    const { data, error } = await supabase
      .from('lc_notes')
      .insert({ lc_id: req.params.id, content: content.trim() })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ note: data });
  } catch (error) {
    res.status(500).json({ error: 'Error al añadir nota' });
  }
});

router.delete('/:id/notes/:noteId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await supabase.from('lc_notes').delete().eq('id', req.params.noteId);
    res.json({ message: 'Nota eliminada' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar nota' });
  }
});

export default router;
