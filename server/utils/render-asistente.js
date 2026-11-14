import sharp from 'sharp';
import { callClaude } from './anthropic.js';
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
// Edición LOCAL: la IA marca solo la zona que cambia, el motor solo toca esa zona (máscara) y el resto se vuelve a pegar de la foto original,
// así todo lo que no se pide cambiar queda idéntico (antes el motor reinventaba la foto entera).
async function zonaDeCambio(buffer, mime, instruccion) {
  const r = await callClaude({ system: 'Eres un editor de fotos. Respondes SOLO con JSON.', maxTokens: 600, messages: [{ role: 'user', content: [
    { type: 'image', source: { type: 'base64', media_type: mime, data: buffer.toString('base64') } },
    { type: 'text', text: 'Cambio pedido: «' + String(instruccion).slice(0, 500) + '». Marca SOLO la zona de la foto que hay que modificar para hacerlo (incluye el objeto o superficie completos y un pequeño margen, nada más). Coordenadas normalizadas 0-1 (x a la derecha, y hacia abajo). JSON: {"global":false,"regiones":[[[x,y],[x,y],[x,y],...]]} con 1-3 polígonos de 3 a 14 puntos. Si el cambio afecta a toda la imagen (luz general, color de toda la escena), {"global":true,"regiones":[]}.' }] }] });
  const j = /\{[\s\S]*\}/.exec((r.content || []).map(b => b.text || '').join('')); if (!j) return null;
  const o = JSON.parse(j[0]); if (o.global) return null;
  const regs = (Array.isArray(o.regiones) ? o.regiones : []).slice(0, 3).map(p => (Array.isArray(p) ? p : []).slice(0, 14).map(q => [Math.max(0, Math.min(1, Number(q?.[0]))), Math.max(0, Math.min(1, Number(q?.[1])))]).filter(q => q.every(Number.isFinite))).filter(p => p.length >= 3);
  return regs.length ? regs : null;
}
const svgZona = (regs, W, H, relleno, fondo) => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '"><rect width="100%" height="100%" fill="' + fondo + '"/>' + regs.map(p => '<polygon points="' + p.map(q => (q[0] * W).toFixed(1) + ',' + (q[1] * H).toFixed(1)).join(' ') + '" fill="' + relleno + '" stroke="' + relleno + '" stroke-width="' + Math.round(Math.max(W, H) / 60) + '" stroke-linejoin="round"/>').join('') + '</svg>');
async function conOpenAIMascara(png, mascaraPng, prompt) {
  const clave = (process.env.OPENAI_API_KEY || '').trim(); if (!clave) throw new Error('sin clave de OpenAI');
  return openaiImagen(clave, 'edits', (modelo) => {
    const fd = new FormData();
    fd.append('model', modelo); fd.append('prompt', prompt); fd.append('size', 'auto'); fd.append('quality', process.env.OPENAI_IMAGE_QUALITY_ASIST || 'medium'); fd.append('n', '1');
    if (/gpt-image-1(?!-mini)/.test(modelo) && !/gpt-image-1-mini|gpt-image-1\.5|gpt-image-2/.test(modelo)) fd.append('input_fidelity', 'high');
    fd.append('image', new Blob([png], { type: 'image/png' }), 'foto.png'); fd.append('mask', new Blob([mascaraPng], { type: 'image/png' }), 'mascara.png');
    return fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: 'Bearer ' + clave }, body: fd, signal: AbortSignal.timeout(110000) });
  });
}
export async function editarFoto({ buffer, mime, instruccion }) {
  const prompt = 'Edita esta fotografía aplicando SOLO este cambio: «' + String(instruccion).slice(0, 800) + '». Mantén exactamente la composición, la perspectiva, la luz y todo lo que no se menciona; integra el cambio con la escala, las sombras y los reflejos de la escena. El resultado debe parecer una fotografía real.';
  const motores = process.env.OPENAI_API_KEY ? [conOpenAI, conGemini] : [conGemini, conOpenAI];
  // 1) edición local con máscara + recomposición (si algo falla se cae a la edición normal)
  try {
    const base = await sharp(buffer).rotate().resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    const { width: W, height: H } = await sharp(base).metadata();
    const regs = await zonaDeCambio(base, 'image/png', instruccion);
    if (regs) {
      // máscara de OpenAI: transparente = se edita; opaco = se conserva
      const hueco = await sharp(svgZona(regs, W, H, '#fff', '#000')).greyscale().raw().toBuffer();
      const rgb = await sharp(base).removeAlpha().raw().toBuffer(); const ch = 3, rgba = Buffer.alloc(W * H * 4);
      for (let i = 0; i < W * H; i++) { rgba[i * 4] = rgb[i * ch]; rgba[i * 4 + 1] = rgb[i * ch + 1]; rgba[i * 4 + 2] = rgb[i * ch + 2]; rgba[i * 4 + 3] = hueco[i] > 127 ? 0 : 255; }
      const mascara = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
      let nuevo = null, ultimo = null;
      for (const m of [async () => conOpenAIMascara(base, mascara, prompt), async () => conGemini(base, 'image/png', prompt)]) { try { nuevo = await m(); break; } catch (e) { ultimo = e; } }
      if (nuevo) {
        const res = await sharp(nuevo).resize(W, H, { fit: 'fill' }).removeAlpha().png().toBuffer();
        // mezcla suave: fuera de la zona (con un margen difuminado) manda la foto original
        const alfa = await sharp(svgZona(regs, W, H, '#fff', '#000')).greyscale().blur(Math.max(2, Math.round(Math.max(W, H) / 250))).raw().toBuffer();
        const capa = await sharp(res).joinChannel(alfa, { raw: { width: W, height: H, channels: 1 } }).png().toBuffer();
        return await sharp(base).removeAlpha().composite([{ input: capa }]).png().toBuffer();
      }
      console.error('editarFoto con máscara falló:', ultimo?.message);
    }
  } catch (e) { console.error('editarFoto local:', e.message); }
  // 2) sin zona clara (cambio global) o si falló: edición normal
  let ultimo = null; for (const m of motores) { try { return await m(buffer, mime, prompt); } catch (e) { ultimo = e; } }
  throw new Error('No hay ningún motor de imágenes disponible o han fallado (' + (ultimo?.message || '') + ')');
}
