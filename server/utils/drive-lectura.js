// Lectura de Google Drive (solo lectura) con una cuenta de servicio. La clave vive en una variable de entorno (DRIVE_KEY_JSON)
// o en el bucket privado "estudio-video" (secretos/drive.json), nunca en el código ni en el navegador.
import crypto from 'crypto';
import { supabase } from '../config/supabase.js';

let cred = null, token = null, caduca = 0; const cache = new Map();
const b64 = (x) => Buffer.from(x).toString('base64url');

async function clave() {
  if (cred) return cred;
  if (process.env.DRIVE_KEY_JSON) cred = JSON.parse(process.env.DRIVE_KEY_JSON);
  else { const { data, error } = await supabase.storage.from('estudio-video').download('secretos/drive.json'); if (error || !data) throw new Error('Drive no está configurado todavía'); cred = JSON.parse(await data.text()); }
  return cred;
}
async function accesoToken() {
  if (token && Date.now() < caduca - 60000) return token;
  const c = await clave(), ahora = Math.floor(Date.now() / 1000);
  const cab = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' })), cuerpo = b64(JSON.stringify({ iss: c.client_email, scope: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/devstorage.read_write', aud: 'https://oauth2.googleapis.com/token', iat: ahora, exp: ahora + 3600 }));
  const firma = crypto.createSign('RSA-SHA256').update(cab + '.' + cuerpo).sign(c.private_key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + cab + '.' + cuerpo + '.' + firma });
  const j = await r.json(); if (!r.ok) throw new Error('Drive: ' + (j.error_description || j.error));
  token = j.access_token; caduca = Date.now() + (j.expires_in || 3600) * 1000; return token;
}
async function api(ruta, params = {}) {
  const u = new URL('https://www.googleapis.com/drive/v3/' + ruta); for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set('supportsAllDrives', 'true'); u.searchParams.set('includeItemsFromAllDrives', 'true');
  const r = await fetch(u, { headers: { Authorization: 'Bearer ' + await accesoToken() } }); const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Drive ' + r.status + ': ' + (j.error?.message || '')); return j;
}
const CAMPOS = 'id,name,mimeType,size,modifiedTime,thumbnailLink,videoMediaMetadata(durationMillis,width,height),imageMediaMetadata(width,height)';

// Subida directa del navegador a Google Cloud Storage (sin límite de 50 MB): se abre una sesión reanudable y el navegador sube el archivo a esa dirección
export async function iniciaSubidaGcs(nombre, origen) {
  const r = await fetch('https://storage.googleapis.com/upload/storage/v1/b/ranuse-video-cache/o?uploadType=resumable&name=' + encodeURIComponent(nombre), { method: 'POST', headers: { Authorization: 'Bearer ' + await accesoToken(), 'Content-Type': 'application/json', Origin: origen || 'https://ranusecrm.vercel.app' }, body: JSON.stringify({ name: nombre }) });
  const url = r.headers.get('location'); if (!r.ok || !url) throw new Error('GCS ' + r.status + ' ' + (await r.text()).slice(0, 100)); return url;
}
export async function raiz() { const j = await api('files', { q: 'sharedWithMe=true and trashed=false', fields: 'files(id,name,mimeType)', pageSize: '50' }); return (j.files || []).filter(f => f.mimeType === 'application/vnd.google-apps.folder'); }
export async function hijos(id) {
  const c = cache.get(id); if (c && Date.now() - c.t < 60000) return c.d;
  const out = []; let pageToken;
  do { const j = await api('files', { q: "'" + id + "' in parents and trashed=false", pageSize: '200', orderBy: 'folder,name_natural', fields: 'nextPageToken,files(' + CAMPOS + ')', ...(pageToken ? { pageToken } : {}) }); out.push(...(j.files || [])); pageToken = j.nextPageToken; } while (pageToken);
  const d = out.map(f => ({ id: f.id, nombre: f.name, tipo: f.mimeType === 'application/vnd.google-apps.folder' ? 'carpeta' : /^video\//.test(f.mimeType) ? 'video' : /^image\//.test(f.mimeType) ? 'imagen' : /^audio\//.test(f.mimeType) ? 'audio' : 'otro', tam: Number(f.size || 0), duracion: f.videoMediaMetadata ? Math.round(Number(f.videoMediaMetadata.durationMillis || 0) / 1000) : null, ancho: f.videoMediaMetadata?.width || f.imageMediaMetadata?.width || null, alto: f.videoMediaMetadata?.height || f.imageMediaMetadata?.height || null, fecha: f.modifiedTime }))
    .filter(f => f.tipo !== 'otro'); cache.set(id, { t: Date.now(), d }); return d;
}
export async function miniatura(id) {
  const m = await api('files/' + id, { fields: 'thumbnailLink,mimeType' }); if (!m.thumbnailLink) return null;
  const r = await fetch(m.thumbnailLink.replace(/=s\d+$/, '=s480'), { headers: { Authorization: 'Bearer ' + await accesoToken() } }); if (!r.ok) return null;
  return { tipo: r.headers.get('content-type') || 'image/jpeg', datos: Buffer.from(await r.arrayBuffer()) };
}
