// Entrevista larga -> varios clips cortos: transcribe todo, la IA elige los mejores momentos y se recorta cada uno
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { transcribe } from './transcribir.mjs';
import { ENV } from './entorno.mjs';

const run = (c, a) => spawnSync(c, a, { encoding: 'utf8', maxBuffer: 1 << 26 });
const mmss = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

// Transcribe el vídeo en trozos de 20 minutos (el servicio de transcripción limita el tamaño) y une las palabras con su tiempo real
export async function transcribeLargo(entrada, dir, avisa = () => {}) {
  fs.mkdirSync(dir, { recursive: true });
  const dur = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', entrada]).stdout) || 0;
  if (!dur) throw new Error('No he podido leer el vídeo (¿archivo dañado?)');
  const TROZO = 1200, palabras = [];
  for (let o = 0; o < dur; o += TROZO) {
    avisa(Math.min(1, o / dur));
    const wav = path.join(dir, 'c' + o + '.wav'), base = path.join(dir, 'pal_' + o);
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(o), '-t', String(TROZO), '-i', entrada, '-vn', '-ac', '1', '-ar', '16000', wav]);
    if (!fs.existsSync(wav)) continue;
    await transcribe(wav, base);
    if (!fs.existsSync(base + '.json')) continue;
    for (const s of JSON.parse(fs.readFileSync(base + '.json', 'utf8').replace(/^\uFEFF/, '')).transcription) {
      const t = s.text.trim(); if (!t || /^\[.*\]$/.test(t)) continue;
      palabras.push({ t, de: o + s.offsets.from / 1000, a: o + s.offsets.to / 1000 });
    }
    fs.rmSync(wav, { force: true });
  }
  return { palabras, dur };
}

// La IA lee la entrevista con marcas de tiempo y elige los momentos que funcionan solos como vídeo corto
export async function eligeClips(palabras, dur, { n = 0, min = 25, max = 70, notas = '' } = {}) {
  const lineas = []; let cur = [], ini = 0;
  palabras.forEach((w, i) => { if (!cur.length) ini = w.de; cur.push(w.t); if (cur.length >= 18 || /[.?!]$/.test(w.t) && cur.length >= 8 || i === palabras.length - 1) { lineas.push('[' + Math.round(ini) + ' s · ' + mmss(ini) + '] ' + cur.join(' ')); cur = []; } });
  const cuantos = n > 0 ? 'Elige EXACTAMENTE ' + n + ' momentos' : 'Elige entre 3 y ' + Math.max(3, Math.min(10, Math.round(dur / 300))) + ' momentos (solo los que de verdad merezcan ser un vídeo; mejor pocos y buenos)';
  const prompt = 'Eres el editor jefe de Ranuse Design (diseño de espacios deportivos y gimnasios) y preparas clips para Instagram, TikTok y Shorts a partir de una entrevista larga. Lee la transcripción (con marcas de tiempo en segundos) y ' + cuantos + ' que funcionen COMO VÍDEO CORTO independiente: una idea completa y redonda, con un gancho en la primera frase (dato llamativo, afirmación fuerte, pregunta, historia), desarrollo claro y un cierre natural. Cada clip debe durar entre ' + min + ' y ' + max + ' segundos, empezar al principio de una frase y acabar al final de otra, y NO solaparse con los demás. Evita saludos, rodeos, partes confusas o que dependan de algo dicho antes. Ordénalos del mejor al peor.' + (notas ? ' Indicaciones de la persona: ' + notas : '') +
    '\n\nResponde SOLO con JSON: {"clips":[{"ini": segundos de inicio, "fin": segundos de fin, "titulo": "título corto y potente en español (máx 8 palabras)", "gancho": "la frase de apertura"}]}\n\nTRANSCRIPCIÓN:\n' + lineas.join('\n');
  let d = null;
  for (const modelo of ['claude-sonnet-4-5-20250929']) {
    for (let intento = 0; intento < 2 && !d; intento++) {
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': ENV.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: modelo, max_tokens: 3000, messages: [{ role: 'user', content: prompt }] }) });
        const j = await r.json(); if (!r.ok) throw new Error('Claude ' + r.status);
        d = JSON.parse(/\{[\s\S]*\}/.exec(j.content.map(b => b.text || '').join(''))[0]);
      } catch (e) { console.log('Elección de clips, reintento:', e.message); }
    }
  }
  if (!d?.clips?.length) throw new Error('La IA no ha podido elegir los momentos de la entrevista');
  // Se ajusta cada corte a los límites de las palabras (sin cortar a mitad de una palabra) y se descartan los que se solapan
  const out = [];
  for (const c of d.clips) {
    let a = Number(c.ini), b = Number(c.fin); if (!(b > a)) continue;
    const wi = palabras.find(w => w.a > a - 0.05) || palabras[0], wf = [...palabras].reverse().find(w => w.de < b + 0.05) || palabras[palabras.length - 1];
    a = Math.max(0, wi.de - 0.12); b = Math.min(dur, wf.a + 0.25);
    if (b - a < Math.min(12, min) || b - a > max * 1.5) continue;
    if (out.some(o => a < o.fin && b > o.ini)) continue;
    out.push({ ini: a, fin: b, titulo: String(c.titulo || 'Clip').slice(0, 90), gancho: String(c.gancho || '').slice(0, 200) });
    if (n > 0 && out.length >= n) break;
  }
  return out;
}

// Recorta un momento (con su audio) para montarlo después como un vídeo normal
export function recorta(entrada, ini, fin, salida) {
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', ini.toFixed(2), '-i', entrada, '-t', (fin - ini).toFixed(2), '-vf', "scale='min(1080,iw)':-2", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', salida]);
  return fs.existsSync(salida) && fs.statSync(salida).size > 5000;
}
