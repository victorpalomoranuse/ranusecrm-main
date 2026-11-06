import express from 'express';
import crypto from 'crypto';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';
import { leerJson, guardarJson } from '../utils/asistente-personal.js';
import * as drive from '../utils/drive-lectura.js';
import { nubeActiva, lanzarNube } from '../utils/nube.js';

// Estudio de vídeo: subes una voz en off (o un bruto), eliges un formato y un trabajador de vídeo lo monta.
// Cola de trabajos = un JSON por trabajo en el bucket privado "estudio-video" (sin migraciones de base de datos).
const router = express.Router();
// las miniaturas se cargan desde etiquetas <img>, que no pueden enviar cabeceras: se admite el token en la URL solo ahí
router.use((req, res, next) => { if (!req.headers.authorization && req.query.t && /^\/drive\/miniatura\//.test(req.path)) req.headers.authorization = 'Bearer ' + req.query.t; next(); });
router.use(authenticateToken, requirePermission('estudio_video'));
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
  receta: { corte: { min: 0.9, max: 2.3 }, acento: '#E3D2B8', zoomFinal: 1.14, whoosh: 0.16, flash: true, subs: { palabrasPorBloque: 2, tam: 84, margenV: 600 }, titulo: true, mayusculas: false, fuente: 'Montserrat', musica: { volumen: -12 } },
  notas: 'Vídeo serio y profesional, sin humor. Prioriza planos de calidad alta.',
};
// Sacado del vídeo de referencia "Suelos" (Dani): una toma limpia, subtítulos pequeños y blancos, sin efectos.
export const FORMATO_LIMPIO = {
  id: 'limpio-suelos', nombre: 'Limpio (estilo Suelos)', descripcion: 'Una toma a cámara sin efectos: subtítulos pequeños y blancos en minúscula, sin título, sin zooms ni destellos. Se centra en el contenido.',
  receta: { corte: { min: 1.5, max: 4 }, acento: '#FFFFFF', zoomFinal: 1, whoosh: 0, flash: false, subs: { palabrasPorBloque: 3, tam: 54, margenV: 620 }, titulo: false, barra: false, mayusculas: false, resaltar: false, fuente: 'Montserrat', musica: { volumen: -21 } },
  notas: 'Estilo limpio y serio: sin efectos ni adornos. El contenido manda.',
};
// Clips cortos con edición muy dinámica (para sacar varios vídeos de una entrevista larga): cortes y zooms rápidos, subtítulos grandes, gráficos y escenas superpuestas
export const FORMATO_CLIPS = {
  id: 'clips-dopaminicos', nombre: 'Clips dopamínicos (entrevista → varios clips)', descripcion: 'Edición rápida y llamativa para clips cortos: sin pausas, zooms in/out constantes que esconden los cortes, subtítulos grandes con la palabra clave resaltada, gráficos animados con cifras y escenas superpuestas si eliges recursos.',
  receta: { corte: { min: 1.2, max: 3 }, acento: '#E3D2B8', zoomFinal: 1.18, whoosh: 0, flash: false, subs: { palabrasPorBloque: 2, tam: 84, margenV: 600 }, titulo: false, barra: false, mayusculas: false, resaltar: true, whoosh: 0.14, flash: true, cambioCada: 2.6, encuadre: true, encuadreZoom: 1.4, subsBajoCara: true, graficos: true, pausa: 0.18, fuente: 'Rubik', limpiar: true, musica: { volumen: -12 } },
  notas: 'Ritmo muy alto y dinámico: cortes y zooms rápidos, sin pausas. Quita muletillas, repeticiones y errores. Gráficos cuando haya cifras o medidas. Si hay recursos, superpón escenas en los momentos clave.',
};
export const FORMATO_DINAMICO = {
  id: 'entrevista-dinamica', nombre: 'Entrevista dinámica', descripcion: 'Para vídeos hablando a cámara: sin pausas, plano centrado en la cara con zoom, subtítulos grandes bajo la cara y gráficos animados (cifra + icono) cuando se dice un dato.',
  receta: { corte: { min: 1.5, max: 4 }, acento: '#E3D2B8', zoomFinal: 1.12, whoosh: 0, flash: false, subs: { palabrasPorBloque: 2, tam: 76, margenV: 600 }, titulo: false, barra: false, mayusculas: false, resaltar: true, encuadre: true, encuadreZoom: 1.3, subsBajoCara: true, graficos: true, pausa: 0.28, fuente: 'Rubik', limpiar: true, musica: { volumen: -12 } },
  notas: 'Dinámico y fluido, serio y profesional. Quita repeticiones y errores. Los gráficos solo cuando aparece una cifra o medida importante.',
};
// Sacado del vídeo de referencia "mi día" (TikTok): un clip nuevo cada 2-3 s, literal a lo que dice la voz, en orden cronológico, con etiquetas de hora y subtítulos de 2-3 palabras en el centro.
export const FORMATO_DIA = {
  id: 'mi-dia-voz', nombre: 'Mi día / contar una historia (voz en off)', descripcion: 'Para documentar tu día o juntar clips y contar una historia con tu voz en off: un clip nuevo cada 2-3 s que ilustra literalmente lo que dices, en orden cronológico, con etiquetas de hora (9:00, 15:30…) y subtítulos de 2-3 palabras en el centro. Cortes secos, sin efectos.',
  receta: { introLetras: true, corte: { min: 1.2, max: 3 }, acento: '#FFFFFF', zoomFinal: 1, whoosh: 0, flash: false, subs: { palabrasPorBloque: 2, tam: 68, margenV: 880 }, titulo: false, barra: false, mayusculas: false, resaltar: false, horas: true, fuente: 'Montserrat', musica: { volumen: -15 } },
  notas: 'Cuenta la historia en ORDEN CRONOLÓGICO, como un día en la vida. Cada clip debe ser literal a lo que se dice en ese momento (si habla del desayuno, un clip del desayuno; de la oficina, la oficina; del gimnasio, el gimnasio). Ritmo ágil de clips cortos, cortes secos, sin zooms ni efectos: manda el contenido y la secuencia. Cuando la voz diga una hora, la etiqueta de hora entra en pantalla.',
};
const SEMBRADOS = [FORMATO_BASE, FORMATO_LIMPIO, FORMATO_DINAMICO, FORMATO_DIA, FORMATO_CLIPS];
async function formatos() {
  const f = await leerJson(RUTA_FORMATOS, null);
  if (!f?.lista?.length) { const lista = SEMBRADOS.map(x => JSON.parse(JSON.stringify(x))); await guardarJson(RUTA_FORMATOS, { lista, sembrados: lista.map(x => x.id) }); return lista; }
  if (!f.migracion) { for (const x of f.lista) { const r = x.receta || (x.receta = {}); if (r.acento === '#F2C46D') r.acento = '#E3D2B8'; if (r.mayusculas === undefined || r.mayusculas === true) r.mayusculas = false; if (!r.fuente) r.fuente = 'Montserrat'; if (!r.musica) r.musica = { volumen: -12 }; } f.migracion = 2; await guardarJson(RUTA_FORMATOS, f); }
  if (!f.musicaV2) { for (const x of f.lista) { const m = x.receta?.musica; if (m && typeof m === 'object' && Number.isFinite(Number(m.volumen))) m.volumen = Math.min(-12, Number(m.volumen) + 7); if (x.id === 'mi-dia-voz' && x.receta) x.receta.introLetras = true; } f.musicaV2 = true; await guardarJson(RUTA_FORMATOS, f); }
  if (!f.clipsV2) { const x = f.lista.find(z => z.id === FORMATO_CLIPS.id); if (x) x.receta = JSON.parse(JSON.stringify(FORMATO_CLIPS.receta)); f.clipsV2 = true; await guardarJson(RUTA_FORMATOS, f); }
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
    for (const k of ['titulo', 'barra', 'mayusculas', 'resaltar', 'encuadre', 'subsBajoCara', 'graficos', 'horas']) if (r[k] !== undefined) f.receta[k] = !!r[k];
    if (['Montserrat', 'Rubik'].includes(r.fuente)) f.receta.fuente = r.fuente;
    if (r.musica === false) f.receta.musica = false; else if (r.musica && Number.isFinite(Number(r.musica.volumen))) f.receta.musica = { volumen: num(r.musica.volumen, -40, -6, -19) };
    if (r.encuadreZoom !== undefined) f.receta.encuadreZoom = num(r.encuadreZoom, 1, 2, 1.3);
    if (r.pausa !== undefined) f.receta.pausa = num(r.pausa, 0.1, 1.2, 0.4);
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
    const ruta = (req.body?.tipo === 'musica' ? 'musica/' + nombre : 'entradas/' + Date.now() + '_' + nombre);
    if (req.body?.tipo !== 'musica') { try { const url = await drive.iniciaSubidaGcs(ruta, req.headers.origin); return res.json({ ruta, url, gcs: true }); } catch (e) { console.log('Subida GCS no disponible:', e.message); return res.status(500).json({ error: 'No se pudo preparar la subida a la nube: ' + e.message }); } }
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

// Biblioteca de música de fondo (instrumentales): se sube aquí y el trabajador analiza el tempo
router.get('/musica', async (req, res) => {
  try {
    await bucket(); const { data } = await st().list('musica', { limit: 200 });
    let idx = {}; try { const u = await st().createSignedUrl('crm-indice-musica.json', 30); if (u.data?.signedUrl) { const r = await fetch(u.data.signedUrl + '&cb=' + Date.now(), { cache: 'no-store' }); if (r.ok) idx = await r.json(); } } catch { /* sin análisis todavía */ }
    res.json({ pistas: (data || []).filter(f => /\.(mp3|mp4|m4a|wav|aac)$/i.test(f.name)).map(f => ({ nombre: f.name, tam: f.metadata?.size || null, ...(idx[f.name] || {}) })) });
  } catch { res.status(500).json({ error: 'No se pudo leer la música' }); }
});
router.delete('/musica/:nombre', async (req, res) => {
  try { await st().remove(['musica/' + req.params.nombre]); res.json({ ok: true }); }
  catch { res.status(500).json({ error: 'No se pudo borrar' }); }
});

// Explorador de Drive (solo lectura): carpetas, vídeos e imágenes con miniatura
router.get('/drive/raiz', async (req, res) => { try { res.json({ carpetas: (await drive.raiz()).map(f => ({ id: f.id, nombre: f.name })) }); } catch (e) { res.status(503).json({ error: e.message }); } });
router.get('/drive/carpeta/:id', async (req, res) => { try { if (!/^[\w-]{10,60}$/.test(req.params.id)) return res.status(400).json({ error: 'Carpeta no válida' }); res.json({ elementos: await drive.hijos(req.params.id) }); } catch (e) { res.status(503).json({ error: e.message }); } });
router.get('/drive/miniatura/:id', async (req, res) => { try { if (!/^[\w-]{10,60}$/.test(req.params.id)) return res.status(400).end(); const m = await drive.miniatura(req.params.id); if (!m) return res.status(404).end(); res.set('Content-Type', m.tipo); res.set('Cache-Control', 'private, max-age=3600'); res.send(m.datos); } catch { res.status(404).end(); } });

// Carpetas de recursos disponibles (las publica el trabajador a partir del índice de la biblioteca)
router.get('/carpetas', async (req, res) => {
  try { await bucket(); const u = await st().createSignedUrl('crm-indice-carpetas.json', 30); let lista = []; if (u.data?.signedUrl) { const r = await fetch(u.data.signedUrl + '&cb=' + Date.now(), { cache: 'no-store' }); if (r.ok) lista = await r.json(); } res.json({ carpetas: lista }); }
  catch { res.status(500).json({ error: 'No se pudieron leer las carpetas' }); }
});

router.post('/trabajos', async (req, res) => {
  try {
    await bucket();
    const b = req.body || {}; const lista = await formatos(); const fmt = lista.find(x => x.id === b.formato);
    if (!fmt) return res.status(400).json({ error: 'Elige un formato' });
    if (!['voz', 'bruto', 'base', 'clips'].includes(b.tipo)) return res.status(400).json({ error: 'Indica si subes una voz en off, un bruto o eliges un vídeo base' });
    if (b.tipo === 'base' || b.base?.id) { if (!/^[\w-]{10,60}$/.test(b.base?.id || '')) return res.status(400).json({ error: 'Elige el archivo de Drive' }); }
    else if (!/^entradas\//.test(b.archivo || '')) return res.status(400).json({ error: 'Falta el archivo subido' });
    const t = { id: crypto.randomUUID().slice(0, 8), creado: new Date().toISOString(), por: req.user?.name || req.user?.email || null, tipo: b.tipo, ...(b.tipo === 'clips' ? { num_clips: Math.max(0, Math.min(12, parseInt(b.num_clips) || 0)), dur_min: Math.max(10, Math.min(120, parseInt(b.dur_min) || 25)), dur_max: Math.max(15, Math.min(180, parseInt(b.dur_max) || 70)) } : {}), archivo: b.base?.id ? null : b.archivo, base: b.base?.id ? { id: limpia(b.base.id, 80), nombre: limpia(b.base.nombre, 160), ruta: limpia(b.base.ruta, 400) } : null, nombre_archivo: limpia(b.nombre_archivo, 120), formato: fmt.id, formato_nombre: fmt.nombre, receta: fmt.receta, notas_formato: fmt.notas || '', indicaciones: limpia(b.indicaciones, 800), musica: limpia(b.musica, 150) || 'auto', carpetas: (Array.isArray(b.carpetas) ? b.carpetas : []).slice(0, 30).map(c => limpia(c, 200)).filter(Boolean), recursos: (Array.isArray(b.recursos) ? b.recursos : []).slice(0, 60).map(x => ({ id: limpia(x?.id, 80), nombre: limpia(x?.nombre, 160), tipo: ['carpeta', 'video', 'imagen'].includes(x?.tipo) ? x.tipo : 'video', ruta: limpia(x?.ruta, 400) })).filter(x => x.id), estado: 'pendiente', progreso: 'En cola', version: 1, origen: b.origen || null };
    t.ejecutor = (await nubeActiva()) ? 'nube' : 'pc'; await guardarTrabajo(t);
    if (t.ejecutor === 'nube' && !(await lanzarNube(t.id))) { t.ejecutor = 'pc'; await guardarTrabajo(t); } // si Google no arranca, lo hace el PC
    res.status(201).json({ trabajo: t });
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
    const cambios = limpia(req.body?.indicaciones, 800);
    const lista = await formatos(); const fmt = lista.find(x => x.id === (req.body?.formato || o.formato)) || { id: o.formato, nombre: o.formato_nombre, receta: o.receta, notas: o.notas_formato };
    const recNuevos = Array.isArray(req.body?.recursos) ? req.body.recursos.slice(0, 60).map(x => ({ id: limpia(x?.id, 80), nombre: limpia(x?.nombre, 160), tipo: ['carpeta', 'video', 'imagen'].includes(x?.tipo) ? x.tipo : 'video', ruta: limpia(x?.ruta, 400) })).filter(x => x.id) : null;
    const b0 = req.body?.base; const baseNueva = b0?.id && /^[\w-]{10,60}$/.test(b0.id) && b0.id !== o.base?.id ? { id: limpia(b0.id, 80), nombre: limpia(b0.nombre, 160), ruta: limpia(b0.ruta, 400) } : null;
    const t = { ...o, ...(recNuevos ? { recursos: recNuevos } : {}), ...(baseNueva ? { base: baseNueva, archivo: null, nombre_archivo: baseNueva.nombre } : {}), id: crypto.randomUUID().slice(0, 8), creado: new Date().toISOString(), formato: fmt.id, formato_nombre: fmt.nombre, receta: fmt.receta, notas_formato: fmt.notas || '', indicaciones: cambios ? (o.indicaciones ? o.indicaciones + '\nCAMBIOS PEDIDOS: ' : 'CAMBIOS PEDIDOS: ') + cambios : ((o.indicaciones ? o.indicaciones + '\n' : '') + 'REGENERAR: monta una versión distinta con los mismos recursos (otra elección y orden de planos, otro ritmo).'), estado: 'pendiente', progreso: 'En cola', version: (o.version || 1) + 1, origen: o.id, resultado: null, resultado_movil: null, error: null, plan: null };
    t.ejecutor = (await nubeActiva()) ? 'nube' : 'pc'; await guardarTrabajo(t);
    if (t.ejecutor === 'nube' && !(await lanzarNube(t.id))) { t.ejecutor = 'pc'; await guardarTrabajo(t); } // si Google no arranca, lo hace el PC
    res.status(201).json({ trabajo: t });
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
