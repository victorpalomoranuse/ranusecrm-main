import { supabase } from '../config/supabase.js';

// Cada imagen del moodboard puede llevar una nota: QUÉ se quiere de ella (el estilo general, un detalle concreto, un material,
// un color, la iluminación, la distribución o algo que NO se quiere). Así la IA entiende por qué está esa imagen.
export const TIPOS_REFERENCIA = {
  estilo: 'Estilo general: el ambiente y la sensación de todo el espacio',
  detalle: 'Un detalle concreto de la imagen',
  material: 'Los materiales y acabados',
  color: 'Los colores',
  iluminacion: 'La iluminación',
  distribucion: 'La distribución o cómo está organizado el espacio',
  evitar: 'Lo que NO quiero (referencia a evitar)',
};

// Las imágenes del moodboard con su nota. Si la tabla aún no tiene las columnas (SQL v80), se siguen leyendo sin ellas.
export async function imagenesMoodboard(projectId, limite = 8) {
  let r = await supabase.from('project_moodboard_images').select('url, tipo, nota').eq('project_id', projectId).order('display_order', { ascending: true }).limit(limite);
  if (r.error) r = await supabase.from('project_moodboard_images').select('url').eq('project_id', projectId).order('display_order', { ascending: true }).limit(limite);
  return r.data || [];
}

// Texto de la nota de una imagen para la IA (vacío si no hay nota)
export function textoNota(img, n) {
  const tipo = TIPOS_REFERENCIA[img?.tipo] || '';
  const nota = String(img?.nota || '').trim();
  if (!tipo && !nota) return '';
  return `Imagen ${n} del moodboard${tipo ? ` · de esta imagen interesa: ${tipo}` : ''}${nota ? `\nComentario de Víctor: «${nota}»` : ''}${img?.tipo === 'evitar' ? '\n(Es una referencia a EVITAR: no copies su estilo.)' : ''}`;
}

// Bloques para la IA: cada imagen seguida de su nota. cargar(url) devuelve el bloque de imagen (o null si no se pudo leer).
export async function bloquesConNotas(imgs, cargar) {
  const salida = [];
  let n = 0;
  for (const img of imgs || []) {
    const bloque = await cargar(img.url);
    if (!bloque) continue;
    n += 1;
    salida.push(bloque);
    const t = textoNota(img, n);
    if (t) salida.push({ type: 'text', text: t });
  }
  return { bloques: salida, total: n };
}
