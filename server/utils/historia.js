import { supabase } from '../config/supabase.js';

export const TIPOS_PROYECTO = ['comercial', 'home_gym'];

/**
 * Copia las plantillas de un tipo ('comercial' | 'home_gym') a un proyecto:
 * capítulos, ideas de bloque (vacías), servicios sugeridos (enlazados a sus
 * capítulos) y entregables. Solo actúa si el proyecto NO tiene ya capítulos,
 * así nunca duplica ni pisa nada. `capitulosOrden` (opcional) = qué capítulos
 * de la plantilla incluir; el resto no se crea y los demás se renumeran.
 * Devuelve true si ha creado la historia.
 */
export async function crearHistoria(projectId, tipo, capitulosOrden = null, extras = []) {
  if (!TIPOS_PROYECTO.includes(tipo)) return false;

  const { count } = await supabase.from('capitulos').select('id', { count: 'exact', head: true }).eq('proyecto_id', projectId);
  if (count > 0) return false;

  const [{ data: plantillas }, { data: ideasBloque }, { data: ideasServicio }, { data: entregables }] = await Promise.all([
    supabase.from('plantillas_capitulo').select('*').eq('tipo', tipo).order('orden', { ascending: true }),
    supabase.from('plantillas_bloque').select('*').eq('tipo_proyecto', tipo).order('orden', { ascending: true }),
    supabase.from('plantillas_servicio').select('*').eq('tipo_proyecto', tipo),
    supabase.from('plantillas_entregable').select('*').eq('tipo', tipo).order('orden', { ascending: true }),
  ]);

  const elegidas = (plantillas || []).filter(p => !Array.isArray(capitulosOrden) || capitulosOrden.length === 0 || capitulosOrden.includes(p.orden));
  if (!elegidas.length) return false;

  const { data: capsCreados, error: errCaps } = await supabase.from('capitulos').insert(
    elegidas.map((p, i) => ({
      proyecto_id: projectId,
      orden: i + 1,
      titulo: p.titulo,
      texto: p.texto_base,
      sensorial: p.sensorial || null,
      origen: 'plantilla',
    }))
  ).select('id, orden');
  if (errCaps) throw errCaps;

  // orden de la plantilla -> id del capítulo creado
  const idPorOrdenPlantilla = {};
  elegidas.forEach((p, i) => { idPorOrdenPlantilla[p.orden] = capsCreados.find(c => c.orden === i + 1).id; });

  const bloques = (ideasBloque || []).filter(b => idPorOrdenPlantilla[b.capitulo_orden]).map(b => ({
    proyecto_id: projectId,
    capitulo_id: idPorOrdenPlantilla[b.capitulo_orden],
    orden: b.orden,
    tipo: b.tipo,
    titulo: b.titulo,
    guia: b.guia || null,
  }));
  if (bloques.length) await supabase.from('capitulo_bloques').insert(bloques);

  for (const [idx, s] of (ideasServicio || []).entries()) {
    const destinos = (s.capitulos_orden || []).filter(o => idPorOrdenPlantilla[o]);
    if (!destinos.length) continue;
    const { data: serv } = await supabase.from('servicios_espacio').insert({
      proyecto_id: projectId, nombre: s.nombre, guia: s.guia || null, etiqueta: s.etiqueta || 'incluido', orden: idx,
    }).select('id').single();
    if (serv) {
      await supabase.from('servicio_capitulo').insert(destinos.map((o, i) => ({ servicio_id: serv.id, capitulo_id: idPorOrdenPlantilla[o], orden: i })));
    }
  }

  const ents = (entregables || [])
    .filter(e => e.capitulo_orden === 0 || idPorOrdenPlantilla[e.capitulo_orden])
    .map(e => ({
      proyecto_id: projectId,
      capitulo_id: e.capitulo_orden === 0 ? null : idPorOrdenPlantilla[e.capitulo_orden],
      orden: e.orden,
      nombre: e.nombre,
      descripcion: e.descripcion || null,
      formato: e.formato || null,
      visible_cliente: e.visible_cliente,
      opcional: e.opcional,
    }));
  if (ents.length) await supabase.from('entregables_capitulo').insert(ents);

  // Capítulos extra elegidos al crear (zona de grabación, boxeo...)
  for (const extraId of Array.isArray(extras) ? extras : []) {
    await anadirCapituloExtra(projectId, extraId).catch(e => console.error('Capítulo extra:', e.message));
  }

  return true;
}

/**
 * Añade a un proyecto un capítulo del catálogo de extras (zona de grabación,
 * boxeo, yoga...). Se coloca antes del último capítulo (el cierre) si ya hay
 * varios, y se crean sus bloques sugeridos vacíos.
 */
export async function anadirCapituloExtra(projectId, extraId) {
  const { data: extra } = await supabase.from('plantillas_capitulo_extra').select('*').eq('id', extraId).single();
  if (!extra) throw new Error('Capítulo extra no encontrado');
  const { data: caps } = await supabase.from('capitulos').select('id, orden').eq('proyecto_id', projectId).order('orden', { ascending: true });
  const lista = caps || [];
  let orden = (lista[lista.length - 1]?.orden || 0) + 1;
  if (lista.length >= 2) {
    const cierre = lista[lista.length - 1];
    orden = cierre.orden;
    await supabase.from('capitulos').update({ orden: cierre.orden + 1 }).eq('id', cierre.id);
  }
  const { data: nuevo, error } = await supabase.from('capitulos').insert({
    proyecto_id: projectId, orden, titulo: extra.titulo, texto: extra.texto_base, sensorial: extra.sensorial || null, origen: 'plantilla',
  }).select('*').single();
  if (error) throw error;
  const bloques = (Array.isArray(extra.bloques) ? extra.bloques : []).map((b, i) => ({
    proyecto_id: projectId, capitulo_id: nuevo.id, orden: i, tipo: b.tipo || 'imagen_texto', titulo: b.titulo || null, guia: b.guia || null,
  }));
  if (bloques.length) await supabase.from('capitulo_bloques').insert(bloques);
  return nuevo;
}

/**
 * Historia completa de un proyecto para el admin (todo, incluidas guías
 * internas, entregables internos y capítulos ocultos).
 */
export async function getHistoriaAdmin(projectId) {
  const [{ data: proyecto }, { data: capitulos }, { data: bloques }, { data: servicios }, { data: enlaces }, { data: entregables }] = await Promise.all([
    supabase.from('client_projects').select('id, tipo_proyecto').eq('id', projectId).single(),
    supabase.from('capitulos').select('*').eq('proyecto_id', projectId).order('orden', { ascending: true }),
    supabase.from('capitulo_bloques').select('*').eq('proyecto_id', projectId).order('orden', { ascending: true }),
    supabase.from('servicios_espacio').select('*').eq('proyecto_id', projectId).order('orden', { ascending: true }),
    supabase.from('servicio_capitulo').select('servicio_id, capitulo_id, orden'),
    supabase.from('entregables_capitulo').select('*').eq('proyecto_id', projectId).order('orden', { ascending: true }),
  ]);
  const idsServ = new Set((servicios || []).map(s => s.id));
  const links = (enlaces || []).filter(l => idsServ.has(l.servicio_id));
  return {
    tipo_proyecto: proyecto?.tipo_proyecto || null,
    capitulos: capitulos || [],
    bloques: bloques || [],
    servicios: (servicios || []).map(s => ({ ...s, capitulos: links.filter(l => l.servicio_id === s.id).map(l => l.capitulo_id) })),
    entregables: entregables || [],
  };
}

/**
 * Historia para el portal del cliente. Devuelve null si el proyecto no tiene
 * capítulos (proyectos antiguos): el portal entonces no cambia en nada.
 * Nunca incluye guías internas, bloques vacíos, capítulos ocultos ni
 * entregables no marcados como visibles / sin archivo.
 */
export async function getHistoriaPublica(projectId) {
  const { data: capitulos } = await supabase.from('capitulos').select('*').eq('proyecto_id', projectId).eq('visible', true).order('orden', { ascending: true });
  if (!capitulos || !capitulos.length) return null;
  const h = await getHistoriaAdmin(projectId);
  const idsVisibles = new Set(capitulos.map(c => c.id));

  const bloques = h.bloques.filter(b => b.visible && idsVisibles.has(b.capitulo_id) && (b.texto?.trim() || b.imagen_url || b.tipo === 'equipo' || (b.tipo === 'galeria' && b.elementos?.length)));
  const serviciosVisibles = h.servicios.filter(s => s.nombre && (s.descripcion?.trim() || s.imagen_url));

  // Estilo definido a partir del moodboard (columnas v61; si no existen aún, null)
  const { data: est } = await supabase.from('client_projects').select('moodboard_estilo_nombre, moodboard_estilo').eq('id', projectId).maybeSingle();
  const estilo = est?.moodboard_estilo?.trim() ? { nombre: est.moodboard_estilo_nombre || null, texto: est.moodboard_estilo } : null;
  // Plano de distribución con recorrido (columnas v65; si no existen aún, null)
  const { data: pl } = await supabase.from('client_projects').select('plano_imagen_url, plano_texto').eq('id', projectId).maybeSingle();
  const plano = pl?.plano_imagen_url ? { imagen_url: pl.plano_imagen_url, texto: pl.plano_texto || null } : null;

  return {
    tipo_proyecto: h.tipo_proyecto,
    estilo,
    plano,
    capitulos: capitulos.map(c => ({
      id: c.id, orden: c.orden, titulo: c.titulo, texto: c.texto, render_url: c.render_url, tour_url: c.tour_url,
      bloques: bloques.filter(b => b.capitulo_id === c.id).map(({ guia, proyecto_id, ...b }) => b),
      servicios: serviciosVisibles.filter(s => s.capitulos.includes(c.id)).map(s => ({
        id: s.id, nombre: s.nombre, descripcion: s.descripcion, imagen_url: s.imagen_url, etiqueta: s.etiqueta,
      })),
    })),
    entregables: h.entregables
      .filter(e => e.visible_cliente && e.archivo_url && (e.capitulo_id === null || idsVisibles.has(e.capitulo_id)))
      .map(e => ({ id: e.id, capitulo_id: e.capitulo_id, nombre: e.nombre, descripcion: e.descripcion, formato: e.formato, archivo_url: e.archivo_url })),
  };
}
