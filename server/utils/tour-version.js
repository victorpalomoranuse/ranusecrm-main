import crypto from 'crypto';
import { supabase } from '../config/supabase.js';

// Versiones fijas del tour: al «generar» se congela una copia del modelo, la escena, el catálogo y las panorámicas (que se copian a su propia carpeta).
// El enlace de una versión no cambia aunque después se edite el modelo o se borren las paradas del plano; solo desaparece si se borra la versión.
const BUCKET = 'project-documents';
const ruta = (id, tid, ext) => 'tours3d/' + id + '/' + tid + ext;
const publica = (p) => supabase.storage.from(BUCKET).getPublicUrl(p).data.publicUrl;

async function subeJson(p, obj) {
  const { error } = await supabase.storage.from(BUCKET).upload(p, Buffer.from(JSON.stringify(obj)), { contentType: 'application/json', upsert: true, cacheControl: '0' });
  if (error) throw error;
}
async function leeJson(p) {
  const { data, error } = await supabase.storage.from(BUCKET).download(p);
  if (error || !data) return null;
  try { return JSON.parse(Buffer.from(await data.arrayBuffer()).toString('utf8')); } catch { return null; }
}
const rutaDeUrl = (u) => { const m = /\/storage\/v1\/object\/public\/project-documents\/(.+?)(\?|$)/.exec(String(u || '')); return m ? decodeURIComponent(m[1]) : null; };

async function copiaImagen(url, id, tid, nombre) {
  const src = rutaDeUrl(url); if (!src) return url;
  const dst = 'tours3d/' + id + '/' + tid + '/' + nombre;
  const { error } = await supabase.storage.from(BUCKET).copy(src, dst);
  if (error) { console.error('tour-version copia:', error.message); return url; }
  return publica(dst);
}

export async function crearVersion(id, nombre, { paradas, plano, catalogo, titulo }) {
  const tid = crypto.randomBytes(9).toString('base64url').replace(/[-_]/g, 'x').slice(0, 12);
  const ps = [];
  for (let i = 0; i < paradas.length; i++) {
    const p = paradas[i];
    ps.push({ ...p, url: await copiaImagen(p.url, id, tid, 'p' + i + '.jpg'), thumb: p.thumb ? await copiaImagen(p.thumb, id, tid, 'p' + i + '-t.jpg') : p.thumb });
  }
  const creado = new Date().toISOString();
  const snap = { v: 1, tid, nombre, creado, titulo, paradas: ps, plano: { ...plano, updated: Date.now() }, catalogo };
  await subeJson(ruta(id, tid, '.json'), snap);
  const meta = { tid, nombre, creado, paradas: ps.length, libre: !!(plano?.modelo3d) };
  await subeJson(ruta(id, tid, '.meta.json'), meta);
  return meta;
}

export async function leerVersion(id, tid) {
  if (!/^[A-Za-z0-9]{6,24}$/.test(String(tid || '')) || !/^[\w-]{1,80}$/.test(String(id || ''))) return null;
  return leeJson(ruta(id, tid, '.json'));
}

export async function listarVersiones(id) {
  const { data, error } = await supabase.storage.from(BUCKET).list('tours3d/' + id, { limit: 200 });
  if (error || !data) return [];
  const metas = data.filter(f => f.name.endsWith('.meta.json'));
  const out = [];
  for (const f of metas) { const m = await leeJson('tours3d/' + id + '/' + f.name); if (m) out.push(m); }
  return out.sort((a, b) => String(b.creado).localeCompare(String(a.creado)));
}

export async function borrarVersion(id, tid) {
  if (!/^[A-Za-z0-9]{6,24}$/.test(String(tid || ''))) return;
  const base = 'tours3d/' + id + '/';
  const { data } = await supabase.storage.from(BUCKET).list(base + tid, { limit: 200 });
  const rutas = [base + tid + '.json', base + tid + '.meta.json', ...(data || []).map(f => base + tid + '/' + f.name)];
  await supabase.storage.from(BUCKET).remove(rutas).catch(() => {});
}
