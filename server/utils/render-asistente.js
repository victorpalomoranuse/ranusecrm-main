// Render fotorrealista a partir de una foto, boceto o captura que Víctor manda al asistente.
// Usa los mismos motores que el visor 3D: ChatGPT/OpenAI (OPENAI_API_KEY) o Gemini (GEMINI_API_KEY), el que haya; si uno falla prueba el otro.
const PROMPT_BASE = 'Convierte esta imagen (foto, boceto o captura de un espacio de interiorismo o gimnasio) en un render fotorrealista, como una fotografía profesional de revista de interiorismo y arquitectura: luz natural cálida, sombras suaves, reflejos creíbles y materiales con textura real. Conserva la arquitectura, la perspectiva, las proporciones y la distribución de la imagen original; no inventes huecos ni cambies las medidas.';

async function conOpenAI(buffer, mime, prompt) {
  const clave = (process.env.OPENAI_API_KEY || '').trim(); if (!clave) throw new Error('sin clave de OpenAI');
  const fd = new FormData();
  fd.append('model', process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1'); fd.append('prompt', prompt); fd.append('size', 'auto'); fd.append('quality', process.env.OPENAI_IMAGE_QUALITY || 'high'); fd.append('n', '1');
  fd.append('image', new Blob([buffer], { type: mime }), 'foto.' + (mime === 'image/png' ? 'png' : 'jpg'));
  const r = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: 'Bearer ' + clave }, body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.data?.[0]?.b64_json) throw new Error('OpenAI: ' + String(j?.error?.message || r.status).slice(0, 200));
  return Buffer.from(j.data[0].b64_json, 'base64');
}
async function conGemini(buffer, mime, prompt) {
  const clave = (process.env.GEMINI_API_KEY || '').trim(); if (!clave) throw new Error('sin clave de Gemini');
  const modelo = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + modelo + ':generateContent', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': clave },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: mime, data: buffer.toString('base64') } }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }),
  });
  const j = await r.json().catch(() => ({}));
  const img = (j?.candidates?.[0]?.content?.parts || []).find(p => p.inlineData?.data || p.inline_data?.data);
  if (!r.ok || !img) throw new Error('Gemini: ' + String(j?.error?.message || r.status).slice(0, 200));
  return Buffer.from((img.inlineData || img.inline_data).data, 'base64');
}

export async function renderDesdeFoto({ buffer, mime, instrucciones, estilo }) {
  const prompt = [PROMPT_BASE, estilo ? 'Estilo: ' + String(estilo).slice(0, 150) + '.' : '', instrucciones ? 'Indicaciones de Víctor: ' + String(instrucciones).slice(0, 600) : ''].filter(Boolean).join(' ');
  const motores = process.env.OPENAI_API_KEY ? [conOpenAI, conGemini] : [conGemini, conOpenAI];
  let ultimo = null;
  for (const m of motores) { try { return await m(buffer, mime, prompt); } catch (e) { ultimo = e; } }
  throw new Error('No hay ningún motor de imágenes disponible o han fallado (' + (ultimo?.message || '') + ')');
}

// ── Imagen desde texto (inspiración sin foto de partida) y edición de una foto con una instrucción ──
const VIABLE = "REGLAS DE VIABILIDAD (obligatorias, el diseño tiene que poder construirse de verdad con presupuesto razonable de reforma de gimnasio o home gym): geometría ORTOGONAL, con paredes, techos y mobiliario rectos y planos; NADA de superficies curvas, onduladas, orgánicas ni de formas que requieran CNC o piezas a medida complejas; techo plano a altura normal (2,5-3 m) con, como mucho, falso techo recto o foseado sencillo; revestimientos en materiales y formatos estándar (tablero chapado o melamina en piezas de 244x122, lamas rectas, pintura, microcemento, porcelánico, espejo, panel acústico) y suelos de caucho, vinilo o SPC en un solo tono o con juntas rectas, sin dibujos ni remolinos; mobiliario modular recto con medidas de catálogo; iluminación con perfiles LED lineales rectos y focos empotrables estándar; maquinaria y racks reales de catálogo comercial. UN SOLO gesto de diseño llamativo por imagen (un color, un material o una iluminación), el resto sobrio y barato de ejecutar.";
async function textoOpenAI(prompt) {
  const clave = (process.env.OPENAI_API_KEY || '').trim(); if (!clave) throw new Error('sin clave de OpenAI');
  const r = await fetch('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { Authorization: 'Bearer ' + clave, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1', prompt, size: 'auto', quality: process.env.OPENAI_IMAGE_QUALITY || 'high', n: 1 }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.data?.[0]?.b64_json) throw new Error('OpenAI: ' + String(j?.error?.message || r.status).slice(0, 200));
  return Buffer.from(j.data[0].b64_json, 'base64');
}
async function textoGemini(prompt) {
  const clave = (process.env.GEMINI_API_KEY || '').trim(); if (!clave) throw new Error('sin clave de Gemini');
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + (process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image') + ':generateContent', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': clave }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }) });
  const j = await r.json().catch(() => ({}));
  const img = (j?.candidates?.[0]?.content?.parts || []).find(p => p.inlineData?.data || p.inline_data?.data);
  if (!r.ok || !img) throw new Error('Gemini: ' + String(j?.error?.message || r.status).slice(0, 200));
  return Buffer.from((img.inlineData || img.inline_data).data, 'base64');
}
export async function imagenDesdeTexto({ prompt, estilo }) {
  const p = ['Imagen de inspiración para un estudio de diseño de espacios deportivos y gimnasios: ' + String(prompt).slice(0, 1200) + '.', estilo ? 'Estilo: ' + String(estilo).slice(0, 150) + '.' : '', 'Fotografía de arquitectura e interiorismo realista, con criterio de diseñador, materiales y luz creíbles, pero que se pueda ejecutar: ' + VIABLE + ' Sin texto ni logotipos.'].filter(Boolean).join(' ');
  const motores = process.env.OPENAI_API_KEY ? [textoOpenAI, textoGemini] : [textoGemini, textoOpenAI];
  let ultimo = null; for (const m of motores) { try { return await m(p); } catch (e) { ultimo = e; } }
  throw new Error('No hay ningún motor de imágenes disponible o han fallado (' + (ultimo?.message || '') + ')');
}
export async function editarFoto({ buffer, mime, instruccion }) {
  const prompt = 'Edita esta fotografía aplicando SOLO este cambio: «' + String(instruccion).slice(0, 800) + '». Mantén exactamente la composición, la perspectiva, la luz y todo lo que no se menciona; integra el cambio con la escala, las sombras y los reflejos de la escena. El resultado debe parecer una fotografía real y el cambio tiene que ser construible con materiales y medidas estándar (sin superficies curvas ni piezas imposibles).';
  const motores = process.env.OPENAI_API_KEY ? [conOpenAI, conGemini] : [conGemini, conOpenAI];
  let ultimo = null; for (const m of motores) { try { return await m(buffer, mime, prompt); } catch (e) { ultimo = e; } }
  throw new Error('No hay ningún motor de imágenes disponible o han fallado (' + (ultimo?.message || '') + ')');
}
