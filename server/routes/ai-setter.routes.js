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

const LEAD_SELECT = 'id, nombre, telefono, instagram, email, canal, estado, objetivo, medidas, maquinarias, notas, assigned_to, fecha_llamada, fecha_venta_1, fecha_venta_2, fecha_venta_extra, extra_descripcion, extra_importe, created_at, updated_at';

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

// Convierte lo que da el modelo (hora de España) a un ISO UTC correcto.
// Acepta "YYYY-MM-DD" (se toma el mediodía de Madrid) o "YYYY-MM-DDTHH:mm[:ss]".
function fechaMadridAISO(valor) {
  const v = String(valor || '').trim();
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?))?/.exec(v);
  if (!m) return { error: `Fecha no válida: "${valor}" — usa formato ISO (ej. "2026-10-03" o "2026-10-03T17:00:00").` };
  const d = madridToUtcDate(m[1], m[2] || '12:00');
  if (isNaN(d.getTime())) return { error: `Fecha no válida: "${valor}".` };
  return { iso: d.toISOString() };
}

// Resuelve "asignado_a" (nombre de un empleado) al id del empleado.
async function resolverEmpleado(nombre) {
  const n = (nombre || '').trim();
  if (!n) return { id: null };
  const { data } = await supabase.from('employees').select('id, name').ilike('name', `%${n}%`).limit(2);
  if (!data || data.length === 0) return { error: `No encuentro ningún empleado que se llame "${n}".` };
  if (data.length > 1) return { error: `Hay varios empleados que encajan con "${n}" (${data.map(e => e.name).join(', ')}) — pregunta a cuál te refieres.` };
  return { id: data[0].id };
}

// Revisión de la ficha tras crear/actualizar: lo que falte o sea incoherente
// ensucia las métricas de Setting (origen, ventas por fecha de venta, llamadas...),
// así que se le devuelve al modelo para que se lo pida a Franco o lo corrija.
function revisarFicha(l) {
  const faltan = [];
  const avisos = [];
  if (!l.canal) faltan.push('canal de origen (Instagram nos escriben / prospección / Ads / Referido): sin él no cuenta en las métricas por canal');
  if (!l.telefono && !l.instagram) faltan.push('teléfono o @instagram, para poder identificar al lead');
  if (l.estado === 'venta_1' && !l.fecha_venta_1) faltan.push('fecha de la venta 1 (las ventas se cuentan por su fecha)');
  if (l.estado === 'venta_2' && !l.fecha_venta_2) faltan.push('fecha de la venta 2 (las ventas se cuentan por su fecha)');
  if (l.estado === 'venta_extra' && !l.fecha_venta_extra) faltan.push('fecha de la venta extra');
  if (l.estado === 'agendado' && !l.fecha_llamada) faltan.push('fecha y hora de la llamada (estado agendado sin fecha)');
  const esVenta = !!(l.fecha_venta_1 || l.fecha_venta_2 || l.fecha_venta_extra);
  if (esVenta && !l.fecha_llamada) avisos.push('Tiene venta pero no consta fecha de llamada: no entra en "Llamadas" ni en "Cierre en llamada". Si hubo llamada, pásala (aunque sea pasada).');
  if (l.fecha_venta_extra && !l.extra_descripcion) avisos.push('Venta extra sin descripción de qué se vendió.');
  const creado = l.created_at ? new Date(l.created_at).getTime() : null;
  [['fecha_venta_1', 'venta 1'], ['fecha_venta_2', 'venta 2'], ['fecha_venta_extra', 'venta extra']].forEach(([k, etq]) => {
    if (creado && l[k] && new Date(l[k]).getTime() < creado - 86400000) avisos.push(`La fecha de la ${etq} es anterior a la fecha de creación del lead: revisa las dos fechas.`);
  });
  if (!l.objetivo && !l.medidas && !l.maquinarias) avisos.push('Faltan objetivo, medidas y equipamiento: rellénalos si los has visto en la conversación.');
  return { completa: faltan.length === 0, faltan, avisos };
}

async function crearLead(input, userId) {
  const nombre = input.nombre?.trim();
  if (!nombre) return { creado: false, error: 'Falta el nombre del lead' };
  // Bloqueo a nivel de código, no solo de instrucción — así no depende de
  // que el modelo se acuerde de preguntar primero: sin confirmación
  // explícita de Franco, no se crea nada.
  if (input.confirmado_por_setter !== true) {
    return { creado: false, requiere_confirmacion: true, mensaje: 'No se ha creado el lead — falta confirmación explícita de Franco. Si él no ha pedido crearlo, pregúntale si quiere darlo de alta en Setting (con el bloque de opciones del canal) antes de volver a llamar a esta herramienta (con confirmado_por_setter=true). Si SÍ te lo ha pedido en su mensaje ("créalo", "dalo de alta"...), eso ya es la confirmación: vuelve a llamar con confirmado_por_setter=true.' };
  }
  // El canal también se exige a nivel de código — es un dato clave para las
  // métricas de origen (de dónde vienen las ventas), así que nunca se crea
  // un lead sin él fijado explícitamente por la respuesta de Franco.
  if (!CANALES_VALIDOS.includes(input.canal)) {
    return { creado: false, requiere_confirmacion: true, mensaje: `No se ha creado el lead — falta el canal de origen (o no es válido: "${input.canal || ''}"). Si Franco no lo ha dicho, pregúntale SOLO eso, con el bloque de opciones, antes de volver a llamar a esta herramienta.` };
  }

  const fechas = {};
  for (const k of ['fecha_creacion', 'fecha_llamada', 'fecha_venta_1', 'fecha_venta_2', 'fecha_venta_extra']) {
    if (input[k] === undefined || input[k] === null || input[k] === '') continue;
    const r = fechaMadridAISO(input[k]);
    if (r.error) return { creado: false, error: `${k}: ${r.error}` };
    fechas[k] = r.iso;
  }
  const asignado = await resolverEmpleado(input.asignado_a);
  if (asignado.error) return { creado: false, error: asignado.error };

  // Estado: el que se indique; si no, se deduce de las fechas dadas.
  let estado = ESTADOS_VALIDOS.includes(input.estado) ? input.estado : null;
  if (!estado) {
    const ventas = [['venta_1', fechas.fecha_venta_1], ['venta_2', fechas.fecha_venta_2], ['venta_extra', fechas.fecha_venta_extra]].filter(([, f]) => f).sort((a, b) => b[1].localeCompare(a[1]));
    estado = ventas.length ? ventas[0][0] : (fechas.fecha_llamada ? 'agendado' : 'contacto_nuevo');
  }
  // Fecha de venta: la que dé Franco; si el estado es de venta y no la dio, se estampa hoy.
  const ahora = new Date().toISOString();
  if (estado === 'venta_1' && !fechas.fecha_venta_1) fechas.fecha_venta_1 = ahora;
  if (estado === 'venta_2' && !fechas.fecha_venta_2) fechas.fecha_venta_2 = ahora;
  if (estado === 'venta_extra' && !fechas.fecha_venta_extra) fechas.fecha_venta_extra = ahora;

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
      assigned_to: asignado.id || null,
      fecha_llamada: fechas.fecha_llamada || null,
      fecha_venta_1: fechas.fecha_venta_1 || null,
      fecha_venta_2: fechas.fecha_venta_2 || null,
      fecha_venta_extra: fechas.fecha_venta_extra || null,
      extra_descripcion: input.extra_descripcion?.trim() || null,
      extra_importe: input.extra_importe !== undefined && input.extra_importe !== null && input.extra_importe !== '' ? Number(input.extra_importe) : null,
      ...(fechas.fecha_creacion ? { created_at: fechas.fecha_creacion } : {}),
      created_by: userId,
    })
    .select(LEAD_SELECT)
    .single();
  if (error) throw error;

  let agenda = null;
  if (data.fecha_llamada) {
    try { agenda = await asignarLlamadaAHernan(data.id, data.fecha_llamada); }
    catch (e) { console.error('Error al asignar la llamada a la agenda de Hernán:', e); agenda = { error: 'El lead se ha creado pero no se ha podido colocar la llamada en la agenda de Hernán.' }; }
  }

  return { creado: true, lead: data, ficha: revisarFicha(data), ...(agenda ? { agenda_hernan: agenda } : {}) };
}

async function actualizarLead(input) {
  const leadId = input.lead_id;
  if (!leadId) return { actualizado: false, error: 'Falta lead_id' };

  const { data: existente, error: errBusqueda } = await supabase.from('setting_leads').select('notas, fecha_venta_1, fecha_venta_2, fecha_venta_extra').eq('id', leadId).maybeSingle();
  if (errBusqueda) throw errBusqueda;
  if (!existente) return { actualizado: false, error: `No existe ningún lead con id ${leadId}` };

  const updates = {};
  if (input.nombre?.trim()) updates.nombre = input.nombre.trim();

  // Fechas explícitas (hora de España)
  const fechas = {};
  for (const k of ['fecha_creacion', 'fecha_venta_1', 'fecha_venta_2', 'fecha_venta_extra']) {
    if (input[k] === undefined) continue;
    if (input[k] === null || input[k] === '') { fechas[k] = null; continue; }
    const r = fechaMadridAISO(input[k]);
    if (r.error) return { actualizado: false, error: `${k}: ${r.error}` };
    fechas[k] = r.iso;
  }

  if (input.estado !== undefined && ESTADOS_VALIDOS.includes(input.estado)) {
    updates.estado = input.estado;
    // Estampa la fecha de venta al pasar a venta_1/2/extra SOLO si el lead no
    // la tenía ya (si no, cada actualización la movería a hoy y se
    // falsearían las métricas por fecha de venta) y no se ha indicado una.
    const ahora = new Date().toISOString();
    if (input.estado === 'venta_1' && !existente.fecha_venta_1 && fechas.fecha_venta_1 === undefined) updates.fecha_venta_1 = ahora;
    if (input.estado === 'venta_2' && !existente.fecha_venta_2 && fechas.fecha_venta_2 === undefined) updates.fecha_venta_2 = ahora;
    if (input.estado === 'venta_extra' && !existente.fecha_venta_extra && fechas.fecha_venta_extra === undefined) updates.fecha_venta_extra = ahora;
  }
  if (fechas.fecha_creacion !== undefined && fechas.fecha_creacion) updates.created_at = fechas.fecha_creacion;
  if (fechas.fecha_venta_1 !== undefined) updates.fecha_venta_1 = fechas.fecha_venta_1;
  if (fechas.fecha_venta_2 !== undefined) updates.fecha_venta_2 = fechas.fecha_venta_2;
  if (fechas.fecha_venta_extra !== undefined) updates.fecha_venta_extra = fechas.fecha_venta_extra;
  if (input.extra_descripcion !== undefined) updates.extra_descripcion = input.extra_descripcion?.trim() || null;
  if (input.extra_importe !== undefined) updates.extra_importe = input.extra_importe === null || input.extra_importe === '' ? null : Number(input.extra_importe);
  if (input.asignado_a !== undefined) {
    const asignado = await resolverEmpleado(input.asignado_a);
    if (asignado.error) return { actualizado: false, error: asignado.error };
    updates.assigned_to = asignado.id;
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

  return { actualizado: true, lead: data, ficha: revisarFicha(data), ...(agenda ? { agenda_hernan: agenda } : {}) };
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
    description: 'Crea un nuevo lead en Setting cuando buscar_lead no ha encontrado nada y hay datos suficientes para identificar al prospecto (al menos nombre o @usuario de Instagram). Rellena LA FICHA ENTERA en esta misma llamada con todo lo que sepas (contacto, canal, estado, objetivo/medidas/equipamiento, notas, fecha de creación real, fecha de llamada, fechas de venta...) — después de crear, revisa el campo "ficha" del resultado. REGLAS DE CONFIRMACIÓN: si Franco te ha pedido crearlo explícitamente ("créalo", "dalo de alta", "mete este lead"...) eso YA es la confirmación (confirmado_por_setter=true) y, si en ese mismo mensaje te dice el canal, úsalo sin volver a preguntar. Si no te lo ha pedido (solo te pasó una captura), pregúntale antes, en un solo bloque de opciones, si quiere darlo de alta y de dónde viene (ver "ORIGEN DEL CONTACTO"), y espera su elección. Se rechaza si falta la confirmación o el canal — el canal nunca lo adivines.',
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
        fecha_creacion: { type: 'string', description: 'Fecha REAL en la que el lead entró/se contactó por primera vez, cuando Franco la indica o se ve en la conversación (ej. "2026-09-27" o "2026-09-27T18:30:00", hora de España). Si la das, el lead se crea CON ESA FECHA, no con la de hoy — cuenta para las métricas del mes en que entró. Si no la sabes, omítela (se usa hoy).' },
        fecha_llamada: { type: 'string', description: 'Fecha y hora de la llamada (ISO, hora de España), futura o pasada, si Franco la menciona. Pon también un estado coherente (agendado, o el de venta si ya compró).' },
        fecha_venta_1: { type: 'string', description: 'Fecha en la que compró el servicio 1 (YYYY-MM-DD o ISO). Las ventas se cuentan por esta fecha, no por la de creación.' },
        fecha_venta_2: { type: 'string', description: 'Fecha en la que compró el servicio 2 (YYYY-MM-DD o ISO).' },
        fecha_venta_extra: { type: 'string', description: 'Fecha de una venta extra fuera de la escalera de valor (máquina, servicio adicional...).' },
        extra_descripcion: { type: 'string', description: 'Qué se vendió en la venta extra.' },
        extra_importe: { type: 'number', description: 'Importe de la venta extra en euros, si se conoce.' },
        asignado_a: { type: 'string', description: 'Nombre del empleado al que se asigna el lead (ej. "Hernán"), solo si Franco lo indica.' },
      },
      required: ['nombre', 'confirmado_por_setter', 'canal'],
    },
  },
  {
    name: 'actualizar_lead',
    description: 'Actualiza un lead existente en Setting: cambia su etapa si ha avanzado, rellena datos nuevos que se hayan descubierto (incluidas fechas de creación, de llamada y de venta), y/o añade una nota resumiendo la interacción actual. Usa nota_nueva para añadir, no para borrar el historial. Tras actualizar, revisa el campo "ficha" del resultado: si algo falta, pídeselo a Franco.',
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
        fecha_creacion: { type: 'string', description: 'Corrige la fecha real en la que el lead entró (YYYY-MM-DD o ISO, hora de España), si Franco te la indica o ves que estaba mal.' },
        fecha_venta_1: { type: 'string', description: 'Fecha real en la que compró el servicio 1, si Franco te la indica (si no la das al marcar venta_1, se estampa hoy SOLO si el lead no tenía fecha). null para quitarla.' },
        fecha_venta_2: { type: 'string', description: 'Fecha real en la que compró el servicio 2. null para quitarla.' },
        fecha_venta_extra: { type: 'string', description: 'Fecha de la venta extra. null para quitarla.' },
        extra_descripcion: { type: 'string', description: 'Qué se vendió en la venta extra.' },
        extra_importe: { type: 'number', description: 'Importe de la venta extra en euros.' },
        asignado_a: { type: 'string', description: 'Nombre del empleado al que se asigna el lead, solo si Franco lo indica.' },
      },
      required: ['lead_id'],
    },
  },
];

const SYSTEM_PROMPT = `Eres la IA de apoyo para el segundo setter de Víctor El Diseñador / Ranuse Design (estudio de diseño integral de espacios de entrenamiento). Tu misión es ayudar a convertir conversaciones de Instagram en oportunidades calificadas y llamadas con Víctor/closer. NO debes intentar cerrar toda la venta por DM — tu función es detectar oportunidad, conversar, descubrir necesidad, calificar, y conseguir que la conversación avance hacia una llamada cuando corresponda.

Muchas veces el setter te va a pasar una CAPTURA (imagen) de una conversación de Instagram o WhatsApp — analízala de verdad: lee todos los mensajes, identifica quién dice qué, y ten en cuenta el hilo completo, no solo el último mensaje.

CÓMO LEER UNA CAPTURA (regla fija, sin excepciones — es el error más grave que puedes cometer, porque si confundes quién dijo qué todo lo demás sale mal):
- Los mensajes de la OTRA PERSONA (el prospecto) son SIEMPRE los que salen por la IZQUIERDA de la pantalla (burbujas alineadas a la izquierda, a menudo con su foto de perfil al lado).
- Los mensajes NUESTROS (el setter / Víctor) son SIEMPRE los que salen por la DERECHA (burbujas alineadas a la derecha).
- Guíate SOLO por el lado en el que está pegada la burbuja, no por el color (cambia según la app, el tema oscuro/claro o el chat), ni por el contenido, ni por lo que "parezca" lógico. Si una burbuja está a la derecha, la escribimos nosotros aunque suene a pregunta del cliente; si está a la izquierda, la escribió el prospecto aunque suene a respuesta nuestra.
- Un mensaje con una cita/respuesta a otro (la tira pequeña encima de la burbuja) pertenece al lado de su burbuja, no al lado del mensaje citado. Las reacciones (emojis pegados a una burbuja), las fechas/horas separadoras, "visto", "entregado", las notas de voz y los vídeos son parte del hilo: úsalos para entender el orden, pero no los confundas con mensajes.
- Lee la conversación de arriba a abajo (lo más antiguo arriba, lo más reciente abajo). El ÚLTIMO mensaje es el de más abajo — fíjate en de qué lado está: si el último es NUESTRO (derecha), el prospecto aún no ha contestado; no respondas como si ya lo hubiera hecho.
- Antes de proponer ningún mensaje, escribe siempre al principio de tu respuesta (en el MISMO texto en el que das el mensaje a enviar, no en un turno aparte ni antes de llamar a una herramienta), en dos líneas muy cortas, "Último del prospecto (izquierda): …" y "Nuestro último (derecha): …" con lo que has leído, para que el setter pueda comprobar de un vistazo que lo has entendido bien. Si algo en la captura no se lee con claridad (texto cortado, borroso, lado dudoso), dilo en una línea y pregunta antes de inventarte nada.

A veces la conversación no cabe en una sola captura y el setter te pasará VARIAS imágenes juntas en el mismo mensaje (o en mensajes distintos, uno detrás de otro) — en ese caso trátalas como una sola conversación continua, no como cosas independientes: júntalas mentalmente en el orden en que te las den y razona sobre el conjunto completo, no captura por captura.

También te pueden pasar un PLANO en PDF del espacio del prospecto (a veces te lo manda el propio prospecto por Instagram). Analízalo de verdad: identifica habitaciones/zonas, medidas si están indicadas, puertas/ventanas/columnas. Úsalo como dato real para entender mejor el proyecto (tamaño, distribución) de cara a la calificación — no hace falta que diseñes nada con él, solo que lo tengas en cuenta como información del espacio, igual que si te dieran los metros por texto.

IMPORTANTE — memoria de la conversación completa: cada vez que respondes, tienes acceso a TODO el historial de este chat (todas las capturas y mensajes anteriores, no solo el último que te acaban de mandar). Antes de responder, repasa todo lo anterior — no repitas preguntas ya respondidas, no trates a un prospecto que ya apareció antes como si fuera nuevo, y ten en cuenta cualquier captura anterior de la misma conversación aunque te la hayan pasado hace varios mensajes.

Botones de respuesta rápida (para que Franco pueda pinchar en vez de escribir, SIEMPRE que le hagas una pregunta A ÉL — no al prospecto):
- Cuando le preguntes algo a Franco directamente (ej. el origen del contacto, o cualquier dato que necesites de él para seguir), termina tu respuesta con UN bloque \`\`\`opciones\`\`\` (JSON array de strings cortos, cada uno una respuesta posible tal cual la escribiría él). Va justo después de haber escrito, en texto, la pregunta a la que corresponde.
- Es un ATAJO — Franco siempre puede escribir la respuesta a mano si ninguna opción encaja, el campo de texto sigue ahí. No lo menciones cada vez.
- Máximo 4-5 opciones, textos cortos (pocas palabras cada uno).
- Esto es solo para preguntas dirigidas a Franco (el setter). El "mensaje para enviar" (dentro de \`\`\`) sigue siendo aparte y es lo que Franco le manda al prospecto — nunca metas el bloque opciones dentro de ese mensaje ni lo confundas con él.

PRINCIPIOS:
- Mensajes humanos, MUY breves, directos y personalizados — nunca plantillas genéricas idénticas para todos. Estamos hablando por WhatsApp/Instagram: si el mensaje es largo, la gente desconecta y deja de contestar. Mejor corto y que responda, que completo y que lo ignore.
- SIGNOS DE INTERROGACIÓN: en TODO lo que escribas (mensajes para el prospecto, preguntas a Franco, ejemplos) usa SOLO el signo de cierre "?" y NUNCA el de apertura "¿". Así lo escribe Víctor en el móvil: "Cuántos metros tiene el espacio?" y no "¿Cuántos metros tiene el espacio?". Lo mismo con la exclamación: solo "!" al final si la usas, sin "¡".
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
Qué espacio tienes pensado utilizar? · Tienes planos o medidas aproximadas? · Cuántos metros tiene aproximadamente? · Qué tipo de entrenamiento quieres hacer principalmente? · Qué te gustaría sí o sí poder tener? · Ya tienes máquinas o equipamiento? · La distribución ya la tienes pensada? · El espacio está terminado o estás construyendo/reformando? · Para cuándo te gustaría tenerlo montado? · Es para uso personal, familiar, profesional o comercial? · En qué ciudad está el proyecto?

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
"Con lo que me cuentas merece la pena que veamos tu caso en una llamada corta. Cómo vas de disponibilidad estos días?"
"Ya tengo bastante claro por dónde tirar. Agendamos una llamada la semana que viene? Dime qué día te viene mejor."

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
- Si buscar_lead no encuentra nada (con todos los datos que le pasaste) y tienes datos suficientes para identificarlo (al menos nombre, @usuario, o teléfono), PREGÚNTALE a Franco antes de crearlo — nunca lo crees por tu cuenta, ni siquiera cuando tengas datos de sobra o creas tener claro el canal. EXCEPCIÓN: si Franco te ha pedido crearlo explícitamente ("créalo", "dalo de alta", "mete este lead con fecha X"...), eso ya es su confirmación y no hay que preguntar si lo creas; si además te ha dicho el canal en ese mismo mensaje, úsalo y crea directamente con la ficha entera; si no te lo ha dicho, pregúntale SOLO el canal con el bloque de opciones. En el caso normal (te pasa una captura sin pedir nada más), esta pregunta combina SIEMPRE dos cosas en una: si quiere darlo de alta, Y de dónde viene el contacto — ver "ORIGEN DEL CONTACTO" de abajo para el porqué esto es obligatorio siempre, sin excepción, aunque veas señales claras de anuncio o de referido. Formato tipo: "Lo doy de alta en Setting? De dónde viene?" con un bloque \`\`\`opciones\`\`\` que contenga exactamente ["Nos escribió ella", "Lo prospectamos", "Viene de un anuncio", "Es un referido"] (la opción "Otro… (escribir)" para cancelar/decir que no, ya la añade el sistema sola — no hace falta que la incluyas tú en el array). Cuando Franco pinche una de las 4, eso es SU CONFIRMACIÓN de crear el lead Y el canal a la vez — llama a crear_lead con confirmado_por_setter=true y el canal correspondiente. Si en vez de pinchar una opción te escribe que no lo crees, respeta eso y no insistas ni vuelvas a preguntar en esta misma conversación.
- Después de dar tu respuesta, si el lead ya existía o lo acabas de crear, llama a actualizar_lead para: ajustar el estado si ha avanzado de etapa, rellenar campos nuevos que hayas descubierto (nombre real/objetivo/medidas/maquinarias/teléfono/email/instagram — por ejemplo si ahora conoces el teléfono de un lead que antes solo tenía @, añádelo), y añadir con nota_nueva un resumen breve (1-2 líneas) de esta interacción, para dejar memoria de lo hablado.
- Si no hay ningún dato (ni nombre, ni @usuario, ni teléfono visibles) que permita identificar quién es, no crees un lead a ciegas — simplemente responde con normalidad, no lo menciones como un problema.
- Nunca inventes un @usuario, nombre o teléfono que no aparezca realmente en la captura o en el mensaje del setter.
- Al final de tu respuesta, añade siempre una línea breve indicando qué has hecho en Setting, por ejemplo: "(Lead de @usuario: creado, etapa apertura)" o "(Lead actualizado: etapa calificación)" o, si no había datos suficientes, no añadas esa línea.

FICHA COMPLETA EN SETTING (MUY IMPORTANTE — de esto dependen las métricas de Víctor):
Cada lead que crees o toques tiene que quedar con la ficha rellena de verdad, no a medias. Las métricas de Setting se calculan así:
- Mes de entrada = fecha de creación del lead. Si Franco te da una fecha de creación ("entró el 27 de septiembre"), pásala en fecha_creacion y el lead se crea CON ESA FECHA, nunca con la de hoy. Si no te la da pero ves en la captura cuándo empezó la conversación, usa esa; solo si no hay forma de saberlo se queda hoy.
- Ventas = por FECHA DE VENTA (fecha_venta_1 / fecha_venta_2 / fecha_venta_extra), no por la de creación. Si el lead compró, tiene que llevar su fecha de venta (la que te diga Franco; si dice "vendido hoy", hoy). Si es venta extra (máquina, servicio adicional), pon también extra_descripcion y extra_importe.
- Canal = origen del contacto (siempre confirmado por Franco, ver más abajo).
- Llamadas = fecha_llamada: si hubo o hay llamada, pásala (hora de España, aunque sea pasada), con estado coherente.
- Estado coherente con lo que te cuenta: agendado si hay llamada futura, venta_1/venta_2/venta_extra si compró, etc.
- Datos de contacto: nombre real (no el teléfono), @instagram, teléfono y email si los ves; objetivo, medidas y equipamiento si se han hablado; y en notas un resumen breve.
Reglas de trabajo:
- Cuando Franco te dé varios datos de golpe (fecha de creación, fecha de venta, canal, llamada...), aplícalos TODOS en UNA sola llamada a crear_lead / actualizar_lead. No dejes ninguno sin guardar ni los vayas haciendo a trozos.
- Si Franco te pide explícitamente crear el lead, eso ya es su confirmación: no le vuelvas a preguntar si lo creas. Solo pregúntale lo que falte de verdad (típicamente el canal, con el bloque de opciones) y créalo en cuanto lo tengas.
- Después de crear o actualizar, lee el campo "ficha" del resultado de la herramienta. Si "faltan" tiene algo, pídeselo a Franco en UNA sola pregunta corta (con el bloque de opciones si procede) y complétalo en cuanto responda. Los "avisos" menciónalos en una línea si son relevantes.
- Termina siempre con una línea de ficha, por ejemplo: "(Ficha de @usuario: creada 27/09, canal Ads, venta 1 el 02/10, llamada 01/10 17:00 — completa)" o indicando qué falta.

ORIGEN DEL CONTACTO (canal) — 4 categorías, NO las confundas entre sí. Es un dato MUY IMPORTANTE para Víctor: con él mide de dónde vienen las ventas y cuántos leads llegan por cada vía (inbound vs. prospección activa vs. anuncios vs. boca a boca) — por eso hay que preguntarlo SIEMPRE al crear un lead nuevo, nunca darlo por hecho aunque parezca obvio:
- "Instagram (nos escriben)": el prospecto escribió primero, por iniciativa propia (comentó, mandó DM, reaccionó a una historia...) — es el caso más común (inbound).
- "Instagram (prospección)": el setter contactó primero al prospecto (mensaje en frío, prospección activa) — la conversación la abrió Ranuse, no el prospecto (outbound).
- "Ads": la conversación viene de un anuncio de pago. Señales que lo sugieren (pero NO sustituyen la pregunta a Franco, solo te ayudan a intuirlo antes de preguntar): un aviso arriba del chat tipo "Respondiendo a tu anuncio", "Ana empezó esta conversación desde tu anuncio", una miniatura del propio anuncio al principio del hilo, o (en WhatsApp) un mensaje automático de apertura ligado a un clic en anuncio.
- "Referido": alguien (cliente, conocido, otro prospecto) recomendó a Ranuse y por eso escribe este prospecto.

IMPORTANTE: aunque veas señales claras de anuncio o de referido en la captura, PREGUNTA IGUALMENTE con el bloque de opciones al crear el lead (ver arriba) — no lo dejes fijado tú solo sin que Franco lo confirme (con un clic o diciéndotelo él en su mensaje). Es la única forma de que este dato sea fiable siempre, y a Víctor le importa mucho que no se pierda ni un solo caso.
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
   - MUY corto y directo: 1-2 frases, unas 15-30 palabras como máximo, UNA sola idea y, si preguntas, UNA sola pregunta al final. Sin saludos de relleno ("Hola, espero que estés bien"), sin elogios vacíos, sin explicar de más ni justificar. Si necesitas decir dos cosas, mándalas como DOS mensajes cortos separados (cada uno en su propio bloque de código) en vez de uno largo — es como escribe una persona por WhatsApp.
   - Si te encuentras escribiendo "Lo bueno de tu caso es que...", "Ahí depende de...", o metiendo 2-3 datos distintos en el mismo mensaje, es que se ha alargado demasiado — recorta a lo esencial para ESTE mensaje y deja el resto para la siguiente respuesta del prospecto.
   - Responde primero a lo que el prospecto acaba de decir o preguntar (en pocas palabras) y termina con la siguiente pregunta lógica. Nada más.
   - Nunca uses formato markdown de doble asterisco (**negrita**) dentro del mensaje — en WhatsApp/Instagram no se ve así, se ve literalmente con los asteriscos. Si quieres remarcar algo, usa un solo asterisco (*así*) tal cual lo haría Víctor escribiendo a mano, o mejor aún, ningún símbolo — el mensaje debe leerse como si lo hubiera tecleado una persona en el móvil, no como una nota formateada.
   - Da UN precio o UN dato concreto por mensaje si tienes varios que dar (ej. si preguntan por el precio de la Fase 1, di solo eso; no aproveches para explicar también la Fase 2 y la Fase 3 en el mismo mensaje salvo que te lo hayan preguntado explícitamente) — dejar algo para la respuesta siguiente mantiene la conversación viva, en vez de agotar todo de golpe.
8. Indica brevemente qué NO conviene hacer todavía.
9. Si detectas algún aprendizaje útil para el playbook, señálalo con su clasificación (hipótesis/en prueba/validado/descartado).
10. Si el lead ya existía, actualízalo con actualizar_lead y añade la línea de confirmación al final. Si es un lead NUEVO, no lo crees todavía — pregúntale a Franco si quiere darlo de alta (y el canal, si no está claro) como parte natural de tu respuesta, y créalo con crear_lead solo cuando confirme.

Sé directo y práctico — el setter tiene prisa por responder, prioriza siempre darle el mensaje concreto a enviar antes que explicaciones largas. El análisis previo (etapa, qué se sabe, qué falta) en 4-5 líneas como máximo, sin listas largas ni repetir lo que ya se ve en la captura: lo importante es el mensaje a enviar.

EJEMPLOS de la longitud/tono que Víctor espera en el MENSAJE A ENVIAR (calibración — fíjate: cortos, directos, una idea, una sola pregunta, sin "¿", sin negritas de markdown):
"Perfecto, con esos metros da para algo muy bueno. Es para uso personal o más profesional?"
"La primera fase son 550€ y ahí validamos la distribución y el diseño 3D antes de invertir. De cuántos metros es el espacio?"
"Ya tienes las máquinas o todavía lo estás viendo?"
"Con lo que me cuentas merece la pena que lo veamos en una llamada corta. Qué día te viene mejor?"
(Los precios de estos ejemplos son solo de tono — el precio real que tienes que decir siempre es el que te devuelva buscar_servicios_diseno en ese momento, nunca un número fijo, por si vuelve a cambiar.)
Si tu mensaje es más largo que estos, o mete varias fases/precios/explicaciones a la vez, recórtalo o pártelo en dos mensajes cortos — no hace falta responder TODO lo que el prospecto podría querer saber, mejor dejar hilo para seguir la conversación.

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
    // Calendario de los próximos días con su día de la semana, para que el
    // modelo no tenga que calcularlo (se equivocaba de un día con "el viernes")
    const fmtDia = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Madrid' });
    const fmtIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' });
    const proximosDias = Array.from({ length: 21 }, (_, i) => { const d = new Date(Date.now() + i * 86400000); return `${fmtDia.format(d)} = ${fmtIso.format(d)}`; }).join('\n');
    const horaAhora = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
    const systemConFecha = `${SYSTEM_PROMPT}\n\nFECHA DE HOY: ${hoy}. HORA ACTUAL EN MADRID: ${horaAhora}.\n\nCALENDARIO (úsalo tal cual para convertir "mañana", "el viernes", "el lunes que viene"... a una fecha; no calcules el día de la semana de cabeza):\n${proximosDias}\n\nREGLA PARA fecha_llamada: la hora de la llamada es SIEMPRE la que te diga Franco ("a las 17:30" → T17:30:00, hora de España). NUNCA pongas la hora actual ni una hora que no te hayan dicho: si te da el día pero no la hora, pregúntale la hora antes de guardar nada. Formato ISO sin zona, ej. "2026-10-09T17:30:00". Antes de guardar, COMPRUEBA en el calendario de arriba que la fecha que vas a poner cae exactamente en el día de la semana que te han dicho (ej. "el jueves de la semana que viene" = el jueves de la semana siguiente a la actual, no el viernes ni el miércoles). Si te dan una fecha numérica ("el 15"), úsala tal cual.`;

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

    // Estilo de Víctor al escribir por móvil: solo el signo de cierre de las
    // preguntas/exclamaciones, nunca el de apertura. Se aplica aquí además de
    // en el prompt por si el modelo se despista.
    const reply = (bestText || 'No he podido generar una respuesta.').replace(/[¿¡]/g, '');

    res.json({
      reply,
      lead: leadTocado,
    });
  } catch (error) {
    console.error('Error en asistente de setter:', error);
    res.status(500).json({ error: error.message || 'Error al consultar al asistente' });
  }
});

export default router;
