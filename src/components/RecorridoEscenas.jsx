import { useEffect, useRef, useState } from 'react';
import { analizaMov, estadoCamara, cargaImg } from './RenderRecorrido';
import './RenderRecorrido.css';

// Recorrido continuo: los renders de una zona se encadenan en un solo escenario fijo. Al deslizar, la cámara
// avanza por el primero y, sin parar, «entra» en el siguiente (fundido con el movimiento todavía en marcha),
// así se siente que uno se mueve por el espacio de una vista a otra. Si algo falla, se enseñan las imágenes sin más.

const VS = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
const FS = `
precision highp float;
uniform sampler2D uIA,uDA,uIB,uDB;
uniform vec2 uRes,uFA,uFB;
uniform float uTA,uLA,uTB,uLB,uSwA,uSwB,uRA,uRB,uMix,uAspA,uAspB;
vec3 escena(sampler2D img,sampler2D dep,float t,float lat,float sw,float rel,vec2 foc,float asp,vec2 s){
  float va=uRes.x/uRes.y;vec2 uv=s;
  if(va<asp)uv.x=0.5+(s.x-0.5)*(va/asp);else uv.y=0.5+(s.y-0.5)*(asp/va);
  vec2 p=uv;
  vec2 sway=vec2(sw*0.012-lat*0.034,sw*0.004);
  for(int i=0;i<10;i++){
    float n=0.5+(texture2D(dep,p).r-0.5)*rel;
    float k=0.12+n*0.95;
    p=foc+(uv-foc)/(1.0+t*k)-sway*(n-0.35);
  }
  float e=0.010;
  float g=abs(texture2D(dep,p+vec2(e,0.0)).r-texture2D(dep,p-vec2(e,0.0)).r)+abs(texture2D(dep,p+vec2(0.0,e)).r-texture2D(dep,p-vec2(0.0,e)).r);
  float w=1.0-smoothstep(0.05,0.22,g*rel)*0.75;
  p=mix(uv,p,w);
  return texture2D(img,clamp(p,0.002,0.998)).rgb;
}
void main(){
  vec2 s=vec2(gl_FragCoord.x/uRes.x,1.0-gl_FragCoord.y/uRes.y);
  vec3 c=escena(uIA,uDA,uTA,uLA,uSwA,uRA,uFA,uAspA,s);
  if(uMix>0.002){vec3 b=escena(uIB,uDB,uTB,uLB,uSwB,uRB,uFB,uAspB,s);c=mix(c,b,uMix);}
  gl_FragColor=vec4(c,1.0);
}`;
const FOC = [0.5, 0.46];

export default function RecorridoEscenas({ escenas, zona }) {
  const N = escenas.length;
  const outer = useRef(null), stage = useRef(null), cv = useRef(null), botones = useRef([]), zonaRef = useRef(null);
  const [fallo, setFallo] = useState(false);
  const [listo, setListo] = useState(false);
  const [act, setAct] = useState(0);
  const [abierto, setAbierto] = useState(null); // { e, i }
  const datos = useRef(escenas); datos.current = escenas;

  useEffect(() => {
    setFallo(false); setListo(false);
    const el = cv.current, st = stage.current;
    if (!el || !st) return undefined;
    const gl2 = el.getContext('webgl2', { antialias: false, alpha: false });
    const gl = gl2 || el.getContext('webgl', { antialias: false, alpha: false }) || el.getContext('experimental-webgl');
    if (!gl) { setFallo(true); return undefined; }
    let muerto = false, raf = 0, ocupado = false, W = 0, H = 0, cur = 0, obj = 0, entra = 1, pr = null;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    try {
      const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
      pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr);
    } catch { setFallo(true); return undefined; }
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = {}; ['uIA', 'uDA', 'uIB', 'uDB', 'uRes', 'uFA', 'uFB', 'uTA', 'uLA', 'uTB', 'uLB', 'uSwA', 'uSwB', 'uRA', 'uRB', 'uMix', 'uAspA', 'uAspB'].forEach(n => { U[n] = gl.getUniformLocation(pr, n); });
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
    const asegura = (i) => {
      if (i < 0 || i >= N || tex[i] || cargando[i]) return;
      cargando[i] = true;
      const e = datos.current[i];
      Promise.all([cargaImg(e.src, anchoImg), cargaImg(e.prof, 1100)]).then(([a, d]) => {
        cargando[i] = false; if (muerto) return;
        const c = document.createElement('canvas'); c.width = 160; c.height = 113;
        const x = c.getContext('2d'); x.drawImage(d.c, 0, 0, 160, 113);
        const px = x.getImageData(0, 0, 160, 113).data, m = new Float32Array(160 * 113); for (let k = 0; k < m.length; k++) m[k] = px[k * 4] / 255;
        mapas[i] = m;
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
      entra = Math.max(0, Math.min(1, 1 - r.top / Math.max(1, st.clientHeight))); /* 0 = aún no se ve, 1 = ya está fijo en pantalla */
    };
    const nProf = (i, px, py) => { const m = mapas[i]; if (!m) return 0.4; const x = Math.max(0, Math.min(159, Math.round(px * 159))), y = Math.max(0, Math.min(112, Math.round(py * 112))); return m[y * 160 + x]; };
    const aPantalla = (i, x, y, t, lat, sw, rel) => {
      const n = 0.5 + (nProf(i, x / 100, y / 100) - 0.5) * rel, k = 0.12 + n * 0.95, asp = tex[i] ? tex[i].asp : 1.5;
      let u = FOC[0] + (x / 100 + (sw * 0.012 - lat * 0.034) * (n - 0.35) - FOC[0]) * (1 + t * k);
      let v = FOC[1] + (y / 100 + sw * 0.004 * (n - 0.35) - FOC[1]) * (1 + t * k);
      const va = W / H; let sx, sy;
      if (va < asp) { sx = 0.5 + (u - 0.5) / (va / asp); sy = v; } else { sx = u; sy = 0.5 + (v - 0.5) / (asp / va); }
      return { x: sx * W, y: sy * H };
    };
    // estado de cámara de una escena según su avance s (0..1.35)
    const estado = (e, s) => {
      const { dir, inten, relieve } = analizaMov(e.mov), k = inten / 75;
      const [t, lat] = estadoCamara(dir, s);
      return { t: t * k, lat: lat * k, sw: (dir === 'izq' || dir === 'dcha') ? 0 : Math.sin(s * 3.1) * k, rel: relieve / 100 };
    };
    let actual = -1;
    const dibuja = () => {
      ocupado = false; if (muerto) return;
      cur += (obj - cur) * 0.12; if (Math.abs(obj - cur) < 0.0004) cur = obj;
      // nombre de la zona: aparece al entrar en el recorrido y se va desvaneciendo (subiendo y desenfocándose) al avanzar por la primera vista
      const zr = zonaRef.current;
      if (zr) {
        const sale = Math.max(0, Math.min(1, (cur - 0.32) / 0.4)), ent = entra * entra * (3 - 2 * entra);
        zr.style.opacity = (ent * (1 - sale)).toFixed(3);
        zr.style.transform = 'translateY(' + (-(cur * 70) + (1 - ent) * 40).toFixed(1) + 'px) scale(' + (1 + Math.min(cur, 1) * 0.08).toFixed(3) + ')';
        zr.style.filter = sale > 0.01 ? 'blur(' + (sale * 7).toFixed(1) + 'px)' : 'none';
      }
      const i = Math.min(N - 1, Math.floor(cur)), f = cur - i, ultima = i >= N - 1;
      // la escena avanza con el scroll; al final se funde con la siguiente, que ya empieza a moverse (movimiento continuo)
      const sA = ultima ? Math.min(1, f) : Math.min(1.35, f + (f > 0.76 ? (f - 0.76) * 0.9 : 0));
      let mix = 0; if (!ultima && f > 0.76) mix = Math.min(1, (f - 0.76) / 0.22); mix = mix * mix * (3 - 2 * mix);
      const sB = !ultima && mix > 0 ? Math.max(0, f - 0.76) * 0.9 : 0;
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
      // puntos tocables: los de la escena que se ve (y los de la siguiente al fundirse)
      const dom = mix > 0.5 ? j : i;
      if (dom !== actual) { actual = dom; setAct(dom); setAbierto(null); }
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
      if (cur !== obj) pide();
    };
    const pide = () => { if (!ocupado && !muerto) { ocupado = true; raf = requestAnimationFrame(dibuja); } };
    const tick = () => { lee(); pide(); };
    const redim = () => { medida(); tick(); };
    medida(); asegura(0); asegura(1);
    window.addEventListener('scroll', tick, { passive: true });
    window.addEventListener('resize', redim);
    return () => {
      muerto = true; cancelAnimationFrame(raf);
      window.removeEventListener('scroll', tick); window.removeEventListener('resize', redim);
      tex.forEach(t => { if (t) { gl.deleteTexture(t.img); gl.deleteTexture(t.dep); } });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [N, escenas.map(e => e.src + e.prof).join('|')]);

  if (fallo) {
    return <>{escenas.map((e, i) => <div className="rr-plano" key={i}><img src={e.src} alt={e.alt || ''} loading="lazy" /></div>)}</>;
  }
  const cap = escenas[act] || escenas[0];
  return (
    <div ref={outer} className="rr-track" style={N > 1 ? { height: (N * 125 + 90) + 'svh' } : undefined}>
      <div ref={stage} className="rr-stage" onClick={() => setAbierto(null)} role="img" aria-label={cap.alt || ''}>
        <canvas ref={cv} className="rr-cv" />
        <div className="rr-sombra" />
        {zona && zona.titulo && (
          <div ref={zonaRef} className="rr-zona" aria-hidden="true">
            {zona.num && <span>Zona {zona.num}</span>}
            <strong>{zona.titulo}</strong>
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
        <div className="rr-pista" aria-hidden="true">{N > 1 ? 'Sigue deslizando: avanzas por el espacio' : 'Desliza para recorrer'}</div>
      </div>
    </div>
  );
}
