import express from 'express';
import PDFDocument from 'pdfkit';
import https from 'https';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = express.Router();
const requireProyectos = requirePermission('proyectos');

const BRAND = {
  name: 'Ranuse Design',
  contact: 'Víctor Palomo Díaz',
  phone: '657 589 503',
  email: 'victor.palomo@ranusedesign.com',
  web: 'ranusedesign.com',
  primary: '#beb0a2',
  dark: '#0a0a0a',
};
const PHASE_LABELS = { 0: 'Diseño previo', 1: 'Planos generales', 2: 'Instalaciones', 3: 'Interiorismo y materialidad', 4: 'Renders', 5: 'Maquinaria y equipamiento', 6: 'Documentación de apoyo' };
const W = 595, H = 842, M = 50;

function fetchImageBuffer(url) {
  return new Promise((resolve) => {
    try {
      const client = new URL(url).protocol === 'https:' ? https : http;
      const req = client.get(url, { timeout: 6000 }, (res) => {
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

function fmtEur(n) {
  return Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
}
function fmtAnswer(q, v) {
  if (v == null || v === '') return '—';
  if (q.question_type === 'si_no') return v === true || v === 'si' ? 'Sí' : 'No';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

function ensureSpace(doc, needed) {
  if (doc.y + needed > H - M) doc.addPage();
}
function sectionTitle(doc, text) {
  doc.addPage();
  doc.fillColor(BRAND.primary).fontSize(9).font('Helvetica-Bold').text(text.toUpperCase(), M, M, { characterSpacing: 1.5 });
  doc.moveTo(M, doc.y + 4).lineTo(W - M, doc.y + 4).strokeColor(BRAND.primary).lineWidth(0.5).stroke();
  doc.moveDown(1.2);
  doc.fillColor(BRAND.dark);
}
function paragraph(doc, text) {
  if (!text) return;
  doc.fillColor('#333333').fontSize(10).font('Helvetica').text(text, M, doc.y, { width: W - M * 2, lineGap: 3 });
  doc.moveDown(0.8);
}
function label(doc, text) {
  doc.fillColor('#888888').fontSize(7.5).font('Helvetica-Bold').text(text.toUpperCase(), M, doc.y, { characterSpacing: 1 });
  doc.moveDown(0.3);
}

// Rejilla de imágenes: cols por fila, altura fija, salto de página si hace falta.
async function imageGrid(doc, urls, { cols = 2, rowH = 150, gap = 12 } = {}) {
  const colW = (W - M * 2 - gap * (cols - 1)) / cols;
  let i = 0;
  for (const url of urls) {
    const buf = await fetchImageBuffer(url);
    const col = i % cols;
    if (col === 0) { ensureSpace(doc, rowH + gap); }
    const x = M + col * (colW + gap);
    const y = doc.y;
    if (buf) {
      try {
        doc.save();
        doc.rect(x, y, colW, rowH).clip();
        doc.image(buf, x, y, { cover: [colW, rowH] });
        doc.restore();
        doc.rect(x, y, colW, rowH).strokeColor('#e5e5e5').lineWidth(0.5).stroke();
      } catch { doc.restore(); }
    } else {
      doc.rect(x, y, colW, rowH).fillAndStroke('#f5f5f5', '#e5e5e5');
    }
    if (col === cols - 1 || i === urls.length - 1) doc.y = y + rowH + gap;
    i++;
  }
  doc.fillColor(BRAND.dark);
}

async function loadProjectData(projectId) {
  const { data: project } = await supabase.from('client_projects')
    .select('id, client_name, project_name, phase, memoria_intro, client_nif, client_city, responsible:employees!responsible_id(name, email)')
    .eq('id', projectId).single();
  if (!project) return null;

  const [
    needsForm, renders, documents, tours, moodboardImgs, materials, equipment, catalogTypes, budget,
  ] = await Promise.all([
    supabase.from('project_needs_forms').select('*').eq('project_id', projectId).maybeSingle().then(r => r.data),
    supabase.from('project_renders').select('*').eq('project_id', projectId).order('display_order', { ascending: true, nullsFirst: false }).then(r => r.data || []),
    supabase.from('project_documents').select('*').eq('project_id', projectId).order('created_at', { ascending: true }).then(r => r.data || []),
    supabase.from('project_tours').select('*').eq('project_id', projectId).order('created_at', { ascending: true }).then(r => r.data || []),
    supabase.from('project_moodboard_images').select('*').eq('project_id', projectId).order('display_order', { ascending: true }).then(r => r.data || []),
    supabase.from('project_material_selections').select('*').eq('project_id', projectId).order('display_order', { ascending: true, nullsFirst: false }).then(r => r.data || []),
    supabase.from('project_equipment_selections').select('*').eq('project_id', projectId).order('display_order', { ascending: true, nullsFirst: false }).then(r => r.data || []),
    supabase.from('catalog_types').select('name, slug, display_order').order('display_order', { ascending: true, nullsFirst: false }).then(r => r.data || []),
    supabase.from('budgets').select('*, items:budget_items(*)').eq('project_id', projectId).maybeSingle().then(r => r.data),
  ]);

  let needsQuestions = [], needsAnswers = [], needsMeasurements = [], needsPhotos = [];
  if (needsForm) {
    [needsQuestions, needsAnswers, needsMeasurements, needsPhotos] = await Promise.all([
      supabase.from('needs_form_questions').select('*').order('display_order', { ascending: true }).then(r => r.data || []),
      supabase.from('project_needs_form_answers').select('*').eq('form_id', needsForm.id).then(r => r.data || []),
      supabase.from('project_needs_form_measurements').select('*').eq('form_id', needsForm.id).order('display_order', { ascending: true }).then(r => r.data || []),
      supabase.from('project_needs_form_photos').select('*').eq('form_id', needsForm.id).order('display_order', { ascending: true }).then(r => r.data || []),
    ]);
  }

  return {
    project, needsForm, needsQuestions, needsAnswers, needsMeasurements, needsPhotos,
    renders, documents, tours, moodboardImgs, materials, equipment, catalogTypes,
    moodboardDesc: null, budget,
  };
}

/**
 * GET /api/memoria/:projectId/pdf
 * Memoria del proyecto en PDF (solo panel, permiso "proyectos").
 */
router.get('/:projectId/pdf', authenticateToken, requireProyectos, async (req, res) => {
  try {
    const data = await loadProjectData(req.params.projectId);
    if (!data) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const { project } = data;

    // moodboard_description vive en client_projects
    const { data: mbRow } = await supabase.from('client_projects').select('moodboard_description').eq('id', req.params.projectId).single();
    const moodboardDesc = mbRow?.moodboard_description || '';

    const doc = new PDFDocument({ margin: M, size: 'A4', bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="memoria-${(project.project_name || 'proyecto').replace(/[^a-zA-Z0-9-]/g, '_')}.pdf"`);
    doc.pipe(res);

    // ── PORTADA ──────────────────────────────────────────────
    doc.rect(0, 0, W, H).fill('#ffffff');
    doc.rect(0, 0, W, 8).fill(BRAND.primary);
    const logoPath = path.join(__dirname, '..', 'Icono Blanco.png');
    doc.rect(M, 120, 90, 90).fill(BRAND.dark);
    try { doc.image(logoPath, M + 18, 138, { height: 54 }); } catch {}
    doc.fillColor('#999999').fontSize(9).font('Helvetica-Bold').text('MEMORIA DE PROYECTO', M, 250, { characterSpacing: 2 });
    doc.fillColor(BRAND.dark).fontSize(26).font('Helvetica-Bold').text(project.project_name || 'Proyecto', M, 270, { width: W - M * 2 });
    doc.fillColor('#555555').fontSize(12).font('Helvetica').text(project.client_name || '', M, doc.y + 4);
    doc.moveDown(2);
    doc.fillColor('#888888').fontSize(9).font('Helvetica')
      .text(`Fase actual: ${PHASE_LABELS[project.phase] ?? project.phase ?? '—'}`, M, doc.y)
      .text(`Fecha: ${new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}`, M, doc.y + 2)
      .text(project.responsible?.name ? `Responsable: ${project.responsible.name}` : '', M, doc.y + 2);
    doc.fillColor('#aaaaaa').fontSize(8).font('Helvetica').text(`${BRAND.name}  ·  ${BRAND.contact}  ·  ${BRAND.phone}  ·  ${BRAND.email}`, M, H - M - 10, { width: W - M * 2 });

    // ── PLANTEAMIENTO Y JUSTIFICACIÓN ────────────────────────
    if (project.memoria_intro?.trim()) {
      sectionTitle(doc, 'Planteamiento y justificación');
      paragraph(doc, project.memoria_intro.trim());
    }

    // ── PROGRAMA DE NECESIDADES ──────────────────────────────
    const nfHasContent = data.needsForm && (
      data.needsForm.client_summary?.trim() || data.needsForm.brief?.trim() ||
      data.needsMeasurements.length || data.needsPhotos.length ||
      data.needsAnswers.some(a => a.answer_value != null && a.answer_value !== '' && !(Array.isArray(a.answer_value) && !a.answer_value.length))
    );
    if (nfHasContent) {
      sectionTitle(doc, 'Programa de necesidades');
      if (data.needsForm.client_summary?.trim()) {
        label(doc, 'Resumen');
        paragraph(doc, data.needsForm.client_summary.trim());
      }
      if (data.needsForm.brief?.trim()) {
        label(doc, 'Descripción del proyecto');
        paragraph(doc, data.needsForm.brief.trim());
      }
      if (data.needsMeasurements.length) {
        label(doc, 'Mediciones');
        data.needsMeasurements.forEach(m => {
          const dims = [m.largo, m.ancho, m.alto].filter(v => v != null).length ? `${m.largo ?? '—'} × ${m.ancho ?? '—'} × ${m.alto ?? '—'} m` : 'sin medidas';
          ensureSpace(doc, 16);
          doc.fillColor('#333333').fontSize(9.5).font('Helvetica').text(`${m.space_name}: ${dims}${m.notes ? ` — ${m.notes}` : ''}`, M, doc.y);
        });
        doc.moveDown(0.8);
      }
      const answered = data.needsQuestions
        .map(q => ({ q, v: data.needsAnswers.find(a => a.question_id === q.id)?.answer_value }))
        .filter(x => x.v != null && x.v !== '' && !(Array.isArray(x.v) && !x.v.length));
      if (answered.length) {
        label(doc, 'Respuestas del formulario');
        answered.forEach(({ q, v }) => {
          ensureSpace(doc, 26);
          doc.fillColor('#666666').fontSize(8.5).font('Helvetica-Bold').text(q.question_text, M, doc.y, { width: W - M * 2 });
          doc.fillColor('#333333').fontSize(9.5).font('Helvetica').text(fmtAnswer(q, v), M, doc.y + 1, { width: W - M * 2 });
          doc.moveDown(0.5);
        });
      }
      if (data.needsPhotos.length) {
        doc.moveDown(0.5);
        label(doc, 'Fotos del antes');
        await imageGrid(doc, data.needsPhotos.map(p => p.url), { cols: 3, rowH: 110 });
      }
    }

    // ── ESTILO / MOODBOARD ──────────────────────────────────
    if (moodboardDesc?.trim() || data.moodboardImgs.length) {
      sectionTitle(doc, 'Estilo y dirección de diseño');
      if (moodboardDesc?.trim()) paragraph(doc, moodboardDesc.trim());
      if (data.moodboardImgs.length) await imageGrid(doc, data.moodboardImgs.map(i => i.url), { cols: 3, rowH: 120 });
    }

    // ── RENDERS ─────────────────────────────────────────────
    if (data.renders.length) {
      sectionTitle(doc, 'Renders');
      await imageGrid(doc, data.renders.map(r => r.url), { cols: 1, rowH: 300 });
    }

    // ── LISTADO DE MATERIALES Y EQUIPAMIENTO ────────────────
    const all = [
      ...data.materials.map(m => ({ ...m, kind: 'material', type_slug: m.category_type || 'material' })),
      ...data.equipment.map(e => ({ ...e, kind: 'equipment', type_slug: e.category_type || 'mobiliario' })),
    ];
    if (all.length) {
      sectionTitle(doc, 'Listado de materiales y equipamiento');
      const typeMeta = {}; data.catalogTypes.forEach(t => { typeMeta[t.slug] = t; });
      const fallbackNames = { material: 'Materiales', mobiliario: 'Equipamiento' };
      const byType = {};
      all.forEach(it => {
        const slug = it.type_slug;
        if (!byType[slug]) byType[slug] = { name: typeMeta[slug]?.name || fallbackNames[slug] || slug, order: typeMeta[slug]?.display_order ?? 99, cats: {} };
        const cat = it.category || 'Sin categoría';
        if (!byType[slug].cats[cat]) byType[slug].cats[cat] = [];
        byType[slug].cats[cat].push(it);
      });
      Object.values(byType).sort((a, b) => a.order - b.order).forEach(tg => {
        ensureSpace(doc, 30);
        doc.fillColor(BRAND.primary).fontSize(9).font('Helvetica-Bold').text(tg.name.toUpperCase(), M, doc.y, { characterSpacing: 1 });
        doc.moveDown(0.4);
        Object.entries(tg.cats).forEach(([catName, items]) => {
          ensureSpace(doc, 20);
          doc.fillColor('#888888').fontSize(8).font('Helvetica-Bold').text(catName, M, doc.y);
          doc.moveDown(0.2);
          items.forEach(it => {
            ensureSpace(doc, 14);
            const q = it.quantity || 1;
            const line = `${it.name}${it.brand ? ` · ${it.brand}` : ''}   —   ${q} ${it.unit || 'ud'}`;
            doc.fillColor('#333333').fontSize(9).font('Helvetica').text(line, M + 8, doc.y, { width: W - M * 2 - 8 });
          });
          doc.moveDown(0.5);
        });
        doc.moveDown(0.5);
      });
    }

    // ── PRESUPUESTO (solo total) ────────────────────────────
    if (data.budget && (data.budget.items || []).length) {
      sectionTitle(doc, 'Presupuesto');
      const items = data.budget.items || [];
      const total = items.reduce((s, i) => {
        const qty = parseFloat(i.quantity) || 1;
        if ((i.pricing_mode || 'margin') === 'pvp') {
          const pvp = parseFloat(i.pvp_ref) || 0, dtoK = parseFloat(i.discount_pct) || 0;
          return s + pvp * qty * (1 - dtoK / 100);
        }
        return s + (parseFloat(i.unit_price) || 0) * qty;
      }, 0);
      const gDto = parseFloat(data.budget.global_discount_pct) || 0;
      const totalConDto = total * (1 - gDto / 100);
      doc.fillColor('#888888').fontSize(9).font('Helvetica').text(`Presupuesto ${data.budget.budget_number || ''} — ${items.length} partida(s)`, M, doc.y);
      doc.moveDown(0.5);
      doc.fillColor(BRAND.dark).fontSize(16).font('Helvetica-Bold').text(`Total estimado: ${fmtEur(totalConDto)}`, M, doc.y);
      doc.fillColor('#999999').fontSize(8).font('Helvetica').text('Importe del equipamiento y materiales, sin IVA. El presupuesto detallado se entrega aparte.', M, doc.y + 4, { width: W - M * 2 });
    }

    // ── ANEXO: DOCUMENTOS Y ENLACES ────────────────────────
    const anexo = [];
    if (data.needsForm?.measurement_plan_url) anexo.push({ label: 'Plano de medición', url: data.needsForm.measurement_plan_url });
    data.tours.forEach(t => anexo.push({ label: `Tour 3D — ${t.name}`, url: t.url }));
    data.documents.forEach(d => anexo.push({ label: `${d.name}${d.doc_type && d.doc_type !== 'otro' ? ` (${d.doc_type})` : ''}`, url: d.url }));
    if (anexo.length) {
      sectionTitle(doc, 'Anexo · documentos y enlaces');
      paragraph(doc, 'Los siguientes archivos y enlaces forman parte del proyecto y se consultan online (no se incluyen dentro de este PDF):');
      anexo.forEach(a => {
        ensureSpace(doc, 20);
        doc.fillColor(BRAND.dark).fontSize(9.5).font('Helvetica-Bold').text(a.label, M, doc.y, { continued: false });
        doc.fillColor('#2563eb').fontSize(8).font('Helvetica').text(a.url, M, doc.y + 1, { width: W - M * 2, link: a.url, underline: true });
        doc.moveDown(0.6);
      });
    }

    // ── PIE DE PÁGINA EN TODAS ──────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const oldBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0; // evita que pdfkit añada páginas al escribir en el pie
      doc.fillColor('#bbbbbb').fontSize(7).font('Helvetica')
        .text(`${BRAND.name} · ${project.project_name || ''}`, M, doc.page.height - 28, { width: W - M * 2, align: 'left', lineBreak: false });
      doc.text(`${i + 1} / ${range.count}`, M, doc.page.height - 28, { width: W - M * 2, align: 'right', lineBreak: false });
      doc.page.margins.bottom = oldBottom;
    }

    doc.end();
  } catch (err) {
    console.error('Error al generar memoria:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Error al generar la memoria' });
  }
});

export default router;
