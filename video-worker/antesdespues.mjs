// Reel "Antes y después": un clip de antes con un texto de duda, corte seco al resultado y un montaje de planos al ritmo de la canción,
// con otro texto y un cierre animado (frase + pastilla de "Seguir"). Todo con ffmpeg; la pastilla se dibuja con HyperFrames y, si no
// hay, se queda en texto. No inventa nada: solo corta, recorta en vertical y pone texto sobre los clips reales.
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const FUENTE = path.join(AQUI, 'fonts', 'Montserrat-Bold.ttf');
const PLANTILLA = path.join(AQUI, 'plantillas', 'seguir');
const run = (c, a, o = {}) => spawnSync(c, a, { encoding: 'utf8', maxBuffer: 1 << 28, ...o });
const FPS = 30, W = 1080, H = 1920;
const PASTILLA_S = 2.5; // duración de la animación de cierre

// ---------- Ritmo ----------
// Pulsos de la canción (energía + autocorrelación). Devuelve segundos. Sin decodificar nada raro: ffmpeg -> f32 mono.
export function pulsosDe(x, sr = 22050) {
  const HOP = 256, WIN = 1024, nF = Math.floor((x.length - WIN) / HOP);
  if (nF < 200) return { bpm: 0, pulsos: [] };
  const E = new Float32Array(nF);
  for (let i = 0; i < nF; i++) { let s = 0; for (let j = 0; j < WIN; j++) { const v = x[i * HOP + j]; s += v * v; } E[i] = Math.log(1 + 1000 * s / WIN); }
  const O = new Float32Array(nF); for (let i = 1; i < nF; i++) O[i] = Math.max(0, E[i] - E[i - 1]);
  const fr = sr / HOP; let best = 0, bl = 0;
  for (let bpm = 70; bpm <= 180; bpm += 0.5) {
    const lag = fr * 60 / bpm; let s = 0;
    for (let i = 0; i + Math.round(lag * 2) < nF; i++) s += O[i] * (O[Math.round(i + lag)] || 0) + 0.5 * O[i] * (O[Math.round(i + lag * 2)] || 0);
    if (s > best) { best = s; bl = bpm; }
  }
  if (!bl) return { bpm: 0, pulsos: [] };
  const lag = fr * 60 / bl; let bp = 0, bs = 0;
  for (let p = 0; p < lag; p++) { let s = 0; for (let t = p; t < nF; t += lag) s += O[Math.round(t)] || 0; if (s > bs) { bs = s; bp = p; } }
  const pulsos = []; for (let t = bp; t < nF; t += lag) pulsos.push(+(t / fr).toFixed(3));
  return { bpm: +bl.toFixed(1), pulsos };
}
export function detectaRitmo(cancion) {
  const r = run('ffmpeg', ['-v', 'error', '-i', cancion, '-ac', '1', '-ar', '22050', '-f', 'f32le', '-'], { encoding: 'buffer', maxBuffer: 1 << 29 });
  if (r.status !== 0 || !r.stdout?.length) throw new Error('No se pudo leer la canción');
  const buf = r.stdout, x = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
  const duracion = x.length / 22050;
  return { duracion: +duracion.toFixed(3), ...pulsosDe(x) };
}

// ---------- Plan (puro: se puede probar sin vídeo) ----------
// Reparte la canción: [antes hasta el pulso del corte] + [planos de resultado cada 4 pulsos; el primero 6 para que respire] + cierre.
export function planifica({ duracion, pulsos, nClips, antesSeg = 4.7, cierreSeg = PASTILLA_S }) {
  if (!(duracion >= 8)) throw new Error('La canción es demasiado corta: necesito al menos 8 segundos');
  if (!(nClips >= 1)) throw new Error('Falta al menos un clip del resultado');
  let p = (pulsos || []).filter(t => t > 0 && t < duracion).sort((a, b) => a - b);
  if (p.length < 8) { p = []; for (let t = 0.25; t < duracion; t += 0.5) p.push(+t.toFixed(3)); } // sin ritmo claro: rejilla de 120 por minuto
  const paso = (p[p.length - 1] - p[0]) / Math.max(1, p.length - 1);
  while (p[p.length - 1] + paso < duracion + paso * 8) p.push(+(p[p.length - 1] + paso).toFixed(3)); // prolonga la rejilla un poco
  const objetivo = Math.min(antesSeg, duracion - 4);
  let R = 2; for (let i = 2; i < p.length; i++) if (Math.abs(p[i] - objetivo) < Math.abs(p[R] - objetivo)) R = i;
  const revelado = p[R], limite = duracion - 1.3, cortes = [revelado];
  let i = R + 6; if (p[i] != null && p[i] <= limite) cortes.push(p[i]);
  while (cortes.length > 1) { i += 4; if (p[i] != null && p[i] <= limite) cortes.push(p[i]); else break; }
  cortes.push(duracion);
  const tramos = []; for (let k = 0; k < cortes.length - 1; k++) tramos.push({ ini: cortes[k], fin: cortes[k + 1], clip: k % nClips });
  const arranques = cortes.slice(0, -1).filter(t => t <= duracion - cierreSeg + 0.05 && t > revelado);
  const pastillaInicio = arranques.length ? arranques[arranques.length - 1] : Math.max(revelado + 1, duracion - cierreSeg);
  return { duracion, revelado, tramos, pastillaInicio: +pastillaInicio.toFixed(3) };
}

// ---------- Movimiento: qué tramo de cada clip es más fluido ----------
export function analizaMovimiento(video, dir) {
  const f = 'mov_' + path.basename(video).replace(/[^\w.-]/g, '_') + '.txt'; fs.rmSync(path.join(dir, f), { force: true });
  run('ffmpeg', ['-nostats', '-v', 'error', '-t', '180', '-i', video, '-vf', `scale=216:-2,signalstats,metadata=print:key=lavfi.signalstats.YDIF:file=${f}`, '-an', '-f', 'null', '-'], { cwd: dir });
  try { return fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(l => l.includes('YDIF')).map(l => +l.split('=')[1]); } catch { return []; }
}
const mediana3 = a => a.map((_, i) => [a[Math.max(0, i - 1)], a[i], a[Math.min(a.length - 1, i + 1)]].sort((x, y) => x - y)[1]);
// Devuelve el segundo de inicio de la ventana más fluida (pocos tirones, algo de movimiento), evitando las ya usadas.
export function elegirVentana(y, durSeg, usados = [], fps = 29.97, margen = 0.3) {
  const serie = mediana3(y), n = Math.round(durSeg * fps), m = Math.round(margen * fps);
  if (serie.length < n + 2 * m) return { ss: Math.max(0, (serie.length / fps - durSeg) / 2), corto: true };
  let mejor = null;
  for (let s = m; s + n <= serie.length - m; s++) {
    if (usados.some(([a, b]) => s < b && s + n > a)) continue;
    const w = serie.slice(s, s + n), media = w.reduce((a, b) => a + b, 0) / n;
    let salto = 0; for (let i = 1; i < n; i++) salto = Math.max(salto, Math.abs(w[i] - w[i - 1]));
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - media) ** 2, 0) / n);
    const score = salto + sd * 0.8 + Math.max(0, 3 - media) * 0.8;
    if (!mejor || score < mejor.score) mejor = { s, score };
  }
  if (!mejor) return { ss: m / fps, corto: false };
  usados.push([mejor.s - Math.round(0.2 * fps), mejor.s + n + Math.round(0.2 * fps)]);
  return { ss: +(mejor.s / fps).toFixed(2), corto: false };
}

// ---------- Utilidades ffmpeg ----------
export function sondea(video) {
  const r = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:stream_side_data=rotation:format=duration', '-of', 'json', video]);
  let j; try { j = JSON.parse(r.stdout); } catch { throw new Error('No se pudo leer el vídeo ' + path.basename(video)); }
  let w = j.streams?.[0]?.width, h = j.streams?.[0]?.height; const rot = Math.abs(Number(j.streams?.[0]?.side_data_list?.find(s => s.rotation != null)?.rotation || 0));
  if (!w || !h) throw new Error('El archivo ' + path.basename(video) + ' no tiene vídeo');
  if (rot === 90 || rot === 270) [w, h] = [h, w];
  return { w, h, dur: Number(j.format?.duration) || 0 };
}
export const escFuente = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:');
// Texto con aparición/desaparición suave. Los ficheros de texto se escriben en dir para no escapar nada.
function dibuja(dir, id, texto, { size, y, ini, fin, entra = 0.18, sale = 0.3 }) {
  const f = `txt_${id}.txt`; fs.writeFileSync(path.join(dir, f), String(texto), 'utf8');
  const a = `min(1,(t-${ini})/${entra})*min(1,(${fin}-t)/${sale})`;
  return `drawtext=fontfile='${escFuente(FUENTE)}':textfile=${f}:fontsize=${size}:fontcolor=white@0.96:shadowcolor=black@0.6:shadowx=2:shadowy=3:x=(w-text_w)/2:y=${y}:enable='between(t,${ini},${fin})':alpha='${a}'`;
}
const cubre = `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H}`;

// ---------- Pastilla de "Seguir" (HyperFrames); devuelve la ruta del .webm con transparencia o null ----------
export function renderPastilla({ handle, cta, dir }) {
  if (process.env.HF_ACTIVO !== '1' && process.env.HF_PASTILLA !== '1') return null;
  try {
    const p = path.join(dir, '_pastilla'); fs.rmSync(p, { recursive: true, force: true }); fs.cpSync(PLANTILLA, p, { recursive: true });
    const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = fs.readFileSync(path.join(p, 'index.html'), 'utf8').replace('{{CTA}}', esc(cta)).replace('{{HANDLE}}', esc(handle));
    fs.writeFileSync(path.join(p, 'index.html'), html);
    const salida = path.join(dir, 'pastilla.webm');
    const global = process.env.HF_GLOBAL === '1', cmd = global ? 'hyperframes' : (process.platform === 'win32' ? 'npx.cmd' : 'npx');
    const args = global ? [] : ['--yes', 'hyperframes@' + (process.env.HF_PASTILLA_VERSION || '0.9.94')];
    run(cmd, [...args, 'render', p, '-o', salida, '--format', 'webm', '-f', String(FPS), '--quiet'], { timeout: 10 * 60 * 1000, shell: process.platform === 'win32' });
    return fs.existsSync(salida) && fs.statSync(salida).size > 3000 ? salida : null;
  } catch { return null; }
}

// ---------- Montaje ----------
export async function montaAntesDespues({ antes, despues, cancion, textos = {}, ajustes = {}, dir, salida, avisa = async () => {} }) {
  fs.mkdirSync(dir, { recursive: true });
  const T = { intro: textos.intro ?? '¿y si sale mal?', reveal: textos.reveal ?? '¿y si sale bien?', cta: textos.cta ?? 'sígueme para más proyectos de gym', handle: textos.handle ?? '' };
  await avisa(5, 'Escuchando el ritmo de la canción');
  const ritmo = detectaRitmo(cancion);
  const plan = planifica({ duracion: Math.min(ritmo.duracion, ajustes.duracion_max || 30), pulsos: ritmo.pulsos, nClips: despues.length, antesSeg: ajustes.antes_seg || 4.7 });
  await avisa(15, 'Buscando en cada clip el tramo donde la cámara va más fluida');
  const infos = despues.map(v => sondea(v));
  const movs = despues.map(v => analizaMovimiento(v, dir)), usados = despues.map(() => []);
  const tramos = plan.tramos.map(t => { const d = t.fin - t.ini, v = elegirVentana(movs[t.clip], d, usados[t.clip]); return { ...t, dur: d, ss: v.ss }; });
  await avisa(30, 'Montando el vídeo');
  // entradas: 0 = antes, 1..N = tramos, luego canción y (opcional) pastilla
  const entradas = [], filtros = [];
  const ia = sondea(antes), dA = plan.revelado, ini = Math.max(0, Number(ajustes.antes_inicio) || 0);
  entradas.push('-ss', String(ini), '-t', String(dA + 0.5), '-i', antes);
  let gA;
  if (ia.w > ia.h) {
    const cw = Math.floor(ia.h * 9 / 16 / 2) * 2, x0 = Math.min(ia.w - cw, Math.max(0, Math.round((ajustes.antes_x ?? 50) / 100 * ia.w - cw / 2)));
    const x1 = ajustes.antes_x_fin != null ? Math.min(ia.w - cw, Math.max(0, Math.round(ajustes.antes_x_fin / 100 * ia.w - cw / 2))) : x0;
    gA = `crop=${cw}:${ia.h}:'${x0}+(${x1}-${x0})*min(t/${dA.toFixed(3)},1)':0,scale=${W}:${H}:flags=lanczos`;
  } else gA = cubre;
  filtros.push(`[0:v]fps=${FPS},${gA},setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration=3,trim=duration=${dA.toFixed(3)},setpts=PTS-STARTPTS[v0]`);
  tramos.forEach((t, k) => {
    entradas.push('-ss', String(t.ss), '-t', String(t.dur + 0.3), '-i', despues[t.clip]);
    filtros.push(`[${k + 1}:v]fps=${FPS},${cubre},setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration=3,trim=duration=${t.dur.toFixed(3)},setpts=PTS-STARTPTS[v${k + 1}]`);
  });
  const n = tramos.length + 1; entradas.push('-i', cancion); const iAudio = n;
  const cierre = Boolean(T.handle || T.cta);
  const webm = T.handle ? renderPastilla({ handle: T.handle.startsWith('@') ? T.handle : '@' + T.handle, cta: T.cta, dir }) : null;
  if (webm) entradas.push('-c:v', 'libvpx-vp9', '-i', webm);
  const textosF = [];
  const yIntro = ajustes.intro_y ?? '(h-text_h)/2', yReveal = 'h*0.315-text_h/2';
  if (T.intro) textosF.push(dibuja(dir, 'intro', T.intro, { size: 56, y: yIntro, ini: 0, fin: +(plan.revelado - 0.06).toFixed(3), entra: 0.001 }));
  if (T.reveal) textosF.push(dibuja(dir, 'reveal', T.reveal, { size: 56, y: yReveal, ini: +(plan.revelado + 0.06).toFixed(3), fin: plan.pastillaInicio, entra: 0.18 }));
  if (cierre && !webm) { // sin HyperFrames: el cierre queda en texto
    if (T.cta) textosF.push(dibuja(dir, 'cta', T.cta, { size: 46, y: 'h*0.47-text_h/2', ini: plan.pastillaInicio, fin: +(plan.duracion - 0.1).toFixed(3), entra: 0.4 }));
    if (T.handle) textosF.push(dibuja(dir, 'handle', T.handle.startsWith('@') ? T.handle : '@' + T.handle, { size: 52, y: 'h*0.53-text_h/2', ini: +(plan.pastillaInicio + 0.2).toFixed(3), fin: +(plan.duracion - 0.1).toFixed(3), entra: 0.4 }));
  }
  const lista = Array.from({ length: n }, (_, i) => `[v${i}]`).join('');
  let cadena = `${lista}concat=n=${n}:v=1:a=0,eq=contrast=1.03:saturation=1.04${textosF.length ? ',' + textosF.join(',') : ''}`;
  if (webm) cadena += `,format=yuv420p[base];[${n + 1}:v]format=yuva420p,setpts=PTS+${plan.pastillaInicio}/TB[pp];[base][pp]overlay=0:0:eof_action=pass:format=auto,format=yuv420p[vout]`;
  else cadena += ',format=yuv420p[vout]';
  filtros.push(cadena);
  filtros.push(`[${iAudio}:a]atrim=0:${plan.duracion},afade=t=in:d=0.1,afade=t=out:st=${Math.max(0, plan.duracion - 0.75).toFixed(2)}:d=0.75[aout]`);
  const r = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...entradas, '-filter_complex', filtros.join(';'), '-map', '[vout]', '-map', '[aout]', '-t', String(plan.duracion), '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-maxrate', '10M', '-bufsize', '20M', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', salida], { cwd: dir });
  if (!fs.existsSync(salida) || fs.statSync(salida).size < 5000) throw new Error('No se pudo montar el vídeo: ' + (r.stderr || '').slice(-500));
  return { plan: { ...plan, bpm: ritmo.bpm, tramos: tramos.map(t => ({ clip: t.clip, ini: +t.ini.toFixed(2), fin: +t.fin.toFixed(2), desde: t.ss })), pastilla: Boolean(webm) }, salida };
}

// Uso directo para probar: node antesdespues.mjs <spec.json>   (spec: { antes, despues:[...], cancion, textos, ajustes, salida })
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) && process.argv[2]) {
  const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), dir = path.resolve(spec.dir || 'trabajo_reveal');
  montaAntesDespues({ ...spec, dir, salida: path.resolve(spec.salida || path.join(dir, 'reveal.mp4')), avisa: async (p, t) => console.log(p + '%', t) }).then(r => console.log(JSON.stringify(r.plan))).catch(e => { console.error('ERROR', e.message); process.exit(1); });
}
