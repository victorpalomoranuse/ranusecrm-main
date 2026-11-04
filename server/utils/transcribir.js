// Voz a texto con Whisper de Groq (gratis, sin tarjeta). Variable de Railway: GROQ_API_KEY
export async function transcribir(buffer, nombre = 'audio.ogg') {
  const clave = (process.env.GROQ_API_KEY || '').trim();
  if (!clave) throw new Error('Falta GROQ_API_KEY');
  const form = new FormData();
  form.append('file', new Blob([buffer]), nombre);
  form.append('model', 'whisper-large-v3-turbo');
  form.append('language', 'es');
  form.append('response_format', 'json');
  const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + clave }, body: form });
  if (!r.ok) throw new Error('Groq ' + r.status + ': ' + (await r.text().catch(() => '')).slice(0, 200));
  const j = await r.json();
  return String(j.text || '').trim();
}
