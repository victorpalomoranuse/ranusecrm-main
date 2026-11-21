// Vídeos de la guía de Home Gym (los graba Víctor): cada uno se enseña solo a los clientes a los que les toca según su caso.
// Se guardan en un archivo JSON del almacenamiento (igual que los modelos 3D de la biblioteca), sin tablas nuevas.
import { supabase } from '../config/supabase.js';

const BUCKET = 'project-documents';
const RUTA = 'homegym/videos.json';
let cache = null, cacheT = 0;

// Etiquetas posibles: la herramienta calcula las del cliente y enseña los vídeos que tengan alguna (o «siempre»)
export const ETIQUETAS = {
  siempre: 'Para todos',
  sala_pequena: 'Sala pequeña (menos de 9 m²)', sala_media: 'Sala media (9–16 m²)', sala_grande: 'Sala grande (más de 16 m²)',
  techo_bajo: 'Techo bajo (menos de 2,40 m)',
  tipo_garaje: 'Garaje', tipo_habitacion: 'Habitación', tipo_sotano: 'Sótano', tipo_trastero: 'Trastero',
  objetivo_fuerza: 'Objetivo fuerza', objetivo_cardio: 'Objetivo cardio', objetivo_mixto: 'Objetivo mixto', objetivo_func: 'Objetivo funcional',
  varias_personas: 'Entrenan varias personas',
  con_rack: 'Lleva rack', con_banco: 'Lleva banco', con_discos: 'Lleva barra y discos', con_mancu: 'Lleva mancuernas', con_polea: 'Lleva polea',
  con_cinta: 'Lleva cinta', con_bici: 'Lleva bici', con_remo: 'Lleva remo', con_kettle: 'Lleva kettlebells', con_cajon: 'Lleva cajón',
};

// Lista de partida para que Víctor solo tenga que ir grabando y pegando el enlace (todos desactivados hasta que tengan enlace)
export const VIDEOS_SUGERIDOS = [
  ['Cómo usar esta herramienta y tu pack', 'siempre', 'Una vuelta rápida por todo lo que incluye tu oferta.'],
  ['Cómo medir tu sala bien (y los errores típicos)', 'siempre', ''],
  ['Suelo: qué poner y cuánto cuesta', 'siempre', ''],
  ['Electricidad, ventilación e iluminación', 'siempre', ''],
  ['Cómo comprar sin intermediarios y comparar precios', 'siempre', ''],
  ['Montaje: qué hacer tú y qué dejar a un montador', 'siempre', ''],
  ['Montar un gym en un garaje: qué cuidar', 'tipo_garaje', ''],
  ['Montar un gym en una habitación', 'tipo_habitacion', ''],
  ['Techo bajo: qué máquinas sí y cuáles no', 'techo_bajo', ''],
  ['Sala pequeña: cómo sacarle partido', 'sala_pequena', ''],
  ['Sala grande: cómo repartir las zonas', 'sala_grande', ''],
  ['Gym de fuerza: rack, banco y discos', 'objetivo_fuerza', ''],
  ['Gym de cardio: cinta, bici y remo', 'objetivo_cardio', ''],
  ['Gym mixto: cómo combinar fuerza y cardio', 'objetivo_mixto', ''],
  ['Gym funcional: qué necesitas de verdad', 'objetivo_func', ''],
  ['Entrenar varias personas a la vez', 'varias_personas', ''],
  ['Cómo elegir el rack', 'con_rack', ''],
  ['Cómo elegir una cinta (y no molestar a los vecinos)', 'con_cinta', ''],
].map(([titulo, etiqueta, descripcion], i) => ({ id: 'v' + (i + 1), titulo, descripcion, url: '', etiquetas: [etiqueta], orden: i + 1, activo: false }));

export async function leerVideos() {
  if (cache && Date.now() - cacheT < 20 * 1000) return cache;
  try {
    const url = supabase.storage.from(BUCKET).getPublicUrl(RUTA).data.publicUrl;
    const r = await fetch(url + '?t=' + Date.now(), { headers: { 'cache-control': 'no-cache' } });
    if (r.ok) { const j = await r.json(); cache = Array.isArray(j) ? j : VIDEOS_SUGERIDOS; }
    else cache = VIDEOS_SUGERIDOS; // todavía no hay archivo: se enseña la lista sugerida (en el CRM)
  } catch { cache = cache || VIDEOS_SUGERIDOS; }
  cacheT = Date.now();
  return cache;
}

export async function guardarVideos(lista) {
  const { error } = await supabase.storage.from(BUCKET).upload(RUTA, Buffer.from(JSON.stringify(lista)), { contentType: 'application/json', upsert: true, cacheControl: '0' });
  if (!error) { cache = lista; cacheT = Date.now(); }
  return { error };
}

// Convierte un enlace de YouTube, Vimeo o Google Drive en la dirección para incrustarlo. Devuelve null si no es de uno de esos sitios.
export function aEmbed(enlace) {
  let u; try { u = new URL(String(enlace || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const h = u.hostname.replace(/^www\./, '');
  if (h === 'youtu.be') { const id = u.pathname.slice(1).split('/')[0]; return /^[\w-]{6,20}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null; }
  if (h === 'youtube.com' || h === 'm.youtube.com') {
    const id = u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{6,20})/) || [])[1];
    return id && /^[\w-]{6,20}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  }
  if (h === 'vimeo.com' || h === 'player.vimeo.com') {
    const m = u.pathname.match(/(\d{5,12})(?:\/([0-9a-f]{6,20}))?/); if (!m) return null;
    const hash = m[2] || u.searchParams.get('h');
    return `https://player.vimeo.com/video/${m[1]}${hash ? '?h=' + hash : ''}`;
  }
  if (h === 'drive.google.com') { const m = u.pathname.match(/\/file\/d\/([\w-]{10,80})/); return m ? `https://drive.google.com/file/d/${m[1]}/preview` : null; }
  return null;
}
