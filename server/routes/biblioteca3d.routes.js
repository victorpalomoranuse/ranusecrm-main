import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { uploadModelo3dFile, uploadFotosProducto, uploadReferenceImageFile, handleMulterError } from '../middleware/upload.middleware.js';
import sharp from 'sharp';
import JSZip from 'jszip';
import { glbConChatGPT } from '../utils/modelo3d-openai.js';

// Biblioteca 3D gratuita (modelos y texturas de Poly Haven, licencia CC0). No forma parte del catálogo de productos:
// es un índice aparte, guardado en el almacenamiento (biblioteca3d/indice.json), que el visor 3D usa para colocar muebles y texturas.
const router = express.Router();
router.use(authenticateToken);

let cache = { t: 0, data: null };
export async function indiceBiblioteca3d() {
  if (cache.data && Date.now() - cache.t < 10 * 60 * 1000) return cache.data;
  const { data: { publicUrl } } = supabase.storage.from('project-documents').getPublicUrl('biblioteca3d/indice.json');
  const r = await fetch(publicUrl + '?t=' + Date.now());
  if (!r.ok) return null;
  cache = { t: Date.now(), data: await r.json() };
  return cache.data;
}

// «Mis modelos»: plantas, muebles… subidos a mano, sin ligarlos a ningún producto. Lista en storage (modelos-3d/_libres.json)
const BUCKET = 'project-documents', RUTA_LIBRES = 'modelos-3d/_libres.json';
const MIME = { glb: 'model/gltf-binary', gltf: 'model/gltf+json', bin: 'application/octet-stream', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', dae: 'model/vnd.collada+xml', obj: 'text/plain', mtl: 'text/plain' };
async function leerLibres() {
  try { const { data, error } = await supabase.storage.from(BUCKET).download(RUTA_LIBRES); if (error || !data) return []; const j = JSON.parse(await data.text()); return Array.isArray(j) ? j : []; } catch { return []; }
}
async function guardarLibres(lista) {
  return supabase.storage.from(BUCKET).upload(RUTA_LIBRES, Buffer.from(JSON.stringify(lista)), { contentType: 'application/json', upsert: true, cacheControl: '0' });
}
// Categorías de «Mis modelos»: se guardan aparte para poder crear categorías vacías (modelos-3d/_categorias.json)
const RUTA_CATS = 'modelos-3d/_categorias.json';
async function leerCats() {
  try { const { data, error } = await supabase.storage.from(BUCKET).download(RUTA_CATS); if (error || !data) return []; const j = JSON.parse(await data.text()); return Array.isArray(j) ? j.filter(x => typeof x === 'string') : []; } catch { return []; }
}
async function guardarCats(lista) {
  return supabase.storage.from(BUCKET).upload(RUTA_CATS, Buffer.from(JSON.stringify(lista)), { contentType: 'application/json', upsert: true, cacheControl: '0' });
}
const limpiaCat = v => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 40);
// los nombres de archivo con tildes llegan mal codificados (SofÃ¡ en vez de Sofá): se corrigen
const nombreOk = n => { const t = String(n || ''); try { return /[ÃÂ]/.test(t) ? Buffer.from(t, 'latin1').toString('utf8') : t; } catch { return t; } };
router.post('/cats', async (req, res) => {
  try {
    const n = limpiaCat(req.body?.nombre); if (!n) return res.status(400).json({ error: 'Escribe un nombre para la categoría' });
    const lista = await leerCats(); if (!lista.some(x => x.toLowerCase() === n.toLowerCase())) lista.push(n);
    const { error } = await guardarCats(lista); if (error) throw error;
    res.status(201).json({ cats: lista });
  } catch (e) { res.status(500).json({ error: 'No se pudo crear la categoría' }); }
});
router.put('/cats', async (req, res) => {
  try {
    const de = limpiaCat(req.body?.de), a = limpiaCat(req.body?.a); if (!de || !a) return res.status(400).json({ error: 'Faltan los nombres' });
    const cats = (await leerCats()).filter(x => x !== de); if (!cats.some(x => x.toLowerCase() === a.toLowerCase())) cats.push(a);
    const lista = await leerLibres(); lista.forEach(m => { if (m.categoria === de) m.categoria = a; });
    const e1 = (await guardarCats(cats)).error, e2 = (await guardarLibres(lista)).error; if (e1 || e2) throw (e1 || e2);
    res.json({ cats, mios: lista });
  } catch (e) { res.status(500).json({ error: 'No se pudo cambiar el nombre' }); }
});
router.delete('/cats/:nombre', async (req, res) => {
  try {
    const n = limpiaCat(req.params.nombre), cats = (await leerCats()).filter(x => x !== n), lista = await leerLibres();
    lista.forEach(m => { if (m.categoria === n) m.categoria = 'Mis modelos'; });
    const e1 = (await guardarCats(cats)).error, e2 = (await guardarLibres(lista)).error; if (e1 || e2) throw (e1 || e2);
    res.json({ cats, mios: lista });
  } catch (e) { res.status(500).json({ error: 'No se pudo borrar la categoría' }); }
});
router.post('/mios', uploadModelo3dFile, handleMulterError, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Falta el archivo del modelo' });
    const ext = String(req.file.originalname.split('.').pop()).toLowerCase();
    const id = 'mio-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), base = 'modelos-3d/libres/' + id;
    let url, tipo = ext, carpeta = null;
    if (ext === 'zip') {
      const zip = await JSZip.loadAsync(req.file.buffer);
      const entradas = Object.values(zip.files).filter(f => !f.dir && !/(^|\/)(__MACOSX|\.DS_Store)(\/|$)/.test(f.name) && !f.name.startsWith('/') && !f.name.split('/').includes('..'));
      if (!entradas.length || entradas.length > 300) return res.status(400).json({ error: 'El .zip está vacío o tiene demasiados archivos' });
      const principal = ['glb', 'gltf', 'dae', 'obj'].map(e => entradas.find(f => f.name.toLowerCase().endsWith('.' + e))).find(Boolean);
      if (!principal) return res.status(400).json({ error: 'No hay ningún .glb, .gltf, .dae u .obj dentro del .zip' });
      for (const f of entradas) {
        const buf = await f.async('nodebuffer'); if (buf.length > 25e6) continue;
        const { error } = await supabase.storage.from(BUCKET).upload(base + '/' + f.name, buf, { contentType: MIME[f.name.split('.').pop().toLowerCase()] || 'application/octet-stream', upsert: true });
        if (error && f === principal) throw error;
      }
      url = supabase.storage.from(BUCKET).getPublicUrl(base + '/' + principal.name).data.publicUrl; tipo = principal.name.split('.').pop().toLowerCase(); carpeta = base;
    } else {
      const { error } = await supabase.storage.from(BUCKET).upload(base + '.' + ext, req.file.buffer, { contentType: MIME[ext] || 'application/octet-stream', upsert: true });
      if (error) throw error;
      url = supabase.storage.from(BUCKET).getPublicUrl(base + '.' + ext).data.publicUrl;
    }
    let aviso;
    if (ext !== 'zip' && ext !== 'glb') {
      try {
        const txt = req.file.buffer.toString('utf8');
        const externas = ext === 'dae' ? new Set([...txt.matchAll(/<init_from>([^<]+\.(?:jpe?g|png|tga|bmp|tiff?|webp|gif))<\/init_from>/gi)].map(x => x[1]))
          : ext === 'gltf' ? new Set((JSON.parse(txt).images || []).map(i => i.uri).filter(u => u && !String(u).startsWith('data:')))
          : /^\s*mtllib\s/m.test(txt) ? new Set(['materiales .mtl y sus imágenes']) : new Set();
        if (externas.size) aviso = 'Ojo: este .' + ext + ' usa ' + externas.size + ' archivo(s) externos de texturas que no se han subido, y se verá en negro o sin material. Súbelo como un .zip con el modelo y su carpeta de texturas juntos (en SketchUp: Archivo → Exportar → Modelo 3D, y comprime el .' + ext + ' con su carpeta), o expórtalo como .glb, que lleva las texturas dentro.';
      } catch { /* sin análisis */ }
    }
    const num = (v, d) => (Number(v) > 0 ? Math.min(5000, Number(v)) : d);
    const nombre = String(req.body?.nombre || nombreOk(req.file.originalname).replace(/\.[^.]+$/, '')).trim().slice(0, 80) || 'Modelo';
    const m = { id, nombre, categoria: String(req.body?.categoria || 'Mis modelos').trim().slice(0, 40) || 'Mis modelos', url, tipo, ...(carpeta ? { carpeta } : {}), w: num(req.body?.w, 100), d: num(req.body?.d, 100), alto: num(req.body?.alto, 100), mio: true };
    const lista = await leerLibres(); lista.push(m);
    const { error } = await guardarLibres(lista); if (error) throw error;
    res.status(201).json({ modelo: m, ...(aviso ? { aviso } : {}) });
  } catch (err) {
    console.error('biblioteca3d mios:', err);
    res.status(500).json({ error: 'No se pudo guardar el modelo' + (err?.message ? ': ' + String(err.message).slice(0, 140) : '') });
  }
});
router.put('/mios/:id', async (req, res) => {
  try {
    const lista = await leerLibres(), m = lista.find(x => x.id === req.params.id);
    if (!m) return res.status(404).json({ error: 'No encontrado' });
    const num = v => (Number(v) > 0 ? Math.min(5000, Number(v)) : null);
    if (num(req.body?.w)) m.w = num(req.body.w); if (num(req.body?.d)) m.d = num(req.body.d); if (num(req.body?.alto)) m.alto = num(req.body.alto);
    if (typeof req.body?.nombre === 'string' && req.body.nombre.trim()) m.nombre = req.body.nombre.trim().slice(0, 80);
    if (typeof req.body?.categoria === 'string' && req.body.categoria.trim()) m.categoria = req.body.categoria.trim().slice(0, 40);
    const { error } = await guardarLibres(lista); if (error) throw error;
    res.json({ modelo: m });
  } catch (err) { res.status(500).json({ error: 'No se pudo cambiar el modelo' }); }
});
router.delete('/mios/:id', async (req, res) => {
  try {
    const lista = await leerLibres(), m = lista.find(x => x.id === req.params.id);
    if (!m) return res.json({ ok: true });
    const { error } = await guardarLibres(lista.filter(x => x.id !== m.id)); if (error) throw error;
    try {
      if (m.carpeta) { const { data } = await supabase.storage.from(BUCKET).list(m.carpeta, { limit: 300 }); if (data?.length) await supabase.storage.from(BUCKET).remove(data.filter(f => f.id).map(f => m.carpeta + '/' + f.name)); }
      else { const p = String(m.url).split('/' + BUCKET + '/')[1]; if (p) await supabase.storage.from(BUCKET).remove([decodeURIComponent(p)]); }
    } catch { /* si no se pueden borrar los archivos, el modelo ya no sale en la lista */ }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'No se pudo quitar el modelo' }); }
});

// ── «Crear modelo 3D con IA»: ChatGPT (API de OpenAI con su herramienta de código) construye un .glb a partir de la foto de un producto
// Variables: OPENAI_API_KEY (obligatoria) y OPENAI_3D_MODEL (por defecto gpt-5). Es un trabajo largo: se lanza y el visor pregunta por su estado.
const trabajosIA = new Map();
async function ejecutaIA(job, fotos, nombre, medidas, categoria) {
  try {
    const glb = await glbConChatGPT(fotos, nombre, medidas);
    const id = 'mio-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ruta = 'modelos-3d/libres/' + id + '.glb';
    const { error: eUp } = await supabase.storage.from(BUCKET).upload(ruta, glb, { contentType: 'model/gltf-binary', upsert: true });
    if (eUp) throw eUp;
    const url = supabase.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl;
    const m = { id, nombre: nombre.slice(0, 80), categoria: String(categoria || 'Mis modelos').slice(0, 40), url, tipo: 'glb', w: 100, d: 100, alto: 100, ia: true };
    const lista = await leerLibres(); lista.push(m);
    const { error } = await guardarLibres(lista); if (error) throw error;
    Object.assign(job, { estado: 'listo', modelo: m });
  } catch (e) {
    console.error('biblioteca3d crear-ia:', e);
    Object.assign(job, { estado: 'error', error: String(e.message || e).slice(0, 300) });
  }
}
router.post('/crear-ia', uploadFotosProducto, handleMulterError, async (req, res) => {
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'Falta la clave de OpenAI en el servidor (variable OPENAI_API_KEY en Railway).' });
  const fotos = (req.files || []).map(f => ({ buffer: f.buffer, mimetype: f.mimetype || 'image/jpeg', originalname: f.originalname }));
  if (!fotos.length) return res.status(400).json({ error: 'Falta la foto del producto' });
  const nombre = String(req.body?.nombre || nombreOk(fotos[0].originalname).replace(/\.[^.]+$/, '')).trim().slice(0, 80) || 'Producto';
  const medidas = String(req.body?.medidas || '').trim().slice(0, 200);
  const id = 'ia' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const job = { id, estado: 'trabajando', desde: Date.now() };
  trabajosIA.set(id, job);
  for (const [k, v] of trabajosIA) if (Date.now() - v.desde > 60 * 60 * 1000) trabajosIA.delete(k);
  ejecutaIA(job, fotos, nombre, medidas, req.body?.categoria);
  res.status(202).json({ id });
});
router.get('/crear-ia/:id', (req, res) => {
  const job = trabajosIA.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Ese trabajo ya no existe (el servidor se reinició o pasó más de una hora)' });
  res.json({ estado: job.estado, modelo: job.modelo, error: job.error, segundos: Math.round((Date.now() - job.desde) / 1000) });
});

// «Mis texturas»: imágenes propias (suelos, paredes, tejidos…) que se suben una vez y sirven en todos los planos. Lista en modelos-3d/_texturas.json
const RUTA_TEX_MIAS = 'modelos-3d/_texturas.json';
export async function leerTexturasMias() {
  try { const { data, error } = await supabase.storage.from(BUCKET).download(RUTA_TEX_MIAS); if (error || !data) return []; const j = JSON.parse(await data.text()); return Array.isArray(j) ? j : []; } catch { return []; }
}
const guardarTexturasMias = lista => supabase.storage.from(BUCKET).upload(RUTA_TEX_MIAS, Buffer.from(JSON.stringify(lista)), { contentType: 'application/json', upsert: true, cacheControl: '0' });
router.post('/mis-texturas', uploadReferenceImageFile, handleMulterError, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Falta la imagen' });
    const id = 'mt-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ruta = 'biblioteca3d/mis-texturas/' + id + '.jpg';
    const buf = await sharp(req.file.buffer).rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
    const { error: eUp } = await supabase.storage.from(BUCKET).upload(ruta, buf, { contentType: 'image/jpeg', upsert: true });
    if (eUp) throw eUp;
    const tam = Math.max(5, Math.min(1000, parseFloat(req.body?.tam) || 60));
    const nombre = String(req.body?.nombre || nombreOk(req.file.originalname).replace(/\.[^.]+$/, '')).replace(/[_-]+/g, ' ').trim().slice(0, 60) || 'Mi textura';
    const t = { id, nombre, categoria: 'Mis texturas', url: supabase.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl, tam, mia: true };
    const lista = await leerTexturasMias(); lista.push(t);
    const { error } = await guardarTexturasMias(lista); if (error) throw error;
    res.status(201).json({ textura: t });
  } catch (e) { console.error('biblioteca3d mis-texturas:', e); res.status(500).json({ error: 'No se pudo guardar la textura' }); }
});
router.put('/mis-texturas/:id', async (req, res) => {
  try {
    const lista = await leerTexturasMias(), t = lista.find(x => x.id === req.params.id);
    if (!t) return res.status(404).json({ error: 'No encontrada' });
    if (typeof req.body?.nombre === 'string' && req.body.nombre.trim()) t.nombre = req.body.nombre.trim().slice(0, 60);
    if (parseFloat(req.body?.tam) > 0) t.tam = Math.max(5, Math.min(1000, parseFloat(req.body.tam)));
    const { error } = await guardarTexturasMias(lista); if (error) throw error;
    res.json({ textura: t });
  } catch (e) { res.status(500).json({ error: 'No se pudo cambiar' }); }
});
router.delete('/mis-texturas/:id', async (req, res) => {
  try {
    const lista = await leerTexturasMias(), t = lista.find(x => x.id === req.params.id);
    if (!t) return res.json({ ok: true });
    const { error } = await guardarTexturasMias(lista.filter(x => x.id !== t.id)); if (error) throw error;
    await supabase.storage.from(BUCKET).remove(['biblioteca3d/mis-texturas/' + t.id + '.jpg']).catch(() => {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'No se pudo quitar' }); }
});

router.get('/', async (req, res) => {
  try {
    const ind = await indiceBiblioteca3d(), mios = await leerLibres(), catsMios = await leerCats(), texturasMias = await leerTexturasMias();
    if (!ind) return res.json({ modelos: [], texturas: [], mios, catsMios, texturasMias, vacia: !mios.length && !texturasMias.length });
    res.json({ ...ind, mios, catsMios, texturasMias });
  } catch (err) {
    console.error('biblioteca3d:', err);
    res.status(500).json({ error: 'No se pudo cargar la biblioteca 3D' });
  }
});

export default router;
