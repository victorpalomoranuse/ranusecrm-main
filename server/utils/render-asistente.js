// Render fotorrealista a partir de una foto, boceto o captura que Víctor manda al asistente.
// Usa los mismos motores que el visor 3D: ChatGPT/OpenAI (OPENAI_API_KEY) o Gemini (GEMINI_API_KEY), el que haya; si uno falla prueba el otro.
const PROMPT_BASE = 'Convierte esta imagen (foto, boceto o captura de un espacio de interiorismo o gimnasio) en un render fotorrealista, como una fotografía profesional de revista de interiorismo y arquitectura: luz natural cálida, sombras suaves, reflejos creíbles y materiales con textura real. Conserva la arquitectura, la perspectiva, las proporciones y la distribución de la imagen original; no inventes huecos ni cambies las medidas.';

let modeloAuto = null;
const versionDe = id => (String(id).match(/\d+(\.\d+)?/g) || ['0']).map(Number);
async function buscaModeloOpenAI(clave) {
  const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + clave } }); const j = await r.json().catch(() => ({}));
  const ids = (j.data || []).map(x => x.id).filter(id => /image/i.test(id) && !/dall-e|audio|realtime|transcribe/i.test(id));
  return ids.sort((a, b) => { const mini = (/mini/i.test(a) ? 1 : 0) - (/mini/i.test(b) ? 1 : 0); if (mini) return mini; const va = versionDe(a), vb = versionDe(b); for (let i = 0; i < Math.max(va.length, vb.length); i++) { const d = (vb[i] || 0) - (va[i] || 0); if (d) return d; } return b.localeCompare(a); })[0] || null;
}
// llama a OpenAI; si el modelo no existe o no hay acceso, busca el más nuevo que vea la cuenta y reintenta una vez
async function openaiImagen(clave, ruta, hacer) {
  let modelo = process.env.OPENAI_IMAGE_MODEL || modeloAuto || 'gpt-image-1';
  let r = await hacer(modelo), j = await r.json().catch(() => ({}));
  if (!r.ok && !process.env.OPENAI_IMAGE_MODEL && /does not exist|model_not_found|do not have access|not found/i.test(JSON.stringify(j?.error || {}))) {
    const nuevo = await buscaModeloOpenAI(clave).catch(() => null);
    if (nuevo && nuevo !== modelo) { modeloAuto = nuevo; r = await hacer(nuevo); j = await r.json().catch(() => ({})); }
  }
  if (!r.ok || !j?.data?.[0]?.b64_json) throw new Error('OpenAI: ' + String(j?.error?.message || r.status).slice(0, 200));
  return Buffer.from(j.data[0].b64_json, 'base64');
}

async function conOpenAI(buffer, mime, prompt) {
  const clave = (process.env.OPENAI_API_KEY || '').trim(); if (!clave) throw new Error('sin clave de OpenAI');
  return openaiImagen(clave, 'edits', (modelo) => {
    const fd = new FormData();
    fd.append('model', modelo); fd.append('prompt', prompt); fd.append('size', 'auto'); fd.append('quality', process.env.OPENAI_IMAGE_QUALITY_ASIST || 'medium'); fd.append('n', '1');
    fd.append('image', new Blob([buffer], { type: mime }), 'foto.' + (mime === 'image/png' ? 'png' : 'jpg'));
    return fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: 'Bearer ' + clave }, body: fd, signal: AbortSignal.timeout(110000) }); // si tarda más de ~2 min se corta y prueba el otro motor
  });
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
async function textoOpenAI(prompt) {
  const clave = (process.env.OPENAI_API_KEY || '').trim(); if (!clave) throw new Error('sin clave de OpenAI');
  return openaiImagen(clave, 'generations', (modelo) => fetch('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { Authorization: 'Bearer ' + clave, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: modelo, prompt, size: 'auto', quality: process.env.OPENAI_IMAGE_QUALITY_ASIST || 'medium', n: 1 }), signal: AbortSignal.timeout(110000) }));
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
  const p = [String(prompt).slice(0, 1800), estilo ? 'Estilo: ' + String(estilo).slice(0, 150) + '.' : '', 'Fotografía realista de arquitectura e interiorismo, con luz y materiales creíbles. Sin texto ni logotipos.'].filter(Boolean).join(' ');
  const motores = process.env.OPENAI_API_KEY ? [textoOpenAI, textoGemini] : [textoGemini, textoOpenAI];
  let ultimo = null; for (const m of motores) { try { return await m(p); } catch (e) { ultimo = e; } }
  throw new Error('No hay ningún motor de imágenes disponible o han fallado (' + (ultimo?.message || '') + ')');
}
export async function editarFoto({ buffer, mime, instruccion }) {
  const prompt = 'Edita esta fotografía aplicando SOLO este cambio: «' + String(instruccion).slice(0, 800) + '». Mantén exactamente la composición, la perspectiva, la luz y todo lo que no se menciona; integra el cambio con la escala, las sombras y los reflejos de la escena. El resultado debe parecer una fotografía real.';
  const motores = process.env.OPENAI_API_KEY ? [conOpenAI, conGemini] : [conGemini, conOpenAI];
  let ultimo = null; for (const m of motores) { try { return await m(buffer, mime, prompt); } catch (e) { ultimo = e; } }
  throw new Error('No hay ningún motor de imágenes disponible o han fallado (' + (ultimo?.message || '') + ')');
}
