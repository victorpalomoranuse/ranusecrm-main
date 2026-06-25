import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.middleware.js';
import { uploadCatalogPhotoFile, handleMulterError } from '../middleware/upload.middleware.js';
import { uploadCatalogPhoto, deleteCatalogPhoto } from '../utils/storage.js';

const router = express.Router();

// Todas las rutas requieren admin
router.use(authenticateToken, requireAdmin);

// ── Categorías ─────────────────────────────────────────────────────────

router.get('/categories', async (req, res) => {
  try {
    const { type } = req.query;
    let query = supabase.from('catalog_categories').select('*').order('name');
    if (type) query = query.eq('type', type);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ categories: data });
  } catch (err) {
    res.status(500).json({ error: 'Error al listar categorías' });
  }
});

router.post('/categories', async (req, res) => {
  try {
    const { name, type } = req.body;
    if (!name?.trim() || !['material', 'mobiliario'].includes(type)) {
      return res.status(400).json({ error: 'Nombre y tipo requeridos' });
    }
    const { data, error } = await supabase
      .from('catalog_categories')
      .insert({ name: name.trim(), type })
      .select('*')
      .single();
    if (error) throw error;
    res.status(201).json({ category: data });
  } catch (err) {
    res.status(500).json({ error: 'Error al crear categoría' });
  }
});

router.delete('/categories/:id', async (req, res) => {
  try {
    // Borrar fotos de los productos de esta categoría
    const { data: products } = await supabase
      .from('catalog_products')
      .select('photo_url')
      .eq('category_id', req.params.id);
    if (products) {
      await Promise.all(products.filter(p => p.photo_url).map(p => deleteCatalogPhoto(p.photo_url)));
    }
    const { error } = await supabase.from('catalog_categories').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Categoría eliminada' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar categoría' });
  }
});

// ── Productos ──────────────────────────────────────────────────────────

router.get('/products', async (req, res) => {
  try {
    const { category_id, type } = req.query;
    let query = supabase
      .from('catalog_products')
      .select('*, category:catalog_categories(id, name, type)')
      .order('display_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (category_id) query = query.eq('category_id', category_id);
    if (type) query = query.eq('catalog_categories.type', type);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ products: data });
  } catch (err) {
    res.status(500).json({ error: 'Error al listar productos' });
  }
});

router.put('/products/reorder', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids requeridos' });
    }
    await Promise.all(
      ids.map((id, index) =>
        supabase.from('catalog_products').update({ display_order: index }).eq('id', id)
      )
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al reordenar productos' });
  }
});

router.post('/products', uploadCatalogPhotoFile, handleMulterError, async (req, res) => {
  try {
    const { category_id, name, brand, price, link, notes, longitud, ancho, altura, color_bastidor, color_acolchado, tipo_acolchado } = req.body;
    if (!category_id || !name?.trim()) {
      return res.status(400).json({ error: 'Categoría y nombre requeridos' });
    }
    let photo_url = null;
    if (req.file) {
      photo_url = await uploadCatalogPhoto(req.file.buffer, req.file.originalname, req.file.mimetype);
    }
    const { data: maxRow } = await supabase
      .from('catalog_products')
      .select('display_order')
      .order('display_order', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    const nextOrder = (maxRow?.display_order ?? -1) + 1;
    const { data, error } = await supabase
      .from('catalog_products')
      .insert({
        category_id,
        name: name.trim(),
        brand: brand?.trim() || null,
        price: price ? parseFloat(price) : null,
        link: link?.trim() || null,
        notes: notes?.trim() || null,
        photo_url,
        display_order: nextOrder,
        longitud: longitud ? parseFloat(longitud) : null,
        ancho: ancho ? parseFloat(ancho) : null,
        altura: altura ? parseFloat(altura) : null,
        color_bastidor: color_bastidor?.trim() || null,
        color_acolchado: color_acolchado?.trim() || null,
        tipo_acolchado: tipo_acolchado?.trim() || null,
      })
      .select('*, category:catalog_categories(id, name, type)')
      .single();
    if (error) throw error;
    res.status(201).json({ product: data });
  } catch (err) {
    console.error('Error al crear producto:', err);
    res.status(500).json({ error: 'Error al crear producto' });
  }
});

router.put('/products/:id', uploadCatalogPhotoFile, handleMulterError, async (req, res) => {
  try {
    const { category_id, name, brand, price, link, notes, longitud, ancho, altura, color_bastidor, color_acolchado, tipo_acolchado } = req.body;
    const updates = {};
    if (category_id !== undefined) updates.category_id = category_id;
    if (name !== undefined) updates.name = name.trim();
    if (brand !== undefined) updates.brand = brand?.trim() || null;
    if (price !== undefined) updates.price = price ? parseFloat(price) : null;
    if (link !== undefined) updates.link = link?.trim() || null;
    if (notes !== undefined) updates.notes = notes?.trim() || null;
    if (longitud !== undefined) updates.longitud = longitud ? parseFloat(longitud) : null;
    if (ancho !== undefined) updates.ancho = ancho ? parseFloat(ancho) : null;
    if (altura !== undefined) updates.altura = altura ? parseFloat(altura) : null;
    if (color_bastidor !== undefined) updates.color_bastidor = color_bastidor?.trim() || null;
    if (color_acolchado !== undefined) updates.color_acolchado = color_acolchado?.trim() || null;
    if (tipo_acolchado !== undefined) updates.tipo_acolchado = tipo_acolchado?.trim() || null;

    if (req.file) {
      // Borrar foto anterior
      const { data: existing } = await supabase
        .from('catalog_products')
        .select('photo_url')
        .eq('id', req.params.id)
        .single();
      if (existing?.photo_url) await deleteCatalogPhoto(existing.photo_url);
      updates.photo_url = await uploadCatalogPhoto(req.file.buffer, req.file.originalname, req.file.mimetype);
    }

    const { data, error } = await supabase
      .from('catalog_products')
      .update(updates)
      .eq('id', req.params.id)
      .select('*, category:catalog_categories(id, name, type)')
      .single();
    if (error) throw error;
    res.json({ product: data });
  } catch (err) {
    console.error('Error al actualizar producto:', err);
    res.status(500).json({ error: 'Error al actualizar producto' });
  }
});

router.delete('/products/:id', async (req, res) => {
  try {
    const { data: product } = await supabase
      .from('catalog_products')
      .select('photo_url')
      .eq('id', req.params.id)
      .single();
    if (product?.photo_url) await deleteCatalogPhoto(product.photo_url);
    const { error } = await supabase.from('catalog_products').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Producto eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

export default router;
