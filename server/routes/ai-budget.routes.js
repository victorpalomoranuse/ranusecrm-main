import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdminSuperior } from '../middleware/auth.middleware.js';
import { callClaude } from '../utils/anthropic.js';

const router = express.Router();
router.use(authenticateToken, requireAdminSuperior);

const SYSTEM_PROMPT = `Eres el asistente de presupuestos de Ranuse Design, un estudio de diseño de espacios deportivos (home gyms, salas de entrenamiento, etc.) en España.

Tu trabajo: cuando el diseñador te pida un presupuesto (por ejemplo "gimnasio en casa con rack, banco, mancuernas y cardio"), buscas en el catálogo REAL de productos (con la herramienta buscar_productos) los que encajan con cada tipo de máquina que te pida, y le devuelves un desglose claro en tres niveles de calidad: ECONÓMICO, MEDIO y PREMIUM.

Reglas importantes:
- NUNCA inventes productos ni precios. Todo dato de producto (nombre, marca, precio) tiene que venir de una llamada a buscar_productos. Si una categoría no tiene productos en el catálogo, dilo claramente en vez de inventar.
- Primero usa listar_categorias si no sabes qué nombre exacto tiene una categoría en el catálogo (el diseñador puede usar abreviaturas o nombres coloquiales, ej. "VC" podría no coincidir literalmente).
- Los niveles de calidad ya vienen calculados en el resultado de buscar_productos (el más barato de la categoría es económico, el más caro premium, y el resto medio) — solo tienes que elegir UN producto de cada nivel por categoría (si hay varios "medio", elige el más representativo, ej. el de precio más cercano a la media).
- Responde SIEMPRE en español, en un formato claro tipo tabla/lista por nivel, con el precio de cada producto y el TOTAL sumado de cada nivel al final.
- Si el diseñador no especifica cantidades (ej. cuántas mancuernas), asume 1 unidad de cada producto salvo que sea obvio que hacen falta más (pares, sets) — y dilo explícitamente para que él lo pueda corregir.
- Sé breve y directo — esto lo usa un diseñador con prisa para responder a un cliente rápido, no hace falta que expliques tu proceso, solo dale el resultado.`;

const TOOLS = [
  {
    name: 'listar_categorias',
    description: 'Lista todas las categorías de producto que existen en el catálogo (ej. Racks, Mancuernas, Bancos, Cardio, Suelos...), con su tipo (material o mobiliario). Úsala cuando no estés seguro de qué nombre exacto usar en buscar_productos.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'buscar_productos',
    description: 'Busca productos reales del catálogo por categoría (coincidencia parcial, no hace falta el nombre exacto) y devuelve todos los que hay con nombre, marca, precio y el nivel de calidad ya calculado (económico/medio/premium) según su precio dentro de esa categoría.',
    input_schema: {
      type: 'object',
      properties: {
        categoria: { type: 'string', description: 'Nombre o parte del nombre de la categoría a buscar, ej. "rack", "mancuernas", "cardio"' },
      },
      required: ['categoria'],
    },
  },
];

function fmtEur(n) {
  return Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
}

async function listarCategorias() {
  const { data } = await supabase.from('catalog_categories').select('name, type').order('name');
  return (data || []).map(c => `${c.name} (${c.type === 'material' ? 'material' : 'mobiliario'})`);
}

async function buscarProductos(categoriaQuery) {
  const { data: cats } = await supabase.from('catalog_categories').select('id, name, type').ilike('name', `%${categoriaQuery}%`);
  if (!cats?.length) return { encontrado: false, mensaje: `No hay ninguna categoría que coincida con "${categoriaQuery}" en el catálogo.` };

  const catIds = cats.map(c => c.id);
  const { data: products } = await supabase
    .from('catalog_products')
    .select('name, brand, price, category_id')
    .in('category_id', catIds)
    .not('price', 'is', null)
    .order('price', { ascending: true });

  if (!products?.length) return { encontrado: false, mensaje: `La categoría "${cats[0].name}" existe pero no tiene productos con precio cargado todavía.` };

  // Nivel por precio, agrupado por categoría (por si buscarProductos matcheó varias categorías a la vez)
  const porCategoria = {};
  products.forEach(p => {
    if (!porCategoria[p.category_id]) porCategoria[p.category_id] = [];
    porCategoria[p.category_id].push(p);
  });

  const resultado = [];
  Object.entries(porCategoria).forEach(([catId, items]) => {
    const catName = cats.find(c => c.id === catId)?.name || categoriaQuery;
    items.sort((a, b) => Number(a.price) - Number(b.price));
    items.forEach((p, i) => {
      let nivel = 'medio';
      if (i === 0) nivel = 'económico';
      else if (i === items.length - 1 && items.length > 1) nivel = 'premium';
      resultado.push({ categoria: catName, nombre: p.name, marca: p.brand || null, precio: Number(p.price), precio_formateado: fmtEur(p.price), nivel });
    });
  });

  return { encontrado: true, productos: resultado };
}

async function runTool(name, input) {
  if (name === 'listar_categorias') return { categorias: await listarCategorias() };
  if (name === 'buscar_productos') return buscarProductos(input.categoria);
  return { error: 'Herramienta desconocida' };
}

/**
 * POST /api/ai-budget/chat
 * Body: { messages: [{ role: 'user'|'assistant', content: string }] }
 * Devuelve la respuesta final del asistente tras resolver, si hace falta,
 * varias vueltas de búsqueda en el catálogo.
 */
router.post('/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages es requerido' });
    }

    // Anthropic espera content como string o array de bloques; los mensajes
    // que llegan del frontend son simples { role, content: string }.
    let conversation = messages.map(m => ({ role: m.role, content: m.content }));

    let lastResponse = null;
    for (let turn = 0; turn < 6; turn++) {
      lastResponse = await callClaude({ system: SYSTEM_PROMPT, messages: conversation, tools: TOOLS });

      const toolUses = (lastResponse.content || []).filter(b => b.type === 'tool_use');
      if (toolUses.length === 0) break;

      // Añadir el turno del asistente (con sus tool_use) y luego los resultados
      conversation.push({ role: 'assistant', content: lastResponse.content });
      const toolResults = await Promise.all(toolUses.map(async tu => ({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(await runTool(tu.name, tu.input)),
      })));
      conversation.push({ role: 'user', content: toolResults });
    }

    const textBlock = (lastResponse?.content || []).find(b => b.type === 'text');
    res.json({
      reply: textBlock?.text || 'No he podido generar una respuesta.',
      messages: conversation.concat(lastResponse?.content ? [{ role: 'assistant', content: lastResponse.content }] : []),
    });
  } catch (error) {
    console.error('Error en asistente de presupuestos:', error);
    res.status(500).json({ error: error.message || 'Error al consultar al asistente' });
  }
});

export default router;
