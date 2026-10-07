import express from 'express';
import { randomUUID } from 'crypto';
import { supabase } from '../config/supabase.js';
import { authenticateToken } from '../middleware/auth.middleware.js';

// Conversaciones guardadas de los asistentes de IA (Asistente Setter y
// Asistente IA de presupuestos). Cada persona ve SOLO las suyas. Las capturas
// y planos adjuntos se suben al almacenamiento y en la conversación solo
// queda su enlace (así no se guardan megas de base64 en la base de datos y
// la IA los lee directamente por URL).
const router = express.Router();
router.use(authenticateToken);

const ASISTENTES = ['setter', 'presupuestos'];
const BUCKET = 'project-documents';
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' };

const fail = (res, e, msg) => { console.error(msg, e); res.status(500).json({ error: msg }); };

// Sube a Storage los adjuntos en base64 y los sustituye por su enlace
async function procesarAdjuntos(mensajes, userId) {
  const salida = [];
  for (const m of mensajes) {
    if (!Array.isArray(m.content)) { salida.push(m); continue; }
    const contenido = [];
    for (const b of m.content) {
      if ((b.type === 'image' || b.type === 'document') && b.source?.type === 'base64') {
        const mime = b.source.media_type;
        const ruta = `ia-chats/${userId}/${randomUUID()}.${EXT[mime] || 'bin'}`;
        const { error } = await supabase.storage.from(BUCKET).upload(ruta, Buffer.from(b.source.data, 'base64'), { contentType: mime });
        if (error) throw new Error('No se pudo guardar un adjunto: ' + error.message);
        const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(ruta);
        contenido.push({ ...b, source: { type: 'url', url: publicUrl } });
      } else contenido.push(b);
    }
    salida.push({ ...m, content: contenido });
  }
  return salida;
}

const textoDe = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? (c.find(b => b.type === 'text')?.text || '') : '');

// Título automático: @usuario de Instagram si sale + primeras palabras de lo que se pidió
function tituloDe(mensajes) {
  const todo = mensajes.map(m => textoDe(m.content)).join('\n');
  const handle = /@[A-Za-z0-9_.]{3,}/.exec(todo)?.[0];
  const primero = textoDe(mensajes.find(m => m.role === 'user')?.content).replace(/\s+/g, ' ').trim();
  const frase = primero && !/^Aquí tienes (la|varias)/i.test(primero) ? primero.slice(0, 55) + (primero.length > 55 ? '…' : '') : '';
  const base = [handle, frase].filter(Boolean).join(' · ');
  return base || `Conversación del ${new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'short', timeZone: 'Europe/Madrid' })}`;
}

router.get('/', async (req, res) => {
  try {
    const asistente = ASISTENTES.includes(req.query.asistente) ? req.query.asistente : null;
    if (!asistente) return res.status(400).json({ error: 'asistente no válido' });
    const { data, error } = await supabase.from('ia_conversaciones').select('id, titulo, updated_at').eq('user_id', req.user.id).eq('asistente', asistente).order('updated_at', { ascending: false }).limit(60);
    if (error) throw error;
    res.json({ conversaciones: data });
  } catch (e) { fail(res, e, 'Error al cargar tus conversaciones (¿has ejecutado el SQL v68?)'); }
});

router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('ia_conversaciones').select('id, titulo, mensajes').eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Conversación no encontrada' });
    res.json({ conversacion: data });
  } catch (e) { fail(res, e, 'Error al abrir la conversación'); }
});

// Crea o actualiza (con id) una conversación y devuelve los mensajes ya con enlaces en vez de base64
router.put('/', async (req, res) => {
  try {
    const { id, asistente, mensajes } = req.body;
    if (!ASISTENTES.includes(asistente) || !Array.isArray(mensajes) || !mensajes.length) return res.status(400).json({ error: 'Datos no válidos' });
    const limpios = await procesarAdjuntos(mensajes, req.user.id);
    const titulo = tituloDe(limpios);
    const ahora = new Date().toISOString();
    if (id) {
      const { data, error } = await supabase.from('ia_conversaciones').update({ mensajes: limpios, titulo, updated_at: ahora }).eq('id', id).eq('user_id', req.user.id).select('id, titulo').maybeSingle();
      if (error) throw error;
      if (data) return res.json({ id: data.id, titulo: data.titulo, mensajes: limpios });
    }
    const { data, error } = await supabase.from('ia_conversaciones').insert({ user_id: req.user.id, asistente, titulo, mensajes: limpios }).select('id, titulo').single();
    if (error) throw error;
    res.json({ id: data.id, titulo: data.titulo, mensajes: limpios });
  } catch (e) { fail(res, e, e.message || 'Error al guardar la conversación'); }
});

router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('ia_conversaciones').delete().eq('id', req.params.id).eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { fail(res, e, 'Error al borrar la conversación'); }
});

export default router;
