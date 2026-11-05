// Indexador de la biblioteca de vídeo: recorre una carpeta, saca fotogramas de cada vídeo y la IA describe qué se ve en cada trozo.
// Resultado: un índice (JSON) para BUSCAR escenas por lo que se ve ("plano aéreo de pesas con luz cálida").
// No mueve ni cambia ningún vídeo: solo lee. Se puede parar y relanzar (continúa donde se quedó).
//
// Uso:  node indexar.mjs "<carpeta con vídeos>" "<carpeta de salida>" [máx. fotogramas por vídeo]
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';

const [CARPETA, SALIDA, MAXF = '8'] = process.argv.slice(2);
if (!CARPETA || !SALIDA) { console.log('Uso: node indexar.mjs "<carpeta>" "<salida>" [máx fotogramas]'); process.exit(1); }
const ENV = Object.fromEntries(fs.readFileSync(new URL('../server/.env', import.meta.url), 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]));
const MODELO = 'claude-sonnet-4-5-20250929';
const EXT = /\.(mp4|mov|mkv|m4v|avi)$/i;
fs.mkdirSync(path.join(SALIDA, 'miniaturas'), { recursive: true });
const IDX = path.join(SALIDA, 'indice.json');
const indice = fs.existsSync(IDX) ? JSON.parse(fs.readFileSync(IDX, 'utf8')) : { creado: new Date().toISOString(), videos: [] };
const hechos = new Set(indice.videos.map(v => v.ruta + '|' + v.bytes));
const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26 });
const guarda = () => fs.writeFileSync(IDX, JSON.stringify(indice, null, 1));

function recorre(dir) { let o = []; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) o = o.concat(recorre(p)); else if (EXT.test(e.name)) o.push(p); } return o; }

async function describe(frames, nombre, dur) {
  const contenido = [];
  frames.forEach((f, i) => { contenido.push({ type: 'text', text: 'Fotograma ' + (i + 1) + ' (segundo ' + f.t.toFixed(1) + '):' }); contenido.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(f.fichero).toString('base64') } }); });
  contenido.push({ type: 'text', text: 'Eres el documentalista de vídeo de Ranuse Design, un estudio de diseño de espacios deportivos y gimnasios. Estos son fotogramas de un vídeo en bruto ("' + nombre + '", ' + dur.toFixed(0) + ' s). Describe lo que se ve para poder buscar escenas más adelante cuando se monte un vídeo. Responde SOLO con JSON: {"resumen":"1-2 frases de qué es el vídeo","planos":[{"fotograma":1,"descripcion":"qué se ve, concreto (espacio, máquinas, materiales, acción, luz)","tipo_plano":"general|medio|detalle|aéreo|travelling|a cámara","uso":"para qué sirve en un vídeo de marca (p. ej. \\"apertura potente\\", \\"detalle de producto\\", \\"ambiente del gimnasio\\")"}],"etiquetas":["10-15 palabras clave en español"],"personas":"ninguna | alguien entrenando | persona hablando a cámara | otra","hablando_a_camara":true|false,"calidad":"alta|media|baja (enfoque, luz, encuadre)","movimiento":"dron|mano|trípode|estático"}' });
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': ENV.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: MODELO, max_tokens: 1800, messages: [{ role: 'user', content: contenido }] }) });
  const j = await r.json(); if (!r.ok) throw new Error('Claude ' + r.status + ' ' + JSON.stringify(j).slice(0, 200));
  const txt = (j.content || []).map(b => b.text || '').join(''); const m = /\{[\s\S]*\}/.exec(txt); if (!m) throw new Error('sin JSON'); return { datos: JSON.parse(m[0]), uso: j.usage };
}

const todos = recorre(CARPETA).sort(); let costeTok = { entrada: 0, salida: 0 }, n = 0;
console.log('Vídeos encontrados:', todos.length);
for (const f of todos) {
  const bytes = fs.statSync(f).size; if (hechos.has(f + '|' + bytes)) continue; n++;
  const t0 = Date.now();
  try {
    const pr = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,codec_name:format=duration', '-of', 'json', f]);
    const info = JSON.parse(pr.stdout || '{}'), st = info.streams?.[0] || {}, dur = Number(info.format?.duration) || 0;
    if (dur < 0.5) { console.log('SALTADO (sin duración)', path.basename(f)); continue; }
    const hash = crypto.createHash('md5').update(f).digest('hex').slice(0, 10), N = Math.min(Number(MAXF), Math.max(2, Math.ceil(dur / 8))), frames = [];
    for (let i = 0; i < N; i++) {
      const t = Math.min(dur - 0.3, (i + 0.5) / N * dur), fich = path.join(SALIDA, 'miniaturas', hash + '_' + i + '.jpg');
      const r = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', t.toFixed(2), '-i', f, '-map', '0:v:0', '-frames:v', '1', '-vf', 'scale=w=448:h=448:force_original_aspect_ratio=decrease,format=yuvj420p', '-strict', 'unofficial', fich]);
      if (fs.existsSync(fich) && fs.statSync(fich).size > 1000) frames.push({ t, fichero: fich });
    }
    if (!frames.length) { console.log('SALTADO (sin fotogramas)', path.basename(f)); continue; }
    const { datos, uso } = await describe(frames, path.basename(f), dur); costeTok.entrada += uso?.input_tokens || 0; costeTok.salida += uso?.output_tokens || 0;
    indice.videos.push({
      id: hash, ruta: f, nombre: path.basename(f), carpeta: path.relative(CARPETA, path.dirname(f)).replace(/\\/g, '/'), bytes, duracion: Math.round(dur * 10) / 10, ancho: st.width, alto: st.height, vertical: st.height > st.width, codec: st.codec_name,
      fecha: (/(20\d{2})(\d{2})(\d{2})/.exec(path.basename(f)) || []).slice(1).join('-') || null,
      resumen: datos.resumen, etiquetas: datos.etiquetas || [], personas: datos.personas, hablando_a_camara: !!datos.hablando_a_camara, calidad: datos.calidad, movimiento: datos.movimiento,
      planos: (datos.planos || []).map(p => ({ t: Math.round((frames[(p.fotograma || 1) - 1]?.t ?? 0) * 10) / 10, miniatura: path.basename(frames[(p.fotograma || 1) - 1]?.fichero || ''), descripcion: p.descripcion, tipo_plano: p.tipo_plano, uso: p.uso })),
    });
    guarda(); console.log('OK ' + indice.videos.length + '/' + todos.length + '  ' + path.basename(f) + '  ' + dur.toFixed(0) + ' s · ' + frames.length + ' fotogramas · ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s');
  } catch (e) { console.log('FALLO ' + path.basename(f) + ': ' + e.message); }
}
const coste = costeTok.entrada / 1e6 * 3 + costeTok.salida / 1e6 * 15;
console.log('FIN. Indexados ahora: ' + n + ' · tokens ' + costeTok.entrada + ' entrada / ' + costeTok.salida + ' salida · coste aprox. ' + coste.toFixed(2) + ' $');
