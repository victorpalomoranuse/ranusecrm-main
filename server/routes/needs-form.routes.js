import express from 'express';
import PDFDocument from 'pdfkit';
import https from 'https';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';
import { uploadDiagnosisImageFile, uploadDocumentFile, handleMulterError } from '../middleware/upload.middleware.js';
import { uploadDiagnosisImage, deleteDiagnosisImage, uploadProjectDocument, deleteProjectDocument } from '../utils/storage.js';
import { callClaude } from '../utils/anthropic.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const requireProyectos = requirePermission('proyectos');
const router = express.Router();

const BRAND = { dark: '#0a0a0a', primary: '#beb0a2' };

function fetchImageBuffer(url) {
  return new Promise((resolve) => {
    try {
      const client = new URL(url).protocol === 'https:' ? https : http;
      const req = client.get(url, { timeout: 5000 }, (res) => {
        if (res.statusCode !== 200) { resolve(null); return; }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', () => resolve(null));
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    } catch { resolve(null); }
  });
}

function formatAnswer(question, value, productsById, referencesById) {
  if (value == null || value === '') return '—';
  switch (question.question_type) {
    case 'si_no': return value === true || value === 'si' ? 'Sí' : 'No';
    case 'opcion_multiple': return Array.isArray(value) ? value.join(', ') : String(value);
    case 'catalogo_productos':
      if (!Array.isArray(value) || !value.length) return '—';
      return value.map(id => productsById[id]?.name).filter(Boolean).join(', ') || '—';
    case 'estilo_imagenes':
      if (!Array.isArray(value) || !value.length) return '—';
      return value.map(id => referencesById[id]?.title).filter(Boolean).join(', ') || '—';
    default:
      return String(value);
  }
}

async function generateNeedsPdf(res, project, bundle) {
  const { form, questions, answers, measurements, photos } = bundle;
  const answerByQuestion = {};
  answers.forEach(a => { answerByQuestion[a.question_id] = a.answer_value; });

  // Resolver nombres de productos de catálogo y referencias de estilo mencionados
  const productIds = new Set(), referenceIds = new Set();
  questions.forEach(q => {
    const val = answerByQuestion[q.id];
    if (!Array.isArray(val)) return;
    if (q.question_type === 'catalogo_productos') val.forEach(id => productIds.add(id));
    if (q.question_type === 'estilo_imagenes') val.forEach(id => referenceIds.add(id));
  });
  const [{ data: products }, { data: references }] = await Promise.all([
    productIds.size ? supabase.from('catalog_products').select('id, name, photo_url').in('id', [...productIds]) : { data: [] },
    referenceIds.size ? supabase.from('inspiration_references').select('id, title, image_url').in('id', [...referenceIds]) : { data: [] },
  ]);
  const productsById = Object.fromEntries((products || []).map(p => [p.id, p]));
  const referencesById = Object.fromEntries((references || []).map(r => [r.id, r]));

  const W = 595, H = 842, margin = 45;
  const logoPath = path.join(__dirname, '..', 'Icono Blanco.png');
  const dateStr = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });

  const doc = new PDFDocument({ margin: 0, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="programa-necesidades-${(project.project_name || 'proyecto').replace(/\s+/g, '-')}.pdf"`);
  doc.pipe(res);

  const ensureSpace = (need) => { if (doc.y > H - margin - need) { doc.addPage(); doc.y = margin; } };

  doc.rect(0, 0, W, 70).fill(BRAND.dark);
  try { doc.image(logoPath, margin, 12, { height: 46 }); } catch {}
  doc.fillColor('#999999').fontSize(8).font('Helvetica').text('PROGRAMA DE NECESIDADES', 0, 14, { align: 'right', width: W - margin });
  doc.fillColor('#ffffff').fontSize(13).font('Helvetica-Bold').text(project.project_name || '', 0, 27, { align: 'right', width: W - margin });
  doc.fillColor('#999999').fontSize(8).font('Helvetica').text(dateStr, 0, 46, { align: 'right', width: W - margin });

  doc.y = 90;
  doc.fillColor('#777777').fontSize(8.5).font('Helvetica').text(`Cliente: ${project.client_name || '—'}   ·   Rellenado por: ${form.filled_by_name || '—'} (${form.filled_by_role === 'cliente' ? 'cliente' : form.filled_by_role === 'comercial' ? 'comercial' : 'sin enviar'})`, margin, doc.y);
  doc.moveDown(1.2);

  // Mediciones
  if (measurements.length) {
    ensureSpace(30);
    doc.fillColor(BRAND.dark).fontSize(11).font('Helvetica-Bold').text('Mediciones', margin, doc.y);
    doc.moveDown(0.4);
    measurements.forEach(m => {
      ensureSpace(16);
      const dims = [m.largo, m.ancho, m.alto].filter(v => v != null).length ? `${m.largo ?? '—'} × ${m.ancho ?? '—'} × ${m.alto ?? '—'} m` : '';
      doc.fillColor(BRAND.dark).fontSize(9).font('Helvetica-Bold').text(m.space_name, margin, doc.y, { continued: !!dims, width: 200 });
      if (dims) doc.font('Helvetica').fillColor('#666666').text('  ' + dims);
      if (m.notes) { doc.fontSize(8).fillColor('#888888').font('Helvetica').text(m.notes, margin + 8); }
      doc.moveDown(0.3);
    });
    doc.moveDown(0.6);
  }

  // Fotos del estado actual
  if (photos.length) {
    ensureSpace(100);
    doc.fillColor(BRAND.dark).fontSize(11).font('Helvetica-Bold').text('Fotos del estado actual', margin, doc.y);
    doc.moveDown(0.4);
    const thumb = 100, gap = 10;
    let x = margin, rowH = 0;
    for (const p of photos) {
      if (x + thumb > W - margin) { x = margin; doc.y += rowH + gap; rowH = 0; }
      ensureSpace(thumb + 20);
      const buf = await fetchImageBuffer(p.url);
      if (buf) { try { doc.image(buf, x, doc.y, { width: thumb, height: thumb, cover: [thumb, thumb] }); } catch {} }
      if (p.caption) doc.fontSize(7).fillColor('#888888').font('Helvetica').text(p.caption, x, doc.y + thumb + 2, { width: thumb });
      x += thumb + gap;
      rowH = thumb + 14;
    }
    doc.y += rowH + gap;
    doc.moveDown(0.4);
  }

  // Preguntas agrupadas por sección
  const sections = [];
  questions.forEach(q => {
    let sec = sections.find(s => s.name === (q.section || 'General'));
    if (!sec) { sec = { name: q.section || 'General', qs: [] }; sections.push(sec); }
    sec.qs.push(q);
  });

  for (const sec of sections) {
    ensureSpace(30);
    doc.fillColor(BRAND.dark).fontSize(11).font('Helvetica-Bold').text(sec.name, margin, doc.y);
    doc.moveDown(0.4);
    for (const q of sec.qs) {
      ensureSpace(28);
      doc.fillColor('#555555').fontSize(8.5).font('Helvetica-Bold').text(q.question_text, margin, doc.y, { width: W - margin * 2 });
      const text = formatAnswer(q, answerByQuestion[q.id], productsById, referencesById);
      doc.fillColor(BRAND.dark).fontSize(9).font('Helvetica').text(text, margin, doc.y + 2, { width: W - margin * 2 });
      doc.moveDown(0.5);
    }
    doc.moveDown(0.4);
  }

  doc.rect(0, H - 42, W, 42).fill(BRAND.dark);
  try { doc.image(logoPath, W / 2 - 15, H - 36, { height: 24 }); } catch {}

  doc.end();
}

async function getOrCreateForm(projectId) {
  const { data: existing } = await supabase.from('project_needs_forms').select('*').eq('project_id', projectId).maybeSingle();
  if (existing) return existing;
  const { data, error } = await supabase.from('project_needs_forms').insert({ project_id: projectId }).select('*').single();
  if (error) throw error;
  return data;
}

async function loadFormBundle(projectId) {
  const form = await getOrCreateForm(projectId);
  const [{ data: questions }, { data: answers }, { data: measurements }, { data: photos }, { data: catalogProducts }, { data: references }] = await Promise.all([
    supabase.from('needs_form_questions').select('*').order('display_order', { ascending: true }),
    supabase.from('project_needs_form_answers').select('*').eq('form_id', form.id),
    supabase.from('project_needs_form_measurements').select('*').eq('form_id', form.id).order('display_order', { ascending: true }),
    supabase.from('project_needs_form_photos').select('*').eq('form_id', form.id).order('display_order', { ascending: true }),
    supabase.from('catalog_products').select('id, name, photo_url, category_id, category:catalog_categories(type)'),
    supabase.from('inspiration_references').select('id, title, image_url, category'),
  ]);
  return {
    form, questions: questions || [], answers: answers || [], measurements: measurements || [], photos: photos || [],
    catalog_products: catalogProducts || [], references: references || [],
  };
}

async function resolveProjectIdByCode(code) {
  const { data } = await supabase.from('client_projects').select('id').eq('access_code', code.toUpperCase()).single();
  return data?.id || null;
}

async function upsertAnswers(formId, answersInput) {
  if (!Array.isArray(answersInput)) return;
  const rows = answersInput
    .filter(a => a && a.question_id)
    .map(a => ({ form_id: formId, question_id: a.question_id, answer_value: a.answer_value ?? null }));
  if (!rows.length) return;
  await supabase.from('project_needs_form_answers').upsert(rows, { onConflict: 'form_id,question_id' });
}

// ══════════════════════════════════════════════════════════════════════
// PREGUNTAS (catálogo global, solo admin)
// ══════════════════════════════════════════════════════════════════════

router.get('/questions', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { data, error } = await supabase.from('needs_form_questions').select('*').order('display_order', { ascending: true });
    if (error) throw error;
    res.json({ questions: data || [] });
  } catch (err) {
    console.error('Error al listar preguntas:', err);
    res.status(500).json({ error: 'Error al listar preguntas' });
  }
});

router.post('/questions', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { question_text, question_type, options, section } = req.body;
    if (!question_text?.trim()) return res.status(400).json({ error: 'question_text es requerido' });
    const { data: maxRow } = await supabase.from('needs_form_questions').select('display_order').order('display_order', { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await supabase.from('needs_form_questions').insert({
      question_text: question_text.trim(),
      question_type: question_type || 'texto',
      options: options || [],
      section: section?.trim() || null,
      display_order: (maxRow?.display_order ?? -1) + 1,
    }).select('*').single();
    if (error) throw error;
    res.status(201).json({ question: data });
  } catch (err) {
    console.error('Error al crear pregunta:', err);
    res.status(500).json({ error: 'Error al crear pregunta' });
  }
});

router.put('/questions/:id', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { question_text, question_type, options, section } = req.body;
    const updates = {};
    if (question_text !== undefined) updates.question_text = question_text.trim();
    if (question_type !== undefined) updates.question_type = question_type;
    if (options !== undefined) updates.options = options;
    if (section !== undefined) updates.section = section?.trim() || null;
    const { data, error } = await supabase.from('needs_form_questions').update(updates).eq('id', req.params.id).select('*').single();
    if (error) throw error;
    res.json({ question: data });
  } catch (err) {
    console.error('Error al actualizar pregunta:', err);
    res.status(500).json({ error: 'Error al actualizar pregunta' });
  }
});

router.put('/questions/reorder', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids es requerido' });
    await Promise.all(ids.map((id, index) => supabase.from('needs_form_questions').update({ display_order: index }).eq('id', id)));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al reordenar preguntas' });
  }
});

router.delete('/questions/:id', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { error } = await supabase.from('needs_form_questions').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar pregunta' });
  }
});

// ══════════════════════════════════════════════════════════════════════
// FORMULARIO — lado admin (autenticado)
// ══════════════════════════════════════════════════════════════════════

router.get('/project/:projectId', authenticateToken, requireProyectos, async (req, res) => {
  try {
    res.json(await loadFormBundle(req.params.projectId));
  } catch (err) {
    console.error('Error al cargar programa de necesidades:', err);
    res.status(500).json({ error: 'Error al cargar el formulario' });
  }
});

router.put('/project/:projectId', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const form = await getOrCreateForm(req.params.projectId);
    const { status, filled_by_role, filled_by_name, answers, admin_notes, client_summary, brief } = req.body;
    const updates = {};
    if (status !== undefined) updates.status = status;
    if (filled_by_role !== undefined) updates.filled_by_role = filled_by_role;
    if (filled_by_name !== undefined) updates.filled_by_name = filled_by_name?.trim() || null;
    if (admin_notes !== undefined) updates.admin_notes = admin_notes;
    if (client_summary !== undefined) updates.client_summary = client_summary;
    if (brief !== undefined) updates.brief = brief?.trim() || null;
    if (status === 'enviado') updates.submitted_at = new Date().toISOString();
    updates.updated_at = new Date().toISOString();

    if (answers) await upsertAnswers(form.id, answers);

    const { data, error } = await supabase.from('project_needs_forms').update(updates).eq('id', form.id).select('*').single();
    if (error) throw error;
    res.json({ form: data });
  } catch (err) {
    console.error('Error al guardar programa de necesidades:', err);
    res.status(500).json({ error: 'Error al guardar el formulario' });
  }
});

router.post('/project/:projectId/measurements', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const form = await getOrCreateForm(req.params.projectId);
    const { space_name, largo, ancho, alto, notes } = req.body;
    if (!space_name?.trim()) return res.status(400).json({ error: 'space_name es requerido' });
    const { data: maxRow } = await supabase.from('project_needs_form_measurements').select('display_order').eq('form_id', form.id).order('display_order', { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await supabase.from('project_needs_form_measurements').insert({
      form_id: form.id, space_name: space_name.trim(),
      largo: largo != null && largo !== '' ? parseFloat(largo) : null,
      ancho: ancho != null && ancho !== '' ? parseFloat(ancho) : null,
      alto: alto != null && alto !== '' ? parseFloat(alto) : null,
      notes: notes?.trim() || null,
      display_order: (maxRow?.display_order ?? -1) + 1,
    }).select('*').single();
    if (error) throw error;
    res.status(201).json({ measurement: data });
  } catch (err) {
    res.status(500).json({ error: 'Error al añadir medición' });
  }
});

router.put('/project/:projectId/measurements/:id', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { space_name, largo, ancho, alto, notes } = req.body;
    const updates = {};
    if (space_name !== undefined) updates.space_name = space_name.trim();
    if (largo !== undefined) updates.largo = largo != null && largo !== '' ? parseFloat(largo) : null;
    if (ancho !== undefined) updates.ancho = ancho != null && ancho !== '' ? parseFloat(ancho) : null;
    if (alto !== undefined) updates.alto = alto != null && alto !== '' ? parseFloat(alto) : null;
    if (notes !== undefined) updates.notes = notes?.trim() || null;
    const { data, error } = await supabase.from('project_needs_form_measurements').update(updates).eq('id', req.params.id).select('*').single();
    if (error) throw error;
    res.json({ measurement: data });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar medición' });
  }
});

router.delete('/project/:projectId/measurements/:id', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { error } = await supabase.from('project_needs_form_measurements').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar medición' });
  }
});

router.post('/project/:projectId/photos', authenticateToken, requireProyectos, uploadDiagnosisImageFile, handleMulterError, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
    const form = await getOrCreateForm(req.params.projectId);
    const url = await uploadDiagnosisImage(req.file.buffer, req.file.originalname, req.file.mimetype, req.params.projectId);
    const { data: maxRow } = await supabase.from('project_needs_form_photos').select('display_order').eq('form_id', form.id).order('display_order', { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await supabase.from('project_needs_form_photos').insert({
      form_id: form.id, url, caption: req.body.caption?.trim() || null, display_order: (maxRow?.display_order ?? -1) + 1,
    }).select('*').single();
    if (error) throw error;
    res.status(201).json({ photo: data });
  } catch (err) {
    console.error('Error al subir foto:', err);
    res.status(500).json({ error: 'Error al subir foto' });
  }
});

router.delete('/project/:projectId/photos/:id', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { data: photo } = await supabase.from('project_needs_form_photos').select('url').eq('id', req.params.id).single();
    if (photo?.url) await deleteDiagnosisImage(photo.url);
    const { error } = await supabase.from('project_needs_form_photos').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar foto' });
  }
});

// ── Plano de medición (PDF o imagen) ──────────────────────────────────
async function guardarPlanoMedicion(projectId, file) {
  const form = await getOrCreateForm(projectId);
  if (form.measurement_plan_url) await deleteProjectDocument(form.measurement_plan_url);
  const url = await uploadProjectDocument(file.buffer, file.originalname, file.mimetype, projectId);
  const { data, error } = await supabase.from('project_needs_forms').update({ measurement_plan_url: url, updated_at: new Date().toISOString() }).eq('id', form.id).select('*').single();
  if (error) throw error;
  return data;
}

async function borrarPlanoMedicion(projectId) {
  const form = await getOrCreateForm(projectId);
  if (form.measurement_plan_url) await deleteProjectDocument(form.measurement_plan_url);
  const { data, error } = await supabase.from('project_needs_forms').update({ measurement_plan_url: null, updated_at: new Date().toISOString() }).eq('id', form.id).select('*').single();
  if (error) throw error;
  return data;
}

router.post('/project/:projectId/measurement-plan', authenticateToken, requireProyectos, uploadDocumentFile, handleMulterError, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido (PDF o imagen)' });
    res.status(201).json({ form: await guardarPlanoMedicion(req.params.projectId, req.file) });
  } catch (err) {
    console.error('Error al subir plano de medición:', err);
    res.status(500).json({ error: 'Error al subir el plano' });
  }
});

router.delete('/project/:projectId/measurement-plan', authenticateToken, requireProyectos, async (req, res) => {
  try {
    res.json({ form: await borrarPlanoMedicion(req.params.projectId) });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar el plano' });
  }
});

// ── Resumen con IA (solo admin) ──────────────────────────────────────
router.post('/project/:projectId/ai-summary', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const bundle = await loadFormBundle(req.params.projectId);
    const { data: project } = await supabase.from('client_projects').select('client_name, project_name').eq('id', req.params.projectId).single();

    const productsById = {}; (bundle.catalog_products || []).forEach(p => { productsById[p.id] = p; });
    const referencesById = {}; (bundle.references || []).forEach(r => { referencesById[r.id] = r; });
    const answerByQuestion = {};
    bundle.answers.forEach(a => { answerByQuestion[a.question_id] = a.answer_value; });

    const preguntasYrespuestas = bundle.questions
      .map(q => `- ${q.question_text}: ${formatAnswer(q, answerByQuestion[q.id], productsById, referencesById)}`)
      .join('\n');
    const mediciones = (bundle.measurements || [])
      .map(m => `- ${m.space_name}: ${[m.largo, m.ancho, m.alto].filter(v => v != null).length ? `${m.largo ?? '—'} × ${m.ancho ?? '—'} × ${m.alto ?? '—'} m` : 'sin medidas'}${m.notes ? ` (${m.notes})` : ''}`)
      .join('\n') || 'Sin mediciones registradas.';
    const notas = bundle.form.admin_notes?.trim() || 'Sin notas internas.';
    const descripcionLibre = bundle.form.brief?.trim() || '';

    const system = `Eres el asistente de Ranuse Design, un estudio de diseño de espacios deportivos (home gyms) en España. Te paso el Programa de Necesidades de un cliente (sus respuestas a un formulario, las mediciones del espacio y las notas internas del diseñador). Escribe un RESUMEN breve y claro EN ESPAÑOL, en 2ª persona dirigido al cliente ("Hemos entendido que quieres..."), de 4-6 frases, que recoja qué quiere, para qué espacio, con qué prioridades y cualquier condicionante importante. No inventes nada que no esté en la información. No uses encabezados ni listas, solo un párrafo natural. Este texto es lo único que verá el cliente en su página, así que tiene que sonar cercano y profesional.`;
    const userMsg = `PROYECTO: ${project?.project_name || '—'} (cliente: ${project?.client_name || '—'})\n\n${descripcionLibre ? `DESCRIPCIÓN LIBRE DEL PROYECTO (escrita por el diseñador):\n${descripcionLibre}\n\n` : ''}RESPUESTAS DEL FORMULARIO:\n${preguntasYrespuestas || 'Sin respuestas — puede que el diseñador solo haya escrito la descripción libre de arriba.'}\n\nMEDICIONES:\n${mediciones}\n\nNOTAS INTERNAS DEL DISEÑADOR:\n${notas}`;

    const response = await callClaude({ system, messages: [{ role: 'user', content: userMsg }], maxTokens: 600 });
    const textBlock = (response.content || []).find(b => b.type === 'text');
    const resumen = textBlock?.text?.trim();
    if (!resumen) return res.status(502).json({ error: 'La IA no devolvió un resumen' });

    const { data, error } = await supabase.from('project_needs_forms').update({ client_summary: resumen, updated_at: new Date().toISOString() }).eq('id', bundle.form.id).select('*').single();
    if (error) throw error;
    res.json({ form: data, client_summary: resumen });
  } catch (err) {
    console.error('Error al generar resumen con IA:', err);
    res.status(500).json({ error: err.message || 'Error al generar el resumen' });
  }
});

// ══════════════════════════════════════════════════════════════════════
// FORMULARIO — lado cliente (público, por código de acceso)
// ══════════════════════════════════════════════════════════════════════

router.get('/public/:code', async (req, res) => {
  try {
    const projectId = await resolveProjectIdByCode(req.params.code);
    if (!projectId) return res.status(404).json({ error: 'Código no válido' });
    const bundle = await loadFormBundle(projectId);
    // admin_notes es privado del diseñador y nunca debe salir por esta ruta pública.
    const { admin_notes, ...publicForm } = bundle.form;
    res.json({ ...bundle, form: publicForm });
  } catch (err) {
    console.error('Error al cargar formulario público:', err);
    res.status(500).json({ error: 'Error al cargar el formulario' });
  }
});

router.put('/public/:code', async (req, res) => {
  try {
    const projectId = await resolveProjectIdByCode(req.params.code);
    if (!projectId) return res.status(404).json({ error: 'Código no válido' });
    const form = await getOrCreateForm(projectId);
    const { status, filled_by_name, answers } = req.body;
    const updates = { filled_by_role: 'cliente', updated_at: new Date().toISOString() };
    if (status !== undefined) updates.status = status;
    if (filled_by_name !== undefined) updates.filled_by_name = filled_by_name?.trim() || null;
    if (status === 'enviado') updates.submitted_at = new Date().toISOString();

    if (answers) await upsertAnswers(form.id, answers);

    const { data, error } = await supabase.from('project_needs_forms').update(updates).eq('id', form.id).select('*').single();
    if (error) throw error;
    const { admin_notes, ...publicForm } = data;
    res.json({ form: publicForm });
  } catch (err) {
    console.error('Error al guardar formulario público:', err);
    res.status(500).json({ error: 'Error al guardar el formulario' });
  }
});

router.post('/public/:code/measurements', async (req, res) => {
  try {
    const projectId = await resolveProjectIdByCode(req.params.code);
    if (!projectId) return res.status(404).json({ error: 'Código no válido' });
    const form = await getOrCreateForm(projectId);
    const { space_name, largo, ancho, alto, notes } = req.body;
    if (!space_name?.trim()) return res.status(400).json({ error: 'space_name es requerido' });
    const { data: maxRow } = await supabase.from('project_needs_form_measurements').select('display_order').eq('form_id', form.id).order('display_order', { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await supabase.from('project_needs_form_measurements').insert({
      form_id: form.id, space_name: space_name.trim(),
      largo: largo != null && largo !== '' ? parseFloat(largo) : null,
      ancho: ancho != null && ancho !== '' ? parseFloat(ancho) : null,
      alto: alto != null && alto !== '' ? parseFloat(alto) : null,
      notes: notes?.trim() || null,
      display_order: (maxRow?.display_order ?? -1) + 1,
    }).select('*').single();
    if (error) throw error;
    res.status(201).json({ measurement: data });
  } catch (err) {
    res.status(500).json({ error: 'Error al añadir medición' });
  }
});

router.delete('/public/:code/measurements/:id', async (req, res) => {
  try {
    const projectId = await resolveProjectIdByCode(req.params.code);
    if (!projectId) return res.status(404).json({ error: 'Código no válido' });
    const { error } = await supabase.from('project_needs_form_measurements').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar medición' });
  }
});

router.post('/public/:code/photos', uploadDiagnosisImageFile, handleMulterError, async (req, res) => {
  try {
    const projectId = await resolveProjectIdByCode(req.params.code);
    if (!projectId) return res.status(404).json({ error: 'Código no válido' });
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
    const form = await getOrCreateForm(projectId);
    const url = await uploadDiagnosisImage(req.file.buffer, req.file.originalname, req.file.mimetype, projectId);
    const { data: maxRow } = await supabase.from('project_needs_form_photos').select('display_order').eq('form_id', form.id).order('display_order', { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await supabase.from('project_needs_form_photos').insert({
      form_id: form.id, url, caption: req.body.caption?.trim() || null, display_order: (maxRow?.display_order ?? -1) + 1,
    }).select('*').single();
    if (error) throw error;
    res.status(201).json({ photo: data });
  } catch (err) {
    console.error('Error al subir foto (público):', err);
    res.status(500).json({ error: 'Error al subir foto' });
  }
});

router.delete('/public/:code/photos/:id', async (req, res) => {
  try {
    const { data: photo } = await supabase.from('project_needs_form_photos').select('url').eq('id', req.params.id).single();
    if (photo?.url) await deleteDiagnosisImage(photo.url);
    const { error } = await supabase.from('project_needs_form_photos').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar foto' });
  }
});

router.post('/public/:code/measurement-plan', uploadDocumentFile, handleMulterError, async (req, res) => {
  try {
    const projectId = await resolveProjectIdByCode(req.params.code);
    if (!projectId) return res.status(404).json({ error: 'Código no válido' });
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido (PDF o imagen)' });
    const form = await guardarPlanoMedicion(projectId, req.file);
    const { admin_notes, ...publicForm } = form;
    res.status(201).json({ form: publicForm });
  } catch (err) {
    console.error('Error al subir plano de medición (público):', err);
    res.status(500).json({ error: 'Error al subir el plano' });
  }
});

router.delete('/public/:code/measurement-plan', async (req, res) => {
  try {
    const projectId = await resolveProjectIdByCode(req.params.code);
    if (!projectId) return res.status(404).json({ error: 'Código no válido' });
    const form = await borrarPlanoMedicion(projectId);
    const { admin_notes, ...publicForm } = form;
    res.json({ form: publicForm });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar el plano' });
  }
});

router.get('/project/:projectId/pdf', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const { data: project } = await supabase.from('client_projects').select('project_name, client_name').eq('id', req.params.projectId).single();
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const bundle = await loadFormBundle(req.params.projectId);
    await generateNeedsPdf(res, project, bundle);
  } catch (err) {
    console.error('Error al generar PDF:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Error al generar PDF' });
  }
});

router.get('/public/:code/pdf', async (req, res) => {
  try {
    const { data: project } = await supabase.from('client_projects').select('id, project_name, client_name').eq('access_code', req.params.code.toUpperCase()).single();
    if (!project) return res.status(404).json({ error: 'Código no válido' });
    const bundle = await loadFormBundle(project.id);
    await generateNeedsPdf(res, project, bundle);
  } catch (err) {
    console.error('Error al generar PDF público:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Error al generar PDF' });
  }
});

export default router;
