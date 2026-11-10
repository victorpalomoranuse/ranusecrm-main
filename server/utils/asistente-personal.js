import crypto from 'crypto';
import { supabase } from '../config/supabase.js';
import { callClaude } from './anthropic.js';
import { uploadDiagnosisImage, uploadProjectDocument, uploadReferenceImage, uploadProjectRender } from './storage.js';
import { renderDesdeFoto, imagenDesdeTexto, editarFoto } from './render-asistente.js';
import { internalAdminToken } from './internal-auth.js';
import { infoPdf, paginaAImagen, escalaDe, construirPlano, registroPlano } from './plano-asistente.js';
import { alzadoPNG } from './alzado-imagen.js';
import { computeCatalogPricing } from './pricing.js';
import { crearInformePdf } from './pdf-informe.js';
import { TOOLS_HISTORIAS, HISTORIAS_NOMBRES, ejecutarHistorias, ponAlmacenHistorias } from './historias-asistente.js';
import { TOOLS_SALUD, SALUD_NOMBRES, ejecutarSalud, bloqueSaludSistema, ponAlmacen } from './salud-asistente.js';

// Cerebro del asistente personal de Víctor (lo usan WhatsApp y Telegram).
// - Memoria que persiste (hechos que le pides recordar) y conversación reciente, guardadas en Storage (sin tocar la base de datos).
// - Herramientas sobre el CRM: agenda del día, proyectos, tareas y eventos.
// Nada de lo que ya existe se borra: solo lee, crea tareas/eventos, marca tareas hechas y apunta/olvida recuerdos.
const BUCKET = 'project-documents';
const RUTA_MEM = 'crm/asistente/memoria.json';
const RUTA_CHARLA = 'crm/asistente/charla.json';
export const RUTA_RECORD = 'crm/asistente/recordatorios.json';
export const RUTA_DIARIO = 'crm/asistente/diario.json';
export const RUTA_PRIV = 'crm/asistente/privado.json'; // recuerdos personales: NO se ven en el CRM
const RUTA_AG = 'crm/asistente/agentes.json';
const recientes = new Map(); // archivos que Víctor mandó hace poco (por conversación), para poder usarlos en mensajes posteriores
let lectorPlano = async (im, nota) => {
  const r = await fetch(BASE_INTERNA + '/api/medicion/plano-ia', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + internalAdminToken() }, body: JSON.stringify({ imagen: im.data, w: im.w, h: im.h, nota }) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || ('error ' + r.status)); return j;
};
export function ponLectorPlano(f) { lectorPlano = f; }
let adminIdCache = null;
async function adminId() { if (adminIdCache) return adminIdCache; const { data } = await supabase.from('users').select('id').eq('role', 'admin_superior').order('created_at', { ascending: true }).limit(1).maybeSingle(); adminIdCache = data?.id || null; return adminIdCache; }
const RUTA_ACC = 'crm/asistente/acciones.json';
const BASE_INTERNA = process.env.ASIST_BASE_URL || ('http://127.0.0.1:' + (process.env.PORT || 3001));
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const FASES = ['Diseño previo', 'Arquitectura', 'Instalaciones', 'Interiorismo y materialidad', 'Maquinaria y equipamiento', 'Documentación de apoyo'];

// Todo lo del asistente (memoria, conversación, recordatorios, recuerdos privados) va a un bucket PRIVADO: no tiene enlace público.
// (Los PDFs, fotos y notas de proyecto sí van a su sitio del CRM, que es lo que se quiere.)
const BUCKET_PRIV = 'asistente-privado';
let bucketListo = null;
async function asegura() {
  if (!bucketListo) bucketListo = (async () => { const { data } = await supabase.storage.getBucket(BUCKET_PRIV); if (!data) await supabase.storage.createBucket(BUCKET_PRIV, { public: false }); })().catch(e => { bucketListo = null; throw e; });
  return bucketListo;
}
// Lectura/escritura con caché en memoria (lectura inmediata tras escribir: el almacenamiento puede servir una versión antigua hasta ~1 min por su CDN)
// y, si hay que ir a Storage, con dirección firmada y parámetro único para saltarse esa caché.
const cacheJson = new Map(), TTL_CACHE = 5 * 60 * 1000;
export async function leerJson(ruta, vacio) {
  const c = cacheJson.get(ruta); if (c && Date.now() - c.t < TTL_CACHE) return structuredClone(c.v);
  await asegura().catch(() => {});
  let valor;
  try { const f = await supabase.storage.from(BUCKET_PRIV).createSignedUrl(ruta, 60); if (f.data?.signedUrl) { const r = await fetch(f.data.signedUrl + '&cb=' + Date.now(), { cache: 'no-store' }); if (r.ok) valor = await r.json(); } } catch { /* se prueba el bucket antiguo */ }
  if (valor === undefined) { try { const viejo = await supabase.storage.from(BUCKET).download(ruta); if (viejo.data) valor = JSON.parse(await viejo.data.text()); } catch { /* sin datos */ } } // datos anteriores a pasarlo a privado
  if (valor === undefined) return vacio;
  cacheJson.set(ruta, { v: valor, t: Date.now() }); return structuredClone(valor);
}
export async function guardarJson(ruta, obj) {
  await asegura();
  const { error } = await supabase.storage.from(BUCKET_PRIV).upload(ruta, Buffer.from(JSON.stringify(obj)), { contentType: 'application/json', upsert: true, cacheControl: '0' });
  if (error) throw new Error('No se pudo guardar: ' + error.message);
  cacheJson.set(ruta, { v: structuredClone(obj), t: Date.now() });
}

function madrid() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'long' }).formatToParts(new Date());
  const g = (t) => p.find(x => x.type === t)?.value;
  return { fecha: g('year') + '-' + g('month') + '-' + g('day'), hora: g('hour') + ':' + g('minute'), dia: new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'long' }).format(new Date()) };
}
// «martes, 10 de noviembre de 2026, 18:42 (hora de Madrid, CET)»: el reloj de verdad, para que nunca tenga que adivinar el día
function ahoraLargo() {
  const d = new Date(), larga = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  const hh = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  const zona = (new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', timeZoneName: 'short' }).formatToParts(d).find(p => p.type === 'timeZoneName') || {}).value || '';
  return larga + ', ' + hh + ' (hora de Madrid' + (zona ? ', ' + zona : '') + ')';
}
// «mar 10 nov, 18:32» para etiquetar cuándo se dijo cada mensaje de la conversación
function marcaTiempo(ms) {
  const d = new Date(ms), f = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'short', day: 'numeric', month: 'short' }).format(d), h = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return f.replace(/\./g, '') + ', ' + h;
}
// fecha de Madrid (AAAA-MM-DD) dentro de n días
function fechaMadridMas(n) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + n * 86400000)); }
function calendario() {
  const fmt = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'long', day: 'numeric', month: 'long' }), iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' });
  return Array.from({ length: 21 }, (_, i) => { const d = new Date(Date.now() + i * 86400000); return (i === 0 ? 'HOY ' : i === 1 ? 'MAÑANA ' : '') + fmt.format(d) + ' = ' + iso.format(d); }).join('\n');
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const limpia = (s) => String(s || '').replace(/[%,()]/g, ' ').trim();

const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
const RUTA_ALIAS = 'crm/asistente/alias.json';
// Devuelve { proyecto } si hay uno claro, { ambiguo: [...] } si hay varios parecidos, o {} si no encuentra nada.
async function resolverProyecto(txt) {
  const t = limpia(txt); if (!t || UUID.test(t)) return {};
  const campos = 'id, client_name, project_name, phase, status, urgency, client_city, active';
  const alias = await leerJson(RUTA_ALIAS, {}); const a = alias[norm(t)];
  if (a?.id) { const { data } = await supabase.from('client_projects').select(campos).eq('id', a.id).maybeSingle(); if (data) return { proyecto: data, por_alias: true }; }
  const { data } = await supabase.from('client_projects').select(campos).limit(600);
  const toks = norm(t).split(' ').filter(w => w.length > 1 && !STOP.has(w)); if (!toks.length) return {};
  const pt = (data || []).map(p => {
    const cli = norm(p.client_name), pro = norm(p.project_name), ciu = norm(p.client_city), todo = [cli, pro, ciu].join(' ');
    const pal = new Set(todo.split(' ')); let sc = 0; for (const w of toks) { if ((cli + ' ' + pro).split(' ').includes(w)) sc += 2; else if (pal.has(w)) sc += 1; }
    if (sc > 0 && (cli === norm(t) || pro === norm(t))) sc += 10; if (sc > 0 && p.status === 'en_marcha' && p.active) sc += 0.5;
    return { p, sc, completo: toks.every(w => pal.has(w)) };
  }).filter(x => x.sc > 0).sort((x, y) => y.sc - x.sc);
  if (!pt.length) return {};
  const [m1, m2] = pt; if (!m2 || m1.sc >= m2.sc * 1.6 || m1.sc >= 10) return { proyecto: m1.p };
  const comp = pt.filter(x => x.completo); if (comp.length === 1) return { proyecto: comp[0].p };
  return { ambiguo: pt.filter(x => x.sc >= m1.sc * 0.5).slice(0, 4).map(x => ({ id: x.p.id, cliente: x.p.client_name, proyecto: x.p.project_name, ciudad: x.p.client_city || null, estado: x.p.status })) };
}
async function proyectoPor(txt) {
  const t = limpia(txt); if (!t) return null;
  if (UUID.test(t)) { const { data } = await supabase.from('client_projects').select('id, client_name, project_name, phase, status, urgency').eq('id', t).maybeSingle(); return data; }
  for (const soloActivos of [true, false]) {
    let q = supabase.from('client_projects').select('id, client_name, project_name, phase, status, urgency').or('client_name.ilike.%' + t + '%,project_name.ilike.%' + t + '%').limit(5);
    if (soloActivos) q = q.eq('status', 'en_marcha').eq('active', true);
    const { data } = await q; if (data?.length) { const t0 = t.toLowerCase(); return data.find(d => String(d.project_name || '').toLowerCase() === t0 || String(d.client_name || '').toLowerCase() === t0) || data[0]; } // si hay varios parecidos, gana el que se llama exactamente así
  }
  return null;
}
async function empleadoPor(nombre) {
  const t = limpia(nombre); if (!t) return null;
  const { data } = await supabase.from('employees').select('id, name').ilike('name', '%' + t + '%').eq('active', true).limit(1);
  return data?.[0] || null;
}

const TOOLS = [
  { name: 'agenda_de_hoy', description: 'Tareas pendientes que vencen hoy o están atrasadas, tareas sin fecha y eventos de hoy. Úsala cuando Víctor salude por la mañana, pregunte qué tiene que hacer o cómo va el día.', input_schema: { type: 'object', properties: {} } },
  { name: 'apuntar_diario', description: 'Apunta en el diario de trabajo de Víctor lo que ha hecho (hoy o el día que diga): resumen breve, proyectos tocados y logros. Úsala siempre que él te cuente lo que ha estado haciendo. Es parte de tu aprendizaje: con el diario conoces su ritmo y sus procesos reales.', input_schema: { type: 'object', properties: { resumen: { type: 'string' }, proyectos: { type: 'array', items: { type: 'string' } }, logros: { type: 'array', items: { type: 'string' } }, fecha: { type: 'string', description: 'AAAA-MM-DD, por defecto hoy' } }, required: ['resumen'] } },
  { name: 'ver_diario', description: 'Lee el diario de trabajo de Víctor de los últimos días (por defecto 7). Úsala cuando pregunte qué hizo, cómo fue la semana, o para dar consejo basado en cómo trabaja.', input_schema: { type: 'object', properties: { dias: { type: 'number' } } } },
  { name: 'ver_presupuesto', description: 'Muestra un presupuesto ya existente: número, nombre, estado, proyecto, todas sus líneas (nombre, cantidad, precio) y el total sin IVA. Búscalo por número (p. ej. RAN-0XX) o por proyecto.', input_schema: { type: 'object', properties: { presupuesto: { type: 'string' }, proyecto: { type: 'string' } } } },
  { name: 'anadir_lineas_presupuesto', description: 'Añade líneas a un presupuesto: uno que YA tiene empezado Víctor (por número o por proyecto) o uno nuevo si el proyecto aún no tiene (con nombre_si_nuevo). Cada línea puede ser un producto del catálogo (producto = nombre, coge su precio del catálogo salvo que des precio), o una línea LIBRE que no está en el catálogo (descripcion o producto sin coincidencia; precio puede ser 0 o vacío = pendiente). Mezcla las dos sin problema. Después genera y te manda el PDF actualizado (generar_pdf, por defecto sí). Úsala para "añade esto al presupuesto de X", "hazme un presupuesto con estos equipos", listados con precio 0, etc. Si una línea ya está en el presupuesto no la duplica.', input_schema: { type: 'object', properties: { presupuesto: { type: 'string', description: 'número, p. ej. RAN-0XX' }, proyecto: { type: 'string' }, nombre_si_nuevo: { type: 'string', description: 'nombre del presupuesto si hay que crearlo' }, lineas: { type: 'array', items: { type: 'object', properties: { producto: { type: 'string', description: 'nombre del producto del catálogo (o texto libre si no está)' }, descripcion: { type: 'string', description: 'línea libre con su texto' }, cantidad: { type: 'number' }, precio: { type: 'number', description: 'precio unitario sin IVA; 0 o vacío = sin precio todavía' }, coste: { type: 'number' }, marca: { type: 'string' }, notas: { type: 'string', description: 'texto para el cliente en esa línea' } } } }, generar_pdf: { type: 'boolean' }, crear_nuevo: { type: 'boolean', description: 'true SOLO si Víctor ha pedido expresamente un presupuesto NUEVO' } }, required: ['lineas'] } },
  { name: 'modificar_linea_presupuesto', description: 'Cambia una línea de un presupuesto existente (cantidad, precio, nombre o nota para el cliente). Localízala por parte de su nombre. Después regenera el PDF si regenerar_pdf=true. No borra líneas.', input_schema: { type: 'object', properties: { presupuesto: { type: 'string' }, proyecto: { type: 'string' }, linea: { type: 'string', description: 'parte del nombre de la línea' }, cantidad: { type: 'number' }, precio: { type: 'number' }, nombre: { type: 'string' }, notas: { type: 'string' }, regenerar_pdf: { type: 'boolean' } }, required: ['linea'] } },
  { name: 'presupuesto_pdf', description: 'Te manda a Víctor el PDF de un presupuesto que YA existe en el CRM (por su número, p. ej. "RAN-0XX", o por el proyecto; si hay varios del proyecto, el más reciente). Si el presupuesto no tiene PDF o dice regenerar=true, lo genera de nuevo con sus datos actuales. Úsala cuando pida "pásame el PDF del presupuesto…", "mándame el presupuesto de…" o cuando el compañero de presupuestos no devuelva el PDF. Para crear uno NUEVO usa hablar_con_agente (presupuestos).', input_schema: { type: 'object', properties: { presupuesto: { type: 'string', description: 'número, p. ej. RAN-0XX' }, proyecto: { type: 'string' }, regenerar: { type: 'boolean' } } } },
  { name: 'buscar_presupuestos', description: 'Busca presupuestos por el nombre del cliente o del presupuesto (sin tildes, por palabras). Devuelve número, nombre, cliente, estado y fechas. Úsala SIEMPRE que no tengas claro el número: nunca inventes ni copies un número.', input_schema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] } },
  { name: 'guardar_alias', description: 'Guarda un apodo para un proyecto/cliente (p. ej. "Ángel de Valencia" = el proyecto de Ángel Juan) para entenderlo siempre. Úsala cuando Víctor te confirme a qué proyecto se refiere con un nombre distinto al oficial.', input_schema: { type: 'object', properties: { alias: { type: 'string' }, proyecto: { type: 'string', description: 'nombre oficial del proyecto o cliente' } }, required: ['alias', 'proyecto'] } },
  { name: 'enviar_alzado', description: 'Te manda a Víctor como imagen (PNG con cotas, escala y cajetín de Ranuse) una lámina de alzado ya guardada en el Asistente de diseño de un proyecto. Si no dices cuál, envía la más reciente y te cuenta las demás. Úsala cuando pida ver, pasar o mandar un alzado.', input_schema: { type: 'object', properties: { proyecto: { type: 'string' }, lamina: { type: 'string', description: 'parte del título de la lámina, opcional' } }, required: ['proyecto'] } },
  { name: 'crear_plano', description: 'Crea en la herramienta Planos del CRM un plano nuevo del ESTADO ACTUAL de un proyecto (muros, puertas, ventanas y pilares) a partir de un PDF o imagen de plano que Víctor te ha mandado (adjunto). Usa la misma lectura con IA que el botón de importar de Planos. Es un BORRADOR: dile siempre que revise medidas, puertas y pilares sobre el plano del cliente. Si el PDF tiene varias páginas, indica pagina (el número de la lámina que es la planta); si no lo sabes, la herramienta te devuelve la lista de páginas para que se lo preguntes. Si el plano no trae cotas legibles, pasa medida_muro_mas_largo_cm (lo que mide en la realidad el muro más largo). Hace falta el proyecto.', input_schema: { type: 'object', properties: { adjunto: { type: 'string' }, proyecto: { type: 'string' }, pagina: { type: 'number' }, nombre: { type: 'string', description: 'nombre del plano; por defecto el del proyecto' }, medida_muro_mas_largo_cm: { type: 'number' } }, required: ['adjunto', 'proyecto'] } },
  { name: 'crear_proyecto', description: 'Crea un proyecto nuevo en el CRM (igual que desde Proyectos: con su fase 0, las tareas de la plantilla de esa fase y su código de acceso). Hace falta nombre del proyecto y del cliente; tipo "comercial" (gimnasio o local) o "home_gym" (gimnasio en casa), deduce el tipo del contexto si puedes. Crea sin pedir más datos de los imprescindibles. Después, si había una tarea tipo "crear proyecto X", ofrécele marcarla como hecha.', input_schema: { type: 'object', properties: { proyecto: { type: 'string', description: 'nombre del proyecto, p. ej. "Adil Gym Marruecos"' }, cliente: { type: 'string' }, tipo: { type: 'string', enum: ['comercial', 'home_gym'] }, email: { type: 'string' }, urgencia: { type: 'string', enum: ['baja', 'normal', 'alta'] }, responsable: { type: 'string', description: 'nombre de quien lo lleva, opcional' }, notas: { type: 'string' }, forzar: { type: 'boolean', description: 'true solo si ya existe uno parecido y Víctor confirma que quiere otro' } }, required: ['proyecto', 'cliente'] } },
  { name: 'contexto_proyecto', description: 'Todo lo que hay de un proyecto para poder asesorar y desglosar trabajo: ficha, fase, urgencia, resumen del cliente y programa de necesidades, equipos y materiales elegidos, documentos y renders que ya existen, y tareas pendientes. Úsala antes de desglosar una tarea o dar consejo de un proyecto concreto.', input_schema: { type: 'object', properties: { proyecto: { type: 'string' } }, required: ['proyecto'] } },
  { name: 'plantillas_fase', description: 'Las plantillas de tareas que Ranuse tiene definidas para cada fase del proyecto (0-5). Úsalas como base al desglosar el trabajo de una fase y complétalas con tu criterio. fase vacía = todas.', input_schema: { type: 'object', properties: { fase: { type: 'number' } } } },
  { name: 'crear_subtareas', description: 'Crea de una vez los pasos de un desglose como tareas del proyecto (hasta 12). Cada paso: titulo (concreto y empezando por un verbo), fecha opcional AAAA-MM-DD, prioridad opcional, asignada_a opcional. Úsala SOLO cuando Víctor haya aceptado el desglose. Salta las que ya existen.', input_schema: { type: 'object', properties: { proyecto: { type: 'string' }, fase: { type: 'number' }, pasos: { type: 'array', items: { type: 'object', properties: { titulo: { type: 'string' }, fecha: { type: 'string' }, prioridad: { type: 'string', enum: ['baja', 'normal', 'alta'] }, asignada_a: { type: 'string' } }, required: ['titulo'] } } }, required: ['proyecto', 'pasos'] } },
  { name: 'listar_eventos', description: 'Eventos y citas del calendario de los próximos días (por defecto 14), con fecha y hora. busqueda filtra por texto. Úsala para saber qué tiene Víctor apuntado en la agenda y ANTES de decir que no tienes algo.', input_schema: { type: 'object', properties: { dias: { type: 'number' }, busqueda: { type: 'string' } } } },
  { name: 'listar_tareas', description: 'Lista TODAS las tareas pendientes (con fecha y sin fecha), ordenadas: atrasadas, de hoy, próximas y sin fecha. Cada una con id, título, fecha, prioridad, a quién está asignada y de qué proyecto (con su urgencia). de = nombre de una persona para filtrar; proyecto = para filtrar por proyecto. Úsala siempre que Víctor pida sus tareas, lo que tiene pendiente o ayuda para organizarse.', input_schema: { type: 'object', properties: { de: { type: 'string' }, proyecto: { type: 'string' } } } },
  { name: 'buscar_tarea', description: 'Busca entre las tareas pendientes la que Víctor menciona, aunque la nombre con otras palabras o apodos. Devuelve las más parecidas con su id y su título exacto. Úsala SIEMPRE antes de crear una tarea nueva si puede que ya exista, y cuando Víctor se refiera a una tarea sin decir su título exacto.', input_schema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] } },
  { name: 'actualizar_tarea', description: 'Cambia una tarea existente (id, las primeras letras del id o su nombre aproximado tal como Víctor la nombre): fecha (AAAA-MM-DD), prioridad, título o a quién se asigna. Úsala para organizar el día de Víctor cuando él te lo pida o acepte tu plan (por ejemplo, ponerle fecha de hoy a las tareas que acordéis).', input_schema: { type: 'object', properties: { id: { type: 'string', description: 'id, primeras letras del id o el nombre de la tarea tal como la dice Víctor' }, fecha: { type: 'string' }, prioridad: { type: 'string', enum: ['baja', 'normal', 'alta'] }, titulo: { type: 'string' }, asignada_a: { type: 'string' } }, required: ['id'] } },
  { name: 'listar_proyectos', description: 'Proyectos en marcha (nombre, cliente, fase). Con "busqueda" filtra por nombre o cliente.', input_schema: { type: 'object', properties: { busqueda: { type: 'string' } } } },
  { name: 'ver_proyecto', description: 'Ficha de un proyecto: fase, urgencia y tareas pendientes. "proyecto" puede ser parte del nombre, del cliente o el id.', input_schema: { type: 'object', properties: { proyecto: { type: 'string' } }, required: ['proyecto'] } },
  { name: 'crear_tarea', description: 'Crea una tarea en el CRM. fecha en formato AAAA-MM-DD (resuelve "mañana", "el viernes"… con la fecha de hoy). proyecto y asignada_a son opcionales (nombre parcial).', input_schema: { type: 'object', properties: { titulo: { type: 'string' }, fecha: { type: 'string' }, proyecto: { type: 'string' }, prioridad: { type: 'string', enum: ['baja', 'normal', 'alta'] }, asignada_a: { type: 'string' }, descripcion: { type: 'string' }, forzar: { type: 'boolean', description: 'true solo si Víctor ya ha confirmado que quiere crearla aunque exista algo parecido' } }, required: ['titulo'] } },
  { name: 'completar_tarea', description: 'Marca una tarea como hecha. id puede ser el id, las primeras letras del id o el nombre aproximado de la tarea tal como la dice Víctor.', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'crear_evento', description: 'Crea un evento en el calendario del CRM.', input_schema: { type: 'object', properties: { titulo: { type: 'string' }, fecha: { type: 'string', description: 'AAAA-MM-DD' }, hora: { type: 'string', description: 'HH:MM, opcional' }, descripcion: { type: 'string' }, forzar: { type: 'boolean', description: 'true solo si Víctor ya ha confirmado que quiere crearlo aunque haya algo parecido ese día' } }, required: ['titulo', 'fecha'] } },
  { name: 'guardar_adjunto', description: 'Guarda una foto o documento que Víctor te acaba de mandar (adjunto con su id, p. ej. "a1"). destino: "necesidades" = fotos del programa de necesidades del proyecto; "obra" = fotos de una visita a obra; "documento" = archivo en los Documentos del proyecto; "referencia" = imagen de inspiración (sin proyecto, tablero general de referencias). Para todo menos "referencia" hace falta el proyecto. Si no está claro el proyecto o el destino, pregunta antes de guardar.', input_schema: { type: 'object', properties: { adjunto: { type: 'string' }, destino: { type: 'string', enum: ['necesidades', 'obra', 'documento', 'referencia'] }, proyecto: { type: 'string' }, titulo: { type: 'string', description: 'título o pie de foto breve' }, nota: { type: 'string', description: 'detalle: qué se ve, qué te gusta, qué hay que tener en cuenta' }, categoria: { type: 'string', description: 'solo referencias: tipo de espacio o estilo' } }, required: ['adjunto', 'destino'] } },
  { name: 'guardar_nota_proyecto', description: 'Guarda una nota en los Documentos de un proyecto: acta de reunión, resumen de visita a obra, transcripción, decisiones. Escribe un resumen ordenado (acuerdos, medidas, decisiones, pendientes). Con incluir_original=true se adjunta además, tal cual, el mensaje completo de Víctor (útil para transcripciones largas: no las copies tú).', input_schema: { type: 'object', properties: { proyecto: { type: 'string' }, titulo: { type: 'string' }, tipo: { type: 'string', enum: ['reunion', 'obra', 'nota'] }, resumen: { type: 'string' }, incluir_original: { type: 'boolean' } }, required: ['proyecto', 'titulo', 'resumen'] } },
  { name: 'crear_proveedor', description: 'Crea un proveedor/contacto nuevo en el CRM (Contactos). sector = su oficio o a qué se dedica.', input_schema: { type: 'object', properties: { nombre: { type: 'string' }, sector: { type: 'string' }, telefono: { type: 'string' }, email: { type: 'string' }, web: { type: 'string' }, descripcion: { type: 'string' } }, required: ['nombre'] } },
  { name: 'buscar_proveedores', description: 'Busca proveedores/contactos por nombre u oficio.', input_schema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] } },
  { name: 'recordatorio', description: 'Programa un aviso: a esa hora le escribirás tú a Víctor el texto. fecha AAAA-MM-DD y hora HH:MM en hora de Madrid.', input_schema: { type: 'object', properties: { texto: { type: 'string' }, fecha: { type: 'string' }, hora: { type: 'string' } }, required: ['texto', 'fecha', 'hora'] } },
  { name: 'consultar_crm', description: 'Datos del negocio para informes y consejos. que: "resumen" (proyectos por fase, tareas atrasadas, carga por persona), "ventas" (ventas abiertas y cerradas), "leads" (últimos leads y su estado), "presupuestos" (últimos presupuestos y estado).', input_schema: { type: 'object', properties: { que: { type: 'string', enum: ['resumen', 'ventas', 'leads', 'presupuestos'] } }, required: ['que'] } },
  { name: 'crear_pdf', description: 'Genera un PDF con la imagen de Ranuse (informe, resumen, listado, propuesta de contenido…) y se lo envías a Víctor como archivo. contenido en texto sencillo: líneas que empiezan por "# " son títulos, "## " subtítulos, "- " viñetas, el resto párrafos. Si pasas proyecto, se guarda también en sus Documentos.', input_schema: { type: 'object', properties: { titulo: { type: 'string' }, contenido: { type: 'string' }, proyecto: { type: 'string' } }, required: ['titulo', 'contenido'] } },
  { name: 'generar_render', description: 'Convierte en render fotorrealista una foto, boceto o captura que Víctor te ha mandado (adjunto). Si dice el proyecto, se guarda en los Renders de ese proyecto en el CRM; si no, en Referencias del CRM. Se lo envías como imagen. instrucciones = qué quiere ver (materiales, colores, ambiente); estilo opcional.', input_schema: { type: 'object', properties: { adjunto: { type: 'string' }, proyecto: { type: 'string' }, instrucciones: { type: 'string' }, estilo: { type: 'string' } }, required: ['adjunto'] } },
  { name: 'editar_foto', description: 'Edita una foto que Víctor te ha mandado (adjunto) aplicando el cambio que pida ("cámbiale el suelo a madera", "quita la columna", "ponle un espejo grande"). Mantiene todo lo demás. No hace falta proyecto: si lo menciona se guarda en los Renders de ese proyecto, si no en Referencias del CRM. Se la envías como imagen.', input_schema: { type: 'object', properties: { adjunto: { type: 'string' }, instruccion: { type: 'string' }, proyecto: { type: 'string' } }, required: ['adjunto', 'instruccion'] } },
  { name: 'generar_imagen', description: 'Genera imágenes de inspiración desde cero, SIN foto de partida (el proyecto es opcional). TÚ escribes cada prompt: lee con atención lo que Víctor pide, su contexto, lo que recuerdas de su gusto y sus referencias (ver_referencias), y describe con detalle y criterio de diseñador lo que hay que ver: espacio, materiales, color, luz, mobiliario. No uses fórmulas ni recursos por costumbre. Si pide varias ideas, pasa en prompts una descripción distinta por cada una (hasta 3), de verdad diferentes entre sí según tu criterio. Se guardan en Referencias del CRM (o en el proyecto si lo dice) y se las envías como imágenes.', input_schema: { type: 'object', properties: { prompts: { type: 'array', items: { type: 'string' }, description: 'una descripción detallada por imagen (1 a 3)' }, prompt: { type: 'string', description: 'alternativa a prompts si es una sola imagen' }, estilo: { type: 'string' }, proyecto: { type: 'string' } } } },
  { name: 'hablar_con_agente', description: 'Habla con uno de los asistentes especializados del CRM y te devuelve su respuesta. agente: "presupuestos" (crea y gestiona presupuestos con IA: pásale lo que Víctor pida, con todos los datos), "setter" (analiza conversaciones de leads y prepara respuestas y fichas), "finanzas" (consulta y crea movimientos de finanzas), "diseno" (alzados: necesita proyecto; la lámina queda guardada en el Asistente de diseño del proyecto). La conversación con cada agente continúa entre llamadas; si el agente pregunta algo, pásaselo a Víctor tal cual y espera su respuesta. nueva=true empieza de cero con ese agente.', input_schema: { type: 'object', properties: { agente: { type: 'string', enum: ['presupuestos', 'setter', 'finanzas', 'diseno'] }, mensaje: { type: 'string' }, proyecto: { type: 'string' }, nueva: { type: 'boolean' } }, required: ['agente', 'mensaje'] } },
  { name: 'llamadas_fathom', description: 'Consulta las reuniones y llamadas grabadas con Fathom: título, fecha, participantes y el resumen. busqueda filtra por título o participante; dias = cuántos días atrás mirar (por defecto 14). con_transcripcion=true trae también la transcripción cuando la búsqueda da una sola reunión. Úsala cuando Víctor hable de una llamada o reunión reciente, pida un resumen o quiera guardarla en un proyecto (entonces sigue con guardar_nota_proyecto con tu resumen de lo acordado y crea las tareas que salgan).', input_schema: { type: 'object', properties: { busqueda: { type: 'string' }, dias: { type: 'number' }, con_transcripcion: { type: 'boolean' } } } },
  { name: 'ver_referencias', description: 'Busca en el tablero de Referencias del CRM (las imágenes de inspiración que Víctor ha ido guardando) y te las enseña: títulos, notas y hasta 4 imágenes para que las veas. Úsala antes de proponer ideas o de generar imágenes, para tirar de su gusto real, y cuando pregunte "qué referencias tengo de…". busqueda vacía = las más recientes.', input_schema: { type: 'object', properties: { busqueda: { type: 'string' }, cantidad: { type: 'number' } } } },
  { name: 'analizar_proyectos_vendidos', description: 'Reúne lo que hay de los proyectos VENDIDOS (cerrados): tipo, resumen del cliente, programa de necesidades, equipos y materiales elegidos. Úsala cuando Víctor te pida aprender de lo que ha vendido, o para dar consejo basado en lo que de verdad funciona con sus clientes. Después saca patrones (qué piden, qué materiales y marcas se repiten, tipologías) y guarda los más útiles con recordar.', input_schema: { type: 'object', properties: { limite: { type: 'number' } } } },
  { name: 'recordar', description: 'Guarda en tu memoria permanente algo que Víctor te cuenta o te pide recordar (preferencias, datos de clientes, decisiones, ideas, ritmos de trabajo…). Úsala sin que te lo pida si es algo que conviene recordar. Un hecho por llamada, redactado de forma autosuficiente. privado=true para TODO lo personal (familia, salud, ánimo, dinero personal, relaciones, planes personales): se guarda aparte y NO se ve en el CRM.', input_schema: { type: 'object', properties: { texto: { type: 'string' }, etiqueta: { type: 'string', description: 'tema corto, p. ej. cliente, proveedor, preferencia, idea' }, privado: { type: 'boolean' } }, required: ['texto'] } },
  { name: 'borrar_conversacion', description: 'Borra el historial reciente de esta conversación (lo que te acabas de decir y lo anterior). NO borra tu memoria. Úsala cuando Víctor pida empezar de cero o borrar la conversación.', input_schema: { type: 'object', properties: {} } },
  { name: 'vaciar_memoria', description: 'Borra tu memoria de forma masiva. ambito: "trabajo" (recuerdos de trabajo), "privada" (recuerdos personales) o "todo". IRREVERSIBLE: antes de llamarla, pregunta a Víctor si está seguro y espera su "sí" explícito en un mensaje posterior.', input_schema: { type: 'object', properties: { ambito: { type: 'string', enum: ['trabajo', 'privada', 'todo'] } }, required: ['ambito'] } },
  { name: 'restaurar_memoria', description: 'Recupera la memoria tal como estaba justo antes del último vaciado (vaciar_memoria deja siempre una copia). Úsala si Víctor dice que se ha equivocado al borrar todo.', input_schema: { type: 'object', properties: {} } },
  { name: 'marcar_conversacion_privada', description: 'Llámala cuando Víctor te hable de algo personal: así esta parte de la conversación no aparece en el CRM. No crees tareas, eventos ni notas de proyecto sobre temas personales salvo que él lo pida expresamente.', input_schema: { type: 'object', properties: {} } },
  { name: 'olvidar', description: 'Borra un recuerdo de tu memoria por su id.', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
];
TOOLS.push(...TOOLS_SALUD, ...TOOLS_HISTORIAS);
ponAlmacen(leerJson, guardarJson);
ponAlmacenHistorias(leerJson, guardarJson, (n, i) => ejecutar(n, i, { adjuntos: [], salida: [], textoUsuario: '' }));

// Palabras clave de un texto (sin tildes, sin palabras cortas ni de relleno) para detectar cosas ya apuntadas que se parecen
const RELLENO = new Set(['para', 'hacer', 'tengo', 'tiene', 'esto', 'este', 'esta', 'sobre', 'cosa', 'tarea', 'revisar', 'hablar', 'llamar', 'enviar', 'mandar', 'preparar', 'terminar']);
const palabras = (t) => new Set(String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3 && !RELLENO.has(w)));
const STOPW = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'e', 'o', 'u', 'con', 'sin', 'para', 'por', 'a', 'al', 'en', 'un', 'una', 'unos', 'unas', 'que', 'se', 'su', 'sus', 'mi', 'mis', 'le', 'lo', 'es', 'ya', 'como', 'mas', 'hay', 'tema', 'cosa', 'tarea', 'sobre', 'esto', 'esta', 'este', 'hacer', 'tengo', 'tiene', 'tenemos', 'quiero', 'toca', 'falta', 'poner']);
const SINON = { llamar: 'contactar', llamada: 'contactar', telefonear: 'contactar', hablar: 'contactar', escribir: 'contactar', avisar: 'contactar', contactar: 'contactar', mandar: 'enviar', remitir: 'enviar', pasar: 'enviar', compartir: 'enviar', enviar: 'enviar', repasar: 'revisar', comprobar: 'revisar', mirar: 'revisar', chequear: 'revisar', validar: 'revisar', revisar: 'revisar', elaborar: 'preparar', redactar: 'preparar', montar: 'preparar', armar: 'preparar', preparar: 'preparar', crear: 'preparar', disenar: 'disenar', diseno: 'disenar', presu: 'presupuesto', ppto: 'presupuesto', oferta: 'presupuesto', cotizacion: 'presupuesto', propuesta: 'presupuesto', presupuesto: 'presupuesto', cliente: 'cliente', clientes: 'cliente', planos: 'plano', plano: 'plano', renders: 'render', render: 'render', visita: 'visita', reunion: 'reunion', cita: 'reunion', quedada: 'reunion', pedir: 'pedir', solicitar: 'pedir', encargar: 'pedir', pedido: 'pedir', comprar: 'pedir' };
const raiz = (w) => { w = w.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9ñ]/g, ''); if (SINON[w]) return SINON[w]; if (w.length > 5) w = w.replace(/(aciones|amientos|acion|amiento|iendo|ando|aron|ados|adas|ado|ada|idos|idas|ido|ida|ar|er|ir|es|os|as|s)$/, ''); return SINON[w] || w; };
const fichas = (t) => new Set(String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9ñ]+/).filter(w => w.length > 2 && !STOPW.has(w)).map(raiz).filter(w => w.length > 1));
const bigramas = (s) => { const x = norm(s).replace(/ /g, ''); const m = new Map(); for (let i = 0; i < x.length - 1; i++) { const g = x.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
function dice(a, b) { const A = bigramas(a), B = bigramas(b); let ta = 0, tb = 0, c = 0; A.forEach(v => { ta += v; }); B.forEach(v => { tb += v; }); A.forEach((v, k) => { c += Math.min(v, B.get(k) || 0); }); return ta + tb ? (2 * c) / (ta + tb) : 0; }
// 0..1: cuánto se parecen dos textos de tarea aunque estén dichos de otra manera
function parecido(a, b) {
  const A = fichas(a), B = fichas(b); if (!A.size || !B.size) return 0;
  let c = 0; A.forEach(w => { if (B.has(w)) c++; });
  const ratio = c / Math.min(A.size, B.size), amplio = c / Math.max(A.size, B.size);
  const porPalabras = c === 0 ? 0 : Math.min(1, 0.55 * ratio + 0.35 * amplio + (c >= 2 ? 0.1 : 0));
  return Math.max(porPalabras, dice(a, b) * 0.9);
}
const seParecen = (a, b) => parecido(a, b) >= 0.62;
const seParecenViejo = (a, b) => { const A = palabras(a), B = palabras(b); if (!A.size || !B.size) return false; let c = 0; A.forEach(w => { if (B.has(w)) c++; }); return (c >= 2 && c / Math.min(A.size, B.size) >= 0.67) || c >= 3; };
async function tareasParecidas(titulo, projectId) {
  const { data } = await supabase.from('tasks').select('id, title, due_date, priority, project:client_projects(client_name, project_name)').eq('done', false).limit(500);
  return (data || []).map(t => ({ t, s: parecido(titulo, t.title) })).filter(x => x.s >= 0.62).sort((a, b) => b.s - a.s).slice(0, 5).map(({ t }) => ({ id: t.id, titulo: t.title, fecha: t.due_date, proyecto: t.project ? (t.project.project_name || t.project.client_name) : null }));
}
// Encuentra UNA tarea pendiente por su id (completo o las primeras letras) o por cómo la nombre Víctor (otras palabras, plurales, apodos…). Si hay duda devuelve las candidatas.
async function resolverTarea(ref) {
  const r = String(ref || '').trim(); if (!r) return { error: 'Dime qué tarea (su id o su nombre).' };
  const { data } = await supabase.from('tasks').select('id, title, due_date, priority, project:client_projects(client_name, project_name)').eq('done', false).limit(600);
  const todas = data || [], ficha = x => ({ id: x.id, titulo: x.title, fecha: x.due_date, proyecto: x.project ? (x.project.project_name || x.project.client_name) : null });
  if (UUID.test(r)) { const x = todas.find(y => y.id === r); return x ? { tarea: x } : { error: 'No encuentro esa tarea entre las pendientes (¿ya está hecha?).' }; }
  if (/^[0-9a-f]{6,12}$/i.test(r)) { const m = todas.filter(y => y.id.toLowerCase().startsWith(r.toLowerCase())); if (m.length === 1) return { tarea: m[0] }; if (m.length > 1) return { ambiguo: true, candidatas: m.slice(0, 5).map(ficha) }; }
  const pun = todas.map(x => ({ x, s: Math.max(parecido(r, x.title), norm(x.title).includes(norm(r)) && norm(r).length >= 4 ? 0.9 : 0, x.project ? parecido(r, x.title + ' ' + (x.project.project_name || '') + ' ' + (x.project.client_name || '')) * 0.95 : 0) })).filter(y => y.s >= 0.4).sort((a, b) => b.s - a.s);
  if (!pun.length) return { error: 'No encuentro ninguna tarea pendiente que se parezca a "' + r + '". Mira listar_tareas.' };
  if (pun[0].s >= 0.75 && (!pun[1] || pun[0].s - pun[1].s >= 0.15)) return { tarea: pun[0].x };
  return { ambiguo: true, candidatas: pun.slice(0, 5).map(y => ficha(y.x)) };
}
// ── presupuestos: buscar uno existente, buscar productos del catálogo y generar el PDF ──
const PRODUCT_SELECT = 'id, name, brand, price, category_id, longitud, ancho, altura, color_bastidor, color_acolchado, tipo_acolchado, purchase_dto, default_margin_pct, pricing_unit, included_accessories, category:catalog_categories!catalog_products_category_id_fkey(type)';
const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'con', 'para', 'a', 'en', 'un', 'una']);
async function productoCatalogo(nombre) {
  const n = String(nombre || '').replace(/[×✕✖]/g, 'x').replace(/[–—]/g, '-').trim(); if (!n) return null;
  const ex = await supabase.from('catalog_products').select(PRODUCT_SELECT).ilike('name', limpia(n)).limit(1).maybeSingle(); if (ex.data) return ex.data;
  const co = await supabase.from('catalog_products').select(PRODUCT_SELECT).ilike('name', '%' + limpia(n) + '%').limit(1).maybeSingle(); if (co.data) return co.data;
  const pal = limpia(n).split(/\s+/).filter(w => w.length > 1 && !STOP.has(w.toLowerCase())); if (!pal.length) return null;
  let q = supabase.from('catalog_products').select(PRODUCT_SELECT); for (const w of pal) q = q.ilike('name', '%' + w + '%');
  const { data } = await q.limit(1); return data?.[0] || null;
}
async function presupuestoPor(input) {
  const cols = 'id, budget_number, budget_name, status, pdf_url, project_id, global_discount_pct, created_at, updated_at';
  const num = limpia(input.presupuesto).toUpperCase().replace(/\s+/g, '');
  if (/^RAN-?\d{1,4}$/.test(num)) { const n = 'RAN-' + num.replace(/^RAN-?/, '').padStart(3, '0'); const { data } = await supabase.from('budgets').select(cols).eq('budget_number', n).limit(1); return data?.[0] || { _noExiste: true, _numero: n }; }
  const texto = limpia(input.presupuesto || input.proyecto || ''); if (!texto) return null;
  let proyecto = null; if (input.proyecto) proyecto = await proyectoPor(input.proyecto);
  const { data: todos } = await supabase.from('budgets').select(cols).order('updated_at', { ascending: false }).limit(400);
  const tk = (t) => norm(t).split(' ').filter(w => w.length > 1 && !STOP.has(w));
  const conjuntos = [tk(texto), proyecto ? tk(proyecto.client_name) : []].filter(x => x.length);
  const cand = (todos || []).filter(b => (proyecto && b.project_id === proyecto.id) || conjuntos.some(c => { const nom = new Set(norm(b.budget_name).split(' ')); return c.every(w => nom.has(w)); }));
  if (!cand.length) return proyecto ? { _sinPresupuesto: true, _proyecto: proyecto } : null;
  if (cand.length === 1) return cand[0];
  // si uno se tocó hace poco y los demás son claramente antiguos, ese es el vigente (la ficha se lo dirá a Víctor)
  const dias = (b) => (Date.now() - new Date(b.updated_at || b.created_at)) / 86400000;
  if (dias(cand[0]) < 14 && dias(cand[1]) - dias(cand[0]) > 30) return cand[0];
  return { _ambiguos: cand.slice(0, 5).map(b => ({ numero: b.budget_number, nombre: b.budget_name || '(sin nombre)', estado: b.status, creado: String(b.created_at).slice(0, 10), modificado: String(b.updated_at || b.created_at).slice(0, 10) })) };
}
function errPresup(b) {
  if (!b) return { error: 'No encuentro ese presupuesto. Búscalo con buscar_presupuestos por el nombre del cliente, o pregúntale a Víctor cuál es. No adivines.' };
  if (b._noExiste) return { error: 'No existe el presupuesto ' + b._numero + '. NO uses ese número: búscalo con buscar_presupuestos por cliente o nombre.' };
  if (b._ambiguos) return { error: 'Hay varios presupuestos que encajan. Pregunta a Víctor cuál (dile número, nombre y fecha) antes de seguir.', candidatos: b._ambiguos };
  if (b._sinPresupuesto) return { error: 'Ese proyecto no tiene presupuesto. Pregunta a Víctor si quiere crear uno NUEVO.', sin_presupuesto: true };
  return { error: 'Presupuesto no disponible.' };
}
const problemaPresup = (b) => !b || b._noExiste || b._ambiguos || b._sinPresupuesto;
// Ficha con la que se identifica un presupuesto ante Víctor y avisos de cosas raras (precio 0, descuento global alto…)
async function fichaPresup(b) {
  const ls = await lineasDe(b.id), reales = ls.filter(l => !l.is_chapter_header), avisos = [];
  const cero = reales.filter(l => !(Number(l.unit_price) > 0)); if (cero.length) avisos.push(cero.length + ' línea(s) SIN PRECIO (0 €): ' + cero.slice(0, 6).map(l => l.name).join('; '));
  if (Number(b.global_discount_pct) > 0) avisos.push('Tiene un descuento global del ' + b.global_discount_pct + '%' + (Number(b.global_discount_pct) >= 50 ? ' (MUY ALTO, revísalo: puede dejar el total en 0)' : ''));
  if (!reales.length) avisos.push('No tiene ninguna línea');
  return { numero: b.budget_number, nombre: b.budget_name || '(sin nombre)', estado: b.status, creado: String(b.created_at).slice(0, 10), modificado: String(b.updated_at || b.created_at).slice(0, 10), lineas: reales.length, total_sin_iva: totalDe(ls, b.global_discount_pct), avisos };
}
async function pdfDePresupuesto(b, ctx, regenerar) {
  let url = regenerar ? null : b.pdf_url;
  if (!url) {
    try { const r = await fetch(BASE_INTERNA + '/api/budgets/' + b.id + '/export-pdf', { method: 'POST', headers: { Authorization: 'Bearer ' + internalAdminToken() } }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || ('error ' + r.status)); url = j.pdf_url || j.budget?.pdf_url || null; }
    catch (e) { return { error: e.message }; }
  }
  if (!url) return { error: 'el PDF no se ha generado' };
  const nomPdf = 'Presupuesto_' + String(b.budget_number).replace(/[^A-Za-z0-9-]/g, '') + '.pdf'; ctx.salida = (ctx.salida || []).filter(x => x.nombre !== nomPdf); ctx.salida.push({ url, nombre: nomPdf });
  return { ok: true };
}
async function lineasDe(budgetId) { const { data } = await supabase.from('budget_items').select('id, name, quantity, unit, unit_price, discount_pct, brand, catalog_product_id, is_chapter_header, display_order').eq('budget_id', budgetId).order('display_order', { ascending: true, nullsFirst: false }); return data || []; }
const totalDe = (ls, dg) => Math.round(ls.filter(l => !l.is_chapter_header).reduce((a, l) => a + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0) * (1 - (Number(l.discount_pct) || 0) / 100), 0) * (1 - (Number(dg) || 0) / 100) * 100) / 100;
async function formPor(pid) {
  const { data: ex } = await supabase.from('project_needs_forms').select('id').eq('project_id', pid).maybeSingle(); if (ex) return ex;
  const { data, error } = await supabase.from('project_needs_forms').insert({ project_id: pid }).select('id').single(); if (error) throw error; return data;
}
async function ejecutar(nombre, input, ctx = {}) {
  const { fecha } = madrid();
  if (HISTORIAS_NOMBRES.has(nombre)) { try { return await ejecutarHistorias(nombre, input || {}, { fecha }); } catch (e) { return { error: 'No se pudo hacer: ' + String(e.message || '').slice(0, 160) }; } }
  if (SALUD_NOMBRES.has(nombre)) { try { return await ejecutarSalud(nombre, input || {}); } catch (e) { return { error: 'No se pudo hacer: ' + String(e.message || '').slice(0, 160) }; } }
  if (input && typeof input.proyecto === 'string' && input.proyecto.trim() && !UUID.test(input.proyecto.trim()) && nombre !== 'guardar_alias') {
    const r = await resolverProyecto(input.proyecto);
    if (r.ambiguo) return { error: 'Hay varios proyectos que encajan con "' + input.proyecto + '". Pregunta a Víctor cuál es (nombra las opciones) y, cuando lo confirme, guarda el apodo con guardar_alias para no volver a preguntar.', candidatos: r.ambiguo };
    if (r.proyecto) input = { ...input, proyecto: r.proyecto.id };
  }
  if (nombre === 'agenda_de_hoy') {
    const [{ data: tareas }, { data: eventos }, { data: emp }] = await Promise.all([
      supabase.from('tasks').select('id, title, due_date, priority, assigned_to, project:client_projects(client_name, project_name)').eq('done', false).order('due_date', { ascending: true, nullsFirst: false }).limit(300),
      supabase.from('events').select('title, time, description').eq('date', fecha).neq('done', true).order('time', { ascending: true, nullsFirst: true }),
      supabase.from('employees').select('id, name'),
    ]);
    const nom = Object.fromEntries((emp || []).map(e => [e.id, e.name.split(' ')[0]]));
    const t = (tareas || []).map(x => ({ id: x.id, titulo: x.title, fecha: x.due_date, atrasada: !!x.due_date && x.due_date < fecha, prioridad: x.priority, de: nom[x.assigned_to] || null, proyecto: x.project ? (x.project.project_name || x.project.client_name) : null }));
    return { hoy: fecha, tareas_hoy_y_atrasadas: t.filter(x => x.fecha && x.fecha <= fecha).slice(0, 25), tareas_sin_fecha: t.filter(x => !x.fecha).length, eventos_hoy: (eventos || []).map(e => ({ hora: e.time ? e.time.slice(0, 5) : null, titulo: e.title, nota: e.description })) };
  }
  if (nombre === 'apuntar_diario') {
    const resumen = String(input.resumen || '').trim().slice(0, 1200); if (!resumen) return { error: 'Nada que apuntar.' };
    const d = await leerJson(RUTA_DIARIO, { entradas: [] });
    d.entradas.push({ id: crypto.randomUUID().slice(0, 6), fecha: /^\d{4}-\d{2}-\d{2}$/.test(input.fecha || '') ? input.fecha : fecha, resumen, proyectos: (Array.isArray(input.proyectos) ? input.proyectos : []).map(x => String(x).slice(0, 80)).slice(0, 10), logros: (Array.isArray(input.logros) ? input.logros : []).map(x => String(x).slice(0, 200)).slice(0, 10) });
    d.entradas = d.entradas.slice(-500); await guardarJson(RUTA_DIARIO, d);
    return { apuntado: true, nota: 'Ahora marca como hechas las tareas que correspondan (completar_tarea), crea las que falten y, si ves un patrón útil de cómo trabaja, guárdalo con recordar.' };
  }
  if (nombre === 'ver_diario') {
    const d = await leerJson(RUTA_DIARIO, { entradas: [] }), n = Math.min(60, Math.max(1, Math.round(Number(input.dias)) || 7)), desde = fechaMadridMas(-n);
    return { entradas: d.entradas.filter(e => e.fecha >= desde).slice(-40) };
  }
  if (nombre === 'ver_presupuesto') {
    const b = await presupuestoPor(input); if (problemaPresup(b)) return errPresup(b);
    const ls = await lineasDe(b.id);
    return { presupuesto: b.budget_number, nombre: b.budget_name, estado: b.status, descuento_global_pct: b.global_discount_pct || 0, lineas: ls.map(l => ({ nombre: l.name, cantidad: l.quantity, unidad: l.unit, precio_unitario: l.unit_price, marca: l.brand, del_catalogo: !!l.catalog_product_id, capitulo: !!l.is_chapter_header })), total_sin_iva: totalDe(ls, b.global_discount_pct), tiene_pdf: !!b.pdf_url, ficha: await fichaPresup(b) };
  }
  if (nombre === 'anadir_lineas_presupuesto') {
    let b = await presupuestoPor(input), creado = false;
    if (b && (b._noExiste || b._ambiguos)) return errPresup(b);
    if (!b || b._sinPresupuesto) {
      if (input.crear_nuevo !== true) return { error: 'No encuentro un presupuesto de ese cliente/proyecto. NO crees uno por tu cuenta: dile a Víctor que no lo encuentras y pregúntale si quiere uno NUEVO (entonces repite con crear_nuevo=true y nombre_si_nuevo).' };
      const proyectoNuevo = b?._proyecto || null, nom = String(input.nombre_si_nuevo || (proyectoNuevo ? (proyectoNuevo.project_name || proyectoNuevo.client_name) : '') || '').trim();
      if (!proyectoNuevo && !nom) return { error: 'No encuentro ese presupuesto. Dime el número (p. ej. RAN-0XX) o el proyecto, o un nombre para crear uno nuevo.' };
      try {
        const r = await fetch(BASE_INTERNA + '/api/budgets', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + internalAdminToken() }, body: JSON.stringify({ project_id: proyectoNuevo?.id || undefined, budget_name: nom || undefined }) });
        const j = await r.json().catch(() => ({})); if (!r.ok || !j.budget) throw new Error(j.error || ('error ' + r.status));
        b = { id: j.budget.id, budget_number: j.budget.budget_number, budget_name: j.budget.budget_name, status: j.budget.status, global_discount_pct: 0, pdf_url: null }; creado = true;
      } catch (e) { return { error: 'No he podido crear el presupuesto nuevo: ' + e.message }; }
    }
    const existentes = await lineasDe(b.id), norm = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim(); let orden = existentes.reduce((m, l) => Math.max(m, Number(l.display_order) || 0), -1) + 1;
    const hechas = [], saltadas = [];
    for (const l of (Array.isArray(input.lineas) ? input.lineas : []).slice(0, 60)) {
      const pedido = String(l.producto || l.descripcion || '').trim(); if (!pedido) continue;
      const cantidad = Number(l.cantidad) > 0 ? Number(l.cantidad) : 1, tienePrecio = l.precio !== undefined && l.precio !== null && l.precio !== '';
      const prod = l.producto ? await productoCatalogo(l.producto) : null;
      let fila, tipo;
      if (prod && prod.price != null) {
        const pr = computeCatalogPricing(prod);
        fila = { catalog_product_id: prod.id, name: prod.name, category: prod.category?.type || 'material', quantity: cantidad, unit: pr.unit, unit_cost: pr.unit_cost, markup_pct: pr.markup_pct, unit_price: tienePrecio ? Number(l.precio) : pr.unit_price, pricing_mode: tienePrecio ? 'margin' : pr.pricing_mode, pvp_ref: tienePrecio ? null : pr.pvp_ref, purchase_dto: tienePrecio ? null : pr.purchase_dto, brand: prod.brand || (l.marca || null), longitud: prod.longitud || null, ancho: prod.ancho || null, altura: prod.altura || null, color_bastidor: prod.color_bastidor || null, color_acolchado: prod.color_acolchado || null, tipo_acolchado: prod.tipo_acolchado || null, accessories_note: prod.included_accessories || null };
        tipo = 'catálogo' + (tienePrecio ? ' (precio indicado por Víctor)' : '');
      } else {
        fila = { catalog_product_id: prod ? prod.id : null, name: (prod ? prod.name : pedido).slice(0, 200), category: prod?.category?.type || 'material', quantity: cantidad, unit: 'ud', unit_cost: Number(l.coste) || 0, markup_pct: 20, unit_price: tienePrecio ? Number(l.precio) || 0 : 0, pricing_mode: 'margin', brand: l.marca ? String(l.marca).slice(0, 80) : (prod?.brand || null) };
        tipo = prod ? 'catálogo sin precio cargado' + (tienePrecio ? ' (precio indicado)' : ' (a 0)') : 'línea libre' + (tienePrecio && Number(l.precio) ? '' : ' (sin precio todavía)');
      }
      if (l.notas) fila.descripcion_cliente = String(l.notas).slice(0, 500);
      if (existentes.some(x => norm(x.name) === norm(fila.name)) || hechas.some(x => norm(x.nombre) === norm(fila.name))) { saltadas.push(fila.name + ' (ya estaba en el presupuesto)'); continue; }
      const { error } = await supabase.from('budget_items').insert({ budget_id: b.id, display_order: orden++, ...fila });
      if (error) { saltadas.push(pedido + ' (error: ' + error.message.slice(0, 60) + ')'); continue; }
      hechas.push({ nombre: fila.name, cantidad, precio: fila.unit_price, tipo });
    }
    const ls = await lineasDe(b.id); const res = { presupuesto: b.budget_number, nombre: b.budget_name, creado_nuevo: creado, lineas_anadidas: hechas, no_anadidas: saltadas, lineas_totales: ls.length, total_sin_iva: totalDe(ls, b.global_discount_pct) };
    res.ficha = await fichaPresup(b);
    if (hechas.length && input.generar_pdf !== false) { if (ctx.avisar) await ctx.avisar('Generando el PDF del presupuesto, un momento…'); const p = await pdfDePresupuesto(b, ctx, true); if (p.error) res.pdf_error = 'No he podido generar el PDF: ' + p.error + '. Se puede exportar a mano desde Presupuestos.'; else res.pdf = 'El PDF actualizado se envía a Víctor junto a tu respuesta.'; }
    return res;
  }
  if (nombre === 'modificar_linea_presupuesto') {
    const b = await presupuestoPor(input); if (problemaPresup(b)) return errPresup(b);
    const q = limpia(input.linea).toLowerCase(); const ls = await lineasDe(b.id); const cand = ls.filter(l => String(l.name || '').toLowerCase().includes(q));
    if (!cand.length) return { error: 'No encuentro una línea que contenga "' + input.linea + '".', lineas: ls.map(l => l.name).slice(0, 30) };
    if (cand.length > 1) return { error: 'Hay varias líneas que encajan; dime cuál.', candidatas: cand.map(l => l.name).slice(0, 10) };
    const cambios = {}; if (input.cantidad !== undefined) cambios.quantity = Number(input.cantidad) || 1; if (input.precio !== undefined) { cambios.unit_price = Number(input.precio) || 0; cambios.pricing_mode = 'margin'; } if (input.nombre) cambios.name = String(input.nombre).slice(0, 200); if (input.notas !== undefined) cambios.descripcion_cliente = String(input.notas).slice(0, 500);
    if (!Object.keys(cambios).length) return { error: 'No hay nada que cambiar.' };
    const { error } = await supabase.from('budget_items').update(cambios).eq('id', cand[0].id).eq('budget_id', b.id); if (error) return { error: 'No se pudo cambiar: ' + error.message };
    const res = { modificada: cand[0].name, cambios: Object.keys(cambios), total_sin_iva: totalDe(await lineasDe(b.id), b.global_discount_pct) };
    res.ficha = await fichaPresup(b);
    if (input.regenerar_pdf !== false) { if (ctx.avisar) await ctx.avisar('Generando el PDF actualizado…'); const p = await pdfDePresupuesto(b, ctx, true); if (p.error) res.pdf_error = p.error; else res.pdf = 'Se envía a Víctor un PDF NUEVO con el cambio ya aplicado. Dile número, nombre, líneas y total, y repite los avisos.'; }
    return res;
  }
  if (nombre === 'presupuesto_pdf') {
    const b = await presupuestoPor(input); if (problemaPresup(b)) return errPresup(b);
    if (ctx.avisar) await ctx.avisar('Generando el PDF actualizado de ' + b.budget_number + '…');
    const p = await pdfDePresupuesto(b, ctx, true); if (p.error) return { error: 'No he podido generar el PDF de ' + b.budget_number + ': ' + p.error + '. Se puede exportar a mano desde Presupuestos.' };
    return { enviado: true, ficha: await fichaPresup(b), nota: 'Se manda un PDF NUEVO generado ahora con los datos actuales. Dile a Víctor número, nombre, nº de líneas y total, y repite los avisos si los hay.' };
  }
  if (nombre === 'buscar_presupuestos') {
    const tk = norm(input.texto).split(' ').filter(w => w.length > 1 && !STOP.has(w)); if (!tk.length) return { error: 'Dime qué buscar (cliente o nombre).' };
    const { data } = await supabase.from('budgets').select('id, budget_number, budget_name, status, project_id, created_at, updated_at, global_discount_pct').order('updated_at', { ascending: false }).limit(400);
    const pids = [...new Set((data || []).map(b => b.project_id).filter(Boolean))]; const { data: ps } = pids.length ? await supabase.from('client_projects').select('id, client_name, project_name').in('id', pids) : { data: [] }; const pm = Object.fromEntries((ps || []).map(p => [p.id, p]));
    const coinc = (data || []).filter(b => { const t = new Set(norm(b.budget_name + ' ' + (pm[b.project_id]?.client_name || '') + ' ' + (pm[b.project_id]?.project_name || '')).split(' ')); return tk.every(w => t.has(w)); });
    return { resultados: coinc.slice(0, 8).map(b => ({ numero: b.budget_number, nombre: b.budget_name || '(sin nombre)', cliente: pm[b.project_id]?.client_name || null, estado: b.status, creado: String(b.created_at).slice(0, 10), modificado: String(b.updated_at || b.created_at).slice(0, 10) })), total: coinc.length };
  }
  if (nombre === 'guardar_alias') {
    const al = norm(input.alias); if (!al) return { error: 'Falta el apodo.' }; const p = await proyectoPor(input.proyecto); if (!p) return { error: 'No encuentro ese proyecto.' };
    const m = await leerJson(RUTA_ALIAS, {}); m[al] = { id: p.id, nombre: (p.client_name || '') + ' · ' + (p.project_name || '') }; await guardarJson(RUTA_ALIAS, m);
    return { guardado: true, nota: 'Desde ahora "' + input.alias + '" significa ' + m[al].nombre + '.' };
  }
  if (nombre === 'enviar_alzado') {
    const p = await proyectoPor(input.proyecto); if (!p) return { error: 'No encuentro ese proyecto.' };
    const { data: blob } = await supabase.storage.from(BUCKET).download('crm/diseno/' + String(p.id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60) + '.json');
    let laminas = []; try { laminas = blob ? (JSON.parse(await blob.text()).laminas || []).filter(l => l.versiones?.length) : []; } catch { /* sin láminas */ }
    if (!laminas.length) return { error: 'Ese proyecto no tiene ningún alzado guardado todavía.' };
    laminas.sort((a, b) => String(b.actualizada || '').localeCompare(String(a.actualizada || '')));
    const q = limpia(input.lamina).toLowerCase(), l = (q && laminas.find(x => String(x.titulo || '').toLowerCase().includes(q))) || laminas[0];
    let png; try { png = alzadoPNG(l.versiones[l.versiones.length - 1].spec, { fecha: new Date().toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid' }) }); } catch (e) { return { error: 'No he podido dibujar el alzado: ' + e.message }; }
    const url = await uploadProjectDocument(png, 'alzado_' + fecha + '.png', 'image/png', p.id);
    (ctx.salida = ctx.salida || []).push({ url, nombre: 'alzado.png', tipo: 'imagen' });
    return { enviado: true, lamina: l.titulo, version: l.versiones.length, otras_laminas: laminas.filter(x => x !== l).map(x => x.titulo).slice(0, 8), nota: 'La imagen se envía a Víctor junto a tu respuesta; no pegues enlaces.' };
  }
  if (nombre === 'crear_plano') {
    const a = (ctx.adjuntos || []).find(x => x.id === input.adjunto); if (!a) return { error: 'No encuentro ese adjunto.' };
    const p = await proyectoPor(input.proyecto); if (!p) return { error: 'No encuentro ese proyecto. Dime a cuál va el plano.' };
    const esPdf = a.mime === 'application/pdf', esImg = /^image\/(jpeg|png|webp)$/.test(a.mime); if (!esPdf && !esImg) return { error: 'Necesito un PDF o una imagen (jpg, png, webp) del plano.' };
    let im;
    try {
      if (esPdf) {
        const info = infoPdf(a.buffer); let pag = Math.round(Number(input.pagina)) || 0;
        if (!pag && info.paginas === 1) pag = 1;
        if (!pag) return { error: 'El PDF tiene ' + info.paginas + ' páginas. Pregúntale a Víctor cuál es la planta (estado actual) que quiere llevar a Planos.', paginas: info.lista.map(x => 'p' + x.n + ': ' + x.texto) };
        im = paginaAImagen(a.buffer, pag);
      } else { return { error: 'De momento solo sé montar el plano desde un PDF. Si es una foto o imagen, impórtala desde Planos con el botón de importar con IA.' }; }
    } catch (e) { return { error: 'No he podido abrir el archivo: ' + e.message }; }
    if (ctx.avisar) await ctx.avisar('Leyendo el plano, tarda un minuto…');
    let lectura; try { lectura = await lectorPlano(im, null); } catch (e) { return { error: 'No he podido leer el plano: ' + e.message }; }
    if (!lectura?.muros?.length) return { error: 'La IA no ha encontrado muros. Prueba con una página donde se vea la planta completa y nítida.' };
    const es = escalaDe(lectura); let cm = es?.cm, escalaDe_ = es ? 'cotas del plano (' + es.n + ' de ' + es.de + ' coinciden)' : null;
    if (!cm && input.medida_muro_mas_largo_cm > 20) { let Lmax = 0; lectura.muros.forEach(m => { Lmax = Math.max(Lmax, Math.hypot(m.x2 - m.x1, m.y2 - m.y1)); }); cm = Number(input.medida_muro_mas_largo_cm) / Lmax; escalaDe_ = 'la medida que Víctor ha dado del muro más largo'; }
    if (!cm) return { error: 'El plano no trae cotas legibles. Pregúntale a Víctor cuánto mide en la realidad el muro más largo (en cm) y vuelve a llamar con medida_muro_mas_largo_cm.' };
    let B; try { B = construirPlano({ muros: lectura.muros, puertas: lectura.puertas, ventanas: lectura.ventanas, pilares: lectura.pilares, w: lectura.w || im.w, h: lectura.h || im.h }, cm); } catch (e) { return { error: 'No he podido montar el plano: ' + e.message }; }
    if (!B.walls.length) return { error: 'No se ha podido montar ningún muro.' };
    const id = 'vm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), nombrePlano = String(input.nombre || p.project_name || 'Plano').slice(0, 200);
    const reg = registroPlano({ id, B, nombre: nombrePlano, cliente: p.client_name || '', altura: 300 });
    const uid = await adminId();
    const { error } = await supabase.from('mediciones').insert({ id, data: reg, resumen: null, nombre: nombrePlano, cliente: String(p.client_name || '').slice(0, 200) || null, project_id: p.id, created_by: uid, updated_by: uid, updated_at: new Date().toISOString() });
    if (error) return { error: 'El plano está leído pero no se ha podido guardar en el CRM: ' + error.message };
    return { creado: true, donde: 'Planos de ' + (p.project_name || p.client_name) + ' (CRM), plano "' + nombrePlano + '"', muros: B.walls.length, puertas_y_ventanas: B.ops.length, pilares: B.pil.length, tamano_aprox_m: (B.extension_cm.ancho / 100).toFixed(1) + ' x ' + (B.extension_cm.alto / 100).toFixed(1), escala_sacada_de: escalaDe_, aviso_ia: lectura.aviso || null, nota: 'ES UN BORRADOR del estado actual. Dile a Víctor que lo revise sobre el plano del cliente: la escala puede desviarse unos puntos y la IA puede dejarse puertas y pilares.' };
  }
  if (nombre === 'crear_proyecto') {
    const nombreP = String(input.proyecto || '').trim(), cliente = String(input.cliente || '').trim(); if (!nombreP || !cliente) return { error: 'Faltan el nombre del proyecto o del cliente.' };
    if (!input.forzar) { const ex = await proyectoPor(nombreP); if (ex && (seParecen(nombreP, ex.project_name) || seParecen(cliente + ' ' + nombreP, ex.project_name + ' ' + ex.client_name))) return { posible_duplicado: true, ya_existe: { proyecto: ex.project_name, cliente: ex.client_name, fase: ex.phase }, nota: 'NO he creado nada: ya hay un proyecto parecido. Díselo a Víctor y pregúntale si es el mismo o crea otro (forzar=true).' }; }
    let resp = null; if (input.responsable) { resp = await empleadoPor(input.responsable); if (!resp) return { error: 'No encuentro a "' + input.responsable + '" en el equipo. No he creado el proyecto.' }; }
    const cab = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + internalAdminToken() };
    const cod = await fetch(BASE_INTERNA + '/api/client-projects/generate-code', { method: 'POST', headers: cab }); const cj = await cod.json().catch(() => ({}));
    if (!cod.ok || !cj.code) return { error: 'No he podido generar el código del proyecto: ' + (cj.error || cod.status) };
    const r = await fetch(BASE_INTERNA + '/api/client-projects', { method: 'POST', headers: cab, body: JSON.stringify({ client_name: cliente, project_name: nombreP, access_code: cj.code, phase: 0, urgency: input.urgencia || 'normal', client_email: input.email || undefined, notes: input.notas || undefined, tipo_proyecto: ['comercial', 'home_gym'].includes(input.tipo) ? input.tipo : undefined, responsible_id: resp?.id || undefined }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.project) return { error: 'El CRM no ha podido crearlo: ' + (j.error || r.status) };
    return { creado: true, id: j.project.id, proyecto: j.project.project_name, cliente: j.project.client_name, fase: j.project.phase, tipo: j.project.tipo_proyecto || null, nota: 'Ya aparece en Proyectos con las tareas de la fase 0.' };
  }
  if (nombre === 'contexto_proyecto') {
    const p = await proyectoPor(input.proyecto); if (!p) return { error: 'No encuentro ese proyecto.' };
    const [{ data: full }, { data: f }, { data: eq }, { data: ma }, { data: dc }, { data: rn }, { data: ts }] = await Promise.all([
      supabase.from('client_projects').select('*').eq('id', p.id).maybeSingle(),
      supabase.from('project_needs_forms').select('id, brief, client_summary').eq('project_id', p.id).maybeSingle(),
      supabase.from('project_equipment_selections').select('name, brand, quantity').eq('project_id', p.id).limit(40),
      supabase.from('project_material_selections').select('name, location').eq('project_id', p.id).limit(40),
      supabase.from('project_documents').select('name, doc_type').eq('project_id', p.id).limit(40),
      supabase.from('project_renders').select('id', { count: 'exact', head: false }).eq('project_id', p.id).limit(200),
      supabase.from('tasks').select('id, title, due_date, done, phase_number').eq('project_id', p.id).limit(100),
    ]);
    let respuestas = []; if (f?.id) { const { data: a } = await supabase.from('project_needs_form_answers').select('question_id, answer_value').eq('form_id', f.id).limit(80); const { data: q } = await supabase.from('needs_form_questions').select('id, question_text'); const qn = Object.fromEntries((q || []).map(x => [x.id, x.question_text])); respuestas = (a || []).filter(x => x.answer_value != null && x.answer_value !== '').slice(0, 40).map(x => (qn[x.question_id] || 'pregunta') + ': ' + (Array.isArray(x.answer_value) ? x.answer_value.join(', ') : String(x.answer_value)).slice(0, 160)); }
    return { proyecto: p.project_name, cliente: p.client_name, tipo: full?.tipo_proyecto || null, fase: p.phase != null ? p.phase + ' · ' + (FASES[p.phase] || '') : null, urgencia: p.urgency, condicionantes: String(full?.condicionantes || '').slice(0, 600) || null, resumen_cliente: String(f?.client_summary || f?.brief || '').slice(0, 900) || null, programa_de_necesidades: respuestas, equipos: (eq || []).map(x => (x.brand ? x.brand + ' ' : '') + x.name + (x.quantity > 1 ? ' x' + x.quantity : '')), materiales: (ma || []).map(x => x.name + (x.location ? ' (' + x.location + ')' : '')), documentos: (dc || []).map(x => x.name), renders: (rn || []).length, tareas_pendientes: (ts || []).filter(t => !t.done).map(t => ({ id: t.id, titulo: t.title, fecha: t.due_date, fase: t.phase_number })), tareas_hechas: (ts || []).filter(t => t.done).length };
  }
  if (nombre === 'plantillas_fase') {
    let q = supabase.from('phase_task_templates').select('phase_number, title').order('phase_number', { ascending: true }); if (input.fase != null && input.fase !== '') q = q.eq('phase_number', Number(input.fase));
    const { data, error } = await q; if (error) return { error: 'No se pudieron leer las plantillas.' };
    const porFase = {}; (data || []).forEach(t => { const k = t.phase_number + ' · ' + (FASES[t.phase_number] || ''); (porFase[k] = porFase[k] || []).push(t.title); });
    return { plantillas: porFase };
  }
  if (nombre === 'crear_subtareas') {
    const p = await proyectoPor(input.proyecto); if (!p) return { error: 'No encuentro ese proyecto. No he creado nada.' };
    const pasos = (Array.isArray(input.pasos) ? input.pasos : []).filter(x => String(x?.titulo || '').trim()).slice(0, 12); if (!pasos.length) return { error: 'No hay pasos que crear.' };
    const { data: ex } = await supabase.from('tasks').select('title').eq('project_id', p.id).eq('done', false).limit(200);
    const creadas = [], saltadas = [];
    for (const x of pasos) {
      const titulo = String(x.titulo).trim().slice(0, 200);
      if ((ex || []).some(t => seParecen(titulo, t.title)) || creadas.some(c => seParecen(titulo, c))) { saltadas.push(titulo); continue; }
      const fila = { title: titulo, project_id: p.id, priority: x.prioridad || 'normal', due_date: /^\d{4}-\d{2}-\d{2}$/.test(x.fecha || '') ? x.fecha : null, phase_number: input.fase != null && input.fase !== '' ? Math.round(Number(input.fase)) : (p.phase ?? null) };
      if (x.asignada_a) { const e = await empleadoPor(x.asignada_a); if (e) fila.assigned_to = e.id; }
      const { error } = await supabase.from('tasks').insert(fila); if (error) { saltadas.push(titulo + ' (error)'); continue; } creadas.push(titulo);
    }
    return { proyecto: p.project_name || p.client_name, creadas, ya_existian_o_fallaron: saltadas };
  }
  if (nombre === 'listar_eventos') {
    const n = Math.min(60, Math.max(1, Math.round(Number(input.dias)) || 14)), hasta = fechaMadridMas(n);
    const { data, error } = await supabase.from('events').select('title, date, time, description').gte('date', fecha).lte('date', hasta).neq('done', true).order('date', { ascending: true }).order('time', { ascending: true, nullsFirst: true }).limit(120);
    if (error) return { error: 'No se pudo leer el calendario.' };
    const b = limpia(input.busqueda).toLowerCase();
    return { eventos: (data || []).filter(e => !b || (e.title + ' ' + (e.description || '')).toLowerCase().includes(b)).map(e => ({ fecha: e.date, hora: e.time ? e.time.slice(0, 5) : null, titulo: e.title, nota: e.description })) };
  }
  if (nombre === 'listar_tareas') {
    let q = supabase.from('tasks').select('id, title, due_date, priority, assigned_to, project_id, project:client_projects(client_name, project_name, urgency)').eq('done', false).limit(400);
    if (input.proyecto) { const p = await proyectoPor(input.proyecto); if (!p) return { error: 'No encuentro ese proyecto.' }; q = q.eq('project_id', p.id); }
    if (input.de) { const e = await empleadoPor(input.de); if (!e) return { error: 'No encuentro a "' + input.de + '" en el equipo.' }; q = q.eq('assigned_to', e.id); }
    const [{ data: ts, error }, { data: emp }] = await Promise.all([q, supabase.from('employees').select('id, name')]);
    if (error) return { error: 'No se pudieron leer las tareas.' };
    const nom = Object.fromEntries((emp || []).map(e => [e.id, e.name.split(' ')[0]]));
    const orden = (a, b) => (a.due_date && b.due_date ? a.due_date.localeCompare(b.due_date) : a.due_date ? -1 : b.due_date ? 1 : 0);
    const f = x => ({ id: x.id, titulo: x.title, fecha: x.due_date || null, prioridad: x.priority, de: nom[x.assigned_to] || 'sin asignar', proyecto: x.project ? (x.project.project_name || x.project.client_name) : null, urgencia_proyecto: x.project?.urgency || null });
    const todas = (ts || []).slice().sort(orden);
    return { hoy: fecha, total_pendientes: todas.length, atrasadas: todas.filter(x => x.due_date && x.due_date < fecha).map(f), de_hoy: todas.filter(x => x.due_date === fecha).map(f), proximas: todas.filter(x => x.due_date && x.due_date > fecha).slice(0, 30).map(f), sin_fecha: todas.filter(x => !x.due_date).slice(0, 60).map(f) };
  }
  if (nombre === 'buscar_tarea') {
    const q = String(input.texto || '').trim(); if (!q) return { error: 'Dime qué tarea buscas.' };
    const { data } = await supabase.from('tasks').select('id, title, due_date, priority, project:client_projects(client_name, project_name)').eq('done', false).limit(600);
    const r = (data || []).map(x => ({ x, s: Math.max(parecido(q, x.title), norm(x.title).includes(norm(q)) && norm(q).length >= 4 ? 0.9 : 0, x.project ? parecido(q, x.title + ' ' + (x.project.project_name || '') + ' ' + (x.project.client_name || '')) * 0.95 : 0) })).filter(y => y.s >= 0.35).sort((a, b) => b.s - a.s).slice(0, 6);
    return r.length ? { coincidencias: r.map(y => ({ id: y.x.id, titulo: y.x.title, fecha: y.x.due_date, proyecto: y.x.project ? (y.x.project.project_name || y.x.project.client_name) : null, parecido: Math.round(y.s * 100) + '%' })), nota: 'Si la primera se parece mucho, es la misma tarea: no crees otra.' } : { coincidencias: [], nota: 'No hay nada parecido apuntado: puedes crearla.' };
  }
  if (nombre === 'actualizar_tarea') {
    const rs = await resolverTarea(input.id); if (rs.error) return rs; if (rs.ambiguo) return { ambiguo: true, candidatas: rs.candidatas, nota: 'Hay varias que encajan: pregúntale a Víctor cuál (con sus títulos).' };
    input.id = rs.tarea.id;
    const cambios = {}; if (input.fecha !== undefined) { if (!/^\d{4}-\d{2}-\d{2}$/.test(input.fecha)) return { error: 'La fecha debe ser AAAA-MM-DD.' }; cambios.due_date = input.fecha; }
    if (input.prioridad) cambios.priority = input.prioridad; if (input.titulo) cambios.title = String(input.titulo).trim().slice(0, 200);
    if (input.asignada_a) { const e = await empleadoPor(input.asignada_a); if (!e) return { error: 'No encuentro a "' + input.asignada_a + '".' }; cambios.assigned_to = e.id; }
    if (!Object.keys(cambios).length) return { error: 'No hay nada que cambiar.' };
    const { data, error } = await supabase.from('tasks').update(cambios).eq('id', input.id).select('id, title, due_date, priority').maybeSingle();
    if (error || !data) return { error: 'No he podido actualizar la tarea.' };
    return { actualizada: true, titulo: data.title, fecha: data.due_date, prioridad: data.priority };
  }
  if (nombre === 'listar_proyectos') {
    let q = supabase.from('client_projects').select('id, client_name, project_name, phase, urgency').eq('status', 'en_marcha').eq('active', true).order('created_at', { ascending: false }).limit(40);
    const b = limpia(input.busqueda); if (b) q = q.or('client_name.ilike.%' + b + '%,project_name.ilike.%' + b + '%');
    const { data } = await q;
    return { proyectos: (data || []).map(p => ({ id: p.id, nombre: p.project_name, cliente: p.client_name, fase: p.phase != null ? p.phase + ' · ' + (FASES[p.phase] || '') : null, urgencia: p.urgency })) };
  }
  if (nombre === 'ver_proyecto') {
    const p = await proyectoPor(input.proyecto); if (!p) return { error: 'No encuentro ese proyecto.' };
    const { data: ts } = await supabase.from('tasks').select('id, title, due_date, priority').eq('project_id', p.id).eq('done', false).order('due_date', { ascending: true, nullsFirst: false }).limit(25);
    return { id: p.id, nombre: p.project_name, cliente: p.client_name, fase: p.phase != null ? p.phase + ' · ' + (FASES[p.phase] || '') : null, estado: p.status, urgencia: p.urgency, tareas_pendientes: (ts || []).map(x => ({ id: x.id, titulo: x.title, fecha: x.due_date, prioridad: x.priority })) };
  }
  if (nombre === 'crear_tarea') {
    if (!String(input.titulo || '').trim()) return { error: 'Falta el título.' };
    const fila = { title: String(input.titulo).trim().slice(0, 200), description: input.descripcion ? String(input.descripcion).slice(0, 1000) : null, priority: input.prioridad || 'normal', due_date: /^\d{4}-\d{2}-\d{2}$/.test(input.fecha || '') ? input.fecha : null };
    if (!input.forzar) { const par = await tareasParecidas(input.titulo, null); if (par.length) return { posible_duplicado: true, ya_apuntado: par, nota: 'NO he creado nada. Ya hay tareas pendientes parecidas. Díselo a Víctor ("ya tenías apuntado…") y pregúntale si la cambias (actualizar_tarea), la sumas como otra (crear_tarea con forzar=true) o es la misma.' }; }
    let proyecto = null; if (input.proyecto) { proyecto = await proyectoPor(input.proyecto); if (!proyecto) return { error: 'No encuentro el proyecto "' + input.proyecto + '". No he creado la tarea.' }; fila.project_id = proyecto.id; }
    if (input.asignada_a) { const e = await empleadoPor(input.asignada_a); if (!e) return { error: 'No encuentro a "' + input.asignada_a + '" en el equipo. No he creado la tarea.' }; fila.assigned_to = e.id; }
    const { data, error } = await supabase.from('tasks').insert(fila).select('id, title, due_date').single();
    if (error) return { error: 'No se pudo crear: ' + error.message };
    return { creada: true, id: data.id, titulo: data.title, fecha: data.due_date, proyecto: proyecto ? (proyecto.project_name || proyecto.client_name) : null };
  }
  if (nombre === 'completar_tarea') {
    const rs = await resolverTarea(input.id); if (rs.error) return rs; if (rs.ambiguo) return { ambiguo: true, candidatas: rs.candidatas, nota: 'Hay varias que encajan: pregúntale a Víctor cuál (con sus títulos).' };
    input.id = rs.tarea.id;
    const { data, error } = await supabase.from('tasks').update({ done: true }).eq('id', input.id).select('id, title').maybeSingle();
    if (error || !data) return { error: 'No he podido marcarla.' };
    return { hecha: true, titulo: data.title };
  }
  if (nombre === 'crear_evento') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.fecha || '') || !String(input.titulo || '').trim()) return { error: 'Faltan título o fecha (AAAA-MM-DD).' };
    if (!input.forzar) {
      const { data: ev } = await supabase.from('events').select('id, title, time').eq('date', input.fecha).neq('done', true).limit(50);
      const par = (ev || []).filter(e => seParecen(input.titulo, e.title) || (input.hora && e.time && e.time.slice(0, 5) === String(input.hora).padStart(5, '0'))).map(e => ({ titulo: e.title, hora: e.time ? e.time.slice(0, 5) : null }));
      if (par.length) return { posible_duplicado: true, ya_apuntado: par, nota: 'NO he creado nada. Ese día ya hay algo parecido o a la misma hora. Díselo a Víctor y pregúntale si lo sumas igualmente (crear_evento con forzar=true) o cambias el que había.' };
    }
    const fila = { title: String(input.titulo).trim().slice(0, 200), description: input.descripcion ? String(input.descripcion).slice(0, 1000) : null, date: input.fecha, time: /^\d{1,2}:\d{2}$/.test(input.hora || '') ? input.hora : null, color: '#beb0a2' };
    const { data, error } = await supabase.from('events').insert(fila).select('id, title, date, time').single();
    if (error) return { error: 'No se pudo crear: ' + error.message };
    return { creado: true, titulo: data.title, fecha: data.date, hora: data.time };
  }
  if (nombre === 'guardar_adjunto') {
    const a = (ctx.adjuntos || []).find(x => x.id === input.adjunto); if (!a) return { error: 'No encuentro ese adjunto.' };
    const ext = EXT[a.mime] || ((a.nombre || '').split('.').pop() || 'bin'), nom = (a.nombre && /\./.test(a.nombre)) ? a.nombre : 'archivo.' + ext;
    if (input.destino === 'referencia') {
      if (!a.mime.startsWith('image/')) return { error: 'Las referencias tienen que ser imágenes.' };
      const url = await uploadReferenceImage(a.buffer, nom, a.mime);
      const { error } = await supabase.from('inspiration_references').insert({ title: String(input.titulo || 'Referencia desde el móvil').slice(0, 120), description: input.nota ? String(input.nota).slice(0, 800) : null, category: input.categoria ? String(input.categoria).slice(0, 60) : null, image_url: url });
      if (error) return { error: 'No se pudo guardar: ' + error.message };
      return { guardada: true, donde: 'Referencias (tablero general)' };
    }
    const p = await proyectoPor(input.proyecto); if (!p) return { error: 'No encuentro ese proyecto. No he guardado nada.' };
    const nombreP = p.project_name || p.client_name;
    if (input.destino === 'documento') {
      const url = await uploadProjectDocument(a.buffer, nom, a.mime, p.id);
      const { error } = await supabase.from('project_documents').insert({ project_id: p.id, url, name: String(input.titulo || nom).slice(0, 150), doc_type: 'otro' });
      if (error) return { error: 'No se pudo guardar: ' + error.message };
      return { guardado: true, donde: 'Documentos de ' + nombreP };
    }
    if (!a.mime.startsWith('image/')) return { error: 'En necesidades/obra solo caben fotos. Para un PDF usa destino "documento".' };
    const f = await formPor(p.id), url = await uploadDiagnosisImage(a.buffer, nom, a.mime, p.id);
    const { data: mx } = await supabase.from('project_needs_form_photos').select('display_order').eq('form_id', f.id).order('display_order', { ascending: false }).limit(1).maybeSingle();
    const pie = [input.destino === 'obra' ? 'Visita a obra ' + fecha.split('-').reverse().join('/') : null, input.titulo, input.nota].filter(Boolean).join(' · ').slice(0, 400) || null;
    const { error } = await supabase.from('project_needs_form_photos').insert({ form_id: f.id, url, caption: pie, display_order: (mx?.display_order ?? -1) + 1 });
    if (error) return { error: 'No se pudo guardar: ' + error.message };
    return { guardada: true, donde: (input.destino === 'obra' ? 'Programa de necesidades (fotos de obra) de ' : 'Programa de necesidades de ') + nombreP };
  }
  if (nombre === 'guardar_nota_proyecto') {
    const p = await proyectoPor(input.proyecto); if (!p) return { error: 'No encuentro ese proyecto. No he guardado nada.' };
    const cuerpo = '# ' + String(input.titulo).slice(0, 150) + '\nFecha: ' + fecha + '\nProyecto: ' + (p.project_name || p.client_name) + '\n\n' + String(input.resumen || '') + (input.incluir_original && ctx.textoUsuario ? '\n\n---\nTexto original:\n' + ctx.textoUsuario : '') + '\n';
    const slug = String(input.titulo).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 40);
    const url = await uploadProjectDocument(Buffer.from(cuerpo, 'utf8'), (input.tipo || 'nota') + '_' + fecha + '_' + slug + '.txt', 'text/plain', p.id);
    const nom = ({ reunion: 'Reunión', obra: 'Visita a obra', nota: 'Nota' })[input.tipo] || 'Nota';
    const fila = { project_id: p.id, url, name: nom + ' ' + fecha.split('-').reverse().join('/') + ' · ' + String(input.titulo).slice(0, 100) };
    let { error } = await supabase.from('project_documents').insert({ ...fila, doc_type: 'nota' });
    if (error) ({ error } = await supabase.from('project_documents').insert({ ...fila, doc_type: 'otro' }));
    if (error) return { error: 'No se pudo guardar: ' + error.message };
    return { guardada: true, donde: 'Documentos de ' + (p.project_name || p.client_name) };
  }
  if (nombre === 'crear_proveedor') {
    const nomb = String(input.nombre || '').trim(); if (!nomb) return { error: 'Falta el nombre.' };
    const { data: ya } = await supabase.from('contacts').select('id, name').ilike('name', limpia(nomb)).limit(1); if (ya?.length) return { error: 'Ya existe un contacto llamado "' + ya[0].name + '". No he creado otro.' };
    const { data, error } = await supabase.from('contacts').insert({ name: nomb.slice(0, 120), sector: input.sector ? String(input.sector).slice(0, 80) : null, phone: input.telefono ? String(input.telefono).slice(0, 40) : null, email: input.email ? String(input.email).slice(0, 120) : null, company_url: input.web ? String(input.web).slice(0, 200) : null, description: input.descripcion ? String(input.descripcion).slice(0, 800) : null }).select('id, name, sector').single();
    if (error) return { error: 'No se pudo crear: ' + error.message };
    return { creado: true, nombre: data.name, sector: data.sector };
  }
  if (nombre === 'buscar_proveedores') {
    const t = limpia(input.texto); const { data } = await supabase.from('contacts').select('name, sector, phone, email, company_url').or('name.ilike.%' + t + '%,sector.ilike.%' + t + '%,description.ilike.%' + t + '%').limit(15);
    return { proveedores: data || [] };
  }
  if (nombre === 'recordatorio') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.fecha || '') || !/^\d{1,2}:\d{2}$/.test(input.hora || '') || !String(input.texto || '').trim()) return { error: 'Faltan texto, fecha (AAAA-MM-DD) u hora (HH:MM).' };
    const lista = await leerJson(RUTA_RECORD, []); const hh = input.hora.padStart(5, '0');
    const r = { id: crypto.randomUUID().slice(0, 6), cuando: input.fecha + 'T' + hh, texto: String(input.texto).trim().slice(0, 300), enviado: false };
    lista.push(r); await guardarJson(RUTA_RECORD, lista.slice(-200));
    return { programado: true, para: r.cuando };
  }
  if (nombre === 'consultar_crm') {
    if (input.que === 'resumen') {
      const [{ data: pr }, { data: ta }, { data: em }] = await Promise.all([
        supabase.from('client_projects').select('project_name, client_name, phase, urgency').eq('status', 'en_marcha').eq('active', true),
        supabase.from('tasks').select('title, due_date, assigned_to, done').eq('done', false).limit(2000),
        supabase.from('employees').select('id, name').eq('active', true),
      ]);
      const porFase = {}; (pr || []).forEach(p => { const k = (p.phase ?? 0) + ' · ' + (FASES[p.phase ?? 0] || ''); (porFase[k] = porFase[k] || []).push(p.project_name || p.client_name); });
      const nom = Object.fromEntries((em || []).map(e => [e.id, e.name])); const carga = {};
      (ta || []).forEach(t => { const n = nom[t.assigned_to] || 'Sin asignar'; carga[n] = carga[n] || { pendientes: 0, atrasadas: 0 }; carga[n].pendientes++; if (t.due_date && t.due_date < fecha) carga[n].atrasadas++; });
      return { hoy: fecha, proyectos_por_fase: porFase, total_proyectos: (pr || []).length, tareas_pendientes: (ta || []).length, tareas_atrasadas: (ta || []).filter(t => t.due_date && t.due_date < fecha).length, carga_por_persona: carga };
    }
    if (input.que === 'ventas') { const { data } = await supabase.from('ventas').select('nombre, valor, cerrada').limit(200); const v = data || []; return { abiertas: v.filter(x => !x.cerrada).map(x => ({ nombre: x.nombre, valor: x.valor })), cerradas: v.filter(x => x.cerrada).length, importe_abierto: v.filter(x => !x.cerrada).reduce((a, x) => a + (Number(x.valor) || 0), 0) }; }
    if (input.que === 'leads') { const { data } = await supabase.from('setting_leads').select('nombre, estado, canal, created_at').order('created_at', { ascending: false }).limit(30); return { ultimos_leads: (data || []).map(l => ({ nombre: l.nombre, estado: l.estado, canal: l.canal, fecha: (l.created_at || '').slice(0, 10) })) }; }
    if (input.que === 'presupuestos') { const { data } = await supabase.from('budgets').select('budget_name, status, created_at').order('created_at', { ascending: false }).limit(30); return { ultimos_presupuestos: (data || []).map(b => ({ nombre: b.budget_name, estado: b.status, fecha: (b.created_at || '').slice(0, 10) })) }; }
    return { error: 'Consulta desconocida.' };
  }
  if (nombre === 'crear_pdf') {
    const buf = await crearInformePdf({ titulo: String(input.titulo).slice(0, 150), contenido: String(input.contenido || '') });
    const slug = String(input.titulo).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 40) || 'informe';
    const archivo = slug + '_' + fecha + '.pdf';
    let proy = null; if (input.proyecto) { proy = await proyectoPor(input.proyecto); if (!proy) return { error: 'No encuentro el proyecto "' + input.proyecto + '". No he creado el PDF.' }; }
    const url = await uploadProjectDocument(buf, archivo, 'application/pdf', proy ? proy.id : '_asistente');
    if (proy) { const fila = { project_id: proy.id, url, name: String(input.titulo).slice(0, 150) }; let { error } = await supabase.from('project_documents').insert({ ...fila, doc_type: 'informe' }); if (error) await supabase.from('project_documents').insert({ ...fila, doc_type: 'otro' }); }
    (ctx.salida = ctx.salida || []).push({ url, nombre: archivo });
    return { creado: true, nota: 'El PDF se envía a Víctor como archivo adjunto en tu respuesta; no pegues el enlace.' };
  }
  if (nombre === 'generar_render' || nombre === 'editar_foto' || nombre === 'generar_imagen') {
    const esTexto = nombre === 'generar_imagen';
    let a = null;
    if (!esTexto) { a = (ctx.adjuntos || []).find(x => x.id === input.adjunto); if (!a || !/^image\/(jpeg|png|webp)$/.test(a.mime)) return { error: 'Necesito una foto (jpg, png o webp) adjunta.' }; }
    let proy = null; if (input.proyecto) { proy = await proyectoPor(input.proyecto); if (!proy) return { error: 'No encuentro el proyecto "' + input.proyecto + '". Dime cuál es o lo guardo sin proyecto.' }; }
    const n = esTexto ? Math.min(3, Math.max(1, (Array.isArray(input.prompts) ? input.prompts.filter(Boolean).length : 0) || Math.round(Number(input.variantes)) || 1)) : 1;
    if (ctx.avisar) await ctx.avisar(esTexto ? 'Voy con ' + (n > 1 ? 'las ' + n + ' ideas' : 'la idea') + ', tarda un minuto…' : nombre === 'editar_foto' ? 'Editando la foto, un momento…' : 'Voy con el render, tarda un minuto…');
    const prompts = esTexto ? (Array.isArray(input.prompts) && input.prompts.length ? input.prompts : [input.prompt]).map(x => String(x || '').trim()).filter(Boolean).slice(0, 3) : [];
    const hechas = await Promise.allSettled(Array.from({ length: n }, (_, i) => esTexto ? imagenDesdeTexto({ prompt: prompts[i] || prompts[0], estilo: input.estilo }) : nombre === 'editar_foto' ? editarFoto({ buffer: a.buffer, mime: a.mime, instruccion: input.instruccion }) : renderDesdeFoto({ buffer: a.buffer, mime: a.mime, instrucciones: input.instrucciones, estilo: input.estilo })));
    const pngs = hechas.filter(h => h.status === 'fulfilled').map(h => h.value);
    if (!pngs.length) return { error: 'No he podido generar la imagen: ' + (hechas[0].reason?.message || 'error desconocido') };
    const titulo = esTexto ? String(input.prompt).slice(0, 90) : nombre === 'editar_foto' ? String(input.instruccion).slice(0, 90) : 'Render desde móvil';
    let donde = '';
    for (let i = 0; i < pngs.length; i++) {
      const png = pngs[i]; let url;
      if (proy) {
        url = await uploadProjectRender(png, 'imagen.png', 'image/png', proy.id);
        const { data: mx } = await supabase.from('project_renders').select('display_order').eq('project_id', proy.id).order('display_order', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
        const { error } = await supabase.from('project_renders').insert({ project_id: proy.id, url, name: (esTexto ? 'Idea IA ' : nombre === 'editar_foto' ? 'Foto editada ' : 'Render desde móvil ') + fecha.split('-').reverse().join('/') + (pngs.length > 1 ? ' · ' + (i + 1) : ''), version: null, display_order: (mx?.display_order ?? -1) + 1 });
        if (error) return { error: 'La imagen está hecha pero no se pudo guardar en el proyecto: ' + error.message };
        donde = 'Renders de ' + (proy.project_name || proy.client_name) + ' (CRM)';
      } else {
        url = await uploadReferenceImage(png, 'ia.png', 'image/png');
        const { error } = await supabase.from('inspiration_references').insert({ title: titulo, description: (esTexto ? input.prompt : nombre === 'editar_foto' ? 'Edición: ' + input.instruccion : input.instrucciones || 'Render de una foto') + (pngs.length > 1 ? ' (variante ' + (i + 1) + ')' : ''), category: esTexto ? 'IA · inspiración' : 'IA · ' + (nombre === 'editar_foto' ? 'edición' : 'render'), image_url: url });
        if (error) return { error: 'La imagen está hecha pero no se pudo guardar en Referencias: ' + error.message };
        donde = 'Referencias (CRM), categoría IA';
      }
      (ctx.salida = ctx.salida || []).push({ url, nombre: 'imagen.png', tipo: 'imagen' });
    }
    return { creadas: pngs.length, de_las_pedidas: n, guardado_en: donde, nota: 'Las imágenes se envían a Víctor junto a tu respuesta; no pegues enlaces. Cuéntale en una o dos frases qué propones y por qué.' };
  }
  if (nombre === 'hablar_con_agente') {
    const ag = input.agente, mensaje = String(input.mensaje || '').trim(); if (!mensaje) return { error: 'Falta el mensaje.' };
    let proy = null; if (ag === 'diseno') { proy = await proyectoPor(input.proyecto); if (!proy) return { error: 'Para los alzados necesito el proyecto. ¿De cuál es?' }; }
    const est = await leerJson(RUTA_AG, {}), clave = ag === 'diseno' ? 'diseno:' + proy.id : ag;
    const conv = input.nueva || !est[clave] ? { messages: [] } : est[clave];
    conv.messages.push({ role: 'user', content: mensaje });
    if (ctx.avisar) await ctx.avisar('Un momento, se lo paso al asistente de ' + ag + '…');
    const cab = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + internalAdminToken() };
    const llama = async (ruta, cuerpo) => { const r = await fetch(BASE_INTERNA + ruta, { method: 'POST', headers: cab, body: JSON.stringify(cuerpo) }); const j = await r.json().catch(() => ({})); if (!r.ok && r.status !== 202) throw new Error(j.error || ('error ' + r.status)); return { j, status: r.status }; };
    let reply = '', extra = {};
    if (ag === 'presupuestos') { const { j } = await llama('/api/ai-budget/chat', { messages: conv.messages.slice(-24) }); reply = j.reply; if (!j.budget_created) extra.AVISO_IMPORTANTE = 'En esta respuesta el compañero NO ha creado ningún presupuesto ni PDF (solo habló o tocó el catálogo). NO le digas a Víctor que el presupuesto está listo. Si quiere uno NUEVO, vuelve a pedírselo al compañero con instrucciones explícitas (crear presupuesto nuevo con nombre, productos, cantidades y precios, y generar el PDF). Si quiere el PDF de uno que ya existe, usa presupuesto_pdf.'; if (j.budget_created) { extra.presupuesto_creado = { numero: j.budget_created.budget_number }; if (j.budget_created.pdf_url) (ctx.salida = ctx.salida || []).push({ url: j.budget_created.pdf_url, nombre: 'Presupuesto_' + (j.budget_created.budget_number || '') + '.pdf' }); } }
    else if (ag === 'setter') { const { j } = await llama('/api/ai-setter/chat', { messages: conv.messages.slice(-24) }); reply = j.reply; if (j.lead) extra.lead = j.lead?.nombre || true; }
    else if (ag === 'diseno') { const { j } = await llama('/api/asistente-diseno/chat', { messages: conv.messages.slice(-24), proyectoId: proy.id, laminaId: conv.laminaId, spec: conv.spec }); reply = j.reply; conv.spec = j.spec || conv.spec; if (j.guardado) { conv.laminaId = j.guardado.laminaId; extra.guardado_en = 'Asistente de diseño del proyecto ' + (proy.project_name || proy.client_name) + ' (CRM)'; } if (j.avisos?.length) extra.avisos = j.avisos; if (j.spec?.pared) { try { const png = alzadoPNG(j.spec, { fecha: new Date().toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid' }) }); const url = await uploadProjectDocument(png, 'alzado_' + fecha + '_' + Date.now().toString(36) + '.png', 'image/png', proy.id); (ctx.salida = ctx.salida || []).push({ url, nombre: 'alzado.png', tipo: 'imagen' }); extra.imagen = 'El alzado se envía a Víctor como imagen junto a tu respuesta.'; } catch (e) { extra.imagen_error = e.message; } } }
    else if (ag === 'finanzas') {
      const { j } = await llama('/api/ai-finanzas/chat', { messages: conv.messages.slice(-24) }); const t0 = Date.now(); let r = { estado: 'trabajando' };
      while (r.estado === 'trabajando' && Date.now() - t0 < 150000) { await new Promise(ok => setTimeout(ok, 3000)); const rr = await fetch(BASE_INTERNA + '/api/ai-finanzas/chat/' + j.jobId, { headers: cab }); r = await rr.json().catch(() => ({ estado: 'error', error: 'sin respuesta' })); }
      if (r.estado !== 'listo') return { error: r.error || 'El asistente de finanzas tarda demasiado; revisa Finanzas en el CRM.' }; reply = r.reply; if (r.creados?.length) extra.creados = r.creados;
    }
    conv.messages.push({ role: 'assistant', content: String(reply || '').slice(0, 4000) }); conv.messages = conv.messages.slice(-30); est[clave] = conv; await guardarJson(RUTA_AG, est);
    return { respuesta_del_agente: reply, ...extra };
  }
  if (nombre === 'llamadas_fathom') {
    const clave = (process.env.FATHOM_API_KEY || '').trim(); if (!clave) return { error: 'Fathom todavía no está conectado: falta la clave FATHOM_API_KEY en Railway.' };
    const dias = Math.min(90, Math.max(1, Math.round(Number(input.dias)) || 14)), desde = new Date(Date.now() - dias * 86400000).toISOString();
    const url = 'https://api.fathom.ai/external/v1/meetings?include_summary=true&created_after=' + encodeURIComponent(desde) + (input.con_transcripcion ? '&include_transcript=true' : '');
    const r = await fetch(url, { headers: { 'X-Api-Key': clave } });
    if (!r.ok) return { error: 'Fathom ha respondido con error ' + r.status + (r.status === 401 ? ' (la clave no es válida)' : '') + '.' };
    const j = await r.json().catch(() => ({})); let lista = j.items || j.meetings || j.data || [];
    const b = limpia(input.busqueda).toLowerCase();
    const nombresDe = m => (m.calendar_invitees || m.participants || []).map(p => (p.name || p.display_name || p.email || '')).filter(Boolean);
    if (b) lista = lista.filter(m => (String(m.title || m.meeting_title || '') + ' ' + nombresDe(m).join(' ')).toLowerCase().includes(b));
    const resumenDe = m => { const d = m.default_summary || m.summary; return String(typeof d === 'string' ? d : (d?.markdown_formatted || d?.text || '')).slice(0, 1800); };
    const fila = m => ({ titulo: m.title || m.meeting_title || 'Reunión', fecha: String(m.recording_start_time || m.created_at || '').slice(0, 16).replace('T', ' '), participantes: nombresDe(m).slice(0, 8), enlace: m.share_url || m.url || null, resumen: resumenDe(m) });
    const salida = lista.slice(0, 8).map(fila);
    if (input.con_transcripcion && lista.length === 1 && Array.isArray(lista[0].transcript)) salida[0].transcripcion = lista[0].transcript.map(t => (t.speaker?.display_name || t.speaker || '') + ': ' + (t.text || '')).join('\n').slice(0, 9000);
    return { reuniones: salida, total: lista.length };
  }
  if (nombre === 'ver_referencias') {
    let q = supabase.from('inspiration_references').select('title, description, category, image_url, created_at').order('created_at', { ascending: false }).limit(Math.min(8, Math.max(1, Math.round(Number(input.cantidad)) || 6)));
    const b = limpia(input.busqueda); if (b) q = q.or('title.ilike.%' + b + '%,description.ilike.%' + b + '%,category.ilike.%' + b + '%');
    const { data, error } = await q; if (error) return { error: 'No se pudieron leer las referencias.' };
    return { total: (data || []).length, referencias: (data || []).map(r => ({ titulo: r.title, nota: r.description, categoria: r.category, fecha: (r.created_at || '').slice(0, 10) })), __imagenes: (data || []).filter(r => r.image_url).slice(0, 4).map(r => r.image_url) };
  }
  if (nombre === 'analizar_proyectos_vendidos') {
    const { data: vs } = await supabase.from('ventas').select('nombre, valor, client_project_id').eq('cerrada', true).not('client_project_id', 'is', null).limit(Math.min(40, Math.max(3, Math.round(Number(input.limite)) || 25)));
    const ids = [...new Set((vs || []).map(v => v.client_project_id))]; if (!ids.length) return { vendidos: 0, nota: 'No hay ventas cerradas ligadas a un proyecto.' };
    const [{ data: ps }, { data: fs }, { data: eq }, { data: ma }] = await Promise.all([
      supabase.from('client_projects').select('id, project_name, client_name, tipo_proyecto, phase').in('id', ids),
      supabase.from('project_needs_forms').select('project_id, brief, client_summary').in('project_id', ids),
      supabase.from('project_equipment_selections').select('project_id, name, brand, quantity').in('project_id', ids).limit(600),
      supabase.from('project_material_selections').select('project_id, name, location').in('project_id', ids).limit(600),
    ]);
    const por = (arr, k) => { const m = {}; (arr || []).forEach(x => { (m[x[k]] = m[x[k]] || []).push(x); }); return m; };
    const F = por(fs, 'project_id'), E = por(eq, 'project_id'), M = por(ma, 'project_id'), V = por(vs, 'client_project_id');
    return { vendidos: (ps || []).length, proyectos: (ps || []).map(p => ({ proyecto: p.project_name, cliente: p.client_name, tipo: p.tipo_proyecto, importe: (V[p.id] || []).reduce((a, v) => a + (Number(v.valor) || 0), 0), resumen_cliente: String(F[p.id]?.[0]?.client_summary || F[p.id]?.[0]?.brief || '').slice(0, 500), equipos: (E[p.id] || []).slice(0, 12).map(x => (x.brand ? x.brand + ' ' : '') + x.name + (x.quantity > 1 ? ' x' + x.quantity : '')), materiales: (M[p.id] || []).slice(0, 12).map(x => x.name + (x.location ? ' (' + x.location + ')' : '')) })) };
  }
  if (nombre === 'recordar') {
    const texto = String(input.texto || '').trim().slice(0, 600); if (!texto) return { error: 'Nada que recordar.' };
    const ruta = input.privado ? RUTA_PRIV : RUTA_MEM, mem = await leerJson(ruta, { hechos: [] });
    const yaEsta = mem.hechos.find(h => seParecen(texto, h.texto) && palabras(texto).size >= 4 && (() => { const A = palabras(texto), B = palabras(h.texto); let c = 0; A.forEach(w => { if (B.has(w)) c++; }); return c / Math.max(A.size, B.size) >= 0.7; })());
    if (yaEsta) return { guardado: false, ya_estaba: true, id: yaEsta.id, nota: 'Ya tenías recordado algo casi igual; no lo he duplicado.' };
    const hecho = { id: crypto.randomUUID().slice(0, 6), texto, etiqueta: String(input.etiqueta || '').slice(0, 30) || null, fecha };
    mem.hechos.push(hecho); if (mem.hechos.length > 400) mem.hechos = mem.hechos.slice(-400);
    await guardarJson(ruta, mem);
    return { guardado: true, id: hecho.id, privado: !!input.privado };
  }
  if (nombre === 'borrar_conversacion') { ctx.borrarCharla = true; return { ok: true, nota: 'Historial borrado. La memoria se mantiene.' }; }
  if (nombre === 'vaciar_memoria') {
    const a = input.ambito; if (!['trabajo', 'privada', 'todo'].includes(a)) return { error: 'Ámbito no válido.' };
    await guardarJson('crm/asistente/memoria-respaldo.json', { fecha: new Date().toISOString(), trabajo: await leerJson(RUTA_MEM, { hechos: [] }), privada: await leerJson(RUTA_PRIV, { hechos: [] }) }); // copia de seguridad antes de borrar
    if (a !== 'privada') await guardarJson(RUTA_MEM, { hechos: [] });
    if (a !== 'trabajo') await guardarJson(RUTA_PRIV, { hechos: [] });
    return { vaciada: a, nota: 'Queda una copia de seguridad: si Víctor se arrepiente, usa restaurar_memoria.' };
  }
  if (nombre === 'restaurar_memoria') {
    const r = await leerJson('crm/asistente/memoria-respaldo.json', null); if (!r) return { error: 'No hay ninguna copia de seguridad.' };
    await guardarJson(RUTA_MEM, r.trabajo || { hechos: [] }); await guardarJson(RUTA_PRIV, r.privada || { hechos: [] });
    return { restaurada: true, copia_del: r.fecha, recuerdos_de_trabajo: (r.trabajo?.hechos || []).length, recuerdos_personales: (r.privada?.hechos || []).length };
  }
  if (nombre === 'marcar_conversacion_privada') { ctx.privado = true; return { ok: true, nota: 'Esta conversación no se verá en el CRM.' }; }
  if (nombre === 'olvidar') {
    for (const ruta of [RUTA_MEM, RUTA_PRIV]) {
      const mem = await leerJson(ruta, { hechos: [] }); const antes = mem.hechos.length;
      mem.hechos = mem.hechos.filter(h => h.id !== String(input.id || '')); if (mem.hechos.length < antes) { await guardarJson(ruta, mem); return { olvidado: true }; }
    }
    return { error: 'No encuentro ese recuerdo.' };
  }
  return { error: 'Herramienta desconocida.' };
}

function sistema(mem, priv, acc, resumenCharla) {
  const { fecha, hora, dia } = madrid();
  const hechos = (mem.hechos || []).slice(-120).map(h => '- [' + h.id + '] ' + (h.etiqueta ? '(' + h.etiqueta + ') ' : '') + h.texto + ' (' + h.fecha + ')').join('\n') || '(todavía no hay recuerdos guardados)';
  return 'Eres el asistente personal de Víctor Palomo, fundador de Ranuse Design (diseño de espacios deportivos y gimnasios). Hablas con él por mensajería, desde el móvil. AHORA MISMO es ' + ahoraLargo() + ' (' + dia + ' ' + fecha + ', ' + hora + '). Este es TU RELOJ: es la fecha y la hora reales, en Madrid, España. Nunca preguntes qué día es ni te bases en otra fecha.\n' +
    'FECHAS EN LA CONVERSACIÓN: los mensajes antiguos de Víctor llevan entre corchetes cuándo los escribió (ej. [lun 9 nov, 18:32]). Cuando dijera «hoy», «mañana» o «el viernes», se refería a ESA fecha, no a la de ahora: traduce siempre con el calendario de abajo.\n' +
    'CALENDARIO (úsalo tal cual para resolver "mañana", "el viernes", "el lunes que viene"; NUNCA calcules de cabeza el día de la semana):\n' + calendario() + '\n' +
    '- Español, tono cercano y directo, como un compañero de confianza. Sin markdown (solo *negrita* con un asterisco si hace falta). Víctor no es técnico: sin jerga.\n' +
    '- BREVEDAD, REGLA DURA: Víctor NO lee mensajes largos. Responde en 1 a 4 líneas (unas 50 palabras) por defecto. Primero la respuesta o la acción hecha, sin saludos ni rodeos ni resúmenes de lo que acabas de hacer. Listas de 5 elementos como máximo y cada uno en una línea. Si hay mucho que contar, da lo esencial y pregunta "¿quieres el detalle?", o ofrécelo en PDF con crear_pdf. Haz como máximo UNA pregunta por mensaje. Si pide explícitamente algo largo (informe, guion, análisis), entonces sí, pero en PDF o en trozos que se lean en 20 segundos.\n' +
    '- Tienes MEMORIA permanente: usa la herramienta recordar cuando te cuente algo que convenga tener presente, sin que te lo pida, y confírmalo en pocas palabras. Nunca digas que no puedes recordar.\n' +
    '- Tienes acceso al CRM: agenda, tareas, eventos y proyectos. No inventes datos: consúltalos con las herramientas. Si crear algo es ambiguo (qué proyecto, qué día), pregunta lo mínimo.\n' +
    '- DIARIO Y APRENDIZAJE: cuando Víctor te cuente lo que ha hecho (o contestes a tu pregunta de "¿qué has hecho hoy?"), apúntalo con apuntar_diario, marca como hechas las tareas que correspondan (listar_tareas + completar_tarea; si dudas de cuál es, pregunta), crea las tareas que falten y aprende: guarda con recordar los patrones útiles de cómo trabaja (cuánto tarda de verdad en cada cosa, qué se le atasca, procesos que repite, decisiones de diseño y su porqué). Responde con 1-2 líneas y, si ves algo útil (un retraso, algo que se repite), dilo.\n' +
    '- ERES UN EXPERTO, NO UN SECRETARIO. Víctor apunta tareas grandes ("diseño de Josema") y a veces no sabe desglosarlas: ayúdale a partir el trabajo en pasos concretos y ordenados. Primero reúne el contexto (contexto_proyecto y plantillas_fase), luego propón un desglose de hasta 8 pasos, una línea cada uno, con verbo, orden lógico, qué depende de qué y una estimación de horas; señala qué información falta pedirle al cliente. Termina preguntando si lo creas como tareas (crear_subtareas, solo con su sí). Piensa como un diseñador senior de espacios deportivos: circulaciones y distancias de seguridad entre máquinas, cargas y puntos eléctricos, suelos y acústica, ventilación y climatización, normativa, plazos de proveedores y obra, presupuesto. Da tu criterio y opinión con franqueza.\n' +
    '- Así trabaja Ranuse por fases: 0 Diseño previo (servicio de pago: renders y tour 3D; si el cliente sigue, continúa en la fase 1), 1 Arquitectura (planos: estado actual, cotas, demoliciones, distribución, implantación; docs A.01-A.04), 2 Instalaciones (IE.01 eléctrica, IE.02 climatización y fontanería si hace falta; C.01/F.01 de terceros), 3 Interiorismo y materialidad (I.01-I.03, renders R.01, tour virtual TV.01), 4 Maquinaria y equipamiento (M.02-M.03), 5 Documentación de apoyo (D.02, D.04).\n' +
    '- NO TE OLVIDES DE LO QUE TE DICE: antes de contestar que algo no lo tienes apuntado o que no te lo ha dicho, repasa la conversación, lo que has hecho tú últimamente (más abajo), las tareas (listar_tareas) y el calendario (listar_eventos). Si Víctor dice que ya te lo dijo, créele: normalmente es verdad. Nunca le hagas repetir algo que ya está apuntado. Una cita o quedada con hora va al calendario (crear_evento); una cosa por hacer, a tareas.\n' +
    '- PLANOS: si Víctor te manda el PDF o plano de un cliente y quiere empezarlo, usa crear_plano (estado actual en la herramienta Planos, como borrador). Si el PDF tiene varias láminas, pregúntale cuál es la planta; si no hay cotas, pídele lo que mide el muro más largo. Avísale siempre de que es un borrador que debe revisar (escala, puertas, pilares) y de que el modelo 3D se genera al abrirlo en Planos.\n' +
    '- ALZADOS: cuando el compañero de diseño crea o cambia un alzado, la imagen se le manda sola a Víctor; para ver uno ya guardado usa enviar_alzado. Nunca digas que no puedes mandar alzados.\n' +
    '- PRESUPUESTOS (preferente): para ver, completar o crear un presupuesto usa TÚ las herramientas ver_presupuesto y anadir_lineas_presupuesto (valen para uno ya empezado, por número o proyecto, o para uno nuevo; mezclan productos del catálogo y líneas libres que no están en el catálogo, con precio 0 si no hay) y manda siempre el PDF. Si Víctor te pasa una lista de equipos, conviértela en líneas con cantidades; lo que no esté en el catálogo va como línea libre, no lo descartes. El compañero de presupuestos solo sirve para recomendaciones por niveles y ese tipo de análisis. Para crear uno NUEVO con el compañero, pásale al compañero de presupuestos instrucciones explícitas ("crea un presupuesto nuevo para el proyecto X con estos productos, cantidades y precios, y genera el PDF"); él solo crea presupuestos nuevos, no edita los que ya existen. Para mandar el PDF de uno existente usa presupuesto_pdf. Nunca digas que el presupuesto está listo si no te ha devuelto un PDF o un número de presupuesto: cuenta con franqueza qué se hizo y qué falta.\n' +
    '- PRESUPUESTOS (seguridad): nunca inventes ni copies un número de presupuesto; si Víctor no lo dice, búscalo con buscar_presupuestos por cliente o nombre. Cada vez que mandes un PDF di en una frase: número, nombre, nº de líneas, total y los avisos de la ficha (líneas a 0 €, descuento global…). Si Víctor pide cambios, aplícalos y manda un PDF NUEVO; nunca reenvíes uno anterior. Si no lo encuentras o hay varios, pregunta cuál en vez de adivinar. Un presupuesto NUEVO solo si Víctor lo pide expresamente (crear_nuevo=true).\n' +
    '- NOMBRES: Víctor llama a clientes y proyectos de formas distintas (apodo, ciudad, apellido). Si una herramienta devuelve candidatos o dice que hay varios, pregúntale cuál (nombra las opciones) y cuando lo confirme guarda el apodo con guardar_alias. No asumas.\n' +
    '- CONTENIDO A PARTIR DE SU VIDA: cuando Víctor te cuente un proyecto, obra, viaje o evento (o pida «qué vídeos puedo sacar de esto» o «formatos para grabar yo solo»), usa sacar_contenido: propones piezas concretas con qué grabar y cuándo, y siempre un formato repetible que pueda grabar solo. Si menciona en la agenda un viaje o evento, aprovecha para sugerirle qué grabar mientras ocurre.' +
    '- INSTAGRAM, HISTORIAS Y SU VOZ: además de asistente eres su ESTRATEGA DE INSTAGRAM. Cuando pida historias, una secuencia, qué subir hoy o mañana, o cómo vender algo por Instagram, usa crear_secuencia_historias (objetivo vender, engagement, autoridad, bastidores o lanzamiento): construye la secuencia con lo que de verdad hace (agenda, obras, proyectos, diario) y con SU voz. Respóndele con el GUION COMPLETO de cada historia en el mismo mensaje, sin preguntarle si lo quiere (él ya quiere guiones exactos): cómo grabarla, texto en pantalla, lo que dice palabra por palabra con su voz y la pegatina; el PDF solo si lo pide. Anticípate: si ves en su agenda algo contable (visita a obra, reunión con cliente, entrega, render, instalación), propónle sin que lo pida qué historias sacar ese día («mañana tienes X: 1) foto de…, 2) vídeo de…»). En el repaso de la mañana cierra con 2-3 ideas de historias para hoy si hay material. ESTRATEGA DEL DÍA: cuando pregunte «qué subo hoy» (o «qué publico»), usa SIEMPRE que_subo_hoy: decide el tipo de día mirando lo que ha subido estos días, su agenda, su banco de ideas y su vida personal, sin repetirse; no vendas directo por historias (su estrategia es conectar y que le escriban o le pidan una herramienta) y, si ves hueco, sugiérele una herramienta que crear para captar contactos. Guarda TODA idea de historia que te cuente, también de su vida personal (guardar_idea_historia), para recuperarla en el momento oportuno («hace tres semanas me dijiste…»), y apunta lo que sube (registrar_historia_publicada). Aprende cómo habla: cuando notes una frase o un rasgo suyo representativo, o cuando corrija un guion, guárdalo con guardar_mi_voz. Escribe siempre en primera persona como habla él, nunca con tono de marketing genérico, y no inventes resultados, clientes ni cifras. Pasado un día, pregúntale cómo le fue la secuencia (respuestas, mensajes, qué historia se cayó) y apúntalo con resultado_historias: así aprendes qué funciona con su audiencia.\n' +
    '- Puedes crear proyectos nuevos con crear_proyecto (nombre, cliente y tipo comercial u home_gym; deduce lo que puedas y no preguntes más de lo imprescindible). Nunca digas que no puedes crear proyectos.\n' +
    '- UNA COSA, UNA TAREA (REGLA DURA): Víctor nombra las tareas de memoria, con otras palabras, apodos o abreviado. Abajo tienes TAREAS PENDIENTES con su id corto. Antes de crear NADA, comprueba esa lista (y buscar_tarea si dudas): si lo que dice es el mismo asunto aunque lo diga distinto («mandar presu a Adil» = «Presupuesto Adil Gym»), es LA MISMA tarea: actualízala o complétala, no hagas otra. Para tocar una tarea usa el id corto de la lista o su nombre aproximado. Si dudas entre dos, pregunta «¿te refieres a «título exacto»?» con una pregunta corta. Nunca le exijas el nombre tal cual.\n' +
    '- AVÍSALE DE LO YA APUNTADO: cuando Víctor te diga que tiene que hacer algo, antes de crear nada mira si ya hay algo relacionado (listar_tareas) y, si lo hay, recuérdaselo: "ya tenías apuntado X para el día Y, ¿lo cambio o lo sumo?". Si una herramienta te devuelve posible_duplicado, no insistas en crearlo: cuéntale lo que ya había y pregúntale.\n' +
    '- TAREAS Y ORGANIZACIÓN: cuando pida sus tareas, lo pendiente o ayuda para organizarse, usa listar_tareas y dale TODAS, no un resumen: agrupadas (atrasadas, hoy, próximas, sin fecha), una línea por tarea con su proyecto; si son más de 15, agrúpalas por proyecto con el número y ofrécele el listado completo en PDF. Después, SIEMPRE, propón su plan: las 3 prioridades de hoy en orden ("1. … 2. … 3. …") justificadas en una frase cada una (plazos, urgencia del proyecto, lo que desbloquea a otros) y pregunta si le pones fecha de hoy a esas tareas; si dice que sí, usa actualizar_tarea. Ve guiándole: cuando termine algo, ofrécele lo siguiente.\n' +
    '- Cuando Víctor salude por la mañana o pregunte por su día, llama a agenda_de_hoy y dáselo ordenado: primero lo atrasado y urgente, luego lo de hoy, y los eventos con hora. Termina con una sugerencia breve de por dónde empezar.\n' +
    '- Fotos y documentos: cuando Víctor te mande uno, míralo y descríbelo en una frase. Si dice o se deduce dónde va (proyecto y si es del programa de necesidades, de una obra, un documento o una referencia de inspiración), guárdalo con guardar_adjunto y dile dónde lo has dejado. Si no está claro, pregunta una sola cosa. Reuniones, transcripciones y visitas a obra: guárdalas con guardar_nota_proyecto y crea las tareas que se desprendan.\n' +
    '- Llamadas y reuniones grabadas con Fathom (llamadas_fathom): cuando Víctor mencione una reunión, dale lo esencial (acuerdos, medidas, próximos pasos). Si dice dónde va o se deduce el proyecto, guárdala con guardar_nota_proyecto y crea las tareas que salgan; si no, pregunta el proyecto.\n' +
    '- Informes y PDFs: cuando te pida un reporte, resumen o documento, reúne los datos con las herramientas (consultar_crm, ver_proyecto…) y genera el PDF con crear_pdf. Redes y contenido: ayúdale con ideas, guiones y textos con la voz de Ranuse (cercana, profesional, de diseñador de espacios deportivos), usando lo que recuerdas de sus proyectos y gustos.\n' +
    '- Aprender de su gusto y de lo que vende: antes de proponer ideas, mira sus referencias (ver_referencias) y lo que recuerdas; cuando te mande una foto que claramente le gusta o es una referencia, además de guardarla apunta con recordar el rasgo de gusto (material, paleta, tipología, qué le atrae) en una frase. Si te pide aprender de los proyectos vendidos, usa analizar_proyectos_vendidos, saca los patrones útiles y guárdalos con recordar (uno por patrón, concretos y con datos).\n' +
    '- APRENDE: cada vez que Víctor te corrija, te cuente una preferencia, una forma de trabajar, datos de un cliente o una decisión, guárdalo con recordar sin que te lo pida. Antes de dar consejo, tira de lo que recuerdas.\n' +
    '- Compañeros del CRM (hablar_con_agente): presupuestos (crear presupuestos), setter (leads), finanzas y diseno (alzados). Si Víctor pide un presupuesto, un alzado, mirar un lead o algo de finanzas, pásaselo al compañero adecuado con todos los datos que te dé. Con una foto adjunta: generar_render (convertirla en render) o editar_foto (cambiarle algo concreto); ninguna exige proyecto. Cuando pida inspiración o ideas sin foto ni proyecto, usa generar_imagen (1 a 3 variantes) y acompáñalas de una explicación breve: piensa como un diseñador top pero viable, evita lo típico y sorpréndele.\n' +
    '- También puedes crear proveedores, buscarlos y programar recordatorios que te llegan a esta misma conversación. Puedes ser su consultor: cuando solo quiera pensar en voz alta o comparar opciones, da tu opinión con criterio y sin rodeos.\n\n' +
    '- HAZ SOLO LO QUE PIDE EL ÚLTIMO MENSAJE. Si pide las tareas, la agenda o una consulta, responde eso y NO generes imágenes ni retomes peticiones anteriores. Genera imágenes únicamente cuando lo pida de forma explícita en ese mensaje.\n' +
    '- ENTIENDE LO QUE PIDE: no sigas fórmulas. Lee su petición, su contexto y lo que recuerdas de él, y decide tú qué proponer. Cuando diga que algo no le convence, guárdalo con recordar y cámbialo de verdad; a veces lo repetido está bien y otras quiere cambiar, y eso lo deduces de lo que dice. Si pide varias ideas, que sean distintas entre sí por tu criterio, no por un turno de materiales.\n' +
    '- Por lo general a Víctor le gusta el diseño atrevido pero ejecutable (le parecen mal las superficies curvas o las piezas a medida complejas que encarecen la obra). Tenlo presente como criterio, no como regla: si pide algo conceptual o de otro tipo, hazle caso. Al presentar ideas, di en una línea cómo se ejecuta y si el coste es bajo, medio o alto.\n' +
    '- BREVEDAD: Víctor no lee mensajes largos. Por defecto, máximo 300 caracteres (3-4 líneas). Nada de introducciones ni cierres de cortesía. Ideas o listas: máximo 3 puntos de una línea cada uno, y pregunta si quiere más.\n' +
    '- OLVIDAR: tu memoria vive en el servidor, no en el chat de WhatsApp: si Víctor borra la conversación en su móvil, sigues recordando. Si quiere que olvides algo concreto, usa olvidar (tienes los ids); si quiere empezar de cero la conversación, borrar_conversacion; si quiere borrar toda la memoria, pregúntale si está seguro y solo con su sí explícito usa vaciar_memoria (deja una copia: si se arrepiente, restaurar_memoria). Para borrar varias cosas concretas, usa olvidar una vez por cada una. Si te pregunta qué sabes de él, díselo con franqueza, incluido lo privado (solo habla contigo él).\n' +
    '- LO PERSONAL ES PRIVADO: si Víctor te habla de cosas personales (familia, salud, ánimo, dinero, relaciones, dudas vitales), ayúdale como un amigo con criterio y cercanía, llama a marcar_conversacion_privada, guarda lo importante con recordar y privado=true, y NUNCA lo conviertas en tareas, eventos, notas de proyecto ni nada que se vea en el CRM salvo que él te lo pida expresamente. Nunca menciones lo personal en resúmenes del día ni en informes.\n\n' +
    'Lo que recuerdas del trabajo:\n' + hechos +
    '\n\nRecuerdos PERSONALES de Víctor (privados; úsalos para ayudarle pero no los muestres ni los saques si no viene a cuento):\n' + ((priv.hechos || []).slice(-60).map(h => '- [' + h.id + '] ' + h.texto).join('\n') || '(ninguno)') +
    (resumenCharla ? '\n\nRESUMEN de lo que habéis hablado antes (más antiguo que los mensajes que ves; úsalo como memoria de la conversación):\n' + resumenCharla : '') +
    '\n\nLO QUE HAS HECHO TÚ en el CRM últimamente (no lo olvides ni lo repitas; si Víctor dice que ya te lo dijo, créele y compruébalo aquí y en la conversación):\n' + (((acc && acc.l) || []).slice(-25).map(a => '- ' + a.t + ' · ' + a.x).join('\n') || '(nada todavía)');
}

// Las tareas pendientes, siempre a la vista del asistente (id corto · título · fecha · proyecto), para que reconozca de qué habla Víctor sin duplicar
async function bloqueTareasPendientes() {
  const { fecha } = madrid();
  const { data } = await supabase.from('tasks').select('id, title, due_date, project:client_projects(client_name, project_name)').eq('done', false).limit(500);
  const l = (data || []).slice().sort((a, b) => (a.due_date && b.due_date ? a.due_date.localeCompare(b.due_date) : a.due_date ? -1 : b.due_date ? 1 : 0));
  if (!l.length) return '\n\nTAREAS PENDIENTES: ninguna.';
  const fmt = x => '[' + x.id.slice(0, 8) + '] ' + String(x.title).slice(0, 90) + (x.due_date ? ' · ' + (x.due_date < fecha ? 'ATRASADA ' : '') + x.due_date : ' · sin fecha') + (x.project ? ' · ' + (x.project.project_name || x.project.client_name) : '');
  return '\n\nTAREAS PENDIENTES (' + l.length + ' en total; id corto · título · fecha · proyecto). Es lo que ya está apuntado: compara con esto antes de crear nada' + (l.length > 90 ? ' (aquí van las 90 más urgentes; usa buscar_tarea para el resto)' : '') + ':\n' + l.slice(0, 90).map(fmt).join('\n');
}

async function resumir(previo, mensajes) {
  const texto = mensajes.filter(m => !m.privado && typeof m.content === 'string').map(m => (m.role === 'user' ? 'Víctor: ' : 'Asistente: ') + m.content.slice(0, 1200)).join('\n');
  if (!texto.trim()) return previo || '';
  try {
    const out = await callClaude({ system: 'Mantienes un resumen breve y fiel de una conversación entre Víctor (fundador de un estudio de diseño de espacios deportivos) y su asistente. Fusiona el resumen anterior con los mensajes nuevos. Conserva SIEMPRE nombres propios, proyectos, fechas, citas, cifras, decisiones, compromisos y cosas pendientes; descarta saludos y charla sin contenido. Máximo 1800 caracteres, en español, en viñetas cortas. Devuelve solo el resumen.', messages: [{ role: 'user', content: 'RESUMEN ANTERIOR:\n' + (previo || '(vacío)') + '\n\nMENSAJES NUEVOS:\n' + texto }], maxTokens: 900 });
    const t = (out.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    return t ? t.slice(0, 2200) : previo || '';
  } catch { return previo || ''; }
}

// Frase corta de lo que se ha hecho de verdad en el CRM (para que no se pierda aunque la conversación se corte)
function resumenAccion(n, i, r) {
  if (!r || r.error || r.posible_duplicado) return null;
  const f = {
    crear_tarea: () => 'creada tarea "' + (r.titulo || i.titulo) + '"' + (r.fecha ? ' para el ' + r.fecha : '') + (r.proyecto ? ' (' + r.proyecto + ')' : ''),
    crear_evento: () => 'creado evento "' + (r.titulo || i.titulo) + '" el ' + (r.fecha || i.fecha) + (r.hora ? ' a las ' + String(r.hora).slice(0, 5) : ''),
    actualizar_tarea: () => 'actualizada tarea "' + (r.titulo || '') + '"' + (r.fecha ? ' → ' + r.fecha : ''),
    completar_tarea: () => 'marcada como hecha "' + (r.titulo || '') + '"',
    crear_subtareas: () => 'creadas ' + (r.creadas || []).length + ' tareas en ' + r.proyecto,
    recordatorio: () => 'programado aviso para ' + r.para + ': ' + String(i.texto || '').slice(0, 80),
    recordar: () => 'recordado' + (r.privado ? ' (privado)' : '') + ': ' + String(i.texto || '').slice(0, 90),
    apuntar_diario: () => 'apuntado en el diario: ' + String(i.resumen || '').slice(0, 90),
    guardar_nota_proyecto: () => 'guardada nota "' + String(i.titulo || '').slice(0, 60) + '" en ' + (r.donde || ''),
    guardar_adjunto: () => 'guardado un archivo en ' + (r.donde || ''),
    crear_proveedor: () => 'creado proveedor ' + (r.nombre || ''),
    anadir_lineas_presupuesto: () => 'presupuesto ' + (r.presupuesto || '') + ': añadidas ' + (r.lineas_anadidas || []).length + ' líneas' + (r.creado_nuevo ? ' (presupuesto nuevo)' : ''),
    crear_plano: () => 'creado plano "' + (r.donde || '') + '" (' + (r.muros || 0) + ' muros)',
    crear_secuencia_historias: () => 'preparada secuencia de historias "' + (r.titulo || '') + '"',
    guardar_mi_voz: () => 'aprendido un rasgo de cómo habla Víctor',
    resultado_historias: () => 'apuntado cómo le fue a una secuencia de historias',
    guardar_idea_historia: () => 'guardada una idea de historia: ' + String(i.texto || '').slice(0, 80),
    registrar_historia_publicada: () => 'apuntado lo que subió a Instagram: ' + String(i.resumen || '').slice(0, 80),
    guardar_estrategia_instagram: () => 'guardada una regla de su estrategia de Instagram',
    crear_proyecto: () => 'creado proyecto "' + (r.proyecto || '') + '" (cliente ' + (r.cliente || '') + ')',
  }[n];
  return f ? f() : null;
}

// Un resultado de herramienta puede traer imágenes (__imagenes: urls): se descargan y se le enseñan a Claude.
async function aContenido(r) {
  const { __imagenes, ...resto } = r || {}; const texto = JSON.stringify(resto).slice(0, 6000);
  if (!Array.isArray(__imagenes) || !__imagenes.length) return texto;
  const bloques = [{ type: 'text', text: texto }];
  for (const url of __imagenes.slice(0, 4)) {
    try { const res = await fetch(url); if (!res.ok) continue; const mime = (res.headers.get('content-type') || '').split(';')[0]; if (!/^image\/(jpeg|png|webp|gif)$/.test(mime)) continue; const buf = Buffer.from(await res.arrayBuffer()); if (buf.length > 4 * 1024 * 1024) continue; bloques.push({ type: 'image', source: { type: 'base64', media_type: mime, data: buf.toString('base64') } }); } catch { /* una imagen menos */ }
  }
  return bloques;
}

// Devuelve el texto de respuesta. chatId separa conversaciones (WhatsApp / Telegram).
export async function responderAsistente({ chatId, texto, adjuntos = [], avisar = null }) {
  const [mem, charla, priv, acc] = await Promise.all([leerJson(RUTA_MEM, { hechos: [] }), leerJson(RUTA_CHARLA, {}), leerJson(RUTA_PRIV, { hechos: [] }), leerJson(RUTA_ACC, { l: [] })]);
  if (!Array.isArray(acc.l)) acc.l = [];
  const previoCrudo = (charla[chatId] || []).slice(-40), previo = previoCrudo.map(m => ({ role: m.role, content: (m.role === 'user' && m.t && typeof m.content === 'string') ? '[' + marcaTiempo(m.t) + '] ' + m.content : m.content }));
  const ahoraMs = Date.now(), previos = (recientes.get(chatId) || []).filter(r => ahoraMs - r.t < 60 * 60 * 1000 && !adjuntos.find(a => a.id === r.id));
  const ctx = { adjuntos: [...adjuntos, ...previos], textoUsuario: texto, salida: [], avisar };
  const txtRecientes = previos.length ? '\n\nARCHIVOS que Víctor te mandó hace poco y SIGUES teniendo disponibles (puedes usarlos con sus herramientas, p. ej. guardar_adjunto, crear_plano, editar_foto): ' + previos.map(r => { let det = r.mime; if (r.mime === 'application/pdf') { try { det = 'PDF de ' + infoPdf(r.buffer).paginas + ' páginas'; } catch { det = 'PDF'; } } return r.id + ' (' + det + (r.nombre ? ', "' + r.nombre + '"' : '') + ', hace ' + Math.round((ahoraMs - r.t) / 60000) + ' min)'; }).join('; ') : '';
  const bloquesUsuario = adjuntos.length ? [
    ...adjuntos.filter(a => /^image\/(jpeg|png|webp|gif)$/.test(a.mime)).map(a => ({ type: 'image', source: { type: 'base64', media_type: a.mime, data: a.buffer.toString('base64') } })),
    ...adjuntos.filter(a => a.mime === 'application/pdf').map(a => { try { const inf = infoPdf(a.buffer); if (inf.paginas > 6) return { type: 'text', text: '[PDF largo de ' + inf.paginas + ' páginas (' + a.id + '). Páginas: ' + inf.lista.map(x => 'p' + x.n + ': ' + x.texto.slice(0, 70)).join(' | ') + ']' }; } catch { /* se manda tal cual */ } return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.buffer.toString('base64') } }; }),
    { type: 'text', text: texto + '\n\n[Adjuntos recibidos: ' + adjuntos.map(a => a.id + ' (' + a.mime + (a.nombre ? ', ' + a.nombre : '') + ')').join('; ') + ']' },
  ] : texto;
  const mensajes = [...previo, { role: 'user', content: bloquesUsuario }];
  const salud = (await bloqueSaludSistema().catch(() => '')) + (await bloqueTareasPendientes().catch(() => ''));
  let respuesta = '';
  for (let vuelta = 0; vuelta < 7; vuelta++) {
    const out = await callClaude({ system: sistema(mem, priv, acc, charla['_resumen:' + chatId]) + salud + txtRecientes, messages: mensajes, tools: TOOLS, maxTokens: 2500 });
    const bloques = out.content || [];
    const usos = bloques.filter(b => b.type === 'tool_use');
    if (out.stop_reason !== 'tool_use' || !usos.length) { respuesta = bloques.filter(b => b.type === 'text').map(b => b.text).join('\n').trim(); break; }
    mensajes.push({ role: 'assistant', content: bloques });
    const resultados = [];
    for (const u of usos) { let r; try { r = await ejecutar(u.name, u.input || {}, ctx); } catch (e) { r = { error: e.message }; } { const ac = resumenAccion(u.name, u.input || {}, r); if (ac) { const m = madrid(); acc.l.push({ t: m.fecha + ' ' + m.hora, x: ac }); } } resultados.push({ type: 'tool_result', tool_use_id: u.id, content: await aContenido(r) }); }
    mensajes.push({ role: 'user', content: resultados });
  }
  if (!respuesta) respuesta = 'Me he liado un poco con eso. ¿Me lo repites con otras palabras?';
  let nuevaCharla = ctx.borrarCharla ? [] : [...(charla[chatId] || []), { role: 'user', t: ahoraMs, content: texto + (adjuntos.length ? ' [adjuntó ' + adjuntos.length + ' archivo(s)]' : ''), ...(ctx.privado ? { privado: true } : {}) }, { role: 'assistant', t: Date.now(), content: respuesta, ...(ctx.privado ? { privado: true } : {}) }];
  if (ctx.borrarCharla) delete charla['_resumen:' + chatId];
  else if (nuevaCharla.length > 60) { const viejos = nuevaCharla.slice(0, nuevaCharla.length - 40); nuevaCharla = nuevaCharla.slice(-40); charla['_resumen:' + chatId] = await resumir(charla['_resumen:' + chatId], viejos); }
  charla[chatId] = nuevaCharla;
  try { acc.l = acc.l.slice(-60); await guardarJson(RUTA_ACC, acc); } catch { /* no crítico */ }
  try { await guardarJson(RUTA_CHARLA, charla); } catch (e) { console.error('Asistente: no se pudo guardar la conversación:', e.message); }
  recientes.set(chatId, [...previos, ...adjuntos.map(a => ({ ...a, t: ahoraMs }))].slice(-6));
  return { texto: respuesta, archivos: ctx.salida };
}
