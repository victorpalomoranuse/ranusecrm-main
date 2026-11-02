import express from 'express';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';

// Render fotorrealista con IA de imágenes (Gemini, «Nano Banana»): recibe la imagen del visor 3D
// (render limpio con materiales y luz) más la paleta de colores y devuelve la imagen mejorada.
// Motores: ChatGPT / OpenAI (variable OPENAI_API_KEY, modelo OPENAI_IMAGE_MODEL, por defecto gpt-image-1) o Gemini (GEMINI_API_KEY, GEMINI_IMAGE_MODEL).
// Si no se indica motor, se usa OpenAI cuando hay clave y, si no, Gemini.
const router = express.Router();
router.use(authenticateToken, requirePermission('proyectos'));

const API = 'https://generativelanguage.googleapis.com/v1beta';

// Modelo de imagen de OpenAI: si el configurado ya no existe (OpenAI los renueva), se busca entre los que ve la cuenta el más nuevo con «image» en el nombre
let imagenOpenAI = null;
const versionDe = id => (String(id).match(/\d+(\.\d+)?/g) || ['0']).map(Number);
async function modelosImagenOpenAI(clave) {
  const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + clave } });
  const j = await r.json().catch(() => ({}));
  const ids = (j.data || []).map(x => x.id).filter(id => /image/i.test(id) && !/dall-e|audio|realtime|transcribe/i.test(id));
  return ids.sort((a, b) => {
    const mini = (/mini/i.test(a) ? 1 : 0) - (/mini/i.test(b) ? 1 : 0); if (mini) return mini;
    const va = versionDe(a), vb = versionDe(b);
    for (let i = 0; i < Math.max(va.length, vb.length); i++) { const d = (vb[i] || 0) - (va[i] || 0); if (d) return d; }
    return b.localeCompare(a);
  });
}
const modelo = () => process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';

// ¿Está configurada la clave? Y qué modelos de imagen ve la cuenta (sin enseñar la clave)
router.get('/estado', async (req, res) => {
  const clave = process.env.GEMINI_API_KEY;
  const openai = !!process.env.OPENAI_API_KEY;
  if (!clave) return res.json({ configurado: false, openai });
  try {
    const r = await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': clave } });
    if (!r.ok) return res.json({ configurado: true, valida: false, estado: r.status });
    const j = await r.json();
    const imagen = (j.models || []).map(m => String(m.name || '').replace(/^models\//, '')).filter(n => /image/i.test(n));
    res.json({ configurado: true, openai, valida: true, modelo: modelo(), modelosDeImagen: imagen });
  } catch (e) {
    res.json({ configurado: true, valida: false, error: 'No se pudo consultar a Google' });
  }
});

router.post('/', async (req, res) => {
  const { proveedor } = req.body || {};
  const prov = proveedor === 'gemini' ? 'gemini' : proveedor === 'openai' ? 'openai' : (process.env.OPENAI_API_KEY ? 'openai' : 'gemini');
  const clave = prov === 'openai' ? process.env.OPENAI_API_KEY : process.env.GEMINI_API_KEY;
  if (!clave) return res.status(503).json({ error: 'Falta configurar ' + (prov === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY') + ' en el servidor' });
  try {
    const { imagen, estancia, estilo, paleta, extra, libertad, materiales, inventario, modo, ajustes } = req.body || {};
    const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(String(imagen || ''));
    if (!m) return res.status(400).json({ error: 'Falta la imagen del visor (png, jpg o webp)' });
    const colores = Array.isArray(paleta) ? paleta.filter(p => p && p.nombre).slice(0, 12).map(p => `${String(p.nombre).slice(0, 40)}${p.hex ? ' (' + String(p.hex).slice(0, 9) + ')' : ''}`) : [];
    // Cuánto puede inventar la IA: fiel (solo pule), equilibrado (ambiente y luz) o creativo (decora y amuebla con criterio)
    const nivel = ['fiel', 'equilibrado', 'creativo'].includes(libertad) ? libertad : 'equilibrado';
    const NIVELES = {
      fiel: 'Respeta EXACTAMENTE la composición, la perspectiva, las proporciones y la posición de cada elemento. No añadas ni quites nada: solo mejora la luz, los materiales y las texturas.',
      equilibrado: 'Respeta la distribución, la perspectiva y las proporciones del espacio, y los elementos principales (muros, puertas, ventanas y muebles). Sí puedes enriquecer la escena con luz natural cálida, reflejos, sombras suaves, texturas realistas en suelos y paredes, el exterior visible por las ventanas y pequeños detalles de ambiente coherentes con la estancia.',
      creativo: 'Mantén la arquitectura (muros, huecos, medidas y perspectiva) y la distribución general, pero decora con criterio de interiorista: textiles, plantas, iluminación ambiente, accesorios y detalles que hagan que el espacio parezca vivido y de revista. No cambies el encuadre.',
    };
    // Muestras reales de los materiales de la escena (imagen + descripción) para que la IA los reconozca y no invente otros
    const muestras = (Array.isArray(materiales) ? materiales : []).slice(0, 8).map(x => ({ zona: String(x?.zona || '').slice(0, 60), descr: String(x?.descr || '').slice(0, 300), ref: /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(String(x?.ref || '')) })).filter(x => x.descr || x.ref);
    const conRef = muestras.filter(x => x.ref);
    const txtMateriales = muestras.length ? 'MATERIALES REALES DEL PROYECTO (reprodúcelos con exactitud en cada zona: mismo color, veta, dibujo, tamaño de pieza y junta; no cambies de material ni inventes otros): ' + muestras.map(x => x.zona + ': ' + x.descr + (x.ref ? ' [muestra en la imagen ' + (conRef.indexOf(x) + 2) + ']' : '')).join(' | ') + '.' + (conRef.length ? ' Las imágenes 2 a ' + (conRef.length + 1) + ' son solo muestras de material (no forman parte de la escena): no las pongas en la foto.' : '') : '';
    const txtInventario = Array.isArray(inventario) && inventario.length ? 'EQUIPAMIENTO Y ELEMENTOS QUE EXISTEN en la escena (no añadas ni quites ninguno, ni cambies su forma): ' + inventario.slice(0, 40).map(v => String(v).slice(0, 80)).join('; ') + '.' : '';
    // Modo «mejora»: la imagen ya es un render terminado; la IA solo la retoca técnicamente y no cambia nada de lo que hay
    const aj = ajustes && typeof ajustes === 'object' ? ajustes : {};
    const instMejora = [
      'Eres un retocador fotográfico profesional. La imagen es un render de interiorismo ya terminado. Tu único trabajo es mejorarla técnicamente, sin cambiar su contenido.',
      'REGLAS ABSOLUTAS: no cambies la geometría, la perspectiva, el encuadre ni las proporciones. No cambies los materiales, los colores ni los acabados. No añadas, quites ni muevas ningún objeto, máquina, mueble, persona o elemento decorativo. No cambies textos ni logotipos. Si dudas, deja la imagen como está.',
      aj.nitidez !== false ? 'Aumenta la nitidez y el detalle fino de las texturas, y limpia el ruido y el grano de la imagen.' : '',
      aj.luz ? 'Retoca la luz con suavidad: mejora el contraste, el rango dinámico, las sombras y los reflejos, sin cambiar la dirección ni la intensidad general de la luz.' : '',
      'Entrega la imagen con la mayor resolución y calidad posibles, con aspecto de fotografía real pero idéntica en contenido.',
    ].filter(Boolean).join(' ');
    const instrucciones = modo === 'mejora' ? instMejora : [
      'Convierte esta imagen de un modelo 3D de interiorismo en una fotografía profesional de revista de interiorismo y arquitectura: realista, nítida, con luz natural cálida, sombras suaves, reflejos creíbles, materiales con textura real y profundidad de campo, como hecha con una cámara réflex y un objetivo gran angular. Debe parecer una foto real, no un render ni una ilustración.',
      NIVELES[nivel],
      colores.length ? 'Respeta con la máxima fidelidad estos colores y acabados: ' + colores.join('; ') + '.' : 'Mantén los colores de los materiales tal y como aparecen en la imagen.',
      txtMateriales,
      txtInventario,
      estancia ? 'Estancia: ' + String(estancia).slice(0, 80) + '.' : '',
      estilo ? 'Estilo: ' + String(estilo).slice(0, 120) + '.' : '',
      extra ? String(extra).slice(0, 400) : '',
    ].filter(Boolean).join(' ');
    if (prov === 'openai') {
      let modeloO = process.env.OPENAI_IMAGE_MODEL || imagenOpenAI || 'gpt-image-1';
      const llamar = async (fidelidad, refs = true) => {
        const fd = new FormData();
        fd.append('model', modeloO); fd.append('prompt', instrucciones); fd.append('size', 'auto'); fd.append('quality', process.env.OPENAI_IMAGE_QUALITY || 'high'); fd.append('n', '1');
        if (fidelidad) fd.append('input_fidelity', 'high');
        const usa = refs && conRef.length;
        fd.append(usa ? 'image[]' : 'image', new Blob([Buffer.from(m[2], 'base64')], { type: m[1] }), 'vista.' + (m[1] === 'image/png' ? 'png' : 'jpg'));
        if (usa) conRef.forEach((x, i) => fd.append('image[]', new Blob([Buffer.from(x.ref[2], 'base64')], { type: x.ref[1] }), 'muestra' + (i + 2) + '.' + (x.ref[1] === 'image/png' ? 'png' : 'jpg')));
        const rr = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: 'Bearer ' + clave }, body: fd });
        return { rr, jj: await rr.json().catch(() => ({})) };
      };
      let { rr, jj } = await llamar(true);
      if (!rr.ok && !process.env.OPENAI_IMAGE_MODEL && /does not exist|model_not_found|do not have access|not found/i.test(JSON.stringify(jj?.error || {}))) {
        const lista = await modelosImagenOpenAI(clave).catch(() => []);
        if (lista.length && lista[0] !== modeloO) { modeloO = lista[0]; imagenOpenAI = modeloO; console.log('render-ia: modelo de imagen de OpenAI →', modeloO); ({ rr, jj } = await llamar(true)); }
        else if (!lista.length) jj = { error: { message: String(jj?.error?.message || '') + ' (y tu cuenta no ve ningún modelo de imagen: comprueba el saldo y el acceso en platform.openai.com)' } };
      }
      if (!rr.ok && /input_fidelity|unknown|unsupported/i.test(JSON.stringify(jj?.error || {}))) ({ rr, jj } = await llamar(false));
      if (!rr.ok && conRef.length) ({ rr, jj } = await llamar(false, false)); // si no admite varias imágenes, se manda solo la vista (las muestras siguen descritas en el texto)
      if (!rr.ok) { console.error('render-ia OpenAI', rr.status, jj?.error?.message); return res.status(502).json({ error: 'ChatGPT (OpenAI) no ha podido generar la imagen' + (jj?.error?.message ? ': ' + String(jj.error.message).slice(0, 220) : '') }); }
      const b64 = jj?.data?.[0]?.b64_json;
      if (!b64) return res.status(502).json({ error: 'OpenAI no ha devuelto ninguna imagen' });
      return res.json({ imagen: 'data:image/png;base64,' + b64 });
    }
    // Tamaño de salida (1K, 2K o 4K) con GEMINI_IMAGE_SIZE: solo lo admiten los modelos Pro; si el modelo no lo acepta se reintenta sin él
    const tam = ['1K', '2K', '4K'].includes(process.env.GEMINI_IMAGE_SIZE) ? process.env.GEMINI_IMAGE_SIZE : null;
    const llamarG = async (t) => {
      const rr = await fetch(`${API}/models/${modelo()}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': clave },
        body: JSON.stringify({
          contents: [{ parts: [{ text: instrucciones }, { inlineData: { mimeType: m[1], data: m[2] } }, ...conRef.map(x => ({ inlineData: { mimeType: x.ref[1], data: x.ref[2] } }))] }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'], ...(t ? { imageConfig: { imageSize: t } } : {}) },
        }),
      });
      return { rr, jj: await rr.json().catch(() => ({})) };
    };
    let { rr: r, jj: j } = await llamarG(tam);
    if (!r.ok && tam && /imageConfig|imageSize|unknown name|invalid json/i.test(JSON.stringify(j?.error || {}))) ({ rr: r, jj: j } = await llamarG(null));
    if (!r.ok) {
      console.error('render-ia Gemini', r.status, j?.error?.message);
      return res.status(502).json({ error: 'Gemini no ha podido generar la imagen' + (j?.error?.message ? ': ' + String(j.error.message).slice(0, 200) : '') });
    }
    const partes = j?.candidates?.[0]?.content?.parts || [];
    const img = partes.find(p => p.inlineData?.data || p.inline_data?.data);
    if (!img) return res.status(502).json({ error: 'Gemini no ha devuelto ninguna imagen' + (partes.find(p => p.text)?.text ? ': ' + partes.find(p => p.text).text.slice(0, 200) : '') });
    const d = img.inlineData || img.inline_data;
    res.json({ imagen: `data:${d.mimeType || d.mime_type || 'image/png'};base64,${d.data}` });
  } catch (e) {
    console.error('render-ia:', e);
    res.status(500).json({ error: 'No se pudo generar el render' });
  }
});

export default router;
