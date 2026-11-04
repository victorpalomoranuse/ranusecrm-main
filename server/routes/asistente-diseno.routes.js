import express from 'express';
import crypto from 'crypto';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';
import { callClaude } from '../utils/anthropic.js';

// Asistente de diseño: chat que va construyendo un alzado (pared + mueble a medida) con medidas exactas.
// La IA solo decide/propone las medidas; el dibujo lo hace el código del navegador a partir de la ficha (spec), así no se inventa nada.

const router = express.Router();

// ── guardado por proyecto ──
// Todo se guarda en un JSON propio por proyecto (crm/diseno/<proyecto>.json), aparte de Planos, presupuestos y demás: este asistente nunca toca nada ya hecho.
// Cada cambio es una VERSIÓN NUEVA (las anteriores se conservan y se pueden recuperar) y antes de escribir se guarda una copia de seguridad diaria.
const BUCKET = 'project-documents';
const idProy = p => String(p || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
const ruta = pid => 'crm/diseno/' + idProy(pid) + '.json';
export async function leerProy(pid) {
  const { data, error } = await supabase.storage.from(BUCKET).download(ruta(pid));
  if (error || !data) {
    if (/not.?found|does not exist|404/i.test(JSON.stringify(error || {}) + (error?.message || ''))) return { laminas: [] };
    throw new Error('No he podido leer lo guardado de este proyecto; no se ha tocado nada.');
  }
  const j = JSON.parse(await data.text());
  return { laminas: Array.isArray(j.laminas) ? j.laminas : [] };
}
export async function guardarProy(pid, d, existia) {
  if (existia) { const dia = new Date().toISOString().slice(0, 10).replace(/-/g, ''); await supabase.storage.from(BUCKET).copy(ruta(pid), 'crm/diseno/_copias/' + idProy(pid) + '-' + dia + '.json').catch(() => {}); }
  const { error } = await supabase.storage.from(BUCKET).upload(ruta(pid), Buffer.from(JSON.stringify(d)), { contentType: 'application/json', upsert: true, cacheControl: '0' });
  if (error) throw new Error('No se ha podido guardar: ' + error.message);
}
const nuevoId = () => crypto.randomUUID().slice(0, 8);
const resumenLam = l => ({ id: l.id, titulo: l.titulo, actualizada: l.actualizada, versiones: (l.versiones || []).length });
export const ponVersion = (l, spec, resumen) => { l.versiones = l.versiones || []; l.versiones.push({ v: (l.versiones[l.versiones.length - 1]?.v || 0) + 1, ts: new Date().toISOString(), spec, resumen: String(resumen || '').slice(0, 140) }); if (l.versiones.length > 100) l.versiones.shift(); l.titulo = spec.titulo || l.titulo; l.actualizada = new Date().toISOString(); };

router.get('/proyecto/:pid', async (req, res) => {
  try { const d = await leerProy(req.params.pid); res.json({ laminas: d.laminas.map(resumenLam).sort((a, b) => String(b.actualizada).localeCompare(String(a.actualizada))) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/proyecto/:pid/lamina/:lid', async (req, res) => {
  try { const l = (await leerProy(req.params.pid)).laminas.find(x => x.id === req.params.lid); if (!l) return res.status(404).json({ error: 'No existe esa lámina' }); res.json({ lamina: l }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// Recuperar una versión antigua: NO borra nada, la copia como versión nueva.
router.post('/proyecto/:pid/lamina/:lid/restaurar', async (req, res) => {
  try {
    const d = await leerProy(req.params.pid), l = d.laminas.find(x => x.id === req.params.lid); if (!l) return res.status(404).json({ error: 'No existe esa lámina' });
    const v = (l.versiones || []).find(x => x.v === Number(req.body?.v)); if (!v) return res.status(404).json({ error: 'No existe esa versión' });
    ponVersion(l, v.spec, 'Recuperada la versión ' + v.v); await guardarProy(req.params.pid, d, true); res.json({ lamina: l });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Duplicar para probar cosas sin arriesgar la lámina buena.
router.post('/proyecto/:pid/lamina/:lid/duplicar', async (req, res) => {
  try {
    const d = await leerProy(req.params.pid), l = d.laminas.find(x => x.id === req.params.lid); if (!l) return res.status(404).json({ error: 'No existe esa lámina' });
    const ult = l.versiones?.[l.versiones.length - 1]; const c = { id: nuevoId(), titulo: (l.titulo || 'Alzado') + ' (copia)', creada: new Date().toISOString(), actualizada: new Date().toISOString(), mensajes: l.mensajes || [], versiones: [] };
    if (ult) ponVersion(c, { ...ult.spec, titulo: c.titulo }, 'Copia de «' + (l.titulo || 'lámina') + '»');
    d.laminas.push(c); await guardarProy(req.params.pid, d, true); res.json({ lamina: c });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.use(authenticateToken, requirePermission('proyectos'));

const num = (v, d = null) => { const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v); return Number.isFinite(n) ? n : d; };
const r1 = n => Math.round(n * 10) / 10;
const TIPOS_MOD = ['puertas', 'cajones', 'abierto', 'hueco'];
const TIPOS_HUECO = ['puerta', 'ventana', 'otro'];

// Deja la ficha limpia y con todo calculado (posiciones, sobrante a cada lado). Devuelve también los avisos que la IA debe leer.
export function normalizaAlzado(inp, previo) {
  const avisos = [];
  const base = previo || {};
  const s = { ...base, ...inp };
  const par = { ...(base.pared || {}), ...(inp.pared || {}) };
  const W = num(par.ancho), H = num(par.alto);
  if (!W || !H || W < 30 || H < 30 || W > 3000 || H > 1000) return { error: 'Faltan el ancho y el alto de la pared (en cm) o no son razonables.' };
  const out = { titulo: String(s.titulo || 'Alzado').slice(0, 80), proyecto: String(s.proyecto || '').slice(0, 80), pared: { ancho: r1(W), alto: r1(H) }, huecos: [], mueble: null, notas: [] };
  (Array.isArray(s.huecos) ? s.huecos : []).forEach((h, i) => {
    const w = num(h.ancho), al = num(h.alto), x = num(h.x, 0), y = num(h.y, 0);
    if (!w || !al) { avisos.push(`Hueco ${i + 1} sin medidas: ignorado.`); return; }
    if (x < -0.05 || x + w > W + 0.05 || y < -0.05 || y + al > H + 0.05) avisos.push(`El hueco "${h.nombre || h.tipo || i + 1}" se sale de la pared.`);
    out.huecos.push({ tipo: TIPOS_HUECO.includes(h.tipo) ? h.tipo : 'otro', nombre: String(h.nombre || '').slice(0, 40), x: r1(x), y: r1(y), ancho: r1(w), alto: r1(al) });
  });
  const bm = base.mueble ? { ...base.mueble, margenDer: undefined } : {};
  const m = inp.mueble ? { ...bm, ...inp.mueble } : (base.mueble ? bm : null);
  if (m &&Array.isArray(m.modulos) && m.modulos.length) {
    const altura = num(m.altura), zocalo = num(m.zocalo, 10), enc = num(m.encimera, 3), mi = Math.max(0, num(m.margenIzq, 0));
    if (!altura || altura < 20 || altura > H) avisos.push('La altura del mueble no es válida o supera la de la pared.');
    const mdIn = m.margenDer === undefined || m.margenDer === null ? null : Math.max(0, num(m.margenDer, 0));
    const fijos = m.modulos.filter(x => num(x.ancho)).reduce((a, x) => a + num(x.ancho), 0);
    const libres = m.modulos.filter(x => !num(x.ancho)).length;
    let anchos = m.modulos.map(x => num(x.ancho));
    if (libres) {
      const hueco = W - mi - (mdIn ?? 0) - fijos;
      if (hueco <= 0) avisos.push('No queda espacio para los módulos sin medida.');
      else { const each = r1(hueco / libres); anchos = anchos.map(a => a || each); }
    }
    const total = r1(anchos.reduce((a, b) => a + (b || 0), 0));
    let md = r1(W - mi - total);
    if (Math.abs(md) < 0.06) md = 0;
    if (md < 0) avisos.push(`El mueble se pasa de la pared por ${r1(-md)} cm (módulos ${total} cm + margen izquierdo ${mi} cm > ${W} cm).`);
    if (mdIn !== null && Math.abs(md - mdIn) > 0.6 && !libres) avisos.push(`Con esos módulos queda ${md} cm a la derecha, no ${mdIn} cm.`);
    let x = mi;
    out.mueble = {
      nombre: String(m.nombre || 'Mueble a medida').slice(0, 60), altura: r1(altura || 90), zocalo: r1(Math.max(0, zocalo)), encimera: r1(Math.max(0, enc)),
      profundidad: num(m.profundidad) ? r1(num(m.profundidad)) : null, material: String(m.material || '').slice(0, 60),
      margenIzq: r1(mi), margenDer: r1(Math.max(0, md)), total,
      modulos: m.modulos.map((mod, i) => {
        const a = anchos[i] || 0, o = { n: i + 1, x: r1(x), ancho: r1(a), tipo: TIPOS_MOD.includes(mod.tipo) ? mod.tipo : 'puertas', nombre: String(mod.nombre || '').slice(0, 40) };
        if (o.tipo === 'puertas') o.hojas = Math.min(4, Math.max(1, Math.round(num(mod.hojas, a > 70 ? 2 : 1))));
        if (o.tipo === 'cajones') o.cajones = Math.min(8, Math.max(1, Math.round(num(mod.cajones, 3))));
        if (o.tipo === 'abierto') o.baldas = Math.min(6, Math.max(0, Math.round(num(mod.baldas, 2))));
        if (o.tipo === 'puertas' && a / o.hojas > 65) avisos.push(`Módulo ${i + 1}: las hojas salen de ${r1(a / o.hojas)} cm; mejor ≤ 60 cm cada una.`);
        x += a; return o;
      }),
    };
  } else if (m) avisos.push('El mueble no tiene módulos todavía.');
  out.notas = (Array.isArray(s.notas) ? s.notas : []).map(n => String(n).slice(0, 140)).slice(0, 6);
  return { spec: out, avisos };
}

const TOOLS = [{
  name: 'actualizar_alzado',
  description: 'Crea o modifica la lámina del alzado que ve Víctor a la derecha. Llámala SIEMPRE que cambie cualquier medida o elemento (y la primera vez en cuanto tengas ancho y alto de la pared). Solo hace falta enviar lo que cambia: lo demás se conserva. Todas las medidas en cm. Devuelve la ficha ya calculada (posiciones, sobrante a cada lado) y avisos: si hay avisos, corrígelos o díselos a Víctor.',
  input_schema: {
    type: 'object',
    properties: {
      titulo: { type: 'string', description: 'Título de la lámina, ej. "Alzado mueble TV — salón".' },
      proyecto: { type: 'string', description: 'Nombre del proyecto/cliente si lo dijo, ej. "Juan Lebrón".' },
      pared: { type: 'object', properties: { ancho: { type: 'number' }, alto: { type: 'number' } }, description: 'Superficie del alzado (cm).' },
      huecos: { type: 'array', description: 'Puertas, ventanas u otros elementos de la pared. Si cambias algo, envía la lista completa.', items: { type: 'object', properties: { tipo: { type: 'string', enum: TIPOS_HUECO }, nombre: { type: 'string' }, x: { type: 'number', description: 'Distancia desde el borde izquierdo de la pared hasta el lado izquierdo del hueco.' }, y: { type: 'number', description: 'Distancia desde el suelo hasta la base del hueco.' }, ancho: { type: 'number' }, alto: { type: 'number' } }, required: ['ancho', 'alto'] } },
      mueble: {
        type: 'object', description: 'Mueble a medida apoyado en el suelo. Si cambias los módulos, envía la lista completa de módulos de izquierda a derecha.',
        properties: {
          nombre: { type: 'string' },
          altura: { type: 'number', description: 'Altura total desde el suelo hasta la parte alta de la encimera.' },
          margenIzq: { type: 'number', description: 'Espacio libre entre el borde izquierdo de la pared y el mueble (cm).' },
          margenDer: { type: 'number', description: 'Espacio libre a la derecha. Normalmente omítelo: se calcula solo. Úsalo solo para repartir módulos sin ancho.' },
          zocalo: { type: 'number', description: 'Altura del zócalo retranqueado (por defecto 10).' },
          encimera: { type: 'number', description: 'Grosor de la encimera/tapa (por defecto 3).' },
          profundidad: { type: 'number' }, material: { type: 'string', description: 'Acabado, ej. "roble natural".' },
          modulos: { type: 'array', description: 'De izquierda a derecha. Si omites "ancho" en alguno(s), se reparte el espacio libre a partes iguales entre ellos.', items: { type: 'object', properties: { ancho: { type: 'number' }, tipo: { type: 'string', enum: TIPOS_MOD }, hojas: { type: 'number', description: 'Nº de puertas (tipo puertas).' }, cajones: { type: 'number', description: 'Nº de cajones (tipo cajones).' }, baldas: { type: 'number', description: 'Nº de baldas (tipo abierto).' }, nombre: { type: 'string' } } } },
        },
      },
      notas: { type: 'array', items: { type: 'string' }, description: 'Notas cortas que aparecerán en la lámina (acabados, observaciones). Máx. 6.' },
    },
  },
}];

const SYSTEM = `Eres el Asistente de Diseño de Ranuse Design (diseño de espacios deportivos y reformas). Ayudas a Víctor a preparar rápido láminas de alzado de muebles a medida y superficies, hablando con él en español, de forma breve y directa.

CÓMO TRABAJAS
- La lámina la dibuja el sistema a partir de la ficha que tú rellenas con la herramienta actualizar_alzado. Tú NO dibujas ni describes el dibujo con texto: rellena la ficha y listo.
- En cuanto tengas ancho y alto de la pared, crea la lámina, aunque falten cosas. Mejor una primera propuesta que empezar con muchas preguntas. Solo pregunta lo imprescindible (máximo 1-2 preguntas cortas por turno), y propón tú una opción razonable mientras tanto.
- Todo en cm. Nunca inventes una medida que Víctor haya dado: respétala exacta. Lo que él no diga, lo propones TÚ y lo marcas claramente como propuesta ("propongo…").
- Si te pide que repartas módulos, propón anchos redondos y cómodos de fabricar (múltiplos de 5 cm cuando se pueda; puertas de hasta 60 cm por hoja; cajones en módulos de 60-100 cm) y compruébalo: margen izquierdo + suma de módulos + margen derecho = ancho de la pared. Si no cuadra exacto con medidas redondas, di cuánto sobra y dónde lo absorbes.
- Cuando dice "quito X cm a la izquierda", eso es margenIzq = X. Los módulos que "empiezan desde la derecha" van pegados a la pared derecha: margen derecho 0, y el sobrante de la izquierda es el margenIzq.
- Reglas de carpintería por defecto si no dice otra cosa: zócalo 10 cm retranqueado, encimera 3 cm, módulos de puertas con hoja ≤ 60 cm, cajones: 3 por módulo.
- Después de actualizar, responde corto: qué has puesto (medidas de cada módulo, sobrantes) y qué propones ajustar o qué necesitas saber. Si la herramienta devuelve avisos, corrígelos antes de contestar o explícaselos.
- Cuando Víctor pida un cambio ("el módulo 2 de cajones", "hazlo 10 cm más ancho", "quita la puerta") modifica solo eso y vuelve a llamar a la herramienta.
- Si te pide algo que una lámina de alzado no puede mostrar bien (detalles de herrajes, secciones, perspectiva), dilo y ofrece lo más parecido.`;

router.post('/chat', async (req, res) => {
  try {
    const msgs = (Array.isArray(req.body?.messages) ? req.body.messages : []).filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim()).slice(-30).map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
    if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return res.status(400).json({ error: 'Falta el mensaje' });
    let spec = req.body?.spec && typeof req.body.spec === 'object' ? req.body.spec : null;
    const system = SYSTEM + (spec ? `\n\nLÁMINA ACTUAL (ficha ya calculada; modifícala, no la rehagas desde cero):\n${JSON.stringify(spec)}` : '\n\nTodavía no hay lámina.');
    const conv = msgs.slice();
    let texto = '', avisosFinal = [], cambio = false;
    for (let i = 0; i < 4; i++) {
      const r = await callClaude({ system, messages: conv, tools: TOOLS, maxTokens: 3000 });
      const t = (r.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n\n');
      if (t.length >= texto.length || !texto) texto = t || texto;
      const usos = (r.content || []).filter(b => b.type === 'tool_use');
      if (!usos.length) break;
      conv.push({ role: 'assistant', content: r.content });
      const resultados = usos.map(u => {
        const n = normalizaAlzado(u.input || {}, spec);
        if (n.error) return { type: 'tool_result', tool_use_id: u.id, content: n.error, is_error: true };
        spec = n.spec; cambio = true; avisosFinal = n.avisos;
        return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify({ ok: true, ficha: n.spec, avisos: n.avisos }) };
      });
      conv.push({ role: 'user', content: resultados });
      if (r.stop_reason !== 'tool_use') break;
    }
    let guardado = null, guardadoError = null;
    const pid = idProy(req.body?.proyectoId);
    if (pid && (cambio || msgs.length)) {
      try {
        const ex = await leerProy(pid).then(d => ({ d, ok: true }));
        const d = ex.d; let l = req.body?.laminaId && d.laminas.find(x => x.id === req.body.laminaId);
        if (!l) { l = { id: nuevoId(), titulo: spec?.titulo || 'Alzado', creada: new Date().toISOString(), mensajes: [], versiones: [] }; d.laminas.push(l); }
        const respuesta = texto || (cambio ? 'Lámina actualizada.' : '');
        const previos = (Array.isArray(req.body?.messages) ? req.body.messages : msgs).filter(m => m && typeof m.content === 'string').slice(-200).map(m => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
        l.mensajes = [...previos, { role: 'assistant', content: respuesta.slice(0, 4000) }];
        const ult = l.versiones[l.versiones.length - 1];
        if (spec && (!ult || JSON.stringify(ult.spec) !== JSON.stringify(spec))) ponVersion(l, spec, msgs[msgs.length - 1].content);
        l.actualizada = new Date().toISOString();
        await guardarProy(pid, d, true);
        guardado = { laminaId: l.id, versiones: l.versiones.length };
      } catch (e) { guardadoError = e.message; }
    }
    res.json({ guardado, guardadoError, reply: texto || (cambio ? 'Lámina actualizada.' : 'No he entendido, ¿me lo cuentas de otra forma?'), spec, avisos: avisosFinal });
  } catch (e) {
    console.error('asistente-diseno:', e.message);
    res.status(500).json({ error: e.message?.includes('ANTHROPIC') || e.message?.includes('clave') ? e.message : 'No he podido consultar a la IA. Inténtalo de nuevo.' });
  }
});

export default router;
