// Música de fondo: análisis de pulsos (BPM + instantes de cada pulso) y mezcla por debajo de la voz.
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

// Devuelve { dur, bpm, beats:[s], energia } leyendo el audio de cualquier mp3/mp4/m4a/wav.
export function analizar(archivo) {
  const SR = 22050, HOP = 441; // 20 ms
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', archivo, '-vn', '-ac', '1', '-ar', String(SR), '-af', 'lowpass=f=220', '-t', '240', '-f', 'f32le', '-'], { maxBuffer: 1 << 29 });
  const buf = r.stdout; if (!buf || buf.length < SR * 4) return null;
  const f = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
  const n = Math.floor(f.length / HOP), env = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < HOP; k++) { const v = f[i * HOP + k]; s += v * v; } env[i] = Math.sqrt(s / HOP); }
  // fuerza de ataque (subidas de energía en graves = bombo)
  const on = new Float32Array(n); let mx = 0; for (let i = 2; i < n; i++) { const d = env[i] - (env[i - 1] + env[i - 2]) / 2; on[i] = d > 0 ? d : 0; if (on[i] > mx) mx = on[i]; }
  if (mx === 0) return null; for (let i = 0; i < n; i++) on[i] /= mx;
  // tempo por autocorrelación (70-170 BPM)
  const fps = SR / HOP; let mejor = 0, lagBest = 0;
  for (let lag = Math.round(fps * 60 / 170); lag <= Math.round(fps * 60 / 70); lag++) { let s = 0; for (let i = lag; i < n; i++) s += on[i] * on[i - lag]; const pen = 1 - Math.abs(Math.log2((fps * 60 / lag) / 110)) * 0.12; s *= pen; if (s > mejor) { mejor = s; lagBest = lag; } }
  if (!lagBest) return null;
  // fase: el desplazamiento que más energía de ataque recoge
  let fase = 0, fb = -1; for (let p = 0; p < lagBest; p++) { let s = 0; for (let i = p; i < n; i += lagBest) s += on[i]; if (s > fb) { fb = s; fase = p; } }
  const beats = []; for (let i = fase; i < n; i += lagBest) beats.push(Math.round(i / fps * 1000) / 1000);
  // energía media (para elegir pista tranquila/potente)
  let e = 0; for (let i = 0; i < n; i++) e += env[i]; e /= n;
  const dur = Number((spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', archivo], { encoding: 'utf8' }).stdout || '0')) || n / fps;
  return { dur: Math.round(dur * 10) / 10, bpm: Math.round(60 / (lagBest / fps) * 10) / 10, beats, energia: Math.round(e * 1000) / 1000 };
}

// Ajusta un instante al pulso más cercano si está a menos de `tol` segundos.
export function alPulso(t, beats, tol = 0.2) {
  if (!beats?.length) return t; let b = beats[0], d = Math.abs(t - b);
  for (const x of beats) { const dd = Math.abs(t - x); if (dd < d) { d = dd; b = x; } }
  return d <= tol ? b : t;
}

// Trozo de filtro: música en bucle por debajo de la voz (se agacha cuando hablas). voz = etiqueta de la voz ya limpia.
export function mezcla({ entradaIdx, voz, durTotal, db = -19, salida = 'am', inicio = 0 }) {
  return [
    `[${voz}]asplit=2[${voz}_a][${voz}_s]`,
    `[${entradaIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=${inicio.toFixed(2)}:${(inicio + durTotal + 1).toFixed(2)},asetpts=PTS-STARTPTS,volume=${db}dB,afade=t=in:d=1.2,afade=t=out:st=${Math.max(0, durTotal - 2.2).toFixed(2)}:d=2.2[${voz}_m]`,
    `[${voz}_m][${voz}_s]sidechaincompress=threshold=0.015:ratio=12:attack=15:release=450:makeup=1[${voz}_d]`,
    `[${voz}_a][${voz}_d]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.95[${salida}]`,
  ].join(';');
}

export function bibliotecaLocal(dir) {
  const out = []; if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    if (!/\.(mp3|mp4|m4a|wav|aac|mov)$/i.test(f)) continue; const ruta = path.join(dir, f), cache = ruta + '.json'; let a = null;
    if (fs.existsSync(cache)) { try { a = JSON.parse(fs.readFileSync(cache, 'utf8')); } catch { /* se recalcula */ } }
    if (!a) { a = analizar(ruta); if (a) fs.writeFileSync(cache, JSON.stringify(a)); }
    if (a) out.push({ nombre: f, ruta, ...a });
  }
  return out;
}
