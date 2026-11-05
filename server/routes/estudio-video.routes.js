import express from 'express';
import crypto from 'crypto';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';
import { leerJson, guardarJson } from '../utils/asistente-personal.js';

// Estudio de vídeo: subes una voz en off (o un bruto), eliges un formato y un trabajador de vídeo lo monta.
// Cola de trabajos = un JSON por trabajo en el bucket privado "estudio-video" (sin migraciones de base de datos).
const router = express.Router();
router.use(authenticateToken, requirePermission('recursos'));
const BUCKET = 'estudio-video';
const RUTA_FORMATOS = 'crm/estudio-video/formatos.json';

let bucketListo = null;
const bucket = () => {
  if (!bucketListo) bucketListo = (async () => { const { data } = await supabase.storage.getBucket(BUCKET); if (!data) await supabase.storage.createBucket(BUCKET, { public: false }); })().catch(e => { bucketListo = null; throw e; });
  return bucketListo;
};
const st = () => supabase.storage.from(BUCKET);
const limpia = (t, n = 200) => String(t ?? '').trim().slice(0, n);

// Formato por defecto = el estilo "Dopamínico serio" que se ha ido afinando. Cada formato es una receta editable.
export const FORMATO_BASE = {
  id: 'dopaminico-serio', nombre: 'Dopamínico serio', descripcion: 'Cortes rápidos, zoom lento en cada plano, subtítulos pop de 1-2 palabras con las claves en dorado, barra de progreso. Serio y premium.',
  receta: { corte: { min: 0.9, max: 2.3 }, acento: '#F2C46D', zoomFinal: 1.14, whoosh: 0.16, flash: true, subs: { palabrasPorBloque: 2, tam: 104, margenV: 600 }, titulo: true, musica: false },
  notas: 'Vídeo serio y profesional, sin humor. Prioriza planos de calidad alta.',
};
// Sacado del vídeo de referencia "Suelos" (Dani): una toma limpia, subtítulos pequeños y blancos, sin efectos.
export const FORMATO_LIMPIO = {
  id: 'limpio-suelos', nombre: 'Limpio (estilo Suelos)', descripcion: 'Una toma a cámara sin efectos: subtítulos pequeños y blancos en minúscula, sin título, sin zooms ni destellos. Se centra en el contenido.',
  receta: { corte: { min: 1.5, max: 4 }, acento: '#FFFFFF', zoomFinal: 1, whoosh: 0, flash: false, subs: { palabrasPorBloque: 3, tam: 46, margenV: 620 }, titulo: false, barra: false, mayusculas: false, resaltar: false, musica: false },
  notas: 'Estilo limpio y serio: sin efectos ni adornos. El contenido manda.',
};
const SEMBRADOS = [FORMATO_BASE, FORMATO_LIMPIO];
async function formatos() {
  const f = await leerJson(RUTA_FORMATOS, null);
  if (!f?.lista?.length) { const lista = SEMBRADOS.map(x => JSON.parse(JSON.stringify(x))); await guardarJson(RUTA_FORMATOS, { lista, sembrados: lista.map(x => x.id) }); return lista; }
  // formatos nuevos de fábrica se añaden una sola vez (si luego los borras, no vuelven)
  const ya = new Set(f.sembrados || [FORMATO_BASE.id]); const nuevos = SEMBRADOS.filter(x => !ya.has(x.id));
  if (nuevos.length) { f.lista.push(...nuevos.map(x => JSON.parse(JSON.stringify(x)))); f.sembrados = [...ya, ...nuevos.map(x => x.id)]; await guardarJson(RUTA_FORMATOS, f); }
  return f.lista;
}
const guardarFormatos = async (lista) => { const f = await leerJson(RUTA_FORMATOS, {}); await guardarJson(RUTA_FORMATOS, { ...f, lista }); };

router.get('/formatos', async (req, res) => { try { res.json({ formatos: await formatos() }); } catch { res.status(500).json({ error: 'No se pudieron leer los formatos' }); } });
router.post('/formatos', async (req, res) => {
  try {
    const lista = await formatos(); const base = lista.find(x => x.id === req.body?.copiar_de) || FORMATO_BASE;
    const nombre = limpia(req.body?.nombre, 60); if (!nombre) return res.status(400).json({ error: 'Ponle un nombre al formato' });
    const nuevo = { ...JSON.parse(JSON.stringify(base)), id: crypto.randomUUID().slice(0, 8), nombre };
    lista.push(nuevo); await guardarFormatos(lista); res.status(201).json({ formato: nuevo });
  } catch { res.status(500).json({ error: 'No se pudo crear' }); }
});
router.put('/formatos/:id', async (req, res) => {
  try {
    const lista = await formatos(); const f = lista.find(x => x.id === req.params.id); if (!f) return res.status(404).json({ error: 'No existe ese formato' });
    const b = req.body || {}, r = b.receta || {};
    if (b.nombre !== undefined) f.nombre = limpia(b.nombre, 60) || f.nombre;
    if (b.descripcion !== undefined) f.descripcion = limpia(b.descripcion, 400);
    if (b.notas !== undefined) f.notas = limpia(b.notas, 1500);
    const num = (v, a, z, d) => Number.isFinite(Number(v)) ? Math.min(z, Math.max(a, Number(v))) : d;
    f.receta = f.receta || {};
    if (r.corte) f.receta.corte = { min: num(r.corte.min, 0.4, 6, f.receta.corte?.min ?? 0.9), max: num(r.corte.max, 0.8, 10, f.receta.corte?.max ?? 2.3) };
    if (r.acento && /^#[0-9a-fA-F]{6}$/.test(r.acento)) f.receta.acento = r.acento;
    if (r.zoomFinal !== undefined) f.receta.zoomFinal = num(r.zoomFinal, 1, 1.4, 1.14);
    if (r.whoosh !== undefined) f.receta.whoosh = num(r.whoosh, 0, 0.5, 0.16);
    if (r.flash !== undefined) f.receta.flash = !!r.flash;
    for (const k of ['titulo', 'barra', 'mayusculas', 'resaltar']) if (r[k] !== undefined) f.receta[k] = !!r[k];
    if (r.subs) f.receta.subs = { palabrasPorBloque: Math.round(num(r.subs.palabrasPorBloque, 1, 5, 2)), tam: Math.round(num(r.subs.tam, 50, 160, 104)), margenV: Math.round(num(r.subs.margenV, 200, 900, 600)) };
    await guardarFormatos(lista); res.json({ formato: f });
  } catch { res.status(500).json({ error: 'No se pudo guardar' }); }
});
router.delete('/formatos/:id', async (req, res) => {
  try { const lista = await formatos(); if (lista.length <= 1) return res.status(400).json({ error: 'Debe quedar al menos un formato' }); await guardarFormatos(lista.filter(x => x.id !== req.params.id)); res.json({ ok: true }); }
  catch { res.status(500).json({ error: 'No se pudo borrar' }); }
});

// Subida directa del archivo a Storage (no pasa por el servidor: los vídeos pueden pesar mucho)
router.post('/subida', async (req, res) => {
  try {
    await bucket();
    const nombre = limpia(req.body?.nombre, 120).replace(/[^\w.\-]+/g, '_') || 'archivo';
    const ruta = 'entradas/' + Date.now() + '_' + nombre;
    const { data, error } = await st().createSignedUploadUrl(ruta); if (error) throw error;
    res.json({ ruta, url: data.signedUrl, token: data.token });
  } catch (e) { res.status(500).json({ error: 'No se pudo preparar la subida: ' + (e.message || '') }); }
});

const rutaTrabajo = (id) => 'trabajos/' + id + '.json';
async function leerTrabajo(id) {
  const f = await st().createSignedUrl(rutaTrabajo(id), 30); if (!f.data?.signedUrl) return null;
  const r = await fetch(f.data.signedUrl + '&cb=' + Date.now(), { cache: 'no-store' }); return r.ok ? r.json() : null;
}
const guardarTrabajo = (t) => st().upload(rutaTrabajo(t.id), Buffer.from(JSON.stringify(t)), { contentType: 'application/json', upsert: true, cacheControl: '0' });

router.post('/trabajos', async (req, res) => {
  try {
    await bucket();
    const b = req.body || {}; const lista = await formatos(); const fmt = lista.find(x => x.id === b.formato);
    if (!fmt) return res.status(400).json({ error: 'Elige un formato' });
    if (!['voz', 'bruto'].includes(b.tipo)) return res.status(400).json({ error: 'Indica si subes una voz en off o un vídeo en bruto' });
    if (!/^entradas\//.test(b.archivo || '')) return res.status(400).json({ error: 'Falta el archivo subido' });
    const t = { id: crypto.randomUUID().slice(0, 8), creado: new Date().toISOString(), por: req.user?.name || req.user?.email || null, tipo: b.tipo, archivo: b.archivo, nombre_archivo: limpia(b.nombre_archivo, 120), formato: fmt.id, formato_nombre: fmt.nombre, receta: fmt.receta, notas_formato: fmt.notas || '', indicaciones: limpia(b.indicaciones, 800), estado: 'pendiente', progreso: 'En cola', version: 1, origen: b.origen || null };
    await guardarTrabajo(t); res.status(201).json({ trabajo: t });
  } catch (e) { res.status(500).json({ error: 'No se pudo crear el trabajo: ' + (e.message || '') }); }
});
router.get('/trabajos', async (req, res) => {
  try {
    await bucket();
    const { data } = await st().list('trabajos', { limit: 60, sortBy: { column: 'created_at', order: 'desc' } });
    const out = (await Promise.all((data || []).filter(f => /\.json$/.test(f.name)).map(f => leerTrabajo(f.name.replace(/\.json$/, ''))))).filter(Boolean);
    for (const t of out) if (t.resultado) { const u = await st().createSignedUrl(t.resultado, 3600); t.url = u.data?.signedUrl || null; const m = t.resultado_movil && await st().createSignedUrl(t.resultado_movil, 3600); t.url_movil = m?.data?.signedUrl || null; }
    out.sort((a, b) => String(b.creado).localeCompare(String(a.creado)));
    res.json({ trabajos: out });
  } catch { res.status(500).json({ error: 'No se pudo leer la lista' }); }
});
// Pedir cambios sobre un vídeo ya hecho: crea una versión nueva con las indicaciones añadidas
router.post('/trabajos/:id/rehacer', async (req, res) => {
  try {
    const o = await leerTrabajo(req.params.id); if (!o) return res.status(404).json({ error: 'No existe ese trabajo' });
    const cambios = limpia(req.body?.indicaciones, 800); if (!cambios) return res.status(400).json({ error: 'Cuéntame qué quieres cambiar' });
    const lista = await formatos(); const fmt = lista.find(x => x.id === (req.body?.formato || o.formato)) || { id: o.formato, nombre: o.formato_nombre, receta: o.receta, notas: o.notas_formato };
    const t = { ...o, id: crypto.randomUUID().slice(0, 8), creado: new Date().toISOString(), formato: fmt.id, formato_nombre: fmt.nombre, receta: fmt.receta, notas_formato: fmt.notas || '', indicaciones: (o.indicaciones ? o.indicaciones + '\nCAMBIOS PEDIDOS: ' : 'CAMBIOS PEDIDOS: ') + cambios, estado: 'pendiente', progreso: 'En cola', version: (o.version || 1) + 1, origen: o.id, resultado: null, resultado_movil: null, error: null, plan: null };
    await guardarTrabajo(t); res.status(201).json({ trabajo: t });
  } catch { res.status(500).json({ error: 'No se pudo crear la nueva versión' }); }
});
router.delete('/trabajos/:id', async (req, res) => {
  try {
    const o = await leerTrabajo(req.params.id); const rutas = [rutaTrabajo(req.params.id)];
    if (o?.resultado) rutas.push(o.resultado); if (o?.resultado_movil) rutas.push(o.resultado_movil);
    await st().remove(rutas); res.json({ ok: true });
  } catch { res.status(500).json({ error: 'No se pudo borrar' }); }
});

export default router;
