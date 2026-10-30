import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';
import { uploadCatalogPhotoFile, uploadSkpFile, uploadModelo3dFile, handleMulterError } from '../middleware/upload.middleware.js';
import { uploadCatalogPhoto, deleteCatalogPhoto, copyCatalogPhoto } from '../utils/storage.js';
import sharp from 'sharp';
import { callClaude } from '../utils/anthropic.js';
import { generarBloquesAuto } from '../utils/bloques-auto.js';
import { vaciaCacheAlEscribir } from '../utils/cache-catalogos.js';
import JSZip from 'jszip';

const router = express.Router();

// Todas las rutas requieren admin
router.use(authenticateToken, requirePermission('catalogo'));
router.use(vaciaCacheAlEscribir); // cualquier cambio del catálogo vacía la caché de la herramienta de planos

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
    {
      const skpPrev = previo?.bloques?.skp || (await supabase.from('catalog_products').select('bloques').eq('id', req.params.id).maybeSingle()).data?.bloques?.skp;
      if (skpPrev) bloques.skp = skpPrev;
      const m3Prev = previo?.bloques?.modelo3d || (await supabase.from('catalog_products').select('bloques').eq('id', req.params.id).maybeSingle()).data?.bloques?.modelo3d;
      if (m3Prev) bloques.modelo3d = m3Prev;
    }
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

// Fotos del producto subidas desde Planos: la primera puede ser la foto principal (photo_url) y el resto se guardan como fotos extra
// (bloques.fotos) para generar el bloque con varias vistas del producto.
router.post('/products/:id/fotos', async (req, res) => {
  try {
    const { data: p, error } = await supabase.from('catalog_products').select('id, photo_url, bloques').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
    const bufs = [];
    for (const d of (Array.isArray(req.body?.imagenes) ? req.body.imagenes.slice(0, 4) : [])) {
      const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(d || ''));
      if (!m) continue;
      const b = Buffer.from(m[2], 'base64');
      if (b.length > 12 * 1024 * 1024) continue;
      const jpg = await sharp(b).rotate().resize(2000, 2000, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 88 }).toBuffer();
      bufs.push(jpg);
    }
    if (!bufs.length) return res.status(400).json({ error: 'Las imágenes no son válidas (usa PNG, JPG o WebP)' });
    const urls = [];
    for (const b of bufs) urls.push(await uploadCatalogPhoto(b, 'foto.jpg', 'image/jpeg'));
    const updates = {};
    const extra = [...(Array.isArray(p.bloques?.fotos) ? p.bloques.fotos : [])];
    let resto = urls;
    if (req.body?.principal || !p.photo_url) {
      if (p.photo_url) await deleteCatalogPhoto(p.photo_url);
      updates.photo_url = urls[0];
      resto = urls.slice(1);
    }
    const fotos = [...extra, ...resto].slice(-6);
    updates.bloques = { ...(p.bloques || {}), fotos };
    const { error: eUp } = await supabase.from('catalog_products').update(updates).eq('id', req.params.id);
    if (eUp) throw eUp;
    res.json({ ok: true, photo_url: updates.photo_url || p.photo_url, fotos, n: 1 + fotos.length });
  } catch (err) {
    console.error('catalog fotos:', err);
    res.status(500).json({ error: 'No se pudieron guardar las fotos del producto' });
  }
});

// Genera con IA un borrador de bloques (planta, alzado, lateral) a partir de la foto y las
// medidas del producto. No guarda nada: el editor de bloques lo muestra para revisarlo.
router.post('/products/:id/bloques/generar', async (req, res) => {
  try {
    const { data: p, error } = await supabase.from('catalog_products').select('id, name, photo_url, longitud, ancho, altura, bloques').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
    if (!p.photo_url) return res.status(400).json({ error: 'El producto necesita una foto para generar los bloques' });
    const largo = Number(req.body?.largo) || Number(p.longitud), fondo = Number(req.body?.fondo) || Number(p.ancho), alto = Number(req.body?.alto) || Number(p.altura);
    if (!(largo > 0 && fondo > 0 && alto > 0)) return res.status(400).json({ error: 'Faltan las medidas del producto: rellena largo, ancho y alto (en el editor o en la ficha)' });
    const r = await fetch(p.photo_url);
    if (!r.ok) return res.status(400).json({ error: 'No se pudo leer la foto del producto' });
    const imagen = Buffer.from(await r.arrayBuffer());
    // además de la foto principal, las fotos extra del producto (otras vistas)
    const imagenes = [imagen];
    for (const u of (Array.isArray(p.bloques?.fotos) ? p.bloques.fotos : []).slice(0, 3)) {
      try { const rr = await fetch(u); if (rr.ok) imagenes.push(Buffer.from(await rr.arrayBuffer())); } catch { /* sin esa foto */ }
    }
    // 1) modelo 3D a partir de la foto, proyectado a las tres vistas; 2) si el servicio 3D no responde, ensamblaje de piezas con IA
    const b = await generarBloquesAuto({ imagen, imagenes, largo, fondo, alto, nombre: p.name });
    res.json({ bloque: { largo: b.largo, fondo: b.fondo, alto: b.alto, shapes: b.shapes, svg: b.svg, nota: b.nota, metodo: b.metodo } });
  } catch (err) {
    console.error('catalog bloques generar:', err);
    res.status(500).json({ error: err.message?.includes('clave de la IA') ? err.message : (err.message || 'No se pudo generar el bloque') });
  }
});

// ── Modelo 3D de SketchUp (.skp) enlazado a un producto ───────────────────
// El plugin de SketchUp lo descarga y lo coloca donde esté el producto en el plano.
const BUCKET_SKP = 'project-documents';
const rutaDeUrl = (url) => { const m = /\/object\/public\/[^/]+\/(.+)$/.exec(String(url || '')); return m ? decodeURIComponent(m[1]) : null; };
router.post('/products/:id/skp', uploadSkpFile, handleMulterError, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Falta el archivo .skp' });
    const cab = req.file.buffer.subarray(0, 100).toString('utf16le');
    if (!/SketchUp/i.test(cab)) return res.status(400).json({ error: 'Ese archivo no parece un modelo de SketchUp' });
    const { data: pr, error: e0 } = await supabase.from('catalog_products').select('id, bloques').eq('id', req.params.id).maybeSingle();
    if (e0) throw e0;
    if (!pr) return res.status(404).json({ error: 'Producto no encontrado' });
    const ruta = `modelos-skp/${req.params.id}-${Date.now()}.skp`;
    const { error: eUp } = await supabase.storage.from(BUCKET_SKP).upload(ruta, req.file.buffer, { contentType: 'application/octet-stream', upsert: true });
    if (eUp) return res.status(500).json({ error: 'No se pudo guardar el archivo: ' + eUp.message });
    const { data: { publicUrl } } = supabase.storage.from(BUCKET_SKP).getPublicUrl(ruta);
    const antiguo = rutaDeUrl(pr.bloques?.skp?.url);
    const skp = { url: publicUrl, rot: Number(pr.bloques?.skp?.rot) || 0, nombre: req.file.originalname, bytes: req.file.size, actualizado: new Date().toISOString() };
    const { error } = await supabase.from('catalog_products').update({ bloques: { ...(pr.bloques || {}), skp } }).eq('id', req.params.id);
    if (error) throw error;
    if (antiguo) await supabase.storage.from(BUCKET_SKP).remove([antiguo]).catch(() => {});
    res.status(201).json({ skp });
  } catch (err) {
    console.error('catalog skp:', err);
    res.status(500).json({ error: 'No se pudo enlazar el modelo' });
  }
});
// Enlazar un modelo por URL (Google Drive, Dropbox…) en vez de subirlo: no ocupa espacio en el CRM
function urlDirecta(u) {
  let url;
  try { url = new URL(String(u).trim()); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  if (url.hostname === 'drive.google.com') {
    const m = /\/file\/d\/([^/]+)/.exec(url.pathname) || null;
    const id = m ? m[1] : url.searchParams.get('id');
    return id ? `https://drive.google.com/uc?export=download&id=${id}` : null;
  }
  if (/(^|\.)dropbox\.com$/.test(url.hostname)) { url.searchParams.delete('dl'); url.searchParams.set('dl', '1'); return url.toString(); }
  return url.toString();
}
// ── Modelo 3D para el visor 3D (glb, gltf, obj, dae) asignado a un producto ──
// Todas las veces que se coloque ese producto en el visor se verá con este modelo.
const TIPOS_MODELO3D = { glb: 'model/gltf-binary', gltf: 'model/gltf+json', obj: 'text/plain', dae: 'model/vnd.collada+xml' };
const MIME_MODELO = { glb: 'model/gltf-binary', gltf: 'model/gltf+json', bin: 'application/octet-stream', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', dae: 'model/vnd.collada+xml', obj: 'text/plain', mtl: 'text/plain' };
async function listarRecursivo(prefijo, prof = 0) {
  const { data } = await supabase.storage.from(BUCKET_SKP).list(prefijo, { limit: 300 });
  let out = [];
  for (const f of data || []) { if (f.id) out.push(prefijo + '/' + f.name); else if (prof < 3) out.push(...await listarRecursivo(prefijo + '/' + f.name, prof + 1)); }
  return out;
}
// Quita del almacenamiento los archivos de un modelo 3D antiguo (un solo archivo o toda su carpeta si venía en un .zip)
async function quitarModelo3dArchivos(m) {
  try {
    if (m?.carpeta) { const lista = await listarRecursivo(m.carpeta); if (lista.length) await supabase.storage.from(BUCKET_SKP).remove(lista); }
    else { const r = rutaDeUrl(m?.url); if (r) await supabase.storage.from(BUCKET_SKP).remove([r]); }
  } catch { /* sin limpiar: no es grave */ }
}
router.post('/products/:id/modelo3d', uploadModelo3dFile, handleMulterError, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Falta el archivo del modelo' });
    const ext = String(req.file.originalname.split('.').pop()).toLowerCase();
    const { data: pr, error: e0 } = await supabase.from('catalog_products').select('id, bloques').eq('id', req.params.id).maybeSingle();
    if (e0) throw e0;
    if (!pr) return res.status(404).json({ error: 'Producto no encontrado' });
    const base = `modelos-3d/${req.params.id}-${Date.now()}`;
    let url, tipo = ext, carpeta = null;
    if (ext === 'zip') {
      // un .zip con el modelo (.glb, .gltf, .dae u .obj) y sus texturas: se sube todo conservando las rutas para que las texturas se encuentren
      const zip = await JSZip.loadAsync(req.file.buffer);
      const entradas = Object.values(zip.files).filter(f => !f.dir && !/(^|\/)(__MACOSX|\.DS_Store)(\/|$)/.test(f.name) && !f.name.startsWith('/') && !f.name.split('/').includes('..'));
      if (!entradas.length || entradas.length > 300) return res.status(400).json({ error: 'El .zip está vacío o tiene demasiados archivos' });
      const principal = ['glb', 'gltf', 'dae', 'obj'].map(e => entradas.find(f => f.name.toLowerCase().endsWith('.' + e))).find(Boolean);
      if (!principal) return res.status(400).json({ error: 'No hay ningún .glb, .gltf, .dae u .obj dentro del .zip' });
      for (const f of entradas) {
        const buf = await f.async('nodebuffer'); if (buf.length > 25e6) continue;
        const e2 = f.name.split('.').pop().toLowerCase();
        const { error } = await supabase.storage.from(BUCKET_SKP).upload(base + '/' + f.name, buf, { contentType: MIME_MODELO[e2] || 'application/octet-stream', upsert: true });
        if (error && f === principal) throw error;
      }
      url = supabase.storage.from(BUCKET_SKP).getPublicUrl(base + '/' + principal.name).data.publicUrl;
      tipo = principal.name.split('.').pop().toLowerCase(); carpeta = base;
    } else {
      const ruta = `${base}.${ext}`;
      const { error: eUp } = await supabase.storage.from(BUCKET_SKP).upload(ruta, req.file.buffer, { contentType: MIME_MODELO[ext] || 'application/octet-stream', upsert: true });
      if (eUp) throw eUp;
      url = supabase.storage.from(BUCKET_SKP).getPublicUrl(ruta).data.publicUrl;
    }
    const antiguo = pr.bloques?.modelo3d;
    const modelo3d = { url, tipo, ...(carpeta ? { carpeta } : {}), rot: Number(antiguo?.rot) || 0, nombre: req.file.originalname, bytes: req.file.size, actualizado: new Date().toISOString() };
    const { error } = await supabase.from('catalog_products').update({ bloques: { ...(pr.bloques || {}), modelo3d } }).eq('id', req.params.id);
    if (error) throw error;
    if (antiguo) await quitarModelo3dArchivos(antiguo);
    res.status(201).json({ modelo3d });
  } catch (err) {
    console.error('catalog modelo3d:', err);
    res.status(500).json({ error: 'No se pudo guardar el modelo 3D' + (err?.message ? ': ' + String(err.message).slice(0, 160) : '') });
  }
});
router.put('/products/:id/modelo3d', async (req, res) => {
  try {
    const rot = ((Number(req.body?.rot) % 360) + 360) % 360;
    const { data: pr } = await supabase.from('catalog_products').select('bloques').eq('id', req.params.id).maybeSingle();
    if (!pr?.bloques?.modelo3d) return res.status(404).json({ error: 'Este producto no tiene modelo 3D' });
    const modelo3d = { ...pr.bloques.modelo3d, rot };
    const { error } = await supabase.from('catalog_products').update({ bloques: { ...pr.bloques, modelo3d } }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ modelo3d });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo girar el modelo' });
  }
});
router.delete('/products/:id/modelo3d', async (req, res) => {
  try {
    const { data: pr } = await supabase.from('catalog_products').select('bloques').eq('id', req.params.id).maybeSingle();
    if (!pr?.bloques?.modelo3d) return res.json({ ok: true });
    const { modelo3d, ...resto } = pr.bloques;
    const { error } = await supabase.from('catalog_products').update({ bloques: resto }).eq('id', req.params.id);
    if (error) throw error;
    await quitarModelo3dArchivos(modelo3d);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo quitar el modelo 3D' });
  }
});

router.post('/products/:id/skp-enlace', async (req, res) => {
  try {
    const directa = urlDirecta(req.body?.url);
    if (!directa) return res.status(400).json({ error: 'Pega un enlace https (por ejemplo, de Google Drive o Dropbox) al archivo .skp' });
    // se comprueba que de ahí sale de verdad un modelo de SketchUp
    let cab = '';
    try {
      const r = await fetch(directa, { headers: { Range: 'bytes=0-199' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
      if (!r.ok && r.status !== 206) throw new Error('http ' + r.status);
      cab = Buffer.from(await r.arrayBuffer()).subarray(0, 100).toString('utf16le');
    } catch { /* se avisa abajo */ }
    if (!/SketchUp/i.test(cab)) return res.status(400).json({ error: 'No he podido leer un modelo de SketchUp en ese enlace. Comprueba que el archivo está compartido con «cualquiera que tenga el enlace» y que es un .skp.' });
    const { data: pr, error: e0 } = await supabase.from('catalog_products').select('id, bloques').eq('id', req.params.id).maybeSingle();
    if (e0) throw e0;
    if (!pr) return res.status(404).json({ error: 'Producto no encontrado' });
    const antiguo = rutaDeUrl(pr.bloques?.skp?.url); // si antes se había subido al CRM, se libera ese espacio
    const skp = { url: directa, externo: true, rot: Number(pr.bloques?.skp?.rot) || 0, nombre: 'Modelo por enlace', actualizado: new Date().toISOString() };
    const { error } = await supabase.from('catalog_products').update({ bloques: { ...(pr.bloques || {}), skp } }).eq('id', req.params.id);
    if (error) throw error;
    if (antiguo) await supabase.storage.from(BUCKET_SKP).remove([antiguo]).catch(() => {});
    res.status(201).json({ skp });
  } catch (err) {
    console.error('catalog skp enlace:', err);
    res.status(500).json({ error: 'No se pudo enlazar el modelo' });
  }
});
router.put('/products/:id/skp', async (req, res) => {
  try {
    const rot = ((Math.round(Number(req.body?.rot) || 0) % 360) + 360) % 360;
    const { data: pr } = await supabase.from('catalog_products').select('bloques').eq('id', req.params.id).maybeSingle();
    if (!pr?.bloques?.skp) return res.status(404).json({ error: 'Este producto no tiene modelo enlazado' });
    const skp = { ...pr.bloques.skp, rot };
    const { error } = await supabase.from('catalog_products').update({ bloques: { ...pr.bloques, skp } }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ skp });
  } catch (err) { res.status(500).json({ error: 'No se pudo cambiar el giro del modelo' }); }
});
router.delete('/products/:id/skp', async (req, res) => {
  try {
    const { data: pr } = await supabase.from('catalog_products').select('bloques').eq('id', req.params.id).maybeSingle();
    const ruta = rutaDeUrl(pr?.bloques?.skp?.url);
    const { skp, ...resto } = pr?.bloques || {};
    const { error } = await supabase.from('catalog_products').update({ bloques: Object.keys(resto).length ? resto : null }).eq('id', req.params.id);
    if (error) throw error;
    if (ruta) await supabase.storage.from(BUCKET_SKP).remove([ruta]).catch(() => {});
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'No se pudo quitar el modelo' }); }
});

router.delete('/products/:id/bloques', async (req, res) => {
  try {
    const { data: prev } = await supabase.from('catalog_products').select('bloques').eq('id', req.params.id).maybeSingle();
    const { error } = await supabase.from('catalog_products').update({ bloques: prev?.bloques?.skp ? { skp: prev.bloques.skp } : null }).eq('id', req.params.id);
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
    const { category_id, name, brand, price, link, notes, longitud, ancho, altura, color_bastidor, color_acolchado, tipo_acolchado, lumens, watts, color_temperature, color, purchase_dto, default_margin_pct, pricing_unit, included_accessories, nivel_uso, search_keywords, extra_category_ids, complement_ids, descripcion_cliente } = req.body;
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
    if (descripcion_cliente !== undefined) updates.descripcion_cliente = descripcion_cliente?.trim() || null;

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
