// Entrevista larga -> varios clips cortos: transcribe todo, la IA elige los mejores momentos y se recorta cada uno
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { transcribe } from './transcribir.mjs';
import { ENV } from './entorno.mjs';
import { etiquetasHablantes } from './voz.mjs';

// Lo que hace que un vídeo corto funcione en redes (se usa al elegir los momentos y al montar)
export const PLAYBOOK_REDES = `CONOCIMIENTO DE REDES SOCIALES (aplícalo siempre):
- GANCHO (primeros 1-3 s): decide todo. Debe funcionar a la vez por TRES canales: lo que se ve, las primeras palabras y el texto en pantalla (y entenderse sin sonido). Se abre una pregunta que el espectador necesita cerrar; el contenido la responde. Empieza ya en plena energía: sin saludos, sin "hola", sin presentarte, sin logos. Nunca prometas algo que el vídeo no cumple (el remate debe corresponder al gancho).
- ESTRUCTURA: Gancho -> desarrollo con bucles abiertos -> remate (payoff) -> cierre. Una sola idea por clip. El valor va por delante; cambio visual (zoom, plano, gráfico) cada 2-4 s; cero silencios, muletillas ni partes planas.
- DURACIÓN: lo que más alcance da es 15-35 s (unas 75 palabras cada 30 s). Para explicar un tutorial se puede llegar a ~90 s; más de eso solo si cada segundo aporta.
- SIN SONIDO: el vídeo debe entenderse mudo: subtítulos grabados en el vídeo desde la primera palabra, palabra a palabra, de unas 2 líneas, con la palabra clave resaltada y revisados.
- ZONA SEGURA: no pongas texto ni caras importantes en los ~250 px de arriba ni en los ~350 px de abajo (los tapan los botones de la app); el gancho, la cara y la llamada a la acción, en el centro.
- PALABRAS CLAVE: deben aparecer en las primeras palabras habladas y en el texto en pantalla (ayuda a que la red entienda de qué va).
- CIERRE: terminar de forma que enlace con el principio (el espectador lo vuelve a ver) y con UNA sola llamada a la acción ligada al valor del vídeo (~2 s), nunca "dale like y suscríbete".
- LO QUE MÁS SE COMPARTE: datos y cifras concretas, errores comunes, secretos del oficio, antes/después, opiniones con carácter, historias reales con resultado. Pregúntate: ¿quién se lo mandaría a quién, y por qué?
- PROFESIONALIDAD: contenido original, sin marcas de agua de otras apps, con audio. Un clip debe sostenerse solo, representar con justicia a quien habla y servir a la audiencia. Si pasa de entrevista a clip, descarta intros, saludos, patrocinios y charla (se espera descartar ~40% de lo que la IA propone).
- Formato pregunta-respuesta: se ve primero la pregunta (en pantalla) y enseguida la respuesta, que empieza directa y sin rodeos.`;

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
      palabras.push({ t, de: o + s.offsets.from / 1000, a: o + s.offsets.to / 1000, ...(s.spk !== undefined ? { spk: s.spk } : {}) });
    }
    fs.rmSync(wav, { force: true });
  }
  return { palabras, dur };
}

// La IA lee la entrevista y ARMA clips: cada clip es una secuencia de tramos [ini,fin] que pueden venir de partes distintas (gancho, pregunta, mejor toma de la respuesta)
export async function eligeClips(palabras, dur, { n = 0, min = 25, max = 70, notas = '', reglas = '' } = {}) {
  const et = etiquetasHablantes(palabras), conVoces = et.some(e => e);
  const lineas = []; let cur = [], ini = 0, act = '';
  const cierra = () => { if (cur.length) { lineas.push('[' + ini.toFixed(1) + ' s]' + (conVoces && act ? ' ' + act + ':' : '') + ' ' + cur.join(' ')); cur = []; } };
  palabras.forEach((w, i) => { if (cur.length && et[i] !== act) cierra(); if (!cur.length) { ini = w.de; act = et[i]; } cur.push(w.t); if (cur.length >= 16 || /[.?!]$/.test(w.t) && cur.length >= 4) cierra(); });
  cierra();
  const cuantos = n > 0 ? 'Arma EXACTAMENTE ' + n + ' clips' : 'Arma entre 3 y ' + Math.max(3, Math.min(10, Math.round(dur / 300))) + ' clips (solo los que de verdad merezcan ser un vídeo; mejor pocos y buenos)';
  const prompt = 'Eres el editor jefe de Ranuse Design (diseño de espacios deportivos y gimnasios) y preparas clips virales para Instagram Reels, TikTok y Shorts a partir de una entrevista larga.\n\n' + PLAYBOOK_REDES +
    '\n\nCÓMO ARMAR CADA CLIP (como un editor profesional de Opus Clip): un clip NO es un trozo seguido de la entrevista: se compone de TRAMOS [ini,fin] que se reproducen EN ESTE ORDEN y que pueden ser de partes distintas.\n' +
    '1) Estructura: gancho -> contexto o pregunta breve -> respuesta con valor -> remate. Puedes colocar al principio la frase más potente aunque venga después en la entrevista, si así engancha más, siempre que luego el relato se entienda.\n' +
    '2) Si la entrevista es de preguntas y respuestas, incluye SIEMPRE la pregunta del entrevistador (su propio tramo) justo antes de la respuesta.\n' +
    '3) De la respuesta usa SOLO la mejor toma: si la persona se equivoca, se corrige, se traba, repite o empieza de nuevo, SALTA esos tramos y quédate con la versión bien dicha, completa y fluida. Quita divagaciones, muletillas y charla fuera de tema (risas, comentarios a otras personas, "vale", "ya").\n' +
    '4) Cada tramo empieza al principio de una frase y acaba al final de otra, y los tramos de un mismo clip no se solapan entre sí.\n' +
    '5) El resultado total (suma de tramos) debe sonar fluido y natural, sin cortes bruscos de idea, y durar entre ' + min + ' y ' + max + ' segundos (si es pregunta con respuesta y hace falta, puede pasarse un poco).\n' +
    '6) Prefiere clips de 20-45 s y empieza cada uno con la frase más potente (gancho en los 3 primeros segundos, entendible sin sonido); excluye intros, saludos, patrocinios y charla fuera de tema. Cada clip trata una idea distinta; reparte por TODA la entrevista; los clips no deben repetir los mismos tramos.\n\n' +
    (conVoces ? 'Cada línea empieza con P: (el entrevistador, que PREGUNTA) o R: (quien RESPONDE). Un clip de pregunta-respuesta incluye la pregunta P (su mejor formulación; si la repite o la corrige, la versión bien dicha) justo antes de la mejor toma de la respuesta R; descarta los "vale", "¿me repites?" y comentarios sueltos de P. ' : '') + 'Lee la transcripción (con el segundo de inicio de cada línea) y ' + cuantos + '. Ordénalos del mejor al peor.' + (notas ? ' INDICACIONES DE LA PERSONA (obligatorias): ' + notas : '') +
    (reglas ? '\n\nVOZ Y REGLAS DE MARCA DE RANUSE (obligatorias):\n' + reglas : '') +
    '\n\nResponde SOLO con JSON: {"clips":[{"tramos":[[ini,fin],[ini,fin]], "titulo": "título gancho en pantalla, que provoque curiosidad o prometa algo (máx 9 palabras, en español, sin comillas)", "pregunta": "si es de pregunta y respuesta, la pregunta resumida; si no, vacío", "gancho": "la frase de apertura", "score": 0-100 potencial viral (sé exigente y honesto: 90+ excepcional, la mayoría entre 55 y 85), "sub": {"gancho": 0-100, "flujo": 0-100, "valor": 0-100, "tendencia": 0-100}, "motivo": "en una frase, por qué funciona o qué le falta"}]}\n\nTRANSCRIPCIÓN:\n' + lineas.join('\n');
  let d = null;
  for (let intento = 0; intento < 2 && !d; intento++) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': ENV.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: 8000, messages: [{ role: 'user', content: prompt }] }) });
      const j = await r.json(); if (!r.ok) throw new Error('Claude ' + r.status);
      d = JSON.parse(/\{[\s\S]*\}/.exec(j.content.map(b => b.text || '').join(''))[0]);
    } catch (e) { console.log('Elección de clips, reintento:', e.message); }
  }
  if (!d?.clips?.length) throw new Error('La IA no ha podido elegir los momentos de la entrevista');
  console.log('Clips armados por la IA:', JSON.stringify(d.clips.map(c => [(c.tramos || []).map(t => Math.round(t[0]) + '-' + Math.round(t[1])).join(' + '), c.titulo, c.score])));
  // cada tramo se ajusta a los límites de las palabras (sin cortar una palabra por la mitad)
  const alinea = (a, b) => {
    const wi = palabras.find(w => w.a > a - 0.05), wf = [...palabras].reverse().find(w => w.de < b + 0.05); if (!wi || !wf || wf.a <= wi.de) return null;
    return [Math.max(0, wi.de - 0.08), Math.min(dur, wf.a + 0.18)];
  };
  const hechos = [];
  const arma = (c, estricto) => {
    const crudos = (Array.isArray(c.tramos) && c.tramos.length ? c.tramos : (Number.isFinite(c.ini) ? [[c.ini, c.fin]] : [])).filter(t => Array.isArray(t) && Number(t[1]) > Number(t[0]));
    let tr = crudos.map(t => alinea(Number(t[0]), Number(t[1]))).filter(t => t && t[1] - t[0] >= 0.8);
    if (!tr.length) return null;
    let total = tr.reduce((x, t) => x + (t[1] - t[0]), 0); const tope = Math.max(max * 2.2, 90);
    while (total > tope && tr.length > 1) { const u = tr.pop(); total -= u[1] - u[0]; }
    if (total > tope) { tr[0][1] = tr[0][0] + tope; total = tope; }
    if (estricto && total < Math.min(10, min)) return null;
    return { ini: tr[0][0], fin: tr[tr.length - 1][1], tramos: tr, total, titulo: String(c.titulo || 'Clip').slice(0, 90), pregunta: String(c.pregunta || '').slice(0, 200), gancho: String(c.gancho || '').slice(0, 200), ...puntua(c) };
  };
  // un clip que reutiliza más de la mitad de los tramos de otro ya elegido se descarta
  const solapa = (x, y) => { let comun = 0; for (const a of x.tramos) for (const b of y.tramos) comun += Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0])); return comun > 0.5 * Math.min(x.total, y.total); };
  for (const c of d.clips) { const x = arma(c, true); if (!x) { console.log('Clip descartado (sin tramos válidos o demasiado corto)'); continue; } if (hechos.some(o => solapa(x, o))) { console.log('Clip descartado por repetir tramos de otro'); continue; } hechos.push(x); if (n > 0 && hechos.length >= n) break; }
  if (!hechos.length) for (const c of d.clips.slice(0, n > 0 ? n : 3)) { const x = arma(c, false); if (x) hechos.push(x); }
  return hechos;
}

// Puntuación de viralidad (0-100) con sus 4 componentes y el motivo
function puntua(c) {
  const n = (x) => (Number.isFinite(Number(x)) ? Math.max(0, Math.min(100, Math.round(Number(x)))) : null);
  const sub = { gancho: n(c.sub?.gancho), flujo: n(c.sub?.flujo), valor: n(c.sub?.valor), tendencia: n(c.sub?.tendencia) };
  let score = n(c.score); if (score === null) { const v = Object.values(sub).filter(x => x !== null); score = v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; }
  return { score, sub, motivo: String(c.motivo || '').slice(0, 220) };
}

// Recorta cada tramo a calidad completa (sin reducir la resolución) y los une en un solo vídeo
export function recorta(entrada, tramos, salida) {
  const tmp = salida + '_t'; fs.mkdirSync(tmp, { recursive: true }); const lista = [];
  tramos.forEach(([a, b], k) => {
    const f = path.join(tmp, 't' + k + '.mp4');
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', a.toFixed(2), '-i', entrada, '-t', (b - a).toFixed(2), '-vf', "scale='min(2560,iw)':-2", '-c:v', 'libx264', '-preset', 'fast', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', '30', '-af', 'afade=t=in:d=0.015,afade=t=out:st=' + Math.max(0, b - a - 0.02).toFixed(2) + ':d=0.02', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', f]);
    if (fs.existsSync(f) && fs.statSync(f).size > 2000) lista.push(f);
  });
  if (!lista.length) return false;
  fs.writeFileSync(path.join(tmp, 'l.txt'), lista.map(f => "file '" + f.replace(/\\/g, '/') + "'").join('\n'));
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'l.txt'), '-c', 'copy', '-movflags', '+faststart', salida]);
  fs.rmSync(tmp, { recursive: true, force: true });
  return fs.existsSync(salida) && fs.statSync(salida).size > 5000;
}
