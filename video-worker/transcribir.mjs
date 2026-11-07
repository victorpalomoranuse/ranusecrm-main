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
function claveDeepgram() {
  if (ENV.DEEPGRAM_API_KEY) return String(ENV.DEEPGRAM_API_KEY).trim();
  try { return fs.readFileSync(new URL('./secretos/deepgram.txt', import.meta.url), 'utf8').trim(); } catch { return ''; }
}
// Alineador de palabras (forced alignment con el modelo MMS): afina los tiempos de cada palabra (~20 ms). Solo si está instalado (ALINEA=1) y se pide.
function alinea(wav16, base) {
  if (process.env.ALINEA !== '1') return false;
  try {
    const py = process.env.ALINEA_PY || 'python3', script = new URL('./alinea.py', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const r = spawnSync(py, [script, wav16, base + '.json', base + '.alineado.json'], { encoding: 'utf8', timeout: 8 * 60 * 1000, maxBuffer: 1 << 26 });
    if (r.status === 0 && fs.existsSync(base + '.alineado.json')) { fs.copyFileSync(base + '.json', base + '.deepgram.json'); fs.copyFileSync(base + '.alineado.json', base + '.json'); console.log('Palabras alineadas con el alineador:', (r.stdout || '').trim().split('\n').pop()); return true; }
    console.log('Sin alinear (se usan los tiempos de Deepgram):', ((r.stderr || '') + '').split('\n').filter(l => l && !/%/.test(l)).slice(-2).join(' | '));
  } catch (e) { console.log('Sin alinear:', e.message); }
  return false;
}
export async function transcribe(wav16, base, { alinear = false } = {}) {
  if (fs.existsSync(base + '.json')) return 'cache';
  // 1) Deepgram (tiempos de palabra muy precisos y muletillas incluidas) si hay clave
  const kd = claveDeepgram();
  if (kd) {
    try {
      const mp3 = base + '.mp3'; spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav16, '-ac', '1', '-ar', '16000', '-b:a', '64k', mp3]);
      const r = await fetch('https://api.deepgram.com/v1/listen?model=nova-3&language=es&punctuate=true&smart_format=false&filler_words=true&diarize=true', { method: 'POST', headers: { Authorization: 'Token ' + kd, 'Content-Type': 'audio/mpeg' }, body: fs.readFileSync(mp3) });
      const j = await r.json(); if (!r.ok) throw new Error('Deepgram ' + r.status + ' ' + JSON.stringify(j).slice(0, 160));
      const ws = (j.results?.channels?.[0]?.alternatives?.[0]?.words || []).filter(w => String(w.punctuated_word || w.word || '').trim()); if (!ws.length) throw new Error('Deepgram no devolvió palabras');
      fs.writeFileSync(base + '.json', JSON.stringify({ transcription: ws.map(w => ({ text: ' ' + String(w.punctuated_word || w.word).trim(), offsets: { from: Math.round(w.start * 1000), to: Math.round(w.end * 1000) }, ...(w.speaker !== undefined ? { spk: w.speaker } : {}) })) }));
      if (alinear) alinea(wav16, base);
      return 'deepgram';
    } catch (e) { console.log('Deepgram falló (' + e.message + '), se prueba Groq'); }
  }
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
