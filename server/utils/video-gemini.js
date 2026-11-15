// Análisis de vídeo con Gemini (entiende imagen + voz + texto en pantalla a la vez). Usa GEMINI_API_KEY, la misma que ya se usa para imágenes.
// El vídeo se sube a la API de archivos de Gemini (sirve para vídeos de hasta ~16 MB de WhatsApp), se espera a que esté listo y se le pide un análisis.
const BASE = 'https://generativelanguage.googleapis.com';

const PEDIDO = `Analiza este vídeo como un editor de vídeo y estratega de contenido de redes. Responde en español, claro y concreto, SIN rodeos. Estructura:
1) DE QUÉ VA y formato (vertical/horizontal, duración aproximada, tipo: pantalla dividida, hablando a cámara, voz en off, etc.).
2) GUION: lo que se dice, resumido por partes (gancho de los primeros 3 s, desarrollo, cierre/llamada a la acción). Si hay voz, cita las frases clave.
3) EDICIÓN: ritmo y número aproximado de cortes, transiciones, zooms, subtítulos (estilo, posición, color), música y efectos de sonido, rótulos y gráficos.
4) RECURSOS VISUALES: qué se ve y cómo está compuesto (por ejemplo, persona arriba y espacio 3D abajo), uso de color, fondo, luz.
5) POR QUÉ FUNCIONA y QUÉ SE PUEDE REPLICAR para vídeos de diseño de espacios deportivos (gimnasios, home gym): pasos concretos.`;

export const geminiVideoDisponible = () => !!(process.env.GEMINI_API_KEY || '').trim();

export async function analizaVideo({ buffer, mime, pregunta }) {
  const clave = (process.env.GEMINI_API_KEY || '').trim(); if (!clave) throw new Error('Falta GEMINI_API_KEY');
  const tipo = String(mime || 'video/mp4').split(';')[0] || 'video/mp4';
  // 1) subida (protocolo resumable en un solo paso)
  const ini = await fetch(BASE + '/upload/v1beta/files', {
    method: 'POST',
    headers: { 'x-goog-api-key': clave, 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(buffer.length), 'X-Goog-Upload-Header-Content-Type': tipo, 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: { display_name: 'video-' + Date.now() } }),
  });
  const urlSubida = ini.headers.get('x-goog-upload-url'); if (!ini.ok || !urlSubida) throw new Error('Gemini no aceptó la subida (' + ini.status + ')');
  const sube = await fetch(urlSubida, { method: 'POST', headers: { 'Content-Length': String(buffer.length), 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' }, body: buffer });
  const fj = await sube.json().catch(() => ({})); let fichero = fj.file; if (!sube.ok || !fichero?.uri) throw new Error('No se pudo subir el vídeo a Gemini (' + sube.status + ')');
  try {
    // 2) esperar a que Gemini lo procese
    for (let i = 0; i < 30 && fichero.state && fichero.state !== 'ACTIVE'; i++) {
      if (fichero.state === 'FAILED') throw new Error('Gemini no pudo procesar el vídeo');
      await new Promise(ok => setTimeout(ok, 2000));
      const g = await fetch(BASE + '/v1beta/' + fichero.name, { headers: { 'x-goog-api-key': clave } }); fichero = (await g.json().catch(() => ({}))) || fichero;
    }
    if (fichero.state && fichero.state !== 'ACTIVE') throw new Error('El vídeo tarda demasiado en procesarse');
    // 3) análisis
    const modelo = process.env.GEMINI_VIDEO_MODEL || 'gemini-2.5-flash';
    const r = await fetch(BASE + '/v1beta/models/' + modelo + ':generateContent', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': clave }, signal: AbortSignal.timeout(150000),
      body: JSON.stringify({ contents: [{ parts: [{ fileData: { mimeType: tipo, fileUri: fichero.uri } }, { text: PEDIDO + (pregunta ? '\n\nLo que pregunta el usuario sobre este vídeo: ' + String(pregunta).slice(0, 500) : '') }] }], generationConfig: { maxOutputTokens: 3000, temperature: 0.4 } }),
    });
    const j = await r.json().catch(() => ({}));
    const t = (j?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
    if (!r.ok || !t) throw new Error('Gemini: ' + String(j?.error?.message || r.status).slice(0, 200));
    return t;
  } finally {
    fetch(BASE + '/v1beta/' + fichero.name, { method: 'DELETE', headers: { 'x-goog-api-key': clave } }).catch(() => {}); // no se guarda el vídeo en Google
  }
}
