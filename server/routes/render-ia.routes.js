import express from 'express';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';

// Render fotorrealista con IA de imágenes (Gemini, «Nano Banana»): recibe la imagen del visor 3D
// (render limpio con materiales y luz) más la paleta de colores y devuelve la imagen mejorada.
// Necesita la variable GEMINI_API_KEY en el servidor. El modelo se puede cambiar con GEMINI_IMAGE_MODEL.
const router = express.Router();
router.use(authenticateToken, requirePermission('proyectos'));

const API = 'https://generativelanguage.googleapis.com/v1beta';
const modelo = () => process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';

// ¿Está configurada la clave? Y qué modelos de imagen ve la cuenta (sin enseñar la clave)
router.get('/estado', async (req, res) => {
  const clave = process.env.GEMINI_API_KEY;
  if (!clave) return res.json({ configurado: false });
  try {
    const r = await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': clave } });
    if (!r.ok) return res.json({ configurado: true, valida: false, estado: r.status });
    const j = await r.json();
    const imagen = (j.models || []).map(m => String(m.name || '').replace(/^models\//, '')).filter(n => /image/i.test(n));
    res.json({ configurado: true, valida: true, modelo: modelo(), modelosDeImagen: imagen });
  } catch (e) {
    res.json({ configurado: true, valida: false, error: 'No se pudo consultar a Google' });
  }
});

router.post('/', async (req, res) => {
  const clave = process.env.GEMINI_API_KEY;
  if (!clave) return res.status(503).json({ error: 'Falta configurar GEMINI_API_KEY en el servidor' });
  try {
    const { imagen, estancia, estilo, paleta, extra } = req.body || {};
    const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(String(imagen || ''));
    if (!m) return res.status(400).json({ error: 'Falta la imagen del visor (png, jpg o webp)' });
    const colores = Array.isArray(paleta) ? paleta.filter(p => p && p.nombre).slice(0, 12).map(p => `${String(p.nombre).slice(0, 40)}${p.hex ? ' (' + String(p.hex).slice(0, 9) + ')' : ''}`) : [];
    const instrucciones = [
      'Convierte esta imagen de un modelo 3D de interiorismo en una fotografía de arquitectura realista.',
      'Respeta EXACTAMENTE la composición, la perspectiva, las proporciones, la posición y el número de muebles, puertas y ventanas. No añadas ni quites elementos ni cambies el encuadre.',
      'Mejora la iluminación (luz natural suave y sombras realistas), los materiales y las texturas, como en una foto hecha con una cámara profesional.',
      colores.length ? 'Respeta con la máxima fidelidad estos colores y acabados: ' + colores.join('; ') + '.' : 'Mantén los colores de los materiales tal y como aparecen en la imagen.',
      estancia ? 'Estancia: ' + String(estancia).slice(0, 80) + '.' : '',
      estilo ? 'Estilo: ' + String(estilo).slice(0, 120) + '.' : '',
      extra ? String(extra).slice(0, 400) : '',
    ].filter(Boolean).join(' ');
    const r = await fetch(`${API}/models/${modelo()}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': clave },
      body: JSON.stringify({
        contents: [{ parts: [{ text: instrucciones }, { inlineData: { mimeType: m[1], data: m[2] } }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('render-ia Gemini', r.status, j?.error?.message);
      return res.status(502).json({ error: 'Gemini no ha podido generar la imagen' + (j?.error?.message ? ': ' + String(j.error.message).slice(0, 200) : '') });
    }
    const partes = j?.candidates?.[0]?.content?.parts || [];
    const img = partes.find(p => p.inlineData?.data || p.inline_data?.data);
    if (!img) return res.status(502).json({ error: 'Gemini no ha devuelto ninguna imagen' + (partes.find(p => p.text)?.text ? ': ' + partes.find(p => p.text).text.slice(0, 200) : '') });
    const d = img.inlineData || img.inline_data;
    res.json({ imagen: `data:${d.mimeType || d.mime_type || 'image/png'};base64,${d.data}` });
  } catch (e) {
    console.error('render-ia:', e);
    res.status(500).json({ error: 'No se pudo generar el render' });
  }
});

export default router;
