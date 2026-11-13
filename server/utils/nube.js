// Enciende el servidor de vídeo de Google Cloud (Cloud Run Job) para un trabajo de la cola.
// La configuración y la clave de la cuenta de servicio viven en el bucket privado "estudio-video" (secretos/), nunca en el código.
import crypto from 'crypto';
import { supabase } from '../config/supabase.js';

let cfg = null, cfgT = 0, cred = null, token = null, caduca = 0;
const b64 = (x) => Buffer.from(x).toString('base64url');
async function secreto(ruta) { const { data } = await supabase.storage.from('estudio-video').download(ruta); return data ? JSON.parse(await data.text()) : null; }
async function config() { if (cfg !== null && Date.now() - cfgT < 60000) return cfg; try { cfg = (await secreto('secretos/nube.json')) || { activo: false }; } catch { cfg = { activo: false }; } cfgT = Date.now(); return cfg; }
export async function nubeActiva() { return !!(await config()).activo; }
async function acceso() {
  if (token && Date.now() < caduca - 60000) return token;
  cred = cred || await secreto('secretos/drive.json'); if (!cred) throw new Error('sin cuenta de servicio');
  const ahora = Math.floor(Date.now() / 1000), cab = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' })), cuerpo = b64(JSON.stringify({ iss: cred.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: ahora, exp: ahora + 3600 }));
  const firma = crypto.createSign('RSA-SHA256').update(cab + '.' + cuerpo).sign(cred.private_key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + cab + '.' + cuerpo + '.' + firma });
  const j = await r.json(); if (!r.ok) throw new Error(j.error_description || j.error);
  token = j.access_token; caduca = Date.now() + (j.expires_in || 3600) * 1000; return token;
}
// true si Google ha aceptado arrancar el servidor para este trabajo
export async function lanzarNube(id) {
  try {
    const c = await config(); if (!c.activo) return false;
    const r = await fetch('https://run.googleapis.com/v2/projects/' + c.proyecto + '/locations/' + c.region + '/jobs/' + c.job + ':run', { method: 'POST', headers: { Authorization: 'Bearer ' + await acceso(), 'content-type': 'application/json' }, body: JSON.stringify({ overrides: { containerOverrides: [{ env: [{ name: 'JOB_ID', value: String(id) }, ...(process.env.OPENAI_API_KEY ? [{ name: 'OPENAI_API_KEY', value: String(process.env.OPENAI_API_KEY).trim() }] : [])] }] } }) });
    if (!r.ok) { console.error('Nube: Google rechazó el arranque', r.status, (await r.text()).slice(0, 200)); return false; }
    return true;
  } catch (e) { console.error('Nube: no se pudo lanzar', e.message); return false; }
}
