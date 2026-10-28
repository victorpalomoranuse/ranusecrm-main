import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken } from '../middleware/auth.middleware.js';

// Biblioteca 3D gratuita (modelos y texturas de Poly Haven, licencia CC0). No forma parte del catálogo de productos:
// es un índice aparte, guardado en el almacenamiento (biblioteca3d/indice.json), que el visor 3D usa para colocar muebles y texturas.
const router = express.Router();
router.use(authenticateToken);

let cache = { t: 0, data: null };
export async function indiceBiblioteca3d() {
  if (cache.data && Date.now() - cache.t < 10 * 60 * 1000) return cache.data;
  const { data: { publicUrl } } = supabase.storage.from('project-documents').getPublicUrl('biblioteca3d/indice.json');
  const r = await fetch(publicUrl + '?t=' + Date.now());
  if (!r.ok) return null;
  cache = { t: Date.now(), data: await r.json() };
  return cache.data;
}

router.get('/', async (req, res) => {
  try {
    const ind = await indiceBiblioteca3d();
    if (!ind) return res.json({ modelos: [], texturas: [], vacia: true });
    res.json(ind);
  } catch (err) {
    console.error('biblioteca3d:', err);
    res.status(500).json({ error: 'No se pudo cargar la biblioteca 3D' });
  }
});

export default router;
