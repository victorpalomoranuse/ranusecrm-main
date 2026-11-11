// Biblioteca de ganadores y «cerebro» editable del estratega de redes.
// - La biblioteca guarda vídeos reales que están funcionando en el mercado (analizados a fondo) y los busca por parecido con una idea.
// - El cerebro son los catálogos y reglas que usa el estratega; vienen de fábrica y Víctor los puede editar.
import { leerJson } from './asistente-personal.js';

export const RUTA_BIB = 'crm/redes/biblioteca.json';
export const RUTA_CEREBRO = 'crm/redes/cerebro.json';

const NL = String.fromCharCode(10);
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const PARADAS = new Set(['para', 'como', 'esto', 'esta', 'este', 'tiene', 'sobre', 'cuando', 'desde', 'hasta', 'entre', 'hacer', 'video', 'videos', 'reel', 'reels', 'gimnasio', 'gimnasios', 'gym', 'gyms', 'casa', 'mi', 'tu']);

// Texto del cerebro: lo que Víctor haya editado o, si no, el de fábrica
export async function textoCerebro(clave, porDefecto) {
  try { const c = await leerJson(RUTA_CEREBRO, {}); const t = c && c[clave]; if (typeof t === 'string' && t.trim().length > 20) return t; } catch { /* se usa el de fábrica */ }
  return porDefecto;
}

// Ejemplos reales parecidos a la idea (o los que más han destacado si no hay idea)
export async function ejemplosGanadores(idea = '', n = 4) {
  try {
    const b = await leerJson(RUTA_BIB, { lista: [] }), lista = (b.lista || []).filter(x => x.analisis); if (!lista.length) return '';
    const toks = [...new Set(norm(idea).split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !PARADAS.has(w)))];
    const pun = (x) => { const t = norm([x.pie, x.analisis?.gancho?.que_se_ve, x.analisis?.gancho?.frase, x.analisis?.narrativa?.estructura, x.descripcion].join(' ')); let s = 0; for (const w of toks) if (t.includes(w)) s++; return s * 10 + Math.min(9, Number(x.ratio) || 0); };
    const top = lista.map(x => ({ x, s: pun(x) })).sort((a, c) => c.s - a.s).slice(0, n).map(o => o.x);
    const cut = (v, m) => String(typeof v === 'object' && v ? Object.values(v).join(' · ') : (v || '')).slice(0, m);
    return 'EJEMPLOS REALES QUE ESTÁN FUNCIONANDO EN EL MERCADO (vídeos de su nicho analizados a fondo; apóyate en su estructura y su forma de grabar, no los copies):' + NL + top.map(x => '- @' + x.cuenta + ' · ' + (x.vistas || '?') + ' vistas' + (x.ratio ? ' (' + x.ratio + '× lo habitual de su cuenta)' : '') + ' · gancho: ' + cut(x.analisis?.gancho, 220) + ' · estructura: ' + cut(x.analisis?.narrativa, 260) + ' · grabación: ' + cut(x.analisis?.grabacion, 200) + ' · edición: ' + cut(x.analisis?.edicion, 200)).join(NL);
  } catch { return ''; }
}

// ── Catálogos de fábrica (editables en el cerebro)
export const CATALOGO_GANCHOS = [
  'TIPOS DE GANCHO (elige el que mejor encaje con la idea y escribe la frase exacta):',
  '1) Cifra concreta: «Este gimnasio costó 14.000 € y mira en qué falló».',
  '2) Error caro: «El error que te cuesta 5.000 € al montar tu gimnasio».',
  '3) Antes y después inmediato: se enseña el resultado en el segundo 1 y luego el proceso.',
  '4) Promesa con plazo: «Cómo montar un home gym en 7 días».',
  '5) Mito roto: «Te han mentido con el suelo de tu gimnasio».',
  '6) Pregunta que duele: «¿Por qué tu gimnasio en casa no lo usas?».',
  '7) Lo que nadie cuenta: «Lo que un diseñador de gimnasios nunca te dice».',
  '8) Comparativa: «Lo que pide el cliente vs lo que puede pagar».',
  '9) Reto o apuesta: «Monto un gym completo en 60 segundos».',
  '10) Contraste de calidad: «Gimnasio de 3.000 € vs de 30.000 €».',
  '11) Reacción o puntuación: «Puntuando el gimnasio de…».',
  '12) Curiosidad específica: «3 curiosidades que no conocías de…».',
  '13) Orden directa: «Para de comprar máquinas antes de diseñar».',
  '14) Historia con giro: «El cliente me pidió X… y acabó con Y».',
  '15) POV: «POV: entrenas en el gimnasio que diseñé para un deportista».',
  'Reglas: el gancho debe entenderse sin sonido, con una cifra o una imagen fuerte; nunca empezar con saludo ni presentación.',
].join(NL);
export const CATALOGO_CTAS = [
  'LLAMADAS A LA ACCIÓN (una sola por vídeo, ligada al valor):',
  '- Palabra clave: «Comenta GYM y te mando la guía» (genera comentarios y contactos; requiere un lead magnet real).',
  '- Guardar: «Guárdalo para cuando montes tu gimnasio» (útil en listas, checklists y datos).',
  '- Compartir: «Mándaselo a quien esté montando un gimnasio» (útil en errores comunes y comparativas).',
  '- Seguir: «Sígueme para ver cómo termina» (solo si hay continuación real: series y obras en curso).',
  '- Pregunta: «¿Tú qué elegirías, A o B?» (genera conversación en opiniones y comparativas).',
  'Nunca pedir varias cosas a la vez; la CTA debe acompañar al objetivo de la pieza (comentarios, guardados, compartidos o contactos).',
].join(NL);
export const CATALOGO_SERIES = [
  'SERIES REPETIBLES (mismo formato, distinto tema; las que más se pueden grabar él solo muchas veces):',
  '- «Error de la semana»: un error típico al montar un gimnasio y cómo evitarlo (30 s, a cámara).',
  '- «Cuánto cuesta…»: el precio real de algo concreto con cifras (a cámara + pantalla).',
  '- «Antes y después en 30 s»: un espacio real o un render frente a la obra (plano fijo + transición).',
  '- «Diseño en directo»: grabación de pantalla del 3D mientras explica una decisión (pantalla + voz).',
  '- «Respondo tus preguntas»: una pregunta de DM por vídeo (selfie).',
  '- «Puntuando gimnasios»: reacción a fotos de seguidores (reacción en pantalla).',
  '- «Bastidores de la entrega»: un trozo del día de trabajo antes de entregar un proyecto.',
].join(NL);
export const CATALOGO_EMBUDO = [
  'EMBUDO Y CADENCIA (criterio de trabajo, no ley de Instagram):',
  '- Alrededor del 60 % de las piezas atraen a la audiencia amplia (curiosidad, aspiración, deporte, hogar, transformaciones, utilidad para cualquiera).',
  '- Alrededor del 25 % conectan (confianza, bastidores, historias personales, opinión).',
  '- Alrededor del 15 % convierten (lead magnet, caso real con resultado, CTA a contactos).',
  '- Cada pieza tiene UN objetivo medible: visibilidad (vistas), conversación (comentarios), valor (guardados), difusión (compartidos) o contactos.',
  '- Un reel nuevo no se juzga antes de 7 días; se compara con la mediana de los últimos 120 días, no con los virales antiguos.',
].join(NL);

// Para mostrar y editar: clave → texto de fábrica (el manual, la estructura y los formatos se pasan desde donde viven)
export function cerebroPorDefecto({ manual, estructura, formatos }) {
  return { manual, estructura, formatos_grabacion: formatos, ganchos: CATALOGO_GANCHOS, ctas: CATALOGO_CTAS, series: CATALOGO_SERIES, embudo: CATALOGO_EMBUDO };
}

// Bloque de catálogos para los prompts (ganchos, CTAs, series y embudo)
export async function catalogosParaPrompt() {
  const [g, c, s, e] = await Promise.all([textoCerebro('ganchos', CATALOGO_GANCHOS), textoCerebro('ctas', CATALOGO_CTAS), textoCerebro('series', CATALOGO_SERIES), textoCerebro('embudo', CATALOGO_EMBUDO)]);
  return [g, c, s, e].join(NL + NL);
}
