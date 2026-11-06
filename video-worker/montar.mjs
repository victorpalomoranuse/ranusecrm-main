// Montaje con voz en off: voz (audio o vídeo) -> transcripción por palabras -> la IA elige escenas del índice -> render vertical.
// Uso: node montar.mjs "<voz>" "<indice.json>" "<salida.mp4>" ["indicaciones"]
// El estilo vive en RECETA (después saldrá de la biblioteca de formatos del CRM).
import fs from 'fs';
import path from 'path';
import { spawnSync, spawn } from 'child_process';
import { bibliotecaLocal, alPulso, mezcla } from './musica.mjs';
import * as drive from './drive.mjs';
import { ENV } from './entorno.mjs';
import { introLetras, ESTILO_INTRO } from './intro.mjs';
import { acotaPorEnergia } from './voz.mjs';
import { PLAYBOOK_REDES } from './clips.mjs';
import { ARGS_VIDEO } from './codec.mjs';
import { transcribe } from './transcribir.mjs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { CADENA_VOZ, copiaModelo, corrigeTrabones, repetidasInmediatas, rangosAQuitar, guionLimpio, recomponeVoz, muletillasSueltas, huecosConSonido, tomasRepetidas, elegirMejoresTomas } from './voz.mjs';

const [VOZ, INDICE, SALIDA, NOTAS = ''] = process.argv.slice(2);
if (!VOZ || !INDICE || !SALIDA) { console.log('Uso: node montar.mjs "<voz>" "<indice.json>" "<salida.mp4>" ["indicaciones"]'); process.exit(1); }
const WHISPER = process.env.WHISPER_CLI || 'C:/Users/cashc/AppData/Local/RanuseVideo/whisper/Release/whisper-cli.exe';
const MODELO_W = process.env.WHISPER_MODEL || 'C:/Users/cashc/AppData/Local/RanuseVideo/whisper/ggml-large-v3-turbo-q5_0.bin';
const FONT = new URL('../public/fonts/Montserrat-Bold.ttf', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// ===== RECETA: "Dopamínico serio" =====
const RECETA = {
  nombre: 'dopaminico-serio-v1',
  corte: { min: 0.9, max: 2.3 },        // cortes rápidos, siempre con cambio de plano
  acento: '&HB8D2E3&',                  // arena cálida (BGR), paleta oscura Ranuse
  mayusculas: false, fuente: 'Montserrat', musica: { volumen: -19 },
  zoomFinal: 1.14,                      // cada plano hace un empujón lento hacia dentro
  whoosh: 0.16,                         // volumen de los whoosh en cada corte (0 = sin)
  flash: true,                          // destello blanco muy breve en cada corte
  subs: { palabrasPorBloque: 2, tam: 104, margenV: 600 },
  voz: CADENA_VOZ,
  color: 'eq=contrast=1.08:saturation=1.12:gamma=0.97,vignette=PI/6',
};

if (process.env.RECETA_JSON) { // receta elegida en el CRM
  const o = JSON.parse(fs.readFileSync(process.env.RECETA_JSON, 'utf8'));
  if (o.corte) RECETA.corte = { ...RECETA.corte, ...o.corte };
  if (/^#[0-9a-f]{6}$/i.test(o.acento || '')) RECETA.acento = '&H' + o.acento.slice(5, 7) + o.acento.slice(3, 5) + o.acento.slice(1, 3) + '&';
  for (const k of ['zoomFinal', 'whoosh', 'flash', 'titulo', 'mayusculas', 'fuente', 'horas', 'introLetras']) if (o[k] !== undefined) RECETA[k] = o[k];
  if (o.musica && typeof o.musica === 'object') RECETA.musica = { ...RECETA.musica, ...o.musica };
  if (!['Montserrat', 'Rubik'].includes(RECETA.fuente)) RECETA.fuente = 'Montserrat';
  if (o.subs) RECETA.subs = { ...RECETA.subs, ...o.subs };
}
const work = path.resolve(path.dirname(SALIDA), '_trabajo_' + path.basename(SALIDA, '.mp4')); fs.mkdirSync(work, { recursive: true });
const run = (c, a, o = {}) => spawnSync(c, a, { encoding: 'utf8', maxBuffer: 1 << 28, ...o });
const pad2 = n => String(n).padStart(2, '0');
const tAss = t => { const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t - h * 3600 - m * 60; return h + ':' + pad2(m) + ':' + s.toFixed(2).padStart(5, '0'); };
const limpiaT = t => String(t).replace(/[{}\\]/g, '');

// 1) audio de la voz (si es vídeo se extrae el audio)
const wav = path.join(work, 'voz.wav'), m4a = path.join(work, 'voz.m4a');
run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', VOZ, '-vn', '-ac', '1', '-ar', '16000', wav]);
run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', VOZ, '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', path.join(work, 'voz48_orig.wav')]);
let durVoz = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav]).stdout) || 0;
const T_INI = Date.now(); if (process.env.TIEMPOS === '1') { const _l = console.log; console.log = (...x) => _l('[' + String(Math.round((Date.now() - T_INI) / 1000)).padStart(3) + 's]', ...x); }
const marca = (n, t) => console.log('##PCT ' + n + ' ' + t);
marca(8, 'Leyendo el audio');
console.log('Voz:', durVoz.toFixed(1), 's');
if (!durVoz) { console.log('FALLO: no he podido leer el audio del archivo (¿falta ffmpeg o el archivo no tiene sonido?)'); process.exit(1); }

// 2) transcripción por palabras (en la nube se cambia por Groq)
marca(12, 'Transcribiendo la voz');
const wj = path.join(work, 'palabras');
console.log('Transcripcion con:', await transcribe(wav, wj));
let palabras = JSON.parse(fs.readFileSync(wj + '.json', 'utf8').replace(/^\uFEFF/, '')).transcription
  .map(s => ({ t: s.text.trim(), de: s.offsets.from / 1000, a: s.offsets.to / 1000 })).filter(w => w.t && !/^\[.*\]$/.test(w.t));
palabras.forEach((w, i) => { w.i = i; });
{ const nA = acotaPorEnergia(palabras, wav); if (nA) console.log('Palabras estiradas sobre un silencio, acortadas:', nA); }
console.log('Palabras:', palabras.length);
if (palabras.length < 3) { console.error('FALLO: No se oye ninguna voz en ese archivo. En "Voz en off" tienes que elegir el audio o vídeo donde hablas (no un clip del dron o sin voz).'); process.exit(1); }

marca(30, 'Quitando muletillas, tropiezos y repeticiones');
// 2b) corregir cuando te trabas: tropiezos, palabras repetidas, frases dichas dos veces, errores y pausas largas
if (process.env.SIN_LIMPIEZA !== '1') {
  const trab = corrigeTrabones(palabras, wav); const quitar = new Set();
  const conservar = /conservw* (las )?muletillas|mantw* (las )?muletillas/i.test(NOTAS); const huecos = conservar ? 0 : huecosConSonido(palabras, wav); if (!conservar) for (const i of muletillasSueltas(palabras)) quitar.add(i);
  if (huecos) console.log('Muletillas sin transcribir cortadas:', huecos);
  // la IA construye el discurso final eligiendo qué tramos CONSERVAR (cada idea una vez, con su mejor toma); si falla, se usa el método de rangos a quitar
  const limpio = await guionLimpio(palabras, ENV.ANTHROPIC_API_KEY, NOTAS);
  if (limpio) { console.log('Discurso final elegido por la IA:', palabras.length - limpio.size, 'de', palabras.length, 'palabras'); for (const i of limpio) quitar.add(i); for (const i of repetidasInmediatas(palabras.filter(w => !limpio.has(w.i)))) quitar.add(i); } else for (const i of repetidasInmediatas(palabras)) quitar.add(i);
  const [aQuitar, tomas] = limpio ? [new Set(), []] : await Promise.all([rangosAQuitar(palabras, ENV.ANTHROPIC_API_KEY, NOTAS), tomasRepetidas(palabras, ENV.ANTHROPIC_API_KEY, NOTAS)]);
  // lo que dijiste varias veces: se queda la mejor toma (la que mejor entonación y ritmo tiene, sin tropiezos ni muletillas).
  // La toma elegida queda PROTEGIDA: lo que la IA haya marcado dentro de ella no se quita, para que nunca desaparezcan todas las versiones de una frase.
  const protegidas = new Set(); let porTomas = new Set();
  if (tomas.length) {
    console.log('Frases dichas varias veces:', tomas.length, 'grupo(s)');
    porTomas = new Set(elegirMejoresTomas(palabras, tomas, wav, true));
    for (const g of tomas) for (const [x, y] of g) { let tocada = false; for (let i = x; i <= y; i++) if (porTomas.has(i)) { tocada = true; break; } if (!tocada) for (let i = x; i <= y; i++) protegidas.add(i); }
  }
  for (const i of aQuitar) if (!protegidas.has(i)) quitar.add(i);
  for (const i of porTomas) quitar.add(i);
  console.log('Tropiezos recortados:', trab, '| palabras quitadas:', quitar.size, [...quitar].slice(0, 30).map(i => palabras[i]?.t).join(' '));
  const r = recomponeVoz({ palabras, quitar, wav48: path.join(work, 'voz48_orig.wav'), salida: path.join(work, 'voz48.wav') });
  palabras = r.palabras; console.log('Voz limpia:', durVoz.toFixed(1), 's ->', r.durVoz.toFixed(1), 's'); durVoz = r.durVoz;
} else { fs.copyFileSync(path.join(work, 'voz48_orig.wav'), path.join(work, 'voz48.wav')); }

// 3) la IA monta
let idx = JSON.parse(fs.readFileSync(INDICE, 'utf8')).videos.filter(v => v.duracion >= 1.5);
// recursos elegidos en el CRM: carpetas enteras o vídeos sueltos (vacío = todo lo indexado, sin los brutos hablando)
{ let sel = {}; try { sel = JSON.parse(process.env.RECURSOS_SEL || '{}'); } catch { /* todo */ }
  const carps = sel.carpetas || [], vids = sel.videos || [];
  if (carps.length || vids.length) {
    const f = idx.filter(v => { const abs = v.ruta_abs ?? v.carpeta ?? ''; return carps.some(c => abs === c || abs.startsWith(c + '/')) || vids.some(z => z.id === v.drive_id || (z.ruta ? z.ruta + '/' : '') + z.nombre === (abs ? abs + '/' : '') + v.nombre); });
    console.log('Recursos elegidos:', carps.length, 'carpeta(s),', vids.length, 'vídeo(s) →', f.length, 'de', idx.length, 'vídeos indexados');
    f.forEach(v => { v._elegido = true; });
    if (f.length) {
      const utiles = f.filter(v => !v.hablando_a_camara && v.duracion >= 2).length;
      if (utiles < 3 && process.env.EDICION !== '1') { const ids = new Set(f.map(v => v.id)); const extra = idx.filter(v => !ids.has(v.id) && !v.hablando_a_camara && v.duracion >= 2); console.log('Pocos vídeos útiles en lo elegido (' + utiles + '): se amplía con la biblioteca (+' + extra.length + ')'); idx = [...f, ...extra]; } else idx = f;
    } else if ((sel.imagenes || []).length || (sel.carpetasId || []).length) { console.log('En lo elegido no hay vídeos indexados: se montará con imágenes'); idx = []; } else { console.log('Nada de lo elegido está indexado; se usan todos'); idx = idx.filter(v => !v.hablando_a_camara); }
  } else if (process.env.EDICION !== '1') idx = idx.filter(v => !v.hablando_a_camara && v.duracion >= 2);
}
// Imágenes elegidas (sueltas o dentro de carpetas): se bajan, se describen con visión (con caché) y entran al catálogo como escenas fijas
const enParalelo = async (items, n, fn) => { const cola = items.slice(); await Promise.all(Array.from({ length: Math.min(n, cola.length) }, async () => { while (cola.length) await fn(cola.shift()); })); };
async function imagenesParaCatalogo(sel) {
  const lista = [...(sel.imagenes || [])];
  for (const c of (sel.carpetasId || [])) { try { const pila = [{ id: c.id, ruta: c.ruta }]; while (pila.length && lista.length < 80) { const x = pila.pop(); for (const f of await drive.hijos(x.id)) { if (drive.esCarpeta(f)) pila.push({ id: f.id, ruta: x.ruta + '/' + f.name }); else if (drive.esImagen(f) && lista.length < 80) lista.push({ id: f.id, nombre: f.name, ruta: x.ruta }); } } } catch (e) { console.log('Imágenes de carpeta sin leer:', e.message); } }
  if (!lista.length) return [];
  const dirImg = path.join(work, 'imgs'); fs.mkdirSync(dirImg, { recursive: true });
  const fCache = new URL('./datos/drive-imagenes/indice.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'); let cache = {}; try { cache = JSON.parse(fs.readFileSync(fCache, 'utf8')); } catch { /* sin caché */ }
  const listas = [];
  await enParalelo(lista, 6, async (im) => {
    try { const { url, cabeceras } = await drive.urlDescarga(im.id); const rs = await fetch(url, { headers: cabeceras }); if (!rs.ok) throw new Error('HTTP ' + rs.status); const raw = path.join(dirImg, im.id + '.raw'), jpg = path.join(dirImg, im.id + '.jpg'); fs.writeFileSync(raw, Buffer.from(await rs.arrayBuffer()));
      run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-vf', 'scale=1600:1600:force_original_aspect_ratio=decrease', '-frames:v', '1', '-q:v', '3', jpg]); fs.unlinkSync(raw); if (fs.existsSync(jpg)) listas.push({ ...im, jpg }); } catch (e) { console.log('Imagen sin bajar:', im.nombre, e.message); }
  });
  const nuevas = listas.filter(x => !cache[x.id]);
  const lotes = []; for (let i = 0; i < nuevas.length; i += 6) lotes.push(nuevas.slice(i, i + 6));
  await enParalelo(lotes, 4, async (lote) => {
    const cont = [];
    lote.forEach((x, k) => { const peq = x.jpg.replace('.jpg', '_p.jpg'); run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', x.jpg, '-vf', 'scale=640:640:force_original_aspect_ratio=decrease', peq]); cont.push({ type: 'text', text: 'Imagen ' + (k + 1) + ' (' + x.nombre + '):' }); cont.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(peq).toString('base64') } }); });
    cont.push({ type: 'text', text: 'Son imágenes del archivo de Ranuse Design (diseño de gimnasios y espacios deportivos): renders, fotos de obra, proyectos. Describe cada una para poder elegirla al montar un vídeo. Responde SOLO JSON {"imagenes":[{"n":1,"resumen":"qué se ve en 1-2 frases","etiquetas":["8-12 palabras clave en español"]}]}' });
    try { const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': ENV.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: 1800, messages: [{ role: 'user', content: cont }] }) }); const j = await r.json(); const d = JSON.parse(/\{[\s\S]*\}/.exec(j.content.map(b => b.text || '').join(''))[0]); for (const it of (d.imagenes || [])) { const x = lote[(it.n || 1) - 1]; if (x) cache[x.id] = { resumen: it.resumen, etiquetas: it.etiquetas || [] }; } } catch (e) { console.log('Sin describir un lote de imágenes:', e.message); }
  });
  try { fs.mkdirSync(path.dirname(fCache), { recursive: true }); fs.writeFileSync(fCache, JSON.stringify(cache)); } catch { /* sin caché */ }
  return listas.filter(x => cache[x.id]).map(x => ({ id: 'img' + x.id.slice(0, 9), nombre: x.nombre, es_imagen: true, drive_id_img: x.id, ruta: x.jpg, duracion: 600, calidad: 'media', tipo: 'imagen', resumen: 'IMAGEN FIJA: ' + cache[x.id].resumen, etiquetas: cache[x.id].etiquetas || [], planos: [{ t: 0, descripcion: cache[x.id].resumen }], ruta_abs: x.ruta }));
}
const llamaClaude = async (content, max = 3000, rapido = false) => {
  for (const modelo of (rapido ? ['claude-haiku-4-5-20251001', 'claude-sonnet-4-5-20250929'] : ['claude-sonnet-4-5-20250929'])) {
    try { const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': ENV.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: modelo, max_tokens: max, messages: [{ role: 'user', content }] }) }); const j = await r.json(); if (!r.ok) throw new Error('Claude ' + r.status); return JSON.parse(/\{[\s\S]*\}/.exec(j.content.map(b => b.text || '').join(''))[0]); } catch (e) { if (modelo.includes('sonnet')) throw e; }
  }
};
{ let sel = {}; try { sel = JSON.parse(process.env.RECURSOS_SEL || '{}'); } catch { /* sin selección */ } if ((sel.imagenes || []).length || (sel.carpetasId || []).length) { try { const ims = await imagenesParaCatalogo(sel); if (ims.length) { console.log('Imágenes disponibles para el montaje:', ims.length); idx = [...idx, ...ims]; } } catch (e) { console.log('Sin imágenes en el montaje:', e.message); } } }
// Si hay mucho material (una carpeta entera), se queda con los ~110 vídeos que más tienen que ver con lo que se dice (por coincidencia de palabras: instantáneo)
if (idx.length > 120) {
  const n2 = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9ñ ]/g, ' ');
  const PARADAS = new Set('para como pero este esta esto estos estas porque cuando donde mucho muchos poco pocos tiene tienen tengo hacer hace cada todo todos tambien entonces ahora siempre nunca menos desde hasta sobre entre cuanto cuantos algo algun alguna alguno vamos puede pueden quiero quieres usted ustedes'.split(' '));
  const voz = new Map(); for (const w of palabras) { const k = n2(w.t).trim(); if (k.length > 3 && !PARADAS.has(k)) voz.set(k, (voz.get(k) || 0) + 1); }
  const df = new Map(); const textos = idx.map(v => { const t = new Set(n2([v.resumen, (v.etiquetas || []).join(' '), (v.planos || []).map(p => p.descripcion).join(' ')].join(' ')).split(/\s+/).filter(x => x.length > 3)); for (const k of t) df.set(k, (df.get(k) || 0) + 1); return t; });
  const puntos = idx.map((v, i) => { let s = 0; for (const [k, c] of voz) if (textos[i].has(k)) s += Math.min(c, 3) / Math.log(2 + (df.get(k) || 1)); if (v.calidad === 'alta') s += 0.4; if (v._elegido) s += 1.5; if (v.tipo === 'bruto_hablando' || v.hablando_a_camara) s -= 3; return s; });
  const orden = idx.map((v, i) => [v, puntos[i]]).sort((a, b) => b[1] - a[1]); const f = orden.slice(0, 110).map(x => x[0]);
  console.log('Preselección por tema (palabras):', f.length, 'de', idx.length, 'vídeos'); idx = f;
}
const compacto = v => ({ ...(v._elegido ? { elegido_por_la_persona: true } : {}), id: v.id, dur: v.duracion, calidad: v.calidad, resumen: v.resumen, etiquetas: (v.etiquetas || []).slice(0, 8), planos: (v.planos || []).slice(0, 6).map(p => p.t + 's: ' + String(p.descripcion).slice(0, 100)) });
const cat = idx.map(compacto);
const guionDe = (a, b) => palabras.slice(a, b).map((w, i) => (a + i) + ':' + w.t + '@' + w.de.toFixed(1)).join(' ');
const planF = path.join(work, 'plan.json'); let plan, esquema = null;
if (process.env.REUSE && fs.existsSync(planF)) plan = JSON.parse(fs.readFileSync(planF, 'utf8'));
else {
  const pidePlan = async (A, B) => {
  const guion = guionDe(A, B), durBloque = palabras[B - 1].a - palabras[A].de;
  const prompt = 'Eres montador de vídeo de Ranuse Design (diseño de gimnasios y espacios deportivos). Tienes la voz en off de un vídeo vertical para Instagram/TikTok y un catálogo de escenas en bruto. Monta un vídeo PROFESIONAL, DINÁMICO y SERIO (sin humor, sin emojis; sensación de marca premium).\n\nVOZ EN OFF (índice:palabra@segundo): ' + guion + '\n\nDuración de este fragmento: ' + durBloque.toFixed(1) + ' s (el vídeo completo dura ' + durVoz.toFixed(0) + ' s).\n\nHISTORIA DEL VÍDEO (síguela de principio a fin): ' + JSON.stringify(esquema) + '\n\nCATÁLOGO (id, duración en s, planos con su segundo; los planos de cada vídeo están en orden cronológico):\n' + JSON.stringify(cat) + '\n\n' + (NOTAS ? 'INDICACIONES DEL EQUIPO: ' + NOTAS + '\n\n' : '') +
    PLAYBOOK_REDES + '\n\n' +
    'ESTRUCTURA NARRATIVA: el vídeo tiene un arco claro (arranque con gancho, capítulos ordenados por lugar y tema, cierre). Agrupa los cortes de un mismo lugar o actividad mientras la voz siga en ese tema; NO saltes de un escenario a otro en cada corte ni vuelvas a un escenario anterior sin motivo. Cada cambio de lugar debe estar justificado por lo que se dice (viaje, llegada, trabajo, obra, contenido, comida, hotel…). Da más protagonismo (más cortes o planos más largos) a los planos que cuentan la historia y menos a los de relleno. CIERRE: los últimos 2 o 3 cortes deben dar sensación de final: la persona a cámara o un plano emblemático del proyecto, sin cambiar de escenario en la frase final, con el último plano algo más largo. Los planos de transición (comida, alojamiento…) necesitan que la voz los mencione. REGLAS PERMANENTES DE LA PERSONA (siempre): las escenas deben contar la misma historia que la voz, nunca clips sin relación con lo que se dice; nada de comida u objetos al azar si no se habla de ello; los clips deben seguir el orden cronológico del relato; no repitas el mismo clip ni el mismo tramo; si un clip es inútil o no encaja, no lo uses. REGLA DE VARIEDAD (obligatoria): reparte el uso de los vídeos de forma pareja: nunca el mismo vídeo en cortes seguidos ni el mismo tramo dos veces; si hay catálogo de sobra, ninguno más de 2 veces; un vídeo corto no puede cubrir muchos cortes. Si no hay escenas suficientes que encajen con lo que se dice, es MEJOR usar otras escenas relevantes distintas del catálogo, aunque encajen solo en parte, que repetir la misma. Si en el catálogo hay vídeos con "elegido_por_la_persona": la persona los ha escogido A MANO para contar ESTA historia. Entiende lo que muestra cada uno (resumen y planos) y DEBES usar TODOS ellos al menos una vez, colocando cada uno justo donde lo que se dice encaja con lo que muestra (sigue el orden del relato: viaje, llegada, trabajo, obra, contenido, comida, hotel…). Un vídeo elegido largo puede aportar varios tramos distintos, pero ninguno más de 3 veces. Reglas: 1) Ritmo rápido: cortes de ' + RECETA.corte.min + ' a ' + RECETA.corte.max + ' s siguiendo el sentido de las frases; cambia de plano al cambiar de idea o cada pocas palabras. La primera palabra de cada corte es el índice "de"; cada corte llega hasta justo antes del siguiente; el primero empieza en la palabra ' + A + '. 2) COHERENCIA OBLIGATORIA: la escena de cada corte debe tener relación DIRECTA con lo que se dice en ese corte (el mismo espacio, equipamiento, material o proceso). Está PROHIBIDO usar una escena que no tenga nada que ver (comida, personas ajenas al tema, objetos sin relación). Si no hay nada literal, usa un plano genérico del espacio o del equipamiento del mismo tema, nunca algo de otro asunto. NO tienes que usar todo el catálogo: lo elegido es una reserva y solo debes poner lo que SIRVE para lo que se dice; un clip que no encaja con nada del guion simplemente no se usa. Si para un tramo no hay NINGUNA escena coherente, no metas algo ajeno: continúa con otro fragmento distinto de la escena anterior (mismo espacio o tema) o con el plano más neutro de ese mismo tema. Prefiere calidad alta y evita planos oscuros o borrosos. Algunas entradas del catálogo son IMÁGENES FIJAS (empiezan por "IMAGEN FIJA"): úsalas como cortes cortos de 1,5 a 3 s cuando ilustren lo que se dice (renders, proyectos), sin encadenar más de dos seguidas. ' + (idx.length < 6 ? 'Hay pocos vídeos disponibles: reutilízalos con tramos DISTINTOS ("desde" puede ser cualquier segundo del vídeo, no solo los listados), sin repetir el mismo tramo ni el mismo vídeo en cortes seguidos.' : 'No repitas el mismo vídeo en cortes seguidos; puedes reutilizar un vídeo con otro tramo ("desde" distinto).') + ' 3a) SECUENCIA Y HISTORIA: las escenas deben contar la historia del guion en orden (de un espacio a otro, de la obra al resultado, del problema a la solución), con hilo conductor. Los planos de un mismo vídeo van en orden cronológico, así que usar fragmentos consecutivos de un recorrido cuenta la secuencia. Nunca escenas sueltas sin relación con la anterior ni con lo que se dice; el primer corte debe ser el gancho de la historia. 3b) VÍDEOS LARGOS: de un mismo vídeo largo puedes usar VARIOS fragmentos DISTINTOS en cortes no seguidos (cada plano listado tiene su segundo; separa los tramos al menos 10 s entre sí) para tener más recursos y variedad; no uses nunca el mismo tramo dos veces. 3) "desde" = segundo del vídeo donde empieza el plano (usa los segundos de los planos listados; debe cumplirse desde + duración del corte <= duración del vídeo). 4) "kicker": categoría de 2-4 palabras. "titulo": gancho serio en mayúsculas, máx. 7 palabras, sin signos de exclamación. 5) "enfasis": índices de las palabras clave de la voz (cifras, términos técnicos, la idea fuerte), unas 1 de cada 5-6 palabras. 5b) "horas": si la voz menciona una hora del día ("a las 9", "9:00", "plego a las 18h", "a las tres y media"), apunta {"de": índice de la palabra donde se dice, "texto": "9:00"} (formato 24 h, h:mm); si no menciona ninguna, déjalo vacío. 6) Responde SOLO con JSON: {"kicker":"","titulo":"","enfasis":[0],"horas":[{"de":0,"texto":"9:00"}],"cortes":[{"de":0,"video":"id","desde":0.0}]}';
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': ENV.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: 8000, messages: [{ role: 'user', content: prompt }] }) });
  const j = await r.json(); if (!r.ok) { console.log('Claude error', JSON.stringify(j).slice(0, 300)); process.exit(1); }
  console.log('Plan del fragmento ' + A + '-' + B + ': tokens', j.usage.input_tokens, '/', j.usage.output_tokens);
  return JSON.parse(/\{[\s\S]*\}/.exec(j.content.map(b => b.text || '').join(''))[0]);
  };
  // primero se ENTIENDE el guion entero: de qué trata, cómo se estructura y qué debería verse en cada parte
  try { const texto = palabras.map((w, i) => (i % 25 === 0 ? '[' + i + '] ' : '') + w.t).join(' ').slice(0, 150000);
    esquema = await llamaClaude('Eres el editor jefe de Ranuse Design (diseño de gimnasios y espacios deportivos). Lee el guion completo de un vídeo (con marcas [n] de la palabra cada 25) y define su HISTORIA para que luego se monte con imágenes que la cuenten en secuencia.\n\nGUION:\n' + texto + '\n\n' + (NOTAS ? 'INDICACIONES: ' + NOTAS + '\n\n' : '') + 'Responde SOLO JSON: {"historia":"de qué trata y a dónde quiere llevar al espectador, en 2-3 frases","gancho":"qué debe verse al empezar","secciones":[{"de":0,"hasta":120,"idea":"qué se explica","visual":"qué espacios, equipos o procesos deben verse y en qué orden (p. ej. entrada, luego zona de fuerza, luego cardio)"}],"cierre":"cómo debe terminar"}', 3000); console.log('Historia del vídeo:', String(esquema.historia || '').slice(0, 140)); } catch (e) { console.log('Sin esquema de la historia:', e.message); }
  // el guion se trocea en bloques de ~330 palabras (cortados al final de una frase) que se planifican a la vez: así un audio de 20 minutos entra entero
  const BLOQUE = 330, bloques = [];
  for (let a = 0; a < palabras.length;) { let b = Math.min(palabras.length, a + BLOQUE); if (b < palabras.length) { let k = b; while (k > a + BLOQUE * 0.6 && !/[.?!]$/.test(palabras[k - 1].t)) k--; if (k > a + BLOQUE * 0.6) b = k; } bloques.push([a, b]); a = b; }
  const partes = new Array(bloques.length), cola = bloques.map((_, i) => i);
  await Promise.all(Array.from({ length: Math.min(3, bloques.length) }, async () => { while (cola.length) { const i = cola.shift(); partes[i] = await pidePlan(bloques[i][0], bloques[i][1]); } }));
  if (partes.some(p => !p)) { console.error('FALLO: la IA no ha podido planificar las escenas (intenta regenerar en un minuto).'); process.exit(1); }
  plan = { kicker: partes[0].kicker, titulo: partes[0].titulo, enfasis: [...new Set(partes.flatMap(p => p.enfasis || []))], cortes: partes.flatMap(p => p.cortes || []), horas: partes.flatMap(p => p.horas || []) };
  if (bloques.length > 1) console.log('Guion largo planificado en', bloques.length, 'bloques →', plan.cortes.length, 'cortes');
  fs.writeFileSync(planF, JSON.stringify(plan, null, 1));
}
// Revisión de coherencia: una segunda pasada puntúa cada escena frente a lo que se dice y sustituye las que no encajan
if (process.env.SIN_REVISION !== '1') try {
  const cs = plan.cortes.slice().sort((a, b) => a.de - b.de);
  const items = cs.map((c, k) => { const sig = cs[k + 1]?.de ?? palabras.length, v = idx.find(x => x.id === c.video); const pl = (v?.planos || []).reduce((mm, p) => (!mm || Math.abs(p.t - (c.desde || 0)) < Math.abs(mm.t - (c.desde || 0)) ? p : mm), null); return { k, dice: palabras.slice(c.de, sig).map(w => w.t).join(' '), escena: String(v?.resumen || '').slice(0, 140) + ' | ' + String(pl?.descripcion || '').slice(0, 120) }; });
  const r2 = await llamaClaude('Revisa la COHERENCIA entre lo que se dice y la escena que se muestra en cada corte de un vídeo de gimnasios/espacios deportivos, Y TAMBIÉN la SECUENCIA: la historia del vídeo (' + JSON.stringify(esquema || {}) + ') debe poder seguirse, sin saltos absurdos entre espacios ni escenas que rompan el hilo (p. ej. alternar sin motivo entre una vivienda y un gimnasio); si una escena rompe la secuencia, cámbiala aunque encaje con la frase. Puntúa de 0 a 10 la relación directa (0 = nada que ver, p. ej. comida cuando se habla de gimnasios). Devuelve SOLO los cortes con nota menor de 6, cada uno con una escena SUSTITUTA del catálogo que sí guarde relación con lo que se dice (si no hay ninguna literal, el plano más genérico del mismo tema), sin repetir la misma escena en cortes seguidos.\n\nCORTES: ' + JSON.stringify(items) + '\n\nCATÁLOGO: ' + JSON.stringify(cat) + '\n\nResponde SOLO JSON {"cambios":[{"k":0,"video":"id","desde":0.0,"motivo":"breve"}]}', 2500, true);
  let n = 0; for (const ch of (r2.cambios || [])) { const c = cs[ch.k]; if (c && idx.find(x => x.id === ch.video)) { c.video = ch.video; c.desde = Number(ch.desde) || 0; n++; } }
  if (n) { console.log('Revisión de coherencia: ' + n + ' escena(s) sustituida(s) de ' + cs.length); fs.writeFileSync(planF, JSON.stringify(plan, null, 1)); }
} catch (e) { console.log('Sin revisión de coherencia:', e.message); }
// Un mismo vídeo largo puede aparecer varias veces, pero nunca con el mismo tramo: si dos cortes se pisan, el segundo pasa a otro plano de ese vídeo
if (process.env.SIN_REVISION !== '1') try {
  const cs2 = plan.cortes.slice().sort((a, b) => a.de - b.de), usados = {}; let movidos = 0;
  cs2.forEach((c, k) => { const v = idx.find(x => x.id === c.video); if (!v || v.es_imagen) return; const sig = cs2[k + 1]?.de ?? palabras.length, dur = Math.max(1.2, (palabras[Math.min(sig, palabras.length - 1)]?.de ?? durVoz) - (palabras[c.de]?.de ?? 0)); const lista = usados[v.id] || (usados[v.id] = []);
    const choca = (t) => lista.some(u => t < u[1] + 3 && t + dur + 3 > u[0]);
    let t = Number(c.desde) || 0; if (choca(t)) { const alt = (v.planos || []).map(p => p.t).filter(tp => tp + dur <= v.duracion - 0.2 && !choca(tp)); if (alt.length) { t = alt[Math.floor(Math.random() * alt.length)]; c.desde = t; movidos++; } }
    lista.push([t, t + dur]); });
  if (movidos) { console.log('Tramos repetidos movidos a otro momento del mismo vídeo:', movidos); fs.writeFileSync(planF, JSON.stringify(plan, null, 1)); }
} catch (e) { console.log('Sin comprobar tramos repetidos:', e.message); }
// Ningún plano dura menos del mínimo del formato: los cortes demasiado cortos se funden con el anterior (un plano más largo en vez de un parpadeo)
if (process.env.EDICION !== '1') try {
  const cs0 = plan.cortes.slice().sort((x, y) => x.de - y.de);
  const dur0 = (c, k) => { const sig = cs0[k + 1]?.de ?? palabras.length; return Math.max(0.2, (palabras[Math.min(sig, palabras.length) - 1]?.a ?? 0) - (palabras[c.de]?.de ?? 0)); };
  const minCorte = Math.max(1.4, Number(RECETA.corte?.min) || 1.4);
  const mantener = []; let acc = 0;
  cs0.forEach((c, k) => { const d = dur0(c, k); if (!mantener.length || acc >= minCorte) { mantener.push(c); acc = d; } else { acc += d; c._borrar = true; } });
  if (mantener.length > 1 && acc < minCorte * 0.8) mantener.pop()._borrar = true;
  const n0 = plan.cortes.length; plan.cortes = plan.cortes.filter(c => !c._borrar);
  console.log('Cortes demasiado cortos fundidos (mínimo ' + minCorte.toFixed(1) + ' s):', n0, '→', plan.cortes.length);
} catch (e) { console.log('Sin fundir cortes cortos:', e.message); }
// Todos los vídeos que la persona eligió a mano deben aparecer: si falta alguno, se coloca donde mejor encaje, sustituyendo un corte de un vídeo repetido
if (process.env.EDICION !== '1') try {
  const elegidos = idx.filter(v => v._elegido && !v.es_imagen && !v.hablando_a_camara);
  const usos = new Map(); for (const c of plan.cortes) usos.set(c.video, (usos.get(c.video) || 0) + 1);
  const faltan = elegidos.filter(v => !usos.get(v.id));
  if (faltan.length) {
    const cs = plan.cortes.slice().sort((x, y) => x.de - y.de);
    const lineas = cs.map((c, k) => { const sig = cs[k + 1]?.de ?? palabras.length; return k + ': "' + palabras.slice(c.de, sig).map(w => w.t).join(' ').slice(0, 90) + '" → ' + (idx.find(z => z.id === c.video)?.nombre || c.video) + ' (usado ' + usos.get(c.video) + ' veces)'; });
    const rr = await llamaClaude('La persona eligió a mano estos vídeos para contar su historia y todavía no aparecen en el montaje:\n' + faltan.map(v => '- id ' + v.id + ': ' + (v.resumen || '') + ' [' + (v.etiquetas || []).slice(0, 6).join(', ') + ']').join('\n') + '\n\nCortes actuales (número: texto que se dice → vídeo que se muestra):\n' + lineas.join('\n') + '\n\nPara cada vídeo que falta, elige el corte donde MEJOR encaje con lo que se dice, prefiriendo cortes que ahora muestran un vídeo usado 3 veces o más. Cada corte se puede asignar a un solo vídeo. Si ningún corte encaja de forma razonable, pon null. Responde SOLO JSON {"asignaciones":[{"video":"id","corte":número o null}]}', 1500, true);
    let n = 0, tomados = new Set();
    for (const x of (rr?.asignaciones || [])) { const v = faltan.find(z => z.id === x.video), c = Number.isInteger(x.corte) ? cs[x.corte] : null; if (!v || !c || tomados.has(x.corte)) continue; tomados.add(x.corte); c.video = v.id; c.desde = 0; n++; }
    console.log('Vídeos elegidos que faltaban:', faltan.length, '→ colocados:', n);
  }
} catch (e) { console.log('Sin completar los vídeos elegidos:', e.message); }
// Reparto de usos: la capacidad de un vídeo depende de lo que dura (un clip corto no puede cubrir muchos cortes). Lo que sobra se pasa a otros vídeos que encajen
// con lo que se dice; después se garantiza que los tramos de un mismo vídeo no se solapen (nunca se ve la misma imagen dos veces).
if (process.env.EDICION !== '1') try {
  const cs = plan.cortes.slice().sort((x, y) => x.de - y.de);
  const durCorte = (c, k) => { const sig = cs[k + 1]?.de ?? palabras.length; return Math.max(1, (palabras[Math.min(sig, palabras.length) - 1]?.a ?? 0) - (palabras[c.de]?.de ?? 0)); };
  const capac = v => v.es_imagen ? 2 : v.hablando_a_camara ? 3 : Math.max(1, Math.floor((v.duracion || 4) / 4));
  const porVideo = new Map(); cs.forEach((c, k) => { c._k = k; if (!porVideo.has(c.video)) porVideo.set(c.video, []); porVideo.get(c.video).push(c); });
  const exceso = []; for (const [id, arr] of porVideo) { const v = idx.find(z => z.id === id); if (v && arr.length > capac(v)) exceso.push(...arr.slice(capac(v))); }
  cs.forEach((c, k) => { if (k > 0 && c.video === cs[k - 1].video && !exceso.includes(c)) exceso.push(c); });
  const libre = new Map(); for (const v of idx) { if (v.hablando_a_camara && !v._elegido) continue; const u = (porVideo.get(v.id) || []).length; if (u < capac(v) + 1) libre.set(v.id, capac(v) + 1 - u); }
  if (exceso.length && libre.size) {
    const cands = idx.filter(v => libre.has(v.id)).slice(0, 80);
    const rr = await llamaClaude('Hay cortes de un montaje que repiten demasiado el mismo vídeo (uno corto no puede cubrir tantos cortes). Para cada corte de la lista, elige UN vídeo de los candidatos que muestre algo que encaje con lo que se dice en ese momento (misma historia, no algo al azar). Cada candidato solo puede usarse tantas veces como indica "hueco". El vídeo que elijas NO puede ser el mismo que el del corte anterior ni el del siguiente (los cortes seguidos deben mostrar vídeos distintos). Si ninguno encaja de forma razonable, pon null y el corte se queda como está.\n\nCORTES A REASIGNAR:\n' + exceso.map(c => c._k + ': "' + palabras.slice(c.de, (cs[c._k + 1]?.de ?? palabras.length)).map(w => w.t).join(' ').slice(0, 100) + '" (ahora: ' + (idx.find(z => z.id === c.video)?.nombre || c.video) + ')').join('\n') + '\n\nCANDIDATOS:\n' + cands.map(v => '- id ' + v.id + ' (hueco ' + libre.get(v.id) + ')' + (v._elegido ? ' [elegido por la persona]' : '') + ': ' + (v.resumen || '').slice(0, 140)).join('\n') + '\n\nResponde SOLO JSON {"asignaciones":[{"corte":número,"video":"id" o null}]}', 2500, true);
    let n = 0; for (const x of (rr?.asignaciones || [])) { const c = cs[x.corte]; if (!c || !x.video || !libre.get(x.video)) continue; if (!exceso.includes(c)) continue; if (x.video === cs[x.corte - 1]?.video || x.video === cs[x.corte + 1]?.video) continue; c.video = x.video; c.desde = 0; libre.set(x.video, libre.get(x.video) - 1); n++; }
    console.log('Reparto de clips: ' + exceso.length + ' cortes repetían demasiado el mismo vídeo →', n, 'reasignados');
  }
  // cortes seguidos del mismo vídeo que no se han podido cambiar: continúan donde acabó el corte anterior (un solo plano seguido)
  let enlazados = 0;
  for (let k = 1; k < cs.length; k++) {
    if (cs[k].video !== cs[k - 1].video) continue;
    const v = idx.find(z => z.id === cs[k].video); if (!v || v.es_imagen) continue;
    const fin = (Number(cs[k - 1].desde) || 0) + durCorte(cs[k - 1], k - 1);
    if (fin + durCorte(cs[k], k) + 0.2 <= (v.duracion || 0)) { cs[k].desde = Math.round(fin * 10) / 10; cs[k]._cont = true; enlazados++; }
  }
  if (enlazados) console.log('Cortes seguidos del mismo vídeo enlazados sin saltos:', enlazados);
  // los tramos de un mismo vídeo no se solapan
  const ocupado = new Map(); let movidos = 0;
  cs.forEach((c, k) => {
    const v = idx.find(z => z.id === c.video); if (!v || v.es_imagen) return;
    const L = durCorte(c, k) + 0.3, D = v.duracion || 0; if (D <= L + 0.2) return;
    const lista = ocupado.get(v.id) || [];
    if (c._cont) { const prev = cs[k - 1]; const d2 = Math.round(((Number(prev.desde) || 0) + durCorte(prev, k - 1)) * 10) / 10; if (d2 + L <= D) { c.desde = d2; lista.push([d2, d2 + L]); ocupado.set(v.id, lista); return; } c._cont = false; } const choca = (d) => lista.some(([a, b]) => d < b + 0.4 && d + L > a - 0.4);
    let d = Math.max(0, Math.min(Number(c.desde) || 0, D - L));
    if (choca(d)) { let hallado = null; for (let t = 0; t + L <= D; t += 0.5) if (!choca(t)) { hallado = t; break; } if (hallado !== null) { d = hallado; movidos++; } }
    c.desde = Math.round(d * 10) / 10; lista.push([d, d + L]); ocupado.set(v.id, lista);
  });
  if (movidos) console.log('Tramos de un mismo vídeo que se solapaban, movidos:', movidos);
  { // un plano enlazado se funde con el anterior solo mientras el plano resultante no pase de ~3 s; si no, se queda como corte (continúa la misma toma, sin saltos)
    let run = 0; const borrar = new Set();
    cs.forEach((c, k) => { const d = durCorte(c, k); if (c._cont) { if (run + d <= 3.0) { borrar.add(c); run += d; } else run = d; } else run = d; });
    const n1 = plan.cortes.length; plan.cortes = plan.cortes.filter(c => !borrar.has(c)); if (plan.cortes.length !== n1) console.log('Cortes enlazados fundidos en un solo plano:', n1 - plan.cortes.length);
  }
} catch (e) { console.log('Sin repartir los usos de los clips:', e.message); }
// ¿Qué partes de la historia se quedan sin imágenes adecuadas? Se avisa a la persona para que pueda subir más clips
if (process.env.EDICION !== '1') try {
  const cs = plan.cortes.slice().sort((x, y) => x.de - y.de);
  const lineas = cs.map((c, k) => { const sig = cs[k + 1]?.de ?? palabras.length, v = idx.find(z => z.id === c.video); return k + ': "' + palabras.slice(c.de, sig).map(w => w.t).join(' ').slice(0, 90) + '" → ' + (v ? (v.resumen || v.nombre || '').slice(0, 110) : '?'); });
  const usosN = {}; for (const c of cs) usosN[c.video] = (usosN[c.video] || 0) + 1;
  const rr = await llamaClaude('Revisa si las escenas que se muestran encajan con lo que se dice en cada corte de un vídeo (formato número: "lo que se dice" → qué se ve). Indica solo los PROBLEMAS REALES: partes de la historia donde lo que se ve no tiene que ver con lo que se dice, o donde se repite una escena por falta de material. Agrupa cortes seguidos de la misma parte. Para cada problema describe con precisión qué clip habría que grabar o subir (qué se vería). Si todo encaja bien, devuelve la lista vacía. No inventes problemas. Máximo 6.\n\n' + lineas.join('\n') + '\n\nResponde SOLO JSON {"faltan":[{"parte":"frase o idea afectada","necesitas":"clip concreto que haría falta: qué se ve"}]}', 1500, true);
  const faltan = (rr?.faltan || []).filter(x => x && x.parte && x.necesitas).slice(0, 6).map(x => ({ parte: String(x.parte).slice(0, 140), necesitas: String(x.necesitas).slice(0, 200) }));
  fs.mkdirSync(path.join(work, 'edicion'), { recursive: true }); fs.writeFileSync(path.join(work, 'edicion', 'faltan.json'), JSON.stringify(faltan));
  console.log('Clips que faltan:', faltan.length ? faltan.map(f => f.necesitas).join(' | ') : 'ninguno');
} catch (e) { console.log('Sin revisar qué clips faltan:', e.message); }
// Para poder editar los cortes a mano después: se guardan el plan final, las palabras limpias y los datos de cada corte
try {
  const ed = path.join(work, 'edicion'); fs.mkdirSync(ed, { recursive: true });
  const cs3 = plan.cortes.slice().sort((a, b) => a.de - b.de);
  const info = cs3.map((c, k) => { const sig = cs3[k + 1]?.de ?? palabras.length, v = idx.find(x => x.id === c.video); return { k, de: c.de, ini: Math.round((palabras[c.de]?.de ?? 0) * 100) / 100, fin: Math.round((palabras[Math.min(sig, palabras.length) - 1]?.a ?? durVoz) * 100) / 100, texto: palabras.slice(c.de, sig).map(w => w.t).join(' ').slice(0, 160), video: c.video, nombre: v?.nombre || '', drive_id: v?.drive_id || v?.drive_id_img || null, es_imagen: !!v?.es_imagen, dur_clip: v?.es_imagen ? null : (v?.duracion || null), desde: Number(c.desde) || 0 }; });
  fs.writeFileSync(path.join(ed, 'cortes.json'), JSON.stringify(info));
  fs.writeFileSync(path.join(ed, 'plan.json'), JSON.stringify(plan));
  fs.writeFileSync(path.join(ed, 'palabras.json'), JSON.stringify({ transcription: palabras.map(w => ({ text: ' ' + w.t, offsets: { from: Math.round(w.de * 1000), to: Math.round(w.a * 1000) } })) }));
  fs.writeFileSync(path.join(ed, 'usados.json'), JSON.stringify({ videos: [...new Set(plan.cortes.map(c => c.video))].map(id => idx.find(x => x.id === id)).filter(Boolean) }));
} catch (e) { console.log('Sin guardar datos para editar cortes:', e.message); }
marca(48, 'Escenas elegidas · cortando');
{ const usados = new Set(plan.cortes.map(c => c.video)); console.log('Clips usados:', usados.size, 'de', idx.length, 'disponibles (los que no sirven para este guion no se ponen)'); }
console.log('Plan:', plan.kicker, '|', plan.titulo, '|', plan.cortes.length, 'cortes');

// música de fondo (la IA elige entre las pistas del CRM) y pulsos
let pista = null; const elegida = process.env.MUSICA_ELEGIDA || 'auto';
if (process.env.MUSICA_DIR && elegida !== 'ninguna') {
  const lib = bibliotecaLocal(process.env.MUSICA_DIR);
  if (lib.length) {
    pista = lib.find(p => p.nombre === elegida) || null;
    if (!pista) { if (lib.length === 1) pista = lib[0]; else try { const rr = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': ENV.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: 200, messages: [{ role: 'user', content: 'Elige la pista de música instrumental para un vídeo de Ranuse Design (gimnasios, serio y elegante) titulado "' + plan.titulo + '", montado con cortes rápidos de escenas. Indicaciones: ' + (NOTAS || 'ninguna') + '. Pistas: ' + JSON.stringify(lib.map(p => ({ nombre: p.nombre, bpm: p.bpm, energia: p.energia, dur: p.dur }))) + '. Responde SOLO JSON {"nombre":"..."}' }] }) }); const jj = await rr.json(); const nm = JSON.parse(/{[sS]*}/.exec(jj.content.map(b => b.text || '').join(''))[0]).nombre; pista = lib.find(p => p.nombre === nm) || lib[0]; } catch { pista = lib[0]; } }
  }
  console.log('Música:', pista ? pista.nombre + ' (' + pista.bpm + ' bpm)' : 'ninguna');
}
// 4) tiempos de cada corte
const cortes = plan.cortes.filter(c => idx.find(v => v.id === c.video)).sort((a, b) => a.de - b.de);
cortes.forEach((c, i) => { c.ini = i === 0 ? 0 : (Number.isFinite(c.t0) ? c.t0 : (pista ? alPulso(palabras[c.de]?.de ?? 0, pista.beats, 0.18) : palabras[c.de]?.de ?? 0)); }); // cada cambio de escena cae en un pulso de la música
cortes.forEach((c, i) => { c.fin = i < cortes.length - 1 ? cortes[i + 1].ini : durVoz; c.dur = c.fin - c.ini; });
const valido = cortes.filter(c => c.dur > 0.15);

// 5) render de cada corte: vertical, empujón de zoom suave, color
const partes = []; let t0c = 0; const marcas = [];
const dr = {}; for (const c of valido) { const v = idx.find(z => z.id === c.video); if (v?.drive_id && !dr[v.id]) { try { dr[v.id] = await drive.urlDescarga(v.drive_id); } catch (e) { console.log('Sin acceso a Drive:', e.message); } } }
// Los vídeos de Drive que se usan muchas veces se bajan una sola vez (leerlos por red en cada corte es lentísimo con 4K)
{ const usos = {}; for (const c of valido) usos[c.video] = (usos[c.video] || 0) + 1;
  for (const [id, r] of Object.entries(dr)) { const v = idx.find(z => z.id === id); if (!r.url || !v || usos[id] < 2 || !v.bytes || v.bytes > 3e9) continue;
    const f = path.join(work, 'fuente_' + id + (path.extname(v.nombre || '') || '.mp4'));
    try { console.log('Bajando a local (' + Math.round(v.bytes / 1e6) + ' MB) porque se usa ' + usos[id] + ' veces…'); let rs; for (let k = 0; k < 4; k++) { rs = await fetch(r.url, { headers: r.cabeceras }); if (rs.ok) break; await new Promise(z => setTimeout(z, 3000 * (k + 1))); } if (!rs.ok) throw new Error('HTTP ' + rs.status); await pipeline(Readable.fromWeb(rs.body), fs.createWriteStream(f)); dr[id] = { local: f }; }
    catch (e) { console.log('No se pudo bajar, se lee por red:', e.message); } } }
const hechos = new Array(valido.length).fill(null);
const ejecuta = (args) => new Promise(res => { const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] }); let err = ''; p.stderr.on('data', d => { err += d; }); p.on('close', () => res(err)); });
// Orientación: de cada vídeo se saca un fotograma, se generan sus 4 rotaciones (0, 90 horario, 180, 90 antihorario) y la IA elige en cuál se ve derecho
// (suelo abajo, personas de pie, texto legible). Así no salen planos girados aunque el archivo venga mal grabado o sin marca de giro.
const giroDe = {};
const fuenteDe = (v) => ({ src: dr[v.id] ? (dr[v.id].local || dr[v.id].url) : v.ruta, hdr: dr[v.id]?.cabeceras ? ['-headers', 'Authorization: ' + dr[v.id].cabeceras.Authorization + '\r\n'] : [] });
const VARIANTES = [['A', ''], ['B', 'transpose=1,'], ['C', 'hflip,vflip,'], ['D', 'transpose=2,']];
async function detectaGiros() {
  // Solo los vídeos en horizontal (los grabados en vertical y guardados de lado). Se miran DOS fotogramas y solo se gira si los dos coinciden en la misma rotación:
  // girar un plano que estaba bien es peor que dejar uno ambiguo.
  const cand = [...new Set(valido.map(c => c.video))].map(id => idx.find(z => z.id === id)).filter(v => v && !v.es_imagen && v.ancho > v.alto);
  const cola = cand.slice();
  const pregunta = async (jpg, base) => {
    const cont = [];
    for (const [k, f] of VARIANTES) { const o = base + k + '.jpg'; await ejecuta(['-hide_banner', '-loglevel', 'error', '-y', '-i', jpg, '-vf', f + 'scale=256:256:force_original_aspect_ratio=decrease', o]); if (fs.existsSync(o)) { cont.push({ type: 'text', text: 'Versión ' + k + ':' }); cont.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(o).toString('base64') } }); } }
    cont.push({ type: 'text', text: 'Son 4 rotaciones de la MISMA imagen (A es la original). ¿En cuál se ve la escena derecha: el suelo o la mesa abajo, el cielo o el techo arriba, las personas de pie y el texto legible? Si no se puede saber con seguridad (por ejemplo un primer plano de comida u objetos), responde "A". Responde SOLO JSON {"correcta":"A"|"B"|"C"|"D"}.' });
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': ENV.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: 40, messages: [{ role: 'user', content: cont }] }) });
    const j = await r.json(); return JSON.parse(/\{[\s\S]*\}/.exec(j.content.map(b => b.text || '').join(''))[0]).correcta;
  };
  const uno = async (v) => {
    try {
      const D = v.duracion || 4, { src, hdr } = fuenteDe(v), res = [];
      for (const [n, fr] of [[1, 0.3], [2, 0.7]]) {
        const base = path.join(work, 'giro_' + v.id.replace(/\W/g, '') + n), t = Math.min(Math.max(0.5, D * fr), Math.max(0, D - 0.3));
        await ejecuta(['-hide_banner', '-loglevel', 'error', '-y', ...hdr, '-ss', t.toFixed(2), '-i', src, '-frames:v', '1', '-vf', 'scale=640:-2', base + '.jpg']);
        if (fs.existsSync(base + '.jpg')) res.push(await pregunta(base + '.jpg', base));
      }
      const k = res.length === 2 && res[0] === res[1] ? res[0] : 'A';
      giroDe[v.id] = (VARIANTES.find(x => x[0] === k) || ['A', ''])[1];
      if (giroDe[v.id]) console.log('Girado:', v.nombre, '→', k, '(' + res.join(',') + ')');
    } catch (e) { console.log('Sin comprobar giro de', v.nombre, e.message); }
  };
  await Promise.all(Array.from({ length: 4 }, async () => { while (cola.length) await uno(cola.shift()); }));
}
await detectaGiros();
// Brillo medio (0-255) de un fotograma: para aclarar los planos oscuros (siluetas) y bajar un poco los quemados
const lumaMedia = (src, hdr, t) => new Promise(res => {
  const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...hdr, '-ss', Math.max(0, t).toFixed(2), '-i', src, '-frames:v', '1', '-vf', 'scale=32:56,format=gray', '-f', 'rawvideo', '-'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const trozos = []; p.stdout.on('data', d => trozos.push(d)); p.on('close', () => { const b = Buffer.concat(trozos); if (b.length < 100) return res(null); let sum = 0; for (const x of b) sum += x; res(sum / b.length); });
  setTimeout(() => { try { p.kill(); } catch { /* ya acabó */ } }, 25000);
});
async function cortar(c, i) {
  const v = idx.find(x => x.id === c.video), out = path.join(work, 'c' + pad2(i) + '.mp4');
  const desde = v.es_imagen ? 0 : Math.max(0, Math.min(Number(c.desde) || 0, Math.max(0, v.duracion - c.dur - 0.1)));
  const nf = Math.max(2, Math.round(c.dur * 30)), z1 = RECETA.zoomFinal, dir = i % 2 ? 1 : -1;
  let gamma = 1; if (!v.es_imagen && RECETA.autoLuz !== false) { const { src, hdr } = fuenteDe(v); const m = await lumaMedia(src, hdr, desde + c.dur / 2); if (m && m > 8 && m < 245) { const g = Math.log(m / 255) / Math.log(105 / 255); gamma = Math.max(0.88, Math.min(1.7, g)); if (Math.abs(gamma - 1) < 0.08) gamma = 1; } }
  const luz = gamma !== 1 ? 'eq=gamma=' + gamma.toFixed(2) + ',' : '';
  const vf = (giroDe[v.id] || '') + 'scale=1296:2304:force_original_aspect_ratio=increase,crop=1296:2304,' + luz + 'zoompan=z=\'' + (dir > 0 ? '1+' + (z1 - 1) + '*on/' + nf : z1 + '-' + (z1 - 1) + '*on/' + nf) + '\':d=1:x=\'iw/2-(iw/zoom/2)\':y=\'ih/2-(ih/zoom/2)\':s=1080x1920:fps=30,' + RECETA.color + ',setsar=1,format=yuv420p';
  const loop = v.es_imagen ? ['-loop', '1', '-framerate', '30'] : (v.duracion < c.dur + 0.2 ? ['-stream_loop', '-1'] : []);
  let rr = { stderr: '' };
  for (let intento = 0; intento < 4; intento++) {
    rr = { stderr: await ejecuta(['-hide_banner', '-loglevel', 'error', '-y', ...loop, ...(dr[v.id]?.cabeceras ? ['-headers', 'Authorization: ' + dr[v.id].cabeceras.Authorization + '\r\n'] : []), '-ss', desde.toFixed(2), '-i', dr[v.id] ? (dr[v.id].local || dr[v.id].url) : v.ruta, '-t', c.dur.toFixed(3), '-an', '-vf', vf, ...ARGS_VIDEO(23), out]) };
    if (fs.existsSync(out) && fs.statSync(out).size > 1000) break;
    if (!/403|429|5\d\d|timed out|Connection/i.test(rr.stderr || '')) break;
    await new Promise(r => setTimeout(r, 2500 * (intento + 1)));
  }
  if (!fs.existsSync(out)) { console.log('corte', i, 'falló', (rr.stderr || '').slice(0, 200)); return; }
  hechos[i] = { out, ini: c.ini }; hechosN++; marca(48 + Math.round(38 * hechosN / valido.length), 'Cortando escenas ' + hechosN + ' de ' + valido.length);
}
let hechosN = 0;
// varios cortes a la vez: el ordenador tiene de sobra para 3 procesos de ffmpeg
{ const cola = valido.map((_, i) => i), POOL = Number(process.env.CORTES_EN_PARALELO || 3);
  await Promise.all(Array.from({ length: POOL }, async () => { while (cola.length) { const i = cola.shift(); await cortar(valido[i], i); } })); }
// Si algún corte no se pudo sacar (p. ej. Drive limitó la lectura de un archivo), se rellena con el de un vecino para no descuadrar el vídeo con la voz
for (let i = 0; i < valido.length; i++) {
  if (hechos[i]) continue;
  const orden = hechos.map((h, j) => [Math.abs(j - i), j]).filter(([, j]) => hechos[j]).sort((a, b) => a[0] - b[0]); if (!orden.length) continue;
  const k = orden[0][1], out = path.join(work, 'r' + pad2(i) + '.mp4');
  await ejecuta(['-hide_banner', '-loglevel', 'error', '-y', '-stream_loop', '-1', '-i', hechos[k].out, '-t', valido[i].dur.toFixed(3), '-an', ...ARGS_VIDEO(23), out]);
  if (fs.existsSync(out) && fs.statSync(out).size > 1000) { hechos[i] = { out, ini: valido[i].ini }; console.log('Corte', i, 'rellenado con el vecino', k, '(no se pudo leer su escena original)'); }
}
for (const h of hechos) if (h) { partes.push(h.out); marcas.push(h.ini); }
fs.writeFileSync(path.join(work, 'lista.txt'), partes.map(p => "file '" + p.replace(/\\/g, '/') + "'").join('\n'));

// 6) subtítulos "pop" de 1-2 palabras (estilo dopamínico serio) + título + flashes + barra de progreso
// ¿Dónde está la cara en cada escena? (visión sobre un fotograma de cada corte): los subtítulos se colocan donde no la tapen
const bandas = [];
if (RECETA.subsBajoCara !== false) try {
  const fr = [];
  hechos.forEach((h, i) => { if (!h || !valido[i]) return; const jpg = path.join(work, 'face_' + i + '.jpg'); run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', Math.max(0, valido[i].dur / 2).toFixed(2), '-i', h.out, '-frames:v', '1', '-vf', 'scale=270:-2', jpg]); if (fs.existsSync(jpg)) fr.push({ i, jpg }); });
  const lotes = []; for (let k = 0; k < fr.length; k += 10) lotes.push(fr.slice(k, k + 10));
  await enParalelo(lotes, 4, async (lote) => {
    try {
      const cont = []; lote.forEach((x, j) => { cont.push({ type: 'text', text: 'Imagen ' + (j + 1) + ':' }); cont.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(x.jpg).toString('base64') } }); });
      cont.push({ type: 'text', text: 'Para cada imagen indica la franja VERTICAL (0 = borde superior, 1 = borde inferior) que ocupan la cabeza o la cara de las personas visibles (de la parte más alta de una cabeza a la más baja de una barbilla). Si no se ve ninguna persona o cara, pon null. Responde SOLO JSON {"imagenes":[{"n":1,"cara":[arriba,abajo] o null}]}' });
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': ENV.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1200, messages: [{ role: 'user', content: cont }] }) });
      const j = await r.json(); const d = JSON.parse(/\{[\s\S]*\}/.exec(j.content.map(b2 => b2.text || '').join(''))[0]);
      for (const it of (d.imagenes || [])) { const x = lote[(it.n || 1) - 1]; if (x && Array.isArray(it.cara) && it.cara.length === 2 && it.cara[1] > it.cara[0]) bandas.push({ ini: hechos[x.i].ini, fin: hechos[x.i].ini + valido[x.i].dur, t: it.cara[0] * 1920, b: it.cara[1] * 1920 }); }
    } catch (e) { console.log('Sin localizar caras en un lote:', e.message); }
  });
  console.log('Caras localizadas en', bandas.length, 'de', fr.length, 'escenas');
} catch (e) { console.log('Sin localizar caras:', e.message); }
const ev = []; const bloques = []; let b = [];
// intro con palabras enormes apiladas (estilo "mi día"): sustituye a los subtítulos normales durante la frase de apertura
const intro = RECETA.introLetras ? introLetras(palabras, tAss, limpiaT) : { eventos: [], ultima: -1, fin: 0 };
ev.push(...intro.eventos);
const enf = new Set(plan.enfasis || []);
palabras.forEach((w, i) => { w.i = i; if (i <= intro.ultima) return; b.push(w); if (b.length >= RECETA.subs.palabrasPorBloque || /[.?!,]$/.test(w.t)) { bloques.push(b); b = []; } }); if (b.length) bloques.push(b);
bloques.forEach((bl, k) => {
  const ini = bl[0].de, fin = k < bloques.length - 1 ? Math.max(bloques[k + 1][0].de, ini + 0.25) : Math.max(bl[bl.length - 1].a, ini + 0.4);
  const txt = bl.map(w => { const fuerte = enf.has(w.i) || /\d/.test(w.t); const s = (RECETA.mayusculas === true ? limpiaT(w.t).toUpperCase() : limpiaT(w.t).toLowerCase()).replace(/[.,;:¿¡]+$/, ''); return fuerte ? '{\\c' + RECETA.acento + '}' + s + '{\\c&HFFFFFF&}' : s; }).join(' ');
  // si el subtítulo caería sobre una cara, se mueve a otra zona libre (abajo o arriba)
  let pos = ''; { const mid = (ini + fin) / 2, bd = bandas.find(z => mid >= z.ini && mid < z.fin);
    if (bd) { const alto = RECETA.subs.tam * 1.35, tapa = (yBase) => !(yBase < bd.t - 50 || yBase - alto > bd.b + 50);
      const ybase0 = 1920 - RECETA.subs.margenV; if (tapa(ybase0)) { const alt = [1640, 1420, 470, 340].find(y => !tapa(y)); if (alt) pos = '\\an2\\pos(540,' + alt + ')'; } } }
  ev.push('Dialogue: 1,' + tAss(ini) + ',' + tAss(fin) + ',Sub,,0,0,0,,{' + pos + '\\fscx82\\fscy82\\t(0,110,\\fscx100\\fscy100)\\fad(40,0)}' + txt);
});
const tf = Math.min(durVoz, 3.2);
if (RECETA.titulo !== false) {
ev.push('Dialogue: 3,' + tAss(0) + ',' + tAss(tf) + ',Kicker,,0,0,0,,{\\fad(200,300)}' + limpiaT(plan.kicker || '').toLowerCase().split('').join('\u200A'));
ev.push('Dialogue: 3,' + tAss(0) + ',' + tAss(tf) + ',Titulo,,0,0,0,,{\\fad(250,350)}' + limpiaT(plan.titulo || '').toLowerCase());
ev.push('Dialogue: 3,' + tAss(0.1) + ',' + tAss(tf) + ',Kicker,,0,0,0,,{\\an8\\pos(540,360)\\p1\\c' + RECETA.acento + '\\fad(200,300)\\t(0,500,\\fscx100)\\fscx0}m -45 0 l 45 0 45 4 -45 4{\\p0}');
}
if (RECETA.flash) marcas.slice(1).forEach(m => ev.push('Dialogue: 4,' + tAss(m) + ',' + tAss(m + 0.09) + ',Kicker,,0,0,0,,{\\an7\\pos(0,0)\\p1\\c&HFFFFFF&\\alpha&H9C&\\fad(0,80)}m 0 0 l 1080 0 1080 1920 0 1920{\\p0}'));
ev.push('Dialogue: 4,' + tAss(0) + ',' + tAss(durVoz) + ',Kicker,,0,0,0,,{\\an7\\pos(0,1896)\\p1\\c' + RECETA.acento + '\\fscx0\\t(0,' + Math.round(durVoz * 1000) + ',\\fscx100)}m 0 0 l 1080 0 1080 7 0 7{\\p0}');
// etiquetas de hora grandes ("9:00") justo sobre los subtítulos, como en los vídeos de "mi día"
if (RECETA.horas) for (const h of (plan.horas || [])) { const w = palabras[h.de]; if (!w || !h.texto) continue; ev.push('Dialogue: 2,' + tAss(w.de) + ',' + tAss(Math.min(durVoz, w.de + 1.8)) + ',Hora,,0,0,0,,{\\fad(80,150)\\fscx80\\fscy80\\t(0,130,\\fscx100\\fscy100)}' + limpiaT(h.texto)); }
const ass = ['[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1080', 'PlayResY: 1920', 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '', '[V4+ Styles]',
  'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
  'Style: Sub,' + RECETA.fuente + ',' + RECETA.subs.tam + ',&H00FFFFFF,&H000000FF,&H00101010,&H88000000,-1,0,0,0,100,100,0,0,1,' + (RECETA.mayusculas === true && RECETA.subs.tam > 70 ? '9,4' : '1,2') + ',2,50,50,' + RECETA.subs.margenV + ',1',
  ESTILO_INTRO,
  'Style: Kicker,Montserrat,34,' + RECETA.acento.replace('&H', '&H00').replace(/&$/, '') + ',&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,4,0,1,0,0,8,80,80,300,1',
  'Style: Hora,' + RECETA.fuente + ',118,&H00FFFFFF,&H000000FF,&H00101010,&H88000000,-1,0,0,0,100,100,0,0,1,2,3,8,60,60,500,1',
  'Style: Titulo,Montserrat,60,&H00FFFFFF,&H000000FF,&H00000000,&HA0000000,-1,0,0,0,100,100,1,0,1,3,5,8,90,90,385,1', '', '[Events]', 'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text'].concat(ev).join('\n');
fs.writeFileSync(path.join(work, 'subs.ass'), '\uFEFF' + ass, 'utf8');
copiaModelo(work);
fs.mkdirSync(path.join(work, 'fonts'), { recursive: true }); fs.copyFileSync(FONT, path.join(work, 'fonts', 'Montserrat-Bold.ttf'));
for (const f of ['Rubik-Bold.ttf', 'Rubik-Regular.ttf']) { const o = new URL('./fonts/' + f, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'); if (fs.existsSync(o)) fs.copyFileSync(o, path.join(work, 'fonts', f)); }

marca(88, 'Montando el vídeo final con música y subtítulos');
// 7) audio: voz limpia + whoosh sutil en cada corte
const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', 'lista.txt', '-i', 'voz48.wav'];
let fa = '[1:a]' + RECETA.voz + '[voz]';
if (RECETA.whoosh > 0 && marcas.length > 1) {
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anoisesrc=d=0.4:c=pink:a=0.6:r=48000', '-af', 'highpass=f=500,lowpass=f=6000,afade=t=in:st=0:d=0.22,afade=t=out:st=0.2:d=0.2,volume=' + RECETA.whoosh, path.join(work, 'whoosh.wav')]);
  const n = marcas.length - 1; args.push('-i', 'whoosh.wav');
  fa += ';[2:a]asplit=' + n + marcas.slice(1).map((_, k) => '[w' + k + ']').join('') + ';' + marcas.slice(1).map((m, k) => '[w' + k + ']adelay=' + Math.max(0, Math.round((m - 0.2) * 1000)) + ':all=1[d' + k + ']').join(';') + ';[voz]' + marcas.slice(1).map((_, k) => '[d' + k + ']').join('') + 'amix=inputs=' + (n + 1) + ':normalize=0:duration=first,alimiter=limit=0.95[va]';
} else fa += ';[voz]anull[va]';
if (pista) { args.push('-stream_loop', '-1', '-i', pista.ruta); fa += ';' + mezcla({ entradaIdx: args.filter(x => x === '-i').length - 1, voz: 'va', durTotal: durVoz, db: Number(RECETA.musica.volumen) || -19, salida: 'a' }); } else fa += ';[va]anull[a]';
args.push('-filter_complex', '[0:v]ass=subs.ass:fontsdir=fonts[v];' + fa, '-map', '[v]', '-map', '[a]', ...ARGS_VIDEO(23), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', '-movflags', '+faststart', path.resolve(SALIDA));
const fin = run('ffmpeg', args, { cwd: work });
console.log(fs.existsSync(SALIDA) ? 'OK ' + SALIDA + ' · ' + (fs.statSync(SALIDA).size / 1048576).toFixed(1) + ' MB' : 'FALLO ' + (fin.stderr || '').slice(0, 800));
