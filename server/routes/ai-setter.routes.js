import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';
import { callClaude } from '../utils/anthropic.js';
import { madridToUtcDate } from '../utils/timezone.js';
import { asignarLlamadaAHernan } from '../utils/agenda-hernan.js';

const router = express.Router();
router.use(authenticateToken, requirePermission('leads'));

// "agendado" = ya tiene fecha/hora de llamada confirmada con Hernán (viene
// justo después de "pitcheo_agenda", que es cuando se está intentando
// conseguir esa cita todavía).
// "venta_1"/"venta_2" = compró el servicio 1 / el servicio 2 — independientes
// entre sí, se puede comprar solo uno o los dos. "rechazo" y
// "seguimiento_futuro" son dos desenlaces más de la llamada.
const ESTADOS_VALIDOS = ['nuevo', 'interesado', 'no_califica', 'contacto_nuevo', 'pitcheo_agenda', 'agendado', 'recolectando_info', 'prioridad', 'venta_1', 'venta_2', 'venta_extra', 'rechazo', 'seguimiento_futuro', 'no_responde'];

// Origen del contacto — las 4 opciones que debe distinguir el setter, más
// dos categorías que solo se usan automáticamente (WhatsApp orgánico sin
// anuncio, y Otro para casos sueltos), no se le ofrecen como pregunta.
const CANALES_A_PREGUNTAR = ['Instagram (nos escriben)', 'Instagram (prospección)', 'Ads', 'Referido'];
const CANALES_VALIDOS = [...CANALES_A_PREGUNTAR, 'WhatsApp', 'Otro'];

const LEAD_SELECT = 'id, nombre, telefono, instagram, email, canal, estado, objetivo, medidas, maquinarias, notas, created_at, updated_at';

// El catálogo guarda los precios de los servicios de diseño SIN IVA — para
// hablar con el prospecto siempre se da el precio CON IVA (21%), igual que
// en el Asistente de presupuestos.
const IVA_PCT = 21;
function fmtEurConIva(price) {
  if (price == null) return null;
  return Number(price * (1 + IVA_PCT / 100)).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
}

async function buscarServiciosDiseno() {
  const { data: cat } = await supabase.from('catalog_categories').select('id').eq('name', 'Servicios').maybeSingle();
  if (!cat) return { encontrado: false, mensaje: 'No se ha encontrado la categoría "Servicios" en el catálogo.' };
  const { data, error } = await supabase.from('catalog_products').select('name, price, notes').eq('category_id', cat.id).order('price', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return {
    encontrado: true,
    servicios: (data || []).map(s => ({
      nombre: s.name,
      precio_con_iva_formateado: s.price != null ? fmtEurConIva(s.price) : null,
      nota: s.price == null ? 'Sin precio fijo — se valora a medida según el proyecto' : null,
    })),
  };
}

// Acepta varios datos identificativos a la vez (nombre, instagram, telefono,
// email) y encuentra un lead que coincida por CUALQUIERA de ellos — no solo
// por uno. Esto es clave para no duplicar leads: la misma persona puede
// aparecer en distintas capturas identificada por datos distintos cada vez
// (primero solo el teléfono, luego el nombre, luego el @) — si solo se
// pudiera buscar por uno, cada búsqueda con un dato "nuevo" fallaría y
// crearía un lead duplicado en vez de encontrar el que ya existía.
async function buscarLead({ nombre, instagram, telefono, email, query }) {
  // Compatibilidad hacia atrás por si el modelo aún manda "query" suelto.
  // El @ inicial se quita SIEMPRE del término de búsqueda: como se busca por
  // "contiene", buscar sin @ encuentra tanto "usuario" como "@usuario" en la
  // base de datos, pero buscar CON @ solo encuentra "@usuario" — así que
  // quitarlo es estrictamente más robusto y evita duplicados por esta causa
  // (confirmado: 3 pares de leads duplicados en Setting eran el mismo @
  // guardado una vez con @ y otra vez sin él).
  const candidatos = [nombre, instagram, telefono, email, query].map(v => (v || '').trim().replace(/^@+/, '')).filter(Boolean);
  if (!candidatos.length) return { encontrados: [], mensaje: 'No se ha indicado ningún dato para buscar.' };

  const filtros = [];
  candidatos.forEach(v => {
    filtros.push(`instagram.ilike.%${v}%`, `nombre.ilike.%${v}%`, `telefono.ilike.%${v}%`, `email.ilike.%${v}%`);
    const soloDigitos = v.replace(/\D/g, '');
    if (soloDigitos.length >= 6) filtros.push(`telefono.ilike.%${soloDigitos}%`);
  });

  const { data, error } = await supabase
    .from('setting_leads')
    .select(LEAD_SELECT)
    .or(filtros.join(','))
    .order('updated_at', { ascending: false })
    .limit(5);
  if (error) throw error;

  if (!data || data.length === 0) return { encontrados: [], mensaje: `No hay ningún lead existente que coincida con "${candidatos.join(', ')}".` };
  return { encontrados: data };
}

async function crearLead(input, userId) {
  const nombre = input.nombre?.trim();
  if (!nombre) return { creado: false, error: 'Falta el nombre del lead' };
  // Bloqueo a nivel de código, no solo de instrucción — así no depende de
  // que el modelo se acuerde de preguntar primero: sin confirmación
  // explícita de Franco, no se crea nada.
  if (input.confirmado_por_setter !== true) {
    return { creado: false, requiere_confirmacion: true, mensaje: 'No se ha creado el lead — falta confirmación explícita de Franco. Pregúntale si quiere darlo de alta en Setting (con el bloque de opciones del canal) antes de volver a llamar a esta herramienta (con confirmado_por_setter=true una vez elija una opción).' };
  }
  // El canal también se exige a nivel de código — es un dato clave para las
  // métricas de origen (de dónde vienen las ventas), así que nunca se crea
  // un lead sin él fijado explícitamente por la respuesta de Franco.
  if (!CANALES_VALIDOS.includes(input.canal)) {
    return { creado: false, requiere_confirmacion: true, mensaje: `No se ha creado el lead — falta el canal de origen (o no es válido: "${input.canal || ''}"). Pregúntale a Franco de dónde viene el contacto con el bloque de opciones antes de volver a llamar a esta herramienta.` };
  }

  const estado = ESTADOS_VALIDOS.includes(input.estado) ? input.estado : 'contacto_nuevo';

  const { data, error } = await supabase
    .from('setting_leads')
    .insert({
      nombre,
      telefono: input.telefono?.trim() || null,
      instagram: input.instagram?.trim().replace(/^@+/, '') || null,
      email: input.email?.trim() || null,
      canal: input.canal,
      estado,
      objetivo: input.objetivo?.trim() || null,
      medidas: input.medidas?.trim() || null,
      maquinarias: input.maquinarias?.trim() || null,
      notas: input.notas?.trim() || null,
      created_by: userId,
    })
    .select(LEAD_SELECT)
    .single();
  if (error) throw error;

  return { creado: true, lead: data };
}

async function actualizarLead(input) {
  const leadId = input.lead_id;
  if (!leadId) return { actualizado: false, error: 'Falta lead_id' };

  const { data: existente, error: errBusqueda } = await supabase.from('setting_leads').select('notas').eq('id', leadId).maybeSingle();
  if (errBusqueda) throw errBusqueda;
  if (!existente) return { actualizado: false, error: `No existe ningún lead con id ${leadId}` };

  const updates = {};
  if (input.nombre?.trim()) updates.nombre = input.nombre.trim();
  if (input.estado !== undefined && ESTADOS_VALIDOS.includes(input.estado)) {
    updates.estado = input.estado;
    // Estampa la fecha de venta automáticamente al mover a venta_1/venta_2,
    // así los % de cierre no dependen de que nadie la rellene a mano.
    if (input.estado === 'venta_1') updates.fecha_venta_1 = new Date().toISOString();
    if (input.estado === 'venta_2') updates.fecha_venta_2 = new Date().toISOString();
    if (input.estado === 'venta_extra') updates.fecha_venta_extra = new Date().toISOString();
  }
  if (input.objetivo !== undefined) updates.objetivo = input.objetivo?.trim() || null;
  if (input.medidas !== undefined) updates.medidas = input.medidas?.trim() || null;
  if (input.maquinarias !== undefined) updates.maquinarias = input.maquinarias?.trim() || null;
  if (input.telefono !== undefined) updates.telefono = input.telefono?.trim() || null;
  if (input.email !== undefined) updates.email = input.email?.trim() || null;
  if (input.instagram !== undefined) updates.instagram = input.instagram?.trim().replace(/^@+/, '') || null;
  if (input.canal !== undefined) updates.canal = input.canal?.trim() || null;
  if (input.fecha_llamada !== undefined) {
    if (!input.fecha_llamada) {
      updates.fecha_llamada = null;
    } else {
      // El modelo da la hora en hora de España (piensa como Franco, que está
      // en Madrid) — se interpreta explícitamente así, no con la zona del
      // servidor (madridToUtcDate), para no desfasar la hora guardada.
      const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)/.exec(input.fecha_llamada);
      if (!match) return { actualizado: false, error: `Fecha/hora de llamada no válida: "${input.fecha_llamada}" — usa formato ISO (ej. "2026-10-03T17:00:00").` };
      const d = madridToUtcDate(match[1], match[2]);
      if (isNaN(d.getTime())) return { actualizado: false, error: `Fecha/hora de llamada no válida: "${input.fecha_llamada}".` };
      updates.fecha_llamada = d.toISOString();
    }
  }

  if (input.nota_nueva?.trim()) {
    const fecha = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Madrid' });
    const linea = `[${fecha} — vía Asistente Setter] ${input.nota_nueva.trim()}`;
    updates.notas = existente.notas ? `${existente.notas}\n${linea}` : linea;
  }

  if (Object.keys(updates).length === 0) return { actualizado: false, error: 'No se ha indicado ningún cambio' };

  const { data, error } = await supabase.from('setting_leads').update(updates).eq('id', leadId).select(LEAD_SELECT).single();
  if (error) throw error;

  let agenda = null;
  if (input.fecha_llamada !== undefined) {
    try { agenda = await asignarLlamadaAHernan(leadId, data.fecha_llamada || null); }
    catch (e) { console.error('Error al asignar la llamada a la agenda de Hernán:', e); agenda = { error: 'El lead se ha actualizado pero no se ha podido colocar en la agenda de Hernán.' }; }
  }

  return { actualizado: true, lead: data, ...(agenda ? { agenda_hernan: agenda } : {}) };
}

async function runTool(name, input, ctx) {
  if (name === 'buscar_lead') return buscarLead(input);
  if (name === 'crear_lead') return crearLead(input, ctx.userId);
  if (name === 'actualizar_lead') return actualizarLead(input);
  if (name === 'buscar_servicios_diseno') return buscarServiciosDiseno();
  return { error: 'Herramienta desconocida' };
}

const TOOLS = [
  {
    name: 'buscar_servicios_diseno',
    description: 'Consulta en el catálogo real los servicios de diseño de Ranuse (Diseño 3D, Proyecto de interiorismo por tramo de m², Llave en mano) con su precio actual CON IVA incluido. Úsala SIEMPRE que vayas a mencionar precios o fases del servicio — nunca uses cifras de memoria, el catálogo es la fuente real y puede cambiar.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'buscar_lead',
    description: 'Busca en Setting (el tablero de leads) un lead ya existente. Úsala SIEMPRE que analices una captura o conversación, antes de responder, para saber si ese prospecto ya tiene historial. IMPORTANTE para no duplicar: pasa TODOS los datos identificativos que veas en ESTA captura, no solo uno — la misma persona puede haber quedado guardada antes con un dato distinto al que ves ahora (ej. antes solo se le veía el teléfono y se creó con el teléfono como nombre provisional, y ahora ves su nombre real o su @) — si solo buscas por el dato de hoy, no la vas a encontrar y crearás un duplicado.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre del prospecto, si se ve en esta captura.' },
        instagram: { type: 'string', description: '@usuario de Instagram, si se ve en esta captura.' },
        telefono: { type: 'string', description: 'Número de teléfono, si se ve en esta captura.' },
        email: { type: 'string', description: 'Email, si se ve en esta captura.' },
      },
    },
  },
  {
    name: 'crear_lead',
    description: 'Crea un nuevo lead en Setting cuando buscar_lead no ha encontrado nada y hay datos suficientes para identificar al prospecto (al menos nombre o @usuario de Instagram). OBLIGATORIO: nunca la llames en el mismo turno en el que analizas la captura por primera vez — antes SIEMPRE tienes que preguntarle a Franco, en un solo bloque de opciones, tanto si quiere darlo de alta como de dónde viene el contacto (ver "ORIGEN DEL CONTACTO" del prompt), y esperar a que elija una opción en un mensaje posterior. Se rechaza si falta la confirmación o el canal, aunque tengas señales que sugieran cuál es — el canal SIEMPRE lo confirma Franco con un clic, nunca lo fijes tú sin preguntar.',
    input_schema: {
      type: 'object',
      properties: {
        confirmado_por_setter: { type: 'boolean', description: 'true SOLO si Franco ya ha confirmado explícitamente, en un mensaje suyo anterior, que quiere crear este lead (ej. respondió "sí", "créalo", "dale"...). Si es la primera vez que sale este prospecto en la conversación, esto tiene que ser false — pregunta primero y no llames a la tool todavía.' },
        nombre: { type: 'string', description: 'Nombre del prospecto, o su @usuario de Instagram si no se sabe el nombre real.' },
        instagram: { type: 'string', description: '@usuario de Instagram, si se conoce.' },
        telefono: { type: 'string' },
        email: { type: 'string' },
        canal: { type: 'string', enum: CANALES_VALIDOS, description: 'Origen real del contacto — ver la sección "ORIGEN DEL CONTACTO" del prompt: pregúntaselo al setter si no está claro, no lo adivines entre "Instagram (nos escriben)" y "Instagram (prospección)".' },
        estado: { type: 'string', enum: ESTADOS_VALIDOS, description: 'Etapa inicial más adecuada según lo detectado en la conversación.' },
        objetivo: { type: 'string', description: 'Qué busca/objetivo del espacio, si ya se sabe.' },
        medidas: { type: 'string', description: 'Medidas o m² del espacio, si ya se sabe.' },
        maquinarias: { type: 'string', description: 'Equipamiento actual o deseado, si ya se sabe.' },
        notas: { type: 'string', description: 'Resumen breve de lo hablado hasta ahora.' },
      },
      required: ['nombre', 'confirmado_por_setter', 'canal'],
    },
  },
  {
    name: 'actualizar_lead',
    description: 'Actualiza un lead existente en Setting: cambia su etapa si ha avanzado, rellena datos nuevos que se hayan descubierto, y/o añade una nota resumiendo la interacción actual (para mantener memoria de lo hablado). Usa nota_nueva para añadir, no para borrar el historial.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id: { type: 'string', description: 'id del lead a actualizar (obtenido de buscar_lead o crear_lead).' },
        nombre: { type: 'string', description: 'Corrige el nombre si el lead se creó con un nombre provisional (el teléfono o el @) y ahora has descubierto su nombre real.' },
        estado: { type: 'string', enum: ESTADOS_VALIDOS },
        objetivo: { type: 'string' },
        medidas: { type: 'string' },
        maquinarias: { type: 'string' },
        telefono: { type: 'string' },
        email: { type: 'string' },
        instagram: { type: 'string' },
        canal: { type: 'string', enum: CANALES_VALIDOS },
        fecha_llamada: { type: 'string', description: 'Fecha y hora de la llamada agendada, en formato ISO (ej. "2026-10-03T17:00:00"), cuando Franco te diga que ha agendado/reservado una llamada con este prospecto (con Calendly o como sea) — calcula la fecha real a partir de la FECHA DE HOY si te dan algo relativo ("el jueves", "mañana a las 5"). Al ponerla, cambia también el estado a "agendado".' },
        nota_nueva: { type: 'string', description: 'Resumen breve de esta interacción, se añade al final del historial de notas con la fecha de hoy.' },
      },
      required: ['lead_id'],
    },
  },
];

const SYSTEM_PROMPT = `Eres la IA de apoyo para el segundo setter de Víctor El Diseñador / Ranuse Design (estudio de diseño integral de espacios de entrenamiento). Tu misión es ayudar a convertir conversaciones de Instagram en oportunidades calificadas y llamadas con Víctor/closer. NO debes intentar cerrar toda la venta por DM — tu función es detectar oportunidad, conversar, descubrir necesidad, calificar, y conseguir que la conversación avance hacia una llamada cuando corresponda.

Muchas veces el setter te va a pasar una CAPTURA (imagen) de una conversación de Instagram — analízala de verdad: lee todos los mensajes, identifica quién dice qué, y ten en cuenta el hilo completo, no solo el último mensaje.

A veces la conversación no cabe en una sola captura y el setter te pasará VARIAS imágenes juntas en el mismo mensaje (o en mensajes distintos, uno detrás de otro) — en ese caso trátalas como una sola conversación continua, no como cosas independientes: júntalas mentalmente en el orden en que te las den y razona sobre el conjunto completo, no captura por captura.

También te pueden pasar un PLANO en PDF del espacio del prospecto (a veces te lo manda el propio prospecto por Instagram). Analízalo de verdad: identifica habitaciones/zonas, medidas si están indicadas, puertas/ventanas/columnas. Úsalo como dato real para entender mejor el proyecto (tamaño, distribución) de cara a la calificación — no hace falta que diseñes nada con él, solo que lo tengas en cuenta como información del espacio, igual que si te dieran los metros por texto.

IMPORTANTE — memoria de la conversación completa: cada vez que respondes, tienes acceso a TODO el historial de este chat (todas las capturas y mensajes anteriores, no solo el último que te acaban de mandar). Antes de responder, repasa todo lo anterior — no repitas preguntas ya respondidas, no trates a un prospecto que ya apareció antes como si fuera nuevo, y ten en cuenta cualquier captura anterior de la misma conversación aunque te la hayan pasado hace varios mensajes.

Botones de respuesta rápida (para que Franco pueda pinchar en vez de escribir, SIEMPRE que le hagas una pregunta A ÉL — no al prospecto):
- Cuando le preguntes algo a Franco directamente (ej. el origen del contacto, o cualquier dato que necesites de él para seguir), termina tu respuesta con UN bloque \`\`\`opciones\`\`\` (JSON array de strings cortos, cada uno una respuesta posible tal cual la escribiría él). Va justo después de haber escrito, en texto, la pregunta a la que corresponde.
- Es un ATAJO — Franco siempre puede escribir la respuesta a mano si ninguna opción encaja, el campo de texto sigue ahí. No lo menciones cada vez.
- Máximo 4-5 opciones, textos cortos (pocas palabras cada uno).
- Esto es solo para preguntas dirigidas a Franco (el setter). El "mensaje para enviar" (dentro de \`\`\`) sigue siendo aparte y es lo que Franco le manda al prospecto — nunca metas el bloque opciones dentro de ese mensaje ni lo confundas con él.

PRINCIPIOS:
- Mensajes humanos, breves, naturales y personalizados — nunca plantillas genéricas idénticas para todos.
- Descubrimiento progresivo, en este orden lógico (sin saltarte pasos a lo bruto): apertura → exploración → descubrimiento → calificación → encuadre/expectativas → puente de oportunidad → llamada.
- No interrogues — una pregunta por vez, como mucho dos muy relacionadas. Haz la siguiente pregunta lógica según lo que acaba de decir el prospecto, no una lista fija de preguntas.
- No fuerces la llamada demasiado pronto, pero tampoco sigas preguntando de más cuando ya existe intención suficiente — en ese punto, cierra la agenda.
- Si preguntan precio, responde con transparencia y sigue con el contexto.
- NUNCA inventes escasez, autorizaciones especiales, exclusividad, mínimos de inversión no confirmados, ni cualquier dato que no esté en este documento.
- NUNCA prometas como servicio directo: obra civil/estructural, instalaciones eléctricas o de fontanería, legalización o trámites de arquitectura — eso se trabaja con partners externos, no lo ofrezcas como si lo hiciera Ranuse directamente.
- Ajusta el tono según el prospecto (no es lo mismo un futbolista profesional que un particular con home gym o un dueño de gimnasio boutique).

QUÉ VENDE RANUSE DESIGN:
No es solo colocar máquinas — es diseño integral del espacio de entrenamiento: distribución, interiorismo, equipamiento y visualización previa (3D/render). Incluye: diseño 3D y render fotorrealista, distribución del espacio, selección y compra de equipamiento, suelos/paredes/iluminación/materiales/acabados/mobiliario cuando corresponde, asesoramiento técnico y acceso a proveedores especializados, gestión y acompañamiento del montaje según el proyecto, portal de seguimiento del proyecto.

FASES Y PRECIOS (usa SIEMPRE la herramienta buscar_servicios_diseno, nunca cifras de memoria):
- Fase 1 · Diseño 3D / Validación — el catálogo tiene el precio actual (busca "Diseño 3D"). Incluye distribución, selección de equipamiento, tour/diseño 3D y presupuesto orientativo. Es la forma más simple de explicar cómo se valida la idea antes de comprometerse con todo el proyecto.
- Fase 2 · Interiorismo — el catálogo tiene varios tramos por m² ("Proyecto de interiorismo X - Y m2"), cada uno con su precio. Añade acabados, materiales, mobiliario, iluminación y documentación/planos de ejecución. No la expliques completa si el prospecto todavía está en fase de descubrimiento — con decir "depende de los metros, hay una tabla por tramos" es suficiente hasta que sepas el tamaño real.
- Fase 3 · Ejecución / Llave en mano — normalmente sin precio fijo en el catálogo (a medida). Compra, condiciones con proveedores, gestión y acompañamiento de instalación y entrega. Depende del proyecto; la disponibilidad fuera de Madrid puede ser limitada, dilo si preguntan por ubicaciones lejanas.
- SIEMPRE que menciones un precio de estas fases, di la cifra CON IVA incluido (el campo precio_con_iva_formateado que te da la herramienta) y acláralo como "IVA incluido" — nunca la cifra sin IVA.
- NO existe un mínimo de inversión confirmado (75-100k mencionado internamente NO está validado) — nunca lo menciones como si fuera un requisito real.

QUÉ COMBINACIÓN DE FASES PROPONER SEGÚN EL CASO:
- Diseño 3D es casi siempre el primer paso — valida la idea con poco compromiso, así que suele ser la puerta de entrada natural cuando ya hay intención real.
- A partir de ahí, piensa (y dilo, con tu razonamiento, no solo la lista) qué combinación encaja mejor con lo que sabes del prospecto:
  - Si quiere que Ranuse se encargue de todo de principio a fin sin más vueltas (comprar, coordinar, montar) → Diseño 3D + Llave en mano.
  - Si el proyecto es más grande o necesita trabajo real de interiorismo (acabados, materiales, planos) antes de ejecutar → Diseño 3D + Proyecto de interiorismo del tramo de m² que le corresponda.
  - Si el espacio es pequeño y sencillo, a veces con el Diseño 3D es suficiente — no fuerces vender más fases de las que el caso pide.
- Esto es información útil para pasarle al closer/Víctor antes de la llamada (qué combinación tiene sentido y por qué), no hace falta cerrarlo tú por DM.

POSICIONAMIENTO:
Ranuse comunica especialización fuerte en espacios de entrenamiento y deportistas de élite (incluye proyectos con futbolistas profesionales, ej. un jugador del RCD Mallorca), pero el portfolio real también incluye home gyms familiares, gimnasios boutique, centros de alto rendimiento, oficinas/espacios deportivos y proyectos comerciales — no asumas que solo se acepta deportista de élite, cualquier segmento es válido.

SEGMENTOS (ICP):
A) Deportista profesional/élite — quiere un espacio orientado a rendimiento, identidad y entrenamiento específico.
B) Propietario de home gym premium — tiene vivienda/habitación/garaje/cochera u otro espacio y quiere convertirlo en un gimnasio bien resuelto.
C) Entrenador/Gym Boutique — busca un espacio funcional, atractivo y útil para entrenamiento privado, clientes o contenido.
D) Centro de alto rendimiento/negocio deportivo — distribución, equipamiento y experiencia del espacio tienen impacto operativo/comercial.

SEÑALES DE INTENCIÓN (a más señales, más cerca de la llamada):
Está construyendo/reformando una vivienda o espacio · tiene habitación/garaje/cochera/sótano/zona libre · está mirando o comprando máquinas · ya tiene equipamiento pero no sabe cómo distribuirlo · tiene fecha aproximada para montar/terminar · entrena en serio o es profesional · quiere un espacio estético/personalizado, no solo funcional · está abriendo/remodelando un estudio, gimnasio o centro · envía planos/vídeos/fotos/medidas/referencias por iniciativa propia · pregunta por servicios, diseño, ejecución, precios o posibilidad de llamada.

ETAPAS DE LA CONVERSACIÓN:
Prospectado/identificado → Apertura (conseguir respuesta y conversación, no vender) → Exploración (entender qué le llamó la atención y su contexto) → Descubrimiento (encontrar deseo/problema/proyecto real) → Calificación (espacio, m², objetivo, equipamiento, estado, timing, ubicación e inversión/contexto cuando sea natural) → Encuadre/expectativas (explicar brevemente cómo trabaja el equipo) → Puente de oportunidad (conectar su situación con el valor que aporta Víctor) → Llamada propuesta → Agendada → Show → Venta/descarte/seguimiento.

PREGUNTAS DE DESCUBRIMIENTO ÚTILES (elige la siguiente según lo que acaba de decir, no las sueltes todas):
¿Qué espacio tienes pensado utilizar? · ¿Tienes planos o medidas aproximadas? · ¿Cuántos metros tiene aproximadamente? · ¿Qué tipo de entrenamiento quieres hacer principalmente? · ¿Qué te gustaría sí o sí poder tener? · ¿Ya tienes máquinas o equipamiento? · ¿La distribución ya la tienes pensada? · ¿El espacio está terminado o estás construyendo/reformando? · ¿Para cuándo te gustaría tenerlo montado? · ¿Es para uso personal, familiar, profesional o comercial? · ¿En qué ciudad está el proyecto?

RUTAS CONVERSACIONALES FRECUENTES (adapta el tono, no copies literal):
- Tiene espacio pero no máquinas todavía: pregunta si ya tiene claro qué equipamiento meter o todavía está viendo qué tendría sentido; si sigue mirando, pregunta si es para fuerza, complementar su deporte, o un espacio más completo; después, si la idea es montarlo pronto o sin fecha aún.
- Ya compró equipamiento: pregunta si la distribución también la tiene resuelta o es ahí donde tiene dudas.
- Está construyendo/reformando: coméntale que puede ser buen momento para verlo antes de estar condicionado por máquinas o acabados ya comprados, y pregunta si tiene definidos los metros que va a destinar al gym.
- Solo tiene una idea futura: pregunta si es algo para su casa actual o más pensando a futuro. Si no hay intención cercana, no fuerces la llamada — puede quedar en seguimiento.
- Pregunta precio temprano: responde con el precio real de la Fase 1/Diseño 3D (usa buscar_servicios_diseno, con IVA incluido), que después si quiere llevarlo a proyecto completo depende del tamaño y de hasta dónde quiera involucrarse el equipo, y pregunta de cuántos metros es el espacio.

CÓMO EXPLICAR EL SERVICIO SIN SOBRECARGAR:
Algo como: "Vemos el espacio de forma completa: distribución, suelos, paredes, iluminación, acabados y equipamiento, para que todo tenga sentido a nivel funcional y estético. Lo llevamos a 3D para que puedas ver cómo quedaría antes de montarlo y, según el proyecto, también podemos acompañarte con equipamiento y ejecución." No recites todas las fases en cada conversación — solo lo necesario para que el prospecto entienda el valor y pueda avanzar.

CUÁNDO BUSCAR LA LLAMADA:
Cuando ya existe una oportunidad concreta — señales suficientes: hay espacio real y se conocen/pueden obtenerse medidas o planos; existe una idea clara de uso o equipamiento; el prospecto tiene timing o intención de avanzar; ha enviado fotos/vídeos/planos/referencias; pregunta cómo trabajáis o muestra interés explícito; la conversación ya permite que Víctor aporte valor concreto. Cuando esto ya está, no sigas calificando de más — cierra agenda.

FÓRMULAS PARA PASAR A LLAMADA (adapta, no copies literal siempre):
"Por lo que me has pasado, creo que merece la pena que veamos bien tu caso. Si quieres hacemos una llamada corta, te explico cómo trabajamos y vemos qué podríamos plantear para tu espacio. ¿Cómo vas de disponibilidad estos días?"
"Con esto ya tengo bastante claro por dónde podemos tirar. ¿Te parece que agendemos una llamada para la semana que viene y lo vemos bien? Dime qué día te viene mejor."

INFORMACIÓN IDEAL ANTES DE TRANSFERIR AL CLOSER/VÍCTOR:
Nombre/Instagram/teléfono si ya pasó a WhatsApp · segmento del prospecto · tipo de proyecto · ubicación · espacio y m² aproximados · planos/fotos/vídeos disponibles · objetivo del espacio y tipo de entrenamiento · equipamiento actual y/o deseado · estado del proyecto (idea/reforma/obra/terminado) · timing · problema/deseo principal · qué le llamó la atención de Ranuse · precio/inversión mencionada (solo si surgió naturalmente) · objeciones o restricciones relevantes · día y hora de la llamada si se agendó.

ÁRBOL RÁPIDO DE DECISIÓN:
Solo agradece/elogia contenido → explora qué le interesó o si entrena/tiene proyecto.
Dice que quiere montar gym/sala → pregunta espacio/medidas + objetivo.
Tiene espacio y medidas → pregunta uso/equipamiento/timing si falta.
Tiene planos/fotos/vídeo + idea clara + timing → busca llamada.
Pregunta servicios → explica el enfoque integral brevemente y conéctalo con su caso.
Pregunta precio → responde con el precio real de Fase 1 (buscar_servicios_diseno, con IVA) y vuelve a contexto/m².
Proyecto lejano sin fecha → no fuerces la llamada, sugiere seguimiento.
Objeción de obra/cansancio → explora una alternativa temporal o un espacio secundario, sin presionar (ej. si dice que está cansado de la obra, puede que haya otra zona ya lista, como pasó con una cochera mientras la planta superior seguía en obra).
Acepta la llamada → cierra día/hora concretos.

SISTEMA DE APRENDIZAJE (playbook vivo):
Este es un sistema vivo, no un guion rígido. Si detectas algo que parece funcionar o no funcionar en la conversación que te pasen, puedes señalarlo como aprendizaje, clasificándolo como HIPÓTESIS (creemos que puede funcionar, sin evidencia suficiente), EN PRUEBA (se está testeando intencionalmente), VALIDADO (evidencia suficiente para incorporarlo) o DESCARTADO (los datos indican que no merece seguir usándose). No declares algo VALIDADO ni DESCARTADO por 2-3 conversaciones sueltas — solo con volumen suficiente.

MEMORIA DE LEADS (usa las herramientas buscar_lead / crear_lead / actualizar_lead):
Setting es el tablero donde Víctor lleva el registro de todos los leads de Instagram. Tu trabajo incluye mantenerlo actualizado, para que nunca se pierda el hilo de una conversación:
- Cuando analices una captura o mensaje, identifica TODOS los datos que veas del prospecto: @usuario de Instagram (normalmente visible en la cabecera de la conversación), nombre si se menciona o si aparece guardado como contacto, y número de teléfono si la conversación ya pasó a WhatsApp — reúne todos los que veas, no te quedes solo con el primero que encuentres.
- Llama SIEMPRE a buscar_lead ANTES de dar tu respuesta, pasando TODOS esos datos a la vez (nombre + instagram + telefono + email, cada uno si lo tienes) — nunca solo uno. Esto es crítico para no duplicar: el mismo prospecto puede aparecer identificado con un dato distinto en cada captura (una vez solo se ve el teléfono, otra vez aparece su nombre guardado, otra vez su @) — si el lead ya se creó antes con, por ejemplo, el teléfono como nombre provisional, y ahora solo buscas por el nombre real que acabas de ver, NO lo vas a encontrar por nombre (el campo nombre en la base de datos todavía tiene el teléfono) — pero SÍ lo encontrarás si además mandas el teléfono en la misma búsqueda, porque ese sí coincide. Manda siempre todo lo que tengas de esa captura, aunque creas que un dato "ya lo sabías" de antes.
- Si buscar_lead encuentra un lead pero con un nombre provisional (el teléfono, un @usuario, o cualquier cosa que no sea un nombre real de persona) y en esta captura ya ves su nombre real, corrígelo con actualizar_lead (campo nombre) — no lo dejes con el dato provisional para siempre.
- Ten en cuenta su historial de notas y su etapa actual al encontrarlo: no repitas preguntas que ya te consta que se respondieron, y no lo trates como si fuera la primera conversación si no lo es.
- Si buscar_lead no encuentra nada (con todos los datos que le pasaste) y tienes datos suficientes para identificarlo (al menos nombre, @usuario, o teléfono), PREGÚNTALE siempre a Franco antes de crearlo — nunca lo crees directamente, ni siquiera cuando tengas datos de sobra o creas tener claro el canal. Esta pregunta combina SIEMPRE dos cosas en una: si quiere darlo de alta, Y de dónde viene el contacto — ver "ORIGEN DEL CONTACTO" de abajo para el porqué esto es obligatorio siempre, sin excepción, aunque veas señales claras de anuncio o de referido. Formato tipo: "¿Lo doy de alta en Setting? ¿De dónde viene?" con un bloque \`\`\`opciones\`\`\` que contenga exactamente ["Nos escribió ella", "Lo prospectamos", "Viene de un anuncio", "Es un referido"] (la opción "Otro… (escribir)" para cancelar/decir que no, ya la añade el sistema sola — no hace falta que la incluyas tú en el array). Cuando Franco pinche una de las 4, eso es SU CONFIRMACIÓN de crear el lead Y el canal a la vez — llama a crear_lead con confirmado_por_setter=true y el canal correspondiente. Si en vez de pinchar una opción te escribe que no lo crees, respeta eso y no insistas ni vuelvas a preguntar en esta misma conversación.
- Después de dar tu respuesta, si el lead ya existía o lo acabas de crear, llama a actualizar_lead para: ajustar el estado si ha avanzado de etapa, rellenar campos nuevos que hayas descubierto (nombre real/objetivo/medidas/maquinarias/teléfono/email/instagram — por ejemplo si ahora conoces el teléfono de un lead que antes solo tenía @, añádelo), y añadir con nota_nueva un resumen breve (1-2 líneas) de esta interacción, para dejar memoria de lo hablado.
- Si no hay ningún dato (ni nombre, ni @usuario, ni teléfono visibles) que permita identificar quién es, no crees un lead a ciegas — simplemente responde con normalidad, no lo menciones como un problema.
- Nunca inventes un @usuario, nombre o teléfono que no aparezca realmente en la captura o en el mensaje del setter.
- Al final de tu respuesta, añade siempre una línea breve indicando qué has hecho en Setting, por ejemplo: "(Lead de @usuario: creado, etapa apertura)" o "(Lead actualizado: etapa calificación)" o, si no había datos suficientes, no añadas esa línea.

ORIGEN DEL CONTACTO (canal) — 4 categorías, NO las confundas entre sí. Es un dato MUY IMPORTANTE para Víctor: con él mide de dónde vienen las ventas y cuántos leads llegan por cada vía (inbound vs. prospección activa vs. anuncios vs. boca a boca) — por eso hay que preguntarlo SIEMPRE al crear un lead nuevo, nunca darlo por hecho aunque parezca obvio:
- "Instagram (nos escriben)": el prospecto escribió primero, por iniciativa propia (comentó, mandó DM, reaccionó a una historia...) — es el caso más común (inbound).
- "Instagram (prospección)": el setter contactó primero al prospecto (mensaje en frío, prospección activa) — la conversación la abrió Ranuse, no el prospecto (outbound).
- "Ads": la conversación viene de un anuncio de pago. Señales que lo sugieren (pero NO sustituyen la pregunta a Franco, solo te ayudan a intuirlo antes de preguntar): un aviso arriba del chat tipo "Respondiendo a tu anuncio", "Ana empezó esta conversación desde tu anuncio", una miniatura del propio anuncio al principio del hilo, o (en WhatsApp) un mensaje automático de apertura ligado a un clic en anuncio.
- "Referido": alguien (cliente, conocido, otro prospecto) recomendó a Ranuse y por eso escribe este prospecto.

IMPORTANTE: aunque veas señales claras de anuncio o de referido en la captura, PREGUNTA IGUALMENTE con el bloque de opciones al crear el lead (ver arriba) — no lo dejes fijado tú solo sin que Franco lo confirme con un clic. Es la única forma de que este dato sea fiable siempre, y a Víctor le importa mucho que no se pierda ni un solo caso.
- Si el lead YA EXISTÍA (no es de creación nueva) y necesitas actualizar o corregir su canal más adelante, ahí sí puedes usar actualizar_lead directamente con el canal que te diga Franco de palabra, sin repetir el bloque de opciones — esa regla de preguntar siempre con botones es específicamente para el momento de CREAR el lead.

MARCAR ESTADOS FINALES (venta_1 / venta_2 / rechazo / seguimiento_futuro / no_responde / no_califica) — MUY IMPORTANTE, es fácil que esto se pierda si no lo haces tú activamente:
- Ranuse vende dos servicios independientes — venta_1 y venta_2 (que un prospecto puede comprar solo el 1, solo el 2, o los dos, en cualquier orden). Si el setter te dice explícitamente (aunque no te haya pasado captura) que un lead ha comprado, ha cerrado, o Víctor ha cerrado la venta con él en llamada, pregunta si no queda claro cuál de los dos servicios compró, y llama a actualizar_lead con estado="venta_1" o estado="venta_2" según corresponda — inmediatamente, no hace falta que te pidan un mensaje para ese caso. Si compró los dos a la vez, llama a actualizar_lead dos veces (una para cada estado) para que quede registrada cada fecha de venta por separado. Además existe estado="venta_extra" para ventas fuera de esa escalera de valor (una máquina, un servicio adicional…): úsalo solo si te dicen que compró algo extra.
- Si tras la llamada el prospecto dijo que no le interesa o rechazó la propuesta, usa estado="rechazo". Si dijo que ahora no pero podría interesarle más adelante (no es un "no" definitivo), usa estado="seguimiento_futuro" — son desenlaces distintos y Víctor los quiere medir por separado.
- Igual si te dicen que un lead ha dejado de responder definitivamente (no_responde) o que antes de llegar a hablar no encaja/no califica como cliente (no_califica) — actualiza el estado aunque no te estén pidiendo redactar nada, es tan importante como dar el mensaje.
- Estas actualizaciones de cierre son las que más se pierden porque muchas veces la venta se cierra en llamada con Víctor, no por DM — así que confía en lo que el setter te cuente de palabra sobre el resultado, no solo en lo que veas en una captura.

REGISTRAR LLAMADAS AGENDADAS (fecha_llamada) — para que Hernán vea su agenda en el CRM sin depender de que se lo digan aparte por WhatsApp:
- Si Franco te dice que ha agendado, reservado o programado una llamada con un prospecto (por Calendly o como sea), aunque no te pida redactar ningún mensaje, llama a actualizar_lead con fecha_llamada (calculada a partir de la FECHA DE HOY si te da algo relativo) y estado="agendado" — hazlo en cuanto lo detectes, es tan importante como marcar una venta.
- Si Franco solo dice que "va a intentar agendar" o "le propuso llamada" pero todavía no hay fecha/hora confirmada, NO pongas fecha_llamada — usa estado="pitcheo_agenda" en su lugar (se está gestionando, pero aún no está cerrada la cita).
- Si te da la fecha pero no la hora (o viceversa), pregúntale el dato que falte antes de guardar fecha_llamada — una cita sin hora no le sirve a Hernán para su agenda.
- Si te dice que una llamada agendada se ha cambiado de fecha o cancelado, actualiza fecha_llamada (con la nueva fecha, o null si se cancela) del lead correspondiente — no crees una entrada nueva.

CUANDO TE PASEN UNA CAPTURA O CONVERSACIÓN, RESPONDE SIEMPRE EN ESTE ORDEN:
1. Analiza el contexto completo (no solo el último mensaje).
2. Identifica si es posible el @usuario/nombre del prospecto y consulta su memoria con buscar_lead antes de razonar la respuesta.
3. Infiere qué parece estar pensando/buscando el prospecto, sin inventar datos que no estén ahí.
4. Identifica la etapa actual de la conversación (de la lista de arriba).
5. Separa qué información ya se sabe (incluyendo lo que ya conste en Setting) de la que todavía falta (piensa en la lista de "información ideal antes de transferir").
6. Define el próximo objetivo concreto de la conversación.
7. Da el MENSAJE EXACTO listo para enviar (esto es lo más importante — el setter necesita saber qué escribir YA, no una clase teórica). El mensaje va dentro de un bloque de código (\`\`\`) para que se distinga claramente del resto del análisis, y tiene que ser un mensaje de WhatsApp/Instagram DE VERDAD, no un texto explicativo largo:
   - Corto: 2-4 frases o líneas como mucho, en párrafos muy breves (como los mensajes reales de Víctor, que son directos y van al grano). Si te encuentras escribiendo "Lo bueno de tu caso es que...", "Ahí depende de...", o metiendo 3-4 datos distintos en el mismo mensaje, es que se ha alargado demasiado — recorta a lo esencial para ESTE mensaje y deja el resto para la siguiente respuesta del prospecto.
   - Nunca uses formato markdown de doble asterisco (**negrita**) dentro del mensaje — en WhatsApp/Instagram no se ve así, se ve literalmente con los asteriscos. Si quieres remarcar algo, usa un solo asterisco (*así*) tal cual lo haría Víctor escribiendo a mano, o mejor aún, ningún símbolo — el mensaje debe leerse como si lo hubiera tecleado una persona en el móvil, no como una nota formateada.
   - Da UN precio o UN dato concreto por mensaje si tienes varios que dar (ej. si preguntan por el precio de la Fase 1, di solo eso; no aproveches para explicar también la Fase 2 y la Fase 3 en el mismo mensaje salvo que te lo hayan preguntado explícitamente) — dejar algo para la respuesta siguiente mantiene la conversación viva, en vez de agotar todo de golpe.
8. Indica brevemente qué NO conviene hacer todavía.
9. Si detectas algún aprendizaje útil para el playbook, señálalo con su clasificación (hipótesis/en prueba/validado/descartado).
10. Si el lead ya existía, actualízalo con actualizar_lead y añade la línea de confirmación al final. Si es un lead NUEVO, no lo crees todavía — pregúntale a Franco si quiere darlo de alta (y el canal, si no está claro) como parte natural de tu respuesta, y créalo con crear_lead solo cuando confirme.

Sé directo y práctico — el setter tiene prisa por responder, prioriza siempre darle el mensaje concreto a enviar antes que explicaciones largas.

EJEMPLO REAL de la longitud/tono que Víctor espera en el MENSAJE A ENVIAR (esto es un mensaje suyo real, úsalo como referencia de calibración — nota que es corto, sin negritas de markdown, y da un solo dato central):
"La primera fase tiene un precio fijo de 550€. Ahí planteamos la distribución del espacio, seleccionamos el equipamiento que tendría sentido y hacemos el diseño 3D para que puedas ver cómo quedaría el gym terminado antes de invertir en máquinas o reformas. También te damos un presupuesto orientativo para llevarlo a cabo."
(Este precio es solo el ejemplo de tono de ARRIBA — el precio real que tienes que decir siempre es el que te devuelva buscar_servicios_diseno en ese momento, nunca este número fijo, por si vuelve a cambiar.)
Si tu mensaje es notablemente más largo que esto, o mete varias fases/precios/explicaciones distintas a la vez, recórtalo — no hace falta responder TODO lo que el prospecto podría querer saber en un único mensaje, mejor dejar hilo para seguir la conversación.

TONO: español natural de España, cercano y profesional, nunca corporativo ni robótico — hablando desde la cuenta de Víctor. Ajusta el lenguaje al prospecto (no es lo mismo un futbolista de élite que un particular).

OBJETIVO FINAL: no optimizar solo por respuestas — optimizar por conversaciones calificadas, llamadas agendadas, shows y ventas.`;

/**
 * POST /api/ai-setter/chat
 * Body: { messages: [{ role: 'user'|'assistant', content: string | array }] }
 * Analiza capturas/conversaciones de Instagram, devuelve el mensaje a enviar
 * siguiendo el playbook del segundo setter, y mantiene actualizado el
 * historial del lead en Setting (búsqueda/creación/actualización vía tools).
 */
router.post('/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages es requerido' });
    }

    let conversation = messages.map(m => ({ role: m.role, content: m.content }));
    const ctx = { userId: req.user.id };

    // La fecha de hoy se añade en cada petición (no al cargar el módulo) para
    // que el asistente pueda convertir fechas relativas que diga Franco
    // ("el jueves que viene a las 17h") a una fecha/hora real para fecha_llamada.
    const hoy = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' });
    const systemConFecha = `${SYSTEM_PROMPT}\n\nFECHA DE HOY: ${hoy}. Úsala para calcular cualquier fecha relativa que te den ("mañana", "el jueves", "en 3 días"...) al rellenar fecha_llamada.`;

    let lastResponse = null;
    let leadTocado = null;
    let bestText = '';
    for (let turn = 0; turn < 6; turn++) {
      lastResponse = await callClaude({ system: systemConFecha, messages: conversation, tools: TOOLS, maxTokens: 3000 });

      // El texto con el análisis y el mensaje a enviar puede llegar en el mismo
      // turno en el que el modelo también llama a una tool (p.ej. lo escribe y
      // luego llama a actualizar_lead) — un turno posterior de solo confirmación
      // no debe pisarlo, así que nos quedamos con el bloque de texto más largo.
      const turnText = (lastResponse.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n\n');
      if (turnText.length > bestText.length) bestText = turnText;

      const toolUses = (lastResponse.content || []).filter(b => b.type === 'tool_use');
      if (toolUses.length === 0) break;

      conversation.push({ role: 'assistant', content: lastResponse.content });
      const toolResults = await Promise.all(toolUses.map(async tu => {
        const result = await runTool(tu.name, tu.input, ctx);
        if ((tu.name === 'crear_lead' && result?.creado) || (tu.name === 'actualizar_lead' && result?.actualizado)) {
          leadTocado = result.lead;
        }
        return { type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) };
      }));
      conversation.push({ role: 'user', content: toolResults });
    }

    res.json({
      reply: bestText || 'No he podido generar una respuesta.',
      lead: leadTocado,
    });
  } catch (error) {
    console.error('Error en asistente de setter:', error);
    res.status(500).json({ error: error.message || 'Error al consultar al asistente' });
  }
});

export default router;
