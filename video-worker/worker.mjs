// Trabajador de vídeo: vigila la cola del CRM ("Estudio de vídeo") y edita lo que llegue.
// Uso: node worker.mjs "<indice.json>"      (se deja abierto; Ctrl+C para parar)
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { createRequire } from 'module';
import { spawnSync, spawn } from 'child_process';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import * as drive from './drive.mjs';
import { ENV } from './entorno.mjs';

// ffmpeg siempre disponible, arranque el trabajador desde donde arranque
const FFMPEG_DIR = process.env.FFMPEG_BIN || 'C:/Users/cashc/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin';
if (fs.existsSync(FFMPEG_DIR)) process.env.PATH = FFMPEG_DIR + ';' + (process.env.PATH || '');
const require = createRequire(new URL('../server/package.json', import.meta.url));
const { createClient } = require('@supabase/supabase-js');
const INDICE = path.resolve(process.argv[2] || new URL('./datos/piloto/indice.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const st = sb.storage.from('estudio-video');
const BASE = new URL('./datos/trabajos/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const AQUI = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const run = (c, a, o = {}) => spawnSync(c, a, { encoding: 'utf8', maxBuffer: 1 << 28, ...o });

async function leer(id) {
  const f = await st.createSignedUrl('trabajos/' + id + '.json', 30); if (!f.data?.signedUrl) return null;
  const r = await fetch(f.data.signedUrl + '&cb=' + Date.now(), { cache: 'no-store' }); return r.ok ? r.json() : null;
}
const reintenta = async (fn, intentos = 5) => { let ult; for (let i = 0; i < intentos; i++) { try { const r = await fn(); if (r?.error) throw new Error(r.error.message || String(r.error)); return r; } catch (e) { ult = e; await new Promise(z => setTimeout(z, 1500 * (i + 1))); } } throw ult; };
const guardar = (t) => reintenta(() => st.upload('trabajos/' + t.id + '.json', Buffer.from(JSON.stringify(t)), { contentType: 'application/json', upsert: true, cacheControl: '0' }));
let ultPct = 0;
async function pct(t, n, texto) { const ahora = Date.now(); if (ahora - ultPct < 2500 && n < 99) return; ultPct = ahora; Object.assign(t, { pct: Math.round(n), progreso: texto }); try { await guardar(t); } catch { /* se reintenta en el siguiente */ } }
function lanzaMotor(t, script, opciones) {
  return new Promise(res => { let out = '', err = '', buf = ''; const p = spawn('node', script, { ...opciones, stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', d => { const x = d.toString(); out += x; buf += x; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); const m = /^##PCT (\d+) (.*)$/.exec(l); if (m) pct(t, Number(m[1]), m[2]); const k = /^OK (\d+)\/(\d+)/.exec(l); if (k && opciones.fase === 'indexado') pct(t, 6 + Math.round(18 * Number(k[1]) / Math.max(1, Number(k[2]))), 'Indexando los vídeos de la carpeta elegida (' + k[1] + ' de ' + k[2] + ')'); } });
    p.stderr.on('data', d => { err += d.toString(); }); p.on('close', () => res({ stdout: out, stderr: err })); });
}
async function paso(t, texto, extra = {}) { Object.assign(t, { progreso: texto }, extra); console.log('[' + t.id + '] ' + texto); await guardar(t); }

const MUSICA_LOCAL = new URL('./datos/musica-crm/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
async function sincronizaMusica() {
  fs.mkdirSync(MUSICA_LOCAL, { recursive: true });
  const { data } = await st.list('musica', { limit: 200 }); const remotas = (data || []).filter(f => /\.(mp3|mp4|m4a|wav|aac)$/i.test(f.name));
  for (const f of remotas) { const dst = path.join(MUSICA_LOCAL, f.name); if (fs.existsSync(dst) && fs.statSync(dst).size === (f.metadata?.size || fs.statSync(dst).size)) continue; const u = await st.createSignedUrl('musica/' + f.name, 600); if (!u.data?.signedUrl) continue; const r = await fetch(u.data.signedUrl); if (r.ok) { fs.writeFileSync(dst, Buffer.from(await r.arrayBuffer())); try { fs.unlinkSync(dst + '.json'); } catch { /* sin análisis previo */ } } }
  for (const f of fs.readdirSync(MUSICA_LOCAL)) if (!f.endsWith('.json') && !remotas.some(r => r.name === f)) { try { fs.unlinkSync(path.join(MUSICA_LOCAL, f)); fs.unlinkSync(path.join(MUSICA_LOCAL, f + '.json')); } catch { /* ya no está */ } }
}
async function publicaIndiceMusica() {
  const idx = {}; for (const f of fs.readdirSync(MUSICA_LOCAL)) if (f.endsWith('.json')) { try { const a = JSON.parse(fs.readFileSync(path.join(MUSICA_LOCAL, f), 'utf8')); idx[f.slice(0, -5)] = { bpm: a.bpm, dur: a.dur, energia: a.energia }; } catch { /* ignorar */ } }
  await st.upload('crm-indice-musica.json', Buffer.from(JSON.stringify(idx)), { contentType: 'application/json', upsert: true, cacheControl: '0' });
}
async function publicaCarpetas() {
  const v = JSON.parse(fs.readFileSync(INDICE, 'utf8')).videos || []; const cuenta = {};
  for (const x of v) { if (x.hablando_a_camara) continue; const partes = String(x.carpeta || '').split('/').filter(Boolean); for (let i = 1; i <= partes.length; i++) { const k = partes.slice(0, i).join('/'); cuenta[k] = (cuenta[k] || 0) + 1; } if (!partes.length) cuenta[''] = (cuenta[''] || 0) + 1; }
  const lista = Object.entries(cuenta).filter(([k]) => k).map(([ruta, n]) => ({ ruta, videos: n })).sort((a, b) => a.ruta.localeCompare(b.ruta));
  await st.upload('crm-indice-carpetas.json', Buffer.from(JSON.stringify(lista)), { contentType: 'application/json', upsert: true, cacheControl: '0' });
}
const DIR_DATOS = new URL('./datos/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const INDICES_NUBE = { 'drive-redes/indice.json': 'indices/redes.json', 'drive-piloto/indice.json': 'indices/piloto.json', 'drive-seleccion/indice.json': 'indices/seleccion.json', 'drive-imagenes/indice.json': 'indices/imagenes.json', 'drive-largos/indice.json': 'indices/largos.json' };
async function subeIndices(solo) {
  for (const [loc, rem] of Object.entries(INDICES_NUBE)) { if (solo && !solo.includes(loc)) continue; const f = path.join(DIR_DATOS, loc); if (!fs.existsSync(f)) continue; const { error } = await st.upload(rem, fs.readFileSync(f), { contentType: 'application/json', upsert: true, cacheControl: '0' }); console.log(error ? 'Índice sin subir ' + rem + ': ' + error.message : 'Índice subido: ' + rem + ' (' + (fs.statSync(f).size / 1e6).toFixed(1) + ' MB)'); }
}
async function bajaIndices() {
  for (const [loc, rem] of Object.entries(INDICES_NUBE)) { try { const u = await st.createSignedUrl(rem, 120); if (!u.data?.signedUrl) continue; const r = await fetch(u.data.signedUrl); if (!r.ok) continue; const f = path.join(DIR_DATOS, loc); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); console.log('Índice bajado:', rem); } catch (e) { console.log('Índice no disponible', rem, e.message); } }
}
// Junta todos los índices (piloto local, Drive redes, vídeos sueltos) y asegura que lo elegido esté indexado.
const RAIZ_PILOTO = '5. Material audiovisual Victor', RAIZ_REDES = '4. Instagram - Tiktok - Shorts';
function cargaIndice(f, raiz, tipo) { try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return (j.videos || []).map(v => ({ ...v, ruta_abs: v.ruta_abs || (raiz + (v.carpeta ? '/' + v.carpeta : '')) })); } catch { return []; } }
async function indexaCarpetas(t, sel, existentes) {
  const base = new URL('./datos/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), dirSel = path.join(base, 'drive-seleccion'); fs.mkdirSync(dirSel, { recursive: true });
  fs.writeFileSync(path.join(dirSel, 'omitir.json'), JSON.stringify([...existentes]));
  for (const c of (sel.carpetasId || [])) { await paso(t, 'Mirando qué vídeos hay en "' + c.nombre + '"…', { pct: 5 }); await lanzaMotor(t, ['indexar-drive.mjs', c.id, dirSel, '8', '3', c.ruta], { cwd: AQUI, env: { ...process.env, MAX_NUEVOS: '150', PRIORIDAD_NORMAL: '1' }, fase: 'indexado' }); }
}
function indiceTotal(dir, sel) {
  const base = new URL('./datos/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const fPiloto = path.join(base, 'drive-piloto/indice.json');
  let todos = [...(fs.existsSync(fPiloto) ? cargaIndice(fPiloto, RAIZ_PILOTO) : cargaIndice(INDICE, RAIZ_PILOTO)), ...cargaIndice(path.join(base, 'drive-redes/indice.json'), RAIZ_REDES)];
  // los vídeos largos reindexados en denso (muchos fotogramas) sustituyen a su entrada antigua, conservando su carpeta
  { const dens = cargaIndice(path.join(base, 'drive-largos/indice.json'), ''); if (dens.length) { const por = new Map(dens.map(v => [v.drive_id, v])); todos = todos.map(v => { const d = por.get(v.drive_id); return d ? { ...d, ruta_abs: v.ruta_abs, carpeta: v.carpeta } : v; }); } }
  const ids = new Set(todos.map(v => v.drive_id).filter(Boolean)), nom = new Set(todos.map(v => v.ruta_abs + '/' + v.nombre));
  const faltan = (sel.videos || []).filter(z => !ids.has(z.id) && !nom.has((z.ruta ? z.ruta + '/' : '') + z.nombre));
  const fSel = path.join(base, 'drive-seleccion/indice.json');
  if (faltan.length) { console.log('Indexando', faltan.length, 'vídeo(s) elegido(s) que aún no estaban…'); const lanza = (ids) => { const rr = spawnSync('node', ['indexar-drive.mjs', 'ids:' + ids.join(','), path.join(base, 'drive-seleccion'), '8', '2'], { cwd: AQUI, encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, PATH: process.env.PATH + ';' + (process.env.FFMPEG_BIN || '') } }); console.log('Indexado de elegidos:', ((rr.stdout || '') + (rr.stderr || '')).split('\n').filter(l => /FIN\.|FALLO|Error/.test(l)).slice(-4).join(' | ') || ('sin salida (código ' + rr.status + ')')); };
    lanza(faltan.map(z => z.id));
    // los que no se hayan podido indexar a la primera se reintentan de uno en uno
    const hechos = () => new Set(cargaIndice(path.join(base, 'drive-seleccion/indice.json'), '').map(v => v.drive_id));
    for (const z of faltan.filter(z => !hechos().has(z.id))) { console.log('Reintentando', z.nombre); lanza([z.id]); }
    const aunFaltan = faltan.filter(z => !hechos().has(z.id)); if (aunFaltan.length) console.log('SIN INDEXAR:', aunFaltan.map(z => z.nombre).join(', '));
  }
  const sueltos = cargaIndice(fSel, '').map(v => { const z = (sel.videos || []).find(q => q.id === v.drive_id); return { ...v, ruta_abs: v.ruta_abs || (z ? z.ruta : '') }; });
  for (const v of sueltos) if (!ids.has(v.drive_id)) todos.push(v);
  const salida = path.join(dir, 'indice-total.json'); fs.writeFileSync(salida, JSON.stringify({ videos: todos })); return salida;
}
// Guarda lo necesario para volver a montar con cambios manuales: plan, palabras limpias, vídeos usados, voz limpia y un resumen de cada corte
async function subeArtefactos(t, dir) {
  const ed = path.join(dir, '_trabajo_salida', 'edicion'), A = 'artefactos/' + t.id + '/'; if (!fs.existsSync(path.join(ed, 'cortes.json'))) return;
  const mp3 = path.join(dir, 'voz_limpia.mp3'); run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(dir, '_trabajo_salida', 'voz48.wav'), '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '128k', mp3]);
  const up = async (rem, f, tipo) => { const { error } = await st.upload(A + rem, fs.readFileSync(f), { contentType: tipo, upsert: true, cacheControl: '0' }); if (error) throw new Error(rem + ': ' + error.message); };
  for (const n of ['plan', 'palabras', 'usados']) await up(n + '.json', path.join(ed, n + '.json'), 'application/json');
  if (fs.existsSync(mp3)) await up('voz.mp3', mp3, 'audio/mpeg');
  t.cortes = JSON.parse(fs.readFileSync(path.join(ed, 'cortes.json'), 'utf8')).slice(0, 400); t.artefactos = true;
}
// Busca el archivo en el Drive de escritorio del PC (no gasta la cuota de descargas de Google)
function buscaEnDriveLocal(nombre, bytes) {
  const raices = ['G:/Mi unidad', 'G:/Unidades compartidas']; const cola = raices.filter(r => fs.existsSync(r));
  while (cola.length) { const d = cola.shift(); let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) { const p = d + '/' + e.name; if (e.isDirectory()) cola.push(p); else if (e.name === nombre) { try { if (!bytes || fs.statSync(p).size === bytes) return p; } catch { /* sigue */ } } } }
  return null;
}
// Entrevista larga -> varios clips: cada momento elegido por la IA se convierte en un trabajo normal de "bruto" y se monta con el formato elegido
async function procesaClips(t, entrada, dir) {
  const clips = await import('./clips.mjs');
  await paso(t, 'Transcribiendo la entrevista…', { pct: 8 });
  const { palabras, dur } = await clips.transcribeLargo(entrada, path.join(dir, '_clips'), (f) => { t.pct = 8 + Math.round(f * 20); });
  if (palabras.length < 30) throw new Error('No se oye suficiente voz en ese vídeo para sacar clips. Elige la entrevista donde se os oye hablar.');
  await paso(t, 'Buscando los mejores momentos…', { pct: 30 });
  const sel = await clips.eligeClips(palabras, dur, { n: t.num_clips || 0, min: t.dur_min || 25, max: t.dur_max || 70, notas: t.indicaciones || '' });
  if (!sel.length) throw new Error('No he encontrado momentos que funcionen solos como clip. Prueba con indicaciones más concretas.');
  sel.sort((x, y) => (y.score ?? 0) - (x.score ?? 0)); // los de mayor puntuación primero
  const hijos = [];
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i], id = crypto.randomUUID().slice(0, 8), f = path.join(dir, 'clip_' + id + '.mp4');
    await paso(t, 'Recortando el clip ' + (i + 1) + ' de ' + sel.length + '…', { pct: 34 + Math.round(10 * i / sel.length) });
    if (!clips.recorta(entrada, c.tramos, f)) { console.log('Clip', i + 1, 'sin recortar'); continue; }
    await drive.cacheSube('entradas/' + id + '.mp4', f); fs.rmSync(f, { force: true });
    const h = { ...t, id, tipo: 'bruto', archivo: 'entradas/' + id + '.mp4', base: null, nombre_archivo: c.titulo, padre: t.id, clip: { ini: Math.round(c.ini), fin: Math.round(c.fin), titulo: c.titulo, pregunta: c.pregunta || '', gancho: c.gancho, score: c.score ?? null, sub: c.sub || null, motivo: c.motivo || '' }, estado: 'pendiente', progreso: 'En cola', pct: 0, creado: new Date().toISOString(), version: 1, origen: null, resultado: null, resultado_movil: null, error: null, plan: null, clips: undefined, num_clips: undefined, dur_min: undefined, dur_max: undefined, terminado: undefined, empezado: undefined };
    await guardar(h); hijos.push(h);
  }
  if (!hijos.length) throw new Error('No he podido recortar ningún clip de la entrevista');
  t.clips = hijos.map(h => h.id);
  // en el servidor de la nube se montan 2 clips a la vez (tiene 8 procesadores); en el PC, de uno en uno
  const cola = hijos.map((_, i) => i); let hechos = 0;
  await Promise.all(Array.from({ length: process.env.JOB_ID ? Math.min(2, hijos.length) : 1 }, async () => {
    while (cola.length) {
      const i = cola.shift();
      try { await procesa(hijos[i]); } catch (e) { console.log('[' + hijos[i].id + '] ERROR', e.message); await paso(hijos[i], 'Error', { estado: 'error', error: String(e.message).slice(0, 400) }); }
      hechos++; await paso(t, 'Montados ' + hechos + ' de ' + hijos.length + ' clips…', { pct: 46 + Math.round(52 * hechos / hijos.length) });
    }
  }));
  await paso(t, hijos.length + ' clips creados (aparecen abajo, cada uno con su vídeo)', { pct: 100, estado: 'listo', terminado: new Date().toISOString(), error: null });
}
async function procesa(t) {
  const dir = path.join(BASE, t.id); fs.mkdirSync(dir, { recursive: true });
  await paso(t, 'Descargando el archivo…', { estado: 'procesando', empezado: new Date().toISOString(), pct: 2 });
  let entrada, indiceEdicion = null, seleccionEdicion = null;
  if (t.tipo === 'edicion') {
    const wk = path.join(dir, '_trabajo_salida'); fs.mkdirSync(wk, { recursive: true }); await paso(t, 'Recuperando el montaje anterior…', { pct: 4 });
    const baja = async (rem, dst) => { const u = await st.createSignedUrl(rem, 300); if (!u.data?.signedUrl) throw new Error('Falta ' + rem + ' del montaje anterior (hay que volver a montar el vídeo original)'); const rr = await fetch(u.data.signedUrl); if (!rr.ok) throw new Error('No se pudo bajar ' + rem); fs.writeFileSync(dst, Buffer.from(await rr.arrayBuffer())); };
    const A = 'artefactos/' + t.origen + '/'; entrada = path.join(dir, 'voz.mp3');
    await baja(A + 'plan.json', path.join(wk, 'plan.json')); await baja(A + 'palabras.json', path.join(wk, 'palabras.json')); await baja(A + 'usados.json', path.join(dir, 'usados.json')); await baja(A + 'voz.mp3', entrada);
    const plan = JSON.parse(fs.readFileSync(path.join(wk, 'plan.json'), 'utf8')); let usados = JSON.parse(fs.readFileSync(path.join(dir, 'usados.json'), 'utf8')).videos || []; const extras = [], imagenes = [];
    for (const ch of (t.cambios || [])) {
      const c = plan.cortes.find(x => x.de === ch.de); if (!c) continue;
      if (ch.video?.id) {
        if (ch.video.tipo === 'imagen') { imagenes.push({ id: ch.video.id, nombre: ch.video.nombre || 'imagen', ruta: '' }); c.video = 'img' + ch.video.id.slice(0, 9); c.desde = 0; }
        else { const meta = await drive.meta(ch.video.id); const dur = Number(meta.videoMediaMetadata?.durationMillis || 0) / 1000; const e = { id: 'm' + ch.video.id.slice(0, 11), drive_id: ch.video.id, ruta: 'drive:' + ch.video.id, nombre: meta.name, carpeta: '', bytes: Number(meta.size || 0), duracion: dur || 60, ancho: meta.videoMediaMetadata?.width, alto: meta.videoMediaMetadata?.height, calidad: 'media', tipo: 'b_roll', resumen: 'Elegido a mano', etiquetas: [], planos: [] }; if (!extras.some(x => x.id === e.id)) extras.push(e); c.video = e.id; c.desde = Math.max(0, Math.min(Number(ch.desde) || 0, Math.max(0, dur - 1))); }
      } else if (ch.desde !== undefined) c.desde = Math.max(0, Number(ch.desde) || 0);
    }
    if (Array.isArray(t.cortes_nuevos) && t.cortes_nuevos.length) {
      const pal = JSON.parse(fs.readFileSync(path.join(wk, 'palabras.json'), 'utf8')).transcription, tiempos = pal.map(x => x.offsets.from / 1000);
      const idxDe = (t0) => { const k = tiempos.findIndex(v => v >= t0 - 0.05); return k < 0 ? tiempos.length - 1 : k; };
      const nuevos = []; let ultDe = -1;
      for (const c of t.cortes_nuevos.slice().sort((a, b) => a.t0 - b.t0)) {
        let video = c.video_int, desde = Math.max(0, Number(c.desde) || 0);
        if (c.video?.id) {
          if (c.video.tipo === 'imagen') { imagenes.push({ id: c.video.id, nombre: c.video.nombre || 'imagen', ruta: '' }); video = 'img' + c.video.id.slice(0, 9); desde = 0; }
          else { const meta = await drive.meta(c.video.id); const dur = Number(meta.videoMediaMetadata?.durationMillis || 0) / 1000; const e = { id: 'm' + c.video.id.slice(0, 11), drive_id: c.video.id, ruta: 'drive:' + c.video.id, nombre: meta.name, carpeta: '', bytes: Number(meta.size || 0), duracion: dur || 60, ancho: meta.videoMediaMetadata?.width, alto: meta.videoMediaMetadata?.height, calidad: 'media', tipo: 'b_roll', resumen: 'Elegido a mano', etiquetas: [], planos: [] }; if (!extras.some(x => x.id === e.id)) extras.push(e); video = e.id; desde = Math.max(0, Math.min(desde, Math.max(0, dur - 1))); }
        }
        if (!video) continue;
        let de = idxDe(c.t0); if (de <= ultDe) de = ultDe + 1; ultDe = de;
        nuevos.push({ de, video, desde, t0: nuevos.length === 0 ? 0 : Number(c.t0) });
      }
      if (nuevos.length) plan.cortes = nuevos;
    }
    for (const v of usados) if (v.es_imagen && v.drive_id_img && !imagenes.some(i => i.id === v.drive_id_img)) imagenes.push({ id: v.drive_id_img, nombre: v.nombre, ruta: '' });
    usados = usados.filter(v => !v.es_imagen);
    fs.writeFileSync(path.join(wk, 'plan.json'), JSON.stringify(plan)); indiceEdicion = path.join(dir, 'indice-total.json'); fs.writeFileSync(indiceEdicion, JSON.stringify({ videos: [...usados, ...extras] }));
    seleccionEdicion = { carpetas: [], videos: [], imagenes, carpetasId: [] };
  } else if (t.base) {
    const meta = await drive.meta(t.base.id); const limiteGB = t.tipo === 'clips' ? (process.env.JOB_ID ? 14e9 : 40e9) : 6e9; if (Number(meta.size) > limiteGB) throw new Error('El archivo de Drive pesa ' + (Number(meta.size) / 1e9).toFixed(1) + ' GB; usa uno de menos de 6 GB (o un trozo)');
    entrada = path.join(dir, 'base' + (path.extname(meta.name) || '.mp4')); await paso(t, 'Bajando el archivo de Drive (' + Math.round(Number(meta.size) / 1e6) + ' MB)…');
    const claveCache = 'base/' + t.base.id + '_' + meta.size + (path.extname(meta.name) || '.mp4'); let desdeCache = false;
    try { desdeCache = await drive.cacheBaja(claveCache, entrada); } catch { desdeCache = false; }
    const { url, cabeceras } = await drive.urlDescarga(t.base.id); const rs = desdeCache ? { ok: true, cache: true } : await fetch(url, { headers: cabeceras });
    if (desdeCache) await paso(t, 'Vídeo base recuperado de la copia guardada');
    else if (rs.ok) await pipeline(Readable.fromWeb(rs.body), fs.createWriteStream(entrada));
    else {
      try { await drive.bajaEnTrozos(t.base.id, entrada); }
      catch (e) {
        const loc = buscaEnDriveLocal(meta.name, Number(meta.size)); if (loc) { await paso(t, 'Copiando el vídeo desde Drive de escritorio…'); fs.copyFileSync(loc, entrada); } else {
        if (process.env.JOB_ID && rs.status === 403) { const er = new Error('DRIVE_BLOQUEADO'); er.bloqueado = true; throw er; }
        if (rs.status === 403) throw new Error('Google Drive ha bloqueado temporalmente la descarga de "' + meta.name + '" (límite de descargas de ese archivo, se libera en unas 24 h). Prueba con otro vídeo, o súbelo desde el dispositivo en lugar de elegirlo de Drive.');
        throw new Error('No se pudo bajar el vídeo base de Drive (' + rs.status + ')'); }
      }
    }
    if (!desdeCache && Number(meta.size) < 3e9) { try { await drive.cacheSube(claveCache, entrada); console.log('Copia del vídeo base guardada'); } catch (e) { console.log('Sin guardar copia del vídeo base:', e.message); } }
  } else {
    const ext = path.extname(t.archivo) || '.mp4'; entrada = path.join(dir, 'entrada' + ext);
    // los archivos grandes se suben a Google Cloud Storage; los pequeños (música, etc.) a Supabase
    if (!(await drive.cacheBaja(t.archivo, entrada).catch(() => false))) {
      const u = await st.createSignedUrl(t.archivo, 600); if (!u.data?.signedUrl) throw new Error('No encuentro el archivo subido');
      const rs = await fetch(u.data.signedUrl); if (!rs.ok) throw new Error('No se pudo descargar el archivo (' + rs.status + ')');
      await pipeline(Readable.fromWeb(rs.body), fs.createWriteStream(entrada));
    }
  }
  fs.writeFileSync(path.join(dir, 'receta.json'), JSON.stringify(t.receta || {}));
  const notas = [t.notas_formato, t.indicaciones].filter(Boolean).join('\n');
  const salida = path.join(dir, 'salida.mp4');
  await paso(t, t.tipo === 'voz' ? 'La IA está eligiendo escenas y montando…' : t.tipo === 'base' ? 'Montando sobre el vídeo base y superponiendo escenas…' : 'Quitando pausas y poniendo subtítulos…');
  try { await sincronizaMusica(); } catch (e) { console.log('Música sin sincronizar:', e.message); }
  if (t.tipo === 'clips') { await procesaClips(t, entrada, dir); return; }
  if (t.edicion_texto && t.tipo !== 'edicion') {
    const wk = path.join(dir, '_trabajo_salida'); fs.mkdirSync(wk, { recursive: true });
    try { const u = await st.createSignedUrl('artefactos/' + t.origen + '/palabras_bruto.json', 300); if (u.data?.signedUrl) fs.writeFileSync(path.join(wk, 'palabras.json'), Buffer.from(await (await fetch(u.data.signedUrl)).arrayBuffer())); } catch (e) { console.log('Sin la transcripción anterior (se volverá a transcribir):', e.message); }
    fs.writeFileSync(path.join(dir, 'fuera.json'), JSON.stringify(t.edicion_texto.fuera || []));
  }
  let indiceUsar = INDICE, seleccion = {};
  const rec0 = Array.isArray(t.recursos) ? t.recursos : [];
  if (t.tipo === 'edicion') { indiceUsar = indiceEdicion; seleccion = seleccionEdicion; }
  else if (t.tipo === 'voz' || t.tipo === 'base' || rec0.length) { const rec = rec0;
    const idsExist = new Set(); for (const f of ['drive-redes/indice.json', 'drive-seleccion/indice.json']) { try { for (const v of JSON.parse(fs.readFileSync(new URL('./datos/' + f, import.meta.url), 'utf8')).videos) if (v.drive_id) idsExist.add(v.drive_id); } catch { /* sin índice */ } }
    try { await indexaCarpetas(t, { carpetasId: rec.filter(r => r.tipo === 'carpeta').map(r => ({ id: r.id, nombre: r.nombre, ruta: r.ruta })) }, idsExist); } catch (e) { console.log('Carpetas sin indexar del todo:', e.message); } seleccion = { carpetas: rec.filter(r => r.tipo === 'carpeta').map(r => r.ruta).filter(Boolean), videos: rec.filter(r => r.tipo === 'video').map(r => ({ id: r.id, nombre: r.nombre, ruta: r.ruta })), imagenes: rec.filter(r => r.tipo === 'imagen').map(r => ({ id: r.id, nombre: r.nombre, ruta: r.ruta })), carpetasId: rec.filter(r => r.tipo === 'carpeta').map(r => ({ id: r.id, nombre: r.nombre, ruta: r.ruta })) }; try { indiceUsar = indiceTotal(dir, seleccion); } catch (e) { console.log('Índice total no disponible:', e.message); } }
  const conInserciones = t.tipo === 'base' || rec0.length > 0;
  const script = (t.tipo === 'voz' || t.tipo === 'edicion') ? ['montar.mjs', entrada, indiceUsar, salida, notas] : ['bruto.mjs', entrada, salida, notas];
  const r = await lanzaMotor(t, script, { cwd: AQUI, env: { ...process.env, ...(t.tipo === 'edicion' ? { REUSE: '1', SIN_LIMPIEZA: '1', SIN_REVISION: '1', EDICION: '1' } : {}), ...(t.edicion_texto && t.tipo !== 'edicion' ? { FUERA_JSON: path.join(dir, 'fuera.json') } : {}), TITULO_PANTALLA: t.clip?.titulo || '', PREGUNTA_PANTALLA: t.clip?.pregunta || '', RECETA_JSON: path.join(dir, 'receta.json'), MUSICA_DIR: MUSICA_LOCAL, RECURSOS_SEL: JSON.stringify(seleccion), INDICE_JSON: indiceUsar, INSERCIONES: conInserciones ? '1' : '0', BASE_DRIVE_ID: t.base?.id || '', MUSICA_ELEGIDA: (t.tipo === 'edicion' && t.musica_usada) ? t.musica_usada : (t.musica === 'ninguna' ? 'ninguna' : (t.musica || 'auto')), PATH: process.env.PATH + ';' + (process.env.FFMPEG_BIN || '') } });
  console.log((r.stdout || '').split('\n').slice(-6).join('\n'));
  { const mm = /Música: (.+?) \(\d/.exec(r.stdout || ''); if (mm) t.musica_usada = mm[1]; }
  if (!fs.existsSync(salida)) { const txt = ((r.stdout || '') + (r.stderr || '')); const fallo = /FALLO:[^\r\n]*/.exec(txt)?.[0]; throw new Error(fallo ? 'El montaje se ha parado. ' + fallo : 'El montaje no ha producido vídeo. ' + txt.slice(-300)); }
  try { await publicaIndiceMusica(); } catch { /* el índice se publica la próxima vez */ }
  await paso(t, 'Ajustando el tamaño del archivo final…', { pct: 93 });
  const final = path.join(dir, 'final.mp4'), movil = path.join(dir, 'movil.mp4');
  // El archivo final debe caber en el límite de Supabase (~50 MB por archivo): se ajusta la tasa de bits a la duración
  const durF = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', salida]).stdout) || 60;
  let kbps = Math.max(600, Math.min(9000, Math.floor((46 * 8 * 1024 * 1024 / durF - 160000) / 1000)));
  for (let intento = 0; intento < 3; intento++) {
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', salida, '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact', '-metadata:s:v:0', 'encoder=', '-metadata:s:a:0', 'encoder=', '-c:v', 'libx264', '-bsf:v', 'filter_units=remove_types=6', '-crf', '22', '-maxrate', kbps + 'k', '-bufsize', (2 * kbps) + 'k', '-preset', 'fast', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', final]);
    if (fs.existsSync(final) && fs.statSync(final).size <= 49 * 1024 * 1024) break; kbps = Math.floor(kbps * 0.8);
  }
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', salida, '-vf', 'scale=720:1280', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact', '-metadata:s:v:0', 'encoder=', '-metadata:s:a:0', 'encoder=', '-c:v', 'libx264', '-bsf:v', 'filter_units=remove_types=6', '-crf', '23', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', movil]);
  await paso(t, 'Subiendo el resultado…', { pct: 97 });
  const sube = async (ruta, f) => { try { await reintenta(() => st.upload(ruta, fs.readFileSync(f), { contentType: 'video/mp4', upsert: true }), 6); } catch (e) { throw new Error('No se pudo subir ' + ruta + ' tras varios intentos: ' + e.message); } };
  await sube('salidas/' + t.id + '.mp4', final); await sube('salidas/' + t.id + '_movil.mp4', movil);
  let plan = null; const pf = path.join(dir, '_trabajo_salida', 'plan.json'); if (fs.existsSync(pf)) { try { const p = JSON.parse(fs.readFileSync(pf, 'utf8')); plan = { kicker: p.kicker, titulo: p.titulo, cortes: p.cortes?.length }; } catch { /* sin plan */ } }
  if (t.tipo === 'voz' || t.tipo === 'edicion') { try { await subeArtefactos(t, dir); } catch (e) { console.log('Sin guardar los datos para editar cortes:', e.message); } }
  if (t.tipo === 'bruto') { try {
    const wk = path.join(dir, '_trabajo_salida'), et = JSON.parse(fs.readFileSync(path.join(wk, 'edicion_texto.json'), 'utf8')), fu = new Set(et.fuera);
    if (et.palabras.length <= 1200) t.transcripcion = et.palabras.map((w, i) => [w[0], w[1], w[2], fu.has(i) ? 1 : 0]);
    const { error } = await st.upload('artefactos/' + t.id + '/palabras_bruto.json', fs.readFileSync(path.join(wk, 'palabras.json')), { contentType: 'application/json', upsert: true, cacheControl: '0' }); if (error) throw new Error(error.message);
  } catch (e) { console.log('Sin guardar el texto editable:', e.message); delete t.transcripcion; } }
  let faltan = []; try { faltan = JSON.parse(fs.readFileSync(path.join(dir, '_trabajo_salida', 'edicion', 'faltan.json'), 'utf8')); } catch { /* sin aviso */ }
  await paso(t, 'Listo', { faltan, pct: 100, estado: 'listo', resultado: 'salidas/' + t.id + '.mp4', resultado_movil: 'salidas/' + t.id + '_movil.mp4', plan, terminado: new Date().toISOString(), error: null });
}

// Modo servidor en la nube: se ejecuta UN trabajo (JOB_ID) y se apaga
if (process.env.JOB_ID) {
  const id = process.env.JOB_ID; console.log('Servidor de vídeo: trabajo', id);
  await bajaIndices(); const t = await leer(id);
  if (!t) { console.log('No existe el trabajo', id); process.exit(1); }
  if (t.estado === 'listo' || t.estado === 'procesando' && Date.now() - new Date(t.empezado || 0) < 3 * 3600000) { console.log('Trabajo ya hecho o en marcha por otro ejecutor'); process.exit(0); }
  t.ejecutor = 'nube';
  try { await procesa(t); } catch (e) { console.log('[' + id + '] ERROR', e.message); if (e.bloqueado) { t.ejecutor = 'pc'; await paso(t, 'Drive limita ese archivo: lo hará el ordenador de la oficina', { estado: 'pendiente', pct: 2 }); process.exit(0); } await paso(t, 'Error', { estado: 'error', error: String(e.message).slice(0, 400) }); }
  try { await subeIndices(['drive-seleccion/indice.json', 'drive-imagenes/indice.json']); } catch { /* el índice de sueltos se rehará la próxima vez */ }
  process.exit(0);
}
console.log('Trabajador de vídeo en marcha. Índice:', INDICE);
try { await subeIndices(); } catch (e) { console.log('Índices sin subir:', e.message); }
try { await publicaCarpetas(); } catch (e) { console.log('Carpetas sin publicar:', e.message); }
// Cada hora indexa los vídeos nuevos que se hayan subido a Drive (solo procesa los que faltan; si ya hay un indexado en marcha, espera)
const ID_REDES = '1pujuBkWSoeFTDg9vc_jwD--9v0IWB8vE';
let sync = null, denso = null;
function lanzaDenso() {
  const f = path.join(DIR_DATOS, 'ids_largos.txt'); if (denso || !fs.existsSync(f)) return;
  denso = spawn('node', ['indexar-drive.mjs', 'ids:' + fs.readFileSync(f, 'utf8').trim(), path.join(DIR_DATOS, 'drive-largos'), '36', '2'], { cwd: AQUI, stdio: 'ignore', env: { ...process.env, DENSO: '1' } });
  denso.on('close', () => { denso = null; subeIndices(['drive-largos/indice.json']).catch(() => {}); });
}
function sincronizaDrive() {
  const dirRedes = new URL('./datos/drive-redes/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  try { if (sync || Date.now() - fs.statSync(path.join(dirRedes, 'indice.json')).mtimeMs < 5 * 60000) return; } catch { /* sin índice aún */ }
  console.log('Buscando vídeos nuevos en Drive…');
  sync = spawn('node', ['indexar-drive.mjs', ID_REDES, dirRedes, '8', '3'], { cwd: AQUI, stdio: 'ignore', env: { ...process.env, PATH: process.env.PATH + ';' + (process.env.FFMPEG_BIN || '') } });
  sync.on('close', () => { sync = null; subeIndices(['drive-redes/indice.json']).catch(() => {}); lanzaDenso(); });
}
setInterval(sincronizaDrive, 60 * 60 * 1000);
for (;;) {
  try {
    const { data } = await st.list('trabajos', { limit: 60, sortBy: { column: 'created_at', order: 'asc' } });
    for (const f of (data || []).filter(x => /\.json$/.test(x.name))) {
      const t = await leer(f.name.replace(/\.json$/, '')); if (!t) continue;
      // los que se quedaron "procesando" por un corte se reintentan pasados 20 min
      if (t.estado === 'procesando' && Date.now() - new Date(t.empezado || 0) > 20 * 60000) t.estado = 'pendiente';
      if (t.estado !== 'pendiente') continue;
      if (t.ejecutor === 'nube' && Date.now() - new Date(t.creado || 0) < 45 * 60000) continue; // lo está haciendo el servidor de la nube
      try { await procesa(t); } catch (e) { console.log('[' + t.id + '] ERROR', e.message); await paso(t, 'Error', { estado: 'error', error: String(e.message).slice(0, 400) }); }
    }
  } catch (e) { console.log('Vigilando… (', e.message, ')'); }
  await new Promise(r => setTimeout(r, 10000));
}
