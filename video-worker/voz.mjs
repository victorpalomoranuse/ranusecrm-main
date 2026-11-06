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
  // Arranques fallidos: se dice algo, se interrumpe y se vuelve a empezar con las mismas palabras ("hoy me toca viajar a / hoy me toca viajar a Barcelona",
  // "durante el trayecto, aprovecho, durante el trayecto me gusta…"). Se quita el primer intento entero (y lo que haya en medio).
  const CONECTOR = new Set(['y', 'o', 'e', 'pues', 'bueno', 'osea', 'entonces']);
  for (let i = 0; i < palabras.length - 3; i++) {
    let hecho = false;
    for (let L = 8; L >= 2 && !hecho; L--) {
      for (let entre = 0; entre <= (L >= 3 ? 4 : 1) && !hecho; entre++) {
        const j = i + L + entre; if (j + L > palabras.length) continue;
        if (L === 2 && entre === 1 && !CONECTOR.has(norm(palabras[i + L].t))) continue;
        let igual = true; for (let k = 0; k < L; k++) { const x = norm(palabras[i + k].t), y = norm(palabras[j + k].t); if (!x || x !== y) { igual = false; break; } }
        if (!igual) continue;
        const hueco = palabras[j].de - palabras[i + L - 1].a; if (hueco > (L >= 3 ? 6 : 1.6)) continue;
        for (let k = 0; k < L + entre; k++) quitar.add(palabras[i + k].i ?? (i + k));
        i += L + entre - 1; hecho = true;
      }
    }
  }
  return quitar;
}

// Muletillas que casi nunca aportan nada: se quitan siempre (salvo que se pida conservarlas)
const MULETILLA = /^(e+h+|e+m+|eh?m+|m{2,}|h+m+|u+h+m*|a+h+m*|ee+|aa+)$/;
export function muletillasSueltas(palabras) {
  const q = new Set(); for (const w of palabras) if (MULETILLA.test(norm(w.t))) q.add(w.i); return q;
}
// Huecos entre palabras donde hay SONIDO de voz (un "eeeh", un "mmm", media sílaba): la palabra siguiente marca un corte y se salta ese tramo.
// Una palabra que dura muchísimo suele llevar pegado un silencio o un tropiezo: se acorta hasta donde la voz deja de sonar de verdad
export function acotaPorEnergia(palabras, wav16) {
  let env; try { env = envolvente(wav16); } catch { return 0; }
  const medias = []; for (const w of palabras) { const i0 = Math.round(w.de * 100), i1 = Math.round(w.a * 100); let a = 0, c = 0; for (let i = i0; i < i1; i++) if (env[i] !== undefined) { a += env[i]; c++; } if (c) medias.push(a / c); }
  medias.sort((x, y) => x - y); const ref = medias[Math.floor(medias.length * 0.6)] || 0; if (!ref) return 0;
  let n = 0;
  for (const w of palabras) {
    if (w.a - w.de < 0.85) continue;
    const i0 = Math.round((w.de + 0.2) * 100), i1 = Math.round(w.a * 100); let bajo = 0;
    for (let i = i0; i < i1; i++) { if ((env[i] || 0) < ref * 0.14) { bajo++; if (bajo >= 22) { w.a = Math.max(w.de + 0.25, (i - bajo + 1) / 100 + 0.06); n++; break; } } else bajo = 0; }
  }
  return n;
}
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
      'Indica qué hay que ELIMINAR para que la comunicación sea fluida y ágil: frases o preguntas dichas dos veces (quédate con la mejor toma, normalmente la última y completa). MUY IMPORTANTE: si el hablante dice algo mal (se traba, se corrige, se queda a medias, cambia de idea a mitad de frase, titubea o lo repite para decirlo mejor), ELIMINA el intento fallido ENTERO (desde donde empieza a decirlo mal) y deja SOLO la versión bien dicha, completa y fluida. Elimina también los comentarios a sí mismo o al aire ("¿cómo era?", "¿el sector ha dicho? sí", "perdona", "otra vez", "vamos a repetirlo") y cualquier frase final que no forme parte del mensaje, empezar una frase y rehacerla, tropiezos ("cu cu cuántos"), errores, y SIEMPRE las muletillas y palabras de relleno: "eh", "mmm", "o sea", "bueno" al empezar, "pues", "vale", "a ver", "digamos", "¿sabes?", "¿no?", "entonces" de arranque, "básicamente", "la verdad" repetido, y comentarios al aire que no son parte del vídeo (órdenes al que graba, "otra vez", "¿lo repito?", "¿se escucha?"). Una muletilla solo se conserva si cambia el sentido o el vídeo pide ese tono (mira las indicaciones). Si Víctor se traba y repite una frase, quédate con la toma completa y limpia. No quites contenido útil. Responde SOLO JSON {"quitar":[[desde,hasta]]} con índices inclusivos.' }] }) });
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
      'Localiza las IDEAS, frases o párrafos que el hablante dijo VARIAS VECES para decirlo mejor (repite una toma). Cada versión debe ser la frase o el párrafo COMPLETO. No incluyas repeticiones retóricas deliberadas ni cosas parecidas pero distintas: solo cuando es claramente la misma idea dicha de nuevo. Para cada grupo indica también "mejor": la posición (empezando en 0) de la versión MEJOR, que es la que está bien dicha: completa (con todo el mensaje hasta el final, incluida la llamada a la acción o el remate si lo hay), fluida, sin tropiezos, sin quedarse a medias ni con puntos suspensivos, sin comentarios a sí mismo y con el sentido más claro; si hay dudas entre varias, la última completa. Responde SOLO JSON {"tomas":[{"tema":"breve","versiones":[[desde,hasta],[desde,hasta]],"mejor":0}]} con índices inclusivos y versiones sin solaparse.' }] }) });
    const j = await r.json(); const t = JSON.parse(/\{[\s\S]*\}/.exec(j.content.map(b => b.text || '').join(''))[0]).tomas || [];
    return t.map(x => { const v = (x.versiones || []).filter(p => Array.isArray(p) && Number.isInteger(p[0]) && Number.isInteger(p[1]) && p[1] >= p[0] && p[1] < palabras.length); v.mejor = (Array.isArray(x.versiones) && v.length === x.versiones.length && Number.isInteger(x.mejor)) ? x.mejor : -1; return v; }).filter(g => g.length > 1);
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
    filas.sort((p, q) => q.puntos - p.puntos);
    // si la IA ha leído las versiones y dice cuál es la buena (completa y sin tropiezos), manda ella; el audio decide solo si no hay veredicto
    if (Number.isInteger(g.mejor) && g.mejor >= 0 && g.mejor < g.length) { const [ma, mb] = g[g.mejor]; const ix = filas.findIndex(f => f.a === ma && f.b === mb); if (ix > 0) filas.unshift(filas.splice(ix, 1)[0]); }
    const ganadora = filas[0];
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
  // Los tiempos de palabra de la transcripción son imprecisos (a veces empiezan tarde o acaban pronto): cada corte se lleva al punto de MENOR energía
  // cercano (un silencio real) antes del inicio y después del final de cada trozo, para no recortar el principio ni el final de una palabra.
  let env = null; try { env = envolvente(wav48); } catch { env = null; }
  let ref = 0; if (env) { const v = Array.from(env).filter(x => x > 0).sort((p, q) => p - q); ref = v[Math.floor(v.length * 0.7)] || 0; }
  const valle = (desde, hasta) => {
    if (!env || !ref || hasta <= desde) return null;
    const i0 = Math.max(0, Math.round(desde * 100)), i1 = Math.min(env.length - 1, Math.round(hasta * 100)); let mejor = -1, mv = 1e9;
    for (let i = i0; i <= i1; i++) if (env[i] < mv) { mv = env[i]; mejor = i; }
    return mejor >= 0 && mv < ref * 0.3 ? mejor / 100 : null;
  };
  let t0 = 0; const partes = []; const fx = []; let ultB = 0;
  trozos.forEach((t, k) => {
    const prevFin = k > 0 ? trozos[k - 1].fin : 0, sigIni = k < trozos.length - 1 ? trozos[k + 1].ini : dur;
    let a = valle(Math.max(prevFin + 0.02, t.ini - 0.3), t.ini + 0.01); if (a === null) a = Math.max(0, t.ini - 0.12);
    let b = valle(t.fin - 0.01, Math.min(sigIni - 0.02, t.fin + 0.3)); if (b === null) b = Math.min(dur, t.fin + 0.15);
    a = Math.max(a, ultB); b = Math.min(dur, Math.max(b, t.fin)); if (b <= a) { a = Math.max(0, t.ini - 0.06); b = Math.min(dur, t.fin + 0.1); }
    ultB = b;
    partes.push({ a, b, t0, ws: t.ws }); fx.push('[0:a]atrim=' + a.toFixed(3) + ':' + b.toFixed(3) + ',asetpts=PTS-STARTPTS,afade=t=in:d=0.012,afade=t=out:st=' + Math.max(0, b - a - 0.02).toFixed(3) + ':d=0.02[p' + k + ']'); t0 += b - a;
  });
  fs.writeFileSync(salida + '.txt', fx.join(';\n') + ';\n' + partes.map((_, k) => '[p' + k + ']').join('') + 'concat=n=' + partes.length + ':v=0:a=1[o]');
  spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav48, '-/filter_complex', salida + '.txt', '-map', '[o]', '-c:a', 'pcm_s16le', salida]);
  const nuevas = []; for (const p of partes) for (const w of p.ws) nuevas.push({ ...w, de: p.t0 + (w.de - p.a), a: p.t0 + (Math.min(w.a, p.b) - p.a) });
  nuevas.forEach((w, i) => { w.i0 = w.i; w.i = i; });
  return { palabras: nuevas, durVoz: t0, cortes: partes.map(p => p.t0) };
}

// Versión final del discurso: la IA decide qué tramos CONSERVAR (en vez de qué borrar). Así cada idea queda una sola vez, con su mejor toma, y nada se pisa.
// Devuelve el conjunto de índices a QUITAR (todo lo que no está en los tramos conservados) o null si no se ha podido.
export async function guionLimpio(palabras, apiKey, notas = '') {
  const guion = palabras.map((w, i) => i + ':' + w.t).join(' ');
  const prompt = 'Eres editor de audio. Esta es la transcripción (índice:palabra) de una grabación en la que la persona se equivoca, se corrige y REPITE tomas de la misma frase varias veces. Tu trabajo es decidir qué tramos CONSERVAR para que la versión final sea el discurso completo y limpio, como si lo hubiera dicho perfecto a la primera.\n\n' +
    'REGLAS:\n1) Cada idea o frase aparece UNA sola vez en la versión final. Si la dijo varias veces, conserva SOLO la toma mejor: la bien dicha, completa, fluida, sin tropiezos, sin cortarse y sin acabar en puntos suspensivos. Si una toma está completa y las demás a medias, la completa. Si dos tomas son casi iguales, elige la que conserva más palabras del mensaje (la más completa, por ejemplo la que incluye el "un día" o el complemento que la otra omite).\n' +
    '2) Elimina falsos comienzos, palabras a medias, correcciones, comentarios a sí mismo o a otras personas ("¿cómo era?", "es que queda mal", "vale", "ya", "¿el sector ha dicho? sí", exclamaciones y charla fuera del guion) y muletillas.\n' +
    '3) NO pierdas ninguna idea del mensaje: la apertura, todo el desarrollo, cada parte de la historia que cuenta y el cierre o llamada a la acción final. Si una idea solo aparece en una toma imperfecta, conserva lo mejor de ella.\n' +
    '4) Mantén el orden original: los tramos conservados van en orden creciente de índice y sin solaparse. Cada tramo empieza al principio de una frase o idea y acaba al final de otra; puedes saltarte palabras sueltas dentro quitando un tramo y abriendo otro.\n' +
    (notas ? 'Indicaciones de la persona: ' + notas + '\n' : '') +
    '\nResponde SOLO con JSON: {"conservar":[[desde,hasta],[desde,hasta]]} con índices inclusivos.\n\nTRANSCRIPCIÓN:\n' + guion.slice(0, 150000);
  for (let intento = 0; intento < 2; intento++) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: 6000, temperature: 0, messages: [{ role: 'user', content: prompt }] }) });
      const j = await r.json(); if (!r.ok) throw new Error('Claude ' + r.status);
      const rangos = (JSON.parse(/\{[\s\S]*\}/.exec(j.content.map(b => b.text || '').join(''))[0]).conservar || []).filter(p => Array.isArray(p) && Number.isInteger(p[0]) && Number.isInteger(p[1]) && p[1] >= p[0] && p[0] >= 0 && p[1] < palabras.length);
      const quedan = new Set(); for (const [a, b] of rangos) for (let i = a; i <= b; i++) quedan.add(i);
      // seguridad: si la respuesta deja muy poco o casi todo igual, no es fiable
      if (quedan.size < Math.min(15, palabras.length * 0.3)) throw new Error('respuesta con muy poco texto');
      const quitar = new Set(); for (let i = 0; i < palabras.length; i++) if (!quedan.has(i)) quitar.add(palabras[i].i ?? i);
      return quitar;
    } catch (e) { console.log('Guion limpio, reintento:', e.message); }
  }
  return null;
}
