import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// Vista 3D de la sala con las máquinas REALES del catálogo (sus modelos .glb), con luz y sombras. Solo se mira (se gira con el dedo o el ratón);
// las máquinas se mueven en la planta. Cada máquina se escala por la altura del catálogo, sin deformarla, igual que en la vista de realidad aumentada.
const CM = 0.01;
const COLOR_CAT = { fuerza: 0x77726b, cardio: 0xbfb1a3, func: 0xe6e1da };
const MAX_BYTES = 14e6; // los modelos más pesados se quedan como caja para que el móvil no se cuelgue

const modelos = new Map(); // url → Promise<Object3D> (se descarga una sola vez por modelo)
let dracoL = null, ktx2L = null;
function cargaModelo(url, renderer) {
  if (!modelos.has(url)) {
    const l = new GLTFLoader();
    try { if (!dracoL) dracoL = new DRACOLoader().setDecoderPath('/draco/'); l.setDRACOLoader(dracoL); } catch { /* sin Draco */ }
    try { l.setMeshoptDecoder(MeshoptDecoder); } catch { /* sin Meshopt */ }
    try { if (!ktx2L) ktx2L = new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer); l.setKTX2Loader(ktx2L); } catch { /* sin KTX2 */ }
    modelos.set(url, new Promise((ok, ko) => l.load(url, g => ok(g.scene), undefined, ko)));
  }
  return modelos.get(url);
}

function lineas1m(L, W) {
  const pts = [];
  for (let x = 1; x < L * CM; x += 1) pts.push(x, 0.002, 0, x, 0.002, W * CM);
  for (let z = 1; z < W * CM; z += 1) pts.push(0, 0.002, z, L * CM, 0.002, z);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x2c2a27 }));
}

export default function HomeGymVisor3D({ S, items, onError }) {
  const caja = useRef(null), est = useRef(null), ficha = useRef(0);

  // Escena, cámara, luces y controles: se crean una sola vez
  useEffect(() => {
    const el = caja.current; let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch { if (onError) onError(); return undefined; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    const cam = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    const controls = new OrbitControls(cam, renderer.domElement);
    controls.maxPolarAngle = Math.PI / 2 - 0.04; controls.minDistance = 1.5; controls.maxDistance = 22;
    const sol = new THREE.DirectionalLight(0xfff1e0, 2.4); sol.castShadow = true; sol.shadow.mapSize.set(2048, 2048); sol.shadow.bias = -0.0004; sol.shadow.normalBias = 0.02;
    scene.add(sol, sol.target, new THREE.HemisphereLight(0xffffff, 0x222222, 0.5));
    const grupo = new THREE.Group(); scene.add(grupo);
    const render = () => renderer.render(scene, cam);
    controls.addEventListener('change', render);
    const ajusta = () => { const w = el.clientWidth || 300, h = el.clientHeight || 200; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); est.current?.reencuadra?.(); render(); };
    controls.addEventListener('start', () => { if (est.current) est.current.tocado = true; });
    const ro = new ResizeObserver(ajusta); ro.observe(el); ajusta();
    est.current = { renderer, scene, cam, controls, sol, grupo, render, dimsCamara: '' };
    return () => {
      ro.disconnect(); controls.dispose(); pm.dispose();
      scene.traverse(o => { if (o.isMesh || o.isLineSegments) { o.geometry?.dispose?.(); } });
      renderer.dispose(); renderer.domElement.remove(); est.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // La sala y las máquinas se reconstruyen cuando cambian las medidas o la distribución
  useEffect(() => {
    const e = est.current; if (!e) return;
    const mi = ++ficha.current, { grupo, render, cam, controls, sol } = e;
    grupo.children.slice().forEach(c => { grupo.remove(c); c.traverse(o => { if (o.userData.propio) { o.geometry?.dispose?.(); o.material?.dispose?.(); } }); });
    const L = S.L * CM, W = S.W * CM, H = S.H * CM;
    const propio = o => { o.userData.propio = true; return o; };

    const suelo = propio(new THREE.Mesh(new THREE.PlaneGeometry(L, W), new THREE.MeshStandardMaterial({ color: 0x1d1c1a, roughness: 0.92, metalness: 0 })));
    suelo.rotation.x = -Math.PI / 2; suelo.position.set(L / 2, 0, W / 2); suelo.receiveShadow = true; grupo.add(suelo);
    grupo.add(propio(lineas1m(S.L, S.W)));
    const matPared = new THREE.MeshStandardMaterial({ color: 0x2a2825, roughness: 0.95, side: THREE.FrontSide });
    const p1 = propio(new THREE.Mesh(new THREE.PlaneGeometry(W, H), matPared)); p1.rotation.y = Math.PI / 2; p1.position.set(0, H / 2, W / 2); p1.receiveShadow = true; grupo.add(p1);
    const p2 = propio(new THREE.Mesh(new THREE.PlaneGeometry(L, H), matPared)); p2.position.set(L / 2, H / 2, 0); p2.receiveShadow = true; grupo.add(p2);
    // puerta: una tira clara en el suelo, en la pared por donde se entra
    const mp = new THREE.MeshBasicMaterial({ color: 0xbfb1a3 });
    const horiz = S.door === 'arriba' || S.door === 'abajo';
    const tira = propio(new THREE.Mesh(new THREE.BoxGeometry(horiz ? 0.9 : 0.06, 0.012, horiz ? 0.06 : 0.9), mp));
    tira.position.set(S.door === 'izq' ? 0.03 : S.door === 'der' ? L - 0.03 : L / 2, 0.006, S.door === 'arriba' ? 0.03 : S.door === 'abajo' ? W - 0.03 : W / 2); grupo.add(tira);

    // Luz y cámara según el tamaño de la sala
    const grande = Math.max(L, W);
    sol.position.set(L * 0.75, Math.max(H * 1.8, 4.5), W * 0.25); sol.target.position.set(L / 2, 0, W / 2);
    const sc = sol.shadow.camera; sc.left = -grande; sc.right = grande; sc.top = grande; sc.bottom = -grande; sc.near = 0.5; sc.far = 30; sc.updateProjectionMatrix();
    // La cámara encuadra toda la sala según el ancho que haya (en un visor estrecho se aleja más). Si el cliente ya la ha movido, no se toca.
    const encuadra = () => {
      const d = grande * 1.35 * Math.max(1, 1.55 / cam.aspect);
      controls.target.set(L / 2, Math.min(0.9, H * 0.35), W / 2);
      cam.position.set(L / 2 + d * 0.62, d * 0.58, W / 2 + d * 0.85); cam.lookAt(controls.target); controls.update();
    };
    e.reencuadra = () => { if (!e.tocado) encuadra(); };
    const clave = S.L + 'x' + S.W + 'x' + S.H;
    if (e.dimsCamara !== clave) { e.dimsCamara = clave; e.tocado = false; encuadra(); }

    // Máquinas: su modelo real escalado por la altura; si no hay modelo (o pesa demasiado), una caja con sus medidas
    items.forEach(a => {
      const { it } = a, h = it.h * CM, m = it.modelo3d;
      const girada = Math.abs(a.w - it.w) > 1 && Math.abs(a.w - it.d) <= 1 && Math.abs(it.w - it.d) > 1;
      const caja3 = () => {
        const b = propio(new THREE.Mesh(new THREE.BoxGeometry(a.w * CM, h, a.d * CM), new THREE.MeshStandardMaterial({ color: COLOR_CAT[it.cat] || 0x77726b, roughness: 0.6, metalness: 0.1 })));
        b.position.set((a.x + a.w / 2) * CM, h / 2, (a.y + a.d / 2) * CM); b.castShadow = true; b.receiveShadow = true; return b;
      };
      const provisional = caja3(); grupo.add(provisional);
      if (!m || !m.url || (m.tipo && m.tipo !== 'glb') || (m.bytes && m.bytes > MAX_BYTES)) return;
      cargaModelo(m.url, e.renderer).then(esc => {
        if (ficha.current !== mi || !est.current) return;
        const envoltura = new THREE.Group(); envoltura.add(esc.clone(true));
        envoltura.rotation.y = -(((m.rot || 0) + (girada ? 90 : 0)) * Math.PI) / 180;
        const b1 = new THREE.Box3().setFromObject(envoltura), tam = b1.getSize(new THREE.Vector3());
        if (!(tam.y > 1e-6)) return;
        envoltura.scale.setScalar(h / tam.y); envoltura.updateMatrixWorld(true);
        const b2 = new THREE.Box3().setFromObject(envoltura), c = b2.getCenter(new THREE.Vector3());
        envoltura.position.set((a.x + a.w / 2) * CM - c.x, -b2.min.y, (a.y + a.d / 2) * CM - c.z);
        envoltura.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        grupo.remove(provisional); provisional.geometry.dispose(); provisional.material.dispose();
        grupo.add(envoltura); render();
      }).catch(() => { /* se queda la caja */ });
    });
    render();
  }, [S.L, S.W, S.H, S.door, items]);

  return <div ref={caja} className="hg-3d" style={{ width: '100%', height: '100%' }} />;
}
