import express from 'express';
import crypto from 'crypto';
import { supabase } from '../config/supabase.js';

const router = express.Router();

// Webhook público de WhatsApp Business (Meta Cloud API) — NO lleva
// authenticateToken porque quien lo llama es Meta, no un usuario logueado
// del CRM. La seguridad aquí es: (1) el token de verificación en el GET de
// enganche, y (2) la firma HMAC del POST (ver verificaFirma).
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const APP_SECRET = process.env.WHATSAPP_APP_SECRET;

/**
 * GET /api/whatsapp/webhook
 * Verificación inicial que pide Meta al pulsar "Verificar y guardar" en el
 * panel de la app — responde con el "challenge" tal cual si el token de
 * verificación coincide con el que hemos configurado.
 */
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && VERIFY_TOKEN && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// DIAGNÓSTICO TEMPORAL — no expone el valor del secreto, solo si está
// configurado y su longitud, para depurar por qué falla la verificación.
// Quitar en cuanto quede confirmado que funciona.
router.get('/webhook-debug', (req, res) => {
  res.json({
    verify_token_configurado: !!VERIFY_TOKEN,
    verify_token_longitud: VERIFY_TOKEN ? VERIFY_TOKEN.length : 0,
    app_secret_configurado: !!APP_SECRET,
    query_recibida: req.query,
  });
});

// Verifica que el POST viene realmente de Meta comprobando la firma
// HMAC-SHA256 que manda en la cabecera x-hub-signature-256, calculada sobre
// el cuerpo crudo de la petición con el App Secret. Sin esto, cualquiera que
// adivinase la URL podría inyectar leads falsos en Setting.
function verificaFirma(req) {
  if (!APP_SECRET) return false;
  const firma = req.headers['x-hub-signature-256'];
  if (!firma || !req.rawBody) return false;
  const esperada = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(req.rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada));
  } catch {
    return false;
  }
}

/**
 * POST /api/whatsapp/webhook
 * Mensajes entrantes reales del número de WhatsApp Business de Ranuse.
 * Si el mensaje trae "referral", la conversación empezó desde un anuncio
 * (clic en "Enviar WhatsApp" de un anuncio de Meta) — es la señal oficial
 * que usamos para etiquetar el lead con canal "Ads" de forma fiable, sin
 * depender de que alguien lo detecte a mano en una captura.
 *
 * Solo crea/actualiza el lead en Setting — nunca responde ni envía nada por
 * WhatsApp; el equipo sigue contestando desde el móvil como siempre.
 */
router.post('/webhook', async (req, res) => {
  // Responder 200 siempre y ya — si tardamos o fallamos aquí, Meta reintenta
  // y puede llegar a desactivar el webhook tras fallos repetidos.
  res.sendStatus(200);

  if (!verificaFirma(req)) {
    console.error('Webhook de WhatsApp: firma inválida o ausente — mensaje ignorado.');
    return;
  }

  try {
    const entries = req.body?.entry || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;
        const value = change.value || {};
        const mensajes = value.messages || [];
        if (!mensajes.length) continue; // notificaciones de estado (entregado/leído) — no interesan aquí

        const nombreContacto = value.contacts?.[0]?.profile?.name || null;

        for (const msg of mensajes) {
          const telefono = '+' + (msg.from || '').replace(/\D/g, '');
          if (telefono === '+') continue;

          const esDeAnuncio = !!msg.referral;
          const textoMsg = msg.text?.body || (msg.type && msg.type !== 'text' ? `[mensaje de tipo ${msg.type}]` : null);

          await registrarMensajeEntrante({ telefono, nombreContacto, esDeAnuncio, referral: msg.referral, textoMsg });
        }
      }
    }
  } catch (err) {
    console.error('Error procesando webhook de WhatsApp:', err);
  }
});

async function registrarMensajeEntrante({ telefono, nombreContacto, esDeAnuncio, referral, textoMsg }) {
  // Busca por los últimos 9 dígitos del teléfono — evita fallos por
  // diferencias de formato (con/sin +, con/sin prefijo 34, espacios...).
  const ultimosDigitos = telefono.replace(/\D/g, '').slice(-9);
  const { data: existentes } = await supabase
    .from('setting_leads')
    .select('id, notas, canal')
    .ilike('telefono', `%${ultimosDigitos}%`)
    .limit(1);

  const fecha = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const lineaAnuncio = esDeAnuncio ? (referral?.headline ? ` — vino de anuncio: "${referral.headline}"` : ' — vino de un anuncio') : '';
  const lineaNota = (textoMsg ? `[${fecha}] WhatsApp entrante: "${textoMsg}"` : `[${fecha}] WhatsApp entrante (sin texto)`) + lineaAnuncio;

  if (existentes?.length) {
    const lead = existentes[0];
    const updates = { notas: lead.notas ? `${lead.notas}\n${lineaNota}` : lineaNota };
    if (esDeAnuncio && lead.canal !== 'Ads') updates.canal = 'Ads';
    await supabase.from('setting_leads').update(updates).eq('id', lead.id);
    return;
  }

  await supabase.from('setting_leads').insert({
    nombre: nombreContacto || telefono,
    telefono,
    canal: esDeAnuncio ? 'Ads' : 'WhatsApp',
    estado: 'contacto_nuevo',
    notas: lineaNota,
  });
}

export default router;
