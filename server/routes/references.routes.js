import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';
import { uploadReferenceImageFile, handleMulterError } from '../middleware/upload.middleware.js';
import { uploadReferenceImage, deleteReferenceImage } from '../utils/storage.js';

const router = express.Router();
router.use(authenticateToken, requirePermission('referencias'));

/**
 * POST /api/references/upload-image
 * Sube una imagen propia (sin URL externa) y devuelve su image_url, para
 * usar al crear/editar una referencia de solo imagen.
 */
router.post('/upload-image', uploadReferenceImageFile, handleMulterError, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen' });
    const image_url = await uploadReferenceImage(req.file.buffer, req.file.originalname, req.file.mimetype);
    res.status(201).json({ image_url });
  } catch (error) {
    console.error('Error al subir imagen de referencia:', error);
    res.status(500).json({ error: 'Error al subir la imagen' });
  }
});

/**
 * POST /api/references/resolve-pin
 * Víctor pega el enlace de un Pin de Pinterest y devolvemos la imagen real
 * (leyendo el og:image de la propia página del Pin) para que se pueda usar
 * directamente como image_url — sin descargarla ni subirla a nuestro
 * Storage, así no ocupa espacio ahí.
 */
router.post('/resolve-pin', async (req, res) => {
  try {
    const raw = req.body?.url?.trim();
    if (!raw) return res.status(400).json({ error: 'Falta el enlace' });
    let target;
    try { target = new URL(raw); } catch { return res.status(400).json({ error: 'Ese enlace no es una URL válida' }); }
    if (!/(^|\.)pinterest\.[a-z.]+$/i.test(target.hostname) && target.hostname.toLowerCase() !== 'pin.it') {
      return res.status(400).json({ error: 'Solo se admiten enlaces de pinterest.com o pin.it' });
    }
    const pageRes = await fetch(target.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' },
      redirect: 'follow',
    });
    if (!pageRes.ok) return res.status(502).json({ error: 'No se pudo abrir ese Pin' });
    const html = await pageRes.text();
    const decode = (s) => s?.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'") || null;
    const imgMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    const titleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    if (!imgMatch) return res.status(422).json({ error: 'No se ha encontrado ninguna imagen en ese Pin' });
    res.json({ image_url: decode(imgMatch[1]), title: decode(titleMatch?.[1]) });
  } catch (error) {
    console.error('Error al resolver Pin de Pinterest:', error);
    res.status(500).json({ error: 'Error al leer el enlace de Pinterest' });
  }
});

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('inspiration_references')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ references: data });
  } catch {
    res.status(500).json({ error: 'Error al listar referencias' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { title, url, description, category, image_url } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Título requerido' });
    const { data, error } = await supabase
      .from('inspiration_references')
      .insert({
        title: title.trim(),
        url: url?.trim() || null,
        description: description?.trim() || null,
        category: category?.trim() || null,
        image_url: image_url?.trim() || null,
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ reference: data });
  } catch {
    res.status(500).json({ error: 'Error al crear referencia' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { title, url, description, category, image_url } = req.body;
    const updates = {};
    if (title !== undefined) updates.title = title.trim();
    if (url !== undefined) updates.url = url?.trim() || null;
    if (description !== undefined) updates.description = description?.trim() || null;
    if (category !== undefined) updates.category = category?.trim() || null;
    if (image_url !== undefined) updates.image_url = image_url?.trim() || null;
    const { data, error } = await supabase
      .from('inspiration_references')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ reference: data });
  } catch {
    res.status(500).json({ error: 'Error al actualizar referencia' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { data: existing } = await supabase.from('inspiration_references').select('image_url').eq('id', req.params.id).maybeSingle();
    const { error } = await supabase
      .from('inspiration_references')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    if (existing?.image_url?.includes('/inspiration-references/')) {
      await deleteReferenceImage(existing.image_url);
    }
    res.json({ message: 'Referencia eliminada' });
  } catch {
    res.status(500).json({ error: 'Error al eliminar referencia' });
  }
});

export default router;
