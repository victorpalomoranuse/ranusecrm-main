// Montaje con voz en off: voz (audio o vídeo) -> transcripción por palabras -> la IA elige escenas del índice -> render vertical.
// Uso: node montar.mjs "<voz>" "<indice.json>" "<salida.mp4>" ["indicaciones"]
// El estilo vive en RECETA (después saldrá de la biblioteca de formatos del CRM).
import fs from 'fs';
import path from 'path';
import { spawnSync, spawn } from 'child_process';
import { bibliotecaLocal, alPulso, mezcla } from './musica.mjs';
import * as drive from './drive.mjs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { CADENA_VOZ, copiaModelo, corrigeTrabones, repetidasInmediatas, rangosAQuitar, recomponeVoz, muletillasSueltas, huecosConSonido } from './voz.mjs';

const [VOZ, INDICE, SALIDA, NOTAS = ''] = process.argv.slice(2);
if (!VOZ || !INDICE || !SALIDA) { console.log('Uso: node montar.mjs "<voz>" "<indice.json>" "<salida.mp4>" ["indicaciones"]'); process.exit(1); }
const ENV = Object.fromEntries(fs.readFileSync(new URL('../server/.env', import.meta.url), 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]));
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
  for (const k of ['zoomFinal', 'whoosh', 'flash', 'titulo', 'mayusculas', 'fuente']) if (o[k] !== undefined) RECETA[k] = o[k];
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
const marca = (n, t) => console.log('##PCT ' + n + ' ' + t);
marca(8, 'Leyendo el audio');
console.log('Voz:', durVoz.toFixed(1), 's');
if (!durVoz) { console.log('FALLO: no he podido leer el audio del archivo (¿falta ffmpeg o el archivo no tiene sonido?)'); process.exit(1); }

// 2) transcripción por palabras (en la nube se cambia por Groq)
marca(12, 'Transcribiendo la voz');
const wj = path.join(work, 'palabras');
if (!fs.existsSync(wj + '.json')) run(WHISPER, ['-m', MODELO_W, '-f', wav, '-l', 'es', '-t', '8', '-bs', '1', '-bo', '1', '-ml', '1', '-sow', '-oj', '-of', wj]);
let palabras = JSON.parse(fs.readFileSync(wj + '.json', 'utf8').replace(/^\uFEFF/, '')).transcription
  .map(s => ({ t: s.text.trim(), de: s.offsets.from / 1000, a: s.offsets.to / 1000 })).filter(w => w.t && !/^\[.*\]$/.test(w.t));
palabras.forEach((w, i) => { w.i = i; });
console.log('Palabras:', palabras.length);

marca(30, 'Quitando muletillas, tropiezos y repeticiones');
// 2b) corregir cuando te trabas: tropiezos, palabras repetidas, frases dichas dos veces, errores y pausas largas
{
  const trab = corrigeTrabones(palabras, wav); const quitar = repetidasInmediatas(palabras);
  const conservar = /conservw* (las )?muletillas|mantw* (las )?muletillas/i.test(NOTAS); const huecos = conservar ? 0 : huecosConSonido(palabras, wav); if (!conservar) for (const i of muletillasSueltas(palabras)) quitar.add(i);
  if (huecos) console.log('Muletillas sin transcribir cortadas:', huecos);
  for (const i of await rangosAQuitar(palabras, ENV.ANTHROPIC_API_KEY, NOTAS)) quitar.add(i);
  console.log('Tropiezos recortados:', trab, '| palabras quitadas:', quitar.size, [...quitar].slice(0, 30).map(i => palabras[i]?.t).join(' '));
  const r = recomponeVoz({ palabras, quitar, wav48: path.join(work, 'voz48_orig.wav'), salida: path.join(work, 'voz48.wav') });
  palabras = r.palabras; console.log('Voz limpia:', durVoz.toFixed(1), 's ->', r.durVoz.toFixed(1), 's'); durVoz = r.durVoz;
}

// 3) la IA monta
let idx = JSON.parse(fs.readFileSync(INDICE, 'utf8')).videos.filter(v => v.duracion >= 1.5);
// recursos elegidos en el CRM: carpetas enteras o vídeos sueltos (vacío = todo lo indexado, sin los brutos hablando)
{ let sel = {}; try { sel = JSON.parse(process.env.RECURSOS_SEL || '{}'); } catch { /* todo */ }
  const carps = sel.carpetas || [], vids = sel.videos || [];
  if (carps.length || vids.length) {
    const f = idx.filter(v => { const abs = v.ruta_abs ?? v.carpeta ?? ''; return carps.some(c => abs === c || abs.startsWith(c + '/')) || vids.some(z => z.id === v.drive_id || (z.ruta ? z.ruta + '/' : '') + z.nombre === (abs ? abs + '/' : '') + v.nombre); });
    console.log('Recursos elegidos:', carps.length, 'carpeta(s),', vids.length, 'vídeo(s) →', f.length, 'de', idx.length, 'vídeos indexados');
    if (f.length) idx = f; else { console.log('Nada de lo elegido está indexado; se usan todos'); idx = idx.filter(v => !v.hablando_a_camara); }
  } else idx = idx.filter(v => !v.hablando_a_camara && v.duracion >= 2);
}
const cat = idx.map(v => ({ id: v.id, dur: v.duracion, calidad: v.calidad, mov: v.movimiento, resumen: v.resumen, planos: v.planos.map(p => p.t + 's: ' + p.descripcion) }));
const guion = palabras.map((w, i) => i + ':' + w.t + '@' + w.de.toFixed(1)).join(' ');
const planF = path.join(work, 'plan.json'); let plan;
if (process.env.REUSE && fs.existsSync(planF)) plan = JSON.parse(fs.readFileSync(planF, 'utf8'));
else {
  const prompt = 'Eres montador de vídeo de Ranuse Design (diseño de gimnasios y espacios deportivos). Tienes la voz en off de un vídeo vertical para Instagram/TikTok y un catálogo de escenas en bruto. Monta un vídeo PROFESIONAL, DINÁMICO y SERIO (sin humor, sin emojis; sensación de marca premium).\n\nVOZ EN OFF (índice:palabra@segundo): ' + guion + '\n\nDuración total: ' + durVoz.toFixed(1) + ' s.\n\nCATÁLOGO (id, duración en s, planos con su segundo):\n' + JSON.stringify(cat) + '\n\n' + (NOTAS ? 'INDICACIONES DEL EQUIPO: ' + NOTAS + '\n\n' : '') +
    'Reglas: 1) Ritmo rápido: cortes de ' + RECETA.corte.min + ' a ' + RECETA.corte.max + ' s siguiendo el sentido de las frases; cambia de plano al cambiar de idea o cada pocas palabras. La primera palabra de cada corte es el índice "de"; cada corte llega hasta justo antes del siguiente; el primero empieza en la palabra 0. 2) Para cada corte elige la escena del catálogo que ilustre lo que se dice; si no hay nada literal, el plano de mejor ambiente/calidad (prefiere calidad alta; evita planos oscuros o borrosos). ' + (idx.length < 6 ? 'Hay pocos vídeos disponibles: reutilízalos con tramos DISTINTOS ("desde" puede ser cualquier segundo del vídeo, no solo los listados), sin repetir el mismo tramo ni el mismo vídeo en cortes seguidos.' : 'No repitas el mismo vídeo en cortes seguidos; puedes reutilizar un vídeo con otro tramo ("desde" distinto).') + ' 3) "desde" = segundo del vídeo donde empieza el plano (usa los segundos de los planos listados; debe cumplirse desde + duración del corte <= duración del vídeo). 4) "kicker": categoría de 2-4 palabras. "titulo": gancho serio en mayúsculas, máx. 7 palabras, sin signos de exclamación. 5) "enfasis": índices de las palabras clave de la voz (cifras, términos técnicos, la idea fuerte), unas 1 de cada 5-6 palabras. 6) Responde SOLO con JSON: {"kicker":"","titulo":"","enfasis":[0],"cortes":[{"de":0,"video":"id","desde":0.0}]}';
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': ENV.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: 8000, messages: [{ role: 'user', content: prompt }] }) });
  const j = await r.json(); if (!r.ok) { console.log('Claude error', JSON.stringify(j).slice(0, 300)); process.exit(1); }
  plan = JSON.parse(/\{[\s\S]*\}/.exec(j.content.map(b => b.text || '').join(''))[0]);
  fs.writeFileSync(planF, JSON.stringify(plan, null, 1));
  console.log('Tokens', j.usage.input_tokens, '/', j.usage.output_tokens);
}
marca(48, 'Escenas elegidas · cortando');
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
cortes.forEach((c, i) => { c.ini = i === 0 ? 0 : (pista ? alPulso(palabras[c.de]?.de ?? 0, pista.beats, 0.18) : palabras[c.de]?.de ?? 0); }); // cada cambio de escena cae en un pulso de la música
cortes.forEach((c, i) => { c.fin = i < cortes.length - 1 ? cortes[i + 1].ini : durVoz; c.dur = c.fin - c.ini; });
const valido = cortes.filter(c => c.dur > 0.15);

// 5) render de cada corte: vertical, empujón de zoom suave, color
const partes = []; let t0c = 0; const marcas = [];
const dr = {}; for (const c of valido) { const v = idx.find(z => z.id === c.video); if (v?.drive_id && !dr[v.id]) { try { dr[v.id] = await drive.urlDescarga(v.drive_id); } catch (e) { console.log('Sin acceso a Drive:', e.message); } } }
// Los vídeos de Drive que se usan muchas veces se bajan una sola vez (leerlos por red en cada corte es lentísimo con 4K)
{ const usos = {}; for (const c of valido) usos[c.video] = (usos[c.video] || 0) + 1;
  for (const [id, r] of Object.entries(dr)) { const v = idx.find(z => z.id === id); if (!r.url || !v || usos[id] < 4 || !v.bytes || v.bytes > 4e9) continue;
    const f = path.join(work, 'fuente_' + id + (path.extname(v.nombre || '') || '.mp4'));
    try { console.log('Bajando a local (' + Math.round(v.bytes / 1e6) + ' MB) porque se usa ' + usos[id] + ' veces…'); const rs = await fetch(r.url, { headers: r.cabeceras }); if (!rs.ok) throw new Error('HTTP ' + rs.status); await pipeline(Readable.fromWeb(rs.body), fs.createWriteStream(f)); dr[id] = { local: f }; }
    catch (e) { console.log('No se pudo bajar, se lee por red:', e.message); } } }
const hechos = new Array(valido.length).fill(null);
const ejecuta = (args) => new Promise(res => { const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] }); let err = ''; p.stderr.on('data', d => { err += d; }); p.on('close', () => res(err)); });
async function cortar(c, i) {
  const v = idx.find(x => x.id === c.video), out = path.join(work, 'c' + pad2(i) + '.mp4');
  const desde = Math.max(0, Math.min(Number(c.desde) || 0, Math.max(0, v.duracion - c.dur - 0.1)));
  const nf = Math.max(2, Math.round(c.dur * 30)), z1 = RECETA.zoomFinal, dir = i % 2 ? 1 : -1;
  const vf = 'scale=1296:2304:force_original_aspect_ratio=increase,crop=1296:2304,zoompan=z=\'' + (dir > 0 ? '1+' + (z1 - 1) + '*on/' + nf : z1 + '-' + (z1 - 1) + '*on/' + nf) + '\':d=1:x=\'iw/2-(iw/zoom/2)\':y=\'ih/2-(ih/zoom/2)\':s=1080x1920:fps=30,' + RECETA.color + ',setsar=1,format=yuv420p';
  const loop = v.duracion < c.dur + 0.2 ? ['-stream_loop', '-1'] : [];
  const rr = { stderr: await ejecuta(['-hide_banner', '-loglevel', 'error', '-y', ...loop, ...(dr[v.id]?.cabeceras ? ['-headers', 'Authorization: ' + dr[v.id].cabeceras.Authorization + '\r\n'] : []), '-ss', desde.toFixed(2), '-i', dr[v.id] ? (dr[v.id].local || dr[v.id].url) : v.ruta, '-t', c.dur.toFixed(3), '-an', '-vf', vf, '-c:v', 'h264_nvenc', '-preset', 'p5', '-cq', '23', out]) };
  if (!fs.existsSync(out)) { console.log('corte', i, 'falló', (rr.stderr || '').slice(0, 200)); return; }
  hechos[i] = { out, ini: c.ini }; hechosN++; marca(48 + Math.round(38 * hechosN / valido.length), 'Cortando escenas ' + hechosN + ' de ' + valido.length);
}
let hechosN = 0;
// varios cortes a la vez: el ordenador tiene de sobra para 3 procesos de ffmpeg
{ const cola = valido.map((_, i) => i), POOL = Number(process.env.CORTES_EN_PARALELO || 3);
  await Promise.all(Array.from({ length: POOL }, async () => { while (cola.length) { const i = cola.shift(); await cortar(valido[i], i); } })); }
for (const h of hechos) if (h) { partes.push(h.out); marcas.push(h.ini); }
fs.writeFileSync(path.join(work, 'lista.txt'), partes.map(p => "file '" + p.replace(/\\/g, '/') + "'").join('\n'));

// 6) subtítulos "pop" de 1-2 palabras (estilo dopamínico serio) + título + flashes + barra de progreso
const ev = []; const bloques = []; let b = [];
const enf = new Set(plan.enfasis || []);
palabras.forEach((w, i) => { w.i = i; b.push(w); if (b.length >= RECETA.subs.palabrasPorBloque || /[.?!,]$/.test(w.t)) { bloques.push(b); b = []; } }); if (b.length) bloques.push(b);
bloques.forEach((bl, k) => {
  const ini = bl[0].de, fin = k < bloques.length - 1 ? Math.max(bloques[k + 1][0].de, ini + 0.25) : Math.max(bl[bl.length - 1].a, ini + 0.4);
  const txt = bl.map(w => { const fuerte = enf.has(w.i) || /\d/.test(w.t); const s = (RECETA.mayusculas === true ? limpiaT(w.t).toUpperCase() : limpiaT(w.t).toLowerCase()).replace(/[.,;:¿¡]+$/, ''); return fuerte ? '{\\c' + RECETA.acento + '}' + s + '{\\c&HFFFFFF&}' : s; }).join(' ');
  ev.push('Dialogue: 1,' + tAss(ini) + ',' + tAss(fin) + ',Sub,,0,0,0,,{\\fscx82\\fscy82\\t(0,110,\\fscx100\\fscy100)\\fad(40,0)}' + txt);
});
const tf = Math.min(durVoz, 3.2);
if (RECETA.titulo !== false) {
ev.push('Dialogue: 3,' + tAss(0) + ',' + tAss(tf) + ',Kicker,,0,0,0,,{\\fad(200,300)}' + limpiaT(plan.kicker || '').toLowerCase().split('').join('\u200A'));
ev.push('Dialogue: 3,' + tAss(0) + ',' + tAss(tf) + ',Titulo,,0,0,0,,{\\fad(250,350)}' + limpiaT(plan.titulo || '').toLowerCase());
ev.push('Dialogue: 3,' + tAss(0.1) + ',' + tAss(tf) + ',Kicker,,0,0,0,,{\\an8\\pos(540,360)\\p1\\c' + RECETA.acento + '\\fad(200,300)\\t(0,500,\\fscx100)\\fscx0}m -45 0 l 45 0 45 4 -45 4{\\p0}');
}
if (RECETA.flash) marcas.slice(1).forEach(m => ev.push('Dialogue: 4,' + tAss(m) + ',' + tAss(m + 0.09) + ',Kicker,,0,0,0,,{\\an7\\pos(0,0)\\p1\\c&HFFFFFF&\\alpha&H9C&\\fad(0,80)}m 0 0 l 1080 0 1080 1920 0 1920{\\p0}'));
ev.push('Dialogue: 4,' + tAss(0) + ',' + tAss(durVoz) + ',Kicker,,0,0,0,,{\\an7\\pos(0,1896)\\p1\\c' + RECETA.acento + '\\fscx0\\t(0,' + Math.round(durVoz * 1000) + ',\\fscx100)}m 0 0 l 1080 0 1080 7 0 7{\\p0}');
const ass = ['[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1080', 'PlayResY: 1920', 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '', '[V4+ Styles]',
  'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
  'Style: Sub,' + RECETA.fuente + ',' + RECETA.subs.tam + ',&H00FFFFFF,&H000000FF,&H00101010,&H88000000,-1,0,0,0,100,100,0,0,1,' + (RECETA.mayusculas === true && RECETA.subs.tam > 70 ? '9,4' : '1,2') + ',2,50,50,' + RECETA.subs.margenV + ',1',
  'Style: Kicker,Montserrat,34,' + RECETA.acento.replace('&H', '&H00').replace(/&$/, '') + ',&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,4,0,1,0,0,8,80,80,300,1',
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
args.push('-filter_complex', '[0:v]ass=subs.ass:fontsdir=fonts[v];' + fa, '-map', '[v]', '-map', '[a]', '-c:v', 'h264_nvenc', '-preset', 'p5', '-cq', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', '-movflags', '+faststart', path.resolve(SALIDA));
const fin = run('ffmpeg', args, { cwd: work });
console.log(fs.existsSync(SALIDA) ? 'OK ' + SALIDA + ' · ' + (fs.statSync(SALIDA).size / 1048576).toFixed(1) + ' MB' : 'FALLO ' + (fin.stderr || '').slice(0, 800));
