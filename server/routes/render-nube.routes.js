import express from 'express';
import crypto from 'crypto';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';
import { guardaRenderGaleria } from './medicion.routes.js';

// Render realista en la nube (trazado de rayos con Blender Cycles en una GPU alquilada de RunPod).
// Flujo: el visor sube la escena (.glb + luces .json) directamente a Supabase con una URL firmada, el servidor
// pide el trabajo a RunPod, el worker (server/render-worker) renderiza y sube la imagen a otra URL firmada.
// Variables: RUNPOD_API_KEY y RUNPOD_ENDPOINT_ID. Sin ellas el botón avisa de que aún no está activado.
const router = express.Router();

const BUCKET = 'project-documents';
const BASE = 'render-nube';

// Escenas grandes: el visor sube el .glb comprimido (gzip) porque Supabase limita cada archivo (~50 MB). El worker de RunPod pide la escena
// a esta URL, que la descomprime al vuelo, así el worker no necesita cambios. Va sin login pero con una firma que caduca (la usa RunPod, no una persona).
const firmaEscena = (id, exp) => crypto.createHmac('sha256', process.env.JWT_SECRET || 'ranuse').update(`escena:${id}:${exp}`).digest('hex');
router.get('/escena/:id.glb', async (req, res) => {
  try {
    const { id } = req.params, exp = Number(req.query.e) || 0, f = String(req.query.f || '');
    const ok = /^[a-f0-9]{16}$/.test(id) && exp > Date.now() && f.length === 64 && crypto.timingSafeEqual(Buffer.from(f), Buffer.from(firmaEscena(id, exp)));
    if (!ok) return res.status(403).json({ error: 'Enlace no válido o caducado' });
    const { data, error } = await supabase.storage.from(BUCKET).download(`${BASE}/${id}/escena.glb.gz`);
    if (error || !data) return res.status(404).json({ error: 'No existe la escena' });
    const glb = (await import('zlib')).gunzipSync(Buffer.from(await data.arrayBuffer()));
    res.set({ 'Content-Type': 'model/gltf-binary', 'Content-Length': glb.length }).send(glb);
  } catch (e) { res.status(500).json({ error: 'No se pudo preparar la escena' }); }
});

router.get('/script/:id.py', async (req, res) => {
  try {
    const { id } = req.params, exp = Number(req.query.e) || 0, f = String(req.query.f || '');
    const ok = /^[a-f0-9]{16}$/.test(id) && exp > Date.now() && f.length === 64 && crypto.timingSafeEqual(Buffer.from(f), Buffer.from(firmaEscena('s' + id, exp)));
    if (!ok) return res.status(403).json({ error: 'Enlace no válido o caducado' });
    const { readFile } = await import('fs/promises'), { fileURLToPath } = await import('url'), { dirname, join } = await import('path');
    res.type('text/plain').send(await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'render-worker', 'render.py'), 'utf8'));
  } catch (e) { res.status(500).json({ error: 'No se pudo leer el script' }); }
});

router.use(authenticateToken, requirePermission('proyectos'));
const RUNPOD = 'https://api.runpod.ai/v2';
const CALIDADES = { previa: { ancho: 1280, muestras: 48 }, hd: { ancho: 3840, muestras: 192 }, '8k': { ancho: 7680, muestras: 256 } };
const clave = () => process.env.RUNPOD_API_KEY, endpoint = () => process.env.RUNPOD_ENDPOINT_ID;
const idValido = s => /^[a-f0-9]{16}$/.test(String(s || ''));
const rp = (ruta, opc = {}) => fetch(RUNPOD + '/' + endpoint() + ruta, { ...opc, headers: { Authorization: 'Bearer ' + clave(), 'Content-Type': 'application/json' } });

// ¿Está activado el render en la nube?
router.get('/estado', (req, res) => { const activo = !!(clave() && endpoint()); res.json({ disponible: activo, activo, motores: activo ? ['cycles'] : [], calidades: Object.keys(CALIDADES), motivo: activo ? '' : 'Todavía no hay ningún servicio de render en la nube conectado.' }); });

// 1) Crea el trabajo y devuelve las URLs firmadas donde subir la escena
router.post('/crear', async (req, res) => {
  if (!clave() || !endpoint()) return res.status(503).json({ error: 'El render en la nube aún no está activado.' });
  try {
    const id = crypto.randomBytes(8).toString('hex');
    const sube = async nombre => { const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(`${BASE}/${id}/${nombre}`); if (error) throw error; return data.signedUrl; };
    res.json({ id, escena: await sube('escena.glb'), escenaGz: await sube('escena.glb.gz'), luces: await sube('luces.json') });
  } catch (e) { res.status(500).json({ error: 'No se pudo preparar el render: ' + (e.message || e) }); }
});

// 2) Lanza el render en RunPod cuando la escena ya está subida
router.post('/iniciar', async (req, res) => {
  if (!clave() || !endpoint()) return res.status(503).json({ error: 'El render en la nube aún no está activado.' });
  const { id, calidad } = req.body || {};
  if (!idValido(id)) return res.status(400).json({ error: 'Trabajo no válido' });
  const cal = CALIDADES[calidad] || CALIDADES.hd;
  try {
    const firma = async nombre => { const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(`${BASE}/${id}/${nombre}`, 3600); if (error) throw error; return data.signedUrl; };
    const sube = await supabase.storage.from(BUCKET).createSignedUploadUrl(`${BASE}/${id}/resultado.png`);
    if (sube.error) throw sube.error;
    let urlEscena;
    if (req.body.comprimida) { const exp = Date.now() + 3 * 3600 * 1000, base = `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}`; urlEscena = `${base}/api/render-nube/escena/${id}.glb?e=${exp}&f=${firmaEscena(id, exp)}`; }
    const expS = Date.now() + 3 * 3600 * 1000, urlScript = `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}/api/render-nube/script/${id}.py?e=${expS}&f=${firmaEscena('s' + id, expS)}`;
    const r = await rp('/run', { method: 'POST', body: JSON.stringify({ policy: { executionTimeout: (calidad === '8k' ? 40 : calidad === 'previa' ? 15 : 30) * 60 * 1000 }, input: { script: urlScript, escena: urlEscena || await firma('escena.glb'), luces: await firma('luces.json'), subida: sube.data.signedUrl, ancho: cal.ancho, muestras: cal.muestras, exposicion: Number(req.body.exposicion) || 3 } }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.id) return res.status(502).json({ error: 'RunPod no aceptó el trabajo', detalle: j.error || r.status });
    const gal = req.body.galeria && /^[A-Za-z0-9_-]{8,64}$/.test(String(req.body.galeria.planoId || '')) ? { planoId: String(req.body.galeria.planoId), nombre: String(req.body.galeria.nombre || '').slice(0, 80), meta: req.body.galeria.meta || null } : null;
    await supabase.storage.from(BUCKET).upload(`${BASE}/${id}/job.json`, Buffer.from(JSON.stringify({ runpod: j.id, calidad, usuario: req.user?.id || null, fecha: new Date().toISOString(), galeria: gal })), { contentType: 'application/json', upsert: true });
    if (gal) pendientes.add(id);
    res.json({ id, runpod: j.id });
  } catch (e) { res.status(500).json({ error: 'No se pudo lanzar el render: ' + (e.message || e) }); }
});

// 3) Estado y resultado. Si el trabajo trae destino de galería, al terminar el SERVIDOR guarda la imagen en la galería del plano (aunque se cierre la página)
const pendientes = new Set(), guardando = new Set();
async function consultaTrabajo(id) {
  const job = await supabase.storage.from(BUCKET).download(`${BASE}/${id}/job.json`);
  if (job.error) return { http: 404, error: 'No existe ese trabajo' };
  const jd = JSON.parse(await job.data.text()), { runpod } = jd;
  if (jd.guardado) { pendientes.delete(id); const { data } = await supabase.storage.from(BUCKET).createSignedUrl(`${BASE}/${id}/resultado.png`, 86400); return { estado: 'listo', url: data?.signedUrl || null, guardada: true, render: jd.render || null }; }
  const r = await rp('/status/' + encodeURIComponent(runpod)), j = await r.json().catch(() => ({}));
  const st = j.status || 'DESCONOCIDO';
  if (st === 'COMPLETED') {
    if (j.output?.error) { pendientes.delete(id); return { estado: 'error', mensaje: String(j.output.error).slice(0, 300) }; }
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(`${BASE}/${id}/resultado.png`, 86400);
    const out = { estado: 'listo', url: data?.signedUrl || null, segundos: Math.round((j.executionTime || 0) / 1000) };
    if (jd.galeria && !guardando.has(id)) {
      guardando.add(id);
      try {
        const png = await supabase.storage.from(BUCKET).download(`${BASE}/${id}/resultado.png`);
        if (png.error) throw png.error;
        const render = await guardaRenderGaleria(jd.galeria.planoId, Buffer.from(await png.data.arrayBuffer()), { tipo: 'hd', nombre: jd.galeria.nombre || 'Render realista', meta: jd.galeria.meta });
        await supabase.storage.from(BUCKET).upload(`${BASE}/${id}/job.json`, Buffer.from(JSON.stringify({ ...jd, guardado: true, render })), { contentType: 'application/json', upsert: true });
        pendientes.delete(id); return { ...out, guardada: true, render };
      } catch (e) { console.error('render-nube galería:', e.message); }
      finally { guardando.delete(id); }
    }
    return out;
  }
  if (st === 'FAILED' || st === 'CANCELLED' || st === 'TIMED_OUT') { pendientes.delete(id); return { estado: 'error', mensaje: String(j.error || st).slice(0, 300) }; }
  return { estado: st === 'IN_QUEUE' ? 'en_cola' : 'renderizando' };
}
router.get('/estado/:id', async (req, res) => {
  if (!clave() || !endpoint()) return res.status(503).json({ error: 'El render en la nube aún no está activado.' });
  const { id } = req.params; if (!idValido(id)) return res.status(400).json({ error: 'Trabajo no válido' });
  try { const o = await consultaTrabajo(id); if (o.http) return res.status(o.http).json({ error: o.error }); res.json(o); }
  catch (e) { res.status(500).json({ error: 'No se pudo consultar el render' }); }
});

// Barrido en segundo plano: cada 30 s mira los trabajos con destino de galería que aún no se han guardado (la página puede estar cerrada)
setInterval(async () => { if (!clave() || !endpoint()) return; for (const id of [...pendientes]) { try { await consultaTrabajo(id); } catch { /* se reintenta en el siguiente barrido */ } } }, 30000).unref?.();
// al arrancar el servidor se recuperan los trabajos recientes que quedaron a medias
(async () => {
  try {
    if (!clave() || !endpoint()) return;
    const { data: carpetas } = await supabase.storage.from(BUCKET).list(BASE, { limit: 60, sortBy: { column: 'created_at', order: 'desc' } });
    for (const c of carpetas || []) { if (!idValido(c.name)) continue; const j = await supabase.storage.from(BUCKET).download(`${BASE}/${c.name}/job.json`); if (j.error) continue; const jd = JSON.parse(await j.data.text()); if (jd.galeria && !jd.guardado && Date.now() - new Date(jd.fecha).getTime() < 3 * 3600 * 1000) pendientes.add(c.name); }
  } catch { /* sin recuperación */ }
})();

export default router;
