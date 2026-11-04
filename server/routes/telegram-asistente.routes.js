import express from 'express';
import { responderAsistente } from '../utils/asistente-personal.js';
import { transcribir } from '../utils/transcribir.js';
import { registraCanal, anotaEntrante } from '../utils/proactivo.js';

const router = express.Router();

// Asistente personal de Víctor por Telegram (no depende de Meta ni de códigos por SMS).
// Variables de Railway:
//   TG_BOT_TOKEN       el token que te da @BotFather al crear el bot
//   TG_WEBHOOK_SECRET  texto cualquiera que inventas (protege el webhook)
//   TG_OWNER_ID        tu "id" de Telegram (el bot te lo dice la primera vez que le escribes)
const TOKEN = process.env.TG_BOT_TOKEN;
const SECRETO = process.env.TG_WEBHOOK_SECRET;
const OWNER = String(process.env.TG_OWNER_ID || '').trim();
const PUBLICA = process.env.PUBLIC_API_URL || 'https://ranusecrm-main-production.up.railway.app';
const API = 'https://api.telegram.org/bot' + TOKEN;

const SYSTEM = `Eres el asistente personal de Víctor Palomo, fundador de Ranuse Design (diseño de espacios deportivos y gimnasios). Hablas con él por Telegram desde el móvil.
- Español, tono cercano y directo. Mensajes cortos, sin markdown.
- Víctor no es técnico: sin jerga.
- De momento solo conversas y ayudas a pensar. Si te pide algo que aún no puedes hacer (crear tareas, mirar el CRM), dilo claro y no te lo inventes.`;

const vistos = new Set();

async function enviar(chatId, texto) {
  const r = await fetch(API + '/sendMessage', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: String(texto).slice(0, 4000) }),
  });
  if (!r.ok) console.error('Telegram asistente: no se pudo enviar', r.status, (await r.text().catch(() => '')).slice(0, 200));
}

async function enviarArchivoTg(chatId, f) {
  const r = await fetch(API + (f.tipo === 'imagen' ? '/sendPhoto' : '/sendDocument'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f.tipo === 'imagen' ? { chat_id: chatId, photo: f.url } : { chat_id: chatId, document: f.url, caption: f.nombre }) });
  if (!r.ok) await enviar(chatId, 'No he podido adjuntar el archivo. Te dejo el enlace: ' + f.url);
}
if (TOKEN && SECRETO && OWNER) registraCanal('tg', { chatId: 'tg:' + OWNER, siempreAbierto: true, enviar: (t) => enviar(OWNER, t), enviarArchivo: (f) => enviarArchivoTg(OWNER, f) });

router.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Telegram reintenta si tardamos: se responde ya y se trabaja después
  if (!TOKEN || !SECRETO || req.headers['x-telegram-bot-api-secret-token'] !== SECRETO) { console.error('Telegram asistente: secreto inválido o sin configurar — ignorado.'); return; }
  try {
    const m = req.body?.message; if (!m?.chat) return;
    const chatId = String(m.chat.id);
    if (!OWNER) { await enviar(chatId, 'Hola. Tu id de Telegram es ' + chatId + '. Pégalo en Railway como TG_OWNER_ID y ya podré hablar contigo.'); return; }
    if (String(m.from?.id) !== OWNER || chatId !== OWNER) { console.warn('Telegram asistente: mensaje de alguien no autorizado, ignorado.'); return; }
    if (m.message_id) { const k = chatId + ':' + m.message_id; if (vistos.has(k)) return; vistos.add(k); if (vistos.size > 500) vistos.delete(vistos.values().next().value); }
    anotaEntrante('tg');
    const bajar = async (fileId) => { const inf = await (await fetch(API + '/getFile?file_id=' + fileId)).json(); const arch = await fetch('https://api.telegram.org/file/bot' + TOKEN + '/' + inf.result.file_path); return Buffer.from(await arch.arrayBuffer()); };
    let entrada = m.text || m.caption || null; const adjuntos = [];
    const voz = m.voice || m.audio;
    if (voz) {
      if (!(process.env.GROQ_API_KEY || '').trim()) { await enviar(chatId, 'Todavía no puedo oír audios: falta activar la transcripción gratuita. Mientras tanto, escríbeme.'); return; }
      try { const t = await transcribir(await bajar(voz.file_id)); if (!t) { await enviar(chatId, 'No he conseguido entender el audio, ¿me lo repites?'); return; } entrada = '[Audio de Víctor, transcrito] ' + t; }
      catch (e) { console.error('Telegram asistente: audio:', e.message); await enviar(chatId, 'No he podido escuchar ese audio. ¿Me lo escribes?'); return; }
    } else if (m.photo?.length || m.document) {
      try {
        const esFoto = !!m.photo?.length, f = esFoto ? m.photo[m.photo.length - 1] : m.document, buffer = await bajar(f.file_id);
        if (buffer.length > 15 * 1024 * 1024) { await enviar(chatId, 'Ese archivo pesa demasiado (más de 15 MB).'); return; }
        adjuntos.push({ id: 'a1', mime: esFoto ? 'image/jpeg' : (f.mime_type || 'application/octet-stream'), buffer, nombre: esFoto ? '' : (f.file_name || '') });
        entrada = entrada || '(sin texto)';
      } catch (e) { console.error('Telegram asistente: adjunto:', e.message); await enviar(chatId, 'No he podido descargar ese archivo. ¿Me lo mandas otra vez?'); return; }
    }
    if (!adjuntos.length && m.reply_to_message?.photo?.length) { try { const f = m.reply_to_message.photo[m.reply_to_message.photo.length - 1]; adjuntos.push({ id: 'a1', mime: 'image/jpeg', buffer: await bajar(f.file_id), nombre: '' }); entrada = '(Víctor responde citando una imagen del chat; la tienes adjunta como a1) ' + (entrada || ''); } catch { /* sigue sin imagen */ } }
    if (!entrada) { await enviar(chatId, 'Eso todavía no lo entiendo. Puedo con texto, audios, fotos y documentos.'); return; }
    const out = await responderAsistente({ chatId: 'tg:' + chatId, texto: entrada, adjuntos, avisar: (t) => enviar(chatId, t) });
    await enviar(chatId, out.texto);
    for (const f of out.archivos || []) await enviarArchivoTg(chatId, f);
  } catch (e) { console.error('Telegram asistente:', e.message); }
});

// Al arrancar: le dice a Telegram a qué dirección mandar los mensajes (solo si ya están puestas las variables).
async function conectaWebhook() {
  if (!TOKEN || !SECRETO) { console.log('Telegram asistente: faltan TG_BOT_TOKEN o TG_WEBHOOK_SECRET (aún no configurado).'); return; }
  try {
    const r = await fetch(API + '/setWebhook', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: PUBLICA + '/api/telegram-asistente/webhook', secret_token: SECRETO, allowed_updates: ['message'] }),
    });
    console.log('Telegram asistente: webhook ->', r.status, (await r.text()).slice(0, 200));
  } catch (err) { console.error('Telegram asistente: no se pudo registrar el webhook:', err.message); }
}
setTimeout(conectaWebhook, 5000);

export default router;
