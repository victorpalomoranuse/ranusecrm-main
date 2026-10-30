import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { uploadModelo3dFile, handleMulterError } from '../middleware/upload.middleware.js';
import JSZip from 'jszip';

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
    const num = (v, d) => (Number(v) > 0 ? Math.min(5000, Number(v)) : d);
    const nombre = String(req.body?.nombre || req.file.originalname.replace(/\.[^.]+$/, '')).trim().slice(0, 80) || 'Modelo';
    const m = { id, nombre, categoria: String(req.body?.categoria || 'Mis modelos').trim().slice(0, 40) || 'Mis modelos', url, tipo, ...(carpeta ? { carpeta } : {}), w: num(req.body?.w, 100), d: num(req.body?.d, 100), alto: num(req.body?.alto, 100), mio: true };
    const lista = await leerLibres(); lista.push(m);
    const { error } = await guardarLibres(lista); if (error) throw error;
    res.status(201).json({ modelo: m });
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

router.get('/', async (req, res) => {
  try {
    const ind = await indiceBiblioteca3d(), mios = await leerLibres();
    if (!ind) return res.json({ modelos: [], texturas: [], mios, vacia: !mios.length });
    res.json({ ...ind, mios });
  } catch (err) {
    console.error('biblioteca3d:', err);
    res.status(500).json({ error: 'No se pudo cargar la biblioteca 3D' });
  }
});

export default router;
