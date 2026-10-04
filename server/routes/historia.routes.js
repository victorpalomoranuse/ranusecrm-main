import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';
import { uploadDocumentFile, handleMulterError } from '../middleware/upload.middleware.js';
import { uploadProjectRender, uploadProjectDocument } from '../utils/storage.js';
import { callClaude } from '../utils/anthropic.js';
import { crearHistoria, getHistoriaAdmin, TIPOS_PROYECTO } from '../utils/historia.js';

// Historia por capítulos del Proyecto creativo (Servicio 1). Todo es opt-in:
// solo existe para proyectos con tipo_proyecto y capítulos. Los proyectos
// antiguos no pasan por aquí.
const router = express.Router();
router.use(authenticateToken, requirePermission('proyectos'));

const ETIQUETAS = ['incluido', 'extra', 'wow'];
const TIPOS_BLOQUE = ['imagen_texto', 'render', 'zona', 'detalle'];
const ESTADOS_ENTREGABLE = ['pendiente', 'en_curso', 'entregado'];

const txt = (v) => (typeof v === 'string' ? (v.trim() || null) : v === null ? null : undefined);
const url = (v) => {
  const t = txt(v);
  if (t === undefined || t === null) return t;
  return /^https?:\/\//i.test(t) ? t : undefined;
};
const sinUndefined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const fail = (res, err, msg) => { console.error(msg, err); res.status(500).json({ error: msg }); };

// Capítulos de la plantilla de un tipo (para elegir cuáles incluir al crear)
router.get('/plantillas/:tipo', async (req, res) => {
  try {
    if (!TIPOS_PROYECTO.includes(req.params.tipo)) return res.status(400).json({ error: 'Tipo no válido' });
    const { data, error } = await supabase.from('plantillas_capitulo').select('orden, titulo').eq('tipo', req.params.tipo).order('orden', { ascending: true });
    if (error) throw error;
    res.json({ capitulos: data });
  } catch (e) { fail(res, e, 'Error al obtener las plantillas'); }
});

// ── Historia completa (admin) ──────────────────────────────────────────
router.get('/:projectId', async (req, res) => {
  try { res.json(await getHistoriaAdmin(req.params.projectId)); }
  catch (e) { fail(res, e, 'Error al obtener la historia'); }
});

// Genera la historia de un proyecto que todavía no la tiene (p.ej. uno
// creado sin tipo). Nunca toca una historia ya existente.
router.post('/:projectId/generar', async (req, res) => {
  try {
    const { tipo, capitulos_orden } = req.body;
    if (!TIPOS_PROYECTO.includes(tipo)) return res.status(400).json({ error: 'Tipo de proyecto no válido' });
    const creada = await crearHistoria(req.params.projectId, tipo, capitulos_orden);
    if (!creada) return res.status(409).json({ error: 'Este proyecto ya tiene historia o no hay capítulos que crear' });
    await supabase.from('client_projects').update({ tipo_proyecto: tipo }).eq('id', req.params.projectId);
    res.status(201).json(await getHistoriaAdmin(req.params.projectId));
  } catch (e) { fail(res, e, 'Error al generar la historia'); }
});

// ── Subida de imágenes / PDFs (devuelve la URL, no guarda nada más) ────
router.post('/:projectId/subir', uploadDocumentFile, handleMulterError, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });
    const esPdf = req.file.mimetype === 'application/pdf';
    const fn = esPdf ? uploadProjectDocument : uploadProjectRender;
    const urlSubida = await fn(req.file.buffer, req.file.originalname, req.file.mimetype, req.params.projectId);
    res.status(201).json({ url: urlSubida, nombre: req.file.originalname });
  } catch (e) { fail(res, e, 'Error al subir el archivo'); }
});

// ── Capítulos ─────────────────────────────────────────────────────────
router.post('/:projectId/capitulos', async (req, res) => {
  try {
    const titulo = txt(req.body.titulo);
    if (!titulo) return res.status(400).json({ error: 'El título es requerido' });
    const { data: ultimo } = await supabase.from('capitulos').select('orden').eq('proyecto_id', req.params.projectId).order('orden', { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await supabase.from('capitulos').insert({
      proyecto_id: req.params.projectId, orden: (ultimo?.orden ?? 0) + 1, titulo,
      texto: txt(req.body.texto) ?? null, origen: 'manual',
    }).select('*').single();
    if (error) throw error;
    res.status(201).json({ capitulo: data });
  } catch (e) { fail(res, e, 'Error al crear el capítulo'); }
});

router.put('/:projectId/capitulos/orden', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids requerido' });
    await Promise.all(ids.map((id, i) => supabase.from('capitulos').update({ orden: i + 1 }).eq('id', id).eq('proyecto_id', req.params.projectId)));
    res.json({ ok: true });
  } catch (e) { fail(res, e, 'Error al reordenar'); }
});

router.put('/capitulos/:id', async (req, res) => {
  try {
    const b = req.body;
    const updates = sinUndefined({
      titulo: txt(b.titulo) || undefined, texto: txt(b.texto), sensorial: txt(b.sensorial),
      render_url: url(b.render_url), tour_url: url(b.tour_url),
      visible: typeof b.visible === 'boolean' ? b.visible : undefined,
      updated_at: new Date().toISOString(),
    });
    const { data, error } = await supabase.from('capitulos').update(updates).eq('id', req.params.id).select('*').single();
    if (error) throw error;
    res.json({ capitulo: data });
  } catch (e) { fail(res, e, 'Error al actualizar el capítulo'); }
});

router.delete('/capitulos/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('capitulos').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { fail(res, e, 'Error al eliminar el capítulo'); }
});

// ── Bloques ───────────────────────────────────────────────────────────
function datosBloque(b) {
  return sinUndefined({
    tipo: TIPOS_BLOQUE.includes(b.tipo) ? b.tipo : undefined,
    titulo: txt(b.titulo), texto: txt(b.texto), imagen_url: url(b.imagen_url),
    elementos: Array.isArray(b.elementos) ? b.elementos.map(x => String(x).trim()).filter(Boolean) : undefined,
    lado: ['izquierda', 'derecha'].includes(b.lado) ? b.lado : undefined,
    guia: txt(b.guia),
    visible: typeof b.visible === 'boolean' ? b.visible : undefined,
  });
}

router.post('/capitulos/:id/bloques', async (req, res) => {
  try {
    const { data: cap } = await supabase.from('capitulos').select('id, proyecto_id').eq('id', req.params.id).single();
    if (!cap) return res.status(404).json({ error: 'Capítulo no encontrado' });
    const { data: ultimo } = await supabase.from('capitulo_bloques').select('orden').eq('capitulo_id', cap.id).order('orden', { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await supabase.from('capitulo_bloques').insert({
      ...datosBloque(req.body), proyecto_id: cap.proyecto_id, capitulo_id: cap.id, orden: (ultimo?.orden ?? 0) + 1,
    }).select('*').single();
    if (error) throw error;
    res.status(201).json({ bloque: data });
  } catch (e) { fail(res, e, 'Error al crear el bloque'); }
});

router.put('/capitulos/:id/bloques/orden', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids requerido' });
    await Promise.all(ids.map((id, i) => supabase.from('capitulo_bloques').update({ orden: i + 1 }).eq('id', id).eq('capitulo_id', req.params.id)));
    res.json({ ok: true });
  } catch (e) { fail(res, e, 'Error al reordenar'); }
});

router.put('/bloques/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('capitulo_bloques').update(datosBloque(req.body)).eq('id', req.params.id).select('*').single();
    if (error) throw error;
    res.json({ bloque: data });
  } catch (e) { fail(res, e, 'Error al actualizar el bloque'); }
});

router.delete('/bloques/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('capitulo_bloques').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { fail(res, e, 'Error al eliminar el bloque'); }
});

// ── Servicios del espacio (del proyecto, enlazados a varios capítulos) ─
async function enlazarServicio(servicioId, capitulos) {
  if (!Array.isArray(capitulos)) return;
  await supabase.from('servicio_capitulo').delete().eq('servicio_id', servicioId);
  if (capitulos.length) await supabase.from('servicio_capitulo').insert(capitulos.map((capitulo_id, i) => ({ servicio_id: servicioId, capitulo_id, orden: i })));
}

function datosServicio(b) {
  return sinUndefined({
    nombre: txt(b.nombre) || undefined, descripcion: txt(b.descripcion), imagen_url: url(b.imagen_url), guia: txt(b.guia),
    etiqueta: ETIQUETAS.includes(b.etiqueta) ? b.etiqueta : undefined,
  });
}

router.post('/:projectId/servicios', async (req, res) => {
  try {
    const datos = datosServicio(req.body);
    if (!datos.nombre) return res.status(400).json({ error: 'El nombre es requerido' });
    const { data: ultimo } = await supabase.from('servicios_espacio').select('orden').eq('proyecto_id', req.params.projectId).order('orden', { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await supabase.from('servicios_espacio').insert({ ...datos, proyecto_id: req.params.projectId, orden: (ultimo?.orden ?? -1) + 1 }).select('*').single();
    if (error) throw error;
    await enlazarServicio(data.id, req.body.capitulos);
    res.status(201).json({ servicio: { ...data, capitulos: Array.isArray(req.body.capitulos) ? req.body.capitulos : [] } });
  } catch (e) { fail(res, e, 'Error al crear el servicio'); }
});

router.put('/servicios/:id', async (req, res) => {
  try {
    const datos = datosServicio(req.body);
    if (Object.keys(datos).length) {
      const { error } = await supabase.from('servicios_espacio').update(datos).eq('id', req.params.id);
      if (error) throw error;
    }
    await enlazarServicio(req.params.id, req.body.capitulos);
    const { data } = await supabase.from('servicios_espacio').select('*').eq('id', req.params.id).single();
    const { data: links } = await supabase.from('servicio_capitulo').select('capitulo_id').eq('servicio_id', req.params.id);
    res.json({ servicio: { ...data, capitulos: (links || []).map(l => l.capitulo_id) } });
  } catch (e) { fail(res, e, 'Error al actualizar el servicio'); }
});

router.delete('/servicios/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('servicios_espacio').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { fail(res, e, 'Error al eliminar el servicio'); }
});

// ── Entregables (capitulo_id null = general del proyecto) ─────────────
function datosEntregable(b) {
  return sinUndefined({
    nombre: txt(b.nombre) || undefined, descripcion: txt(b.descripcion), formato: txt(b.formato),
    estado: ESTADOS_ENTREGABLE.includes(b.estado) ? b.estado : undefined,
    archivo_url: url(b.archivo_url),
    visible_cliente: typeof b.visible_cliente === 'boolean' ? b.visible_cliente : undefined,
    opcional: typeof b.opcional === 'boolean' ? b.opcional : undefined,
  });
}

router.post('/:projectId/entregables', async (req, res) => {
  try {
    const datos = datosEntregable(req.body);
    if (!datos.nombre) return res.status(400).json({ error: 'El nombre es requerido' });
    const { data: ultimo } = await supabase.from('entregables_capitulo').select('orden').eq('proyecto_id', req.params.projectId).order('orden', { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await supabase.from('entregables_capitulo').insert({
      ...datos, proyecto_id: req.params.projectId, capitulo_id: req.body.capitulo_id || null, orden: (ultimo?.orden ?? 0) + 1,
    }).select('*').single();
    if (error) throw error;
    res.status(201).json({ entregable: data });
  } catch (e) { fail(res, e, 'Error al crear el entregable'); }
});

router.put('/entregables/:id', async (req, res) => {
  try {
    const datos = datosEntregable(req.body);
    // Si se sube un archivo y no se indica estado, pasa a "entregado"
    if (datos.archivo_url && !datos.estado) datos.estado = 'entregado';
    const { data, error } = await supabase.from('entregables_capitulo').update(datos).eq('id', req.params.id).select('*').single();
    if (error) throw error;
    res.json({ entregable: data });
  } catch (e) { fail(res, e, 'Error al actualizar el entregable'); }
});

router.delete('/entregables/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('entregables_capitulo').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { fail(res, e, 'Error al eliminar el entregable'); }
});

// ── IA: propone, NUNCA guarda ─────────────────────────────────────────
const SYSTEM_BASE = `Eres el editor de textos de Ranuse Design, estudio de diseño de espacios deportivos (gimnasios y home gyms) en España. Los textos se muestran al cliente en una historia tipo "un día en tu espacio": segunda persona del singular, presente, tono cálido y elegante, frases cortas, sin tecnicismos ni adjetivos vacíos. Responde SOLO con el texto resultante, sin comillas, títulos ni explicaciones.`;

async function textoDeClaude(system, userMsg, maxTokens = 500) {
  const response = await callClaude({ system, messages: [{ role: 'user', content: userMsg }], maxTokens });
  const bloque = (response.content || []).find(b => b.type === 'text');
  return bloque?.text?.trim() || null;
}

// Corrige un texto escrito a mano (ortografía, claridad, tono) sin cambiar
// su significado ni inventar datos.
router.post('/ia/corregir', async (req, res) => {
  try {
    const texto = txt(req.body.texto);
    if (!texto) return res.status(400).json({ error: 'No hay texto que corregir' });
    const contexto = txt(req.body.contexto);
    const system = `${SYSTEM_BASE}\nTu tarea: CORREGIR y pulir el texto que te pasa el diseñador. Corrige ortografía y gramática, mejora la claridad y el ritmo y adáptalo al tono descrito, pero conserva su significado y su longitud aproximada y NO inventes datos, cifras ni servicios que no aparezcan en el texto.`;
    const propuesta = await textoDeClaude(system, `${contexto ? `CONTEXTO: ${contexto}\n\n` : ''}TEXTO:\n${texto}`, 700);
    if (!propuesta) return res.status(502).json({ error: 'La IA no devolvió texto' });
    res.json({ original: texto, propuesta });
  } catch (e) { fail(res, e, e.message || 'Error al corregir el texto'); }
});

// Reescribe el texto de un capítulo con los datos del proyecto.
router.post('/capitulos/:id/ia-reescribir', async (req, res) => {
  try {
    const { data: cap } = await supabase.from('capitulos').select('*').eq('id', req.params.id).single();
    if (!cap) return res.status(404).json({ error: 'Capítulo no encontrado' });
    const [{ data: proyecto }, { data: servs }, { data: links }, { data: bloques }] = await Promise.all([
      supabase.from('client_projects').select('project_name, tipo_proyecto, moodboard_description, moodboard_palette').eq('id', cap.proyecto_id).single(),
      supabase.from('servicios_espacio').select('id, nombre, descripcion, etiqueta').eq('proyecto_id', cap.proyecto_id),
      supabase.from('servicio_capitulo').select('servicio_id').eq('capitulo_id', cap.id),
      supabase.from('capitulo_bloques').select('tipo, titulo, texto, elementos').eq('capitulo_id', cap.id).order('orden', { ascending: true }),
    ]);
    const { data: form } = await supabase.from('project_needs_forms').select('brief').eq('project_id', cap.proyecto_id).maybeSingle();
    const idsServ = new Set((links || []).map(l => l.servicio_id));
    const serviciosCap = (servs || []).filter(s => idsServ.has(s.id));
    const tipoTxt = proyecto?.tipo_proyecto === 'home_gym' ? 'home gym (gimnasio en casa)' : 'gimnasio comercial';

    const system = `${SYSTEM_BASE}\nTu tarea: reescribir el texto de introducción de UN capítulo (2-3 frases como máximo) con un detalle sensorial (luz, olor, sonido o tacto). Usa los datos reales del proyecto que se te pasan; si algo no está en los datos, no lo inventes.${req.body.instruccion ? `\nInstrucción adicional del diseñador: ${String(req.body.instruccion).slice(0, 400)}` : ''}`;
    const userMsg = [
      `PROYECTO: ${proyecto?.project_name || '—'} (${tipoTxt})`,
      `ESTILO / MOODBOARD: ${proyecto?.moodboard_description?.trim() || 'No hay.'}`,
      `PALETA: ${(proyecto?.moodboard_palette || []).join(', ') || 'No hay.'}`,
      `NECESIDADES DEL CLIENTE: ${form?.brief?.trim() || 'No hay.'}`,
      `CAPÍTULO: ${cap.titulo}`,
      `DETALLE SENSORIAL SUGERIDO: ${cap.sensorial || '—'}`,
      `SERVICIOS DEL CAPÍTULO: ${serviciosCap.map(s => `${s.nombre} (${s.etiqueta})${s.descripcion ? ': ' + s.descripcion : ''}`).join('; ') || 'ninguno'}`,
      `BLOQUES YA ESCRITOS: ${(bloques || []).filter(b => b.titulo || b.texto).map(b => `${b.titulo || ''} ${b.texto || ''}${b.elementos?.length ? ' [' + b.elementos.join(', ') + ']' : ''}`.trim()).join(' | ') || 'ninguno'}`,
      `TEXTO ACTUAL:\n${cap.texto || '(vacío)'}`,
    ].join('\n');
    const propuesta = await textoDeClaude(system, userMsg, 400);
    if (!propuesta) return res.status(502).json({ error: 'La IA no devolvió texto' });
    res.json({ original: cap.texto || '', propuesta });
  } catch (e) { fail(res, e, e.message || 'Error al reescribir el capítulo'); }
});

export default router;
