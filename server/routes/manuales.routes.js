import express from 'express';
import sharp from 'sharp';
import PDFDocument from 'pdfkit';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';
import { uploadReferenceImageFile, handleMulterError } from '../middleware/upload.middleware.js';
import { limpiaSpec, esquemaSvg, esquemaPdf, resumenDe, distribuye } from '../utils/esquema-planta.js';

// Manuales internos (p. ej. «Manual de diseño de home gyms»): capítulos con bloques de texto, imágenes y esquemas de distribución.
// Se guardan como JSON en el almacenamiento (crm/manuales/<id>.json) con un historial de versiones; se exportan a PDF con la imagen de marca.
const router = express.Router();
router.use(authenticateToken, requirePermission('recursos'));
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUCKET = 'project-documents', CARPETA = 'crm/manuales';
const uid = () => crypto.randomBytes(5).toString('hex');
const txt = (v, n = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const urlPublica = (p) => supabase.storage.from(BUCKET).getPublicUrl(p).data.publicUrl;
const idOk = (id) => /^[a-f0-9]{6,16}$/.test(String(id));
const rutaM = (id) => CARPETA + '/' + id + '.json';

async function leerJson(ruta) { try { const { data, error } = await supabase.storage.from(BUCKET).download(ruta); if (error || !data) return null; return JSON.parse(await data.text()); } catch { return null; } }
async function guardaJson(ruta, obj) { const { error } = await supabase.storage.from(BUCKET).upload(ruta, Buffer.from(JSON.stringify(obj)), { contentType: 'application/json', upsert: true, cacheControl: '0' }); if (error) throw error; }
const leerManual = async (id) => (idOk(id) ? leerJson(rutaM(id)) : null);

function limpiaBloque(b = {}, previo = {}) {
  const tipo = ['texto', 'imagen', 'esquema'].includes(b.tipo) ? b.tipo : 'texto', base = { id: txt(b.id, 20) || previo.id || uid(), tipo };
  if (tipo === 'texto') return { ...base, texto: String(b.texto ?? '').slice(0, 20000) };
  if (tipo === 'imagen') return { ...base, url: /^https?:\/\//.test(b.url || '') ? String(b.url).slice(0, 600) : '', pie: txt(b.pie, 200) };
  return { ...base, spec: limpiaSpec(b.spec || {}), pie: txt(b.pie, 300) };
}
function limpiaManual(b, previo) {
  return {
    titulo: txt(b.titulo, 120) || previo.titulo, subtitulo: txt(b.subtitulo, 200),
    capitulos: (Array.isArray(b.capitulos) ? b.capitulos : []).slice(0, 60).map(c => ({ id: txt(c?.id, 20) || uid(), titulo: txt(c?.titulo, 120) || 'Capítulo', bloques: (Array.isArray(c?.bloques) ? c.bloques : []).slice(0, 80).map(x => limpiaBloque(x)) })),
  };
}
// instantánea para el historial: como mucho una cada 3 minutos, y se guardan las últimas 40
async function instantanea(m, quien, forzar) {
  const lista = (await supabase.storage.from(BUCKET).list(CARPETA + '/v/' + m.id, { limit: 200, sortBy: { column: 'name', order: 'desc' } })).data || [];
  const ultima = lista[0] ? Number(String(lista[0].name).split('-')[0]) : 0;
  if (!forzar && Date.now() - ultima < 3 * 60 * 1000) return;
  await guardaJson(CARPETA + '/v/' + m.id + '/' + Date.now() + '-' + uid() + '.json', { ...m, _quien: quien || '' });
  const sobran = lista.slice(39).map(f => CARPETA + '/v/' + m.id + '/' + f.name); if (sobran.length) await supabase.storage.from(BUCKET).remove(sobran).catch(() => {});
}

router.get('/', async (req, res) => {
  try {
    const { data } = await supabase.storage.from(BUCKET).list(CARPETA, { limit: 200 });
    const lista = (await Promise.all((data || []).filter(f => /^[a-f0-9]{6,16}\.json$/.test(f.name)).map(f => leerJson(CARPETA + '/' + f.name)))).filter(Boolean)
      .map(m => ({ id: m.id, titulo: m.titulo, subtitulo: m.subtitulo || '', capitulos: m.capitulos.length, bloques: m.capitulos.reduce((n, c) => n + c.bloques.length, 0), actualizado: m.actualizado }));
    res.json({ manuales: lista.sort((a, b) => String(b.actualizado).localeCompare(String(a.actualizado))) });
  } catch { res.status(500).json({ error: 'No se pudo leer la lista' }); }
});
router.post('/', async (req, res) => {
  try {
    const m = { id: uid(), titulo: txt(req.body?.titulo, 120) || 'Manual sin título', subtitulo: '', creado: new Date().toISOString(), actualizado: new Date().toISOString(), capitulos: [{ id: uid(), titulo: 'Introducción', bloques: [] }] };
    await guardaJson(rutaM(m.id), m); res.status(201).json({ manual: m });
  } catch { res.status(500).json({ error: 'No se pudo crear el manual' }); }
});

// esquemas (sin guardar nada): SVG para la pantalla y PDF de una página para mandarlo por el asistente
router.post('/esquema/svg', (req, res) => { try { const { svg, resumen } = esquemaSvg(req.body?.spec || {}); res.json({ svg, resumen }); } catch (e) { res.status(400).json({ error: 'Esquema no válido' }); } });
async function pdfUnaPagina(titulo, spec, pie) {
  const doc = new PDFDocument({ margin: 0, size: 'A4' }), trozos = []; doc.on('data', c => trozos.push(c)); const fin = new Promise(ok => doc.on('end', ok));
  cabecera(doc, 'ESQUEMA DE DISTRIBUCIÓN', titulo); const alto = esquemaPdf(doc, spec, 40, 120, 515, 600);
  if (pie) doc.fillColor('#444').font('Helvetica').fontSize(9).text(pie, 40, 120 + alto + 6, { width: 515 });
  doc.end(); await fin; return Buffer.concat(trozos);
}
router.post('/esquema/pdf', async (req, res) => { try { res.set({ 'Content-Type': 'application/pdf' }).send(await pdfUnaPagina(txt(req.body?.titulo, 100) || 'Distribución', req.body?.spec || {}, txt(req.body?.pie, 400))); } catch (e) { console.error('esquema pdf:', e); res.status(500).json({ error: 'No se pudo crear el PDF' }); } });

router.get('/:id', async (req, res) => { const m = await leerManual(req.params.id); if (!m) return res.status(404).json({ error: 'Manual no encontrado' }); res.json({ manual: m }); });
router.put('/:id', async (req, res) => {
  try {
    const m = await leerManual(req.params.id); if (!m) return res.status(404).json({ error: 'Manual no encontrado' });
    await instantanea(m, '', false);
    Object.assign(m, limpiaManual(req.body || {}, m), { actualizado: new Date().toISOString(), editor: String(req.user?.name || req.user?.email || '').slice(0, 60) });
    await guardaJson(rutaM(m.id), m); res.json({ manual: m });
  } catch (e) { console.error('manual guarda:', e); res.status(500).json({ error: 'No se pudo guardar' }); }
});
router.delete('/:id', async (req, res) => { try { if (!idOk(req.params.id)) return res.json({ ok: true }); await supabase.storage.from(BUCKET).remove([rutaM(req.params.id)]); res.json({ ok: true }); } catch { res.status(500).json({ error: 'No se pudo borrar' }); } });

router.get('/:id/versiones', async (req, res) => {
  try {
    if (!idOk(req.params.id)) return res.json({ versiones: [] });
    const { data } = await supabase.storage.from(BUCKET).list(CARPETA + '/v/' + req.params.id, { limit: 60, sortBy: { column: 'name', order: 'desc' } });
    res.json({ versiones: (data || []).map(f => ({ id: f.name.replace(/\.json$/, ''), fecha: new Date(Number(f.name.split('-')[0])).toISOString() })) });
  } catch { res.status(500).json({ error: 'No se pudo leer el historial' }); }
});
router.post('/:id/versiones/:vid/restaurar', async (req, res) => {
  try {
    const m = await leerManual(req.params.id); if (!m || !/^[0-9]+-[a-f0-9]+$/.test(req.params.vid)) return res.status(404).json({ error: 'No encontrado' });
    const v = await leerJson(CARPETA + '/v/' + m.id + '/' + req.params.vid + '.json'); if (!v) return res.status(404).json({ error: 'Esa versión ya no existe' });
    await instantanea(m, '', true); delete v._quien; Object.assign(m, limpiaManual(v, m), { actualizado: new Date().toISOString() }); await guardaJson(rutaM(m.id), m); res.json({ manual: m });
  } catch { res.status(500).json({ error: 'No se pudo restaurar' }); }
});

router.post('/:id/imagen', uploadReferenceImageFile, handleMulterError, async (req, res) => {
  try {
    const m = await leerManual(req.params.id); if (!m) return res.status(404).json({ error: 'Manual no encontrado' }); if (!req.file) return res.status(400).json({ error: 'Falta la imagen' });
    const buf = await sharp(req.file.buffer).rotate().resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 86 }).toBuffer();
    const ruta = CARPETA + '/img/' + m.id + '/' + uid() + '.jpg'; const { error } = await supabase.storage.from(BUCKET).upload(ruta, buf, { contentType: 'image/jpeg', upsert: true }); if (error) throw error;
    res.status(201).json({ url: urlPublica(ruta) });
  } catch (e) { console.error('manual imagen:', e); res.status(500).json({ error: 'No se pudo subir la imagen' }); }
});

// ── PDF con la imagen de marca (todo el manual o solo algunos capítulos)
function cabecera(doc, arriba, titulo) {
  const W = 595, OSC = '#1e1b18'; doc.rect(0, 0, W, 62).fill(OSC);
  try { doc.image(path.join(__dirname, '..', 'Icono Blanco.png'), 40, 12, { height: 38 }); } catch { /* sin logo */ }
  doc.fillColor('#9a948d').fontSize(8).font('Helvetica').text(arriba, 0, 26, { align: 'right', width: W - 40 });
  doc.fillColor(OSC).fontSize(18).font('Helvetica').text(titulo || '', 40, 84, { width: W - 80 });
}
async function bufDe(url) { try { const r = await fetch(url); if (!r.ok) return null; return await sharp(Buffer.from(await r.arrayBuffer())).rotate().resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 84 }).toBuffer(); } catch { return null; } }
router.post('/:id/pdf', async (req, res) => {
  try {
    const m = await leerManual(req.params.id); if (!m) return res.status(404).json({ error: 'Manual no encontrado' });
    const sel = new Set(Array.isArray(req.body?.capitulos) ? req.body.capitulos : []), caps = m.capitulos.filter(c => !sel.size || sel.has(c.id));
    const W = 595, H = 842, mg = 40, OSC = '#1e1b18', GRIS = '#6b6560', ORO = '#c9a46c', ancho = W - mg * 2;
    const doc = new PDFDocument({ margin: 0, size: 'A4', bufferPages: true }), trozos = []; doc.on('data', c => trozos.push(c)); const fin = new Promise(ok => doc.on('end', ok));
    doc.rect(0, 0, W, H).fill(OSC); try { doc.image(path.join(__dirname, '..', 'Icono Blanco.png'), mg, 60, { height: 70 }); } catch { /* sin logo */ }
    doc.fillColor('#ffffff').font('Helvetica').fontSize(30).text(m.titulo, mg, 300, { width: ancho }); if (m.subtitulo) doc.fillColor('#b9b3ab').fontSize(13).text(m.subtitulo, mg, doc.y + 12, { width: ancho });
    doc.fillColor(ORO).fontSize(9).text('RANUSE DESIGN · ' + new Date().toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }).toUpperCase(), mg, H - 70);
    if (caps.length > 1) { doc.addPage(); doc.fillColor(OSC).font('Helvetica').fontSize(20).text('Contenido', mg, 80); let yy = 130; caps.forEach((c, i) => { doc.fillColor(OSC).fontSize(11).text((i + 1) + '.  ' + c.titulo, mg, yy, { width: ancho }); yy += 22; }); }
    for (let ci = 0; ci < caps.length; ci++) {
      const c = caps[ci]; doc.addPage(); cabecera(doc, String(m.titulo).toUpperCase().slice(0, 60), (ci + 1) + '. ' + c.titulo); let y = 130;
      const sitio = (alto) => { if (y + alto > H - 60) { doc.addPage(); cabecera(doc, String(m.titulo).toUpperCase().slice(0, 60), c.titulo + ' (continúa)'); y = 130; } };
      for (const b of c.bloques) {
        if (b.tipo === 'texto') {
          for (const linea of String(b.texto || '').split('\n')) {
            const t = linea.trim(); if (!t) { y += 5; continue; }
            if (t.startsWith('## ')) { sitio(30); doc.fillColor(OSC).font('Helvetica-Bold').fontSize(11.5).text(t.slice(3), mg, y, { width: ancho }); y = doc.y + 5; }
            else if (t.startsWith('# ')) { sitio(36); doc.fillColor(OSC).font('Helvetica-Bold').fontSize(14).text(t.slice(2), mg, y + 4, { width: ancho }); y = doc.y + 6; }
            else if (/^[-•]\s/.test(t)) { const s2 = t.slice(2), h = doc.font('Helvetica').fontSize(10).heightOfString(s2, { width: ancho - 16 }); sitio(h + 4); doc.fillColor(ORO).text('•', mg + 2, y); doc.fillColor('#333').font('Helvetica').fontSize(10).text(s2, mg + 16, y, { width: ancho - 16 }); y = doc.y + 3; }
            else { const h = doc.font('Helvetica').fontSize(10).heightOfString(t, { width: ancho }); sitio(h + 4); doc.fillColor('#333').text(t, mg, y, { width: ancho }); y = doc.y + 4; }
          }
          y += 6;
        } else if (b.tipo === 'imagen' && b.url) {
          const buf = await bufDe(b.url); if (!buf) continue; const meta = await sharp(buf).metadata(), h = Math.min(330, ancho * meta.height / meta.width); sitio(h + 24);
          try { doc.image(buf, mg, y, { fit: [ancho, h], align: 'center' }); } catch { /* imagen no válida */ } y += h + 6; if (b.pie) { doc.fillColor(GRIS).font('Helvetica').fontSize(8.5).text(b.pie, mg, y, { width: ancho, align: 'center' }); y = doc.y + 8; } else y += 6;
        } else if (b.tipo === 'esquema') {
          const res = distribuye(b.spec), prop = (res.esX ? res.D / res.L : res.L / res.D), alto = Math.min(470, Math.max(240, ancho * Math.min(1.1, prop) + 70)); sitio(alto + 30);
          const usado = esquemaPdf(doc, b.spec, mg, y, ancho, alto); y += usado + 4; if (b.pie) { doc.fillColor(GRIS).font('Helvetica').fontSize(8.5).text(b.pie, mg, y, { width: ancho, align: 'center' }); y = doc.y + 8; } else y += 8;
        }
      }
    }
    const rango = doc.bufferedPageRange(); for (let i = 1; i < rango.count; i++) { doc.switchToPage(i); doc.fillColor('#999').font('Helvetica').fontSize(7.5).text('Ranuse Design · ' + m.titulo + ' · ' + (i + 1), mg, H - 28, { width: ancho, align: 'center', lineBreak: false }); }
    doc.end(); await fin;
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="manual.pdf"' }).send(Buffer.concat(trozos));
  } catch (e) { console.error('manual pdf:', e); if (!res.headersSent) res.status(500).json({ error: 'No se pudo crear el PDF' }); }
});

export { pdfUnaPagina, resumenDe };
export default router;
