import express from 'express';
import sharp from 'sharp';
import PDFDocument from 'pdfkit';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../config/supabase.js';
import { callClaude } from '../utils/anthropic.js';
import { uploadReferenceImageFile, handleMulterError } from '../middleware/upload.middleware.js';
import { uploadProjectRender } from '../utils/storage.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';

// Combinador: se suben fotos de productos (sillas, mesas, lámparas…), la IA los lee y propone combinaciones con moodboard.
// Cada producto es «Lo compra el cliente» (enlace y precio de referencia) o «Lo vendo yo» (coste, margen y precio de venta).
// Todo se guarda en el almacenamiento (crm/combinador/<id>.json), sin tocar la base de datos. La autenticación y el permiso se ponen al montar la ruta.
const router = express.Router();
router.use(authenticateToken, requirePermission('referencias'));
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUCKET = 'project-documents', CARPETA = 'crm/combinador';
const uid = () => crypto.randomBytes(5).toString('hex');
const hexOk = (v) => (/^#[0-9a-fA-F]{6}$/.test(String(v || '').trim()) ? String(v).trim().toLowerCase() : null);
const num = (v, d = 0, mn = 0, mx = 1e7) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? Math.max(mn, Math.min(mx, n)) : d; };
const txt = (v, n = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

async function leerJson(ruta) {
  try { const { data, error } = await supabase.storage.from(BUCKET).download(ruta); if (error || !data) return null; return JSON.parse(await data.text()); } catch { return null; }
}
async function guardaJson(ruta, obj) {
  const { error } = await supabase.storage.from(BUCKET).upload(ruta, Buffer.from(JSON.stringify(obj)), { contentType: 'application/json', upsert: true, cacheControl: '0' });
  if (error) throw error;
}
const rutaTablero = (id) => CARPETA + '/' + id + '.json';
const leerTablero = async (id) => (/^[a-f0-9]{6,16}$/.test(String(id)) ? leerJson(rutaTablero(id)) : null);
const urlPublica = (p) => supabase.storage.from(BUCKET).getPublicUrl(p).data.publicUrl;

// ── precios: lo que vende Ranuse lleva coste + margen; lo que compra el cliente lleva su precio de referencia
export function precioVenta(p) { const c = Number(p.costo) || 0; return c > 0 ? Math.round(c * (1 + (Number(p.margen) || 0) / 100) * 100) / 100 : Number(p.precioVenta) || 0; }
export function totales(c, productos) {
  let ranuse = 0, cliente = 0;
  for (const it of c.productos || []) {
    const p = productos.find(x => x.id === it.id); if (!p) continue;
    const q = Number(p.cantidad) || 1;
    if (p.compra === 'ranuse') ranuse += precioVenta(p) * q; else cliente += (Number(p.precio) || 0) * q;
  }
  return { ranuse: Math.round(ranuse * 100) / 100, cliente: Math.round(cliente * 100) / 100 };
}

const limpiaProducto = (p, previo = {}) => ({
  id: previo.id || p.id || uid(),
  foto: previo.foto || txt(p.foto, 400), nombre: txt(p.nombre, 90), tipo: txt(p.tipo, 40), material: txt(p.material, 80), color: txt(p.color, 60),
  colores: (Array.isArray(p.colores) ? p.colores : []).map(hexOk).filter(Boolean).slice(0, 4), estilo: txt(p.estilo, 80), medidas: txt(p.medidas, 80),
  rol: ['protagonista', 'apoyo', 'neutro'].includes(p.rol) ? p.rol : 'apoyo', nota: txt(p.nota, 300),
  compra: p.compra === 'ranuse' ? 'ranuse' : 'cliente', enlace: /^https?:\/\//i.test(String(p.enlace || '').trim()) ? String(p.enlace).trim().slice(0, 600) : '',
  precio: num(p.precio), costo: num(p.costo), margen: num(p.margen, 20, 0, 500), precioVenta: num(p.precioVenta), cantidad: Math.round(num(p.cantidad, 1, 1, 999)),
});

// ── lista, crear, leer, guardar y borrar tableros
router.get('/', async (req, res) => {
  try {
    const { data } = await supabase.storage.from(BUCKET).list(CARPETA, { limit: 300 });
    const archivos = (data || []).filter(f => /^[a-f0-9]{6,16}\.json$/.test(f.name));
    const lista = (await Promise.all(archivos.map(f => leerJson(CARPETA + '/' + f.name)))).filter(Boolean).map(t => ({ id: t.id, nombre: t.nombre, proyectoId: t.proyectoId || null, proyecto: t.proyecto || '', productos: (t.productos || []).length, combinaciones: (t.combinaciones || []).length, actualizado: t.actualizado }));
    res.json({ tableros: lista.sort((a, b) => String(b.actualizado).localeCompare(String(a.actualizado))) });
  } catch (e) { console.error('combinador lista:', e); res.status(500).json({ error: 'No se pudo leer la lista' }); }
});
router.post('/', async (req, res) => {
  try {
    const t = { id: uid(), nombre: txt(req.body?.nombre, 80) || 'Tablero sin nombre', espacio: txt(req.body?.espacio, 1200), proyectoId: req.body?.proyectoId || null, proyecto: txt(req.body?.proyecto, 120), creado: new Date().toISOString(), actualizado: new Date().toISOString(), productos: [], combinaciones: [] };
    await guardaJson(rutaTablero(t.id), t); res.status(201).json({ tablero: t });
  } catch (e) { res.status(500).json({ error: 'No se pudo crear el tablero' }); }
});
router.get('/proyectos', async (req, res) => {
  try { const { data } = await supabase.from('client_projects').select('id, client_name, project_name').order('created_at', { ascending: false }).limit(200); res.json({ proyectos: data || [] }); }
  catch { res.status(500).json({ error: 'No se pudieron leer los proyectos' }); }
});
router.get('/proyectos/:pid/destinos', async (req, res) => {
  try {
    const [b, c] = await Promise.all([
      supabase.from('budgets').select('id, budget_number, budget_name, status').eq('project_id', req.params.pid).order('created_at', { ascending: false }),
      supabase.from('capitulos').select('id, titulo, orden, visible').eq('proyecto_id', req.params.pid).order('orden'),
    ]);
    res.json({ presupuestos: b.data || [], capitulos: c.data || [] });
  } catch { res.status(500).json({ error: 'No se pudieron leer los presupuestos y la historia' }); }
});
router.get('/:id', async (req, res) => { const t = await leerTablero(req.params.id); if (!t) return res.status(404).json({ error: 'Tablero no encontrado' }); res.json({ tablero: t }); });
router.put('/:id', async (req, res) => {
  try {
    const t = await leerTablero(req.params.id); if (!t) return res.status(404).json({ error: 'Tablero no encontrado' });
    const b = req.body || {};
    if (typeof b.nombre === 'string') t.nombre = txt(b.nombre, 80) || t.nombre;
    if (typeof b.espacio === 'string') t.espacio = txt(b.espacio, 1200);
    if ('proyectoId' in b) { t.proyectoId = b.proyectoId || null; t.proyecto = txt(b.proyecto, 120); }
    if (Array.isArray(b.productos)) t.productos = b.productos.slice(0, 60).map(p => limpiaProducto(p, t.productos.find(x => x.id === p.id) || {}));
    if (Array.isArray(b.combinaciones)) {
      const ids = new Set(t.productos.map(p => p.id));
      t.combinaciones = b.combinaciones.slice(0, 40).map(c => ({ id: txt(c.id, 20) || uid(), titulo: txt(c.titulo, 90), idea: txt(c.idea, 240), porque: txt(c.porque, 700), evitar: txt(c.evitar, 400), moodboard: /^https?:\/\//.test(c.moodboard || '') ? c.moodboard : '', elegida: !!c.elegida, publicada: c.publicada || null,
        productos: (Array.isArray(c.productos) ? c.productos : []).filter(x => ids.has(x.id)).slice(0, 12).map(x => ({ id: x.id, rol: ['protagonista', 'apoyo', 'neutro'].includes(x.rol) ? x.rol : 'apoyo' })),
        paleta: (Array.isArray(c.paleta) ? c.paleta : []).map(q => ({ hex: hexOk(q.hex), nombre: txt(q.nombre, 40) })).filter(q => q.hex).slice(0, 6) }));
    }
    t.actualizado = new Date().toISOString(); await guardaJson(rutaTablero(t.id), t); res.json({ tablero: t });
  } catch (e) { console.error('combinador guarda:', e); res.status(500).json({ error: 'No se pudo guardar' }); }
});
router.delete('/:id', async (req, res) => {
  try {
    const t = await leerTablero(req.params.id); if (!t) return res.json({ ok: true });
    const { data } = await supabase.storage.from(BUCKET).list(CARPETA + '/img/' + t.id, { limit: 200 });
    await supabase.storage.from(BUCKET).remove([rutaTablero(t.id), ...(data || []).map(f => CARPETA + '/img/' + t.id + '/' + f.name)]).catch(() => {});
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'No se pudo borrar' }); }
});

// ── subir una foto de producto: se guarda reducida y la IA la lee
const SISTEMA_LECTURA = 'Eres una interiorista que cataloga productos de mobiliario y decoración a partir de su foto. Responde SOLO con JSON, sin explicaciones.';
router.post('/:id/productos', uploadReferenceImageFile, handleMulterError, async (req, res) => {
  try {
    const t = await leerTablero(req.params.id); if (!t) return res.status(404).json({ error: 'Tablero no encontrado' });
    if (!req.file) return res.status(400).json({ error: 'Falta la foto' });
    if ((t.productos || []).length >= 60) return res.status(400).json({ error: 'Máximo 60 productos por tablero' });
    const pid = uid();
    const buf = await sharp(req.file.buffer).rotate().resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 86 }).toBuffer();
    const ruta = CARPETA + '/img/' + t.id + '/' + pid + '.jpg';
    const { error: eUp } = await supabase.storage.from(BUCKET).upload(ruta, buf, { contentType: 'image/jpeg', upsert: true }); if (eUp) throw eUp;
    const pista = txt(req.body?.pista, 300);
    let lectura = {};
    try {
      const r = await callClaude({ system: SISTEMA_LECTURA, maxTokens: 700, messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } },
        { type: 'text', text: 'Cataloga el producto de la foto.' + (pista ? ' Dato del usuario: ' + pista + '.' : '') + ' JSON: {"nombre":"nombre corto y descriptivo en español","tipo":"silla|mesa|sofá|butaca|taburete|lámpara|alfombra|estantería|aparador|espejo|cuadro|planta|otro","material":"materiales principales","color":"color principal en palabras","colores":["#RRGGBB de los 2-3 colores dominantes del producto"],"estilo":"estilo en 2-3 palabras","medidas":"medidas aproximadas si se ven o se deducen, si no vacío","rol":"protagonista|apoyo|neutro","nota":"una frase sobre qué lo hace especial o delicado de combinar"}' }] }] });
      const j = /\{[\s\S]*\}/.exec((r.content || []).map(b => b.text || '').join('')); if (j) lectura = JSON.parse(j[0]);
    } catch (e) { console.error('combinador lectura:', e.message); }
    const p = limpiaProducto({ ...lectura, foto: urlPublica(ruta), compra: req.body?.compra === 'ranuse' ? 'ranuse' : 'cliente', enlace: req.body?.enlace, nombre: lectura.nombre || pista || 'Producto' }, { id: pid, foto: urlPublica(ruta) });
    t.productos.push(p); t.actualizado = new Date().toISOString(); await guardaJson(rutaTablero(t.id), t);
    res.status(201).json({ producto: p });
  } catch (e) { console.error('combinador producto:', e); res.status(500).json({ error: 'No se pudo subir y leer la foto' }); }
});

// ── búsqueda de productos por estilo en tiendas reales (la IA navega y devuelve enlaces)
const hostSeguro = (u) => { try { const x = new URL(u); if (x.protocol !== 'https:') return false; const h = x.hostname; return !(/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || !h.includes('.')); } catch { return false; } };
async function imagenDe(url) {
  if (!hostSeguro(url)) return '';
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(7000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RanuseBot/1.0)', Accept: 'text/html' } });
    if (!r.ok) return '';
    const html = (await r.text()).slice(0, 400000);
    const m = /<meta[^>]+(?:property|name)=["']og:image(?::secure_url)?["'][^>]*content=["']([^"']+)["']/i.exec(html) || /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i.exec(html);
    if (!m) return '';
    const abs = new URL(m[1].replace(/&amp;/g, '&'), r.url).toString();
    return hostSeguro(abs) ? abs : '';
  } catch { return ''; }
}
router.post('/:id/buscar', async (req, res) => {
  try {
    const t = await leerTablero(req.params.id); if (!t) return res.status(404).json({ error: 'Tablero no encontrado' });
    const estilo = txt(req.body?.estilo, 300), busco = txt(req.body?.busco, 300), maxPrecio = num(req.body?.maxPrecio, 0);
    if (!estilo && !busco && !t.espacio) return res.status(400).json({ error: 'Cuéntame el estilo que buscas (por ejemplo: japandi cálido, madera clara y negro mate)' });
    const yaHay = t.productos.map(p => [p.nombre, p.estilo, p.material, p.color].filter(Boolean).join(' / ')).slice(0, 12).join('; ');
    const system = 'Eres interiorista de Ranuse Design y buscas productos REALES de mobiliario y decoración en tiendas online (España y envío a España). Prioriza el ESTILO y la coherencia estética sobre el precio. Usa la búsqueda web y devuelve solo productos cuya página de producto hayas visto. Responde SOLO con JSON.';
    const pedido = 'ESTILO: ' + (estilo || 'el que encaje con el espacio') + '\nBUSCO: ' + (busco || 'piezas variadas (silla, mesa, lámpara, complementos)') + '\nESPACIO: ' + (t.espacio || 'sin descripción') + (maxPrecio ? '\nPRECIO MÁXIMO POR PIEZA: ' + maxPrecio + ' €' : '') + (yaHay ? '\nYA TENGO EN EL TABLERO (que combinen con esto): ' + yaHay : '') + '\n\nDevuelve de 6 a 8 productos de tiendas distintas. JSON: {"productos":[{"nombre":"...","tipo":"silla|mesa|sofá|butaca|taburete|lámpara|alfombra|estantería|aparador|espejo|cuadro|planta|otro","tienda":"nombre de la tienda","enlace":"URL https directa a la página del producto","precio":número en euros o 0 si no lo sabes,"material":"...","color":"...","estilo":"...","motivo":"una frase: por qué encaja"}]}';
    const r = await callClaude({ system, messages: [{ role: 'user', content: pedido }], tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }], maxTokens: 4000 });
    const j = /\{[\s\S]*\}/.exec((r.content || []).filter(b => b.type === 'text').map(b => b.text || '').join('')); if (!j) return res.status(502).json({ error: 'La IA no devolvió productos. Inténtalo otra vez.' });
    let lista = (JSON.parse(j[0]).productos || []).filter(p => hostSeguro(String(p.enlace || ''))).slice(0, 8);
    lista = await Promise.all(lista.map(async p => ({ id: uid(), nombre: txt(p.nombre, 90), tipo: txt(p.tipo, 40), tienda: txt(p.tienda, 40), enlace: String(p.enlace).slice(0, 600), precio: num(p.precio), material: txt(p.material, 80), color: txt(p.color, 60), estilo: txt(p.estilo, 80), motivo: txt(p.motivo, 200), imagen: await imagenDe(String(p.enlace)) })));
    if (!lista.length) return res.status(502).json({ error: 'No encontré productos con enlace válido. Prueba con otra descripción.' });
    res.json({ propuestas: lista });
  } catch (e) { console.error('mobiliario buscar:', e); res.status(500).json({ error: 'No se pudo buscar: ' + String(e.message || '').slice(0, 120) }); }
});
// la propuesta elegida pasa al tablero como producto «lo compra el cliente» (la foto se descarga y se guarda)
router.post('/:id/propuesta', async (req, res) => {
  try {
    const t = await leerTablero(req.params.id); if (!t) return res.status(404).json({ error: 'Tablero no encontrado' });
    if (t.productos.length >= 60) return res.status(400).json({ error: 'Máximo 60 productos por tablero' });
    const b = req.body || {}, pid = uid(); let foto = '';
    if (hostSeguro(String(b.imagen || ''))) {
      try {
        const ri = await fetch(b.imagen, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RanuseBot/1.0)' } });
        if (ri.ok) { const buf = await sharp(Buffer.from(await ri.arrayBuffer())).rotate().resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 86 }).toBuffer(); const ruta = CARPETA + '/img/' + t.id + '/' + pid + '.jpg'; const { error } = await supabase.storage.from(BUCKET).upload(ruta, buf, { contentType: 'image/jpeg', upsert: true }); if (!error) foto = urlPublica(ruta); }
      } catch { /* sin foto: se puede subir a mano */ }
    }
    const p = limpiaProducto({ ...b, foto, compra: 'cliente' }, { id: pid, foto });
    t.productos.push(p); t.actualizado = new Date().toISOString(); await guardaJson(rutaTablero(t.id), t); res.status(201).json({ producto: p });
  } catch (e) { console.error('mobiliario propuesta:', e); res.status(500).json({ error: 'No se pudo añadir el producto' }); }
});

// ── la IA propone combinaciones con lo que hay en el tablero
router.post('/:id/combinar', async (req, res) => {
  try {
    const t = await leerTablero(req.params.id); if (!t) return res.status(404).json({ error: 'Tablero no encontrado' });
    if (t.productos.length < 2) return res.status(400).json({ error: 'Sube al menos 2 productos para combinar' });
    const espacio = txt(req.body?.espacio ?? t.espacio, 1200); if (typeof req.body?.espacio === 'string') t.espacio = espacio;
    const n = Math.round(num(req.body?.cantidad, 3, 1, 5)), extra = txt(req.body?.instrucciones, 400);
    const lista = t.productos.map(p => p.id + ' → ' + [p.nombre, p.tipo, p.material, p.color, p.estilo, p.medidas, 'rol ' + p.rol, p.compra === 'ranuse' ? 'lo vende Ranuse' : 'lo compra el cliente', p.nota].filter(Boolean).join(' · ')).join('\n');
    const previas = (t.combinaciones || []).map(c => c.titulo).filter(Boolean).slice(-8);
    const system = 'Eres directora creativa de interiorismo de Ranuse Design (gimnasios, oficinas, espacios comerciales y vivienda). Combinas productos reales que el usuario ha elegido para un espacio concreto. Criterio: coherencia de materiales, contraste de tonos que dé profundidad, una sola protagonista por composición, y respeto a la paleta del espacio. Responde SOLO con JSON.';
    const user = 'ESPACIO: ' + (espacio || 'sin descripción: propón combinaciones versátiles') + '\n' + (extra ? 'PETICIÓN ESPECIAL: ' + extra + '\n' : '') + '\nPRODUCTOS DISPONIBLES (usa exactamente estos ids):\n' + lista + '\n\n' + (previas.length ? 'Ya propuse: ' + previas.join(' | ') + '. No las repitas.\n' : '') + 'Propón ' + n + ' combinaciones MUY distintas entre sí (por ejemplo: una segura y equilibrada, una con contraste atrevido, una cálida). Cada una usa de 2 a 6 productos de la lista (no tienen que entrar todos; si un producto no encaja en ninguna, no lo uses). JSON: {"combinaciones":[{"titulo":"nombre corto","idea":"la idea en una frase","productos":[{"id":"id","rol":"protagonista|apoyo|neutro"}],"paleta":[{"hex":"#RRGGBB","nombre":"nombre del color"}],"porque":"3 frases: por qué funciona en ESTE espacio","evitar":"1-2 frases: qué evitar o qué cuidar"}]}. La paleta tiene de 4 a 5 colores: los de los productos y los del espacio.';
    const r = await callClaude({ system, messages: [{ role: 'user', content: user }], maxTokens: 4500 });
    const j = /\{[\s\S]*\}/.exec((r.content || []).map(b => b.text || '').join('')); if (!j) return res.status(502).json({ error: 'La IA no devolvió combinaciones. Inténtalo otra vez.' });
    const ids = new Set(t.productos.map(p => p.id));
    const nuevas = (JSON.parse(j[0]).combinaciones || []).slice(0, n).map(c => ({ id: uid(), titulo: txt(c.titulo, 90) || 'Combinación', idea: txt(c.idea, 240), porque: txt(c.porque, 700), evitar: txt(c.evitar, 400), moodboard: '', elegida: false, publicada: null,
      productos: (Array.isArray(c.productos) ? c.productos : []).filter(x => ids.has(x.id)).slice(0, 8).map(x => ({ id: x.id, rol: ['protagonista', 'apoyo', 'neutro'].includes(x.rol) ? x.rol : 'apoyo' })),
      paleta: (Array.isArray(c.paleta) ? c.paleta : []).map(q => ({ hex: hexOk(q.hex), nombre: txt(q.nombre, 40) })).filter(q => q.hex).slice(0, 6) })).filter(c => c.productos.length >= 2);
    if (!nuevas.length) return res.status(502).json({ error: 'Ninguna combinación era válida. Inténtalo otra vez.' });
    t.combinaciones = [...(t.combinaciones || []), ...nuevas].slice(-40); t.actualizado = new Date().toISOString(); await guardaJson(rutaTablero(t.id), t);
    res.json({ tablero: t, nuevas: nuevas.map(c => c.id) });
  } catch (e) { console.error('combinador combinar:', e); res.status(500).json({ error: 'No se pudieron crear las combinaciones: ' + String(e.message || '').slice(0, 120) }); }
});

// ── el moodboard se dibuja en el navegador (con la tipografía de la web) y se guarda aquí
router.post('/:id/combinaciones/:cid/moodboard', async (req, res) => {
  try {
    const t = await leerTablero(req.params.id); const c = t && t.combinaciones.find(x => x.id === req.params.cid); if (!c) return res.status(404).json({ error: 'Combinación no encontrada' });
    const m = /^data:image\/png;base64,(.+)$/.exec(String(req.body?.imagen || '')); if (!m) return res.status(400).json({ error: 'Falta la imagen' });
    const buf = await sharp(Buffer.from(m[1], 'base64')).resize({ width: 1800, withoutEnlargement: true }).png({ compressionLevel: 8 }).toBuffer();
    const ruta = CARPETA + '/img/' + t.id + '/mb-' + c.id + '-' + uid() + '.png';
    const { error } = await supabase.storage.from(BUCKET).upload(ruta, buf, { contentType: 'image/png', upsert: true }); if (error) throw error;
    c.moodboard = urlPublica(ruta); t.actualizado = new Date().toISOString(); await guardaJson(rutaTablero(t.id), t); res.json({ moodboard: c.moodboard });
  } catch (e) { console.error('combinador moodboard:', e); res.status(500).json({ error: 'No se pudo guardar el moodboard' }); }
});

// ── publicar una combinación en la historia del cliente (capítulo elegido o uno nuevo)
const lineaProducto = (p) => [p.nombre, p.compra === 'ranuse' ? 'Suministra Ranuse Design' + (precioVenta(p) > 0 ? ' · ' + precioVenta(p).toLocaleString('es-ES') + ' €' : '') : (p.enlace ? 'Comprar: ' + p.enlace : 'Lo compra el cliente')].join(' — ');
router.post('/:id/combinaciones/:cid/publicar', async (req, res) => {
  try {
    const t = await leerTablero(req.params.id); const c = t && t.combinaciones.find(x => x.id === req.params.cid); if (!c) return res.status(404).json({ error: 'Combinación no encontrada' });
    const pid = req.body?.proyectoId || t.proyectoId; if (!pid) return res.status(400).json({ error: 'Elige el proyecto del cliente' });
    if (!c.moodboard) return res.status(400).json({ error: 'Primero crea el moodboard de esta combinación' });
    let capId = String(req.body?.capituloId || '');
    if (capId === 'nuevo' || !capId) {
      const { data: u } = await supabase.from('capitulos').select('orden').eq('proyecto_id', pid).order('orden', { ascending: false }).limit(1).maybeSingle();
      const { data: nuevo, error: eC } = await supabase.from('capitulos').insert({ proyecto_id: pid, titulo: txt(req.body?.tituloCapitulo, 80) || 'Mobiliario y ambientes', orden: (u?.orden ?? 0) + 1, visible: false }).select('id').single(); if (eC) throw eC; capId = nuevo.id;
    } else { const { data: cap } = await supabase.from('capitulos').select('id, proyecto_id').eq('id', capId).maybeSingle(); if (!cap || cap.proyecto_id !== pid) return res.status(404).json({ error: 'Ese capítulo no es de este proyecto' }); }
    const rf = await fetch(c.moodboard); if (!rf.ok) throw new Error('No se pudo leer el moodboard');
    const url = await uploadProjectRender(Buffer.from(await rf.arrayBuffer()), 'moodboard.png', 'image/png', pid);
    const prods = c.productos.map(x => t.productos.find(p => p.id === x.id)).filter(Boolean), tot = totales(c, t.productos);
    const texto = [c.idea, c.porque, '', ...prods.map(lineaProducto), '', tot.ranuse > 0 ? 'A cargo de Ranuse Design: ' + tot.ranuse.toLocaleString('es-ES') + ' €' : '', tot.cliente > 0 ? 'Compra del cliente (estimado): ' + tot.cliente.toLocaleString('es-ES') + ' €' : ''].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n').slice(0, 1000);
    const { data: ult } = await supabase.from('capitulo_bloques').select('orden').eq('capitulo_id', capId).order('orden', { ascending: false }).limit(1).maybeSingle();
    const { data: bloque, error } = await supabase.from('capitulo_bloques').insert({ tipo: 'render', titulo: c.titulo, texto, imagen_url: url, visible: true, proyecto_id: pid, capitulo_id: capId, orden: (ult?.orden ?? 0) + 1 }).select('*').single(); if (error) throw error;
    c.publicada = { capituloId: capId, bloqueId: bloque.id, en: new Date().toISOString() }; t.actualizado = new Date().toISOString(); await guardaJson(rutaTablero(t.id), t);
    res.json({ ok: true, bloque, combinacion: c });
  } catch (e) { console.error('combinador publicar:', e); res.status(500).json({ error: 'No se pudo publicar en la historia: ' + String(e.message || '').slice(0, 120) }); }
});

// ── lo que vende Ranuse entra en un presupuesto como partidas (coste, margen y precio de venta)
router.post('/:id/combinaciones/:cid/presupuesto', async (req, res) => {
  try {
    const t = await leerTablero(req.params.id); const c = t && t.combinaciones.find(x => x.id === req.params.cid); if (!c) return res.status(404).json({ error: 'Combinación no encontrada' });
    const budgetId = String(req.body?.budgetId || ''); const { data: b } = await supabase.from('budgets').select('id').eq('id', budgetId).maybeSingle(); if (!b) return res.status(404).json({ error: 'Presupuesto no encontrado' });
    const prods = c.productos.map(x => t.productos.find(p => p.id === x.id)).filter(p => p && p.compra === 'ranuse'); if (!prods.length) return res.status(400).json({ error: 'Esta combinación no tiene productos que venda Ranuse' });
    const { data: u } = await supabase.from('budget_items').select('display_order').eq('budget_id', budgetId).order('display_order', { ascending: false }).limit(1).maybeSingle();
    let orden = (u?.display_order ?? 0);
    const base = { budget_id: budgetId, unit: 'ud', discount_pct: 0, pricing_mode: 'margin', category: 'otro' };
    const filas = [{ ...base, name: 'MOBILIARIO Y AMBIENTACIÓN · ' + c.titulo.toUpperCase().slice(0, 50), is_chapter_header: true, nivel_capitulo: 1, quantity: 1, unit_cost: 0, markup_pct: 0, unit_price: 0, display_order: ++orden }];
    for (const p of prods) { const pv = precioVenta(p); filas.push({ ...base, category: 'material', name: p.nombre, is_chapter_header: false, quantity: Number(p.cantidad) || 1, unit_cost: Number(p.costo) || 0, markup_pct: Number(p.margen) || 0, unit_price: pv, display_order: ++orden, order_status: 'pendiente', payment_status: 'pendiente', image_url: p.foto, descripcion_cliente: [p.tipo, p.material, p.color, p.medidas].filter(Boolean).join(' · ') || null }); }
    const { error } = await supabase.from('budget_items').insert(filas); if (error) throw error;
    res.json({ ok: true, partidas: prods.length });
  } catch (e) { console.error('combinador presupuesto:', e); res.status(500).json({ error: 'No se pudo añadir al presupuesto: ' + String(e.message || '').slice(0, 120) }); }
});

// ── PDF solo de las combinaciones elegidas
async function bufDe(url) { try { const r = await fetch(url); if (!r.ok) return null; return await sharp(Buffer.from(await r.arrayBuffer())).rotate().resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer(); } catch { return null; } }
router.post('/:id/pdf', async (req, res) => {
  try {
    const t = await leerTablero(req.params.id); if (!t) return res.status(404).json({ error: 'Tablero no encontrado' });
    const sel = new Set(Array.isArray(req.body?.combinaciones) ? req.body.combinaciones : []);
    const combos = (t.combinaciones || []).filter(c => !sel.size || sel.has(c.id)); if (!combos.length) return res.status(400).json({ error: 'No hay combinaciones para el PDF' });
    const W = 595, H = 842, mg = 40, OSC = '#1e1b18', GRIS = '#6b6560', ORO = '#c9a46c';
    const doc = new PDFDocument({ margin: 0, size: 'A4' }); const trozos = []; doc.on('data', c => trozos.push(c));
    const fin = new Promise(ok => doc.on('end', ok));
    const logo = path.join(__dirname, '..', 'Icono Blanco.png'), eur = n => Number(n).toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €';
    const cabecera = (titulo, sub) => {
      doc.rect(0, 0, W, 62).fill(OSC); try { doc.image(logo, mg, 12, { height: 38 }); } catch { /* sin logo */ }
      doc.fillColor('#9a948d').fontSize(8).font('Helvetica').text('PROPUESTA DE MOBILIARIO Y AMBIENTACIÓN', 0, 18, { align: 'right', width: W - mg });
      doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold').text(String(t.proyecto || t.nombre || '').slice(0, 60), 0, 32, { align: 'right', width: W - mg });
      doc.fillColor(OSC).fontSize(18).font('Helvetica').text(titulo, mg, 84, { width: W - mg * 2 });
      if (sub) doc.fillColor(GRIS).fontSize(9).font('Helvetica').text(sub, mg, 110, { width: W - mg * 2 });
    };
    for (let i = 0; i < combos.length; i++) {
      const c = combos[i]; if (i) doc.addPage();
      const prods = c.productos.map(x => t.productos.find(p => p.id === x.id)).filter(Boolean), tot = totales(c, t.productos);
      cabecera(c.titulo, c.idea); let y = 140;
      if (c.moodboard) { const mb = await bufDe(c.moodboard); if (mb) { const h0 = Math.min(300, (W - mg * 2) * 0.62); try { doc.image(mb, mg, y, { fit: [W - mg * 2, h0], align: 'center' }); } catch { /* imagen no válida */ } y += h0 + 12; } }
      if (c.paleta?.length) { c.paleta.forEach((q, k) => { doc.roundedRect(mg + k * 62, y, 56, 22, 4).fill(q.hex); doc.fillColor(GRIS).fontSize(6.5).font('Helvetica').text(q.nombre || q.hex, mg + k * 62, y + 25, { width: 56, align: 'center' }); }); y += 42; }
      doc.fillColor(OSC).fontSize(8.5).font('Helvetica-Bold').text('POR QUÉ FUNCIONA', mg, y); y += 12;
      doc.fillColor('#444').fontSize(8.5).font('Helvetica').text(c.porque || '', mg, y, { width: W - mg * 2 }); y += doc.heightOfString(c.porque || '', { width: W - mg * 2 }) + 8;
      if (c.evitar) { doc.fillColor(OSC).fontSize(8.5).font('Helvetica-Bold').text('QUÉ CUIDAR', mg, y); y += 12; doc.fillColor('#444').fontSize(8.5).font('Helvetica').text(c.evitar, mg, y, { width: W - mg * 2 }); y += doc.heightOfString(c.evitar, { width: W - mg * 2 }) + 10; }
      doc.moveTo(mg, y).lineTo(W - mg, y).strokeColor('#ddd').lineWidth(0.5).stroke(); y += 10;
      for (const p of prods) {
        if (y > H - 110) { doc.addPage(); cabecera(c.titulo + ' (continúa)', ''); y = 140; }
        const fb = p.foto ? await bufDe(p.foto) : null; doc.roundedRect(mg, y, 62, 62, 4).strokeColor('#e5dfd6').lineWidth(0.5).stroke();
        if (fb) { try { doc.image(fb, mg + 2, y + 2, { fit: [58, 58], align: 'center', valign: 'center' }); } catch { /* sin foto */ } }
        doc.fillColor(OSC).fontSize(9.5).font('Helvetica-Bold').text(p.nombre + (p.cantidad > 1 ? ' × ' + p.cantidad : ''), mg + 74, y + 2, { width: 300 });
        doc.fillColor(GRIS).fontSize(7.5).font('Helvetica').text([p.tipo, p.material, p.color, p.medidas].filter(Boolean).join(' · '), mg + 74, y + 16, { width: 300 });
        if (p.compra === 'ranuse') { doc.fillColor(ORO).fontSize(8).font('Helvetica-Bold').text('Suministra Ranuse Design', mg + 74, y + 34); if (precioVenta(p) > 0) doc.fillColor(OSC).fontSize(10).font('Helvetica-Bold').text(eur(precioVenta(p) * (p.cantidad || 1)), W - mg - 110, y + 4, { width: 110, align: 'right' }); }
        else { doc.fillColor(GRIS).fontSize(8).font('Helvetica').text('Lo compra el cliente', mg + 74, y + 34); if (p.precio > 0) doc.fillColor(OSC).fontSize(10).font('Helvetica-Bold').text('≈ ' + eur(p.precio * (p.cantidad || 1)), W - mg - 110, y + 4, { width: 110, align: 'right' }); if (p.enlace) doc.fillColor('#1b6dd6').fontSize(7.5).font('Helvetica').text('Comprar → ' + p.enlace.replace(/^https?:\/\//, '').slice(0, 60), mg + 74, y + 47, { width: 330, link: p.enlace, underline: true }); }
        y += 74;
      }
      if (tot.ranuse > 0 || tot.cliente > 0) {
        if (y > H - 80) { doc.addPage(); cabecera(c.titulo + ' (continúa)', ''); y = 140; }
        doc.rect(mg, y, W - mg * 2, tot.ranuse > 0 && tot.cliente > 0 ? 44 : 28).fill('#f5f3f0');
        let yy = y + 8; if (tot.ranuse > 0) { doc.fillColor(OSC).fontSize(9).font('Helvetica').text('A cargo de Ranuse Design (sin IVA)', mg + 10, yy); doc.font('Helvetica-Bold').text(eur(tot.ranuse), mg, yy, { width: W - mg * 2 - 10, align: 'right' }); yy += 15; }
        if (tot.cliente > 0) { doc.fillColor(OSC).fontSize(9).font('Helvetica').text('Compra del cliente (precio de referencia)', mg + 10, yy); doc.font('Helvetica-Bold').text('≈ ' + eur(tot.cliente), mg, yy, { width: W - mg * 2 - 10, align: 'right' }); }
      }
      doc.fillColor('#999').fontSize(7).font('Helvetica').text('Ranuse Design · los precios de referencia de los productos que compra el cliente pueden variar según la tienda.', mg, H - 30, { width: W - mg * 2, align: 'center' });
    }
    doc.end(); await fin;
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="combinaciones.pdf"' }); res.send(Buffer.concat(trozos));
  } catch (e) { console.error('combinador pdf:', e); if (!res.headersSent) res.status(500).json({ error: 'No se pudo crear el PDF' }); }
});

export default router;
