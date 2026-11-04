import crypto from 'crypto';
import { supabase } from '../config/supabase.js';
import { callClaude } from './anthropic.js';

// Cerebro del asistente personal de Víctor (lo usan WhatsApp y Telegram).
// - Memoria que persiste (hechos que le pides recordar) y conversación reciente, guardadas en Storage (sin tocar la base de datos).
// - Herramientas sobre el CRM: agenda del día, proyectos, tareas y eventos.
// Nada de lo que ya existe se borra: solo lee, crea tareas/eventos, marca tareas hechas y apunta/olvida recuerdos.
const BUCKET = 'project-documents';
const RUTA_MEM = 'crm/asistente/memoria.json';
const RUTA_CHARLA = 'crm/asistente/charla.json';
const FASES = ['Diseño previo', 'Arquitectura', 'Instalaciones', 'Interiorismo y materialidad', 'Maquinaria y equipamiento', 'Documentación de apoyo'];

async function leerJson(ruta, vacio) {
  const { data, error } = await supabase.storage.from(BUCKET).download(ruta);
  if (error || !data) return vacio;
  try { return JSON.parse(await data.text()); } catch { return vacio; }
}
async function guardarJson(ruta, obj) {
  const { error } = await supabase.storage.from(BUCKET).upload(ruta, Buffer.from(JSON.stringify(obj)), { contentType: 'application/json', upsert: true, cacheControl: '0' });
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
  { name: 'recordar', description: 'Guarda en tu memoria permanente algo que Víctor te cuenta o te pide recordar (preferencias, datos de clientes, decisiones, ideas, ritmos de trabajo…). Úsala sin que te lo pida si es algo que conviene recordar. Un hecho por llamada, redactado de forma autosuficiente.', input_schema: { type: 'object', properties: { texto: { type: 'string' }, etiqueta: { type: 'string', description: 'tema corto, p. ej. cliente, proveedor, preferencia, idea' } }, required: ['texto'] } },
  { name: 'olvidar', description: 'Borra un recuerdo de tu memoria por su id.', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
];

async function ejecutar(nombre, input) {
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
  if (nombre === 'recordar') {
    const texto = String(input.texto || '').trim().slice(0, 600); if (!texto) return { error: 'Nada que recordar.' };
    const mem = await leerJson(RUTA_MEM, { hechos: [] });
    const hecho = { id: crypto.randomUUID().slice(0, 6), texto, etiqueta: String(input.etiqueta || '').slice(0, 30) || null, fecha };
    mem.hechos.push(hecho); if (mem.hechos.length > 400) mem.hechos = mem.hechos.slice(-400);
    await guardarJson(RUTA_MEM, mem);
    return { guardado: true, id: hecho.id };
  }
  if (nombre === 'olvidar') {
    const mem = await leerJson(RUTA_MEM, { hechos: [] }); const antes = mem.hechos.length;
    mem.hechos = mem.hechos.filter(h => h.id !== String(input.id || '')); if (mem.hechos.length === antes) return { error: 'No encuentro ese recuerdo.' };
    await guardarJson(RUTA_MEM, mem); return { olvidado: true };
  }
  return { error: 'Herramienta desconocida.' };
}

function sistema(mem) {
  const { fecha, hora, dia } = madrid();
  const hechos = (mem.hechos || []).slice(-120).map(h => '- [' + h.id + '] ' + (h.etiqueta ? '(' + h.etiqueta + ') ' : '') + h.texto + ' (' + h.fecha + ')').join('\n') || '(todavía no hay recuerdos guardados)';
  return 'Eres el asistente personal de Víctor Palomo, fundador de Ranuse Design (diseño de espacios deportivos y gimnasios). Hablas con él por mensajería, desde el móvil. Ahora es ' + dia + ' ' + fecha + ', ' + hora + ' (hora de Madrid).\n' +
    '- Español, tono cercano y directo, como un compañero de confianza. Mensajes cortos, sin markdown (solo *negrita* con un asterisco si hace falta). Víctor no es técnico: sin jerga.\n' +
    '- Tienes MEMORIA permanente: usa la herramienta recordar cuando te cuente algo que convenga tener presente, sin que te lo pida, y confírmalo en pocas palabras. Nunca digas que no puedes recordar.\n' +
    '- Tienes acceso al CRM: agenda, tareas, eventos y proyectos. No inventes datos: consúltalos con las herramientas. Si crear algo es ambiguo (qué proyecto, qué día), pregunta lo mínimo.\n' +
    '- Cuando Víctor salude por la mañana o pregunte por su día, llama a agenda_de_hoy y dáselo ordenado: primero lo atrasado y urgente, luego lo de hoy, y los eventos con hora. Termina con una sugerencia breve de por dónde empezar.\n' +
    '- Todavía NO sabes procesar fotos ni documentos, ni lanzar renders, alzados o el setter: se están montando. Si te lo pide, dilo claro y ofrécete a apuntar la petición como tarea.\n\n' +
    'Lo que recuerdas:\n' + hechos;
}

// Devuelve el texto de respuesta. chatId separa conversaciones (WhatsApp / Telegram).
export async function responderAsistente({ chatId, texto }) {
  const [mem, charla] = await Promise.all([leerJson(RUTA_MEM, { hechos: [] }), leerJson(RUTA_CHARLA, {})]);
  const previo = (charla[chatId] || []).slice(-20);
  const mensajes = [...previo, { role: 'user', content: texto }];
  let respuesta = '';
  for (let vuelta = 0; vuelta < 7; vuelta++) {
    const out = await callClaude({ system: sistema(mem), messages: mensajes, tools: TOOLS, maxTokens: 900 });
    const bloques = out.content || [];
    const usos = bloques.filter(b => b.type === 'tool_use');
    if (out.stop_reason !== 'tool_use' || !usos.length) { respuesta = bloques.filter(b => b.type === 'text').map(b => b.text).join('\n').trim(); break; }
    mensajes.push({ role: 'assistant', content: bloques });
    const resultados = [];
    for (const u of usos) { let r; try { r = await ejecutar(u.name, u.input || {}); } catch (e) { r = { error: e.message }; } resultados.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(r).slice(0, 6000) }); }
    mensajes.push({ role: 'user', content: resultados });
  }
  if (!respuesta) respuesta = 'Me he liado un poco con eso. ¿Me lo repites con otras palabras?';
  charla[chatId] = [...previo, { role: 'user', content: texto }, { role: 'assistant', content: respuesta }].slice(-30);
  try { await guardarJson(RUTA_CHARLA, charla); } catch (e) { console.error('Asistente: no se pudo guardar la conversación:', e.message); }
  return respuesta;
}
