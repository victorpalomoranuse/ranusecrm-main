import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';
import { callClaude } from '../utils/anthropic.js';
import { contextoProyecto } from './agente-proyecto.routes.js';

// Combinador de colores (public/combinador): catálogo propio del estudio
// (colores, suelos y estilos que se suman a los del sistema Ranuse) y la
// propuesta de punto de partida a partir del moodboard del proyecto.
const router = express.Router();
router.use(authenticateToken, requirePermission('proyectos'));

const fail = (res, e, msg) => { console.error(msg, e); res.status(500).json({ error: msg }); };

// ── Catálogo propio ────────────────────────────────────────────────────
const VACIO = { colores: [], suelos: [], estilos: [] };
const HEX = /^#[0-9a-f]{6}$/i;
const ID = /^[a-z0-9_]{3,40}$/;
const nombre = (v) => String(v ?? '').replace(/[^\p{L}\p{N} \-.,()/%·]/gu, '').trim().slice(0, 60);
const ids = (v, max = 40) => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && ID.test(x)).slice(0, max) : []);

export function limpiarCatalogo(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const vistos = new Set();
  const nuevo = (x) => { if (!x || typeof x.id !== 'string' || !ID.test(x.id) || vistos.has(x.id)) return false; vistos.add(x.id); return true; };
  return {
    colores: (Array.isArray(c.colores) ? c.colores : []).filter(x => nuevo(x) && HEX.test(x.hex || '') && nombre(x.n)).slice(0, 80).map(x => ({
      id: x.id, n: nombre(x.n), hex: x.hex.toUpperCase(),
      role: ['Dominante', 'Secundario', 'Acento'].includes(x.role) ? x.role : 'Dominante',
      mats: nombre(x.mats),
    })),
    suelos: (Array.isArray(c.suelos) ? c.suelos : []).filter(x => nuevo(x) && HEX.test(x.hex || '') && nombre(x.n)).slice(0, 80).map(x => ({
      id: x.id, n: nombre(x.n), hex: x.hex.toUpperCase(),
      tex: ['rubber', 'rubberflat', 'marble'].includes(x.tex) ? x.tex : 'rubber',
      eq: typeof x.eq === 'string' && ID.test(x.eq) ? x.eq : null,
    })),
    estilos: (Array.isArray(c.estilos) ? c.estilos : []).filter(x => nuevo(x) && nombre(x.n)).slice(0, 30).map(x => ({
      id: x.id, n: nombre(x.n), lum: ['any', 'clara', 'media', 'oscura'].includes(x.lum) ? x.lum : 'any',
      like: ids(x.like), avoid: ids(x.avoid),
    })),
  };
}

router.get('/custom', async (req, res) => {
  try {
    const { data, error } = await supabase.from('settings').select('combinador_custom').eq('id', 1).maybeSingle();
    if (error) return res.json({ custom: VACIO, sinColumna: true });
    let custom = VACIO;
    try { custom = limpiarCatalogo(JSON.parse(data?.combinador_custom || 'null')); } catch { /* sin datos */ }
    res.json({ custom });
  } catch (e) { fail(res, e, 'Error al cargar tus colores, suelos y estilos'); }
});

router.put('/custom', async (req, res) => {
  try {
    const limpio = limpiarCatalogo(req.body?.custom);
    const { error } = await supabase.from('settings').upsert({ id: 1, combinador_custom: JSON.stringify(limpio) });
    if (error) throw error;
    res.json({ custom: limpio });
  } catch (e) { fail(res, e, 'No se pudo guardar (¿has ejecutado el SQL v77?)'); }
});

// ── Punto de partida desde el moodboard ────────────────────────────────
const ESTILOS_BASE = {
  medi: 'Mediterráneo: beiges, arena, terracota y verdes, luminoso, cálido.',
  nordico: 'Nórdico claro: blancos, grises muy claros y roble claro, aire y luz, casi sin color.',
  industrial: 'Industrial: grises fríos, hormigón, acero, azules apagados, oscuro con textura.',
  premium: 'Premium oscuro: negros y grafitos, sobrio, un solo acento cálido (roble, burdeos, terracota).',
};

const SYSTEM_COMBO = `Eres el asesor de color de Ranuse Design (diseño de espacios de entrenamiento). Un diseñador usa el Combinador Ranuse: eligiendo un SUELO o un COLOR de partida, un ambiente (neutro o con un toque de color) y un estilo, el sistema monta combinaciones con sus reglas 60/30/10. Tu trabajo: mirar las IMÁGENES DEL MOODBOARD del proyecto y decidir esos puntos de partida, para que el sistema proponga combinaciones que encajen con lo que el cliente ya ha visto.

CÓMO DECIDES
- Mira qué domina de verdad en las imágenes: tonos de paredes y techos, suelos, materiales (hormigón, madera, acero, microcemento, piedra), luz y ambiente. No te inventes lo que no se ve.
- mode "floor" solo si el moodboard muestra o implica claramente un suelo técnico/oscuro/claro concreto; elige el suelo del catálogo más parecido en color y textura. Si lo que domina es el color de paredes/materiales, usa mode "color" con el color del catálogo más cercano al dominante.
- ambiente "accent" solo si el moodboard tiene un toque de color claro que coincide con uno de los acentos permitidos; si no, "neutral".
- estilo: el que mejor describe el conjunto (usa "all" si no está claro).
- La paleta hex y el estilo ya definidos en el proyecto, y los condicionantes (techo bajo, poca luz...), pesan en tu decisión.
- Usa SOLO ids del catálogo que se te da. Escribe "razon" en español, 2-3 frases, citando lo concreto que ves.
- Da una "alternativa" que sea otra lectura razonable y distinta (por ejemplo, partir de color en vez de suelo, o un estilo vecino).
FORMATO: responde SOLO llamando a la herramienta proponer_combinacion.`;

function herramienta(cat) {
  const sueloIds = cat.suelos.map(s => s.id), colorIds = cat.colores.map(c => c.id);
  const opcion = {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['floor', 'color'] },
      pick: { type: 'string', description: 'id del suelo (si mode=floor) o del color (si mode=color) del catálogo' },
      ambiente: { type: 'string', enum: ['neutral', 'accent'] },
      acento: { type: 'string', enum: cat.acentos.length ? cat.acentos : ['none'], description: 'solo si ambiente=accent' },
      estilo: { type: 'string', enum: ['all', ...cat.estilos.map(e => e.id)] },
      razon: { type: 'string' },
    },
    required: ['mode', 'pick', 'ambiente', 'estilo', 'razon'],
  };
  return {
    sueloIds, colorIds,
    tool: {
      name: 'proponer_combinacion',
      description: 'Entrega el punto de partida para el Combinador.',
      input_schema: {
        type: 'object',
        properties: {
          observado: { type: 'object', properties: { ambiente: { type: 'string' }, materiales: { type: 'array', items: { type: 'string' } }, colores: { type: 'array', items: { type: 'string' } } } },
          principal: opcion,
          alternativa: opcion,
        },
        required: ['principal'],
      },
    },
  };
}

const valida = (o, h, cat) => {
  if (!o || typeof o !== 'object') return null;
  const mode = o.mode === 'color' ? 'color' : 'floor';
  if (!(mode === 'floor' ? h.sueloIds : h.colorIds).includes(o.pick)) return null;
  const ambiente = o.ambiente === 'accent' && cat.acentos.includes(o.acento) ? 'accent' : 'neutral';
  return {
    mode, pick: o.pick, ambiente, acento: ambiente === 'accent' ? o.acento : null,
    estilo: ['all', ...cat.estilos.map(e => e.id)].includes(o.estilo) ? o.estilo : 'all',
    razon: String(o.razon || '').slice(0, 600),
  };
};

router.post('/moodboard/:projectId', async (req, res) => {
  try {
    const c = req.body?.catalogo || {};
    const cat = {
      suelos: (Array.isArray(c.suelos) ? c.suelos : []).filter(x => x && ID.test(x.id || '')).slice(0, 150),
      colores: (Array.isArray(c.colores) ? c.colores : []).filter(x => x && ID.test(x.id || '')).slice(0, 150),
      acentos: (Array.isArray(c.acentos) ? c.acentos : []).filter(x => typeof x === 'string' && ID.test(x)).slice(0, 20),
      estilos: (Array.isArray(c.estilos) ? c.estilos : []).filter(x => x && ID.test(x.id || '')).slice(0, 40),
    };
    if (!cat.suelos.length || !cat.colores.length) return res.status(400).json({ error: 'Falta el catálogo del Combinador' });
    const ctx = await contextoProyecto(req.params.projectId);
    if (!ctx) return res.status(404).json({ error: 'Proyecto no encontrado' });
    if (!ctx.hayMoodboard) return res.status(400).json({ error: 'Este proyecto todavía no tiene imágenes en el moodboard. Súbelas arriba y vuelve a probar.' });

    const h = herramienta(cat);
    const lista = [
      'SUELOS DISPONIBLES (id | nombre | color | motas):\n' + cat.suelos.map(s => `${s.id} | ${s.n} | ${s.hex}${s.fleck ? ' | motas ' + s.fleck : ''}`).join('\n'),
      'COLORES DISPONIBLES (id | nombre | NCS | color | rol):\n' + cat.colores.map(x => `${x.id} | ${x.n} | ${x.ncs || ''} | ${x.hex} | ${x.rol || ''}`).join('\n'),
      'ACENTOS PERMITIDOS (ids): ' + (cat.acentos.join(', ') || 'ninguno'),
      'ESTILOS (ids): ' + cat.estilos.map(e => `${e.id} = ${ESTILOS_BASE[e.id] || e.n}`).join('; '),
    ].join('\n\n');
    const content = [
      ...ctx.imagenes,
      { type: 'text', text: `CONTEXTO DEL PROYECTO (las imágenes de arriba son el moodboard):\n\n${ctx.texto}` },
      { type: 'text', text: `CATÁLOGO DEL COMBINADOR:\n\n${lista}` },
    ];

    let principal = null, alternativa = null, observado = {};
    for (let intento = 0; intento < 2 && !principal; intento++) {
      const response = await callClaude({ system: SYSTEM_COMBO, messages: [{ role: 'user', content }], tools: [h.tool], maxTokens: 2000 });
      const uso = (response.content || []).find(b => b.type === 'tool_use' && b.name === 'proponer_combinacion');
      principal = valida(uso?.input?.principal, h, cat);
      alternativa = valida(uso?.input?.alternativa, h, cat);
      observado = uso?.input?.observado || {};
    }
    if (!principal) return res.status(502).json({ error: 'La IA no ha dado una propuesta válida, inténtalo otra vez' });
    const lim = (a) => (Array.isArray(a) ? a.map(x => String(x).slice(0, 60)).slice(0, 8) : []);
    res.json({ data: { observado: { ambiente: String(observado.ambiente || '').slice(0, 160), materiales: lim(observado.materiales), colores: lim(observado.colores) }, principal, alternativa } });
  } catch (e) { fail(res, e, e.message || 'No se pudo proponer desde el moodboard'); }
});

export default router;
