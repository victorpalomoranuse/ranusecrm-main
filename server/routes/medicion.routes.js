import express from 'express';
import sharp from 'sharp';
import compression from 'compression';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission, requireAdminSuperior } from '../middleware/auth.middleware.js';
import { cantidadesDePlano } from '../utils/planos.js';
import { disenadorDe, proyectoEsDe, proyectosDe } from '../utils/asignados.js';
import { generarBloquesAuto } from '../utils/bloques-auto.js';
import { catalogoEnCache, guardaCatalogo, vaciaCacheAlEscribir } from '../utils/cache-catalogos.js';
import { callClaude } from '../utils/anthropic.js';
import { urlSketchup } from './medicion-sketchup.routes.js';
import { uploadReferenceImageFile, handleMulterError } from '../middleware/upload.middleware.js';
import { indiceBiblioteca3d } from './biblioteca3d.routes.js';

// Herramienta de medición en obra: guarda los planos por proyecto y le sirve el
// catálogo del CRM (máquinas y luminarias) para colocarlas en el plano.

const router = express.Router();
router.use(authenticateToken, requirePermission('proyectos'));
router.use((req, res, next) => { if (/^\/biblioteca/.test(req.path)) return vaciaCacheAlEscribir(req, res, next); next(); });

// Diseñadores: solo planos de proyectos que tienen asignados (o que han creado ellos)
async function planoPermitido(req, planoId) {
  const emp = await disenadorDe(req);
  if (!emp) return true;
  const { data } = await supabase.from('mediciones').select('project_id, created_by').eq('id', planoId).maybeSingle();
  if (!data) return true; // plano nuevo
  if (data.created_by === req.user.id) return true;
  return !!data.project_id && proyectoEsDe(emp, data.project_id);
}
router.param('id', async (req, res, next, id) => {
  try {
    if (!/^\/[^/]+(\/sketchup)?$/.test(req.path)) return next(); // solo /:id y /:id/sketchup (los planos)
    if (await planoPermitido(req, id)) return next();
    return res.status(403).json({ error: 'Este plano es de un proyecto que no tienes asignado.' });
  } catch (e) { console.error('guardia plano:', e); return res.status(500).json({ error: 'No se pudo comprobar el acceso al plano' }); }
});
async function proyectoPermitido(req, projectId) {
  const emp = await disenadorDe(req);
  return !emp || proyectoEsDe(emp, projectId);
}

// ── Catálogo → herramienta ─────────────────────────────────────────────────
const SIMBOLO_MAQUINA = [
  [/cinta/i, 'cinta'], [/banco/i, 'banco'], [/mancuerna/i, 'manc'], [/bici|spinning|ciclo/i, 'bici'],
  [/remo/i, 'remo'], [/rack|jaula/i, 'rack'], [/suelo|tatami|c[eé]sped/i, 'tatami'],
];
// Categorías de "máquina grande" que merece la pena colocar en un plano aunque aún no tengan medidas
const CATEGORIA_COLOCABLE = /m[aá]quina|cinta|bici|remo|rack|jaula|banco|all in one|skier|polea|trineo|saco|almacenamiento/i;

function simboloMaquina(cat) {
  for (const [re, s] of SIMBOLO_MAQUINA) if (re.test(cat || '')) return s;
  return 'gen';
}
function simboloLuminaria(cat, nombre) {
  const t = `${cat || ''} ${nombre || ''}`.toLowerCase();
  if (/lineal|linear/.test(t)) return /colgante|pendant|suspend/.test(t) ? 'linealc' : 'lineal';
  if (/panel|rectangular/.test(t)) return 'panel';
  if (/perfil|tira|strip/.test(t)) return 'led';
  if (/carril|track/.test(t)) return 'carril';
  if (/colgante|pendant|suspend/.test(t)) return 'colg';
  if (/aplique|pared/.test(t)) return 'aplq';
  if (/plaf[oó]n|superficie/.test(t)) return 'plaf';
  return 'foco';
}

const cacheFotos = new Map();
async function fotoMiniatura(url, conColor = false) {
  if (!url) return null;
  const clave = url + (conColor ? '|c' : '');
  if (cacheFotos.has(clave)) return cacheFotos.get(clave);
  let r = null;
  try {
    const resp = await fetch(url);
    if (resp.ok) {
      const buf = Buffer.from(await resp.arrayBuffer());
      const { data, info } = await sharp(buf).rotate().resize(160, 160, { fit: 'inside' }).flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer({ resolveWithObject: true });
      r = { uri: `data:image/jpeg;base64,${data.toString('base64')}`, pw: info.width, ph: info.height };
      if (conColor) { // color medio de la muestra (para el PDF y para rellenar sin textura)
        const px = await sharp(buf).resize(1, 1).removeAlpha().raw().toBuffer();
        r.c = '#' + [...px].slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('');
      }
    }
  } catch { /* sin foto */ }
  cacheFotos.set(clave, r);
  return r;
}
const limpiarCategoria = (n) => String(n || '').replace(/^[A-Z]?\.?\d+\.*\s*/, '').trim();
const ES_MATERIAL = /suelo|pavimento|c[eé]sped|madera|pintura|revestimiento|techo|acabado|parquet|microcemento|caucho/i;

// ── Crear un bloque a partir de una imagen pegada en el plano ──────────────
// No guarda nada: devuelve planta, alzado y lateral para que se revisen y se guarden en la biblioteca.
router.post('/bloque-ia', async (req, res) => {
  try {
    const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.imagen || ''));
    if (!m) return res.status(400).json({ error: 'La imagen no es válida (usa PNG, JPG o WebP)' });
    const imagen = Buffer.from(m[2], 'base64');
    if (imagen.length > 12 * 1024 * 1024) return res.status(400).json({ error: 'La imagen pesa demasiado' });
    // más fotos del mismo producto (de frente, de lado, en perspectiva): con ellas el dibujo sale mucho mejor
    const imagenes = [imagen];
    for (const d of (Array.isArray(req.body?.imagenes) ? req.body.imagenes.slice(0, 4) : [])) {
      const mm = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(d || ''));
      if (!mm || mm[2] === m[2]) continue;
      const b = Buffer.from(mm[2], 'base64');
      if (b.length <= 12 * 1024 * 1024) imagenes.push(b);
    }
    let largo = Number(req.body.largo), fondo = Number(req.body.fondo), alto = Number(req.body.alto);
    const nombre = String(req.body.nombre || '').slice(0, 120);
    let estimadas = false;
    if (![largo, fondo, alto].every(n => n > 0 && n <= 5000)) {
      // sin medidas: la IA las estima viendo la foto (hay que revisarlas)
      const tipo = m[1] === 'png' ? 'image/png' : m[1] === 'webp' ? 'image/webp' : 'image/jpeg';
      const r = await callClaude({
        system: 'Eres un técnico de equipamiento de gimnasios y mobiliario. Te enseñan la foto de un objeto y estimas sus medidas reales típicas en centímetros. Responde SOLO con un JSON: {"largo":n,"fondo":n,"alto":n}. largo = lado más largo visto de frente (ancho), fondo = profundidad de delante a atrás, alto = altura total.',
        maxTokens: 200,
        messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: tipo, data: m[2] } }, { type: 'text', text: 'Objeto: ' + (nombre || 'sin nombre') + '. Estima largo, fondo y alto en cm.' }] }],
      });
      const txt = (r.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
      let j = null;
      try { j = JSON.parse((txt.match(/\{[\s\S]*\}/) || [''])[0]); } catch { /* sin medidas */ }
      largo = Number(j?.largo); fondo = Number(j?.fondo); alto = Number(j?.alto);
      if (![largo, fondo, alto].every(n => n > 0 && n <= 5000)) return res.status(422).json({ error: 'No se pudieron estimar las medidas: escríbelas tú' });
      estimadas = true;
    }
    const b = await generarBloquesAuto({ imagen, imagenes, largo, fondo, alto, nombre });
    if (!b?.svg?.planta) return res.status(422).json({ error: 'No se pudo sacar un dibujo de esa imagen. Prueba con otra foto, con el objeto bien visible y fondo limpio.' });
    res.json({ bloque: { largo, fondo, alto, estimadas, svg: { planta: b.svg.planta || '', alzado: b.svg.alzado || '', lateral: b.svg.lateral || '' }, metodo: b.metodo || null, nota: b.nota || '' } });
  } catch (err) {
    console.error('medicion bloque-ia:', err);
    res.status(500).json({ error: err.message?.includes('clave de la IA') ? err.message : 'No se pudo generar el bloque. Inténtalo de nuevo.' });
  }
});

// ── Plano del cliente (imagen o PDF ya convertido a imagen) → estado actual ──
// La IA lee el plano y devuelve muros, puertas, ventanas y pilares en PÍXELES de la imagen enviada,
// más cotas de referencia para sacar la escala. No guarda nada: la herramienta lo dibuja y se ajusta a mano.
const TOOL_PLANO = {
  name: 'entregar_plano',
  description: 'Entrega el plano leído: muros, huecos y pilares en píxeles de la imagen, y cotas de referencia para la escala.',
  input_schema: {
    type: 'object',
    properties: {
      muros: { type: 'array', description: 'Segmentos de muro (eje central). Los muros que se encuentran DEBEN compartir exactamente las mismas coordenadas en el punto de unión. Incluye el perímetro y los tabiques interiores.', items: { type: 'object', properties: { x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' }, espesor_px: { type: 'number' } }, required: ['x1', 'y1', 'x2', 'y2'] } },
      puertas: { type: 'array', items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, ancho_px: { type: 'number', description: 'Ancho del hueco en píxeles' }, ancho_cm: { type: 'number', description: 'Si el plano lo indica o es una puerta típica' } }, required: ['x', 'y'] } },
      ventanas: { type: 'array', items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, ancho_px: { type: 'number' }, ancho_cm: { type: 'number' } }, required: ['x', 'y'] } },
      pilares: { type: 'array', items: { type: 'object', properties: { x: { type: 'number', description: 'Centro' }, y: { type: 'number' }, ancho_px: { type: 'number' }, fondo_px: { type: 'number' } }, required: ['x', 'y', 'ancho_px', 'fondo_px'] } },
      escala: { type: 'array', description: 'Cotas escritas en el plano que midas sobre la imagen (de punto a punto), para calcular cm por píxel. Mínimo 2 si las hay.', items: { type: 'object', properties: { x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' }, cm: { type: 'number' } }, required: ['x1', 'y1', 'x2', 'y2', 'cm'] } },
      aviso: { type: 'string', description: 'Dudas o partes que no se leen bien (en español, breve).' },
    },
    required: ['muros'],
  },
};
router.post('/plano-ia', async (req, res) => {
  try {
    const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.imagen || ''));
    if (!m) return res.status(400).json({ error: 'La imagen no es válida (usa PNG, JPG o WebP)' });
    if (Buffer.from(m[2], 'base64').length > 12 * 1024 * 1024) return res.status(400).json({ error: 'La imagen pesa demasiado' });
    const w = Math.round(Number(req.body.w)), h = Math.round(Number(req.body.h));
    if (!(w > 50 && w <= 4000 && h > 50 && h <= 4000)) return res.status(400).json({ error: 'Faltan las dimensiones de la imagen' });
    const tipo = m[1] === 'png' ? 'image/png' : m[1] === 'webp' ? 'image/webp' : 'image/jpeg';
    const r = await callClaude({
      system: 'Eres un delineante que pasa a limpio planos de planta de locales. Recibes la imagen de un plano que entrega un cliente y la transcribes con la herramienta entregar_plano. Reglas: las coordenadas son PÍXELES de la imagen (origen arriba-izquierda, x a la derecha, y hacia abajo); la imagen mide ' + w + ' x ' + h + ' px. Dibuja cada muro como un segmento sobre su eje central; los muros que se unen comparten exactamente el mismo punto. Divide un muro largo donde otro tabique se une a él. No inventes muros que no se ven; ignora muebles, cotas, textos, marco y cajetín. Puertas y ventanas: centro del hueco sobre el muro y su ancho. Pilares: solo los macizos dibujados dentro del local. En "escala" pon 2 a 4 cotas escritas en el plano (preferiblemente largas y en direcciones distintas), midiendo con cuidado sus extremos sobre la imagen. Si no hay ninguna cota legible, deja escala vacío.',
      maxTokens: 12000,
      tools: [TOOL_PLANO],
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: tipo, data: m[2] } }, { type: 'text', text: 'Transcribe este plano de la planta con entregar_plano.' + (req.body.nota ? ' Nota de quien lo sube: ' + String(req.body.nota).slice(0, 300) : '') }] }],
    });
    const uso = (r.content || []).find(c => c.type === 'tool_use' && c.name === 'entregar_plano');
    const p = uso?.input;
    if (!p || !Array.isArray(p.muros) || !p.muros.length) return res.status(422).json({ error: 'La IA no ha podido leer muros en ese plano. Prueba con una imagen más nítida o recortada solo a la planta.' });
    const n = (v) => Number.isFinite(Number(v)) ? Number(v) : null;
    const lista = (a, campos, max) => (Array.isArray(a) ? a : []).slice(0, max).map(o => {
      const r2 = {}; for (const c of campos) r2[c] = n(o?.[c]); return r2;
    }).filter(o => campos.every(c => c === 'cm' || c.startsWith('ancho') || c === 'fondo_px' || c === 'espesor_px' || o[c] !== null));
    res.json({
      w, h,
      muros: lista(p.muros, ['x1', 'y1', 'x2', 'y2', 'espesor_px'], 400),
      puertas: lista(p.puertas, ['x', 'y', 'ancho_px', 'ancho_cm'], 100),
      ventanas: lista(p.ventanas, ['x', 'y', 'ancho_px', 'ancho_cm'], 100),
      pilares: lista(p.pilares, ['x', 'y', 'ancho_px', 'fondo_px'], 100),
      escala: lista(p.escala, ['x1', 'y1', 'x2', 'y2', 'cm'], 8).filter(o => o.cm > 0),
      aviso: String(p.aviso || '').slice(0, 400),
    });
  } catch (err) {
    console.error('medicion plano-ia:', err);
    res.status(500).json({ error: err.message?.includes('clave de la IA') ? err.message : 'No se pudo leer el plano. Inténtalo de nuevo.' });
  }
});

// ── Biblioteca propia de bloques (importados desde DXF, etc.) ─────────────
const ETIQUETAS_PLANTA = new Set(['path', 'g', 'line', 'rect', 'circle', 'polygon']);
function plantaValida(frag) {
  if (typeof frag !== 'string' || !frag || frag.length > 120000) return false;
  const etiquetas = [...frag.matchAll(/<\s*\/?\s*([a-zA-Z][\w:-]*)/g)].map(m => m[1].toLowerCase());
  if (!etiquetas.length || etiquetas.some(t => !ETIQUETAS_PLANTA.has(t))) return false;
  return !/on\w+\s*=|javascript:|<\s*script|href\s*=|url\s*\(/i.test(frag);
}
function itemBiblioteca(r) {
  const vistas = [r.planta && 'planta', r.alzado && 'alzado', r.lado && 'lateral'].filter(Boolean);
  return {
    id: 'bib-' + r.id, nombre: r.nombre, tipo: 'gen', w: Number(r.largo), d: Number(r.fondo), alto: Number(r.alto) || null,
    categoria: r.categoria || 'Mi biblioteca', ref: r.origen || 'Biblioteca propia', biblioteca: true, vistas,
    ...(r.planta ? { bloque: { planta: r.planta, largo: Number(r.largo), fondo: Number(r.fondo) } } : {}),
  };
}
const COLS_BIB = 'id, nombre, categoria, largo, fondo, alto, planta, alzado, lado, origen';
// Supabase devuelve como mucho 1000 filas por consulta: se pide por páginas para que, cuando la biblioteca pase de mil bloques, no desaparezcan los últimos
async function pedirBiblioteca(columnas) {
  const filas = [];
  for (let desde = 0; desde < 20000; desde += 1000) {
    const { data, error } = await supabase.from('biblioteca_bloques').select(columnas).order('categoria').order('nombre').order('id').range(desde, desde + 999);
    if (error) return { error };
    filas.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return { data: filas };
}
async function cargarBiblioteca() {
  // En el catálogo solo viaja la planta; el alzado y el lateral se piden al colocarlos (/bloque/:id)
  const { data, error } = await pedirBiblioteca('id, nombre, categoria, largo, fondo, alto, planta, origen, alzado, lado');
  if (error) { // si la tabla aún no tiene las columnas de vistas (v73), se sigue con la planta
    const { data: d2, error: e2 } = await pedirBiblioteca('id, nombre, categoria, largo, fondo, alto, planta, origen');
    return e2 ? [] : (d2 || []).map(itemBiblioteca);
  }
  return (data || []).map(r => itemBiblioteca(r));
}
router.post('/biblioteca', async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 60) : [];
    const filas = [];
    for (const it of items) {
      const nombre = String(it?.nombre || '').trim().slice(0, 120);
      const largo = Number(it?.largo), fondo = Number(it?.fondo);
      const vistas = ['planta', 'alzado', 'lateral'];
      if (!nombre || !(largo >= 1 && largo <= 5000 && fondo >= 1 && fondo <= 5000)) continue;
      if (vistas.some(v => it?.[v] && !plantaValida(it[v])) || !vistas.some(v => it?.[v])) continue;
      filas.push({
        nombre, categoria: String(it.categoria || 'Mi biblioteca').trim().slice(0, 60) || 'Mi biblioteca',
        largo, fondo, alto: Number(it.alto) > 0 ? Number(it.alto) : 100,
        planta: it.planta || null, alzado: it.alzado || null, lado: it.lateral || null,
        origen: String(it.origen || 'Biblioteca propia').slice(0, 80), created_by: req.user?.id || null,
      });
    }
    if (!filas.length) return res.status(400).json({ error: 'No hay bloques válidos que guardar' });
    const { data, error } = await supabase.from('biblioteca_bloques').insert(filas).select(COLS_BIB);
    if (error) throw error;
    res.json({ items: (data || []).map(r => ({ ...itemBiblioteca(r), completo: { largo: Number(r.largo), fondo: Number(r.fondo), alto: Number(r.alto), svg: { planta: r.planta || '', alzado: r.alzado || '', lateral: r.lado || '' } } })) });
  } catch (err) {
    console.error('medicion biblioteca:', err);
    res.status(500).json({ error: 'No se pudieron guardar los bloques. ¿Están creadas las tablas de la biblioteca (migraciones v72 y v73)?' });
  }
});
// Cambiar el nombre o las categorías de una pieza de la biblioteca: solo el administrador
router.patch('/biblioteca/:id', requireAdminSuperior, async (req, res) => {
  try {
    const cambios = {};
    if (typeof req.body?.categoria === 'string') {
      const c = req.body.categoria.trim().slice(0, 200);
      if (!c) return res.status(400).json({ error: 'La categoría no puede estar vacía' });
      cambios.categoria = c;
    }
    if (typeof req.body?.nombre === 'string') {
      const n = req.body.nombre.trim().slice(0, 120);
      if (!n) return res.status(400).json({ error: 'El nombre no puede estar vacío' });
      cambios.nombre = n;
    }
    if (!Object.keys(cambios).length) return res.status(400).json({ error: 'Nada que cambiar' });
    const { data, error } = await supabase.from('biblioteca_bloques').update(cambios).eq('id', req.params.id).select('id, nombre, categoria').single();
    if (error) throw error;
    res.json({ ok: true, id: 'bib-' + data.id, nombre: data.nombre, categoria: data.categoria });
  } catch (err) {
    console.error('medicion biblioteca patch:', err);
    res.status(500).json({ error: 'No se pudo cambiar la pieza de la biblioteca' });
  }
});
router.delete('/biblioteca/:id', requireAdminSuperior, async (req, res) => {
  try {
    const { error } = await supabase.from('biblioteca_bloques').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo quitar el bloque de la biblioteca' });
  }
});

router.get('/catalogos', compression(), async (req, res) => { // comprimido: la biblioteca propia puede traer cientos de bloques
  try {
    const claveCat = req.user?.role === 'admin_superior' ? 'admin' : 'resto';
    const enCache = catalogoEnCache(claveCat);
    if (enCache) return res.json(enCache);
    const columnas = 'id, name, brand, category_id, longitud, ancho, altura, lumens, watts, color_temperature, photo_url, display_order, link';
    const pedirProductos = (cols) => supabase.from('catalog_products').select(cols).order('display_order', { ascending: true, nullsFirst: false });
    const [{ data: cats }, conBloques] = await Promise.all([
      supabase.from('catalog_categories').select('id, name, type'),
      pedirProductos(columnas + ', bloques'),
    ]);
    // Si la columna "bloques" aún no existe en la base de datos, se sigue sin ella
    const prods = conBloques.error ? (await pedirProductos(columnas)).data : conBloques.data;
    const catPorId = Object.fromEntries((cats || []).map(c => [c.id, c]));

    const maquinas = [];
    const luminariasBase = [];
    for (const p of prods || []) {
      const cat = catPorId[p.category_id];
      if (!cat) continue;
      if (cat.type === 'mobiliario') {
        const tieneMedidas = p.longitud > 0 && p.ancho > 0;
        if (!tieneMedidas && !CATEGORIA_COLOCABLE.test(cat.name)) continue;
        maquinas.push({
          id: p.id,
          nombre: p.name,
          tipo: simboloMaquina(cat.name),
          w: tieneMedidas ? Number(p.longitud) : 100,
          d: tieneMedidas ? Number(p.ancho) : 80,
          categoria: limpiarCategoria(cat.name) || 'Equipamiento',
          marca: p.brand ? String(p.brand).trim() : '',
          ref: [p.brand, cat.name].filter(Boolean).join(' · '),
          sinMedidas: !tieneMedidas,
          // dibujo real de la planta (si el producto tiene bloque), a escala en cm
          foto: p.photo_url || null,
          paso: p.bloques?.paso || null,
          enlace: /^https?:\/\//i.test(p.link || '') ? p.link : null,
          skp: p.bloques?.skp?.url ? { url: p.bloques.skp.url, rot: Number(p.bloques.skp.rot) || 0 } : null,
          modelo3d: p.bloques?.modelo3d?.url ? { url: p.bloques.modelo3d.url, tipo: p.bloques.modelo3d.tipo || 'glb', rot: Number(p.bloques.modelo3d.rot) || 0 } : null,
          alto: Number(p.altura) > 0 ? Number(p.altura) : null,
          ...(p.bloques?.svg?.planta ? {
            bloque: { planta: p.bloques.svg.planta, largo: p.bloques.largo, fondo: p.bloques.fondo },
            vistas: ['planta', ...(p.bloques.svg.alzado ? ['alzado'] : []), ...(p.bloques.svg.lateral ? ['lateral'] : [])],
          } : (p.bloques?.svg?.alzado || p.bloques?.svg?.lateral) ? {
            vistas: [...(p.bloques.svg.alzado ? ['alzado'] : []), ...(p.bloques.svg.lateral ? ['lateral'] : [])],
          } : {}),
        });
      } else if (cat.type === 'iluminacion') {
        luminariasBase.push({ p, cat });
      }
    }
    maquinas.sort((a, b) => Number(a.sinMedidas) - Number(b.sinMedidas)); // primero las que ya tienen medidas
    maquinas.push(...await cargarBiblioteca());
    const luminarias = await Promise.all(luminariasBase.map(async ({ p, cat }) => {
      const foto = await fotoMiniatura(p.photo_url);
      const k = parseInt(String(p.color_temperature || '').replace(/[^\d]/g, ''), 10);
      return {
        id: p.id, ref: p.brand || '', n: p.name, sym: simboloLuminaria(cat.name, p.name),
        lm: p.lumens || 0, w: Number(p.watts) || 0, k: Number.isFinite(k) ? k : 0,
        ...(foto || {}),
      };
    }));
    // Materiales con foto → texturas para suelos, techos y paredes
    const materialesBase = (prods || []).filter(p => p.photo_url && catPorId[p.category_id] && (catPorId[p.category_id].type === 'material' || ES_MATERIAL.test(catPorId[p.category_id].name)) && catPorId[p.category_id].type !== 'iluminacion');
    const materiales = (await Promise.all(materialesBase.map(async p => {
      const foto = await fotoMiniatura(p.photo_url, true);
      if (!foto) return null;
      return { id: p.id, n: p.name, cat: limpiarCategoria(catPorId[p.category_id].name), tw: Number(p.ancho) > 5 && Number(p.ancho) < 500 ? Number(p.ancho) : 60, ...foto };
    }))).filter(Boolean);
    // Todos los productos (ligeros) para la memoria de calidades: mecanismos, grifería, sanitarios…
    const productos = (prods || []).map(p => {
      const cat = catPorId[p.category_id];
      return cat ? { id: p.id, n: p.name, m: p.brand || '', c: limpiarCategoria(cat.name), t: cat.type } : null;
    }).filter(Boolean).slice(0, 4000);
    const cuerpo = { maquinas, luminarias, materiales, productos, admin: req.user?.role === 'admin_superior' };
    guardaCatalogo(claveCat, cuerpo);
    res.json(cuerpo);
  } catch (err) {
    console.error('medicion/catalogos:', err);
    res.status(500).json({ error: 'No se pudo cargar el catálogo' });
  }
});

// ── Dashboard de planos (todos, con o sin proyecto) ────────────────────────
// Miniaturas (data URI) de productos para la memoria de calidades
router.post('/miniaturas', async (req, res) => {
  try {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter(x => typeof x === 'string').slice(0, 40);
    if (!ids.length) return res.json({ items: {} });
    const { data, error } = await supabase.from('catalog_products').select('id, photo_url').in('id', ids);
    if (error) throw error;
    const items = {};
    await Promise.all((data || []).map(async p => { const f = await fotoMiniatura(p.photo_url); if (f) items[p.id] = f; }));
    res.json({ items });
  } catch (err) {
    console.error('medicion miniaturas:', err);
    res.status(500).json({ error: 'No se pudieron cargar las fotos' });
  }
});

router.get('/dashboard', async (req, res) => {
  try {
    const { data, error } = await supabase.from('mediciones')
      .select('id, project_id, nombre, cliente, resumen, created_by, updated_by, created_at, updated_at, project:client_projects(id, client_name, project_name, client_address)')
      .order('updated_at', { ascending: false }).limit(500);
    if (error) throw error;
    const ids = [...new Set((data || []).flatMap(m => [m.updated_by, m.created_by]).filter(Boolean))];
    const nombres = {};
    if (ids.length) {
      const [{ data: emp }, { data: usr }] = await Promise.all([
        supabase.from('employees').select('id, name').in('id', ids),
        supabase.from('users').select('id, name').in('id', ids),
      ]);
      [...(usr || []), ...(emp || [])].forEach(x => { if (x?.id && x.name) nombres[x.id] = x.name; });
    }
    const emp = await disenadorDe(req); // diseñadores: solo planos de sus proyectos asignados o creados por ellos
    let visibles = data || [];
    if (emp) {
      const ids = new Set(await proyectosDe(emp));
      visibles = visibles.filter(m => (m.project_id && ids.has(m.project_id)) || m.created_by === req.user.id);
    }
    const planos = visibles.map(m => {
      const r = m.resumen || {};
      return {
        id: m.id, project_id: m.project_id, proyecto: m.project || null,
        nombre: m.nombre || 'Sin nombre', cliente: m.cliente || '',
        m2: Math.round(((r.salas || []).reduce((s, x) => s + (x.area_m2 || 0), 0)) * 10) / 10,
        salas: (r.salas || []).length,
        equipos: (r.equipos || []).reduce((s, x) => s + (x.n || 0), 0),
        luminarias: (r.luminarias || []).reduce((s, x) => s + (x.n || 0), 0),
        puertas: r.puertas || 0, ventanas: r.ventanas || 0,
        creado_por: nombres[m.created_by] || null, editado_por: nombres[m.updated_by] || null,
        created_at: m.created_at, updated_at: m.updated_at,
      };
    });
    res.json({ planos });
  } catch (err) {
    console.error('medicion dashboard:', err);
    res.status(500).json({ error: 'No se pudieron cargar los planos' });
  }
});

// Bloque completo (planta, alzado y lateral) de un producto, cuando se necesita colocar el alzado o el lateral
router.get('/bloque/:id', async (req, res) => {
  try {
    if (req.params.id.startsWith('bib-')) { // pieza de la biblioteca propia
      const { data: b, error: eb } = await supabase.from('biblioteca_bloques').select(COLS_BIB).eq('id', req.params.id.slice(4)).maybeSingle();
      if (eb) throw eb;
      if (!b) return res.status(404).json({ error: 'No existe esa pieza' });
      return res.json({ bloque: { largo: Number(b.largo), fondo: Number(b.fondo), alto: Number(b.alto) || 100, svg: { planta: b.planta || '', alzado: b.alzado || '', lateral: b.lado || '' } } });
    }
    const { data, error } = await supabase.from('catalog_products').select('id, bloques').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!data?.bloques?.svg) return res.status(404).json({ error: 'Este producto no tiene bloque' });
    const b = data.bloques;
    res.json({ bloque: { largo: b.largo, fondo: b.fondo, alto: b.alto, svg: b.svg } });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo cargar el bloque' });
  }
});

// ── Mediciones de un proyecto ──────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { project_id } = req.query;
    if (!project_id) return res.status(400).json({ error: 'project_id requerido' });
    if (!(await proyectoPermitido(req, project_id))) return res.status(403).json({ error: 'Este proyecto no está asignado a ti.' });
    const { data, error } = await supabase.from('mediciones').select('id, data, updated_at').eq('project_id', project_id).order('updated_at', { ascending: false }).limit(30);
    if (error) throw error;
    res.json({ mediciones: (data || []).map(m => ({ ...m.data, id: m.id, updated: new Date(m.updated_at).getTime() })) });
  } catch (err) {
    console.error('medicion list:', err);
    res.status(500).json({ error: 'No se pudieron cargar las mediciones' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { project_id, data } = req.body || {};
    if (!data || typeof data !== 'object' || !Array.isArray(data.walls)) return res.status(400).json({ error: 'Datos de medición no válidos' });
    const ahora = new Date().toISOString();
    const { data: previa } = await supabase.from('mediciones').select('id, project_id, data').eq('id', req.params.id).maybeSingle();
    if (previa?.data?.escena3d) data.escena3d = previa.data.escena3d; // el editor 2D no la toca: no se pierde al guardar
    else delete data.escena3d;
    const fila = {
      id: req.params.id, data, resumen: data.resumen || null,
      nombre: String(data.nombre || '').slice(0, 200) || null, cliente: String(data.cliente || '').slice(0, 200) || null,
      updated_by: req.user.id, updated_at: ahora,
    };
    if (!previa) { fila.created_by = req.user.id; fila.project_id = project_id || null; }
    const { error } = await supabase.from('mediciones').upsert(fila);
    if (error) throw error;
    res.json({ ok: true, updated: new Date(ahora).getTime() });
  } catch (err) {
    console.error('medicion save:', err);
    res.status(500).json({ error: 'No se pudo guardar la medición' });
  }
});

// Escena 3D de un plano: objetos que se colocan y modelan en el visor 3D (bloques de la biblioteca y cajas).
// Se guarda aparte del dibujo 2D para que ninguno de los dos editores pise al otro.
const TIPOS_OBJ3D = ['bloque', 'caja', 'luz', 'escalera', 'puerta', 'ventana', 'prisma'];
const BUCKET_TEX = 'project-documents';
router.put('/:id/escena3d', async (req, res) => {
  try {
    const objs = Array.isArray(req.body?.objetos) ? req.body.objetos.slice(0, 2000) : null;
    if (!objs) return res.status(400).json({ error: 'Escena no válida' });
    const num = (v, d = 0) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : d);
    const hex = v => (/^#[0-9a-fA-F]{6}$/.test(v || '') ? v : null);
    const acab = v => (hex(v) || (/^tex:[\w-]{1,40}$/.test(v || '') ? v : null));
    const limpios = objs.map(o => ({
      id: String(o.id || '').slice(0, 40),
      tipo: TIPOS_OBJ3D.includes(o.tipo) ? o.tipo : 'bloque',
      cid: o.cid ? String(o.cid).slice(0, 80) : null,
      nombre: String(o.nombre || '').slice(0, 120),
      etiqueta: String(o.etiqueta || '').slice(0, 40),
      cx: num(o.cx), cy: num(o.cy), rot: num(o.rot), rotM: num(o.rotM),
      w: Math.max(1, num(o.w, 100)), d: Math.max(1, num(o.d, 100)), alto: Math.max(1, num(o.alto, 100)),
      z0: num(o.z0), color: acab(o.color),
      lum: o.tipo === 'luz' ? Math.max(0, Math.min(100, num(o.lum, 40))) : undefined,
      k: o.tipo === 'luz' ? Math.max(1500, Math.min(10000, num(o.k, 3000))) : undefined,
      caras: o.caras && typeof o.caras === 'object' ? Object.fromEntries(Object.entries(o.caras).slice(0, 12).map(([k, v]) => [String(k).slice(0, 2), acab(v)]).filter(([, v]) => v)) : undefined,
      pts: o.tipo === 'prisma' && Array.isArray(o.pts) ? o.pts.slice(0, 80).map(p => [num(p?.[0]), num(p?.[1])]) : undefined,
      skp: o.skp?.url ? { url: String(o.skp.url).slice(0, 500), rot: num(o.skp.rot) } : null,
      mod: /^https:\/\/[^\s]+\/storage\/v1\/object\/public\//.test(o.mod?.url || '') ? { url: String(o.mod.url).slice(0, 600), tipo: ['gltf', 'glb', 'obj', 'dae'].includes(o.mod.tipo) ? o.mod.tipo : 'gltf', rot: num(o.mod.rot) } : undefined,
    })).filter(o => o.id);
    const mapa = m => Object.fromEntries(Object.entries(m && typeof m === 'object' ? m : {}).slice(0, 500).map(([k, v]) => [String(k).slice(0, 60), acab(v)]).filter(([, v]) => v));
    const a = req.body?.acabados || {};
    const acabados = { muros: mapa(a.muros), salas: mapa(a.salas), techos: mapa(a.techos), todosMuros: acab(a.todosMuros), todosSuelos: acab(a.todosSuelos), todosTechos: acab(a.todosTechos) };
    const paleta = (Array.isArray(req.body?.paleta) ? req.body.paleta : []).slice(0, 80).map(p => ({ nombre: String(p?.nombre || '').slice(0, 60), hex: hex(p?.hex) })).filter(p => p.hex);
    const { data: fila, error } = await supabase.from('mediciones').select('data').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!fila) return res.status(404).json({ error: 'Plano no encontrado' });
    const previa = fila.data?.escena3d || {};
    const data = { ...fila.data, escena3d: { objetos: limpios, acabados, paleta, texturas: previa.texturas || [], hora: Math.max(0, Math.min(24, num(req.body?.hora, 15))), updated: Date.now() } };
    const { error: e2 } = await supabase.from('mediciones').update({ data }).eq('id', req.params.id);
    if (e2) throw e2;
    res.json({ ok: true });
  } catch (err) {
    console.error('medicion escena3d:', err);
    res.status(500).json({ error: 'No se pudo guardar la escena 3D' });
  }
});

// Texturas del plano (fotos de parquet, microcemento, tejidos…): se suben, se reducen y se guardan en la escena del plano
router.post('/:id/textura', uploadReferenceImageFile, handleMulterError, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Falta la imagen' });
    const buf = await sharp(req.file.buffer).rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
    const idTex = 't' + Date.now().toString(36);
    const ruta = `texturas/${req.params.id}-${idTex}.jpg`;
    const { error: eUp } = await supabase.storage.from(BUCKET_TEX).upload(ruta, buf, { contentType: 'image/jpeg', upsert: true });
    if (eUp) throw eUp;
    const { data: { publicUrl } } = supabase.storage.from(BUCKET_TEX).getPublicUrl(ruta);
    const { data: fila } = await supabase.from('mediciones').select('data').eq('id', req.params.id).maybeSingle();
    if (!fila) return res.status(404).json({ error: 'Plano no encontrado' });
    const esc = fila.data?.escena3d || { objetos: [] };
    const tam = Math.max(5, Math.min(1000, parseFloat(req.body?.tam) || 60));
    const tex = { id: idTex, nombre: String(req.body?.nombre || req.file.originalname || 'Textura').replace(/\.[^.]+$/, '').slice(0, 60), url: publicUrl, tam };
    const data = { ...fila.data, escena3d: { ...esc, texturas: [...(esc.texturas || []), tex].slice(-60), updated: Date.now() } };
    const { error } = await supabase.from('mediciones').update({ data }).eq('id', req.params.id);
    if (error) throw error;
    res.status(201).json({ textura: tex });
  } catch (err) {
    console.error('medicion textura:', err);
    res.status(500).json({ error: 'No se pudo guardar la textura' });
  }
});
router.post('/:id/textura-biblioteca', async (req, res) => {
  try {
    const ind = await indiceBiblioteca3d();
    const t = (ind?.texturas || []).find(x => x.id === req.body?.texId);
    if (!t) return res.status(404).json({ error: 'Esa textura no está en la biblioteca' });
    const { data: fila } = await supabase.from('mediciones').select('data').eq('id', req.params.id).maybeSingle();
    if (!fila) return res.status(404).json({ error: 'Plano no encontrado' });
    const esc = fila.data?.escena3d || { objetos: [] };
    const idTex = 'b_' + t.id;
    if ((esc.texturas || []).some(x => x.id === idTex)) return res.json({ textura: esc.texturas.find(x => x.id === idTex) });
    const tex = { id: idTex, nombre: t.nombre, url: t.url, tam: Math.max(5, Math.min(1000, parseFloat(req.body?.tam) || t.tam || 100)) };
    const data = { ...fila.data, escena3d: { ...esc, texturas: [...(esc.texturas || []), tex].slice(-80), updated: Date.now() } };
    const { error } = await supabase.from('mediciones').update({ data }).eq('id', req.params.id);
    if (error) throw error;
    res.status(201).json({ textura: tex });
  } catch (err) {
    console.error('medicion textura-biblioteca:', err);
    res.status(500).json({ error: 'No se pudo añadir la textura' });
  }
});
router.delete('/:id/textura/:tid', async (req, res) => {
  try {
    const { data: fila } = await supabase.from('mediciones').select('data').eq('id', req.params.id).maybeSingle();
    if (!fila) return res.status(404).json({ error: 'Plano no encontrado' });
    const esc = fila.data?.escena3d || {};
    const data = { ...fila.data, escena3d: { ...esc, texturas: (esc.texturas || []).filter(t => t.id !== req.params.tid) } };
    const { error } = await supabase.from('mediciones').update({ data }).eq('id', req.params.id);
    if (error) throw error;
    await supabase.storage.from(BUCKET_TEX).remove([`texturas/${req.params.id}-${req.params.tid}.jpg`]).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo quitar la textura' });
  }
});

// Cambios hechos en el visor 3D sobre elementos del plano 2D (puertas, ventanas y máquinas): se escriben en el propio plano
// y en su modelo 3D guardado, así el 2D y el 3D siempre dicen lo mismo.
const contenedoresPlano = (d) => [d, ...(Array.isArray(d.pisos) ? d.pisos : [])];
const acota = (v, a, b) => Math.max(a, Math.min(b, parseFloat(v)));
router.patch('/:id/hueco', async (req, res) => {
  try {
    const { opId, muroId, p0, w0, cambios = {} } = req.body || {};
    const { data: fila } = await supabase.from('mediciones').select('data').eq('id', req.params.id).maybeSingle();
    if (!fila) return res.status(404).json({ error: 'Plano no encontrado' });
    const data = fila.data || {};
    const lim = { w: [20, 800], h: [20, 500], sill: [0, 400], p: [0, 5000] };
    const vals = {};
    for (const k of Object.keys(lim)) if (Number.isFinite(parseFloat(cambios[k]))) vals[k] = acota(cambios[k], lim[k][0], lim[k][1]);
    let hecho = false;
    for (const c of contenedoresPlano(data)) for (const o of c.ops || []) {
      if (opId ? o.id === opId : (o.wall === muroId && Math.abs(o.p - p0) < 1.5 && Math.abs(o.w - w0) < 1.5)) { Object.assign(o, vals); hecho = true; }
    }
    if (!hecho) return res.status(404).json({ error: 'No he encontrado ese hueco en el plano' });
    const m3 = data.modelo3d;
    if (m3) for (const pl of (m3.plantas || [m3])) for (const mu of pl.muros || []) if (mu.id === muroId) for (const ab of mu.ab || []) {
      if (opId ? ab.id === opId : (Math.abs(ab.p - p0) < 1.5 && Math.abs(ab.w - w0) < 1.5)) Object.assign(ab, vals);
    }
    const ahora = new Date().toISOString();
    data.updated = Date.now();
    const { error } = await supabase.from('mediciones').update({ data, updated_at: ahora }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('medicion hueco:', err);
    res.status(500).json({ error: 'No se pudo cambiar el hueco en el plano' });
  }
});
router.patch('/:id/equipo', async (req, res) => {
  try {
    const { eqId, cambios = {} } = req.body || {};
    if (!eqId) return res.status(400).json({ error: 'Falta el equipo' });
    const { data: fila } = await supabase.from('mediciones').select('data').eq('id', req.params.id).maybeSingle();
    if (!fila) return res.status(404).json({ error: 'Plano no encontrado' });
    const data = fila.data || {};
    const vals = {};
    if (Number.isFinite(parseFloat(cambios.w))) vals.w = acota(cambios.w, 5, 2000);
    if (Number.isFinite(parseFloat(cambios.d))) vals.d = acota(cambios.d, 5, 2000);
    if (Number.isFinite(parseFloat(cambios.rot))) vals.rot = ((parseFloat(cambios.rot) % 360) + 360) % 360;
    let hecho = false;
    for (const c of contenedoresPlano(data)) for (const e of c.eq || []) if (e.id === eqId) { Object.assign(e, vals); hecho = true; }
    if (!hecho) return res.status(404).json({ error: 'No he encontrado ese equipo en el plano' });
    const m3 = data.modelo3d;
    if (m3) for (const pl of (m3.plantas || [m3])) for (const e of pl.equipos || []) if (e.id === eqId) {
      Object.assign(e, vals);
      if (vals.w !== undefined) e.largo = vals.w;
      if (vals.d !== undefined) e.fondo = vals.d;
    }
    const ahora = new Date().toISOString();
    data.updated = Date.now();
    const { error } = await supabase.from('mediciones').update({ data, updated_at: ahora }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('medicion equipo:', err);
    res.status(500).json({ error: 'No se pudo cambiar el equipo en el plano' });
  }
});

// Enlace para SketchUp de un plano (solo lectura)
router.post('/:id/sketchup', async (req, res) => {
  try {
    const { data } = await supabase.from('mediciones').select('id').eq('id', req.params.id).maybeSingle();
    if (!data) return res.status(404).json({ error: 'Guarda primero el plano (dibuja algo y espera al aviso de guardado)' });
    res.json({ url: urlSketchup(req, req.params.id) });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo crear el enlace' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('mediciones').select('id, project_id, data, updated_at').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Plano no encontrado' });
    res.json({ plano: { ...data.data, id: data.id, updated: new Date(data.updated_at).getTime() }, project_id: data.project_id });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo cargar el plano' });
  }
});

router.patch('/:id/proyecto', async (req, res) => {
  try {
    const project_id = req.body?.project_id || null;
    if (project_id) {
      const { data: p } = await supabase.from('client_projects').select('id').eq('id', project_id).maybeSingle();
      if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    }
    const { error } = await supabase.from('mediciones').update({ project_id }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo cambiar el proyecto del plano' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('mediciones').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo borrar la medición' });
  }
});

// ── Cantidades de un plano → filas para un presupuesto ─────────────────────
// Equipos y luminarias que existen en el catálogo salen como producto del
// catálogo (con precio); el resto de lo medido sale como partida libre.
router.get('/cantidades', async (req, res) => {
  try {
    const { project_id, plano_id } = req.query;
    if (!project_id) return res.status(400).json({ error: 'project_id requerido' });
    if (!(await proyectoPermitido(req, project_id))) return res.status(403).json({ error: 'Este proyecto no está asignado a ti.' });
    const { resumen, ...salida } = await cantidadesDePlano(project_id, plano_id);
    res.json(salida);
  } catch (err) {
    console.error('medicion cantidades:', err);
    res.status(500).json({ error: 'No se pudieron calcular las cantidades' });
  }
});

export default router;
