import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';
import { uploadCatalogPhotoFile, handleMulterError } from '../middleware/upload.middleware.js';
import { uploadCatalogPhoto, deleteCatalogPhoto, copyCatalogPhoto } from '../utils/storage.js';
import sharp from 'sharp';
import { callClaude } from '../utils/anthropic.js';
import { generarBloquesAuto } from '../utils/bloques-auto.js';

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

    const { data: complementRows } = await supabase
      .from('catalog_product_complements')
      .select('product_id, complement:catalog_products!catalog_product_complements_complement_id_fkey(id, name, price, photo_url)');
    const complementsByProduct = {};
    (complementRows || []).forEach(r => {
      if (!r.complement) return;
      (complementsByProduct[r.product_id] ||= []).push(r.complement);
    });

    const products = (data || []).map(p => ({ ...p, extra_categories: extraByProduct[p.id] || [], complements: complementsByProduct[p.id] || [] }));

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

async function syncComplements(productId, complementIdsRaw) {
  if (complementIdsRaw === undefined) return;
  let ids;
  try { ids = JSON.parse(complementIdsRaw); } catch { ids = []; }
  if (!Array.isArray(ids)) ids = [];
  ids = ids.filter(cid => cid !== productId);
  await supabase.from('catalog_product_complements').delete().eq('product_id', productId);
  if (ids.length) {
    await supabase.from('catalog_product_complements').insert(ids.map(complement_id => ({ product_id: productId, complement_id })));
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

// ── IA: rellena la ficha de un producto a partir de su foto ───────────────
// Propone nombre, marca, categoría, medidas y datos técnicos. Solo sugiere:
// la persona lo revisa en el formulario antes de guardar. No propone precios.
router.post('/products/ia-foto', uploadCatalogPhotoFile, handleMulterError, async (req, res) => {
  try {
    let buf = req.file?.buffer;
    if (!buf && req.body?.url) {
      const r = await fetch(String(req.body.url));
      if (!r.ok) return res.status(400).json({ error: 'No se pudo leer la foto del producto' });
      buf = Buffer.from(await r.arrayBuffer());
    }
    if (!buf) return res.status(400).json({ error: 'Falta la foto' });
    const jpg = await sharp(buf).rotate().resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer();

    const { data: cats } = await supabase.from('catalog_categories').select('id, name, type').order('type').order('name');
    const listaCats = (cats || []).map(c => `${c.id} | ${c.type} | ${c.name}`).join('\n');

    const system = `Eres el asistente de catálogo de Ranuse Design, un estudio que diseña gimnasios y espacios deportivos (home gyms, gimnasios comerciales). Te enseñan la foto de UN producto (máquina, rack, banco, mancuernas, suelo, luminaria, material de obra…) y tienes que proponer su ficha para el catálogo.

Categorías disponibles (id | tipo | nombre):
${listaCats}

Responde SOLO con un JSON, sin texto alrededor, con estas claves (usa null cuando no lo sepas o no se vea; NO inventes):
{
 "nombre": "nombre corto y claro en español, como lo buscaría un diseñador",
 "marca": "marca o proveedor si se ve (logo, texto), si no null",
 "categoria_id": "id EXACTO de la lista de categorías que mejor encaje, o null",
 "longitud": número en cm o null (largo en planta),
 "ancho": número en cm o null,
 "altura": número en cm o null,
 "color_bastidor": "color del bastidor/estructura o null",
 "color_acolchado": "color del acolchado/tapizado o null",
 "tipo_acolchado": "tipo de tapizado (piel sintética…) o null",
 "color": "color o acabado principal (para luminarias, materiales…) o null",
 "lumens": número o null, "watts": número o null, "temperatura_color": "ej. 3000K" o null,
 "nivel_uso": "domestico" | "semi_profesional" | "profesional" | null,
 "palabras_clave": "3-6 palabras de búsqueda separadas por comas",
 "notas": "una o dos frases útiles para el diseñador (qué es, para qué sirve)",
 "confianza": "alta" | "media" | "baja",
 "aviso": "una frase sobre lo que has supuesto, sobre todo las medidas"
}
Reglas: las medidas solo si se leen en la foto (etiqueta, ficha) o se pueden estimar con un objeto de referencia (persona, discos, banco); si las estimas, dilo en "aviso" y baja la confianza. Nunca propongas precios.`;

    const respuesta = await callClaude({
      system, maxTokens: 900,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpg.toString('base64') } },
        { type: 'text', text: 'Propón la ficha de este producto.' },
      ] }],
    });
    const texto = (respuesta.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const m = texto.match(/\{[\s\S]*\}/);
    if (!m) return res.status(502).json({ error: 'La IA no devolvió una ficha válida. Inténtalo de nuevo.' });
    let s;
    try { s = JSON.parse(m[0]); } catch { return res.status(502).json({ error: 'La IA no devolvió una ficha válida. Inténtalo de nuevo.' }); }

    const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
    const txt = (v, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
    const catOk = (cats || []).some(c => c.id === s.categoria_id) ? s.categoria_id : null;
    res.json({ sugerencia: {
      nombre: txt(s.nombre, 120), marca: txt(s.marca, 80), categoria_id: catOk,
      longitud: num(s.longitud), ancho: num(s.ancho), altura: num(s.altura),
      color_bastidor: txt(s.color_bastidor, 60), color_acolchado: txt(s.color_acolchado, 60), tipo_acolchado: txt(s.tipo_acolchado, 60), color: txt(s.color, 60),
      lumens: num(s.lumens), watts: num(s.watts), color_temperature: txt(s.temperatura_color, 20),
      nivel_uso: ['domestico', 'semi_profesional', 'profesional'].includes(s.nivel_uso) ? s.nivel_uso : null,
      search_keywords: txt(s.palabras_clave, 160), notes: txt(s.notas, 400),
      confianza: ['alta', 'media', 'baja'].includes(s.confianza) ? s.confianza : 'media', aviso: txt(s.aviso, 300),
    } });
  } catch (err) {
    console.error('catalog ia-foto:', err);
    res.status(500).json({ error: err.message?.includes('clave de la IA') ? err.message : 'No se pudo analizar la foto' });
  }
});

// ── Bloques de producto (planta / alzado / lateral dibujados a escala) ─────
// Solo se aceptan trazos simples (line, rect, circle, polygon, path, g): el mismo
// dibujo se pinta en pantalla y en los PDF de los planos.
const ETIQUETAS_BLOQUE = new Set(['line', 'rect', 'circle', 'polygon', 'path', 'g']);
function svgBloqueValido(frag) {
  if (typeof frag !== 'string' || frag.length > 120000) return false;
  const etiquetas = [...frag.matchAll(/<\s*\/?\s*([a-zA-Z][\w:-]*)/g)].map(m => m[1].toLowerCase());
  if (etiquetas.some(t => !ETIQUETAS_BLOQUE.has(t))) return false;
  return !/on\w+\s*=|javascript:|<\s*script|href\s*=|url\s*\(/i.test(frag);
}
router.put('/products/:id/bloques', async (req, res) => {
  try {
    const { largo, fondo, alto, shapes, svg: svgIn, merge, fallback } = req.body || {};
    const fb = fallback && typeof fallback === 'object' ? fallback : {};
    if (!svgIn || typeof svgIn !== 'object') return res.status(400).json({ error: 'Datos del bloque no válidos' });
    // con merge solo se cambian las vistas que se mandan; las medidas que falten salen de lo que ya tiene el producto
    let previo = null;
    if (merge) {
      const { data: pr } = await supabase.from('catalog_products').select('longitud, ancho, altura, bloques').eq('id', req.params.id).maybeSingle();
      previo = pr || null;
    }
    const svg = merge ? { ...(previo?.bloques?.svg || {}), ...Object.fromEntries(Object.entries(svgIn).filter(([, v]) => v)) } : svgIn;
    // medidas: las del dibujo; si faltan, las que ya tiene el producto; y si tampoco, las del propio archivo subido
    const L = Number(largo) || Number(previo?.bloques?.largo) || Number(previo?.longitud) || Number(fb.largo) || 0;
    const D = Number(fondo) || Number(previo?.bloques?.fondo) || Number(previo?.ancho) || Number(fb.fondo) || 0;
    const H = Number(alto) || Number(previo?.bloques?.alto) || Number(previo?.altura) || Number(fb.alto) || 0;
    if (!(L > 0 && D > 0 && H > 0)) return res.status(400).json({ error: merge ? 'Faltan medidas: rellena el largo, el ancho y el alto del producto en el catálogo' : 'Datos del bloque no válidos' });
    const vistas = ['planta', 'alzado', 'lateral'];
    for (const v of vistas) {
      if (svg[v] != null && svg[v] !== '' && !svgBloqueValido(svg[v])) return res.status(400).json({ error: `El dibujo de ${v} contiene elementos no permitidos` });
    }
    if (!svg.planta && !svg.alzado && !svg.lateral) return res.status(400).json({ error: 'Falta el dibujo' });
    if (!merge && !svg.planta) return res.status(400).json({ error: 'Falta el dibujo de la planta' });
    const bloques = {
      largo: L, fondo: D, alto: H,
      shapes: merge ? (previo?.bloques?.shapes || null) : (shapes && typeof shapes === 'object' ? shapes : null),
      svg: { planta: svg.planta || '', alzado: svg.alzado || '', lateral: svg.lateral || '' },
      actualizado: new Date().toISOString(),
    };
    if (!previo) {
      const { data: pr2 } = await supabase.from('catalog_products').select('bloques').eq('id', req.params.id).maybeSingle();
      if (pr2?.bloques?.paso) bloques.paso = pr2.bloques.paso;
    } else if (previo.bloques?.paso) bloques.paso = previo.bloques.paso;
    // Las medidas del bloque son las medidas reales del producto: largo → longitud, fondo → ancho
    const { data, error } = await supabase.from('catalog_products').update({ bloques, longitud: L, ancho: D, altura: H }).eq('id', req.params.id).select('id, longitud, ancho, altura, bloques').single();
    if (error) throw error;
    res.json({ ok: true, product: data });
  } catch (err) {
    console.error('catalog bloques:', err);
    res.status(500).json({ error: 'No se pudo guardar el bloque' });
  }
});

// Distancias de paso de un producto (izquierda, derecha, delante, detrás, en cm): se guardan en el producto y se heredan al colocarlo
router.put('/products/:id/paso', async (req, res) => {
  try {
    const lim = v => (v == null || v === '' ? null : (Number(v) >= 0 && Number(v) <= 500 ? Number(v) : null));
    const p = req.body?.paso || {};
    const paso = { I: lim(p.I), D: lim(p.D), F: lim(p.F), T: lim(p.T) };
    const { data: prev, error: e1 } = await supabase.from('catalog_products').select('bloques').eq('id', req.params.id).maybeSingle();
    if (e1) throw e1;
    const bloques = { ...(prev?.bloques || {}), paso };
    const { error } = await supabase.from('catalog_products').update({ bloques }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true, paso });
  } catch (err) {
    console.error('catalog paso:', err);
    res.status(500).json({ error: 'No se pudieron guardar las distancias' });
  }
});

// Genera con IA un borrador de bloques (planta, alzado, lateral) a partir de la foto y las
// medidas del producto. No guarda nada: el editor de bloques lo muestra para revisarlo.
router.post('/products/:id/bloques/generar', async (req, res) => {
  try {
    const { data: p, error } = await supabase.from('catalog_products').select('id, name, photo_url, longitud, ancho, altura').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
    if (!p.photo_url) return res.status(400).json({ error: 'El producto necesita una foto para generar los bloques' });
    const largo = Number(req.body?.largo) || Number(p.longitud), fondo = Number(req.body?.fondo) || Number(p.ancho), alto = Number(req.body?.alto) || Number(p.altura);
    if (!(largo > 0 && fondo > 0 && alto > 0)) return res.status(400).json({ error: 'Faltan las medidas del producto: rellena largo, ancho y alto (en el editor o en la ficha)' });
    const r = await fetch(p.photo_url);
    if (!r.ok) return res.status(400).json({ error: 'No se pudo leer la foto del producto' });
    const imagen = Buffer.from(await r.arrayBuffer());
    // 1) modelo 3D a partir de la foto, proyectado a las tres vistas; 2) si el servicio 3D no responde, ensamblaje de piezas con IA
    const b = await generarBloquesAuto({ imagen, largo, fondo, alto, nombre: p.name });
    res.json({ bloque: { largo: b.largo, fondo: b.fondo, alto: b.alto, shapes: b.shapes, svg: b.svg, nota: b.nota, metodo: b.metodo } });
  } catch (err) {
    console.error('catalog bloques generar:', err);
    res.status(500).json({ error: err.message?.includes('clave de la IA') ? err.message : (err.message || 'No se pudo generar el bloque') });
  }
});

router.delete('/products/:id/bloques', async (req, res) => {
  try {
    const { error } = await supabase.from('catalog_products').update({ bloques: null }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo quitar el bloque' });
  }
});

router.post('/products', uploadCatalogPhotoFile, handleMulterError, async (req, res) => {
  try {
    const { category_id, name, brand, price, link, notes, longitud, ancho, altura, color_bastidor, color_acolchado, tipo_acolchado, lumens, watts, color_temperature, color, purchase_dto, default_margin_pct, pricing_unit, included_accessories, nivel_uso, search_keywords, extra_category_ids, complement_ids } = req.body;
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
        nivel_uso: nivel_uso?.trim() || null,
        search_keywords: search_keywords?.trim() || null,
      })
      .select('*, category:catalog_categories!catalog_products_category_id_fkey(id, name, type)')
      .single();
    if (error) throw error;
    await syncExtraCategories(data.id, extra_category_ids);
    await syncComplements(data.id, complement_ids);
    const { data: extraRows } = await supabase.from('catalog_product_categories').select('category:catalog_categories(id, name, type)').eq('product_id', data.id);
    const { data: complementRows } = await supabase.from('catalog_product_complements').select('complement:catalog_products!catalog_product_complements_complement_id_fkey(id, name, price, photo_url)').eq('product_id', data.id);
    res.status(201).json({ product: { ...data, extra_categories: (extraRows || []).map(r => r.category).filter(Boolean), complements: (complementRows || []).map(r => r.complement).filter(Boolean) } });
  } catch (err) {
    console.error('Error al crear producto:', err);
    res.status(500).json({ error: 'Error al crear producto' });
  }
});

router.put('/products/:id', uploadCatalogPhotoFile, handleMulterError, async (req, res) => {
  try {
    const { category_id, name, brand, price, link, notes, longitud, ancho, altura, color_bastidor, color_acolchado, tipo_acolchado, lumens, watts, color_temperature, color, purchase_dto, default_margin_pct, pricing_unit, included_accessories, nivel_uso, search_keywords, extra_category_ids, complement_ids } = req.body;
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
    if (nivel_uso !== undefined) updates.nivel_uso = nivel_uso?.trim() || null;
    if (search_keywords !== undefined) updates.search_keywords = search_keywords?.trim() || null;

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
    await syncComplements(data.id, complement_ids);
    const { data: extraRows } = await supabase.from('catalog_product_categories').select('category:catalog_categories(id, name, type)').eq('product_id', data.id);
    const { data: complementRows } = await supabase.from('catalog_product_complements').select('complement:catalog_products!catalog_product_complements_complement_id_fkey(id, name, price, photo_url)').eq('product_id', data.id);
    res.json({ product: { ...data, extra_categories: (extraRows || []).map(r => r.category).filter(Boolean), complements: (complementRows || []).map(r => r.complement).filter(Boolean) } });
  } catch (err) {
    console.error('Error al actualizar producto:', err);
    res.status(500).json({ error: 'Error al actualizar producto' });
  }
});

router.post('/products/:id/duplicate', async (req, res) => {
  try {
    const { data: original, error: fetchError } = await supabase
      .from('catalog_products')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (fetchError || !original) return res.status(404).json({ error: 'Producto no encontrado' });

    const { data: maxRow } = await supabase
      .from('catalog_products')
      .select('display_order')
      .order('display_order', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    const nextOrder = (maxRow?.display_order ?? -1) + 1;

    const { id, created_at, updated_at, display_order, name, photo_url, ...rest } = original;
    // La foto se copia a un archivo propio en Storage — nunca comparte el
    // mismo archivo que el original, para que borrar una copia no borre
    // también la foto del producto del que se duplicó.
    const copiedPhotoUrl = photo_url ? await copyCatalogPhoto(photo_url) : null;
    const { data: copy, error } = await supabase
      .from('catalog_products')
      .insert({ ...rest, name: `${name} (copia)`, display_order: nextOrder, photo_url: copiedPhotoUrl })
      .select('*, category:catalog_categories!catalog_products_category_id_fkey(id, name, type)')
      .single();
    if (error) throw error;

    const [{ data: extraRows }, { data: complementRows }] = await Promise.all([
      supabase.from('catalog_product_categories').select('category_id').eq('product_id', id),
      supabase.from('catalog_product_complements').select('complement_id').eq('product_id', id),
    ]);
    if (extraRows?.length) await supabase.from('catalog_product_categories').insert(extraRows.map(r => ({ product_id: copy.id, category_id: r.category_id })));
    if (complementRows?.length) await supabase.from('catalog_product_complements').insert(complementRows.map(r => ({ product_id: copy.id, complement_id: r.complement_id })));

    const { data: extraCats } = await supabase.from('catalog_product_categories').select('category:catalog_categories(id, name, type)').eq('product_id', copy.id);
    const { data: complements } = await supabase.from('catalog_product_complements').select('complement:catalog_products!catalog_product_complements_complement_id_fkey(id, name, price, photo_url)').eq('product_id', copy.id);
    res.status(201).json({ product: { ...copy, extra_categories: (extraCats || []).map(r => r.category).filter(Boolean), complements: (complements || []).map(r => r.complement).filter(Boolean) } });
  } catch (err) {
    console.error('Error al duplicar producto:', err);
    res.status(500).json({ error: 'Error al duplicar producto' });
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
