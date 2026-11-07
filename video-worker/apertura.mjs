// Apertura premium (HyperFrames): tarjeta de título con rejilla, dos tarjetas de fotos y el propio vídeo reducido a una ventana abajo;
// después la ventana crece a pantalla completa. Devuelve el HTML, el JS de animación (GSAP) y el CSS que se añaden a la composición.
export function aperturaAHtml(ap, duracion) {
  if (!ap || !ap.titulo) return { html: '', js: '', css: '' };
  const t1 = Math.min(Number(ap.t1) || 4.4, Math.max(2, duracion - 1)), esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const fa = ap.fotos?.a || [], fb = ap.fotos?.b || [];
  const imgs = (arr, p) => arr.map((f, i) => '<img id="' + p + (i + 1) + '" src="assets/' + f + '"' + (i ? ' style="opacity:0"' : '') + '/>').join('');
  const css = `
  #ap { position: absolute; inset: 0; background: #0b0b0c; z-index: 1; }
  #ap .g { position: absolute; inset: 0; background-image: linear-gradient(rgba(255,255,255,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.045) 1px, transparent 1px); background-size: 54px 54px; }
  #ap .k { position: absolute; left: 70px; top: 96px; font-family: 'Playfair Display', serif; font-style: italic; font-size: 54px; color: #d9d3c8; }
  #ap .t1 { position: absolute; left: 0; width: 1080px; top: 236px; text-align: center; font-family: 'Montserrat', sans-serif; font-weight: 800; font-size: 43px; letter-spacing: 1px; text-transform: uppercase; white-space: nowrap; color: #f3efe9; }
  #ap .t1 span { position: relative; display: inline-block; } #ap .t1 i { position: absolute; left: 0; right: 0; bottom: -10px; height: 4px; background: #E3D2B8; transform-origin: left center; }
  #ap .t2 { position: absolute; left: 0; width: 1080px; top: 322px; text-align: center; font-family: 'Playfair Display', serif; font-style: italic; font-size: 76px; color: #E3D2B8; }
  #ap .c { position: absolute; top: 520px; width: 380px; height: 620px; border-radius: 30px; overflow: hidden; border: 2px solid rgba(255,255,255,.14); background: #111; box-shadow: 0 40px 90px rgba(0,0,0,.6); }
  #ap .c img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  #ap .p { position: absolute; left: 0; width: 1080px; top: 1180px; text-align: center; font-family: 'Montserrat', sans-serif; font-weight: 800; font-size: 32px; letter-spacing: 8px; text-transform: uppercase; color: #f3efe9; }
  #ap .v { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 35%, rgba(0,0,0,0) 30%, rgba(0,0,0,.6) 100%); }`;
  const fsT = Math.max(26, Math.min(43, Math.floor(940 / (String(ap.titulo || '').length * 0.74))));
  const html = `<div id="ap" class="clip" data-start="0" data-duration="${(t1 + 0.9).toFixed(2)}" data-track-index="6"><div class="g"></div><div class="k">${esc(ap.kicker)}</div><div class="t1" style="font-size:${fsT}px"><span>${esc(ap.titulo)}<i id="apsr"></i></span></div><div class="t2">${esc(ap.frase)}</div><div id="apA" class="c" style="left:120px">${imgs(fa, 'apa')}</div><div id="apB" class="c" style="left:580px">${imgs(fb, 'apb')}</div><div id="appal" class="p">${esc((ap.palabras || [])[0] || '')}</div><div class="v"></div></div>
`;
  const pal = JSON.stringify(ap.palabras || []);
  const js = `
gsap.set("#fondo", { zIndex: 2, left: 40, top: 1330, width: 1000, height: 540, borderRadius: "34px 34px 0 0", boxShadow: "0 0 0 2px rgba(255,255,255,.12)" });
tl.from("#ap .g", { opacity: 0, duration: 1.0, ease: "power2.out" }, 0);
tl.from("#ap .k", { opacity: 0, y: 14, duration: 0.9, ease: "power3.out" }, 0.15);
tl.from("#ap .t1", { opacity: 0, y: 22, duration: 0.8, ease: "power3.out" }, 0.4);
tl.from("#apsr", { scaleX: 0, duration: 0.8, ease: "power4.inOut" }, 0.8);
tl.from("#ap .t2", { opacity: 0, y: 22, duration: 0.8, ease: "power3.out" }, 0.7);
tl.from(["#apA", "#apB"], { y: 90, opacity: 0, scale: 0.96, duration: 1.0, ease: "expo.out", stagger: 0.12 }, 0.9);
tl.from("#fondo", { y: 560, duration: 1.1, ease: "expo.out" }, 1.1);
const fotosA = ${fa.length}, fotosB = ${fb.length};
for (let i = 1; i < fotosA; i++) { tl.to("#apa" + i, { opacity: 0, duration: 0.5, ease: "power2.inOut" }, 1.9 + (i - 1) * 1.15); tl.to("#apa" + (i + 1), { opacity: 1, duration: 0.5, ease: "power2.inOut" }, 1.9 + (i - 1) * 1.15); }
for (let i = 1; i < fotosB; i++) { tl.to("#apb" + i, { opacity: 0, duration: 0.5, ease: "power2.inOut" }, 2.15 + (i - 1) * 1.15); tl.to("#apb" + (i + 1), { opacity: 1, duration: 0.5, ease: "power2.inOut" }, 2.15 + (i - 1) * 1.15); }
tl.to(["#apA", "#apB"], { scale: 1.04, duration: ${t1.toFixed(2)}, ease: "none" }, 0.9);
${pal}.forEach((w, i) => { tl.call(() => { document.getElementById("appal").textContent = w; }, [], 1.5 + i * 0.9); tl.fromTo("#appal", { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.3, ease: "power3.out" }, 1.5 + i * 0.9); });
tl.to("#fondo", { left: 0, top: 0, width: 1080, height: 1920, borderRadius: 0, boxShadow: "none", duration: 0.8, ease: "expo.inOut" }, ${(t1 - 0.2).toFixed(2)});
tl.to("#ap", { opacity: 0, duration: 0.4, ease: "power2.in" }, ${(t1 + 0.4).toFixed(2)});
`;
  return { html, js, css };
}
