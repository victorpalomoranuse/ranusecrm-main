// Edición de un vídeo en bruto hablando a cámara: quita pausas, repeticiones y errores; encuadra a la cara con zooms in/out que esconden los cortes;
// subtítulos bajo la cara; gráficos animados (cifra + icono); música de fondo por debajo de la voz con los cambios de plano a pulso.
// Uso: node bruto.mjs "<bruto.mp4>" "<salida.mp4>" ["indicaciones"]   (receta con RECETA_JSON; música con MUSICA_DIR y MUSICA_ELEGIDA)
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { tarjetaPNG, NOMBRES_ICONOS } from './iconos.mjs';
import { copiaFuentes } from './fuentes.mjs';
import { bibliotecaLocal, alPulso, mezcla } from './musica.mjs';
import * as drive from './drive.mjs';
import { ENV } from './entorno.mjs';
import { ARGS_VIDEO } from './codec.mjs';
import { transcribe } from './transcribir.mjs';
import { CADENA_VOZ, copiaModelo, corrigeTrabones, repetidasInmediatas, guionLimpio, ajustaAlGuion, numerosEnCifras, envolvente, etiquetasHablantes } from './voz.mjs';

const [ENTRADA, SALIDA, NOTAS = ''] = process.argv.slice(2);
if (!ENTRADA || !SALIDA) { console.log('Uso: node bruto.mjs "<bruto>" "<salida.mp4>" ["indicaciones"]'); process.exit(1); }
const WHISPER = process.env.WHISPER_CLI || 'C:/Users/cashc/AppData/Local/RanuseVideo/whisper/Release/whisper-cli.exe';
const MODELO_W = process.env.WHISPER_MODEL || 'C:/Users/cashc/AppData/Local/RanuseVideo/whisper/ggml-large-v3-turbo-q5_0.bin';
const FONT = new URL('../public/fonts/Montserrat-Bold.ttf', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// Paleta Ranuse: oscura y elegante (negros, grises, marrones cálidos)
const R = { acento: '#CDBBA7', titulo: true, pausa: 0.4, subs: { palabrasPorBloque: 2, tam: 76, margenV: 600 }, zoomFinal: 1.2, barra: false, mayusculas: false, resaltar: true, encuadre: false, encuadreZoom: 1.3, subsBajoCara: false, graficos: false, fuente: 'Montserrat', limpiar: true, inserciones: false, musica: { volumen: -19 } };
if (process.env.INSERCIONES === '1') R.inserciones = true;
if (process.env.RECETA_JSON) {
  const o = JSON.parse(fs.readFileSync(process.env.RECETA_JSON, 'utf8'));
  for (const k of ['acento', 'titulo', 'zoomFinal', 'barra', 'mayusculas', 'resaltar', 'encuadre', 'encuadreZoom', 'subsBajoCara', 'graficos', 'pausa', 'limpiar', 'fuente', 'whoosh', 'flash', 'cambioCada', 'director', 'cambiosEnFrases', 'intensidad', 'ilustraciones', 'estiloSubs', 'preguntaSoloEscrita']) if (o[k] !== undefined) R[k] = o[k];
  if (o.subs) R.subs = { ...R.subs, ...o.subs }; if (o.musica && typeof o.musica === 'object') R.musica = { ...R.musica, ...o.musica };
}
if (!/^#[0-9a-f]{6}$/i.test(R.acento)) R.acento = '#CDBBA7';
const ACENTO = '&H' + R.acento.slice(5, 7) + R.acento.slice(3, 5) + R.acento.slice(1, 3) + '&';
if (!['Montserrat', 'Rubik'].includes(R.fuente)) R.fuente = 'Montserrat';
const GROSOR = R.mayusculas === true && R.subs.tam > 70 ? '9,4' : '1,2'; // sombra muy leve y limpia
const AUDIO = CADENA_VOZ;
const work = path.resolve(path.dirname(SALIDA), '_trabajo_' + path.basename(SALIDA, '.mp4')); fs.mkdirSync(work, { recursive: true });
const run = (c, a, o = {}) => spawnSync(c, a, { encoding: 'utf8', maxBuffer: 1 << 28, ...o });
const pad2 = n => String(n).padStart(2, '0');
const tAss = t => { const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t - h * 3600 - m * 60; return h + ':' + pad2(m) + ':' + s.toFixed(2).padStart(5, '0'); };
const limpiaT = t => String(t).replace(/[{}\\]/g, '');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const claude = async (content, max = 1500) => {
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': ENV.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: max, messages: [{ role: 'user', content }] }) });
  const j = await r.json(); if (!r.ok) throw new Error('Claude ' + r.status); return JSON.parse(/\{[\s\S]*\}/.exec(j.content.map(b => b.text || '').join(''))[0]);
};

// Director de edición: el modelo más capaz que tenga la cuenta (si uno no existe, se prueba el siguiente)
const MODELOS_DIRECTOR = [ENV.EDITOR_MODEL, 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-sonnet-4-5-20250929'].filter(Boolean);
const claudeMejor = async (content, max = 2500) => {
  let ultimo = null;
  for (const modelo of MODELOS_DIRECTOR) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': ENV.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: modelo, max_tokens: Math.max(max, 3000), messages: [{ role: 'user', content }] }) });
      const j = await r.json(); if (!r.ok) throw new Error('Claude ' + r.status + ' ' + (j.error?.message || '').slice(0, 80));
      return JSON.parse(/\{[\s\S]*\}/.exec(j.content.map(b => b.text || '').join(''))[0]);
    } catch (e) { ultimo = e; console.log('Director de edición (' + modelo + '):', e.message); }
  }
  throw ultimo || new Error('sin modelo');
};

// ---- datos del vídeo ----
const pr = JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:stream_side_data=rotation:format=duration', '-of', 'json', ENTRADA]).stdout);
let W = pr.streams[0].width, H = pr.streams[0].height; const rot = Math.abs(Number(pr.streams[0].side_data_list?.[0]?.rotation || 0)); if (rot === 90 || rot === 270) [W, H] = [H, W];
const dur = Number(pr.format.duration) || 0; const marca = (n, t) => console.log('##PCT ' + n + ' ' + t);
marca(8, 'Leyendo el vídeo');
console.log('Bruto:', W + 'x' + H, dur.toFixed(1), 's');
if (!dur) { console.log('FALLO: no he podido leer el vídeo (¿falta ffmpeg o el archivo está dañado?)'); process.exit(1); }

// ---- voz -> palabras ----
const wav = path.join(work, 'voz.wav'); run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', ENTRADA, '-vn', '-ac', '1', '-ar', '16000', wav]);
marca(12, 'Transcribiendo la voz');
const wj = path.join(work, 'palabras');
await transcribe(wav, wj, { alinear: true });
const palabras = JSON.parse(fs.readFileSync(wj + '.json', 'utf8').replace(/^\uFEFF/, '')).transcription.map(s => ({ t: s.text.trim(), de: s.offsets.from / 1000, a: s.offsets.to / 1000, ...(s.spk !== undefined ? { spk: s.spk } : {}) })).filter(w => w.t && !/^\[.*\]$/.test(w.t));
if (!palabras.length) { console.log('FALLO: no se oye voz en el vídeo'); process.exit(1); }
if (process.env.GUION) console.log('Palabras corregidas con el guion:', ajustaAlGuion(palabras, process.env.GUION));
console.log('Números escritos con cifras:', numerosEnCifras(palabras));
palabras.forEach((w, i) => { w.i = i; });
const trabones = corrigeTrabones(palabras, wav); if (trabones) console.log('Tropiezos recortados:', trabones);

// ---- catálogo de escenas para superponer (B-roll del índice, filtrado por lo que se eligió en el CRM) ----
let catalogo = [];
if (R.inserciones && process.env.INDICE_JSON) {
  try {
    let sel = {}; try { sel = JSON.parse(process.env.RECURSOS_SEL || '{}'); } catch { /* todo */ }
    const carps = sel.carpetas || [], vids = sel.videos || [];
    let todos = JSON.parse(fs.readFileSync(process.env.INDICE_JSON, 'utf8')).videos.filter(v => v.duracion >= 2 && (!process.env.BASE_DRIVE_ID || v.drive_id !== process.env.BASE_DRIVE_ID));
    if (carps.length || vids.length) { const f = todos.filter(v => { const abs = v.ruta_abs ?? v.carpeta ?? ''; return carps.some(c => abs === c || abs.startsWith(c + '/')) || vids.some(z => z.id === v.drive_id || (z.ruta ? z.ruta + '/' : '') + z.nombre === (abs ? abs + '/' : '') + v.nombre); }); if (f.length) todos = f; }
    else todos = todos.filter(v => !v.hablando_a_camara && v.tipo !== 'bruto_hablando');
    todos.sort((a, b) => (b.calidad === 'alta') - (a.calidad === 'alta')); catalogo = todos.slice(0, 150);
    console.log('Catálogo para superponer:', catalogo.length, 'vídeos');
  } catch (e) { console.log('Sin catálogo para superponer:', e.message); }
}
marca(40, 'La IA decide qué quitar y qué superponer');
// ---- IA: qué se quita (repeticiones, errores), título, palabras clave y gráficos ----
let plan = { kicker: 'RANUSE DESIGN', titulo: '', enfasis: [], quitar: [], graficos: [] };
try {
  const guion = palabras.map((w, i) => i + ':' + w.t).join(' ');
  plan = { ...plan, ...(await claude('Vídeo vertical de Ranuse Design (diseño de gimnasios y espacios deportivos), alguien hablando a cámara. Transcripción (índice:palabra): ' + guion.slice(0, 12000) + '\n' + (NOTAS ? 'Indicaciones del equipo: ' + NOTAS + '\n' : '') +
    'Responde SOLO JSON con: "kicker" (categoría de 2-4 palabras), "titulo" (gancho serio, máx. 8 palabras, sin exclamaciones), "enfasis" (ÍNDICES de palabras clave: cifras, términos técnicos, la idea fuerte; ~1 de cada 6 palabras)' +
    (R.limpiar !== false ? ', "quitar": lista de rangos [desde, hasta] de ÍNDICES (inclusivos) que hay que ELIMINAR para que la comunicación sea fluida y ágil: frases o preguntas dichas dos veces (quédate con la mejor toma, normalmente la última y completa), empezar una frase y rehacerla, errores, muletillas largas (eh, mmm, o sea repetido), comentarios al aire que no son parte del vídeo (órdenes al que graba, "vale", "otra vez"). No quites contenido útil; sé conservador ante la duda' : '') +
    (catalogo.length ? ', "inserciones": lista de 3 a 8 momentos en los que conviene SUPERPONER una escena del catálogo sobre la persona (su voz sigue sonando) porque dice algo que se puede ilustrar: un proyecto, máquinas, materiales, medidas, un lugar. Cada una: {"de": índice de la palabra donde entra (que NO esté en "quitar"), "video": id del catálogo, "desde": segundo del vídeo (usa los de sus planos), "dur": segundos 1.6-3.5}. Separadas al menos 5 s, ni en los primeros 2 s ni en la idea emocional o la llamada a la acción final. CATÁLOGO: ' + JSON.stringify(catalogo.map(v => ({ id: v.id, dur: v.duracion, resumen: v.resumen, planos: (v.planos || []).slice(0, 6).map(p => p.t + 's: ' + String(p.descripcion).slice(0, 90)) }))) : '') + (R.graficos ? ', "graficos": lista de 3 a 6 momentos donde aparece una cifra, medida o concepto que merece una animación en pantalla. Cada uno: {"de": índice de la palabra donde entra (que NO esté en "quitar"), "valor": "140" (solo la cifra, o ""), "unidad": "kg" (o ""), "texto": "texto corto si no hay cifra (máx. 3 palabras)", "icono": uno de [' + NOMBRES_ICONOS.join(', ') + '] o "", "dur": segundos visible (1.6-2.6)}. No satures, separados al menos 4 segundos' : '') + '.', 2200)) };
} catch (e) { console.log('Sin IA para limpieza/título/gráficos:', e.message); }
fs.writeFileSync(path.join(work, 'plan.json'), JSON.stringify(plan, null, 1));
const fuera = new Set(); for (const r of (plan.quitar || [])) if (Array.isArray(r) && Number.isInteger(r[0])) for (let i = r[0]; i <= (Number.isInteger(r[1]) ? r[1] : r[0]); i++) fuera.add(i);
if (fuera.size) console.log('Se quitan', fuera.size, 'palabras (repeticiones/errores):', [...fuera].slice(0, 40).map(i => palabras[i]?.t).join(' '));
{ const limpio = R.limpiar !== false ? await guionLimpio(palabras, ENV.ANTHROPIC_API_KEY, NOTAS, !!process.env.TITULO_PANTALLA) : null;
  if (limpio) { fuera.clear(); for (const i of limpio) fuera.add(i); console.log('Discurso final elegido por la IA:', palabras.length - limpio.size, 'de', palabras.length, 'palabras'); } }
for (const i of repetidasInmediatas(palabras.filter(w => !fuera.has(w.i)))) fuera.add(i);
// Edición por texto: si la persona ha elegido a mano qué palabras quitar, manda ella (se ignora la propuesta de la IA)
if (process.env.FUERA_JSON) { try { const man = JSON.parse(fs.readFileSync(process.env.FUERA_JSON, 'utf8')); fuera.clear(); for (const i of man) if (Number.isInteger(i)) fuera.add(i); console.log('Texto editado a mano:', fuera.size, 'palabras quitadas'); } catch (e) { console.log('No se pudo leer la edición de texto:', e.message); } }
// Si el formato lo pide, la pregunta solo aparece escrita (no se oye al entrevistador): se quitan sus palabras
if (R.preguntaSoloEscrita) { const et = etiquetasHablantes(palabras); let n = 0; palabras.forEach((w, i) => { if (et[i] === 'P' && !fuera.has(w.i)) { fuera.add(w.i); n++; } }); if (n) console.log('La pregunta solo sale escrita: se quitan', n, 'palabras del entrevistador'); }
// se guarda la transcripción y lo que se quita para que la persona pueda revisarlo y corregirlo
try { fs.writeFileSync(path.join(work, 'edicion_texto.json'), JSON.stringify({ palabras: palabras.map(w => [w.t, Math.round(w.de * 100) / 100, Math.round(w.a * 100) / 100]), fuera: [...fuera] })); } catch { /* sin edición de texto */ }
const enfasis = new Set((plan.enfasis || []).filter(n => Number.isInteger(n)));

// ---- música (elegida por la IA entre las pistas del CRM) ----
let pista = null;
const elegida = process.env.MUSICA_ELEGIDA || 'auto';
if (process.env.MUSICA_DIR && elegida !== 'ninguna' && R.musica !== false) {
  const lib = bibliotecaLocal(process.env.MUSICA_DIR);
  if (lib.length) {
    pista = lib.find(p => p.nombre === elegida) || null;
    if (!pista) { // auto
      if (lib.length === 1) pista = lib[0];
      else try { const r = await claude('Elige la pista de música instrumental de fondo para un vídeo de Ranuse Design (gimnasios, serio y elegante) titulado "' + plan.titulo + '". Indicaciones: ' + (NOTAS || 'ninguna') + '. Pistas: ' + JSON.stringify(lib.map(p => ({ nombre: p.nombre, bpm: p.bpm, energia: p.energia, dur: p.dur }))) + '. Para charla seria se prefiere una pista de energía media y constante. Responde SOLO JSON {"nombre":"..."}', 200); pista = lib.find(p => p.nombre === r.nombre) || lib[0]; } catch { pista = lib[0]; }
    }
  }
  console.log('Música:', pista ? pista.nombre + ' (' + pista.bpm + ' bpm)' : 'ninguna');
}

// ---- cara: dónde está para encuadrar y colocar los subtítulos debajo ----
let cara = null;
if (R.encuadre || R.subsBajoCara) {
  const cf = path.join(work, 'cara.json');
  if (fs.existsSync(cf)) cara = JSON.parse(fs.readFileSync(cf, 'utf8'));
  else {
    try {
      const imgs = []; for (let i = 0; i < 4; i++) { const f = path.join(work, 'cara' + i + '.jpg'); run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', (dur * (0.15 + 0.2 * i)).toFixed(2), '-i', ENTRADA, '-frames:v', '1', '-vf', 'scale=640:-2', f]); if (fs.existsSync(f)) imgs.push(f); }
      const cont = []; imgs.forEach((f, i) => { cont.push({ type: 'text', text: 'Fotograma ' + (i + 1) }); cont.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(f).toString('base64') } }); });
      cont.push({ type: 'text', text: 'Localiza la cara de la persona que habla en cada fotograma. Coordenadas NORMALIZADAS (0-1). "cx" = centro horizontal de la cara, "cy" = centro vertical, "alto" = altura de la cara (frente a barbilla) como fracción del alto de la imagen, "personas" = cuántas personas distintas se ven con la cara visible. Responde SOLO JSON: {"fotogramas":[{"cx":0.5,"cy":0.3,"alto":0.2,"personas":1}]}' });
      const r = await claude(cont, 400); const l = (r.fotogramas || []).filter(x => x.cx >= 0 && x.cx <= 1 && x.cy >= 0 && x.cy <= 1 && x.alto > 0.03 && x.alto < 0.8);
      const med = k => { const v = l.map(x => x[k]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
      if (l.length) cara = { cx: med('cx'), cy: med('cy'), alto: med('alto'), personas: (() => { const v = l.map(x => Number(x.personas) || 1).sort((p, q) => p - q); return v[Math.floor(v.length / 2)]; })() };
    } catch (e) { console.log('Sin detección de cara:', e.message); }
    if (cara) fs.writeFileSync(cf, JSON.stringify(cara));
  }
  console.log('Cara:', cara ? JSON.stringify(cara) : 'no detectada (encuadre centrado)');
}

// ---- encuadre 9:16 ----
const hcMax = (() => { let hc = H, wc = hc * 9 / 16; if (wc > W) { wc = W; hc = wc * 16 / 9; } return hc; })();
const hcBase = R.encuadre ? hcMax / clamp(Number(R.encuadreZoom) || 1.3, 1, 2) : hcMax;
function ventana(z) {
  const hc = clamp(hcBase / z, 200, hcMax), wc = hc * 9 / 16;
  const cx = cara ? cara.cx * W : W / 2, cy = cara ? cara.cy * H : H / 2;
  const x0 = clamp(cx - wc / 2, 0, W - wc), y0 = cara && R.encuadre ? clamp(cy - 0.33 * hc, 0, H - hc) : clamp((H - hc) / 2, 0, H - hc);
  return { hc: Math.round(hc / 2) * 2, wc: Math.round(wc / 2) * 2, x0: Math.round(x0), y0: Math.round(y0) };
}
const ANCHO = !!(cara && cara.personas >= 2 && R.layout === 'ancho' && W > H); /* solo si el formato lo pide: en pruebas el plano ancho dejaba a la persona diminuta */
if (ANCHO) console.log('Hay', cara.personas, 'personas en el plano: se usa el plano ancho (se ven todos) en vez de recortar a una cara');
let subTop = null;
if (ANCHO) subTop = 1290;
else if (R.subsBajoCara && cara) { const v = ventana(1.05), chin = (cara.cy + cara.alto * 0.4) * H; subTop = clamp(Math.round((chin - v.y0) / v.hc * 1920 + 70), 520, 1500); console.log('Subtítulos a y =', subTop); }

// ---- trozos de voz continuos: se quitan pausas, repeticiones y errores ----
const trozos = []; let ult = -2;
for (const w of palabras) { if (fuera.has(w.i)) continue; const u = trozos[trozos.length - 1]; if (u && w.i === ult + 1 && w.de - u.fin < R.pausa) { u.fin = w.a; } else trozos.push({ ini: w.de, fin: w.a }); ult = w.i; }
// los cambios de plano dentro de un trozo largo caen a pulso de la música
// Los tiempos de palabra de la transcripción pueden ir desplazados (en algunos audios ~0,3 s) y dejar restos de palabras que se querían quitar:
// cada corte se lleva al SILENCIO real más cercano (hacia atrás desde el punto nominal, hasta 0,45 s), para no dejar ni comerse palabras.
try {
  const env = envolvente(wav); const v70 = Array.from(env).filter(x => x > 0).sort((p, q) => p - q), ref = v70[Math.floor(v70.length * 0.7)] || 0, sil = ref * 0.22;
  const atras = (desde, limite) => { const i0 = Math.min(env.length - 1, Math.round(desde * 100)), i1 = Math.max(0, Math.round(limite * 100)); for (let i = i0; i >= i1; i--) if (env[i] < sil) return i / 100; return null; };
  let movidos = 0;
  trozos.forEach((tr, k) => {
    const prevFin = k > 0 ? trozos[k - 1].fin : 0, sigIni = k < trozos.length - 1 ? trozos[k + 1].ini : dur;
    const a = atras(tr.ini + 0.05, Math.max(prevFin + 0.02, tr.ini - 0.45)); if (a !== null && Math.abs(a - tr.ini) > 0.04) { tr.ini = a; tr.sa = true; movidos++; }
    const b = atras(tr.fin + 0.06, Math.max(tr.ini + 0.3, tr.fin - 0.45)); if (b !== null && b > tr.ini + 0.2 && b < sigIni && Math.abs(b - tr.fin) > 0.04) { tr.fin = b; tr.sb = true; movidos++; }
  });
  if (movidos) console.log('Cortes ajustados al silencio más cercano:', movidos);
} catch (e) { console.log('Sin ajustar los cortes a los silencios:', e.message); }
console.log('Trozos de voz que se conservan:', trozos.map(t => t.ini.toFixed(1) + '-' + t.fin.toFixed(1)).join(' '));
const piezas = []; let acum = 0;
// ── DIRECTOR DE EDICIÓN ──
// Un editor profesional no pone un efecto cada X segundos: cada zoom, flash o golpe de sonido tiene una razón en lo que se dice (la idea clave, una cifra, un giro, el remate).
// La IA lee el texto final y decide DÓNDE va cada efecto y de qué tipo; el motor los coloca. Si no hay IA, quedan cortes limpios en las pausas y un movimiento muy suave.
const FLASH_OK = R.flash === true || R.flash === 'si';
const conservadas = palabras.filter(w => !fuera.has(w.i));
const INTENSIDAD = ['sobria', 'media', 'alta'].includes(R.intensidad) ? R.intensidad : 'media';
const TIPOS_EFECTO = ['zoom', 'zoomFuerte', 'abierto', 'empuje', 'temblor', 'glitch', 'blancoNegro', 'vineta', 'apagon', 'barrido', 'calido', 'palabra', ...(FLASH_OK ? ['flash', 'flashColor', 'impacto'] : [])];
const ESTILO_IMG = 'Imagen vertical 9:16 para superponer en un vídeo de Instagram de Ranuse Design (diseño de gimnasios). Estilo: fotografía/render realista y elegante, iluminación cinematográfica, paleta oscura (negros, grises, marrones cálidos) con un acento arena. SIN texto, SIN logotipos, SIN marcas y SIN personas reconocibles. Escena: ';
const QUIERE_IMG = R.ilustraciones !== false && !!ENV.OPENAI_API_KEY;
let efectos = []; /* { i, t (tiempo original), tipo, texto, motivo } */
let ilustraciones = []; /* { i, t, dur, prompt, motivo } */
let analisis = null;
if (R.director !== false && conservadas.length > 12) {
  try {
    let tf = 0; const tiempoFinal = new Map(); // segundos aproximados en el vídeo final (antes de cortes de plano)
    for (const tr of trozos) { for (const w of conservadas) if (w.de >= tr.ini - 0.01 && w.a <= tr.fin + 0.12) tiempoFinal.set(w.i, tf + (w.de - tr.ini)); tf += (tr.fin - tr.ini) + 0.19; }
    const texto = conservadas.map(w => w.i + ':' + w.t + (tiempoFinal.has(w.i) && /[.?!]$/.test(w.t) ? ' [' + tiempoFinal.get(w.i).toFixed(1) + 's]' : '')).join(' ');
    const dens = { sobria: 'un efecto cada 8-12 s, solo de cámara y alguna palabra en pantalla', media: 'un efecto cada 5-8 s', alta: 'un efecto cada 3-5 s, usando variedad' }[INTENSIDAD];
    const r = await claudeMejor('Eres un editor de vídeo profesional y un guionista especializado en redes sociales (Reels, TikTok, Shorts) y diseño, con ojo para lo que se hace viral. Trabajas para Ranuse Design (diseño de gimnasios y espacios deportivos). Este es un vídeo vertical de alguien hablando a cámara; abajo tienes el texto FINAL ya limpio (índice:palabra; entre corchetes, los segundos aproximados en el vídeo al acabar una frase). Dura unos ' + durFinalEstimada().toFixed(0) + ' s.\n\n' + texto.slice(0, 14000) + '\n\n' +
      'TU TRABAJO TIENE TRES PARTES:\n' +
      '1) ANÁLISIS DE LA HISTORIA como lo haría un editor jefe: de qué va, cómo es el gancho actual (¿para el scroll?), el arco (gancho → planteamiento → nudo/giro → remate → cierre) señalando en qué palabra (índice) arranca cada momento, qué puntos son FUERTES, cuáles FLOJOS o donde se cae la retención, un potencial viral de 0 a 100 con el porqué y qué mejorarías (en el texto, el ritmo o lo visual).\n' +
      '2) EFECTOS dirigidos con criterio, uno por razón narrativa (nunca por rutina). Repertorio:\n' +
      '- "zoom": acercamiento suave sobre una idea clave o un dato.   - "zoomFuerte": golpe de zoom en el gancho, un remate o una frase contundente.\n' +
      '- "abierto": plano más abierto para respirar tras algo intenso o al cambiar de tema.   - "empuje": acercamiento LENTO y continuo durante todo el plano (tensión creciente, explicación importante de 4 s o más).\n' +
      '- "temblor": sacudida breve de cámara para un golpe (cifra enorme, un "boom").   - "glitch": fallo digital breve (error, caos, "ojo", cambio brusco).\n' +
      '- "blancoNegro": el plano en blanco y negro para lo negativo, el problema o el "antes" (vuelve a color en el siguiente plano).   - "vineta": oscurece los bordes para dar foco a una frase importante o íntima.\n' +
      '- "apagon": entrada desde negro (pausa dramática o cambio de capítulo antes del remate).   - "barrido": transición con desenfoque rápido (cambio de tema con energía).   - "calido": tono cálido para algo humano, positivo o de resultado.\n' +
      '- "palabra": una palabra o cifra clave GRANDE en pantalla con rebote (campo "texto": 1-3 palabras, en MAYÚSCULAS; que no repita lo que ya se lee en el subtítulo salvo para subrayar).\n' +
      (FLASH_OK ? '- "flash": destello blanco breve en un impacto real (frase gancho, cifra que sorprende, giro «pero…», remate); máx. 1 cada 10 s.   - "flashColor": destello del color de la marca, más sutil.   - "impacto": flash + subida y golpe de sonido; solo para el momento más fuerte; máximo 2 en todo el vídeo.\n' : '- (En este estilo NO se usan flashes.)\n') +
      (process.env.REGLAS_MARCA ? 'VOZ, REGLAS Y PREFERENCIAS DE VÍCTOR (obligatorias; incluyen lo que el editor ha aprendido de sus correcciones):\n' + process.env.REGLAS_MARCA.slice(0, 4500) + '\n\n' : '') +
      'REGLAS: intensidad "' + INTENSIDAD + '": ' + dens + '; separados al menos 2,8 s (una "palabra" puede ir a ≥1,5 s de otro efecto); el primero cae en los primeros 2,5 s si hay frase potente (el gancho decide el scroll); elige la palabra donde ARRANCA la idea (no muletillas ni mitad de frase); VARÍA mucho los tipos, no repitas el mismo dos veces seguidas; explicación tranquila = menos efectos; construye hacia el remate y deja respirar el final.\n' +
      (QUIERE_IMG ? '3) ILUSTRACIONES: de 0 a ' + (INTENSIDAD === 'alta' ? 4 : 3) + ' imágenes a pantalla completa (1,6-3 s) que se superponen mientras sigue sonando la voz, cuando lo que se dice se puede VER y ayuda a contarlo o a sorprender (un espacio, un material, un objeto, una escena, una metáfora visual). Cada una: "de" (índice de palabra donde entra), "dur" (segundos), "prompt" (qué se ve, concreto y visual, en español, SIN personas, SIN texto y SIN logotipos) y "motivo". Separadas ≥3 s entre sí y del gancho inicial. Si no aportan, no pongas ninguna.\n' : '3) (No se generan ilustraciones en este vídeo: deja "ilustraciones" vacío.)\n') +
      'Responde SOLO JSON: {"analisis":{"tema":"","gancho":"","arco":[{"momento":"gancho|planteamiento|nudo|giro|remate|cierre","de":0,"resumen":""}],"puntos_fuertes":[""],"puntos_flojos":[""],"potencial":0,"por_que":"","mejoras":[""]},"efectos":[{"de":0,"tipo":"","texto":"","motivo":"4-8 palabras"}],"ilustraciones":[{"de":0,"dur":2,"prompt":"","motivo":""}],"idea_de_ritmo":"una frase"}', 6000);
    analisis = r.analisis || null;
    const tipos = new Set(TIPOS_EFECTO), porIdx = new Map(conservadas.map(w => [w.i, w]));
    let ult = -9, ultP = -9, nImp = 0; const ocupado = [];
    for (const e of (r.efectos || []).slice().sort((x, y) => (x.de || 0) - (y.de || 0))) {
      const w = porIdx.get(e.de); if (!w || !tipos.has(e.tipo)) continue;
      const tfin = tiempoFinal.get(w.i); if (tfin === undefined || tfin > durFinalEstimada() - 1.2) continue;
      if (e.tipo === 'palabra') { const txt = String(e.texto || '').replace(/[{}\\]/g, '').trim().toUpperCase().split(/\s+/).slice(0, 3).join(' '); if (!txt || tfin < ultP + 3 || ocupado.some(o => Math.abs(o - tfin) < 1.5)) continue; efectos.push({ i: w.i, t: w.de, tipo: 'palabra', texto: txt, motivo: String(e.motivo || '').slice(0, 60) }); ultP = tfin; continue; }
      if (e.tipo === 'impacto' && ++nImp > 2) continue;
      if (tfin < ult + 2.8) continue;
      efectos.push({ i: w.i, t: w.de, tipo: e.tipo, motivo: String(e.motivo || '').slice(0, 60) }); ult = tfin; ocupado.push(tfin);
    }
    for (const g of (QUIERE_IMG ? (r.ilustraciones || []) : []).slice(0, INTENSIDAD === 'alta' ? 4 : 3)) {
      const w = porIdx.get(g.de); if (!w || !String(g.prompt || '').trim()) continue; const tfin = tiempoFinal.get(w.i); if (tfin === undefined || tfin < 1 || tfin > durFinalEstimada() - 2.2) continue;
      if (ilustraciones.some(x => Math.abs(x.tf - tfin) < 3.2)) continue;
      ilustraciones.push({ i: w.i, t: w.de, tf: tfin, dur: Math.max(1.4, Math.min(3.2, Number(g.dur) || 2.2)), prompt: String(g.prompt).slice(0, 400), motivo: String(g.motivo || '').slice(0, 80) });
    }
    console.log('Director de edición:', efectos.length, 'efectos,', ilustraciones.length, 'ilustraciones —', r.idea_de_ritmo || '', '\n  ' + efectos.map(e => e.tipo + (e.texto ? '«' + e.texto + '»' : '') + '@' + (tiempoFinal.get(e.i) || 0).toFixed(1) + 's (' + e.motivo + ')').join('\n  '));
    if (analisis) console.log('Análisis del editor: potencial', analisis.potencial, '—', String(analisis.por_que || '').slice(0, 200));
    fs.writeFileSync(path.join(work, 'analisis_edicion.json'), JSON.stringify({ analisis, efectos: efectos.map(e => ({ tipo: e.tipo, texto: e.texto, t: Math.round((tiempoFinal.get(e.i) || 0) * 10) / 10, motivo: e.motivo })), ilustraciones: ilustraciones.map(g => ({ t: Math.round(g.tf * 10) / 10, dur: g.dur, motivo: g.motivo, prompt: g.prompt })), ritmo: r.idea_de_ritmo || '', intensidad: INTENSIDAD }, null, 1));
  } catch (e) { console.log('Sin director de edición (cortes limpios y movimiento suave):', e.message); efectos = []; ilustraciones = []; }
}
const DIRECTOR = efectos.length > 0;
const efCortes = efectos.filter(e => e.tipo !== 'palabra'); /* la palabra en pantalla no cambia de plano */
function durFinalEstimada() { return trozos.reduce((s, x) => s + (x.fin - x.ini) + 0.19, 0); }
// Un cambio de plano (zoom) que cae EN MITAD de una frase se nota y cansa; uno que cae donde la persona respira (final de frase, coma, micro-pausa) pasa desapercibido y ayuda al ritmo.
const nominal = Number(R.cambioCada) > 0.8 ? Number(R.cambioCada) : 3.6, porFrases = R.cambiosEnFrases !== false;
const puntosNaturales = (ini, fin) => {
  const r = [];
  for (let k = 0; k < conservadas.length - 1; k++) {
    const w = conservadas[k], s = conservadas[k + 1]; if (w.a < ini + 1 || w.a > fin - 1) continue;
    const hueco = s.de - w.a, punto = /[.?!]$/.test(w.t), coma = /[,;:]$/.test(w.t);
    if (!(punto || coma || hueco >= 0.12)) continue;
    r.push({ t: Math.min(s.de - 0.03, w.a + Math.max(0.03, hueco * 0.5)), fuerza: (punto ? 3 : coma ? 2 : 1) + Math.min(1, hueco) });
  }
  return r;
};
for (const t of trozos) {
  const ini = Math.max(0, t.ini - (t.sa ? 0.02 : 0.07)), fin = Math.min(dur, t.fin + (t.sb ? 0.03 : 0.12)), largo = fin - ini;
  const cortes = [], efCorte = new Map();
  // 1) los efectos dirigidos mandan: cada uno es un cambio de plano en la palabra elegida
  const mios = efCortes.filter(e => e.t > ini + 0.15 && e.t < fin - 0.5).sort((x, y) => x.t - y.t);
  const primero = efCortes.find(e => e.t >= ini - 0.05 && e.t <= ini + 0.35); if (primero) efCorte.set('ini', primero.tipo);
  for (const e of mios) { const tc = Math.max(ini + 0.3, e.t - 0.04); cortes.push(tc); efCorte.set(tc, e.tipo); }
  // 2) entre efectos, cortes limpios donde el habla respira (solo si hace falta romper un plano muy largo)
  if (porFrases) {
    const maxPlano = DIRECTOR ? nominal * 1.6 : nominal;
    const cand = puntosNaturales(ini, fin); let ult = ini;
    const fijos = cortes.slice().sort((x, y) => x - y);
    const siguiente = () => fijos.find(c => c > ult + 0.01);
    while (true) {
      const sig = siguiente(), limite = sig !== undefined ? sig : fin;
      if (limite - ult <= maxPlano * 1.5) { if (sig === undefined) break; ult = sig; continue; }
      const ventana = cand.filter(c => c.t > ult + maxPlano * 0.6 && c.t < Math.min(ult + maxPlano * 1.6, limite - 1.1));
      if (!ventana.length) { if (limite - ult > maxPlano * 2.4) { const pc = ult + maxPlano * 1.2; cortes.push(pc); fijos.push(pc); fijos.sort((x, y) => x - y); ult = pc; continue; } if (sig === undefined) break; ult = sig; continue; }
      const mejor = ventana.reduce((m, c) => { const pm = m.fuerza * 1.2 - Math.abs(m.t - (ult + maxPlano)) / maxPlano, pc = c.fuerza * 1.2 - Math.abs(c.t - (ult + maxPlano)) / maxPlano; return pc > pm ? c : m; });
      cortes.push(mejor.t); fijos.push(mejor.t); fijos.sort((x, y) => x - y); ult = mejor.t;
    }
  } else if (!DIRECTOR) {
    const n = Math.max(1, Math.round(largo / nominal));
    for (let k = 1; k < n; k++) { let fk = ini + largo * k / n; if (pista) { const sal = alPulso(acum + (fk - ini), pista.beats, 0.3), aj = ini + (sal - acum); if (aj > (cortes[cortes.length - 1] ?? ini) + 1.2 && aj < fin - 1.2) fk = aj; } cortes.push(fk); }
  }
  cortes.sort((x, y) => x - y);
  let corte = ini, k0 = 0;
  for (const fk of [...cortes, fin]) { piezas.push({ ini: corte, fin: fk, t0: acum + (corte - ini), efecto: k0 === 0 ? efCorte.get('ini') : efCorte.get(corte) }); corte = fk; k0++; }
  acum += largo;
}
// zoom de cada plano: el que pide el efecto; si no, un movimiento muy suave que esconde los saltos sin cansar
{
  const sutil = [1.0, 1.08, 1.0, 1.05]; let base = 0, previoPunch = false;
  piezas.forEach((p, i) => {
    if (R.zoomFinal <= 1) { p.z = 1.0; return; }
    const zf0 = Math.max(1.05, R.zoomFinal), Z = { zoom: Math.max(1.16, zf0), zoomFuerte: Math.max(1.3, zf0 + 0.12), impacto: Math.max(1.3, zf0 + 0.12), abierto: 0.94, flash: Math.max(1.12, zf0), flashColor: Math.max(1.1, zf0), temblor: 1.12, glitch: 1.1, empuje: 1.0, barrido: 1.1, apagon: 1.0, blancoNegro: 1.06, vineta: 1.04, calido: 1.04 };
    if (p.efecto && Z[p.efecto] !== undefined) { p.z = Z[p.efecto]; previoPunch = Z[p.efecto] > 1.1; }
    else if (DIRECTOR) { p.z = previoPunch ? 1.0 : sutil[base++ % sutil.length]; previoPunch = false; }
    /* sin director: queda el ciclo de siempre */
  });
  piezas.forEach((p, i) => { if (p.efecto === 'barrido' && i > 0) piezas[i - 1].blurFin = true; });
}
let acum2 = 0; piezas.forEach(p => { p.t0 = acum2; acum2 += p.fin - p.ini; }); const durFinal = acum2;
const mapea = (t) => { for (const p of piezas) if (t >= p.ini && t <= p.fin) return p.t0 + (t - p.ini); return null; };
console.log('Duración final:', durFinal.toFixed(1), 's (', piezas.length, 'trozos de', dur.toFixed(0), 's )');

// ---- subtítulos: siempre minúscula, Montserrat negrita con sombra leve ----
const ev = []; const bl = []; let b = [];
palabras.forEach((w) => { if (fuera.has(w.i)) return; const d = mapea((w.de + w.a) / 2); if (d === null) return; b.push({ ...w, d }); if (b.length >= (R.estiloSubs === 'palabra' ? 1 : R.subs.palabrasPorBloque) || /[.?!,]$/.test(w.t)) { bl.push(b); b = []; } }); if (b.length) bl.push(b);
const posSub = subTop ? '\\an8\\pos(540,' + subTop + ')' : '';
bl.forEach((g, k) => {
  const ini = mapea(g[0].de) ?? g[0].d, fin = k < bl.length - 1 ? Math.max(mapea(bl[k + 1][0].de) ?? bl[k + 1][0].d, ini + 0.25) : ini + 0.6;
  const txt = g.map(w => { const s0 = limpiaT(w.t).replace(/[.,;:]+$/, '').replace(/[¿¡]/g, ''), s = R.mayusculas === true ? s0.toUpperCase() : s0.toLowerCase(); const fuerte = R.resaltar !== false && (/\d/.test(w.t) || enfasis.has(w.i)); return fuerte ? '{\\c' + ACENTO + '}' + s + '{\\c&HFFFFFF&}' : s; }).join(' ');
  if (R.estiloSubs === 'karaoke') {
    g.forEach((w, j) => {
      const t0 = j === 0 ? ini : (mapea(w.de) ?? w.d), t1 = j < g.length - 1 ? Math.max(mapea(g[j + 1].de) ?? g[j + 1].d, t0 + 0.12) : Math.min(fin, durFinal);
      const tx = g.map((x, q) => { const s0 = limpiaT(x.t).replace(/[.,;:]+$/, '').replace(/[¿¡]/g, ''), sx = R.mayusculas === true ? s0.toUpperCase() : s0.toLowerCase(); return q === j ? '{\\c' + ACENTO + '\\fscx112\\fscy112}' + sx + '{\\c&HFFFFFF&\\fscx100\\fscy100}' : sx; }).join(' ');
      if (t1 > t0) ev.push('Dialogue: 1,' + tAss(t0) + ',' + tAss(Math.min(t1, durFinal)) + ',Sub,,0,0,0,,{' + posSub + '\\fad(' + (j === 0 ? 30 : 0) + ',0)}' + tx);
    });
  } else ev.push('Dialogue: 1,' + tAss(ini) + ',' + tAss(Math.min(fin, durFinal)) + ',' + (R.estiloSubs === 'caja' ? 'SubCaja' : 'Sub') + ',,0,0,0,,{' + posSub + (R.estiloSubs === 'palabra' ? '\\fscx55\\fscy55\\t(0,150,\\fscx100\\fscy100)\\fad(30,0)' : '\\fscx90\\fscy90\\t(0,100,\\fscx100\\fscy100)\\fad(30,0)') + '}' + txt);
});
const tf = Math.min(durFinal, 3.2);
if (R.titulo !== false && plan.titulo) {
  ev.push('Dialogue: 3,' + tAss(0) + ',' + tAss(tf) + ',Kicker,,0,0,0,,{\\fad(200,300)}' + limpiaT(plan.kicker || '').toLowerCase().split('').join('\u200A'));
  ev.push('Dialogue: 3,' + tAss(0) + ',' + tAss(tf) + ',Titulo,,0,0,0,,{\\fad(250,350)}' + limpiaT(plan.titulo).toLowerCase());
}
// Texto de apertura: en vídeos de pregunta-respuesta, la pregunta en una caja limpia arriba; si no, el título gancho. Los primeros segundos, en la zona alta libre de botones.
if (process.env.TITULO_PANTALLA || process.env.PREGUNTA_PANTALLA) {
  const parte = (txt, max) => { const pal = String(txt).replace(/[{}\\]/g, '').trim().split(/\s+/); const lin = []; let cur = ''; for (const w of pal) { if ((cur + ' ' + w).trim().length > max && cur) { lin.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); } if (cur) lin.push(cur); return lin.join('\\N'); };
  if (process.env.PREGUNTA_PANTALLA) ev.push('Dialogue: 6,' + tAss(0) + ',' + tAss(Math.min(durFinal, 5.5)) + ',Pregunta,,0,0,0,,{\\an8\\fad(150,300)}' + parte(process.env.PREGUNTA_PANTALLA.replace(/^[¿?]+|[?]+$/g, '').trim() + '?', 26));
  else ev.push('Dialogue: 6,' + tAss(0) + ',' + tAss(Math.min(durFinal, 4.2)) + ',Titulo,,0,0,0,,{\\an8\\pos(540,290)\\bord0\\shad4\\fs64\\fad(150,300)}' + parte(process.env.TITULO_PANTALLA, 22));
}
// destello blanco muy breve en cada cambio de plano
if (FLASH_OK) piezas.slice(1).filter(p => ['flash', 'impacto', 'flashColor'].includes(p.efecto)).forEach(p => ev.push('Dialogue: 4,' + tAss(p.t0) + ',' + tAss(p.t0 + 0.09) + ',Kicker,,0,0,0,,{\\an7\\pos(0,0)\\p1\\c' + (p.efecto === 'flashColor' ? ACENTO : '&HFFFFFF&') + '\\alpha&H' + (p.efecto === 'flashColor' ? 'B8' : '9C') + '&\\fad(0,80)}m 0 0 l 1080 0 1080 1920 0 1920{\\p0}'));
const tarjetasT = R.graficos ? (plan.graficos || []).map(g => { const w = palabras[g.de]; return w ? mapea(w.de) : null; }).filter(x => x !== null) : []; /* si ya sale una tarjeta de dato, la palabra grande no se pone encima */
efectos.filter(e => e.tipo === 'palabra').forEach(e => { const t0 = mapea(e.t); if (t0 === null || t0 > durFinal - 0.6 || tarjetasT.some(x => t0 > x - 0.7 && t0 < x + 2.8)) return; ev.push('Dialogue: 5,' + tAss(t0) + ',' + tAss(Math.min(durFinal, t0 + 1.0)) + ',Titulo,,0,0,0,,{\\an5\\pos(540,500)\\fs130\\bord0\\shad6\\c' + ACENTO + '\\fscx45\\fscy45\\alpha&HFF&\\t(0,110,\\fscx118\\fscy118\\alpha&H00&)\\t(110,210,\\fscx100\\fscy100)\\fad(0,170)}' + limpiaT(e.texto)); });
if (R.barra === true) ev.push('Dialogue: 4,' + tAss(0) + ',' + tAss(durFinal) + ',Kicker,,0,0,0,,{\\an7\\pos(0,1896)\\p1\\c' + ACENTO + '\\fscx0\\t(0,' + Math.round(durFinal * 1000) + ',\\fscx100)}m 0 0 l 1080 0 1080 7 0 7{\\p0}');
const ass = ['[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1080', 'PlayResY: 1920', 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '', '[V4+ Styles]',
  'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
  'Style: Sub,' + R.fuente + ',' + (R.subs.tam >= 70 ? Math.round(R.subs.tam * 0.64) : R.subs.tam) + ',&H00FFFFFF,&H000000FF,&H00101010,&H88000000,-1,0,0,0,100,100,0,0,1,' + GROSOR + ',2,50,50,' + R.subs.margenV + ',1',
  'Style: SubCaja,' + R.fuente + ',' + (R.subs.tam >= 70 ? Math.round(R.subs.tam * 0.64) : R.subs.tam) + ',&H00FFFFFF,&H000000FF,&HC0141414,&HC0141414,-1,0,0,0,100,100,0,0,3,14,0,2,50,50,' + R.subs.margenV + ',1',
  'Style: Kicker,Montserrat,34,' + ACENTO.replace('&H', '&H00').replace(/&$/, '') + ',&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,4,0,1,0,0,8,80,80,300,1',
  'Style: Titulo,Montserrat,60,&H00FFFFFF,&H000000FF,&H00000000,&HA0000000,-1,0,0,0,100,100,0,0,1,2,4,8,90,90,385,1', 'Style: Pregunta,Montserrat,50,&H00FFFFFF,&H000000FF,&HC0141414,&HC0141414,-1,0,0,0,100,100,0,0,3,18,0,8,80,80,270,1', '', '[Events]', 'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text'].concat(ev).join('\n');
fs.writeFileSync(path.join(work, 'subs.ass'), '\uFEFF' + ass, 'utf8');
copiaModelo(work);
fs.mkdirSync(path.join(work, 'fonts'), { recursive: true }); fs.copyFileSync(FONT, path.join(work, 'fonts', 'Montserrat-Bold.ttf'));
for (const f of ['Rubik-Bold.ttf', 'Rubik-Regular.ttf']) { const o = new URL('./fonts/' + f, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'); if (fs.existsSync(o)) fs.copyFileSync(o, path.join(work, 'fonts', f)); }
copiaFuentes(path.join(work, 'fonts'), ['Montserrat', 'Rubik', R.fuente]);

// ---- escenas superpuestas en momentos clave ----
const ins = [], dr = {}, imgs = [];
if (catalogo.length) {
  let ult = -9;
  for (const g of (plan.inserciones || []).slice(0, 10)) {
    const w = palabras[g.de]; if (!w || fuera.has(g.de)) continue; const a = mapea(w.de); if (a === null || a < 2 || a < ult + 4 || a > durFinal - 2) continue;
    const v = catalogo.find(x => x.id === g.video); if (!v) continue;
    const d = Math.min(clamp(Number(g.dur) || 2.2, 1.4, 4), durFinal - a - 0.5), desde = Math.max(0, Math.min(Number(g.desde) || 0, v.duracion - d - 0.1)); ins.push({ v, a, d, desde }); ult = a + d;
  }
  for (const x of ins) if (x.v.drive_id && !dr[x.v.id]) { try { dr[x.v.id] = await drive.urlDescarga(x.v.drive_id); } catch (e) { console.log('Sin acceso a Drive:', e.message); } }
  console.log('Superpuestas:', ins.map(i => i.a.toFixed(1) + 's ' + String(i.v.nombre).slice(0, 24)).join(' | ') || 'ninguna');
}
// ---- gráficos animados ----
const graf = [];
if (R.graficos) {
  let ultimoFin = -9;
  for (const g of (plan.graficos || []).slice(0, 8)) {
    const w = palabras[g.de]; if (!w || fuera.has(g.de)) continue; const a = mapea(w.de); if (a === null || a < ultimoFin + 1.5 || a > durFinal - 1) continue;
    if (!g.valor && !g.texto) continue;
    const d = clamp(Number(g.dur) || 2, 1.4, 3), f = path.join(work, 'g' + graf.length + '.png');
    const t = tarjetaPNG({ valor: g.valor, unidad: g.unidad, texto: g.texto, icono: g.icono, acento: R.acento }, f);
    graf.push({ f, a, d: Math.min(d, durFinal - a - 0.2), ancho: t.ancho, alto: t.alto }); ultimoFin = a + d;
  }
  console.log('Gráficos:', graf.map(g => g.a.toFixed(1) + 's').join(', ') || 'ninguno');
}

marca(60, 'Montando el vídeo: cortes, subtítulos y gráficos');
// ---- un solo ffmpeg ----
const zf = Math.max(1.05, R.zoomFinal), ZOOMS = R.zoomFinal <= 1 ? [1.0] : [1.0, zf, 0.92, zf + 0.1]; // acercar y alejar
// ── Sonidos de efectos: cada efecto lleva el suyo (golpe grave, subida, "pop", whoosh, ruido digital), sintetizados aquí; el volumen lo fija la receta (whoosh, 0 = sin sonidos)
const VOL_SFX = Math.min(0.5, Math.max(0, Number(R.whoosh) || 0));
const SFX_CMD = {
  whoosh: ['-f', 'lavfi', '-i', 'anoisesrc=d=0.4:c=pink:a=0.6:r=48000', '-af', 'highpass=f=500,lowpass=f=6000,afade=t=in:st=0:d=0.22,afade=t=out:st=0.2:d=0.2'],
  boom: ['-f', 'lavfi', '-i', 'sine=f=52:d=0.9:r=48000', '-f', 'lavfi', '-i', 'anoisesrc=d=0.35:c=brown:r=48000', '-filter_complex', '[0:a]afade=t=out:st=0.05:d=0.85,volume=2.0[s];[1:a]lowpass=f=260,afade=t=out:d=0.35[n];[s][n]amix=inputs=2:normalize=0,aformat=channel_layouts=mono'],
  subida: ['-f', 'lavfi', '-i', 'anoisesrc=d=0.7:c=white:r=48000', '-af', 'highpass=f=700,lowpass=f=9000,afade=t=in:st=0:d=0.7,volume=0.9'],
  pop: ['-f', 'lavfi', '-i', 'sine=f=1500:d=0.09:r=48000', '-af', 'afade=t=out:st=0.01:d=0.08,volume=1.4'],
  glitch: ['-f', 'lavfi', '-i', 'anoisesrc=d=0.2:c=white:r=48000', '-af', 'bandpass=f=3000:w=2500,tremolo=f=45:d=0.9,afade=t=out:d=0.2'],
};
const GANANCIA = { whoosh: 1, boom: 1.5, subida: 0.9, pop: 1, glitch: 1 };
const sfxWav = {};
function sfx(tipo) {
  if (sfxWav[tipo] !== undefined) return sfxWav[tipo];
  const f = path.join(work, 'sfx_' + tipo + '.wav');
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...SFX_CMD[tipo], '-ac', '2', '-ar', '48000', f]);
  return (sfxWav[tipo] = fs.existsSync(f) && fs.statSync(f).size > 500 ? f : null);
}
const sfxEventos = [];
if (VOL_SFX > 0) {
  const MAPA = { impacto: [['subida', -0.55], ['boom', 0]], flash: [['pop', 0]], flashColor: [['pop', 0]], zoomFuerte: [['whoosh', -0.15]], temblor: [['boom', 0]], glitch: [['glitch', 0]], barrido: [['whoosh', -0.2]], apagon: [['boom', 0]] };
  if (DIRECTOR) {
    piezas.forEach((p, i) => { if (i > 0) for (const [s, d] of (MAPA[p.efecto] || [])) sfxEventos.push({ s, t: Math.max(0, p.t0 + d) }); });
    efectos.filter(e => e.tipo === 'palabra').forEach(e => { const t0 = mapea(e.t); if (t0 !== null) sfxEventos.push({ s: 'pop', t: Math.max(0, t0 - 0.02) }); });
  } else piezas.slice(1).forEach(p => sfxEventos.push({ s: 'whoosh', t: Math.max(0, p.t0 - 0.2) })); /* sin director: un whoosh suave en cada corte, como antes */
}
// una sola pista con todos los sonidos en su sitio (se mezcla luego por debajo de la voz)
let SFX_TRACK = null;
{
  const ev = sfxEventos.filter(e => sfx(e.s)).slice(0, 40);
  if (ev.length) {
    const ent = [], fl = [];
    ev.forEach((e, k) => { ent.push('-i', sfx(e.s)); fl.push('[' + k + ':a]adelay=' + Math.round(e.t * 1000) + ':all=1,volume=' + (VOL_SFX * (GANANCIA[e.s] || 1)).toFixed(3) + '[x' + k + ']'); });
    fl.push(ev.map((_, k) => '[x' + k + ']').join('') + 'amix=inputs=' + ev.length + ':normalize=0:duration=longest,apad,atrim=0:' + durFinal.toFixed(2) + '[sfx]');
    const o = path.join(work, 'sfx_pista.wav');
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...ent, '-filter_complex', fl.join(';'), '-map', '[sfx]', '-ar', '48000', '-ac', '2', o]);
    if (fs.existsSync(o) && fs.statSync(o).size > 2000) SFX_TRACK = o;
  }
  console.log('Sonidos de efectos:', ev.length ? ev.map(e => e.s + '@' + e.t.toFixed(1)).join(' ') : 'ninguno');
}
const BLUR = "boxblur=luma_radius=20:luma_power=2:chroma_radius=10:chroma_power=2";
function extraEfecto(p) {
  const D = Math.max(0.3, p.fin - p.ini), f = [];
  switch (p.efecto) {
    case 'empuje': f.push("scale=w='1080*(1+0.2*min(t\\," + D.toFixed(2) + ")/" + D.toFixed(2) + ")':h='1920*(1+0.2*min(t\\," + D.toFixed(2) + ")/" + D.toFixed(2) + ")':eval=frame", 'crop=1080:1920'); break;
    case 'temblor': f.push('scale=1152:2048', "crop=1080:1920:x='36+16*sin(70*t)*exp(-7*t)':y='64+16*cos(61*t)*exp(-7*t)'"); break;
    case 'glitch': f.push("rgbashift=rh=-14:bh=14:gv=5:enable='lt(t\\,0.24)'", "noise=alls=24:allf=t:enable='lt(t\\,0.24)'"); break;
    case 'blancoNegro': f.push('hue=s=0', 'eq=contrast=1.12'); break;
    case 'vineta': f.push('vignette=angle=0.9', 'eq=brightness=-0.03'); break;
    case 'apagon': f.push('fade=t=in:st=0:d=0.22:color=black'); break;
    case 'barrido': f.push(BLUR + ":enable='lt(t\\,0.14)'"); break;
    case 'calido': f.push('colorbalance=rs=0.08:gs=0.02:bs=-0.08:rm=0.06:bm=-0.06'); break;
    default: break;
  }
  if (p.blurFin) f.push(BLUR + ":enable='gt(t\\," + Math.max(0, D - 0.12).toFixed(2) + ")'");
  return f.length ? ',' + f.join(',') : '';
}
const partes = [], pa = [];
piezas.forEach((p, i) => {
  const v = ventana(p.z ?? ZOOMS[i % ZOOMS.length]);
  if (ANCHO) partes.push('[0:v]trim=' + p.ini.toFixed(3) + ':' + p.fin.toFixed(3) + ',setpts=PTS-STARTPTS,split=2[bg' + i + '][fg' + i + '];[bg' + i + ']scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=36:6,eq=brightness=-0.15[bgb' + i + '];[fg' + i + ']scale=1080:-2[fgs' + i + '];[bgb' + i + '][fgs' + i + ']overlay=0:(H-h)/2-90,fps=30,setsar=1[v' + i + ']');
  else partes.push('[0:v]trim=' + p.ini.toFixed(3) + ':' + p.fin.toFixed(3) + ',setpts=PTS-STARTPTS,crop=' + v.wc + ':' + v.hc + ':' + v.x0 + ':' + v.y0 + ',scale=1080:1920,fps=30,setsar=1' + extraEfecto(p) + '[v' + i + ']');
  pa.push('[0:a]atrim=' + p.ini.toFixed(3) + ':' + p.fin.toFixed(3) + ',asetpts=PTS-STARTPTS[a' + i + ']');
});
const cat = piezas.map((_, i) => '[v' + i + '][a' + i + ']').join('') + 'concat=n=' + piezas.length + ':v=1:a=1[vc][ac]';
const filtros = [...partes, ...pa, cat, '[vc]eq=contrast=1.07:saturation=0.95:gamma=0.97[vb0]'];
const entradas = ['-i', path.resolve(ENTRADA)]; let prev = 'vb0';
ins.forEach((x, k) => {
  const src = dr[x.v.id], ix = k + 1;
  entradas.push(...(src ? ['-headers', 'Authorization: ' + src.cabeceras.Authorization + '\r\n'] : []), '-ss', x.desde.toFixed(2), '-t', (x.d + 0.1).toFixed(2), '-i', src ? src.url : x.v.ruta);
  filtros.push('[' + ix + ':v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,format=yuva420p,fade=t=in:st=0:d=0.18:alpha=1,fade=t=out:st=' + (x.d - 0.18).toFixed(2) + ':d=0.18:alpha=1,setpts=PTS+' + x.a.toFixed(3) + '/TB[i' + k + ']');
  filtros.push('[' + prev + '][i' + k + ']overlay=x=0:y=0:enable=\'between(t\\,' + x.a.toFixed(3) + '\\,' + (x.a + x.d).toFixed(3) + ')\':eof_action=pass[oi' + k + ']'); prev = 'oi' + k;
});
graf.forEach((g, k) => {
  entradas.push('-loop', '1', '-framerate', '30', '-t', (g.d + 0.1).toFixed(2), '-i', g.f);
  const yFin = (process.env.PREGUNTA_PANTALLA && g.a < 5.8) ? 520 : 300, a = g.a.toFixed(3), b2 = (g.a + g.d).toFixed(3);
  filtros.push('[' + (ins.length + k + 1) + ':v]format=rgba,fade=t=in:st=0:d=0.22:alpha=1,fade=t=out:st=' + (g.d - 0.25).toFixed(2) + ':d=0.25:alpha=1,setpts=PTS+' + a + '/TB[g' + k + ']');
  filtros.push('[' + prev + '][g' + k + ']overlay=x=\'(W-w)/2\':y=\'' + yFin + '-70*pow(max(0\\,1-(t-' + a + ')/0.32)\\,3)\':enable=\'between(t\\,' + a + '\\,' + b2 + ')\':eof_action=pass[o' + k + ']');
  prev = 'o' + k;
});
// ilustraciones generadas con IA: se superponen a pantalla completa mientras la voz sigue (los subtítulos quedan por encima)
if (ilustraciones.length) {
  const gen = async (g, f) => {
    const r = await fetch('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { Authorization: 'Bearer ' + ENV.OPENAI_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: ENV.OPENAI_IMAGE_MODEL || 'gpt-image-1', prompt: ESTILO_IMG + g.prompt, size: '1024x1536', quality: 'medium', n: 1 }), signal: AbortSignal.timeout(120000) });
    const j = await r.json(); const b64 = j.data?.[0]?.b64_json; if (!r.ok || !b64) throw new Error('OpenAI ' + r.status + ' ' + (j.error?.message || '').slice(0, 100));
    fs.writeFileSync(f, Buffer.from(b64, 'base64'));
  };
  const hechas = await Promise.all(ilustraciones.map(async (g, k) => { const f = path.join(work, 'ilustracion' + k + '.png'); try { await gen(g, f); return { ...g, f }; } catch (e) { console.log('Ilustración ' + (k + 1) + ' sin generar:', e.message); return null; } }));
  const ocupa = [...ins.map(x => [x.a, x.a + x.d]), ...graf.map(x => [x.a, x.a + x.d])];
  hechas.filter(Boolean).forEach(g => {
    const a0 = mapea(g.t); if (a0 === null || a0 > durFinal - 1) return; const d = Math.min(g.dur, durFinal - a0 - 0.3);
    if (ocupa.some(([x, y]) => a0 < y + 0.3 && a0 + d > x - 0.3)) return;
    imgs.push({ f: g.f, a: a0, d, motivo: g.motivo }); ocupa.push([a0, a0 + d]);
  });
  console.log('Ilustraciones superpuestas:', imgs.map(x => x.a.toFixed(1) + 's (' + x.motivo + ')').join(' | ') || 'ninguna');
}
imgs.forEach((g, k) => {
  const ix = entradas.filter(x => x === '-i').length, a = g.a.toFixed(3), b2 = (g.a + g.d).toFixed(3);
  entradas.push('-loop', '1', '-framerate', '30', '-t', (g.d + 0.1).toFixed(2), '-i', g.f);
  filtros.push('[' + ix + ':v]scale=1296:2304:force_original_aspect_ratio=increase,crop=1296:2304,fps=30,setsar=1,format=yuva420p,scale=w=\'1080*(1+0.06*min(t\\,' + g.d.toFixed(2) + ')/' + g.d.toFixed(2) + ')\':h=\'1920*(1+0.06*min(t\\,' + g.d.toFixed(2) + ')/' + g.d.toFixed(2) + ')\':eval=frame,crop=1080:1920,fade=t=in:st=0:d=0.16:alpha=1,fade=t=out:st=' + Math.max(0, g.d - 0.16).toFixed(2) + ':d=0.16:alpha=1,setpts=PTS+' + a + '/TB[im' + k + ']');
  filtros.push('[' + prev + '][im' + k + ']overlay=x=0:y=0:enable=\'between(t\\,' + a + '\\,' + b2 + ')\':eof_action=pass[oim' + k + ']'); prev = 'oim' + k;
});
filtros.push('[' + prev + ']' + (process.env.SIN_ASS === '1' ? 'null' : 'ass=subs.ass:fontsdir=fonts') + '[v]');
// audio: voz limpia + (música por debajo) + sonidos de efectos
filtros.push('[ac]' + AUDIO + '[voz0]');
let audioEntrada = 'voz0';
if (SFX_TRACK) { const ix = entradas.filter(x => x === '-i').length; entradas.push('-i', SFX_TRACK); filtros.push('[voz0][' + ix + ':a]amix=inputs=2:normalize=0:duration=first[vozfx]'); audioEntrada = 'vozfx'; }
if (pista) {
  const ix = entradas.filter(x => x === '-i').length; entradas.push('-stream_loop', '-1', '-i', pista.ruta);
  filtros.push(mezcla({ entradaIdx: ix, voz: audioEntrada, durTotal: durFinal, db: Number(R.musica.volumen) || -19, salida: 'a' }));
} else filtros.push('[' + audioEntrada + ']anull[a]');
fs.writeFileSync(path.join(work, 'grafo.txt'), filtros.join(';\n'));
const rr = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...entradas, '-/filter_complex', 'grafo.txt', '-map', '[v]', '-map', '[a]', '-t', durFinal.toFixed(2), ...ARGS_VIDEO(21), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', path.resolve(SALIDA)], { cwd: work });
console.log(fs.existsSync(SALIDA) ? 'OK ' + SALIDA + ' · ' + (fs.statSync(SALIDA).size / 1048576).toFixed(1) + ' MB' : 'FALLO ' + (rr.stderr || '').slice(0, 900));
