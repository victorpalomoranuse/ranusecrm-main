import express from 'express';
import crypto from 'crypto';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';

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
    const r = await rp('/run', { method: 'POST', body: JSON.stringify({ policy: { executionTimeout: (calidad === '8k' ? 40 : calidad === 'previa' ? 15 : 30) * 60 * 1000 }, input: { escena: urlEscena || await firma('escena.glb'), luces: await firma('luces.json'), subida: sube.data.signedUrl, ancho: cal.ancho, muestras: cal.muestras, exposicion: Number(req.body.exposicion) || 3 } }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.id) return res.status(502).json({ error: 'RunPod no aceptó el trabajo', detalle: j.error || r.status });
    await supabase.storage.from(BUCKET).upload(`${BASE}/${id}/job.json`, Buffer.from(JSON.stringify({ runpod: j.id, calidad, usuario: req.user?.id || null, fecha: new Date().toISOString() })), { contentType: 'application/json', upsert: true });
    res.json({ id, runpod: j.id });
  } catch (e) { res.status(500).json({ error: 'No se pudo lanzar el render: ' + (e.message || e) }); }
});

// 3) Estado y resultado
router.get('/estado/:id', async (req, res) => {
  if (!clave() || !endpoint()) return res.status(503).json({ error: 'El render en la nube aún no está activado.' });
  const { id } = req.params; if (!idValido(id)) return res.status(400).json({ error: 'Trabajo no válido' });
  try {
    const job = await supabase.storage.from(BUCKET).download(`${BASE}/${id}/job.json`);
    if (job.error) return res.status(404).json({ error: 'No existe ese trabajo' });
    const { runpod } = JSON.parse(await job.data.text());
    const r = await rp('/status/' + encodeURIComponent(runpod)), j = await r.json().catch(() => ({}));
    const st = j.status || 'DESCONOCIDO';
    if (st === 'COMPLETED') {
      if (j.output?.error) return res.json({ estado: 'error', mensaje: String(j.output.error).slice(0, 300) });
      const { data } = await supabase.storage.from(BUCKET).createSignedUrl(`${BASE}/${id}/resultado.png`, 86400);
      return res.json({ estado: 'listo', url: data?.signedUrl || null, segundos: Math.round((j.executionTime || 0) / 1000) });
    }
    if (st === 'FAILED' || st === 'CANCELLED' || st === 'TIMED_OUT') return res.json({ estado: 'error', mensaje: String(j.error || st).slice(0, 300) });
    res.json({ estado: st === 'IN_QUEUE' ? 'en_cola' : 'renderizando' });
  } catch (e) { res.status(500).json({ error: 'No se pudo consultar el render' }); }
});

export default router;
