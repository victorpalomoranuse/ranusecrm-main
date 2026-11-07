// Capa visual con HyperFrames (HTML + GSAP renderizado con Chrome): convierte los textos del motor (subs.ass) en una composición
// con mejor diseño (tarjeta de pregunta con esquinas redondeadas, subtítulos karaoke, intro, horas, flashes) y la renderiza sobre el vídeo.
// Si algo falla, quien llame usa el método de siempre (quemar subs.ass con ffmpeg).
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const tseg = (s) => { const m = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(String(s).trim()); return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0; };
// &HAABBGGRR& o &HBBGGRR& -> #RRGGBB
const color = (c, def = '#ffffff') => { const m = /&H([0-9A-Fa-f]{6,8})&?/.exec(String(c || '')); if (!m) return def; const h = m[1].slice(-6); return '#' + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2); };

export function parseAss(texto) {
  const estilos = {}, eventos = []; let seccion = '', fmtEst = [], fmtEv = [];
  for (const l of texto.replace(/^﻿/, '').split(/\r?\n/)) {
    const sec = /^\[(.+)\]$/.exec(l); if (sec) { seccion = sec[1]; continue; }
    if (l.startsWith('Format:')) { const f = l.slice(7).split(',').map(x => x.trim()); if (/Styles/i.test(seccion)) fmtEst = f; else if (/Events/i.test(seccion)) fmtEv = f; }
    else if (l.startsWith('Style:')) { const v = l.slice(6).split(','); estilos[v[0].trim()] = Object.fromEntries(fmtEst.map((k, i) => [k, (v[i] || '').trim()])); }
    else if (l.startsWith('Dialogue:')) {
      const r = l.slice(9).trimStart(); const partes = []; let rest = r; for (let i = 0; i < fmtEv.length - 1; i++) { const k = rest.indexOf(','); partes.push(rest.slice(0, k)); rest = rest.slice(k + 1); } partes.push(rest);
      const o = Object.fromEntries(fmtEv.map((k, i) => [k, partes[i]])); eventos.push({ capa: Number(o.Layer) || 0, ini: tseg(o.Start), fin: tseg(o.End), estilo: (o.Style || '').trim(), texto: o.Text || '' });
    }
  }
  return { estilos, eventos };
}

const caja0 = (est) => est?.BorderStyle === '3';
// Una línea de evento -> elemento HTML + animación GSAP
function eventoAHtml(ev, est, id) {
  const T = ev.texto; const bloques = [...T.matchAll(/\{([^}]*)\}/g)];
  const tag0 = bloques[0] ? bloques[0][1] : ''; const todos = bloques.map(b => b[1]).join('');
  const dur = Math.max(0.05, ev.fin - ev.ini);
  const an = Number((/\\an(\d)/.exec(todos) || [])[1] || est?.Alignment || 2);
  const pos = /\\pos\(([-\d.]+),([-\d.]+)\)/.exec(todos);
  const fad = /\\fad\((\d+),(\d+)\)/.exec(todos); const fadIn = fad ? Number(fad[1]) / 1000 : 0, fadOut = fad ? Number(fad[2]) / 1000 : 0;
  const fsOv = /\\fs(\d+(?:\.\d+)?)/.exec(todos); const fs0 = fsOv ? Number(fsOv[1]) : Number(est?.Fontsize || 60);
  const esDibujo = /\\p1/.test(todos);
  let css = '', inner = '', anim = '';
  const z = 10 + ev.capa;
  // ----- dibujos vectoriales: destello blanco, barra de progreso, rayita del título -----
  if (esDibujo) {
    const path = T.replace(/\{[^}]*\}/g, '').trim(); const nums = [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map(m => Number(m[0]));
    if (nums.length < 8) return null;
    const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1); const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys); const w = maxX - minX, h = maxY - minY;
    const px = pos ? Number(pos[1]) : 0, py = pos ? Number(pos[2]) : 0; const left = an === 8 || an === 2 || an === 5 ? px - w / 2 : px; const top = an === 5 || an === 4 || an === 6 ? py - h / 2 : (an <= 3 ? py - h : py);
    const alfa = /\\alpha&H([0-9A-Fa-f]{2})&/.exec(todos); const op = alfa ? 1 - parseInt(alfa[1], 16) / 255 : 1; const col = /\\c(&H[0-9A-Fa-f]+&)/.exec(todos); const c = col ? color(col[1]) : '#ffffff';
    css = `left:${left}px;top:${top}px;width:${w}px;height:${h}px;background:${c};opacity:${op};z-index:${z};`;
    if (/\\fscx0/.test(todos) && /\\t\(0,(\d+),\\fscx100\)/.test(todos)) { const ms = Number(/\\t\(0,(\d+),\\fscx100\)/.exec(todos)[1]) / 1000; css += 'transform-origin:' + (an === 8 ? '50%' : '0%') + ' 50%;'; anim = `tl.fromTo("#${id}",{scaleX:0},{scaleX:1,duration:${ms.toFixed(2)},ease:"none"},${ev.ini.toFixed(2)});\n`; }
    else if (fadIn || fadOut) anim = `tl.fromTo("#${id}",{opacity:0},{opacity:${op},duration:${Math.max(0.02, fadIn).toFixed(2)}},${ev.ini.toFixed(2)});tl.to("#${id}",{opacity:0,duration:${Math.max(0.02, fadOut).toFixed(2)}},${(ev.fin - Math.max(0.02, fadOut)).toFixed(2)});\n`;
    return { html: `<div id="${id}" class="clip dib" data-start="${ev.ini.toFixed(2)}" data-duration="${dur.toFixed(2)}" data-track-index="${ev.capa + 2}" style="${css}"></div>\n`, anim };
  }
  // ----- texto con colores por tramos -----
  const colorBase = color(est?.PrimaryColour, '#ffffff'); let col = colorBase; const trozos = []; let ult = 0;
  const reColor = (b) => { const m = /\\c(&H[0-9A-Fa-f]+&)/.exec(b); return m ? color(m[1]) : null; };
  for (const b of bloques) { const ini = b.index, antes = T.slice(ult, ini); if (antes) trozos.push([antes, col]); const c = reColor(b[1]); if (c) col = c; if (/\\c&HFFFFFF&/.test(b[1]) && !c) col = colorBase; ult = ini + b[0].length; }
  const resto = T.slice(ult); if (resto) trozos.push([resto, col]);
  inner = trozos.map(([t, c]) => { const t2 = esc(t).replace(/\\N/g, '<br>'); return c.toLowerCase() === colorBase.toLowerCase() ? t2 : `<span style="color:${c}">${t2}</span>`; }).join('');
  if (!inner.replace(/<[^>]+>/g, '').trim()) return null;
  const fuente = est?.Fontname === 'Rubik' ? 'Rubik' : 'Montserrat'; const negrita = est?.Bold === '-1' || est?.Bold === '1' ? 800 : 500;
  let fsUso = fs0; if (ev.estilo === 'Intro' && pos) { const nCar = inner.replace(/<[^>]+>/g, '').length || 1; fsUso = Math.min(fs0, 980 / (nCar * 0.66)); const ancho = nCar * fsUso * 0.66; pos[1] = String(Math.max(ancho / 2 + 30, Math.min(1050 - ancho / 2, Number(pos[1])))); }
  // el texto nunca se sale del encuadre: si la línea más larga no cabe en 920 px se reduce el tamaño; HF_ESCALA lo reduce más si la revisión lo pide
  if (ev.estilo !== 'Intro' && !caja0(est)) { const lineas = inner.replace(/<br>/g, '\n').replace(/<[^>]+>/g, '').split('\n'); const mx = Math.max(...lineas.map(s => s.length), 1); fsUso = Math.min(fsUso, 900 / (mx * 0.66)); }
  if (ev.estilo !== 'Intro') fsUso = Math.round(fsUso * Number(process.env.HF_ESCALA || 1));
  const mL = Number(est?.MarginL || 50), mR = Number(est?.MarginR || 50), mV = Number(est?.MarginV || 0); const caja = est?.BorderStyle === '3';
  let posCss = '';
  if (pos) { const x = Number(pos[1]), y = Number(pos[2]); const tx = an === 5 || an === 8 || an === 2 ? '-50%' : '0'; const ty = an <= 3 ? '-100%' : an <= 6 ? '-50%' : '0'; posCss = `left:${x}px;top:${y}px;transform:translate(${tx},${ty});`; }
  else if (an <= 3) posCss = `left:${mL}px;right:${mR}px;bottom:${1920 - (1920 - mV)}px;`.replace(/bottom:\d+px/, 'bottom:' + mV + 'px');
  else if (an <= 6) posCss = `left:${mL}px;right:${mR}px;top:50%;transform:translateY(-50%);`;
  else posCss = `left:${mL}px;right:${mR}px;top:${mV}px;`;
  const sombra = caja ? 'box-shadow:0 14px 40px rgba(0,0,0,.35);' : (ev.estilo === 'Intro' ? 'text-shadow:0 6px 28px rgba(0,0,0,.8),0 0 4px rgba(0,0,0,.45);' : 'text-shadow:0 4px 16px rgba(0,0,0,.55);');
  const cajaCss = caja ? `display:block;margin:0 auto;width:fit-content;max-width:920px;padding:${Math.round(fs0 * 0.62)}px ${Math.round(fs0 * 0.9)}px;border-radius:${Math.round(fs0 * 0.7)}px;background:rgba(18,18,18,.84);` : '';
  css = `${posCss}font-family:${fuente},sans-serif;font-weight:${negrita};font-size:${fsUso}px;line-height:1.15;white-space:nowrap;text-align:center;color:${colorBase};${sombra}${cajaCss}z-index:${z};`;
  // animación: entrada (fundido y/o crecimiento) y salida
  const sc0 = /\\fscx(\d+)/.exec(todos); const pop = /\\t\(0,(\d+),\\fscx100/.exec(todos);
  const ini = ev.ini.toFixed(2), fin = ev.fin.toFixed(2);
  if (pop && sc0 && Number(sc0[1]) < 100) { const s0 = Number(sc0[1]) / 100; anim += `tl.fromTo("#${id}",{opacity:0,scale:${s0}},{opacity:1,scale:1,duration:${(Number(pop[1]) / 1000).toFixed(2)},ease:"back.out(1.7)"},${ini});\n`; }
  else anim += `tl.fromTo("#${id}",{opacity:0},{opacity:1,duration:${Math.max(0.02, fadIn || 0.04).toFixed(2)}},${ini});\n`;
  anim += `tl.to("#${id}",{opacity:0,duration:${Math.max(0.03, fadOut || 0.05).toFixed(2)}},${Math.max(ev.ini, ev.fin - Math.max(0.03, fadOut || 0.05)).toFixed(2)});\n`;
  return { html: `<div id="${id}" class="clip tx" data-start="${ini}" data-duration="${dur.toFixed(2)}" data-track-index="${ev.capa + 2}" style="${css}"><span style="display:${caja ? 'block' : 'inline'}">${inner}</span></div>\n`, anim };
}

export function construyeComposicion(ass, duracion, nombreVideo) {
  const { estilos, eventos } = parseAss(ass); let html = '', anim = '', n = 0;
  for (const ev of eventos) { if (ev.fin <= ev.ini) continue; const r = eventoAHtml(ev, estilos[ev.estilo], 'e' + (n++)); if (r) { html += r.html; anim += r.anim; } }
  return `<!doctype html>
<html lang="es"><head><meta charset="UTF-8" /><meta name="viewport" content="width=1080, height=1920" />
<script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
<style>
  @font-face { font-family: 'Montserrat'; font-weight: 100 900; src: url('assets/Montserrat-Bold.ttf'); }
  @font-face { font-family: 'Rubik'; font-weight: 100 900; src: url('assets/Rubik-Bold.ttf'); }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1920px; overflow: hidden; background: #000; }
  #root { position: relative; width: 1080px; height: 1920px; overflow: hidden; }
  #fondo { position: absolute; inset: 0; width: 1080px; height: 1920px; object-fit: cover; z-index: 0; }
  .tx, .dib { position: absolute; }
</style></head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${duracion.toFixed(2)}" data-width="1080" data-height="1920">
<video id="fondo" class="clip" data-start="0" data-duration="${duracion.toFixed(2)}" data-track-index="0" src="${nombreVideo}" playsinline></video>
${html}</div>
<script>
const tl = gsap.timeline({ paused: true });
${anim}window.__timelines["main"] = tl;
tl.seek(0);
</script></body></html>`;
}

const HF_VERSION = '0.9.19';
export function hfDisponible() { return process.env.HF_ACTIVO === '1'; }

// Renderiza la capa visual sobre el vídeo base. Devuelve la ruta del vídeo final o lanza un error (el llamador usa el respaldo).
export function componeHF({ base, subsAss, fuentes = [], salida, dir, fps = 30 }) {
  const p = path.join(dir, '_hf'); fs.rmSync(p, { recursive: true, force: true }); fs.mkdirSync(path.join(p, 'assets'), { recursive: true });
  const dur = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', base], { encoding: 'utf8' }).stdout) || 0; if (!dur) throw new Error('no se pudo leer la duración del vídeo base');
  fs.copyFileSync(base, path.join(p, 'assets', 'base.mp4'));
  for (const f of fuentes) if (fs.existsSync(f)) fs.copyFileSync(f, path.join(p, 'assets', path.basename(f)));
  fs.writeFileSync(path.join(p, 'index.html'), construyeComposicion(fs.readFileSync(subsAss, 'utf8'), dur, 'assets/base.mp4'));
  fs.writeFileSync(path.join(p, 'hyperframes.json'), JSON.stringify({ name: 'estudio', version: 1 })); fs.writeFileSync(path.join(p, 'package.json'), JSON.stringify({ name: 'estudio', private: true, type: 'module' }));
  const global = process.env.HF_GLOBAL === '1';
  const cmd = global ? 'hyperframes' : (process.platform === 'win32' ? 'npx.cmd' : 'npx'), args = global ? [] : ['--yes', 'hyperframes@' + HF_VERSION];
  const r = spawnSync(cmd, [...args, 'render', p, '-o', salida, '-f', String(fps), '-q', 'looks', '-w', process.env.HF_WORKERS || '4', '--quiet'], { encoding: 'utf8', maxBuffer: 1 << 26, timeout: 25 * 60 * 1000, shell: process.platform === 'win32' });
  if (!fs.existsSync(salida) || fs.statSync(salida).size < 5000) throw new Error('HyperFrames no produjo vídeo: ' + ((r.stderr || '') + (r.stdout || '')).slice(-400));
  return salida;
}
