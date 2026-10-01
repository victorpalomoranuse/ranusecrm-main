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

// Busca un movimiento ya existente que pueda ser el mismo documento subido
// otra vez (mismo tipo, importe prácticamente igual, y fecha cercana) — para
// no duplicar si Víctor sube sin querer la misma foto dos veces, o la misma
// factura en dos capturas distintas. No es 100% infalible (dos gastos reales
// y distintos podrían coincidir en importe y fecha), así que solo AVISA y no
// crea nada — nunca descarta un documento real por error silencioso.
async function buscarPosibleDuplicado({ tipo, monto, fecha }) {
  const fechaRef = fecha || new Date().toISOString().slice(0, 10);
  // OJO: antes esto miraba ±3 días, pensado para "subió la misma foto dos
  // veces". Pero al importar un extracto bancario con decenas de movimientos
  // es normalísimo tener varios cargos recurrentes del mismo proveedor (ej.
  // "Compra Anthropic Ireland") en días distintos por importes parecidos —
  // con la ventana de 3 días, el segundo cargo real se marcaba como
  // "duplicado" y se perdía en silencio. Ahora solo miramos el MISMO día
  // exacto, que es lo que de verdad indica "esto ya lo metí antes".
  const { data } = await supabase
    .from('finanzas_movimientos')
    .select('id, concepto, monto, fecha, proveedor')
    .eq('tipo', tipo)
    .eq('fecha', fechaRef);

  return (data || []).find(m => Math.abs(Number(m.monto) - monto) < 0.01) || null;
}

async function crearMovimiento(input, userId) {
  const tipo = input.tipo === 'ingreso' ? 'ingreso' : input.tipo === 'gasto' ? 'gasto' : null;
  if (!tipo) return { creado: false, error: 'Falta tipo (ingreso o gasto)' };

  const categoriasValidas = tipo === 'ingreso' ? CATEGORIAS_INGRESO : CATEGORIAS_GASTO;
  const categoria = categoriasValidas.includes(input.categoria) ? input.categoria : 'Otros';

  const concepto = input.concepto?.trim();
  if (!concepto) return { creado: false, error: 'Falta el concepto' };

  const monto = parseFloat(input.monto);
  if (isNaN(monto) || monto < 0) return { creado: false, error: `Importe no válido: "${input.monto}"` };

  const fecha = input.fecha || new Date().toISOString().slice(0, 10);
  const duplicado = await buscarPosibleDuplicado({ tipo, monto, fecha });
  if (duplicado) {
    return {
      creado: false,
      posible_duplicado: true,
      existente: duplicado,
      mensaje: `No se ha creado — ya existe un movimiento muy parecido: "${duplicado.concepto}" por ${duplicado.monto}€ el ${duplicado.fecha}${duplicado.proveedor ? ` (${duplicado.proveedor})` : ''}. Si de verdad es un documento distinto (ej. dos facturas distintas por casualidad con el mismo importe), dilo explícitamente en tu respuesta para que Víctor decida si crearlo a mano.`,
    };
  }

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
    description: 'Da de alta un movimiento (ingreso o gasto) en Finanzas a partir de lo que veas en una factura, recibo, ticket o extracto bancario/de tarjeta (foto o PDF). Llámala una vez por cada movimiento distinto que detectes: una factura suelta es una llamada, pero un extracto con una lista de movimientos es UNA LLAMADA POR CADA FILA de esa lista — si el extracto tiene 80 filas, son 80 llamadas, repartidas en las que hagan falta. Víctor revisa y ajusta todo después en Finanzas, así que créalo con tu mejor lectura — no hace falta que sea perfecto, pero nunca inventes un importe o una fecha que no veas con claridad: si una fila o un documento no se lee bien, no la llames para esa y dilo en tu respuesta.',
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

const SYSTEM_PROMPT = `Eres el Asistente de Finanzas de Ranuse Design. Tu trabajo es leer fotos/capturas o PDFs de facturas, recibos, tickets o movimientos bancarios que te pase Víctor, y dar de alta cada uno como un movimiento en Finanzas con la herramienta crear_movimiento — para que él no tenga que teclearlos a mano uno a uno. Víctor revisa y corrige todo después directamente en la sección Finanzas, así que tu trabajo es ir rápido y razonablemente bien, no perfecto.

CÓMO TRABAJAR:
Primero identifica qué tipo de documento es cada uno — es la decisión más importante, porque cambia totalmente cuántos movimientos salen de él:
- FACTURA / RECIBO / TICKET SUELTO (una compra, un pago, un cobro): es UN documento → como mucho una llamada a crear_movimiento (puede tener varias líneas de producto, pero normalmente se registra como un único movimiento con el total).
- EXTRACTO BANCARIO O DE TARJETA (una lista de movimientos de cuenta, "últimos movimientos", varias filas con fecha + descripción + importe): esto es UNA LISTA, no un documento único. Tienes que llamar a crear_movimiento UNA VEZ POR CADA FILA/MOVIMIENTO de la lista, sin excepción — un extracto con 88 movimientos son 88 llamadas a la herramienta, no una. Revisa TODAS las páginas del PDF antes de empezar a crear nada, para saber cuántas filas hay en total.
- Si te mandan varios documentos sueltos en el mismo mensaje (imágenes y/o PDFs mezclados), trata cada uno como independiente — una llamada por cada uno, salvo que sean claramente partes del MISMO documento (ej. una factura de dos páginas en dos fotos), en cuyo caso es un solo movimiento.
- NUNCA inventes un importe, una fecha o un dato que no se lea con claridad. Si una fila de un extracto o un documento suelto está cortado o no se entiende, NO llames a crear_movimiento para él — dilo explícitamente en tu respuesta de texto para que Víctor sepa que ese no se creó.
- MUY IMPORTANTE — no te dejes ningún movimiento sin procesar: antes de dar tu respuesta final, cuenta tú mismo cuántos movimientos hay en total (documentos sueltos + TODAS las filas de TODOS los extractos que te hayan pasado, recorriendo cada página), y repásalos uno por uno — por cada uno, tiene que haber pasado una de estas tres cosas: (1) llamaste a crear_movimiento para él, (2) se saltó por venir repetido/duplicado (eso te lo dice la propia herramienta), o (3) lo mencionaste explícitamente en tu respuesta como "no se pudo leer". Si al repasar ves que alguno no entra en ninguno de los tres casos, es que se te ha olvidado — vuelve a llamar a crear_movimiento para él antes de terminar. Con extractos largos es muy fácil saltarse filas sin querer (sobre todo si el PDF tiene las columnas desalineadas o el texto se corta entre páginas), así que haz este repaso siempre.
- Tipo: si es dinero que sale (compra, pago, "a favor de", recibo pagado) → gasto. Si es dinero que entra (cobro, transferencia recibida "de" un cliente, un ingreso) → ingreso. En un extracto bancario el propio signo del importe YA te lo dice: negativo = gasto, positivo = ingreso — úsalo siempre que esté disponible, no lo adivines por el texto.
- Categoría: elige la que mejor encaje de la lista fija (ver la herramienta) — si ninguna encaja bien, usa "Otros" y explica en notas de qué se trata.
- Concepto: escríbelo tú de forma clara y breve, como lo escribiría Víctor a mano — no copies literalmente todo el texto de la factura o la fila del extracto, resume lo esencial (proveedor/beneficiario + qué es).
- Fecha: usa la fecha que aparezca en el propio documento o fila (fecha de la factura/recibo/movimiento — en un extracto, la "fecha operación"), no la fecha de hoy — solo usa hoy si no ves ninguna fecha.
- IMPORTANTE — IVA: en facturas/recibos/tickets sueltos, las capturas suelen traer el importe CON IVA (el total que se ha pagado de verdad); divide entre 1,21 (IVA 21%) antes de guardarlo, salvo que el propio documento ya muestre una "base imponible" o "importe sin IVA" aparte, en cuyo caso usa ese dato directamente sin volver a dividirlo.
  En un EXTRACTO BANCARIO no hay forma de saber, línea por línea, si un cargo concreto lleva IVA o no (una nómina no, una compra con tarjeta normalmente sí, una transferencia a un proveedor depende de la factura que la originó...). No intentes razonarlo caso por caso: aplica la regla por defecto a TODAS las filas del extracto sin excepción — divide siempre entre 1,21 — y deja que Víctor corrija a mano después los pocos casos donde no toque (él mismo revisa cada movimiento en Finanzas). Es mejor una regla simple y consistente que te dejes IVA sin quitar en unos sí y en otros no.
  Nunca guardes el importe con IVA tal cual, en ningún caso.

AL TERMINAR, empieza SIEMPRE tu resumen con el recuento total de MOVIMIENTOS (no de documentos — un extracto cuenta por cada una de sus filas) vs. lo que ha pasado con cada uno, y luego el detalle en lista. Para facturas/recibos sueltos, indica los dos importes (con IVA, visto en el documento → sin IVA, el que se ha guardado); para filas de un extracto, basta con indicar el importe guardado (ya sin IVA) sin repetir el "con IVA, visto" en cada línea — pero si el lote es grande, resume por bloques en vez de listar las 80 líneas una a una (ej. agrupa por proveedor o por tipo), el detalle completo ya queda en Finanzas:
"Recibidos 3 documentos → 2 movimientos creados, 1 duplicada, 0 ilegibles.
- Gasto: Factura Leroy Merlin - material obra — 172,18€ con IVA → guardado 142,30€ sin IVA (03/10/2026)
- Ingreso: Transferencia recibida - anticipo Proyecto X — 1.500€ (ya venía sin IVA, no se ha tocado) (01/10/2026)
- El tercero ya existía (duplicado con un gasto de 50€ del 02/10/2026) — no se ha creado otra vez.
Revísalos en Finanzas para ajustar lo que haga falta."
Si algún movimiento no se pudo procesar, dilo también ahí, claramente, aparte de la lista de lo que sí se creó. El número de movimientos del recuento tiene que coincidir exactamente con (creados + duplicadas + ilegibles) — si no coincide, es que te has dejado alguno sin repasar.

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

    // Contamos las imágenes de verdad en servidor (no nos fiamos solo de que
    // el modelo las cuente bien) y se lo decimos explícitamente en el
    // sistema — un ancla concreta contra la que puede comprobar su propio
    // recuento final, para no dejarse ninguna sin procesar en lotes grandes.
    const ultimoMensaje = messages[messages.length - 1];
    const numDocumentos = Array.isArray(ultimoMensaje?.content) ? ultimoMensaje.content.filter(b => b.type === 'image' || b.type === 'document').length : 0;
    const systemConContexto = numDocumentos > 0
      ? `${SYSTEM_PROMPT}\n\nEn el último mensaje de Víctor hay exactamente ${numDocumentos} archivo(s) adjuntos (imagen o PDF). OJO: esto cuenta ARCHIVOS, no movimientos — si alguno de esos archivos es un extracto bancario con una lista de movimientos, tu recuento final de movimientos (creados + duplicadas + ilegibles) va a ser mucho mayor que ${numDocumentos}, porque cada fila del extracto es un movimiento aparte. Usa este número solo para comprobar que no te has olvidado de abrir/revisar alguno de los ${numDocumentos} archivos enteros, no como el total de movimientos esperado.`
      : SYSTEM_PROMPT;

    // Más margen de turnos que otros asistentes: un extracto bancario largo
    // puede generar decenas de llamadas a la herramienta repartidas en varios
    // turnos (el modelo no siempre las manda todas de golpe), y cada turno
    // con muchas tool_use necesita más tokens de salida para no cortarse a
    // mitad de una llamada.
    for (let turn = 0; turn < 25; turn++) {
      lastResponse = await callClaude({ system: systemConContexto, messages: conversation, tools: TOOLS, maxTokens: 8000 });

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
