import * as THREE from 'three';

// Proyección de renders sobre el modelo 3D («proyector de diapositivas»): cada render final se pega al modelo desde la cámara con la que se hizo.
// Al sacar un panorama 360° desde cualquier punto, lo que cubre un render lleva SUS píxeles (ya mejorados con IA) y lo que no cubre ninguno
// sale del propio modelo. No se inventa nada: solo se reparte lo que ya existe. Cada render solo se pega donde su cámara lo veía
// (se comprueba con un mapa de profundidad), de frente y con borde suave, y si varios cubren el mismo sitio se mezclan.
const MAX = 4;
const DEFECTO = { fuerza: 0.97, sesgo: 0.04, cercaMin: 0.12, cercaMax: 0.45 };

// Cámara de un render: la misma proyección que usó el visor (apertura vertical, desplazamiento vertical de la lente y proporción de la imagen)
export function camaraDeRender(meta, aspecto) {
  const c = meta?.camara; if (!c || !Number.isFinite(c.px)) return null;
  const cam = new THREE.PerspectiveCamera(c.fov > 5 && c.fov < 140 ? c.fov : 50, aspecto || 16 / 9, 0.1, 400);
  cam.position.set(c.px, c.py, c.pz); cam.lookAt(c.tx ?? c.px, c.ty ?? c.py, c.tz ?? c.pz + 1);
  cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
  const s = Number(meta.shift) || 0; if (s) { cam.projectionMatrix.elements[9] += 2 * s; cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert(); }
  return cam;
}

// Mapa de profundidad de la escena vista desde la cámara del render (para saber qué ve cada render y no pegarlo «a través» de una pared)
function mapaProfundidad(renderer, scene, cam, ocultar, tam = 2048) {
  const w = Math.min(tam, Math.round(tam * Math.min(1, cam.aspect))), h = Math.round(w / cam.aspect);
  const rt = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
  rt.depthTexture = new THREE.DepthTexture(w, h); rt.depthTexture.type = THREE.UnsignedIntType; rt.depthTexture.minFilter = THREE.NearestFilter; rt.depthTexture.magFilter = THREE.NearestFilter;
  const ocultos = [], previo = renderer.getRenderTarget(), bg = scene.background, fog = scene.fog;
  ocultar.forEach(o => { if (o) { ocultos.push([o, o.visible]); o.visible = false; } });
  scene.traverse(o => { if (o.isMesh && o.visible && [].concat(o.material).some(m => m && m.transparent && m.opacity < 0.98)) { ocultos.push([o, true]); o.visible = false; } }); // los cristales no tapan
  scene.background = null; scene.fog = null;
  renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, cam); renderer.setRenderTarget(previo);
  scene.background = bg; scene.fog = fog; ocultos.forEach(([o, v]) => { o.visible = v; });
  return rt;
}

const MATERIALES = ['isMeshStandardMaterial', 'isMeshPhysicalMaterial', 'isMeshBasicMaterial', 'isMeshLambertMaterial', 'isMeshPhongMaterial'];

// refs: [{ meta, textura (THREE.Texture), aspecto }] (hasta 4). Devuelve { n, aplicar(), quitar() }.
export function crearProyeccion(renderer, scene, refs, ocultar = [], opciones = {}) {
  const op = { ...DEFECTO, ...opciones }, lista = refs.slice(0, MAX).map(r => ({ ...r, cam: camaraDeRender(r.meta, r.aspecto) })).filter(r => r.cam && r.textura);
  if (!lista.length) throw new Error('Ningún render tiene cámara guardada');
  const rts = lista.map(r => mapaProfundidad(renderer, scene, r.cam, ocultar));
  const U = { pvFuerza: { value: op.fuerza } };
  lista.forEach((r, k) => {
    r.textura.colorSpace = THREE.NoColorSpace; r.textura.minFilter = THREE.LinearFilter; r.textura.generateMipmaps = false; r.textura.needsUpdate = true;
    U['pvM' + k] = { value: new THREE.Matrix4().multiplyMatrices(r.cam.projectionMatrix, r.cam.matrixWorldInverse) };
    U['pvP' + k] = { value: r.cam.position.clone() }; U['pvT' + k] = { value: r.textura }; U['pvD' + k] = { value: rts[k].depthTexture };
    U['pvNF' + k] = { value: new THREE.Vector2(r.cam.near, r.cam.far) };
  });
  const decl = lista.map((_, k) => `uniform mat4 pvM${k}; uniform vec3 pvP${k}; uniform sampler2D pvT${k}; uniform sampler2D pvD${k}; uniform vec2 pvNF${k};`).join('\n');
  const cuerpo = lista.map((_, k) => `{
      vec4 c = pvM${k} * vec4(vPW, 1.0);
      if (c.w > 0.0) { vec3 nd = c.xyz / c.w;
        if (abs(nd.x) < 1.0 && abs(nd.y) < 1.0) {
          vec2 uv = nd.xy * 0.5 + 0.5;
          float dm = texture2D(pvD${k}, uv).r, n = pvNF${k}.x, f = pvNF${k}.y, dl = n * f / (f - dm * (f - n));
          float vis = step(c.w, dl + ${op.sesgo.toFixed(3)} + 0.012 * c.w);
          float cara = smoothstep(${op.cercaMin.toFixed(2)}, ${op.cercaMax.toFixed(2)}, dot(normalize(vPN), normalize(pvP${k} - vPW)));
          float borde = smoothstep(0.0, 0.06, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
          float w = vis * cara * borde;
          acc += texture2D(pvT${k}, uv).rgb * w; wsum += w;
        } }
    }`).join('\n');
  const vertex = (s) => s.replace('#include <common>', '#include <common>\nvarying vec3 vPW; varying vec3 vPN;').replace('#include <project_vertex>', '#include <project_vertex>\n  vPW = (modelMatrix * vec4(transformed, 1.0)).xyz; vPN = length(normal) > 0.0 ? normalize(mat3(modelMatrix) * normal) : vec3(0.0, 1.0, 0.0);');
  const fragment = (s) => s.replace('#include <common>', `#include <common>\nvarying vec3 vPW; varying vec3 vPN; uniform float pvFuerza;\n${decl}`)
    .replace('#include <dithering_fragment>', `#include <dithering_fragment>\n  { vec3 acc = vec3(0.0); float wsum = 0.0;\n${cuerpo}\n    if (wsum > 0.001) gl_FragColor.rgb = mix(gl_FragColor.rgb, acc / wsum, clamp(wsum, 0.0, 1.0) * pvFuerza); }`);

  const guardados = [];
  const aplicar = () => {
    scene.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh) return;
      [].concat(o.material).forEach(m => {
        if (!m || m.userData.pvOrig || !MATERIALES.some(t => m[t]) || (m.transparent && m.opacity < 0.98)) return;
        const orig = m.onBeforeCompile, clave = m.customProgramCacheKey;
        m.userData.pvOrig = { orig, clave }; guardados.push(m);
        m.onBeforeCompile = function (sh, rend) { orig && orig.call(this, sh, rend); Object.assign(sh.uniforms, U); sh.vertexShader = vertex(sh.vertexShader); sh.fragmentShader = fragment(sh.fragmentShader); };
        m.customProgramCacheKey = function () { return (clave ? clave.call(this) : '') + '|pv' + lista.length; };
        m.needsUpdate = true;
      });
    });
  };
  const quitar = () => {
    guardados.splice(0).forEach(m => { const o = m.userData.pvOrig; if (!o) return; m.onBeforeCompile = o.orig || (() => {}); m.customProgramCacheKey = o.clave || (() => ''); delete m.userData.pvOrig; m.needsUpdate = true; });
    rts.forEach(rt => { rt.depthTexture?.dispose(); rt.dispose(); });
  };
  return { n: lista.length, aplicar, quitar };
}

// Carga los renders elegidos (imagen + cámara) como texturas listas para proyectar. renders: elementos de la galería con { url, meta }
export async function cargarRefs(renders) {
  const cargador = new THREE.TextureLoader(); cargador.setCrossOrigin('anonymous');
  const out = [];
  for (const r of renders.slice(0, MAX)) {
    if (!r?.url || !r.meta?.camara) continue;
    const textura = await new Promise((ok, ko) => cargador.load(r.url, ok, undefined, () => ko(new Error('No se pudo cargar «' + (r.nombre || 'un render') + '»'))));
    const img = textura.image; out.push({ meta: r.meta, textura, aspecto: img.width / img.height, nombre: r.nombre });
  }
  return out;
}
