// Indexa vídeos de una carpeta de Drive SIN bajarlos: lee fotogramas por HTTP y la IA describe cada vídeo.
// Se puede parar y relanzar (continúa). Uso: node indexar-drive.mjs "<id carpeta Drive>" "<salida>" [máx fotogramas] [paralelo]
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import * as drive from './drive.mjs';
import { ENV } from './entorno.mjs';
import os from 'os';
if (process.env.PRIORIDAD_NORMAL !== '1') { try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* sin permiso: sigue con prioridad normal */ } } // el indexado de fondo no debe frenar los vídeos que se piden

const [CARPETA_ID, SALIDA, MAXF = '8', PARALELO = '3', RAIZ_ABS = ''] = process.argv.slice(2);
if (!CARPETA_ID || !SALIDA) { console.log('Uso: node indexar-drive.mjs "<id carpeta>" "<salida>" [fotogramas] [paralelo]'); process.exit(1); }
fs.mkdirSync(path.join(SALIDA, 'miniaturas'), { recursive: true });
const IDX = path.join(SALIDA, 'indice.json');
const indice = fs.existsSync(IDX) ? JSON.parse(fs.readFileSync(IDX, 'utf8')) : { creado: new Date().toISOString(), origen: 'drive:' + CARPETA_ID, videos: [] };
const hechos = new Set(indice.videos.map(v => v.drive_id));
try { const om = path.join(SALIDA, 'omitir.json'); if (fs.existsSync(om)) for (const id of JSON.parse(fs.readFileSync(om, 'utf8'))) hechos.add(id); } catch { /* sin lista de omitidos */ }
const fallos = fs.existsSync(path.join(SALIDA, 'fallos.json')) ? JSON.parse(fs.readFileSync(path.join(SALIDA, 'fallos.json'), 'utf8')) : {};
const guarda = () => { fs.writeFileSync(IDX + '.tmp', JSON.stringify(indice)); fs.renameSync(IDX + '.tmp', IDX); fs.writeFileSync(path.join(SALIDA, 'fallos.json'), JSON.stringify(fallos)); };
let costeTok = { e: 0, s: 0 };

const ffmpeg = (args) => new Promise(res => { const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'ignore'] }); const t = setTimeout(() => p.kill(), 90000); p.on('close', c => { clearTimeout(t); res(c); }); });

async function describe(frames, nombre, dur) {
  const cont = [];
  frames.forEach((f, i) => { cont.push({ type: 'text', text: 'Fotograma ' + (i + 1) + ' (segundo ' + f.t.toFixed(1) + '):' }); cont.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(f.fichero).toString('base64') } }); });
  cont.push({ type: 'text', text: 'Eres el documentalista de vídeo de Ranuse Design, estudio de diseño de espacios deportivos y gimnasios. Estos son fotogramas de un vídeo ("' + nombre + '", ' + dur.toFixed(0) + ' s) de su archivo de redes sociales (puede ser un vídeo en bruto hablando a cámara, B-roll de obra o gimnasio, un vídeo ya editado, una captura de pantalla, etc.). Describe lo que se ve para poder buscar escenas al montar vídeos. Responde SOLO JSON: {"resumen":"1-2 frases de qué es","tipo":"bruto_hablando|b_roll|editado|pantalla|render|otro","planos":[{"fotograma":1,"descripcion":"qué se ve, concreto (espacio, máquinas, materiales, acción, luz)","tipo_plano":"general|medio|detalle|aéreo|travelling|a cámara","uso":"para qué sirve en un vídeo de marca"}],"etiquetas":["10-15 palabras clave en español"],"personas":"ninguna | alguien entrenando | persona hablando a cámara | otra","hablando_a_camara":true,"calidad":"alta|media|baja","movimiento":"dron|mano|trípode|estático"}' });
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': ENV.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: 1800, messages: [{ role: 'user', content: cont }] }) });
  const j = await r.json(); if (!r.ok) throw new Error('Claude ' + r.status + ' ' + JSON.stringify(j).slice(0, 160));
  const m = /\{[\s\S]*\}/.exec((j.content || []).map(b => b.text || '').join('')); if (!m) throw new Error('sin JSON'); costeTok.e += j.usage?.input_tokens || 0; costeTok.s += j.usage?.output_tokens || 0; return JSON.parse(m[0]);
}

async function procesa(f, ruta) {
  const dur = Number(f.videoMediaMetadata?.durationMillis || 0) / 1000; if (dur < 0.8) throw new Error('sin duración');
  const N = Math.min(Number(MAXF), Math.max(2, Math.ceil(dur / 10))), frames = [], { url, cabeceras } = await drive.urlDescarga(f.id);
  for (let i = 0; i < N; i++) {
    const t = Math.min(dur - 0.3, (i + 0.5) / N * dur), fich = path.join(SALIDA, 'miniaturas', f.id.slice(0, 12) + '_' + i + '.jpg');
    await ffmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-headers', 'Authorization: ' + cabeceras.Authorization + '\r\n', '-ss', t.toFixed(2), '-i', url, '-map', '0:v:0', '-frames:v', '1', '-vf', 'scale=w=448:h=448:force_original_aspect_ratio=decrease,format=yuvj420p', '-strict', 'unofficial', fich]);
    if (fs.existsSync(fich) && fs.statSync(fich).size > 1000) frames.push({ t, fichero: fich });
  }
  if (frames.length < 1) throw new Error('sin fotogramas');
  const d = await describe(frames, f.name, dur);
  const w = f.videoMediaMetadata?.width, h = f.videoMediaMetadata?.height;
  indice.videos.push({
    id: f.id.slice(0, 12), drive_id: f.id, ruta: 'drive:' + f.id, nombre: f.name, carpeta: path.dirname(ruta).replace(/\\/g, '/').replace(/^\.$/, ''), ruta_abs: RAIZ_ABS ? RAIZ_ABS + (path.dirname(ruta).replace(/\\/g, '/').replace(/^\.$/, '') ? '/' + path.dirname(ruta).replace(/\\/g, '/') : '') : undefined, bytes: Number(f.size || 0), duracion: Math.round(dur * 10) / 10, ancho: w, alto: h, vertical: h > w, fecha: f.modifiedTime?.slice(0, 10),
    resumen: d.resumen, tipo: d.tipo, etiquetas: d.etiquetas || [], personas: d.personas, hablando_a_camara: !!d.hablando_a_camara, calidad: d.calidad, movimiento: d.movimiento,
    planos: (d.planos || []).map(p => ({ t: Math.round((frames[(p.fotograma || 1) - 1]?.t ?? 0) * 10) / 10, miniatura: path.basename(frames[(p.fotograma || 1) - 1]?.fichero || ''), descripcion: p.descripcion, tipo_plano: p.tipo_plano, uso: p.uso })),
  });
}

// 1) recorrer la carpeta (solo metadatos)
console.log('Recorriendo Drive…');
const videos = []; const pila = CARPETA_ID.startsWith('ids:') ? [] : [{ id: CARPETA_ID, ruta: '' }];
if (CARPETA_ID.startsWith('ids:')) for (const id of CARPETA_ID.slice(4).split(',').filter(Boolean)) { try { const f = await drive.meta(id); if (drive.esVideo(f)) videos.push({ f, ruta: f.name }); } catch (e) { console.log('Sin acceso a', id, e.message.slice(0, 80)); } }
while (pila.length) { const c = pila.pop(); for (const f of await drive.hijos(c.id)) { if (drive.esCarpeta(f)) pila.push({ id: f.id, ruta: (c.ruta ? c.ruta + '/' : '') + f.name }); else if (drive.esVideo(f)) videos.push({ f, ruta: (c.ruta ? c.ruta + '/' : '') + f.name }); } }
const pendientes = videos.filter(x => !hechos.has(x.f.id) && !fallos[x.f.id]);
if (process.env.MAX_NUEVOS && pendientes.length > Number(process.env.MAX_NUEVOS)) { console.log('Hay', pendientes.length, 'vídeos sin indexar; se indexan los', process.env.MAX_NUEVOS, 'primeros para no tardar demasiado'); pendientes.length = Number(process.env.MAX_NUEVOS); }
console.log('Vídeos:', videos.length, '| ya indexados:', hechos.size, '| pendientes:', pendientes.length);

// 2) indexar con varios en paralelo
let hechosAhora = 0; const t0 = Date.now();
async function trabajador() {
  while (pendientes.length) {
    const x = pendientes.shift();
    try { await procesa(x.f, x.ruta); hechosAhora++; if (hechosAhora % 5 === 0) guarda(); if (hechosAhora % 10 === 0) { const seg = (Date.now() - t0) / 1000, coste = costeTok.e / 1e6 * 3 + costeTok.s / 1e6 * 15; console.log('OK ' + indice.videos.length + '/' + videos.length + ' · ' + (seg / hechosAhora).toFixed(1) + ' s/vídeo · quedan ' + pendientes.length + ' · ~' + coste.toFixed(2) + ' $'); } }
    catch (e) { fallos[x.f.id] = { nombre: x.f.name, error: e.message.slice(0, 120) }; console.log('FALLO', x.f.name, e.message.slice(0, 100)); }
  }
}
await Promise.all(Array.from({ length: Number(PARALELO) }, trabajador)); guarda();
const coste = costeTok.e / 1e6 * 3 + costeTok.s / 1e6 * 15;
console.log('FIN. Indexados ahora:', hechosAhora, '· total', indice.videos.length, '· fallos', Object.keys(fallos).length, '· coste ~' + coste.toFixed(2) + ' $');
