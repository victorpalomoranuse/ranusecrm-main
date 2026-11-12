import express from 'express';
import multer from 'multer';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';
import { callClaude } from '../utils/anthropic.js';

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

// Ideas de ambiente para el modelo 3D: la IA propone colores concretos para una pared, un suelo o todo el espacio, y el visor los aplica al modelo con un clic
router.post('/ambiente', async (req, res) => {
  try {
    const tipo = ['muro', 'suelo', 'global'].includes(req.body?.tipo) ? req.body.tipo : 'global';
    const objetivo = String(req.body?.objetivo || '').slice(0, 400), contexto = String(req.body?.contexto || '').slice(0, 4500), actual = String(req.body?.actual || '').slice(0, 300), otras = String(req.body?.otras || '').slice(0, 400);
    const forma = tipo === 'global'
      ? '{"ideas":[{"titulo":"nombre corto","descripcion":"2 frases: el ambiente, por qué funciona en un gimnasio y qué sensación da","muros":"#RRGGBB","suelo":"#RRGGBB","techo":"#RRGGBB","acento":"#RRGGBB"}]}'
      : '{"ideas":[{"titulo":"nombre corto","descripcion":"2 frases: cómo queda, por qué funciona y con qué se combina","principal":"#RRGGBB","acento":"#RRGGBB"}]}';
    const r = await callClaude({
      system: 'Eres interiorista de Ranuse Design, especialista en gimnasios, boxes de crossfit y espacios deportivos. Propones ideas de ambiente CONCRETAS y realizables para un modelo 3D: colores exactos (hex) para pintar o revestir. Piensa en iluminación, suelo oscuro de caucho, máquinas negras o grises, y en que el espacio se vea premium y con carácter; evita colores sosos o todos iguales y haz que las 4 ideas sean claramente distintas entre sí (por ejemplo una oscura e industrial, una cálida de madera y tierra, una limpia y luminosa, una atrevida con un color de marca). Responde SOLO JSON con esta forma: ' + forma + '. Exactamente 4 ideas. Los hex deben ser válidos de 6 dígitos.',
      messages: [{ role: 'user', content: 'Qué quiero decorar: ' + (tipo === 'muro' ? 'UNA pared' : tipo === 'suelo' ? 'UN suelo' : 'TODO el espacio (muros, suelo y techo)') + '.\n' + (objetivo ? 'Lo que busco: ' + objetivo + '\n' : '') + (actual ? 'Color actual: ' + actual + '\n' : '') + (otras ? 'Cómo están las demás superficies: ' + otras + '\n' : '') + 'Datos del proyecto:\n' + contexto }],
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
