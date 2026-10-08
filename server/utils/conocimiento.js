import { supabase } from '../config/supabase.js';

// Biblioteca de conocimiento de las IA: PDFs (apuntes del curso de reformas,
// normativa, guías...) troceados y con búsqueda de texto completo. La IA no
// "memoriza" los PDFs: los consulta cuando una pregunta lo necesita, igual
// que haría una persona con sus apuntes.

export const ASISTENTES_CONOCIMIENTO = ['presupuestos', 'proyecto'];

const PARO = new Set(['para', 'como', 'cual', 'cuales', 'esta', 'este', 'estos', 'estas', 'sobre', 'entre', 'desde', 'hasta', 'cuando', 'donde', 'porque', 'pero', 'tiene', 'tienen', 'puede', 'pueden', 'hace', 'hacer', 'debe', 'deben', 'segun', 'cada', 'otro', 'otra', 'unos', 'unas', 'algo', 'todo', 'toda', 'todos', 'todas', 'mas', 'muy', 'con', 'los', 'las', 'del', 'una', 'que', 'por']);

// Convierte una pregunta en una consulta "palabra | palabra | palabra" segura para to_tsquery
export function consultaDesdeTexto(texto) {
  const palabras = String(texto || '').toLowerCase().normalize('NFC')
    .replace(/[^a-záéíóúüñ0-9\s]/g, ' ').split(/\s+/)
    .filter(p => p.length > 3 && !PARO.has(p.normalize('NFD').replace(/[̀-ͯ]/g, '')));
  return [...new Set(palabras)].slice(0, 12).join(' | ');
}

export async function buscarConocimiento(texto, asistente, limite = 6) {
  const consulta = consultaDesdeTexto(texto);
  if (!consulta) return [];
  const { data, error } = await supabase.rpc('buscar_conocimiento', { consulta, asistente, limite });
  if (error) throw error;
  return data || [];
}

// ── Herramienta que se le da a las IA ──────────────────────────────────
export const TOOL_CONOCIMIENTO = {
  name: 'consultar_conocimiento',
  description: 'Consulta la BIBLIOTECA DE CONOCIMIENTO de Ranuse: los apuntes del curso de reformas y construcción de Víctor (rehabilitación, patologías, instalaciones, materiales, partidas, normativa, procesos de obra...). Úsala siempre que la pregunta sea técnica de obra, reformas, materiales, instalaciones, normativa, plazos o procesos constructivos, ANTES de contestar de memoria. Devuelve los fragmentos más relevantes con su documento y página. Si no encuentra nada relevante, dilo y responde con tu criterio general avisando de que no sale en los apuntes.',
  input_schema: {
    type: 'object',
    properties: {
      consulta: { type: 'string', description: 'Palabras clave de lo que buscas (3-8 palabras), p. ej. "humedades capilaridad tratamiento muro" o "aislamiento térmico fachada SATE".' },
    },
    required: ['consulta'],
  },
};

export async function ejecutarConsultaConocimiento(input, asistente) {
  try {
    const frag = await buscarConocimiento(input?.consulta, asistente, 6);
    if (!frag.length) return { encontrado: false, mensaje: 'No hay nada relevante en la biblioteca para esa consulta. Prueba con otras palabras clave o responde con tu criterio general avisando de que no sale en los apuntes.' };
    return { encontrado: true, fragmentos: frag.map(f => ({ documento: f.documento, pagina: f.pagina, texto: f.texto })) };
  } catch (e) {
    console.error('Error al consultar la biblioteca:', e.message);
    return { encontrado: false, error: 'La biblioteca no está disponible ahora mismo.' };
  }
}

// ── Ingesta de un PDF ya convertido a texto por página ─────────────────
const OBJETIVO = 1300; // caracteres por fragmento (≈ 300 palabras)

function limpiarPagina(t) {
  return String(t || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ')
    .replace(/\n(?=[a-záéíóúñ,;(])/g, ' ') // unir líneas partidas a mitad de frase
    .replace(/\n{3,}/g, '\n\n').trim();
}

export function trocear(paginas) {
  const fragmentos = [];
  let buf = '';
  let pagBuf = null;
  const volcar = () => { if (buf.trim().length > 40) fragmentos.push({ pagina: pagBuf, texto: buf.trim() }); buf = ''; pagBuf = null; };
  paginas.forEach((txt, i) => {
    const pagina = i + 1;
    for (const parrafo of limpiarPagina(txt).split(/\n{1,}/)) {
      const p = parrafo.trim();
      if (!p) continue;
      if (pagBuf === null) pagBuf = pagina;
      if (buf.length + p.length > OBJETIVO && buf.length > 300) volcar(), pagBuf = pagina;
      buf += (buf ? '\n' : '') + p;
    }
  });
  volcar();
  return fragmentos;
}

export async function ingestarDocumento({ titulo, fuente, paginas, asistentes = ASISTENTES_CONOCIMIENTO }) {
  const fragmentos = trocear(paginas);
  if (!fragmentos.length) throw new Error('No se ha podido extraer texto de ese PDF (¿es un escaneo/imagen?).');
  const { data: doc, error } = await supabase.from('ia_conocimiento_docs').insert({
    titulo, fuente: fuente || null, num_paginas: paginas.length, num_fragmentos: fragmentos.length, asistentes,
  }).select('*').single();
  if (error) throw error;
  const filas = fragmentos.map((f, i) => ({ doc_id: doc.id, orden: i, pagina: f.pagina, texto: f.texto }));
  for (let i = 0; i < filas.length; i += 100) {
    const { error: e2 } = await supabase.from('ia_conocimiento_fragmentos').insert(filas.slice(i, i + 100));
    if (e2) { await supabase.from('ia_conocimiento_docs').delete().eq('id', doc.id); throw e2; }
  }
  return doc;
}
