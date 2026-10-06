import express from 'express';
import sharp from 'sharp';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';
import { callClaude } from '../utils/anthropic.js';
import { getHistoriaAdmin } from '../utils/historia.js';

// Asistente de diseño por proyecto: conoce el moodboard (paleta + IMÁGENES),
// las necesidades, las medidas, la historia y los condicionantes del proyecto
// (techo bajo, pilares...) y ayuda a Víctor mientras lo monta. Solo da
// consejo: nunca modifica nada del proyecto.
const router = express.Router();
router.use(authenticateToken, requirePermission('proyectos'));

const fail = (res, e, msg) => { console.error(msg, e); res.status(500).json({ error: msg }); };
const txt = (v) => (typeof v === 'string' ? (v.trim() || null) : v === null ? null : undefined);

async function imagenParaIA(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = await sharp(Buffer.from(await r.arrayBuffer())).rotate().resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
    return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } };
  } catch { return null; }
}

// Reúne lo que el proyecto ya sabe: es el "contexto fijo" del asistente.
async function contextoProyecto(projectId) {
  const { data: p } = await supabase.from('client_projects')
    .select('project_name, tipo_proyecto, phase, notes, condicionantes, moodboard_description, moodboard_palette, moodboard_estilo_nombre, moodboard_estilo')
    .eq('id', projectId).single();
  if (!p) return null;

  const [{ data: imgs }, { data: form }, h, { data: equipos }, { data: materiales }] = await Promise.all([
    supabase.from('project_moodboard_images').select('url').eq('project_id', projectId).order('display_order', { ascending: true }).limit(6),
    supabase.from('project_needs_forms').select('id, brief, client_summary').eq('project_id', projectId).maybeSingle(),
    getHistoriaAdmin(projectId).catch(() => null),
    supabase.from('project_equipment_selections').select('name, brand, quantity').eq('project_id', projectId).limit(40),
    supabase.from('project_material_selections').select('name, location').eq('project_id', projectId).limit(40),
  ]);

  let respuestas = [];
  let medidas = [];
  if (form) {
    const [{ data: ans }, { data: preguntas }, { data: med }] = await Promise.all([
      supabase.from('project_needs_form_answers').select('question_id, answer_value').eq('form_id', form.id),
      supabase.from('needs_form_questions').select('id, question_text'),
      supabase.from('project_needs_form_measurements').select('*').eq('form_id', form.id),
    ]);
    const nombre = Object.fromEntries((preguntas || []).map(q => [q.id, q.question_text]));
    respuestas = (ans || []).filter(a => a.answer_value != null && a.answer_value !== '' && nombre[a.question_id])
      .map(a => `- ${nombre[a.question_id]} → ${Array.isArray(a.answer_value) ? a.answer_value.join(', ') : typeof a.answer_value === 'object' ? JSON.stringify(a.answer_value) : a.answer_value}`);
    medidas = (med || []).map(m => `- ${m.space_name || 'Espacio'}: largo ${m.largo ?? '?'} × ancho ${m.ancho ?? '?'} × alto ${m.alto ?? '?'}${m.notes ? ` (${m.notes})` : ''}`);
  }

  const lineas = [
    `PROYECTO: ${p.project_name} (${p.tipo_proyecto === 'home_gym' ? 'home gym' : p.tipo_proyecto === 'comercial' ? 'gimnasio comercial' : 'tipo sin definir'}) · fase ${p.phase ?? '—'}`,
    `CONDICIONANTES DEL PROYECTO (los ha escrito Víctor; tenlos SIEMPRE en cuenta): ${p.condicionantes?.trim() || 'ninguno anotado todavía'}`,
    `NOTAS INTERNAS: ${p.notes?.trim() || '—'}`,
    `MEDIDAS DEL ESPACIO (formulario de necesidades):\n${medidas.join('\n') || '— sin medidas todavía'}`,
    `RESPUESTAS DEL CLIENTE (programa de necesidades):\n${respuestas.join('\n') || '— sin respuestas todavía'}${form?.client_summary ? `\nResumen: ${form.client_summary}` : ''}${form?.brief ? `\nBrief: ${form.brief}` : ''}`,
    `PALETA DEL MOODBOARD (hex): ${(p.moodboard_palette || []).join(', ') || 'sin definir'}`,
    `RECETA DE COMBINACIÓN DE COLORES (combinador): ${(p.moodboard_description || '—').slice(0, 1500)}`,
    `ESTILO DEFINIDO: ${p.moodboard_estilo_nombre ? `${p.moodboard_estilo_nombre} — ${p.moodboard_estilo || ''}` : 'sin definir todavía'}`,
    `HISTORIA / CAPÍTULOS: ${h?.capitulos?.length ? h.capitulos.map(c => c.titulo).join(' → ') : 'sin historia'}`,
    `EQUIPAMIENTO ELEGIDO: ${(equipos || []).map(e => `${e.name}${e.brand ? ` (${e.brand})` : ''}`).join('; ') || 'ninguno todavía'}`,
    `MATERIALES ELEGIDOS: ${(materiales || []).map(m => m.name + (m.location ? ` [${m.location}]` : '')).join('; ') || 'ninguno todavía'}`,
  ];
  const imagenes = (await Promise.all((imgs || []).map(i => imagenParaIA(i.url)))).filter(Boolean);
  return { texto: lineas.join('\n\n'), imagenes, hayMoodboard: imagenes.length > 0 };
}

const SYSTEM = `Eres el asistente de diseño de Víctor, de Ranuse Design (estudio de diseño integral de espacios de entrenamiento: gimnasios comerciales, home gyms, centros de alto rendimiento). Víctor está montando un proyecto y tú le ayudas como un compañero senior: analizas lo que ya hay en el proyecto (moodboard con sus IMÁGENES, paleta, estilo, medidas, respuestas del cliente, equipamiento, materiales) y le avisas de inconvenientes y le propones soluciones concretas.

CÓMO TRABAJAS
- Parte SIEMPRE de los datos reales del proyecto que se te pasan (y de lo que ves en las imágenes del moodboard). Cita lo concreto: un color de la paleta, una imagen, una medida, un condicionante. Nada de consejos genéricos de manual.
- Los CONDICIONANTES del proyecto (techo bajo, pilares, poca luz natural, suelo irregular, ruido a vecinos, etc.) son lo primero que tienes en cuenta: cada recomendación tiene que ser compatible con ellos. Si Víctor te cuenta uno nuevo en la conversación, tenlo en cuenta desde ese momento y sugiérele que lo anote en "Condicionantes" para que no se pierda.
- Si falta un dato que cambia la respuesta (la altura real, los m², el uso, qué equipamiento), dilo y pregúntalo en UNA línea; no inventes cifras del proyecto.
- Tus consejos son criterio de diseño, no normativa ni cálculo estructural/instalaciones: si algo toca seguridad, estructura, electricidad, ventilación reglamentaria o accesibilidad normativa, dilo y recomienda validarlo con el técnico correspondiente. Si no estás seguro de una cifra (alturas mínimas de un equipo, etc.), dilo y recomienda comprobar la ficha del fabricante.
- Para techos bajos, por ejemplo, piensa en: color y acabado del techo (claro y mate o continuo con la pared para que "desaparezca"; evitar contrastes fuertes arriba salvo intención clara), iluminación empotrada o indirecta perimetral en vez de luminarias colgantes, evitar vigas/instalaciones vistas si bajan la altura percibida, espejos y paredes claras para ampliar, líneas verticales en paredes, suelos continuos; y sobre todo ALTURA LIBRE del equipamiento: ejercicios por encima de la cabeza (press militar, dominadas, cuerdas, wall balls, saltos al cajón, kettlebell overhead) y racks/estructuras altas — qué se puede y qué no, y alternativas (versiones bajas, zonas con más altura, rediseñar la distribución para colocar lo alto donde hay más altura).
- Tienes en cuenta el estilo del moodboard: no propongas nada que lo contradiga sin avisar.

CÓMO RESPONDES
- En español de España, directo y práctico, como un compañero. Respuestas cortas: lo importante primero. Usa títulos cortos en negrita (**así**) y listas breves cuando ayuden; sin párrafos largos.
- Cuando analices el proyecto, ordena: 1) lo que ves (moodboard/paleta/estilo) y si encaja con los condicionantes, 2) inconvenientes y riesgos (priorizados), 3) soluciones concretas y 4) qué te falta saber o decidir.
- No modificas nada del proyecto; solo aconsejas. Si Víctor quiere que algo se guarde, dile dónde (Condicionantes, Estilo, Historia, etc.).`;

// ── Condicionantes + conversación guardada ─────────────────────────────
router.get('/:projectId', async (req, res) => {
  try {
    const [{ data: p, error }, { data: mensajes }] = await Promise.all([
      supabase.from('client_projects').select('condicionantes').eq('id', req.params.projectId).single(),
      supabase.from('agente_mensajes').select('id, role, content, created_at').eq('proyecto_id', req.params.projectId).order('created_at', { ascending: true }).limit(200),
    ]);
    if (error) throw error;
    res.json({ condicionantes: p.condicionantes || '', mensajes: mensajes || [] });
  } catch (e) { fail(res, e, 'Error al cargar el asistente (¿has ejecutado el SQL v67?)'); }
});

router.put('/:projectId/condicionantes', async (req, res) => {
  try {
    const { error } = await supabase.from('client_projects').update({ condicionantes: txt(req.body.condicionantes) ?? null }).eq('id', req.params.projectId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { fail(res, e, 'Error al guardar los condicionantes'); }
});

router.delete('/:projectId/mensajes', async (req, res) => {
  try {
    const { error } = await supabase.from('agente_mensajes').delete().eq('proyecto_id', req.params.projectId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { fail(res, e, 'Error al borrar la conversación'); }
});

// ── Chat ───────────────────────────────────────────────────────────────
router.post('/:projectId/chat', async (req, res) => {
  try {
    const mensaje = txt(req.body.mensaje);
    if (!mensaje) return res.status(400).json({ error: 'Escribe un mensaje' });
    const ctx = await contextoProyecto(req.params.projectId);
    if (!ctx) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const { data: previos } = await supabase.from('agente_mensajes').select('role, content').eq('proyecto_id', req.params.projectId).order('created_at', { ascending: false }).limit(16);
    const historial = (previos || []).reverse().map(m => ({ role: m.role, content: m.content }));
    while (historial.length && historial[0].role === 'assistant') historial.shift(); // la conversación enviada empieza siempre por el usuario

    // El contexto (con las imágenes) viaja en el primer mensaje de cada petición, así siempre está actualizado
    const intro = {
      role: 'user',
      content: [
        ...ctx.imagenes,
        { type: 'text', text: `CONTEXTO ACTUAL DEL PROYECTO (se actualiza en cada mensaje; ${ctx.hayMoodboard ? 'las imágenes de arriba son las del moodboard' : 'todavía no hay imágenes en el moodboard'}):\n\n${ctx.texto}` },
      ],
    };
    const puente = { role: 'assistant', content: 'Entendido, tengo el contexto del proyecto. Dime.' };
    const messages = [intro, puente, ...historial, { role: 'user', content: mensaje }];

    const response = await callClaude({ system: SYSTEM, messages, maxTokens: 1500 });
    const respuesta = (response.content || []).find(b => b.type === 'text')?.text?.trim();
    if (!respuesta) return res.status(502).json({ error: 'La IA no devolvió respuesta' });

    await supabase.from('agente_mensajes').insert([
      { proyecto_id: req.params.projectId, role: 'user', content: mensaje },
      { proyecto_id: req.params.projectId, role: 'assistant', content: respuesta },
    ]);
    res.json({ respuesta });
  } catch (e) { fail(res, e, e.message || 'Error al consultar al asistente'); }
});

export default router;
