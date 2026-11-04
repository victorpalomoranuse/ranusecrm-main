import express from 'express';
import { callClaude } from '../utils/anthropic.js';

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

const memoria = new Map(); // últimos mensajes por conversación (se reinicia al reiniciar el servidor)

async function enviar(chatId, texto) {
  const r = await fetch(API + '/sendMessage', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: String(texto).slice(0, 4000) }),
  });
  if (!r.ok) console.error('Telegram asistente: no se pudo enviar', r.status, (await r.text().catch(() => '')).slice(0, 200));
}

router.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Telegram reintenta si tardamos: se responde ya y se trabaja después
  if (!TOKEN || !SECRETO || req.headers['x-telegram-bot-api-secret-token'] !== SECRETO) { console.error('Telegram asistente: secreto inválido o sin configurar — ignorado.'); return; }
  try {
    const m = req.body?.message; if (!m?.chat) return;
    const chatId = String(m.chat.id);
    if (!OWNER) { await enviar(chatId, 'Hola. Tu id de Telegram es ' + chatId + '. Pégalo en Railway como TG_OWNER_ID y ya podré hablar contigo.'); return; }
    if (String(m.from?.id) !== OWNER || chatId !== OWNER) { console.warn('Telegram asistente: mensaje de alguien no autorizado, ignorado.'); return; }
    if (!m.text) { await enviar(chatId, 'Por ahora solo entiendo texto. Los audios y fotos los añadimos después.'); return; }
    const hist = memoria.get(chatId) || [];
    hist.push({ role: 'user', content: m.text });
    while (hist.length > 12) hist.shift();
    while (hist.length && hist[0].role !== 'user') hist.shift();
    const out = await callClaude({ system: SYSTEM, messages: hist, maxTokens: 700 });
    const texto = (out.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim() || 'No he sabido qué contestar, ¿me lo repites?';
    hist.push({ role: 'assistant', content: texto });
    memoria.set(chatId, hist);
    await enviar(chatId, texto);
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
