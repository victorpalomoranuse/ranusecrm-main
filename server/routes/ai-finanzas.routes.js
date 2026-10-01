import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';
import { callClaude } from '../utils/anthropic.js';

const router = express.Router();
router.use(authenticateToken, requirePermission('finanzas'));

// Mismas listas que usa el formulario manual de Finanzas (SectionFinanzas.jsx)
// — si se añade o cambia una categoría ahí, hay que replicarlo aquí también.
const CATEGORIAS_GASTO = ['Nóminas', 'Materiales', 'Marketing', 'Software', 'Alquiler', 'Comisiones', 'Devolución', 'Fiscal', 'Otros'];
const CATEGORIAS_INGRESO = ['Venta proyecto', 'Anticipo', 'Diseño', 'Otros'];
const METODOS_PAGO = ['Transferencia', 'Tarjeta', 'Efectivo', 'Bizum', 'Otro'];

async function crearMovimiento(input, userId) {
  const tipo = input.tipo === 'ingreso' ? 'ingreso' : input.tipo === 'gasto' ? 'gasto' : null;
  if (!tipo) return { creado: false, error: 'Falta tipo (ingreso o gasto)' };

  const categoriasValidas = tipo === 'ingreso' ? CATEGORIAS_INGRESO : CATEGORIAS_GASTO;
  const categoria = categoriasValidas.includes(input.categoria) ? input.categoria : 'Otros';

  const concepto = input.concepto?.trim();
  if (!concepto) return { creado: false, error: 'Falta el concepto' };

  const monto = parseFloat(input.monto);
  if (isNaN(monto) || monto < 0) return { creado: false, error: `Importe no válido: "${input.monto}"` };

  const { data, error } = await supabase
    .from('finanzas_movimientos')
    .insert({
      tipo,
      categoria,
      concepto,
      monto,
      fecha: input.fecha || new Date().toISOString().slice(0, 10),
      metodo_pago: METODOS_PAGO.includes(input.metodo_pago) ? input.metodo_pago : null,
      beneficiario: input.beneficiario?.trim() || null,
      proveedor: input.proveedor?.trim() || null,
      notas: input.notas?.trim() || null,
      created_by: userId,
    })
    .select('id, tipo, categoria, concepto, monto, fecha')
    .single();
  if (error) return { creado: false, error: error.message };

  return { creado: true, movimiento: data };
}

const TOOLS = [
  {
    name: 'crear_movimiento',
    description: 'Da de alta un movimiento (ingreso o gasto) en Finanzas a partir de lo que veas en una factura, recibo, ticket o captura de un movimiento bancario. Llámala una vez por cada documento/movimiento distinto que detectes en las imágenes — si te mandan varias capturas a la vez, puede que tengas que llamarla varias veces en el mismo turno. Víctor revisa y ajusta todo después en Finanzas, así que créalo con tu mejor lectura — no hace falta que sea perfecto, pero nunca inventes un importe o una fecha que no veas con claridad: si no se lee bien, no la llames para ese documento y dilo en tu respuesta.',
    input_schema: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: ['ingreso', 'gasto'], description: 'Ingreso si es dinero que entra (cobro de un cliente, transferencia recibida...), gasto si es dinero que sale (factura pagada, compra, nómina...).' },
        categoria: { type: 'string', enum: [...new Set([...CATEGORIAS_INGRESO, ...CATEGORIAS_GASTO])], description: 'La que mejor encaje según el tipo — para gasto: Nóminas/Materiales/Marketing/Software/Alquiler/Comisiones/Devolución/Fiscal/Otros; para ingreso: Venta proyecto/Anticipo/Diseño/Otros.' },
        concepto: { type: 'string', description: 'Descripción breve y clara, ej. "Factura Leroy Merlin - material obra" o "Transferencia recibida - anticipo proyecto X". Si ves el nombre del proveedor/cliente o el nº de factura, inclúyelo aquí o en notas.' },
        monto: { type: 'number', description: 'Importe SIN IVA, en euros. Las capturas que te pasan suelen traer el importe CON IVA (el total que se paga de verdad) — si el documento ya muestra una "base imponible" aparte, usa esa directamente; si solo ves el total con IVA, divide entre 1,21 (IVA 21%) para sacar el importe sin IVA, y pon el resultado aquí. Dilo en tu respuesta de texto (el total con IVA y el que has guardado sin IVA), para que Víctor pueda comprobarlo.' },
        fecha: { type: 'string', description: 'Fecha del documento en formato YYYY-MM-DD, si se ve. Si no se ve ninguna fecha, omite este campo (se usará la fecha de hoy).' },
        metodo_pago: { type: 'string', enum: METODOS_PAGO, description: 'Si se puede deducir del documento (ej. "Pago con tarjeta", número de cuenta visible en una transferencia...).' },
        proveedor: { type: 'string', description: 'Nombre del proveedor/emisor de la factura o recibo, si aplica (normalmente para gastos).' },
        beneficiario: { type: 'string', description: 'A quién se le paga, SOLO si es un empleado del equipo de Ranuse (para nóminas/comisiones) — no lo uses para proveedores externos, de eso ya está el campo "proveedor".' },
        notas: { type: 'string', description: 'Cualquier detalle extra útil que no encaje en los campos de arriba (nº de factura, referencia, IVA desglosado si se ve, etc.) — opcional.' },
      },
      required: ['tipo', 'categoria', 'concepto', 'monto'],
    },
  },
];

const SYSTEM_PROMPT = `Eres el Asistente de Finanzas de Ranuse Design. Tu trabajo es leer fotos/capturas de facturas, recibos, tickets o movimientos bancarios que te pase Víctor, y dar de alta cada uno como un movimiento en Finanzas con la herramienta crear_movimiento — para que él no tenga que teclearlos a mano uno a uno. Víctor revisa y corrige todo después directamente en la sección Finanzas, así que tu trabajo es ir rápido y razonablemente bien, no perfecto.

CÓMO TRABAJAR:
- Si te mandan una sola imagen, es un solo documento → como mucho una llamada a crear_movimiento (puede que el documento tenga varias líneas, pero normalmente se registra como un único movimiento con el total).
- Si te mandan varias imágenes en el mismo mensaje, trata cada una como un documento independiente — llama a crear_movimiento una vez por cada una, salvo que sean claramente fotos distintas del MISMO documento (ej. una factura de dos páginas), en cuyo caso es un solo movimiento.
- NUNCA inventes un importe, una fecha o un dato que no se lea con claridad en la imagen. Si una imagen está borrosa, cortada, o no se entiende, NO llames a crear_movimiento para ella — dilo explícitamente en tu respuesta de texto (ej. "la segunda captura no se lee bien el importe, revísala tú o mándamela más clara") para que Víctor sepa que esa no se creó.
- Tipo: si es una factura/ticket/recibo de algo que se ha comprado o pagado → gasto. Si es un cobro, una transferencia recibida, un ingreso de un cliente → ingreso. Si no está claro, dilo en vez de adivinar al azar.
- Categoría: elige la que mejor encaje de la lista fija (ver la herramienta) — si ninguna encaja bien, usa "Otros" y explica en notas de qué se trata.
- Concepto: escríbelo tú de forma clara y breve, como lo escribiría Víctor a mano — no copies literalmente todo el texto de la factura, resume lo esencial (proveedor + qué es).
- Fecha: usa la fecha que aparezca en el propio documento (fecha de la factura/recibo/movimiento), no la fecha de hoy — solo usa hoy si no ves ninguna fecha en la imagen.
- IMPORTANTE — IVA: las capturas que te pasan traen el importe CON IVA (el total que se ha pagado de verdad). Finanzas guarda los importes SIN IVA, así que antes de llamar a crear_movimiento tienes que dividir ese total entre 1,21 (IVA 21%) — salvo que el propio documento ya muestre una "base imponible" o "importe sin IVA" aparte, en cuyo caso usa ese dato directamente sin volver a dividirlo. Nunca guardes el importe con IVA tal cual.

AL TERMINAR, responde siempre con un resumen breve en texto de lo que has creado, en lista, indicando SIEMPRE los dos importes (con IVA, visto en la captura → sin IVA, el que se ha guardado), tipo:
"He creado 2 movimientos:
- Gasto: Factura Leroy Merlin - material obra — 172,18€ con IVA → guardado 142,30€ sin IVA (03/10/2026)
- Ingreso: Transferencia recibida - anticipo Proyecto X — 1.500€ (ya venía sin IVA, no se ha tocado) (01/10/2026)
Revísalos en Finanzas para ajustar lo que haga falta."
Si alguna imagen no se pudo procesar, dilo también ahí, claramente, aparte de la lista de lo que sí se creó.

Sé directo — nada de explicaciones largas, Víctor tiene prisa y quiere ver rápido qué se ha creado.`;

router.post('/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages es requerido' });
    }

    let conversation = messages.map(m => ({ role: m.role, content: m.content }));
    const creados = [];
    let bestText = '';
    let lastResponse = null;

    for (let turn = 0; turn < 4; turn++) {
      lastResponse = await callClaude({ system: SYSTEM_PROMPT, messages: conversation, tools: TOOLS, maxTokens: 2000 });

      const turnText = (lastResponse.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n\n');
      if (turnText.length > bestText.length) bestText = turnText;

      const toolUses = (lastResponse.content || []).filter(b => b.type === 'tool_use');
      if (toolUses.length === 0) break;

      conversation.push({ role: 'assistant', content: lastResponse.content });
      const toolResults = await Promise.all(toolUses.map(async tu => {
        const result = await crearMovimiento(tu.input, req.user.id);
        if (result.creado) creados.push(result.movimiento);
        return { type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) };
      }));
      conversation.push({ role: 'user', content: toolResults });
    }

    res.json({ reply: bestText || 'No he podido generar una respuesta.', creados });
  } catch (error) {
    console.error('Error en asistente de finanzas:', error);
    res.status(500).json({ error: error.message || 'Error al consultar al asistente' });
  }
});

export default router;
