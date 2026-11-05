// Edición de un vídeo en bruto hablando a cámara: quita pausas, repeticiones y errores; encuadra a la cara con zooms in/out que esconden los cortes;
// subtítulos bajo la cara; gráficos animados (cifra + icono); música de fondo por debajo de la voz con los cambios de plano a pulso.
// Uso: node bruto.mjs "<bruto.mp4>" "<salida.mp4>" ["indicaciones"]   (receta con RECETA_JSON; música con MUSICA_DIR y MUSICA_ELEGIDA)
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { tarjetaPNG, NOMBRES_ICONOS } from './iconos.mjs';
import { bibliotecaLocal, alPulso, mezcla } from './musica.mjs';
import { CADENA_VOZ, corrigeTrabones, repetidasInmediatas } from './voz.mjs';

const [ENTRADA, SALIDA, NOTAS = ''] = process.argv.slice(2);
if (!ENTRADA || !SALIDA) { console.log('Uso: node bruto.mjs "<bruto>" "<salida.mp4>" ["indicaciones"]'); process.exit(1); }
const ENV = Object.fromEntries(fs.readFileSync(new URL('../server/.env', import.meta.url), 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]));
const WHISPER = process.env.WHISPER_CLI || 'C:/Users/cashc/AppData/Local/RanuseVideo/whisper/Release/whisper-cli.exe';
const MODELO_W = process.env.WHISPER_MODEL || 'C:/Users/cashc/AppData/Local/RanuseVideo/whisper/ggml-large-v3-turbo-q5_0.bin';
const FONT = new URL('../public/fonts/Montserrat-Bold.ttf', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// Paleta Ranuse: oscura y elegante (negros, grises, marrones cálidos)
const R = { acento: '#CDBBA7', titulo: true, pausa: 0.4, subs: { palabrasPorBloque: 2, tam: 76, margenV: 600 }, zoomFinal: 1.2, barra: false, mayusculas: false, resaltar: true, encuadre: false, encuadreZoom: 1.3, subsBajoCara: false, graficos: false, fuente: 'Montserrat', limpiar: true, musica: { volumen: -19 } };
if (process.env.RECETA_JSON) {
  const o = JSON.parse(fs.readFileSync(process.env.RECETA_JSON, 'utf8'));
  for (const k of ['acento', 'titulo', 'zoomFinal', 'barra', 'mayusculas', 'resaltar', 'encuadre', 'encuadreZoom', 'subsBajoCara', 'graficos', 'pausa', 'limpiar', 'fuente']) if (o[k] !== undefined) R[k] = o[k];
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
const dur = Number(pr.format.duration) || 0; console.log('Bruto:', W + 'x' + H, dur.toFixed(1), 's');

// ---- voz -> palabras ----
const wav = path.join(work, 'voz.wav'); run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', ENTRADA, '-vn', '-ac', '1', '-ar', '16000', wav]);
const wj = path.join(work, 'palabras');
if (!fs.existsSync(wj + '.json')) run(WHISPER, ['-m', MODELO_W, '-f', wav, '-l', 'es', '-t', '8', '-bs', '1', '-bo', '1', '-ml', '1', '-sow', '-oj', '-of', wj]);
const palabras = JSON.parse(fs.readFileSync(wj + '.json', 'utf8').replace(/^\uFEFF/, '')).transcription.map(s => ({ t: s.text.trim(), de: s.offsets.from / 1000, a: s.offsets.to / 1000 })).filter(w => w.t && !/^\[.*\]$/.test(w.t));
if (!palabras.length) { console.log('FALLO: no se oye voz en el vídeo'); process.exit(1); }
palabras.forEach((w, i) => { w.i = i; });
const trabones = corrigeTrabones(palabras, wav); if (trabones) console.log('Tropiezos recortados:', trabones);

// ---- IA: qué se quita (repeticiones, errores), título, palabras clave y gráficos ----
let plan = { kicker: 'RANUSE DESIGN', titulo: '', enfasis: [], quitar: [], graficos: [] };
try {
  const guion = palabras.map((w, i) => i + ':' + w.t).join(' ');
  plan = { ...plan, ...(await claude('Vídeo vertical de Ranuse Design (diseño de gimnasios y espacios deportivos), alguien hablando a cámara. Transcripción (índice:palabra): ' + guion.slice(0, 12000) + '\n' + (NOTAS ? 'Indicaciones del equipo: ' + NOTAS + '\n' : '') +
    'Responde SOLO JSON con: "kicker" (categoría de 2-4 palabras), "titulo" (gancho serio, máx. 8 palabras, sin exclamaciones), "enfasis" (ÍNDICES de palabras clave: cifras, términos técnicos, la idea fuerte; ~1 de cada 6 palabras)' +
    (R.limpiar !== false ? ', "quitar": lista de rangos [desde, hasta] de ÍNDICES (inclusivos) que hay que ELIMINAR para que la comunicación sea fluida y ágil: frases o preguntas dichas dos veces (quédate con la mejor toma, normalmente la última y completa), empezar una frase y rehacerla, errores, muletillas largas (eh, mmm, o sea repetido), comentarios al aire que no son parte del vídeo (órdenes al que graba, "vale", "otra vez"). No quites contenido útil; sé conservador ante la duda' : '') +
    (R.graficos ? ', "graficos": lista de 3 a 6 momentos donde aparece una cifra, medida o concepto que merece una animación en pantalla. Cada uno: {"de": índice de la palabra donde entra (que NO esté en "quitar"), "valor": "140" (solo la cifra, o ""), "unidad": "kg" (o ""), "texto": "texto corto si no hay cifra (máx. 3 palabras)", "icono": uno de [' + NOMBRES_ICONOS.join(', ') + '] o "", "dur": segundos visible (1.6-2.6)}. No satures, separados al menos 4 segundos' : '') + '.', 2200)) };
} catch (e) { console.log('Sin IA para limpieza/título/gráficos:', e.message); }
fs.writeFileSync(path.join(work, 'plan.json'), JSON.stringify(plan, null, 1));
const fuera = new Set(); for (const r of (plan.quitar || [])) if (Array.isArray(r) && Number.isInteger(r[0])) for (let i = r[0]; i <= (Number.isInteger(r[1]) ? r[1] : r[0]); i++) fuera.add(i);
if (fuera.size) console.log('Se quitan', fuera.size, 'palabras (repeticiones/errores):', [...fuera].slice(0, 40).map(i => palabras[i]?.t).join(' '));
for (const i of repetidasInmediatas(palabras)) fuera.add(i);
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
      cont.push({ type: 'text', text: 'Localiza la cara de la persona que habla en cada fotograma. Coordenadas NORMALIZADAS (0-1). "cx" = centro horizontal de la cara, "cy" = centro vertical, "alto" = altura de la cara (frente a barbilla) como fracción del alto de la imagen. Responde SOLO JSON: {"fotogramas":[{"cx":0.5,"cy":0.3,"alto":0.2}]}' });
      const r = await claude(cont, 400); const l = (r.fotogramas || []).filter(x => x.cx >= 0 && x.cx <= 1 && x.cy >= 0 && x.cy <= 1 && x.alto > 0.03 && x.alto < 0.8);
      const med = k => { const v = l.map(x => x[k]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
      if (l.length) cara = { cx: med('cx'), cy: med('cy'), alto: med('alto') };
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
let subTop = null;
if (R.subsBajoCara && cara) { const v = ventana(1.05), chin = (cara.cy + cara.alto * 0.4) * H; subTop = clamp(Math.round((chin - v.y0) / v.hc * 1920 + 70), 520, 1500); console.log('Subtítulos a y =', subTop); }

// ---- trozos de voz continuos: se quitan pausas, repeticiones y errores ----
const trozos = []; let ult = -2;
for (const w of palabras) { if (fuera.has(w.i)) continue; const u = trozos[trozos.length - 1]; if (u && w.i === ult + 1 && w.de - u.fin < R.pausa) { u.fin = w.a; } else trozos.push({ ini: w.de, fin: w.a }); ult = w.i; }
// los cambios de plano dentro de un trozo largo caen a pulso de la música
const piezas = []; let acum = 0;
for (const t of trozos) {
  const ini = Math.max(0, t.ini - 0.07), fin = Math.min(dur, t.fin + 0.12), largo = fin - ini, n = Math.max(1, Math.round(largo / 3.6));
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
  ev.push('Dialogue: 1,' + tAss(ini) + ',' + tAss(Math.min(fin, durFinal)) + ',Sub,,0,0,0,,{' + posSub + '\\fscx90\\fscy90\\t(0,100,\\fscx100\\fscy100)\\fad(30,0)}' + txt);
});
const tf = Math.min(durFinal, 3.2);
if (R.titulo !== false && plan.titulo) {
  ev.push('Dialogue: 3,' + tAss(0) + ',' + tAss(tf) + ',Kicker,,0,0,0,,{\\fad(200,300)}' + limpiaT(plan.kicker || '').toLowerCase().split('').join('\u200A'));
  ev.push('Dialogue: 3,' + tAss(0) + ',' + tAss(tf) + ',Titulo,,0,0,0,,{\\fad(250,350)}' + limpiaT(plan.titulo).toLowerCase());
}
if (R.barra === true) ev.push('Dialogue: 4,' + tAss(0) + ',' + tAss(durFinal) + ',Kicker,,0,0,0,,{\\an7\\pos(0,1896)\\p1\\c' + ACENTO + '\\fscx0\\t(0,' + Math.round(durFinal * 1000) + ',\\fscx100)}m 0 0 l 1080 0 1080 7 0 7{\\p0}');
const ass = ['[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1080', 'PlayResY: 1920', 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '', '[V4+ Styles]',
  'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
  'Style: Sub,' + R.fuente + ',' + R.subs.tam + ',&H00FFFFFF,&H000000FF,&H00101010,&H88000000,-1,0,0,0,100,100,0,0,1,' + GROSOR + ',2,50,50,' + R.subs.margenV + ',1',
  'Style: Kicker,Montserrat,34,' + ACENTO.replace('&H', '&H00').replace(/&$/, '') + ',&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,4,0,1,0,0,8,80,80,300,1',
  'Style: Titulo,Montserrat,60,&H00FFFFFF,&H000000FF,&H00000000,&HA0000000,-1,0,0,0,100,100,0,0,1,2,4,8,90,90,385,1', '', '[Events]', 'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text'].concat(ev).join('\n');
fs.writeFileSync(path.join(work, 'subs.ass'), '\uFEFF' + ass, 'utf8');
fs.mkdirSync(path.join(work, 'fonts'), { recursive: true }); fs.copyFileSync(FONT, path.join(work, 'fonts', 'Montserrat-Bold.ttf'));
for (const f of ['Rubik-Bold.ttf', 'Rubik-Regular.ttf']) { const o = new URL('./fonts/' + f, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'); if (fs.existsSync(o)) fs.copyFileSync(o, path.join(work, 'fonts', f)); }

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

// ---- un solo ffmpeg ----
const zf = Math.max(1.05, R.zoomFinal), ZOOMS = R.zoomFinal <= 1 ? [1.0] : [1.0, zf, 0.92, zf + 0.1]; // acercar y alejar
const partes = [], pa = [];
piezas.forEach((p, i) => {
  const v = ventana(ZOOMS[i % ZOOMS.length]);
  partes.push('[0:v]trim=' + p.ini.toFixed(3) + ':' + p.fin.toFixed(3) + ',setpts=PTS-STARTPTS,crop=' + v.wc + ':' + v.hc + ':' + v.x0 + ':' + v.y0 + ',scale=1080:1920,fps=30,setsar=1[v' + i + ']');
  pa.push('[0:a]atrim=' + p.ini.toFixed(3) + ':' + p.fin.toFixed(3) + ',asetpts=PTS-STARTPTS[a' + i + ']');
});
const cat = piezas.map((_, i) => '[v' + i + '][a' + i + ']').join('') + 'concat=n=' + piezas.length + ':v=1:a=1[vc][ac]';
const filtros = [...partes, ...pa, cat, '[vc]eq=contrast=1.07:saturation=0.95:gamma=0.97[vb0]'];
const entradas = ['-i', path.resolve(ENTRADA)]; let prev = 'vb0';
graf.forEach((g, k) => {
  entradas.push('-loop', '1', '-framerate', '30', '-t', (g.d + 0.1).toFixed(2), '-i', g.f);
  const yFin = 150, a = g.a.toFixed(3), b2 = (g.a + g.d).toFixed(3);
  filtros.push('[' + (k + 1) + ':v]format=rgba,fade=t=in:st=0:d=0.22:alpha=1,fade=t=out:st=' + (g.d - 0.25).toFixed(2) + ':d=0.25:alpha=1,setpts=PTS+' + a + '/TB[g' + k + ']');
  filtros.push('[' + prev + '][g' + k + ']overlay=x=\'(W-w)/2\':y=\'' + yFin + '-70*pow(max(0\\,1-(t-' + a + ')/0.32)\\,3)\':enable=\'between(t\\,' + a + '\\,' + b2 + ')\':eof_action=pass[o' + k + ']');
  prev = 'o' + k;
});
filtros.push('[' + prev + ']ass=subs.ass:fontsdir=fonts[v]');
if (pista) {
  entradas.push('-stream_loop', '-1', '-i', pista.ruta);
  filtros.push('[ac]' + AUDIO + '[voz]', mezcla({ entradaIdx: 1 + graf.length, voz: 'voz', durTotal: durFinal, db: Number(R.musica.volumen) || -19, salida: 'a' }));
} else filtros.push('[ac]' + AUDIO + '[a]');
fs.writeFileSync(path.join(work, 'grafo.txt'), filtros.join(';\n'));
const rr = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...entradas, '-/filter_complex', 'grafo.txt', '-map', '[v]', '-map', '[a]', '-t', durFinal.toFixed(2), '-c:v', 'h264_nvenc', '-preset', 'p5', '-cq', '24', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', path.resolve(SALIDA)], { cwd: work });
console.log(fs.existsSync(SALIDA) ? 'OK ' + SALIDA + ' · ' + (fs.statSync(SALIDA).size / 1048576).toFixed(1) + ' MB' : 'FALLO ' + (rr.stderr || '').slice(0, 900));
