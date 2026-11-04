import crypto from 'crypto';
import { supabase } from '../config/supabase.js';
import { callClaude } from './anthropic.js';
import { uploadDiagnosisImage, uploadProjectDocument, uploadReferenceImage, uploadProjectRender } from './storage.js';
import { renderDesdeFoto, imagenDesdeTexto, editarFoto } from './render-asistente.js';
import { internalAdminToken } from './internal-auth.js';
import { crearInformePdf } from './pdf-informe.js';

// Cerebro del asistente personal de Víctor (lo usan WhatsApp y Telegram).
// - Memoria que persiste (hechos que le pides recordar) y conversación reciente, guardadas en Storage (sin tocar la base de datos).
// - Herramientas sobre el CRM: agenda del día, proyectos, tareas y eventos.
// Nada de lo que ya existe se borra: solo lee, crea tareas/eventos, marca tareas hechas y apunta/olvida recuerdos.
const BUCKET = 'project-documents';
const RUTA_MEM = 'crm/asistente/memoria.json';
const RUTA_CHARLA = 'crm/asistente/charla.json';
export const RUTA_RECORD = 'crm/asistente/recordatorios.json';
export const RUTA_PRIV = 'crm/asistente/privado.json'; // recuerdos personales: NO se ven en el CRM
const RUTA_AG = 'crm/asistente/agentes.json';
const BASE_INTERNA = 'http://127.0.0.1:' + (process.env.PORT || 3001);
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
export async function leerJson(ruta, vacio) {
  await asegura().catch(() => {});
  let { data, error } = await supabase.storage.from(BUCKET_PRIV).download(ruta);
  if (error || !data) { const viejo = await supabase.storage.from(BUCKET).download(ruta); data = viejo.data; } // datos anteriores a pasarlo a privado
  if (!data) return vacio;
  try { return JSON.parse(await data.text()); } catch { return vacio; }
}
export async function guardarJson(ruta, obj) {
  await asegura();
  const { error } = await supabase.storage.from(BUCKET_PRIV).upload(ruta, Buffer.from(JSON.stringify(obj)), { contentType: 'application/json', upsert: true, cacheControl: '0' });
  if (error) throw new Error('No se pudo guardar: ' + error.message);
}

function madrid() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'long' }).formatToParts(new Date());
  const g = (t) => p.find(x => x.type === t)?.value;
  return { fecha: g('year') + '-' + g('month') + '-' + g('day'), hora: g('hour') + ':' + g('minute'), dia: g('weekday') };
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const limpia = (s) => String(s || '').replace(/[%,()]/g, ' ').trim();

async function proyectoPor(txt) {
  const t = limpia(txt); if (!t) return null;
  if (UUID.test(t)) { const { data } = await supabase.from('client_projects').select('id, client_name, project_name, phase, status, urgency').eq('id', t).maybeSingle(); return data; }
  for (const soloActivos of [true, false]) {
    let q = supabase.from('client_projects').select('id, client_name, project_name, phase, status, urgency').or('client_name.ilike.%' + t + '%,project_name.ilike.%' + t + '%').limit(5);
    if (soloActivos) q = q.eq('status', 'en_marcha').eq('active', true);
    const { data } = await q; if (data?.length) return data[0];
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
  { name: 'listar_proyectos', description: 'Proyectos en marcha (nombre, cliente, fase). Con "busqueda" filtra por nombre o cliente.', input_schema: { type: 'object', properties: { busqueda: { type: 'string' } } } },
  { name: 'ver_proyecto', description: 'Ficha de un proyecto: fase, urgencia y tareas pendientes. "proyecto" puede ser parte del nombre, del cliente o el id.', input_schema: { type: 'object', properties: { proyecto: { type: 'string' } }, required: ['proyecto'] } },
  { name: 'crear_tarea', description: 'Crea una tarea en el CRM. fecha en formato AAAA-MM-DD (resuelve "mañana", "el viernes"… con la fecha de hoy). proyecto y asignada_a son opcionales (nombre parcial).', input_schema: { type: 'object', properties: { titulo: { type: 'string' }, fecha: { type: 'string' }, proyecto: { type: 'string' }, prioridad: { type: 'string', enum: ['baja', 'normal', 'alta'] }, asignada_a: { type: 'string' }, descripcion: { type: 'string' } }, required: ['titulo'] } },
  { name: 'completar_tarea', description: 'Marca una tarea como hecha (usa el id que devolvió agenda_de_hoy o ver_proyecto).', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'crear_evento', description: 'Crea un evento en el calendario del CRM.', input_schema: { type: 'object', properties: { titulo: { type: 'string' }, fecha: { type: 'string', description: 'AAAA-MM-DD' }, hora: { type: 'string', description: 'HH:MM, opcional' }, descripcion: { type: 'string' } }, required: ['titulo', 'fecha'] } },
  { name: 'guardar_adjunto', description: 'Guarda una foto o documento que Víctor te acaba de mandar (adjunto con su id, p. ej. "a1"). destino: "necesidades" = fotos del programa de necesidades del proyecto; "obra" = fotos de una visita a obra; "documento" = archivo en los Documentos del proyecto; "referencia" = imagen de inspiración (sin proyecto, tablero general de referencias). Para todo menos "referencia" hace falta el proyecto. Si no está claro el proyecto o el destino, pregunta antes de guardar.', input_schema: { type: 'object', properties: { adjunto: { type: 'string' }, destino: { type: 'string', enum: ['necesidades', 'obra', 'documento', 'referencia'] }, proyecto: { type: 'string' }, titulo: { type: 'string', description: 'título o pie de foto breve' }, nota: { type: 'string', description: 'detalle: qué se ve, qué te gusta, qué hay que tener en cuenta' }, categoria: { type: 'string', description: 'solo referencias: tipo de espacio o estilo' } }, required: ['adjunto', 'destino'] } },
  { name: 'guardar_nota_proyecto', description: 'Guarda una nota en los Documentos de un proyecto: acta de reunión, resumen de visita a obra, transcripción, decisiones. Escribe un resumen ordenado (acuerdos, medidas, decisiones, pendientes). Con incluir_original=true se adjunta además, tal cual, el mensaje completo de Víctor (útil para transcripciones largas: no las copies tú).', input_schema: { type: 'object', properties: { proyecto: { type: 'string' }, titulo: { type: 'string' }, tipo: { type: 'string', enum: ['reunion', 'obra', 'nota'] }, resumen: { type: 'string' }, incluir_original: { type: 'boolean' } }, required: ['proyecto', 'titulo', 'resumen'] } },
  { name: 'crear_proveedor', description: 'Crea un proveedor/contacto nuevo en el CRM (Contactos). sector = su oficio o a qué se dedica.', input_schema: { type: 'object', properties: { nombre: { type: 'string' }, sector: { type: 'string' }, telefono: { type: 'string' }, email: { type: 'string' }, web: { type: 'string' }, descripcion: { type: 'string' } }, required: ['nombre'] } },
  { name: 'buscar_proveedores', description: 'Busca proveedores/contactos por nombre u oficio.', input_schema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] } },
  { name: 'recordatorio', description: 'Programa un aviso: a esa hora le escribirás tú a Víctor el texto. fecha AAAA-MM-DD y hora HH:MM en hora de Madrid.', input_schema: { type: 'object', properties: { texto: { type: 'string' }, fecha: { type: 'string' }, hora: { type: 'string' } }, required: ['texto', 'fecha', 'hora'] } },
  { name: 'consultar_crm', description: 'Datos del negocio para informes y consejos. que: "resumen" (proyectos por fase, tareas atrasadas, carga por persona), "ventas" (ventas abiertas y cerradas), "leads" (últimos leads y su estado), "presupuestos" (últimos presupuestos y estado).', input_schema: { type: 'object', properties: { que: { type: 'string', enum: ['resumen', 'ventas', 'leads', 'presupuestos'] } }, required: ['que'] } },
  { name: 'crear_pdf', description: 'Genera un PDF con la imagen de Ranuse (informe, resumen, listado, propuesta de contenido…) y se lo envías a Víctor como archivo. contenido en texto sencillo: líneas que empiezan por "# " son títulos, "## " subtítulos, "- " viñetas, el resto párrafos. Si pasas proyecto, se guarda también en sus Documentos.', input_schema: { type: 'object', properties: { titulo: { type: 'string' }, contenido: { type: 'string' }, proyecto: { type: 'string' } }, required: ['titulo', 'contenido'] } },
  { name: 'generar_render', description: 'Convierte en render fotorrealista una foto, boceto o captura que Víctor te ha mandado (adjunto). Si dice el proyecto, se guarda en los Renders de ese proyecto en el CRM; si no, en Referencias del CRM. Se lo envías como imagen. instrucciones = qué quiere ver (materiales, colores, ambiente); estilo opcional.', input_schema: { type: 'object', properties: { adjunto: { type: 'string' }, proyecto: { type: 'string' }, instrucciones: { type: 'string' }, estilo: { type: 'string' } }, required: ['adjunto'] } },
  { name: 'editar_foto', description: 'Edita una foto que Víctor te ha mandado (adjunto) aplicando el cambio que pida ("cámbiale el suelo a madera", "quita la columna", "ponle un espejo grande"). Mantiene todo lo demás. No hace falta proyecto: si lo menciona se guarda en los Renders de ese proyecto, si no en Referencias del CRM. Se la envías como imagen.', input_schema: { type: 'object', properties: { adjunto: { type: 'string' }, instruccion: { type: 'string' }, proyecto: { type: 'string' } }, required: ['adjunto', 'instruccion'] } },
  { name: 'generar_imagen', description: 'Genera imágenes de inspiración desde cero, SIN foto de partida y sin proyecto concreto: ideas de diseño para gimnasios, zonas de entrenamiento, recepciones, materiales, mobiliario a medida, etc. Piensa como un diseñador top pero viable de construir: propón algo que sorprenda, no el cliché de siempre. prompt = descripción detallada de lo que se ve. variantes 1 a 3 (con varias, cada una con un enfoque distinto). Se guardan en Referencias del CRM (o en el proyecto si lo dice) y se las envías como imágenes.', input_schema: { type: 'object', properties: { prompt: { type: 'string' }, estilo: { type: 'string' }, variantes: { type: 'number' }, proyecto: { type: 'string' } }, required: ['prompt'] } },
  { name: 'hablar_con_agente', description: 'Habla con uno de los asistentes especializados del CRM y te devuelve su respuesta. agente: "presupuestos" (crea y gestiona presupuestos con IA: pásale lo que Víctor pida, con todos los datos), "setter" (analiza conversaciones de leads y prepara respuestas y fichas), "finanzas" (consulta y crea movimientos de finanzas), "diseno" (alzados: necesita proyecto; la lámina queda guardada en el Asistente de diseño del proyecto). La conversación con cada agente continúa entre llamadas; si el agente pregunta algo, pásaselo a Víctor tal cual y espera su respuesta. nueva=true empieza de cero con ese agente.', input_schema: { type: 'object', properties: { agente: { type: 'string', enum: ['presupuestos', 'setter', 'finanzas', 'diseno'] }, mensaje: { type: 'string' }, proyecto: { type: 'string' }, nueva: { type: 'boolean' } }, required: ['agente', 'mensaje'] } },
  { name: 'llamadas_fathom', description: 'Consulta las reuniones y llamadas grabadas con Fathom: título, fecha, participantes y el resumen. busqueda filtra por título o participante; dias = cuántos días atrás mirar (por defecto 14). con_transcripcion=true trae también la transcripción cuando la búsqueda da una sola reunión. Úsala cuando Víctor hable de una llamada o reunión reciente, pida un resumen o quiera guardarla en un proyecto (entonces sigue con guardar_nota_proyecto con tu resumen de lo acordado y crea las tareas que salgan).', input_schema: { type: 'object', properties: { busqueda: { type: 'string' }, dias: { type: 'number' }, con_transcripcion: { type: 'boolean' } } } },
  { name: 'ver_referencias', description: 'Busca en el tablero de Referencias del CRM (las imágenes de inspiración que Víctor ha ido guardando) y te las enseña: títulos, notas y hasta 4 imágenes para que las veas. Úsala antes de proponer ideas o de generar imágenes, para tirar de su gusto real, y cuando pregunte "qué referencias tengo de…". busqueda vacía = las más recientes.', input_schema: { type: 'object', properties: { busqueda: { type: 'string' }, cantidad: { type: 'number' } } } },
  { name: 'analizar_proyectos_vendidos', description: 'Reúne lo que hay de los proyectos VENDIDOS (cerrados): tipo, resumen del cliente, programa de necesidades, equipos y materiales elegidos. Úsala cuando Víctor te pida aprender de lo que ha vendido, o para dar consejo basado en lo que de verdad funciona con sus clientes. Después saca patrones (qué piden, qué materiales y marcas se repiten, tipologías) y guarda los más útiles con recordar.', input_schema: { type: 'object', properties: { limite: { type: 'number' } } } },
  { name: 'recordar', description: 'Guarda en tu memoria permanente algo que Víctor te cuenta o te pide recordar (preferencias, datos de clientes, decisiones, ideas, ritmos de trabajo…). Úsala sin que te lo pida si es algo que conviene recordar. Un hecho por llamada, redactado de forma autosuficiente. privado=true para TODO lo personal (familia, salud, ánimo, dinero personal, relaciones, planes personales): se guarda aparte y NO se ve en el CRM.', input_schema: { type: 'object', properties: { texto: { type: 'string' }, etiqueta: { type: 'string', description: 'tema corto, p. ej. cliente, proveedor, preferencia, idea' }, privado: { type: 'boolean' } }, required: ['texto'] } },
  { name: 'marcar_conversacion_privada', description: 'Llámala cuando Víctor te hable de algo personal: así esta parte de la conversación no aparece en el CRM. No crees tareas, eventos ni notas de proyecto sobre temas personales salvo que él lo pida expresamente.', input_schema: { type: 'object', properties: {} } },
  { name: 'olvidar', description: 'Borra un recuerdo de tu memoria por su id.', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
];

async function formPor(pid) {
  const { data: ex } = await supabase.from('project_needs_forms').select('id').eq('project_id', pid).maybeSingle(); if (ex) return ex;
  const { data, error } = await supabase.from('project_needs_forms').insert({ project_id: pid }).select('id').single(); if (error) throw error; return data;
}
async function ejecutar(nombre, input, ctx = {}) {
  const { fecha } = madrid();
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
    let proyecto = null; if (input.proyecto) { proyecto = await proyectoPor(input.proyecto); if (!proyecto) return { error: 'No encuentro el proyecto "' + input.proyecto + '". No he creado la tarea.' }; fila.project_id = proyecto.id; }
    if (input.asignada_a) { const e = await empleadoPor(input.asignada_a); if (!e) return { error: 'No encuentro a "' + input.asignada_a + '" en el equipo. No he creado la tarea.' }; fila.assigned_to = e.id; }
    const { data, error } = await supabase.from('tasks').insert(fila).select('id, title, due_date').single();
    if (error) return { error: 'No se pudo crear: ' + error.message };
    return { creada: true, id: data.id, titulo: data.title, fecha: data.due_date, proyecto: proyecto ? (proyecto.project_name || proyecto.client_name) : null };
  }
  if (nombre === 'completar_tarea') {
    if (!UUID.test(String(input.id || ''))) return { error: 'Id de tarea no válido.' };
    const { data, error } = await supabase.from('tasks').update({ done: true }).eq('id', input.id).select('id, title').maybeSingle();
    if (error || !data) return { error: 'No he podido marcarla.' };
    return { hecha: true, titulo: data.title };
  }
  if (nombre === 'crear_evento') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.fecha || '') || !String(input.titulo || '').trim()) return { error: 'Faltan título o fecha (AAAA-MM-DD).' };
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
    const n = esTexto ? Math.min(3, Math.max(1, Math.round(Number(input.variantes)) || 1)) : 1;
    if (ctx.avisar) await ctx.avisar(esTexto ? 'Voy con ' + (n > 1 ? 'las ' + n + ' ideas' : 'la idea') + ', tarda un minuto…' : nombre === 'editar_foto' ? 'Editando la foto, un momento…' : 'Voy con el render, tarda un minuto…');
    const enfoques = ['', ' Enfoque alternativo: cambia por completo los materiales y la composición respecto a lo más habitual.', ' Enfoque atrevido pero construible: una solución de diseño inesperada que un buen estudio sí propondría.'];
    const hechas = await Promise.allSettled(Array.from({ length: n }, (_, i) => esTexto ? imagenDesdeTexto({ prompt: String(input.prompt) + enfoques[i], estilo: input.estilo }) : nombre === 'editar_foto' ? editarFoto({ buffer: a.buffer, mime: a.mime, instruccion: input.instruccion }) : renderDesdeFoto({ buffer: a.buffer, mime: a.mime, instrucciones: input.instrucciones, estilo: input.estilo })));
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
    if (ag === 'presupuestos') { const { j } = await llama('/api/ai-budget/chat', { messages: conv.messages.slice(-24) }); reply = j.reply; if (j.budget_created) { extra.presupuesto_creado = { numero: j.budget_created.budget_number }; if (j.budget_created.pdf_url) (ctx.salida = ctx.salida || []).push({ url: j.budget_created.pdf_url, nombre: 'Presupuesto_' + (j.budget_created.budget_number || '') + '.pdf' }); } }
    else if (ag === 'setter') { const { j } = await llama('/api/ai-setter/chat', { messages: conv.messages.slice(-24) }); reply = j.reply; if (j.lead) extra.lead = j.lead?.nombre || true; }
    else if (ag === 'diseno') { const { j } = await llama('/api/asistente-diseno/chat', { messages: conv.messages.slice(-24), proyectoId: proy.id, laminaId: conv.laminaId, spec: conv.spec }); reply = j.reply; conv.spec = j.spec || conv.spec; if (j.guardado) { conv.laminaId = j.guardado.laminaId; extra.guardado_en = 'Asistente de diseño del proyecto ' + (proy.project_name || proy.client_name) + ' (CRM)'; } if (j.avisos?.length) extra.avisos = j.avisos; }
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
    const hecho = { id: crypto.randomUUID().slice(0, 6), texto, etiqueta: String(input.etiqueta || '').slice(0, 30) || null, fecha };
    mem.hechos.push(hecho); if (mem.hechos.length > 400) mem.hechos = mem.hechos.slice(-400);
    await guardarJson(ruta, mem);
    return { guardado: true, id: hecho.id, privado: !!input.privado };
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

function sistema(mem, priv) {
  const { fecha, hora, dia } = madrid();
  const hechos = (mem.hechos || []).slice(-120).map(h => '- [' + h.id + '] ' + (h.etiqueta ? '(' + h.etiqueta + ') ' : '') + h.texto + ' (' + h.fecha + ')').join('\n') || '(todavía no hay recuerdos guardados)';
  return 'Eres el asistente personal de Víctor Palomo, fundador de Ranuse Design (diseño de espacios deportivos y gimnasios). Hablas con él por mensajería, desde el móvil. Ahora es ' + dia + ' ' + fecha + ', ' + hora + ' (hora de Madrid).\n' +
    '- Español, tono cercano y directo, como un compañero de confianza. Sin markdown (solo *negrita* con un asterisco si hace falta). Víctor no es técnico: sin jerga.\n' +
    '- BREVEDAD, REGLA DURA: Víctor NO lee mensajes largos. Responde en 1 a 4 líneas (unas 50 palabras) por defecto. Primero la respuesta o la acción hecha, sin saludos ni rodeos ni resúmenes de lo que acabas de hacer. Listas de 5 elementos como máximo y cada uno en una línea. Si hay mucho que contar, da lo esencial y pregunta "¿quieres el detalle?", o ofrécelo en PDF con crear_pdf. Haz como máximo UNA pregunta por mensaje. Si pide explícitamente algo largo (informe, guion, análisis), entonces sí, pero en PDF o en trozos que se lean en 20 segundos.\n' +
    '- Tienes MEMORIA permanente: usa la herramienta recordar cuando te cuente algo que convenga tener presente, sin que te lo pida, y confírmalo en pocas palabras. Nunca digas que no puedes recordar.\n' +
    '- Tienes acceso al CRM: agenda, tareas, eventos y proyectos. No inventes datos: consúltalos con las herramientas. Si crear algo es ambiguo (qué proyecto, qué día), pregunta lo mínimo.\n' +
    '- Cuando Víctor salude por la mañana o pregunte por su día, llama a agenda_de_hoy y dáselo ordenado: primero lo atrasado y urgente, luego lo de hoy, y los eventos con hora. Termina con una sugerencia breve de por dónde empezar.\n' +
    '- Fotos y documentos: cuando Víctor te mande uno, míralo y descríbelo en una frase. Si dice o se deduce dónde va (proyecto y si es del programa de necesidades, de una obra, un documento o una referencia de inspiración), guárdalo con guardar_adjunto y dile dónde lo has dejado. Si no está claro, pregunta una sola cosa. Reuniones, transcripciones y visitas a obra: guárdalas con guardar_nota_proyecto y crea las tareas que se desprendan.\n' +
    '- Llamadas y reuniones grabadas con Fathom (llamadas_fathom): cuando Víctor mencione una reunión, dale lo esencial (acuerdos, medidas, próximos pasos). Si dice dónde va o se deduce el proyecto, guárdala con guardar_nota_proyecto y crea las tareas que salgan; si no, pregunta el proyecto.\n' +
    '- Informes y PDFs: cuando te pida un reporte, resumen o documento, reúne los datos con las herramientas (consultar_crm, ver_proyecto…) y genera el PDF con crear_pdf. Redes y contenido: ayúdale con ideas, guiones y textos con la voz de Ranuse (cercana, profesional, de diseñador de espacios deportivos), usando lo que recuerdas de sus proyectos y gustos.\n' +
    '- Aprender de su gusto y de lo que vende: antes de proponer ideas, mira sus referencias (ver_referencias) y lo que recuerdas; cuando te mande una foto que claramente le gusta o es una referencia, además de guardarla apunta con recordar el rasgo de gusto (material, paleta, tipología, qué le atrae) en una frase. Si te pide aprender de los proyectos vendidos, usa analizar_proyectos_vendidos, saca los patrones útiles y guárdalos con recordar (uno por patrón, concretos y con datos).\n' +
    '- APRENDE: cada vez que Víctor te corrija, te cuente una preferencia, una forma de trabajar, datos de un cliente o una decisión, guárdalo con recordar sin que te lo pida. Antes de dar consejo, tira de lo que recuerdas.\n' +
    '- Compañeros del CRM (hablar_con_agente): presupuestos (crear presupuestos), setter (leads), finanzas y diseno (alzados). Si Víctor pide un presupuesto, un alzado, mirar un lead o algo de finanzas, pásaselo al compañero adecuado con todos los datos que te dé. Con una foto adjunta: generar_render (convertirla en render) o editar_foto (cambiarle algo concreto); ninguna exige proyecto. Cuando pida inspiración o ideas sin foto ni proyecto, usa generar_imagen (1 a 3 variantes) y acompáñalas de una explicación breve: piensa como un diseñador top pero viable, evita lo típico y sorpréndele.\n' +
    '- También puedes crear proveedores, buscarlos y programar recordatorios que te llegan a esta misma conversación. Puedes ser su consultor: cuando solo quiera pensar en voz alta o comparar opciones, da tu opinión con criterio y sin rodeos.\n\n' +
    '- BREVEDAD: Víctor no lee mensajes largos. Por defecto, máximo 300 caracteres (3-4 líneas). Nada de introducciones ni cierres de cortesía. Ideas o listas: máximo 3 puntos de una línea cada uno, y pregunta si quiere más.\n' +
    '- LO PERSONAL ES PRIVADO: si Víctor te habla de cosas personales (familia, salud, ánimo, dinero, relaciones, dudas vitales), ayúdale como un amigo con criterio y cercanía, llama a marcar_conversacion_privada, guarda lo importante con recordar y privado=true, y NUNCA lo conviertas en tareas, eventos, notas de proyecto ni nada que se vea en el CRM salvo que él te lo pida expresamente. Nunca menciones lo personal en resúmenes del día ni en informes.\n\n' +
    'Lo que recuerdas del trabajo:\n' + hechos +
    '\n\nRecuerdos PERSONALES de Víctor (privados; úsalos para ayudarle pero no los muestres ni los saques si no viene a cuento):\n' + ((priv.hechos || []).slice(-60).map(h => '- [' + h.id + '] ' + h.texto).join('\n') || '(ninguno)');
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
  const [mem, charla, priv] = await Promise.all([leerJson(RUTA_MEM, { hechos: [] }), leerJson(RUTA_CHARLA, {}), leerJson(RUTA_PRIV, { hechos: [] })]);
  const previoCrudo = (charla[chatId] || []).slice(-20), previo = previoCrudo.map(m => ({ role: m.role, content: m.content }));
  const ctx = { adjuntos, textoUsuario: texto, salida: [], avisar };
  const bloquesUsuario = adjuntos.length ? [
    ...adjuntos.filter(a => /^image\/(jpeg|png|webp|gif)$/.test(a.mime)).map(a => ({ type: 'image', source: { type: 'base64', media_type: a.mime, data: a.buffer.toString('base64') } })),
    ...adjuntos.filter(a => a.mime === 'application/pdf').map(a => ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.buffer.toString('base64') } })),
    { type: 'text', text: texto + '\n\n[Adjuntos recibidos: ' + adjuntos.map(a => a.id + ' (' + a.mime + (a.nombre ? ', ' + a.nombre : '') + ')').join('; ') + ']' },
  ] : texto;
  const mensajes = [...previo, { role: 'user', content: bloquesUsuario }];
  let respuesta = '';
  for (let vuelta = 0; vuelta < 7; vuelta++) {
    const out = await callClaude({ system: sistema(mem, priv), messages: mensajes, tools: TOOLS, maxTokens: 2500 });
    const bloques = out.content || [];
    const usos = bloques.filter(b => b.type === 'tool_use');
    if (out.stop_reason !== 'tool_use' || !usos.length) { respuesta = bloques.filter(b => b.type === 'text').map(b => b.text).join('\n').trim(); break; }
    mensajes.push({ role: 'assistant', content: bloques });
    const resultados = [];
    for (const u of usos) { let r; try { r = await ejecutar(u.name, u.input || {}, ctx); } catch (e) { r = { error: e.message }; } resultados.push({ type: 'tool_result', tool_use_id: u.id, content: await aContenido(r) }); }
    mensajes.push({ role: 'user', content: resultados });
  }
  if (!respuesta) respuesta = 'Me he liado un poco con eso. ¿Me lo repites con otras palabras?';
  charla[chatId] = [...previoCrudo, { role: 'user', content: texto + (adjuntos.length ? ' [adjuntó ' + adjuntos.length + ' archivo(s)]' : ''), ...(ctx.privado ? { privado: true } : {}) }, { role: 'assistant', content: respuesta, ...(ctx.privado ? { privado: true } : {}) }].slice(-30);
  try { await guardarJson(RUTA_CHARLA, charla); } catch (e) { console.error('Asistente: no se pudo guardar la conversación:', e.message); }
  return { texto: respuesta, archivos: ctx.salida };
}
