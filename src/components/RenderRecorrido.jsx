import { useEffect, useRef, useState } from 'react';
import './RenderRecorrido.css';

// Render con sensación de recorrido: a la imagen se le asocia un mapa de profundidad y, al avanzar el
// progreso (con el scroll en el portal, con un deslizador en el editor), cada píxel se mueve según lo
// cerca que esté, como si la cámara caminara por el espacio. Si algo falla (sin WebGL, imagen sin CORS…)
// se enseña el render normal, nunca un hueco.

export const MOVIMIENTOS = [
  { id: 'adelante', label: 'Avanzar', icono: '▲' },
  { id: 'atras', label: 'Retroceder', icono: '▼' },
  { id: 'izq', label: 'Hacia la izquierda', icono: '◀' },
  { id: 'dcha', label: 'Hacia la derecha', icono: '▶' },
];

const VS = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
const FS = `
precision highp float;
uniform sampler2D uI,uD;
uniform vec2 uRes,uF;uniform float uT,uL,uAsp,uSw,uR;
void main(){
  vec2 s=vec2(gl_FragCoord.x/uRes.x,1.0-gl_FragCoord.y/uRes.y);
  float va=uRes.x/uRes.y;vec2 uv=s;
  if(va<uAsp)uv.x=0.5+(s.x-0.5)*(va/uAsp);else uv.y=0.5+(s.y-0.5)*(uAsp/va);
  vec2 p=uv;
  vec2 sway=vec2(uSw*0.012-uL*0.034,uSw*0.004);
  for(int i=0;i<10;i++){
    float n=0.5+(texture2D(uD,p).r-0.5)*uR; /* uR = relieve: 0 mueve todo igual (sin deformar), 1 usa toda la profundidad */
    float k=0.12+n*0.95;
    p=uF+(uv-uF)/(1.0+uT*k)-sway*(n-0.35);
  }
  float e=0.010;
  float g=abs(texture2D(uD,p+vec2(e,0.0)).r-texture2D(uD,p-vec2(e,0.0)).r)+abs(texture2D(uD,p+vec2(0.0,e)).r-texture2D(uD,p-vec2(0.0,e)).r);
  float w=1.0-smoothstep(0.05,0.22,g*uR)*0.75;
  p=mix(uv,p,w);
  gl_FragColor=vec4(texture2D(uI,clamp(p,0.002,0.998)).rgb,1.0);
}`;

// el movimiento se guarda como «dirección:intensidad:relieve». Intensidad 10-100 (normal 75); relieve 0-100 (normal 35: 0 = solo se mueve la cámara, sin deformar los objetos)
export function analizaMov(m) {
  const [d, i, r] = String(m || 'adelante').split(':');
  const dir = ['adelante', 'atras', 'izq', 'dcha'].includes(d) ? d : 'adelante';
  const n = Number(i), q = r === undefined || r === '' ? NaN : Number(r);
  return { dir, inten: n >= 10 && n <= 100 ? n : 75, relieve: q >= 0 && q <= 100 ? q : 35 };
}

// estado de la cámara (avance, desplazamiento lateral) según el movimiento y el progreso 0..1
export function estadoCamara(dir, s) {
  const q = Math.max(0, Math.min(1, s));
  if (dir === 'atras') return [0.77 * (1 - q), 0];
  if (dir === 'dcha') return [0.28, -1 + 2 * q];
  if (dir === 'izq') return [0.28, 1 - 2 * q];
  return [0.77 * q, 0];
}

function cargaImg(url, ancho) {
  return new Promise((ok, ko) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => {
      const k = Math.min(1, ancho / im.naturalWidth), c = document.createElement('canvas');
      c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
      const cx = c.getContext('2d'); cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
      cx.drawImage(im, 0, 0, c.width, c.height);
      ok({ c, w: im.naturalWidth, h: im.naturalHeight });
    };
    im.onerror = () => ko(new Error('imagen'));
    im.src = url;
  });
}

/**
 * modo 'scroll'  → el portal del cliente: sección alta, el progreso sale del scroll.
 * modo 'editor'  → vista previa del admin: caja fija, el progreso llega por la prop `progreso` (0..1).
 * puntos: [{x,y,titulo,texto}] en % de la imagen. colocar: al pulsar la imagen avisa con onColocar({x,y}).
 */
export default function RenderRecorrido({ src, prof, mov = 'adelante', puntos = [], alt = '', modo = 'scroll', progreso = 0, colocar = false, onColocar, altura }) {
  const outer = useRef(null), stage = useRef(null), cv = useRef(null);
  const botones = useRef([]);
  const vivo = useRef({ mov, puntos, progreso, colocar });
  const [fallo, setFallo] = useState(false);
  const [listo, setListo] = useState(false);
  const [abierto, setAbierto] = useState(null);
  vivo.current = { mov, puntos, progreso, colocar, rel: analizaMov(mov).relieve / 100 };

  useEffect(() => {
    setFallo(false); setListo(false);
    const el = cv.current, st = stage.current;
    if (!el || !st) return undefined;
    const gl2 = el.getContext('webgl2', { antialias: false, alpha: false });
    const gl = gl2 || el.getContext('webgl', { antialias: false, alpha: false }) || el.getContext('experimental-webgl');
    if (!gl) { setFallo(true); return undefined; }
    let muerto = false, raf = 0, ocupado = false, W = 0, H = 0, cur = 0, obj = 0, asp = 1.5, prog = null, tex = [], progSh = null;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    try {
      const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
      progSh = gl.createProgram(); gl.attachShader(progSh, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(progSh, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(progSh); gl.useProgram(progSh);
    } catch { setFallo(true); return undefined; }
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(progSh, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = {}; ['uI', 'uD', 'uRes', 'uF', 'uT', 'uL', 'uAsp', 'uSw', 'uR'].forEach(n => { U[n] = gl.getUniformLocation(progSh, n); });
    gl.uniform1i(U.uI, 0); gl.uniform1i(U.uD, 1);
    const textura = (c, mip) => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
      const conMip = !!(mip && gl2); // con WebGL2 se generan mipmaps (imagen nítida al reducirla, sin brillos ni dientes de sierra)
      if (conMip) gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, conMip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      tex.push(t); return t;
    };
    let tI = null, tD = null, mapa = null;
    const medida = () => {
      W = st.clientWidth; H = st.clientHeight;
      el.width = Math.round(W * DPR); el.height = Math.round(H * DPR);
      gl.viewport(0, 0, el.width, el.height); gl.uniform2f(U.uRes, el.width, el.height);
    };
    const nProf = (px, py) => {
      if (!mapa) return 0.4;
      const x = Math.max(0, Math.min(159, Math.round(px * 159))), y = Math.max(0, Math.min(112, Math.round(py * 112)));
      return mapa[y * 160 + x];
    };
    const FOC = [0.5, 0.46];
    const aPantalla = (x, y, t, lat, sw) => {
      const n = 0.5 + (nProf(x / 100, y / 100) - 0.5) * vivo.current.rel, k = 0.12 + n * 0.95;
      let u = x / 100, v = y / 100;
      u = FOC[0] + (u + (sw * 0.012 - lat * 0.034) * (n - 0.35) - FOC[0]) * (1 + t * k);
      v = FOC[1] + (v + sw * 0.004 * (n - 0.35) - FOC[1]) * (1 + t * k);
      const va = W / H; let sx, sy;
      if (va < asp) { sx = 0.5 + (u - 0.5) / (va / asp); sy = v; } else { sx = u; sy = 0.5 + (v - 0.5) / (asp / va); }
      return { x: sx * W, y: sy * H };
    };
    const lee = () => {
      const v = vivo.current;
      if (modo === 'editor') { obj = v.colocar ? 0 : Math.max(0, Math.min(1, v.progreso)); return; }
      const o = outer.current; if (!o) return;
      const r = o.getBoundingClientRect(), total = r.height - st.clientHeight;
      obj = total > 0 ? Math.max(0, Math.min(1, -r.top / total)) : 0;
    };
    const dibuja = () => {
      ocupado = false; if (muerto || !tI) return;
      const v = vivo.current;
      cur += (obj - cur) * 0.14; if (Math.abs(obj - cur) < 0.0004) cur = obj;
      const neutro = modo === 'editor' && v.colocar; // «colocando puntos»: imagen sin mover
      const { dir, inten, relieve } = analizaMov(v.mov), k = inten / 75, rel = relieve / 100; /* 75 = lo normal */
      const [t0, lat0] = neutro ? [0, 0] : estadoCamara(dir, cur);
      const t = t0 * k, lat = lat0 * k;
      const sw = neutro || dir === 'izq' || dir === 'dcha' ? 0 : Math.sin(cur * 3.1) * k;
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tI); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tD);
      gl.uniform2f(U.uF, FOC[0], FOC[1]); gl.uniform1f(U.uT, t); gl.uniform1f(U.uL, lat); gl.uniform1f(U.uAsp, asp); gl.uniform1f(U.uSw, sw); gl.uniform1f(U.uR, rel);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      (v.puntos || []).forEach((p, i) => {
        const b = botones.current[i]; if (!b) return;
        const q = aPantalla(p.x, p.y, t, lat, sw);
        const dentro = q.x > 8 && q.x < W - 8 && q.y > 8 && q.y < H - 8;
        b.style.transform = `translate(${q.x.toFixed(1)}px,${q.y.toFixed(1)}px)`;
        b.style.opacity = dentro ? 1 : 0; b.style.pointerEvents = dentro ? 'auto' : 'none';
      });
      if (cur !== obj) pide();
    };
    const pide = () => { if (!ocupado && !muerto) { ocupado = true; raf = requestAnimationFrame(dibuja); } };
    const tick = () => { lee(); pide(); };
    const redim = () => { medida(); tick(); };
    medida();
    // calidad máxima: la textura es tan grande como lo permita el dispositivo (hasta 3840 px) y como pida la pantalla
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048;
    const anchoImg = Math.min(maxTex, 3840, Math.max(2000, Math.round((st.clientWidth || 600) * DPR * 2)));
    Promise.all([cargaImg(src, anchoImg), cargaImg(prof, 1100)]).then(([a, d]) => {
      if (muerto) return;
      tI = textura(a.c, true); tD = textura(d.c, false); asp = a.w / a.h; st.dataset.asp = String(asp);
      const c = document.createElement('canvas'); c.width = 160; c.height = 113;
      const x = c.getContext('2d'); x.drawImage(d.c, 0, 0, 160, 113);
      const px = x.getImageData(0, 0, 160, 113).data; mapa = new Float32Array(160 * 113);
      for (let k = 0; k < mapa.length; k++) mapa[k] = px[k * 4] / 255;
      setListo(true); tick();
    }).catch(() => { if (!muerto) setFallo(true); });
    window.addEventListener('scroll', tick, { passive: true });
    window.addEventListener('resize', redim);
    st.__tick = tick; // el editor avisa de cambios de progreso o movimiento
    return () => {
      muerto = true; cancelAnimationFrame(raf);
      window.removeEventListener('scroll', tick); window.removeEventListener('resize', redim);
      tex.forEach(t => gl.deleteTexture(t));
    };
  }, [src, prof, modo]);

  // cambios de progreso / movimiento / puntos en el editor
  useEffect(() => { stage.current?.__tick?.(); }, [progreso, mov, puntos, colocar, listo]);

  if (fallo) {
    return <div className="rr-plano"><img src={src} alt={alt} loading="lazy" /></div>;
  }

  const pulsar = (e) => {
    if (!colocar || !onColocar || !stage.current) return;
    const r = stage.current.getBoundingClientRect(), W = r.width, H = r.height;
    // la imagen está en modo «cover»: se convierte el punto pulsado a % de la imagen
    const asp = stage.current.dataset.asp ? Number(stage.current.dataset.asp) : 1.5, va = W / H;
    let u = (e.clientX - r.left) / W, v = (e.clientY - r.top) / H;
    if (va < asp) u = 0.5 + (u - 0.5) * (va / asp); else v = 0.5 + (v - 0.5) * (asp / va);
    onColocar({ x: Math.round(u * 1000) / 10, y: Math.round(v * 1000) / 10 });
  };

  const escena = (
    <div ref={stage} className={`rr-stage${modo === 'editor' ? ' rr-edit' : ''}${colocar ? ' rr-colocar' : ''}`} style={modo === 'editor' ? { height: altura || 420 } : undefined} onClick={(e) => { pulsar(e); if (!colocar) setAbierto(null); }} role="img" aria-label={alt}>
      <canvas ref={cv} className="rr-cv" />
      <div className="rr-sombra" />
      {!listo && <img className="rr-previa" src={src} alt="" />}
      {puntos.map((p, i) => (
        <button key={i} ref={el => { botones.current[i] = el; }} type="button" className={`rr-punto${abierto === i ? ' on' : ''}`} aria-label={p.titulo || `Punto ${i + 1}`}
          onClick={(e) => { e.stopPropagation(); if (!colocar) setAbierto(abierto === i ? null : i); }}><i /></button>
      ))}
      {abierto != null && puntos[abierto] && (puntos[abierto].titulo || puntos[abierto].texto) && (
        <div className="rr-ficha" role="status" onClick={e => e.stopPropagation()}>
          {puntos[abierto].titulo && <b>{puntos[abierto].titulo}</b>}
          {puntos[abierto].texto && <span>{puntos[abierto].texto}</span>}
          <button type="button" aria-label="Cerrar" onClick={() => setAbierto(null)}>×</button>
        </div>
      )}
      {modo === 'scroll' && <div className="rr-pista" aria-hidden="true">Desliza para recorrer</div>}
    </div>
  );

  if (modo === 'editor') return escena;
  return <div ref={outer} className="rr-track">{escena}</div>;
}
