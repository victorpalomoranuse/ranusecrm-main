// Análisis de un vídeo viral de referencia: mide cómo está editado (ritmo de cortes, zooms, texto, música, gancho)
// y lo convierte en una receta de formato con las mismas claves que usa el montador. El aspecto (colores, fuente, mayúsculas) se adapta luego a la marca.
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { ENV } from './entorno.mjs';
import { transcribe } from './transcribir.mjs';

const run = (c, a) => spawnSync(c, a, { encoding: 'utf8', maxBuffer: 1 << 28 });

// Instantes de corte (cambios de plano) detectados con ffmpeg
export function detectaCortes(video, umbral = 0.28) {
  const r = run('ffmpeg', ['-hide_banner', '-nostats', '-i', video, '-vf', `select='gt(scene,${umbral})',showinfo`, '-an', '-f', 'null', '-']);
  const t = [...String(r.stderr || '').matchAll(/pts_time:([\d.]+)/g)].map(m => Number(m[1])).filter(x => x > 0.3);
  return t.sort((a, b) => a - b).filter((x, i, a) => i === 0 || x - a[i - 1] > 0.25);
}

const estad = (v) => { if (!v.length) return { media: 0, mediana: 0, min: 0, max: 0 }; const s = [...v].sort((a, b) => a - b); return { media: v.reduce((x, y) => x + y, 0) / v.length, mediana: s[Math.floor(s.length / 2)], min: s[0], max: s[s.length - 1] }; };

// Análisis A FONDO de un vídeo: 24 fotogramas a buena resolución (el gancho casi fotograma a fotograma) + datos medidos.
// Describe cómo está grabado, la presencia de la persona (mirada, gestos, energía), la edición, el audio y la narrativa, con segundos concretos.
export function rasgosAudio(wav, palabras, dur) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-loglevel', 'error', '-i', wav, '-af', 'asetnsamples=n=4000:p=0,astats=metadata=1:reset=1,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=-', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const lv = [...String(r.stdout || '').matchAll(/RMS_level=(-?[0-9.]+|-inf)/g)].map(m => (m[1] === '-inf' ? -90 : Number(m[1])));
  if (lv.length < 12) return null;
  const orden = [...lv].sort((a, b) => a - b), pc = (q) => orden[Math.min(orden.length - 1, Math.floor(orden.length * q))];
  const p10 = pc(0.1), p50 = pc(0.5), p90 = pc(0.9), ventana = 0.25;
  const hablada = new Array(lv.length).fill(false); for (const w of palabras || []) { const i = Math.floor(w.de / ventana); if (i >= 0 && i < hablada.length) hablada[i] = true; }
  const voz = lv.filter((_, i) => hablada[i]), hueco = lv.filter((_, i) => !hablada[i] && i > 2 && i < lv.length - 2);
  const media = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const vozM = media(voz), huecoM = media(hueco);
  // pausas largas (ventanas seguidas muy por debajo de la voz)
  const umbral = (vozM ?? p90) - 18; let racha = 0, larga = 0, nPausas = 0, silencio = 0; for (const x of lv) { if (x < umbral) { racha++; silencio++; if (racha === 3) nPausas++; larga = Math.max(larga, racha); } else racha = 0; }
  // ritmo del habla por tramos de 5 s
  const wpm = []; if (palabras && palabras.length) for (let s = 0; s < dur; s += 5) { const n = palabras.filter(w => w.de >= s && w.de < s + 5).length; wpm.push(Math.round(n * 12)); }
  const hab = wpm.filter(x => x > 0);
  const txt = (palabras || []).map(w => String(w.t).toLowerCase().replace(/[^a-záéíóúñ]/g, ''));
  const muletillas = txt.filter(x => ['eh', 'ehh', 'em', 'emm', 'mm', 'mmm', 'ee', 'eee'].includes(x)).length + (txt.join(' ').split(' o sea ').length - 1);
  const fondo = huecoM !== null && vozM !== null ? vozM - huecoM : null; // cuánto más bajo está el fondo que la voz
  return {
    nivel_voz_db: vozM !== null ? Math.round(vozM) : null, rango_dinamico_db: Math.round(p90 - p10),
    variacion_energia: p90 - p10 > 22 ? 'muy variada (la voz sube y baja mucho)' : p90 - p10 > 14 ? 'variada' : 'plana (energía casi constante)',
    picos_de_energia: lv.filter((x, i) => hablada[i] && x > p50 + 6).length, pausas_largas: nPausas, pausa_mas_larga_s: Math.round(larga * ventana * 10) / 10, silencio_pct: Math.round(silencio / lv.length * 100),
    ritmo_habla_ppm: hab.length ? { medio: Math.round(hab.reduce((a, b) => a + b, 0) / hab.length), minimo: Math.min(...hab), maximo: Math.max(...hab) } : null,
    muletillas, fondo: fondo === null ? 'no se puede saber' : fondo < 14 ? 'hay música o ruido de fondo constante entre frases' : fondo < 28 ? 'ambiente o música muy baja entre frases' : 'fondo limpio (casi silencio entre frases)',
  };
}
export async function analisisProfundo(video, dir, { dur, cortes, hablado, ppm, mean, audio }, avisa = () => {}) {
  avisa('Mirando el vídeo a fondo…');
  const segs = [0.2, 0.6, 1.0, 1.5, 2.1, 2.8]; const resto = 18; for (let i = 0; i < resto; i++) segs.push(3 + (Math.max(dur - 3.5, 1) * i) / Math.max(resto - 1, 1));
  const cont = []; const usados = [];
  segs.forEach((s, i) => { const t0 = Math.min(Math.max(dur - 0.15, 0.05), s); const jpg = path.join(dir, 'prof_' + i + '.jpg'); run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', t0.toFixed(2), '-i', video, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', jpg]); if (fs.existsSync(jpg)) { cont.push({ type: 'text', text: 'Segundo ' + t0.toFixed(1) + (i < 6 ? ' (gancho)' : '') + ':' }); cont.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(jpg).toString('base64') } }); usados.push(t0); fs.rmSync(jpg, { force: true }); } });
  const datos = 'DATOS MEDIDOS: dura ' + dur.toFixed(1) + ' s; cortes (cambios de plano) en los segundos: ' + (cortes || []).slice(0, 40).map(c => c.toFixed(1)).join(', ') + '; ' + (ppm ? ppm + ' palabras por minuto' : 'sin voz hablada') + '; volumen medio ' + (mean ?? '?') + ' dB. ' + (hablado ? 'Lo que se dice: "' + hablado.slice(0, 2000) + '".' : '') + (audio ? ' AUDIO MEDIDO (no es una impresión, son mediciones): ' + JSON.stringify(audio) + '. Úsalo para el campo audio y la presencia: energía de la voz, pausas, ritmo, muletillas y si hay música o ruido de fondo.' : '');
  const prompt = datos + '\n\nEres un director de fotografía y editor de vídeo corto (Reels) con ojo clínico. Analiza este vídeo HASTA EL FONDO, como si tuvieras que reproducirlo plano a plano. Sé concreto y específico (qué se ve, en qué segundo), no genérico. Solo lo que se ve u oye en los datos y fotogramas; si algo no se puede saber, pon "no se aprecia". Devuelve SOLO JSON con esta forma exacta:\n{"gancho":{"que_se_ve":"los primeros 3 s fotograma a fotograma","gesto_o_accion":"qué hace la persona en el arranque","frase":"primera frase o texto","texto_en_pantalla":"","por_que_engancha":""},"grabacion":{"plano_predominante":"primer plano|plano medio|plano general|detalle","angulo":"a la altura de los ojos|picado|contrapicado","movimiento_camara":"fija|en mano|gimbal|travelling|zoom","encuadre_persona":"dónde está en el cuadro y cuánto ocupa","iluminacion":"natural|artificial|contraluz… y calidad","lugar_y_fondo":"dónde está grabado y qué hay detrás","calidad_imagen":"nítido|ruido|…","audio_captado":"micro de solapa|ambiente|reverb…","como_se_grabo":"deducción de cómo se grabó (quién sujeta la cámara, trípode, selfie…)"},"presencia":{"contacto_visual":"mira a cámara o no, cuánto","expresion":"","energia":"baja|media|alta y cómo cambia","gestos":[{"segundo":0,"gesto":"gesto o movimiento concreto (manos, cabeza, cejas, señalar…)","efecto":"para qué sirve en el vídeo"}],"postura_y_ropa":"","naturalidad":"cuánto parece guion y cuánto espontáneo"},"edicion":{"ritmo":"","tipos_de_plano_b_roll":["qué imágenes de apoyo usa"],"zooms_y_movimientos":"","texto_y_subtitulos":"estilo, tamaño, posición, animación","transiciones_y_efectos":"","color_y_look":""},"audio":{"musica":"hay o no, género, volumen frente a la voz","voz":"tono, velocidad, pausas","efectos_sonido":""},"narrativa":{"estructura":"gancho → desarrollo → cierre con segundos","giro_o_sorpresa":"","cierre_y_cta":"","emocion":"qué hace sentir"},"momentos_clave":[{"segundo":0,"que_pasa":"","por_que_funciona":""}],"replicar":["detalle concreto que merece copiarse"],"mejorar":["qué haría mejor el vídeo"]}';
  cont.push({ type: 'text', text: prompt });
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': ENV.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: 5000, temperature: 0, messages: [{ role: 'user', content: cont }] }) });
  const j = await r.json(); const txt = (j.content || []).map(b => b.text || '').join(''); const m = /\{[\s\S]*\}/.exec(txt); if (!m) throw new Error('análisis a fondo sin respuesta');
  return JSON.parse(m[0]);
}

export async function analizaReferencia(video, dir, avisa = () => {}) {
  fs.mkdirSync(dir, { recursive: true });
  const dur = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video]).stdout) || 0; if (!dur) throw new Error('No he podido leer el vídeo de referencia');
  avisa('Midiendo el ritmo de cortes…');
  const cortes = detectaCortes(video), tramos = []; let prev = 0; for (const c of [...cortes, dur]) { tramos.push(c - prev); prev = c; }
  const est = estad(tramos);
  // volumen de la música/voz (para saber si hay música fuerte) y palabras por minuto
  avisa('Escuchando la referencia…');
  let palabras = [], hablado = '';
  try {
    const wav = path.join(dir, 'ref.wav'); run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-vn', '-ac', '1', '-ar', '16000', wav]);
    const wj = path.join(dir, 'ref_palabras'); await transcribe(wav, wj);
    palabras = JSON.parse(fs.readFileSync(wj + '.json', 'utf8').replace(/^﻿/, '')).transcription.map(s => ({ t: s.text.trim(), de: s.offsets.from / 1000 })).filter(w => w.t && !/^\[.*\]$/.test(w.t));
    hablado = palabras.map(w => w.t).join(' ');
  } catch { /* sin voz o sin transcripción */ }
  const ppm = palabras.length && dur ? Math.round(palabras.length / (dur / 60)) : 0;
  const vol = run('ffmpeg', ['-hide_banner', '-nostats', '-i', video, '-vn', '-af', 'volumedetect', '-f', 'null', '-']).stderr || ''; const mean = Number((/mean_volume: (-?[\d.]+)/.exec(vol) || [])[1]) || null;
  // fotogramas: los 3 primeros segundos (gancho) y uno en medio de varios planos
  avisa('Mirando cómo está montado…');
  const cont = []; const tomas = [0.2, 0.9, 1.7, 2.6]; const medios = []; for (let i = 0; i < tramos.length && medios.length < 8; i += Math.max(1, Math.floor(tramos.length / 8))) { const ini = i === 0 ? 0 : cortes[i - 1]; medios.push(ini + tramos[i] / 2); }
  [...tomas, ...medios].forEach((s, i) => { const jpg = path.join(dir, 'ref_' + i + '.jpg'); run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', Math.min(dur - 0.1, s).toFixed(2), '-i', video, '-frames:v', '1', '-vf', 'scale=320:-2', jpg]); if (fs.existsSync(jpg)) { cont.push({ type: 'text', text: 'Fotograma en el segundo ' + s.toFixed(1) + (i < tomas.length ? ' (gancho)' : '') + ':' }); cont.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(jpg).toString('base64') } }); fs.rmSync(jpg, { force: true }); } });
  const datos = 'DATOS MEDIDOS: duración ' + dur.toFixed(1) + ' s; ' + tramos.length + ' planos; duración de plano media ' + est.media.toFixed(2) + ' s, mediana ' + est.mediana.toFixed(2) + ', mín ' + est.min.toFixed(2) + ', máx ' + est.max.toFixed(2) + '; ' + (ppm ? ppm + ' palabras por minuto' : 'sin voz hablada') + '; volumen medio ' + (mean ?? '?') + ' dB. ' + (hablado ? 'Lo que se dice: "' + hablado.slice(0, 1500) + '". ' : '');
  const prompt = datos + '\n\nEres un editor de vídeo experto en Reels/TikTok. Analiza CÓMO está editado este vídeo viral de referencia (no su tema) para que podamos replicar su estilo de edición con nuestro montador automático. Devuelve SOLO JSON con esta forma exacta:\n{"nombre":"nombre corto del formato (3-4 palabras)","descripcion":"2-3 frases: qué estructura tiene (gancho, desarrollo, cierre) y por qué funciona","estructura":["gancho: ...","desarrollo: ...","cierre: ..."],"receta":{"corte":{"min":nº,"max":nº},"zoomFinal":1-1.3,"whoosh":0-1,"flash":true|false,"introLetras":true|false,"collage":true|false,"estiloSubs":"normal"|"karaoke","subs":{"palabrasPorBloque":1-4,"tam":60-110,"margenV":300-900},"titulo":true|false,"barra":true|false,"resaltar":true|false,"horas":true|false,"musica":{"volumen":-24 a -8}},"criterio":"instrucciones para el montador automático sobre cómo montar este estilo (ritmo, qué se enseña en el gancho, cuándo cambia de escena, zooms, texto en pantalla), 4-8 frases concretas","parecido_a_nuestros_formatos":"cuál de estos se le parece más: un día contigo, entrevista pregunta-respuesta, one take, collage b-roll, clips dopamínicos, o ninguno"}\nUsa los datos medidos para el ritmo de cortes (corte.min y max en segundos alrededor de la mediana). No inventes lo que no se vea.';
  cont.push({ type: 'text', text: prompt });
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': ENV.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: 2000, temperature: 0, messages: [{ role: 'user', content: cont }] }) });
  const j = await r.json(); const d = JSON.parse(/\{[\s\S]*\}/.exec((j.content || []).map(b => b.text || '').join(''))[0]);
  let detalle = null, audio = null; try { const w = path.join(dir, 'ref.wav'); if (fs.existsSync(w)) audio = rasgosAudio(w, palabras, dur); } catch (e) { avisa('Sin medir el audio: ' + e.message); }
  try { detalle = await analisisProfundo(video, dir, { dur, cortes, hablado, ppm, mean, audio }, avisa); } catch (e) { avisa('Sin análisis a fondo: ' + e.message); }
  return { audio_medido: audio, detalle, hablado: hablado.slice(0, 3000), dur, planos: tramos.length, plano_medio: Number(est.media.toFixed(2)), plano_mediana: Number(est.mediana.toFixed(2)), palabras_por_min: ppm, ...d };
}
