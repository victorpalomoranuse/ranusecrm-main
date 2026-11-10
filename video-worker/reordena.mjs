// Reordenar con criterio de redes: "gancho primero" (cold open). La IA lee la transcripción y, si el vídeo no arranca ya con algo potente,
// elige la mejor frase (autosuficiente, 2-9 s) y se pone al principio; el vídeo sigue después tal cual. El resto del motor (pausas, subtítulos, efectos) trabaja
// sobre ese vídeo ya reordenado, así que no cambia nada de cómo monta.
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { ENV } from './entorno.mjs';
import { transcribe } from './transcribir.mjs';

const run = (c, a) => spawnSync(c, a, { encoding: 'utf8', maxBuffer: 1 << 28 });

// Pone el tramo [a, b] (segundos) al principio y deja el vídeo completo detrás
export function concatConGancho(entrada, a, b, salida) {
  const f = 'trim=start=' + a.toFixed(2) + ':end=' + b.toFixed(2);
  const g = 'atrim=start=' + a.toFixed(2) + ':end=' + b.toFixed(2);
  const filtro = '[0:v]' + f + ',setpts=PTS-STARTPTS[v0];[0:a]' + g + ',asetpts=PTS-STARTPTS[a0];[0:v]setpts=PTS-STARTPTS[v1];[0:a]asetpts=PTS-STARTPTS[a1];[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]';
  const r = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', entrada, '-filter_complex', filtro, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', salida]);
  if (r.status !== 0 || !fs.existsSync(salida)) throw new Error('No se pudo reordenar: ' + String(r.stderr || '').slice(-200));
  return salida;
}

export async function abreConGancho(entrada, dir, direccion, avisa = () => {}) {
  const dur = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', entrada]).stdout) || 0;
  if (!dur || dur < 12 || dur > 15 * 60) return null; // solo vídeos de verdad cortos o medios
  avisa('La IA de redes está buscando el mejor gancho…');
  const wav = path.join(dir, 'gancho.wav'); run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', entrada, '-vn', '-ac', '1', '-ar', '16000', wav]);
  const base = path.join(dir, 'gancho_palabras'); await transcribe(wav, base);
  const seg = JSON.parse(fs.readFileSync(base + '.json', 'utf8').replace(/^﻿/, '')).transcription.map(s => ({ t: String(s.text || '').trim(), de: s.offsets.from / 1000, a: s.offsets.to / 1000 })).filter(s => s.t && !/^\[.*\]$/.test(s.t));
  if (seg.length < 8) return null;
  // líneas de ~12 palabras con su tiempo, para que la IA pueda señalar el tramo
  const lineas = []; let cur = null; for (const s of seg) { if (!cur || cur.n >= 12) { cur = { de: s.de, a: s.a, txt: [], n: 0 }; lineas.push(cur); } cur.txt.push(s.t); cur.a = s.a; cur.n++; }
  const texto = lineas.map(l => '[' + l.de.toFixed(1) + '-' + l.a.toFixed(1) + 's] ' + l.txt.join(' ')).join('\n').slice(0, 30000);
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': ENV.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: 800, temperature: 0, system: 'Eres el estratega de redes de Víctor Palomo (Ranuse Design, diseño de gimnasios) y editas Reels. Decides si el vídeo necesita un GANCHO AL PRINCIPIO: si los primeros 4 segundos ya enganchan (pregunta, promesa, cifra, afirmación potente), no hace falta. Si no, eliges de TODO el vídeo la frase más potente (la que más curiosidad, polémica, cifra o promesa genere) para ponerla al principio como adelanto; debe entenderse sola, durar entre 2 y 9 segundos y empezar/terminar en un límite de frase. Aplica lo aprendido de su cuenta (abajo). Devuelves SOLO JSON {"necesita":true|false,"inicio":segundos,"fin":segundos,"frase":"lo que dice","por_que":"1 frase"}.\n\n' + String(direccion || '').slice(0, 4000), messages: [{ role: 'user', content: 'TRANSCRIPCIÓN con tiempos (duración total ' + dur.toFixed(1) + ' s):\n' + texto }] }) });
  const j = await r.json(); const m = /\{[\s\S]*\}/.exec((j.content || []).map(b => b.text || '').join('')); if (!m) return null;
  const d = JSON.parse(m[0]); if (!d.necesita) { avisa('El vídeo ya arranca con buen gancho: se deja como está'); return { archivo: null, motivo: 'ya enganchaba' }; }
  let a = Math.max(0, Number(d.inicio) || 0), b = Math.min(dur, Number(d.fin) || 0);
  if (!(b - a >= 1.5 && b - a <= 12) || a < 3) return { archivo: null, motivo: 'el mejor tramo ya estaba al principio' }; // si está en los 3 primeros segundos, no se mueve
  // ajusta a los límites reales de las palabras
  const pIni = seg.find(s => s.a > a + 0.05), pFin = [...seg].reverse().find(s => s.de < b - 0.05); if (pIni) a = Math.max(0, pIni.de - 0.05); if (pFin) b = Math.min(dur, pFin.a + 0.12);
  const salida = path.join(dir, 'con_gancho.mp4'); concatConGancho(entrada, a, b, salida);
  avisa('Gancho puesto al principio: «' + String(d.frase || '').slice(0, 80) + '»');
  return { archivo: salida, inicio: a, fin: b, frase: String(d.frase || '').slice(0, 200), por_que: String(d.por_que || '').slice(0, 200) };
}
