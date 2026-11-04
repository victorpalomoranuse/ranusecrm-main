import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// Campus de Ranuse en estilo gemelo digital: edificios sólidos de grafito con vetas de luz.
// - Headquarters: recepción, estudio de diseño, ventas, presupuestos, finanzas y sala del equipo, con su gente dentro.
// - Proyectos: cada uno es un gym que sale del suelo, unido con arcos de luz a los departamentos que intervienen.
// - Proveedores: un almacén o una oficina por sector, con un stand (logo) por empresa.

const LUZ = { rojo: '#ff6b57', ambar: '#ffb347', gris: '#8f8a85', verde: '#4be3a0' };
const TAUPE = '#baafa5';
const LED = '#ffc978'; // luz cálida indirecta de los renders de Ranuse
const DEP = {
  diseno: { c: '#e8c98f', nombre: 'Diseño y proyectos' }, ventas: { c: '#8db4c4', nombre: 'Ventas y leads' }, presupuestos: { c: '#b4a3c4', nombre: 'Presupuestos' },
  finanzas: { c: '#93bd9f', nombre: 'Finanzas' }, equipo: { c: '#baafa5', nombre: 'Sala del equipo' }, direccion: { c: '#d9b36a', nombre: 'Dirección' }, marketing: { c: '#e08f8f', nombre: 'Marketing y redes' },
};
// Sede: fila de delante = camino del proyecto (1 Marketing > 2 Ventas > 3 Presupuestos > 4 Estudio de diseño), con una pasarela de luz delante;
// fila de detrás = apoyo (dirección, finanzas, equipo, juntas, renders, materiales). A la derecha, los proyectos en columnas por fase (0-5).
const FCOL = ['#e8c98f', '#8db4c4', '#e0b25a', '#c98fa3', '#93bd9f', '#b4a3c4'];
const FASES_L = ['Diseño previo', 'Arquitectura', 'Instalaciones', 'Interiorismo y materialidad', 'Maquinaria y equipamiento', 'Documentación'];
const PIELES = ['#f3d2b3', '#e8b98f', '#c98f63', '#a86d45', '#7a4b2f'];
const PELOS = ['#1c1c20', '#3b2a20', '#6b4a2f', '#b5651d', '#e1b866', '#8d8d92', '#7a3b2e'];
const ROPAS = ['#1d1d22', '#3a3f4b', '#baafa5', '#f1eee8', '#33425b', '#46695e', '#8c3b36', '#6b6259'];
const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const corto = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

function etiqueta(texto, { fs = 26, color = '#2b2622', bg = 'rgba(248,245,240,0.95)', borde = 'rgba(60,50,40,0.14)', espaciado = 0, punto = null } = {}) {
  const c = document.createElement('canvas'), g = c.getContext('2d'), pad = 15, fuente = `600 ${fs}px Montserrat, system-ui, sans-serif`;
  g.font = fuente; if (espaciado) g.letterSpacing = espaciado + 'px';
  const dp = punto ? fs * 0.9 : 0, w = Math.ceil(g.measureText(texto).width) + pad * 2 + dp, h = fs + pad * 1.1;
  c.width = w; c.height = h; g.font = fuente; if (espaciado) g.letterSpacing = espaciado + 'px';
  g.fillStyle = bg; g.strokeStyle = borde; g.lineWidth = 2; g.beginPath(); g.roundRect(1, 1, w - 2, h - 2, h / 2); g.fill(); g.stroke();
  if (punto) { g.fillStyle = punto; g.beginPath(); g.arc(pad + fs * 0.33, h / 2, fs * 0.3, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(texto, pad + dp, h / 2 + 1);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  /* tamaño fijo en pantalla: los nombres se leen igual de cerca que de lejos */
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, sizeAttenuation: false }));
  s.userData.px = { w, h }; s.scale.set(w * 0.0008, h * 0.0008, 1); s.renderOrder = 20; return s;
}
function texturaBrillo() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function texturaSuelo(tipo) {
  const N = 512, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d');
  const ruido = (n, al) => { for (let i = 0; i < n; i++) { g.fillStyle = 'rgba(' + (Math.random() > 0.5 ? '255,255,255' : '0,0,0') + ',' + Math.random() * al + ')'; g.fillRect(Math.random() * N, Math.random() * N, 1 + Math.random() * 2, 1 + Math.random() * 2); } };
  if (tipo === 'madera') { // roble natural en tablas largas
    g.fillStyle = '#b98f62'; g.fillRect(0, 0, N, N);
    const tablas = 16, h = N / tablas;
    for (let i = 0; i < tablas; i++) {
      const tono = (((i * 37) % 5) - 2) * 0.035; g.fillStyle = 'rgba(' + (tono > 0 ? '255,235,200' : '60,35,15') + ',' + (Math.abs(tono) + 0.02) + ')'; g.fillRect(0, i * h, N, h);
      g.strokeStyle = 'rgba(70,40,15,0.14)'; g.lineWidth = 1; for (let k = 0; k < 4; k++) { const y = i * h + 3 + k * (h - 6) / 4 + Math.random() * 2; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(N * 0.3, y + Math.random() * 3 - 1.5, N * 0.6, y + Math.random() * 3 - 1.5, N, y); g.stroke(); }
      g.fillStyle = 'rgba(40,22,8,0.5)'; g.fillRect(0, i * h, N, 1.2); g.fillRect(((i * 173) % (N - 80)) + 40, i * h, 1.2, h);
    }
  } else if (tipo === 'gres') { // porcelánico beige de gran formato
    g.fillStyle = '#c4b8a5'; g.fillRect(0, 0, N, N); ruido(2500, 0.05);
    g.strokeStyle = 'rgba(95,82,68,0.5)'; g.lineWidth = 2; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(i * N / 4, 0); g.lineTo(i * N / 4, N); g.moveTo(0, i * N / 4); g.lineTo(N, i * N / 4); g.stroke(); }
  } else if (tipo === 'caucho') { // suelo de caucho negro de gimnasio
    g.fillStyle = '#463f39'; g.fillRect(0, 0, N, N);
    for (let i = 0; i < 6000; i++) { g.fillStyle = 'rgba(' + (Math.random() > 0.8 ? '150,120,95' : '0,0,0') + ',' + (0.15 + Math.random() * 0.3) + ')'; g.fillRect(Math.random() * N, Math.random() * N, 1 + Math.random() * 2.5, 1 + Math.random() * 2.5); }
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 2; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(i * N / 4, 0); g.lineTo(i * N / 4, N); g.moveTo(0, i * N / 4); g.lineTo(N, i * N / 4); g.stroke(); }
  } else if (tipo === 'marmol') { // travertino
    g.fillStyle = '#e3d8c6'; g.fillRect(0, 0, N, N); g.strokeStyle = 'rgba(150,125,95,0.22)'; g.lineWidth = 2;
    for (let i = 0; i < 26; i++) { const y = Math.random() * N; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(N * 0.3, y + Math.random() * 14 - 7, N * 0.6, y + Math.random() * 14 - 7, N, y + Math.random() * 10 - 5); g.stroke(); }
    ruido(1500, 0.05); g.strokeStyle = 'rgba(120,100,78,0.45)'; g.lineWidth = 2; for (let i = 0; i < 2; i++) { g.beginPath(); g.moveTo(i * N / 2, 0); g.lineTo(i * N / 2, N); g.moveTo(0, i * N / 2); g.lineTo(N, i * N / 2); g.stroke(); }
  } else { // microcemento
    g.fillStyle = '#9b9187'; g.fillRect(0, 0, N, N);
    for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(' + (Math.random() > 0.5 ? '255,255,255' : '0,0,0') + ',0.03)'; g.beginPath(); g.arc(Math.random() * N, Math.random() * N, 30 + Math.random() * 80, 0, 7); g.fill(); }
    ruido(2500, 0.05);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export function OficinaVirtual3D({ data, onSeleccion, cargarLogo, apiRef }) {
  const caja = useRef(null);
  const cbSel = useRef(onSeleccion);
  cbSel.current = onSeleccion;

  useEffect(() => {
    const cont = caja.current; if (!cont || !data) return undefined;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch { cbSel.current?.({ tipo: 'error' }); return undefined; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    cont.appendChild(renderer.domElement); renderer.domElement.style.display = 'block'; renderer.domElement.style.touchAction = 'none';
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#1a140f'); scene.fog = new THREE.Fog('#1a140f', 120, 300);
    const cam = new THREE.PerspectiveCamera(36, 1, 0.5, 500);
    const ctrl = new OrbitControls(cam, renderer.domElement);
    const OBJ = new THREE.Vector3(22, 0, 4);
    ctrl.target.copy(OBJ); cam.position.set(OBJ.x + 58, 56, OBJ.z + 76);
    ctrl.enableDamping = true; ctrl.minDistance = 8; ctrl.maxDistance = 190; ctrl.minPolarAngle = 0.35; ctrl.maxPolarAngle = 1.25; ctrl.screenSpacePanning = false; ctrl.update();

    { const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.3; pm.dispose(); }
    scene.add(new THREE.HemisphereLight('#ffe8cc', '#6b5a4a', 0.8));
    const sol = new THREE.DirectionalLight('#ffd9a8', 1.75); sol.position.set(54, 70, 56); sol.target.position.set(34, 0, 8); scene.add(sol, sol.target);
    sol.castShadow = true; sol.shadow.mapSize.set(4096, 4096); Object.assign(sol.shadow.camera, { left: -95, right: 95, top: 95, bottom: -95, near: 5, far: 240 }); sol.shadow.bias = -0.0005;
    const relleno = new THREE.DirectionalLight('#ffd9b0', 0.35); relleno.position.set(-40, 24, -30); scene.add(relleno);

    const brillo = texturaBrillo();
    const mats = new Map(), geos = new Map();
    const G = (k, f) => { if (!geos.has(k)) geos.set(k, f()); return geos.get(k); };
    const M = (c, o = {}) => { const k = c + JSON.stringify(o); if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.05, ...o })); return mats.get(k); };
    const ME = (c, i = 1) => M(c, { emissive: c, emissiveIntensity: i, roughness: 0.4 });
    const sombrear = (m, c = true) => { m.castShadow = c; m.receiveShadow = true; return m; };
    const poner = (m, x, y, z, parent) => { m.position.set(x, y, z); parent.add(m); return m; };
    const raiz = new THREE.Group(); scene.add(raiz); let mundo = raiz; let centroProy = 60, distProy = 60; const caminos = [];
    const en = (g, fn) => { const p = mundo; mundo = g; try { fn(); } finally { mundo = p; } };
    const caja3 = (w, h, d, c, x, y, z, parent = mundo, o, sh = true) => sombrear(poner(new THREE.Mesh(G(`b${w},${h},${d}`, () => new RoundedBoxGeometry(w, h, d, 2, Math.min(0.05, Math.min(w, h, d) * 0.4))), typeof c === 'string' ? M(c, o) : c), x, y, z, parent), sh);
    const cil = (r, h, c, x, y, z, parent = mundo, o) => sombrear(poner(new THREE.Mesh(G(`c${r},${h}`, () => new THREE.CylinderGeometry(r, r, h, 20)), M(c, o)), x, y, z, parent));
    const esf = (r, c, x, y, z, parent = mundo, o) => sombrear(poner(new THREE.Mesh(G(`s${r}`, () => new THREE.SphereGeometry(r, 20, 16)), typeof c === 'string' ? M(c, o) : c), x, y, z, parent));
    const interactivos = [], animados = [], lod = [], subidas = [], stands = [], arcos = [], posProy = {}, pulsosAtencion = [];
    const marcar = (obj, info) => { obj.userData.info = info; interactivos.push(obj); obj.traverse(o => { if (o !== obj) o.userData.root = obj; }); };
    const halo = (color, x, y, z, esc, parent, o = 0.9) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: brillo, color, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false })); s.position.set(x, y, z); s.scale.set(esc, esc, 1); parent.add(s); return s; };
    const aro3 = (r, color, x, y, z, parent, o = 0.9) => { const m = new THREE.Mesh(G(`ring${r}`, () => new THREE.RingGeometry(r * 0.84, r, 48)), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: o, side: THREE.DoubleSide, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); parent.add(m); return m; };
    const rotulo = (texto, x, y, z, opts, lim) => { const e = etiqueta(texto, opts); e.position.set(x, y, z); mundo.add(e); if (lim) { e.userData.lod = lim; lod.push(e); } return e; };
    // vetas de luz: línea fina emisiva alrededor de un rectángulo
    const contorno = (x, z, w, d, color, y = 0.12, parent = mundo) => { [[w, 0.06, x, z - d / 2], [w, 0.06, x, z + d / 2]].forEach(([ww, hh, xx, zz]) => caja3(ww, 0.04, 0.06, ME(LED, 0.9), xx, y, zz, parent, null, false)); [[x - w / 2], [x + w / 2]].forEach(([xx]) => caja3(0.06, 0.04, d, ME(LED, 0.9), xx, y, z, parent, null, false)); };
    // paredes sólidas de grafito; con hueco de puerta opcional
    const tm = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); g.fillStyle = '#d6c8b0'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 46; i++) { g.fillStyle = 'rgba(' + (Math.random() > 0.5 ? '255,250,240' : '90,70,50') + ',0.04)'; g.beginPath(); g.arc(Math.random() * 256, Math.random() * 256, 18 + Math.random() * 60, 0, 7); g.fill(); } for (let i = 0; i < 1800; i++) { g.fillStyle = 'rgba(' + (Math.random() > 0.5 ? '255,255,255' : '0,0,0') + ',0.03)'; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); } const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    const GRAFITO = new THREE.MeshStandardMaterial({ map: tm, roughness: 0.88, metalness: 0 });
    const paredH = (x0, z, w, h, color, gap = 0) => { const seg = (xa, wa) => { if (wa <= 0.1) return; caja3(wa, h, 0.26, GRAFITO, xa + wa / 2, h / 2 + 0.1, z, mundo, { roughness: 0.55 }); caja3(wa, 0.07, 0.3, ME(color === TAUPE ? LED : color, 2.4), xa + wa / 2, h + 0.12, z, mundo, null, false); caja3(wa, 0.14, 0.3, '#1d1713', xa + wa / 2, 0.17, z, mundo, { roughness: 0.6 }, false); }; if (gap > 0) { const l = (w - gap) / 2; seg(x0, l); seg(x0 + l + gap, l); } else seg(x0, w); };
    const paredV = (x, z0, d, h, color, gap = 0) => { const seg = (za, da) => { if (da <= 0.1) return; caja3(0.26, h, da, GRAFITO, x, h / 2 + 0.1, za + da / 2, mundo, { roughness: 0.55 }); caja3(0.3, 0.07, da, ME(color === TAUPE ? LED : color, 2.4), x, h + 0.12, za + da / 2, mundo, null, false); caja3(0.3, 0.14, da, '#1d1713', x, 0.17, za + da / 2, mundo, { roughness: 0.6 }, false); }; if (gap > 0) { const l = (d - gap) / 2; seg(z0, l); seg(z0 + l + gap, l); } else seg(z0, d); };
    const ventana = (x, y, z, rot, w = 1.8, h = 1.1) => { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rot; mundo.add(g); caja3(w + 0.14, h + 0.14, 0.1, '#2b2520', 0, 0, 0, g, { metalness: 0.4 }, false); const cr = new THREE.Mesh(new THREE.PlaneGeometry(w, h), M('#bfd6ee', { emissive: '#9fc3e6', emissiveIntensity: 0.55 })); cr.position.z = 0.06; g.add(cr); };
    const ACENTO = { '#1f3a66': ['#6fa8ff', 3], '#1d4a66': ['#6fd0ff', 1], '#3a2a66': ['#b79cff', 2], '#1f5a3c': ['#4be3a0', 0], '#5a2a3a': ['#ff8fa3', 4] };
    const pantTex = (color, w, h) => {
      const [ac, k] = ACENTO[color] || ['#79b7ff', 0], cv = document.createElement('canvas'); cv.width = 512; cv.height = Math.round(512 * h / w); const c = cv.getContext('2d'), W2 = cv.width, H2 = cv.height, sd = hash(color);
      c.fillStyle = '#0d1117'; c.fillRect(0, 0, W2, H2); c.fillStyle = 'rgba(255,255,255,0.07)'; c.fillRect(0, 0, W2, H2 * 0.14); c.fillStyle = ac; c.fillRect(14, H2 * 0.04, 10, H2 * 0.06);
      if (k === 0) { for (let i = 0; i < 9; i++) { const bh = (0.25 + ((i * 37 + sd) % 60) / 100) * H2 * 0.6; c.fillStyle = i % 3 === 2 ? '#ffc978' : ac; c.fillRect(30 + i * (W2 - 60) / 9, H2 * 0.9 - bh, (W2 - 60) / 9 - 10, bh); } }
      else if (k === 1) { for (let q = 0; q < 4; q++) { c.fillStyle = 'rgba(255,255,255,0.07)'; c.fillRect(20 + q * (W2 - 30) / 4, H2 * 0.2, (W2 - 30) / 4 - 10, H2 * 0.72); for (let r = 0; r < 3 + (q % 2); r++) { c.fillStyle = [ac, '#ffc978', '#9ad0a8', '#e58f8f'][(q + r) % 4]; c.fillRect(28 + q * (W2 - 30) / 4, H2 * 0.26 + r * H2 * 0.2, (W2 - 30) / 4 - 26, H2 * 0.15); } } }
      else if (k === 2) { c.strokeStyle = ac; c.lineWidth = 5; c.beginPath(); for (let i = 0; i <= 20; i++) { const x = 24 + i * (W2 - 48) / 20, y = H2 * 0.8 - (Math.sin(i * 0.5 + sd % 5) * 0.5 + 0.5) * H2 * 0.3 - i * H2 * 0.012; if (i) c.lineTo(x, y); else c.moveTo(x, y); } c.stroke(); for (let i = 0; i < 3; i++) { c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(24 + i * (W2 - 48) / 3, H2 * 0.2, (W2 - 48) / 3 - 12, H2 * 0.2); c.fillStyle = ac; c.fillRect(34 + i * (W2 - 48) / 3, H2 * 0.26, 44, 7); } }
      else if (k === 3) { c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 3; c.strokeRect(W2 * 0.1, H2 * 0.25, W2 * 0.8, H2 * 0.6); c.beginPath(); c.moveTo(W2 * 0.45, H2 * 0.25); c.lineTo(W2 * 0.45, H2 * 0.85); c.moveTo(W2 * 0.45, H2 * 0.55); c.lineTo(W2 * 0.9, H2 * 0.55); c.stroke(); c.strokeStyle = ac; c.strokeRect(W2 * 0.12, H2 * 0.62, W2 * 0.18, H2 * 0.2); }
      else { const cols = 5; for (let i = 0; i < cols * 3; i++) { c.fillStyle = ['#ff8fa3', '#ffc978', '#8db4c4', '#b79cff', '#9ad0a8'][(i * 7 + sd) % 5]; c.globalAlpha = 0.55 + ((i * 13) % 4) * 0.12; c.fillRect(18 + (i % cols) * (W2 - 30) / cols, H2 * 0.2 + Math.floor(i / cols) * H2 * 0.26, (W2 - 30) / cols - 8, H2 * 0.22); } c.globalAlpha = 1; }
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
    };
    const pantalla = (x, y, z, rot, w, h, color = '#3b6fd4') => { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rot; mundo.add(g); caja3(w + 0.1, h + 0.1, 0.06, '#101013', 0, 0, 0, g, null, false); const tx = pantTex(color, w, h); const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tx, emissive: '#ffffff', emissiveMap: tx, emissiveIntensity: 0.85, roughness: 0.3 })); p.position.z = 0.04; g.add(p); halo(ACENTO[color]?.[0] || '#79b7ff', 0, 0, 0.3, w * 1.5, g, 0.1); };

    // ── terreno y losas ──
    const fondo = document.createElement('canvas'); fondo.width = fondo.height = 256; { const g = fondo.getContext('2d'), gr = g.createRadialGradient(128, 128, 5, 128, 128, 128); gr.addColorStop(0, '#4a3b2e'); gr.addColorStop(0.55, '#2a2018'); gr.addColorStop(1, '#1a140f'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); }
    const ft = new THREE.CanvasTexture(fondo); ft.colorSpace = THREE.SRGBColorSpace;
    const terreno = new THREE.Mesh(new THREE.PlaneGeometry(340, 280), new THREE.MeshBasicMaterial({ map: ft })); terreno.rotation.x = -Math.PI / 2; terreno.position.set(22, -0.3, 16); mundo.add(terreno);
    const losa = (x, z, w, d, h = 0.4, color = '#2a2622') => { caja3(w, h, d, color, x, -h / 2 + 0.05, z, mundo, { roughness: 0.6 }, false).receiveShadow = true; contorno(x, z, w, d, TAUPE, 0.08); };
    const pavimento = (x, z, w, d, color = '#3a3632') => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), M(color, { roughness: 0.35, metalness: 0.2 })); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.06, z); m.receiveShadow = true; mundo.add(m); };
    losa(-2, 3, 84, 40); pavimento(-2, 3, 82, 38);

    // ── personas: figuras con proporciones reales; cada cual puede parecerse a su dueño (peinado, barba, gafas, piel y ropa) ──
    const persona = ({ av = {}, id = 'x', sentado, robot, casco, chaleco }) => {
      const hs = hash(id), a = { piel: PIELES[hs % PIELES.length], pelo: 'corto', peloColor: PELOS[(hs >> 3) % PELOS.length], barba: 'no', gafas: false, ropa: ROPAS[(hs >> 5) % ROPAS.length], ...av };
      const g = new THREE.Group(), y0 = sentado ? -0.34 : 0, pantalon = robot ? '#dfe5ea' : '#22252d', camisa = robot ? '#eef2f5' : chaleco ? '#e8f04a' : a.ropa, piel = robot ? '#eef2f5' : a.piel;
      const cap = (r, l, c, x, y, z, rx = 0, rz = 0) => { const m = new THREE.Mesh(G(`cp${r},${l}`, () => new THREE.CapsuleGeometry(r, l, 6, 12)), M(c, { roughness: 0.75 })); m.position.set(x, y, z); m.rotation.x = rx; m.rotation.z = rz; sombrear(m); g.add(m); return m; };
      if (sentado) [-0.13, 0.13].forEach(x => { cap(0.1, 0.42, pantalon, x, 0.78, 0.26, Math.PI / 2); cap(0.085, 0.46, pantalon, x, 0.42, 0.52); caja3(0.15, 0.08, 0.28, '#111114', x, 0.12, 0.58, g, null, false); });
      else [-0.12, 0.12].forEach(x => { cap(0.1, 0.62, pantalon, x, 0.52, 0), caja3(0.15, 0.08, 0.28, '#111114', x, 0.06, 0.05, g, null, false); });
      const torso = cap(0.22, 0.5, camisa, 0, 1.18 + y0, 0); torso.scale.z = 0.78;
      cil(0.07, 0.12, piel, 0, 1.66 + y0, 0, g);
      const cabeza = esf(0.19, M(piel, { roughness: 0.6 }), 0, 1.84 + y0, 0, g); cabeza.scale.set(0.95, 1.1, 1);
      if (robot) { caja3(0.34, 0.1, 0.06, '#27313b', 0, 1.86 + y0, 0.17, g, { emissive: '#4fc3f7', emissiveIntensity: 0.9 }, false); }
      else {
        const pelo = M(a.peloColor, { roughness: 0.85 });
        if (casco) { const c = new THREE.Mesh(G('casco', () => new THREE.SphereGeometry(0.23, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55)), M('#f2c230', { roughness: 0.4 })); c.position.set(0, 1.9 + y0, 0); sombrear(c); g.add(c); }
        else if (a.pelo === 'calvo') { /* sin pelo */ }
        else if (a.pelo === 'largo') { const c = new THREE.Mesh(G('peloL', () => new THREE.SphereGeometry(0.205, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62)), pelo); c.position.set(0, 1.87 + y0, -0.01); sombrear(c); g.add(c); caja3(0.36, 0.5, 0.12, pelo, 0, 1.68 + y0, -0.14, g, null, false); }
        else if (a.pelo === 'rizado') { for (let i = 0; i < 9; i++) { const ang = (i / 9) * Math.PI * 2; esf(0.085, pelo, Math.cos(ang) * 0.14, 1.95 + y0, Math.sin(ang) * 0.14, g); } esf(0.12, pelo, 0, 2.02 + y0, 0, g); esf(0.1, pelo, 0, 1.94 + y0, 0, g); }
        else { const c = new THREE.Mesh(G('peloC', () => new THREE.SphereGeometry(0.2, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5)), pelo); c.position.set(0, 1.88 + y0, -0.005); sombrear(c); g.add(c); }
        [-0.07, 0.07].forEach(x => esf(0.022, '#17171a', x, 1.86 + y0, 0.175, g).castShadow = false);
        if (a.barba && a.barba !== 'no') { const b = new THREE.Mesh(G('barba', () => new THREE.SphereGeometry(0.195, 14, 10, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45)), pelo); b.position.set(0, 1.84 + y0, 0.015); b.scale.set(1.0, a.barba === 'larga' ? 1.5 : 1, 1.02); g.add(b); }
        if (a.gafas) { [-0.075, 0.075].forEach(x => { const r = new THREE.Mesh(G('gafa', () => new THREE.TorusGeometry(0.05, 0.008, 6, 16)), M('#111114', { metalness: 0.6 })); r.position.set(x, 1.865 + y0, 0.19); g.add(r); }); caja3(0.05, 0.01, 0.01, '#111114', 0, 1.87 + y0, 0.19, g, null, false); }
      }
      // brazos (se animan al teclear)
      g.userData.brazos = [-1, 1].map(s => { const p = new THREE.Group(); p.position.set(s * 0.29, 1.46 + y0, 0); const b = new THREE.Mesh(G('brazoP', () => new THREE.CapsuleGeometry(0.062, 0.46, 6, 10)), M(camisa)); b.position.y = -0.26; sombrear(b); p.add(b); const mano = esf(0.06, piel, 0, -0.55, 0, p); mano.castShadow = false; g.add(p); p.rotation.x = sentado ? -1.15 : 0.08; return p; });
      g.userData.fase = Math.random() * 6; g.userData.sentado = !!sentado; animados.push(g);
      return g;
    };
    const luzPersona = p => (p.atrasadas > 0 ? LUZ.rojo : p.hoy > 0 ? LUZ.ambar : LUZ.verde);
    const nombre = (p, x, z, y, color) => rotulo(p.nombre.split(' ')[0], x, y, z, { fs: 24, borde: 'rgba(60,50,40,0.14)' }, 80);
    const mesaOf = (x, z, rot = 0, ancho = 1.9) => { const g = new THREE.Group(); g.position.set(x, 0.1, z); g.rotation.y = rot; mundo.add(g); caja3(ancho, 0.07, 0.95, '#ece8e1', 0, 0.76, 0, g, { roughness: 0.35 }); [-1, 1].forEach(s => { caja3(0.06, 0.74, 0.8, '#16161a', s * (ancho / 2 - 0.1), 0.37, 0, g); }); caja3(0.72, 0.44, 0.04, '#0e0e11', 0, 1.15, -0.2, g, null, false); const pa = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.38), M('#79b7ff', { emissive: '#3a78d0', emissiveIntensity: 0.8 })); pa.position.set(0, 1.15, -0.175); g.add(pa); cil(0.03, 0.2, '#222', 0, 0.9, -0.2, g); caja3(0.5, 0.02, 0.18, '#2a2a30', 0, 0.8, 0.22, g, null, false); return g; };
    const sillaOf = (x, z, rot) => { const g = new THREE.Group(); g.position.set(x, 0.1, z); g.rotation.y = rot; mundo.add(g); caja3(0.58, 0.09, 0.58, '#18181c', 0, 0.5, 0, g); caja3(0.56, 0.62, 0.08, '#18181c', 0, 0.86, 0.28, g); cil(0.04, 0.38, '#777', 0, 0.28, 0, g, { metalness: 0.8 }); caja3(0.5, 0.04, 0.5, '#555', 0, 0.1, 0, g, { metalness: 0.7 }, false); };
    const planta = (x, z, s = 1) => {
      const g = new THREE.Group(); g.position.set(x, 0.1, z); g.scale.setScalar(s); mundo.add(g);
      cil(0.3, 0.55, '#1d1a17', 0, 0.27, 0, g, { roughness: 0.5 }); cil(0.27, 0.04, '#3b2d22', 0, 0.55, 0, g);
      const h0 = hash(x + ',' + z);
      for (let k = 0; k < 9; k++) {
        const piv = new THREE.Group(); piv.position.set(0, 0.55, 0); piv.rotation.y = k * 2.4 + (h0 % 7); piv.rotation.z = 0.14 + ((k * 37 + h0) % 10) * 0.045; g.add(piv);
        const alto = 0.9 + ((k * 53 + h0) % 6) * 0.12;
        const tallo = new THREE.Mesh(G('tallo', () => new THREE.CylinderGeometry(0.012, 0.016, 1, 5)), M('#4a6b3a')); tallo.scale.y = alto; tallo.position.y = alto / 2; piv.add(tallo);
        const hoja = new THREE.Mesh(G('hojaE', () => new THREE.SphereGeometry(1, 10, 8)), M(k % 2 ? '#2f5a3e' : '#3b6e48', { roughness: 0.55 })); hoja.scale.set(0.2, 0.46, 0.03); hoja.position.set(0, alto + 0.34, 0); hoja.rotation.x = 0.35; hoja.castShadow = true; piv.add(hoja);
      }
    };
    const lampara = (x, z, h = 2) => { const g = new THREE.Group(); g.position.set(x, 0.1, z); mundo.add(g); cil(0.16, 0.06, '#222', 0, 0.03, 0, g); cil(0.022, h, '#222', 0, h / 2, 0, g); esf(0.18, ME('#fff1d6', 1.4), 0, h + 0.12, 0, g).castShadow = false; halo('#ffd9a0', 0, h + 0.12, 0, 1.8, g, 0.5); };
    const sofa = (x, z, rot, color = '#4a4540') => { const g = new THREE.Group(); g.position.set(x, 0.1, z); g.rotation.y = rot; mundo.add(g); caja3(2.6, 0.42, 1, color, 0, 0.32, 0, g); caja3(2.6, 0.7, 0.26, color, 0, 0.78, -0.38, g); [-1.2, 1.2].forEach(s => caja3(0.28, 0.68, 1, color, s, 0.52, 0, g)); };
    const estante = (x, z, rot, w = 2.4) => { const g = new THREE.Group(); g.position.set(x, 0.1, z); g.rotation.y = rot; mundo.add(g); caja3(w, 2.2, 0.4, '#1a1a1e', 0, 1.1, 0, g); [0.4, 0.95, 1.5, 2.0].forEach(y => caja3(w - 0.1, 0.04, 0.38, '#34343c', 0, y, 0.01, g, null, false)); ['#ece8e1', TAUPE, '#a9895d', '#6b6259', '#2e3a52'].forEach((c, i) => [0.62, 1.17, 1.72].forEach(y => caja3(0.34, 0.42, 0.3, c, -w / 2 + 0.4 + i * (w - 0.7) / 5, y, 0.03, g, null, false))); };
    const alfombra = (x, z, w, d, c) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), M(c, { roughness: 1 })); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.12, z); m.receiveShadow = true; mundo.add(m); };

    // ── SEDE ──
    const anclas = {}, salas = {}, MUR = 3.4;
    const OBRAS = ['/img/homegyms/contGym1.png', '/img/xthor/xthorPrincipal.png', '/img/homegyms/contGym2.png', '/img/f11/proyectoF11.jpg', '/img/golfpark/golfPark.jpg', '/img/homegyms/contGym3.png', '/img/nextera/Aula.png'];
    const cuadro = (x, y, z, rot, w, h, k) => {
      const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rot; mundo.add(g);
      caja3(w + 0.16, h + 0.16, 0.06, '#141110', 0, 0, 0, g, { roughness: 0.5 }, false);
      const cv = document.createElement('canvas'); cv.width = 480; cv.height = Math.round(480 * h / w); const gx = cv.getContext('2d'); gx.fillStyle = '#8a7d6c'; gx.fillRect(0, 0, cv.width, cv.height);
      const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4;
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tx, roughness: 0.6, emissive: '#ffffff', emissiveMap: tx, emissiveIntensity: 0.3 })); p.position.z = 0.04; g.add(p);
      halo(LED, 0, 0.05, 0.4, w * 2, g, 0.18);
      const im = new Image(); im.decoding = 'async';
      im.onload = () => { if (!vivo) return; const r = Math.max(cv.width / im.width, cv.height / im.height); gx.drawImage(im, (cv.width - im.width * r) / 2, (cv.height - im.height * r) / 2, im.width * r, im.height * r); tx.needsUpdate = true; };
      im.src = OBRAS[k % OBRAS.length];
    };
    const letrero = (x, y, z, rot, w, h) => {
      const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rot; mundo.add(g);
      const cv = document.createElement('canvas'); cv.width = 1024; cv.height = Math.round(1024 * h / w); const c2 = cv.getContext('2d');
      const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4;
      const dibuja = () => {
        c2.fillStyle = '#ece3d4'; c2.fillRect(0, 0, cv.width, cv.height); c2.fillStyle = '#17120f'; c2.textAlign = 'center'; c2.textBaseline = 'middle';
        c2.font = '800 ' + Math.round(cv.height * 0.5) + 'px Montserrat, system-ui, sans-serif'; if ('letterSpacing' in c2) c2.letterSpacing = '8px'; c2.fillText('RANUSE', cv.width / 2, cv.height * 0.42);
        c2.font = '600 ' + Math.round(cv.height * 0.12) + 'px Montserrat, system-ui, sans-serif'; if ('letterSpacing' in c2) c2.letterSpacing = '6px'; c2.fillStyle = '#6b5e50'; c2.fillText('DESIGN', cv.width / 2, cv.height * 0.82); tx.needsUpdate = true;
      };
      dibuja(); if (document.fonts?.ready) document.fonts.ready.then(() => { if (vivo) dibuja(); });
      caja3(w + 0.6, h + 0.6, 0.05, ME(LED, 1.1), 0, 0, -0.05, g, null, false); caja3(w + 0.14, h + 0.14, 0.06, '#17120f', 0, 0, -0.01, g, null, false);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tx, roughness: 0.7 })); p.position.z = 0.03; g.add(p);
      halo(LED, 0, 0, 0.5, w * 1.8, g, 0.16);
    };
    const charco = (x, z, w, d, o = 0.3) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: brillo, color: LED, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.135, z); mundo.add(m); return m; };
    const texC = {}; const sueloTex = (tipo, w, d) => { const k = tipo + w + 'x' + d; if (!texC[k]) { const t = texturaSuelo(tipo); t.repeat.set(w / 4, d / 4); texC[k] = t; } return texC[k]; };
    const VIDRIO = new THREE.MeshStandardMaterial({ color: '#bfe3f2', transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.1, depthWrite: false });
    const cristalH = (x0, z, x1, col) => { const w = x1 - x0, cx = (x0 + x1) / 2, v = new THREE.Mesh(new THREE.BoxGeometry(w, 3.0, 0.05), VIDRIO); v.position.set(cx, 1.6, z); mundo.add(v); caja3(w, 0.07, 0.1, ME(col, 1.8), cx, 3.15, z, mundo, null, false); caja3(w, 0.12, 0.12, '#1d1713', cx, 0.17, z, mundo, null, false); for (let px = x0; px <= x1 + 0.01; px += 3) caja3(0.07, 3.0, 0.1, '#1d1713', px, 1.6, z, mundo, null, false); };
    // una sala: suelo, paredes (oeste alta, fondo alto o de cristal, frente baja), cartel y grupo local (coordenadas 0..w, 0..d)
    const sala = (id, x, z, w, d, o = {}) => {
      const col = o.col || DEP[id]?.c || TAUPE, cx = x + w / 2, cz = z + d / 2, delante = o.delante !== false, dep = data.departamentos.find(q => q.id === id);
      const piso = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: sueloTex(o.suelo || 'madera', w, d), roughness: 0.5, metalness: 0.1 })); piso.rotation.x = -Math.PI / 2; piso.position.set(cx, 0.1, cz); piso.receiveShadow = true; raiz.add(piso);
      marcar(piso, { tipo: 'sala', id, nombre: o.titulo || DEP[id]?.nombre || id, ir: dep?.ir, datos: dep?.datos || [], detalle: dep?.detalle || [], alerta: dep?.alerta || 'verde' });
      contorno(cx, cz, w - 0.4, d - 0.4, col, 0.14); charco(cx, cz, w * 1.05, d * 1.05, 0.14);
      paredV(x, z, d, MUR, col); if (o.este) paredV(x + w, z, d, MUR, col);
      if (delante) { cristalH(x, z, x + w, col); paredH(x, z + d, w, 0.55, col); } else { paredH(x, z, w, MUR, col); paredH(x, z + d, w, 0.55, col); }
      anclas[id] = new THREE.Vector3(cx, 5.2, cz);
      const cartel = etiqueta(o.titulo || DEP[id].nombre, { fs: 26, punto: dep ? LUZ[dep.alerta || 'verde'] : col, borde: 'rgba(60,50,40,0.14)' }); cartel.position.set(cx, o.alto || 5.4, cz); raiz.add(cartel);
      const g = new THREE.Group(); g.position.set(x, 0, z); raiz.add(g); salas[id] = g; return g;
    };

    // ── gente por sala según su rol ──
    const avDe = (p) => p.avatar || {};
    const punto = (info, x, z, color, opts) => {
      const g = persona({ av: avDe(info), id: info.id || info.nombre, ...opts }); g.position.set(x, 0.1, z); if (opts.rot != null) g.rotation.y = opts.rot; mundo.add(g);
      aro3(0.62, color, x, 0.16, z, mundo); halo(color, x, 0.3, z, 1.8, mundo, 0.55);
      const diana = new THREE.Mesh(G('diana', () => new THREE.CylinderGeometry(0.7, 0.7, 2.3, 10)), new THREE.MeshBasicMaterial({ visible: false })); diana.position.set(0, 1.1, 0); g.add(diana);
      marcar(g, info); return g;
    };
    const perso = data.personas || [], rolDe = p => String(p.rol || '').toLowerCase();
    const salaDe = p => { const r = rolDe(p) + ' ' + String(p.nombre || '').toLowerCase(); if (/market|redes|social|content|comunic/.test(r)) return 'marketing'; if (/comercial|ventas|setter/.test(r)) return 'ventas'; if (/presup/.test(r)) return 'presupuestos'; if (/financ|contab/.test(r)) return 'finanzas'; if (/admin|direc|socio|gerente|ceo/.test(r)) return 'direccion'; if (/dise|arquit|interior/.test(r)) return 'diseno'; return 'equipo'; };
    const gr = { marketing: [], ventas: [], presupuestos: [], finanzas: [], direccion: [], diseno: [], equipo: [] }; perso.forEach(p => gr[salaDe(p)].push(p));
    const sobran = [];
    const sentar = (p, x, z) => { mesaOf(x, z - 1.0, 0); sillaOf(x, z, Math.PI); punto({ tipo: 'persona', ...p }, x, z, luzPersona(p), { sentado: true, rot: Math.PI }); nombre(p, x, z, 3.1, luzPersona(p)); };
    const ocupa = (p, x, z, rot) => { punto({ tipo: 'persona', ...p }, x, z, luzPersona(p), { sentado: true, rot }); nombre(p, x, z, 3.1, luzPersona(p)); };
    const pone = (id, lista, asientos) => lista.forEach((p, k) => (k < asientos.length ? sentar(p, asientos[k][0], asientos[k][1]) : sobran.push(p)));
    const mesaGrande = (cx, cz, ancho, fondo, n, color = '#1a1a1e') => { caja3(ancho, 0.1, fondo, color, cx, 0.82, cz, mundo, { roughness: 0.3 }); [-1, 1].forEach(sx => cil(0.1, 0.72, '#222', cx + sx * (ancho / 2 - 0.5), 0.46, cz)); const por = Math.ceil(n / 2); for (let i = 0; i < n; i++) { const arriba = i < por, k = arriba ? i : i - por, tot = arriba ? por : n - por; sillaOf(cx - (tot - 1) * 0.6 + k * 1.2, cz + (arriba ? -(fondo / 2 + 0.7) : fondo / 2 + 0.7), arriba ? 0 : Math.PI); } };

    // fila de DELANTE: el camino del proyecto (z 3 a 16)
    const sRec = sala('recepcion', -42, 3, 16, 13, { titulo: 'Recepción', col: '#d9c8b2', suelo: 'marmol', alto: 6.2 });
    const sMar = sala('marketing', -26, 3, 12, 13, { titulo: '1 · Marketing y redes' });
    const sVen = sala('ventas', -14, 3, 12, 13, { titulo: '2 · Ventas y leads', alto: 7.4 });
    const sPre = sala('presupuestos', -2, 3, 12, 13, { titulo: '3 · Presupuestos' });
    const sDis = sala('diseno', 10, 3, 28, 13, { titulo: '4 · Estudio de diseño', este: true, alto: 7.4 });
    // fila de DETRÁS: apoyo (z -16 a -3)
    const sDir = sala('direccion', -42, -16, 14, 13, { delante: false, suelo: 'marmol' });
    const sFin = sala('finanzas', -28, -16, 12, 13, { delante: false, suelo: 'gres', alto: 7.4 });
    const sEq = sala('equipo', -16, -16, 14, 13, { delante: false, titulo: 'Sala del equipo y café' });
    const sJun = sala('juntas', -2, -16, 12, 13, { delante: false, titulo: 'Sala de juntas', col: '#8fa0b0', suelo: 'marmol', alto: 7.4 });
    const sRen = sala('renders', 10, -16, 14, 13, { delante: false, titulo: 'Sala de renders', col: '#c98fa3', suelo: 'madera' });
    const sMat = sala('materiales', 24, -16, 14, 13, { delante: false, titulo: 'Materioteca', col: '#c46a4f', suelo: 'gres', este: true, alto: 7.4 });
    sRec.add(new THREE.Group());

    en(sRec, () => {
      letrero(8, 3.4, 0.2, 0, 9.6, 2.4);
      caja3(5.6, 1.05, 1.2, '#1a1a1e', 8, 0.62, 5.4); caja3(5.8, 0.08, 1.4, TAUPE, 8, 1.17, 5.4, mundo, { metalness: 0.6, roughness: 0.3 }); caja3(5.2, 0.03, 0.05, ME(LED, 1.6), 8, 0.9, 6.02, mundo, null, false);
      { const pg = persona({ id: 'recepcion', av: { ropa: '#33425b', pelo: 'largo', peloColor: '#3b2a20' } }); pg.position.set(8, 0.1, 4.3); pg.rotation.y = 0; mundo.add(pg); }
      alfombra(8, 9, 12, 5.4, '#cfc6b8'); sofa(4, 11.4, Math.PI, '#3a3f4b'); sofa(12, 11.4, Math.PI, '#3a3f4b'); caja3(1.8, 0.1, 0.9, '#222', 8, 0.5, 9.6); caja3(1.4, 0.04, 0.6, '#e8e2d8', 8, 0.58, 9.6, mundo, null, false);
      estante(2.6, 0.32, 0, 3.2); estante(13.4, 0.32, 0, 3.2); planta(1, 12.2, 1.4); planta(15, 12.2, 1.4); planta(1, 2.2, 1.2); planta(15, 2.2, 1.2); lampara(4.5, 7); lampara(11.5, 7);
    });
    en(sMar, () => {
      pone('marketing', gr.marketing, [[3.2, 6.5], [6.6, 6.5]]);
      pantalla(4, 2.2, 0.2, 0, 4.6, 1.9, '#5a2a3a'); caja3(3.6, 2.8, 0.06, '#d9cdb8', 9.4, 1.5, 0.2); caja3(1.0, 1.2, 0.26, ME('#fff6e6', 1.5), 7.6, 1.9, 2.8, mundo, null, false); cil(0.03, 1.3, '#222', 7.6, 0.75, 2.8); caja3(0.5, 0.05, 0.5, '#222', 7.6, 0.12, 2.8);
      cil(0.03, 1.5, '#222', 10.8, 0.85, 4.2); { const aro = new THREE.Mesh(G('aroLuz', () => new THREE.TorusGeometry(0.3, 0.035, 8, 28)), ME('#fff6e6', 1.8)); aro.position.set(10.8, 1.7, 4.2); mundo.add(aro); } caja3(0.34, 0.26, 0.3, '#18181c', 10.8, 1.1, 4.7);
      alfombra(5, 7.3, 8, 4.6, '#e6d4cf'); sofa(3.4, 11.3, Math.PI, '#8c5a5a'); esf(0.4, '#c98fa3', 8.8, 0.55, 11.2); planta(0.9, 12.2, 1.1); planta(11.1, 12.2, 1.1); lampara(11, 9);
    });
    en(sVen, () => {
      pone('ventas', gr.ventas, [[2.8, 5.5], [6, 5.5], [9.2, 5.5], [4.2, 9.5], [7.6, 9.5]]);
      pantalla(6, 2.2, 0.2, 0, 5, 1.9, '#1d4a66'); alfombra(6, 7.5, 9, 6, '#d7cfc3'); planta(0.9, 12.2); planta(11.1, 12.2); planta(11.1, 2); estante(1.7, 0.32, 0, 2.6);
    });
    en(sPre, () => {
      mesaGrande(6, 7, 4.2, 2.2, 6);
      gr.presupuestos.forEach((p, i) => { if (i < 6) { const por = 3, arriba = i < por, k = arriba ? i : i - por; ocupa(p, 6 - 1.2 + k * 1.2, 7 + (arriba ? -1.8 : 1.8), arriba ? Math.PI : 0); } else sobran.push(p); });
      pantalla(6, 2.2, 0.2, 0, 4.6, 1.8, '#3a2a66'); [1.2, 2.4, 3.6].forEach(x => caja3(1, 1.5, 0.6, '#34343c', x, 0.85, 0.55)); planta(11.1, 12.2); planta(0.9, 12.2); alfombra(6, 7, 7.5, 5, '#d7cfc3');
    });
    en(sDis, () => {
      pone('diseno', gr.diseno, [[2.5, 5.5], [5.5, 5.5], [8.5, 5.5], [2.5, 9.5], [5.5, 9.5], [8.5, 9.5]]);
      estante(3, 0.32, 0, 4.4); estante(8.2, 0.32, 0, 3.6); pantalla(12, 2.2, 0.2, 0, 3.4, 1.6, '#1f3a66'); alfombra(5.5, 7.5, 10, 7, '#cfc6b8'); lampara(0.8, 3.2);
      mesaGrande(21, 6.8, 5.2, 2, 8, '#ece8e1'); pantalla(21, 2.3, 0.2, 0, 6.4, 2.3, '#1f3a66'); alfombra(21, 6.8, 9.5, 6.4, '#d7cfc3'); sofa(25, 11.5, Math.PI, '#4a4540'); caja3(1.2, 0.1, 0.8, '#222', 25, 0.5, 10.2);
      planta(26.8, 1.4, 1.2); planta(26.8, 12.2, 1.2); planta(13.4, 12.2, 1.1); planta(0.9, 12.2, 1.1); lampara(26.6, 7);
    });
    en(sDir, () => {
      pone('direccion', gr.direccion, [[4.5, 6.6], [9.5, 6.6]]);
      estante(3.2, 0.32, 0, 3); estante(10.8, 0.32, 0, 3); pantalla(7, 2.2, 0.2, 0, 3.6, 1.5, '#3a2a66'); alfombra(7, 7.3, 10, 6, '#cfc6b8'); sofa(7, 11.3, Math.PI, '#3a3f4b'); caja3(1.4, 0.1, 0.8, '#222', 7, 0.5, 9.9);
      planta(1, 12.2, 1.2); planta(13, 12.2, 1.2); lampara(12.6, 2.6); cuadro(1.1, 2.1, 6, Math.PI / 2, 1.8, 1.2, 0);
    });
    en(sFin, () => {
      [3, 6, 9].forEach((x, k) => { const p = gr.finanzas[k]; if (k < 2 && p) sentar(p, x, 6.6); else if (k === 2 && gr.finanzas[2]) sobran.push(gr.finanzas[2]); });
      [1.2, 2.4, 3.6, 4.8].forEach(x => caja3(1, 1.5, 0.6, '#34343c', x, 0.85, 0.55)); pantalla(8.6, 2.2, 0.2, 0, 3.4, 1.5, '#1f5a3c'); alfombra(6, 8, 8, 5, '#d7cfc3'); planta(0.9, 12.2); planta(11.1, 12.2);
    });
    en(sEq, () => {
      caja3(6.4, 1.0, 0.8, '#1a1a1e', 4.2, 0.62, 0.9); caja3(6.6, 0.08, 1.0, TAUPE, 4.2, 1.15, 0.9, mundo, { metalness: 0.6 }); [1.8, 3.2, 4.6, 6].forEach(x => { cil(0.2, 0.06, '#333', x, 0.8, 2.2); cil(0.04, 0.7, '#555', x, 0.42, 2.2); });
      const lounge = [[3, 9.4, 0.6], [6.4, 10.6, -0.5], [9.6, 9.8, 2.2], [11.4, 11.2, 0.2], [12.4, 8.2, 3]];
      [...gr.equipo, ...sobran].slice(0, lounge.length).forEach((p, k) => { const [x, z, r] = lounge[k]; punto({ tipo: 'persona', ...p }, x, z, luzPersona(p), { sentado: false, rot: r }); nombre(p, x, z, 3.1, luzPersona(p)); });
      sofa(4, 6.2, 0, '#4a4540'); sofa(10, 6.2, 0, '#4a4540'); caja3(1.6, 0.1, 0.9, '#222', 7, 0.5, 7.6); alfombra(7, 7.6, 11, 4.6, '#d9c8b2'); planta(0.9, 12.2, 1.2); planta(13.1, 12.2, 1.2); planta(13.1, 2.2, 1.2); lampara(13, 5);
    });
    en(sJun, () => { mesaGrande(6, 7, 6, 2, 10, '#1a1a1e'); pantalla(6, 2.3, 0.2, 0, 5.4, 2, '#1f3a66'); caja3(2.6, 1.6, 0.05, '#f1eee8', 10.6, 1.6, 0.2, mundo, null, false); alfombra(6, 7, 9.5, 6, '#cfc6b8'); planta(0.9, 12.2); planta(11.1, 12.2); planta(0.9, 2); });
    en(sRen, () => {
      cuadro(7, 2.5, 0.2, 0, 8.6, 3.2, 3); [[4, 6.5], [10, 6.5], [4, 9.6], [10, 9.6]].forEach(([x, z]) => sofa(x, z, Math.PI, '#2a2f3a')); alfombra(7, 8, 11, 6, '#3a3f4b'); lampara(0.9, 3); lampara(13.1, 3); planta(0.9, 12.2); planta(13.1, 12.2);
    });
    en(sMat, () => {
      for (let i = 0; i < 6; i++) ['#e8e2d8', '#c9bfae', '#a97f55', '#46695e', '#8c3b36', '#33425b'].slice(i % 3, (i % 3) + 4).forEach((c, k) => caja3(0.34, 0.5, 0.1, c, 1.6 + i * 1.9 + (k % 2) * 0.01, 0.55 + k * 0.62, 0.35, mundo, null, false));
      for (let i = 0; i < 6; i++) { caja3(1.7, 0.05, 0.3, '#2a2622', 1.9 + i * 1.9 - 0.3, 0.3, 0.32, mundo, null, false); }
      caja3(4.6, 0.1, 1.8, '#ece8e1', 7, 0.82, 7); [-1.9, 1.9].forEach(dx => cil(0.1, 0.72, '#222', 7 + dx, 0.46, 7)); ['#e8e2d8', '#a97f55', '#46695e', '#8c3b36'].forEach((c, i) => caja3(0.6, 0.06, 0.6, c, 5.6 + i * 0.95, 0.9, 7, mundo, null, false));
      alfombra(7, 7, 8, 5, '#d7cfc3'); planta(0.9, 12.2); planta(13.1, 12.2);
    });
    // agentes de IA en su sala
    const puestoAg = { diseno: [[13.2, 10.2], [16.6, 10.2]], ventas: [[10.4, 10.4]], presupuestos: [[6, 11.5]], finanzas: [[6, 6.6]] };
    const nAg = {};
    (data.agentes || []).forEach(a => { const lis = puestoAg[a.sala], g = salas[a.sala]; if (!lis || !g) return; const k = nAg[a.sala] || 0, pt = lis[Math.min(k, lis.length - 1)]; nAg[a.sala] = k + 1; en(g, () => { mesaOf(pt[0], pt[1] - 1.0, 0); sillaOf(pt[0], pt[1], Math.PI); punto({ tipo: 'agente', ...a }, pt[0], pt[1], '#6fd0ff', { sentado: true, robot: true, rot: Math.PI }); rotulo(a.id === 'diseno' ? 'Alzados' : a.nombre.replace('Asistente de ', '').replace('Asistente ', ''), pt[0], 3.1, pt[1], { fs: 22, color: '#1f5d7a' }, 80); }); });

    // pasillo central y pasarela del camino, con la entrada de Ranuse
    pavimento(-2, 0, 82, 6, '#2d2823'); pavimento(4.5, 19.5, 96, 5.4, '#26211d');
    [17, 22].forEach(z => caja3(96, 0.05, 0.12, ME(LED, 1.0), 4.5, 0.14, z, raiz, null, false));
    [-30, -14, 6, 24].forEach(x => planta(x, 0, 1.1)); [-36, -18, 0, 18, 36].forEach(x => planta(x, 22.6, 0.9));
    caja3(0.5, 4.4, 0.5, '#1d1713', -42.5, 2.3, 19.5, raiz); caja3(0.5, 4.4, 0.5, '#1d1713', -37.5, 2.3, 19.5, raiz); caja3(5.5, 0.5, 0.7, '#1d1713', -40, 4.6, 19.5, raiz); caja3(5.0, 0.08, 0.5, ME(LED, 2.2), -40, 4.3, 19.5, raiz, null, false);
    rotulo('Bienvenido a Ranuse', -40, 5.9, 19.5, { fs: 24 });
    // camino de luz con flechas y puntos que se mueven
    const camino = (pts, ancho = 0.5) => {
      const seg = [], tot = []; let acum = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az), g = new THREE.Group();
        g.position.set((ax + bx) / 2, 0.19, (az + bz) / 2); g.rotation.y = Math.atan2(bx - ax, bz - az); raiz.add(g);
        caja3(ancho, 0.04, L, ME(LED, 1.6), 0, 0, 0, g, null, false);
        const n = Math.max(1, Math.floor(L / 3)); for (let k = 0; k < n; k++) { const co = new THREE.Mesh(G('flechaC', () => new THREE.ConeGeometry(0.55, 1.1, 4)), ME('#fff1d6', 1.8)); co.rotation.x = Math.PI / 2; co.scale.z = 0.25; co.position.set(0, 0.05, -L / 2 + (k + 0.5) * L / n); g.add(co); }
        seg.push([ax, az, bx, bz, L]); tot.push(acum); acum += L;
      }
      const en2 = (u) => { const d = u * acum; let i = seg.length - 1; for (let k = 0; k < seg.length; k++) if (d <= tot[k] + seg[k][4]) { i = k; break; } const [ax, az, bx, bz, L] = seg[i], f = Math.min(1, Math.max(0, (d - tot[i]) / L)); return [ax + (bx - ax) * f, az + (bz - az) * f]; };
      caminos.push({ en: en2, pulsos: Array.from({ length: 14 }, () => halo('#fff1d6', 0, 0.5, 0, 1.3, raiz, 0.9)) });
    };
    const disco = (n, x, z, color, texto) => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 256; const c = cv.getContext('2d'); c.fillStyle = '#17120f'; c.beginPath(); c.arc(128, 128, 120, 0, 7); c.fill(); c.strokeStyle = color; c.lineWidth = 12; c.beginPath(); c.arc(128, 128, 112, 0, 7); c.stroke();
      c.fillStyle = '#ffffff'; c.font = '800 150px Montserrat, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(n), 128, 140);
      const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; const m = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshBasicMaterial({ map: tx, transparent: true })); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.24, z); raiz.add(m);
      halo(color, x, 0.4, z, 5.5, raiz, 0.35); rotulo(texto, x, 2.1, z + 1.2, { fs: 22, punto: color }, 140);
    };
    disco(1, -20, 19.5, DEP.marketing.c, 'Marketing: atrae clientes'); disco(2, -8, 19.5, DEP.ventas.c, 'Ventas: los convierte'); disco(3, 4, 19.5, DEP.presupuestos.c, 'Presupuesto'); disco(4, 24, 19.5, DEP.diseno.c, 'Diseño del proyecto');
    // ── proyectos: un gym por proyecto (sólido), que sale del suelo y se conecta con los departamentos ──
    const equipo = (tipo, g, ox, oz) => {
      if (tipo === 0) { [-0.8, 0.8].forEach(s => caja3(0.12, 2.3, 0.12, '#3a3a42', ox + s, 1.25, oz, g, { metalness: 0.7, roughness: 0.4 })); caja3(1.8, 0.12, 0.14, '#3a3a42', ox, 2.4, oz, g, { metalness: 0.7 }); caja3(2.4, 0.08, 1.8, '#6b4a2f', ox, 0.14, oz + 0.2, g); cil(0.03, 2.2, '#c7c7cf', ox, 1.35, oz + 0.2, g, { metalness: 0.9 }).rotation.z = Math.PI / 2; [-1, 1].forEach(s => cil(0.28, 0.06, '#18181c', ox + s * 1.0, 1.35, oz + 0.2, g).rotation.z = Math.PI / 2); }
      else if (tipo === 1) { caja3(0.9, 0.16, 2.1, '#18181c', ox, 0.32, oz, g); caja3(0.9, 0.06, 1.9, GRAFITO, ox, 0.44, oz, g); caja3(0.1, 1.1, 0.1, '#3a3a42', ox - 0.4, 0.95, oz - 0.95, g); caja3(0.1, 1.1, 0.1, '#3a3a42', ox + 0.4, 0.95, oz - 0.95, g); caja3(0.7, 0.34, 0.06, '#0e0e11', ox, 1.45, oz - 0.95, g, { emissive: '#4be3a0', emissiveIntensity: 0.5 }, false); }
      else if (tipo === 2) { caja3(0.62, 0.14, 1.5, '#18181c', ox, 0.42, oz, g); caja3(0.62, 0.5, 0.14, '#18181c', ox, 0.72, oz - 0.6, g); [0.4, 0.8].forEach((y, i) => caja3(2.0, 0.05, 0.5, '#3a3a42', ox + 1.8, y, oz - 0.3, g, { metalness: 0.7 })); for (let i = 0; i < 5; i++) { cil(0.1, 0.3, '#18181c', ox + 1.0 + i * 0.4, 0.62, oz - 0.3, g).rotation.z = Math.PI / 2; cil(0.1, 0.3, '#18181c', ox + 1.0 + i * 0.4, 1.02, oz - 0.3, g).rotation.z = Math.PI / 2; } }
      else { caja3(1.2, 2.3, 0.8, '#3a3a42', ox, 1.3, oz, g, { metalness: 0.6 }); for (let i = 0; i < 8; i++) caja3(0.8, 0.1, 0.5, '#18181c', ox, 0.5 + i * 0.2, oz, g); cil(0.03, 1.2, '#c7c7cf', ox + 0.9, 1.4, oz + 0.2, g, { metalness: 0.9 }); }
    };
    const obrero = (gg, x, z, rot, id, o = {}) => { const pg = persona({ av: { ropa: ['#33425b', '#46695e', '#6b6259', '#8c3b36'][hash(id) % 4] }, id, casco: true, chaleco: true, ...o }); pg.position.set(x, 0.1, z); pg.rotation.y = rot; gg.add(pg); return pg; };
    // lo que se ve dentro de cada proyecto depende de su fase: diseñadores, planos, instalaciones, acabados, montaje de máquinas, entrega
    const escenaFase = (f, gg, W, D, id, comercial) => en(gg, () => {
      const bz = -D / 2, h0 = hash(id), hw = W / 2;
      if (f === 0) { mesaOf(0.6, bz + 1.5, 0); sillaOf(0.6, bz + 2.4, Math.PI); obrero(gg, 0.6, bz + 2.4, Math.PI, id, { sentado: true, casco: false, chaleco: false }); alfombra(-1.4, 0.6, 2.4, 1.8, '#cfc6b8'); caja3(1.0, 0.7, 0.04, '#e8e2d8', -2.2, 1.3, bz + 0.5, gg, null, false); }
      else if (f === 1) { caja3(2.4, 0.07, 1.3, '#ece8e1', 0, 0.88, 0.2, gg, { roughness: 0.3 }); [-1, 1].forEach(sx => [-0.5, 0.5].forEach(sz => cil(0.04, 0.8, '#222', sx * 1.05, 0.5, 0.2 + sz, gg))); caja3(2.0, 0.012, 1.0, '#8fb4e0', 0, 0.93, 0.2, gg, { emissive: '#3a6aa8', emissiveIntensity: 0.35 }, false); obrero(gg, -1.9, 0.3, Math.PI / 2, id + 'a', { casco: false, chaleco: false }); obrero(gg, 1.9, 0.3, -Math.PI / 2, id + 'b', { casco: false, chaleco: false }); }
      else if (f === 2) { obrero(gg, -1.5, 0.4, 0.6, id + 'a'); obrero(gg, 1.6, 1.0, -0.9, id + 'b'); caja3(1.0, 1.3, 0.16, '#9aa3ab', -1.8, 1.7, bz + 0.3, gg, { metalness: 0.4 }); [0, 1, 2].forEach(i => caja3(0.12, 0.12, 0.04, ME(['#4be3a0', '#ffb347', '#ff6b57'][i], 1.5), -2.1 + i * 0.3, 1.75, bz + 0.4, gg, null, false)); cil(0.5, 0.3, '#e0c24a', 0.2, 0.28, bz + 1.0, gg); cil(0.2, 0.34, '#555', 0.2, 0.3, bz + 1.0, gg); caja3(0.06, 0.03, 2.2, '#17171b', -0.6, 0.14, 0.2, gg, null, false); }
      else if (f === 3) { ['#e8e2d8', '#c9bfae', '#8c3b36', '#46695e', '#a97f55'].forEach((c, i) => caja3(0.8, 2.0, 0.08, c, -hw + 1.0 + i * 0.95, 1.1, bz + 0.5, gg)); obrero(gg, 0.2, 0.9, Math.PI, id + 'a', { chaleco: false }); [0, 1].forEach(i => cil(0.2, 0.34, ['#e0705a', '#5fb0cf'][i], 1.4 + i * 0.6, 0.28, 1.6, gg)); caja3(1.0, 0.06, 0.8, '#ece8e1', -1.6, 0.7, 1.3, gg); }
      else {
        const t1 = h0 % 4, ox1 = [-1.6, -2.2, -2.4, -2.2][t1]; equipo(t1, gg, ox1, bz + 1.7);
        if (comercial) { const t2 = [0, 1, 3][(h0 >> 2) % 3]; equipo(t2, gg, hw - 1.4, bz + 1.7); }
        if (f === 4) { obrero(gg, -1.2, 1.4, Math.PI, id + 'a'); obrero(gg, 1.2, 1.4, Math.PI, id + 'b'); caja3(0.7, 0.4, 0.5, '#d97b29', 0, 0.35, 1.9, gg); }
        else { obrero(gg, 0, 1.5, Math.PI, id + 'a', { casco: false, chaleco: false }); caja3(1.5, 0.8, 0.06, ME('#4be3a0', 1.1), 0, 1.6, bz + 0.34, gg, null, false); }
      }
    });
    const PXP = 9.2, PZP = 8.8, Z0 = -12;
    const faseDe = p => Math.min(5, Math.max(0, Number(p.fase) || 0));
    const porFaseP = [[], [], [], [], [], []]; data.proyectos.slice(0, 24).forEach(p => porFaseP[faseDe(p)].push(p));
    const colsP = []; let cur = 52;
    porFaseP.forEach(lista => { const sub = lista.length ? Math.ceil(lista.length / 4) : 0, ancho = sub ? sub * PXP : 5; colsP.push({ x0: cur, ancho }); cur += ancho + 1.2; });
    centroProy = (52 + cur) / 2; distProy = Math.max(48, (cur - 52) * 0.85);
    const lugar = {}; porFaseP.forEach((lista, f) => lista.forEach((p, k) => { lugar[p.id] = [colsP[f].x0 + (Math.floor(k / 4) + 0.5) * PXP, Z0 + (k % 4) * PZP]; }));
    colsP.forEach((c, f) => {
      const cx = c.x0 + c.ancho / 2, zona = new THREE.Mesh(new THREE.PlaneGeometry(c.ancho - 0.4, 38), new THREE.MeshBasicMaterial({ color: FCOL[f], transparent: true, opacity: 0.05, depthWrite: false })); zona.rotation.x = -Math.PI / 2; zona.position.set(cx, 0.07, 1.6); raiz.add(zona);
      caja3(c.ancho - 0.4, 0.05, 1.1, ME(FCOL[f], 1.3), cx, 0.14, -16.6, raiz, null, false);
      rotulo(f + ' · ' + FASES_L[f] + ' · ' + porFaseP[f].length, cx, f % 2 ? 6.4 : 1.7, -16.6, { fs: 22, punto: FCOL[f] }, 125);
    });
    camino([[-40, 19.5], [49, 19.5], [49, -19.5], [cur - 1, -19.5]]);
    rotulo('5 · Sale a obra', 49, 2.2, 12, { fs: 22, color: '#7a5a1f' }, 100);
    porFaseP.flat().forEach((p, i) => {
      const [gx, gz] = lugar[p.id], comercial = p.tipo === 'comercial', W = comercial ? 7.4 : 6, D = comercial ? 6.2 : 5, col = LUZ[p.semaforo];
      posProy[p.id] = new THREE.Vector3(gx, 0, gz);
      const gg = new THREE.Group(); gg.position.set(gx, 0, gz); mundo.add(gg);
      { const lz = charco(0, 0, W + 1.5, D + 1.5, 0.28); gg.add(lz); lz.position.set(0, 0.135, 0); }
      caja3(W + 0.8, 0.3, D + 0.8, '#2a2622', 0, -0.05, 0, gg, { roughness: 0.6 }, false).receiveShadow = true;
      const piso = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: sueloTex('caucho', W, D), roughness: 0.9 })); piso.rotation.x = -Math.PI / 2; piso.position.y = 0.11; piso.receiveShadow = true; gg.add(piso);
      caja3(W, 3.2, 0.26, GRAFITO, 0, 1.7, -D / 2, gg); caja3(0.26, 3.2, D, GRAFITO, -W / 2, 1.7, 0, gg); caja3(W, 0.6, 0.26, GRAFITO, 0, 0.4, D / 2, gg); caja3(0.26, 0.6, D, GRAFITO, W / 2, 0.4, 0, gg);
      const tira = caja3(W + 0.3, 0.1, 0.34, ME(col, 1.4), 0, 3.35, -D / 2, gg, null, false); caja3(0.34, 0.1, D + 0.3, ME(col, 1.4), -W / 2, 3.35, 0, gg, null, false); [[0, D / 2, W + 0.3, 0.34], [W / 2, 0, 0.34, D + 0.3]].forEach(([x, z, w, d]) => caja3(w, 0.08, d, ME(col, 1.2), x, 0.72, z, gg, null, false)); if (p.semaforo === 'rojo' || p.semaforo === 'ambar') pulsosAtencion.push(tira.material);
      const esp = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.62, 1.9), M('#b9c5cd', { metalness: 0.5, roughness: 0.22 })); esp.position.set(0, 1.5, -D / 2 + 0.15); gg.add(esp);
      escenaFase(faseDe(p), gg, W, D, p.id, comercial);
      const etq = rotulo(corto(p.nombre, 22) + ' · F' + (Number(p.fase) || 0), gx, 5.0, gz, { fs: 24, borde: 'rgba(60,50,40,0.14)', punto: col }, 80);
      marcar(gg, { tipo: 'proyecto', ...p }); gg.userData.proy = p.id; gg.scale.y = 0.001; subidas.push({ g: gg, retardo: 0.4 + i * 0.12 });
      (p.deps || ['diseno']).forEach(dp => {
        const A = anclas[dp]; if (!A) return; const B = new THREE.Vector3(gx, 4.6, gz), dx = B.x - A.x, dz = B.z - A.z;
        const curva = new THREE.CubicBezierCurve3(A.clone(), new THREE.Vector3(A.x + dx * 0.25, 14, A.z + dz * 0.25), new THREE.Vector3(B.x - dx * 0.25, 14, B.z - dz * 0.25), B);
        const mat = new THREE.LineBasicMaterial({ color: DEP[dp].c, transparent: true, opacity: 0.13, depthWrite: false }); mundo.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curva.getPoints(60)), mat));
        arcos.push({ pid: p.id, curva, mat, pulso: halo(DEP[dp].c, 0, 0, 0, 1.5, mundo, 0), fase: Math.random() });
      });
    });

    // ── proveedores: un almacén o una oficina por sector ──
    rotulo('Proveedores · tiendas por oficio y marca', 4, 5.6, 25.5, { fs: 30, borde: 'rgba(60,50,40,0.14)' });
    const ALMACEN = /madera|lamin|gym|sauna|rocod|constru|electric|reform/i;
    const propsAlmacen = (tipo, g, W, D) => {
      const caj = (c, x, y, z, w = 0.7, h = 0.5, d = 0.7) => caja3(w, h, d, c, x, y, z, g);
      const estantes = (n) => { for (let i = 0; i < n; i++) { const x = -W / 2 + 1.4 + i * 2.1; [-1, 1].forEach(s => caja3(0.08, 3.0, 0.08, '#4a5568', x + s * 0.9, 1.6, -D / 2 + 0.7, g, { metalness: 0.6 })); [0.5, 1.5, 2.5].forEach(y => { caja3(1.9, 0.07, 0.8, '#d97b29', x, y + 0.1, -D / 2 + 0.7, g, { metalness: 0.4 }); [0, 1].forEach(k => caj(['#c9a77a', '#a97f55', '#e2c9a4', '#8f6b45'][(i + k + Math.floor(y * 2)) % 4], x - 0.45 + k * 0.9, y + 0.42, -D / 2 + 0.7, 0.8, 0.55, 0.65)); }); } };
      if (tipo === 'tableros') { estantes(2); for (let k = 0; k < 7; k++) caja3(2.4, 0.12, 1.2, ['#c8a27a', '#a97f55', '#e2c9a4'][k % 3], W / 2 - 2.2, 0.35 + k * 0.14, 0.4, g); caja3(2.6, 0.1, 1.4, '#6b4a2f', W / 2 - 2.2, 0.17, 0.4, g); }
      else if (tipo === 'pesas') { estantes(2); for (let k = 0; k < 5; k++) { cil(0.32, 0.12, '#18181c', W / 2 - 2.2, 0.2 + k * 0.14, 0.6, g); } caja3(2.6, 0.9, 0.6, '#3a3a42', W / 2 - 2.2, 0.55, -1.2, g, { metalness: 0.6 }); }
      else if (tipo === 'ladrillos') { for (let k = 0; k < 4; k++) for (let j = 0; j < 5; j++) caj(k % 2 ? '#b0553d' : '#c46a4f', -W / 2 + 1.5 + j * 0.9, 0.3 + k * 0.5, -D / 2 + 1, 0.8, 0.45, 0.6); const co = new THREE.Mesh(G('cono', () => new THREE.ConeGeometry(0.3, 0.8, 16)), M('#f08a24')); co.position.set(W / 2 - 1.5, 0.5, 1.5); sombrear(co); g.add(co); estantes(1); }
      else if (tipo === 'cables') { estantes(2); [0, 1].forEach(k => { cil(0.55, 0.4, '#e0c24a', W / 2 - 2 + k * 1.2, 0.3, 0.8, g); cil(0.2, 0.44, '#555', W / 2 - 2 + k * 1.2, 0.32, 0.8, g); }); }
      else if (tipo === 'sauna') { caja3(3, 2.4, 2.4, '#c79a63', W / 2 - 2.4, 1.3, -0.4, g); caja3(0.9, 1.7, 0.08, '#8a6a46', W / 2 - 3, 1, 0.82, g); estantes(1); }
      else if (tipo === 'rocodromo') { caja3(4, 2.6, 0.24, '#6a7780', -W / 2 + 2.5, 1.5, -D / 2 + 0.5, g); ['#e0705a', '#e0c24a', '#5fb0cf', '#7fbf6f', '#c06bd8'].forEach((c, k) => esf(0.1, c, -W / 2 + 1.3 + (k % 3) * 1.1, 0.8 + k * 0.35, -D / 2 + 0.68, g)); estantes(1); }
      else estantes(2);
    };
    const WA = 13, DA = 9.5, PAA = 15.6, ZA = [28, 41];
    (data.anexos || []).slice(0, 10).forEach((a, k) => {
      const fila = k < 5 ? 0 : 1, col = fila ? k - 5 : k, ax = -20 + col * PAA + WA / 2, az = ZA[fila] + DA / 2, esAlmacen = ALMACEN.test(a.sector);
      const gA = new THREE.Group(); gA.position.set(ax, 0, az); mundo.add(gA);
      caja3(WA + 1, 0.3, DA + 1, '#17171b', 0, -0.05, 0, gA, { roughness: 0.6 }, false).receiveShadow = true; contorno(ax, az, WA + 0.8, DA + 0.8, TAUPE, 0.1);
      charco(ax, az, WA * 1.1, DA * 1.1, 0.22); const piso = new THREE.Mesh(new THREE.PlaneGeometry(WA, DA), new THREE.MeshStandardMaterial({ map: sueloTex(esAlmacen ? 'caucho' : 'madera', WA, DA), roughness: 0.6, metalness: 0.05 })); piso.rotation.x = -Math.PI / 2; piso.position.y = 0.11; piso.receiveShadow = true; gA.add(piso);
      marcar(piso, { tipo: 'anexo', sector: a.sector, n: a.n, proveedores: a.proveedores, ir: 'contactos' });
      const alto = esAlmacen ? 4.2 : 3.4;
      caja3(WA, alto, 0.28, GRAFITO, 0, alto / 2 + 0.1, -DA / 2, gA); caja3(0.28, alto, DA, GRAFITO, -WA / 2, alto / 2 + 0.1, 0, gA); caja3(WA, 0.55, 0.28, GRAFITO, 0, 0.38, DA / 2, gA); caja3(0.28, 0.55, DA, GRAFITO, WA / 2, 0.38, 0, gA);
      { const TOLDO = ['#c46a4f', '#46695e', '#33425b', '#a97f55', '#8c3b36'][hash(a.sector) % 5]; const t1 = caja3(WA + 0.4, 0.1, 1.5, TOLDO, 0, 3.35, DA / 2 + 0.55, gA); t1.rotation.x = 0.28; }
      caja3(WA + 0.3, 0.1, 0.36, ME(TAUPE, 1.2), 0, alto + 0.15, -DA / 2, gA, null, false); caja3(0.36, 0.1, DA + 0.3, ME(TAUPE, 1.2), -WA / 2, alto + 0.15, 0, gA, null, false);
      if (esAlmacen) { caja3(4, 3.2, 0.1, '#1a1a1e', WA / 2 - 3.2, 1.8, -DA / 2 + 0.16, gA); for (let r = 0; r < 8; r++) caja3(3.9, 0.04, 0.12, '#3a3a42', WA / 2 - 3.2, 0.6 + r * 0.38, -DA / 2 + 0.2, gA, null, false); } else { [-3, 0, 3].forEach(x => ventana(x, 1.9, -DA / 2 + 0.16, 0, 2, 1.2)); }
      const cfg = ((s) => (/ilumin/i.test(s) ? 'lamparas' : /gym|fitness/i.test(s) ? 'pesas' : /madera|lamin/i.test(s) ? 'tableros' : /sauna/i.test(s) ? 'sauna' : /rocod/i.test(s) ? 'rocodromo' : /constru|reform/i.test(s) ? 'ladrillos' : /electric/i.test(s) ? 'cables' : /pintor/i.test(s) ? 'pintura' : /revest|moldur/i.test(s) ? 'paneles' : null))(a.sector);
      if (esAlmacen) propsAlmacen(cfg, gA, WA, DA);
      else if (cfg === 'lamparas') { [-4.5, -2, 0.5].forEach((x, i) => { cil(0.012, 1.4 + i * 0.3, '#222', x, alto - 0.6, -DA / 2 + 1.4, gA); esf(0.3, ME('#fff0c9', 1.2), x, alto - 1.4 - i * 0.3, -DA / 2 + 1.4, gA).castShadow = false; }); estante(-WA / 2 + 2.2, -DA / 2 + 0.5, 0, 3); }
      else if (cfg === 'pintura') { ['#e0705a', '#5fb0cf', '#e0c24a', '#7fbf6f', '#f1eee8', '#6b6259'].forEach((c, i) => [0, 1, 2].forEach(r => cil(0.24, 0.42, c, -WA / 2 + 1.5 + i * 0.7, 0.32 + r * 0.46, -DA / 2 + 0.8, gA))); }
      else { ['#ddd6ca', '#c9bfae', '#e8e2d8', '#b9ad99', '#a89c88'].forEach((c, i) => caja3(0.9, 2.2, 0.1, c, -WA / 2 + 1.5 + i * 1.1, 1.3, -DA / 2 + 0.4, gA)); }
      const sg = etiqueta(`${a.sector} · ${a.n}`, { fs: 24, borde: 'rgba(60,50,40,0.14)' }); sg.position.set(ax, alto + 1.6, az); mundo.add(sg);
      rotulo(esAlmacen ? 'Almacén' : 'Oficina', ax - WA / 2 + 1.2, alto + 0.9, az - DA / 2, { fs: 18, color: TAUPE }, 60);
      // stands con el logo de cada empresa y su representante
      const slots = [[-3.8, 1.2], [-1.2, 1.4], [1.4, 1.2], [4, 1.4], [-2.4, 3.2]];
      a.proveedores.slice(0, slots.length).forEach((pr, j) => {
        const sx = ax + slots[j][0], sz = az + slots[j][1], cv = document.createElement('canvas'); cv.width = 384; cv.height = 480; const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
        const dibujar = (img) => {
          const g = cv.getContext('2d'); g.fillStyle = '#1a1511'; g.fillRect(0, 0, 384, 480); g.strokeStyle = TAUPE; g.lineWidth = 5; g.strokeRect(8, 8, 368, 464);
          g.fillStyle = '#f4f1ec'; g.beginPath(); g.roundRect(72, 50, 240, 240, 22); g.fill();
          if (img) { const r = Math.min(190 / img.width, 190 / img.height); g.drawImage(img, 192 - (img.width * r) / 2, 170 - (img.height * r) / 2, img.width * r, img.height * r); }
          else { g.fillStyle = TAUPE; g.font = '700 96px Montserrat, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(pr.nombre.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase(), 192, 176); }
          g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '600 34px Montserrat, system-ui, sans-serif';
          const pal = pr.nombre.split(' '), lin = ['']; pal.forEach(w => { const tt = (lin[lin.length - 1] + ' ' + w).trim(); if (g.measureText(tt).width < 320 || !lin[lin.length - 1]) lin[lin.length - 1] = tt; else lin.push(w); });
          lin.slice(0, 3).forEach((tt, q) => g.fillText(tt, 192, 345 + q * 42));
        };
        dibujar(null);
        const st = new THREE.Group(); st.position.set(sx, 0.1, sz); st.rotation.y = 0.45; mundo.add(st);
        const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.0), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.35 })); panel.position.set(0, 1.45, 0); sombrear(panel); st.add(panel);
        caja3(1.7, 0.06, 0.1, TAUPE, 0, 0.42, 0, st, { metalness: 0.6 }, false); caja3(1.7, 0.06, 0.1, TAUPE, 0, 2.48, 0, st, { metalness: 0.6 }, false); [-0.82, 0.82].forEach(x => caja3(0.06, 2.1, 0.1, TAUPE, x, 1.45, 0, st, { metalness: 0.6 }, false));
        caja3(1.2, 0.9, 0.5, '#1a1a1e', 0, 0.5, 0.95, st); caja3(1.2, 0.05, 0.54, TAUPE, 0, 0.97, 0.95, st, { metalness: 0.6 });
        const rep = persona({ av: { ropa: ['#33425b', '#46695e', '#6b6259', '#1d1d22'][hash(pr.nombre) % 4] }, id: pr.nombre, casco: esAlmacen && /constru|electric|rocod|madera/i.test(a.sector), chaleco: esAlmacen && /constru|electric/i.test(a.sector) });
        rep.position.set(sx + 0.85, 0.1, sz + 0.55); rep.rotation.y = 0.4; mundo.add(rep);
        const info = { tipo: 'proveedor', nombre: pr.nombre, url: pr.url, sector: a.sector }; marcar(st, info); marcar(rep, info);
        const et = etiqueta(corto(pr.nombre, 22), { fs: 22 }); et.position.set(sx, 3.4, sz); mundo.add(et); et.userData.lod = 34; lod.push(et);
        if (pr.url) stands.push({ url: pr.url, dibujar, tex });
      });
      if (a.n > slots.length) { const mas = etiqueta(`+${a.n - slots.length} más`, { fs: 22 }); mas.position.set(ax + WA / 2 - 1.3, 0.9, az + DA / 2 - 1); mundo.add(mas); mas.userData.lod = 34; lod.push(mas); }
    });
    let vivo = true;
    if (cargarLogo) stands.forEach(st => { cargarLogo(st.url).then(b => createImageBitmap(b)).then(img => { if (vivo) { st.dibujar(img); st.tex.needsUpdate = true; } }).catch(() => {}); });

    // ── almacén del catálogo: una estantería por categoría, con cajas según los productos que hay ──
    const FAM = { E: ['Equipamiento de gym', '#baafa5'], R: ['Reformas y obra', '#c46a4f'], I: ['Iluminación', '#e0b25a'], M: ['Maderas y materiales', '#a97f55'], S: ['Servicios y otros', '#8f8a85'] };
    const cat = (data.catalogo || []).slice().sort((a, b) => 'ERIMS'.indexOf(a.familia) - 'ERIMS'.indexOf(b.familia));
    if (cat.length) {
      const CW = 58, CD = 28, cx0 = 4, cz0 = -37;
      caja3(CW + 1, 0.3, CD + 1, '#2a2622', cx0, -0.05, cz0, mundo, { roughness: 0.6 }, false).receiveShadow = true; contorno(cx0, cz0, CW + 0.8, CD + 0.8, TAUPE, 0.1);
      const tc = texturaSuelo('hormigon'); tc.repeat.set(CW / 4, CD / 4); const pc = new THREE.Mesh(new THREE.PlaneGeometry(CW, CD), new THREE.MeshStandardMaterial({ map: tc, roughness: 0.55 })); pc.rotation.x = -Math.PI / 2; pc.position.set(cx0, 0.11, cz0); pc.receiveShadow = true; mundo.add(pc);
      marcar(pc, { tipo: 'almacen', nombre: 'Almacén del catálogo', n: data.totalProductos || 0, categorias: cat.length, ir: 'catalogo' });
      const hN = 5.4; caja3(CW, hN, 0.28, GRAFITO, cx0, hN / 2 + 0.1, cz0 - CD / 2); caja3(0.28, hN, CD, GRAFITO, cx0 - CW / 2, hN / 2 + 0.1, cz0); caja3(CW, 0.6, 0.28, GRAFITO, cx0, 0.4, cz0 + CD / 2); caja3(0.28, 0.6, CD, GRAFITO, cx0 + CW / 2, 0.4, cz0);
      caja3(CW + 0.3, 0.1, 0.36, M(TAUPE, { metalness: 0.5 }), cx0, hN + 0.15, cz0 - CD / 2, mundo, null, false); caja3(0.36, 0.1, CD + 0.3, M(TAUPE, { metalness: 0.5 }), cx0 - CW / 2, hN + 0.15, cz0, mundo, null, false);
      for (let k = 0; k < 4; k++) { const x = cx0 - 18 + k * 12; caja3(5, 4, 0.1, '#bdb6ab', x, 2.1, cz0 - CD / 2 + 0.16); for (let r = 0; r < 10; r++) caja3(4.9, 0.04, 0.12, '#8d867b', x, 0.4 + r * 0.38, cz0 - CD / 2 + 0.22, mundo, null, false); }
      rotulo('Almacén del catálogo · ' + (data.totalProductos || 0) + ' productos', cx0, hN + 1.8, cz0 - CD / 2 + 0.5, { fs: 30 });
      const COL = 12, PXC = 4.5, PZC = 6.4, X1 = cx0 - CW / 2 + 5, Z1 = cz0 - CD / 2 + 5.5;
      cat.slice(0, 48).forEach((c, i) => {
        const gx = X1 + (i % COL) * PXC, gz = Z1 + Math.floor(i / COL) * PZC, fam = FAM[c.familia] || FAM.S, rack = new THREE.Group(); rack.position.set(gx, 0.1, gz); mundo.add(rack);
        [-1.8, 1.8].forEach(sx => [-0.45, 0.45].forEach(sz => caja3(0.08, 2.9, 0.08, '#4a5568', sx, 1.45, sz, rack, { metalness: 0.6 })));
        [0.35, 1.25, 2.15].forEach(y => caja3(3.7, 0.07, 1.0, '#d97b29', 0, y, 0, rack, { metalness: 0.4 }, false));
        const nb = Math.min(c.n, 12); for (let b = 0; b < nb; b++) { const fila = Math.floor(b / 4), col = b % 4; caja3(0.8, 0.55, 0.7, [fam[1], '#d8d2c7', '#8d867b'][(b + i) % 3], -1.35 + col * 0.9, 0.7 + fila * 0.9, 0, rack); }
        const et = etiqueta(corto(c.nombre, 24) + ' · ' + c.n, { fs: 22, color: c.n ? '#2b2622' : '#8a8a8a' }); et.position.set(gx, 3.6, gz); mundo.add(et); et.userData.lod = 56; lod.push(et);
        marcar(rack, { tipo: 'categoria', nombre: c.nombre, n: c.n, familia: fam[0], productos: c.productos, ir: 'catalogo' });
      });
    }

    // ── selección, hover, vuelos de cámara y bucle ──
    const rayo = new THREE.Raycaster(), ptr = new THREE.Vector2(), aro = aro3(1.4, '#ffffff', 0, 0.14, 0, scene, 0.95); aro.visible = false;
    let activo = null, selId = null, hover = null, abajo = null, vuelo = null;
    const raizDe = (o) => { let x = o; while (x) { if (x.userData.info) return x; if (x.userData.root) return x.userData.root; x = x.parent; } return null; };
    const golpe = (ev) => { const r = renderer.domElement.getBoundingClientRect(); ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); rayo.setFromCamera(ptr, cam); const hits = rayo.intersectObjects(interactivos, true); return hits.length ? raizDe(hits[0].object) : null; };
    const elegir = (raiz) => {
      if (!raiz) { selId = null; aro.visible = false; cbSel.current?.(null); return; }
      const info = raiz.userData.info; cbSel.current?.(info); selId = info.tipo === 'proyecto' ? info.id : null;
      const p = new THREE.Vector3(); raiz.getWorldPosition(p); const t = info.tipo, esZona = t === 'sala' || t === 'anexo' || t === 'almacen';
      aro.visible = !esZona; aro.position.set(p.x, 0.14, p.z); aro.scale.setScalar(t === 'proyecto' ? 3.2 : 1.1);
    };
    const onMove = (ev) => { const r = golpe(ev); renderer.domElement.style.cursor = r ? 'pointer' : 'grab'; hover = r; };
    const onDown = (ev) => { abajo = { x: ev.clientX, y: ev.clientY }; };
    const onUp = (ev) => { if (!abajo || Math.hypot(ev.clientX - abajo.x, ev.clientY - abajo.y) > 5) return; abajo = null; elegir(golpe(ev)); };
    const el = renderer.domElement; el.addEventListener('pointermove', onMove); el.addEventListener('pointerdown', onDown); el.addEventListener('pointerup', onUp);
    const volar = (obj, dist) => { const dir = cam.position.clone().sub(ctrl.target).normalize(); vuelo = { t0: performance.now(), a: ctrl.target.clone(), b: obj.clone(), d0: cam.position.distanceTo(ctrl.target), d1: dist, dir }; };
    if (apiRef) apiRef.current = {
      zona: (z) => { const Z = { todo: [OBJ, 135], catalogo: [new THREE.Vector3(4, 0, -36), 46], sede: [new THREE.Vector3(-2, 0, 4), 62], proyectos: [new THREE.Vector3(centroProy, 0, 0), distProy], proveedores: [new THREE.Vector3(10, 0, 36), 50] }[z]; if (Z) volar(Z[0], Z[1]); },
      proyecto: (id) => { const p = posProy[id]; if (!p) return; volar(p, 22); const g = interactivos.find(o => o.userData.proy === id); if (g) elegir(g); },
      limpiar: () => elegir(null),
    };

    const composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, cam)); composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.18, 0.4, 1.5)); composer.addPass(new OutputPass()); let usaBloom = true;
    const ajustar = () => { const w = cont.clientWidth, h = Math.max(260, cont.clientHeight); renderer.setSize(w, h); composer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); const K = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) / h) * 0.4; scene.traverse(o => { if (o.isSprite && o.userData.px) o.scale.set(o.userData.px.w * K, o.userData.px.h * K, 1); }); };
    ajustar(); const ro = new ResizeObserver(ajustar); ro.observe(cont);
    const reloj = new THREE.Clock(), tmp = new THREE.Vector3(), ease = (x) => 1 - Math.pow(1 - x, 3), easeBack = (x) => { const c = 1.4; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
    let ema = 16, cuenta = 0, sombrasOn = true;
    renderer.setAnimationLoop(() => {
      const dt = reloj.getDelta(), t = reloj.elapsedTime, ahora = performance.now();
      // en ordenadores flojos se quitan las sombras para que siga fluido
      ema = ema * 0.95 + dt * 1000 * 0.05; if (sombrasOn && ++cuenta > 150 && ema > 45) { sombrasOn = false; usaBloom = false; renderer.shadowMap.enabled = false; sol.castShadow = false; scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; }); }); }
      subidas.forEach(s => { const k = Math.min(1, Math.max(0, (t - s.retardo) / 1.3)); s.g.scale.y = Math.max(0.001, easeBack(k)); });
      if (vuelo) { const k = Math.min(1, (ahora - vuelo.t0) / 900), e = ease(k); ctrl.target.lerpVectors(vuelo.a, vuelo.b, e); cam.position.copy(ctrl.target).addScaledVector(vuelo.dir, vuelo.d0 + (vuelo.d1 - vuelo.d0) * e); if (k >= 1) vuelo = null; }
      const dist = cam.position.distanceTo(ctrl.target); lod.forEach(e => { e.visible = dist < e.userData.lod; });
      activo = (hover?.userData.proy) || selId;
      arcos.forEach(a => { const on = a.pid === activo, hay = !!activo; a.mat.opacity = on ? 0.9 : hay ? 0.04 : 0.13; const u = (t * 0.18 + a.fase) % 1; a.curva.getPoint(u, tmp); a.pulso.position.copy(tmp); a.pulso.material.opacity = on ? 0.95 : hay ? 0 : 0.3; a.pulso.scale.setScalar(on ? 2.0 : 0.9); });
      pulsosAtencion.forEach(m => { m.emissiveIntensity = 1.2 + Math.sin(t * 3) * 0.7; });
      caminos.forEach(c => c.pulsos.forEach((sp, i) => { const [px, pz] = c.en((t * 0.03 + i / c.pulsos.length) % 1); sp.position.set(px, 0.5, pz); }));
      animados.forEach(g => { const f = g.userData.fase; g.userData.brazos.forEach((b, i) => { b.rotation.x = g.userData.sentado ? -1.15 + Math.sin(t * 7 + f + i * 1.7) * 0.1 : 0.08 + Math.sin(t * 1.4 + f + i * Math.PI) * 0.1; }); });
      aro.rotation.z = t * 0.6; ctrl.update(); if (usaBloom) composer.render(); else renderer.render(scene, cam);
    });

    return () => {
      vivo = false; renderer.setAnimationLoop(null); ro.disconnect(); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerup', onUp);
      if (apiRef) apiRef.current = null;
      ctrl.dispose(); scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.map?.dispose?.(); m.emissiveMap?.dispose?.(); m.dispose?.(); }); if (o.geometry) o.geometry.dispose?.(); });
      composer.dispose?.(); renderer.dispose(); renderer.forceContextLoss?.(); if (el.parentNode) el.parentNode.removeChild(el);
    };
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={caja} style={{ position: 'absolute', inset: 0, background: '#1a140f', touchAction: 'none' }} />;
}
