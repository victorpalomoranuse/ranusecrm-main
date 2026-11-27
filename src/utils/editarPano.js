// Editar un panorama 360° con IA: se saca como foto normal la parte que se está mirando, se edita en el editor de siempre
// y la foto editada se vuelve a encajar dentro del panorama (solo donde ha cambiado, con los bordes fundidos).
// Convención de direcciones = la de la esfera del visor 360 (SphereGeometry volteada en X):
//   columna u (0..1) y fila y (0 = arriba) → (cos(2πu)·sin(πy), cos(πy), sin(2πu)·sin(πy))
import * as THREE from 'three';

const carga = src => new Promise((ok, ko) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = () => ko(new Error('No se pudo cargar la imagen')); i.src = src; });

const camaraVista = (lon, lat, fov, aspecto) => {
  const cam = new THREE.PerspectiveCamera(fov, aspecto, 0.1, 1100);
  cam.position.set(0, 0, 0);
  cam.lookAt(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
  cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
  return cam;
};

const lienzo = (W, H) => {
  const r = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  r.setPixelRatio(1); r.setSize(W, H, false);
  r.outputColorSpace = THREE.LinearSRGBColorSpace; r.toneMapping = THREE.NoToneMapping; // los colores pasan tal cual
  return r;
};
const suelta = r => { try { r.dispose(); r.forceContextLoss(); } catch { /* nada */ } };
const textura = (img, mip) => { const t = new THREE.Texture(img); t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = !!mip; t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t; };

// La foto de lo que se mira (lon/lat en radianes, fov vertical en grados)
export async function vistaDePano(url, lon, lat, fov, W, H) {
  const img = await carga(url), r = lienzo(W, H);
  try {
    const tex = textura(img, true); tex.anisotropy = r.capabilities.getMaxAnisotropy();
    const g = new THREE.SphereGeometry(500, 128, 80); g.scale(-1, 1, 1);
    const sc = new THREE.Scene(); sc.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex })));
    r.render(sc, camaraVista(lon, lat, fov, W / H));
    const out = r.domElement.toDataURL('image/jpeg', 0.95);
    g.dispose(); tex.dispose();
    return out;
  } finally { suelta(r); }
}

// Máscara de lo que ha cambiado entre la foto original y la editada (blanco = cambia); si cambia casi todo, se toma la foto entera
function mascaraCambio(a0, b0) {
  const w = 384, h = Math.max(8, Math.round(384 * a0.naturalHeight / a0.naturalWidth));
  const lee = im => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.filter = 'blur(1.5px)'; g.drawImage(im, 0, 0, w, h); return g.getImageData(0, 0, w, h).data; };
  const a = lee(a0), b = lee(b0), n = w * h, med = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) med[c] += (b[i * 4 + c] - a[i * 4 + c]) / n;
  let m = new Uint8Array(n), cambiados = 0;
  for (let i = 0; i < n; i++) { let d = 0; for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(b[i * 4 + c] - a[i * 4 + c] - med[c])); m[i] = d > 22 ? 1 : 0; cambiados += m[i]; }
  const todo = cambiados / n > 0.55;
  if (!todo) for (let it = 0; it < 5; it++) { const m2 = m.slice(); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (m[y * w + x]) continue; if ((x > 0 && m[y * w + x - 1]) || (x < w - 1 && m[y * w + x + 1]) || (y > 0 && m[(y - 1) * w + x]) || (y < h - 1 && m[(y + 1) * w + x])) m2[y * w + x] = 1; } m = m2; }
  const pc = document.createElement('canvas'); pc.width = w; pc.height = h; const gp = pc.getContext('2d'), id = gp.createImageData(w, h);
  for (let i = 0; i < n; i++) { const v = todo || m[i] ? 255 : 0; id.data[i * 4] = v; id.data[i * 4 + 1] = v; id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
  gp.putImageData(id, 0, 0);
  const out = document.createElement('canvas'); out.width = 768; out.height = Math.round(768 * h / w); const go = out.getContext('2d');
  go.fillStyle = '#000'; go.fillRect(0, 0, out.width, out.height); go.filter = 'blur(5px)'; go.drawImage(pc, 0, 0, out.width, out.height);
  return { canvas: out, cambiados: todo ? 1 : cambiados / n };
}

// Vuelve a meter la foto editada en el panorama. Devuelve un JPEG del mismo tamaño que el panorama.
export async function pegaEnPano(panoUrl, vistaOrig, vistaNueva, lon, lat, fov, W, H) {
  const [pano, a0, b0] = await Promise.all([carga(panoUrl), carga(vistaOrig), carga(vistaNueva)]);
  const mk = mascaraCambio(a0, b0);
  if (mk.cambiados < 0.0005) throw new Error('la foto no tiene cambios');
  const PW = pano.naturalWidth, PH = pano.naturalHeight, r = lienzo(PW, PH);
  try {
    const cam = camaraVista(lon, lat, fov, W / H);
    const tP = textura(pano, false), tV = textura(b0, false), tM = new THREE.CanvasTexture(mk.canvas); tM.colorSpace = THREE.NoColorSpace; tM.generateMipmaps = false; tM.minFilter = THREE.LinearFilter;
    const mat = new THREE.ShaderMaterial({
      uniforms: { tP: { value: tP }, tV: { value: tV }, tM: { value: tM }, vista: { value: cam.matrixWorldInverse.clone() }, proy: { value: cam.projectionMatrix.clone() } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D tP, tV, tM; uniform mat4 vista, proy; varying vec2 vUv;
        void main(){
          vec4 base = texture2D(tP, vUv);
          float th = 3.14159265 * (1.0 - vUv.y), ph = 6.28318531 * vUv.x;
          vec3 d = vec3(cos(ph) * sin(th), cos(th), sin(ph) * sin(th));
          vec4 p = vista * vec4(d, 0.0);
          if (p.z > -0.01) { gl_FragColor = base; return; }
          vec4 c = proy * vec4(p.xyz, 1.0); vec2 n = c.xy / c.w;
          if (abs(n.x) >= 1.0 || abs(n.y) >= 1.0) { gl_FragColor = base; return; }
          vec2 t = n * 0.5 + 0.5;
          float borde = smoothstep(0.0, 0.1, 1.0 - abs(n.x)) * smoothstep(0.0, 0.1, 1.0 - abs(n.y));
          float m = texture2D(tM, t).r * borde;
          gl_FragColor = vec4(mix(base.rgb, texture2D(tV, t).rgb, m), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    const g = new THREE.PlaneGeometry(2, 2), sc = new THREE.Scene(); sc.add(new THREE.Mesh(g, mat));
    r.render(sc, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
    const out = r.domElement.toDataURL('image/jpeg', 0.92);
    g.dispose(); mat.dispose(); tP.dispose(); tV.dispose(); tM.dispose();
    return out;
  } finally { suelta(r); }
}
