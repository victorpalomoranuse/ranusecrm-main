import { useEffect, useRef, useState } from 'react';
import { analizaMov, estadoCamara, cargaImg } from './RenderRecorrido';
import './RenderRecorrido.css';

// Recorrido continuo: TODOS los renders del proyecto, en orden, en un solo escenario fijo. Al deslizar, la cámara avanza por
// el primero y, sin parar, «entra» en el siguiente (fundido con el movimiento todavía en marcha): uno se mueve por el espacio
// de una vista a otra sin salir nunca del recorrido. Al empezar una zona nueva, su nombre aparece pequeño, arriba a la izquierda, y se desvanece.
// Cada escena: { src, prof (mapa de profundidad, opcional), mov, puntos, alt, inicio (primera de su zona), zona: { num, titulo, texto } }.
// Si algo falla, se enseñan las imágenes sin más.

const VS = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
const FS = `
precision highp float;
uniform sampler2D uIA,uDA,uIB,uDB;
uniform vec2 uRes,uFA,uFB,uLook;
uniform float uFit;
uniform float uTA,uLA,uTB,uLB,uSwA,uSwB,uRA,uRB,uMix,uAspA,uAspB;
vec3 escena(sampler2D img,sampler2D dep,float t,float lat,float sw,float rel,vec2 foc,float asp,vec2 s){
  float va=uRes.x/uRes.y;vec2 uv=s;bool fuera=false;vec2 bg=s;
  if(uFit>0.5){
    if(va<asp){float fh=va/asp;uv=vec2(s.x,0.5+(s.y-0.5)/fh);bg=vec2(0.5+(s.x-0.5)*fh,s.y);}
    else{float fw=asp/va;uv=vec2(0.5+(s.x-0.5)/fw,s.y);bg=vec2(s.x,0.5+(s.y-0.5)*fw);}
    fuera=uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0;
    uv=clamp(uv,0.0,1.0);
  }else{
    if(va<asp)uv.x=0.5+(s.x-0.5)*(va/asp);else uv.y=0.5+(s.y-0.5)*(asp/va);
  }
  vec2 p=uv;
  vec2 sway=vec2(sw*0.012-lat*0.034,sw*0.004)+uLook*vec2(0.022,0.011);
  for(int i=0;i<10;i++){
    float n=0.5+(texture2D(dep,p).r-0.5)*rel;
    float k=0.12+n*0.95;
    p=foc+(uv-foc)/(1.0+t*k)-sway*(n-0.35);
  }
  float e=0.010;
  float g=abs(texture2D(dep,p+vec2(e,0.0)).r-texture2D(dep,p-vec2(e,0.0)).r)+abs(texture2D(dep,p+vec2(0.0,e)).r-texture2D(dep,p-vec2(0.0,e)).r);
  float w=1.0-smoothstep(0.05,0.22,g*rel)*0.75;
  p=mix(uv,p,w);
  if(fuera)return texture2D(img,clamp(bg,0.002,0.998),6.0).rgb*0.5;
  return texture2D(img,clamp(p,0.002,0.998)).rgb;
}
void main(){
  vec2 s=vec2(gl_FragCoord.x/uRes.x,1.0-gl_FragCoord.y/uRes.y);
  vec3 c=escena(uIA,uDA,uTA,uLA,uSwA,uRA,uFA,uAspA,s);
  if(uMix>0.002){vec3 b=escena(uIB,uDB,uTB,uLB,uSwB,uRB,uFB,uAspB,s);c=mix(c,b,uMix);}
  gl_FragColor=vec4(c,1.0);
}`;
const FOC = [0.5, 0.46];
const S0 = 0.216; // avance con el que una escena «llega» del fundido: la siguiente sigue desde ahí, sin saltos
const INI = 0.76, SPAN = 0.22; // el fundido ocupa el último cuarto de cada escena

const recorta = (t, n = 190) => {
  const s = String(t || '').trim().replace(/\s+/g, ' ');
  if (s.length <= n) return s;
  const corte = s.slice(0, n), p = Math.max(corte.lastIndexOf('. '), corte.lastIndexOf('? '), corte.lastIndexOf('! '));
  return p > 60 ? corte.slice(0, p + 1) : corte.replace(/\s+\S*$/, '') + '…';
};

export default function RecorridoEscenas({ escenas }) {
  const N = escenas.length;
  const outer = useRef(null), stage = useRef(null), cv = useRef(null), botones = useRef([]), zonaRef = useRef(null);
  const [fallo, setFallo] = useState(false);
  const [listo, setListo] = useState(false);
  const [act, setAct] = useState(0);
  const [abierto, setAbierto] = useState(null); // { e, i }
  const [entero, setEntero] = useState(true); // ver cada render completo (true) o rellenando la pantalla (false)
  const enteroRef = useRef(true), redibuja = useRef(null);
  enteroRef.current = entero;
  const datos = useRef(escenas); datos.current = escenas;

  useEffect(() => {
    setFallo(false); setListo(false);
    const el = cv.current, st = stage.current;
    if (!el || !st) return undefined;
    const gl2 = el.getContext('webgl2', { antialias: false, alpha: false });
    const gl = gl2 || el.getContext('webgl', { antialias: false, alpha: false }) || el.getContext('experimental-webgl');
    if (!gl) { setFallo(true); return undefined; }
    let muerto = false, raf = 0, ocupado = false, W = 0, H = 0, cur = 0, obj = 0, entra = 1, pr = null;
    // mirar un poco alrededor: el ratón (o la inclinación del móvil) y una respiración suave mueven la cámara, además del avance por profundidad
    const quieto = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let ptrX = 0, ptrY = 0, dragX = 0, dragY = 0, drag = null, lookX = 0, lookY = 0, viz = true;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    try {
      const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
      pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr);
    } catch { setFallo(true); return undefined; }
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = {}; ['uIA', 'uDA', 'uIB', 'uDB', 'uRes', 'uLook', 'uFit', 'uFA', 'uFB', 'uTA', 'uLA', 'uTB', 'uLB', 'uSwA', 'uSwB', 'uRA', 'uRB', 'uMix', 'uAspA', 'uAspB'].forEach(n => { U[n] = gl.getUniformLocation(pr, n); });
    gl.uniform1i(U.uIA, 0); gl.uniform1i(U.uDA, 1); gl.uniform1i(U.uIB, 2); gl.uniform1i(U.uDB, 3);
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048;
    // calidad máxima, cuidando la memoria: con varias escenas las texturas son algo más pequeñas y solo viven las cercanas
    const anchoImg = Math.min(maxTex, N > 2 ? 2800 : 3840, Math.max(2000, Math.round((st.clientWidth || 600) * DPR * 2)));
    const tex = []; const cargando = {}; const mapas = [];
    const textura = (c, mip) => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
      const conMip = !!(mip && gl2);
      if (conMip) gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, conMip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    const llano = () => { const c = document.createElement('canvas'); c.width = 4; c.height = 4; const x = c.getContext('2d'); x.fillStyle = '#808080'; x.fillRect(0, 0, 4, 4); return c; }; // render sin mapa de profundidad: todo a la misma distancia
    const asegura = (i) => {
      if (i < 0 || i >= N || tex[i] || cargando[i]) return;
      cargando[i] = true;
      const e = datos.current[i];
      Promise.all([cargaImg(e.src, anchoImg), e.prof ? cargaImg(e.prof, 1100) : Promise.resolve({ c: llano() })]).then(([a, d]) => {
        cargando[i] = false; if (muerto) return;
        if (e.prof) {
          const c = document.createElement('canvas'); c.width = 160; c.height = 113;
          const x = c.getContext('2d'); x.drawImage(d.c, 0, 0, 160, 113);
          const px = x.getImageData(0, 0, 160, 113).data, m = new Float32Array(160 * 113); for (let k = 0; k < m.length; k++) m[k] = px[k * 4] / 255;
          mapas[i] = m;
        }
        tex[i] = { img: textura(a.c, true), dep: textura(d.c, false), asp: a.w / a.h };
        setListo(true); tick();
      }).catch(() => { cargando[i] = false; if (i === 0 && !muerto) setFallo(true); });
    };
    const suelta = (i) => { if (tex[i]) { gl.deleteTexture(tex[i].img); gl.deleteTexture(tex[i].dep); tex[i] = null; } };
    const medida = () => { W = st.clientWidth; H = st.clientHeight; el.width = Math.round(W * DPR); el.height = Math.round(H * DPR); gl.viewport(0, 0, el.width, el.height); gl.uniform2f(U.uRes, el.width, el.height); };
    const lee = () => {
      const o = outer.current; if (!o) return;
      const r = o.getBoundingClientRect(), total = r.height - st.clientHeight;
      obj = (total > 0 ? Math.max(0, Math.min(1, -r.top / total)) : 0) * (N - 0.0001);
      viz = r.bottom > 0 && r.top < window.innerHeight && !document.hidden;
      entra = Math.max(0, Math.min(1, 1 - r.top / Math.max(1, st.clientHeight))); /* 0 = aún no se ve, 1 = ya está fijo en pantalla */
    };
    const nProf = (i, px, py) => { const m = mapas[i]; if (!m) return 0.4; const x = Math.max(0, Math.min(159, Math.round(px * 159))), y = Math.max(0, Math.min(112, Math.round(py * 112))); return m[y * 160 + x]; };
    const aPantalla = (i, x, y, t, lat, sw, rel) => {
      const fit = enteroRef.current;
      const lx = lookX, ly = lookY;
      const n = 0.5 + (nProf(i, x / 100, y / 100) - 0.5) * rel, k = 0.12 + n * 0.95, asp = tex[i] ? tex[i].asp : 1.5;
      const u = FOC[0] + (x / 100 + (sw * 0.012 - lat * 0.034 + lx * 0.022) * (n - 0.35) - FOC[0]) * (1 + t * k);
      const v = FOC[1] + (y / 100 + (sw * 0.004 + ly * 0.011) * (n - 0.35) - FOC[1]) * (1 + t * k);
      const va = W / H; let sx, sy;
      if (fit) { if (va < asp) { sx = u; sy = 0.5 + (v - 0.5) * (va / asp); } else { sx = 0.5 + (u - 0.5) * (asp / va); sy = v; } }
      else if (va < asp) { sx = 0.5 + (u - 0.5) / (va / asp); sy = v; } else { sx = u; sy = 0.5 + (v - 0.5) / (asp / va); }
      return { x: sx * W, y: sy * H };
    };
    // estado de cámara de una escena según su avance s (0..1.35)
    const estado = (e, s) => {
      const { dir, inten, relieve } = analizaMov(e.mov), k = inten / 75;
      const [t, lat] = estadoCamara(dir, s);
      return { t: t * k, lat: lat * k, sw: (dir === 'izq' || dir === 'dcha') ? 0 : Math.sin(s * 3.1) * k, rel: e.prof ? relieve / 100 : 0 };
    };
    let actual = -1;
    const dibuja = () => {
      ocupado = false; if (muerto) return;
      cur += (obj - cur) * 0.12; if (Math.abs(obj - cur) < 0.0004) cur = obj;
      if (!quieto) {
        const tt = performance.now() / 1000;
        if (!drag) { dragX *= 0.985; dragY *= 0.985; } // al soltar, vuelve despacio a su sitio
        const oX = ptrX + dragX + Math.sin(tt * 0.45) * 0.28, oY = ptrY + dragY + Math.sin(tt * 0.31 + 1) * 0.18;
        lookX += (oX - lookX) * 0.05; lookY += (oY - lookY) * 0.05;
      }
      gl.uniform2f(U.uLook, lookX, lookY);
      gl.uniform1f(U.uFit, enteroRef.current ? 1 : 0);
      const i = Math.min(N - 1, Math.floor(cur)), f = cur - i, ultima = i >= N - 1;
      // la escena avanza con el scroll; al final se funde con la siguiente, que ya empieza a moverse (movimiento continuo, sin saltos)
      const s0 = i > 0 ? S0 : 0, base = s0 + (1 - s0) * f;
      const sA = ultima ? Math.min(1, base) : Math.min(1.35, base + (f > INI ? (f - INI) * 0.9 : 0));
      let mix = 0; if (!ultima && f > INI) mix = Math.min(1, (f - INI) / SPAN); mix = mix * mix * (3 - 2 * mix);
      const sB = !ultima && mix > 0 ? Math.max(0, f - INI) * 0.9 : 0;
      asegura(i); asegura(i + 1); asegura(i - 1);
      for (let k = 0; k < N; k++) if (Math.abs(k - i) > 2) suelta(k);
      const A = tex[i], j = ultima ? i : i + 1, B = tex[j];
      const eA = estado(datos.current[i], sA), eB = estado(datos.current[j], sB);
      if (A) {
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, A.img); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, A.dep);
        const usaB = !!(B && !ultima && mix > 0.002);
        const BB = usaB ? B : A;
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, BB.img); gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, BB.dep);
        gl.uniform2f(U.uFA, FOC[0], FOC[1]); gl.uniform2f(U.uFB, FOC[0], FOC[1]);
        gl.uniform1f(U.uTA, eA.t); gl.uniform1f(U.uLA, eA.lat); gl.uniform1f(U.uSwA, eA.sw); gl.uniform1f(U.uRA, eA.rel); gl.uniform1f(U.uAspA, A.asp);
        gl.uniform1f(U.uTB, eB.t); gl.uniform1f(U.uLB, eB.lat); gl.uniform1f(U.uSwB, eB.sw); gl.uniform1f(U.uRB, eB.rel); gl.uniform1f(U.uAspB, BB.asp);
        gl.uniform1f(U.uMix, usaB ? mix : 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      const dom = mix > 0.5 ? j : i;
      if (dom !== actual) { actual = dom; setAct(dom); setAbierto(null); }
      // nombre de la zona: solo en la primera vista de cada zona; aparece al llegar a ella y se desvanece subiendo y desenfocándose
      const zr = zonaRef.current;
      if (zr) {
        const ed = datos.current[dom], sd = dom === i ? f : Math.max(0, f - INI) * 0.9;
        let op = 0, sale = 0;
        if (ed && ed.inicio) {
          sale = Math.max(0, Math.min(1, (sd - 0.36) / 0.4));
          op = Math.min(1, sd / 0.16) * (1 - sale);
          if (dom === 0) { const ent = entra * entra * (3 - 2 * entra); op = Math.min(1, ent) * (1 - sale); }
          if (mix > 0 && !ultima) op *= dom === j ? Math.max(0, 2 * mix - 1) : Math.max(0, 1 - 2 * mix); // cruce limpio entre el nombre que sale y el que entra
        }
        zr.style.opacity = op.toFixed(3);
        zr.style.transform = 'translateY(' + (-(Math.min(sd, 1) * 22)).toFixed(1) + 'px)';
        zr.style.filter = sale > 0.01 ? 'blur(' + (sale * 3).toFixed(1) + 'px)' : 'none';
      }
      // puntos tocables: los de la escena que se ve (y los de la siguiente al fundirse)
      datos.current.forEach((e, k) => {
        const lista = botones.current[k] || [];
        const visible = (k === i && mix < 0.4) || (k === j && !ultima && mix > 0.6);
        lista.forEach((b, n) => {
          if (!b) return;
          if (!visible || !tex[k]) { b.style.opacity = 0; b.style.pointerEvents = 'none'; return; }
          const p = (e.puntos || [])[n]; if (!p) return;
          const est = k === i ? eA : eB, q = aPantalla(k, p.x, p.y, est.t, est.lat, est.sw, est.rel);
          const dentro = q.x > 8 && q.x < W - 8 && q.y > 8 && q.y < H - 40;
          const op = k === i ? 1 - Math.max(0, (mix - 0.1) / 0.3) : Math.max(0, (mix - 0.6) / 0.3);
          b.style.transform = 'translate(' + q.x.toFixed(1) + 'px,' + q.y.toFixed(1) + 'px)';
          b.style.opacity = dentro ? Math.max(0, Math.min(1, op)) : 0; b.style.pointerEvents = dentro && op > 0.5 ? 'auto' : 'none';
        });
      });
      if (cur !== obj || (!quieto && viz)) pide();
    };
    const pide = () => { if (!ocupado && !muerto) { ocupado = true; raf = requestAnimationFrame(dibuja); } };
    redibuja.current = pide;
    const tick = () => { lee(); pide(); };
    const redim = () => { medida(); tick(); };
    medida(); asegura(0); asegura(1);
    // clic y arrastrar (ratón) o deslizar de lado (táctil) para mirar alrededor; deslizar hacia abajo sigue siendo pasar a la siguiente imagen
    st.style.touchAction = 'pan-y'; st.style.userSelect = 'none'; st.style.cursor = quieto ? '' : 'grab';
    const alBajar = (ev) => { if (quieto || (ev.pointerType === 'mouse' && ev.button !== 0) || ev.target.closest('button,a')) return; drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, bx: dragX, by: dragY }; st.style.cursor = 'grabbing'; try { st.setPointerCapture(ev.pointerId); } catch { /* sin captura */ } };
    const alMover = (ev) => { if (!drag || ev.pointerId !== drag.id) return; const w = Math.max(1, W); dragX = Math.max(-1.4, Math.min(1.4, drag.bx - (ev.clientX - drag.x) / w * 3)); dragY = Math.max(-1, Math.min(1, drag.by - (ev.clientY - drag.y) / Math.max(1, H) * 3)); pide(); };
    const alSoltar = (ev) => { if (drag && ev.pointerId === drag.id) { drag = null; st.style.cursor = 'grab'; } };
    const alGiro = (ev) => { if (ev.gamma == null || ev.beta == null) return; ptrX = Math.max(-1, Math.min(1, ev.gamma / 25)); ptrY = Math.max(-1, Math.min(1, (ev.beta - 50) / 25)); };
    const alVer = () => { lee(); pide(); };
    if (!quieto) { st.addEventListener('pointerdown', alBajar); st.addEventListener('pointermove', alMover); st.addEventListener('pointerup', alSoltar); st.addEventListener('pointercancel', alSoltar); window.addEventListener('deviceorientation', alGiro, { passive: true }); document.addEventListener('visibilitychange', alVer); }
    window.addEventListener('scroll', tick, { passive: true });
    window.addEventListener('resize', redim);
    return () => {
      muerto = true; cancelAnimationFrame(raf);
      window.removeEventListener('scroll', tick); window.removeEventListener('resize', redim);
      st.removeEventListener('pointerdown', alBajar); st.removeEventListener('pointermove', alMover); st.removeEventListener('pointerup', alSoltar); st.removeEventListener('pointercancel', alSoltar); window.removeEventListener('deviceorientation', alGiro); document.removeEventListener('visibilitychange', alVer);
      tex.forEach(t => { if (t) { gl.deleteTexture(t.img); gl.deleteTexture(t.dep); } });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [N, escenas.map(e => e.src + (e.prof || '')).join('|')]);

  if (fallo) {
    return <>{escenas.map((e, i) => <div className="rr-plano" key={i}><img src={e.src} alt={e.alt || ''} loading="lazy" /></div>)}</>;
  }
  const cap = escenas[act] || escenas[0], z = cap.zona;
  return (
    <div ref={outer} className="rr-track" style={N > 1 ? { height: (N * 115 + 90) + 'svh' } : undefined}>
      <div ref={stage} className="rr-stage" onClick={() => setAbierto(null)} role="img" aria-label={cap.alt || ''}>
        <canvas ref={cv} className="rr-cv" />
        <div className="rr-sombra" />
        {z && z.titulo && (
          <div ref={zonaRef} className="rr-zona" aria-hidden="true">
            {z.num && <span>Zona {z.num}</span>}
            <strong>{z.titulo}</strong>
            {cap.inicio && z.texto && <p>{recorta(z.texto, 105)}</p>}
          </div>
        )}
        {!listo && <img className="rr-previa" src={escenas[0].src} alt="" />}
        {escenas.map((e, k) => (e.puntos || []).map((p, n) => (
          <button key={k + '-' + n} ref={b => { (botones.current[k] = botones.current[k] || [])[n] = b; }} type="button" className={'rr-punto' + (abierto && abierto.i === k + '-' + n ? ' on' : '')} aria-label={p.titulo || 'Punto'}
            onClick={(ev) => { ev.stopPropagation(); setAbierto(abierto && abierto.i === k + '-' + n ? null : { e: p, i: k + '-' + n }); }}><i /></button>
        )))}
        {abierto && (abierto.e.titulo || abierto.e.texto) && (
          <div className="rr-ficha" role="status" onClick={ev => ev.stopPropagation()}>
            {abierto.e.titulo && <b>{abierto.e.titulo}</b>}
            {abierto.e.texto && <span>{abierto.e.texto}</span>}
            <button type="button" aria-label="Cerrar" onClick={() => setAbierto(null)}>×</button>
          </div>
        )}
        {N > 1 && (
          <div className="rr-prog" aria-hidden="true">{escenas.map((_, k) => <i key={k} className={k === act ? 'on' : ''} />)}</div>
        )}
        <button type="button" className="rr-fit" onClick={(ev) => { ev.stopPropagation(); setEntero(v => !v); setTimeout(() => redibuja.current && redibuja.current(), 0); }} title={entero ? 'Llenar toda la pantalla (se recortan los bordes)' : 'Ver cada render entero'}>{entero ? 'Llenar pantalla' : 'Ver entero'}</button>
        <div className="rr-pista" aria-hidden="true">{N > 1 ? 'Sigue deslizando: avanzas por el espacio' : 'Desliza para recorrer'}</div>
      </div>
    </div>
  );
}
