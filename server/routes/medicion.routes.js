import express from 'express';
import sharp from 'sharp';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';
import { cantidadesDePlano } from '../utils/planos.js';
import { urlSketchup } from './medicion-sketchup.routes.js';

// Herramienta de medición en obra: guarda los planos por proyecto y le sirve el
// catálogo del CRM (máquinas y luminarias) para colocarlas en el plano.

const router = express.Router();
router.use(authenticateToken, requirePermission('proyectos'));

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

// ── Biblioteca propia de bloques (importados desde DXF, etc.) ─────────────
const ETIQUETAS_PLANTA = new Set(['path', 'g', 'line', 'rect', 'circle', 'polygon']);
function plantaValida(frag) {
  if (typeof frag !== 'string' || !frag || frag.length > 120000) return false;
  const etiquetas = [...frag.matchAll(/<\s*\/?\s*([a-zA-Z][\w:-]*)/g)].map(m => m[1].toLowerCase());
  if (!etiquetas.length || etiquetas.some(t => !ETIQUETAS_PLANTA.has(t))) return false;
  return !/on\w+\s*=|javascript:|<\s*script|href\s*=|url\s*\(/i.test(frag);
}
function itemBiblioteca(r) {
  return {
    id: 'bib-' + r.id, nombre: r.nombre, tipo: 'gen', w: Number(r.largo), d: Number(r.fondo), alto: Number(r.alto) || null,
    categoria: r.categoria || 'Mi biblioteca', ref: r.origen || 'Biblioteca propia', biblioteca: true,
    bloque: { planta: r.planta, largo: Number(r.largo), fondo: Number(r.fondo) },
  };
}
async function cargarBiblioteca() {
  const { data, error } = await supabase.from('biblioteca_bloques').select('id, nombre, categoria, largo, fondo, alto, planta, origen').order('categoria').order('nombre').limit(2000);
  return error ? [] : (data || []).map(itemBiblioteca); // si la tabla aún no existe, se sigue sin ella
}
router.post('/biblioteca', async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 60) : [];
    const filas = [];
    for (const it of items) {
      const nombre = String(it?.nombre || '').trim().slice(0, 120);
      const largo = Number(it?.largo), fondo = Number(it?.fondo);
      if (!nombre || !(largo >= 1 && largo <= 5000 && fondo >= 1 && fondo <= 5000) || !plantaValida(it?.planta)) continue;
      filas.push({
        nombre, categoria: String(it.categoria || 'Mi biblioteca').trim().slice(0, 60) || 'Mi biblioteca',
        largo, fondo, alto: Number(it.alto) > 0 ? Number(it.alto) : 100, planta: it.planta,
        origen: String(it.origen || 'Biblioteca propia').slice(0, 80), created_by: req.user?.id || null,
      });
    }
    if (!filas.length) return res.status(400).json({ error: 'No hay bloques válidos que guardar' });
    const { data, error } = await supabase.from('biblioteca_bloques').insert(filas).select('id, nombre, categoria, largo, fondo, alto, planta, origen');
    if (error) throw error;
    res.json({ items: (data || []).map(itemBiblioteca) });
  } catch (err) {
    console.error('medicion biblioteca:', err);
    res.status(500).json({ error: 'No se pudieron guardar los bloques. ¿Está creada la tabla de la biblioteca (migración v72)?' });
  }
});
router.delete('/biblioteca/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('biblioteca_bloques').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo quitar el bloque de la biblioteca' });
  }
});

router.get('/catalogos', async (req, res) => {
  try {
    const columnas = 'id, name, brand, category_id, longitud, ancho, altura, lumens, watts, color_temperature, photo_url, display_order';
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
          ref: [p.brand, cat.name].filter(Boolean).join(' · '),
          sinMedidas: !tieneMedidas,
          // dibujo real de la planta (si el producto tiene bloque), a escala en cm
          foto: p.photo_url || null,
          alto: Number(p.altura) > 0 ? Number(p.altura) : null,
          ...(p.bloques?.svg?.planta ? {
            bloque: { planta: p.bloques.svg.planta, largo: p.bloques.largo, fondo: p.bloques.fondo },
            vistas: ['planta', ...(p.bloques.svg.alzado ? ['alzado'] : []), ...(p.bloques.svg.lateral ? ['lateral'] : [])],
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
    res.json({ maquinas, luminarias, materiales });
  } catch (err) {
    console.error('medicion/catalogos:', err);
    res.status(500).json({ error: 'No se pudo cargar el catálogo' });
  }
});

// ── Dashboard de planos (todos, con o sin proyecto) ────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const { data, error } = await supabase.from('mediciones')
      .select('id, project_id, nombre, cliente, resumen, created_by, updated_by, created_at, updated_at, project:client_projects(id, client_name, project_name)')
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
    const planos = (data || []).map(m => {
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
    const { data: previa } = await supabase.from('mediciones').select('id, project_id').eq('id', req.params.id).maybeSingle();
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
    const { resumen, ...salida } = await cantidadesDePlano(project_id, plano_id);
    res.json(salida);
  } catch (err) {
    console.error('medicion cantidades:', err);
    res.status(500).json({ error: 'No se pudieron calcular las cantidades' });
  }
});

export default router;
