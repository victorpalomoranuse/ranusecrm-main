// Modelos 3D de las piezas de la biblioteca propia (ids «bib-…»). La tabla biblioteca_bloques no tiene columna para ellos,
// así que se guardan en un pequeño archivo JSON del almacenamiento: { "bib-<id>": { url, tipo, rot, … } }
import { supabase } from '../config/supabase.js';

const BUCKET = 'project-documents';
const RUTA = 'modelos-3d/_biblioteca.json';
let cache = null, cacheT = 0;

export async function leerModelosBib() {
  if (cache && Date.now() - cacheT < 30 * 1000) return cache;
  try {
    const { data, error } = await supabase.storage.from(BUCKET).download(RUTA);
    if (error || !data) { cache = cache || {}; }
    else { const j = JSON.parse(await data.text()); cache = j && typeof j === 'object' ? j : {}; }
  } catch { cache = cache || {}; }
  cacheT = Date.now();
  return cache;
}

// modelo3d = null quita el modelo de esa pieza. Devuelve { error } como Supabase.
export async function guardarModeloBib(id, modelo3d) {
  cacheT = 0;
  const todo = { ...(await leerModelosBib()) };
  if (modelo3d) todo[id] = modelo3d; else delete todo[id];
  const { error } = await supabase.storage.from(BUCKET).upload(RUTA, Buffer.from(JSON.stringify(todo)), { contentType: 'application/json', upsert: true, cacheControl: '0' });
  if (!error) { cache = todo; cacheT = Date.now(); }
  return { error };
}
