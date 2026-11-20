import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { uploadModelo3dFile, uploadFotosProducto, uploadReferenceImageFile, uploadZipTexturas, handleMulterError } from '../middleware/upload.middleware.js';
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
    for (const k of ['autor', 'licencia', 'fuente']) if (typeof req.body?.[k] === 'string' && req.body[k].trim()) m[k] = req.body[k].trim().slice(0, 200);
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
// Hace continua una textura (microcemento, mortero, lino…): 1) quita las variaciones grandes de claro y oscuro (lo que más delata los rectángulos al repetirla) y
// 2) mezcla los bordes con la misma imagen desplazada media pieza, de modo que el borde derecho encaja con el izquierdo y el de abajo con el de arriba
export async function hazContinua(buf, lado = 2048) {
  const base = await sharp(buf).rotate().resize({ width: lado, height: lado, fit: 'inside', withoutEnlargement: true }).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = base.info, C = 3, d = base.data;
  const sigma = Math.max(8, Math.min(W, H) / 6);
  const desenfoque = await sharp(d, { raw: { width: W, height: H, channels: C } }).blur(sigma).raw().toBuffer();
  const media = [0, 0, 0]; for (let i = 0; i < d.length; i += C) { media[0] += d[i]; media[1] += d[i + 1]; media[2] += d[i + 2]; } const n = W * H; media[0] /= n; media[1] /= n; media[2] /= n;
  const plano = new Float32Array(d.length); // imagen sin las manchas grandes
  for (let i = 0; i < d.length; i += C) for (let c = 0; c < C; c++) plano[i + c] = Math.max(0, Math.min(255, d[i + c] - 0.85 * (desenfoque[i + c] - media[c])));
  const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const wx = new Float32Array(W), wy = new Float32Array(H);
  for (let x = 0; x < W; x++) { const t = (x + 0.5) / W; wx[x] = ss(0, 0.38, t) * ss(0, 0.38, 1 - t); }
  for (let y = 0; y < H; y++) { const t = (y + 0.5) / H; wy[y] = ss(0, 0.38, t) * ss(0, 0.38, 1 - t); }
  const out = Buffer.alloc(d.length), hx = W >> 1, hy = H >> 1;
  for (let y = 0; y < H; y++) { const sy = (y + hy) % H; for (let x = 0; x < W; x++) { const sx = (x + hx) % W, m = wx[x] * wy[y], a = (y * W + x) * C, b = (sy * W + sx) * C; for (let c = 0; c < C; c++) out[a + c] = Math.round(plano[a + c] * m + plano[b + c] * (1 - m)); } }
  return sharp(out, { raw: { width: W, height: H, channels: C } }).jpeg({ quality: 92 }).toBuffer();
}
const guardarTexturasMias = lista => supabase.storage.from(BUCKET).upload(RUTA_TEX_MIAS, Buffer.from(JSON.stringify(lista)), { contentType: 'application/json', upsert: true, cacheControl: '0' });
router.post('/mis-texturas', uploadReferenceImageFile, handleMulterError, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Falta la imagen' });
    const id = 'mt-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ruta = 'biblioteca3d/mis-texturas/' + id + '.jpg';
    const buf = req.body?.continua === '1' ? await hazContinua(req.file.buffer) : await sharp(req.file.buffer).rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
    const { error: eUp } = await supabase.storage.from(BUCKET).upload(ruta, buf, { contentType: 'image/jpeg', upsert: true });
    if (eUp) throw eUp;
    const tam = Math.max(5, Math.min(1000, parseFloat(req.body?.tam) || 60)), tamH = parseFloat(req.body?.tamH) > 0 ? Math.max(5, Math.min(1000, parseFloat(req.body.tamH))) : undefined;
    const nombre = String(req.body?.nombre || nombreOk(req.file.originalname).replace(/\.[^.]+$/, '')).replace(/[_-]+/g, ' ').trim().slice(0, 60) || 'Mi textura';
    const t = { id, nombre, categoria: 'Mis texturas', url: supabase.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl, tam, ...(tamH ? { tamH } : {}), mia: true };
    const lista = await leerTexturasMias(); lista.push(t);
    const { error } = await guardarTexturasMias(lista); if (error) throw error;
    res.status(201).json({ textura: t });
  } catch (e) { console.error('biblioteca3d mis-texturas:', e); res.status(500).json({ error: 'No se pudo guardar la textura' }); }
});
// Una carpeta entera de texturas en un .zip (p. ej. la carpeta «Alvic» de Drive descargada): se crean todas de una vez, con el nombre del archivo
router.post('/mis-texturas/zip', uploadZipTexturas, handleMulterError, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Falta el archivo .zip' });
    const zip = await JSZip.loadAsync(req.file.buffer), tam = Math.max(5, Math.min(1000, parseFloat(req.body?.tam) || 60)), tamH = parseFloat(req.body?.tamH) > 0 ? Math.max(5, Math.min(1000, parseFloat(req.body.tamH))) : undefined;
    const entradas = Object.values(zip.files).filter(e => !e.dir && /\.(jpe?g|png|webp)$/i.test(e.name) && !/(^|\/)(__MACOSX|\.)/.test(e.name)).slice(0, 150);
    if (!entradas.length) return res.status(400).json({ error: 'El .zip no tiene imágenes (jpg, png o webp)' });
    const lista = await leerTexturasMias(), nuevas = []; let omitidas = 0;
    for (const e of entradas) {
      try {
        const buf = await e.async('nodebuffer'); if (buf.length < 3000) { omitidas++; continue; }
        const id = 'mt-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + nuevas.length, ruta = 'biblioteca3d/mis-texturas/' + id + '.jpg';
        const out = req.body?.continua === '1' ? await hazContinua(buf) : await sharp(buf).rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
        const { error: eUp } = await supabase.storage.from(BUCKET).upload(ruta, out, { contentType: 'image/jpeg', upsert: true }); if (eUp) throw eUp;
        const base = e.name.split('/').pop().replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Mi textura';
        nuevas.push({ id, nombre: base, categoria: 'Mis texturas', url: supabase.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl, tam, ...(tamH ? { tamH } : {}), mia: true });
      } catch (err) { omitidas++; console.warn('mis-texturas zip: no se pudo', e.name, err.message); }
    }
    if (!nuevas.length) return res.status(500).json({ error: 'No se pudo guardar ninguna textura del .zip' });
    const { error } = await guardarTexturasMias([...lista, ...nuevas]); if (error) throw error;
    res.status(201).json({ texturas: nuevas, omitidas });
  } catch (e) { console.error('biblioteca3d mis-texturas zip:', e); res.status(500).json({ error: 'No se pudo leer el .zip: ' + String(e.message || '').slice(0, 120) }); }
});
router.post('/mis-texturas/:id/continua', async (req, res) => {
  try {
    const lista = await leerTexturasMias(), t = lista.find(x => x.id === req.params.id); if (!t) return res.status(404).json({ error: 'No encontrada' });
    const rf = await fetch(t.url); if (!rf.ok) throw new Error('No se pudo leer la imagen');
    const buf = await hazContinua(Buffer.from(await rf.arrayBuffer()));
    const id = 'mt-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ruta = 'biblioteca3d/mis-texturas/' + id + '.jpg';
    const { error: eUp } = await supabase.storage.from(BUCKET).upload(ruta, buf, { contentType: 'image/jpeg', upsert: true }); if (eUp) throw eUp;
    const nueva = { ...t, id, nombre: (t.nombre.replace(/ \(continua\)$/, '') + ' (continua)').slice(0, 60), url: supabase.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl };
    const { error } = await guardarTexturasMias([...lista, nueva]); if (error) throw error;
    res.status(201).json({ textura: nueva });
  } catch (e) { console.error('biblioteca3d continua:', e); res.status(500).json({ error: 'No se pudo hacer continua: ' + String(e.message || '').slice(0, 100) }); }
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

// ── Sketchfab: buscar modelos descargables con licencia que permite usarlos (CC0 y CC-BY) y traerlos a «Mis modelos» ──
// La búsqueda es pública; para descargar hace falta la clave personal de Sketchfab en la variable SKETCHFAB_TOKEN del servidor.
const SF = 'https://api.sketchfab.com/v3';
router.get('/sketchfab/estado', (req, res) => res.json({ configurado: !!process.env.SKETCHFAB_TOKEN }));
router.get('/sketchfab/buscar', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 80); if (!q) return res.json({ resultados: [], siguiente: null });
    const p = new URLSearchParams({ type: 'models', q, downloadable: 'true', license: String(req.query.licencia) === 'cc0' ? 'cc0' : 'by', sort_by: '-likeCount', count: '24', max_face_count: '150000' });
    if (req.query.categoria) p.set('categories', String(req.query.categoria).slice(0, 40));
    if (req.query.cursor) p.set('cursor', String(req.query.cursor).slice(0, 200));
    const r = await fetch(SF + '/search?' + p.toString(), { headers: process.env.SKETCHFAB_TOKEN ? { Authorization: 'Token ' + process.env.SKETCHFAB_TOKEN } : {} });
    if (!r.ok) return res.status(502).json({ error: 'Sketchfab no responde ahora (' + r.status + ')' });
    const j = await r.json();
    const resultados = (j.results || []).map(m => {
      const im = (m.thumbnails?.images || []).slice().sort((a, b) => Math.abs(a.width - 200) - Math.abs(b.width - 200))[0];
      return { uid: m.uid, nombre: m.name, autor: m.user?.displayName || m.user?.username || '', licencia: m.license?.label || m.license?.slug || '', caras: m.faceCount || 0, miniatura: im?.url || '', url: m.viewerUrl || ('https://sketchfab.com/3d-models/' + m.uid) };
    });
    res.json({ resultados, siguiente: j.cursors?.next || null });
  } catch (e) { console.error('sketchfab buscar:', e); res.status(500).json({ error: 'No se pudo buscar en Sketchfab' }); }
});
// Tanda recomendada: los mejores modelos (por «me gusta») de cada tipo de mueble, primero CC0 y luego CC-BY, ligeros, para revisarlos y añadir los que gusten
const TANDA = [['modern sofa', 'Sofás'], ['modern armchair', 'Sillones'], ['modern dining chair', 'Sillas'], ['modern coffee table', 'Mesas de centro'], ['modern dining table', 'Mesas'], ['modern bed', 'Camas'], ['modern bookshelf', 'Estanterías'], ['modern floor lamp', 'Lámparas'], ['modern tv stand', 'Muebles de TV'], ['modern bar stool', 'Taburetes']];
const NO_MUEBLE = /room|scene|pack|set|collection|house|building|interior|kitchen|bedroom|living|apartment|studio|victorian|antique|retro|old|vintage|gothic|baroque|kid|sci-fi|demo|download|please|low.?poly/i;
router.get('/sketchfab/tanda', async (req, res) => {
  try {
    const buscar = async (q, lic, n) => {
      const p = new URLSearchParams({ type: 'models', q, downloadable: 'true', license: lic, sort_by: '-likeCount', count: '12', max_face_count: '80000', categories: 'furniture-home' });
      const r = await fetch(SF + '/search?' + p.toString()); if (!r.ok) return [];
      return ((await r.json()).results || []).filter(m => !NO_MUEBLE.test(m.name || '') && (m.faceCount || 0) > 800).slice(0, n).map(m => {
        const im = (m.thumbnails?.images || []).slice().sort((a, b) => Math.abs(a.width - 200) - Math.abs(b.width - 200))[0];
        return { uid: m.uid, nombre: m.name, autor: m.user?.displayName || m.user?.username || '', licencia: m.license?.label || lic, caras: m.faceCount || 0, miniatura: im?.url || '', url: m.viewerUrl || ('https://sketchfab.com/3d-models/' + m.uid) };
      });
    };
    const visto = new Set(), out = [];
    for (const [q, cat] of TANDA) {
      const [a, b] = await Promise.all([buscar(q, 'cc0', 4), buscar(q, 'by', 4)]);
      for (const m of [...a, ...b]) if (!visto.has(m.uid)) { visto.add(m.uid); out.push({ ...m, cat }); }
    }
    res.json({ resultados: out });
  } catch (e) { console.error('sketchfab tanda:', e); res.status(500).json({ error: 'No se pudo preparar la tanda' }); }
});
// Descarga el modelo (zip glTF con sus texturas) y lo entrega para que el visor lo guarde y lo mida como cualquier modelo subido
router.get('/sketchfab/descargar/:uid', async (req, res) => {
  try {
    const token = process.env.SKETCHFAB_TOKEN; if (!token) return res.status(400).json({ error: 'Falta la clave de Sketchfab en el servidor (variable SKETCHFAB_TOKEN)' });
    const uid = String(req.params.uid).replace(/[^a-z0-9]/gi, ''); if (!uid) return res.status(400).json({ error: 'Modelo no válido' });
    const r = await fetch(SF + '/models/' + uid + '/download', { headers: { Authorization: 'Token ' + token } });
    if (r.status === 401 || r.status === 403) return res.status(400).json({ error: 'La clave de Sketchfab no es válida o ese modelo no se puede descargar' });
    if (!r.ok) return res.status(502).json({ error: 'Sketchfab no ha dado la descarga (' + r.status + ')' });
    const j = await r.json(), arch = j.glb || j.gltf; if (!arch?.url) return res.status(400).json({ error: 'Ese modelo no tiene descarga glTF' });
    if (arch.size && arch.size > 55 * 1048576) return res.status(400).json({ error: 'Pesa demasiado (' + Math.round(arch.size / 1048576) + ' MB; el máximo son 55 MB). Elige otro.' });
    const d = await fetch(arch.url); if (!d.ok) return res.status(502).json({ error: 'No se pudo bajar el archivo' });
    const buf = Buffer.from(await d.arrayBuffer());
    res.setHeader('Content-Type', j.glb ? 'model/gltf-binary' : 'application/zip'); res.setHeader('X-Modelo-Tipo', j.glb ? 'glb' : 'zip');
    res.send(buf);
  } catch (e) { console.error('sketchfab descargar:', e); res.status(500).json({ error: 'No se pudo traer el modelo de Sketchfab' }); }
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
