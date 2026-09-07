import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';
import { callClaude } from '../utils/anthropic.js';

const router = express.Router();
// admin_superior siempre pasa; trabajador necesita el permiso "ventas"
// (comerciales) — así el asistente lo pueden usar tanto Víctor como su equipo.
router.use(authenticateToken, requirePermission('ventas'));

const BASE_SYSTEM_PROMPT = `Eres el asistente de presupuestos de Ranuse Design, un estudio de diseño de espacios deportivos (home gyms, salas de entrenamiento, etc.) en España. Lo usan tanto Víctor (el dueño del estudio) como los comerciales del equipo.

Tu trabajo: cuando te pidan un presupuesto (por ejemplo "gimnasio en casa con rack, banco, mancuernas y cardio"), buscas en el catálogo REAL de productos (con la herramienta buscar_productos) los que encajan con cada tipo de máquina que te pidan, y devuelves un desglose claro en tres niveles de calidad: ECONÓMICO, MEDIO y PREMIUM.

Reglas importantes:
- NUNCA inventes productos ni precios. Todo dato de producto (nombre, marca, precio) tiene que venir de una llamada a buscar_productos. Si una categoría no tiene productos en el catálogo, dilo claramente en vez de inventar.
- Primero usa listar_categorias si no sabes qué nombre exacto tiene una categoría en el catálogo (puede que usen abreviaturas o nombres coloquiales, ej. "VC" podría no coincidir literalmente).
- Los niveles de calidad ya vienen calculados en el resultado de buscar_productos (el más barato de la categoría es económico, el más caro premium, y el resto medio) — solo tienes que elegir UN producto de cada nivel por categoría (si hay varios "medio", elige el más representativo, ej. el de precio más cercano a la media). Ten en cuenta también las preferencias de selección de más abajo, si las hay, no solo el precio.
- Responde SIEMPRE en español, en un formato claro tipo tabla/lista por nivel, con el precio de cada producto y el TOTAL sumado de cada nivel al final.
- Si no especifican cantidades (ej. cuántas mancuernas), asume 1 unidad de cada producto salvo que sea obvio que hacen falta más (pares, sets) — y dilo explícitamente para que lo puedan corregir.
- Sé breve y directo — esto lo usa alguien con prisa para responder a un cliente rápido, no hace falta que expliques tu proceso, solo dale el resultado.

Cómo guardar un presupuesto de verdad (herramienta crear_presupuesto):
- Cuando la persona ya haya elegido un nivel (económico/medio/premium) o una lista concreta de productos y te pida guardarlo / crearlo / armarlo como presupuesto real, necesitas saber a qué proyecto de cliente pertenece. Si no te lo han dicho, pregúntalo (nombre del cliente o del proyecto).
- Usa buscar_proyecto con ese nombre para encontrar el proyecto exacto. Si hay varias coincidencias, enséñaselas y pregunta cuál es. Si no hay ninguna, dilo y pregunta si el proyecto ya existe en el CRM.
- Un proyecto solo puede tener UN presupuesto. Si buscar_proyecto o crear_presupuesto indican que ya tiene uno, no crees otro: avisa con el número de presupuesto existente y sugiere abrirlo desde la sección Presupuestos para añadir partidas ahí.
- Solo llama a crear_presupuesto cuando tengas confirmación clara de la persona sobre qué nivel/productos concretos quiere guardar y para qué proyecto — no lo hagas por iniciativa propia con el primer mensaje. Usa como "nombre" de cada partida el nombre EXACTO tal cual aparece en los resultados de buscar_productos.
- Tras crear el presupuesto, confirma con el número de presupuesto generado y recuerda que se puede terminar de revisar y exportar a PDF desde la sección Presupuestos.`;

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
  {
    name: 'buscar_proyecto',
    description: 'Busca proyectos de cliente existentes en el CRM por nombre de cliente o de proyecto (coincidencia parcial). Úsala antes de crear_presupuesto para encontrar el id exacto del proyecto y comprobar si ya tiene presupuesto.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre (o parte del nombre) del cliente o del proyecto a buscar' },
      },
      required: ['nombre'],
    },
  },
  {
    name: 'crear_presupuesto',
    description: 'Crea un presupuesto REAL en el sistema de Presupuestos de Ranuse Design, con sus partidas, y lo deja guardado (estado borrador) para ese proyecto. Solo se puede usar una vez que la persona ha confirmado el proyecto y los productos/nivel elegidos. Cada nombre de producto debe ser EXACTO tal cual lo devolvió buscar_productos.',
    input_schema: {
      type: 'object',
      properties: {
        proyecto_id: { type: 'string', description: 'id del proyecto (uuid) devuelto por buscar_proyecto' },
        nombre_presupuesto: { type: 'string', description: 'Nombre corto opcional para el presupuesto, ej. "Nivel medio - gimnasio en casa"' },
        items: {
          type: 'array',
          description: 'Lista de productos a incluir, con el nombre EXACTO devuelto por buscar_productos',
          items: {
            type: 'object',
            properties: {
              nombre: { type: 'string', description: 'Nombre exacto del producto tal cual aparece en buscar_productos' },
              cantidad: { type: 'number', description: 'Cantidad de unidades, por defecto 1' },
            },
            required: ['nombre'],
          },
        },
      },
      required: ['proyecto_id', 'items'],
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

async function buscarProyecto(nombreQuery) {
  const { data: projects, error } = await supabase
    .from('client_projects')
    .select('id, client_name, project_name, phase')
    .or(`client_name.ilike.%${nombreQuery}%,project_name.ilike.%${nombreQuery}%`)
    .limit(10);
  if (error || !projects?.length) return { encontrado: false, mensaje: `No hay ningún proyecto que coincida con "${nombreQuery}" en el CRM.` };

  const ids = projects.map(p => p.id);
  const { data: budgets } = await supabase.from('budgets').select('project_id, budget_number').in('project_id', ids);
  const budgetByProject = {};
  (budgets || []).forEach(b => { budgetByProject[b.project_id] = b.budget_number; });

  return {
    encontrado: true,
    proyectos: projects.map(p => ({
      id: p.id,
      cliente: p.client_name,
      proyecto: p.project_name,
      ya_tiene_presupuesto: !!budgetByProject[p.id],
      numero_presupuesto_existente: budgetByProject[p.id] || null,
    })),
  };
}

async function generateBudgetNumber() {
  const { data, error } = await supabase.rpc('increment_budget_counter');
  if (error || !data) {
    const rand = String(Math.floor(Math.random() * 999) + 1).padStart(3, '0');
    return 'RAN-' + rand;
  }
  return 'RAN-' + String(data).padStart(3, '0');
}

async function crearPresupuesto({ proyecto_id, nombre_presupuesto, items }) {
  if (!proyecto_id) return { creado: false, mensaje: 'Falta proyecto_id — usa buscar_proyecto primero.' };
  if (!Array.isArray(items) || items.length === 0) return { creado: false, mensaje: 'No se ha indicado ningún producto para el presupuesto.' };

  const { data: existente } = await supabase.from('budgets').select('id, budget_number').eq('project_id', proyecto_id).maybeSingle();
  if (existente) {
    return { creado: false, ya_existe: true, budget_number: existente.budget_number, mensaje: `Este proyecto ya tiene el presupuesto ${existente.budget_number}. No se ha creado uno nuevo — hay que añadir partidas desde la sección Presupuestos.` };
  }

  const budget_number = await generateBudgetNumber();
  const { data: budget, error: errBudget } = await supabase
    .from('budgets')
    .insert({
      budget_number,
      status: 'borrador',
      design_fee_type: 'flat',
      design_fee_value: 0,
      design_hours: 0,
      project_id: proyecto_id,
      ...(nombre_presupuesto?.trim() ? { budget_name: nombre_presupuesto.trim() } : {}),
    })
    .select('id, budget_number')
    .single();
  if (errBudget) {
    if (errBudget.code === '23505') return { creado: false, ya_existe: true, mensaje: 'Este proyecto ya tiene presupuesto (creado justo ahora por otra parte) — no se ha duplicado.' };
    return { creado: false, mensaje: 'Error al crear el presupuesto: ' + errBudget.message };
  }

  const insertados = [];
  const noEncontrados = [];
  let displayOrder = 0;

  for (const it of items) {
    const nombreBuscado = (it.nombre || '').trim();
    if (!nombreBuscado) continue;
    const { data: producto } = await supabase
      .from('catalog_products')
      .select('id, name, brand, price, category_id, longitud, ancho, altura, color_bastidor, color_acolchado, tipo_acolchado, category:catalog_categories(type)')
      .ilike('name', nombreBuscado)
      .limit(1)
      .maybeSingle();

    if (!producto) {
      noEncontrados.push(nombreBuscado);
      continue;
    }

    const cost = Number(producto.price) || 0;
    const cantidad = parseFloat(it.cantidad) || 1;
    const { error: errItem } = await supabase.from('budget_items').insert({
      budget_id: budget.id,
      catalog_product_id: producto.id,
      name: producto.name,
      category: producto.category?.type || 'material',
      quantity: cantidad,
      unit: 'ud',
      unit_cost: cost,
      markup_pct: 20,
      unit_price: parseFloat((cost * 1.2).toFixed(2)),
      display_order: displayOrder++,
      brand: producto.brand || null,
      longitud: producto.longitud || null,
      ancho: producto.ancho || null,
      altura: producto.altura || null,
      color_bastidor: producto.color_bastidor || null,
      color_acolchado: producto.color_acolchado || null,
      tipo_acolchado: producto.tipo_acolchado || null,
      pricing_mode: 'margin',
    });
    if (!errItem) insertados.push(producto.name);
    else noEncontrados.push(nombreBuscado);
  }

  return {
    creado: true,
    budget_id: budget.id,
    budget_number: budget.budget_number,
    partidas_creadas: insertados,
    partidas_no_encontradas: noEncontrados,
    mensaje: noEncontrados.length
      ? `Presupuesto ${budget.budget_number} creado, pero algunos productos no se encontraron en el catálogo con ese nombre exacto y no se añadieron: ${noEncontrados.join(', ')}.`
      : `Presupuesto ${budget.budget_number} creado correctamente con ${insertados.length} partida(s).`,
  };
}

async function runTool(name, input) {
  if (name === 'listar_categorias') return { categorias: await listarCategorias() };
  if (name === 'buscar_productos') return buscarProductos(input.categoria);
  if (name === 'buscar_proyecto') return buscarProyecto(input.nombre);
  if (name === 'crear_presupuesto') return crearPresupuesto(input);
  return { error: 'Herramienta desconocida' };
}

/**
 * POST /api/ai-budget/chat
 * Body: { messages: [{ role: 'user'|'assistant', content: string }] }
 * Devuelve la respuesta final del asistente tras resolver, si hace falta,
 * varias vueltas de búsqueda en el catálogo / creación de presupuesto.
 */
router.post('/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages es requerido' });
    }

    const { data: settings } = await supabase.from('settings').select('ai_budget_preferences').eq('id', 1).maybeSingle();
    const prefs = settings?.ai_budget_preferences?.trim();
    const system = prefs
      ? `${BASE_SYSTEM_PROMPT}\n\nPreferencias de selección de producto de Víctor (además de ordenar por precio, ten esto en cuenta al elegir qué producto representa cada nivel):\n${prefs}`
      : BASE_SYSTEM_PROMPT;

    // Anthropic espera content como string o array de bloques; los mensajes
    // que llegan del frontend son simples { role, content: string }.
    let conversation = messages.map(m => ({ role: m.role, content: m.content }));

    let lastResponse = null;
    for (let turn = 0; turn < 6; turn++) {
      lastResponse = await callClaude({ system, messages: conversation, tools: TOOLS });

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
