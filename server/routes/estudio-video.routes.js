import express from 'express';
import crypto from 'crypto';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';
import { leerJson, guardarJson } from '../utils/asistente-personal.js';
import * as drive from '../utils/drive-lectura.js';
import { nubeActiva, lanzarNube } from '../utils/nube.js';
import { callClaude } from '../utils/anthropic.js';

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
  receta: { corte: { min: 1.2, max: 3 }, acento: '#E3D2B8', zoomFinal: 1.18, whoosh: 0, flash: false, subs: { palabrasPorBloque: 3, tam: 84, margenV: 600 }, estiloSubs: 'karaoke', titulo: false, barra: false, mayusculas: false, resaltar: true, whoosh: 0.14, flash: true, cambioCada: 2.6, encuadre: true, encuadreZoom: 1.4, subsBajoCara: true, graficos: true, pausa: 0.18, fuente: 'Rubik', limpiar: true, musica: { volumen: -12 } },
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
  receta: { introLetras: true, corte: { min: 1.8, max: 3.5 }, acento: '#FFFFFF', zoomFinal: 1, whoosh: 0, flash: false, subs: { palabrasPorBloque: 2, tam: 86, margenV: 820 }, titulo: false, barra: false, mayusculas: false, resaltar: false, horas: true, fuente: 'Montserrat', musica: { volumen: -15 } },
  notas: 'Cuenta la historia en ORDEN CRONOLÓGICO, como un día en la vida. Cada clip debe ser literal a lo que se dice en ese momento (si habla del desayuno, un clip del desayuno; de la oficina, la oficina; del gimnasio, el gimnasio). Ritmo ágil de clips cortos, cortes secos, sin zooms ni efectos: manda el contenido y la secuencia. Cuando la voz diga una hora, la etiqueta de hora entra en pantalla.',
};
// One take: un solo plano seguido, solo limpiado (sin b-roll, sin zooms ni cortes visibles), con subtítulos y música suave.
export const FORMATO_ONETAKE = {
  id: 'one-take', nombre: 'One take (un solo plano, limpio)', descripcion: 'Para alguien hablando a cámara de una sola toma: se quitan pausas, muletillas y tomas falladas, sin b-roll ni zooms. Subtítulos karaoke y música suave.',
  receta: { corte: { min: 4, max: 10 }, acento: '#E3D2B8', zoomFinal: 1, whoosh: 0, flash: false, cambioCada: 9999, subs: { palabrasPorBloque: 3, tam: 80, margenV: 640 }, estiloSubs: 'karaoke', titulo: false, barra: false, mayusculas: false, resaltar: true, encuadre: false, subsBajoCara: true, graficos: false, pausa: 0.45, fuente: 'Montserrat', limpiar: true, musica: { volumen: -18 } },
  notas: 'Un solo plano continuo: no añadir b-roll ni efectos. Quitar pausas largas, muletillas, tropiezos y tomas repetidas (quedarse con la mejor toma de cada frase). Subtítulos grandes, música suave por debajo.',
};
// Collage b-roll: voz en off con clips de la biblioteca; en algunos cortes se ven dos clips a la vez (uno arriba y otro abajo).
export const FORMATO_COLLAGE = {
  id: 'collage-broll', nombre: 'Collage b-roll (dos clips a la vez)', descripcion: 'Voz en off con tus clips: en cortes alternos se ven dos clips a la vez, uno sobre otro, mientras habla la voz. Más dinámico y con más material en pantalla.',
  receta: { collage: true, introLetras: true, corte: { min: 1.8, max: 3.5 }, acento: '#FFFFFF', zoomFinal: 1, whoosh: 0, flash: false, subs: { palabrasPorBloque: 2, tam: 86, margenV: 820 }, titulo: false, barra: false, mayusculas: false, resaltar: false, horas: false, fuente: 'Montserrat', musica: { volumen: -15 } },
  notas: 'Cuenta la historia en orden con los clips elegidos. Cada clip literal a lo que se dice. Ritmo ágil, cortes secos, sin efectos.',
};
// ── Estilos de edición: la parte «cómo se ve y se mueve» (cortes, zooms, subtítulos, música…). Un FORMATO es el tipo de vídeo (entrevista → reels, voz en off, un solo plano…)
// y elige un estilo; dos formatos distintos pueden compartir estilo.
const RUTA_ESTILOS = 'crm/estudio-video/estilos.json';
const ESTRUCTURALES = ['collage', 'preguntaSoloEscrita', 'layout', 'inserciones'];
const sinEstructura = (r) => { const o = JSON.parse(JSON.stringify(r || {})); for (const k of ESTRUCTURALES) delete o[k]; return o; };
async function estilos() {
  const e = await leerJson(RUTA_ESTILOS, null);
  if (e?.lista?.length) return e.lista;
  const fl = await formatos(); const lista = fl.map(f => ({ id: f.id, nombre: f.nombre, descripcion: f.descripcion || '', receta: sinEstructura(f.receta) }));
  await guardarJson(RUTA_ESTILOS, { lista }); return lista;
}
const guardarEstilos = (lista) => guardarJson(RUTA_ESTILOS, { lista });
// La receta con la que se monta un vídeo = la del formato (parte estructural) + la del estilo elegido (parte visual)
async function recetaFinal(fmt, estiloId) {
  const base = JSON.parse(JSON.stringify(fmt?.receta || {})), id = estiloId || fmt?.estilo || fmt?.id;
  const e = id ? (await estilos()).find(x => x.id === id) : null;
  return { receta: e ? { ...base, ...JSON.parse(JSON.stringify(e.receta || {})) } : base, estilo: e ? { id: e.id, nombre: e.nombre } : null };
}
export const FORMATO_AUTO = {
  id: 'auto-redes', nombre: '🤖 Dirigido por la IA de redes (automático)', descripcion: 'No es un formato fijo: la IA de redes decide cómo montarlo según lo que mejor te funciona en tu cuenta y en el nicho, tu voz y tus preferencias. Se va afinando solo con lo que aprende.',
  receta: { corte: { min: 1.2, max: 3 }, acento: '#E3D2B8', zoomFinal: 1.12, whoosh: 0.1, flash: false, subs: { palabrasPorBloque: 3, tam: 84, margenV: 600 }, estiloSubs: 'karaoke', titulo: false, barra: false, mayusculas: false, resaltar: true, director: true, cambiosEnFrases: true },
  notas: '',
};
const SEMBRADOS = [FORMATO_BASE, FORMATO_LIMPIO, FORMATO_DINAMICO, FORMATO_DIA, FORMATO_CLIPS, FORMATO_ONETAKE, FORMATO_COLLAGE];
async function formatos() {
  const f = await leerJson(RUTA_FORMATOS, null);
  if (!f?.lista?.length) { const lista = SEMBRADOS.map(x => JSON.parse(JSON.stringify(x))); await guardarJson(RUTA_FORMATOS, { lista, sembrados: lista.map(x => x.id) }); return lista; }
  if (!f.migracion) { for (const x of f.lista) { const r = x.receta || (x.receta = {}); if (r.acento === '#F2C46D') r.acento = '#E3D2B8'; if (r.mayusculas === undefined || r.mayusculas === true) r.mayusculas = false; if (!r.fuente) r.fuente = 'Montserrat'; if (!r.musica) r.musica = { volumen: -12 }; } f.migracion = 2; await guardarJson(RUTA_FORMATOS, f); }
  if (!f.musicaV2) { for (const x of f.lista) { const m = x.receta?.musica; if (m && typeof m === 'object' && Number.isFinite(Number(m.volumen))) m.volumen = Math.min(-12, Number(m.volumen) + 7); if (x.id === 'mi-dia-voz' && x.receta) x.receta.introLetras = true; } f.musicaV2 = true; await guardarJson(RUTA_FORMATOS, f); }
  if (!f.diaV3) { const x = f.lista.find(z => z.id === 'mi-dia-voz'); if (x?.receta) { x.receta.corte = { min: 1.8, max: 3.5 }; x.receta.subs = { ...(x.receta.subs || {}), tam: 86, margenV: 820 }; } f.diaV3 = true; await guardarJson(RUTA_FORMATOS, f); }
  // Mi día: movimiento variado en los planos y etiquetas animadas (sin flashes); el título de apertura va como un subtítulo más
  if (!f.motionV1) { const x = f.lista.find(z => z.id === 'mi-dia-voz'); if (x?.receta) { x.receta.motion = true; x.receta.flash = false; x.receta.introLetras = false; x.receta.subs = { ...(x.receta.subs || {}), tam: 72 }; } f.motionV1 = true; await guardarJson(RUTA_FORMATOS, f); }
  // Mi día: limpio pero dinámico (sin tarjetas, etiquetas ni destellos; cortes ágiles, movimiento variado y un sonido sutil en cada corte)
  if (!f.diaV4) { const x = f.lista.find(z => z.id === 'mi-dia-voz'); if (x?.receta) { Object.assign(x.receta, { corte: { min: 1.4, max: 2.8 }, zoomFinal: 1.14, whoosh: 0.1, flash: false, motion: true, etiquetas: false, aperturaPremium: false, introLetras: false, estiloSubs: 'normal' }); } f.diaV4 = true; await guardarJson(RUTA_FORMATOS, f); }
  // Mi día: cambio de plano cada ~3 s
  if (!f.diaV5) { const x = f.lista.find(z => z.id === 'mi-dia-voz'); if (x?.receta) x.receta.corte = { min: 2.0, max: 3.2 }; f.diaV5 = true; await guardarJson(RUTA_FORMATOS, f); }
  // Sin destellos blancos en los cortes (Víctor: «hace todo el rato flashes, no tiene sentido») y cambios de plano al ritmo del habla
  if (!f.sinFlashV1) { for (const x of f.lista) { const r = x.receta || (x.receta = {}); r.flash = false; if (x.id === 'clips-dopaminicos' || x.id === 'entrevista-dinamica') { r.cambiosEnFrases = true; r.cambioCada = Math.max(Number(r.cambioCada) || 0, 4.2); } } f.sinFlashV1 = true; await guardarJson(RUTA_FORMATOS, f); }
  if (!f.directorV1) { for (const x of f.lista) { const r = x.receta || (x.receta = {}); r.director = true; r.cambiosEnFrases = true; if (['dopaminico-serio', 'clips-dopaminicos', 'entrevista-dinamica'].includes(x.id)) r.flash = true; } f.directorV1 = true; await guardarJson(RUTA_FORMATOS, f); const e = await leerJson(RUTA_ESTILOS, null); if (e?.lista) { for (const s of e.lista) { const r = s.receta || (s.receta = {}); r.director = true; r.cambiosEnFrases = true; if (['dopaminico-serio', 'clips-dopaminicos', 'entrevista-dinamica'].includes(s.id)) r.flash = true; } await guardarJson(RUTA_ESTILOS, e); } }
  if (!f.clipsV3) { const x = f.lista.find(z => z.id === 'clips-dopaminicos'); if (x?.receta) { x.receta.estiloSubs = 'karaoke'; x.receta.subs = { ...(x.receta.subs || {}), palabrasPorBloque: 3 }; } f.clipsV3 = true; await guardarJson(RUTA_FORMATOS, f); }
  if (!f.clipsV2) { const x = f.lista.find(z => z.id === FORMATO_CLIPS.id); if (x) x.receta = JSON.parse(JSON.stringify(FORMATO_CLIPS.receta)); f.clipsV2 = true; await guardarJson(RUTA_FORMATOS, f); }
  if (!f.autoV1) { if (!f.lista.some(x => x.id === FORMATO_AUTO.id)) f.lista.unshift(JSON.parse(JSON.stringify(FORMATO_AUTO))); f.autoV1 = true; f.sembrados = [...(f.sembrados || []), FORMATO_AUTO.id]; await guardarJson(RUTA_FORMATOS, f); }
  // formatos nuevos de fábrica se añaden una sola vez (si luego los borras, no vuelven)
  const ya = new Set(f.sembrados || [FORMATO_BASE.id]); const nuevos = SEMBRADOS.filter(x => !ya.has(x.id));
  if (nuevos.length) { f.lista.push(...nuevos.map(x => JSON.parse(JSON.stringify(x)))); f.sembrados = [...ya, ...nuevos.map(x => x.id)]; await guardarJson(RUTA_FORMATOS, f); }
  return f.lista;
}
const guardarFormatos = async (lista) => { const f = await leerJson(RUTA_FORMATOS, {}); await guardarJson(RUTA_FORMATOS, { ...f, lista }); };

// Voz y reglas de marca de Ranuse: texto editable que se aplica a todo lo que escribe o decide la IA del Estudio
const RUTA_REGLAS = 'crm/estudio-video/reglas.json';
const REGLAS_BASE = 'Ranuse Design diseña y monta gimnasios y espacios deportivos (home gyms, gimnasios profesionales, vestuarios, zonas wellness). Se presenta como experto con criterio y experiencia real de obra.\nTONO: serio, directo y profesional; cercano pero sin exageraciones; nada de clickbait vacío, exclamaciones ni promesas que no se cumplen. Se habla de tú.\nLO QUE SE QUIERE TRANSMITIR: autoridad (proyectos reales, cifras, medidas, errores comunes que evita el equipo), calidad y cuidado por el detalle, y confianza para que un cliente nos escriba.\nTEMAS QUE FUNCIONAN: errores al montar un gimnasio, cuánto cuesta y cuánto espacio hace falta, mezclar marcas de máquinas o no, distribución y circulaciones, suelos y acústica, antes y después de obras, el día a día del equipo.\nEVITAR: prometer precios o plazos concretos sin dato, criticar a marcas o competidores por su nombre, tecnicismos sin explicar.\nCIERRE HABITUAL: invitar a seguir para ver el proceso o a escribirnos para su proyecto.';
const textoReglas = async () => { try { const r = await leerJson(RUTA_REGLAS, null); return typeof r?.texto === 'string' ? r.texto : REGLAS_BASE; } catch { return REGLAS_BASE; } };
// ── El editor habla con Víctor, APRENDE sus preferencias y las aplica solo (memoria propia; llega a todos los vídeos nuevos y a los que se rehacen)
const RUTA_EDITOR = 'crm/estudio-video/editor.json';
const memoriaEditor = async () => { try { const m = await leerJson(RUTA_EDITOR, null); return { hechos: Array.isArray(m?.hechos) ? m.hechos : [], charla: Array.isArray(m?.charla) ? m.charla : [] }; } catch { return { hechos: [], charla: [] }; } };
const guardaEditor = (m) => guardarJson(RUTA_EDITOR, { hechos: m.hechos.slice(-80), charla: m.charla.slice(-60), actualizado: new Date().toISOString() });
const textoReglasCompleto = async () => {
  const base = await textoReglas(); let m = { hechos: [] }; try { m = await memoriaEditor(); } catch { /* sin memoria */ }
  const ap = m.hechos.slice(-60).map(h => '- ' + h.texto).join('\n');
  let redes = ''; try {
    const a = await leerJson('crm/redes/aprendizaje.json', null), v = await leerJson('crm/redes/analisis_videos.json', null);
    const vz = await leerJson('crm/redes/voz_marca.json', null); const vozL = vz ? ['Su voz real: ' + vz.resumen, ...(vz.evitar || []).map(x => 'No suena a él: ' + x)] : [];
    const refs = await leerJson('crm/redes/referencias.json', { lista: [] }); const refL = (refs.lista || []).slice(-6).flatMap(r => (r.replicar || []).slice(0, 2).map(x => 'De un referente (' + r.nombre + '): ' + x));
    const l = [...vozL, ...refL, ...(a?.para_el_editor || []), ...(a?.ganchos_ganadores || []).map(x => 'Gancho que le funciona: ' + x), ...(v?.reglas_edicion || [])].slice(0, 16);
    if (l.length) redes = '\n\nLO APRENDIDO DE SUS REDES (de sus reels reales y de su nicho; úsalo como criterio de edición y de gancho salvo que choque con sus preferencias):\n' + l.map(x => '- ' + x).join('\n');
  } catch { /* sin datos de redes */ }
  return base + redes + (ap ? '\n\nPREFERENCIAS QUE EL EDITOR HA APRENDIDO DE VÍCTOR (las ha ido aprendiendo hablando con él; son obligatorias, por encima de lo anterior si chocan):\n' + ap : '');
};
const normE = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
router.get('/editor', async (req, res) => { try { const m = await memoriaEditor(); res.json({ hechos: m.hechos, charla: m.charla.slice(-30) }); } catch { res.status(500).json({ error: 'No se pudo leer la memoria del editor' }); } });
router.delete('/editor/hechos/:id', async (req, res) => { try { const m = await memoriaEditor(); m.hechos = m.hechos.filter(h => h.id !== req.params.id); await guardaEditor(m); res.json({ ok: true, hechos: m.hechos }); } catch { res.status(500).json({ error: 'No se pudo borrar' }); } });
router.delete('/editor/charla', async (req, res) => { try { const m = await memoriaEditor(); m.charla = []; await guardaEditor(m); res.json({ ok: true }); } catch { res.status(500).json({ error: 'No se pudo borrar' }); } });
router.post('/editor/chat', async (req, res) => {
  try {
    const msg = limpia(req.body?.mensaje, 2000); if (!msg) return res.status(400).json({ error: 'Escribe algo al editor' });
    const mem = await memoriaEditor(), lista = await estilos();
    let video = ''; const tid = limpia(req.body?.trabajo, 20);
    if (tid) { const o = await leerTrabajo(tid); if (o) video = 'VÍDEO DEL QUE HABLAN: «' + (o.nombre_archivo || o.id) + '» (' + o.tipo + ', formato ' + (o.formato_nombre || o.formato) + ', estilo ' + (o.estilo_nombre || 'el del formato') + ', estado ' + o.estado + ').' + (o.analisis_edicion?.analisis ? ' Tu análisis de entonces: ' + JSON.stringify(o.analisis_edicion.analisis).slice(0, 1800) + ' Efectos que pusiste: ' + JSON.stringify((o.analisis_edicion.efectos || []).slice(0, 14)) : '') + (o.autorevision?.resumen ? ' Revisión de la IA: ' + o.autorevision.resumen : '') + (o.error ? ' Error: ' + String(o.error).slice(0, 200) : ''); }
    const resumenEstilo = (e) => e.id + ' = «' + e.nombre + '»: ' + JSON.stringify({ corte: e.receta?.corte, zoomFinal: e.receta?.zoomFinal, flash: e.receta?.flash, whoosh: e.receta?.whoosh, cambioCada: e.receta?.cambioCada, intensidad: e.receta?.intensidad, subs: e.receta?.subs, estiloSubs: e.receta?.estiloSubs, motion: e.receta?.motion });
    const system = 'Eres el editor jefe de vídeo de Ranuse Design (diseño de gimnasios y espacios deportivos): un profesional del montaje y de las redes sociales, con ojo para lo que se hace viral, que habla DIRECTAMENTE con Víctor. Tienes memoria propia y APRENDES: cada corrección, gusto o criterio que te dé lo conviertes en una regla clara que aplicarás en todos los vídeos futuros, sin que él tenga que repetirlo ni encender nada.\n\n' +
      'CÓMO HABLAS: español de España, natural, cercano y directo, como un compañero de estudio con criterio. Breve (3-6 frases salvo que pida más). Nada de fórmulas de atención al cliente. Opina, razona y propón; si te pide algo que va contra lo que funciona en redes, díselo con tacto y propón alternativa; si falta un dato importante, pregunta UNA cosa.\n\n' +
      'LO QUE YA HAS APRENDIDO (tu memoria):\n' + (mem.hechos.map(h => '[' + h.id + '] ' + h.texto).join('\n') || '(todavía nada)') + '\n\n' +
      'ESTILOS DE EDICIÓN que puedes ajustar (campos de receta que puedes cambiar: corte{min,max}, zoomFinal, whoosh (volumen de sonidos 0-0.5, 0 = sin sonidos), flash (true = el editor puede usar destellos donde tenga sentido), cambioCada (segundos entre cambios de plano), intensidad ("sobria"|"media"|"alta": cuántos efectos), ilustraciones (true/false), subs{tam,palabrasPorBloque,margenV}, estiloSubs, musica{volumen}, motion, titulo, barra, mayusculas, resaltar, encuadre, graficos):\n' + lista.map(resumenEstilo).join('\n') + '\n\n' +
      'CÓMO ACTÚAS: respondes con JSON {"respuesta": "tu mensaje a Víctor", "acciones": [...]}. Acciones posibles: {"tipo":"recordar","texto":"regla clara y reutilizable, en imperativo, sin referirse a un vídeo concreto"} cuando te dé una preferencia o corrección (no dupliques: si ya existe algo parecido usa {"tipo":"reemplazar","id":"...","texto":"..."}); {"tipo":"olvidar","id":"..."} si te dice que ya no vale; {"tipo":"estilo","id":"id del estilo","receta":{...solo los campos que cambian...}} cuando pida cambiar cómo se ve o se mueve algo (por ejemplo «menos zoom» → baja zoomFinal; «más ritmo» → baja cambioCada; «sin flashes» → flash false). Si lo que pide NO cabe en un campo de la receta (por ejemplo «flashes solo en el remate» o «las cifras siempre en grande»), cambia lo que puedas del estilo Y ADEMÁS guárdalo con «recordar» para que el director de edición lo cumpla. Si solo conversáis, acciones vacío. En «respuesta» di claramente qué has aprendido o cambiado.';
    const historial = mem.charla.slice(-14).map(m => ({ role: m.rol === 'yo' ? 'user' : 'assistant', content: m.texto }));
    const r = await callClaude({ system, messages: [...historial, { role: 'user', content: (video ? video + '\n\n' : '') + msg }], maxTokens: 2500 });
    const txt = (r.content || []).map(b => b.text || '').join(''); let j; try { j = JSON.parse(/\{[\s\S]*\}/.exec(txt)[0]); } catch { j = { respuesta: txt.trim(), acciones: [] }; }
    const cambios = []; let estilosCambiados = false;
    for (const a of (Array.isArray(j.acciones) ? j.acciones : []).slice(0, 8)) {
      const texto = limpia(a?.texto, 320);
      if (a?.tipo === 'recordar' && texto) { const n = normE(texto); if (!mem.hechos.some(h => normE(h.texto) === n)) { mem.hechos.push({ id: crypto.randomUUID().slice(0, 6), texto, fecha: new Date().toISOString().slice(0, 10) }); cambios.push('Aprendido: ' + texto); } }
      else if (a?.tipo === 'reemplazar' && texto) { const h = mem.hechos.find(x => x.id === a.id); if (h) { h.texto = texto; h.fecha = new Date().toISOString().slice(0, 10); cambios.push('Actualizado: ' + texto); } }
      else if (a?.tipo === 'olvidar') { const n0 = mem.hechos.length; mem.hechos = mem.hechos.filter(h => h.id !== a.id); if (mem.hechos.length < n0) cambios.push('Olvidado un criterio'); }
      else if (a?.tipo === 'estilo' && a.receta && typeof a.receta === 'object') { const e = lista.find(x => x.id === a.id) || lista.find(x => normE(x.nombre) === normE(a.id)); if (e) { e.receta = e.receta || {}; aplicaReceta(e, a.receta); estilosCambiados = true; cambios.push('Estilo «' + e.nombre + '» ajustado: ' + Object.keys(a.receta).join(', ')); } }
    }
    if (estilosCambiados) await guardarEstilos(lista);
    const respuesta = limpia(j.respuesta, 3000) || 'Hecho.';
    mem.charla.push({ rol: 'yo', texto: msg, t: Date.now() }, { rol: 'ia', texto: respuesta, cambios, t: Date.now() });
    await guardaEditor(mem);
    res.json({ respuesta, cambios, hechos: mem.hechos });
  } catch (e) { console.error('editor/chat', e); res.status(500).json({ error: 'El editor no ha podido contestar: ' + String(e.message || '').slice(0, 160) }); }
});
// Duración de los clips que ayuda a crecer: sale del análisis de edición de sus reels (si existe); si no, un rango habitual para reels que crecen
async function direccionRedes() {
  const [vid, ap, voz, prefs, ref] = await Promise.all([leerJson('crm/redes/analisis_videos.json', null), leerJson('crm/redes/aprendizaje.json', null), leerJson('crm/redes/voz_marca.json', null), leerJson('crm/redes/preferencias.json', { reglas: [] }), leerJson('crm/redes/referencias.json', { lista: [] })]);
  const receta = {}; const ritmo = Number(String(vid?.ritmo_ideal || '').match(/[0-9]+([.,][0-9]+)?/)?.[0]?.replace(',', '.'));
  if (Number.isFinite(ritmo) && ritmo >= 0.6 && ritmo <= 8) receta.corte = { min: Math.max(0.6, Math.round(ritmo * 0.7 * 10) / 10), max: Math.round(ritmo * 1.6 * 10) / 10 };
  const l = [];
  if (vid?.resumen) l.push('Lo que marca la diferencia en SUS reels (analizado de verdad): ' + vid.resumen);
  for (const x of [...(vid?.reglas_edicion || []), ...(ap?.para_el_editor || [])].slice(0, 10)) l.push('- ' + x);
  for (const x of (ap?.ganchos_ganadores || []).slice(0, 4)) l.push('- Gancho que le funciona: ' + x);
  for (const r of (ref?.lista || []).slice(-6)) for (const x of (r.replicar || []).slice(0, 2)) l.push('- De un referente (' + r.nombre + '): ' + x);
  if (voz) l.push('Su voz: ' + voz.resumen + (voz.muletillas?.length ? ' Muletillas reales: ' + voz.muletillas.join(', ') + '.' : ''));
  const no = (prefs.reglas || []).filter(r => r.tipo === 'no').map(r => r.texto); if (no.length) l.push('NO quiere: ' + no.join('; '));
  return { receta, notas: 'DIRIGIDO POR LA IA DE REDES: decide el montaje (ritmo, gancho, qué se queda, énfasis) aplicando esto, que se ha aprendido de su cuenta y del nicho; no sigas un molde fijo.\n' + l.join('\n') };
}
const duracionIdeal = async () => { try { const v = await leerJson('crm/redes/analisis_videos.json', null); const n = String(v?.duracion_ideal_s || '').match(/d+/g)?.map(Number) || []; if (n.length >= 2 && n[0] < n[1]) return [Math.max(10, n[0]), Math.min(120, Math.max(n[1], n[0] + 10))]; if (n.length === 1) return [Math.max(10, n[0] - 8), Math.min(120, n[0] + 12)]; } catch { /* sin análisis */ } return [20, 50]; };
router.get('/reglas', async (req, res) => { try { res.json({ texto: await textoReglas(), base: REGLAS_BASE }); } catch { res.status(500).json({ error: 'No se pudieron leer las reglas' }); } });
router.put('/reglas', async (req, res) => { try { await guardarJson(RUTA_REGLAS, { texto: limpia(req.body?.texto, 3500), actualizado: new Date().toISOString() }); res.json({ ok: true }); } catch { res.status(500).json({ error: 'No se pudieron guardar las reglas' }); } });
// ---------- Ideas de contenido y calendario (departamento de redes) ----------
const RUTA_IDEAS = 'crm/estudio-video/ideas.json';
const MANUAL_REDES = 'MANUAL DE REDES (aplícalo): gancho en los 1-3 primeros segundos que funcione por tres canales (lo que se ve, las primeras palabras y el texto en pantalla) y se entienda sin sonido; una sola idea por vídeo; gancho -> desarrollo con bucles abiertos -> remate que cumple lo prometido -> una sola llamada a la acción ligada al valor; duración ideal 20-35 s (unas 75 palabras cada 30 s); cambio visual cada 2-4 s; palabras clave en las primeras palabras y en el texto; lo que más se comparte: datos y cifras, errores comunes, secretos del oficio, antes/después, opiniones con carácter e historias reales con resultado; nunca prometer algo que el vídeo no cumple.';
const leerIdeas = async () => { const j = await leerJson(RUTA_IDEAS, null); return Array.isArray(j?.lista) ? j.lista : []; };
router.get('/ideas', async (req, res) => { try { res.json({ ideas: await leerIdeas() }); } catch { res.status(500).json({ error: 'No se pudieron leer las ideas' }); } });
router.post('/ideas/generar', async (req, res) => {
  try {
    const tema = limpia(req.body?.tema, 400), cantidad = Math.max(1, Math.min(10, parseInt(req.body?.cantidad) || 6));
    const previas = await leerIdeas(); const reglas = await textoReglas();
    const sistema = 'Eres el estratega de contenido de Ranuse Design (diseño y montaje de gimnasios y espacios deportivos). Piensas como un equipo de redes de primer nivel: ideas que se pueden grabar con un móvil o con material que Ranuse ya tiene (obras, proyectos, entrevistas con alguien del equipo, el día a día del equipo). NO pongas nombres propios de otras personas (como Dani) en titulares, ganchos ni preguntas salvo que Víctor te lo pida: Víctor es la cara de la cuenta y las preguntas deben poder hacerse a cámara o a quien sea. Respondes SIEMPRE en español y SOLO con JSON.\n\n' + MANUAL_REDES + '\n\nVOZ Y REGLAS DE MARCA DE RANUSE (obligatorias):\n' + reglas;
    const usuario = 'Dame ' + cantidad + ' ideas de vídeos cortos (Reels, TikTok y Shorts)' + (tema ? ' sobre: ' + tema : ' variadas para esta semana') + '. Mezcla formatos (entrevista pregunta-respuesta, hablando a cámara, "un día conmigo", antes y después, error común, dato con cifra). No repitas estas ideas ya hechas: ' + (previas.slice(-25).map(x => x.titulo).join(' | ') || 'ninguna') + '.\n\nResponde SOLO con JSON: {"ideas":[{"titulo":"título gancho en pantalla (máx 9 palabras)","gancho":"frase exacta de apertura (primeros 3 s)","guion":"guion completo para decir en voz alta, 60-90 palabras, con gancho, desarrollo, remate y una llamada a la acción","formato":"entrevista | a cámara | acompáñame (día) | antes y después | tutorial | otro","plataforma":"Reels | TikTok | Shorts | todas","razon":"una frase: por qué funcionaría","que_grabar":"qué hay que grabar o qué material de Drive usar"}]}';
    const r = await callClaude({ system: sistema, messages: [{ role: 'user', content: usuario }], maxTokens: 6000 });
    const txt = (r.content || []).map(b => b.text || '').join(''); const j = JSON.parse(/\{[\s\S]*\}/.exec(txt)[0]);
    const nuevas = (j.ideas || []).slice(0, cantidad).map(x => ({ id: crypto.randomUUID().slice(0, 8), titulo: limpia(x.titulo, 120), gancho: limpia(x.gancho, 300), guion: limpia(x.guion, 1800), formato: limpia(x.formato, 40), plataforma: limpia(x.plataforma, 30), razon: limpia(x.razon, 300), que_grabar: limpia(x.que_grabar, 400), estado: 'idea', fecha: null, notas: '', creada: new Date().toISOString() })).filter(x => x.titulo);
    await guardarJson(RUTA_IDEAS, { lista: [...previas, ...nuevas] }); res.json({ ideas: await leerIdeas(), nuevas: nuevas.length });
  } catch (e) { res.status(500).json({ error: 'No se pudieron generar las ideas: ' + String(e.message || '').slice(0, 160) }); }
});
router.put('/ideas/:id', async (req, res) => {
  try {
    const lista = await leerIdeas(); const x = lista.find(i => i.id === req.params.id); if (!x) return res.status(404).json({ error: 'No existe esa idea' });
    const b = req.body || {};
    if (['idea', 'grabar', 'editando', 'publicado', 'descartada'].includes(b.estado)) x.estado = b.estado;
    if (b.fecha === null || /^\d{4}-\d{2}-\d{2}$/.test(b.fecha || '')) x.fecha = b.fecha;
    if (b.notas !== undefined) x.notas = limpia(b.notas, 1000);
    if (b.guion !== undefined) x.guion = limpia(b.guion, 1800);
    if (b.titulo !== undefined) x.titulo = limpia(b.titulo, 120) || x.titulo;
    await guardarJson(RUTA_IDEAS, { lista }); res.json({ idea: x });
  } catch { res.status(500).json({ error: 'No se pudo guardar' }); }
});
router.delete('/ideas/:id', async (req, res) => { try { const lista = (await leerIdeas()).filter(i => i.id !== req.params.id); await guardarJson(RUTA_IDEAS, { lista }); res.json({ ok: true }); } catch { res.status(500).json({ error: 'No se pudo borrar' }); } });
// Guionizador: escribe el guion completo de un reel o de una historia con el manual de redes y las reglas de marca
router.post('/guionizador', async (req, res) => {
  try {
    const b = req.body || {}; const tema = limpia(b.tema, 600); if (!tema) return res.status(400).json({ error: 'Escribe de qué va el vídeo' });
    const tipo = b.tipo === 'historia' ? 'historia' : 'reel'; const seg = Math.max(10, Math.min(120, parseInt(b.duracion) || (tipo === 'historia' ? 60 : 30)));
    const modo = ['entrevista', 'camara', 'voz', 'midia'].includes(b.modo) ? b.modo : 'camara'; const reglas = await textoReglas();
    const modos = { entrevista: 'entrevista pregunta-respuesta (quién pregunta y quién responde se decide al grabar; no pongas nombres propios en las preguntas)', camara: 'Víctor hablando a cámara', voz: 'voz en off sobre imágenes de obra y proyectos', midia: 'vídeo tipo "mi día / acompáñame" con voz en off y escenas del día' };
    const sistema = 'Eres el guionista de redes de Ranuse Design (diseño y montaje de gimnasios y espacios deportivos). Escribes guiones de ' + (tipo === 'historia' ? 'HISTORIAS (narración con arco: situación, conflicto, giro, cierre; real, con detalle de obra)' : 'REELS (gancho en 1-3 s, una sola idea, bucles abiertos, remate y una llamada a la acción)') + '. ' + MANUAL_REDES + '\n\nREGLAS DE MARCA (obligatorias):\n' + reglas;
    const usuario = 'Escribe el guion de un ' + tipo + ' de unos ' + seg + ' segundos, formato: ' + modos[modo] + '. Tema: ' + tema + '. Habla en español de España, frases cortas y naturales, sin inventar datos ni cifras que no te haya dado (si hace falta una cifra, deja [CIFRA]). Responde SOLO JSON: {"titulo":"...","gancho":"texto en pantalla de los primeros 3 s","hablado":"SOLO el texto que se dice, de corrido, listo para pegar como guion (en entrevista: líneas P: pregunta / R: respuesta)","escenas":[{"seg":"0-3","que_se_ve":"...","texto_pantalla":"...","dice":"..."}],"que_grabar":"lista de tomas necesarias","cierre":"llamada a la acción"}';
    const r = await callClaude({ system: sistema, messages: [{ role: 'user', content: usuario }], maxTokens: 3500 });
    const txt = (r.content || []).map(x => x.text || '').join(''); const j = JSON.parse(/\{[\s\S]*\}/.exec(txt)[0]);
    res.json({ titulo: limpia(j.titulo, 140), gancho: limpia(j.gancho, 300), hablado: limpia(j.hablado, 5000), escenas: (Array.isArray(j.escenas) ? j.escenas : []).slice(0, 14).map(e => ({ seg: limpia(e.seg, 20), que_se_ve: limpia(e.que_se_ve, 300), texto_pantalla: limpia(e.texto_pantalla, 200), dice: limpia(e.dice, 500) })), que_grabar: limpia(j.que_grabar, 800), cierre: limpia(j.cierre, 300) });
  } catch (e) { res.status(500).json({ error: 'No se pudo escribir el guion: ' + String(e.message || '').slice(0, 160) }); }
});
// Crea un formato nuevo a partir del análisis de un vídeo viral: copia el ritmo y la estructura, y adapta el aspecto a la marca de Ranuse
router.post('/formatos/desde-referencia', async (req, res) => {
  try {
    const o = await leerTrabajo(limpia(req.body?.id, 20)); const a = o?.analisis; if (!a?.receta) return res.status(404).json({ error: 'Ese análisis no está listo' });
    const lista = await formatos(); const num = (v, d, mn, mx) => { const n = Number(v); return Number.isFinite(n) ? Math.max(mn, Math.min(mx, n)) : d; };
    const r0 = a.receta || {}, base = JSON.parse(JSON.stringify(FORMATO_BASE.receta || {}));
    const receta = { ...base, corte: { min: num(r0.corte?.min, 1.8, 0.6, 6), max: num(r0.corte?.max, 3.5, 1, 10) }, zoomFinal: num(r0.zoomFinal, 1, 1, 1.4), whoosh: num(r0.whoosh, 0, 0, 1), flash: !!r0.flash, introLetras: !!r0.introLetras, collage: !!r0.collage, estiloSubs: r0.estiloSubs === 'karaoke' ? 'karaoke' : 'normal', titulo: !!r0.titulo, barra: !!r0.barra, resaltar: !!r0.resaltar, horas: !!r0.horas,
      subs: { palabrasPorBloque: Math.round(num(r0.subs?.palabrasPorBloque, 2, 1, 4)), tam: Math.round(num(r0.subs?.tam, 86, 60, 110)), margenV: Math.round(num(r0.subs?.margenV, 820, 300, 900)) }, musica: { volumen: num(r0.musica?.volumen, -15, -26, -8) },
      // ADAPTACIÓN A LA MARCA: se copia el ritmo, no el aspecto (colores, fuente y minúsculas de Ranuse; subtítulos sin borde negro)
      acento: '#E3D2B8', fuente: 'Montserrat', mayusculas: false };
    const nuevo = { id: crypto.randomUUID().slice(0, 8), nombre: limpia(req.body?.nombre, 60) || limpia(a.nombre, 60) || 'Formato de referencia', receta, notas: limpia(a.criterio, 1500), referencia: { descripcion: limpia(a.descripcion, 500), estructura: (Array.isArray(a.estructura) ? a.estructura : []).slice(0, 6).map(x => limpia(x, 200)), origen: limpia(o.nombre_archivo, 120) } };
    await guardarJson(RUTA_FORMATOS, { ...(await leerJson(RUTA_FORMATOS, {})), lista: [...lista, nuevo] }); res.status(201).json({ formato: nuevo });
  } catch (e) { res.status(500).json({ error: 'No se pudo crear el formato: ' + String(e.message || '').slice(0, 160) }); }
});
// Ejemplo real de cada formato: el último vídeo terminado hecho con él (y un candidato para crear el ejemplo si no hay ninguno)
router.get('/formatos/ejemplos', async (req, res) => {
  try {
    const { data } = await st().list('trabajos', { limit: 80, sortBy: { column: 'created_at', order: 'desc' } });
    const out = (await Promise.all((data || []).filter(f => /\.json$/.test(f.name)).map(f => leerTrabajo(f.name.replace(/\.json$/, ''))))).filter(Boolean).filter(t => t.estado === 'listo' && t.resultado_movil && t.tipo !== 'referencia');
    out.sort((a, b) => String(b.creado).localeCompare(String(a.creado)));
    const ejemplos = {};
    for (const t of out) { if (ejemplos[t.formato]) continue; const u = await st().createSignedUrl(t.resultado_movil, 3600); if (u.data?.signedUrl) ejemplos[t.formato] = { id: t.id, nombre: t.nombre_archivo || '', url: u.data.signedUrl, creado: t.creado }; }
    const base = out.find(t => ['voz', 'bruto'].includes(t.tipo));
    res.json({ ejemplos, candidato: base ? { id: base.id, nombre: base.nombre_archivo || '' } : null });
  } catch { res.status(500).json({ error: 'No se pudieron leer los ejemplos' }); }
});
// Valida y aplica los cambios de una receta (la usan los formatos y los estilos de edición)
function aplicaReceta(f, r) {
  const num = (v, a, z, d) => Number.isFinite(Number(v)) ? Math.min(z, Math.max(a, Number(v))) : d;
  f.receta = f.receta || {};
  if (r.corte) f.receta.corte = { min: num(r.corte.min, 0.4, 6, f.receta.corte?.min ?? 0.9), max: num(r.corte.max, 0.8, 10, f.receta.corte?.max ?? 2.3) };
  if (r.acento && /^#[0-9a-fA-F]{6}$/.test(r.acento)) f.receta.acento = r.acento;
  if (r.zoomFinal !== undefined) f.receta.zoomFinal = num(r.zoomFinal, 1, 1.4, 1.14);
  if (r.whoosh !== undefined) f.receta.whoosh = num(r.whoosh, 0, 0.5, 0.16);
  if (r.flash !== undefined) f.receta.flash = !!r.flash; /* permiso: el director de edición decide dónde va cada destello */
  for (const k of ['titulo', 'barra', 'mayusculas', 'resaltar', 'encuadre', 'subsBajoCara', 'graficos', 'horas', 'preguntaSoloEscrita', 'collage', 'motion', 'etiquetas', 'aperturaPremium']) if (r[k] !== undefined) f.receta[k] = !!r[k];
  if (['Montserrat', 'Rubik'].includes(r.fuente)) f.receta.fuente = r.fuente;
  if (['normal', 'karaoke', 'caja', 'palabra'].includes(r.estiloSubs)) f.receta.estiloSubs = r.estiloSubs;
  if (r.musica === false) f.receta.musica = false; else if (r.musica && Number.isFinite(Number(r.musica.volumen))) f.receta.musica = { volumen: num(r.musica.volumen, -40, -6, -19) };
  if (r.encuadreZoom !== undefined) f.receta.encuadreZoom = num(r.encuadreZoom, 1, 2, 1.3);
  if (['sobria', 'media', 'alta'].includes(r.intensidad)) f.receta.intensidad = r.intensidad;
  if (r.cambioCada !== undefined) f.receta.cambioCada = Math.min(20, Math.max(0.8, Number(r.cambioCada) || 3.6));
  for (const k of ['director', 'cambiosEnFrases', 'ilustraciones']) if (r[k] !== undefined) f.receta[k] = !!r[k];
  if (r.pausa !== undefined) f.receta.pausa = num(r.pausa, 0.1, 1.2, 0.4);
  if (r.subs) f.receta.subs = { palabrasPorBloque: Math.round(num(r.subs.palabrasPorBloque, 1, 5, 2)), tam: Math.round(num(r.subs.tam, 50, 160, 104)), margenV: Math.round(num(r.subs.margenV, 200, 900, 600)) };
}
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
    aplicaReceta(f, r);
    if (typeof b.estilo === 'string') f.estilo = limpia(b.estilo, 40);
    await guardarFormatos(lista); res.json({ formato: f });
  } catch { res.status(500).json({ error: 'No se pudo guardar' }); }
});
router.get('/estilos', async (req, res) => { try { res.json({ estilos: await estilos() }); } catch { res.status(500).json({ error: 'No se pudieron leer los estilos' }); } });
router.post('/estilos', async (req, res) => {
  try {
    const lista = await estilos(); const base = lista.find(x => x.id === req.body?.copiar_de) || lista[0];
    const nombre = limpia(req.body?.nombre, 60); if (!nombre) return res.status(400).json({ error: 'Ponle un nombre al estilo' });
    const nuevo = { ...JSON.parse(JSON.stringify(base)), id: crypto.randomUUID().slice(0, 8), nombre };
    lista.push(nuevo); await guardarEstilos(lista); res.status(201).json({ estilo: nuevo });
  } catch { res.status(500).json({ error: 'No se pudo crear' }); }
});
router.put('/estilos/:id', async (req, res) => {
  try {
    const lista = await estilos(); const e = lista.find(x => x.id === req.params.id); if (!e) return res.status(404).json({ error: 'No existe ese estilo' });
    const b = req.body || {};
    if (b.nombre !== undefined) e.nombre = limpia(b.nombre, 60) || e.nombre;
    if (b.descripcion !== undefined) e.descripcion = limpia(b.descripcion, 400);
    e.receta = e.receta || {}; aplicaReceta(e, b.receta || {});
    await guardarEstilos(lista); res.json({ estilo: e });
  } catch { res.status(500).json({ error: 'No se pudo guardar' }); }
});
router.delete('/estilos/:id', async (req, res) => {
  try { const lista = await estilos(); if (lista.length <= 1) return res.status(400).json({ error: 'Debe quedar al menos un estilo' }); await guardarEstilos(lista.filter(x => x.id !== req.params.id)); res.json({ ok: true }); }
  catch { res.status(500).json({ error: 'No se pudo borrar' }); }
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
    const b = req.body || {}; if (b.dur_auto) { const [mn, mx] = await duracionIdeal(); b.dur_min = mn; b.dur_max = mx; }
    const lista = await formatos(); const fmt = b.tipo === 'referencia' ? lista[0] : lista.find(x => x.id === b.formato);
    if (!fmt) return res.status(400).json({ error: 'Elige un formato' });
    if (!['voz', 'bruto', 'base', 'clips', 'referencia'].includes(b.tipo)) return res.status(400).json({ error: 'Indica si subes una voz en off, un bruto o eliges un vídeo base' });
    if (b.tipo === 'base' || b.base?.id) { if (!/^[\w-]{10,60}$/.test(b.base?.id || '')) return res.status(400).json({ error: 'Elige el archivo de Drive' }); }
    else if (!/^entradas\//.test(b.archivo || '')) return res.status(400).json({ error: 'Falta el archivo subido' });
    const recFin = await recetaFinal(fmt, b.estilo); let notasFmt = fmt.notas || '';
    if (fmt.id === 'auto-redes') { const dr = await direccionRedes(); recFin.receta = { ...recFin.receta, ...dr.receta }; notasFmt = dr.notas; }
    const t = { id: crypto.randomUUID().slice(0, 8), creado: new Date().toISOString(), por: req.user?.name || req.user?.email || null, reglas: await textoReglasCompleto(), tipo: b.tipo, ...(b.tipo === 'clips' ? { num_clips: Math.max(0, Math.min(12, parseInt(b.num_clips) || 0)), dur_min: Math.max(10, Math.min(120, parseInt(b.dur_min) || 25)), dur_max: Math.max(15, Math.min(180, parseInt(b.dur_max) || 70)) } : {}), archivo: b.base?.id ? null : b.archivo, base: b.base?.id ? { id: limpia(b.base.id, 80), nombre: limpia(b.base.nombre, 160), ruta: limpia(b.base.ruta, 400) } : null, nombre_archivo: limpia(b.nombre_archivo, 120), formato: fmt.id, formato_nombre: fmt.nombre, receta: recFin.receta, estilo: recFin.estilo?.id || null, estilo_nombre: recFin.estilo?.nombre || null, notas_formato: notasFmt, indicaciones: limpia(b.indicaciones, 800), guion: limpia(b.guion, 20000), ...(b.fase === 'transcribir' && b.tipo === 'clips' ? { fase: 'transcribir' } : {}), ...(b.fase === 'audio' && b.tipo === 'voz' ? { fase: 'audio' } : {}), ...(Array.isArray(b.reparto) && b.reparto.length ? { reparto: b.reparto.slice(0, 40).map(p => ({ texto: limpia(p?.texto, 700), clips: (Array.isArray(p?.clips) ? p.clips : []).slice(0, 10).map(x => ({ id: limpia(x?.id, 80), nombre: limpia(x?.nombre, 160), tipo: ['video', 'imagen', 'carpeta'].includes(x?.tipo) ? x.tipo : 'video', ruta: limpia(x?.ruta, 400) })).filter(x => /^[\w-]{10,60}$/.test(x.id)) })).filter(p => p.texto && p.clips.length) } : {}), musica: limpia(b.musica, 150) || 'auto', carpetas: (Array.isArray(b.carpetas) ? b.carpetas : []).slice(0, 30).map(c => limpia(c, 200)).filter(Boolean), recursos: (Array.isArray(b.recursos) ? b.recursos : []).slice(0, 60).map(x => ({ id: limpia(x?.id, 80), nombre: limpia(x?.nombre, 160), tipo: ['carpeta', 'video', 'imagen', 'subido'].includes(x?.tipo) ? x.tipo : 'video', ruta: limpia(x?.ruta, 400) })).filter(x => x.id), estado: 'pendiente', progreso: 'En cola', version: 1, origen: b.origen || null };
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
    for (const t of out) if (t.resultado_audio) { const u = await st().createSignedUrl(t.resultado_audio, 3600); t.url_audio = u.data?.signedUrl || null; }
    for (const t of out) if (t.resultado) { try { const nom = 'ranuse-' + String((t.plan && t.plan.titulo) || t.nombre_archivo || t.id).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) + '-' + t.id + '.mp4'; const d = await st().createSignedUrl(t.resultado, 3600, { download: nom }); t.url_descarga = d.data?.signedUrl || null; } catch { /* sin enlace de descarga */ } const u = await st().createSignedUrl(t.resultado, 3600); t.url = u.data?.signedUrl || null; const m = t.resultado_movil && await st().createSignedUrl(t.resultado_movil, 3600); t.url_movil = m?.data?.signedUrl || null; }
    out.sort((a, b) => String(b.creado).localeCompare(String(a.creado)));
    res.json({ trabajos: out.filter(x => x.estado !== 'borrado' && x.tipo !== 'muestra') });
  } catch { res.status(500).json({ error: 'No se pudo leer la lista' }); }
});
// Catálogo de efectos de HyperFrames con su vídeo de muestra
const EFECTOS_CAT = [
  ['pin-ubicacion', 'Ubicación con pin', 'Un pin cae sobre el mapa y aparece el lugar (Barcelona · obra). Ideal para «mi día».'],
  ['nombre-cargo', 'Nombre y cargo', 'Rótulo que entra de lado con el nombre y el cargo de quien habla (entrevistas).'],
  ['antes-despues', 'Antes y después', 'Una barra se desliza entre el antes y el después (render frente a obra terminada).'],
  ['medidas', 'Medidas que se dibujan', 'Un recuadro con líneas de cota que se dibujan y cifras que aparecen.'],
  ['checklist', 'Checklist', 'Lista de lo que incluye un proyecto con ticks que se van marcando.'],
  ['linea-tiempo', 'Línea de tiempo de obra', 'Pasos del proyecto (diseño, licencia, obra, entrega) que avanzan uno a uno.'],
  ['maquina-escribir', 'Máquina de escribir', 'El texto se escribe letra a letra con cursor parpadeante.'],
  ['marcador', 'Marcador sobre la palabra clave', 'Una franja de color se dibuja detrás de la palabra importante.'],
  ['cortina-circular', 'Transición: cortina circular', 'Un círculo se abre y revela la escena siguiente.'],
  ['persiana', 'Transición: persiana', 'Franjas que se cierran y se abren para cambiar de escena.'],
  ['zoom-desenfoque', 'Transición: zoom con desenfoque', 'La imagen se acerca desenfocándose y entra la siguiente.'],
  ['cierre-seguir', 'Cierre con botón de seguir', 'Botón «seguir» que se pulsa, con la arroba y una línea que se dibuja.'],
];
router.get('/efectos', async (req, res) => {
  try {
    const lista = await Promise.all(EFECTOS_CAT.map(async ([id, nombre, descripcion]) => {
      let url = null; try { const u = await st().createSignedUrl('efectos/' + id + '.mp4', 3600); if (u.data?.signedUrl) { const h = await fetch(u.data.signedUrl, { method: 'HEAD' }); if (h.ok) url = u.data.signedUrl; } } catch { /* sin muestra */ }
      return { id, nombre, descripcion, url };
    }));
    res.json({ efectos: lista });
  } catch { res.status(500).json({ error: 'No se pudo leer el catálogo' }); }
});
router.post('/efectos/muestra', async (req, res) => {
  try {
    await bucket(); const ids = (Array.isArray(req.body?.ids) ? req.body.ids : [req.body?.id]).map(x => limpia(x, 30)).filter(id => EFECTOS_CAT.some(e => e[0] === id)).slice(0, 12);
    if (!ids.length) return res.status(400).json({ error: 'Efecto no válido' });
    for (const id of ids) {
      const t = { id: 'm' + crypto.randomUUID().slice(0, 7), creado: new Date().toISOString(), por: 'sistema', tipo: 'muestra', muestra: { efecto: id }, nombre_archivo: 'Efecto ' + id, estado: 'pendiente', progreso: 'En cola', version: 1 };
      t.ejecutor = (await nubeActiva()) ? 'nube' : 'pc'; await guardarTrabajo(t);
      if (t.ejecutor === 'nube' && !(await lanzarNube(t.id))) { t.ejecutor = 'pc'; await guardarTrabajo(t); }
    }
    res.status(201).json({ ok: true, creados: ids.length });
  } catch { res.status(500).json({ error: 'No se pudo crear la muestra' }); }
});
// Muestras en vídeo de los estilos de subtítulos (estilo + tipografía): ver si existe y pedir que se cree
const slugMuestra = (estilo, fuente) => String(estilo) + '__' + String(fuente).replace(/\s+/g, '-');
router.get('/estilos/muestra', async (req, res) => {
  try {
    const estilo = limpia(req.query.estilo, 20), fuente = limpia(req.query.fuente, 40); if (!/^[a-z]+$/.test(estilo) || !/^[\w ]+$/.test(fuente)) return res.status(400).json({ error: 'Datos no válidos' });
    const u = await st().createSignedUrl('estilos/' + slugMuestra(estilo, fuente) + '.mp4', 3600); if (!u.data?.signedUrl) return res.json({ url: null });
    // createSignedUrl no falla si el archivo no existe: se comprueba
    const h = await fetch(u.data.signedUrl, { method: 'HEAD' }); res.json({ url: h.ok ? u.data.signedUrl : null });
  } catch { res.json({ url: null }); }
});
router.post('/estilos/muestra', async (req, res) => {
  try {
    await bucket(); const estilo = limpia(req.body?.estilo, 20), fuente = limpia(req.body?.fuente, 40);
    if (!['normal', 'karaoke', 'caja', 'palabra'].includes(estilo) || !/^[\w ]+$/.test(fuente)) return res.status(400).json({ error: 'Estilo o tipografía no válidos' });
    const t = { id: 'm' + crypto.randomUUID().slice(0, 7), creado: new Date().toISOString(), por: 'sistema', tipo: 'muestra', muestra: { estilo, fuente, acento: limpia(req.body?.acento, 9) || '#E3D2B8' }, nombre_archivo: 'Muestra ' + estilo + ' · ' + fuente, estado: 'pendiente', progreso: 'En cola', version: 1 };
    t.ejecutor = (await nubeActiva()) ? 'nube' : 'pc'; await guardarTrabajo(t);
    if (t.ejecutor === 'nube' && !(await lanzarNube(t.id))) { t.ejecutor = 'pc'; await guardarTrabajo(t); }
    res.status(201).json({ ok: true, id: t.id });
  } catch (e) { res.status(500).json({ error: 'No se pudo crear la muestra' }); }
});
// Guarda el reparto de vídeos por parte del guion (y el guion) en el propio trabajo, para que no haya que volver a elegirlos
router.post('/trabajos/:id/reparto', async (req, res) => {
  try {
    const o = await leerTrabajo(limpia(req.params.id, 20)); if (!o || o.estado === 'borrado') return res.status(404).json({ error: 'No existe ese trabajo' });
    const b = req.body || {};
    o.reparto = (Array.isArray(b.reparto) ? b.reparto : []).slice(0, 40).map(p => ({ texto: limpia(p?.texto, 700), clips: (Array.isArray(p?.clips) ? p.clips : []).slice(0, 10).map(x => ({ id: limpia(x?.id, 80), nombre: limpia(x?.nombre, 160), tipo: ['video', 'imagen', 'carpeta'].includes(x?.tipo) ? x.tipo : 'video', duracion: Number(x?.duracion) || null, ruta: limpia(x?.ruta, 400) })).filter(x => /^[\w-]{10,60}$/.test(x.id)) })).filter(p => p.texto && p.clips.length);
    if (typeof b.guion === 'string') o.guion = limpia(b.guion, 20000);
    await guardarTrabajo(o); res.json({ ok: true, partes: o.reparto.length });
  } catch { res.status(500).json({ error: 'No se pudo guardar la selección' }); }
});
// Paso 2 del método en dos pasos: con el audio ya ajustado (paso 1), se eligen los clips y se monta el vídeo SIN volver a tocar el audio
router.post('/trabajos/:id/montar-con-audio', async (req, res) => {
  try {
    const o = await leerTrabajo(limpia(req.params.id, 20)); if (!o || o.fase !== 'audio' || o.estado !== 'listo' || !o.resultado_audio) return res.status(400).json({ error: 'Primero hay que tener el audio listo' });
    const id = crypto.randomUUID().slice(0, 8), b = req.body || {};
    const cp = await st().copy(o.resultado_audio, 'entradas/' + id + '.mp3'); if (cp.error) return res.status(500).json({ error: 'No se pudo preparar el audio: ' + cp.error.message });
    const recs = Array.isArray(b.recursos) ? b.recursos.slice(0, 60).map(x => ({ id: limpia(x?.id, 80), nombre: limpia(x?.nombre, 160), tipo: ['carpeta', 'video', 'imagen', 'subido'].includes(x?.tipo) ? x.tipo : 'video', ruta: limpia(x?.ruta, 400) })).filter(x => x.id) : (o.recursos || []);
    const reparto = (Array.isArray(b.reparto) ? b.reparto : []).slice(0, 40).map(p => ({ texto: limpia(p?.texto, 700), clips: (Array.isArray(p?.clips) ? p.clips : []).slice(0, 10).map(x => ({ id: limpia(x?.id, 80), nombre: limpia(x?.nombre, 160), tipo: ['video', 'imagen', 'carpeta'].includes(x?.tipo) ? x.tipo : 'video', ruta: limpia(x?.ruta, 400) })).filter(x => /^[\w-]{10,60}$/.test(x.id)) })).filter(p => p.texto && p.clips.length);
    const t = { ...o, reglas: await textoReglasCompleto(), id, creado: new Date().toISOString(), origen: o.id, version: 1, fase: undefined, sin_limpieza: true, archivo: 'entradas/' + id + '.mp3', base: null, nombre_archivo: (o.nombre_archivo || 'audio') + ' (audio ajustado)', recursos: recs, ...(reparto.length ? { reparto } : { reparto: o.reparto && o.reparto.length ? o.reparto : undefined }), guion: typeof b.guion === 'string' ? limpia(b.guion, 20000) : o.guion, edicion_texto: undefined, transcripcion: undefined, resultado_audio: undefined, url_audio: undefined, dur_audio: undefined, estado: 'pendiente', progreso: 'En cola', pct: 0, resultado: null, resultado_movil: null, error: null, plan: null, empezado: undefined, terminado: undefined, autorevision: undefined };
    t.ejecutor = (await nubeActiva()) ? 'nube' : 'pc'; await guardarTrabajo(t);
    if (t.ejecutor === 'nube' && !(await lanzarNube(t.id))) { t.ejecutor = 'pc'; await guardarTrabajo(t); }
    res.status(201).json({ trabajo: t });
  } catch (e) { res.status(500).json({ error: 'No se pudo montar con ese audio: ' + String(e.message || '').slice(0, 160) }); }
});
// Pide a la IA que puntúe un vídeo que ya estaba hecho (revisión sin volver a montarlo)
router.post('/trabajos/:id/puntuar', async (req, res) => {
  try {
    const o = await leerTrabajo(limpia(req.params.id, 20)); if (!o || o.estado !== 'listo' || !(o.resultado_movil || o.resultado)) return res.status(400).json({ error: 'Solo se puede puntuar un vídeo ya terminado' });
    o.pedir_puntuacion = true; await guardarTrabajo(o);
    if (!(await nubeActiva()) || !(await lanzarNube(o.id))) { o.pedir_puntuacion = false; await guardarTrabajo(o); return res.status(503).json({ error: 'El servidor de vídeo no está disponible ahora mismo' }); }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'No se pudo pedir la puntuación' }); }
});
// Método manual para entrevistas largas: la transcripción completa (con tiempos) para que el usuario elija los tramos de cada clip
router.get('/trabajos/:id/palabras', async (req, res) => {
  try { const id = limpia(req.params.id, 20); if (!/^[\w-]{4,20}$/.test(id)) return res.status(400).json({ error: 'Id no válido' }); const u = await st().createSignedUrl('artefactos/' + id + '/palabras_largo.json', 600); if (!u.data?.signedUrl) return res.status(404).json({ error: 'Todavía no hay transcripción' }); res.json({ url: u.data.signedUrl }); }
  catch { res.status(500).json({ error: 'No se pudo leer la transcripción' }); }
});
// Paquete para publicar: la IA de redes escribe, con la voz de Víctor y lo que funciona en su cuenta, el texto de cada vídeo ya editado
router.post('/trabajos/:id/paquete-redes', async (req, res) => {
  try {
    const id = limpia(req.params.id, 20); if (!/^[\w-]{4,20}$/.test(id)) return res.status(400).json({ error: 'Id no válido' });
    let j = null; for (const nombre of ['palabras_bruto.json', 'palabras_largo.json']) { const u = await st().createSignedUrl('artefactos/' + id + '/' + nombre, 120); if (u.data?.signedUrl) { const r = await fetch(u.data.signedUrl); if (r.ok) { j = await r.json(); break; } } }
    if (!j) return res.status(404).json({ error: 'Este vídeo no tiene transcripción guardada (solo los vídeos con voz la tienen).' });
    const arr = Array.isArray(j) ? j : (j.p || j.palabras || []), texto = arr.map(w => Array.isArray(w) ? w[0] : (w.t || w.text || w.word || '')).join(' ').replace(/\s+/g, ' ').trim().slice(0, 12000);
    if (texto.length < 30) return res.status(422).json({ error: 'No hay suficiente texto hablado.' });
    const dr = await direccionRedes(), [mn, mx] = await duracionIdeal();
    const r = await callClaude({ system: 'Eres el estratega de redes de Víctor Palomo (Ranuse Design, diseño de gimnasios). Te paso lo que se dice en un vídeo ya editado y escribes TODO lo necesario para publicarlo, con SU voz (primera persona, cercana, directa, sin jerga de marketing) y aplicando lo que se ha aprendido de su cuenta y del nicho (abajo). Se publica el mismo vídeo vertical a la vez en Reels, TikTok y YouTube Shorts desde Metricool, con prioridad en Instagram. Devuelves SOLO JSON {"gancho_pantalla":"texto corto para los 2 primeros segundos","ganchos_alternativos":["2 opciones más"],"caption":"texto del post, con salto de línea y CTA","cta":"llamada a la acción acorde a conseguir comentarios/contactos","hashtags":["8 como máximo, sin repetir lo obvio"],"titulo_shorts":"título para YouTube Shorts (máx 70 car.)","mejor_momento":"día y hora para publicar en Instagram según lo aprendido, o \"sin datos\"","si_lo_rehaces":["1-3 mejoras concretas de edición o gancho"]}.\n\n' + dr.notas, messages: [{ role: 'user', content: 'LO QUE SE DICE EN EL VÍDEO:\n' + texto }], maxTokens: 2500 });
    const txt = (r.content || []).map(b => b.text || '').join(''), p = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
    const L = (a, n, m) => (Array.isArray(a) ? a : []).slice(0, n).map(x => limpia(x, m));
    res.json({ gancho_pantalla: limpia(p.gancho_pantalla, 120), ganchos_alternativos: L(p.ganchos_alternativos, 3, 120), caption: limpia(p.caption, 1500), cta: limpia(p.cta, 200), hashtags: L(p.hashtags, 8, 40), titulo_shorts: limpia(p.titulo_shorts, 90), mejor_momento: limpia(p.mejor_momento, 160), si_lo_rehaces: L(p.si_lo_rehaces, 3, 200) });
  } catch (e) { res.status(500).json({ error: 'No se pudo preparar el texto: ' + String(e.message || e).slice(0, 140) }); }
});
router.post('/trabajos/:id/proponer-clips', async (req, res) => {
  try {
    const id = limpia(req.params.id, 20); if (!/^[\w-]{4,20}$/.test(id)) return res.status(400).json({ error: 'Id no válido' });
    const u = await st().createSignedUrl('artefactos/' + id + '/palabras_largo.json', 300); if (!u.data?.signedUrl) return res.status(404).json({ error: 'Todavía no hay transcripción' });
    const pal = (await (await fetch(u.data.signedUrl)).json()).p || []; if (pal.length < 30) return res.status(422).json({ error: 'La transcripción es demasiado corta' });
    const lineas = []; let cur = null; pal.forEach((w, i) => { if (!cur || cur.n >= 22 || (i && w[1] - pal[i - 1][2] > 1.2)) { cur = { ini: w[1], n: 0, txt: [] }; lineas.push(cur); } cur.n++; cur.txt.push(w[0]); });
    const texto = lineas.map(x => '[' + x.ini.toFixed(1) + 's] ' + x.txt.join(' ')).join('\n').slice(0, 60000);
    const [mn, mx] = await duracionIdeal(), dr = await direccionRedes(), n = Math.max(2, Math.min(10, parseInt(req.body?.cuantos) || 5));
    const r = await callClaude({ system: 'Eres el estratega de contenido de Víctor Palomo (Ranuse Design, diseño de gimnasios) y le sacas clips de una entrevista o vídeo largo para Reels. Eliges los ' + n + ' mejores momentos usando lo que se ha aprendido de qué funciona en su cuenta y en el nicho (abajo). Cada clip: un gancho potente en los primeros 2 segundos, una sola idea, sentido completo y duración entre ' + mn + ' y ' + mx + ' segundos (puede juntar 2-3 tramos si queda natural; los tramos se montan EN EL ORDEN en que los listes, así que puedes empezar por la frase más potente como gancho y seguir con el contexto, aunque en el vídeo original vaya después). Prioriza lo que genera comentarios, guardados o compartidos. Usa los tiempos de la transcripción (en segundos) para los tramos. Devuelves SOLO JSON {"clips":[{"titulo":"título corto","gancho":"primera frase del clip","por_que":"por qué funcionaría, en 1 frase","tramos":[[inicio_s,fin_s]]}]}.\n\n' + dr.notas, messages: [{ role: 'user', content: 'TRANSCRIPCIÓN con tiempos:\n' + texto }], maxTokens: 5000 });
    const txt = (r.content || []).map(b => b.text || '').join(''), j = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
    const ajusta = (a, b) => { let i = pal.findIndex(w => w[2] >= a); if (i < 0) i = 0; let k = i; for (let q = i; q < pal.length && pal[q][1] <= b; q++) k = q; return [Math.max(0, +(pal[i][1] - 0.05).toFixed(2)), +(pal[k][2] + 0.1).toFixed(2)]; };
    const clips = (j.clips || []).slice(0, n).map(c => ({ titulo: limpia(c.titulo, 100), gancho: limpia(c.gancho, 200), por_que: limpia(c.por_que, 220), tramos: (c.tramos || []).slice(0, 6).map(x => ajusta(Number(x[0]) || 0, Number(x[1]) || 0)).filter(x => x[1] - x[0] > 2) })).filter(c => c.tramos.length);
    if (!clips.length) return res.status(422).json({ error: 'La IA no ha encontrado clips claros, prueba otra vez.' });
    res.json({ clips });
  } catch (e) { res.status(500).json({ error: 'No se pudieron proponer los clips: ' + String(e.message || e).slice(0, 140) }); }
});
// Crea los clips con los tramos que el usuario ha elegido sobre la transcripción (no vuelve a transcribir ni a elegir)
router.post('/trabajos/:id/montar-clips', async (req, res) => {
  try {
    const o = await leerTrabajo(limpia(req.params.id, 20)); if (!o) return res.status(404).json({ error: 'No existe ese trabajo' });
    const lista = (Array.isArray(req.body?.clips) ? req.body.clips : []).slice(0, 20).map(c => ({ titulo: limpia(c?.titulo, 120) || 'Clip', pregunta: limpia(c?.pregunta, 300), tramos: (Array.isArray(c?.tramos) ? c.tramos : []).slice(0, 12).map(x => [Number(x?.[0]), Number(x?.[1])]).filter(x => Number.isFinite(x[0]) && Number.isFinite(x[1]) && x[1] > x[0] && x[0] >= 0) })).filter(c => c.tramos.length);
    if (!lista.length) return res.status(400).json({ error: 'Elige al menos un tramo de la transcripción' });
    const t = { ...o, reglas: await textoReglasCompleto(), id: crypto.randomUUID().slice(0, 8), creado: new Date().toISOString(), tipo: 'clips', fase: undefined, clips_manual: lista, clips: undefined, estado: 'pendiente', progreso: 'En cola', pct: 0, resultado: null, resultado_movil: null, error: null, empezado: undefined, terminado: undefined, palabras_n: undefined, origen: o.id, version: 1 };
    t.ejecutor = (await nubeActiva()) ? 'nube' : 'pc'; await guardarTrabajo(t);
    if (t.ejecutor === 'nube' && !(await lanzarNube(t.id))) { t.ejecutor = 'pc'; await guardarTrabajo(t); }
    res.status(201).json({ trabajo: t });
  } catch (e) { res.status(500).json({ error: 'No se pudieron crear los clips: ' + String(e.message || '').slice(0, 160) }); }
});
// Pedir cambios sobre un vídeo ya hecho: crea una versión nueva con las indicaciones añadidas
router.post('/trabajos/:id/rehacer', async (req, res) => {
  try {
    const o = await leerTrabajo(req.params.id); if (!o) return res.status(404).json({ error: 'No existe ese trabajo' });
    const cambios = limpia(req.body?.indicaciones, 800);
    const lista = await formatos(); const fmt = lista.find(x => x.id === (req.body?.formato || o.formato)) || { id: o.formato, nombre: o.formato_nombre, receta: o.receta, notas: o.notas_formato };
    const recNuevos = Array.isArray(req.body?.recursos) ? req.body.recursos.slice(0, 60).map(x => ({ id: limpia(x?.id, 80), nombre: limpia(x?.nombre, 160), tipo: ['carpeta', 'video', 'imagen', 'subido'].includes(x?.tipo) ? x.tipo : 'video', ruta: limpia(x?.ruta, 400) })).filter(x => x.id) : null;
    const b0 = req.body?.base; const baseNueva = b0?.id && /^[\w-]{10,60}$/.test(b0.id) && b0.id !== o.base?.id ? { id: limpia(b0.id, 80), nombre: limpia(b0.nombre, 160), ruta: limpia(b0.ruta, 400) } : null;
    const recFin = await recetaFinal(fmt, req.body?.estilo || (fmt.id === o.formato ? o.estilo : undefined)); const dinam = Math.max(0, Math.min(2, parseInt(req.body?.dinamismo) || 0)); const recetaDin = (() => { const r = JSON.parse(JSON.stringify(recFin.receta || {})); if (!dinam) return r; const c = r.corte || { min: 1.5, max: 3.5 }; r.corte = dinam === 1 ? { min: Math.min(c.min, 1.4), max: Math.min(c.max, 2.6) } : { min: Math.min(c.min, 1.0), max: Math.min(c.max, 2.0) }; r.zoomFinal = Math.max(Number(r.zoomFinal) || 1, dinam === 1 ? 1.12 : 1.18); r.whoosh = Math.max(Number(r.whoosh) || 0, dinam === 1 ? 0.1 : 0.16); r.flash = false; r.motion = true; if (dinam === 2) r.barra = true; return r; })();
    const t = { ...o, reglas: await textoReglasCompleto(), ...(recNuevos ? { recursos: recNuevos } : {}), ...(baseNueva ? { base: baseNueva, archivo: null, nombre_archivo: baseNueva.nombre } : {}), ...(typeof req.body?.guion === 'string' ? { guion: limpia(req.body.guion, 20000) } : {}), ...(typeof req.body?.musica === 'string' ? { musica: limpia(req.body.musica, 150) || 'auto' } : {}), ...(Array.isArray(req.body?.reparto) ? { reparto: req.body.reparto.slice(0, 40).map(p => ({ texto: limpia(p?.texto, 700), clips: (Array.isArray(p?.clips) ? p.clips : []).slice(0, 10).map(x => ({ id: limpia(x?.id, 80), nombre: limpia(x?.nombre, 160), tipo: ['video', 'imagen', 'carpeta'].includes(x?.tipo) ? x.tipo : 'video', duracion: Number(x?.duracion) || null, ruta: limpia(x?.ruta, 400) })).filter(x => /^[\w-]{10,60}$/.test(x.id)) })).filter(p => p.texto && p.clips.length) } : {}), id: crypto.randomUUID().slice(0, 8), creado: new Date().toISOString(), formato: fmt.id, formato_nombre: fmt.nombre, receta: recetaDin, notas_formato: fmt.notas || '', indicaciones: cambios ? (o.indicaciones ? o.indicaciones + '\nCAMBIOS PEDIDOS: ' : 'CAMBIOS PEDIDOS: ') + cambios : ((o.indicaciones ? o.indicaciones + '\n' : '') + 'REGENERAR: monta una versión distinta con los mismos recursos (otra elección y orden de planos, otro ritmo).'), estado: 'pendiente', progreso: 'En cola', version: (o.version || 1) + 1, origen: o.id, resultado: null, resultado_movil: null, error: null, plan: null };
    t.ejecutor = (await nubeActiva()) ? 'nube' : 'pc'; await guardarTrabajo(t);
    if (t.ejecutor === 'nube' && !(await lanzarNube(t.id))) { t.ejecutor = 'pc'; await guardarTrabajo(t); } // si Google no arranca, lo hace el PC
    res.status(201).json({ trabajo: t });
  } catch { res.status(500).json({ error: 'No se pudo crear la nueva versión' }); }
});
// Postproducción a mano: cambiar el clip de un corte o mover el punto de inicio dentro del clip. Crea una versión nueva reutilizando el montaje anterior (misma voz, mismo plan).
router.post('/trabajos/:id/editar', async (req, res) => {
  try {
    const o = await leerTrabajo(req.params.id); if (!o) return res.status(404).json({ error: 'No existe ese trabajo' });
    if (!o.artefactos) return res.status(400).json({ error: 'Este vídeo se hizo antes de que existiera la edición de cortes. Pulsa Regenerar y podrás editar la versión nueva.' });
    const cambios = (Array.isArray(req.body?.cambios) ? req.body.cambios : []).slice(0, 300).map(c => {
      const vid = c?.video && /^[\w-]{10,60}$/.test(String(c.video.id || '')) ? { id: String(c.video.id), nombre: limpia(c.video.nombre, 160), tipo: c.video.tipo === 'imagen' ? 'imagen' : 'video' } : null;
      const desde = Number.isFinite(Number(c?.desde)) && c?.desde !== '' && c?.desde !== null ? Math.max(0, Math.min(36000, Number(c.desde))) : undefined;
      return { de: Number(c?.de), ...(vid ? { video: vid } : {}), ...(desde !== undefined ? { desde } : {}) };
    }).filter(c => Number.isInteger(c.de) && (c.video || c.desde !== undefined));
    const lista = (Array.isArray(req.body?.cortes) ? req.body.cortes : []).slice(0, 400).map(c => {
      const vid = c?.video && /^[\w-]{10,60}$/.test(String(c.video.id || '')) ? { id: String(c.video.id), nombre: limpia(c.video.nombre, 160), tipo: c.video.tipo === 'imagen' ? 'imagen' : 'video' } : null;
      const t0 = Number(c?.t0), desde = Number(c?.desde);
      return { t0, ...(vid ? { video: vid } : {}), ...(c?.video_int ? { video_int: limpia(String(c.video_int), 80) } : {}), desde: Number.isFinite(desde) ? Math.max(0, Math.min(36000, desde)) : 0 };
    }).filter(c => Number.isFinite(c.t0) && c.t0 >= 0 && (c.video || c.video_int));
    if (!cambios.length && lista.length < 2) return res.status(400).json({ error: 'No has cambiado ningún corte' });
    const t = { ...o, id: crypto.randomUUID().slice(0, 8), creado: new Date().toISOString(), tipo: 'edicion', origen: o.id, cambios, ...(lista.length >= 2 ? { cortes_nuevos: lista } : {}), version: (o.version || 1) + 1, estado: 'pendiente', progreso: 'En cola', pct: 0, resultado: null, resultado_movil: null, error: null, plan: null, cortes: undefined, artefactos: undefined, faltan: undefined, empezado: undefined, terminado: undefined };
    t.ejecutor = (await nubeActiva()) ? 'nube' : 'pc'; await guardarTrabajo(t);
    if (t.ejecutor === 'nube' && !(await lanzarNube(t.id))) { t.ejecutor = 'pc'; await guardarTrabajo(t); }
    res.status(201).json({ trabajo: t });
  } catch { res.status(500).json({ error: 'No se pudo crear la nueva versión editada' }); }
});
// Edición por texto: la persona elige qué palabras se quitan (la IA solo propone) y se vuelve a montar el clip con ese texto
router.post('/trabajos/:id/editar-texto', async (req, res) => {
  try {
    const o = await leerTrabajo(req.params.id); if (!o) return res.status(404).json({ error: 'No existe ese trabajo' });
    const n = (o.transcripcion || []).length; if (!n) return res.status(400).json({ error: 'Este vídeo no tiene texto editable. Pulsa Regenerar y podrás editarlo en la versión nueva.' });
    const fuera = [...new Set((Array.isArray(req.body?.fuera) ? req.body.fuera : (o.transcripcion || []).map((w, i) => (w[3] ? i : -1)).filter(i => i >= 0)).map(Number).filter(i => Number.isInteger(i) && i >= 0 && i < n))].sort((a, b) => a - b);
    if (fuera.length >= n) return res.status(400).json({ error: 'No puedes quitar todo el texto' });
    const t = { ...o, id: crypto.randomUUID().slice(0, 8), creado: new Date().toISOString(), origen: o.id, edicion_texto: { fuera }, audio_ritmo: Math.max(0, Math.min(2, parseInt(req.body?.ritmo) || 0)), version: (o.version || 1) + 1, estado: 'pendiente', progreso: 'En cola', pct: 0, resultado: null, resultado_movil: null, error: null, plan: null, transcripcion: undefined, faltan: undefined, empezado: undefined, terminado: undefined };
    t.ejecutor = (await nubeActiva()) ? 'nube' : 'pc'; await guardarTrabajo(t);
    if (t.ejecutor === 'nube' && !(await lanzarNube(t.id))) { t.ejecutor = 'pc'; await guardarTrabajo(t); }
    res.status(201).json({ trabajo: t });
  } catch { res.status(500).json({ error: 'No se pudo crear la versión con el texto editado' }); }
});
// Borra un trabajo con todo lo suyo (vídeo, móvil, audio, datos del editor y los clips que salieron de él).
// Si todavía se está montando, deja una marca "borrado" para que el servidor de vídeo se pare y no lo vuelva a crear.
async function borraTrabajo(id, hijos = true) {
  if (!/^[\w-]{4,20}$/.test(id)) return;
  const o = await leerTrabajo(id); if (!o) { await st().remove([rutaTrabajo(id)]); return; }
  const rutas = [];
  for (const k of ['resultado', 'resultado_movil', 'resultado_audio']) if (o[k]) rutas.push(o[k]);
  rutas.push('salidas/' + id + '.mp4', 'salidas/' + id + '_movil.mp4', 'salidas/' + id + '_voz.mp3');
  try { const l = await st().list('artefactos/' + id); for (const f of (l.data || [])) rutas.push('artefactos/' + id + '/' + f.name); } catch { /* sin datos del editor */ }
  if (['pendiente', 'procesando'].includes(o.estado)) await guardarTrabajo({ id, creado: o.creado, estado: 'borrado', borrado: true }); else rutas.push(rutaTrabajo(id));
  const r = await st().remove(rutas); if (r.error) throw new Error(r.error.message);
  if (hijos) for (const h of (Array.isArray(o.clips) ? o.clips : []).slice(0, 40)) { try { await borraTrabajo(String(h), false); } catch { /* un clip sin borrar no impide borrar el resto */ } }
}
router.delete('/trabajos/:id', async (req, res) => {
  try { await borraTrabajo(limpia(req.params.id, 20)); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: 'No se pudo borrar: ' + String(e.message || '').slice(0, 140) }); }
});

// Vídeos terminados (para avisar por WhatsApp y para que el asistente los pase cuando se lo pidan)
const TIPOS_VIDEO = ['voz', 'bruto', 'base', 'clips', 'edicion'];
export async function videosTerminados({ soloSinAvisar = false, max = 6 } = {}) {
  await bucket();
  const { data } = await st().list('trabajos', { limit: 40, sortBy: { column: 'created_at', order: 'desc' } });
  const out = [];
  for (const f of (data || []).filter(x => /\.json$/.test(x.name))) {
    const t = await leerTrabajo(f.name.replace(/\.json$/, '')); if (!t || !TIPOS_VIDEO.includes(t.tipo)) continue;
    if (t.estado !== 'listo' && t.estado !== 'error') continue;
    if (t.autocorregido || t.por === 'sistema') continue;
    if (soloSinAvisar && (t.avisado || Date.now() - new Date(t.terminado || t.creado).getTime() > 3 * 86400000)) continue;
    let enlace = null; if (t.estado === 'listo' && t.resultado_movil) { const u = await st().createSignedUrl(t.resultado_movil, 172800); enlace = u.data?.signedUrl || null; }
    out.push({ id: t.id, nombre: t.nombre_archivo || t.id, estado: t.estado, error: t.error || null, terminado: t.terminado || t.creado, enlace });
    if (out.length >= max) break;
  }
  return out;
}
export const guardaTrabajoSistema = (t) => guardarTrabajo(t);
// Predicciones con vídeo pendientes de avisar (se calculan y se mandan por el asistente cuando terminan)
export async function prediccionesPendientes() {
  await bucket(); const { data } = await st().list('trabajos', { limit: 30, sortBy: { column: 'created_at', order: 'desc' } }); const out = [];
  for (const f of (data || []).filter(x => /\.json$/.test(x.name))) { const t = await leerTrabajo(f.name.replace(/\.json$/, '')); if (t && t.tipo === 'analisis_redes' && t.pred && !t.avisado && t.estado === 'listo' && Date.now() - new Date(t.terminado || t.creado).getTime() < 3 * 86400000) out.push(t); }
  return out;
}
export async function marcaVideoAvisado(id) { const t = await leerTrabajo(id); if (t) { t.avisado = new Date().toISOString(); await guardarTrabajo(t); } }
export async function creaTrabajoSistema(t) { await bucket(); t.ejecutor = (await nubeActiva()) ? 'nube' : 'pc'; await guardarTrabajo(t); if (t.ejecutor === 'nube' && !(await lanzarNube(t.id))) { t.ejecutor = 'pc'; await guardarTrabajo(t); } return t; }
export const leeTrabajoSistema = (id) => leerTrabajo(id);
export default router;
