import express from 'express';
import sharp from 'sharp';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';
import { callClaude } from '../utils/anthropic.js';
import { contextoProyecto } from './agente-proyecto.routes.js';

// Prompts de render con IA: Claude actúa de director de arte. Con el moodboard
// (imágenes + paleta + estilo), los materiales/equipos elegidos, las medidas y
// los condicionantes del proyecto, escribe el prompt para generar (o mejorar)
// un render en otra herramienta de IA. No genera imágenes: entrega el prompt.
const router = express.Router();
router.use(authenticateToken, requirePermission('proyectos'));

const fail = (res, e, msg) => { console.error(msg, e); res.status(500).json({ error: msg }); };
const txt = (v) => (typeof v === 'string' ? (v.trim() || null) : null);

const HERRAMIENTAS = {
  midjourney: 'MIDJOURNEY: prompt en inglés, una sola línea de descriptores concretos separados por comas (sujeto, materiales, luz, cámara, ambiente). Sin frases largas. Termina con los parámetros: --ar <formato> --style raw --v 7. El "negativo" se expresa con --no <lista>; ponlo también en el campo negativo.',
  chatgpt: 'CHATGPT (generación de imágenes de OpenAI): prompt en inglés, en lenguaje natural, 1 o 2 párrafos claros que describan la escena como a un fotógrafo de interiores. Para mejorar una imagen subida, indica explícitamente qué se conserva (distribución, perspectiva, proporciones, posición del equipamiento) y qué cambia. No uses parámetros de Midjourney.',
  flux: 'FLUX / KREA / FREEPIK / LEONARDO: prompt en inglés, descriptivo y fotográfico (cámara, objetivo, iluminación, materiales con su acabado). Estas herramientas no suelen admitir negativo: déjalo vacío y evita "no ...". Sugiere en consejos la intensidad/denoise (0,35–0,5 para conservar la geometría) si se parte de una imagen.',
  gemini: 'GEMINI (Nano Banana) y editores conversacionales: instrucciones en inglés, en forma de orden de edición ("Keep the room layout exactly as is. Replace..., change..."). Muy buenas para mejorar una imagen subida; sé explícito con lo que NO debe cambiar.',
  universal: 'UNIVERSAL: prompt en inglés, en lenguaje natural y bien estructurado, que funcione en cualquier generador de imágenes. Sin parámetros propios de ninguna herramienta.',
};

const SYSTEM_RENDER = `Eres el director de arte de Ranuse Design (estudio de diseño integral de espacios de entrenamiento: gimnasios comerciales, home gyms, centros de alto rendimiento). Tu trabajo: convertir lo que Víctor quiere ver en un render en un PROMPT excelente para una IA de imágenes, partiendo del proyecto real.

REGLAS
- Parte SIEMPRE del estilo del moodboard (mira las imágenes: materiales, texturas, ambiente, luz, contraste) y de la paleta. Traduce los colores hex a nombres de color/acabado reales (p. ej. "warm greige microcement", "matte black steel", "light oak veneer").
- Usa los materiales y el equipamiento ELEGIDOS en el proyecto cuando encajen con la zona pedida; descríbelos como objetos genéricos y reconocibles (sin marcas ni logotipos, las IA los inventan mal).
- Respeta las medidas y los condicionantes (techo bajo, pilares, poca luz natural...): que el render sea coherente con el espacio real, no un espacio de revista imposible.
- Incluye siempre: tipo de espacio y encuadre, materiales y acabados por superficie (suelo, paredes, techo), equipamiento visible y su disposición, iluminación (tipo, temperatura, atmósfera), cámara (altura de ojos ~1,5 m, objetivo 20-28 mm, verticales corregidas) y nivel de realismo (fotografía de arquitectura de interiores, fotorrealista, sin personas salvo que se pidan).
- Lo que Víctor pide expresamente ("me gustaría esto para esto") manda sobre tu criterio: inclúyelo tal cual y complétalo, no lo sustituyas.
- Si Víctor sube una imagen base y el modo es MEJORAR, el prompt debe CONSERVAR la geometría, la perspectiva y la distribución, y especificar solo lo que cambia (materiales, luz, ambiente, detalles). Dilo con claridad en el prompt.
- No inventes datos del proyecto. Si falta algo importante, sugiérelo en "consejos" (una línea cada uno), sin bloquear el prompt.
- Genera también "prompt_es": la versión en español, para que Víctor entienda y pueda retocar lo que va a pegar.
- Variantes: si se piden, cada una debe cambiar de verdad algo (ángulo de cámara, hora/luz, nivel de detalle), no repetir.

FORMATO: responde SOLO llamando a la herramienta entregar_prompts.`;

const TOOL_ENTREGAR = {
  name: 'entregar_prompts',
  description: 'Entrega el prompt de render final.',
  input_schema: {
    type: 'object',
    properties: {
      titulo: { type: 'string', description: 'Título corto del render (ej. "Zona de peso libre, luz cálida")' },
      prompt: { type: 'string', description: 'El prompt final, en inglés, listo para pegar en la herramienta elegida' },
      prompt_es: { type: 'string', description: 'Misma idea del prompt en español' },
      negativo: { type: 'string', description: 'Qué evitar (vacío si la herramienta no lo admite)' },
      parametros: { type: 'string', description: 'Parámetros o ajustes recomendados para la herramienta (formato, intensidad, etc.)' },
      consejos: { type: 'array', items: { type: 'string' }, description: 'Consejos cortos de uso o datos que faltan' },
      variantes: { type: 'array', items: { type: 'object', properties: { nombre: { type: 'string' }, prompt: { type: 'string' } }, required: ['nombre', 'prompt'] } },
    },
    required: ['titulo', 'prompt', 'prompt_es'],
  },
};

async function imagenBase(dataUrl) {
  try {
    const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(dataUrl || '');
    if (!m) return null;
    const buf = await sharp(Buffer.from(m[2], 'base64')).rotate().resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } };
  } catch { return null; }
}

// Qué sabe la IA del proyecto (para enseñarlo en pantalla) + historial guardado
router.get('/:projectId/render-prompts', async (req, res) => {
  try {
    const [{ data: p }, { count }, { data: hist, error }] = await Promise.all([
      supabase.from('client_projects').select('moodboard_estilo_nombre, moodboard_palette').eq('id', req.params.projectId).single(),
      supabase.from('project_moodboard_images').select('id', { count: 'exact', head: true }).eq('project_id', req.params.projectId),
      supabase.from('render_prompts').select('id, zona, detalles, herramienta, modo, resultado, created_at').eq('project_id', req.params.projectId).order('created_at', { ascending: false }).limit(40),
    ]);
    res.json({
      base: { imagenes: count || 0, estilo: p?.moodboard_estilo_nombre || null, paleta: p?.moodboard_palette || [] },
      historial: error ? [] : (hist || []),
      sinTabla: !!error,
    });
  } catch (e) { fail(res, e, 'Error al cargar los prompts de render'); }
});

router.delete('/:projectId/render-prompts/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('render_prompts').delete().eq('id', req.params.id).eq('project_id', req.params.projectId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { fail(res, e, 'No se pudo borrar el prompt'); }
});

router.post('/:projectId/render-prompt', async (req, res) => {
  try {
    const zona = txt(req.body.zona) || '';
    const detalles = txt(req.body.detalles) || '';
    if (!zona && !detalles) return res.status(400).json({ error: 'Cuéntame qué zona quieres y qué detalles' });
    const herramienta = HERRAMIENTAS[req.body.herramienta] ? req.body.herramienta : 'universal';
    const formato = ['16:9', '3:2', '4:3', '1:1', '9:16'].includes(req.body.formato) ? req.body.formato : '16:9';
    const variantes = Math.max(0, Math.min(3, parseInt(req.body.variantes, 10) || 0));
    const mejorar = req.body.modo === 'mejorar';
    const ctx = await contextoProyecto(req.params.projectId);
    if (!ctx) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const base = mejorar ? await imagenBase(req.body.imagen_base) : null;
    if (mejorar && !base) return res.status(400).json({ error: 'Para mejorar una imagen, sube la imagen base (PNG, JPG o WEBP)' });

    const anterior = req.body.anterior && typeof req.body.anterior === 'object' ? req.body.anterior : null;
    const ajuste = txt(req.body.ajuste);
    const pedido = [
      `HERRAMIENTA DE DESTINO: ${HERRAMIENTAS[herramienta]}`,
      `FORMATO / ASPECT RATIO: ${formato}`,
      `MODO: ${mejorar ? 'MEJORAR la imagen base adjunta (la última imagen del mensaje)' : 'CREAR un render nuevo desde cero'}`,
      `ZONA O ESPACIO: ${zona || '(la que se deduzca de los detalles)'}`,
      `LO QUE VÍCTOR QUIERE VER (detalles, tal cual los ha dicho): ${detalles || '—'}`,
      variantes ? `VARIANTES: añade ${variantes} variantes distintas en el campo variantes` : 'VARIANTES: ninguna',
      anterior && ajuste ? `PROMPT ANTERIOR (Víctor quiere ajustarlo):\n${String(anterior.prompt || '').slice(0, 4000)}\n\nAJUSTE PEDIDO: ${ajuste}\nDevuelve el prompt completo ya ajustado, no solo el cambio.` : '',
    ].filter(Boolean).join('\n');

    const content = [
      ...ctx.imagenes,
      { type: 'text', text: `CONTEXTO DEL PROYECTO (${ctx.hayMoodboard ? 'las imágenes de arriba son el moodboard, que define el estilo' : 'todavía no hay imágenes en el moodboard'}):\n\n${ctx.texto}` },
      ...(base ? [{ type: 'text', text: 'IMAGEN BASE A MEJORAR (la que Víctor subirá a la herramienta; conserva su composición):' }, base] : []),
      { type: 'text', text: `PEDIDO:\n${pedido}` },
    ];
    const response = await callClaude({ system: SYSTEM_RENDER, messages: [{ role: 'user', content }], tools: [TOOL_ENTREGAR], maxTokens: 3000 });
    const uso = (response.content || []).find(b => b.type === 'tool_use' && b.name === 'entregar_prompts');
    if (!uso?.input?.prompt) return res.status(502).json({ error: 'La IA no devolvió el prompt, inténtalo otra vez' });
    const r = uso.input;
    const resultado = {
      titulo: String(r.titulo || zona || 'Render'),
      prompt: String(r.prompt),
      prompt_es: String(r.prompt_es || ''),
      negativo: String(r.negativo || ''),
      parametros: String(r.parametros || ''),
      consejos: Array.isArray(r.consejos) ? r.consejos.map(String).slice(0, 8) : [],
      variantes: Array.isArray(r.variantes) ? r.variantes.filter(v => v && v.prompt).map(v => ({ nombre: String(v.nombre || 'Variante'), prompt: String(v.prompt) })).slice(0, 3) : [],
    };
    const { data: guardado, error } = await supabase.from('render_prompts')
      .insert({ project_id: req.params.projectId, zona: zona || null, detalles: detalles || null, herramienta, modo: mejorar ? 'mejorar' : 'crear', resultado })
      .select('id, created_at').single();
    res.json({ resultado, id: error ? null : guardado.id, created_at: error ? null : guardado.created_at, sinTabla: !!error });
  } catch (e) { fail(res, e, e.message || 'No se pudo generar el prompt'); }
});

export default router;
