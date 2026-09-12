import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';
import { uploadCatalogPhotoFile, handleMulterError } from '../middleware/upload.middleware.js';
import { uploadCatalogPhoto, deleteCatalogPhoto } from '../utils/storage.js';

const router = express.Router();

// Todas las rutas requieren admin
router.use(authenticateToken, requirePermission('catalogo'));

function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

// ── Tipos de catálogo (nivel superior: Materiales, Mobiliario, y los que añadas) ──

router.get('/types', async (req, res) => {
  try {
    const { data, error } = await supabase.from('catalog_types').select('*').order('display_order', { ascending: true, nullsFirst: false }).order('created_at', { ascending: true });
    if (error) throw error;
    res.json({ types: data });
  } catch (err) {
    res.status(500).json({ error: 'Error al listar tipos' });
  }
});

router.post('/types', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Nombre requerido' });
    const baseSlug = slugify(name) || 'tipo';
    let slug = baseSlug, n = 1;
    while (true) {
      const { data: existing } = await supabase.from('catalog_types').select('id').eq('slug', slug).maybeSingle();
      if (!existing) break;
      slug = `${baseSlug}-${++n}`;
    }
    const { data: maxRow } = await supabase.from('catalog_types').select('display_order').order('display_order', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
    const { data, error } = await supabase.from('catalog_types').insert({
      name: name.trim(), slug, display_order: (maxRow?.display_order ?? -1) + 1,
    }).select('*').single();
    if (error) throw error;
    res.status(201).json({ type: data });
  } catch (err) {
    res.status(500).json({ error: 'Error al crear tipo' });
  }
});

router.put('/types/:id', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Nombre requerido' });
    const { data, error } = await supabase.from('catalog_types').update({ name: name.trim() }).eq('id', req.params.id).select('*').single();
    if (error) throw error;
    res.json({ type: data });
  } catch (err) {
    res.status(500).json({ error: 'Error al renombrar tipo' });
  }
});

router.delete('/types/:id', async (req, res) => {
  try {
    const { data: type } = await supabase.from('catalog_types').select('slug').eq('id', req.params.id).single();
    if (type) {
      const { data: inUse } = await supabase.from('catalog_categories').select('id').eq('type', type.slug).limit(1);
      if (inUse?.length) return res.status(400).json({ error: 'Hay categorías usando este tipo. Muévelas o elimínalas antes.' });
    }
    const { error } = await supabase.from('catalog_types').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Tipo eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar tipo' });
  }
});

// ── Categorías ─────────────────────────────────────────────────────────

router.get('/categories', async (req, res) => {
  try {
    const { type } = req.query;
    let query = supabase.from('catalog_categories').select('*').order('display_order', { ascending: true, nullsFirst: false }).order('name');
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
    if (!name?.trim() || !type?.trim()) {
      return res.status(400).json({ error: 'Nombre y tipo requeridos' });
    }
    const { data: maxRow } = await supabase.from('catalog_categories').select('display_order').eq('type', type).order('display_order', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
    const { data, error } = await supabase
      .from('catalog_categories')
      .insert({ name: name.trim(), type, display_order: (maxRow?.display_order ?? -1) + 1 })
      .select('*')
      .single();
    if (error) throw error;
    res.status(201).json({ category: data });
  } catch (err) {
    res.status(500).json({ error: 'Error al crear categoría' });
  }
});

router.put('/categories/reorder', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids requeridos' });
    await Promise.all(ids.map((id, index) => supabase.from('catalog_categories').update({ display_order: index }).eq('id', id)));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al reordenar categorías' });
  }
});

router.put('/categories/:id', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Nombre requerido' });
    const { data, error } = await supabase.from('catalog_categories').update({ name: name.trim() }).eq('id', req.params.id).select('*').single();
    if (error) throw error;
    res.json({ category: data });
  } catch (err) {
    res.status(500).json({ error: 'Error al renombrar categoría' });
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
      .select('*, category:catalog_categories!catalog_products_category_id_fkey(id, name, type)')
      .order('display_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (category_id) query = query.eq('category_id', category_id);
    if (type) query = query.eq('catalog_categories.type', type);
    const { data, error } = await query;
    if (error) throw error;

    const { data: extraRows } = await supabase
      .from('catalog_product_categories')
      .select('product_id, category:catalog_categories(id, name, type)');
    const extraByProduct = {};
    (extraRows || []).forEach(r => {
      if (!r.category) return;
      (extraByProduct[r.product_id] ||= []).push(r.category);
    });
    const products = (data || []).map(p => ({ ...p, extra_categories: extraByProduct[p.id] || [] }));

    res.json({ products });
  } catch (err) {
    res.status(500).json({ error: 'Error al listar productos' });
  }
});

async function syncExtraCategories(productId, extraCategoryIdsRaw) {
  if (extraCategoryIdsRaw === undefined) return;
  let ids;
  try { ids = JSON.parse(extraCategoryIdsRaw); } catch { ids = []; }
  if (!Array.isArray(ids)) ids = [];
  await supabase.from('catalog_product_categories').delete().eq('product_id', productId);
  if (ids.length) {
    await supabase.from('catalog_product_categories').insert(ids.map(category_id => ({ product_id: productId, category_id })));
  }
}

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
    const { category_id, name, brand, price, link, notes, longitud, ancho, altura, color_bastidor, color_acolchado, tipo_acolchado, lumens, watts, color_temperature, color, purchase_dto, default_margin_pct, pricing_unit, included_accessories, extra_category_ids } = req.body;
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
        lumens: lumens ? parseInt(lumens) : null,
        watts: watts ? parseFloat(watts) : null,
        color_temperature: color_temperature?.trim() || null,
        color: color?.trim() || null,
        purchase_dto: purchase_dto ? parseFloat(purchase_dto) : null,
        default_margin_pct: default_margin_pct ? parseFloat(default_margin_pct) : null,
        pricing_unit: pricing_unit?.trim() || 'ud',
        included_accessories: included_accessories?.trim() || null,
      })
      .select('*, category:catalog_categories!catalog_products_category_id_fkey(id, name, type)')
      .single();
    if (error) throw error;
    await syncExtraCategories(data.id, extra_category_ids);
    const { data: extraRows } = await supabase.from('catalog_product_categories').select('category:catalog_categories(id, name, type)').eq('product_id', data.id);
    res.status(201).json({ product: { ...data, extra_categories: (extraRows || []).map(r => r.category).filter(Boolean) } });
  } catch (err) {
    console.error('Error al crear producto:', err);
    res.status(500).json({ error: 'Error al crear producto' });
  }
});

router.put('/products/:id', uploadCatalogPhotoFile, handleMulterError, async (req, res) => {
  try {
    const { category_id, name, brand, price, link, notes, longitud, ancho, altura, color_bastidor, color_acolchado, tipo_acolchado, lumens, watts, color_temperature, color, purchase_dto, default_margin_pct, pricing_unit, included_accessories, extra_category_ids } = req.body;
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
    if (lumens !== undefined) updates.lumens = lumens ? parseInt(lumens) : null;
    if (watts !== undefined) updates.watts = watts ? parseFloat(watts) : null;
    if (color_temperature !== undefined) updates.color_temperature = color_temperature?.trim() || null;
    if (color !== undefined) updates.color = color?.trim() || null;
    if (purchase_dto !== undefined) updates.purchase_dto = purchase_dto ? parseFloat(purchase_dto) : null;
    if (default_margin_pct !== undefined) updates.default_margin_pct = default_margin_pct ? parseFloat(default_margin_pct) : null;
    if (pricing_unit !== undefined) updates.pricing_unit = pricing_unit?.trim() || 'ud';
    if (included_accessories !== undefined) updates.included_accessories = included_accessories?.trim() || null;

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

    const selectCols = '*, category:catalog_categories!catalog_products_category_id_fkey(id, name, type)';
    const { data, error } = Object.keys(updates).length
      ? await supabase.from('catalog_products').update(updates).eq('id', req.params.id).select(selectCols).single()
      : await supabase.from('catalog_products').select(selectCols).eq('id', req.params.id).single();
    if (error) throw error;
    await syncExtraCategories(data.id, extra_category_ids);
    const { data: extraRows } = await supabase.from('catalog_product_categories').select('category:catalog_categories(id, name, type)').eq('product_id', data.id);
    res.json({ product: { ...data, extra_categories: (extraRows || []).map(r => r.category).filter(Boolean) } });
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
