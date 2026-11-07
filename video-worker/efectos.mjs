// Catálogo de efectos de HyperFrames (HTML + GSAP): cada efecto es una plantilla con los colores y la tipografía de Ranuse.
// Se renderizan como vídeos de muestra de ~5 s para que se vea cómo quedan; después se pueden usar como piezas en los montajes.
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { rutaFuente } from './fuentes.mjs';

const ARENA = '#E3D2B8';
export const EFECTOS = {
  'pin-ubicacion': { nombre: 'Ubicación con pin', descripcion: 'Un pin cae sobre el mapa y aparece el lugar (Barcelona · obra). Ideal para «mi día».', dur: 4.5 },
  'nombre-cargo': { nombre: 'Nombre y cargo', descripcion: 'Rótulo que entra de lado con el nombre y el cargo de quien habla (entrevistas).', dur: 4.5 },
  'antes-despues': { nombre: 'Antes y después', descripcion: 'Una barra se desliza entre el antes y el después (render frente a obra terminada).', dur: 5.5 },
  'medidas': { nombre: 'Medidas que se dibujan', descripcion: 'Un recuadro con líneas de cota que se dibujan y cifras que aparecen.', dur: 5.5 },
  'checklist': { nombre: 'Checklist', descripcion: 'Lista de lo que incluye un proyecto con ticks que se van marcando.', dur: 5.5 },
  'linea-tiempo': { nombre: 'Línea de tiempo de obra', descripcion: 'Pasos del proyecto (diseño, licencia, obra, entrega) que avanzan uno a uno.', dur: 5.5 },
  'maquina-escribir': { nombre: 'Máquina de escribir', descripcion: 'El texto se escribe letra a letra con cursor parpadeante.', dur: 4.5 },
  'marcador': { nombre: 'Marcador sobre la palabra clave', descripcion: 'Una franja de color se dibuja detrás de la palabra importante.', dur: 4.5 },
  'cortina-circular': { nombre: 'Transición: cortina circular', descripcion: 'Un círculo se abre y revela la escena siguiente.', dur: 4.0 },
  'persiana': { nombre: 'Transición: persiana', descripcion: 'Franjas que se cierran y se abren para cambiar de escena.', dur: 4.0 },
  'zoom-desenfoque': { nombre: 'Transición: zoom con desenfoque', descripcion: 'La imagen se acerca desenfocándose y entra la siguiente.', dur: 4.0 },
  'cierre-seguir': { nombre: 'Cierre con botón de seguir', descripcion: 'Botón «seguir» que se pulsa, con la arroba y una línea que se dibuja.', dur: 4.5 },
};

const css = `
@font-face { font-family: 'Montserrat'; font-weight: 100 900; src: url('assets/Montserrat-Bold.ttf'); }
@font-face { font-family: 'Bebas Neue'; font-weight: 100 900; src: url('assets/BebasNeue-Regular.ttf'); }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 1080px; height: 1920px; overflow: hidden; background: #0d0c0b; }
#root { position: relative; width: 1080px; height: 1920px; overflow: hidden; font-family: 'Montserrat', sans-serif; color: #f3efe9; background: radial-gradient(ellipse at 30% 20%, #2a2218 0%, #14110d 55%, #0b0a09 100%); }
.abs { position: absolute; }
.arena { color: ${ARENA}; }
`;

function pagina(dur, cuerpo, script) {
  return `<!doctype html><html lang="es"><head><meta charset="UTF-8" /><meta name="viewport" content="width=1080, height=1920" />
<script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script><style>${css}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${dur}" data-width="1080" data-height="1920">
<div id="esc" class="abs clip" style="inset:0" data-start="0" data-duration="${dur}" data-track-index="1">${cuerpo}</div></div>
<script>const tl = gsap.timeline({ paused: true });
${script}
window.__timelines["main"] = tl; tl.seek(0);</script></body></html>`;
}

// Fondo de "escena" con dos paneles de color para las transiciones
const escena = (n, color, texto) => `<div id="e${n}" class="abs" style="inset:0;background:${color};display:flex;align-items:center;justify-content:center;font-size:120px;font-weight:800;color:${/^#(2a|17)/.test(color) ? '#E3D2B8' : '#17130f'}">${texto}</div>`;

const PLANTILLAS = {
  'pin-ubicacion': (p) => [`
<div class="abs" style="left:90px;top:560px;width:900px;height:760px;border-radius:44px;background:linear-gradient(135deg,#1d1914,#2a241c);border:2px solid rgba(227,210,184,.25);overflow:hidden">
  <div class="abs" style="inset:0;background-image:linear-gradient(rgba(255,255,255,.05) 2px,transparent 2px),linear-gradient(90deg,rgba(255,255,255,.05) 2px,transparent 2px);background-size:90px 90px"></div>
  <div class="abs" style="left:-100px;top:340px;width:1200px;height:34px;background:rgba(227,210,184,.12);transform:rotate(-14deg)"></div>
  <div class="abs" style="left:200px;top:-100px;width:34px;height:1000px;background:rgba(227,210,184,.1);transform:rotate(18deg)"></div>
</div>
<svg id="pin" class="abs" style="left:440px;top:700px" width="200" height="260" viewBox="0 0 100 130"><path d="M50 4C28 4 12 21 12 42c0 28 38 82 38 82s38-54 38-82C88 21 72 4 50 4z" fill="${ARENA}"/><circle cx="50" cy="42" r="15" fill="#17130f"/></svg>
<div id="onda" class="abs" style="left:420px;top:910px;width:240px;height:80px;border-radius:50%;border:5px solid ${ARENA};opacity:0"></div>
<div id="lugar" class="abs" style="left:90px;width:900px;top:1050px;text-align:center;font-size:92px;font-weight:800">${p.texto || 'barcelona'}</div>
<div id="lugar2" class="abs arena" style="left:90px;width:900px;top:1170px;text-align:center;font-size:44px;font-weight:700;letter-spacing:8px">${p.texto2 || 'VISITA DE OBRA'}</div>`,
  `tl.fromTo("#pin",{y:-700,opacity:0},{y:0,opacity:1,duration:.7,ease:"bounce.out"},.3);
tl.fromTo("#onda",{scale:.2,opacity:.9},{scale:2.2,opacity:0,duration:.9,ease:"power2.out"},.95);
tl.fromTo("#lugar",{opacity:0,y:40},{opacity:1,y:0,duration:.6,ease:"power3.out"},1.1);
tl.fromTo("#lugar2",{opacity:0,letterSpacing:"30px"},{opacity:1,letterSpacing:"8px",duration:.8,ease:"power3.out"},1.3);
tl.to("#esc",{opacity:0,duration:.3},4.2);`],

  'nombre-cargo': (p) => [`
<div id="tar" class="abs" style="left:90px;top:1380px;width:760px;height:190px;border-radius:30px;background:rgba(20,18,15,.92);border-left:12px solid ${ARENA};box-shadow:0 30px 70px rgba(0,0,0,.5)"></div>
<div id="n1" class="abs" style="left:150px;top:1412px;font-size:68px;font-weight:800">${p.texto || 'víctor palomo'}</div>
<div id="n2" class="abs arena" style="left:150px;top:1500px;font-size:36px;font-weight:700;letter-spacing:4px">${p.texto2 || 'FUNDADOR · RANUSE DESIGN'}</div>`,
  `tl.fromTo("#tar",{x:-1000},{x:0,duration:.7,ease:"expo.out"},.4);
tl.fromTo("#n1",{opacity:0,x:60},{opacity:1,x:0,duration:.5,ease:"power3.out"},.8);
tl.fromTo("#n2",{opacity:0,x:60},{opacity:1,x:0,duration:.5,ease:"power3.out"},.95);
tl.to(["#tar","#n1","#n2"],{x:-1000,duration:.5,ease:"power3.in",stagger:.05},3.8);`],

  'antes-despues': () => [`
<div class="abs" style="left:90px;top:520px;width:900px;height:900px;border-radius:40px;overflow:hidden;background:#2b2118">
  <div class="abs" style="inset:0;background:linear-gradient(160deg,#3a2c1f,#17130f);display:flex;align-items:flex-end;padding:40px"><span style="font-size:54px;font-weight:800;letter-spacing:4px" class="arena">ANTES</span></div>
  <div id="desp" class="abs" style="inset:0;background:linear-gradient(160deg,#E3D2B8,#8f7d66);display:flex;align-items:flex-end;justify-content:flex-end;padding:40px;clip-path:inset(0 0 0 100%)"><span style="font-size:54px;font-weight:800;letter-spacing:4px;color:#17130f">DESPUÉS</span></div>
  <div id="barra" class="abs" style="left:880px;top:0;width:10px;height:900px;background:#fff"></div>
  <div id="asa" class="abs" style="left:855px;top:410px;width:60px;height:80px;border-radius:30px;background:#fff;box-shadow:0 10px 30px rgba(0,0,0,.4)"></div>
</div>
<div id="tt" class="abs" style="left:0;width:1080px;top:1480px;text-align:center;font-size:56px;font-weight:800">de render a <span class="arena">realidad</span></div>`,
  `const o={v:100};
tl.fromTo("#barra",{x:0},{x:-780,duration:2.4,ease:"power2.inOut"},.8);
tl.fromTo("#asa",{x:0},{x:-780,duration:2.4,ease:"power2.inOut"},.8);
tl.fromTo("#desp",{clipPath:"inset(0 0 0 100%)"},{clipPath:"inset(0 0 0 0%)",duration:2.4,ease:"power2.inOut"},.8);
tl.fromTo("#tt",{opacity:0,y:30},{opacity:1,y:0,duration:.6,ease:"power3.out"},3.4);
tl.to("#esc",{opacity:0,duration:.3},5.2);`],

  'medidas': () => [`
<div id="caja" class="abs" style="left:240px;top:640px;width:600px;height:480px;border:6px solid ${ARENA};border-radius:12px;background:rgba(227,210,184,.06)"></div>
<div id="ch" class="abs" style="left:240px;top:1180px;width:600px;height:6px;background:${ARENA};transform-origin:left center"></div>
<div id="cv" class="abs" style="left:900px;top:640px;width:6px;height:480px;background:${ARENA};transform-origin:center top"></div>
<div id="mh" class="abs" style="left:240px;width:600px;white-space:nowrap;top:1210px;text-align:center;font-family:'Bebas Neue';font-size:110px" class="arena">4,20 m</div>
<div id="mv" class="abs" style="left:930px;top:830px;white-space:nowrap;font-family:'Bebas Neue';font-size:110px;color:${ARENA}">2,60 m</div>
<div id="tm" class="abs" style="left:0;width:1080px;top:1450px;text-align:center;font-size:52px;font-weight:800">cada centímetro, <span class="arena">medido</span></div>`,
  `tl.fromTo("#caja",{opacity:0,scale:.9},{opacity:1,scale:1,duration:.6,ease:"power3.out"},.3);
tl.fromTo("#ch",{scaleX:0},{scaleX:1,duration:.8,ease:"power3.inOut"},.9);
tl.fromTo("#cv",{scaleY:0},{scaleY:1,duration:.8,ease:"power3.inOut"},1.3);
tl.fromTo("#mh",{opacity:0,y:20},{opacity:1,y:0,duration:.5,ease:"back.out(1.7)"},1.6);
tl.fromTo("#mv",{opacity:0,x:-20},{opacity:1,x:0,duration:.5,ease:"back.out(1.7)"},2.1);
tl.fromTo("#tm",{opacity:0,y:30},{opacity:1,y:0,duration:.6,ease:"power3.out"},2.8);
tl.to("#esc",{opacity:0,duration:.3},5.2);`],

  'checklist': () => [`
<div class="abs" style="left:110px;width:860px;top:520px;font-size:64px;font-weight:800">el proyecto <span class="arena">incluye</span></div>
${['diseño y planos', 'proyecto técnico y licencia', 'maquinaria y mobiliario', 'obra y puesta en marcha'].map((t, i) => `<div id="f${i}" class="abs" style="left:110px;top:${700 + i * 170}px;width:860px;height:130px;border-radius:26px;background:rgba(20,18,15,.9);border:2px solid rgba(227,210,184,.3);display:flex;align-items:center;padding-left:40px;font-size:46px;font-weight:700"><svg id="k${i}" width="70" height="70" viewBox="0 0 70 70" style="margin-right:34px"><circle cx="35" cy="35" r="30" fill="none" stroke="${ARENA}" stroke-width="5"/><path id="p${i}" d="M20 36l11 11 20-24" fill="none" stroke="${ARENA}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>${t}</div>`).join('')}`,
  `[0,1,2,3].forEach(i=>{tl.fromTo("#f"+i,{x:-900,opacity:0},{x:0,opacity:1,duration:.6,ease:"expo.out"},.4+i*.35);
const L=document.getElementById("p"+i).getTotalLength();tl.fromTo("#p"+i,{strokeDasharray:L,strokeDashoffset:L},{strokeDashoffset:0,duration:.4,ease:"power2.out"},1.0+i*.55);});
tl.to("#esc",{opacity:0,duration:.3},5.2);`],

  'linea-tiempo': () => [`
<div class="abs" style="left:0;width:1080px;top:480px;text-align:center;font-size:60px;font-weight:800">así avanza <span class="arena">tu obra</span></div>
<div class="abs" style="left:230px;top:700px;width:8px;height:920px;background:rgba(255,255,255,.12);border-radius:4px"></div>
<div id="hilo" class="abs" style="left:230px;top:700px;width:8px;height:920px;background:${ARENA};border-radius:4px;transform-origin:center top"></div>
${['diseño', 'licencia', 'obra', 'entrega'].map((t, i) => `<div id="d${i}" class="abs" style="left:196px;top:${700 + i * 280}px;width:76px;height:76px;border-radius:50%;background:#17130f;border:8px solid ${ARENA}"></div><div id="t${i}" class="abs" style="left:320px;top:${706 + i * 280}px;font-size:58px;font-weight:800">${t}</div>`).join('')}`,
  `tl.fromTo("#hilo",{scaleY:0},{scaleY:1,duration:3.4,ease:"none"},.6);
[0,1,2,3].forEach(i=>{tl.fromTo("#d"+i,{scale:0},{scale:1,duration:.4,ease:"back.out(2.5)"},.6+i*1.1);tl.fromTo("#t"+i,{opacity:0,x:40},{opacity:1,x:0,duration:.5,ease:"power3.out"},.7+i*1.1);});
tl.to("#esc",{opacity:0,duration:.3},5.2);`],

  'maquina-escribir': (p) => [`
<div class="abs" style="left:100px;width:880px;top:760px;font-size:96px;font-weight:800;line-height:120px"><span id="tx"></span><span id="cur" class="arena">|</span></div>`,
  `const texto=${JSON.stringify(p.texto || 'diseñamos gimnasios que se sienten')};const o={n:0};const el=document.getElementById("tx");
tl.to(o,{n:texto.length,duration:2.6,ease:"none",onUpdate:()=>{el.textContent=texto.slice(0,Math.round(o.n));}},.5);
tl.fromTo("#cur",{opacity:1},{opacity:0,duration:.35,repeat:9,yoyo:true,ease:"steps(1)"},.2);
tl.to("#esc",{opacity:0,duration:.3},4.1);`],

  'marcador': () => [`
<div class="abs" style="left:100px;width:880px;top:780px;font-size:92px;font-weight:800;line-height:130px">lo que importa es <span style="position:relative;display:inline-block"><span id="mk" class="abs" style="left:-12px;right:-12px;top:22px;bottom:12px;background:${ARENA};transform-origin:left center;border-radius:8px"></span><span style="position:relative;color:#17130f">el espacio</span></span></div>`,
  `tl.fromTo("#mk",{scaleX:0},{scaleX:1,duration:.8,ease:"power3.inOut"},1.0);
tl.fromTo("#esc",{opacity:0},{opacity:1,duration:.3},0);
tl.to("#esc",{opacity:0,duration:.3},4.1);`],

  'cortina-circular': () => [`${escena(1, '#2a2218', 'antes')}<div id="e2w" class="abs" style="inset:0;clip-path:circle(0% at 50% 50%)">${escena(2, ARENA, 'después')}</div>`,
  `tl.fromTo("#e2w",{clipPath:"circle(0% at 50% 50%)"},{clipPath:"circle(150% at 50% 50%)",duration:1.4,ease:"power3.inOut"},1.2);
tl.to("#esc",{opacity:0,duration:.3},3.7);`],

  'persiana': () => [`${escena(1, '#2a2218', 'antes')}<div class="abs" style="inset:0;display:flex;flex-direction:column">${[0,1,2,3,4,5,6,7].map(i => `<div class="pers" style="flex:1;background:${ARENA};transform:scaleX(0);transform-origin:${i % 2 ? 'right' : 'left'} center"></div>`).join('')}</div>${escena(2, '#17130f', 'después').replace('class="abs"', 'class="abs" id="e2p" style="opacity:0"').replace('style="inset:0;', 'style="inset:0;')}`,
  `tl.to(".pers",{scaleX:1,duration:.5,ease:"power3.inOut",stagger:.07},1.0);
tl.to("#e2p",{opacity:1,duration:.01},1.7);
tl.to(".pers",{scaleX:0,transformOrigin:"right center",duration:.5,ease:"power3.inOut",stagger:.07},1.8);
tl.to("#esc",{opacity:0,duration:.3},3.7);`],

  'zoom-desenfoque': () => [`<div id="za" class="abs" style="inset:0">${escena(1, '#2a2218', 'antes')}</div><div id="zb" class="abs" style="inset:0;opacity:0">${escena(2, ARENA, 'después')}</div>`,
  `tl.to("#za",{scale:1.8,filter:"blur(30px)",opacity:0,duration:.9,ease:"power3.in"},1.2);
tl.fromTo("#zb",{scale:.6,filter:"blur(30px)",opacity:0},{scale:1,filter:"blur(0px)",opacity:1,duration:.9,ease:"power3.out"},1.7);
tl.to("#esc",{opacity:0,duration:.3},3.7);`],

  'cierre-seguir': (p) => [`
<div id="btn" class="abs" style="left:240px;top:820px;width:600px;height:170px;border-radius:85px;background:${ARENA};color:#17130f;display:flex;align-items:center;justify-content:center;font-size:72px;font-weight:800"><span id="bt">seguir</span></div>
<div id="arr" class="abs" style="left:0;width:1080px;top:1060px;text-align:center;font-size:48px;font-weight:700;letter-spacing:6px" class="arena">${p.texto || '@RANUSEDESIGN'}</div>
<div id="lin" class="abs" style="left:240px;top:1150px;width:600px;height:6px;background:${ARENA};transform-origin:left center;border-radius:3px"></div>
<div id="txs" class="abs" style="left:0;width:1080px;top:600px;text-align:center;font-size:70px;font-weight:800;line-height:90px">no te pierdas<br><span class="arena">cómo se hace</span></div>`,
  `tl.fromTo("#txs",{opacity:0,y:30},{opacity:1,y:0,duration:.6,ease:"power3.out"},.3);
tl.fromTo("#btn",{scale:0},{scale:1,duration:.6,ease:"back.out(2)"},.8);
tl.to("#btn",{scale:.9,duration:.12,yoyo:true,repeat:1},2.0);
tl.call(()=>{document.getElementById("bt").textContent="siguiendo ✓";},[],2.12);
tl.fromTo("#arr",{opacity:0,letterSpacing:"26px"},{opacity:1,letterSpacing:"6px",duration:.8,ease:"power3.out"},1.8);
tl.fromTo("#lin",{scaleX:0},{scaleX:1,duration:.7,ease:"power3.out"},2.2);
tl.to("#esc",{opacity:0,duration:.3},4.2);`],
};

export function htmlEfecto(id, params = {}) {
  const def = EFECTOS[id], pl = PLANTILLAS[id]; if (!def || !pl) throw new Error('Efecto desconocido: ' + id);
  const [cuerpo, script] = pl(params); return pagina(def.dur, cuerpo, script);
}

// Renderiza el efecto y devuelve la ruta del MP4
export function creaEfecto(id, params, dir) {
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  for (const fam of ['Montserrat', 'Bebas Neue']) { const o = rutaFuente(fam) || (fam === 'Bebas Neue' ? path.join(path.dirname(rutaFuente('Anton') || ''), 'BebasNeue-Regular.ttf') : null); if (o && fs.existsSync(o)) fs.copyFileSync(o, path.join(dir, 'assets', path.basename(o))); }
  fs.writeFileSync(path.join(dir, 'index.html'), htmlEfecto(id, params));
  fs.writeFileSync(path.join(dir, 'hyperframes.json'), JSON.stringify({ name: 'efecto', version: 1 })); fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'efecto', private: true, type: 'module' }));
  const salida = path.join(dir, 'efecto.mp4'); const global = process.env.HF_GLOBAL === '1';
  const cmd = global ? 'hyperframes' : (process.platform === 'win32' ? 'npx.cmd' : 'npx'), args = global ? [] : ['--yes', 'hyperframes@0.9.19'];
  const r = spawnSync(cmd, [...args, 'render', dir, '-o', salida, '-f', '30', '-q', 'looks', '-w', process.env.HF_WORKERS || '4', '--quiet'], { encoding: 'utf8', maxBuffer: 1 << 26, timeout: 10 * 60 * 1000, shell: process.platform === 'win32' });
  if (!fs.existsSync(salida) || fs.statSync(salida).size < 5000) throw new Error('No se pudo dibujar el efecto: ' + ((r.stderr || '') + (r.stdout || '')).slice(-300));
  return salida;
}
