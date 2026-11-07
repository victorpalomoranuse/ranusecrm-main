// Recursos subidos desde el dispositivo (vídeos o fotos sueltos): se miran con visión y entran al catálogo del montaje igual que los de Drive.
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { ENV } from './entorno.mjs';

const run = (c, a) => spawnSync(c, a, { encoding: 'utf8', maxBuffer: 1 << 26 });

async function describe(frames, nombre, dur, esImagen) {
  const cont = [];
  frames.forEach((f, i) => { cont.push({ type: 'text', text: (esImagen ? 'Imagen' : 'Fotograma ' + (i + 1) + ' (segundo ' + f.t.toFixed(1) + ')') + ':' }); cont.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(f.fichero).toString('base64') } }); });
  cont.push({ type: 'text', text: 'Eres el documentalista de Ranuse Design (diseño de gimnasios y espacios deportivos). ' + (esImagen ? 'Esta es una imagen' : 'Estos son fotogramas de un vídeo ("' + nombre + '", ' + dur.toFixed(0) + ' s)') + ' que el usuario ha subido para usarla al montar un vídeo. Descríbela para poder elegirla. Responde SOLO JSON: {"resumen":"qué se ve, en 1-2 frases","etiquetas":["8-12 palabras clave en español"],"calidad":"alta|media|baja","hablando_a_camara":true|false,"planos":[{"t":segundo,"descripcion":"qué se ve en ese momento"}]}' });
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': ENV.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1500, messages: [{ role: 'user', content: cont }] }) });
  const j = await r.json(); const m = /\{[\s\S]*\}/.exec((j.content || []).map(b => b.text || '').join('')); if (!m) throw new Error('sin JSON'); return JSON.parse(m[0]);
}

// lista: [{ ruta (archivo local), nombre, tipo: 'video'|'imagen' }] → entradas de índice
export async function indexaSubidos(lista, dir) {
  fs.mkdirSync(dir, { recursive: true }); const out = [];
  let n = 0;
  for (const it of lista) {
    try {
      n++; const esImg = /\.(jpe?g|png|webp|heic|heif)$/i.test(it.nombre || it.ruta);
      if (esImg) {
        const jpg = path.join(dir, 'up' + n + '.jpg'); run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', it.ruta, '-vf', 'scale=1600:1600:force_original_aspect_ratio=decrease', '-frames:v', '1', '-q:v', '3', jpg]);
        const peq = path.join(dir, 'up' + n + '_p.jpg'); run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', jpg, '-vf', 'scale=640:640:force_original_aspect_ratio=decrease', peq]);
        if (!fs.existsSync(jpg)) continue; const d = await describe([{ t: 0, fichero: peq }], it.nombre, 0, true);
        out.push({ id: 'up' + n, nombre: it.nombre, es_imagen: true, ruta: jpg, duracion: 600, calidad: d.calidad || 'media', tipo: 'imagen', resumen: 'IMAGEN FIJA: ' + (d.resumen || ''), etiquetas: d.etiquetas || [], planos: [{ t: 0, descripcion: d.resumen || '' }], ruta_abs: 'subidos', _elegido: true });
      } else {
        const dur = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', it.ruta]).stdout) || 0; if (dur < 0.8) continue;
        const N = Math.min(8, Math.max(2, Math.ceil(dur / 8))), frames = [];
        for (let i = 0; i < N; i++) { const t = Math.min(dur - 0.3, (i + 0.5) / N * dur), f = path.join(dir, 'up' + n + '_' + i + '.jpg'); run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', t.toFixed(2), '-i', it.ruta, '-frames:v', '1', '-vf', 'scale=w=448:h=448:force_original_aspect_ratio=decrease', f]); if (fs.existsSync(f)) frames.push({ t, fichero: f }); }
        if (!frames.length) continue; const d = await describe(frames, it.nombre, dur, false);
        out.push({ id: 'up' + n, nombre: it.nombre, ruta: it.ruta, duracion: dur, calidad: d.calidad || 'media', resumen: d.resumen || '', etiquetas: d.etiquetas || [], hablando_a_camara: !!d.hablando_a_camara, planos: (d.planos || []).slice(0, 12).map(p => ({ t: Number(p.t) || 0, descripcion: String(p.descripcion || '') })), ruta_abs: 'subidos', _elegido: true });
      }
    } catch (e) { console.log('Recurso subido sin indexar:', it.nombre, e.message); }
  }
  return out;
}
