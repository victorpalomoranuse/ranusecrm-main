// Transcripción con marcas por palabra: Groq (rápido, en la nube) si hay clave; si no, whisper.cpp local.
// Escribe <base>.json con el mismo formato que whisper.cpp ({transcription:[{text, offsets:{from,to}}]}), que es el que lee el resto del motor.
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { ENV } from './entorno.mjs';

function claveGroq() {
  if (ENV.GROQ_API_KEY) return String(ENV.GROQ_API_KEY).trim();
  try { return fs.readFileSync(new URL('./secretos/groq.txt', import.meta.url), 'utf8').trim(); } catch { return ''; }
}
export async function transcribe(wav16, base) {
  if (fs.existsSync(base + '.json')) return 'cache';
  const k = claveGroq();
  if (k) {
    try {
      const mp3 = base + '.mp3'; spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav16, '-ac', '1', '-ar', '16000', '-b:a', '48k', mp3]);
      const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(mp3)]), 'voz.mp3'); fd.append('model', 'whisper-large-v3-turbo'); fd.append('language', 'es'); fd.append('response_format', 'verbose_json'); fd.append('timestamp_granularities[]', 'word'); fd.append('temperature', '0');
      const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + k }, body: fd });
      const j = await r.json(); if (!r.ok) throw new Error('Groq ' + r.status + ' ' + JSON.stringify(j).slice(0, 160));
      const ws = (j.words || []).filter(w => String(w.word || '').trim()); if (!ws.length) throw new Error('Groq no devolvió palabras');
      fs.writeFileSync(base + '.json', JSON.stringify({ transcription: ws.map(w => ({ text: ' ' + String(w.word).trim(), offsets: { from: Math.round(w.start * 1000), to: Math.round(w.end * 1000) } })) }));
      return 'groq';
    } catch (e) { console.log('Groq falló (' + e.message + '), se usa whisper local'); }
  }
  const W = ENV.WHISPER_CLI || 'C:/Users/cashc/AppData/Local/RanuseVideo/whisper/Release/whisper-cli.exe', M = ENV.WHISPER_MODEL || 'C:/Users/cashc/AppData/Local/RanuseVideo/whisper/ggml-large-v3-turbo-q5_0.bin';
  spawnSync(W, ['-m', M, '-f', wav16, '-l', 'es', '-t', '8', '-bs', '1', '-bo', '1', '-ml', '1', '-sow', '-oj', '-of', base], { encoding: 'utf8', maxBuffer: 1 << 26 });
  return fs.existsSync(base + '.json') ? 'local' : 'fallo';
}
