import express from 'express';
import crypto from 'crypto';
import { supabase } from '../config/supabase.js';

// Enlace de solo lectura para que SketchUp lea el modelo de un plano. El enlace lleva una
// firma (HMAC con el secreto del servidor) del id del plano: no hace falta guardar nada y
// solo sirve para ese plano, en solo lectura. Lo usa la extensión de SketchUp (public/sketchup).

export function firmaSketchup(id) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET || 'sin-secreto').update(`sketchup:${id}`).digest('base64url').slice(0, 24);
}
export function urlSketchup(req, id) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0];
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}/api/medicion-publico/${encodeURIComponent(id)}/${firmaSketchup(id)}`;
}

const router = express.Router();

router.get('/:id/:firma', async (req, res) => {
  try {
    const { id, firma } = req.params;
    const esperada = firmaSketchup(id);
    if (firma.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return res.status(403).json({ error: 'Enlace no válido' });
    const { data, error } = await supabase.from('mediciones').select('nombre, data, updated_at').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Plano no encontrado' });
    const modelo = data.data?.modelo3d;
    if (!modelo) return res.status(409).json({ error: 'El plano todavía no tiene modelo: ábrelo y dibuja algo para que se guarde' });
    res.set('Cache-Control', 'no-store');
    // «updated» va en segundos: SketchUp en Windows no admite enteros de más de 32 bits
    res.json({ updated: Math.floor(new Date(data.updated_at).getTime() / 1000), nombre: data.nombre || modelo.nombre || 'Plano', modelo });
  } catch (err) {
    console.error('medicion-publico:', err);
    res.status(500).json({ error: 'No se pudo leer el plano' });
  }
});

export default router;
