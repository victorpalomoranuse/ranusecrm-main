import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';
import { callClaude } from '../utils/anthropic.js';
import { internalAdminToken } from '../utils/internal-auth.js';
import { computeCatalogPricing } from '../utils/pricing.js';

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

Marcas:
- Si te piden una marca concreta ("todo de Akon", "prefiero Titanium Strength"...), pásasela a buscar_productos en el parámetro marca para priorizarla. Si esa marca no tiene nada en alguna categoría, dilo claramente y usa otra marca disponible en su lugar — nunca dejes una categoría vacía por no haber esa marca.

Productos por m² (ej. suelos):
- buscar_productos indica en "unidad_precio" si un producto se cobra por unidad ("ud") o por metro cuadrado ("m2"). Si es "m2", el precio que ves es por m², así que pregunta (si no te lo han dado) los metros cuadrados a cubrir, y usa ese número como "cantidad" al crear el presupuesto — el total sale de multiplicar precio × m².

Accesorios incluidos:
- Si un producto trae accesorios incluidos (campo "accesorios_incluidos" en buscar_productos), menciónalo también en tu respuesta al usuario (ej. "incluye J-cups y barra de seguridad"), no solo lo dejes para el PDF.

Precios y márgenes (esto es automático, no lo calcules tú):
- No calcules tú el coste, margen o descuento de compra — la herramienta crear_presupuesto ya aplica automáticamente el criterio de Víctor por producto (o el precio de catálogo es un PVP con su descuento de compra, o es su coste puro y le suma un margen por defecto). Tú solo trabajas con el precio que te da buscar_productos, que es el precio de venta al cliente.

Cómo guardar un presupuesto de verdad (herramienta crear_presupuesto):
- Cuando la persona ya haya elegido un nivel (económico/medio/premium) o una lista concreta de productos y te pida guardarlo / crearlo / armarlo como presupuesto real, necesitas saber a qué proyecto de cliente pertenece. Si no te lo han dicho, pregúntalo (nombre del cliente o del proyecto).
- Usa buscar_proyecto con ese nombre para encontrar el proyecto exacto. Si hay varias coincidencias, enséñaselas y pregunta cuál es. Si no hay ninguna, dilo y pregunta si el proyecto ya existe en el CRM.
- Un proyecto solo puede tener UN presupuesto. Si buscar_proyecto o crear_presupuesto indican que ya tiene uno, no crees otro: avisa con el número de presupuesto existente y sugiere abrirlo desde la sección Presupuestos para añadir partidas ahí.
- Solo llama a crear_presupuesto cuando tengas confirmación clara de la persona sobre qué nivel/productos concretos quiere guardar y para qué proyecto — no lo hagas por iniciativa propia con el primer mensaje. Usa como "nombre" de cada partida el nombre EXACTO tal cual aparece en los resultados de buscar_productos.
- Tras crear el presupuesto, la herramienta ya genera y guarda el PDF automáticamente (no hace falta que lo pidas aparte). Confirma con el número de presupuesto generado y, si el resultado incluye pdf_url, dilo (el PDF ya está listo y guardado; se puede terminar de revisar o editar a mano desde la sección Presupuestos y volver a exportar si hace falta). Si pdf_url viniera vacío, dilo también y sugiere generarlo a mano desde Presupuestos.`;

const TOOLS = [
  {
    name: 'listar_categorias',
    description: 'Lista todas las categorías de producto que existen en el catálogo (ej. Racks, Mancuernas, Bancos, Cardio, Suelos...), con su tipo (material o mobiliario). Úsala cuando no estés seguro de qué nombre exacto usar en buscar_productos.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'buscar_productos',
    description: 'Busca productos reales del catálogo por categoría (coincidencia parcial, no hace falta el nombre exacto) y devuelve todos los que hay con nombre, marca, precio de venta ya calculado, unidad de precio (ud o m2), accesorios incluidos y el nivel de calidad (económico/medio/premium) según ese precio dentro de esa categoría.',
    input_schema: {
      type: 'object',
      properties: {
        categoria: { type: 'string', description: 'Nombre o parte del nombre de la categoría a buscar, ej. "rack", "mancuernas", "cardio"' },
        marca: { type: 'string', description: 'Opcional — filtra solo productos de esta marca, cuando el usuario pide una marca concreta' },
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
    description: 'Crea un presupuesto REAL en el sistema de Presupuestos de Ranuse Design, con sus partidas, lo deja guardado (estado borrador) para ese proyecto, y genera y guarda automáticamente el PDF de cara al cliente. Solo se puede usar una vez que la persona ha confirmado el proyecto y los productos/nivel elegidos. Cada nombre de producto debe ser EXACTO tal cual lo devolvió buscar_productos.',
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
              cantidad: { type: 'number', description: 'Cantidad de unidades, por defecto 1. Si el producto se cobra por m² (unidad_precio "m2" en buscar_productos), pon aquí los metros cuadrados en vez de un número de piezas.' },
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

async function buscarProductos(categoriaQuery, marcaQuery) {
  const { data: cats } = await supabase.from('catalog_categories').select('id, name, type').ilike('name', `%${categoriaQuery}%`);
  if (!cats?.length) return { encontrado: false, mensaje: `No hay ninguna categoría que coincida con "${categoriaQuery}" en el catálogo.` };

  const catIds = cats.map(c => c.id);
  let query = supabase
    .from('catalog_products')
    .select('name, brand, price, category_id, purchase_dto, default_margin_pct, pricing_unit, included_accessories')
    .in('category_id', catIds)
    .not('price', 'is', null);
  if (marcaQuery?.trim()) query = query.ilike('brand', `%${marcaQuery.trim()}%`);
  const { data: products } = await query;

  if (!products?.length) {
    return marcaQuery?.trim()
      ? { encontrado: false, mensaje: `No hay productos de la marca "${marcaQuery}" en "${cats[0].name}" — prueba con otra marca o sin filtrar por marca.` }
      : { encontrado: false, mensaje: `La categoría "${cats[0].name}" existe pero no tiene productos con precio cargado todavía.` };
  }

  // Precio de venta real (ya con el criterio pvp+dto o coste+margen aplicado,
  // el mismo que usará crear_presupuesto) — es sobre este precio, no el de
  // catálogo en bruto, sobre el que se calculan los niveles y se informa.
  const conPrecioVenta = products.map(p => {
    const pricing = computeCatalogPricing(p);
    const precioVenta = pricing.pricing_mode === 'pvp' ? pricing.pvp_ref : pricing.unit_price;
    return { ...p, precioVenta };
  });

  // Nivel por precio, agrupado por categoría (por si buscarProductos matcheó varias categorías a la vez)
  const porCategoria = {};
  conPrecioVenta.forEach(p => {
    if (!porCategoria[p.category_id]) porCategoria[p.category_id] = [];
    porCategoria[p.category_id].push(p);
  });

  const resultado = [];
  Object.entries(porCategoria).forEach(([catId, items]) => {
    const catName = cats.find(c => c.id === catId)?.name || categoriaQuery;
    items.sort((a, b) => a.precioVenta - b.precioVenta);
    items.forEach((p, i) => {
      let nivel = 'medio';
      if (i === 0) nivel = 'económico';
      else if (i === items.length - 1 && items.length > 1) nivel = 'premium';
      resultado.push({
        categoria: catName,
        nombre: p.name,
        marca: p.brand || null,
        precio: p.precioVenta,
        precio_formateado: fmtEur(p.precioVenta),
        unidad_precio: p.pricing_unit || 'ud',
        accesorios_incluidos: p.included_accessories || null,
        nivel,
      });
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
      .select('id, name, brand, price, category_id, longitud, ancho, altura, color_bastidor, color_acolchado, tipo_acolchado, purchase_dto, default_margin_pct, pricing_unit, included_accessories, category:catalog_categories!catalog_products_category_id_fkey(type)')
      .ilike('name', nombreBuscado)
      .limit(1)
      .maybeSingle();

    if (!producto) {
      noEncontrados.push(nombreBuscado);
      continue;
    }

    const pricing = computeCatalogPricing(producto);
    const cantidad = parseFloat(it.cantidad) || 1;
    const { error: errItem } = await supabase.from('budget_items').insert({
      budget_id: budget.id,
      catalog_product_id: producto.id,
      name: producto.name,
      category: producto.category?.type || 'material',
      quantity: cantidad,
      unit: pricing.unit,
      unit_cost: pricing.unit_cost,
      markup_pct: pricing.markup_pct,
      unit_price: pricing.unit_price,
      pricing_mode: pricing.pricing_mode,
      pvp_ref: pricing.pvp_ref,
      purchase_dto: pricing.purchase_dto,
      display_order: displayOrder++,
      brand: producto.brand || null,
      longitud: producto.longitud || null,
      ancho: producto.ancho || null,
      altura: producto.altura || null,
      color_bastidor: producto.color_bastidor || null,
      color_acolchado: producto.color_acolchado || null,
      tipo_acolchado: producto.tipo_acolchado || null,
      accessories_note: producto.included_accessories || null,
    });
    if (!errItem) insertados.push(producto.name);
    else noEncontrados.push(nombreBuscado);
  }

  let pdf_url = null;
  if (insertados.length > 0) {
    pdf_url = await exportarPdfPresupuesto(budget.id);
  }

  const avisoEncontrados = noEncontrados.length
    ? ` Algunos productos no se encontraron en el catálogo con ese nombre exacto y no se añadieron: ${noEncontrados.join(', ')}.`
    : '';
  const avisoPdf = insertados.length > 0
    ? (pdf_url ? ' El PDF ya está generado y guardado.' : ' No se ha podido generar el PDF automáticamente — se puede exportar a mano desde Presupuestos.')
    : '';

  return {
    creado: true,
    budget_id: budget.id,
    budget_number: budget.budget_number,
    partidas_creadas: insertados,
    partidas_no_encontradas: noEncontrados,
    pdf_url,
    mensaje: `Presupuesto ${budget.budget_number} creado correctamente con ${insertados.length} partida(s).${avisoEncontrados}${avisoPdf}`,
  };
}

// Llama internamente a POST /api/budgets/:id/export-pdf (con los mismos
// valores por defecto que usaría Víctor al pulsar "PDF cliente") para que el
// presupuesto recién creado por el asistente quede con una copia de PDF ya
// guardada, sin que haga falta entrar a Presupuestos a generarla a mano.
async function exportarPdfPresupuesto(budgetId) {
  try {
    const port = process.env.PORT || 3001;
    const res = await fetch(`http://localhost:${port}/api/budgets/${budgetId}/export-pdf`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${internalAdminToken()}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.pdf_url || null;
  } catch {
    return null;
  }
}

async function runTool(name, input) {
  if (name === 'listar_categorias') return { categorias: await listarCategorias() };
  if (name === 'buscar_productos') return buscarProductos(input.categoria, input.marca);
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
    let budgetCreated = null; // último presupuesto creado en esta conversación (si lo hay), con su PDF
    for (let turn = 0; turn < 6; turn++) {
      lastResponse = await callClaude({ system, messages: conversation, tools: TOOLS });

      const toolUses = (lastResponse.content || []).filter(b => b.type === 'tool_use');
      if (toolUses.length === 0) break;

      // Añadir el turno del asistente (con sus tool_use) y luego los resultados
      conversation.push({ role: 'assistant', content: lastResponse.content });
      const toolResults = await Promise.all(toolUses.map(async tu => {
        const result = await runTool(tu.name, tu.input);
        if (tu.name === 'crear_presupuesto' && result?.creado) {
          budgetCreated = { budget_id: result.budget_id, budget_number: result.budget_number, pdf_url: result.pdf_url || null };
        }
        return { type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) };
      }));
      conversation.push({ role: 'user', content: toolResults });
    }

    const textBlock = (lastResponse?.content || []).find(b => b.type === 'text');
    res.json({
      reply: textBlock?.text || 'No he podido generar una respuesta.',
      messages: conversation.concat(lastResponse?.content ? [{ role: 'assistant', content: lastResponse.content }] : []),
      budget_created: budgetCreated,
    });
  } catch (error) {
    console.error('Error en asistente de presupuestos:', error);
    res.status(500).json({ error: error.message || 'Error al consultar al asistente' });
  }
});

export default router;
