import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// Campus de Ranuse en estilo gemelo digital: edificios sólidos de grafito con vetas de luz.
// - Headquarters: recepción, estudio de diseño, ventas, presupuestos, finanzas y sala del equipo, con su gente dentro.
// - Proyectos: cada uno es un gym que sale del suelo, unido con arcos de luz a los departamentos que intervienen.
// - Proveedores: un almacén o una oficina por sector, con un stand (logo) por empresa.

const LUZ = { rojo: '#ff6b57', ambar: '#ffb347', gris: '#8f8a85', verde: '#4be3a0' };
const TAUPE = '#baafa5';
const DEP = {
  diseno: { c: '#e8c98f', nombre: 'Diseño y proyectos' }, ventas: { c: '#6fd0ff', nombre: 'Ventas y leads' }, presupuestos: { c: '#a78bfa', nombre: 'Presupuestos' },
  finanzas: { c: '#4be3a0', nombre: 'Finanzas' }, equipo: { c: '#baafa5', nombre: 'Sala del equipo' },
};
const SALAS = {
  diseno: { x: -20, z: -8, w: 16, d: 16, suelo: 'madera' }, ventas: { x: 0, z: -12, w: 10, d: 9, suelo: 'moqueta' }, presupuestos: { x: 14, z: -12, w: 10, d: 9, suelo: 'marmol' },
  finanzas: { x: 0, z: 3, w: 10, d: 9, suelo: 'moqueta' }, equipo: { x: 14, z: 3, w: 10, d: 9, suelo: 'madera' },
};
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
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  if (tipo === 'madera') {
    g.fillStyle = '#b48e66'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 8; i++) { g.fillStyle = `rgba(${i % 2 ? '0,0,0' : '255,255,255'},${0.04 + (i % 3) * 0.02})`; g.fillRect(0, i * 32, 256, 32); g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, i * 32, 256, 1.5); g.fillRect(((i * 97) % 200) + 20, i * 32, 1.5, 32); }
  } else if (tipo === 'marmol') {
    g.fillStyle = '#e4dfd6'; g.fillRect(0, 0, 256, 256); g.strokeStyle = 'rgba(80,70,60,0.18)'; g.lineWidth = 1.5;
    for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(Math.random() * 256, 0); g.bezierCurveTo(Math.random() * 256, 80, Math.random() * 256, 170, Math.random() * 256, 256); g.stroke(); }
    g.strokeStyle = 'rgba(186,175,165,0.25)'; g.lineWidth = 2; g.strokeRect(1, 1, 254, 254);
  } else {
    g.fillStyle = '#8d857b'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1600; i++) { g.fillStyle = `rgba(${Math.random() > 0.5 ? '255,255,255' : '0,0,0'},0.05)`; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.5;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    cont.appendChild(renderer.domElement); renderer.domElement.style.display = 'block'; renderer.domElement.style.touchAction = 'none';
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#08080a'); scene.fog = new THREE.Fog('#08080a', 110, 260);
    const cam = new THREE.PerspectiveCamera(36, 1, 0.5, 500);
    const ctrl = new OrbitControls(cam, renderer.domElement);
    const OBJ = new THREE.Vector3(22, 0, 4);
    ctrl.target.copy(OBJ); cam.position.set(OBJ.x + 48, 46, OBJ.z + 62);
    ctrl.enableDamping = true; ctrl.minDistance = 8; ctrl.maxDistance = 190; ctrl.minPolarAngle = 0.35; ctrl.maxPolarAngle = 1.25; ctrl.screenSpacePanning = false; ctrl.update();

    scene.add(new THREE.HemisphereLight('#fff4e6', '#7a6e63', 1.8));
    const sol = new THREE.DirectionalLight('#fff1dd', 2.3); sol.position.set(34, 58, 44); sol.target.position.set(22, 0, 12); scene.add(sol, sol.target);
    sol.castShadow = true; sol.shadow.mapSize.set(2048, 2048); Object.assign(sol.shadow.camera, { left: -72, right: 72, top: 72, bottom: -72, near: 5, far: 190 }); sol.shadow.bias = -0.0005;
    const relleno = new THREE.DirectionalLight('#ffd9b0', 0.35); relleno.position.set(-40, 24, -30); scene.add(relleno);

    const brillo = texturaBrillo();
    const mats = new Map(), geos = new Map();
    const G = (k, f) => { if (!geos.has(k)) geos.set(k, f()); return geos.get(k); };
    const M = (c, o = {}) => { const k = c + JSON.stringify(o); if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.05, ...o })); return mats.get(k); };
    const ME = (c, i = 1) => M(c, { emissive: c, emissiveIntensity: i, roughness: 0.4 });
    const sombrear = (m, c = true) => { m.castShadow = c; m.receiveShadow = true; return m; };
    const poner = (m, x, y, z, parent) => { m.position.set(x, y, z); parent.add(m); return m; };
    const mundo = new THREE.Group(); scene.add(mundo);
    const caja3 = (w, h, d, c, x, y, z, parent = mundo, o, sh = true) => sombrear(poner(new THREE.Mesh(G(`b${w},${h},${d}`, () => new RoundedBoxGeometry(w, h, d, 2, Math.min(0.05, Math.min(w, h, d) * 0.4))), typeof c === 'string' ? M(c, o) : c), x, y, z, parent), sh);
    const cil = (r, h, c, x, y, z, parent = mundo, o) => sombrear(poner(new THREE.Mesh(G(`c${r},${h}`, () => new THREE.CylinderGeometry(r, r, h, 20)), M(c, o)), x, y, z, parent));
    const esf = (r, c, x, y, z, parent = mundo, o) => sombrear(poner(new THREE.Mesh(G(`s${r}`, () => new THREE.SphereGeometry(r, 20, 16)), typeof c === 'string' ? M(c, o) : c), x, y, z, parent));
    const interactivos = [], animados = [], lod = [], subidas = [], stands = [], arcos = [], posProy = {}, pulsosAtencion = [];
    const marcar = (obj, info) => { obj.userData.info = info; interactivos.push(obj); obj.traverse(o => { if (o !== obj) o.userData.root = obj; }); };
    const halo = (color, x, y, z, esc, parent, o = 0.9) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: brillo, color, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false })); s.position.set(x, y, z); s.scale.set(esc, esc, 1); parent.add(s); return s; };
    const aro3 = (r, color, x, y, z, parent, o = 0.9) => { const m = new THREE.Mesh(G(`ring${r}`, () => new THREE.RingGeometry(r * 0.84, r, 48)), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: o, side: THREE.DoubleSide, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); parent.add(m); return m; };
    const rotulo = (texto, x, y, z, opts, lim) => { const e = etiqueta(texto, opts); e.position.set(x, y, z); mundo.add(e); if (lim) { e.userData.lod = lim; lod.push(e); } return e; };
    // vetas de luz: línea fina emisiva alrededor de un rectángulo
    const contorno = (x, z, w, d, color, y = 0.12, parent = mundo) => { [[w, 0.06, x, z - d / 2], [w, 0.06, x, z + d / 2]].forEach(([ww, hh, xx, zz]) => caja3(ww, 0.04, 0.06, M(TAUPE, { metalness: 0.5, roughness: 0.4 }), xx, y, zz, parent, null, false)); [[x - w / 2], [x + w / 2]].forEach(([xx]) => caja3(0.06, 0.04, d, M(TAUPE, { metalness: 0.5, roughness: 0.4 }), xx, y, z, parent, null, false)); };
    // paredes sólidas de grafito; con hueco de puerta opcional
    const GRAFITO = '#d9d2c7';
    const paredH = (x0, z, w, h, color, gap = 0) => { const seg = (xa, wa) => { if (wa <= 0.1) return; caja3(wa, h, 0.26, GRAFITO, xa + wa / 2, h / 2 + 0.1, z, mundo, { roughness: 0.55 }); caja3(wa, 0.06, 0.3, M(color, { roughness: 0.5 }), xa + wa / 2, h + 0.12, z, mundo, null, false); caja3(wa, 0.14, 0.3, TAUPE, xa + wa / 2, 0.17, z, mundo, { metalness: 0.4 }, false); }; if (gap > 0) { const l = (w - gap) / 2; seg(x0, l); seg(x0 + l + gap, l); } else seg(x0, w); };
    const paredV = (x, z0, d, h, color, gap = 0) => { const seg = (za, da) => { if (da <= 0.1) return; caja3(0.26, h, da, GRAFITO, x, h / 2 + 0.1, za + da / 2, mundo, { roughness: 0.55 }); caja3(0.3, 0.06, da, M(color, { roughness: 0.5 }), x, h + 0.12, za + da / 2, mundo, null, false); caja3(0.3, 0.14, da, TAUPE, x, 0.17, za + da / 2, mundo, { metalness: 0.4 }, false); }; if (gap > 0) { const l = (d - gap) / 2; seg(z0, l); seg(z0 + l + gap, l); } else seg(z0, d); };
    const ventana = (x, y, z, rot, w = 1.8, h = 1.1) => { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rot; mundo.add(g); caja3(w + 0.14, h + 0.14, 0.1, TAUPE, 0, 0, 0, g, { metalness: 0.5 }, false); const cr = new THREE.Mesh(new THREE.PlaneGeometry(w, h), M('#bfd6ee', { emissive: '#9fc3e6', emissiveIntensity: 0.55 })); cr.position.z = 0.06; g.add(cr); };
    const pantalla = (x, y, z, rot, w, h, color = '#3b6fd4') => { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rot; mundo.add(g); caja3(w + 0.1, h + 0.1, 0.06, '#101013', 0, 0, 0, g, null, false); const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), M('#2b2f36', { emissive: '#3a4250', emissiveIntensity: 0.35 })); p.position.z = 0.04; g.add(p); };

    // ── terreno y losas ──
    const fondo = document.createElement('canvas'); fondo.width = fondo.height = 256; { const g = fondo.getContext('2d'), gr = g.createRadialGradient(128, 128, 5, 128, 128, 128); gr.addColorStop(0, '#1d1b1a'); gr.addColorStop(0.6, '#0e0d0d'); gr.addColorStop(1, '#08080a'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); }
    const ft = new THREE.CanvasTexture(fondo); ft.colorSpace = THREE.SRGBColorSpace;
    const terreno = new THREE.Mesh(new THREE.PlaneGeometry(340, 280), new THREE.MeshBasicMaterial({ map: ft })); terreno.rotation.x = -Math.PI / 2; terreno.position.set(22, -0.3, 16); mundo.add(terreno);
    const rej = new THREE.GridHelper(220, 110, '#26221f', '#17151a'); rej.position.set(22, -0.28, 16); rej.material.transparent = true; rej.material.opacity = 0.25; mundo.add(rej);
    const losa = (x, z, w, d, h = 0.4, color = '#2a2622') => { caja3(w, h, d, color, x, -h / 2 + 0.05, z, mundo, { roughness: 0.6 }, false).receiveShadow = true; contorno(x, z, w, d, TAUPE, 0.08); };
    const pavimento = (x, z, w, d, color = '#3a3632') => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), M(color, { roughness: 0.35, metalness: 0.2 })); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.06, z); m.receiveShadow = true; mundo.add(m); };
    losa(2, 0, 52, 32); pavimento(2, 0, 50, 30);

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
    const planta = (x, z, s = 1) => { const g = new THREE.Group(); g.position.set(x, 0.1, z); g.scale.setScalar(s); mundo.add(g); cil(0.3, 0.5, '#2b2b30', 0, 0.25, 0, g); [[0, 1.0, 0, 0.4], [0.18, 1.35, 0.08, 0.28], [-0.16, 1.25, -0.06, 0.3]].forEach(([a, b, c, r]) => esf(r, '#3f7d5a', a, b, c, g)); };
    const lampara = (x, z, h = 2) => { const g = new THREE.Group(); g.position.set(x, 0.1, z); mundo.add(g); cil(0.16, 0.06, '#222', 0, 0.03, 0, g); cil(0.022, h, '#222', 0, h / 2, 0, g); esf(0.18, ME('#fff1d6', 1.4), 0, h + 0.12, 0, g).castShadow = false; halo('#ffd9a0', 0, h + 0.12, 0, 1.8, g, 0.5); };
    const sofa = (x, z, rot, color = '#4a4540') => { const g = new THREE.Group(); g.position.set(x, 0.1, z); g.rotation.y = rot; mundo.add(g); caja3(2.6, 0.42, 1, color, 0, 0.32, 0, g); caja3(2.6, 0.7, 0.26, color, 0, 0.78, -0.38, g); [-1.2, 1.2].forEach(s => caja3(0.28, 0.68, 1, color, s, 0.52, 0, g)); };
    const estante = (x, z, rot, w = 2.4) => { const g = new THREE.Group(); g.position.set(x, 0.1, z); g.rotation.y = rot; mundo.add(g); caja3(w, 2.2, 0.4, '#1a1a1e', 0, 1.1, 0, g); [0.4, 0.95, 1.5, 2.0].forEach(y => caja3(w - 0.1, 0.04, 0.38, '#34343c', 0, y, 0.01, g, null, false)); ['#ece8e1', TAUPE, '#a9895d', '#6b6259', '#2e3a52'].forEach((c, i) => [0.62, 1.17, 1.72].forEach(y => caja3(0.34, 0.42, 0.3, c, -w / 2 + 0.4 + i * (w - 0.7) / 5, y, 0.03, g, null, false))); };
    const alfombra = (x, z, w, d, c) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), M(c, { roughness: 1 })); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.12, z); m.receiveShadow = true; mundo.add(m); };

    // ── HEADQUARTERS ──
    const anclas = {};
    Object.entries(SALAS).forEach(([id, s]) => {
      const dep = data.departamentos.find(d => d.id === id), col = DEP[id].c, cx = s.x + s.w / 2, cz = s.z + s.d / 2;
      const t = texturaSuelo(s.suelo); t.repeat.set(s.w / 4, s.d / 4);
      const piso = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.d), new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, metalness: 0.1 })); piso.rotation.x = -Math.PI / 2; piso.position.set(cx, 0.1, cz); piso.receiveShadow = true; mundo.add(piso);
      marcar(piso, { tipo: 'sala', id, nombre: DEP[id].nombre, ir: dep?.ir, datos: dep?.datos || [], detalle: dep?.detalle || [], alerta: dep?.alerta || 'verde' });
      contorno(cx, cz, s.w - 0.4, s.d - 0.4, col, 0.14);
      paredH(s.x, s.z, s.w, 3.4, col); paredV(s.x, s.z, s.d, 3.4, col);
      paredH(s.x, s.z + s.d, s.w, 0.55, col, 3); paredV(s.x + s.w, s.z, s.d, 0.55, col, 3);
      anclas[id] = new THREE.Vector3(cx, 5.2, cz);
      const cartel = etiqueta(DEP[id].nombre, { fs: 28, punto: LUZ[dep?.alerta || 'verde'], borde: 'rgba(60,50,40,0.14)' }); cartel.position.copy(anclas[id]); mundo.add(cartel);
    });
    // exterior del edificio: muros del fondo, fachada baja y cartel
    paredH(-23, -15, 50, 3.8, TAUPE); paredV(-23, -15, 30, 3.8, TAUPE); paredH(-23, 15, 50, 0.6, TAUPE, 6); paredV(27, -15, 30, 0.6, TAUPE, 6);
    [-17, -9, 3, 12, 21].forEach(x => ventana(x, 2.2, -14.85, 0, 2.4, 1.3)); [-9, 0, 9].forEach(z => ventana(-22.85, 2.2, z, Math.PI / 2, 2.4, 1.3));
    // recepción y showroom (planta baja, zona sur-oeste)
    const rec = { x: -20, z: 9.5 }; alfombra(-14, 11.5, 9, 4, '#cfc6b8');
    caja3(4.2, 1.05, 1.1, '#1a1a1e', -14, 0.62, 12.5, mundo, { roughness: 0.4 }); caja3(4.4, 0.08, 1.3, TAUPE, -14, 1.17, 12.5, mundo, { metalness: 0.6, roughness: 0.3 }); caja3(0.06, 0.02, 3.6, ME(TAUPE, 1.2), -14, 0.18, 12.0, mundo, null, false);
    pantalla(-14, 2.6, 14.8, Math.PI, 3.4, 1.5, '#1a1a1f'); rotulo('Recepción de Ranuse', -14, 4.1, 13.9, { fs: 24 }, 60);
    sofa(-20, 10.5, Math.PI / 2, '#3a3f4b'); sofa(-8.5, 10.5, -Math.PI / 2, '#3a3f4b'); caja3(1.3, 0.1, 0.8, '#222', -19.2, 0.5, 11.5, mundo); planta(-21.5, 14, 1.2); planta(-6.5, 14, 1.2); lampara(-22, 7.5);
    estante(-12, 8.55, Math.PI, 3.2); estante(-17, 8.55, Math.PI, 3.2);
    // paseo central y pasillos con vetas de luz
    [[-2, -9, 0.1, 18], [12, -9, 0.1, 18]].forEach(([x, z, w, d]) => caja3(w, 0.03, d, ME(TAUPE, 0.8), x, 0.1, z, mundo, null, false));

    // ── la gente y los agentes ──
    const avDe = (p) => p.avatar || {};
    const punto = (info, x, z, color, opts) => {
      const g = persona({ av: avDe(info), id: info.id || info.nombre, ...opts }); g.position.set(x, 0.1, z); if (opts.rot != null) g.rotation.y = opts.rot; mundo.add(g);
      aro3(0.62, color, x, 0.16, z, mundo); halo(color, x, 0.3, z, 1.8, mundo, 0.55);
      const diana = new THREE.Mesh(G('diana', () => new THREE.CylinderGeometry(0.7, 0.7, 2.3, 10)), new THREE.MeshBasicMaterial({ visible: false })); diana.position.set(0, 1.1, 0); g.add(diana);
      marcar(g, info); return g;
    };
    const perso = data.personas || [], rolDe = p => String(p.rol || '').toLowerCase();
    const disen = perso.filter(p => /dise/.test(rolDe(p))), comer = perso.filter(p => /comercial|ventas|setter/.test(rolDe(p))), direc = perso.filter(p => /admin|direc|socio/.test(rolDe(p)));
    const resto = perso.filter(p => ![...disen, ...comer, ...direc].includes(p));
    const pDis = [[-16, -4.5], [-11, -4.5], [-6, -4.5], [-16, 0.5], [-11, 0.5], [-6, 0.5]], pVen = [[2.6, -9], [5.4, -9], [8.1, -9], [2.6, -5.6], [5.4, -5.6]];
    const sobran = [];
    const sentar = (p, x, z) => { mesaOf(x, z - 1.0, 0); sillaOf(x, z, Math.PI); punto({ tipo: 'persona', ...p }, x, z, luzPersona(p), { sentado: true, rot: Math.PI }); nombre(p, x, z, 3.1, luzPersona(p)); };
    disen.forEach((p, k) => (k < pDis.length ? sentar(p, pDis[k][0], pDis[k][1]) : sobran.push(p)));
    comer.forEach((p, k) => (k < pVen.length ? sentar(p, pVen[k][0], pVen[k][1]) : sobran.push(p)));
    direc.forEach((p, k) => { const x = -17 + k * 4.4, z = 5.4; mesaOf(x, z - 1.0, 0, 2.6); sillaOf(x, z, Math.PI); punto({ tipo: 'persona', ...p }, x, z, luzPersona(p), { sentado: true, rot: Math.PI }); nombre(p, x, z, 3.1, luzPersona(p)); });
    const lounge = [[16.5, 6.5, 0.6], [20.5, 8.5, -0.5], [22, 5.5, 2.2], [17.5, 10, 0.2], [21, 10.5, 3], [19, 5, 1]];
    [...resto, ...sobran].slice(0, lounge.length).forEach((p, k) => { const [x, z, r] = lounge[k]; punto({ tipo: 'persona', ...p }, x, z, luzPersona(p), { sentado: false, rot: r }); nombre(p, x, z, 3.1, luzPersona(p)); });
    const puestoAg = { diseno: [-3, 4.8], ventas: [8.2, -5.6], presupuestos: [22, -5], finanzas: [5, 7.5] };
    (data.agentes || []).forEach(a => { const pt = puestoAg[a.sala]; if (!pt) return; mesaOf(pt[0], pt[1] - 1.0, 0); sillaOf(pt[0], pt[1], Math.PI); punto({ tipo: 'agente', ...a }, pt[0], pt[1], '#6fd0ff', { sentado: true, robot: true, rot: Math.PI }); rotulo(a.nombre.replace('Asistente de ', '').replace('Asistente ', ''), pt[0], 3.1, pt[1], { fs: 22, color: '#1f5d7a' }, 80); });
    // mobiliario de cada sala
    estante(-12, -7.55, 0, 4.6); estante(-7, -7.55, 0, 3.2); pantalla(-17.5, 2.2, -7.8, 0, 3.4, 1.6, '#1f3a66'); planta(-4.8, 6.5, 1.2); planta(-19, 6.8, 1.1); sofa(-18, 6.4, 0, '#2a2f3a'); alfombra(-11, 0, 10, 8, '#cfc6b8'); lampara(-19.4, -7.2);
    pantalla(5, 2.2, -11.85, 0, 4, 1.6, '#1d4a66'); alfombra(5, -6.5, 8, 6, '#d7cfc3'); planta(0.8, -11.2); planta(9.2, -3.8);
    caja3(4.2, 0.1, 2.2, '#1a1a1e', 19, 0.82, -7.5, mundo, { roughness: 0.3 }); cil(0.12, 0.75, '#222', 19, 0.45, -7.5); for (let i = 0; i < 6; i++) { const an = (i / 6) * Math.PI * 2; sillaOf(19 + Math.cos(an) * 2.6, -7.5 + Math.sin(an) * 1.7, -an + Math.PI / 2); } pantalla(19, 2.2, -11.85, 0, 4.4, 1.7, '#3a2a66'); planta(14.8, -11);
    mesaOf(3, 6.2, 0); sillaOf(3, 7.2, Math.PI); mesaOf(7, 6.2, 0); sillaOf(7, 7.2, Math.PI); [1.2, 2.4, 3.6].forEach(x => caja3(1, 1.5, 0.6, '#34343c', x, 0.85, 11.5, mundo)); planta(9.2, 4); pantalla(5, 2.2, 3.15, 0, 3.4, 1.5, '#1f5a3c');
    sofa(18, 3.8, 0, '#4a4540'); sofa(14.8, 7, Math.PI / 2, '#4a4540'); caja3(1.4, 0.1, 0.9, '#222', 18, 0.5, 6, mundo); alfombra(18, 6.4, 5.5, 4, '#d9c8b2'); caja3(3.6, 1.0, 0.9, '#1a1a1e', 21, 0.62, 11.3, mundo); caja3(3.6, 0.08, 1.1, TAUPE, 21, 1.15, 11.3, mundo, { metalness: 0.6 }); planta(23.2, 4.5, 1.2); planta(14.8, 11.2); lampara(23.4, 11.4);

    // ── proyectos: un gym por proyecto (sólido), que sale del suelo y se conecta con los departamentos ──
    rotulo('Proyectos en marcha', 50, 5.6, -15.5, { fs: 30, borde: 'rgba(60,50,40,0.14)' });
    const equipo = (tipo, g, ox, oz) => {
      if (tipo === 0) { [-0.8, 0.8].forEach(s => caja3(0.12, 2.3, 0.12, '#3a3a42', ox + s, 1.25, oz, g, { metalness: 0.7, roughness: 0.4 })); caja3(1.8, 0.12, 0.14, '#3a3a42', ox, 2.4, oz, g, { metalness: 0.7 }); caja3(2.4, 0.08, 1.8, '#6b4a2f', ox, 0.14, oz + 0.2, g); cil(0.03, 2.2, '#c7c7cf', ox, 1.35, oz + 0.2, g, { metalness: 0.9 }).rotation.z = Math.PI / 2; [-1, 1].forEach(s => cil(0.28, 0.06, '#18181c', ox + s * 1.0, 1.35, oz + 0.2, g).rotation.z = Math.PI / 2); }
      else if (tipo === 1) { caja3(0.9, 0.16, 2.1, '#18181c', ox, 0.32, oz, g); caja3(0.9, 0.06, 1.9, GRAFITO, ox, 0.44, oz, g); caja3(0.1, 1.1, 0.1, '#3a3a42', ox - 0.4, 0.95, oz - 0.95, g); caja3(0.1, 1.1, 0.1, '#3a3a42', ox + 0.4, 0.95, oz - 0.95, g); caja3(0.7, 0.34, 0.06, '#0e0e11', ox, 1.45, oz - 0.95, g, { emissive: '#4be3a0', emissiveIntensity: 0.5 }, false); }
      else if (tipo === 2) { caja3(0.62, 0.14, 1.5, '#18181c', ox, 0.42, oz, g); caja3(0.62, 0.5, 0.14, '#18181c', ox, 0.72, oz - 0.6, g); [0.4, 0.8].forEach((y, i) => caja3(2.0, 0.05, 0.5, '#3a3a42', ox + 1.8, y, oz - 0.3, g, { metalness: 0.7 })); for (let i = 0; i < 5; i++) { cil(0.1, 0.3, '#18181c', ox + 1.0 + i * 0.4, 0.62, oz - 0.3, g).rotation.z = Math.PI / 2; cil(0.1, 0.3, '#18181c', ox + 1.0 + i * 0.4, 1.02, oz - 0.3, g).rotation.z = Math.PI / 2; } }
      else { caja3(1.2, 2.3, 0.8, '#3a3a42', ox, 1.3, oz, g, { metalness: 0.6 }); for (let i = 0; i < 8; i++) caja3(0.8, 0.1, 0.5, '#18181c', ox, 0.5 + i * 0.2, oz, g); cil(0.03, 1.2, '#c7c7cf', ox + 0.9, 1.4, oz + 0.2, g, { metalness: 0.9 }); }
    };
    const NC = 4, PX = 9.8, PZ = 8.8, X0 = 36, Z0 = -12;
    data.proyectos.slice(0, 16).forEach((p, i) => {
      const gx = X0 + (i % NC) * PX, gz = Z0 + Math.floor(i / NC) * PZ, comercial = p.tipo === 'comercial', W = comercial ? 7.4 : 6, D = comercial ? 6.2 : 5, col = LUZ[p.semaforo];
      posProy[p.id] = new THREE.Vector3(gx, 0, gz);
      const gg = new THREE.Group(); gg.position.set(gx, 0, gz); mundo.add(gg);
      caja3(W + 0.8, 0.3, D + 0.8, '#2a2622', 0, -0.05, 0, gg, { roughness: 0.6 }, false).receiveShadow = true;
      const piso = new THREE.Mesh(new THREE.PlaneGeometry(W, D), M('#6a645b', { roughness: 0.85 })); piso.rotation.x = -Math.PI / 2; piso.position.y = 0.11; piso.receiveShadow = true; gg.add(piso);
      caja3(W, 3.2, 0.26, GRAFITO, 0, 1.7, -D / 2, gg); caja3(0.26, 3.2, D, GRAFITO, -W / 2, 1.7, 0, gg); caja3(W, 0.6, 0.26, GRAFITO, 0, 0.4, D / 2, gg); caja3(0.26, 0.6, D, GRAFITO, W / 2, 0.4, 0, gg);
      const tira = caja3(W + 0.3, 0.1, 0.34, ME(col, 1.4), 0, 3.35, -D / 2, gg, null, false); caja3(0.34, 0.1, D + 0.3, ME(col, 1.4), -W / 2, 3.35, 0, gg, null, false); [[0, D / 2, W + 0.3, 0.34], [W / 2, 0, 0.34, D + 0.3]].forEach(([x, z, w, d]) => caja3(w, 0.08, d, ME(col, 1.2), x, 0.72, z, gg, null, false)); if (p.semaforo === 'rojo' || p.semaforo === 'ambar') pulsosAtencion.push(tira.material);
      const esp = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.62, 1.9), M('#b9c5cd', { metalness: 0.5, roughness: 0.22 })); esp.position.set(0, 1.5, -D / 2 + 0.15); gg.add(esp);
      const h0 = hash(p.id), n = comercial ? 4 : 2; for (let k = 0; k < n; k++) equipo((h0 + k) % 4, gg, -W / 2 + 1.5 + (k % 2) * 2.6, -D / 2 + 1.5 + Math.floor(k / 2) * 2.2);
      const etq = rotulo(corto(p.nombre, 26), gx, 5.0, gz, { fs: 24, borde: 'rgba(60,50,40,0.14)', punto: col }, 80);
      marcar(gg, { tipo: 'proyecto', ...p }); gg.userData.proy = p.id; gg.scale.y = 0.001; subidas.push({ g: gg, retardo: 0.4 + i * 0.12 });
      (p.deps || ['diseno']).forEach(dp => {
        const A = anclas[dp]; if (!A) return; const B = new THREE.Vector3(gx, 4.6, gz), dx = B.x - A.x, dz = B.z - A.z;
        const curva = new THREE.CubicBezierCurve3(A.clone(), new THREE.Vector3(A.x + dx * 0.25, 14, A.z + dz * 0.25), new THREE.Vector3(B.x - dx * 0.25, 14, B.z - dz * 0.25), B);
        const mat = new THREE.LineBasicMaterial({ color: DEP[dp].c, transparent: true, opacity: 0.13, depthWrite: false }); mundo.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curva.getPoints(60)), mat));
        arcos.push({ pid: p.id, curva, mat, pulso: halo(DEP[dp].c, 0, 0, 0, 1.5, mundo, 0), fase: Math.random() });
      });
    });

    // ── proveedores: un almacén o una oficina por sector ──
    rotulo('Red de colaboradores', 10, 5.6, 21.5, { fs: 30, borde: 'rgba(60,50,40,0.14)' });
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
      const t = texturaSuelo('hormigon'); t.repeat.set(WA / 4, DA / 4); const piso = new THREE.Mesh(new THREE.PlaneGeometry(WA, DA), new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, metalness: 0.15 })); piso.rotation.x = -Math.PI / 2; piso.position.y = 0.11; piso.receiveShadow = true; gA.add(piso);
      marcar(piso, { tipo: 'anexo', sector: a.sector, n: a.n, proveedores: a.proveedores, ir: 'contactos' });
      const alto = esAlmacen ? 4.2 : 3.4;
      caja3(WA, alto, 0.28, GRAFITO, 0, alto / 2 + 0.1, -DA / 2, gA); caja3(0.28, alto, DA, GRAFITO, -WA / 2, alto / 2 + 0.1, 0, gA); caja3(WA, 0.55, 0.28, GRAFITO, 0, 0.38, DA / 2, gA); caja3(0.28, 0.55, DA, GRAFITO, WA / 2, 0.38, 0, gA);
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
          const g = cv.getContext('2d'); g.fillStyle = '#101015'; g.fillRect(0, 0, 384, 480); g.strokeStyle = TAUPE; g.lineWidth = 5; g.strokeRect(8, 8, 368, 464);
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
      zona: (z) => { const Z = { todo: [OBJ, 100], catalogo: [new THREE.Vector3(4, 0, -36), 46], sede: [new THREE.Vector3(2, 0, 0), 40], proyectos: [new THREE.Vector3(52, 0, 2), 42], proveedores: [new THREE.Vector3(10, 0, 36), 50] }[z]; if (Z) volar(Z[0], Z[1]); },
      proyecto: (id) => { const p = posProy[id]; if (!p) return; volar(p, 22); const g = interactivos.find(o => o.userData.proy === id); if (g) elegir(g); },
      limpiar: () => elegir(null),
    };

    const ajustar = () => { const w = cont.clientWidth, h = Math.max(260, cont.clientHeight); renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); const K = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) / h) * 0.4; scene.traverse(o => { if (o.isSprite && o.userData.px) o.scale.set(o.userData.px.w * K, o.userData.px.h * K, 1); }); };
    ajustar(); const ro = new ResizeObserver(ajustar); ro.observe(cont);
    const reloj = new THREE.Clock(), tmp = new THREE.Vector3(), ease = (x) => 1 - Math.pow(1 - x, 3), easeBack = (x) => { const c = 1.4; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
    let ema = 16, cuenta = 0, sombrasOn = true;
    renderer.setAnimationLoop(() => {
      const dt = reloj.getDelta(), t = reloj.elapsedTime, ahora = performance.now();
      // en ordenadores flojos se quitan las sombras para que siga fluido
      ema = ema * 0.95 + dt * 1000 * 0.05; if (sombrasOn && ++cuenta > 150 && ema > 45) { sombrasOn = false; renderer.shadowMap.enabled = false; sol.castShadow = false; scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; }); }); }
      subidas.forEach(s => { const k = Math.min(1, Math.max(0, (t - s.retardo) / 1.3)); s.g.scale.y = Math.max(0.001, easeBack(k)); });
      if (vuelo) { const k = Math.min(1, (ahora - vuelo.t0) / 900), e = ease(k); ctrl.target.lerpVectors(vuelo.a, vuelo.b, e); cam.position.copy(ctrl.target).addScaledVector(vuelo.dir, vuelo.d0 + (vuelo.d1 - vuelo.d0) * e); if (k >= 1) vuelo = null; }
      const dist = cam.position.distanceTo(ctrl.target); lod.forEach(e => { e.visible = dist < e.userData.lod; });
      activo = (hover?.userData.proy) || selId;
      arcos.forEach(a => { const on = a.pid === activo, hay = !!activo; a.mat.opacity = on ? 0.9 : hay ? 0.04 : 0.13; const u = (t * 0.18 + a.fase) % 1; a.curva.getPoint(u, tmp); a.pulso.position.copy(tmp); a.pulso.material.opacity = on ? 0.95 : hay ? 0 : 0.3; a.pulso.scale.setScalar(on ? 2.0 : 0.9); });
      pulsosAtencion.forEach(m => { m.emissiveIntensity = 1.2 + Math.sin(t * 3) * 0.7; });
      animados.forEach(g => { const f = g.userData.fase; g.userData.brazos.forEach((b, i) => { b.rotation.x = g.userData.sentado ? -1.15 + Math.sin(t * 7 + f + i * 1.7) * 0.1 : 0.08 + Math.sin(t * 1.4 + f + i * Math.PI) * 0.1; }); });
      aro.rotation.z = t * 0.6; ctrl.update(); renderer.render(scene, cam);
    });

    return () => {
      vivo = false; renderer.setAnimationLoop(null); ro.disconnect(); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerup', onUp);
      if (apiRef) apiRef.current = null;
      ctrl.dispose(); scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.map?.dispose?.(); m.emissiveMap?.dispose?.(); m.dispose?.(); }); if (o.geometry) o.geometry.dispose?.(); });
      renderer.dispose(); renderer.forceContextLoss?.(); if (el.parentNode) el.parentNode.removeChild(el);
    };
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={caja} style={{ position: 'absolute', inset: 0, background: '#08080a', touchAction: 'none' }} />;
}
