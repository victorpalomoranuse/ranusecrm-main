// Termina un trabajo cuyo montaje ya está hecho (salida.mp4) pero falló al preparar/subir el resultado.
import fs from 'fs'; import path from 'path'; import { createRequire } from 'module'; import { spawnSync } from 'child_process';
const FF = 'C:/Users/cashc/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin'; process.env.PATH = FF + ';' + process.env.PATH;
const require = createRequire(new URL('../server/package.json', import.meta.url)); const { createClient } = require('@supabase/supabase-js');
const E = Object.fromEntries(fs.readFileSync(new URL('../server/.env', import.meta.url), 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]));
const st = createClient(E.SUPABASE_URL, E.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } }).storage.from('estudio-video');
const id = process.argv[2], dir = path.join(new URL('./datos/trabajos/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), id), salida = path.join(dir, 'salida.mp4');
const run = (c, a) => spawnSync(c, a, { encoding: 'utf8', maxBuffer: 1 << 28 });
const u = await st.createSignedUrl('trabajos/' + id + '.json', 30); const t = await (await fetch(u.data.signedUrl + '&cb=' + Date.now())).json();
const dur = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', salida]).stdout) || 60, final = path.join(dir, 'final.mp4'), movil = path.join(dir, 'movil.mp4');
let kbps = Math.max(600, Math.min(9000, Math.floor((46 * 8 * 1024 * 1024 / dur - 160000) / 1000)));
for (let i = 0; i < 3; i++) { run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', salida, '-map_metadata', '-1', '-fflags', '+bitexact', '-metadata:s:v:0', 'encoder=', '-metadata:s:a:0', 'encoder=', '-c:v', 'libx264', '-bsf:v', 'filter_units=remove_types=6', '-crf', '22', '-maxrate', kbps + 'k', '-bufsize', 2 * kbps + 'k', '-preset', 'fast', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', final]); const mb = fs.statSync(final).size / 1048576; console.log('intento', i + 1, kbps + ' kbps →', mb.toFixed(1), 'MB'); if (mb <= 49) break; kbps = Math.floor(kbps * 0.8); }
run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', salida, '-vf', 'scale=540:960', '-map_metadata', '-1', '-c:v', 'libx264', '-bsf:v', 'filter_units=remove_types=6', '-crf', '28', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-movflags', '+faststart', movil]);
const sube = async (r, f) => { const { error } = await st.upload(r, fs.readFileSync(f), { contentType: 'video/mp4', upsert: true }); if (error) throw new Error(r + ': ' + error.message); };
await sube('salidas/' + id + '.mp4', final); await sube('salidas/' + id + '_movil.mp4', movil);
let plan = null; try { const p = JSON.parse(fs.readFileSync(path.join(dir, '_trabajo_salida', 'plan.json'), 'utf8')); plan = { kicker: p.kicker, titulo: p.titulo, cortes: p.cortes?.length }; } catch { /* sin plan */ }
Object.assign(t, { estado: 'listo', progreso: 'Listo', resultado: 'salidas/' + id + '.mp4', resultado_movil: 'salidas/' + id + '_movil.mp4', plan, terminado: new Date().toISOString(), error: null });
console.log((await st.upload('trabajos/' + id + '.json', Buffer.from(JSON.stringify(t)), { contentType: 'application/json', upsert: true, cacheControl: '0' })).error?.message || 'LISTO ' + id);
