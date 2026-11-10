// Historias de Instagram con el asistente personal: secuencias para vender o para generar engagement, escritas con la voz de Víctor y basadas en lo que de verdad hace
// (agenda, obras, proyectos, diario, memoria). Lleva un EDITOR JEFE que revisa y repara cada secuencia, aprende cómo habla Víctor (frases suyas, textos que le enseñe)
// y aprende QUÉ FUNCIONA a partir de los resultados que le cuente. Todo se guarda para verlo en el CRM.
import crypto from 'crypto';
import { callClaude } from './anthropic.js';

const RUTA_HIST = 'crm/asistente/historias.json';
const RUTA_VOZ = 'crm/asistente/voz.json';
const RUTA_LECC = 'crm/asistente/historias_lecciones.json';
const RUTA_MEM = 'crm/asistente/memoria.json';
const RUTA_CHARLA = 'crm/asistente/charla.json';
const RUTA_DIARIO = 'crm/asistente/diario.json';
const RUTA_IDEAS = 'crm/asistente/ig_ideas.json';
const RUTA_PUBLICADAS = 'crm/asistente/ig_publicadas.json';
const RUTA_ESTRATEGIA = 'crm/asistente/ig_estrategia.json';
const RUTA_PRIV = 'crm/asistente/privado.json';
const RUTA_REGLAS_VIDEO = 'crm/estudio-video/reglas.json';
const RUTA_EDITOR = 'crm/estudio-video/editor.json';

let leer = async (_r, d) => d, guardar = async () => {}, herramienta = async () => ({});
export function ponAlmacenHistorias(l, g, h) { leer = l; guardar = g; herramienta = h; }

export const TOOLS_HISTORIAS = [
  { name: 'crear_secuencia_historias', description: 'Crea una secuencia de historias de Instagram (de 1 día o de varios) con foto o vídeo a hacer en cada historia, texto en pantalla, guion hablado con la voz de Víctor, stickers y una revisión crítica. Usa lo que Víctor hace de verdad (agenda, obras, proyectos, diario) y lo que ya se sabe que funciona. objetivo: "vender", "engagement", "autoridad", "bastidores", "lanzamiento" o texto libre. Úsala cuando pida historias, una secuencia, qué subir hoy/mañana o cómo vender algo por Instagram. A Víctor respóndele corto: una línea por historia; ofrécele el guion hablado o el PDF.', input_schema: { type: 'object', properties: { objetivo: { type: 'string' }, tema: { type: 'string', description: 'de qué va (un proyecto, un producto, una obra, una idea…); si no lo dice, deduce de su día' }, fecha: { type: 'string', description: 'día en que se publica AAAA-MM-DD (por defecto hoy)' }, num_historias: { type: 'integer' }, dias: { type: 'integer', description: 'si quiere un plan de varios días (1-7)' }, indicaciones: { type: 'string' } }, required: ['objetivo'] } },
  { name: 'ver_historias', description: 'Muestra las últimas secuencias de historias que has preparado (por si Víctor pide recordarlas o repetirlas).', input_schema: { type: 'object', properties: { cuantas: { type: 'integer' } } } },
  { name: 'guardar_mi_voz', description: 'Guarda cómo habla Víctor para escribir guiones con su voz: una frase real suya (muestra) y/o un rasgo de su forma de hablar ("dice ojo al empezar", "frases cortas", "no usa emojis"). Úsala sola cuando notes algo representativo en cómo se expresa o cuando te corrija un guion.', input_schema: { type: 'object', properties: { muestra: { type: 'string' }, rasgo: { type: 'string' } } } },
  { name: 'resultado_historias', description: 'Apunta cómo le fue a una secuencia de historias (respuestas, mensajes directos, retención, ventas, qué historia se cayó…) para APRENDER qué funciona y mejorar las siguientes. Úsala cuando Víctor te cuente cómo fueron sus historias.', input_schema: { type: 'object', properties: { id: { type: 'string', description: 'id de la secuencia; si no lo sabe, la última' }, resultado: { type: 'string' } }, required: ['resultado'] } },
  { name: 'que_subo_hoy', description: 'Víctor pregunta qué subir hoy a Instagram (historias). Te comportas como su ESTRATEGA y su mano derecha: miras lo que ha subido estos días (para no repetir ni ser monótono), su agenda, su banco de ideas guardadas (incluida su vida personal) y su estrategia (no vender directo por historias: conectar y llevar a que le escriban o pidan una herramienta), y decides qué tipo de día toca y qué subir, con foto o vídeo concretos y el texto. Si procede, recupera una idea antigua suya («hace semanas me dijiste…») y/o sugiere una herramienta que crear para captar contactos. Úsala siempre que pregunte «qué subo hoy», «qué publico» o «qué historia hago».', input_schema: { type: 'object', properties: { contexto: { type: 'string', description: 'lo que Víctor cuente de su día o de cómo está (opcional)' }, hoy_no_quiero: { type: 'string', description: 'si descarta algo (opcional)' } } } },
  { name: 'guardar_idea_historia', description: 'Guarda una idea de historia o de contenido de Instagram que Víctor te cuente (de trabajo, de su vida personal, una anécdota, una opinión, algo que le pasó) para recuperarla en el momento oportuno cuando pregunte qué subir. Úsala SIEMPRE que diga cosas como «apunta esta idea para una historia», «esto lo podría subir» o te cuente algo con potencial de contenido. tipo: personal, trabajo, autoridad, bastidores, herramienta, otro.', input_schema: { type: 'object', properties: { texto: { type: 'string' }, tipo: { type: 'string' }, mejor_momento: { type: 'string', description: 'cuándo encaja (un día, un evento, «cuando acabe la obra»…), si lo dice' } }, required: ['texto'] } },
  { name: 'listar_ideas_historias', description: 'Enseña el banco de ideas de historias que Víctor te ha ido contando (las que aún no ha usado primero).', input_schema: { type: 'object', properties: {} } },
  { name: 'registrar_historia_publicada', description: 'Apunta lo que Víctor ha subido de verdad a Instagram (resumen corto y tipo: personal, trabajo, autoridad, bastidores, cta, herramienta, otro) para llevar el hilo y no repetirse. Úsala cuando diga «ya subí…», «he subido…» o te cuente lo que publicó.', input_schema: { type: 'object', properties: { resumen: { type: 'string' }, tipo: { type: 'string' }, resultado: { type: 'string' }, id_idea: { type: 'string', description: 'si venía de una idea guardada' } }, required: ['resumen'] } },
  { name: 'guardar_estrategia_instagram', description: 'Guarda una regla de la estrategia de Instagram de Víctor (cómo quiere usar las historias, a qué llevar a la gente, qué no hacer). Úsala cuando te diga cómo quiere enfocar su Instagram.', input_schema: { type: 'object', properties: { regla: { type: 'string' } }, required: ['regla'] } },
];
export const HISTORIAS_NOMBRES = new Set(TOOLS_HISTORIAS.map(t => t.name));

const limpia = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const json = (r) => { const txt = (r.content || []).filter(b => b.type === 'text').map(b => b.text).join(''); return JSON.parse(/\{[\s\S]*\}/.exec(txt)[0]); };

// ── su voz: frases reales suyas (mensajes, textos que le enseña) y rasgos
async function vozDeVictor() {
  const v = await leer(RUTA_VOZ, { muestras: [], rasgos: [] });
  const reales = [];
  try {
    const ch = await leer(RUTA_CHARLA, {});
    for (const [k, l] of Object.entries(ch)) { if (k.startsWith('_') || !Array.isArray(l)) continue; reales.push(...l.filter(m => m.role === 'user' && !m.privado && typeof m.content === 'string').map(m => m.content.replace(/^\[[^\]]*\]\s*/, '')).filter(t => t.length > 45 && t.length < 400 && !/^\[Aviso/.test(t))); }
  } catch { /* sin conversación */ }
  return { muestras: [...(v.muestras || []).slice(-30), ...reales.slice(-20)].slice(-45), rasgos: (v.rasgos || []).slice(-30) };
}
// Enseñarle su voz con textos suyos (guiones, transcripciones, mensajes): se guardan frases y se deducen los rasgos
export async function ensenarVoz(texto) {
  const t = String(texto || '').replace(/\r/g, '').trim().slice(0, 12000); if (t.length < 80) return { error: 'Pega un texto más largo (un guion, una transcripción, varios mensajes tuyos).' };
  const trozos = t.split(/\n{1,}|(?<=[.!?])\s+/).map(x => x.trim()).filter(x => x.length >= 50 && x.length <= 380);
  const v = await leer(RUTA_VOZ, { muestras: [], rasgos: [] });
  const paso = Math.max(1, Math.floor(trozos.length / 14)); const nuevas = trozos.filter((_, i) => i % paso === 0).slice(0, 14).filter(x => !v.muestras.includes(x));
  v.muestras = [...v.muestras, ...nuevas].slice(-60);
  try {
    const r = await callClaude({ system: 'Analizas cómo habla y escribe una persona para poder imitar su voz. Devuelves SOLO JSON {"rasgos":["frase corta cada rasgo"]} con 5 a 8 rasgos CONCRETOS y útiles (muletillas y arranques típicos, longitud de las frases, nivel de formalidad, humor, si usa emojis o exclamaciones, cómo cierra, vocabulario propio, cómo trata al público: tú/usted). Nada genérico.', messages: [{ role: 'user', content: t.slice(0, 9000) }], maxTokens: 900 });
    const rs = (json(r).rasgos || []).map(x => limpia(x, 160)).filter(Boolean); for (const x of rs) if (!v.rasgos.includes(x)) v.rasgos.push(x);
    v.rasgos = v.rasgos.slice(-40);
  } catch { /* se quedan las frases */ }
  await guardar(RUTA_VOZ, v);
  return { ok: true, muestras: v.muestras.length, rasgos: v.rasgos };
}

const ESTRATEGIA_INICIAL = [
  'Las historias NO se usan para vender directamente. Su objetivo es conectar, mostrar el día a día y el criterio de Víctor y llevar a que le contacten: CTAs de mensaje directo («escríbeme y te cuento»), que pidan una herramienta o recurso, o que respondan a una pregunta.',
  'Equilibrio: mezclar vida personal y cercanía, trabajo/bastidores y autoridad. No repetir el mismo tipo de historia varios días seguidos ni ser monótono.',
  'Cuando haga falta captar contactos, proponer crear una herramienta o recurso útil (checklist, plantilla, calculadora, guía) que la gente pida por mensaje directo.',
];
async function estrategia() { const e = await leer(RUTA_ESTRATEGIA, null); if (e && Array.isArray(e.reglas) && e.reglas.length) return e.reglas; await guardar(RUTA_ESTRATEGIA, { reglas: ESTRATEGIA_INICIAL.map(texto => ({ id: crypto.randomUUID().slice(0, 6), texto })) }); return ESTRATEGIA_INICIAL.map(texto => ({ texto })); }
const hace = (f, hoy) => { const d = Math.round((Date.parse(hoy) - Date.parse(String(f).slice(0, 10))) / 86400000); return isFinite(d) ? (d <= 0 ? 'hoy' : d === 1 ? 'ayer' : 'hace ' + d + ' días') : ''; };
async function contextoEstratega(hoy) {
  const [reglas, ideas, pub] = await Promise.all([estrategia(), leer(RUTA_IDEAS, { ideas: [] }), leer(RUTA_PUBLICADAS, { historias: [] })]);
  const piezas = ['ESTRATEGIA DE INSTAGRAM DE VÍCTOR (obligatoria):\n' + reglas.map(r => '- ' + r.texto).join('\n')];
  const ult = (pub.historias || []).slice(-14); piezas.push('LO QUE HA SUBIDO ÚLTIMAMENTE (para no repetirse):\n' + (ult.map(h => '- ' + h.fecha + ' (' + hace(h.fecha, hoy) + ') [' + h.tipo + '] ' + h.resumen + (h.resultado ? ' → ' + h.resultado : '')).join('\n') || '(no me ha contado que haya subido nada reciente)'));
  const libres = (ideas.ideas || []).filter(i => !(i.usadas || []).length), usadas = (ideas.ideas || []).filter(i => (i.usadas || []).length);
  piezas.push('SU BANCO DE IDEAS (id · tipo · cuándo me la contó · mejor momento):\n' + (libres.slice(-25).map(i => '- [' + i.id + '] ' + i.tipo + ' · ' + hace(i.creada, hoy) + (i.mejor_momento ? ' · encaja: ' + i.mejor_momento : '') + ' · ' + i.texto).join('\n') || '(vacío)') + (usadas.length ? '\n(Ya usadas: ' + usadas.slice(-8).map(i => i.texto.slice(0, 50)).join(' | ') + ')' : ''));
  try { const p = await leer(RUTA_PRIV, { hechos: [] }); const h = (p.hechos || []).slice(-30).map(x => '- ' + x.texto); if (h.length) piezas.push('SU VIDA PERSONAL (úsala con tacto para historias de conexión; nunca expongas a terceros ni datos sensibles):\n' + h.join('\n')); } catch { /* sin personales */ }
  return piezas.join('\n\n');
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
  try { const l = await leer(RUTA_LECC, { lecciones: [] }); const h = (l.lecciones || []).slice(-25).map(x => '- ' + x.texto); if (h.length) piezas.push('LO QUE SE HA COMPROBADO QUE FUNCIONA (o no) EN SUS HISTORIAS REALES:\n' + h.join('\n')); } catch { /* sin lecciones */ }
  return piezas.join('\n\n');
}

const MARCOS = '- PAS (Problema → Agitar → Solución): para vender a quien ya siente el dolor.\n- AIDA (Atención → Interés → Deseo → Acción): para presentar un servicio o proyecto.\n- ANTES → DESPUÉS → PUENTE: para enseñar una transformación real (obra, reforma, distribución).\n- MITO vs REALIDAD: para autoridad y para provocar respuestas.\n- DETRÁS DE CÁMARA CON LECCIÓN: bastidores de obra o diseño que acaban en un porqué de experto.\n- CAJA DE PREGUNTAS / ENCUESTA ESCALONADA: para engagement y para conocer a la audiencia.\n- MINI-SERIE: un mismo hilo en varios días con un «continuará» que haga volver.\n- CUENTA ATRÁS DE LANZAMIENTO: expectativa, prueba, apertura y último aviso.';

function sistemaGenerar(num, dias) {
  return 'Eres el estratega de Instagram de Víctor Palomo, fundador de Ranuse Design (diseño y montaje de gimnasios, home gyms y espacios deportivos). Eres experto en HISTORIAS de Instagram que generan engagement y que venden, y en contar el día a día de un profesional de obra y diseño de forma que la gente se quede, responda y escriba por mensaje directo.\n\n' +
    'PRIMERO ELIGE EL MARCO NARRATIVO que mejor sirva al objetivo (y nómbralo):\n' + MARCOS + '\n\n' +
    'CÓMO CONSTRUYES UNA SECUENCIA:\n- ' + num + ' historias por día (máx. 15 s cada una), UNA idea por historia, con un hilo que se note de una a otra («y ahora…»). La primera para el pulgar (gancho visual + texto que abre una pregunta o promete algo); la última cierra con UNA sola llamada a la acción ligada al objetivo (sticker, mensaje directo, enlace o encuesta). Cada historia empuja a ver la siguiente.\n' +
    '- Alterna formatos (foto, vídeo a cámara, boomerang, texto sobre fondo, captura, encuesta, caja de preguntas, quiz, slider, cuenta atrás) para que no sea monótono, y usa stickers que provoquen respuesta (los mensajes directos y las respuestas valen más que los «me gusta»).\n' +
    '- Todo parte de lo REAL de su día (agenda, obras, proyectos, diario): no inventes proyectos, clientes, cifras, resultados ni testimonios. Si falta material, dilo y propón qué sacar. Anonimiza a los clientes en el texto de pantalla y el guion salvo permiso.\n' +
    '- Aplica lo que ya se ha comprobado que funciona en sus historias (si lo hay) y no repitas lo que no funcionó.\n' +
    '- Para cada historia: QUÉ FOTO O VÍDEO sacar (qué se ve, cómo encuadrarlo, desde dónde, cuánto dura), el TEXTO EN PANTALLA (corto), el GUION HABLADO con SU voz si habla (primera persona, frases cortas, directo, como en las muestras; sin jerga de marketing, sin exclamaciones vacías, sin emojis salvo que él los use) y una ALTERNATIVA si ese día no puede grabarlo.\n' +
    '- Piensa en el día concreto: «este día tal vas a subir esta historia, sacas una foto así, luego así…».\n\nRESPONDE SOLO JSON: {"titulo":"","marco":"marco narrativo elegido y por qué","objetivo":"","resumen":"1-2 frases de la idea de la secuencia","mejor_hora":"","dias":[{"fecha":"AAAA-MM-DD","historias":[{"n":1,"formato":"foto|vídeo|boomerang|texto|encuesta|caja de preguntas|quiz|slider|cuenta atrás|captura","grabar":"qué sacar y cómo","texto_pantalla":"","guion_hablado":"","sticker":"tipo y texto o vacío","para_que":"qué consigue esta historia","alternativa":"si no puede grabarlo"}]}],"consejos":["máx. 3"]}';
}

function normalizaPlan(j, cuando, dias, objetivo) {
  const dd = (Array.isArray(j.dias) ? j.dias : []).slice(0, dias).map(d => ({ fecha: /^\d{4}-\d{2}-\d{2}$/.test(d?.fecha || '') ? d.fecha : cuando, historias: (Array.isArray(d?.historias) ? d.historias : []).slice(0, 12).map((x, i) => ({ n: Number(x?.n) || i + 1, formato: limpia(x?.formato, 40), grabar: limpia(x?.grabar, 400), texto: limpia(x?.texto_pantalla ?? x?.texto, 160), hablado: limpia(x?.guion_hablado ?? x?.hablado, 600), sticker: limpia(x?.sticker, 160), para_que: limpia(x?.para_que, 200), alternativa: limpia(x?.alternativa, 220) })) }));
  return { titulo: limpia(j.titulo, 120) || 'Secuencia de historias', marco: limpia(j.marco, 200), objetivo: limpia(j.objetivo, 80) || objetivo, resumen: limpia(j.resumen, 400), mejor_hora: limpia(j.mejor_hora, 80), dias: dd, consejos: (Array.isArray(j.consejos) ? j.consejos : []).slice(0, 3).map(x => limpia(x, 200)) };
}

// Editor jefe de Instagram: puntúa la secuencia y, si hace falta, la repara
async function revisaYRepara(plan, system, usuario) {
  try {
    const crit = json(await callClaude({ system: 'Eres el editor jefe de contenido de Instagram de una marca de diseño de gimnasios. Revisas con rigor una secuencia de historias ya escrita. Devuelves SOLO JSON: {"nota":0-100,"gancho":"fuerte|normal|flojo","hilo":"se nota o no el hilo entre historias","voz":"suena a él o a marketing genérico","ejecutable":"¿se puede grabar hoy con lo que tiene?","cta":"¿una sola llamada a la acción clara?","problemas":[{"n":número de historia o 0,"que":"qué falla, concreto"}],"veredicto":"ok|reparar"}. Sé exigente: 90+ es excepcional; penaliza lo genérico, lo inventado, los guiones largos, las historias sin un porqué y las que no empujan a la siguiente.', messages: [{ role: 'user', content: 'SECUENCIA:\n' + JSON.stringify(plan).slice(0, 7000) + '\n\nCONTEXTO REAL (para comprobar que no se inventa nada):\n' + usuario.slice(0, 4500) }], maxTokens: 1500 }));
    const rev = { nota: Number(crit.nota) || null, gancho: limpia(crit.gancho, 20), hilo: limpia(crit.hilo, 160), voz: limpia(crit.voz, 160), ejecutable: limpia(crit.ejecutable, 160), cta: limpia(crit.cta, 160), problemas: (crit.problemas || []).slice(0, 6).map(p => ({ n: Number(p?.n) || 0, que: limpia(p?.que, 200) })), veredicto: limpia(crit.veredicto, 12) || 'ok', reparada: false };
    if ((rev.veredicto === 'reparar' || (rev.nota ?? 100) < 80) && rev.problemas.length) {
      const j2 = json(await callClaude({ system, messages: [{ role: 'user', content: usuario + '\n\nTU PRIMER BORRADOR:\n' + JSON.stringify(plan).slice(0, 7000) + '\n\nEL EDITOR JEFE HA DETECTADO ESTOS PROBLEMAS (corrígelos todos y mejora lo demás; devuelve la secuencia COMPLETA en el mismo formato JSON):\n' + rev.problemas.map(p => '- ' + (p.n ? 'Historia ' + p.n + ': ' : '') + p.que).join('\n') + '\nHilo: ' + rev.hilo + '\nVoz: ' + rev.voz }], maxTokens: 6000 }));
      const mejor = normalizaPlan(j2, plan.dias[0]?.fecha, plan.dias.length, plan.objetivo);
      if (mejor.dias.length && mejor.dias[0].historias.length) { rev.reparada = true; Object.assign(plan, mejor); }
    }
    return rev;
  } catch (e) { console.log('Historias: sin revisión del editor jefe:', e.message); return null; }
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
    return { planes: (h.planes || []).slice(-n).reverse().map(p => ({ id: p.id, titulo: p.titulo, objetivo: p.objetivo, cuando: p.cuando, historias: (p.dias || []).flatMap(d => d.historias || []).map(x => x.n + ') ' + x.formato + ': ' + x.grabar), resultados: p.resultados || [] })) };
  }
  if (nombre === 'resultado_historias') {
    const h = await leer(RUTA_HIST, { planes: [] }); const p = (h.planes || []).find(x => x.id === input.id) || (h.planes || [])[(h.planes || []).length - 1];
    const res = limpia(input.resultado, 600); if (!p || !res) return { error: 'No encuentro la secuencia o falta el resultado.' };
    (p.resultados = p.resultados || []).push({ fecha, texto: res }); await guardar(RUTA_HIST, h);
    // lo que cuenta se convierte en una lección para las siguientes secuencias
    try {
      const r = json(await callClaude({ system: 'Sacas LECCIONES de cómo le fue a una secuencia de historias de Instagram para que las próximas sean mejores. Devuelves SOLO JSON {"lecciones":["regla concreta y reutilizable, máx. 2"]}. Si el resultado no permite concluir nada útil, devuelve lista vacía. Nada genérico ("sé auténtico").', messages: [{ role: 'user', content: 'Secuencia: ' + p.titulo + ' (objetivo ' + p.objetivo + '; marco ' + (p.marco || '—') + ').\nHistorias: ' + (p.dias || []).flatMap(d => d.historias || []).map(x => x.n + ') ' + x.formato + ' · ' + x.texto).join(' | ') + '\nResultado que cuenta Víctor: ' + res }], maxTokens: 500 }));
      const l = await leer(RUTA_LECC, { lecciones: [] }); for (const x of (r.lecciones || []).slice(0, 2)) { const t = limpia(x, 220); if (t && !l.lecciones.some(y => y.texto === t)) l.lecciones.push({ id: crypto.randomUUID().slice(0, 6), fecha, texto: t, plan: p.id }); }
      l.lecciones = l.lecciones.slice(-60); await guardar(RUTA_LECC, l);
      return { apuntado: true, lecciones_nuevas: (r.lecciones || []).slice(0, 2) };
    } catch { return { apuntado: true }; }
  }
  if (nombre === 'guardar_idea_historia') {
    const texto = limpia(input.texto, 500); if (!texto) return { error: 'Cuéntame la idea.' };
    const d = await leer(RUTA_IDEAS, { ideas: [] });
    if (d.ideas.some(i => i.texto.toLowerCase() === texto.toLowerCase())) return { guardada: true, nota: 'Ya la tenía.' };
    const idea = { id: crypto.randomUUID().slice(0, 6), texto, tipo: limpia(input.tipo, 20).toLowerCase() || 'otro', mejor_momento: limpia(input.mejor_momento, 120), creada: fecha, usadas: [] };
    d.ideas.push(idea); d.ideas = d.ideas.slice(-150); await guardar(RUTA_IDEAS, d);
    return { guardada: true, id: idea.id, total: d.ideas.length };
  }
  if (nombre === 'listar_ideas_historias') {
    const d = await leer(RUTA_IDEAS, { ideas: [] });
    return { sin_usar: d.ideas.filter(i => !(i.usadas || []).length).slice(-20).map(i => ({ id: i.id, tipo: i.tipo, idea: i.texto, desde: i.creada, encaja: i.mejor_momento })), usadas: d.ideas.filter(i => (i.usadas || []).length).length };
  }
  if (nombre === 'registrar_historia_publicada') {
    const resumen = limpia(input.resumen, 300); if (!resumen) return { error: 'Dime qué subió.' };
    const d = await leer(RUTA_PUBLICADAS, { historias: [] }); d.historias.push({ id: crypto.randomUUID().slice(0, 6), fecha, tipo: limpia(input.tipo, 20).toLowerCase() || 'otro', resumen, resultado: limpia(input.resultado, 200) }); d.historias = d.historias.slice(-200); await guardar(RUTA_PUBLICADAS, d);
    if (input.id_idea) { const ii = await leer(RUTA_IDEAS, { ideas: [] }); const x = ii.ideas.find(y => y.id === input.id_idea); if (x) { (x.usadas = x.usadas || []).push(fecha); await guardar(RUTA_IDEAS, ii); } }
    return { apuntado: true, ultimas: d.historias.slice(-5).map(h => h.fecha + ' [' + h.tipo + '] ' + h.resumen) };
  }
  if (nombre === 'guardar_estrategia_instagram') {
    const regla = limpia(input.regla, 400); if (!regla) return { error: 'Dime la regla.' };
    await estrategia(); const e = await leer(RUTA_ESTRATEGIA, { reglas: [] }); if (!e.reglas.some(r => r.texto === regla)) e.reglas.push({ id: crypto.randomUUID().slice(0, 6), texto: regla }); e.reglas = e.reglas.slice(-30); await guardar(RUTA_ESTRATEGIA, e);
    return { guardada: true, reglas: e.reglas.length };
  }
  if (nombre === 'que_subo_hoy') {
    const [voz, dia, estr] = await Promise.all([vozDeVictor(), contextoDeSuDia(), contextoEstratega(fecha)]);
    const system = 'Eres la mano derecha y estratega de Instagram de Víctor Palomo (Ranuse Design: diseño y montaje de gimnasios y espacios deportivos). Víctor te pregunta «¿qué subo hoy?». Piensas como una estratega de contenido que conoce su vida, su trabajo, su audiencia y todo lo que ha subido: decides QUÉ TIPO DE DÍA toca para no ser repetitivo (conexión personal, bastidores de trabajo, autoridad con criterio, o un CTA para que le contacten o pidan una herramienta) y qué subir exactamente.\n\n' +
      'PRINCIPIOS: no se vende directamente por historias (sigue su estrategia); el objetivo es conectar y que le escriban. Si ayer o antes subió trabajo o autoridad, hoy toca algo distinto (por ejemplo personal o un respiro); si lleva días sin ningún CTA, mete uno suave. Recupera una idea de su banco cuando encaje HOY (di cuánto hace que te la contó: «hace tres semanas me dijiste…»). Si ves una oportunidad de captar contactos con una herramienta o recurso que podría crear (checklist de distribución, plantilla de presupuesto, guía de elección de máquinas, calculadora…), sugiérela con nombre, para qué sirve y cómo se pide («escríbeme la palabra X»). Todo con lo REAL de su día; no inventes. No nombres a clientes ni a terceros en el texto ni en los guiones (di «un cliente», «una obra en Marruecos»…) salvo que él ya lo haya hecho en historias anteriores. Si no tiene material hoy, dilo y propón la opción más fácil de grabar.\n' +
      'Cada historia: formato, QUÉ sacar y cómo (concreto), texto en pantalla corto, guion hablado con SU voz (primera persona, frases cortas, sin jerga de marketing ni emojis salvo que él los use) y sticker si ayuda a que respondan. Entre 1 y 4 historias: lo mínimo que consiga el objetivo del día.\n\n' +
      'RESPONDE SOLO JSON: {"tipo_del_dia":"personal|bastidores|autoridad|cta|herramienta|descanso","por_que":"1-2 frases: qué ha subido estos días y por qué hoy toca esto","historias":[{"formato":"","grabar":"","texto_pantalla":"","guion_hablado":"","sticker":"","idea_usada":"id del banco o vacío"}],"idea_recuperada":{"id":"","aviso":"cómo se lo dices a Víctor, con cuánto tiempo hace"} ,"herramienta_sugerida":{"nombre":"","para_que":"","como_se_pide":""},"evita_hoy":["qué no subir hoy y por qué"],"hora":"mejor hora aproximada"}';
    const usuario = 'FECHA DE HOY: ' + fecha + '\n' + (limpia(input.contexto, 600) ? 'VÍCTOR CUENTA DE SU DÍA: ' + limpia(input.contexto, 600) + '\n' : '') + (limpia(input.hoy_no_quiero, 300) ? 'HOY NO QUIERE: ' + limpia(input.hoy_no_quiero, 300) + '\n' : '') + '\n' + estr + '\n\n' + (dia || '(sin datos de su día)') + '\n\nCÓMO HABLA VÍCTOR:\n' + (voz.rasgos.length ? 'Rasgos: ' + voz.rasgos.join('; ') + '\n' : '') + voz.muestras.slice(-14).map(m => '«' + m + '»').join('\n');
    let j; try { j = json(await callClaude({ system, messages: [{ role: 'user', content: usuario }], maxTokens: 3500 })); } catch { return { error: 'No he podido decidir qué subir, repítemelo.' }; }
    const hist = (Array.isArray(j.historias) ? j.historias : []).slice(0, 5).map((x, i) => ({ n: i + 1, formato: limpia(x?.formato, 40), grabar: limpia(x?.grabar, 350), texto: limpia(x?.texto_pantalla, 140), hablado: limpia(x?.guion_hablado, 450), sticker: limpia(x?.sticker, 140), idea: limpia(x?.idea_usada, 12) }));
    if (!hist.length) return { error: 'No me ha salido nada útil, prueba otra vez.' };
    return { tipo_del_dia: limpia(j.tipo_del_dia, 20), por_que: limpia(j.por_que, 400), historias: hist.map(x => x.n + ') ' + x.formato + ' — ' + x.grabar + (x.texto ? ' · texto: «' + x.texto + '»' : '') + (x.sticker ? ' · ' + x.sticker : '') + (x.idea ? ' [de tu banco: ' + x.idea + ']' : '')), guiones: hist.filter(x => x.hablado).map(x => x.n + ') ' + x.hablado), idea_recuperada: j.idea_recuperada?.aviso ? limpia(j.idea_recuperada.aviso, 300) : null, herramienta_sugerida: j.herramienta_sugerida?.nombre ? { nombre: limpia(j.herramienta_sugerida.nombre, 80), para_que: limpia(j.herramienta_sugerida.para_que, 200), como_se_pide: limpia(j.herramienta_sugerida.como_se_pide, 160) } : null, evita: (Array.isArray(j.evita_hoy) ? j.evita_hoy : []).slice(0, 2).map(x => limpia(x, 160)), hora: limpia(j.hora, 60), ids_ideas: hist.map(x => x.idea).filter(Boolean),
      nota: 'Respóndele corto y con criterio, como su mano derecha: qué tipo de día toca y por qué (una frase), las historias (una línea cada una), la idea que recuperas si la hay y la herramienta que le sugieres si la hay. Ofrécele los guiones hablados. Cuando te diga que las ha subido, apúntalo con registrar_historia_publicada (con id_idea si venía de una idea).' };
  }
  // crear_secuencia_historias
  const objetivo = limpia(input.objetivo, 160) || 'engagement', tema = limpia(input.tema, 300), indic = limpia(input.indicaciones, 500);
  const dias = Math.max(1, Math.min(7, Math.round(Number(input.dias)) || 1)), num = Math.max(3, Math.min(10, Math.round(Number(input.num_historias)) || (dias > 1 ? 4 : 6)));
  const cuando = /^\d{4}-\d{2}-\d{2}$/.test(input.fecha || '') ? input.fecha : fecha;
  const [voz, dia, estr] = await Promise.all([vozDeVictor(), contextoDeSuDia(), contextoEstratega(fecha)]);
  const system = sistemaGenerar(num, dias);
  const usuario = 'OBJETIVO: ' + objetivo + (tema ? '\nTEMA: ' + tema : '\nTEMA: deduce el mejor tema de lo que hace estos días') + '\nDÍA DE PUBLICACIÓN: ' + cuando + (dias > 1 ? ' (plan de ' + dias + ' días desde esa fecha, ' + num + ' historias por día)' : '') + (indic ? '\nINDICACIONES: ' + indic : '') +
    '\n\n' + estr + '\n\n' + (dia || '(No tengo datos de su día: pídele que te cuente qué hace.)') +
    '\n\nCÓMO HABLA VÍCTOR (muestras reales y rasgos):\n' + (voz.rasgos.length ? 'Rasgos: ' + voz.rasgos.join('; ') + '\n' : '') + (voz.muestras.length ? voz.muestras.map(m => '«' + m + '»').join('\n') : '(todavía no tengo muestras: usa un tono cercano, directo, de profesional de obra, y deja el guion corto para que lo adapte)');
  let j; try { j = json(await callClaude({ system, messages: [{ role: 'user', content: usuario }], maxTokens: 6000 })); } catch { return { error: 'No he podido montar la secuencia, repítemelo.' }; }
  const base = normalizaPlan(j, cuando, dias, objetivo);
  if (!base.dias.length || !base.dias[0].historias.length) return { error: 'La secuencia ha salido vacía, prueba otra vez.' };
  const plan = { id: crypto.randomUUID().slice(0, 6), creado: new Date().toISOString(), cuando, ...base };
  plan.revision = await revisaYRepara(plan, system, usuario);
  const h = await leer(RUTA_HIST, { planes: [] }); h.planes = [...(h.planes || []), plan].slice(-40); await guardar(RUTA_HIST, h);
  return { creada: true, id: plan.id, titulo: plan.titulo, marco: plan.marco, resumen: plan.resumen, mejor_hora: plan.mejor_hora, revision: plan.revision ? { nota: plan.revision.nota, reparada: plan.revision.reparada, pendiente: plan.revision.problemas.map(p => p.que).slice(0, 2) } : null,
    dias: plan.dias.map(d => ({ fecha: d.fecha, historias: d.historias.map(x => x.n + ') ' + x.formato + ' — ' + x.grabar + (x.texto ? ' · texto: «' + x.texto + '»' : '') + (x.sticker ? ' · ' + x.sticker : '')) })), consejos: plan.consejos,
    nota: 'Guardada en el CRM (Asistente personal → Historias). Dale a Víctor una línea por historia (máximo 7), dile el marco que has usado en una frase y ofrécele el guion hablado o el PDF. Pregúntale después cómo le fue para aprender.' };
}
