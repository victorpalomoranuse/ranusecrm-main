// Análisis de un vídeo viral de referencia: mide cómo está editado (ritmo de cortes, zooms, texto, música, gancho)
// y lo convierte en una receta de formato con las mismas claves que usa el montador. El aspecto (colores, fuente, mayúsculas) se adapta luego a la marca.
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { ENV } from './entorno.mjs';
import { transcribe } from './transcribir.mjs';

const run = (c, a) => spawnSync(c, a, { encoding: 'utf8', maxBuffer: 1 << 28 });

// Instantes de corte (cambios de plano) detectados con ffmpeg
export function detectaCortes(video, umbral = 0.28) {
  const r = run('ffmpeg', ['-hide_banner', '-nostats', '-i', video, '-vf', `select='gt(scene,${umbral})',showinfo`, '-an', '-f', 'null', '-']);
  const t = [...String(r.stderr || '').matchAll(/pts_time:([\d.]+)/g)].map(m => Number(m[1])).filter(x => x > 0.3);
  return t.sort((a, b) => a - b).filter((x, i, a) => i === 0 || x - a[i - 1] > 0.25);
}

const estad = (v) => { if (!v.length) return { media: 0, mediana: 0, min: 0, max: 0 }; const s = [...v].sort((a, b) => a - b); return { media: v.reduce((x, y) => x + y, 0) / v.length, mediana: s[Math.floor(s.length / 2)], min: s[0], max: s[s.length - 1] }; };

export async function analizaReferencia(video, dir, avisa = () => {}) {
  fs.mkdirSync(dir, { recursive: true });
  const dur = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video]).stdout) || 0; if (!dur) throw new Error('No he podido leer el vídeo de referencia');
  avisa('Midiendo el ritmo de cortes…');
  const cortes = detectaCortes(video), tramos = []; let prev = 0; for (const c of [...cortes, dur]) { tramos.push(c - prev); prev = c; }
  const est = estad(tramos);
  // volumen de la música/voz (para saber si hay música fuerte) y palabras por minuto
  avisa('Escuchando la referencia…');
  let palabras = [], hablado = '';
  try {
    const wav = path.join(dir, 'ref.wav'); run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-vn', '-ac', '1', '-ar', '16000', wav]);
    const wj = path.join(dir, 'ref_palabras'); await transcribe(wav, wj);
    palabras = JSON.parse(fs.readFileSync(wj + '.json', 'utf8').replace(/^﻿/, '')).transcription.map(s => ({ t: s.text.trim(), de: s.offsets.from / 1000 })).filter(w => w.t && !/^\[.*\]$/.test(w.t));
    hablado = palabras.map(w => w.t).join(' ');
  } catch { /* sin voz o sin transcripción */ }
  const ppm = palabras.length && dur ? Math.round(palabras.length / (dur / 60)) : 0;
  const vol = run('ffmpeg', ['-hide_banner', '-nostats', '-i', video, '-vn', '-af', 'volumedetect', '-f', 'null', '-']).stderr || ''; const mean = Number((/mean_volume: (-?[\d.]+)/.exec(vol) || [])[1]) || null;
  // fotogramas: los 3 primeros segundos (gancho) y uno en medio de varios planos
  avisa('Mirando cómo está montado…');
  const cont = []; const tomas = [0.2, 0.9, 1.7, 2.6]; const medios = []; for (let i = 0; i < tramos.length && medios.length < 8; i += Math.max(1, Math.floor(tramos.length / 8))) { const ini = i === 0 ? 0 : cortes[i - 1]; medios.push(ini + tramos[i] / 2); }
  [...tomas, ...medios].forEach((s, i) => { const jpg = path.join(dir, 'ref_' + i + '.jpg'); run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', Math.min(dur - 0.1, s).toFixed(2), '-i', video, '-frames:v', '1', '-vf', 'scale=320:-2', jpg]); if (fs.existsSync(jpg)) { cont.push({ type: 'text', text: 'Fotograma en el segundo ' + s.toFixed(1) + (i < tomas.length ? ' (gancho)' : '') + ':' }); cont.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(jpg).toString('base64') } }); fs.rmSync(jpg, { force: true }); } });
  const datos = 'DATOS MEDIDOS: duración ' + dur.toFixed(1) + ' s; ' + tramos.length + ' planos; duración de plano media ' + est.media.toFixed(2) + ' s, mediana ' + est.mediana.toFixed(2) + ', mín ' + est.min.toFixed(2) + ', máx ' + est.max.toFixed(2) + '; ' + (ppm ? ppm + ' palabras por minuto' : 'sin voz hablada') + '; volumen medio ' + (mean ?? '?') + ' dB. ' + (hablado ? 'Lo que se dice: "' + hablado.slice(0, 1500) + '". ' : '');
  const prompt = datos + '\n\nEres un editor de vídeo experto en Reels/TikTok. Analiza CÓMO está editado este vídeo viral de referencia (no su tema) para que podamos replicar su estilo de edición con nuestro montador automático. Devuelve SOLO JSON con esta forma exacta:\n{"nombre":"nombre corto del formato (3-4 palabras)","descripcion":"2-3 frases: qué estructura tiene (gancho, desarrollo, cierre) y por qué funciona","estructura":["gancho: ...","desarrollo: ...","cierre: ..."],"receta":{"corte":{"min":nº,"max":nº},"zoomFinal":1-1.3,"whoosh":0-1,"flash":true|false,"introLetras":true|false,"collage":true|false,"estiloSubs":"normal"|"karaoke","subs":{"palabrasPorBloque":1-4,"tam":60-110,"margenV":300-900},"titulo":true|false,"barra":true|false,"resaltar":true|false,"horas":true|false,"musica":{"volumen":-24 a -8}},"criterio":"instrucciones para el montador automático sobre cómo montar este estilo (ritmo, qué se enseña en el gancho, cuándo cambia de escena, zooms, texto en pantalla), 4-8 frases concretas","parecido_a_nuestros_formatos":"cuál de estos se le parece más: un día contigo, entrevista pregunta-respuesta, one take, collage b-roll, clips dopamínicos, o ninguno"}\nUsa los datos medidos para el ritmo de cortes (corte.min y max en segundos alrededor de la mediana). No inventes lo que no se vea.';
  cont.push({ type: 'text', text: prompt });
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': ENV.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: 2000, temperature: 0, messages: [{ role: 'user', content: cont }] }) });
  const j = await r.json(); const d = JSON.parse(/\{[\s\S]*\}/.exec((j.content || []).map(b => b.text || '').join(''))[0]);
  return { dur, planos: tramos.length, plano_medio: Number(est.media.toFixed(2)), plano_mediana: Number(est.mediana.toFixed(2)), palabras_por_min: ppm, ...d };
}
