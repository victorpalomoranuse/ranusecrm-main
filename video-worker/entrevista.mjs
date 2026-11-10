// Inteligencia de edición para entrevistas largas: quién habla (y quién es quién), que NO se mezclen las voces dentro de un clip, y un editor jefe que juzga cada clip antes de darlo por bueno.
import { ENV } from './entorno.mjs';

const MODELOS = [ENV.EDITOR_MODEL, 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-sonnet-4-5-20250929'].filter(Boolean);
// Pregunta a Claude y devuelve el JSON de la respuesta; si un modelo no existe en la cuenta, prueba el siguiente.
export async function claudeJSON(prompt, { max = 4000, modelos = MODELOS } = {}) {
  let ultimo = null;
  for (const modelo of modelos) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': ENV.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: modelo, max_tokens: Math.max(max, 3000), messages: [{ role: 'user', content: prompt }] }) });
      const j = await r.json(); if (!r.ok) throw new Error('Claude ' + r.status + ' ' + (j.error?.message || '').slice(0, 80));
      return JSON.parse(/\{[\s\S]*\}/.exec(j.content.map(b => b.text || '').join(''))[0]);
    } catch (e) { ultimo = e; console.log('Claude (' + modelo + '):', e.message); }
  }
  throw ultimo || new Error('sin modelo');
}

// La separación de voces a veces cambia de hablante en una sola palabra (o en dos): se corrige cuando las dos vecinas dicen lo contrario.
export function suavizaHablantes(palabras) {
  if (!palabras.some(w => w.spk !== undefined && w.spk !== null)) return 0;
  let cambios = 0;
  for (let pasada = 0; pasada < 3; pasada++) {
    const runs = []; palabras.forEach((w, i) => { const u = runs[runs.length - 1]; if (u && u.spk === w.spk) u.fin = i; else runs.push({ spk: w.spk, ini: i, fin: i }); });
    for (let k = 1; k < runs.length - 1; k++) {
      const r = runs[k], n = r.fin - r.ini + 1, dur = palabras[r.fin].a - palabras[r.ini].de;
      if (runs[k - 1].spk === runs[k + 1].spk && runs[k - 1].spk !== r.spk && n <= 2 && dur < 0.9) { for (let i = r.ini; i <= r.fin; i++) palabras[i].spk = runs[k - 1].spk; cambios += n; }
    }
  }
  return cambios;
}

// Quién es el experto (el que RESPONDE) y quién el entrevistador. Pista fiable: el experto es quien CONTESTA a las preguntas (empieza a hablar justo después de una frase acabada en «?» del otro).
// Quien más habla no siempre es el experto (en los ensayos el entrevistador a veces dicta frases enteras), así que no se usa solo eso.
export async function asignaRoles(palabras, notas = '') {
  const cuenta = {}; for (const w of palabras) if (w.spk !== undefined && w.spk !== null) cuenta[w.spk] = (cuenta[w.spk] || 0) + 1;
  const ks = Object.keys(cuenta); if (ks.length < 2) return null;
  let experto = ks.sort((x, y) => cuenta[y] - cuenta[x])[0], por = 'quien más habla';
  // 1) quién contesta a las preguntas
  const contesta = {}, pares = [];
  for (let i = 0; i < palabras.length - 1; i++) {
    if (!/\?$/.test(palabras[i].t)) continue;
    const sp = palabras[i].spk; let k = i + 1; while (k < palabras.length && k < i + 60 && (palabras[k].spk === sp || palabras[k].spk === undefined)) k++;
    if (k < palabras.length && k < i + 60) { const r = palabras[k].spk; contesta[r] = (contesta[r] || 0) + 1; if (pares.length < 8) { let q0 = i; while (q0 > 0 && i - q0 < 16 && palabras[q0 - 1].spk === sp && !/[.!?]$/.test(palabras[q0 - 1].t)) q0--; pares.push({ q: sp, pregunta: palabras.slice(q0, i + 1).map(w => w.t).join(' '), r, respuesta: palabras.slice(k, k + 18).map(w => w.t).join(' ') }); } }
  }
  const orden = Object.keys(contesta).sort((x, y) => contesta[y] - contesta[x]);
  if (orden.length && (orden.length === 1 || contesta[orden[0]] >= 2 * contesta[orden[1]]) && contesta[orden[0]] >= 2) { experto = orden[0]; por = 'contesta a las preguntas (' + contesta[orden[0]] + ' veces)'; }
  else {
    // 2) no está claro: la IA decide leyendo preguntas con su respuesta y trozos de cada voz
    try {
      const muestra = ks.map(k => { const idx = palabras.map((w, i) => (String(w.spk) === k ? i : -1)).filter(i => i >= 0), sel = []; for (let q = 0; q < 4; q++) { const i = idx[Math.floor(idx.length * (q + 0.5) / 4)]; sel.push(palabras.slice(i, i + 22).map(w => w.t).join(' ')); } return 'VOZ ' + k + ' (' + cuenta[k] + ' palabras):\n- ' + sel.join('\n- '); }).join('\n\n');
      const qa = pares.length ? '\n\nPREGUNTAS Y QUIÉN CONTESTA:\n' + pares.map(p => 'Voz ' + p.q + ' pregunta: «' + p.pregunta + '» → voz ' + p.r + ' responde: «' + p.respuesta + '…»').join('\n') : '';
      const r = await claudeJSON('En esta grabación hablan dos personas de un estudio de diseño de gimnasios. Una es el EXPERTO (Víctor), que responde y explica, y la otra es quien PREGUNTA (Dani, el entrevistador); mientras graban, el entrevistador a veces sugiere o dicta cómo decirlo, pero el experto es QUIEN CONTESTA A LAS PREGUNTAS. Fragmentos de cada voz:\n\n' + muestra + qa + (notas ? '\n\nIndicaciones del equipo: ' + notas : '') + '\n\nResponde SOLO JSON: {"experto": "<id de la voz que contesta a las preguntas>", "motivo": "una frase"}', { max: 600 });
      if (ks.includes(String(r.experto))) { experto = String(r.experto); por = 'IA: ' + String(r.motivo || '').slice(0, 100); }
    } catch (e) { por += ' (la IA no pudo decidirlo: ' + e.message + ')'; }
  }
  console.log('Voces: experto = voz', experto, '—', por);
  for (const w of palabras) w.rol = (w.spk === undefined || w.spk === null) ? undefined : (String(w.spk) === experto ? 'R' : 'P');
  return experto;
}

// Dentro de un clip: la voz del entrevistador solo vale ANTES de que empiece la respuesta (la pregunta). Todo lo que diga después (sugerencias, «vale», repetir la frase del otro) se corta.
export function limpiaTramosPorVoz(tramos, palabras) {
  const out = []; let hayR = false, quitadas = 0;
  for (const [a, b] of tramos) {
    const ws = palabras.filter(w => w.de >= a - 0.02 && w.a <= b + 0.02); if (!ws.length) continue;
    const runs = []; for (const w of ws) { const rol = w.rol || 'R', u = runs[runs.length - 1]; if (u && u.rol === rol) u.ws.push(w); else runs.push({ rol, ws: [w] }); }
    const quedan = new Set();
    for (const run of runs) {
      if (run.rol === 'P') { if (hayR) { quitadas += run.ws.length; continue; } run.ws.forEach(w => quedan.add(w)); }
      else { run.ws.forEach(w => quedan.add(w)); hayR = true; }
    }
    // los trozos contiguos que sobreviven vuelven a ser tramos
    let cur = null;
    for (const w of ws) {
      if (!quedan.has(w)) { if (cur) { out.push(cur); cur = null; } continue; }
      if (cur && w.de - cur.fin < 0.6) cur.fin = w.a; else { if (cur) out.push(cur); cur = { ini: w.de, fin: w.a }; }
    }
    if (cur) out.push(cur);
  }
  if (quitadas) console.log('  voces: se cortan', quitadas, 'palabras del entrevistador dentro de la respuesta');
  return out.filter(t => t.fin - t.ini >= 0.5).map(t => [Math.max(0, t.ini - 0.08), t.fin + 0.18]);
}

// El texto que se OIRÍA en un clip, tramo a tramo, con quién habla
export function textoDeTramos(tramos, palabras) {
  return tramos.map(([a, b], k) => {
    const ws = palabras.filter(w => w.de >= a - 0.02 && w.a <= b + 0.02), nP = ws.filter(w => w.rol === 'P').length;
    return (k + 1) + ' [' + (ws.some(w => w.rol) ? (nP > ws.length / 2 ? 'P' : 'R') : '·') + '] ' + ws.map(w => w.t).join(' ');
  }).join('\n');
}

// Editor jefe: lee cada clip ya montado como lo haría un espectador y dice si se puede publicar, si hay que quitar algo o si hay que tirarlo.
export async function juzgaClips(clips, palabras, { reglas = '' } = {}) {
  await Promise.all(clips.map(async (c) => {
    try {
      const r = await claudeJSON('Eres el editor jefe de Ranuse Design (diseño de espacios deportivos) y vas a publicar este clip en Instagram Reels / TikTok TAL CUAL. Cada línea es un tramo que se oirá en este orden (P = entrevistador que pregunta, R = el experto que responde). Imagínalo como un espectador que NO conoce el contexto.\n\nTÍTULO EN PANTALLA: ' + c.titulo + '\nPRIMERA FRASE: ' + (c.gancho || '') + '\n\nCLIP:\n' + textoDeTramos(c.tramos, palabras) + '\n\n' +
        'IMPORTANTE: los tartamudeos, muletillas, palabras repetidas y tomas falsas pequeñas se limpian después automáticamente: NO los penalices salvo que cambien el sentido. Juzga la HISTORIA y lo que no se arregla solo. Juzga con rigor: ¿se entiende solo (sin referencias a cosas que no se han dicho)? ¿la primera frase engancha en 3 segundos? ¿hay mezcla de voces (frases del entrevistador que suenan a respuesta, sugerencias de grabación, el mismo mensaje dicho por los dos)? ¿la idea está completa y termina con remate, o queda cortada? ¿hay frases repetidas o tomas falsas? ¿aporta algo que se comparta o se guarde?' + (reglas ? '\n\nREGLAS DE MARCA: ' + reglas.slice(0, 1200) : '') +
        '\n\nResponde SOLO JSON: {"nota": 0-100, "se_entiende_solo": true|false, "mezcla_de_voces": true|false, "incompleto": true|false, "gancho": "fuerte|normal|flojo", "problemas": ["frase corta"], "quitar_tramos": [números de línea que sobran y se pueden quitar sin romper la idea], "veredicto": "publicar|arreglar|descartar"}', { max: 900 });
      c.juicio = { nota: Number(r.nota) || null, entiendeSolo: r.se_entiende_solo !== false, mezcla: !!r.mezcla_de_voces, incompleto: !!r.incompleto, gancho: String(r.gancho || ''), problemas: (r.problemas || []).slice(0, 4).map(x => String(x).slice(0, 140)), veredicto: String(r.veredicto || 'publicar') };
      const sob = new Set((r.quitar_tramos || []).map(Number).filter(n => n >= 2 && n <= c.tramos.length)); // la primera línea (el comienzo) no se toca
      if (sob.size && c.juicio.veredicto === 'arreglar') { c.tramos = c.tramos.filter((_, k) => !sob.has(k + 1)); c.total = c.tramos.reduce((s, t) => s + (t[1] - t[0]), 0); c.juicio.arreglado = [...sob]; }
    } catch (e) { console.log('Sin juicio del editor jefe para un clip:', e.message); }
  }));
  return clips;
}
