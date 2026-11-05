// Edición de un vídeo en bruto hablando a cámara: quita silencios y titubeos largos, pasa a vertical, zooms de énfasis y subtítulos.
// Uso: node bruto.mjs "<bruto.mp4>" "<salida.mp4>" ["indicaciones"]   (receta opcional con RECETA_JSON)
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const [ENTRADA, SALIDA, NOTAS = ''] = process.argv.slice(2);
if (!ENTRADA || !SALIDA) { console.log('Uso: node bruto.mjs "<bruto>" "<salida.mp4>" ["indicaciones"]'); process.exit(1); }
const ENV = Object.fromEntries(fs.readFileSync(new URL('../server/.env', import.meta.url), 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]));
const WHISPER = process.env.WHISPER_CLI || 'C:/Users/cashc/AppData/Local/RanuseVideo/whisper/Release/whisper-cli.exe';
const MODELO_W = process.env.WHISPER_MODEL || 'C:/Users/cashc/AppData/Local/RanuseVideo/whisper/ggml-large-v3-turbo-q5_0.bin';
const FONT = new URL('../public/fonts/Montserrat-Bold.ttf', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const R = { acento: '&H6DC4F2&', titulo: true, pausa: 0.4, subs: { palabrasPorBloque: 2, tam: 104, margenV: 600 }, zoomFinal: 1.14, barra: true, mayusculas: true, resaltar: true };
if (process.env.RECETA_JSON) {
  const o = JSON.parse(fs.readFileSync(process.env.RECETA_JSON, 'utf8'));
  if (/^#[0-9a-f]{6}$/i.test(o.acento || '')) R.acento = '&H' + o.acento.slice(5, 7) + o.acento.slice(3, 5) + o.acento.slice(1, 3) + '&';
  for (const k of ['titulo', 'zoomFinal', 'barra', 'mayusculas', 'resaltar']) if (o[k] !== undefined) R[k] = o[k]; if (o.subs) R.subs = { ...R.subs, ...o.subs };
}
const GROSOR = R.subs.tam > 70 ? '9,4' : '3,0';
const AUDIO = 'highpass=f=90,afftdn=nr=14:nf=-45,acompressor=threshold=-21dB:ratio=3:attack=8:release=120:makeup=3,equalizer=f=3200:t=q:w=1:g=2,loudnorm=I=-15:TP=-1.5:LRA=9,aresample=48000';
const work = path.resolve(path.dirname(SALIDA), '_trabajo_' + path.basename(SALIDA, '.mp4')); fs.mkdirSync(work, { recursive: true });
const run = (c, a, o = {}) => spawnSync(c, a, { encoding: 'utf8', maxBuffer: 1 << 28, ...o });
const pad2 = n => String(n).padStart(2, '0');
const tAss = t => { const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t - h * 3600 - m * 60; return h + ':' + pad2(m) + ':' + s.toFixed(2).padStart(5, '0'); };
const limpiaT = t => String(t).replace(/[{}\\]/g, '');

const pr = JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:stream_side_data=rotation:format=duration', '-of', 'json', ENTRADA]).stdout);
let W = pr.streams[0].width, H = pr.streams[0].height; const rot = Math.abs(Number(pr.streams[0].side_data_list?.[0]?.rotation || 0)); if (rot === 90 || rot === 270) [W, H] = [H, W];
const dur = Number(pr.format.duration) || 0; console.log('Bruto:', W + 'x' + H, dur.toFixed(1), 's');
const wav = path.join(work, 'voz.wav'); run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', ENTRADA, '-vn', '-ac', '1', '-ar', '16000', wav]);
const wj = path.join(work, 'palabras');
if (!fs.existsSync(wj + '.json')) run(WHISPER, ['-m', MODELO_W, '-f', wav, '-l', 'es', '-t', '8', '-bs', '1', '-bo', '1', '-ml', '1', '-sow', '-oj', '-of', wj]);
const palabras = JSON.parse(fs.readFileSync(wj + '.json', 'utf8').replace(/^\uFEFF/, '')).transcription.map(s => ({ t: s.text.trim(), de: s.offsets.from / 1000, a: s.offsets.to / 1000 })).filter(w => w.t && !/^\[.*\]$/.test(w.t));
if (!palabras.length) { console.log('FALLO: no se oye voz en el vídeo'); process.exit(1); }

// trozos de voz continuos (se quitan las pausas largas)
const trozos = []; for (const w of palabras) { const u = trozos[trozos.length - 1]; if (u && w.de - u.fin < R.pausa) { u.fin = w.a; u.palabras.push(w); } else trozos.push({ ini: w.de, fin: w.a, palabras: [w] }); }
const piezas = []; for (const t of trozos) { const ini = Math.max(0, t.ini - 0.1), fin = Math.min(dur, t.fin + 0.18); const n = Math.max(1, Math.round((fin - ini) / 5.5)); for (let k = 0; k < n; k++) piezas.push({ ini: ini + (fin - ini) * k / n, fin: ini + (fin - ini) * (k + 1) / n }); }
let acum = 0; piezas.forEach(p => { p.t0 = acum; acum += p.fin - p.ini; }); const durFinal = acum;
const mapea = (t) => { for (const p of piezas) if (t >= p.ini && t <= p.fin) return p.t0 + (t - p.ini); return null; };
console.log('Duración final:', durFinal.toFixed(1), 's (', piezas.length, 'trozos )');

// título con IA
let plan = { kicker: 'RANUSE DESIGN', titulo: '' };
try {
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': ENV.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: 400, messages: [{ role: 'user', content: 'Vídeo vertical de Ranuse Design (diseño de gimnasios). Transcripción: ' + palabras.map(w => w.t).join(' ').slice(0, 5000) + '\n' + (NOTAS ? 'Indicaciones: ' + NOTAS + '\n' : '') + 'Responde SOLO JSON: {"kicker":"categoría de 2-4 palabras","titulo":"gancho serio en mayúsculas, máx. 8 palabras, sin exclamaciones","enfasis":["palabras clave literales de la transcripción, 1 de cada 6"]}' }] }) });
  const j = await r.json(); plan = JSON.parse(/\{[\s\S]*\}/.exec(j.content.map(b => b.text || '').join(''))[0]);
} catch (e) { console.log('Sin título IA:', e.message); }
fs.writeFileSync(path.join(work, 'plan.json'), JSON.stringify(plan, null, 1));
const enfasis = new Set((plan.enfasis || []).map(x => String(x).toLowerCase().replace(/[.,;:¿?¡!]/g, '')));

// subtítulos pop con la línea de tiempo ya recortada
const ev = []; const bl = []; let b = [];
for (const w of palabras) { const d = mapea((w.de + w.a) / 2); if (d === null) continue; b.push({ ...w, d }); if (b.length >= R.subs.palabrasPorBloque || /[.?!,]$/.test(w.t)) { bl.push(b); b = []; } } if (b.length) bl.push(b);
bl.forEach((g, k) => {
  const ini = mapea(g[0].de) ?? g[0].d, fin = k < bl.length - 1 ? Math.max(mapea(bl[k + 1][0].de) ?? bl[k + 1][0].d, ini + 0.25) : ini + 0.6;
  const txt = g.map(w => { const s0 = limpiaT(w.t).replace(/[.,;:]+$/, ''), s = R.mayusculas === false ? s0.toLowerCase() : s0.toUpperCase(); const fuerte = R.resaltar !== false && (/\d/.test(w.t) || enfasis.has(w.t.toLowerCase().replace(/[.,;:¿?¡!]/g, ''))); return fuerte ? '{\\c' + R.acento + '}' + s + '{\\c&HFFFFFF&}' : s; }).join(' ');
  ev.push('Dialogue: 1,' + tAss(ini) + ',' + tAss(fin) + ',Sub,,0,0,0,,{\\fscx82\\fscy82\\t(0,110,\\fscx100\\fscy100)\\fad(40,0)}' + txt);
});
const tf = Math.min(durFinal, 3.2);
if (R.titulo !== false && plan.titulo) {
  ev.push('Dialogue: 3,' + tAss(0) + ',' + tAss(tf) + ',Kicker,,0,0,0,,{\\fad(200,300)}' + limpiaT(plan.kicker || '').toUpperCase().split('').join('\u200A'));
  ev.push('Dialogue: 3,' + tAss(0) + ',' + tAss(tf) + ',Titulo,,0,0,0,,{\\fad(250,350)}' + limpiaT(plan.titulo).toUpperCase());
}
if (R.barra !== false) ev.push('Dialogue: 4,' + tAss(0) + ',' + tAss(durFinal) + ',Kicker,,0,0,0,,{\\an7\\pos(0,1896)\\p1\\c' + R.acento + '\\fscx0\\t(0,' + Math.round(durFinal * 1000) + ',\\fscx100)}m 0 0 l 1080 0 1080 7 0 7{\\p0}');
const ass = ['[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1080', 'PlayResY: 1920', 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '', '[V4+ Styles]',
  'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
  'Style: Sub,Montserrat,' + R.subs.tam + ',&H00FFFFFF,&H000000FF,&H00000000,&H96000000,-1,0,0,0,100,100,1,0,1,' + GROSOR + ',2,50,50,' + R.subs.margenV + ',1',
  'Style: Kicker,Montserrat,34,' + R.acento.replace('&H', '&H00').replace(/&$/, '') + ',&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,4,0,1,0,0,8,80,80,300,1',
  'Style: Titulo,Montserrat,60,&H00FFFFFF,&H000000FF,&H00000000,&HA0000000,-1,0,0,0,100,100,1,0,1,3,5,8,90,90,385,1', '', '[Events]', 'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Encoding'.replace(',Encoding', ',Effect,Text')].concat(ev).join('\n');
fs.writeFileSync(path.join(work, 'subs.ass'), '\uFEFF' + ass, 'utf8');
fs.mkdirSync(path.join(work, 'fonts'), { recursive: true }); fs.copyFileSync(FONT, path.join(work, 'fonts', 'Montserrat-Bold.ttf'));

// un solo ffmpeg: trozos + zoom alterno + concat + subtítulos + voz limpia
const ZOOMS = R.zoomFinal <= 1 ? [1.0] : [1.0, R.zoomFinal, 1.0, Math.min(1.3, R.zoomFinal + 0.1)];
const partes = [], pa = [];
piezas.forEach((p, i) => {
  const z = ZOOMS[i % ZOOMS.length], cw = W / H > 9 / 16 ? 'ih*9/16' : 'iw', ch = W / H > 9 / 16 ? 'ih' : 'iw*16/9';
  partes.push('[0:v]trim=' + p.ini.toFixed(3) + ':' + p.fin.toFixed(3) + ',setpts=PTS-STARTPTS,crop=' + cw + ':' + ch + ',scale=' + Math.round(1080 * z) + ':' + Math.round(1920 * z) + ',crop=1080:1920,fps=30,setsar=1[v' + i + ']');
  pa.push('[0:a]atrim=' + p.ini.toFixed(3) + ':' + p.fin.toFixed(3) + ',asetpts=PTS-STARTPTS[a' + i + ']');
});
const cat = piezas.map((_, i) => '[v' + i + '][a' + i + ']').join('') + 'concat=n=' + piezas.length + ':v=1:a=1[vc][ac]';
fs.writeFileSync(path.join(work, 'grafo.txt'), partes.concat(pa, [cat, '[vc]eq=contrast=1.06:saturation=1.1,ass=subs.ass:fontsdir=fonts[v]', '[ac]' + AUDIO + '[a]']).join(';\n'));
const rr = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.resolve(ENTRADA), '-/filter_complex', 'grafo.txt', '-map', '[v]', '-map', '[a]', '-c:v', 'h264_nvenc', '-preset', 'p5', '-cq', '24', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', path.resolve(SALIDA)], { cwd: work });
console.log(fs.existsSync(SALIDA) ? 'OK ' + SALIDA + ' · ' + (fs.statSync(SALIDA).size / 1048576).toFixed(1) + ' MB' : 'FALLO ' + (rr.stderr || '').slice(0, 800));
