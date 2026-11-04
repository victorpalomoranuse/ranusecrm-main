import express from 'express';
import crypto from 'crypto';
import { callClaude } from '../utils/anthropic.js';

const router = express.Router();

// Asistente personal de Víctor por WhatsApp. Usa su PROPIA app de Meta ("Ranuse Asistente") y su propio número,
// separado del webhook del WhatsApp comercial (whatsapp.routes.js), para no mezclar ni crear leads por error.
// Variables de Railway (todas con prefijo WA_ASIST_):
//   WA_ASIST_VERIFY_TOKEN  texto que inventas y pegas igual en el panel de Meta
//   WA_ASIST_APP_SECRET    "Clave secreta de la app" de la app Ranuse Asistente (Configuración > Básica)
//   WA_ASIST_TOKEN         token permanente del usuario del sistema
//   WA_ASIST_PHONE_ID      identificador del número del asistente
//   WA_ASIST_OWNER         tu móvil personal (solo contesta a este número)
const VERIFY = process.env.WA_ASIST_VERIFY_TOKEN;
const SECRET = process.env.WA_ASIST_APP_SECRET;
const TOKEN = process.env.WA_ASIST_TOKEN;
const PHONE_ID = process.env.WA_ASIST_PHONE_ID;
const OWNER = String(process.env.WA_ASIST_OWNER || '').replace(/\D/g, '').slice(-9);

const GRAPH = 'https://graph.facebook.com/v21.0';
const SYSTEM = `Eres el asistente personal de Víctor Palomo, fundador de Ranuse Design (diseño de espacios deportivos y gimnasios). Hablas con él por WhatsApp desde el móvil.
- Español, tono cercano y directo. Mensajes cortos, sin markdown (en WhatsApp solo se usa *negrita* con un asterisco).
- Víctor no es técnico: sin jerga.
- De momento solo conversas y ayudas a pensar. Si te pide algo que aún no puedes hacer (crear tareas, mirar el CRM), dilo claro y no te lo inventes.`;

const memoria = new Map(); // últimos mensajes por conversación (se reinicia al reiniciar el servidor)

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
  if (!r.ok) console.error('WhatsApp asistente: no se pudo enviar', r.status, await r.text().catch(() => ''));
}

router.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Meta reintenta si tardamos: se responde ya y se trabaja después
  if (!firmaOk(req)) { console.error('WhatsApp asistente: firma inválida o ausente — ignorado.'); return; }
  try {
    for (const entry of req.body?.entry || []) for (const ch of entry.changes || []) {
      if (ch.field !== 'messages') continue;
      const v = ch.value || {};
      if (PHONE_ID && v.metadata?.phone_number_id !== PHONE_ID) continue; // mensajes de otro número: no es para este asistente
      for (const m of v.messages || []) {
        const de = String(m.from || '').replace(/\D/g, '');
        if (!OWNER || de.slice(-9) !== OWNER) { console.warn('WhatsApp asistente: mensaje de un número no autorizado, ignorado.'); continue; }
        if (m.type !== 'text') { await enviar(de, 'Por ahora solo entiendo texto. Los audios y fotos los añadimos después.'); continue; }
        const hist = memoria.get(de) || [];
        hist.push({ role: 'user', content: m.text.body });
        while (hist.length > 12) hist.shift();
        while (hist.length && hist[0].role !== 'user') hist.shift();
        const out = await callClaude({ system: SYSTEM, messages: hist, maxTokens: 700 });
        const texto = (out.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim() || 'No he sabido qué contestar, ¿me lo repites?';
        hist.push({ role: 'assistant', content: texto });
        memoria.set(de, hist);
        await enviar(de, texto);
      }
    }
  } catch (e) { console.error('WhatsApp asistente:', e.message); }
});

// Al arrancar: si hay PIN (WA_ASIST_PIN, 6 cifras que inventas tú), registra el número en la API de WhatsApp y apunta el estado en el registro.
// Registrar un número ya registrado es inofensivo. Cuando el número esté 'Conectado' puedes borrar la variable WA_ASIST_PIN.
const PIN = String(process.env.WA_ASIST_PIN || '').replace(/[^0-9]/g, '');
async function registraNumero() {
  if (!TOKEN || !PHONE_ID) { console.log('WhatsApp asistente: faltan WA_ASIST_TOKEN o WA_ASIST_PHONE_ID.'); return; }
  const cab = { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };
  try {
    if (PIN.length === 6) {
      const r = await fetch(GRAPH + '/' + PHONE_ID + '/register', { method: 'POST', headers: cab, body: JSON.stringify({ messaging_product: 'whatsapp', pin: PIN }) });
      console.log('WhatsApp asistente: registro del número ->', r.status, (await r.text()).slice(0, 400));
    }
    const e = await fetch(GRAPH + '/' + PHONE_ID + '?fields=status,name_status,platform_type,verified_name,code_verification_status', { headers: cab });
    console.log('WhatsApp asistente: estado del número ->', e.status, (await e.text()).slice(0, 400));
  } catch (err) { console.error('WhatsApp asistente: no se pudo consultar/registrar el número:', err.message); }
}
setTimeout(registraNumero, 4000);

// Para ver el estado desde el navegador sin mirar los registros de Railway:
//   /api/whatsapp-asistente/estado?clave=TU_WA_ASIST_VERIFY_TOKEN            -> estado del número y de la conexión
//   /api/whatsapp-asistente/estado?clave=TU_WA_ASIST_VERIFY_TOKEN&registrar=1 -> además intenta registrar el número con WA_ASIST_PIN
router.get('/estado', async (req, res) => {
  if (!VERIFY || req.query.clave !== VERIFY) return res.sendStatus(403);
  const cab = { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };
  const out = { variables: { token: !!TOKEN, phoneId: !!PHONE_ID, pin6cifras: PIN.length === 6, appSecret: !!SECRET, owner: !!OWNER } };
  try {
    if (req.query.registrar === '1' && PIN.length === 6) {
      const r = await fetch(GRAPH + '/' + PHONE_ID + '/register', { method: 'POST', headers: cab, body: JSON.stringify({ messaging_product: 'whatsapp', pin: PIN }) });
      out.registro = { http: r.status, respuesta: await r.text().catch(() => '') };
    }
    const e = await fetch(GRAPH + '/' + PHONE_ID + '?fields=status,name_status,platform_type,verified_name,code_verification_status,quality_rating', { headers: cab });
    out.numero = { http: e.status, respuesta: await e.text().catch(() => '') };
  } catch (err) { out.error = err.message; }
  res.json(out);
});

export default router;
