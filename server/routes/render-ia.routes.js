import express from 'express';
import sharp from 'sharp';
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
// Colores dominantes de la vista del modelo (k-medias sobre una miniatura): se le dicen a la IA como colores que no puede cambiar,
// porque al «fotorrealizar» tiende a oscurecer o cambiar el tono de las paredes y los suelos.
async function coloresDominantes(buf, k = 6) {
  try {
    const { data, info } = await sharp(buf).resize(48, 48, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const px = []; for (let i = 0; i < info.width * info.height; i++) px.push([data[i * 3], data[i * 3 + 1], data[i * 3 + 2]]);
    let cs = Array.from({ length: k }, (_, i) => px[Math.floor(((i + 0.5) * px.length) / k)].slice()), asig = new Array(px.length).fill(0);
    for (let it = 0; it < 9; it++) {
      px.forEach((p, i) => { let b = 0, bd = Infinity; cs.forEach((c, j) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; b = j; } }); asig[i] = b; });
      cs = cs.map((c, j) => { const m = px.filter((_, i) => asig[i] === j); return m.length ? [0, 1, 2].map(ch => Math.round(m.reduce((a, p) => a + p[ch], 0) / m.length)) : c; });
    }
    const cuenta = new Array(k).fill(0); asig.forEach(j => { cuenta[j]++; });
    return cs.map((c, j) => ({ hex: '#' + c.map(v => v.toString(16).padStart(2, '0')).join(''), pct: Math.round((cuenta[j] / px.length) * 100) })).filter(c => c.pct >= 4).sort((a, b) => b.pct - a.pct);
  } catch { return []; }
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
    const { imagen, estancia, estilo, paleta, extra, libertad, materiales, inventario, modo, ajustes, iluminacion } = req.body || {};
    const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(String(imagen || ''));
    if (!m) return res.status(400).json({ error: 'Falta la imagen del visor (png, jpg o webp)' });
    const colores = Array.isArray(paleta) ? paleta.filter(p => p && p.nombre).slice(0, 12).map(p => `${String(p.nombre).slice(0, 40)}${p.hex ? ' (' + String(p.hex).slice(0, 9) + ')' : ''}`) : [];
    // Cuánto puede inventar la IA: fiel (solo pule), equilibrado (ambiente y luz) o creativo (decora y amuebla con criterio)
    const nivel = ['fiel', 'equilibrado', 'creativo'].includes(libertad) ? libertad : 'equilibrado';
    const NIVELES = {
      fiel: 'Respeta EXACTAMENTE la composición, la perspectiva, las proporciones y la posición de cada elemento. No añadas ni quites nada: solo mejora la luz, los materiales y las texturas.',
      equilibrado: 'Respeta la distribución, la perspectiva y las proporciones del espacio, y los elementos principales (muros, puertas, ventanas y muebles). Sí puedes enriquecer la escena con luz natural, reflejos, sombras suaves, texturas realistas en suelos y paredes, el exterior visible por las ventanas y pequeños detalles de ambiente coherentes con la estancia, SIN cambiar el color base de ninguna superficie.',
      creativo: 'Mantén la arquitectura (muros, huecos, medidas y perspectiva) y la distribución general, pero decora con criterio de interiorista: textiles, plantas, iluminación ambiente, accesorios y detalles que hagan que el espacio parezca vivido y de revista. No cambies el encuadre.',
    };
    // Muestras reales de los materiales de la escena (imagen + descripción) para que la IA los reconozca y no invente otros
    const muestras = (Array.isArray(materiales) ? materiales : []).slice(0, 12).map(x => ({ zona: String(x?.zona || '').slice(0, 60), descr: String(x?.descr || '').slice(0, 300), ref: /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(String(x?.ref || '')) })).filter(x => x.descr || x.ref);
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
    // Modo «panorama»: la imagen es una panorámica 360° equirrectangular (estirada a 3:2); se fotorrealiza sin cambiar la proyección
    const instPano = 'Esta imagen es una panorámica 360° equirrectangular de un interior, tal como la leen los visores 360 (la línea del horizonte recta en el centro, el suelo abajo y el techo arriba, deformada en los extremos). Conviértela en una fotografía profesional realista de interiorismo con luz natural cálida, sombras suaves, reflejos creíbles y materiales con textura real, MANTENIENDO EXACTAMENTE la misma proyección equirrectangular, el mismo encuadre completo, la misma distribución y la posición de cada elemento. El borde izquierdo y el derecho deben seguir encajando entre sí (es un círculo completo). No recortes, no cambies la perspectiva ni añadas bordes. ' + [NIVELES.fiel, extra ? String(extra).slice(0, 300) : ''].join(' ');
    const txtLuz = typeof iluminacion === 'string' && iluminacion.trim() ? 'ILUMINACIÓN REAL DEL PROYECTO (reprodúcela con realismo físico y no la inventes): ' + iluminacion.trim().slice(0, 3500) + ' REGLAS DE LUZ: respeta el número, el tipo y la posición de las luminarias que se ven (no añadas luminarias que no existan ni apagues las que sí); cada foco o spot proyecta un haz con la apertura indicada y deja su cono de luz y su pared iluminada (scallop) coherentes con la altura de montaje; la intensidad y la temperatura de color de cada luz deben corresponder a los lúmenes y a los kelvin indicados (3000 K cálida, 4000 K neutra); la luz natural entra solo por los huecos indicados, con la dirección y la dureza que corresponde a la hora; las sombras deben ser coherentes con esas fuentes; no aclares ni oscurezcas la estancia por tu cuenta.' : '';
    const dom = (modo === 'mejora' || modo === 'panorama') ? [] : await coloresDominantes(Buffer.from(m[2], 'base64'));
    const txtDominantes = dom.length ? 'COLORES DOMINANTES DEL MODELO que debes respetar (color y % de la imagen): ' + dom.map(c => c.hex + ' (' + c.pct + '%)').join(', ') + '. Las paredes, el suelo y el techo deben seguir teniendo estos tonos.' : '';
    const instrucciones = modo === 'panorama' ? instPano : modo === 'mejora' ? instMejora : [
      'Convierte esta imagen de un modelo 3D de interiorismo en una fotografía profesional de revista de interiorismo y arquitectura: realista, nítida, con luz natural cálida, sombras suaves, reflejos creíbles, materiales con textura real y profundidad de campo, como hecha con una cámara réflex y un objetivo gran angular. Debe parecer una foto real, no un render ni una ilustración.',
      'REGLA DE COLOR (obligatoria): cada pared, suelo, techo, mueble y objeto debe conservar el MISMO color base que tiene en la imagen del modelo. Solo puedes variar su luminosidad por la luz y las sombras, nunca su tono: una pared clara sigue siendo clara y una oscura sigue siendo oscura. No cambies de color ninguna pared. Una superficie de color liso es PINTURA LISA y uniforme: no le añadas textura, desgaste, microcemento, manchas ni vetas.',
      txtDominantes,
      txtLuz,
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
        fd.append('model', modeloO); fd.append('prompt', instrucciones); fd.append('size', modo === 'panorama' ? (process.env.OPENAI_PANO_SIZE || '1536x1024') : 'auto'); fd.append('quality', process.env.OPENAI_IMAGE_QUALITY || 'high'); fd.append('n', '1');
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

// ── Editor de post-producción: edita un render con una instrucción y, si se manda una máscara (la zona pintada), solo esa zona.
// La máscara es un PNG del mismo tamaño que la imagen: los píxeles transparentes son los que se editan. Opcionalmente, hasta 3 imágenes de referencia.
const DATA_IMG = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/;
router.post('/editar', async (req, res) => {
  const clave = process.env.OPENAI_API_KEY;
  if (!clave) return res.status(503).json({ error: 'Falta la clave de OpenAI en el servidor (variable OPENAI_API_KEY en Railway).' });
  try {
    const { imagen, mascara, instruccion, referencias } = req.body || {};
    const m = DATA_IMG.exec(String(imagen || ''));
    if (!m) return res.status(400).json({ error: 'Falta la imagen (png, jpg o webp)' });
    const texto = String(instruccion || '').trim().slice(0, 1500);
    if (!texto) return res.status(400).json({ error: 'Escribe qué quieres cambiar' });
    const mk = /^data:image\/png;base64,(.+)$/.exec(String(mascara || ''));
    const refs = (Array.isArray(referencias) ? referencias : []).slice(0, 3).map(x => DATA_IMG.exec(String(x || ''))).filter(Boolean);
    const prompt = [
      'Eres un retocador profesional de renders de interiorismo. Edita la primera imagen aplicando SOLO este cambio: «' + texto + '».',
      mk ? 'El cambio se limita a la zona marcada con la máscara: no toques nada fuera de ella.' : 'Aplica el cambio conservando todo lo demás.',
      'Mantén exactamente la composición, la perspectiva, la iluminación, los materiales y todos los elementos que no se mencionan.',
      refs.length ? 'Las imágenes adicionales son referencias de lo que hay que incorporar (' + refs.length + '): no las pegues tal cual, intégralas con la perspectiva, la escala, la luz y las sombras de la escena.' : '',
      'El resultado debe parecer una fotografía real.',
    ].filter(Boolean).join(' ');
    let modeloO = process.env.OPENAI_IMAGE_MODEL || imagenOpenAI || 'gpt-image-1';
    const llamar = async ({ fidelidad = true, conRefs = true } = {}) => {
      const fd = new FormData();
      fd.append('model', modeloO); fd.append('prompt', prompt); fd.append('size', 'auto'); fd.append('quality', process.env.OPENAI_IMAGE_QUALITY || 'high'); fd.append('n', '1');
      if (fidelidad) fd.append('input_fidelity', 'high');
      const usa = conRefs && refs.length;
      fd.append(usa ? 'image[]' : 'image', new Blob([Buffer.from(m[2], 'base64')], { type: m[1] }), 'render.' + (m[1] === 'image/png' ? 'png' : 'jpg'));
      if (usa) refs.forEach((x, i) => fd.append('image[]', new Blob([Buffer.from(x[2], 'base64')], { type: x[1] }), 'referencia' + (i + 1) + '.' + (x[1] === 'image/png' ? 'png' : 'jpg')));
      if (mk) fd.append('mask', new Blob([Buffer.from(mk[1], 'base64')], { type: 'image/png' }), 'mascara.png');
      const rr = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: 'Bearer ' + clave }, body: fd });
      return { rr, jj: await rr.json().catch(() => ({})) };
    };
    let { rr, jj } = await llamar();
    if (!rr.ok && !process.env.OPENAI_IMAGE_MODEL && /does not exist|model_not_found|do not have access|not found/i.test(JSON.stringify(jj?.error || {}))) {
      const lista = await modelosImagenOpenAI(clave).catch(() => []);
      if (lista.length && lista[0] !== modeloO) { modeloO = lista[0]; imagenOpenAI = modeloO; ({ rr, jj } = await llamar()); }
    }
    if (!rr.ok && /input_fidelity|unknown|unsupported/i.test(JSON.stringify(jj?.error || {}))) ({ rr, jj } = await llamar({ fidelidad: false }));
    if (!rr.ok && refs.length) ({ rr, jj } = await llamar({ fidelidad: false, conRefs: false })); // si no admite varias imágenes, se edita sin las referencias
    if (!rr.ok) { console.error('render-ia editar', rr.status, jj?.error?.message); return res.status(502).json({ error: 'ChatGPT no ha podido editar la imagen' + (jj?.error?.message ? ': ' + String(jj.error.message).slice(0, 220) : '') }); }
    const b64 = jj?.data?.[0]?.b64_json;
    if (!b64) return res.status(502).json({ error: 'OpenAI no ha devuelto ninguna imagen' });
    res.json({ imagen: 'data:image/png;base64,' + b64, modelo: modeloO });
  } catch (e) {
    console.error('render-ia editar:', e);
    res.status(500).json({ error: 'No se pudo editar la imagen: ' + String(e.message || e).slice(0, 200) });
  }
});

export default router;
