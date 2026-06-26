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
    const { data, error } = await supabase.from('leads_cualificados').insert(payload).select().single();
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
    const { data, error } = await supabase.from('leads_cualificados').update(updates).eq('id', req.params.id).select().single();
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
    const { data, error } = await supabase.from('lc_renders').select('*').eq('lc_id', req.params.id).order('display_order', { ascending: true });
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
    const { data, error } = await supabase.from('lc_renders').insert({ lc_id: req.params.id, name: name || file.originalname, version: version || null, url, display_order }).select().single();
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
    const { data, error } = await supabase.from('lc_documents').select('*').eq('lc_id', req.params.id).order('created_at', { ascending: false });
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
    const { data, error } = await supabase.from('lc_documents').insert({ lc_id: req.params.id, name: name || file.originalname, doc_type: doc_type || 'otro', url }).select().single();
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
    const { data, error } = await supabase.from('lc_tours').select('*').eq('lc_id', req.params.id).order('created_at', { ascending: true });
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
    const { data, error } = await supabase.from('lc_tours').insert({ lc_id: req.params.id, name, url }).select().single();
    if (error) throw error;
    res.status(201).json({ tour: data });
  } catch (error) {
    res.status(500).json({ error: 'Error al añadir tour' });
  }
});

router.put('/:id/tours/:tourId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, url } = req.body;
    const { data, error } = await supabase.from('lc_tours').update({ name, url }).eq('id', req.params.tourId).select().single();
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
    const { data, error } = await supabase.from('lc_notes').select('*').eq('lc_id', req.params.id).order('created_at', { ascending: false });
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
    const { data, error } = await supabase.from('lc_notes').insert({ lc_id: req.params.id, content: content.trim() }).select().single();
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

// ── Materiales ────────────────────────────────────────────────────────

router.get('/:id/materials', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from('lc_material_selections').select('*').eq('lc_id', req.params.id).order('display_order', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ materials: data });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener materiales' });
  }
});

router.post('/:id/materials', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, brand, category, notes, image_url, catalog_product_id } = req.body;
    if (!name) return res.status(400).json({ error: 'El nombre es requerido' });
    const { data, error } = await supabase.from('lc_material_selections').insert({ lc_id: req.params.id, name: name.trim(), brand: brand || null, category: category || null, notes: notes || null, image_url: image_url || null, catalog_product_id: catalog_product_id || null }).select().single();
    if (error) throw error;
    res.status(201).json({ material: data });
  } catch (error) {
    res.status(500).json({ error: 'Error al crear material' });
  }
});

router.put('/:id/materials/reorder', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { ids } = req.body;
    await Promise.all(ids.map((sid, i) => supabase.from('lc_material_selections').update({ display_order: i }).eq('id', sid)));
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al reordenar' });
  }
});

router.delete('/:id/materials/:selId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await supabase.from('lc_material_selections').delete().eq('id', req.params.selId);
    res.json({ message: 'Material eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar material' });
  }
});

// ── Equipamiento ──────────────────────────────────────────────────────

router.get('/:id/equipment', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from('lc_equipment_selections').select('*').eq('lc_id', req.params.id).order('display_order', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ equipment: data });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener equipamiento' });
  }
});

router.post('/:id/equipment', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, brand, category, quantity, notes, image_url, catalog_product_id } = req.body;
    if (!name) return res.status(400).json({ error: 'El nombre es requerido' });
    const { data, error } = await supabase.from('lc_equipment_selections').insert({ lc_id: req.params.id, name: name.trim(), brand: brand || null, category: category || null, quantity: quantity ? parseInt(quantity) : 1, notes: notes || null, image_url: image_url || null, catalog_product_id: catalog_product_id || null, extra_images: [] }).select().single();
    if (error) throw error;
    res.status(201).json({ equipment: data });
  } catch (error) {
    res.status(500).json({ error: 'Error al crear equipamiento' });
  }
});

router.put('/:id/equipment/reorder', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { ids } = req.body;
    await Promise.all(ids.map((sid, i) => supabase.from('lc_equipment_selections').update({ display_order: i }).eq('id', sid)));
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al reordenar' });
  }
});

router.put('/:id/equipment/:selId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { quantity, youtube_url, extra_images } = req.body;
    const updates = {};
    if (quantity !== undefined) updates.quantity = parseInt(quantity);
    if (youtube_url !== undefined) updates.youtube_url = youtube_url || null;
    if (extra_images !== undefined) updates.extra_images = Array.isArray(extra_images) ? extra_images : [];
    const { data, error } = await supabase.from('lc_equipment_selections').update(updates).eq('id', req.params.selId).select().single();
    if (error) throw error;
    res.json({ equipment: data });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar equipamiento' });
  }
});

router.delete('/:id/equipment/:selId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await supabase.from('lc_equipment_selections').delete().eq('id', req.params.selId);
    res.json({ message: 'Equipamiento eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar equipamiento' });
  }
});

// ── PDF Materiales ────────────────────────────────────────────────────

router.get('/:id/pdf-materiales', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { data: lead, error } = await supabase.from('leads_cualificados').select('*').eq('id', req.params.id).single();
    if (error || !lead) return res.status(404).json({ error: 'Lead no encontrado' });

    const [matsRes, equipRes] = await Promise.all([
      supabase.from('lc_material_selections').select('*').eq('lc_id', req.params.id).order('display_order', { ascending: true, nullsFirst: false }),
      supabase.from('lc_equipment_selections').select('*').eq('lc_id', req.params.id).order('display_order', { ascending: true, nullsFirst: false }),
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
      name: 'Ranuse Design',
      email: 'victor.palomo@ranusedesign.com',
    };

    const doc = new PDFDocument({ margin: 0, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="materiales-${lead.nombre.replace(/\s+/g, '-')}.pdf"`);
    doc.pipe(res);

    const W = 595, H = 842, margin = 45;
    const dateStr = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
    const logoPath = path.join(__dirname, '..', 'Icono Blanco.png');

    // HEADER
    doc.rect(0, 0, W, 70).fill(BRAND.dark);
    try { doc.image(logoPath, margin, 12, { height: 46 }); } catch {}
    doc.fillColor('#999999').fontSize(8).font('Helvetica').text('PROPUESTA DE MATERIALES', 0, 14, { align: 'right', width: W - margin });
    doc.fillColor('#ffffff').fontSize(11).font('Helvetica-Bold').text(lead.nombre, 0, 27, { align: 'right', width: W - margin });
    const sub = [lead.ubicacion_ciudad, lead.tipo_espacio, lead.metros_cuadrados ? `${lead.metros_cuadrados}m²` : null].filter(Boolean).join(' · ');
    if (sub) doc.fillColor('#999999').fontSize(8).font('Helvetica').text(sub + '  ·  ' + dateStr, 0, 44, { align: 'right', width: W - margin });
    else doc.fillColor('#999999').fontSize(8).font('Helvetica').text(dateStr, 0, 44, { align: 'right', width: W - margin });

    let y = 90;

    const drawSection = async (title, items, showQty) => {
      if (items.length === 0) return;
      if (y > H - 100) { doc.addPage(); y = margin; }
      doc.rect(margin, y, W - margin * 2, 22).fill('#f5f3f0');
      doc.fillColor(BRAND.dark).fontSize(8).font('Helvetica-Bold').text(title.toUpperCase(), margin + 8, y + 7);
      y += 28;

      for (const item of items) {
        const imgH = 42;
        const rowH = imgH + 12;
        if (y + rowH > H - 60) { doc.addPage(); y = margin; }
        if (items.indexOf(item) % 2 === 1) doc.rect(margin, y, W - margin * 2, rowH).fill('#faf9f8');
        const imgX = margin + 8;
        if (item.image_url) {
          const buf = await fetchBuf(item.image_url);
          if (buf) { try { doc.image(buf, imgX, y + 6, { width: imgH, height: imgH, cover: [imgH, imgH] }); } catch {} }
        } else {
          doc.rect(imgX, y + 6, imgH, imgH).fill('#eeeeee');
        }
        const textX = imgX + imgH + 10;
        const textW = W - margin - textX - (showQty ? 80 : 20);
        doc.fillColor(BRAND.dark).fontSize(9).font('Helvetica-Bold').text(item.name, textX, y + 10, { width: textW, lineBreak: false });
        let subY = y + 22;
        if (item.brand) { doc.fillColor('#777777').fontSize(8).font('Helvetica').text(item.brand, textX, subY, { width: textW }); subY += 11; }
        if (item.category) { doc.fillColor('#aaaaaa').fontSize(7.5).font('Helvetica').text(item.category, textX, subY, { width: textW }); }
        if (showQty) {
          doc.fillColor(BRAND.primary).fontSize(11).font('Helvetica-Bold').text('x' + (item.quantity || 1), W - margin - 70, y + rowH / 2 - 7, { width: 60, align: 'right' });
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

// ── Conversión a Proyecto ─────────────────────────────────────────────

router.post('/:id/convert', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { data: lead, error: leadErr } = await supabase
      .from('leads_cualificados')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (leadErr || !lead) return res.status(404).json({ error: 'Lead no encontrado' });

    // Generar access_code único desde nombre
    const base = (lead.nombre || 'LC').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6);
    let access_code = base;
    let suffix = 1;
    while (true) {
      const { data: existing } = await supabase.from('client_projects').select('id').eq('access_code', access_code).single();
      if (!existing) break;
      access_code = base + String(suffix++);
    }

    // Crear proyecto en client_projects
    console.log('[convert] Creando proyecto para lead:', lead.nombre, 'access_code:', access_code);
    const { data: project, error: projErr } = await supabase
      .from('client_projects')
      .insert({
        client_name: lead.nombre.trim(),
        project_name: lead.ubicacion_ciudad ? `Gym ${lead.ubicacion_ciudad}` : 'Home Gym',
        client_email: lead.email || null,
        access_code,
        phase: 1,
        urgency: 'normal',
        notes: lead.notas_internas || null,
      })
      .select()
      .single();
    console.log('[convert] proyecto creado:', project?.id, 'error:', projErr?.message);
    if (projErr) throw projErr;

    // Migrar equipamiento del lead al proyecto
    const [matsRes, equipRes] = await Promise.all([
      supabase.from('lc_material_selections').select('*').eq('lc_id', req.params.id),
      supabase.from('lc_equipment_selections').select('*').eq('lc_id', req.params.id),
    ]);

    const matsToInsert = (matsRes.data || []).map(m => ({
      project_id: project.id,
      name: m.name,
      brand: m.brand || null,
      category: m.category || null,
      notes: m.notes || null,
      image_url: m.image_url || null,
      catalog_product_id: m.catalog_product_id || null,
    }));
    const equipToInsert = (equipRes.data || []).map(e => ({
      project_id: project.id,
      name: e.name,
      brand: e.brand || null,
      category: e.category || null,
      quantity: e.quantity || 1,
      notes: e.notes || null,
      image_url: e.image_url || null,
      catalog_product_id: e.catalog_product_id || null,
    }));

    if (matsToInsert.length > 0) await supabase.from('project_material_selections').insert(matsToInsert);
    if (equipToInsert.length > 0) await supabase.from('project_equipment_selections').insert(equipToInsert);

    // Marcar lead como convertido
    const { data: updatedLead } = await supabase
      .from('leads_cualificados')
      .update({ estado: 'convertido' })
      .eq('id', req.params.id)
      .select()
      .single();

    res.status(201).json({ project, lead: updatedLead });
  } catch (err) {
    console.error('Error al convertir lead:', err);
    res.status(500).json({ error: 'Error al convertir lead en proyecto' });
  }
});

export default router;
