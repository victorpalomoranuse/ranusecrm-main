import express from 'express';
import sharp from 'sharp';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';
import { cantidadesDePlano } from '../utils/planos.js';

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
async function fotoMiniatura(url) {
  if (!url) return null;
  if (cacheFotos.has(url)) return cacheFotos.get(url);
  let r = null;
  try {
    const resp = await fetch(url);
    if (resp.ok) {
      const buf = Buffer.from(await resp.arrayBuffer());
      const { data, info } = await sharp(buf).rotate().resize(160, 160, { fit: 'inside' }).flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer({ resolveWithObject: true });
      r = { uri: `data:image/jpeg;base64,${data.toString('base64')}`, pw: info.width, ph: info.height };
    }
  } catch { /* sin foto */ }
  cacheFotos.set(url, r);
  return r;
}

router.get('/catalogos', async (req, res) => {
  try {
    const [{ data: cats }, { data: prods }] = await Promise.all([
      supabase.from('catalog_categories').select('id, name, type'),
      supabase.from('catalog_products').select('id, name, brand, category_id, longitud, ancho, lumens, watts, color_temperature, photo_url, display_order').order('display_order', { ascending: true, nullsFirst: false }),
    ]);
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
          ref: [p.brand, cat.name].filter(Boolean).join(' · '),
          sinMedidas: !tieneMedidas,
        });
      } else if (cat.type === 'iluminacion') {
        luminariasBase.push({ p, cat });
      }
    }
    maquinas.sort((a, b) => Number(a.sinMedidas) - Number(b.sinMedidas)); // primero las que ya tienen medidas
    const luminarias = await Promise.all(luminariasBase.map(async ({ p, cat }) => {
      const foto = await fotoMiniatura(p.photo_url);
      const k = parseInt(String(p.color_temperature || '').replace(/[^\d]/g, ''), 10);
      return {
        id: p.id, ref: p.brand || '', n: p.name, sym: simboloLuminaria(cat.name, p.name),
        lm: p.lumens || 0, w: Number(p.watts) || 0, k: Number.isFinite(k) ? k : 0,
        ...(foto || {}),
      };
    }));
    res.json({ maquinas, luminarias });
  } catch (err) {
    console.error('medicion/catalogos:', err);
    res.status(500).json({ error: 'No se pudo cargar el catálogo' });
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
    if (!project_id || !data || typeof data !== 'object' || !Array.isArray(data.walls)) return res.status(400).json({ error: 'Datos de medición no válidos' });
    const ahora = new Date().toISOString();
    const { data: previa } = await supabase.from('mediciones').select('id, project_id').eq('id', req.params.id).maybeSingle();
    if (previa && previa.project_id !== project_id) return res.status(409).json({ error: 'Esa medición pertenece a otro proyecto' });
    const fila = {
      id: req.params.id, project_id, data, resumen: data.resumen || null,
      nombre: String(data.nombre || '').slice(0, 200) || null, cliente: String(data.cliente || '').slice(0, 200) || null,
      updated_by: req.user.id, updated_at: ahora,
    };
    if (!previa) fila.created_by = req.user.id;
    const { error } = await supabase.from('mediciones').upsert(fila);
    if (error) throw error;
    res.json({ ok: true, updated: new Date(ahora).getTime() });
  } catch (err) {
    console.error('medicion save:', err);
    res.status(500).json({ error: 'No se pudo guardar la medición' });
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
