import express from 'express';
import crypto from 'crypto';
import { responderAsistente, leerJson, guardarJson } from '../utils/asistente-personal.js';
import { transcribir } from '../utils/transcribir.js';
import { registraCanal, anotaEntrante } from '../utils/proactivo.js';

const router = express.Router();

// Asistente personal de Víctor por WhatsApp. Usa su PROPIA app de Meta ("Ranuse Asistente") y su propio número,
// separado del webhook del WhatsApp comercial (whatsapp.routes.js), para no mezclar ni crear leads por error.
// Variables de Railway (todas con prefijo WA_ASIST_):
//   WA_ASIST_VERIFY_TOKEN  texto que inventas y pegas igual en el panel de Meta
//   WA_ASIST_APP_SECRET    "Clave secreta de la app" de la app Ranuse Asistente (Configuración > Básica)
//   WA_ASIST_TOKEN         token permanente del usuario del sistema
//   WA_ASIST_PHONE_ID      identificador del número del asistente
//   WA_ASIST_OWNER         tu móvil personal (solo contesta a este número)
const VERIFY = (process.env.WA_ASIST_VERIFY_TOKEN || '').trim();
const SECRET = (process.env.WA_ASIST_APP_SECRET || '').trim();
const TOKEN = (process.env.WA_ASIST_TOKEN || '').trim();
const PHONE_ID = (process.env.WA_ASIST_PHONE_ID || '').replace(/[^0-9]/g, ''); // por si al pegarlo se coló un espacio
const WABA_ID = String(process.env.WA_ASIST_WABA_ID || '').replace(/[^0-9]/g, '');
const OWNER = String(process.env.WA_ASIST_OWNER || '').replace(/\D/g, '').slice(-9);
const OWNER_COMPLETO = (() => { const d = String(process.env.WA_ASIST_OWNER || '').replace(/\D/g, ''); return d.length === 9 ? '34' + d : d; })();

const GRAPH = 'https://graph.facebook.com/v21.0';
const SYSTEM = `Eres el asistente personal de Víctor Palomo, fundador de Ranuse Design (diseño de espacios deportivos y gimnasios). Hablas con él por WhatsApp desde el móvil.
- Español, tono cercano y directo. Mensajes cortos, sin markdown (en WhatsApp solo se usa *negrita* con un asterisco).
- Víctor no es técnico: sin jerga.
- De momento solo conversas y ayudas a pensar. Si te pide algo que aún no puedes hacer (crear tareas, mirar el CRM), dilo claro y no te lo inventes.`;

const registro = []; // últimos eventos, para diagnosticar desde /estado sin mirar Railway
const nota = (x) => { registro.unshift({ t: new Date().toISOString(), ...x }); if (registro.length > 15) registro.length = 15; };
const vistos = new Set();
const recibidas = new Map(); // id de mensaje -> { mime, buffer } de las fotos que manda Víctor (para cuando las cita)
const RUTA_IMG = 'crm/asistente/imagenes-enviadas.json';
async function anotaImagen(id, url) { try { const j = await leerJson(RUTA_IMG, { m: {} }); j.m[id] = url; const ks = Object.keys(j.m); if (ks.length > 100) for (const k of ks.slice(0, ks.length - 100)) delete j.m[k]; await guardarJson(RUTA_IMG, j); } catch { /* no es crítico */ } }
async function buscaImagen(id) { try { return (await leerJson(RUTA_IMG, { m: {} })).m[id] || null; } catch { return null; } } // ids de mensajes ya atendidos (Meta reintenta si tarda)

router.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && VERIFY && req.query['hub.verify_token'] === VERIFY) return res.status(200).send(req.query['hub.challenge']);
  return res.sendStatus(403);
});

function firmaOk(req) {
  if (!SECRET) return false;
  const f = req.headers['x-hub-signature-256'];
  if (!f || !req.rawBody) return false;
  const esperada = 'sha256=' + crypto.createHmac('sha256', SECRET).update(req.rawBody).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(f), Buffer.from(esperada)); } catch { return false; }
}

async function enviar(a, texto) {
  const r = await fetch(`${GRAPH}/${PHONE_ID}/messages`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: a, type: 'text', text: { body: String(texto).slice(0, 4000) } }),
  });
  if (!r.ok) { const cuerpo = await r.text().catch(() => ''); console.error('WhatsApp asistente: no se pudo enviar', r.status, cuerpo); nota({ ev: 'error_envio', http: r.status, cuerpo: cuerpo.slice(0, 400) }); } else nota({ ev: 'enviado' });
}

async function descargaMedia(id) {
  const r = await fetch(GRAPH + '/' + id, { headers: { Authorization: 'Bearer ' + TOKEN } }); const j = await r.json();
  if (!j.url) throw new Error('Meta no dio la dirección del archivo: ' + JSON.stringify(j).slice(0, 200));
  const f = await fetch(j.url, { headers: { Authorization: 'Bearer ' + TOKEN } }); if (!f.ok) throw new Error('No se pudo bajar el archivo (' + f.status + ')');
  return { buffer: Buffer.from(await f.arrayBuffer()), mime: j.mime_type || '' };
}
async function enviarArchivo(a, f) {
  const r = await fetch(GRAPH + '/' + PHONE_ID + '/messages', { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(f.tipo === 'imagen' ? { messaging_product: 'whatsapp', to: a, type: 'image', image: { link: f.url } } : { messaging_product: 'whatsapp', to: a, type: 'document', document: { link: f.url, filename: f.nombre } }) });
  if (r.ok && f.tipo === 'imagen') { const j = await r.clone().json().catch(() => ({})); if (j?.messages?.[0]?.id) await anotaImagen(j.messages[0].id, f.url); }
  if (!r.ok) { const cuerpo = await r.text().catch(() => ''); nota({ ev: 'error_envio_archivo', http: r.status, cuerpo: cuerpo.slice(0, 300) }); await enviar(a, 'No he podido adjuntar el archivo. Te dejo el enlace: ' + f.url); }
}

let lote = null; // { de, adj: [], textos: [], timer }
async function procesaLote() {
  const l = lote; lote = null; if (!l || !l.adj.length) return;
  try {
    const adjuntos = l.adj.map((a, i) => ({ ...a, id: 'a' + (i + 1) }));
    const textos = l.textos.filter(Boolean);
    const entrada = (adjuntos.length > 1 ? '(Víctor ha mandado ' + adjuntos.length + ' imágenes o archivos seguidos, adjuntos como ' + adjuntos.map(a => a.id).join(', ') + ') ' : '') + (textos.join(' · ') || '(sin texto)');
    const out = await responderAsistente({ chatId: 'wa:' + OWNER_COMPLETO, texto: entrada, adjuntos, avisar: (t) => enviar(l.de, t) });
    await enviar(l.de, out.texto);
    for (const f of out.archivos || []) await enviarArchivo(l.de, f);
  } catch (e) { console.error('WhatsApp asistente (lote):', e.message); nota({ ev: 'error', mensaje: e.message }); }
}

router.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Meta reintenta si tardamos: se responde ya y se trabaja después
  const firmado = firmaOk(req); nota({ ev: 'peticion', firmaOk: firmado, secretoPuesto: !!SECRET, trae_firma: !!req.headers['x-hub-signature-256'], conRawBody: !!req.rawBody });
  if (!firmado) { console.error('WhatsApp asistente: firma inválida o ausente — ignorado.'); return; }
  try {
    for (const entry of req.body?.entry || []) for (const ch of entry.changes || []) {
      if (ch.field !== 'messages') continue;
      const v = ch.value || {};
      nota({ ev: 'cambio', campo: ch.field, numero: v.metadata?.phone_number_id, mensajes: (v.messages || []).length, estados: (v.statuses || []).length });
      if (PHONE_ID && v.metadata?.phone_number_id !== PHONE_ID) { nota({ ev: 'otro_numero', recibido: v.metadata?.phone_number_id, esperado: PHONE_ID }); continue; } // mensajes de otro número: no es para este asistente
      for (const m of v.messages || []) {
        const de = String(m.from || '').replace(/\D/g, '');
        if (!OWNER || de.slice(-9) !== OWNER) { nota({ ev: 'no_autorizado', desde_ultimos4: de.slice(-4), esperado_ultimos4: OWNER.slice(-4) }); console.warn('WhatsApp asistente: mensaje de un número no autorizado, ignorado.'); continue; }
        if (m.id) { if (vistos.has(m.id)) continue; vistos.add(m.id); if (vistos.size > 500) vistos.delete(vistos.values().next().value); }
        let entrada = null; const adjuntos = [];
        anotaEntrante('wa');
        if (m.type === 'text') entrada = m.text.body;
        else if (m.type === 'audio' && m.audio?.id) {
          if (!(process.env.GROQ_API_KEY || '').trim()) { await enviar(de, 'Todavía no puedo oír audios: falta activar la transcripción gratuita. Mientras tanto, escríbeme.'); continue; }
          try { const t = await transcribir((await descargaMedia(m.audio.id)).buffer); if (!t) { await enviar(de, 'No he conseguido entender el audio, ¿me lo repites?'); continue; } entrada = '[Audio de Víctor, transcrito] ' + t; nota({ ev: 'audio_ok', letras: t.length }); }
          catch (e) { nota({ ev: 'audio_error', mensaje: e.message }); await enviar(de, 'No he podido escuchar ese audio. ¿Me lo escribes?'); continue; }
        } else if ((m.type === 'image' && m.image?.id) || (m.type === 'document' && m.document?.id)) {
          const med = m.type === 'image' ? m.image : m.document;
          try { const { buffer, mime } = await descargaMedia(med.id); if (buffer.length > 15 * 1024 * 1024) { await enviar(de, 'Ese archivo pesa demasiado (más de 15 MB).'); continue; } adjuntos.push({ id: 'a1', mime: med.mime_type || mime || 'application/octet-stream', buffer, nombre: med.filename || '' }); if (m.id && m.type === 'image') { recibidas.set(m.id, { mime: med.mime_type || mime || 'image/jpeg', buffer }); if (recibidas.size > 20) recibidas.delete(recibidas.keys().next().value); } entrada = med.caption || '(sin texto)'; nota({ ev: 'adjunto_ok', tipo: m.type, bytes: buffer.length }); }
          catch (e) { nota({ ev: 'adjunto_error', mensaje: e.message }); await enviar(de, 'No he podido descargar ese archivo. ¿Me lo mandas otra vez?'); continue; }
        } else { await enviar(de, 'Eso todavía no lo entiendo. Puedo con texto, audios, fotos y documentos.'); continue; }
        if (adjuntos.length && !m.context?.id) { // fotos, capturas o documentos: se esperan 4 s por si vienen más y se contestan juntos
          if (!lote) lote = { de, adj: [], textos: [], timer: null }; else clearTimeout(lote.timer);
          lote.adj.push(adjuntos[0]); lote.textos.push(entrada === '(sin texto)' ? '' : entrada); lote.timer = setTimeout(procesaLote, 4000); continue;
        }
        if (m.context?.id && !adjuntos.length) {
          const rec = recibidas.get(m.context.id);
          if (rec) adjuntos.push({ id: 'a1', mime: rec.mime, buffer: rec.buffer, nombre: '' });
          else { const url = await buscaImagen(m.context.id); if (url) { try { const f = await fetch(url); if (f.ok) adjuntos.push({ id: 'a1', mime: (f.headers.get('content-type') || 'image/png').split(';')[0], buffer: Buffer.from(await f.arrayBuffer()), nombre: '' }); } catch { /* sigue sin imagen */ } } }
          if (adjuntos.length) entrada = '(Víctor responde citando una imagen del chat; la tienes adjunta como a1) ' + entrada;
        }
        const out = await responderAsistente({ chatId: 'wa:' + OWNER_COMPLETO, texto: entrada, adjuntos, avisar: (t) => enviar(de, t) });
        await enviar(de, out.texto);
        for (const f of out.archivos || []) await enviarArchivo(de, f);
      }
    }
  } catch (e) { console.error('WhatsApp asistente:', e.message); nota({ ev: 'error', mensaje: e.message }); }
});

// Al arrancar: suscribe la cuenta de WhatsApp (WA_ASIST_WABA_ID) a esta app para que lleguen los mensajes, y apunta el estado en el registro.
// El registro con PIN ya NO se hace solo: en un número enlazado a la app del móvil podría romper el enlace (solo con ?registrar=1 a mano).
const PIN = String(process.env.WA_ASIST_PIN || '').replace(/[^0-9]/g, '');
async function registraNumero() {
  if (!TOKEN || !PHONE_ID) { console.log('WhatsApp asistente: faltan WA_ASIST_TOKEN o WA_ASIST_PHONE_ID.'); return; }
  const cab = { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };
  try {
    if (WABA_ID) {
      const r = await fetch(GRAPH + '/' + WABA_ID + '/subscribed_apps', { method: 'POST', headers: cab });
      console.log('WhatsApp asistente: suscripción de la cuenta a la app ->', r.status, (await r.text()).slice(0, 300));
    }
    const e = await fetch(GRAPH + '/' + PHONE_ID + '?fields=status,name_status,platform_type,verified_name,code_verification_status', { headers: cab });
    console.log('WhatsApp asistente: estado del número ->', e.status, (await e.text()).slice(0, 400));
  } catch (err) { console.error('WhatsApp asistente: no se pudo consultar/registrar el número:', err.message); }
}
setTimeout(registraNumero, 4000);
if (OWNER_COMPLETO) registraCanal('wa', { chatId: 'wa:' + OWNER_COMPLETO, enviar: (t) => enviar(OWNER_COMPLETO, t), enviarArchivo: (f) => enviarArchivo(OWNER_COMPLETO, f) });

// Para ver el estado desde el navegador sin mirar los registros de Railway:
//   /api/whatsapp-asistente/estado?clave=TU_WA_ASIST_VERIFY_TOKEN            -> estado del número y de la conexión
//   /api/whatsapp-asistente/estado?clave=TU_WA_ASIST_VERIFY_TOKEN&registrar=1 -> además intenta registrar el número con WA_ASIST_PIN
router.get('/estado', async (req, res) => {
  if (!VERIFY || req.query.clave !== VERIFY) return res.sendStatus(403);
  const cab = { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };
  const out = { registro, variables: { wabaId: !!WABA_ID, token: !!TOKEN, phoneId: !!PHONE_ID, pin6cifras: PIN.length === 6, appSecret: !!SECRET, owner: !!OWNER, groq_audios: !!(process.env.GROQ_API_KEY || '').trim(), fathom: !!(process.env.FATHOM_API_KEY || '').trim(), openai_imagenes: !!(process.env.OPENAI_API_KEY || '').trim(), gemini_imagenes: !!(process.env.GEMINI_API_KEY || '').trim(), anthropic: !!(process.env.ANTHROPIC_API_KEY || '').trim() } };
  try {
    const llama = async (ruta, cuerpo) => { const r = await fetch(GRAPH + '/' + PHONE_ID + ruta, { method: 'POST', headers: cab, body: JSON.stringify(cuerpo) }); return { http: r.status, respuesta: await r.text().catch(() => '') }; };
    // Pasos para pasar el número de la app del móvil a la API (el móvil dejará de usar ese número):
    //   &accion=pedir_codigo            -> Meta manda un SMS con un código al número
    //   &accion=verificar&codigo=123456 -> confirma el código recibido
    //   &registrar=1&pin=654321         -> registra el número en la API con un PIN de 6 cifras que inventas
    if (req.query.accion === 'pedir_codigo') out.pedir_codigo = await llama('/request_code', { code_method: req.query.metodo === 'VOICE' ? 'VOICE' : 'SMS', language: 'es' }); // &metodo=VOICE = te lo dictan por llamada
    if (req.query.accion === 'verificar') out.verificar = await llama('/verify_code', { code: String(req.query.codigo || '').replace(/[^0-9]/g, '') });
    if (req.query.registrar === '1') {
      const pin = String(req.query.pin || PIN || '').replace(/[^0-9]/g, '');
      out.registro = pin.length === 6 ? await llama('/register', { messaging_product: 'whatsapp', pin }) : { error: 'Falta un PIN de 6 cifras (&pin=123456)' };
    }
    if (req.query.accion === 'suscribir' && WABA_ID) { const r = await fetch(GRAPH + '/' + WABA_ID + '/subscribed_apps', { method: 'POST', headers: cab }); out.suscribir = { http: r.status, respuesta: (await r.text().catch(() => '')).slice(0, 600) }; } // &accion=suscribir -> engancha esta app a la cuenta de WhatsApp
    if (req.query.accion === 'probar_claves') { // comprueba que las claves de Groq y Fathom funcionan, sin mostrarlas
      const probar = async (nombre, f) => { try { const r = await f(); return { http: r.status, ok: r.ok, detalle: r.ok ? 'funciona' : (await r.text().catch(() => '')).slice(0, 160) }; } catch (e) { return { ok: false, detalle: e.message }; } };
      out.probar_claves = {
        groq: await probar('groq', () => fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: 'Bearer ' + (process.env.GROQ_API_KEY || '').trim() } })),
        fathom: await probar('fathom', () => fetch('https://api.fathom.ai/external/v1/meetings?include_summary=false', { headers: { 'X-Api-Key': (process.env.FATHOM_API_KEY || '').trim() } })),
      };
    }
    if (WABA_ID) { const su = await fetch(GRAPH + '/' + WABA_ID + '/subscribed_apps', { headers: cab }); out.apps_suscritas = { http: su.status, respuesta: (await su.text().catch(() => '')).slice(0, 600) }; }
    const e = await fetch(GRAPH + '/' + PHONE_ID + '?fields=status,name_status,platform_type,verified_name,code_verification_status,quality_rating', { headers: cab });
    out.numero = { http: e.status, respuesta: await e.text().catch(() => '') };
  } catch (err) { out.error = err.message; }
  res.json(out);
});

export default router;
