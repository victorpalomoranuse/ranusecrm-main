// Historias de Instagram con el asistente personal: secuencias para vender o para generar engagement, escritas con la voz de Víctor y basadas en lo que de verdad hace
// (agenda, obras, proyectos, diario, memoria). Aprende cómo habla Víctor y guarda los planes para verlos en el CRM.
import crypto from 'crypto';
import { callClaude } from './anthropic.js';

const RUTA_HIST = 'crm/asistente/historias.json';
const RUTA_VOZ = 'crm/asistente/voz.json';
const RUTA_MEM = 'crm/asistente/memoria.json';
const RUTA_CHARLA = 'crm/asistente/charla.json';
const RUTA_DIARIO = 'crm/asistente/diario.json';
const RUTA_REGLAS_VIDEO = 'crm/estudio-video/reglas.json';
const RUTA_EDITOR = 'crm/estudio-video/editor.json';

let leer = async (_r, d) => d, guardar = async () => {}, herramienta = async () => ({});
export function ponAlmacenHistorias(l, g, h) { leer = l; guardar = g; herramienta = h; }

export const TOOLS_HISTORIAS = [
  { name: 'crear_secuencia_historias', description: 'Crea una secuencia de historias de Instagram (de 1 día o de varios) con foto o vídeo a hacer en cada historia, texto en pantalla, guion hablado con la voz de Víctor y stickers. Usa lo que Víctor hace de verdad (agenda, obras, proyectos, diario). objetivo: "vender", "engagement", "autoridad", "bastidores", "lanzamiento" o texto libre. Úsala cuando pida historias, una secuencia, qué subir hoy/mañana o cómo vender algo por Instagram. La respuesta a Víctor debe ser corta: una línea por historia; ofrece el PDF.', input_schema: { type: 'object', properties: { objetivo: { type: 'string' }, tema: { type: 'string', description: 'de qué va (un proyecto, un producto, una obra, una idea…); si no lo dice, deduce de su día' }, fecha: { type: 'string', description: 'día en que se publica AAAA-MM-DD (por defecto hoy)' }, num_historias: { type: 'integer' }, dias: { type: 'integer', description: 'si quiere un plan de varios días (1-7)' }, indicaciones: { type: 'string' } }, required: ['objetivo'] } },
  { name: 'ver_historias', description: 'Muestra las últimas secuencias de historias que has preparado (por si Víctor pide recordarlas o repetirlas).', input_schema: { type: 'object', properties: { cuantas: { type: 'integer' } } } },
  { name: 'guardar_mi_voz', description: 'Guarda cómo habla Víctor para escribir guiones con su voz: una frase real suya (muestra) y/o un rasgo de su forma de hablar ("dice ojo al empezar", "frases cortas", "no usa emojis"). Úsala sola cuando notes algo representativo en cómo se expresa o cuando te corrija un guion.', input_schema: { type: 'object', properties: { muestra: { type: 'string' }, rasgo: { type: 'string' } } } },
];
export const HISTORIAS_NOMBRES = new Set(TOOLS_HISTORIAS.map(t => t.name));

const limpia = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

// Muestras reales de cómo escribe Víctor (sus mensajes al asistente, sin lo privado) + lo que ya se ha guardado de su voz
async function vozDeVictor() {
  const v = await leer(RUTA_VOZ, { muestras: [], rasgos: [] });
  let reales = [];
  try {
    const ch = await leer(RUTA_CHARLA, {});
    for (const [k, l] of Object.entries(ch)) { if (k.startsWith('_') || !Array.isArray(l)) continue; reales.push(...l.filter(m => m.role === 'user' && !m.privado && typeof m.content === 'string').map(m => m.content.replace(/^\[[^\]]*\]\s*/, '')).filter(t => t.length > 45 && t.length < 400 && !/^\[Aviso/.test(t))); }
  } catch { /* sin conversación */ }
  return { muestras: [...(v.muestras || []).slice(-25), ...reales.slice(-25)].slice(-40), rasgos: (v.rasgos || []).slice(-25) };
}

async function contextoDeSuDia() {
  const piezas = [];
  const ok = async (nombre, input) => { try { return await herramienta(nombre, input); } catch { return null; } };
  const ag = await ok('agenda_de_hoy', {}); if (ag && !ag.error) piezas.push('AGENDA DE HOY: ' + JSON.stringify(ag).slice(0, 2200));
  const ev = await ok('listar_eventos', { dias: 10 }); if (ev && !ev.error) piezas.push('EVENTOS PRÓXIMOS (10 días): ' + JSON.stringify(ev).slice(0, 1800));
  const pr = await ok('listar_proyectos', {}); if (pr && !pr.error) piezas.push('PROYECTOS EN MARCHA: ' + JSON.stringify((pr.proyectos || []).map(p => ({ nombre: p.nombre, cliente: p.cliente, fase: p.fase }))).slice(0, 1800));
  try { const d = await leer(RUTA_DIARIO, { entradas: [] }); const e = (d.entradas || []).slice(-8).map(x => x.fecha + ': ' + x.resumen); if (e.length) piezas.push('SU DIARIO RECIENTE:\n' + e.join('\n')); } catch { /* sin diario */ }
  try { const m = await leer(RUTA_MEM, { hechos: [] }); const h = (m.hechos || []).slice(-45).map(x => '- ' + x.texto); if (h.length) piezas.push('LO QUE SABES DE ÉL Y DE SU TRABAJO:\n' + h.join('\n')); } catch { /* sin memoria */ }
  try { const r = await leer(RUTA_REGLAS_VIDEO, null); if (r?.texto) piezas.push('VOZ Y REGLAS DE MARCA DE RANUSE:\n' + String(r.texto).slice(0, 1800)); } catch { /* sin reglas */ }
  try { const e = await leer(RUTA_EDITOR, null); const h = (e?.hechos || []).slice(-25).map(x => '- ' + x.texto); if (h.length) piezas.push('PREFERENCIAS DE CONTENIDO QUE YA HA DICHO:\n' + h.join('\n')); } catch { /* sin editor */ }
  return piezas.join('\n\n');
}

export async function ejecutarHistorias(nombre, input, { fecha }) {
  if (nombre === 'guardar_mi_voz') {
    const v = await leer(RUTA_VOZ, { muestras: [], rasgos: [] }); const m = limpia(input.muestra, 400), r = limpia(input.rasgo, 160);
    if (!m && !r) return { error: 'Dame una frase suya o un rasgo.' };
    if (m && !v.muestras.includes(m)) v.muestras.push(m); if (r && !v.rasgos.includes(r)) v.rasgos.push(r);
    v.muestras = v.muestras.slice(-60); v.rasgos = v.rasgos.slice(-40); await guardar(RUTA_VOZ, v);
    return { guardado: true, muestras: v.muestras.length, rasgos: v.rasgos.length };
  }
  if (nombre === 'ver_historias') {
    const h = await leer(RUTA_HIST, { planes: [] }); const n = Math.max(1, Math.min(5, Math.round(Number(input.cuantas)) || 2));
    return { planes: (h.planes || []).slice(-n).reverse().map(p => ({ id: p.id, titulo: p.titulo, objetivo: p.objetivo, cuando: p.cuando, historias: (p.historias || []).map(x => x.n + ') ' + x.formato + ': ' + x.grabar) })) };
  }
  // crear_secuencia_historias
  const objetivo = limpia(input.objetivo, 160) || 'engagement', tema = limpia(input.tema, 300), indic = limpia(input.indicaciones, 500);
  const dias = Math.max(1, Math.min(7, Math.round(Number(input.dias)) || 1)), num = Math.max(3, Math.min(10, Math.round(Number(input.num_historias)) || (dias > 1 ? 4 : 6)));
  const cuando = /^\d{4}-\d{2}-\d{2}$/.test(input.fecha || '') ? input.fecha : fecha;
  const [voz, dia] = await Promise.all([vozDeVictor(), contextoDeSuDia()]);
  const system = 'Eres el estratega de Instagram de Víctor Palomo, fundador de Ranuse Design (diseño y montaje de gimnasios, home gyms y espacios deportivos). Eres experto en HISTORIAS de Instagram que generan engagement y que venden, y en contar el día a día de un profesional de obra y diseño de forma que la gente se quede, responda y escriba por mensaje directo.\n\n' +
    'CÓMO CONSTRUYES UNA SECUENCIA:\n- Entre ' + num + ' historias por día (máx. 15 s cada una), UNA idea por historia. La primera para el pulgar (gancho visual + texto que abre una pregunta o promete algo); la última cierra con UNA sola llamada a la acción (sticker, mensaje directo, enlace o encuesta) ligada al objetivo.\n' +
    '- Para VENDER: gancho → problema real del cliente → prueba (obra, antes/después, dato real) → cómo se resuelve → oferta o siguiente paso. Para ENGAGEMENT: preguntas, encuestas, quiz, «cajas» de preguntas, opiniones con carácter, bastidores, errores comunes. Para AUTORIDAD: criterio de experto y porqués. Alterna formatos (foto, vídeo a cámara, boomerang, texto sobre fondo, captura, encuesta, caja de preguntas, slider, cuenta atrás) para que no sea monótono.\n' +
    '- Todo parte de lo REAL de su día (agenda, obras, proyectos, diario): no inventes proyectos, clientes, cifras, resultados ni testimonios. Si falta material, di qué tiene que sacar o qué te tiene que contar. Anonimiza a los clientes salvo permiso.\n' +
    '- Para cada historia: QUÉ FOTO O VÍDEO sacar (qué se ve, cómo encuadrarlo, desde dónde, cuánto dura), el TEXTO EN PANTALLA (corto) y, si habla, el GUION HABLADO con SU voz: primera persona, frases cortas, directo, como habla él (usa las muestras), sin jerga de marketing, sin exclamaciones vacías y sin emojis salvo que él los use.\n' +
    '- Piensa en el día concreto: «este día tal vas a subir esta historia, sacas una foto así, luego así…».\n\nRESPONDE SOLO JSON: {"titulo":"","objetivo":"","resumen":"1-2 frases de la idea de la secuencia","mejor_hora":"","dias":[{"fecha":"AAAA-MM-DD","historias":[{"n":1,"formato":"foto|vídeo|boomerang|texto|encuesta|caja de preguntas|quiz|slider|cuenta atrás|captura","grabar":"qué sacar y cómo","texto_pantalla":"","guion_hablado":"","sticker":"tipo y texto o vacío","para_que":"qué consigue esta historia"}]}],"consejos":["máx. 3"]}';
  const usuario = 'OBJETIVO: ' + objetivo + (tema ? '\nTEMA: ' + tema : '\nTEMA: deduce el mejor tema de lo que hace estos días') + '\nDÍA DE PUBLICACIÓN: ' + cuando + (dias > 1 ? ' (plan de ' + dias + ' días desde esa fecha, ' + num + ' historias por día)' : '') + (indic ? '\nINDICACIONES: ' + indic : '') +
    '\n\n' + (dia || '(No tengo datos de su día: pídele que te cuente qué hace.)') +
    '\n\nCÓMO HABLA VÍCTOR (muestras reales y rasgos):\n' + (voz.rasgos.length ? 'Rasgos: ' + voz.rasgos.join('; ') + '\n' : '') + (voz.muestras.length ? voz.muestras.map(m => '«' + m + '»').join('\n') : '(todavía no tengo muestras: usa un tono cercano, directo, de profesional de obra, y deja el guion corto para que lo adapte)');
  const r = await callClaude({ system, messages: [{ role: 'user', content: usuario }], maxTokens: 6000 });
  const txt = (r.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  let j; try { j = JSON.parse(/\{[\s\S]*\}/.exec(txt)[0]); } catch { return { error: 'No he podido montar la secuencia, repítemelo.' }; }
  const dd = (Array.isArray(j.dias) ? j.dias : []).slice(0, dias).map((d, k) => ({ fecha: /^\d{4}-\d{2}-\d{2}$/.test(d?.fecha || '') ? d.fecha : cuando, historias: (Array.isArray(d?.historias) ? d.historias : []).slice(0, 12).map((x, i) => ({ n: Number(x?.n) || i + 1, formato: limpia(x?.formato, 40), grabar: limpia(x?.grabar, 400), texto: limpia(x?.texto_pantalla, 160), hablado: limpia(x?.guion_hablado, 500), sticker: limpia(x?.sticker, 160), para_que: limpia(x?.para_que, 200) })) }));
  if (!dd.length || !dd[0].historias.length) return { error: 'La secuencia ha salido vacía, prueba otra vez.' };
  const plan = { id: crypto.randomUUID().slice(0, 6), creado: new Date().toISOString(), objetivo: limpia(j.objetivo, 80) || objetivo, titulo: limpia(j.titulo, 120) || 'Secuencia de historias', resumen: limpia(j.resumen, 400), mejor_hora: limpia(j.mejor_hora, 80), cuando, dias: dd, consejos: (Array.isArray(j.consejos) ? j.consejos : []).slice(0, 3).map(x => limpia(x, 200)) };
  const h = await leer(RUTA_HIST, { planes: [] }); h.planes = [...(h.planes || []), plan].slice(-40); await guardar(RUTA_HIST, h);
  return { creada: true, id: plan.id, titulo: plan.titulo, resumen: plan.resumen, mejor_hora: plan.mejor_hora, dias: plan.dias.map(d => ({ fecha: d.fecha, historias: d.historias.map(x => x.n + ') ' + x.formato + ' — ' + x.grabar + (x.texto ? ' · texto: «' + x.texto + '»' : '') + (x.sticker ? ' · ' + x.sticker : '')) })), consejos: plan.consejos, nota: 'Guardada en el CRM (Asistente personal → Historias). Dale a Víctor una línea por historia y ofrécele el guion hablado o el PDF.' };
}
