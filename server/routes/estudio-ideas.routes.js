import express from 'express';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';

// «Estudio de ideas»: un agente creativo con ChatGPT (API de OpenAI, Responses). Se le comparte una imagen (una pared, un local, una vista 3D),
// se le pide una idea (un mural, un rótulo, un ambiente) y genera la imagen; se sigue hablando para retocarla y, al final, se le pide solo la imagen.
// Variables: OPENAI_API_KEY (obligatoria), OPENAI_CHAT_MODEL (modelo de texto con visión; si falta se elige uno de los que ve la cuenta)
// y OPENAI_IMAGE_MODEL (opcional, modelo de imagen de la herramienta).
const router = express.Router();
router.use(authenticateToken, requirePermission('proyectos'));

const OPENAI = 'https://api.openai.com/v1';
let modeloElegido = null;
const versionDe = id => (String(id).match(/\d+(\.\d+)?/g) || ['0']).map(Number);

async function elegirModelo(clave, excluir) {
  const r = await fetch(OPENAI + '/models', { headers: { Authorization: 'Bearer ' + clave } });
  const j = await r.json().catch(() => ({}));
  const ids = (j.data || []).map(x => x.id)
    .filter(id => /^gpt-\d/.test(id) && !/mini|nano|image|audio|realtime|transcribe|tts|search|codex|instruct|chat-latest|preview|deep-research|moderation|embedding/i.test(id) && id !== excluir);
  ids.sort((a, b) => {
    const va = versionDe(a), vb = versionDe(b);
    for (let i = 0; i < Math.max(va.length, vb.length); i++) { const d = (vb[i] || 0) - (va[i] || 0); if (d) return d; }
    return a.length - b.length;
  });
  return ids[0] || null;
}

const INSTRUCCIONES = `Eres el agente creativo de Ranuse Design, un estudio de diseño de espacios deportivos y de bienestar (gimnasios, estudios, vestuarios, recepciones…). Hablas en español, de forma breve y cercana.
Cuando el usuario comparta una imagen y pida una idea (un mural, un rótulo, un cartel, una decoración, un ambiente, un material), propón la idea con una frase y genera la imagen con la herramienta de imagen.
Si pide «solo la imagen», «sin la pared» o «para imprimir», genera únicamente el diseño aislado: sin la pared, sin el local, sin marcos, en plano frontal y a pantalla completa, con buena resolución y listo para llevar a producción.
Si pide cambios, parte de la imagen anterior y cambia solo lo pedido. No inventes medidas: si hacen falta, pregúntalas.`;

// Cuando se pide «solo la imagen»: se obliga a generar un diseño nuevo, plano y a toda la imagen, sin habitación ni pared (si no, tiende a repetir la foto de la sala)
const PIDE_SOLO = /solo (la )?imagen|sin (la )?(pared|habitaci|entorno|fondo)|para imprimir|solo (el|la) (mural|dise|ilustra|arte)|aislad/i;
const FORMATOS = { vertical: '1024x1536', horizontal: '1536x1024', cuadrado: '1024x1024' };
const EXTRA_SOLO = `
IMPORTANTE (modo «solo el diseño»): crea una IMAGEN NUEVA que contenga ÚNICAMENTE la obra de arte del mural, vista de frente y plana (sin perspectiva), ocupando toda la imagen de borde a borde. NO incluyas ninguna pared, habitación, suelo, techo, ventana, caja, mueble, marco, sombra ni borde. No uses la foto de la sala como base: úsala solo como referencia del diseño elegido. Conserva el diseño, los colores y el texto de la idea anterior.`;

// Con el visor 3D abierto, el agente recibe en cada mensaje una descripción del modelo (espacio, medidas, acabados, equipamiento) para que las ideas
// encajen en él y no invente nada que no se le pida.
const REGLAS_CONTEXTO = `

CONTEXTO DEL MODELO 3D ACTUAL (es la realidad del proyecto: toda idea debe encajar en ella y respetarla):
`;
const FIN_CONTEXTO = `

REGLAS CON ESTE MODELO: añade o cambia SOLO lo que el usuario te pida. No inventes elementos, muebles, ventanas, puertas, instalaciones ni materiales que no estén en el contexto ni te los hayan pedido. Respeta las medidas, los colores y los acabados del modelo (una superficie de color liso es pintura lisa, sin textura ni desgaste). Si para la idea te falta un dato (una medida, un material, un color), pregúntalo en vez de suponerlo. Al responder, di brevemente qué has añadido o cambiado.`;

router.post('/chat', async (req, res) => {
  const clave = process.env.OPENAI_API_KEY;
  if (!clave) return res.status(503).json({ error: 'Falta la clave de OpenAI en el servidor (variable OPENAI_API_KEY en Railway).' });
  try {
    const texto = String(req.body?.texto || '').trim().slice(0, 4000);
    const imagenes = (Array.isArray(req.body?.imagenes) ? req.body.imagenes : []).slice(0, 4).filter(x => /^data:image\/(png|jpeg|webp);base64,/.test(String(x || '')));
    if (!texto && !imagenes.length) return res.status(400).json({ error: 'Escribe algo o adjunta una imagen' });
    const previo = /^resp_[A-Za-z0-9_-]{5,100}$/.test(String(req.body?.previousResponseId || '')) ? String(req.body.previousResponseId) : null;
    const contenido = [{ type: 'input_text', text: texto || 'Mira esta imagen.' }, ...imagenes.map(u => ({ type: 'input_image', image_url: u }))];
    const contexto = String(req.body?.contexto || '').trim().slice(0, 6000);
    const instrucciones = INSTRUCCIONES + (contexto ? REGLAS_CONTEXTO + contexto + FIN_CONTEXTO : '');
    const solo = req.body?.soloDiseno === true || PIDE_SOLO.test(texto);
    const tam = FORMATOS[String(req.body?.formato || '')] || null;
    const base = { type: 'image_generation', ...(process.env.OPENAI_IMAGE_MODEL ? { model: process.env.OPENAI_IMAGE_MODEL } : {}) };
    const transp = solo && req.body?.transparente === true;
    const herramienta = solo ? { ...base, action: 'generate', ...(tam ? { size: tam } : {}), ...(transp ? { background: 'transparent', output_format: 'png' } : {}) } : base;
    if (solo) contenido[0].text += EXTRA_SOLO + (transp ? ' Sin fondo: el fondo debe ser totalmente transparente (solo el dibujo, recortado).' : '');

    const llama = async (modelo, simple = false) => {
      const r = await fetch(OPENAI + '/responses', {
        method: 'POST', headers: { Authorization: 'Bearer ' + clave, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelo, instructions: instrucciones, tools: [simple ? base : herramienta], ...(solo && !simple ? { tool_choice: { type: 'image_generation' } } : {}), input: [{ role: 'user', content: contenido }], ...(previo ? { previous_response_id: previo } : {}) }),
      });
      return { r, j: await r.json().catch(() => ({})) };
    };
    let modelo = process.env.OPENAI_CHAT_MODEL || modeloElegido || 'gpt-5';
    let { r, j } = await llama(modelo);
    if (!r.ok && solo && /action|size|tool_choice|background|output_format|image_generation/i.test(JSON.stringify(j?.error || {})) && !/does not exist|model_not_found/i.test(JSON.stringify(j?.error || {}))) ({ r, j } = await llama(modelo, true)); // si esta versión de la API no admite esos ajustes, se reintenta sin ellos
    if (!r.ok && !process.env.OPENAI_CHAT_MODEL && /does not exist|model_not_found|do not have access|not found/i.test(JSON.stringify(j?.error || {}))) {
      const otro = await elegirModelo(clave, modelo).catch(() => null);
      if (otro) { modelo = otro; modeloElegido = otro; console.log('estudio-ideas: modelo de chat →', otro); ({ r, j } = await llama(modelo)); }
    }
    if (!r.ok) { console.error('estudio-ideas', r.status, j?.error?.message); return res.status(502).json({ error: 'ChatGPT no ha podido contestar' + (j?.error?.message ? ': ' + String(j.error.message).slice(0, 260) : '') }); }

    const salida = Array.isArray(j.output) ? j.output : [];
    const respuesta = salida.filter(o => o.type === 'message').flatMap(o => o.content || []).filter(c => c.type === 'output_text').map(c => c.text).join('\n').trim();
    const fotos = salida.filter(o => o.type === 'image_generation_call' && o.result).map(o => 'data:image/png;base64,' + o.result);
    res.json({ id: j.id, texto: respuesta, imagenes: fotos, modelo: j.model || modelo });
  } catch (e) {
    console.error('estudio-ideas:', e);
    res.status(500).json({ error: 'No se pudo hablar con ChatGPT: ' + String(e.message || e).slice(0, 200) });
  }
});

export default router;
