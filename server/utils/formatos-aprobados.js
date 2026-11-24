// Solo parámetros reutilizables: nunca índices de palabras, archivos ni prompts del tema anterior.
const CLAVES = ['corte', 'acento', 'zoomFinal', 'whoosh', 'flash', 'subs', 'titulo', 'barra', 'mayusculas', 'resaltar', 'fuente', 'musica', 'encuadre', 'encuadreZoom', 'subsBajoCara', 'graficos', 'pausa', 'limpiar', 'cambioCada', 'director', 'cambiosEnFrases', 'intensidad', 'ilustraciones', 'estiloSubs', 'preguntaSoloEscrita', 'superposicion', 'cortesAutomaticos'];
export function crearFormatoAprobado(t, nombre, reglas = '') {
  if (!t || t.estado !== 'listo' || !(t.resultado || t.resultado_gcs)) throw new Error('Aprueba un vídeo terminado, después de verlo.');
  if (!['bruto', 'clips', 'youtube'].includes(t.tipo)) throw new Error('Por ahora puedes guardar formatos de vídeos a cámara, entrevistas y YouTube.');
  if (!String(nombre || '').trim()) throw new Error('Pon un nombre al formato.');
  if (t.receta?.ilustracionesFijas?.length || t.superposiciones_manuales) throw new Error('Esta prueba tiene superposiciones preparadas para ese vídeo. Primero debemos validar una prueba con superposiciones automáticas para guardar un formato reproducible.');
  const receta = Object.fromEntries(CLAVES.filter(k => t.receta?.[k] !== undefined).map(k => [k, structuredClone(t.receta[k])]));
  return { nombre: String(nombre).trim().slice(0, 100), trabajo_id: t.id, trabajo_version: t.version || 1, tipo: t.tipo, receta, musica: t.musica === 'ninguna' ? 'ninguna' : (t.musica_usada || t.musica || 'auto'), reglas: [t.reglas, String(reglas).trim().slice(0, 2000)].filter(Boolean).join('\n'), num_clips: t.num_clips, dur_min: t.dur_min, dur_max: t.dur_max, objetivo_segundos: t.objetivo_segundos, creado: new Date().toISOString() };
}
export function aplicarFormatoAprobado(p, b) {
  // El cliente solo aporta el material nuevo. La configuración sale de la copia aprobada.
  return { plantilla_id: p.id, tipo: p.tipo, archivo: b.archivo, fuentes: b.fuentes, base: b.base, nombre_archivo: b.nombre_archivo, musica: p.musica, indicaciones: p.tipo === 'youtube' ? p.reglas : '', guion: '', num_clips: p.num_clips, dur_min: p.dur_min, dur_max: p.dur_max, objetivo_segundos: p.objetivo_segundos };
}
