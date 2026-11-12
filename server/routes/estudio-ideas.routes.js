import express from 'express';
import multer from 'multer';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';
import { callClaude } from '../utils/anthropic.js';
import { leerJson, guardarJson } from '../utils/asistente-personal.js';

// Lo que el CRM sabe del proyecto al que pertenece el plano (nombre y fase), para que las ideas encajen con el momento del proyecto. No se envía el nombre del cliente.
const zonasTexto = (z) => { const l = (Array.isArray(z) ? z : []).slice(0, 12).map(q => '«' + String(q?.nombre || '').slice(0, 40) + '»' + (q?.n ? ' (' + Math.round(Number(q.n)) + ' máquinas' + (Array.isArray(q.ejemplos) && q.ejemplos.length ? ': ' + q.ejemplos.slice(0, 3).map(x => String(x).slice(0, 40)).join(', ') : '') + ')' : '') + (q?.paredCercana ? ', pared más cercana ' + String(q.paredCercana).slice(0, 40) : '') + (q?.lado ? ' (' + String(q.lado).slice(0, 12) + ')' : '')); return l.length ? 'ZONAS DE MÁQUINAS (grupos de máquinas que el usuario ha organizado juntos, por tipo: glúteo, pierna, discos…). Úsalas SOLO como CONTEXTO para decidir ambiente, materiales, luz y circulación (por ejemplo: donde hay discos y peso libre pide materiales robustos y luz más dura; donde hay glúteo o pierna, algo más cálido y envolvente). NO pongas el nombre de la zona como rótulo, no etiquetes las zonas y no conviertas esto en poner nombres a las cosas: las zonas no son textos que escribir en la pared. Zonas: ' + l.join(' | ') + '\n' : ''; };
const FASES_CRM = ['Diseño previo (todavía se está definiendo la idea)', 'Arquitectura (planos)', 'Instalaciones', 'Interiorismo y materialidad (aquí se eligen acabados y ambiente)', 'Maquinaria y equipamiento', 'Documentación de apoyo'];
async function contextoCrm(medicionId) {
  try {
    if (!medicionId) return '';
    const { data: m } = await supabase.from('mediciones').select('project_id, nombre').eq('id', String(medicionId).slice(0, 60)).maybeSingle();
    if (!m?.project_id) return m?.nombre ? 'PLANO: ' + String(m.nombre).slice(0, 80) + '.\n' : '';
    const { data: p } = await supabase.from('client_projects').select('project_name, phase').eq('id', m.project_id).maybeSingle();
    if (!p) return '';
    return 'PROYECTO EN EL CRM: «' + String(p.project_name || m.nombre || '').slice(0, 80) + '», fase ' + (Number(p.phase) || 0) + ' → ' + (FASES_CRM[Number(p.phase) || 0] || '') + '. Adapta el nivel de detalle y de atrevimiento a esa fase.\n';
  } catch { return ''; }
}

// «Estudio de ideas»: un agente creativo con ChatGPT (API de OpenAI, Responses). Se le comparte una imagen (una pared, un local, una vista 3D),
// se le pide una idea (un mural, un rótulo, un ambiente) y genera la imagen; se sigue hablando para retocarla y, al final, se le pide solo la imagen.
// Dos modos de trabajo con un render:
//   · «respetar»: el render NO se toca; solo se añade o cambia lo que se pide (modo edición, fidelidad alta).
//   · «sorprende»: 3 propuestas distintas a la vez, cada una desde un ángulo creativo diferente, siempre dentro de la marca y sin mover lo que ya está.
// Marcas: se sube el brandbook (PDF) una vez y el servidor lo resume en una ficha de diseño que se aplica a todas las ideas.
// Variables: OPENAI_API_KEY (obligatoria), OPENAI_CHAT_MODEL (modelo de texto con visión; si falta se elige uno de los que ve la cuenta)
// y OPENAI_IMAGE_MODEL (opcional, modelo de imagen de la herramienta).
const router = express.Router();
router.use(authenticateToken, requirePermission('proyectos'));

const OPENAI = 'https://api.openai.com/v1';
let modeloElegido = null;
const versionDe = id => (String(id).match(/\d+(\.\d+)?/g) || ['0']).map(Number);

async function elegirModelo(clave, excluir) {
  const r = await fetch(OPENAI + '/models', { headers: { Authorization: 'Bearer ' + clave } });
  const j = await r.json().catch(() => ({}));
  const ids = (j.data || []).map(x => x.id)
    .filter(id => /^gpt-\d/.test(id) && !/mini|nano|image|audio|realtime|transcribe|tts|search|codex|instruct|chat-latest|preview|deep-research|moderation|embedding/i.test(id) && id !== excluir);
  ids.sort((a, b) => {
    const va = versionDe(a), vb = versionDe(b);
    for (let i = 0; i < Math.max(va.length, vb.length); i++) { const d = (vb[i] || 0) - (va[i] || 0); if (d) return d; }
    return a.length - b.length;
  });
  return ids[0] || null;
}

const INSTRUCCIONES = `Eres el director creativo de Ranuse Design, un estudio de diseño de espacios deportivos y de bienestar (gimnasios, estudios, vestuarios, recepciones…). Trabajas codo con codo con el diseñador: no eres un asistente que obedece, eres un colega con criterio.

CÓMO HABLAS (importante: suena a persona, no a robot):
- Español natural de España, cercano y directo, como lo diría un compañero de estudio. Frases cortas, con ritmo. Sin fórmulas de atención al cliente: nada de «¡Claro!», «Por supuesto», «Aquí tienes», «Espero que te sirva», «¿Hay algo más en lo que pueda ayudarte?».
- Reacciona a lo que te dicen antes de ponerte a hacer: si la idea es buena, dilo con una razón; si algo no te convence, dilo con tacto y propón algo mejor. Ten opinión y defiéndela en una frase («yo iría por aquí porque…»).
- Piensa en voz alta de forma breve cuando aporte: qué has visto en la imagen, qué te llama la atención, qué riesgo ves. Nada de listas ni títulos salvo que el usuario las pida o hagas preguntas numeradas.
- Responde a lo que se pregunta. Si es una duda, contesta; no generes imágenes si no hace falta. Si te falta un dato importante, pregúntalo (una o dos preguntas, no un cuestionario).
- Recuerda lo hablado antes y retómalo («antes dijiste que no querías rojo en el techo, así que…»). Usa el nombre del proyecto o de la marca cuando lo sepas.
- Sé honesto con los límites: si algo no se puede construir tal cual o no tienes el logo/medida, dilo claro.

QUÉ HACES:
Cuando el usuario comparta una imagen y pida una idea (un mural, un rótulo, un cartel, una decoración, un ambiente, un material), propón la idea en una o dos frases —con el porqué— y genera la imagen con la herramienta de imagen.
Si pide «solo la imagen», «sin la pared» o «para imprimir», genera únicamente el diseño aislado: sin la pared, sin el local, sin marcos, en plano frontal y a pantalla completa, con buena resolución y listo para llevar a producción.
Si pide cambios, parte de la imagen anterior y cambia solo lo pedido. No inventes medidas: si hacen falta, pregúntalas.`;

// Cuando se pide «solo la imagen»: se obliga a generar un diseño nuevo, plano y a toda la imagen, sin habitación ni pared (si no, tiende a repetir la foto de la sala)
const PIDE_SOLO = /solo (la )?imagen|sin (la )?(pared|habitaci|entorno|fondo)|para imprimir|solo (el|la) (mural|dise|ilustra|arte)|aislad/i;
const FORMATOS = { vertical: '1024x1536', horizontal: '1536x1024', cuadrado: '1024x1024' };
const EXTRA_SOLO = `
IMPORTANTE (modo «solo el diseño»): crea una IMAGEN NUEVA que contenga ÚNICAMENTE la obra de arte del mural, vista de frente y plana (sin perspectiva), ocupando toda la imagen de borde a borde. NO incluyas ninguna pared, habitación, suelo, techo, ventana, caja, mueble, marco, sombra ni borde. No uses la foto de la sala como base: úsala solo como referencia del diseño elegido. Conserva el diseño, los colores y el texto de la idea anterior.`;

// Con el visor 3D abierto, el agente recibe en cada mensaje una descripción del modelo (espacio, medidas, acabados, equipamiento) para que las ideas
// encajen en él y no invente nada que no se le pida.
const REGLAS_CONTEXTO = `

CONTEXTO DEL MODELO 3D ACTUAL (es la realidad del proyecto: toda idea debe encajar en ella y respetarla):
`;
const FIN_CONTEXTO = `

REGLAS CON ESTE MODELO: añade o cambia SOLO lo que el usuario te pida. No inventes elementos, muebles, ventanas, puertas, instalaciones ni materiales que no estén en el contexto ni te los hayan pedido. Respeta las medidas, los colores y los acabados del modelo (una superficie de color liso es pintura lisa, sin textura ni desgaste). Si para la idea te falta un dato (una medida, un material, un color), pregúntalo en vez de suponerlo. Al responder, di brevemente qué has añadido o cambiado.`;

// ── Modo «respetar»: el render es sagrado
const REGLAS_RESPETAR = `

MODO «RESPETAR EL RENDER» (obligatorio): la primera imagen es un render del proyecto y ES LA BASE. Trabaja como un retocador, no como un ilustrador nuevo:
- Edita esa misma imagen. Mantén IDÉNTICOS: el encuadre y la cámara, la perspectiva, el número, la forma, el color y la posición de TODAS las máquinas y el mobiliario, el suelo, los pilares, las vigas, las puertas, la iluminación que ya existe y las proporciones del local.
- Cambia o añade ÚNICAMENTE lo que el usuario pide (y nada más). No «mejores» por tu cuenta, no reordenes, no quites, no redecores lo que no pidió.
- Lo que añadas debe parecer parte del mismo render: misma luz, mismas sombras, misma escala y mismo nivel de realismo.
- Si el usuario pide una idea de forma abierta («dame una idea», «sorpréndeme»), elige UNA zona concreta (pared, techo, rótulo, iluminación o un detalle) y actúa solo ahí.
- En tu texto di en una línea qué has cambiado y confirma qué has dejado intacto.`;

// ── Modo «sorprende»: criterio creativo
const CREATIVO = `

CRITERIO CREATIVO (el cliente quiere SORPRESA, no lo típico): evita la solución obvia (poner el logo más grande, una tira de neón genérica, un mural abstracto cualquiera). Piensa como un director de arte de primer nivel: parte de la esencia de la marca (valores, manifiesto, materiales, su manera de hablar) y busca una idea con un porqué, que el cliente no habría pedido y le haga decir «esto sí». Debe ser construible (materiales reales, escalas reales) y respetar la identidad visual: paleta, tipografía y tono. Un solo gesto potente vale más que cinco detalles.
Cuéntalo como se lo contarías a un cliente en el estudio, en 3-4 frases naturales y sin plantilla: el nombre de la idea en negrita, el porqué ligado a la marca, qué has tocado y qué has dejado tal cual. Sin viñetas ni etiquetas tipo «Cambia:» o «Intacto:».`;

// ── Fase «preguntar»: antes de dibujar, el agente se asegura de entender qué quiere el usuario (así no inventa)
const BRIEFING = `

FASE PREVIA (obligatoria ahora): NO generes ninguna imagen todavía. El usuario te ha dado un render y una petición, pero todavía no sabes lo bastante para acertar. Haz de entrevistador:
1. En una línea, di qué ves en el render (qué es el espacio, qué hay) para confirmar que lo has entendido, y qué vas a respetar sin tocar.
2. Haz entre 3 y 5 preguntas CORTAS, numeradas, cada una con 2-4 opciones lettered (A, B, C…) para que conteste con una letra, y deja siempre abierta una opción «Otra cosa: …». Preguntas útiles, adaptadas a lo que pide:
   - DÓNDE: ¿en qué zona actúo (pared del fondo, techo, columnas, suelo, zona concreta de la sala)?
   - QUÉ: ¿qué tiene que aparecer exactamente (logo oficial, lema, símbolo, solo ambiente)? Si hay un texto o lema, pídelo literal.
   - SENSACIÓN: ¿qué quiere transmitir (agresivo, premium, industrial, sobrio…)? y ¿protagonista o sutil?
   - NO TOCAR: ¿hay algo que no quiera que cambie?
   - REFERENCIA: ¿tiene un ejemplo, una imagen o un material en la cabeza?
3. Si hay una marca activa, adapta las opciones a ella (colores, materiales y lemas de la ficha) y avisa en una línea de qué usarías.
4. Si hay logo oficial de la marca, di que lo vas a usar tal cual; si no hay logo guardado y la idea lo necesita, pide que lo adjunte en el siguiente mensaje.
5. Termina con: «Contesta con las letras (por ejemplo 1A, 2C…) o cuéntamelo con tus palabras y lo dibujo.»
No propongas todavía la solución final ni hagas un discurso largo.`;

const ANGULOS = [
  'ÁNGULO A — LUZ Y ATMÓSFERA: la idea es una luz o un efecto de iluminación (no un cartel) que cambie cómo se siente la sala, usando la paleta de la marca.',
  'ÁNGULO B — MATERIA Y TEXTURA: la idea es un material, un relieve o un acabado en una superficie grande (pared, techo, suelo o zócalo) que cuente la marca con el tacto, no con letras.',
  'ÁNGULO C — PIEZA PROTAGONISTA: la idea es un único elemento escultórico o gráfico de gran escala (mensaje, símbolo, instalación) colocado con intención y con un mensaje de la marca.',
];

// ── Marcas (brandbooks): se guardan en el almacenamiento como una lista JSON
const BUCKET = 'project-documents', RUTA_MARCAS = 'ia-marcas/_marcas.json';
async function leerMarcas() {
  const { data, error } = await supabase.storage.from(BUCKET).download(RUTA_MARCAS);
  if (error || !data) return [];
  try { const l = JSON.parse(await data.text()); return Array.isArray(l) ? l : []; } catch { return []; }
}
async function guardarMarcas(lista) {
  const { error } = await supabase.storage.from(BUCKET).upload(RUTA_MARCAS, Buffer.from(JSON.stringify(lista)), { upsert: true, contentType: 'application/json' });
  if (error) throw error;
}
const subirPdf = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => (file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname || '') ? cb(null, true) : cb(new Error('Solo se admiten PDFs'), false)),
  limits: { fileSize: 60 * 1024 * 1024, files: 1 },
}).single('file');

async function textoPdf(buffer) {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return String(Array.isArray(text) ? text.join('\n') : text || '');
}

// Pregunta de solo texto al modelo (sirve para resumir el brandbook en una ficha)
async function consultaTexto(clave, instrucciones, entrada) {
  const llama = async modelo => {
    const r = await fetch(OPENAI + '/responses', { method: 'POST', headers: { Authorization: 'Bearer ' + clave, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: modelo, instructions: instrucciones, input: entrada }) });
    return { r, j: await r.json().catch(() => ({})) };
  };
  let modelo = process.env.OPENAI_CHAT_MODEL || modeloElegido || 'gpt-5';
  let { r, j } = await llama(modelo);
  if (!r.ok && !process.env.OPENAI_CHAT_MODEL && /does not exist|model_not_found|do not have access|not found/i.test(JSON.stringify(j?.error || {}))) {
    const otro = await elegirModelo(clave, modelo).catch(() => null);
    if (otro) { modelo = otro; modeloElegido = otro; ({ r, j } = await llama(modelo)); }
  }
  if (!r.ok) throw new Error(j?.error?.message || 'ChatGPT no ha podido resumir la marca');
  return (Array.isArray(j.output) ? j.output : []).filter(o => o.type === 'message').flatMap(o => o.content || []).filter(c => c.type === 'output_text').map(c => c.text).join('\n').trim();
}

const PIDE_FICHA = `Eres director de arte. Te paso el texto de un brandbook. Escribe una FICHA DE DISEÑO DE ESPACIOS en español, de máximo 2800 caracteres, que un diseñador use para decorar un local (gimnasio, tienda, recepción) con esta marca. Estructura con estos títulos y viñetas cortas, sin inventar nada que no esté en el texto (si falta un dato, escribe «no indicado»):
1. ESENCIA: qué es la marca, su arquetipo, el tono y 2-3 ideas que la definen (cita el manifiesto o el lema tal cual si existe).
2. PALETA: cada color con su nombre y su código (HEX/Pantone) y cuál es el dominante, el de acento y el prohibido.
3. TIPOGRAFÍA Y LOGO: fuentes, mayúsculas/minúsculas, uso del logo, zona de seguridad y usos incorrectos.
4. IMAGEN Y AMBIENTE: cómo es la fotografía y la luz que usan; materiales, acabados y texturas que encajan con la marca (deduce solo lo que se desprenda del texto).
5. TEXTOS: tono de voz, claims y frases oficiales para rótulos o murales (literales).
6. EVITAR: lo que la marca prohíbe o desaconseja.
Devuelve solo la ficha.`;

// ── Tendencias de interiorismo: un resumen que se renueva cada semana buscando en la web (si la búsqueda no está disponible, la IA usa lo que sabe)
const RUTA_TENDENCIAS = 'crm/estudio-ideas/tendencias.json';
let refrescandoTend = null;
async function refrescaTendencias() {
  const pedido = 'Resume en español, con datos concretos y sin relleno, QUÉ ESTÁ PASANDO AHORA en interiorismo y diseño de espacios, con foco en gimnasios, boxes de crossfit, estudios boutique, wellness y hospitality: 1) materiales y revestimientos de moda (maderas, lamas, microcemento, piedra, metales, paneles acústicos, texturas), 2) paletas de color y combinaciones que se llevan, 3) rotulación, neones, tipografías, murales y cómo se usa el logo en pared, 4) iluminación y ambientes, 5) ideas atrevidas o poco vistas que hacen destacar un gimnasio. Menciona referencias reales (marcas, cadenas o estudios) cuando las encuentres. Máximo 900 palabras.';
  const sistema = 'Eres analista de tendencias de interiorismo. Fecha de hoy: ' + new Date().toISOString().slice(0, 10) + '. Prioriza lo más reciente.';
  let texto = '';
  try {
    const r = await callClaude({ system: sistema, messages: [{ role: 'user', content: pedido }], tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }], maxTokens: 3500 });
    texto = (r.content || []).filter(b => b.type === 'text').map(b => b.text || '').join('').trim();
  } catch (e) { console.error('tendencias con búsqueda web:', String(e.message).slice(0, 160)); }
  let fuente = 'web';
  if (texto.length < 400) { fuente = 'conocimiento'; const r2 = await callClaude({ system: sistema, messages: [{ role: 'user', content: pedido }], maxTokens: 2500 }); texto = (r2.content || []).map(b => b.text || '').join('').trim(); }
  const out = { fecha: new Date().toISOString(), fuente, texto: texto.slice(0, 7000) };
  await guardarJson(RUTA_TENDENCIAS, out); return out;
}
async function tendenciasActuales() {
  let t = null; try { t = await leerJson(RUTA_TENDENCIAS, null); } catch { /* sin guardar */ }
  const vieja = !t || !t.texto || Date.now() - new Date(t.fecha || 0).getTime() > 7 * 86400000;
  if (vieja) {
    if (!refrescandoTend) refrescandoTend = refrescaTendencias().catch(e => { console.error('tendencias:', e.message); return null; }).finally(() => { refrescandoTend = null; });
    if (!t || !t.texto) { const n = await refrescandoTend; return n?.texto || ''; } // la primera vez se espera; después se sirve lo guardado mientras se renueva
  }
  return t?.texto || '';
}
router.get('/tendencias', async (req, res) => { try { res.json(await leerJson(RUTA_TENDENCIAS, null) || { texto: '' }); } catch { res.status(500).json({ error: 'No se pudo leer' }); } });
router.post('/tendencias/renovar', async (req, res) => { try { res.json(await refrescaTendencias()); } catch (e) { res.status(500).json({ error: String(e.message).slice(0, 160) }); } });

const PRESETS_VALIDOS = { 'pal-vert': 'Palillería vertical (lamas de madera)', 'pal-fina': 'Palillería fina', 'pal-horiz': 'Palillería horizontal', 'estriado': 'Estriado semicircular', 'acustico': 'Lamas acústicas con fieltro', 'boiserie': 'Boiserie (panelado de cuadros)', 'boiserie-2': 'Boiserie en dos filas', 'boiserie-zoc': 'Boiserie con zócalo', 'paneles': 'Paneles con juntas', 'paneles-g': 'Paneles grandes', 'rel-pira': 'Panel 3D pirámides', 'rel-hexa': 'Panel 3D hexágonos', 'rel-cubos': 'Panel 3D cubos', 'rel-tria': 'Panel 3D triángulos', 'rel-onda': 'Panel 3D ondas', 'rej-fina': 'Panel de rejilla fina (retícula de barras)', 'rej-grande': 'Panel de rejilla grande (barras gruesas)', 'celosia': 'Celosía en diagonal (aspa)', 'perforado': 'Panel perforado (discos)', 'zocalo': 'Zócalo alto', 'zocalo-cl': 'Zócalo clásico', 'cornisa': 'Cornisa clásica', 'cornisa-luz': 'Cornisa para luz indirecta', 'guardasilla': 'Guardasillas', 'plana': 'Moldura plana' };
const FUENTES_VALIDAS = { 'Anton-Regular': 'Anton (condensada, potente)', 'BebasNeue-Regular': 'Bebas Neue (condensada, deportiva)', 'ArchivoBlack-Regular': 'Archivo Black (gruesa)', 'Bungee-Regular': 'Bungee (urbana, rotulación)', 'Oswald': 'Oswald (condensada)', 'Staatliches-Regular': 'Staatliches (condensada, cartelería)', 'RussoOne-Regular': 'Russo One (tecnológica)', 'Orbitron': 'Orbitron (futurista)', 'Righteous-Regular': 'Righteous (redondeada, retro)', 'Montserrat-Bold': 'Montserrat Bold (limpia, premium)', 'Montserrat-Regular': 'Montserrat Regular (limpia, fina)', 'Cinzel': 'Cinzel (clásica, elegante)', 'PlayfairDisplay': 'Playfair Display (serif editorial)', 'AbrilFatface-Regular': 'Abril Fatface (serif de impacto)', 'Bangers-Regular': 'Bangers (cómic)', 'Caveat': 'Caveat (manuscrita informal)', 'DancingScript': 'Dancing Script (cursiva)', 'Lobster-Regular': 'Lobster (cursiva gruesa)', 'Pacifico-Regular': 'Pacifico (surf, retro)', 'PinyonScript-Regular': 'Pinyon Script (caligrafía elegante)' };
// Ideas completas para UNA pared: pintura + revestimiento + rotulación, con tendencias reales y sin depender de lo que pida el usuario
router.post('/interiorismo', async (req, res) => {
  try {
    const b = req.body || {}, objetivo = String(b.objetivo || '').slice(0, 400), contexto = (await contextoCrm(b.medicionId)) + String(b.contexto || '').slice(0, 3500), otras = String(b.otras || '').slice(0, 400), actual = String(b.actual || '').slice(0, 200);
    const previas = (Array.isArray(b.previas) ? b.previas : []).map(x => String(x || '').slice(0, 80)).slice(0, 24);
    const mu = { largo: Math.max(50, Math.min(5000, Number(b.muro?.largo) || 400)), alto: Math.max(150, Math.min(600, Number(b.muro?.alto) || 260)), sala: String(b.muro?.sala || '').slice(0, 60) };
    let marca = ''; if (b.marcaId) { try { const m = (await leerMarcas()).find(x => x.id === b.marcaId); if (m) marca = 'MARCA DEL CLIENTE (úsala: colores, lemas y tono):\n' + String(m.ficha || '').slice(0, 2200); } catch { /* sin marca */ } }
    let tend = ''; try { tend = await tendenciasActuales(); } catch (e) { console.error('tendencias:', e.message); }
    const system = 'Eres directora creativa de interiorismo de Ranuse Design (gimnasios, boxes de crossfit, estudios boutique). Tu trabajo es DAR INSPIRACIÓN: quien te consulta muchas veces no sabe qué hacer, así que no te limites a lo que pida: sorprende con ideas que no se le habrían ocurrido, apoyadas en las TENDENCIAS ACTUALES, y que se puedan construir. Cada idea es un concepto completo para UNA pared (y su techo), con capas que el programa aplica al modelo 3D: (1) pintura base (hex), (1b) PATRONES pintados sobre la pared (franjas, bloques de color, rayas verticales, arcos…) que dan carácter y estilo, (1c) una FRANJA PINTADA EN EL TECHO paralela a la pared (por ejemplo una banda oscura que baja la altura percibida o una banda de color de marca), (1d) LUCES con las que jugar: la franja de techo puede ser LUMINOSA ("led":true), el rótulo puede ser un NEÓN que brilla ("neon":true) y puedes añadir hasta 2 tiras LED en la pared: "alta" (lava la pared hacia abajo desde arriba, muy buena sobre lamas o texturas) o "baja" (luz flotante junto al suelo que da profundidad), cada una con temperatura en kelvin (2700 cálida, 3000, 4000 neutra, 5000 fría) y color opcional para ambientes de color; piensa la luz como parte de la idea (luz cálida rasante sobre madera, neón de marca, contraluz tras un panel) y no pongas luces en todas las ideas, (2) hasta 2 REVESTIMIENTOS creativos elegidos SOLO de esta lista de ids: ' + Object.entries(PRESETS_VALIDOS).map(([k, v]) => k + '=' + v).join('; ') + ', y (3) rotulación opcional: un texto con intención. REGLAS DEL RÓTULO: nunca es solo el nombre de una zona o de un ejercicio ni una palabra suelta típica de gimnasio (GLÚTEO, DISCOS, PIERNA, BEAST MODE, TRAIN HARD, NO PAIN NO GAIN…); si lo pones debe ser una frase corta ORIGINAL con voz de marca, relacionada con la idea del concepto, en el idioma del negocio, que alguien querría fotografiar; si no se te ocurre algo bueno, no pongas rótulo (es mejor ninguno que uno tópico); no inventes datos del cliente con una fuente elegida SOLO de esta lista de ids: ' + Object.entries(FUENTES_VALIDAS).map(([k, v]) => k + '=' + v).join('; ') + '. Las 4 ideas deben ser MUY distintas entre sí (estilo, color y atmósfera) y al menos UNA debe ser atrevida e inesperada. No repitas las ideas ya mostradas. Para cada idea explica en "referencia" de qué tendencia o referencia real sale. Responde SOLO JSON: {"ideas":[{"titulo":"","descripcion":"2 frases con la sensación y por qué funciona","referencia":"tendencia o referencia real en una frase","pintura":"#RRGGBB","acento":"#RRGGBB","patron":[{"forma":"franja|bloque|rayas|arco","desde":0.0,"hasta":1.0,"alturaDesde":0,"alturaHasta":110,"n":5,"color":"#RRGGBB"}] o [],"techo":{"color":"#RRGGBB","distancia":0,"ancho":60,"led":false} o null,"luces":[{"donde":"alta|baja","k":3000,"color":"#RRGGBB o null"}] o [],"revestimientos":[{"id":"id de la lista","color":"#RRGGBB","porque":"una frase","desde":0.0,"hasta":1.0,"alturaDesde":0,"alturaHasta":260}] o [],"rotulo":{"texto":"FRASE","fuente":"id de la lista","color":"#RRGGBB","alturaCentro":150,"posicion":0.5,"ancho":200,"neon":false} o null}]}. Exactamente 4 ideas. Los números en cm; REVESTIMIENTOS: no tienes que usarlos como se usan siempre (toda la pared de suelo a techo). SÉ CREATIVA: panelado solo como zócalo o media pared, una franja de lamas a media altura, una isla de lamas detrás del rótulo, un tramo vertical que sube hasta el techo, paneles 3D solo en una zona focal, boiserie en un color atrevido, dos revestimientos combinados a alturas distintas, lamas acústicas como cabecero o como marco, molduras que enmarquen un cuadro o un rótulo. Ajusta "desde"/"hasta" (fracción 0-1 del largo del muro) y "alturaDesde"/"alturaHasta" (cm) para colocarlos donde aporten estilo; cuida que no tapen el rótulo ni se pisen con los patrones pintados. "patron": hasta 3 piezas pintadas sobre la pared: franja = banda horizontal (alturaDesde/alturaHasta en cm, desde/hasta como fracción 0-1 del largo del muro), bloque = rectángulo de color (desde/hasta y alturas), rayas = n rayas verticales alternas entre desde y hasta, arco = arco decorativo entre desde y hasta que sube hasta alturaHasta; usa patrones solo cuando aporten estilo (no en todas las ideas) y que combinen con el rótulo y el revestimiento sin taparse entre sí; "techo": franja pintada en el techo paralela al muro, "distancia" en cm desde la pared (0 = pegada) y "ancho" entre 30 y 200 cm; "posicion" entre 0.15 y 0.85 a lo largo del muro; "ancho" no mayor que el 70 % del largo del muro; la altura del centro del rótulo entre 80 y alto-40.';
    const user = zonasTexto(b.zonasCerca) + 'Pared: ' + mu.largo + ' cm de largo × ' + mu.alto + ' cm de alto' + (mu.sala ? ', en «' + mu.sala + '»' : '') + '. Color actual: ' + (actual || 'sin definir') + '. Demás superficies: ' + (otras || 'sin definir') + '.\n' + (objetivo ? 'Lo que me gustaría (solo una pista, sorpréndeme): ' + objetivo + '\n' : 'No tengo ninguna pista: sorpréndeme.\n') + (previas.length ? 'Ideas que ya me has enseñado y NO quiero repetir: ' + previas.join(' | ') + '\n' : '') + (marca ? marca + '\n' : '') + 'PROYECTO:\n' + contexto + (tend ? '\n\nTENDENCIAS ACTUALES (' + 'resumen reciente' + '):\n' + tend.slice(0, 5500) : '');
    const r = await callClaude({ system, messages: [{ role: 'user', content: user }], maxTokens: 3500 });
    const txt = (r.content || []).map(x => x.text || '').join(''), j = JSON.parse(/\{[\s\S]*\}/.exec(txt)[0]);
    const hex = v => (/^#[0-9a-fA-F]{6}$/.test(String(v || '').trim()) ? String(v).trim().toLowerCase() : null), cl = (v, a, c, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(a, Math.min(c, n)) : d; };
    const ideas = (Array.isArray(j.ideas) ? j.ideas : []).slice(0, 4).map(x => {
      const rvs = (Array.isArray(x?.revestimientos) ? x.revestimientos : (x?.revestimiento ? [x.revestimiento] : [])).slice(0, 2).map(q => { if (!q || !PRESETS_VALIDOS[q.id]) return null; const d = cl(q.desde, 0, 0.95, 0), h = cl(q.hasta, 0.05, 1, 1), a0 = cl(q.alturaDesde, 0, mu.alto - 20, 0); return { id: q.id, nombre: PRESETS_VALIDOS[q.id], color: hex(q.color), porque: String(q.porque || '').slice(0, 160), desde: Math.min(d, h - 0.05), hasta: Math.max(h, d + 0.05), alturaDesde: a0, alturaHasta: Math.max(a0 + 20, cl(q.alturaHasta, 20, mu.alto, mu.alto)) }; }).filter(Boolean);
      const ro = x?.rotulo && String(x.rotulo.texto || '').trim() && FUENTES_VALIDAS[x.rotulo.fuente] ? { texto: String(x.rotulo.texto).trim().slice(0, 60), fuente: x.rotulo.fuente, color: hex(x.rotulo.color) || '#ffffff', neon: !!x.rotulo.neon, alturaCentro: cl(x.rotulo.alturaCentro, 60, mu.alto - 30, Math.round(mu.alto * 0.6)), posicion: cl(x.rotulo.posicion, 0.15, 0.85, 0.5), ancho: cl(x.rotulo.ancho, 30, mu.largo * 0.7, Math.min(250, mu.largo * 0.6)) } : null;
      const patron = (Array.isArray(x?.patron) ? x.patron : []).slice(0, 3).map(p => { const forma = ['franja', 'bloque', 'rayas', 'arco'].includes(p?.forma) ? p.forma : null, color = hex(p?.color); if (!forma || !color) return null; const d = cl(p.desde, 0, 0.95, 0), h = cl(p.hasta, 0.05, 1, 1), a0 = cl(p.alturaDesde, 0, mu.alto - 10, 0); return { forma, color, desde: Math.min(d, h - 0.05), hasta: Math.max(h, d + 0.05), alturaDesde: a0, alturaHasta: Math.max(a0 + 10, cl(p.alturaHasta, 10, mu.alto, 110)), n: Math.round(cl(p.n, 2, 16, 5)) }; }).filter(Boolean);
      const te = x?.techo && hex(x.techo.color) ? { color: hex(x.techo.color), distancia: cl(x.techo.distancia, 0, 600, 0), ancho: cl(x.techo.ancho, 30, 300, 60), led: !!x.techo.led } : null;
      return { titulo: String(x?.titulo || 'Idea').slice(0, 60), descripcion: String(x?.descripcion || '').slice(0, 400), referencia: String(x?.referencia || '').slice(0, 220), pintura: hex(x?.pintura), acento: hex(x?.acento), patron, techo: te, luces: (Array.isArray(x?.luces) ? x.luces : []).slice(0, 2).map(l => (['alta', 'baja'].includes(l?.donde) ? { donde: l.donde, k: Math.round(cl(l.k, 2200, 6500, 3000)), color: hex(l.color) } : null)).filter(Boolean), revestimientos: rvs, rotulo: ro };
    }).filter(x => x.pintura || x.revestimientos.length || x.rotulo || x.patron.length || x.techo || x.luces.length);
    if (!ideas.length) return res.status(502).json({ error: 'La IA no devolvió ideas válidas. Inténtalo otra vez.' });
    res.json({ ideas, tendencias: !!tend });
  } catch (e) { console.error('estudio-ideas interiorismo:', e.message); res.status(500).json({ error: 'No se pudieron generar las ideas: ' + String(e.message).slice(0, 150) }); }
});

// Concepto completo de UNA sala: una idea que lo une todo (suelo, techo, cada pared con su papel, luces y decoración), no solo cambiar colores
// Afinado de colores de un concepto: cualquier IA tiende a pasarse de saturación y a juntar tonos parecidos. Aquí se corrige para que se vea profesional:
// colores vivos algo apagados (salvo el acento), y contraste suficiente entre paredes, suelo y techo.
const hsl = (h) => { const n = parseInt(h.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let hh = 0, s = 0; if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hh /= 6; } return [hh, s, l]; };
const aHex = ([h, s, l]) => { const f = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; }; let r, g, b; if (s === 0) r = g = b = l; else { const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; r = f(p, q, h + 1 / 3); g = f(p, q, h); b = f(p, q, h - 1 / 3); } return '#' + [r, g, b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join(''); };
const lumRel = (h) => { const n = parseInt(h.slice(1), 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contraste = (a, b) => { const x = lumRel(a), y = lumRel(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const desatura = (h, tope) => { if (!/^#[0-9a-f]{6}$/i.test(h || '')) return h; const [hh, s, l] = hsl(h); return s > tope ? aHex([hh, tope, l]) : h; };
const separa = (h, ref, min) => { if (!/^#[0-9a-f]{6}$/i.test(h || '') || !/^#[0-9a-f]{6}$/i.test(ref || '')) return h; let [hh, s, l] = hsl(h); const dir = lumRel(h) >= lumRel(ref) ? 1 : -1; for (let i = 0; i < 12 && contraste(aHex([hh, s, l]), ref) < min; i++) l = Math.max(0.04, Math.min(0.96, l + dir * 0.04)); return aHex([hh, s, l]); };
function afinaIdea(x) {
  try {
    const sueloC = x.suelo?.color || null, techoC = x.techo?.color || null;
    if (x.paredes) { x.paredes = desatura(x.paredes, 0.55); if (sueloC) x.paredes = separa(x.paredes, sueloC, 1.5); if (techoC && contraste(x.paredes, techoC) < 1.12) x.paredes = separa(x.paredes, techoC, 1.2); }
    if (x.techo?.color) x.techo.color = desatura(x.techo.color, 0.5);
    if (x.suelo?.color) x.suelo.color = desatura(x.suelo.color, 0.55);
    (x.muros || []).forEach(m => { if (m.pintura) { m.pintura = desatura(m.pintura, m.rol === 'focal' ? 0.8 : 0.55); if (x.paredes && m.rol !== 'focal' && contraste(m.pintura, x.paredes) < 1.05) m.pintura = x.paredes; } (m.patron || []).forEach(p => { p.color = desatura(p.color, 0.8); }); });
  } catch { /* si algo falla se deja la idea tal cual */ }
  return x;
}

router.post('/sala', async (req, res) => {
  try {
    const b = req.body || {}, objetivo = String(b.objetivo || '').slice(0, 500), contexto = (await contextoCrm(b.medicionId)) + String(b.contexto || '').slice(0, 3000);
    const previas = (Array.isArray(b.previas) ? b.previas : []).map(x => String(x || '').slice(0, 80)).slice(0, 24);
    const sala = { nombre: String(b.sala?.nombre || '').slice(0, 60), area: Math.max(1, Math.min(5000, Number(b.sala?.area) || 50)), largo: Math.round(Number(b.sala?.largo) || 0), ancho: Math.round(Number(b.sala?.ancho) || 0), maquinas: Math.max(0, Math.min(500, Number(b.sala?.maquinas) || 0)), puertas: Math.max(0, Math.min(30, Number(b.sala?.puertas) || 0)) };
    const muros = (Array.isArray(b.muros) ? b.muros : []).slice(0, 14).map(m => ({ id: String(m?.id || '').slice(0, 40), largo: Math.max(50, Math.min(8000, Number(m?.largo) || 300)), alto: Math.max(150, Math.min(600, Number(m?.alto) || 260)), lado: String(m?.lado || '').slice(0, 20), curva: !!m?.curva, aberturas: Math.max(0, Math.min(20, Number(m?.aberturas) || 0)), cerca: (Array.isArray(m?.cerca) ? m.cerca : []).slice(0, 4).map(x => String(x || '').slice(0, 40)) })).filter(m => m.id);
    if (!muros.length) return res.status(400).json({ error: 'No encuentro las paredes de esta sala' });
    const pilares = (Array.isArray(b.pilares) ? b.pilares : []).slice(0, 24).map(p => ({ id: String(p?.id || '').slice(0, 40), nombre: String(p?.nombre || '').slice(0, 20), w: Math.round(Number(p?.w) || 0), d: Math.round(Number(p?.d) || 0), alto: Math.round(Number(p?.alto) || 0), cerca: String(p?.cerca || '').slice(0, 60) })).filter(p => p.id);
    const pilaresValidos = new Set(pilares.map(p => p.id));
    const piezas = (Array.isArray(b.piezas) ? b.piezas : []).slice(0, 110).map(p => ({ id: String(p?.id || '').slice(0, 60), nombre: String(p?.nombre || '').slice(0, 60), categoria: String(p?.categoria || '').slice(0, 30), w: Math.round(Number(p?.w) || 0), d: Math.round(Number(p?.d) || 0), alto: Math.round(Number(p?.alto) || 0) })).filter(p => p.id && p.nombre);
    const suelos = (Array.isArray(b.suelos) ? b.suelos : []).slice(0, 40).map(p => ({ id: String(p?.id || '').slice(0, 60), nombre: String(p?.nombre || '').slice(0, 60) })).filter(p => p.id);
    const validas = new Map(piezas.map(p => [p.id, p])), validasSuelo = new Set(suelos.map(p => p.id)), porId = new Map(muros.map(m => [m.id, m]));
    let tend = ''; try { tend = await tendenciasActuales(); } catch (e) { console.error('tendencias:', e.message); }
    const system = 'Eres directora creativa de interiorismo de Ranuse Design (gimnasios, boxes de crossfit, estudios boutique). Diseñas el CONCEPTO COMPLETO DE UNA SALA, no de todo el gimnasio. Quien te consulta muchas veces no sabe qué hacer y, cuando ha dado un estilo, solo recibía cambios de color: eso NO sirve. Cada concepto tiene UNA IDEA DIFERENCIAL clara (una frase) que lo hace memorable y se nota en toda la sala (por ejemplo «la pared cabecera como altar de madera con luz rasante», «un túnel de luz en el techo que guía hacia el fondo», «zona de entrenamiento enmarcada por lamas como si fuera un estudio de cine»), y la construyes con capas: un SUELO, un TECHO, y paredes con PAPELES distintos (una pared FOCAL con el gesto principal —revestimiento creativo, rótulo, patrón o luz—, paredes de APOYO con un gesto más suave, paredes NEUTRAS casi sin tocar para que respire), LUCES y DECORACIÓN. No pintes todas las paredes igual ni cambies solo colores: busca contraste de materiales y de luz, y respeta el estilo que te hayan pedido pero aportando algo que no se le habría ocurrido. Tienes que ser realista en un gimnasio: nada que estorbe a máquinas ni a la circulación. RÓTULOS: nunca pongas solo el nombre de una zona o de un ejercicio ni palabras sueltas típicas de gimnasio (GLÚTEO, DISCOS, BEAST MODE, TRAIN HARD…). Un rótulo es una frase corta ORIGINAL con voz de marca ligada a la idea diferencial, o no hay rótulo: es mejor ninguno que uno tópico. COLOR BASE DE PAREDES: si cambias el color de las paredes, lo normal es que sean TODAS las de la sala (usa el campo "paredes" con un hex) y que después des el gesto especial a la pared focal y a las de apoyo; no te limites a una sola pared. Las paredes marcadas CURVA siguen su línea: admiten pintura, revestimiento, franja o bloque de color y luces, que seguirán la curva; NO les pongas rótulo, arcos ni rayas. Puedes proponer materiales poco habituales cuando encajen con el estilo: paneles de rejilla (rej-fina, rej-grande), celosía en diagonal, panel perforado, lamas como marco o como techo de pared, paneles 3D. Piensa en las ZONAS de la sala (zona de pesas, de cardio, de recepción…) y en cómo se recorre. Para el suelo usa SOLO ids de esta lista (o null y un color si ninguno encaja): ' + (suelos.map(p => p.id + '=' + p.nombre).join('; ') || 'ninguno') + '. Revestimientos SOLO de esta lista de ids: ' + Object.entries(PRESETS_VALIDOS).map(([k, v]) => k + '=' + v).join('; ') + '. Fuentes del rótulo SOLO de esta lista: ' + Object.entries(FUENTES_VALIDAS).map(([k, v]) => k + '=' + v).join('; ') + '. ' + TEXTO_LIBRES + 'Piezas de la biblioteca (id): ' + (piezas.map(p => p.id + '=' + p.nombre + ' [' + p.categoria + ', ' + p.w + 'x' + p.d + 'x' + p.alto + ' cm]').join('; ') || 'ninguna todavía') + '. Los cuadros y espejos van siempre en "pared". Ubicaciones de decoración: esquina, pared, entrada, centro. Las 3 ideas deben ser MUY distintas entre sí y una atrevida. No repitas las ya mostradas. Responde SOLO JSON: {"ideas":[{"titulo":"","idea":"la idea diferencial en una frase","descripcion":"3 frases: qué se siente al entrar y por qué funciona","referencia":"tendencia o referencia real en una frase","suelo":{"id":"id de la lista o null","color":"#RRGGBB o null"},"techo":{"color":"#RRGGBB o null"},"paredes":"#RRGGBB color base de todas las paredes o null","muros":[{"id":"id del muro","rol":"focal|apoyo|neutro","pintura":"#RRGGBB","patron":[{"forma":"franja|bloque|rayas|arco","desde":0.0,"hasta":1.0,"alturaDesde":0,"alturaHasta":110,"n":5,"color":"#RRGGBB"}],"techo":{"color":"#RRGGBB","distancia":0,"ancho":60,"led":false} o null,"luces":[{"donde":"alta|baja","k":3000,"color":"#RRGGBB o null"}],"revestimientos":[{"id":"id","color":"#RRGGBB","porque":"","desde":0.0,"hasta":1.0,"alturaDesde":0,"alturaHasta":260}],"rotulo":{"texto":"FRASE","fuente":"id","color":"#RRGGBB","alturaCentro":150,"posicion":0.5,"ancho":200,"neon":false} o null}],"pilares":[{"id":"id de un pilar de la lista","color":"#RRGGBB opcional","revestimiento":"id de revestimiento opcional","colorRev":"#RRGGBB opcional","led":true,"porque":"una frase"}],"decoracion":[{"id":"id de la lista (o en su lugar libre:tipo)","libre":"tipo opcional","color":"#RRGGBB opcional","color2":"#RRGGBB opcional","cantidad":1,"escala":1.0,"ubicacion":"esquina|pared|entrada|centro"}]}]}. Exactamente 3 ideas. REGLAS DE CALIDAD (obligatorias, es lo que separa un diseño profesional de uno corriente): (1) paleta cerrada: 3 o 4 colores neutros o apagados en total más UN solo color de acento, usado solo en la pared focal y en uno o dos detalles; nada de colores vivos puros (saturación alta) salvo ese acento; (2) contraste claro entre suelo, paredes y techo (que no se confundan: si el suelo es oscuro, las paredes son medias o claras, y al revés); (3) una sola temperatura de luz coherente con la paleta (cálida 2700-3000 K con maderas, tierras y rojos; neutra 3500-4000 K con grises y negros) y el color de las luces LED del mismo tono que el acento; (4) materiales con intención: si propones un revestimiento o un patrón, que repita el acento o un tono de la paleta; (5) menos es más: cada elemento extra tiene que tener un motivo en la idea diferencial; no rellenes; (6) respeta el estilo y los colores de la marca del proyecto si aparecen en el contexto. Incluye en "muros" SOLO las paredes que tocas (la focal siempre; las neutras pueden ir sin capas o no aparecer). Los números van en cm; "ancho" del rótulo no mayor que el 70 % del largo del muro; "alturaCentro" entre 80 y alto-40.';
    const user = 'Sala: «' + sala.nombre + '», ' + sala.area + ' m² (' + sala.largo + ' × ' + sala.ancho + ' cm aprox.), ' + sala.maquinas + ' máquinas, ' + sala.puertas + ' puertas.\n' + zonasTexto(b.zonas) + (pilares.length ? 'PILARES Y COLUMNAS DE LA SALA (usa estos ids en "pilares"): ' + pilares.map(p => p.id + ' → ' + p.w + '×' + p.d + ' cm, ' + p.alto + ' cm de alto' + (p.cerca ? ', ' + p.cerca : '')).join(' | ') + '\nLos pilares pueden ser un buen punto focal, pero SOLO si aportan al concepto: con SENTIDO y con MODERACIÓN. Reglas: (1) si el concepto no gana nada con ellos, déjalos sin tocar y no devuelvas "pilares"; (2) nunca trates todos los pilares con lo mismo por rellenar; (3) como mucho una o dos intervenciones distintas en toda la sala (por ejemplo, destacar los pilares que marcan una zona o la entrada, o una serie de pilares alineados con el mismo acabado), y cada una con un motivo claro en "porque" que conecte con la idea diferencial; (4) no mezcles color, revestimiento y LED en el mismo pilar salvo que sea el protagonista del concepto; (5) los pilares pegados a una pared suelen integrarse con ella: no los destaques sin razón.\n' : '') + 'PAREDES DE LA SALA (usa estos ids; cada una es un TRAMO continuo): ' + muros.map(m => m.id + ' → ' + m.largo + ' cm de largo × ' + m.alto + ' de alto, lado ' + m.lado + (m.curva ? ', CURVA (sigue una línea curva)' : '') + (m.aberturas ? ', ' + m.aberturas + ' abertura(s)' : '') + (m.cerca.length ? ', cerca hay: ' + m.cerca.join(', ') : '')).join(' | ') + '\n' + (objetivo ? 'Estilo o pista que me han dado (respétalo, pero APORTA ideas diferenciales, no solo colores): ' + objetivo + '\n' : 'No me han dado ninguna pista: sorpréndeme.\n') + (previas.length ? 'Ideas que ya me has enseñado y NO quiero repetir: ' + previas.join(' | ') + '\n' : '') + 'PROYECTO:\n' + contexto + (tend ? '\n\nTENDENCIAS ACTUALES:\n' + tend.slice(0, 4500) : '');
    const r = await callClaude({ system, messages: [{ role: 'user', content: user }], maxTokens: 6000 });
    const txt = (r.content || []).map(x => x.text || '').join(''), j = JSON.parse(/\{[\s\S]*\}/.exec(txt)[0]);
    const hex = v => (/^#[0-9a-fA-F]{6}$/.test(String(v || '').trim()) ? String(v).trim().toLowerCase() : null), cl = (v, a, c, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(a, Math.min(c, n)) : d; };
    const capas = (x, mu) => {
      const patron = (Array.isArray(x?.patron) ? x.patron : []).slice(0, 3).map(p => { const forma = ['franja', 'bloque', 'rayas', 'arco'].includes(p?.forma) ? p.forma : null, color = hex(p?.color); if (!forma || !color) return null; const d = cl(p.desde, 0, 0.95, 0), h = cl(p.hasta, 0.05, 1, 1), a0 = cl(p.alturaDesde, 0, mu.alto - 10, 0); return { forma, color, desde: Math.min(d, h - 0.05), hasta: Math.max(h, d + 0.05), alturaDesde: a0, alturaHasta: Math.max(a0 + 10, cl(p.alturaHasta, 10, mu.alto, 110)), n: Math.round(cl(p.n, 2, 16, 5)) }; }).filter(Boolean);
      const techo = x?.techo && hex(x.techo.color) ? { color: hex(x.techo.color), distancia: cl(x.techo.distancia, 0, 600, 0), ancho: cl(x.techo.ancho, 30, 300, 60), led: !!x.techo.led } : null;
      const luces = (Array.isArray(x?.luces) ? x.luces : []).slice(0, 2).map(l => (['alta', 'baja'].includes(l?.donde) ? { donde: l.donde, k: Math.round(cl(l.k, 2200, 6500, 3000)), color: hex(l.color) } : null)).filter(Boolean);
      const revestimientos = (Array.isArray(x?.revestimientos) ? x.revestimientos : []).slice(0, 2).map(q => { if (!q || !PRESETS_VALIDOS[q.id]) return null; const d = cl(q.desde, 0, 0.95, 0), h = cl(q.hasta, 0.05, 1, 1), a0 = cl(q.alturaDesde, 0, mu.alto - 20, 0); return { id: q.id, nombre: PRESETS_VALIDOS[q.id], color: hex(q.color), porque: String(q.porque || '').slice(0, 160), desde: Math.min(d, h - 0.05), hasta: Math.max(h, d + 0.05), alturaDesde: a0, alturaHasta: Math.max(a0 + 20, cl(q.alturaHasta, 20, mu.alto, mu.alto)) }; }).filter(Boolean);
      const rotulo = x?.rotulo && String(x.rotulo.texto || '').trim() && FUENTES_VALIDAS[x.rotulo.fuente] ? { texto: String(x.rotulo.texto).trim().slice(0, 60), fuente: x.rotulo.fuente, color: hex(x.rotulo.color) || '#ffffff', neon: !!x.rotulo.neon, alturaCentro: cl(x.rotulo.alturaCentro, 60, mu.alto - 30, Math.round(mu.alto * 0.6)), posicion: cl(x.rotulo.posicion, 0.15, 0.85, 0.5), ancho: cl(x.rotulo.ancho, 30, mu.largo * 0.7, Math.min(250, mu.largo * 0.6)) } : null;
      return { pintura: hex(x?.pintura), patron, techo, luces, revestimientos, rotulo };
    };
    const ideas = (Array.isArray(j.ideas) ? j.ideas : []).slice(0, 3).map(x => {
      const suelo = x?.suelo ? { id: validasSuelo.has(String(x.suelo.id || '')) ? String(x.suelo.id) : null, color: hex(x.suelo.color) } : null;
      const ms = (Array.isArray(x?.muros) ? x.muros : []).map(m => { const mu = porId.get(String(m?.id || '')); if (!mu) return null; const c = capas(m, mu); return { id: mu.id, rol: ['focal', 'apoyo', 'neutro'].includes(m.rol) ? m.rol : 'apoyo', ...c }; }).filter(m => m && (m.pintura || m.patron.length || m.techo || m.luces.length || m.revestimientos.length || m.rotulo));
      const decoracion = (Array.isArray(x?.decoracion) ? x.decoracion : []).slice(0, 8).map(e => normDeco(e, validas)).filter(Boolean);
      const pil = (Array.isArray(x?.pilares) ? x.pilares : []).slice(0, 24).map(p => { const id = String(p?.id || ''); if (!pilaresValidos.has(id)) return null; const rv = PRESETS_VALIDOS[p?.revestimiento] ? p.revestimiento : null, color = hex(p?.color), colorRev = hex(p?.colorRev); if (!rv && !color && !p?.led) return null; return { id, color, revestimiento: rv, nombreRev: rv ? PRESETS_VALIDOS[rv] : null, colorRev, led: !!p?.led, porque: String(p?.porque || '').slice(0, 140) }; }).filter(Boolean);
      return { pilares: pil, titulo: String(x?.titulo || 'Concepto').slice(0, 60), idea: String(x?.idea || '').slice(0, 220), descripcion: String(x?.descripcion || '').slice(0, 500), referencia: String(x?.referencia || '').slice(0, 220), suelo: suelo && (suelo.id || suelo.color) ? suelo : null, techo: x?.techo && hex(x.techo.color) ? { color: hex(x.techo.color) } : null, paredes: hex(x?.paredes), muros: ms, decoracion };
    }).filter(x => x.muros.length || x.suelo || x.techo || x.paredes || x.pilares.length).map(afinaIdea);
    if (!ideas.length) return res.status(502).json({ error: 'La IA no devolvió ideas válidas. Inténtalo otra vez.' });
    res.json({ ideas });
  } catch (e) { console.error('estudio-ideas sala:', e.message); res.status(500).json({ error: 'No se pudieron generar las ideas: ' + String(e.message).slice(0, 150) }); }
});

// Piezas de decoración «libres»: las construye el propio programa, así que la IA no depende de lo que haya en la biblioteca 3D
const LIBRES_DECO = { planta: 'Planta grande en maceta', planta_alta: 'Planta alta o palmera', arbusto: 'Jardinera con arbusto', escultura_esfera: 'Escultura de esferas apiladas', escultura_arco: 'Escultura en arco', escultura_monolito: 'Monolito escultórico', banco: 'Banco', columna_luz: 'Columna de luz (brilla)', cuadro: 'Cuadro grande de pared', persona_de_pie: 'Persona de pie', persona_andando: 'Persona andando', persona_corriendo: 'Persona corriendo (junto a una cinta)', persona_mancuernas: 'Persona con mancuernas', persona_sentadilla: 'Persona haciendo sentadilla', persona_sentada: 'Persona sentada (en un banco)', persona_estirando: 'Persona estirando', grupo_hablando: 'Dos personas hablando' };
const TEXTO_LIBRES = 'Además de las piezas de la lista puedes usar PIEZAS LIBRES que el programa construye (no dependen de la biblioteca, así que úsalas con generosidad cuando aporten): ' + Object.entries(LIBRES_DECO).map(([k, v]) => k + '=' + v).join('; ') + '. LAS PERSONAS (persona_de_pie, persona_andando, persona_corriendo, persona_mancuernas, persona_sentadilla, persona_sentada, persona_estirando, grupo_hablando) dan VIDA y sobre todo ESCALA al espacio: incluye 2 a 5 en al menos una de las ideas (en "centro" o junto a las zonas donde tendría sentido: una persona entrenando, otras andando o hablando) y usa colores de ropa discretos (color y color2). Para una pieza libre pon "libre":"tipo" en lugar de "id", y opcionalmente "color" (hex del cuerpo, maceta, banco o lienzo), "color2" (hex del follaje, de las patas o de la luz) y "ancho"/"alto" en cm. ';
const normDeco = (e, validas) => {
  const hx = v => (/^#[0-9a-fA-F]{6}$/.test(String(v || '').trim()) ? String(v).trim().toLowerCase() : null), cl = (v, a, c, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(a, Math.min(c, n)) : d; };
  const ub = u => (['esquina', 'pared', 'entrada', 'centro'].includes(u) ? u : 'esquina');
  if (e?.libre && LIBRES_DECO[e.libre]) { const cuadro = e.libre === 'cuadro'; return { libre: e.libre, nombre: LIBRES_DECO[e.libre], color: hx(e.color), color2: hx(e.color2), ancho: e.ancho ? cl(e.ancho, 20, 400, 0) : 0, altoCm: e.alto ? cl(e.alto, 20, 400, 0) : 0, cantidad: Math.round(cl(e.cantidad, 1, 6, 1)), escala: cl(e.escala, 0.5, 2, 1), ubicacion: cuadro ? 'pared' : ub(e.ubicacion) }; }
  const p = validas.get(String(e?.id || '')); if (!p) return null; const cuadro = /cuadro|espejo/i.test(p.categoria);
  return { id: p.id, nombre: p.nombre, cantidad: Math.round(cl(e.cantidad, 1, 6, 1)), escala: cl(e.escala, 0.5, 2, 1), ubicacion: cuadro ? 'pared' : ub(e.ubicacion) };
};

// Decoración de una sala: la IA elige piezas de la biblioteca 3D (plantas, esculturas, cuadros, lámparas…) y DÓNDE van (esquina, pared, entrada, centro); el visor calcula el sitio exacto sin chocar con las máquinas
router.post('/decoracion', async (req, res) => {
  try {
    const b = req.body || {}, objetivo = String(b.objetivo || '').slice(0, 400), contexto = (await contextoCrm(b.medicionId)) + String(b.contexto || '').slice(0, 3000), previas = (Array.isArray(b.previas) ? b.previas : []).map(x => String(x || '').slice(0, 80)).slice(0, 24);
    const sala = { nombre: String(b.sala?.nombre || '').slice(0, 60), area: Math.max(1, Math.min(5000, Number(b.sala?.area) || 50)), largo: Math.round(Number(b.sala?.largo) || 0), ancho: Math.round(Number(b.sala?.ancho) || 0), esquinas: Math.max(0, Math.min(40, Number(b.sala?.esquinas) || 0)), puertas: Math.max(0, Math.min(20, Number(b.sala?.puertas) || 0)), maquinas: Math.max(0, Math.min(500, Number(b.sala?.maquinas) || 0)) };
    const piezas = (Array.isArray(b.piezas) ? b.piezas : []).slice(0, 110).map(p => ({ id: String(p?.id || '').slice(0, 60), nombre: String(p?.nombre || '').slice(0, 60), categoria: String(p?.categoria || '').slice(0, 30), w: Math.round(Number(p?.w) || 0), d: Math.round(Number(p?.d) || 0), alto: Math.round(Number(p?.alto) || 0) })).filter(p => p.id && p.nombre);
    const validas = new Map(piezas.map(p => [p.id, p]));
    let tend = ''; try { tend = await tendenciasActuales(); } catch (e) { console.error('tendencias:', e.message); }
    const system = 'Eres directora creativa de interiorismo de Ranuse Design (gimnasios, boxes de crossfit, estudios boutique). Decoras una sala eligiendo piezas de una biblioteca 3D concreta. Quien te consulta muchas veces no sabe qué hacer: SORPRENDE con ideas que no se le habrían ocurrido, apoyadas en las tendencias actuales (biofilia, piezas escultóricas, cuadros grandes, iluminación de ambiente, zonas de espera acogedoras…), pero que sean realistas en un gimnasio: nada que estorbe al entrenar ni a la circulación. Cada idea es una composición de 3 a 7 piezas. Para cada pieza di cuántas (cantidad 1-6), la escala (0.7 a 1.8) y la ubicación: "esquina" (plantas y lámparas altas), "pared" (cuadros, espejos, bancos, estanterías, piezas pegadas a un muro), "entrada" (junto a una puerta: bienvenida, planta, banco, escultura), "centro" (pieza protagonista en zona libre; úsalo con mucho cuidado y solo en salas grandes). Los cuadros y espejos van SIEMPRE en "pared". ' + TEXTO_LIBRES + 'Piezas de la biblioteca (id): ' + (piezas.map(p => p.id + '=' + p.nombre + ' [' + p.categoria + ', ' + p.w + 'x' + p.d + 'x' + p.alto + ' cm]').join('; ') || 'ninguna todavía') + '. Las 4 ideas deben ser MUY distintas entre sí y una atrevida. No repitas las ya mostradas. En "referencia" di de qué tendencia o referencia real sale. Responde SOLO JSON: {"ideas":[{"titulo":"","descripcion":"2 frases","referencia":"una frase","elementos":[{"id":"id de la lista (o en su lugar libre:tipo)","libre":"tipo opcional","color":"#RRGGBB opcional","color2":"#RRGGBB opcional","cantidad":1,"escala":1.0,"ubicacion":"esquina|pared|entrada|centro"}]}]}. Exactamente 4 ideas.';
    const user = 'Sala: «' + sala.nombre + '», ' + sala.area + ' m² (' + sala.largo + ' × ' + sala.ancho + ' cm aprox.), ' + sala.esquinas + ' esquinas, ' + sala.puertas + ' puertas, ' + sala.maquinas + ' máquinas ya colocadas.\n' + (objetivo ? 'Lo que me gustaría (solo una pista, sorpréndeme): ' + objetivo + '\n' : 'No tengo ninguna pista: sorpréndeme.\n') + (previas.length ? 'Ideas que ya me has enseñado y NO quiero repetir: ' + previas.join(' | ') + '\n' : '') + 'PROYECTO:\n' + contexto + (tend ? '\n\nTENDENCIAS ACTUALES:\n' + tend.slice(0, 4500) : '');
    const r = await callClaude({ system, messages: [{ role: 'user', content: user }], maxTokens: 3500 });
    const txt = (r.content || []).map(x => x.text || '').join(''), j = JSON.parse(/\{[\s\S]*\}/.exec(txt)[0]);
    const cl = (v, a, c, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(a, Math.min(c, n)) : d; };
    const ideas = (Array.isArray(j.ideas) ? j.ideas : []).slice(0, 4).map(x => ({
      titulo: String(x?.titulo || 'Idea').slice(0, 60), descripcion: String(x?.descripcion || '').slice(0, 400), referencia: String(x?.referencia || '').slice(0, 220),
      elementos: (Array.isArray(x?.elementos) ? x.elementos : []).slice(0, 8).map(e => normDeco(e, validas)).filter(Boolean),
    })).filter(x => x.elementos.length);
    if (!ideas.length) return res.status(502).json({ error: 'La IA no devolvió ideas válidas. Inténtalo otra vez.' });
    res.json({ ideas });
  } catch (e) { console.error('estudio-ideas decoracion:', e.message); res.status(500).json({ error: 'No se pudieron generar las ideas: ' + String(e.message).slice(0, 150) }); }
});

// Ideas de ambiente para el modelo 3D: la IA propone colores concretos para una pared, un suelo o todo el espacio, y el visor los aplica al modelo con un clic
router.post('/ambiente', async (req, res) => {
  try {
    const tipo = ['muro', 'suelo', 'global'].includes(req.body?.tipo) ? req.body.tipo : 'global';
    const objetivo = String(req.body?.objetivo || '').slice(0, 400), contexto = (await contextoCrm(req.body?.medicionId)) + String(req.body?.contexto || '').slice(0, 4500), actual = String(req.body?.actual || '').slice(0, 300), otras = String(req.body?.otras || '').slice(0, 400);
    const forma = tipo === 'global'
      ? '{"ideas":[{"titulo":"nombre corto","descripcion":"2 frases: el ambiente, por qué funciona en un gimnasio y qué sensación da","muros":"#RRGGBB","suelo":"#RRGGBB","techo":"#RRGGBB","acento":"#RRGGBB"}]}'
      : '{"ideas":[{"titulo":"nombre corto","descripcion":"2 frases: cómo queda, por qué funciona y con qué se combina","principal":"#RRGGBB","acento":"#RRGGBB"}]}';
    const r = await callClaude({
      system: 'Eres interiorista de Ranuse Design, especialista en gimnasios, boxes de crossfit y espacios deportivos. Propones ideas de ambiente CONCRETAS y realizables para un modelo 3D: colores exactos (hex) para pintar o revestir. Piensa en iluminación, suelo oscuro de caucho, máquinas negras o grises, y en que el espacio se vea premium y con carácter; evita colores sosos o todos iguales y haz que las 4 ideas sean claramente distintas entre sí (por ejemplo una oscura e industrial, una cálida de madera y tierra, una limpia y luminosa, una atrevida con un color de marca). Responde SOLO JSON con esta forma: ' + forma + '. Exactamente 4 ideas. Los hex deben ser válidos de 6 dígitos.',
      messages: [{ role: 'user', content: 'Qué quiero decorar: ' + (tipo === 'muro' ? 'UNA pared' : tipo === 'suelo' ? 'UN suelo' : 'TODO el espacio (muros, suelo y techo)') + '.\n' + (objetivo ? 'Lo que busco: ' + objetivo + '\n' : '') + (actual ? 'Color actual: ' + actual + '\n' : '') + (otras ? 'Cómo están las demás superficies: ' + otras + '\n' : '') + 'Datos del proyecto:\n' + contexto + (await tendenciasActuales().then(t => t ? '\n\nTENDENCIAS ACTUALES:\n' + t.slice(0, 5000) : '').catch(() => '')) }],
      maxTokens: 1800,
    });
    const txt = (r.content || []).map(b => b.text || '').join(''), j = JSON.parse(/\{[\s\S]*\}/.exec(txt)[0]);
    const hex = v => (/^#[0-9a-fA-F]{6}$/.test(String(v || '').trim()) ? String(v).trim().toLowerCase() : null);
    const ideas = (Array.isArray(j.ideas) ? j.ideas : []).slice(0, 4).map(x => ({
      titulo: String(x?.titulo || 'Idea').slice(0, 60), descripcion: String(x?.descripcion || '').slice(0, 400),
      principal: hex(x?.principal), acento: hex(x?.acento), muros: hex(x?.muros), suelo: hex(x?.suelo), techo: hex(x?.techo),
    })).filter(x => (tipo === 'global' ? x.muros || x.suelo : x.principal));
    if (!ideas.length) return res.status(502).json({ error: 'La IA no devolvió ideas válidas. Inténtalo otra vez.' });
    res.json({ ideas });
  } catch (e) { console.error('estudio-ideas ambiente:', e.message); res.status(500).json({ error: 'No se pudieron generar las ideas: ' + String(e.message).slice(0, 150) }); }
});
router.get('/marcas', async (req, res) => {
  try { res.json({ marcas: (await leerMarcas()).map(m => ({ id: m.id, nombre: m.nombre, chars: (m.ficha || '').length, creada: m.creada, logo: !!m.logo })) }); }
  catch (e) { console.error('marcas', e); res.status(500).json({ error: 'No se pudieron cargar las marcas' }); }
});

router.get('/marcas/:id', async (req, res) => {
  try { const m = (await leerMarcas()).find(x => x.id === req.params.id); if (!m) return res.status(404).json({ error: 'Marca no encontrada' }); res.json({ id: m.id, nombre: m.nombre, ficha: m.ficha }); }
  catch (e) { res.status(500).json({ error: 'No se pudo leer la marca' }); }
});

// Subir el brandbook en PDF: se lee, se resume en una ficha y se guarda
router.post('/marcas', (req, res, next) => subirPdf(req, res, err => (err ? res.status(400).json({ error: err.message }) : next())), async (req, res) => {
  const clave = process.env.OPENAI_API_KEY;
  if (!clave) return res.status(503).json({ error: 'Falta la clave de OpenAI en el servidor (variable OPENAI_API_KEY en Railway).' });
  try {
    if (!req.file) return res.status(400).json({ error: 'Falta el PDF del brandbook' });
    const crudo = (await textoPdf(req.file.buffer)).replace(/\s+\n/g, '\n').trim();
    if (crudo.length < 200) return res.status(400).json({ error: 'No he podido leer texto en ese PDF (¿está escaneado como imagen?). Pásame uno con texto seleccionable.' });
    const nombre = String(req.body?.nombre || '').trim().slice(0, 60) || String(req.file.originalname || 'Marca').replace(/\.pdf$/i, '').slice(0, 60);
    const ficha = (await consultaTexto(clave, PIDE_FICHA, crudo.slice(0, 60000))).slice(0, 4200);
    if (!ficha) return res.status(502).json({ error: 'ChatGPT no ha devuelto la ficha de la marca' });
    const lista = await leerMarcas(), id = 'm' + Date.now().toString(36);
    lista.push({ id, nombre, ficha, creada: new Date().toISOString() });
    await guardarMarcas(lista);
    res.json({ id, nombre, ficha });
  } catch (e) { console.error('marcas', e); res.status(500).json({ error: 'No se pudo guardar la marca: ' + String(e.message || e).slice(0, 200) }); }
});

// Corregir a mano la ficha (por si el resumen se dejó algo)
router.put('/marcas/:id', async (req, res) => {
  try {
    const lista = await leerMarcas(), m = lista.find(x => x.id === req.params.id); if (!m) return res.status(404).json({ error: 'Marca no encontrada' });
    if (typeof req.body?.ficha === 'string') m.ficha = req.body.ficha.slice(0, 6000);
    if (typeof req.body?.nombre === 'string' && req.body.nombre.trim()) m.nombre = req.body.nombre.trim().slice(0, 60);
    await guardarMarcas(lista); res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'No se pudo guardar' }); }
});

// Logo oficial de la marca (PNG con fondo transparente, o JPG): se manda como referencia en cada idea para que lo use TAL CUAL, sin redibujarlo
router.put('/marcas/:id/logo', async (req, res) => {
  try {
    const m0 = String(req.body?.imagen || '').match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
    if (!m0) return res.status(400).json({ error: 'Sube el logo como imagen (PNG, JPG o WebP)' });
    const buf = Buffer.from(m0[2], 'base64'); if (buf.length > 6 * 1024 * 1024) return res.status(400).json({ error: 'El logo pesa demasiado (máx. 6 MB)' });
    const lista = await leerMarcas(), m = lista.find(x => x.id === req.params.id); if (!m) return res.status(404).json({ error: 'Marca no encontrada' });
    const ruta = 'ia-marcas/' + m.id + '-logo.' + (m0[1] === 'jpeg' ? 'jpg' : m0[1]);
    const { error } = await supabase.storage.from(BUCKET).upload(ruta, buf, { upsert: true, contentType: 'image/' + m0[1] }); if (error) throw error;
    m.logo = ruta; await guardarMarcas(lista); res.json({ ok: true });
  } catch (e) { console.error('logo marca', e); res.status(500).json({ error: 'No se pudo guardar el logo' }); }
});
async function logoDe(m) {
  if (!m?.logo) return null;
  const { data } = await supabase.storage.from(BUCKET).download(m.logo); if (!data) return null;
  const mime = /\.png$/i.test(m.logo) ? 'image/png' : /\.webp$/i.test(m.logo) ? 'image/webp' : 'image/jpeg';
  return 'data:' + mime + ';base64,' + Buffer.from(await data.arrayBuffer()).toString('base64');
}

router.delete('/marcas/:id', async (req, res) => {
  try { await guardarMarcas((await leerMarcas()).filter(x => x.id !== req.params.id)); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: 'No se pudo borrar' }); }
});

router.post('/chat', async (req, res) => {
  const clave = process.env.OPENAI_API_KEY;
  if (!clave) return res.status(503).json({ error: 'Falta la clave de OpenAI en el servidor (variable OPENAI_API_KEY en Railway).' });
  try {
    const texto = String(req.body?.texto || '').trim().slice(0, 4000);
    const imagenes = (Array.isArray(req.body?.imagenes) ? req.body.imagenes : []).slice(0, 4).filter(x => /^data:image\/(png|jpeg|webp);base64,/.test(String(x || '')));
    if (!texto && !imagenes.length) return res.status(400).json({ error: 'Escribe algo o adjunta una imagen' });
    const previo = /^resp_[A-Za-z0-9_-]{5,100}$/.test(String(req.body?.previousResponseId || '')) ? String(req.body.previousResponseId) : null;
    const contenido = [{ type: 'input_text', text: texto || 'Mira esta imagen.' }, ...imagenes.map(u => ({ type: 'input_image', image_url: u }))];
    const contexto = String(req.body?.contexto || '').trim().slice(0, 6000);
    const solo = req.body?.soloDiseno === true || PIDE_SOLO.test(texto);
    const preguntar = req.body?.fase === 'preguntar' && !solo;
    const modo = solo ? 'solo' : (req.body?.modo === 'sorprende' ? 'sorprende' : 'respetar');
    const marcaId = String(req.body?.marcaId || '');
    let ficha = '', logoUrl = null, marcaNombre = ''; if (marcaId) { const m = (await leerMarcas()).find(x => x.id === marcaId); if (m) { marcaNombre = m.nombre; if (!preguntar) logoUrl = await logoDe(m).catch(() => null); ficha = '\n\nMARCA DEL CLIENTE (obligatoria: toda idea debe ser reconocible como de esta marca, con su paleta, su tono y sus materiales; nunca uses colores o estilos que la marca desaconseje). Marca «' + m.nombre + '»:\n' + m.ficha + (m.logo ? '\n\nEl logo oficial de la marca está guardado y se usará tal cual.' : '\n\nNo hay logo oficial guardado: no inventes uno ni dibujes uno «parecido»; si la idea lo necesita, deja el hueco o pide que lo adjunten.'); } }
    if (logoUrl) { contenido[0].text += '\n\n(Última imagen adjunta = LOGO OFICIAL de ' + (marcaNombre || 'la marca') + '. Si el diseño lleva logo, colócalo EXACTAMENTE así: misma forma, proporciones, letras y colores. Prohibido redibujarlo, deformarlo o inventar otro.)'; contenido.push({ type: 'input_image', image_url: logoUrl }); }
    const hayBase = imagenes.length > 0 || !!previo; // hay un render/imagen sobre el que trabajar
    const instrucciones = (extra = '') => INSTRUCCIONES + (contexto ? REGLAS_CONTEXTO + contexto + FIN_CONTEXTO : '') + ficha + (modo !== 'solo' && hayBase ? REGLAS_RESPETAR : '') + (modo === 'sorprende' && !preguntar ? CREATIVO : '') + (preguntar ? BRIEFING : '') + extra;
    const tam = FORMATOS[String(req.body?.formato || '')] || null;
    // calidad alta por defecto (sin indicarla la API usa «auto» y suele salir más floja); si esta versión de la API no admite algún ajuste, se reintenta con la herramienta mínima
    const minima = { type: 'image_generation', ...(process.env.OPENAI_IMAGE_MODEL ? { model: process.env.OPENAI_IMAGE_MODEL } : {}) };
    const base = { ...minima, quality: process.env.OPENAI_IMAGE_QUALITY || 'high', ...(hayBase ? { input_fidelity: 'high' } : {}) };
    const transp = solo && req.body?.transparente === true;
    const herramienta = solo ? { ...base, action: 'generate', ...(tam ? { size: tam } : {}), ...(transp ? { background: 'transparent', output_format: 'png' } : {}) } : (hayBase ? { ...base, action: 'edit' } : base);
    if (solo) contenido[0].text += EXTRA_SOLO + (transp ? ' Sin fondo: el fondo debe ser totalmente transparente (solo el dibujo, recortado).' : '');

    const llama = async (modelo, extra = '', simple = false, textoUsuario = null) => {
      const cont = textoUsuario ? [{ ...contenido[0], text: textoUsuario }, ...contenido.slice(1)] : contenido;
      const r = await fetch(OPENAI + '/responses', {
        method: 'POST', headers: { Authorization: 'Bearer ' + clave, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelo, instructions: instrucciones(extra), ...(preguntar ? {} : { tools: [simple ? minima : herramienta] }), ...((solo || (modo === 'sorprende' && hayBase)) && !simple && !preguntar ? { tool_choice: { type: 'image_generation' } } : {}), input: [{ role: 'user', content: cont }], ...(previo ? { previous_response_id: previo } : {}) }),
      });
      return { r, j: await r.json().catch(() => ({})) };
    };
    const errAjuste = j => /action|size|tool_choice|background|output_format|quality|input_fidelity|image_generation/i.test(JSON.stringify(j?.error || {})) && !/does not exist|model_not_found/i.test(JSON.stringify(j?.error || {}));
    const unaVez = async (modelo, extra, textoUsuario) => {
      let o = await llama(modelo, extra, false, textoUsuario);
      if (!o.r.ok && errAjuste(o.j)) o = await llama(modelo, extra, true, textoUsuario); // si esta versión de la API no admite esos ajustes, se reintenta sin ellos
      return o;
    };
    const lee = (j, modelo) => {
      const salida = Array.isArray(j.output) ? j.output : [];
      return {
        id: j.id, modelo: j.model || modelo,
        texto: salida.filter(o => o.type === 'message').flatMap(o => o.content || []).filter(c => c.type === 'output_text').map(c => c.text).join('\n').trim(),
        imagenes: salida.filter(o => o.type === 'image_generation_call' && o.result).map(o => 'data:image/png;base64,' + o.result),
      };
    };

    let modelo = process.env.OPENAI_CHAT_MODEL || modeloElegido || 'gpt-5';
    const sorprende = modo === 'sorprende' && hayBase && !preguntar;
    const lanzar = () => sorprende
      ? Promise.all(ANGULOS.map((a, i) => unaVez(modelo, '\n\n' + a, (texto || 'Dame una idea para este espacio.') + '\n\n(Propuesta ' + (i + 1) + ' de 3: tiene que ser MUY distinta de las otras dos.)')))
      : unaVez(modelo).then(o => [o]);
    let res1 = await lanzar();
    if (res1.every(o => !o.r.ok) && !process.env.OPENAI_CHAT_MODEL && /does not exist|model_not_found|do not have access|not found/i.test(JSON.stringify(res1[0].j?.error || {}))) {
      const otro = await elegirModelo(clave, modelo).catch(() => null);
      if (otro) { modelo = otro; modeloElegido = otro; console.log('estudio-ideas: modelo de chat →', otro); res1 = await lanzar(); }
    }
    const buenas = res1.filter(o => o.r.ok);
    if (!buenas.length) { const j = res1[0].j; console.error('estudio-ideas', res1[0].r.status, j?.error?.message); return res.status(502).json({ error: 'ChatGPT no ha podido contestar' + (j?.error?.message ? ': ' + String(j.error.message).slice(0, 260) : '') }); }
    const lecturas = buenas.map(o => lee(o.j, modelo));
    if (sorprende) return res.json({ propuestas: lecturas, id: lecturas[0].id, modelo: lecturas[0].modelo });
    res.json(lecturas[0]);
  } catch (e) {
    console.error('estudio-ideas:', e);
    res.status(500).json({ error: 'No se pudo hablar con ChatGPT: ' + String(e.message || e).slice(0, 200) });
  }
});

export default router;
