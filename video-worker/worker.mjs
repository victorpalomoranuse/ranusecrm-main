// Trabajador de vídeo: vigila la cola del CRM ("Estudio de vídeo") y edita lo que llegue.
// Uso: node worker.mjs "<indice.json>"      (se deja abierto; Ctrl+C para parar)
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { spawnSync } from 'child_process';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const { createClient } = require('@supabase/supabase-js');
const INDICE = path.resolve(process.argv[2] || new URL('./datos/piloto/indice.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ENV = Object.fromEntries(fs.readFileSync(new URL('../server/.env', import.meta.url), 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]));
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const st = sb.storage.from('estudio-video');
const BASE = new URL('./datos/trabajos/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const AQUI = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const run = (c, a, o = {}) => spawnSync(c, a, { encoding: 'utf8', maxBuffer: 1 << 28, ...o });

async function leer(id) {
  const f = await st.createSignedUrl('trabajos/' + id + '.json', 30); if (!f.data?.signedUrl) return null;
  const r = await fetch(f.data.signedUrl + '&cb=' + Date.now(), { cache: 'no-store' }); return r.ok ? r.json() : null;
}
const guardar = (t) => st.upload('trabajos/' + t.id + '.json', Buffer.from(JSON.stringify(t)), { contentType: 'application/json', upsert: true, cacheControl: '0' });
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
async function procesa(t) {
  const dir = path.join(BASE, t.id); fs.mkdirSync(dir, { recursive: true });
  await paso(t, 'Descargando el archivo…', { estado: 'procesando', empezado: new Date().toISOString() });
  const u = await st.createSignedUrl(t.archivo, 600); if (!u.data?.signedUrl) throw new Error('No encuentro el archivo subido');
  const ext = path.extname(t.archivo) || '.mp4', entrada = path.join(dir, 'entrada' + ext);
  const rs = await fetch(u.data.signedUrl); if (!rs.ok) throw new Error('No se pudo descargar el archivo (' + rs.status + ')');
  fs.writeFileSync(entrada, Buffer.from(await rs.arrayBuffer()));
  fs.writeFileSync(path.join(dir, 'receta.json'), JSON.stringify(t.receta || {}));
  const notas = [t.notas_formato, t.indicaciones].filter(Boolean).join('\n');
  const salida = path.join(dir, 'salida.mp4');
  await paso(t, t.tipo === 'voz' ? 'La IA está eligiendo escenas y montando…' : 'Quitando pausas y poniendo subtítulos…');
  try { await sincronizaMusica(); } catch (e) { console.log('Música sin sincronizar:', e.message); }
  const script = t.tipo === 'voz' ? ['montar.mjs', entrada, INDICE, salida, notas] : ['bruto.mjs', entrada, salida, notas];
  const r = run('node', script, { cwd: AQUI, env: { ...process.env, RECETA_JSON: path.join(dir, 'receta.json'), MUSICA_DIR: MUSICA_LOCAL, MUSICA_ELEGIDA: t.receta?.musica === false ? 'ninguna' : (t.musica || 'auto'), PATH: process.env.PATH + ';' + (process.env.FFMPEG_BIN || '') } });
  console.log((r.stdout || '').split('\n').slice(-6).join('\n'));
  if (!fs.existsSync(salida)) throw new Error('El montaje no ha producido vídeo. ' + ((r.stdout || '') + (r.stderr || '')).slice(-300));
  try { await publicaIndiceMusica(); } catch { /* el índice se publica la próxima vez */ }
  await paso(t, 'Preparando el archivo final…');
  const final = path.join(dir, 'final.mp4'), movil = path.join(dir, 'movil.mp4');
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', salida, '-c:v', 'libx264', '-crf', '24', '-preset', 'fast', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', final]);
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', salida, '-vf', 'scale=540:960', '-c:v', 'libx264', '-crf', '28', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-movflags', '+faststart', movil]);
  await paso(t, 'Subiendo el resultado…');
  const sube = async (ruta, f) => { const { error } = await st.upload(ruta, fs.readFileSync(f), { contentType: 'video/mp4', upsert: true }); if (error) throw new Error('No se pudo subir ' + ruta + ': ' + error.message); };
  await sube('salidas/' + t.id + '.mp4', final); await sube('salidas/' + t.id + '_movil.mp4', movil);
  let plan = null; const pf = path.join(dir, '_trabajo_salida', 'plan.json'); if (fs.existsSync(pf)) { try { const p = JSON.parse(fs.readFileSync(pf, 'utf8')); plan = { kicker: p.kicker, titulo: p.titulo, cortes: p.cortes?.length }; } catch { /* sin plan */ } }
  await paso(t, 'Listo', { estado: 'listo', resultado: 'salidas/' + t.id + '.mp4', resultado_movil: 'salidas/' + t.id + '_movil.mp4', plan, terminado: new Date().toISOString(), error: null });
}

console.log('Trabajador de vídeo en marcha. Índice:', INDICE);
for (;;) {
  try {
    const { data } = await st.list('trabajos', { limit: 60, sortBy: { column: 'created_at', order: 'asc' } });
    for (const f of (data || []).filter(x => /\.json$/.test(x.name))) {
      const t = await leer(f.name.replace(/\.json$/, '')); if (!t) continue;
      // los que se quedaron "procesando" por un corte se reintentan pasados 20 min
      if (t.estado === 'procesando' && Date.now() - new Date(t.empezado || 0) > 20 * 60000) t.estado = 'pendiente';
      if (t.estado !== 'pendiente') continue;
      try { await procesa(t); } catch (e) { console.log('[' + t.id + '] ERROR', e.message); await paso(t, 'Error', { estado: 'error', error: String(e.message).slice(0, 400) }); }
    }
  } catch (e) { console.log('Vigilando… (', e.message, ')'); }
  await new Promise(r => setTimeout(r, 10000));
}
