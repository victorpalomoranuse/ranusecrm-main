// Edición de un vídeo en bruto hablando a cámara: quita pausas, repeticiones y errores; encuadra a la cara con zooms in/out que esconden los cortes;
// subtítulos bajo la cara; gráficos animados (cifra + icono); música de fondo por debajo de la voz con los cambios de plano a pulso.
// Uso: node bruto.mjs "<bruto.mp4>" "<salida.mp4>" ["indicaciones"]   (receta con RECETA_JSON; música con MUSICA_DIR y MUSICA_ELEGIDA)
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { tarjetaPNG, NOMBRES_ICONOS } from './iconos.mjs';
import { bibliotecaLocal, alPulso, mezcla } from './musica.mjs';
import * as drive from './drive.mjs';
import { ENV } from './entorno.mjs';
import { ARGS_VIDEO } from './codec.mjs';
import { transcribe } from './transcribir.mjs';
import { CADENA_VOZ, copiaModelo, corrigeTrabones, repetidasInmediatas, guionLimpio, envolvente } from './voz.mjs';

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
  for (const k of ['acento', 'titulo', 'zoomFinal', 'barra', 'mayusculas', 'resaltar', 'encuadre', 'encuadreZoom', 'subsBajoCara', 'graficos', 'pausa', 'limpiar', 'fuente', 'whoosh', 'flash', 'cambioCada', 'estiloSubs']) if (o[k] !== undefined) R[k] = o[k];
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
await transcribe(wav, wj);
const palabras = JSON.parse(fs.readFileSync(wj + '.json', 'utf8').replace(/^\uFEFF/, '')).transcription.map(s => ({ t: s.text.trim(), de: s.offsets.from / 1000, a: s.offsets.to / 1000 })).filter(w => w.t && !/^\[.*\]$/.test(w.t));
if (!palabras.length) { console.log('FALLO: no se oye voz en el vídeo'); process.exit(1); }
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
for (const t of trozos) {
  const ini = Math.max(0, t.ini - (t.sa ? 0.02 : 0.07)), fin = Math.min(dur, t.fin + (t.sb ? 0.03 : 0.12)), largo = fin - ini, n = Math.max(1, Math.round(largo / (Number(R.cambioCada) > 0.8 ? Number(R.cambioCada) : 3.6)));
  let corte = ini;
  for (let k = 1; k <= n; k++) {
    let fk = k === n ? fin : ini + largo * k / n;
    if (k < n && pista) { const sal = alPulso(acum + (fk - ini), pista.beats, 0.3), aj = ini + (sal - acum); if (aj > corte + 1.2 && aj < fin - 1.2) fk = aj; }
    piezas.push({ ini: corte, fin: fk, t0: acum + (corte - ini) }); corte = fk;
  }
  acum += largo;
}
let acum2 = 0; piezas.forEach(p => { p.t0 = acum2; acum2 += p.fin - p.ini; }); const durFinal = acum2;
const mapea = (t) => { for (const p of piezas) if (t >= p.ini && t <= p.fin) return p.t0 + (t - p.ini); return null; };
console.log('Duración final:', durFinal.toFixed(1), 's (', piezas.length, 'trozos de', dur.toFixed(0), 's )');

// ---- subtítulos: siempre minúscula, Montserrat negrita con sombra leve ----
const ev = []; const bl = []; let b = [];
palabras.forEach((w) => { if (fuera.has(w.i)) return; const d = mapea((w.de + w.a) / 2); if (d === null) return; b.push({ ...w, d }); if (b.length >= R.subs.palabrasPorBloque || /[.?!,]$/.test(w.t)) { bl.push(b); b = []; } }); if (b.length) bl.push(b);
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
  } else ev.push('Dialogue: 1,' + tAss(ini) + ',' + tAss(Math.min(fin, durFinal)) + ',Sub,,0,0,0,,{' + posSub + '\\fscx90\\fscy90\\t(0,100,\\fscx100\\fscy100)\\fad(30,0)}' + txt);
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
  else ev.push('Dialogue: 6,' + tAss(0) + ',' + tAss(Math.min(durFinal, 4.2)) + ',Titulo,,0,0,0,,{\\an8\\pos(540,230)\\bord0\\shad4\\fs64\\fad(150,300)}' + parte(process.env.TITULO_PANTALLA, 22));
}
// destello blanco muy breve en cada cambio de plano
if (R.flash === true) piezas.slice(1).forEach(p => ev.push('Dialogue: 4,' + tAss(p.t0) + ',' + tAss(p.t0 + 0.09) + ',Kicker,,0,0,0,,{\\an7\\pos(0,0)\\p1\\c&HFFFFFF&\\alpha&H9C&\\fad(0,80)}m 0 0 l 1080 0 1080 1920 0 1920{\\p0}'));
if (R.barra === true) ev.push('Dialogue: 4,' + tAss(0) + ',' + tAss(durFinal) + ',Kicker,,0,0,0,,{\\an7\\pos(0,1896)\\p1\\c' + ACENTO + '\\fscx0\\t(0,' + Math.round(durFinal * 1000) + ',\\fscx100)}m 0 0 l 1080 0 1080 7 0 7{\\p0}');
const ass = ['[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1080', 'PlayResY: 1920', 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '', '[V4+ Styles]',
  'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
  'Style: Sub,' + R.fuente + ',' + R.subs.tam + ',&H00FFFFFF,&H000000FF,&H00101010,&H88000000,-1,0,0,0,100,100,0,0,1,' + GROSOR + ',2,50,50,' + R.subs.margenV + ',1',
  'Style: Kicker,Montserrat,34,' + ACENTO.replace('&H', '&H00').replace(/&$/, '') + ',&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,4,0,1,0,0,8,80,80,300,1',
  'Style: Titulo,Montserrat,60,&H00FFFFFF,&H000000FF,&H00000000,&HA0000000,-1,0,0,0,100,100,0,0,1,2,4,8,90,90,385,1', 'Style: Pregunta,Montserrat,50,&H00FFFFFF,&H000000FF,&HC0141414,&HC0141414,-1,0,0,0,100,100,0,0,3,18,0,8,80,80,190,1', '', '[Events]', 'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text'].concat(ev).join('\n');
fs.writeFileSync(path.join(work, 'subs.ass'), '\uFEFF' + ass, 'utf8');
copiaModelo(work);
fs.mkdirSync(path.join(work, 'fonts'), { recursive: true }); fs.copyFileSync(FONT, path.join(work, 'fonts', 'Montserrat-Bold.ttf'));
for (const f of ['Rubik-Bold.ttf', 'Rubik-Regular.ttf']) { const o = new URL('./fonts/' + f, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'); if (fs.existsSync(o)) fs.copyFileSync(o, path.join(work, 'fonts', f)); }

// ---- escenas superpuestas en momentos clave ----
const ins = [], dr = {};
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
// whoosh sutil en cada cambio de plano (se mezcla por debajo de la voz)
let WHOOSH_WAV = null;
const marcasCorte = piezas.slice(1).map(p => p.t0);
if (Number(R.whoosh) > 0 && marcasCorte.length) {
  WHOOSH_WAV = path.join(work, 'whoosh.wav');
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anoisesrc=d=0.4:c=pink:a=0.6:r=48000', '-af', 'highpass=f=500,lowpass=f=6000,afade=t=in:st=0:d=0.22,afade=t=out:st=0.2:d=0.2,volume=' + Number(R.whoosh), WHOOSH_WAV]);
  if (!fs.existsSync(WHOOSH_WAV)) WHOOSH_WAV = null;
}
function whooshFiltro(entrada, salida, idx) {
  if (!WHOOSH_WAV) return ['[' + entrada + ']anull[' + salida + ']'];
  const n = marcasCorte.length;
  return ['[' + idx + ':a]asplit=' + n + marcasCorte.map((_, k) => '[w' + k + ']').join(''), ...marcasCorte.map((m, k) => '[w' + k + ']adelay=' + Math.max(0, Math.round((m - 0.2) * 1000)) + ':all=1[d' + k + ']'), '[' + entrada + ']' + marcasCorte.map((_, k) => '[d' + k + ']').join('') + 'amix=inputs=' + (n + 1) + ':normalize=0:duration=first,alimiter=limit=0.95[' + salida + ']'];
}
const partes = [], pa = [];
piezas.forEach((p, i) => {
  const v = ventana(ZOOMS[i % ZOOMS.length]);
  if (ANCHO) partes.push('[0:v]trim=' + p.ini.toFixed(3) + ':' + p.fin.toFixed(3) + ',setpts=PTS-STARTPTS,split=2[bg' + i + '][fg' + i + '];[bg' + i + ']scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=36:6,eq=brightness=-0.15[bgb' + i + '];[fg' + i + ']scale=1080:-2[fgs' + i + '];[bgb' + i + '][fgs' + i + ']overlay=0:(H-h)/2-90,fps=30,setsar=1[v' + i + ']');
  else partes.push('[0:v]trim=' + p.ini.toFixed(3) + ':' + p.fin.toFixed(3) + ',setpts=PTS-STARTPTS,crop=' + v.wc + ':' + v.hc + ':' + v.x0 + ':' + v.y0 + ',scale=1080:1920,fps=30,setsar=1[v' + i + ']');
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
  const yFin = 150, a = g.a.toFixed(3), b2 = (g.a + g.d).toFixed(3);
  filtros.push('[' + (ins.length + k + 1) + ':v]format=rgba,fade=t=in:st=0:d=0.22:alpha=1,fade=t=out:st=' + (g.d - 0.25).toFixed(2) + ':d=0.25:alpha=1,setpts=PTS+' + a + '/TB[g' + k + ']');
  filtros.push('[' + prev + '][g' + k + ']overlay=x=\'(W-w)/2\':y=\'' + yFin + '-70*pow(max(0\\,1-(t-' + a + ')/0.32)\\,3)\':enable=\'between(t\\,' + a + '\\,' + b2 + ')\':eof_action=pass[o' + k + ']');
  prev = 'o' + k;
});
filtros.push('[' + prev + ']ass=subs.ass:fontsdir=fonts[v]');
if (pista) {
  entradas.push('-stream_loop', '-1', '-i', pista.ruta);
  filtros.push('[ac]' + AUDIO + '[voz0]'); filtros.push(...whooshFiltro('voz0', 'voz', 2 + ins.length + graf.length));
  filtros.push(mezcla({ entradaIdx: 1 + ins.length + graf.length, voz: 'voz', durTotal: durFinal, db: Number(R.musica.volumen) || -19, salida: 'a' }));
} else { filtros.push('[ac]' + AUDIO + '[voz0]'); filtros.push(...whooshFiltro('voz0', 'a', 1 + ins.length + graf.length)); }
if (WHOOSH_WAV) entradas.push('-i', WHOOSH_WAV);
fs.writeFileSync(path.join(work, 'grafo.txt'), filtros.join(';\n'));
const rr = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...entradas, '-/filter_complex', 'grafo.txt', '-map', '[v]', '-map', '[a]', '-t', durFinal.toFixed(2), ...ARGS_VIDEO(21), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', path.resolve(SALIDA)], { cwd: work });
console.log(fs.existsSync(SALIDA) ? 'OK ' + SALIDA + ' · ' + (fs.statSync(SALIDA).size / 1048576).toFixed(1) + ' MB' : 'FALLO ' + (rr.stderr || '').slice(0, 900));
