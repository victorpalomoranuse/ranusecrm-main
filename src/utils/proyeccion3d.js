import * as THREE from 'three';

// Proyección de renders sobre el modelo 3D («proyector de diapositivas»): cada render final se pega al modelo desde la cámara con la que se hizo.
// Al sacar un panorama 360° desde cualquier punto, lo que cubre un render lleva SUS píxeles (ya mejorados con IA) y lo que no cubre ninguno
// sale del propio modelo. No se inventa nada: solo se reparte lo que ya existe. Cada render solo se pega donde su cámara lo veía
// (se comprueba con un mapa de profundidad), de frente y con borde suave, y si varios cubren el mismo sitio se mezclan.
// Hasta 12 renders: todos van en UN mosaico de imágenes y UN mosaico de profundidades, así no se agotan las texturas de la tarjeta gráfica.
export const MAX_REFS = 12;
const DEFECTO = { fuerza: 0.97, sesgo: 0.04, cercaMin: 0.12, cercaMax: 0.45 };
const TW = 1024, TH = 640, LEJOS = 100; // tamaño de cada hueco del mosaico y distancia máxima que guarda el mapa de profundidad (m)

// Cámara de un render: la misma proyección que usó el visor (apertura vertical, desplazamiento vertical de la lente y proporción de la imagen)
export function camaraDeRender(meta, aspecto) {
  const c = meta?.camara; if (!c || !Number.isFinite(c.px)) return null;
  const cam = new THREE.PerspectiveCamera(c.fov > 5 && c.fov < 140 ? c.fov : 50, aspecto || 16 / 9, 0.1, 400);
  cam.position.set(c.px, c.py, c.pz); cam.lookAt(c.tx ?? c.px, c.ty ?? c.py, c.tz ?? c.pz + 1);
  cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
  const s = Number(meta.shift) || 0; if (s) { cam.projectionMatrix.elements[9] += 2 * s; cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert(); }
  return cam;
}

// Reparto del mosaico: columnas y filas para n huecos, y el rectángulo de cada uno en coordenadas de textura (origen abajo a la izquierda)
export function disposicionMosaico(n) {
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4, filas = Math.ceil(n / cols), W = cols * TW, H = filas * TH;
  const huecos = Array.from({ length: n }, (_, k) => { const c = k % cols, f = Math.floor(k / cols); return { px: c * TW, py: H - (f + 1) * TH, tile: [c * TW / W, 1 - (f + 1) * TH / H, TW / W, TH / H] }; });
  return { cols, filas, W, H, huecos };
}

const hijoOculto = (scene, ocultar) => {
  const ocultos = [];
  ocultar.forEach(o => { if (o) { ocultos.push([o, o.visible]); o.visible = false; } });
  scene.traverse(o => { if (o.isMesh && o.visible && [].concat(o.material).some(m => m && m.transparent && m.opacity < 0.98)) { ocultos.push([o, true]); o.visible = false; } }); // los cristales no tapan
  return () => ocultos.forEach(([o, v]) => { o.visible = v; });
};

// Dibuja en cada hueco del mosaico de profundidades lo que ve la cámara de cada render (distancia, empaquetada en 2 canales de 8 bits)
function mosaicoProfundidad(renderer, scene, cams, ocultar, d) {
  const rt = new THREE.WebGLRenderTarget(d.W, d.H, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, depthBuffer: false });
  const previo = renderer.getRenderTarget(), bg = scene.background, fog = scene.fog, auto = renderer.autoClear, vp = new THREE.Vector4(), sc = new THREE.Vector4(), scT = renderer.getScissorTest();
  renderer.getViewport(vp); renderer.getScissor(sc);
  const restaura = hijoOculto(scene, ocultar); scene.background = null; scene.fog = null;
  const copia = new THREE.ShaderMaterial({
    uniforms: { tDepth: { value: null }, nf: { value: new THREE.Vector2() } }, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform sampler2D tDepth; uniform vec2 nf; varying vec2 vUv;
      void main() { float dd = texture2D(tDepth, vUv).r; float dl = nf.x * nf.y / (nf.y - dd * (nf.y - nf.x));
        float v = clamp(dl / ${LEJOS.toFixed(1)}, 0.0, 1.0) * 65535.0; float hi = floor(v / 256.0); float lo = floor(v - hi * 256.0);
        gl_FragColor = vec4(hi / 255.0, lo / 255.0, 0.0, 1.0); }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copia), qs = new THREE.Scene(), oc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); qs.add(quad);
  renderer.autoClear = false; renderer.setRenderTarget(rt); renderer.setClearColor(0xffffff, 1); renderer.clear(); // 1.0 = «muy lejos»
  cams.forEach((cam, k) => {
    const w = Math.min(1024, Math.round(1024 * Math.min(1, cam.aspect))), h = Math.round(w / cam.aspect);
    const dt = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
    dt.depthTexture = new THREE.DepthTexture(w, h); dt.depthTexture.type = THREE.UnsignedIntType;
    renderer.setRenderTarget(dt); renderer.setScissorTest(false); renderer.setViewport(0, 0, w, h); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(scene, cam);
    const h2 = d.huecos[k]; renderer.setRenderTarget(rt); renderer.setViewport(h2.px, h2.py, TW, TH); renderer.setScissor(h2.px, h2.py, TW, TH); renderer.setScissorTest(true);
    copia.uniforms.tDepth.value = dt.depthTexture; copia.uniforms.nf.value.set(cam.near, cam.far); renderer.render(qs, oc);
    dt.depthTexture.dispose(); dt.dispose();
  });
  renderer.setScissorTest(scT); renderer.setScissor(sc); renderer.setViewport(vp); renderer.setRenderTarget(previo); renderer.autoClear = auto;
  scene.background = bg; scene.fog = fog; restaura(); quad.geometry.dispose(); copia.dispose();
  return rt;
}

// Mosaico de imágenes: cada render, ajustado a su hueco (al muestrear con coordenadas normalizadas el estirado se deshace solo)
function mosaicoImagenes(refs, d) {
  const cv = document.createElement('canvas'); cv.width = d.W; cv.height = d.H; const x = cv.getContext('2d');
  refs.forEach((r, k) => { const h = d.huecos[k]; x.drawImage(r.textura.image, h.px, d.H - h.py - TH, TW, TH); });
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.NoColorSpace; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
}

const MATERIALES = ['isMeshStandardMaterial', 'isMeshPhysicalMaterial', 'isMeshBasicMaterial', 'isMeshLambertMaterial', 'isMeshPhongMaterial'];

// refs: [{ meta, textura (THREE.Texture), aspecto }] (hasta 12). Devuelve { n, aplicar(), quitar() }.
export function crearProyeccion(renderer, scene, refs, ocultar = [], opciones = {}) {
  const op = { ...DEFECTO, ...opciones }, lista = refs.slice(0, MAX_REFS).map(r => ({ ...r, cam: camaraDeRender(r.meta, r.aspecto) })).filter(r => r.cam && r.textura && r.textura.image);
  if (!lista.length) throw new Error('Ningún render tiene cámara guardada');
  const N = lista.length, d = disposicionMosaico(N), rtD = mosaicoProfundidad(renderer, scene, lista.map(r => r.cam), ocultar, d), atlas = mosaicoImagenes(lista, d);
  const U = {
    pvFuerza: { value: op.fuerza }, pvAtlas: { value: atlas }, pvAtlasD: { value: rtD.texture },
    pvM: { value: lista.map(r => new THREE.Matrix4().multiplyMatrices(r.cam.projectionMatrix, r.cam.matrixWorldInverse)) },
    pvP: { value: lista.map(r => r.cam.position.clone()) }, pvTile: { value: d.huecos.map(h => new THREE.Vector4(...h.tile)) },
  };
  const vertex = (s) => s.replace('#include <common>', '#include <common>\nvarying vec3 vPW; varying vec3 vPN;').replace('#include <project_vertex>', '#include <project_vertex>\n  vPW = (modelMatrix * vec4(transformed, 1.0)).xyz; vPN = length(normal) > 0.0 ? normalize(mat3(modelMatrix) * normal) : vec3(0.0, 1.0, 0.0);');
  const fragment = (s) => s.replace('#include <common>', `#include <common>
#define PV_N ${N}
varying vec3 vPW; varying vec3 vPN; uniform float pvFuerza;
uniform mat4 pvM[PV_N]; uniform vec3 pvP[PV_N]; uniform vec4 pvTile[PV_N]; uniform sampler2D pvAtlas; uniform sampler2D pvAtlasD;`)
    .replace('#include <dithering_fragment>', `#include <dithering_fragment>
  { vec3 acc = vec3(0.0); float wsum = 0.0; vec3 nn = normalize(vPN);
    for (int k = 0; k < PV_N; k++) {
      vec4 c = pvM[k] * vec4(vPW, 1.0); if (c.w <= 0.0) continue;
      vec3 nd = c.xyz / c.w; if (abs(nd.x) >= 1.0 || abs(nd.y) >= 1.0) continue;
      vec2 uv = nd.xy * 0.5 + 0.5, ua = pvTile[k].xy + clamp(uv, 0.002, 0.998) * pvTile[k].zw;
      vec4 pk = texture2D(pvAtlasD, ua); float dl = (pk.r * 255.0 * 256.0 + pk.g * 255.0) / 65535.0 * ${LEJOS.toFixed(1)};
      float vis = step(c.w, dl + ${op.sesgo.toFixed(3)} + 0.012 * c.w);
      float cara = smoothstep(${op.cercaMin.toFixed(2)}, ${op.cercaMax.toFixed(2)}, dot(nn, normalize(pvP[k] - vPW)));
      float borde = smoothstep(0.0, 0.06, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
      float w = vis * cara * borde; acc += texture2D(pvAtlas, ua).rgb * w; wsum += w;
    }
    if (wsum > 0.001) gl_FragColor.rgb = mix(gl_FragColor.rgb, acc / wsum, clamp(wsum, 0.0, 1.0) * pvFuerza); }`);

  const guardados = [];
  const aplicar = () => {
    scene.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh) return;
      [].concat(o.material).forEach(m => {
        if (!m || m.userData.pvOrig || !MATERIALES.some(t => m[t]) || (m.transparent && m.opacity < 0.98)) return;
        const orig = m.onBeforeCompile, clave = m.customProgramCacheKey;
        m.userData.pvOrig = { orig, clave }; guardados.push(m);
        m.onBeforeCompile = function (sh, rend) { orig && orig.call(this, sh, rend); Object.assign(sh.uniforms, U); sh.vertexShader = vertex(sh.vertexShader); sh.fragmentShader = fragment(sh.fragmentShader); };
        m.customProgramCacheKey = function () { return (clave ? clave.call(this) : '') + '|pv' + N; };
        m.needsUpdate = true;
      });
    });
  };
  const quitar = () => {
    guardados.splice(0).forEach(m => { const o = m.userData.pvOrig; if (!o) return; m.onBeforeCompile = o.orig || (() => {}); m.customProgramCacheKey = o.clave || (() => ''); delete m.userData.pvOrig; m.needsUpdate = true; });
    atlas.dispose(); rtD.dispose();
  };
  return { n: N, aplicar, quitar };
}

// Carga los renders elegidos (imagen + cámara) como texturas listas para proyectar. renders: elementos de la galería con { url, meta }
export async function cargarRefs(renders) {
  const cargador = new THREE.TextureLoader(); cargador.setCrossOrigin('anonymous');
  const out = [];
  for (const r of renders.slice(0, MAX_REFS)) {
    if (!r?.url || !r.meta?.camara) continue;
    const textura = await new Promise((ok, ko) => cargador.load(r.url, ok, undefined, () => ko(new Error('No se pudo cargar «' + (r.nombre || 'un render') + '»'))));
    const img = textura.image; out.push({ meta: r.meta, textura, aspecto: img.width / img.height, nombre: r.nombre });
  }
  return out;
}
