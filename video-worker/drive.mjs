// Acceso de solo lectura a Google Drive con la cuenta de servicio (sin librerías: JWT firmado + fetch).
import fs from 'fs';
import crypto from 'crypto';

const CLAVE = process.env.DRIVE_KEY_FILE || new URL('./secretos/drive.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
let cred = null, token = null, caduca = 0;
const b64 = (x) => Buffer.from(x).toString('base64url');

export function driveDisponible() { return fs.existsSync(CLAVE) || !!process.env.DRIVE_KEY_JSON; }

async function accesoToken() {
  if (token && Date.now() < caduca - 60000) return token;
  cred = cred || JSON.parse(process.env.DRIVE_KEY_JSON || fs.readFileSync(CLAVE, 'utf8'));
  const ahora = Math.floor(Date.now() / 1000);
  const cab = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' })), cuerpo = b64(JSON.stringify({ iss: cred.client_email, scope: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/devstorage.read_write', aud: 'https://oauth2.googleapis.com/token', iat: ahora, exp: ahora + 3600 }));
  const firma = crypto.createSign('RSA-SHA256').update(cab + '.' + cuerpo).sign(cred.private_key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + cab + '.' + cuerpo + '.' + firma });
  const j = await r.json(); if (!r.ok) throw new Error('Drive token: ' + (j.error_description || j.error));
  token = j.access_token; caduca = Date.now() + (j.expires_in || 3600) * 1000; return token;
}

async function api(ruta, params = {}) {
  const u = new URL('https://www.googleapis.com/drive/v3/' + ruta); for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set('supportsAllDrives', 'true'); u.searchParams.set('includeItemsFromAllDrives', 'true');
  const r = await fetch(u, { headers: { Authorization: 'Bearer ' + await accesoToken() } });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error('Drive ' + r.status + ': ' + (j.error?.message || ''));
  return j;
}

export async function lista(q, campos = 'id,name,mimeType,size,modifiedTime,parents,thumbnailLink,videoMediaMetadata,imageMediaMetadata') {
  const out = []; let pageToken;
  do { const j = await api('files', { q, pageSize: '200', fields: 'nextPageToken,files(' + campos + ')', ...(pageToken ? { pageToken } : {}) }); out.push(...(j.files || [])); pageToken = j.nextPageToken; } while (pageToken);
  return out;
}
export const meta = (id) => api('files/' + id, { fields: 'id,name,mimeType,size,modifiedTime,parents,videoMediaMetadata,imageMediaMetadata' });
export const hijos = (id) => lista("'" + id + "' in parents and trashed=false");
export const compartidoConmigo = () => lista('sharedWithMe=true and trashed=false', 'id,name,mimeType,modifiedTime');
export const esCarpeta = (f) => f.mimeType === 'application/vnd.google-apps.folder';
export const esVideo = (f) => /^video\//.test(f.mimeType);
export const esImagen = (f) => /^image\//.test(f.mimeType);

// URL de descarga (con cabecera de autorización) para ffmpeg/fetch; admite Range
export async function urlDescarga(id) { return { url: 'https://www.googleapis.com/drive/v3/files/' + id + '?alt=media&supportsAllDrives=true', cabeceras: { Authorization: 'Bearer ' + await accesoToken() } }; }

// Descarga por trozos (Range acotado): cuando Drive rechaza la descarga completa de un archivo ("cuota de descarga superada"),
// los trozos pequeños suelen seguir permitidos. Reintenta cada trozo con espera.
import { createWriteStream } from 'fs';
export async function bajaEnTrozos(id, destino, { trozoMB = 5, alAvanzar = null } = {}) {
  const m = await meta(id), total = Number(m.size || 0); if (!total) throw new Error('Drive no da el tamaño del archivo');
  const salida = createWriteStream(destino); let pos = 0;
  try {
    while (pos < total) {
      const fin = Math.min(total - 1, pos + trozoMB * 1048576 - 1); let ok = false, ultimo = '';
      for (let intento = 0; intento < 5 && !ok; intento++) {
        const { url, cabeceras } = await urlDescarga(id);
        const r = await fetch(url, { headers: { ...cabeceras, Range: 'bytes=' + pos + '-' + fin } });
        if (r.status === 206 || r.status === 200) { const buf = Buffer.from(await r.arrayBuffer()); await new Promise((res, rej) => salida.write(buf, e => (e ? rej(e) : res()))); ok = true; }
        else { ultimo = r.status + ' ' + (await r.text()).slice(0, 120).replace(/\s+/g, ' '); await new Promise(z => setTimeout(z, 2000 * (intento + 1))); }
      }
      if (!ok) throw new Error('Drive rechaza incluso los trozos pequeños (' + ultimo + ')');
      pos = fin + 1; if (alAvanzar) alAvanzar(pos, total);
    }
  } finally { await new Promise(res => salida.end(res)); }
  return total;
}

// Copia de seguridad de vídeos base en un depósito propio (Google Cloud Storage) para no depender del límite de descargas de Drive
const CUBO = 'ranuse-video-cache';
export async function cacheBaja(nombre, destino) {
  const r = await fetch('https://storage.googleapis.com/storage/v1/b/' + CUBO + '/o/' + encodeURIComponent(nombre) + '?alt=media', { headers: { Authorization: 'Bearer ' + await accesoToken() } });
  if (!r.ok) { r.body?.cancel(); return false; }
  const { pipeline } = await import('stream/promises'); const { Readable } = await import('stream');
  await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(destino)); return true;
}
export async function cacheSube(nombre, origen) {
  const r = await fetch('https://storage.googleapis.com/upload/storage/v1/b/' + CUBO + '/o?uploadType=media&name=' + encodeURIComponent(nombre), { method: 'POST', duplex: 'half', headers: { Authorization: 'Bearer ' + await accesoToken(), 'Content-Type': 'video/mp4', 'Content-Length': String(fs.statSync(origen).size) }, body: fs.createReadStream(origen) });
  if (!r.ok) throw new Error('Cache ' + r.status + ' ' + (await r.text()).slice(0, 100)); return true;
}
