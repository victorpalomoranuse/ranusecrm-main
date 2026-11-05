// Limpieza de la voz: tropiezos ("cu-cu-cuántos"), palabras repetidas, errores y pausas largas; y cadena de audio para voz con eco/ruido de sala.
import fs from 'fs';
import { spawnSync } from 'child_process';

// Cadena de limpieza: filtro de graves, quita ruido de sala (con seguimiento), puerta suave entre palabras, menos "boxiness",
// presencia en la voz, compresión suave y volumen final. Sin subir el ruido.
// Reductor de ruido con IA (RNNoise, modelo bd.rnnn: se copia a la carpeta de trabajo, donde corre ffmpeg) + un toque de voz + volumen.
export const CADENA_VOZ = 'highpass=f=80,arnndn=m=bd.rnnn,equalizer=f=250:t=q:w=1:g=-1.5,equalizer=f=3000:t=q:w=1.2:g=1.5,loudnorm=I=-15:TP=-1.5:LRA=11,aresample=48000';
export function copiaModelo(dirTrabajo) { const o = new URL('./modelos/bd.rnnn', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'); if (fs.existsSync(o)) fs.copyFileSync(o, dirTrabajo + '/bd.rnnn'); }

const norm = t => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zñ0-9]/g, '');
const silabas = t => Math.max(1, (norm(t).match(/[aeiou]+/g) || ['a']).length);

function envolvente(wav16) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', wav16, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  const f = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4)), HOP = 160, n = Math.floor(f.length / HOP), e = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < HOP; k++) { const v = f[i * HOP + k]; s += v * v; } e[i] = Math.sqrt(s / HOP); }
  const s = new Float32Array(n); for (let i = 0; i < n; i++) { let a = 0, c = 0; for (let k = -2; k <= 2; k++) if (e[i + k] !== undefined) { a += e[i + k]; c++; } s[i] = a / c; }
  return s; // 100 valores por segundo
}

// Tropiezos dentro de una palabra: si dura mucho más de lo normal y hay un valle de energía, se salta lo anterior al valle.
export function corrigeTrabones(palabras, wav16) {
  let env; try { env = envolvente(wav16); } catch { return 0; }
  let n = 0;
  for (const w of palabras) {
    const dur = w.a - w.de, exp = Math.max(0.2, silabas(w.t) * 0.17 + 0.06);
    if (dur < Math.max(0.5, exp * 1.55)) continue;
    const i0 = Math.round(w.de * 100), i1 = Math.round(w.a * 100); const seg = Array.from(env.slice(i0, i1)).sort((a, b) => a - b); const med = seg[Math.floor(seg.length * 0.6)] || 0; if (!med) continue;
    const ini = Math.round((w.de + 0.07) * 100), fin = Math.round((w.a - exp * 0.8) * 100); let mejor = -1, mv = 1e9;
    for (let i = ini; i <= fin; i++) if (env[i] < mv) { mv = env[i]; mejor = i; }
    if (mejor > 0 && mv < med * 0.55) { w.de = mejor / 100 + 0.01; w.corregida = true; n++; }
  }
  return n;
}

// Palabras repetidas seguidas ("es es", "cu cuántos"): se quita la primera.
export function repetidasInmediatas(palabras) {
  const quitar = new Set();
  for (let i = 0; i < palabras.length - 1; i++) {
    const a = norm(palabras[i].t), b = norm(palabras[i + 1].t); if (!a || !b || /^\d+$/.test(a)) continue;
    const hueco = palabras[i + 1].de - palabras[i].a;
    if (hueco < 0.7 && (a === b || (a.length <= 3 && b.length > a.length && b.startsWith(a)))) quitar.add(palabras[i].i ?? i);
  }
  return quitar;
}

// Muletillas que casi nunca aportan nada: se quitan siempre (salvo que se pida conservarlas)
const MULETILLA = /^(e+h+|e+m+|eh?m+|m{2,}|h+m+|u+h+m*|a+h+m*|ee+|aa+)$/;
export function muletillasSueltas(palabras) {
  const q = new Set(); for (const w of palabras) if (MULETILLA.test(norm(w.t))) q.add(w.i); return q;
}
// Huecos entre palabras donde hay SONIDO de voz (un "eeeh", un "mmm", media sílaba): la palabra siguiente marca un corte y se salta ese tramo.
export function huecosConSonido(palabras, wav16) {
  let env; try { env = envolvente(wav16); } catch { return 0; }
  const medias = []; for (const w of palabras) { const i0 = Math.round(w.de * 100), i1 = Math.round(w.a * 100); let a = 0, c = 0; for (let i = i0; i < i1; i++) if (env[i] !== undefined) { a += env[i]; c++; } if (c) medias.push(a / c); }
  medias.sort((x, y) => x - y); const ref = medias[Math.floor(medias.length * 0.6)] || 0; if (!ref) return 0;
  let n = 0;
  for (let k = 0; k < palabras.length - 1; k++) {
    const a = palabras[k].a, b = palabras[k + 1].de, gap = b - a; if (gap < 0.22 || gap > 1.6) continue;
    const i0 = Math.round((a + 0.05) * 100), i1 = Math.round((b - 0.05) * 100); if (i1 <= i0) continue;
    let suma = 0, pico = 0, c = 0; for (let i = i0; i < i1; i++) { const v = env[i] || 0; suma += v; pico = Math.max(pico, v); c++; }
    if (c && suma / c > ref * 0.28 && pico > ref * 0.45) { palabras[k + 1].corte = true; n++; }
  }
  return n;
}

// La IA marca rangos de índices a eliminar: frases dichas dos veces, empezar y rehacer, errores, muletillas, comentarios al aire.
export async function rangosAQuitar(palabras, apiKey, notas = '') {
  try {
    const guion = palabras.map((w, i) => i + ':' + w.t).join(' ');
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: 4000, messages: [{ role: 'user', content:
      'Transcripción de una voz en off o de alguien hablando a cámara (índice:palabra): ' + guion.slice(0, 150000) + '\n' + (notas ? 'Indicaciones: ' + notas + '\n' : '') +
      'Indica qué hay que ELIMINAR para que la comunicación sea fluida y ágil: frases o preguntas dichas dos veces (quédate con la mejor toma, normalmente la última y completa), empezar una frase y rehacerla, tropiezos ("cu cu cuántos"), errores, y SIEMPRE las muletillas y palabras de relleno: "eh", "mmm", "o sea", "bueno" al empezar, "pues", "vale", "a ver", "digamos", "¿sabes?", "¿no?", "entonces" de arranque, "básicamente", "la verdad" repetido, y comentarios al aire que no son parte del vídeo (órdenes al que graba, "otra vez", "¿lo repito?", "¿se escucha?"). Una muletilla solo se conserva si cambia el sentido o el vídeo pide ese tono (mira las indicaciones). Si Víctor se traba y repite una frase, quédate con la toma completa y limpia. No quites contenido útil. Responde SOLO JSON {"quitar":[[desde,hasta]]} con índices inclusivos.' }] }) });
    const j = await r.json(); const q = JSON.parse(/\{[\s\S]*\}/.exec(j.content.map(b => b.text || '').join(''))[0]).quitar || [];
    const s = new Set(); for (const x of q) if (Array.isArray(x) && Number.isInteger(x[0])) for (let i = x[0]; i <= (Number.isInteger(x[1]) ? x[1] : x[0]); i++) s.add(i); return s;
  } catch { return new Set(); }
}

// Ideas, frases o párrafos que el hablante dijo VARIAS VECES (repite la toma para decirlo mejor). Devuelve grupos de versiones: [[ [a,b], [c,d] ], ...]
export async function tomasRepetidas(palabras, apiKey, notas = '') {
  try {
    const guion = palabras.map((w, i) => i + ':' + w.t).join(' ');
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: 4000, messages: [{ role: 'user', content:
      'Transcripción de una grabación larga de voz (índice:palabra): ' + guion.slice(0, 150000) + '\n' + (notas ? 'Indicaciones: ' + notas + '\n' : '') +
      'Localiza las IDEAS, frases o párrafos que el hablante dijo VARIAS VECES para decirlo mejor (repite una toma). Cada versión debe ser la frase o el párrafo COMPLETO. No incluyas repeticiones retóricas deliberadas ni cosas parecidas pero distintas: solo cuando es claramente la misma idea dicha de nuevo. Responde SOLO JSON {"tomas":[{"tema":"breve","versiones":[[desde,hasta],[desde,hasta]]}]} con índices inclusivos y versiones sin solaparse.' }] }) });
    const j = await r.json(); const t = JSON.parse(/\{[\s\S]*\}/.exec(j.content.map(b => b.text || '').join(''))[0]).tomas || [];
    return t.map(x => (x.versiones || []).filter(p => Array.isArray(p) && Number.isInteger(p[0]) && Number.isInteger(p[1]) && p[1] >= p[0] && p[1] < palabras.length)).filter(g => g.length > 1);
  } catch { return []; }
}

// Entonación (variación del tono en semitonos) de un tramo de muestras a 16 kHz, por autocorrelación en tramos con voz
function variacionTono(x, i0, i1) {
  const vals = [], frame = 640;
  for (let s = i0; s + frame + 230 < i1 && s + frame + 230 < x.length; s += 640) {
    let e = 0; for (let k = 0; k < frame; k++) e += x[s + k] * x[s + k]; e /= frame; if (e < 2e-5) continue;
    let mejor = 0, lag0 = 0; for (let lag = 53; lag <= 228; lag++) { let c = 0, n1 = 0, n2 = 0; for (let k = 0; k < frame; k += 2) { const a = x[s + k], b = x[s + k + lag]; c += a * b; n1 += a * a; n2 += b * b; } const r = c / Math.sqrt(n1 * n2 + 1e-9); if (r > mejor) { mejor = r; lag0 = lag; } }
    if (mejor > 0.5) vals.push(12 * Math.log2(16000 / lag0 / 100));
  }
  if (vals.length < 8) return 0; const m = vals.reduce((a, b) => a + b, 0) / vals.length; return Math.sqrt(vals.reduce((a, b) => a + (b - m) * (b - m), 0) / vals.length);
}
// De cada grupo de tomas se queda la MEJOR: sin tropiezos ni muletillas, con ritmo natural, energía y entonación expresivas (y, si hay duda, la última). Devuelve los índices a quitar.
export function elegirMejoresTomas(palabras, grupos, wav16, mostrar = false) {
  if (!grupos.length) return new Set();
  let x; try { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', wav16, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 1 << 29 }); x = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4)); } catch { return new Set(); }
  const quitar = new Set();
  for (const g of grupos) {
    const filas = g.map(([a, b], k) => {
      const ws = palabras.slice(a, b + 1), dur = Math.max(0.5, palabras[b].a - palabras[a].de), i0 = Math.round(palabras[a].de * 16000), i1 = Math.round(palabras[b].a * 16000);
      let pausas = 0, tropiezos = 0, rellenos = 0, suma = 0, suma2 = 0, n = 0;
      for (let i = 1; i < ws.length; i++) if (ws[i].de - ws[i - 1].a > 0.5) pausas++;
      for (const w of ws) { if (w.corregida || w.corte) tropiezos++; if (/^(e+h+|e+m+|m{2,}|o ?sea|bueno|pues|vale)$/i.test(norm(w.t))) rellenos++; }
      for (let s = i0; s < i1; s += 800) { let e = 0; const f = Math.min(800, i1 - s); if (f < 400) break; for (let k = 0; k < f; k++) e += x[s + k] * x[s + k]; e = 10 * Math.log10(e / f + 1e-9); suma += e; suma2 += e * e; n++; }
      const media = n ? suma / n : -60, varE = n ? Math.sqrt(Math.max(0, suma2 / n - media * media)) : 0, ritmo = ws.length / dur, tono = variacionTono(x, i0, i1);
      const puntos = -3 * tropiezos - 2 * rellenos - 1.5 * pausas - Math.abs(ritmo - 2.8) * 1.2 + Math.min(1.5, tono / 3) + Math.min(1, varE / 6) + Math.min(0.5, Math.max(0, (media + 45) / 40)) + (k === g.length - 1 ? 0.8 : 0);
      return { a, b, puntos, ritmo, tono, varE, pausas, tropiezos, rellenos };
    });
    filas.sort((p, q) => q.puntos - p.puntos); const ganadora = filas[0];
    if (mostrar) console.log('Toma elegida', palabras[ganadora.a].t, '…', '| ritmo', ganadora.ritmo.toFixed(1), 'pal/s | entonación', ganadora.tono.toFixed(1), 'st | tropiezos', ganadora.tropiezos, 'rellenos', ganadora.rellenos, '| frente a', filas.length - 1, 'versión(es)');
    for (const f of filas.slice(1)) for (let i = f.a; i <= f.b; i++) quitar.add(palabras[i].i);
  }
  return quitar;
}

// Recompone la voz sin lo eliminado ni las pausas largas, y devuelve las palabras con sus tiempos nuevos.
export function recomponeVoz({ palabras, quitar, wav48, salida, pausa = 0.45 }) {
  const dur = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav48], { encoding: 'utf8' }).stdout) || 0;
  const kept = palabras.filter(w => !quitar.has(w.i)); const trozos = [];
  for (const w of kept) { const u = trozos[trozos.length - 1]; const contiguo = u && w.i === u.ult + 1; if (u && !w.corte && (contiguo || w.de - u.fin < 0.12) && w.de - u.fin < pausa) { u.fin = w.a; u.ult = w.i; u.ws.push(w); } else trozos.push({ ini: w.de, fin: w.a, ult: w.i, ws: [w] }); }
  let t0 = 0; const partes = []; const fx = [];
  trozos.forEach((t, k) => {
    const a = Math.max(0, t.ini - 0.06), b = Math.min(dur, t.fin + 0.1);
    partes.push({ a, b, t0, ws: t.ws }); fx.push('[0:a]atrim=' + a.toFixed(3) + ':' + b.toFixed(3) + ',asetpts=PTS-STARTPTS,afade=t=in:d=0.008,afade=t=out:st=' + Math.max(0, b - a - 0.012).toFixed(3) + ':d=0.012[p' + k + ']'); t0 += b - a;
  });
  fs.writeFileSync(salida + '.txt', fx.join(';\n') + ';\n' + partes.map((_, k) => '[p' + k + ']').join('') + 'concat=n=' + partes.length + ':v=0:a=1[o]');
  spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav48, '-/filter_complex', salida + '.txt', '-map', '[o]', '-c:a', 'pcm_s16le', salida]);
  const nuevas = []; for (const p of partes) for (const w of p.ws) nuevas.push({ ...w, de: p.t0 + (w.de - p.a), a: p.t0 + (Math.min(w.a, p.b) - p.a) });
  nuevas.forEach((w, i) => { w.i0 = w.i; w.i = i; });
  return { palabras: nuevas, durVoz: t0 };
}
