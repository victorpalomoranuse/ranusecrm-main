import express from 'express';
import PDFDocument from 'pdfkit';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.middleware.js';

// Hojas de cálculo del CRM (tipo Excel, para listados y cuentas rápidas). Cada persona del equipo ve solo las suyas.
const router = express.Router();
router.use(authenticateToken, requireAdmin);

const MAX_BYTES = 2 * 1024 * 1024;
const fail = (res, err, msg) => { console.error(msg, err); res.status(500).json({ error: msg }); };
const sinTabla = (err) => /hojas_calculo/.test(err?.message || '');
const AVISO_SQL = 'Falta crear la tabla de hojas (SQL v79).';

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('hojas_calculo').select('id, nombre, updated_at, created_at').eq('owner_id', String(req.user.id)).order('updated_at', { ascending: false });
    if (error) return res.status(sinTabla(error) ? 409 : 500).json({ error: sinTabla(error) ? AVISO_SQL : 'No se pudieron cargar las hojas' });
    res.json({ hojas: data || [] });
  } catch (e) { fail(res, e, 'No se pudieron cargar las hojas'); }
});

router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('hojas_calculo').select('*').eq('id', req.params.id).eq('owner_id', String(req.user.id)).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Hoja no encontrada' });
    res.json({ hoja: data });
  } catch (e) { fail(res, e, 'No se pudo abrir la hoja'); }
});

router.post('/', async (req, res) => {
  try {
    const nombre = String(req.body?.nombre || 'Hoja sin título').trim().slice(0, 120) || 'Hoja sin título';
    const datos = req.body?.datos && typeof req.body.datos === 'object' ? req.body.datos : {};
    if (JSON.stringify(datos).length > MAX_BYTES) return res.status(413).json({ error: 'La hoja es demasiado grande' });
    const { data, error } = await supabase.from('hojas_calculo').insert({ nombre, datos, owner_id: String(req.user.id) }).select('*').single();
    if (error) return res.status(sinTabla(error) ? 409 : 500).json({ error: sinTabla(error) ? AVISO_SQL : 'No se pudo crear la hoja' });
    res.status(201).json({ hoja: data });
  } catch (e) { fail(res, e, 'No se pudo crear la hoja'); }
});

router.put('/:id', async (req, res) => {
  try {
    const cambios = { updated_at: new Date().toISOString() };
    if (typeof req.body?.nombre === 'string') cambios.nombre = req.body.nombre.trim().slice(0, 120) || 'Hoja sin título';
    if (req.body?.datos && typeof req.body.datos === 'object') {
      if (JSON.stringify(req.body.datos).length > MAX_BYTES) return res.status(413).json({ error: 'La hoja es demasiado grande' });
      cambios.datos = req.body.datos;
    }
    const { data, error } = await supabase.from('hojas_calculo').update(cambios).eq('id', req.params.id).eq('owner_id', String(req.user.id)).select('id, nombre, updated_at').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Hoja no encontrada' });
    res.json({ hoja: data });
  } catch (e) { fail(res, e, 'No se pudo guardar la hoja'); }
});

router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('hojas_calculo').delete().eq('id', req.params.id).eq('owner_id', String(req.user.id));
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { fail(res, e, 'No se pudo borrar la hoja'); }
});

// PDF de lo que se ve en la hoja: el navegador manda el texto ya calculado y el estilo de cada celda
router.post('/pdf', express.json({ limit: '4mb' }), (req, res) => {
  try {
    const titulo = String(req.body?.titulo || 'Hoja').slice(0, 120);
    const filas = Array.isArray(req.body?.filas) ? req.body.filas.slice(0, 2000) : [];
    const cols = Math.min(40, Math.max(1, ...filas.map(f => (Array.isArray(f) ? f.length : 0))));
    const anchosPx = Array.from({ length: cols }, (_, i) => Math.max(30, Math.min(600, Number(req.body?.anchos?.[i]) || 110)));
    if (!filas.length) return res.status(400).json({ error: 'La hoja está vacía' });
    const totalPx = anchosPx.reduce((s, a) => s + a, 0);
    const apaisado = req.body?.orientacion === 'apaisado' || (req.body?.orientacion !== 'vertical' && totalPx > 640);
    const doc = new PDFDocument({ size: 'A4', layout: apaisado ? 'landscape' : 'portrait', margin: 36, bufferPages: true });
    const W = doc.page.width, H = doc.page.height, M = 36;
    const util = W - 2 * M, escala = Math.min(1.2, util / totalPx);
    const anchos = anchosPx.map(a => a * escala);
    const fs = Math.max(6.5, Math.min(10, 9 * Math.min(1, escala * 1.1)));
    const alto = fs + 9;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="hoja.pdf"');
    doc.pipe(res);
    const cab = () => {
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#2a2622').text(titulo, M, M - 6, { width: util * 0.7, lineBreak: false, ellipsis: true });
      doc.font('Helvetica').fontSize(8).fillColor('#8f8173').text(new Date().toLocaleDateString('es-ES') + ' · Ranuse Design', M + util * 0.7, M - 4, { width: util * 0.3, align: 'right', lineBreak: false });
      return M + 18;
    };
    let y = cab();
    const color = (c, def) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : def);
    filas.forEach((fila) => {
      if (y + alto > H - M) { doc.addPage(); y = cab(); }
      let x = M;
      for (let c = 0; c < cols; c++) {
        const cel = (Array.isArray(fila) && fila[c]) || {};
        const w = anchos[c];
        const bg = color(cel.bg, null);
        if (bg) doc.rect(x, y, w, alto).fill(bg);
        if (req.body?.cuadricula !== false) doc.rect(x, y, w, alto).lineWidth(0.4).strokeColor('#d6d1ca').stroke();
        const t = cel.t == null ? '' : String(cel.t);
        if (t) {
          const fuente = cel.b && cel.i ? 'Helvetica-BoldOblique' : cel.b ? 'Helvetica-Bold' : cel.i ? 'Helvetica-Oblique' : 'Helvetica';
          doc.font(fuente).fontSize(fs).fillColor(color(cel.col, '#2a2622'));
          doc.text(t, x + 3, y + (alto - fs) / 2 - 0.5, { width: w - 6, align: cel.a === 'c' ? 'center' : cel.a === 'r' ? 'right' : 'left', lineBreak: false, ellipsis: true });
        }
        x += w;
      }
      y += alto;
    });
    doc.end();
  } catch (e) { console.error('hojas pdf:', e); if (!res.headersSent) res.status(500).json({ error: 'No se pudo crear el PDF' }); }
});

export default router;
