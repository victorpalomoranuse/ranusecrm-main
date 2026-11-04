import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// Campus virtual de Ranuse: la sede (cinco departamentos) y, delante, los anexos de los proveedores que colaboran, uno por sector.
// Vista isométrica tipo casa de muñecas (como Los Sims) pero con la estética de la marca: maqueta arquitectónica en blanco, roble y
// taupe sobre fondo negro, con sombras suaves. Las personas se sientan en su departamento según su cargo y llevan un rombo con el
// semáforo de sus tareas; los agentes de IA trabajan en su sala; cada proyecto es una casita en la mesa de maquetas.

const LUZ = { rojo: '#e0705a', ambar: '#e0a24a', gris: '#9a948d', verde: '#5fcf8a' };
const PAL = { fondo: '#0b0a09', suelo: '#171411', losa: '#1b1815', taupe: '#baafa5', pared: '#ece7df', texto: '#2b2622' };
const SALAS = {
  diseno: { x: -17, z: -9, w: 15, d: 18, suelo: 'madera', color: '#cdb08a', nombre: 'Diseño y proyectos' },
  ventas: { x: -1, z: -9, w: 10, d: 9, suelo: 'moqueta', color: '#8f8982', nombre: 'Ventas y leads' },
  presupuestos: { x: 9, z: -9, w: 10, d: 9, suelo: 'baldosa', color: '#e6e2db', nombre: 'Presupuestos' },
  finanzas: { x: -1, z: 0, w: 10, d: 9, suelo: 'moqueta', color: '#5d5a60', nombre: 'Finanzas' },
  equipo: { x: 9, z: 0, w: 10, d: 9, suelo: 'madera', color: '#dcc29c', nombre: 'Sala del equipo' },
};
const ROPA = ['#1d1d1f', '#f1eee8', '#baafa5', '#6b6259', '#33425b', '#a9895d', '#8c3b36', '#46695e'];
const PIEL = ['#f3d2b3', '#e8b98f', '#c98f63', '#a86d45', '#f6dcc6'];
const PELO = ['#2b211b', '#5a3a25', '#b5651d', '#e1b866', '#1c1c24', '#7a3b2e'];
const SECTORES = [
  [/ilumin/i, { color: '#34323a', prop: 'lamparas' }], [/gym|fitness/i, { color: '#3b3b3d', prop: 'pesas' }], [/revest|moldur/i, { color: '#ddd6ca', prop: 'paneles' }],
  [/madera|lamin/i, { color: '#c8a27a', prop: 'tableros' }], [/sauna/i, { color: '#c79a63', prop: 'sauna' }], [/pintor/i, { color: '#f1eee8', prop: 'pintura' }],
  [/rocod/i, { color: '#9aa6ad', prop: 'rocodromo', casco: true }], [/constru|reform/i, { color: '#b7b0a5', prop: 'ladrillos', casco: true }], [/electric/i, { color: '#e2d6a8', prop: 'cables', casco: true }],
];
const sectorCfg = (n) => (SECTORES.find(([re]) => re.test(n)) || [0, { color: '#d8d2c8', prop: null }])[1];
const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const corto = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

function texturaSuelo(tipo, color) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = color; g.fillRect(0, 0, 256, 256);
  if (tipo === 'madera') {
    for (let i = 0; i < 8; i++) { g.fillStyle = `rgba(${i % 2 ? '0,0,0' : '255,255,255'},${0.035 + (i % 3) * 0.02})`; g.fillRect(0, i * 32, 256, 32); g.fillStyle = 'rgba(70,45,20,0.25)'; g.fillRect(0, i * 32, 256, 1.5); g.fillRect(((i * 97) % 200) + 20, i * 32, 1.5, 32); }
  } else if (tipo === 'baldosa') {
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.fillStyle = (x + y) % 2 ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.05)'; g.fillRect(x * 64, y * 64, 64, 64); }
    g.fillStyle = 'rgba(0,0,0,0.12)'; for (let i = 0; i < 4; i++) { g.fillRect(i * 64, 0, 1, 256); g.fillRect(0, i * 64, 256, 1); }
  } else {
    for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(${Math.random() > 0.5 ? '255,255,255' : '0,0,0'},0.05)`; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function etiqueta(texto, { fs = 30, color = PAL.texto, bg = 'rgba(255,255,255,0.95)', borde = 'rgba(0,0,0,0.14)', espaciado = 0, punto = null } = {}) {
  const c = document.createElement('canvas'), g = c.getContext('2d'), pad = 15, fuente = `600 ${fs}px Montserrat, system-ui, sans-serif`;
  g.font = fuente; if (espaciado) g.letterSpacing = espaciado + 'px';
  const dp = punto ? fs * 0.9 : 0, w = Math.ceil(g.measureText(texto).width) + pad * 2 + dp, h = fs + pad * 1.1;
  c.width = w; c.height = h; g.font = fuente; if (espaciado) g.letterSpacing = espaciado + 'px';
  g.fillStyle = bg; g.strokeStyle = borde; g.lineWidth = 2; g.beginPath(); g.roundRect(1, 1, w - 2, h - 2, h / 2); g.fill(); g.stroke();
  if (punto) { g.fillStyle = punto; g.beginPath(); g.arc(pad + fs * 0.33, h / 2, fs * 0.3, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(texto, pad + dp, h / 2 + 1);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  /* tamaño fijo en pantalla (sin atenuación por la distancia): los nombres se leen igual de cerca que de lejos */
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, sizeAttenuation: false }));
  s.userData.px = { w, h }; s.scale.set(w * 0.0008, h * 0.0008, 1); s.renderOrder = 20; return s;
}
function rotuloRanuse() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 380; const g = c.getContext('2d');
  g.fillStyle = '#141210'; g.fillRect(0, 0, 1024, 380); g.strokeStyle = PAL.taupe; g.lineWidth = 6; g.strokeRect(14, 14, 996, 352);
  g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 150px Montserrat, system-ui, sans-serif'; g.letterSpacing = '14px'; g.fillText('RANUSE', 512, 150);
  g.fillStyle = PAL.taupe; g.font = '500 62px Montserrat, system-ui, sans-serif'; g.letterSpacing = '34px'; g.fillText('DESIGN', 520, 275);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export function OficinaVirtual3D({ data, onSeleccion, cargarLogo }) {
  const caja = useRef(null);

  useEffect(() => {
    const cont = caja.current; if (!cont || !data) return undefined;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch { onSeleccion?.({ tipo: 'error' }); return undefined; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    cont.appendChild(renderer.domElement); renderer.domElement.style.display = 'block'; renderer.domElement.style.touchAction = 'none';
    const scene = new THREE.Scene(); scene.background = new THREE.Color(PAL.fondo); scene.fog = new THREE.Fog(PAL.fondo, 75, 170);
    const cam = new THREE.PerspectiveCamera(36, 1, 0.5, 400);
    const ctrl = new OrbitControls(cam, renderer.domElement);
    ctrl.target.set(3, 0.3, 9); cam.position.set(27, 24, 38);
    ctrl.enableDamping = true; ctrl.minDistance = 10; ctrl.maxDistance = 85; ctrl.minPolarAngle = 0.45; ctrl.maxPolarAngle = 1.2;
    ctrl.minAzimuthAngle = Math.PI / 4 - 0.85; ctrl.maxAzimuthAngle = Math.PI / 4 + 0.85; ctrl.screenSpacePanning = false; ctrl.update();

    scene.add(new THREE.HemisphereLight('#fff6ea', '#5b5249', 1.1));
    const sol = new THREE.DirectionalLight('#fff1dc', 2.1); sol.position.set(26, 46, 34); sol.target.position.set(3, 0, 8); scene.add(sol, sol.target);
    sol.castShadow = true; sol.shadow.mapSize.set(2048, 2048); Object.assign(sol.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 5, far: 140 }); sol.shadow.bias = -0.0004; sol.shadow.radius = 3;
    const relleno = new THREE.DirectionalLight('#aebfd6', 0.45); relleno.position.set(-30, 20, -20); scene.add(relleno);

    const mats = new Map(), geos = new Map();
    const M = (c, o = {}) => { const k = c + JSON.stringify(o); if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color: c, roughness: 0.78, metalness: 0, ...o })); return mats.get(k); };
    const G = (k, f) => { if (!geos.has(k)) geos.set(k, f()); return geos.get(k); };
    const sombrear = (m, c = true) => { m.castShadow = c; m.receiveShadow = true; return m; };
    const poner = (m, x, y, z, parent) => { m.position.set(x, y, z); parent.add(m); return m; };
    const caja3 = (w, h, d, c, x, y, z, parent, o, sh = true) => sombrear(poner(new THREE.Mesh(G(`b${w},${h},${d}`, () => new RoundedBoxGeometry(w, h, d, 3, Math.min(0.09, Math.min(w, h, d) * 0.45))), M(c, o)), x, y, z, parent), sh);
    const cilindro = (r, h, c, x, y, z, parent, o) => sombrear(poner(new THREE.Mesh(G(`c${r},${h}`, () => new THREE.CylinderGeometry(r, r, h, 18)), M(c, o)), x, y, z, parent));
    const esfera = (r, c, x, y, z, parent, o) => sombrear(poner(new THREE.Mesh(G(`s${r}`, () => new THREE.SphereGeometry(r, 20, 16)), M(c, o)), x, y, z, parent));
    const sombraBlob = (r, x, z, parent) => { const m = new THREE.Mesh(G(`sh${r}`, () => new THREE.CircleGeometry(r, 20)), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.14, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.12, z); parent.add(m); };

    const interactivos = [], animados = [], lodEtiquetas = [], stands = [], mundo = new THREE.Group(); scene.add(mundo);
    const marcar = (obj, info) => { obj.userData.info = info; interactivos.push(obj); obj.traverse(o => { if (o !== obj) o.userData.root = obj; }); };

    // ── terreno: suelo oscuro con halo, plano de líneas y losa de la sede ──
    const halo = document.createElement('canvas'); halo.width = halo.height = 256; { const g = halo.getContext('2d'), gr = g.createRadialGradient(128, 128, 10, 128, 128, 128); gr.addColorStop(0, '#2c2722'); gr.addColorStop(0.55, '#171411'); gr.addColorStop(1, PAL.fondo); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); }
    const haloT = new THREE.CanvasTexture(halo); haloT.colorSpace = THREE.SRGBColorSpace;
    const terreno = new THREE.Mesh(new THREE.PlaneGeometry(190, 150), new THREE.MeshBasicMaterial({ map: haloT })); terreno.rotation.x = -Math.PI / 2; terreno.position.set(3, -0.45, 10); mundo.add(terreno);
    const rejilla = new THREE.GridHelper(120, 60, '#2e2924', '#221e1a'); rejilla.position.set(3, -0.43, 10); mundo.add(rejilla);
    const losa = (w, d, x, z, h = 0.5) => { caja3(w, h, d, PAL.losa, x, -h / 2 + 0.02, z, mundo, { roughness: 0.9 }, false); caja3(w + 0.1, 0.06, d + 0.1, PAL.taupe, x, 0.04, z, mundo, { roughness: 0.5, metalness: 0.4 }, false); };
    losa(41, 22, 2.5, 0.5);

    // ── sede: suelos, paredes del fondo, ventanas, carteles ──
    const ventana = (x, y, z, rot) => { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rot; mundo.add(g); caja3(1.8, 1.2, 0.12, PAL.taupe, 0, 0, 0, g, null, false); const cr = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 0.95), new THREE.MeshStandardMaterial({ color: '#cfe0ee', emissive: '#bcd4e8', emissiveIntensity: 0.55 })); cr.position.z = 0.07; g.add(cr); };
    const cuadro = (x, y, z, c) => { const g = new THREE.Group(); g.position.set(x, y, z); mundo.add(g); caja3(0.9, 0.65, 0.06, '#1b1b1b', 0, 0, 0, g, null, false); const p = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.5), new THREE.MeshStandardMaterial({ color: c })); p.position.z = 0.04; g.add(p); };
    Object.entries(SALAS).forEach(([id, s]) => {
      const tex = texturaSuelo(s.suelo, s.color); tex.repeat.set(s.w / 4, s.d / 4);
      const piso = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.d), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 })); piso.rotation.x = -Math.PI / 2; piso.position.set(s.x + s.w / 2, 0.09, s.z + s.d / 2); piso.receiveShadow = true; mundo.add(piso);
      const dep = data.departamentos.find(d => d.id === id);
      marcar(piso, { tipo: 'sala', id, nombre: s.nombre, ir: dep?.ir, datos: dep?.datos || [], alerta: dep?.alerta || 'verde' });
      const alto = (z0) => (z0 === -9 ? 2.6 : 0.4), altoX = (x0) => (x0 === -17 ? 2.6 : 0.4);
      caja3(s.w, alto(s.z), 0.22, PAL.pared, s.x + s.w / 2, alto(s.z) / 2 + 0.1, s.z, mundo); caja3(s.w, 0.14, 0.27, PAL.taupe, s.x + s.w / 2, 0.17, s.z, mundo, null, false);
      caja3(0.22, altoX(s.x), s.d, PAL.pared, s.x, altoX(s.x) / 2 + 0.1, s.z + s.d / 2, mundo); caja3(0.27, 0.14, s.d, PAL.taupe, s.x, 0.17, s.z + s.d / 2, mundo, null, false);
      const cartel = etiqueta(s.nombre.toUpperCase(), { fs: 28, espaciado: 3, punto: LUZ[dep?.alerta || 'verde'] }); cartel.position.set(s.x + s.w / 2, 4.5, s.z + 0.3); mundo.add(cartel);
    });
    [-14, -8, -4, 3, 14].forEach(x => ventana(x, 1.7, -8.82, 0)); ventana(-16.82, 1.7, -3, Math.PI / 2); ventana(-16.82, 1.7, 3, Math.PI / 2);
    cuadro(0.5, 1.8, -8.85, '#b9a58b'); cuadro(6.5, 1.8, -8.85, '#8d8780'); cuadro(11, 1.8, -8.85, '#baafa5'); cuadro(17, 1.8, -8.85, '#d8cfc3');

    // ── mobiliario ──
    const mesa = (x, z, rot, ancho = 2.1) => {
      const g = new THREE.Group(); g.position.set(x, 0.1, z); g.rotation.y = rot; mundo.add(g);
      caja3(ancho, 0.08, 1.05, '#f4f1ec', 0, 0.78, 0, g, { roughness: 0.35 }); [[-1, -0.42], [1, -0.42], [-1, 0.42], [1, 0.42]].forEach(([a, b]) => caja3(0.06, 0.74, 0.06, '#2a2623', a * (ancho / 2 - 0.1), 0.37, b, g));
      caja3(0.82, 0.5, 0.05, '#1c1c20', 0, 1.2, -0.2, g); caja3(0.74, 0.42, 0.02, '#8ec0ea', 0, 1.2, -0.17, g, { emissive: '#4a90d9', emissiveIntensity: 0.55 }, false); caja3(0.1, 0.24, 0.1, '#444', 0, 0.92, -0.2, g);
      caja3(0.6, 0.03, 0.2, '#d9d6d0', 0, 0.84, 0.2, g, null, false);
    };
    const silla = (x, z, rot) => { const g = new THREE.Group(); g.position.set(x, 0.1, z); g.rotation.y = rot; mundo.add(g); caja3(0.7, 0.1, 0.7, '#1f1f22', 0, 0.5, 0, g); caja3(0.7, 0.75, 0.1, '#1f1f22', 0, 0.95, 0.33, g); cilindro(0.05, 0.4, '#555', 0, 0.28, 0, g); caja3(0.5, 0.05, 0.5, '#444', 0, 0.12, 0, g, null, false); };
    const planta = (x, z, s = 1) => { const g = new THREE.Group(); g.position.set(x, 0.1, z); g.scale.setScalar(s); mundo.add(g); cilindro(0.3, 0.5, '#e8e3db', 0, 0.25, 0, g); esfera(0.42, '#4f7d5e', 0, 0.95, 0, g); esfera(0.3, '#639972', 0.2, 1.3, 0.1, g); };
    const sofa = (x, z) => { const g = new THREE.Group(); g.position.set(x, 0.1, z); mundo.add(g); caja3(2.6, 0.45, 1, '#6b6259', 0, 0.35, 0, g); caja3(2.6, 0.7, 0.28, '#5a524a', 0, 0.8, -0.38, g); caja3(0.3, 0.7, 1, '#5a524a', -1.2, 0.55, 0, g); caja3(0.3, 0.7, 1, '#5a524a', 1.2, 0.55, 0, g); };
    const estanteria = (x, z) => { const g = new THREE.Group(); g.position.set(x, 0.1, z); mundo.add(g); caja3(2, 1.9, 0.4, '#e8e3db', 0, 0.95, 0, g); ['#1d1d1f', '#baafa5', '#a9895d', '#f1eee8', '#6b6259'].forEach((c, i) => [0.4, 0.95, 1.5].forEach(y => caja3(0.28, 0.4, 0.3, c, -0.75 + i * 0.37, y, 0.06, g, null, false))); };
    const alfombra = (x, z, r, c) => { const m = new THREE.Mesh(G(`r${r}`, () => new THREE.CircleGeometry(r, 36)), M(c, { roughness: 1 })); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.115, z); m.receiveShadow = true; mundo.add(m); };
    const lampara = (x, z, h = 1.9) => { const g = new THREE.Group(); g.position.set(x, 0.1, z); mundo.add(g); cilindro(0.18, 0.06, '#222', 0, 0.03, 0, g); cilindro(0.025, h, '#222', 0, h / 2, 0, g); const b = esfera(0.2, '#fff3d6', 0, h + 0.15, 0, g, { emissive: '#ffd9a0', emissiveIntensity: 1.2 }); b.castShadow = false; };

    // ── personajes ──
    const persona = ({ color, piel, pelo, sentado, robot, casco }) => {
      const g = new THREE.Group(), y0 = sentado ? -0.28 : 0, tela = robot ? '#dfe5ea' : '#2a2f3a';
      const cuerpo = new THREE.Mesh(G('cap', () => new THREE.CapsuleGeometry(0.3, 0.55, 6, 14)), M(color)); cuerpo.position.y = 1.15 + y0; sombrear(cuerpo); g.add(cuerpo);
      if (sentado) { [-0.15, 0.15].forEach(a => { const m = new THREE.Mesh(G('muslo', () => new THREE.CapsuleGeometry(0.12, 0.5, 4, 8)), M(tela)); m.rotation.x = Math.PI / 2; m.position.set(a, 0.75, -0.3); sombrear(m); g.add(m); cilindro(0.11, 0.55, tela, a, 0.4, -0.58, g); }); }
      else [-0.15, 0.15].forEach(a => { cilindro(0.12, 0.8, tela, a, 0.4, 0, g); esfera(0.13, '#161616', a, 0.06, 0.06, g).scale.set(1, 0.5, 1.4); });
      const cabeza = esfera(0.32, robot ? '#eef2f5' : piel, 0, 1.95 + y0, 0, g); cabeza.scale.set(1, 1.05, 1);
      if (robot) { caja3(0.5, 0.2, 0.08, '#27313b', 0, 1.97 + y0, 0.28, g, { emissive: '#4fc3f7', emissiveIntensity: 0.7 }, false); cilindro(0.025, 0.3, '#99a', 0, 2.38 + y0, 0, g); esfera(0.06, '#4fc3f7', 0, 2.55 + y0, 0, g, { emissive: '#4fc3f7', emissiveIntensity: 1 }); }
      else {
        if (casco) { const c = new THREE.Mesh(G('casco', () => new THREE.SphereGeometry(0.36, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5)), M('#f2c230', { roughness: 0.4 })); c.position.set(0, 2.0 + y0, 0); sombrear(c); g.add(c); caja3(0.8, 0.05, 0.5, '#f2c230', 0, 2.0 + y0, 0.12, g, null, false); }
        else { const pe = new THREE.Mesh(G('pelo', () => new THREE.SphereGeometry(0.345, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55)), M(pelo)); pe.position.set(0, 1.97 + y0, -0.02); sombrear(pe); g.add(pe); }
        [-0.11, 0.11].forEach(a => { esfera(0.04, '#1b1b1b', a, 1.95 + y0, 0.3, g).castShadow = false; }); esfera(0.03, '#d98c7a', 0, 1.87 + y0, 0.31, g).castShadow = false;
      }
      const brazos = [-1, 1].map(s => { const p = new THREE.Group(); p.position.set(s * 0.38, 1.4 + y0, 0); const b = new THREE.Mesh(G('brazo', () => new THREE.CapsuleGeometry(0.08, 0.45, 4, 8)), M(robot ? '#dfe5ea' : piel)); b.position.y = -0.28; sombrear(b); p.add(b); g.add(p); p.rotation.x = sentado ? -1.15 : 0.1; return p; });
      sombraBlob(0.55, 0, 0, g);
      g.userData.brazos = brazos; g.userData.fase = Math.random() * 6; g.userData.sentado = !!sentado; animados.push(g);
      return g;
    };
    const ponerRombo = (g, c, y) => { const m = new THREE.Mesh(G('rombo', () => new THREE.OctahedronGeometry(0.2)), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.9, roughness: 0.3, flatShading: true })); m.scale.y = 1.6; m.position.y = y; g.add(m); g.userData.rombo = m; };
    const luzPersona = p => (p.atrasadas > 0 ? LUZ.rojo : p.hoy > 0 ? LUZ.ambar : LUZ.verde);
    const nombrePersona = (p, x, z, y) => { const et = etiqueta(p.nombre.split(' ')[0], { fs: 25 }); et.position.set(x, y, z); mundo.add(et); if (p.atrasadas > 0) { const pen = etiqueta(`⚠ ${p.atrasadas} atrasada${p.atrasadas === 1 ? '' : 's'}`, { fs: 19, color: '#b3402f' }); pen.position.set(x, y + 0.4, z); mundo.add(pen); } };
    const aspecto = (p, color) => { const i = hash(p.id || p.nombre); return { color: color || ROPA[i % ROPA.length], piel: PIEL[(i >> 3) % PIEL.length], pelo: PELO[(i >> 5) % PELO.length] }; };
    const sentarPersona = (p, x, z, ancho, color) => {
      mesa(x, z - 0.95, 0, ancho); silla(x, z, Math.PI);
      const av = persona({ ...aspecto(p, color), sentado: true }); av.position.set(x, 0.1, z); av.rotation.y = Math.PI; mundo.add(av); ponerRombo(av, luzPersona(p), 2.62);
      nombrePersona(p, x, z, 3.5); marcar(av, { tipo: 'persona', ...p });
    };
    const peatonPersona = (p, x, z, rot) => {
      const av = persona({ ...aspecto(p), sentado: false }); av.position.set(x, 0.1, z); av.rotation.y = rot; mundo.add(av); ponerRombo(av, luzPersona(p), 2.9);
      nombrePersona(p, x, z, 3.55); marcar(av, { tipo: 'persona', ...p });
    };

    // ── reparto de la plantilla por cargo ──
    const perso = data.personas || [], rolDe = p => String(p.rol || '').toLowerCase();
    const disenadores = perso.filter(p => /dise/.test(rolDe(p))), comerciales = perso.filter(p => /comercial|ventas|setter/.test(rolDe(p))), directivos = perso.filter(p => /admin|direc|socio/.test(rolDe(p)));
    const resto = perso.filter(p => ![...disenadores, ...comerciales, ...directivos].includes(p));
    const puestosDiseno = [[-14.5, -5.05], [-10, -5.05], [-5.5, -5.05], [-14.5, -0.85], [-10, -0.85], [-5.5, -0.85]];
    const puestosVentas = [[0.8, -5.25], [3.6, -5.25], [0.8, -1.85], [3.6, -1.85], [6.4, -1.85]];
    const desbordan = [];
    disenadores.forEach((p, k) => { if (k < puestosDiseno.length) sentarPersona(p, puestosDiseno[k][0], puestosDiseno[k][1]); else desbordan.push(p); });
    comerciales.forEach((p, k) => { if (k < puestosVentas.length) sentarPersona(p, puestosVentas[k][0], puestosVentas[k][1]); else desbordan.push(p); });
    directivos.forEach((p, k) => sentarPersona(p, -4.2, -6.4 + k * 3, 2.8, '#1d1d1f'));

    // agentes de IA, cada uno en su sala
    const puestoAgente = { diseno: [-2.6, 5.5, true], ventas: [6.4, -6.2, false], presupuestos: [13.5, -5.2, false], finanzas: [3.5, 4, false] };
    (data.agentes || []).forEach(a => {
      const pt = puestoAgente[a.sala]; if (!pt) return; const [x, z, este] = pt;
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = este ? Math.PI / 2 : 0; mundo.add(g); g.position.set(0, 0, 0);
      const sx = este ? x - 0.95 : x, sz = este ? z : z + 0.95;
      const mg = new THREE.Group(); mg.position.set(x, 0.1, z); mg.rotation.y = este ? Math.PI / 2 : 0; mundo.add(mg); mesa(0, 0, 0); mundo.remove(mundo.children[mundo.children.length - 1]);
      mesa(x, z, este ? Math.PI / 2 : 0); silla(sx, sz, este ? Math.PI / 2 : Math.PI);
      const bot = persona({ color: '#dfe5ea', robot: true, sentado: true }); bot.position.set(sx, 0.1, sz); bot.rotation.y = este ? Math.PI / 2 : Math.PI; mundo.add(bot); ponerRombo(bot, '#4fc3f7', 2.62);
      const et = etiqueta('🤖 ' + a.nombre.replace('Asistente de ', '').replace('Asistente ', ''), { fs: 21, color: '#1f5d7a' }); et.position.set(sx, 3.5, sz); mundo.add(et); marcar(bot, { tipo: 'agente', ...a });
    });

    // mesa de maquetas: una casita por proyecto, con el tejado del color del semáforo
    const zM = 7;
    caja3(12.6, 0.12, 2.8, '#f4f1ec', -9.5, 0.78, zM, mundo, { roughness: 0.35 }); [[-15.4, zM - 1.1], [-3.6, zM - 1.1], [-15.4, zM + 1.1], [-3.6, zM + 1.1]].forEach(([a, b]) => caja3(0.1, 0.7, 0.1, '#2a2623', a, 0.4, b, mundo));
    const cartelM = etiqueta('MAQUETAS · UNA POR PROYECTO', { fs: 20, color: '#6b5a44', espaciado: 2 }); cartelM.position.set(-9.5, 2.3, zM - 1.9); mundo.add(cartelM);
    data.proyectos.slice(0, 18).forEach((p, i) => {
      const col = i % 9, fila = Math.floor(i / 9), x = -15 + col * 1.35, z = zM - 0.7 + fila * 1.4, g = new THREE.Group(); g.position.set(x, 0.9, z); mundo.add(g);
      caja3(1.05, 0.06, 1.05, '#d9d3c9', 0, 0.03, 0, g, null, false); caja3(0.7, 0.45, 0.7, '#f7f4ee', 0, 0.3, 0, g);
      const apagado = p.semaforo === 'verde' || p.semaforo === 'gris';
      const tejado = new THREE.Mesh(G('tejado', () => new THREE.ConeGeometry(0.62, 0.42, 4)), M(LUZ[p.semaforo], { emissive: LUZ[p.semaforo], emissiveIntensity: apagado ? 0.08 : 0.5 })); tejado.rotation.y = Math.PI / 4; tejado.position.y = 0.75; sombrear(tejado); g.add(tejado);
      const et = etiqueta(corto(p.nombre, 18), { fs: 20 }); et.position.set(x, 2.1, z); mundo.add(et);
      et.visible = !apagado; g.userData.etiq = et; g.userData.siempre = !apagado; marcar(g, { tipo: 'proyecto', ...p });
    });
    planta(-2.8, -8, 1.1); planta(-16.2, 8.2); estanteria(-9, -8.55); alfombra(-9.8, -3.2, 3.4, '#e3d3b8'); lampara(-16, -8); lampara(-2.5, 8);
    planta(8.4, -8.2); alfombra(3.2, -3.5, 3, '#a8a29b'); planta(18, -8); estanteria(14, -8.55); estanteria(16.5, -8.55); lampara(9.6, -8);
    planta(8, 8); estanteria(2.5, 0.45); alfombra(3.5, 5.2, 2.4, '#77737a'); lampara(-0.3, 8.3);
    sofa(13.5, 1.9); caja3(1.4, 0.1, 0.8, '#b98a5a', 13.5, 0.55, 4.2, mundo); [[12.9, 3.9], [14.1, 3.9], [12.9, 4.5], [14.1, 4.5]].forEach(([a, b]) => caja3(0.08, 0.42, 0.08, '#2a2623', a, 0.3, b, mundo)); alfombra(13.5, 4.8, 2.4, '#d9c8b0'); planta(18, 1); planta(10, 8); lampara(18, 7.6);
    const lounge = [[11.2, 6.6], [13.5, 7], [15.8, 6.6], [17.4, 4.5], [11, 4], [16.5, 2.5]];
    [...resto, ...desbordan].slice(0, lounge.length).forEach((p, k) => { const [x, z] = lounge[k]; peatonPersona(p, x, z, Math.PI + 0.4 * (k % 3 - 1)); });

    // ── rótulo de la marca y paseo hacia los anexos ──
    const rt = rotuloRanuse(), rotulo = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 2.38), new THREE.MeshStandardMaterial({ map: rt, roughness: 0.5, emissive: '#ffffff', emissiveMap: rt, emissiveIntensity: 0.35 }));
    rotulo.position.set(-18.6, 2.2, 12.2); rotulo.rotation.y = Math.PI / 5; mundo.add(rotulo);
    caja3(0.2, 1.1, 0.2, '#26221e', -20.6, 0.55, 11.4, mundo); caja3(0.2, 1.1, 0.2, '#26221e', -16.6, 0.55, 13.0, mundo);
    const camino = new THREE.Mesh(new THREE.PlaneGeometry(40, 5.2), M('#26221e', { roughness: 0.95 })); camino.rotation.x = -Math.PI / 2; camino.position.set(2.5, 0.06, 11.7); camino.receiveShadow = true; mundo.add(camino);
    for (let k = 0; k < 9; k++) caja3(0.6, 0.02, 0.2, '#6b6259', -15 + k * 4.4, 0.08, 11.7, mundo, null, false);
    [-12, -2, 8, 18].forEach(x => lampara(x, 9.8, 2.2));
    const redT = etiqueta('RED DE COLABORADORES', { fs: 24, color: '#ffffff', bg: 'rgba(30,26,22,0.92)', borde: PAL.taupe, espaciado: 4 }); redT.position.set(2.5, 1.2, 11.7); mundo.add(redT);

    // ── anexos: un edificio por sector de proveedores ──
    const propsSector = (tipo, ax, az) => {
      const g = new THREE.Group(); g.position.set(ax, 0.1, az); mundo.add(g);
      if (tipo === 'lamparas') [[1, 1.2], [2.2, 0.9], [6.1, 1.2]].forEach(([x, z], k) => { cilindro(0.025, 1.7 + k * 0.3, '#222', x, 0.85, z, g); esfera(0.26, '#fff0c9', x, 1.8 + k * 0.3, z, g, { emissive: '#ffd58a', emissiveIntensity: 1.1 }); });
      if (tipo === 'pesas') { caja3(2.4, 0.9, 0.5, '#2a2a2c', 1.7, 0.45, 0.5, g); [0.8, 1.4, 2.0, 2.6].forEach(x => { cilindro(0.16, 0.5, '#8a8a90', x, 1.0, 0.5, g).rotation.z = Math.PI / 2; }); cilindro(0.07, 1.4, '#9a9aa0', 5.5, 0.18, 1.1, g).rotation.z = Math.PI / 2; [4.8, 6.2].forEach(x => { cilindro(0.3, 0.1, '#222', x, 0.18, 1.1, g).rotation.z = Math.PI / 2; }); }
      if (tipo === 'paneles') ['#ddd6ca', '#c9bfae', '#e8e2d8', '#b9ad99'].forEach((c, k) => caja3(0.9, 1.6, 0.08, c, 0.9 + k * 1.1, 0.8, 0.35, g));
      if (tipo === 'tableros') [0, 1, 2].forEach(k => ['#c8a27a', '#a97f55', '#e2c9a4'].forEach((c, j) => caja3(2.2, 0.12, 1.1, c, 1.6 + k * 0.05, 0.1 + (k * 3 + j) * 0.13, 0.8, g)));
      if (tipo === 'sauna') { caja3(2.6, 2.1, 2.2, '#c79a63', 1.8, 1.05, 1.1, g); caja3(0.8, 1.5, 0.08, '#8a6a46', 1.2, 0.8, 2.2, g); esfera(0.25, '#ffffff', 3.4, 2.1, 1.1, g, { transparent: true, opacity: 0.55 }); esfera(0.18, '#ffffff', 3.7, 2.5, 1.0, g, { transparent: true, opacity: 0.4 }); }
      if (tipo === 'pintura') ['#e0705a', '#5fb0cf', '#e0c24a', '#7fbf6f', '#f1eee8'].forEach((c, k) => cilindro(0.22, 0.4, c, 0.8 + k * 0.6, 0.2, 0.7, g));
      if (tipo === 'rocodromo') { caja3(3.4, 2.1, 0.2, '#6a7780', 2.2, 1.05, 0.3, g); ['#e0705a', '#e0c24a', '#5fb0cf', '#7fbf6f', '#c06bd8'].forEach((c, k) => esfera(0.1, c, 1.1 + (k % 3) * 0.9, 0.7 + k * 0.28, 0.45, g)); }
      if (tipo === 'ladrillos') { [0, 1, 2].forEach(k => [0, 1, 2, 3].forEach(j => caja3(0.5, 0.22, 0.26, k % 2 ? '#b0553d' : '#c46a4f', 0.8 + j * 0.52 + (k % 2) * 0.25, 0.12 + k * 0.23, 0.7, g))); const cono = new THREE.Mesh(G('cono', () => new THREE.ConeGeometry(0.28, 0.7, 16)), M('#f08a24')); cono.position.set(4.5, 0.35, 1.2); sombrear(cono); g.add(cono); }
      if (tipo === 'cables') { cilindro(0.5, 0.35, '#e0c24a', 1.2, 0.18, 0.9, g); cilindro(0.18, 0.4, '#555', 1.2, 0.2, 0.9, g); caja3(1.2, 1.6, 0.2, '#2c2c30', 3.8, 0.8, 0.4, g); esfera(0.12, '#e0c24a', 3.8, 1.2, 0.52, g, { emissive: '#e0c24a', emissiveIntensity: 1 }); }
    };
    const WA = 7.4, DA = 7, PA = 8.6, filaZ = [14.2, 23.2];
    (data.anexos || []).slice(0, 10).forEach((a, k) => {
      const cfg = sectorCfg(a.sector), fila = k < 5 ? 0 : 1, col = fila ? k - 5 : k, ax = (fila ? -12.7 : -17) + col * PA, az = filaZ[fila];
      losa(WA + 0.8, DA + 0.8, ax + WA / 2, az + DA / 2, 0.3);
      const tex = texturaSuelo(/madera|sauna/i.test(a.sector) ? 'madera' : 'moqueta', cfg.color); tex.repeat.set(WA / 4, DA / 4);
      const piso = new THREE.Mesh(new THREE.PlaneGeometry(WA, DA), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 })); piso.rotation.x = -Math.PI / 2; piso.position.set(ax + WA / 2, 0.09, az + DA / 2); piso.receiveShadow = true; mundo.add(piso);
      marcar(piso, { tipo: 'anexo', sector: a.sector, n: a.n, proveedores: a.proveedores, ir: 'contactos' });
      caja3(WA, 2.3, 0.2, PAL.pared, ax + WA / 2, 1.25, az, mundo); caja3(WA, 0.12, 0.25, PAL.taupe, ax + WA / 2, 0.16, az, mundo, null, false);
      caja3(0.2, 2.3, DA, PAL.pared, ax, 1.25, az + DA / 2, mundo); caja3(0.25, 0.12, DA, PAL.taupe, ax, 0.16, az + DA / 2, mundo, null, false);
      caja3(WA, 0.4, 0.15, PAL.pared, ax + WA / 2, 0.3, az + DA, mundo, null, false); caja3(0.15, 0.4, DA, PAL.pared, ax + WA, 0.3, az + DA / 2, mundo, null, false);
      ventana(ax + WA / 2 + 1.6, 1.55, az + 0.12, 0); propsSector(cfg.prop, ax + 0.3, az + 0.4);
      const sg = etiqueta(`${a.sector.toUpperCase()} · ${a.n}`, { fs: 22, color: '#ffffff', bg: 'rgba(30,26,22,0.94)', borde: PAL.taupe, espaciado: 2 }); sg.position.set(ax + WA / 2, 3.2, az + 0.3); mundo.add(sg);
      // un stand tipo pop-up por proveedor: tarima, panel con su logo (o su nombre) y mostrador con la persona detrás
      const slots = [[1.3, 2.5], [3.7, 2.5], [6.1, 2.5], [2.5, 5.0], [4.9, 5.0]];
      a.proveedores.slice(0, slots.length).forEach((pr, j) => {
        const [sx, sz] = slots[j], i = hash(pr.nombre), gs = new THREE.Group(); gs.position.set(ax + sx, 0.1, az + sz); gs.rotation.y = 0.55; mundo.add(gs); /* girado hacia la cámara */
        caja3(1.95, 0.06, 1.75, '#f4f1ec', 0, 0.03, 0.5, gs, { roughness: 0.4 }, false);
        const cv = document.createElement('canvas'); cv.width = 512; cv.height = 640; const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
        const dibujar = (img) => {
          const g = cv.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, 512, 640); g.fillStyle = cfg.color === '#f1eee8' ? PAL.taupe : cfg.color; g.fillRect(0, 0, 512, 26); g.strokeStyle = PAL.taupe; g.lineWidth = 6; g.strokeRect(10, 10, 492, 620);
          if (img) { const r = Math.min(320 / img.width, 320 / img.height); g.drawImage(img, 256 - (img.width * r) / 2, 70 + (320 - img.height * r) / 2, img.width * r, img.height * r); }
          else { g.fillStyle = '#efe9e0'; g.beginPath(); g.arc(256, 230, 130, 0, Math.PI * 2); g.fill(); g.fillStyle = PAL.taupe; g.font = '700 120px Montserrat, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(pr.nombre.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase(), 256, 236); }
          g.fillStyle = '#26221e'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 46px Montserrat, system-ui, sans-serif';
          const pal = pr.nombre.split(' '), lin = ['']; pal.forEach(w => { const t = (lin[lin.length - 1] + ' ' + w).trim(); if (g.measureText(t).width < 440 || !lin[lin.length - 1]) lin[lin.length - 1] = t; else lin.push(w); });
          lin.slice(0, 3).forEach((t, k) => g.fillText(t, 256, 470 + k * 54 - (Math.min(lin.length, 3) - 1) * 20));
          g.fillStyle = PAL.taupe; g.font = '500 26px Montserrat, system-ui, sans-serif'; g.fillText(a.sector.toUpperCase(), 256, 600);
        };
        dibujar(null);
        const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.9), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 })); panel.position.set(0, 1.15, 0.02); sombrear(panel); gs.add(panel);
        caja3(1.62, 0.06, 0.1, '#26221e', 0, 0.2, 0, gs); caja3(1.62, 0.06, 0.1, '#26221e', 0, 2.1, 0, gs); [-0.78, 0.78].forEach(x => caja3(0.06, 1.95, 0.1, '#26221e', x, 1.15, 0, gs));
        [-0.5, 0.5].forEach(x => { cilindro(0.015, 0.3, '#222', x, 2.28, 0.1, gs); esfera(0.07, '#fff3d6', x, 2.45, 0.12, gs, { emissive: '#ffd9a0', emissiveIntensity: 1.2 }).castShadow = false; });
        caja3(1.15, 0.85, 0.5, '#ffffff', 0, 0.55, 1.0, gs, { roughness: 0.35 }); caja3(1.15, 0.05, 0.5, PAL.taupe, 0, 0.99, 1.0, gs, { roughness: 0.3 }); caja3(0.9, 0.04, 0.02, '#26221e', 0, 0.6, 1.26, gs, null, false);
        [-0.3, 0, 0.3].forEach((x, k) => caja3(0.2, 0.03 + k * 0.012, 0.28, ['#f1eee8', '#baafa5', '#d8cfc3'][k], x, 1.03 + k * 0.006, 0.98, gs, null, false));
        const av = persona({ color: ROPA[(i + 2) % ROPA.length], piel: PIEL[(i >> 3) % PIEL.length], pelo: PELO[(i >> 5) % PELO.length], sentado: false, casco: cfg.casco });
        av.position.set(ax + sx + 0.82, 0.1, az + sz + 0.15); av.rotation.y = 0.3; mundo.add(av);
        const et = etiqueta(corto(pr.nombre, 22), { fs: 22, bg: 'rgba(241,238,232,0.96)' }); et.position.set(ax + sx, 3.0, az + sz); mundo.add(et); et.userData.lod = 40; lodEtiquetas.push(et);
        const info = { tipo: 'proveedor', nombre: pr.nombre, url: pr.url, sector: a.sector }; marcar(av, info); marcar(gs, info);
        if (pr.url) stands.push({ url: pr.url, dibujar, tex });
      });
      if (a.n > slots.length) { const mas = etiqueta(`+${a.n - slots.length} más`, { fs: 22, color: '#6b5a44' }); mas.position.set(ax + WA - 0.9, 1.3, az + DA - 0.8); mundo.add(mas); mas.userData.lod = 40; lodEtiquetas.push(mas); }
      planta(ax + WA - 0.5, az + 0.7, 0.9);
    });
    const arbol = (x, z, s = 1) => { const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s); mundo.add(g); cilindro(0.12, 1, '#4a3c30', 0, 0.5, 0, g); const c1 = new THREE.Mesh(G('abeto', () => new THREE.ConeGeometry(0.9, 2.4, 14)), M('#3d5a48')); c1.position.y = 2.1; sombrear(c1); g.add(c1); const c2 = new THREE.Mesh(G('abeto2', () => new THREE.ConeGeometry(0.65, 1.8, 14)), M('#4a6b56')); c2.position.y = 3.2; sombrear(c2); g.add(c2); };
    [[-22, -6], [-23, 4], [-21, 14], [24, -6], [25, 5], [27, 16], [-22, 26], [20, 20], [30, 26], [-5, -14], [8, -14], [20, -13]].forEach(([x, z], k) => arbol(x, z, 0.9 + (k % 3) * 0.15));

    // logos de los proveedores: se piden al servidor y se pintan en el panel de su stand cuando llegan
    let vivo = true;
    if (cargarLogo) stands.forEach(st => { cargarLogo(st.url).then(b => createImageBitmap(b)).then(img => { if (vivo) { st.dibujar(img); st.tex.needsUpdate = true; } }).catch(() => {}); });

    // ── selección, hover y bucle ──
    const rayo = new THREE.Raycaster(), ptr = new THREE.Vector2(), anillo = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.9, 40), new THREE.MeshBasicMaterial({ color: PAL.taupe, side: THREE.DoubleSide, depthWrite: false, transparent: true, opacity: 0.95 }));
    anillo.rotation.x = -Math.PI / 2; anillo.visible = false; scene.add(anillo);
    const raizDe = (o) => { let x = o; while (x) { if (x.userData.info) return x; if (x.userData.root) return x.userData.root; x = x.parent; } return null; };
    const golpe = (ev) => { const r = renderer.domElement.getBoundingClientRect(); ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); rayo.setFromCamera(ptr, cam); const hits = rayo.intersectObjects(interactivos, true); return hits.length ? raizDe(hits[0].object) : null; };
    let hover = null, abajo = null;
    const onMove = (ev) => { const r = golpe(ev); renderer.domElement.style.cursor = r ? 'pointer' : 'grab'; if (r !== hover) { if (hover?.userData.etiq && !hover.userData.siempre) hover.userData.etiq.visible = false; hover = r; if (r?.userData.etiq) r.userData.etiq.visible = true; } };
    const onDown = (ev) => { abajo = { x: ev.clientX, y: ev.clientY }; };
    const onUp = (ev) => {
      if (!abajo || Math.hypot(ev.clientX - abajo.x, ev.clientY - abajo.y) > 5) return; abajo = null;
      const r = golpe(ev); if (!r) { onSeleccion?.(null); anillo.visible = false; return; }
      onSeleccion?.(r.userData.info);
      const p = new THREE.Vector3(); r.getWorldPosition(p); const t = r.userData.info.tipo, esSala = t === 'sala' || t === 'anexo';
      anillo.visible = !esSala; anillo.position.set(p.x, 0.16, p.z); anillo.scale.setScalar(t === 'proyecto' ? 0.9 : 1.1);
    };
    const el = renderer.domElement; el.addEventListener('pointermove', onMove); el.addEventListener('pointerdown', onDown); el.addEventListener('pointerup', onUp);

    const ajustar = () => { const w = cont.clientWidth, h = Math.max(260, cont.clientHeight); renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); const K = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) / h) * 0.4; scene.traverse(o => { if (o.isSprite && o.userData.px) o.scale.set(o.userData.px.w * K, o.userData.px.h * K, 1); }); };
    ajustar(); const ro = new ResizeObserver(ajustar); ro.observe(cont);
    const reloj = new THREE.Clock(); let ema = 16, cuenta = 0, sombrasOn = true;
    renderer.setAnimationLoop(() => {
      const dt = reloj.getDelta(), t = reloj.elapsedTime;
      // en ordenadores flojos se quitan las sombras para que siga fluido
      ema = ema * 0.95 + dt * 1000 * 0.05;
      if (sombrasOn && ++cuenta > 120 && ema > 42) { sombrasOn = false; renderer.shadowMap.enabled = false; sol.castShadow = false; scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; }); }); }
      animados.forEach(g => {
        const f = g.userData.fase; g.userData.brazos.forEach((b, i) => { b.rotation.x = g.userData.sentado ? -1.15 + Math.sin(t * 7 + f + i * 1.7) * 0.12 : 0.1 + Math.sin(t * 1.5 + f + i * Math.PI) * 0.15; });
        if (!g.userData.sentado) g.position.y = 0.1 + Math.abs(Math.sin(t * 1.5 + f)) * 0.02;
        const r = g.userData.rombo; if (r) r.rotation.y = t * 1.6;
      });
      const dist = cam.position.distanceTo(ctrl.target); lodEtiquetas.forEach(e => { e.visible = dist < e.userData.lod; });
      if (anillo.visible) anillo.rotation.z = t;
      ctrl.update(); renderer.render(scene, cam);
    });

    return () => {
      vivo = false; renderer.setAnimationLoop(null); ro.disconnect(); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerup', onUp);
      ctrl.dispose(); scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.map?.dispose?.(); m.emissiveMap?.dispose?.(); m.dispose?.(); }); if (o.geometry) o.geometry.dispose?.(); });
      renderer.dispose(); renderer.forceContextLoss?.(); if (el.parentNode) el.parentNode.removeChild(el);
    };
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={caja} style={{ width: '100%', height: 'min(74vh, 700px)', minHeight: 380, borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(186,175,165,0.25)', background: PAL.fondo, touchAction: 'none' }} />;
}
