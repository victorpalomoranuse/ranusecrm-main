// Limpieza de la voz: tropiezos ("cu-cu-cuántos"), palabras repetidas, errores y pausas largas; y cadena de audio para voz con eco/ruido de sala.
import fs from 'fs';
import { spawnSync } from 'child_process';

// Cadena de limpieza: filtro de graves, quita ruido de sala (con seguimiento), puerta suave entre palabras, menos "boxiness",
// presencia en la voz, compresión suave y volumen final. Sin subir el ruido.
export const CADENA_VOZ = 'highpass=f=90,afftdn=nr=12:nf=-42,agate=threshold=0.02:ratio=2:attack=8:release=250:range=0.35,equalizer=f=250:t=q:w=1:g=-2,equalizer=f=3200:t=q:w=1.2:g=2,loudnorm=I=-15:TP=-1.5:LRA=11,aresample=48000';

const norm = t => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zñ0-9]/g, '');
const silabas = t => Math.max(1, (norm(t).match(/[aeiou]+/g) || ['a']).length);

function envolvente(wav16) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', wav16, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  const f = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4)), HOP = 160, n = Math.floor(f.length / HOP), e = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < HOP; k++) { const v = f[i * HOP + k]; s += v * v; } e[i] = Math.sqrt(s / HOP); }
  const s = new Float32Array(n); for (let i = 0; i < n; i++) { let a = 0, c = 0; for (let k = -2; k <= 2; k++) if (e[i + k] !== undefined) { a += e[i + k]; c++; } s[i] = a / c; }
  return s; // 100 valores por segundo
}

// Tropiezos dentro de una palabra: si dura mucho más de lo normal y hay un valle de energía, se salta lo anterior al valle.
export function corrigeTrabones(palabras, wav16) {
  let env; try { env = envolvente(wav16); } catch { return 0; }
  let n = 0;
  for (const w of palabras) {
    const dur = w.a - w.de, exp = Math.max(0.2, silabas(w.t) * 0.17 + 0.06);
    if (dur < Math.max(0.5, exp * 1.55)) continue;
    const i0 = Math.round(w.de * 100), i1 = Math.round(w.a * 100); const seg = Array.from(env.slice(i0, i1)).sort((a, b) => a - b); const med = seg[Math.floor(seg.length * 0.6)] || 0; if (!med) continue;
    const ini = Math.round((w.de + 0.07) * 100), fin = Math.round((w.a - exp * 0.8) * 100); let mejor = -1, mv = 1e9;
    for (let i = ini; i <= fin; i++) if (env[i] < mv) { mv = env[i]; mejor = i; }
    if (mejor > 0 && mv < med * 0.55) { w.de = mejor / 100 + 0.01; w.corregida = true; n++; }
  }
  return n;
}

// Palabras repetidas seguidas ("es es", "cu cuántos"): se quita la primera.
export function repetidasInmediatas(palabras) {
  const quitar = new Set();
  for (let i = 0; i < palabras.length - 1; i++) {
    const a = norm(palabras[i].t), b = norm(palabras[i + 1].t); if (!a || !b || /^\d+$/.test(a)) continue;
    const hueco = palabras[i + 1].de - palabras[i].a;
    if (hueco < 0.7 && (a === b || (a.length <= 3 && b.length > a.length && b.startsWith(a)))) quitar.add(palabras[i].i ?? i);
  }
  return quitar;
}

// La IA marca rangos de índices a eliminar: frases dichas dos veces, empezar y rehacer, errores, muletillas, comentarios al aire.
export async function rangosAQuitar(palabras, apiKey, notas = '') {
  try {
    const guion = palabras.map((w, i) => i + ':' + w.t).join(' ');
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: 800, messages: [{ role: 'user', content:
      'Transcripción de una voz en off o de alguien hablando a cámara (índice:palabra): ' + guion.slice(0, 12000) + '\n' + (notas ? 'Indicaciones: ' + notas + '\n' : '') +
      'Indica qué hay que ELIMINAR para que la comunicación sea fluida y ágil: frases o preguntas dichas dos veces (quédate con la mejor toma, normalmente la última y completa), empezar una frase y rehacerla, tropiezos ("cu cu cuántos"), errores, muletillas largas, comentarios al aire que no son parte del vídeo (órdenes al que graba, "vale", "otra vez", "¿lo repito?"). No quites contenido útil; sé conservador ante la duda. Responde SOLO JSON {"quitar":[[desde,hasta]]} con índices inclusivos.' }] }) });
    const j = await r.json(); const q = JSON.parse(/\{[\s\S]*\}/.exec(j.content.map(b => b.text || '').join(''))[0]).quitar || [];
    const s = new Set(); for (const x of q) if (Array.isArray(x) && Number.isInteger(x[0])) for (let i = x[0]; i <= (Number.isInteger(x[1]) ? x[1] : x[0]); i++) s.add(i); return s;
  } catch { return new Set(); }
}

// Recompone la voz sin lo eliminado ni las pausas largas, y devuelve las palabras con sus tiempos nuevos.
export function recomponeVoz({ palabras, quitar, wav48, salida, pausa = 0.45 }) {
  const dur = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav48], { encoding: 'utf8' }).stdout) || 0;
  const kept = palabras.filter(w => !quitar.has(w.i)); const trozos = [];
  for (const w of kept) { const u = trozos[trozos.length - 1]; const contiguo = u && w.i === u.ult + 1; if (u && (contiguo || w.de - u.fin < 0.12) && w.de - u.fin < pausa) { u.fin = w.a; u.ult = w.i; u.ws.push(w); } else trozos.push({ ini: w.de, fin: w.a, ult: w.i, ws: [w] }); }
  let t0 = 0; const partes = []; const fx = [];
  trozos.forEach((t, k) => {
    const a = Math.max(0, t.ini - 0.06), b = Math.min(dur, t.fin + 0.1);
    partes.push({ a, b, t0, ws: t.ws }); fx.push('[0:a]atrim=' + a.toFixed(3) + ':' + b.toFixed(3) + ',asetpts=PTS-STARTPTS,afade=t=in:d=0.008,afade=t=out:st=' + Math.max(0, b - a - 0.012).toFixed(3) + ':d=0.012[p' + k + ']'); t0 += b - a;
  });
  fs.writeFileSync(salida + '.txt', fx.join(';\n') + ';\n' + partes.map((_, k) => '[p' + k + ']').join('') + 'concat=n=' + partes.length + ':v=0:a=1[o]');
  spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav48, '-/filter_complex', salida + '.txt', '-map', '[o]', '-c:a', 'pcm_s16le', salida]);
  const nuevas = []; for (const p of partes) for (const w of p.ws) nuevas.push({ ...w, de: p.t0 + (w.de - p.a), a: p.t0 + (Math.min(w.a, p.b) - p.a) });
  nuevas.forEach((w, i) => { w.i0 = w.i; w.i = i; });
  return { palabras: nuevas, durVoz: t0 };
}
