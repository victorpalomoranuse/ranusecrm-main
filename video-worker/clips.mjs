// Entrevista larga -> varios clips cortos: transcribe todo, la IA elige los mejores momentos y se recorta cada uno
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { transcribe } from './transcribir.mjs';
import { ENV } from './entorno.mjs';

// Lo que hace que un vídeo corto funcione en redes (se usa al elegir los momentos y al montar)
export const PLAYBOOK_REDES = `CONOCIMIENTO DE REDES SOCIALES (aplícalo siempre):
- Los 1-3 primeros segundos deciden todo: abre con la idea más fuerte (dato, afirmación contundente, pregunta que engancha, contraste, promesa). Nada de saludos ni presentaciones.
- Un clip = una sola idea. Gancho -> desarrollo corto -> remate. Termina cuando la idea está dicha; no alargues.
- Duración que mejor retiene: 20-45 s para explicar algo; 8-20 s para una frase potente; solo pasar de 60 s si cada segundo aporta.
- Retención: ritmo rápido, sin silencios ni muletillas, cambio visual (zoom, plano, gráfico) cada 1,5-3 s, ninguna parte plana.
- El texto en pantalla ayuda: un título gancho al principio y subtítulos siempre (la mayoría ve sin sonido); palabras clave resaltadas; fuera de las zonas que tapan los botones de la app (borde inferior y lateral derecho).
- Lo que más comparte la gente: datos concretos y cifras, errores comunes, secretos del oficio, comparaciones antes/después, opiniones con carácter, historias reales con resultado.
- Ranuse es autoridad en diseño y montaje de gimnasios: prueba y credibilidad (proyectos reales, números, experiencia) antes que promesas vacías. Cierre natural: invitar a seguir, comentar o escribir.
- Formato pregunta-respuesta: se muestra primero la pregunta (como título en pantalla o dicha) y enseguida la respuesta; la respuesta empieza directa, sin rodeos.`;

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
  const prompt = 'Eres el editor jefe de Ranuse Design (diseño de espacios deportivos y gimnasios) y preparas clips virales para Instagram Reels, TikTok y Shorts a partir de una entrevista larga.\n\n' + PLAYBOOK_REDES + '\n\nLee la transcripción (con marcas de tiempo en segundos) y ' + cuantos + ' que funcionen COMO VÍDEO CORTO independiente. Cada clip debe durar entre ' + min + ' y ' + max + ' segundos (si es una pregunta con su respuesta y hace falta algo más, puede pasarse un poco), empezar al principio de una frase y acabar al final de otra, y NO solaparse con los demás: reparte los clips por TODA la entrevista, cada uno sobre una idea distinta. Si la entrevista es de preguntas y respuestas, cada clip debe EMPEZAR en la pregunta (para que se vea la pregunta y luego la respuesta) y acabar con la respuesta completa. Evita saludos, rodeos, partes confusas o que dependan de algo dicho antes. Ordénalos del mejor al peor.' + (notas ? ' INDICACIONES DE LA PERSONA (obligatorias): ' + notas : '') +
    '\n\nResponde SOLO con JSON: {"clips":[{"ini": segundos de inicio, "fin": segundos de fin, "titulo": "título gancho en pantalla, que provoque curiosidad o prometa algo (máx 9 palabras, en español, sin comillas)", "pregunta": "si es de pregunta y respuesta, la pregunta resumida; si no, vacío", "gancho": "la frase de apertura"}]}\n\nTRANSCRIPCIÓN:\n' + lineas.join('\n');
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
  console.log('Momentos propuestos por la IA:', JSON.stringify(d.clips.map(c => [Math.round(c.ini), Math.round(c.fin), c.titulo])));
  // Se ajusta cada corte a los límites de las palabras (sin cortar a mitad de una palabra) y se descartan los que se solapan
  const out = [];
  for (const c of d.clips) {
    let a = Number(c.ini), b = Number(c.fin); if (!(b > a)) continue;
    const wi = palabras.find(w => w.a > a - 0.05) || palabras[0], wf = [...palabras].reverse().find(w => w.de < b + 0.05) || palabras[palabras.length - 1];
    a = Math.max(0, wi.de - 0.12); b = Math.min(dur, wf.a + 0.25);
    if (b - a < Math.min(10, min)) { console.log('Descartado por corto:', Math.round(a), Math.round(b)); continue; }
    if (b - a > Math.max(max * 2.2, 90)) { console.log('Recortado por largo:', Math.round(a), Math.round(b)); b = a + Math.max(max * 2.2, 90); }
    // un solape pequeño se permite; si se pisa más de la mitad con otro clip ya elegido, se descarta
    if (out.some(o => Math.min(b, o.fin) - Math.max(a, o.ini) > 0.5 * Math.min(b - a, o.fin - o.ini))) { console.log('Descartado por solaparse:', Math.round(a), Math.round(b)); continue; }
    out.push({ ini: a, fin: b, titulo: String(c.titulo || 'Clip').slice(0, 90), pregunta: String(c.pregunta || '').slice(0, 200), gancho: String(c.gancho || '').slice(0, 200) });
    if (n > 0 && out.length >= n) break;
  }
  // si aun así no ha quedado ninguno, se usan los propuestos tal cual (mejor un clip imperfecto que ninguno)
  if (!out.length) for (const c of d.clips.slice(0, n > 0 ? n : 3)) { const a = Math.max(0, Number(c.ini)), b = Math.min(dur, Number(c.fin)); if (b - a >= 8) out.push({ ini: a, fin: Math.min(b, a + Math.max(max * 2.2, 90)), titulo: String(c.titulo || 'Clip').slice(0, 90), pregunta: String(c.pregunta || '').slice(0, 200), gancho: String(c.gancho || '').slice(0, 200) }); }
  return out;
}

// Recorta un momento (con su audio) para montarlo después como un vídeo normal
export function recorta(entrada, ini, fin, salida) {
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', ini.toFixed(2), '-i', entrada, '-t', (fin - ini).toFixed(2), '-vf', "scale='min(1080,iw)':-2", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', salida]);
  return fs.existsSync(salida) && fs.statSync(salida).size > 5000;
}
