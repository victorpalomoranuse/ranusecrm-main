import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import api from '../services/api';

// Visor 3D de un plano de Planos (lee su modelo3d). Pensado para gimnasios: paredes con puertas y ventanas,
// suelos por sala, pilares y máquinas como bloques con sus medidas. Las medidas del plano van en cm.
const CM = 0.01;

// Texturas subidas: se descargan una vez y se reutilizan; la repetición se ajusta al tamaño real (cm) de cada textura
const cacheTex = new Map();
function texturaDe(t, uvEnCm) {
  const k = uvEnCm ? 1 / t.tam : 1 / (t.tam * CM);
  const clave = t.url + '|' + k;
  let x = cacheTex.get(clave);
  if (!x) {
    x = new THREE.TextureLoader().load(t.url);
    x.wrapS = x.wrapT = THREE.RepeatWrapping; x.colorSpace = THREE.SRGBColorSpace; x.anisotropy = 4; x.repeat.set(k, k);
    cacheTex.set(clave, x);
  }
  return x;
}
// Aplica un color (#hex) o una textura ('tex:ID') a una malla; si no hay valor, vuelve a su color de origen
function pintar(mesh, valor, texturas, uvEnCm) {
  const u = mesh.userData;
  if (u.col0 === undefined) u.col0 = mesh.material.color.getHex();
  const t = valor && String(valor).startsWith('tex:') ? texturas.find(x => 'tex:' + x.id === valor) : null;
  if (t) { mesh.material.map = texturaDe(t, uvEnCm); mesh.material.color.setHex(0xffffff); }
  else { mesh.material.map = null; mesh.material.color.setHex(valor && /^#/.test(valor) ? parseInt(valor.slice(1), 16) : u.col0); }
  mesh.material.needsUpdate = true;
}

// Modelos 3D asignados a los productos: se descargan una vez y se reutilizan (se clonan) en cada copia
const cacheModelos = new Map();
function cargarModelo(m) {
  if (cacheModelos.has(m.url)) return cacheModelos.get(m.url);
  const t = String(m.tipo || '').toLowerCase();
  const p = new Promise((ok, mal) => {
    if (t === 'obj') new OBJLoader().load(m.url, ok, undefined, mal);
    else if (t === 'dae') new ColladaLoader().load(m.url, r => ok(r.scene), undefined, mal);
    else new GLTFLoader().load(m.url, r => ok(r.scene), undefined, mal);
  });
  p.catch(() => cacheModelos.delete(m.url));
  cacheModelos.set(m.url, p);
  return p;
}
// Mueble a medida por módulos: cuerpo (laterales, base, tapa, trasera, baldas), frentes (puertas, cajones, abierto o hueco) y tiradores.
// Medidas en cm; el mueble queda centrado en X y Z, apoyado en el suelo, con el frente hacia +Z.
function matMueble(valor, defHex, texturas, w, h) {
  const m = new THREE.MeshStandardMaterial({ color: color(/^#/.test(valor || '') ? valor : null, defHex), roughness: 0.6, metalness: 0 });
  const t = valor && String(valor).startsWith('tex:') ? texturas.find(x => 'tex:' + x.id === valor) : null;
  if (t) { const mp = texturaDe(t, true).clone(); mp.needsUpdate = true; mp.repeat.set(Math.max(0.2, w / t.tam), Math.max(0.2, h / t.tam)); m.map = mp; m.color.setHex(0xffffff); }
  return m;
}
export function construirMueble(o, texturas) {
  const M = o.mueble || {}, esp = (M.esp || 1.8) * CM, zoc = (M.zocalo ?? 10) * CM, ef = 1.9 * CM;
  const D = o.d * CM, H = o.alto * CM, mods = M.modulos || [];
  const total = mods.reduce((s, m) => s + m.w, 0) * CM;
  const cuerpo = matMueble(o.color, '#e8e2d8', texturas, o.w, o.alto), frente = matMueble(o.colorFrente || o.color, '#f4f1ec', texturas, 60, o.alto);
  const zocMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.8 }), tiradorMat = new THREE.MeshStandardMaterial({ color: 0xb8b8b8, roughness: 0.3, metalness: 0.8 });
  const g = new THREE.Group();
  const caja = (w, h, d, px, py, pz, mat, zona, padre) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w, 0.001), Math.max(h, 0.001), Math.max(d, 0.001)), mat);
    b.position.set(px, py, pz); b.castShadow = b.receiveShadow = true; b.userData.zona = zona; (padre || g).add(b); return b;
  };
  let x = -total / 2;
  mods.forEach(mod => {
    const W = mod.w * CM, cx = x + W / 2, hc = H - zoc, y0 = zoc, zf = D / 2 + ef / 2 + 0.001;
    if (zoc > 0) caja(W - 0.004, zoc, D - 0.05, cx, zoc / 2, -0.02, zocMat, 'cuerpo');
    caja(esp, hc, D, x + esp / 2, y0 + hc / 2, 0, cuerpo, 'cuerpo');
    caja(esp, hc, D, x + W - esp / 2, y0 + hc / 2, 0, cuerpo, 'cuerpo');
    caja(W - 2 * esp, esp, D, cx, y0 + esp / 2, 0, cuerpo, 'cuerpo');
    caja(W - 2 * esp, esp, D, cx, y0 + hc - esp / 2, 0, cuerpo, 'cuerpo');
    caja(W - 2 * esp, hc - 2 * esp, 0.006, cx, y0 + hc / 2, -D / 2 + 0.003, cuerpo, 'cuerpo');
    const nb = mod.t === 'abierto' ? (mod.nb ?? 3) : mod.t === 'puertas' ? (mod.nb ?? 1) : 0;
    for (let i = 1; i <= nb; i++) caja(W - 2 * esp, esp, D - 0.02, cx, y0 + esp + (hc - 2 * esp) * (i / (nb + 1)), -0.01, cuerpo, 'cuerpo');
    const conTirador = M.tirador !== 'ninguno';
    if (mod.t === 'puertas') {
      const nd = mod.n === 2 ? 2 : 1, wd = (W - 0.004) / nd, ang = 100 * Math.PI / 180;
      for (let k = 0; k < nd; k++) {
        const izq = nd === 1 || k === 0; // bisagra a la izquierda (la hoja derecha, a la derecha)
        const bis = izq ? x + 0.002 + wd * k : x + 0.002 + wd * (k + 1);
        const pivote = new THREE.Group(); pivote.position.set(bis, y0 + hc / 2, zf);
        if (mod.abierto) pivote.rotation.y = izq ? -ang : ang;
        caja(wd - 0.003, hc - 0.004, ef, izq ? wd / 2 : -wd / 2, 0, 0, frente, 'frente', pivote);
        if (conTirador) caja(0.012, 0.14, 0.014, izq ? wd - 0.04 : -wd + 0.04, 0, ef / 2 + 0.007, tiradorMat, 'frente', pivote);
        g.add(pivote);
      }
    } else if (mod.t === 'cajones') {
      const nc = Math.max(1, mod.n || 3), hf = (hc - 0.004) / nc, saca = mod.abierto ? 0.28 : 0;
      for (let i = 0; i < nc; i++) {
        const yc = y0 + 0.002 + hf * i + hf / 2;
        caja(W - 0.004, hf - 0.003, ef, cx, yc, zf + (i === 0 ? saca : 0), frente, 'frente');
        if (conTirador) caja(Math.min(0.16, W * 0.5), 0.012, 0.014, cx, yc + hf * 0.3, zf + ef / 2 + 0.007 + (i === 0 ? saca : 0), tiradorMat, 'frente');
        if (i === 0 && saca) caja(W - 2 * esp - 0.03, hf * 0.6, D * 0.75, cx, yc - 0.02, D / 2 - D * 0.375 + saca, cuerpo, 'cuerpo');
      }
    }
    x += W;
  });
  return g;
}
// Lista de piezas y metros cuadrados de tablero del mueble (para fabricar o presupuestar)
function despieceMueble(o) {
  const M = o.mueble || {}, e = M.esp || 1.8, hc = o.alto - (M.zocalo ?? 10), D = o.d, filas = {};
  const suma = (n, a, b, cant = 1) => { const k = n + ' ' + Math.round(a * 10) / 10 + ' × ' + Math.round(b * 10) / 10; filas[k] = (filas[k] || 0) + cant; };
  let area = 0;
  (M.modulos || []).forEach(m => {
    const wi = m.w - 2 * e;
    suma('Lateral', hc, D, 2); suma('Base y tapa', wi, D, 2); suma('Trasera (fina)', wi, hc - 2 * e); area += (2 * hc * D + 2 * wi * D + wi * (hc - 2 * e)) / 1e4;
    const nb = m.t === 'abierto' ? (m.nb ?? 3) : m.t === 'puertas' ? (m.nb ?? 1) : 0;
    if (nb) { suma('Balda', wi, D - 2, nb); area += nb * wi * (D - 2) / 1e4; }
    if (m.t === 'puertas') { const nd = m.n === 2 ? 2 : 1; suma('Puerta', m.w / nd - 0.3, hc - 0.4, nd); area += nd * (m.w / nd - 0.3) * (hc - 0.4) / 1e4; }
    if (m.t === 'cajones') { const nc = Math.max(1, m.n || 3); suma('Frente de cajón', m.w - 0.4, hc / nc - 0.3, nc); area += nc * (m.w - 0.4) * (hc / nc - 0.3) / 1e4; }
  });
  return { filas: Object.entries(filas), area: Math.round(area * 100) / 100 };
}

// El modelo se escala (sin deformarlo) para que quepa en las medidas del objeto y se apoya en el suelo, centrado
function ajustarModelo(raw, w, d, h) {
  const g = raw.clone(true);
  const caja = new THREE.Box3().setFromObject(g);
  const s = caja.getSize(new THREE.Vector3());
  if (!(s.x > 0 && s.y > 0 && s.z > 0)) return null;
  const k = Math.min(w / s.x, h / s.y, d / s.z);
  const c = caja.getCenter(new THREE.Vector3());
  const envoltorio = new THREE.Group();
  g.position.set(-c.x, -caja.min.y, -c.z);
  envoltorio.add(g);
  envoltorio.scale.setScalar(k);
  envoltorio.traverse(x => { if (x.isMesh) { x.castShadow = x.receiveShadow = true; } });
  return envoltorio;
}

const sel2 = (id, sel) => id === sel;
function cartel(texto) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const cx = cv.getContext('2d'); cx.fillStyle = 'rgba(0,0,0,0.78)'; cx.beginPath(); cx.roundRect ? cx.roundRect(4, 8, 248, 48, 12) : cx.rect(4, 8, 248, 48); cx.fill();
  cx.fillStyle = '#ffd34d'; cx.font = 'bold 34px sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(texto, 128, 33);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true }));
  sp.scale.set(0.5, 0.125, 1); sp.renderOrder = 1000; return sp;
}
// ── Sígueme: un perfil (u = hacia el lado, v = hacia arriba, en cm) recorre un camino, con esquinas en inglete
const PERFILES = {
  'Rodapié recto': [[0, 0], [1.5, 0], [1.5, 10], [0, 10]],
  'Rodapié biselado': [[0, 0], [1.8, 0], [1.8, 8], [0.8, 10], [0, 10]],
  'Moldura / cornisa': [[0, 0], [7, 0], [7, 1.5], [2.5, 5], [0, 5]],
  'Cuadrado 5×5': [[0, 0], [5, 0], [5, 5], [0, 5]],
  'Tubo Ø4': Array.from({ length: 16 }, (_, i) => [2 + 2 * Math.cos((i / 16) * 2 * Math.PI), 2 + 2 * Math.sin((i / 16) * 2 * Math.PI)]),
  'Perfil en L': [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]],
  'Bandeja 10×3': [[0, 0], [10, 0], [10, 3], [9.5, 3], [9.5, 0.5], [0.5, 0.5], [0.5, 3], [0, 3]],
};
function geometriaBarrido(path, perfil, esc, cerrado, lado) {
  const n = path.length; if (n < 2 || perfil.length < 3) return null;
  const m = cerrado ? n : n - 1, dirs = [];
  for (let i = 0; i < m; i++) { const a = path[i], b = path[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; dirs.push([(b[0] - a[0]) / L, (b[1] - a[1]) / L]); }
  const norm = d => [-d[1] * lado, d[0] * lado], mit = [];
  for (let i = 0; i < n; i++) {
    let dp = cerrado ? dirs[(i + m - 1) % m] : (i > 0 ? dirs[i - 1] : null), dn = cerrado ? dirs[i % m] : (i < m ? dirs[i] : null);
    if (!dp) dp = dn; if (!dn) dn = dp;
    const n1 = norm(dp), n2 = norm(dn); let sx = n1[0] + n2[0], sy = n1[1] + n2[1]; const sl = Math.hypot(sx, sy);
    if (sl < 1e-6) { mit.push([n1[0], n1[1]]); continue; }
    sx /= sl; sy /= sl; const cs = Math.max(0.35, sx * n1[0] + sy * n1[1]); mit.push([sx / cs, sy / cs]);
  }
  const pos = [], idx = [], np = perfil.length;
  for (let i = 0; i < n; i++) for (let j = 0; j < np; j++) { const u = perfil[j][0] * esc, v = perfil[j][1] * esc; pos.push((path[i][0] + mit[i][0] * u) * CM, v * CM, (path[i][1] + mit[i][1] * u) * CM); }
  for (let i = 0; i < m; i++) { const i2 = (i + 1) % n; for (let j = 0; j < np; j++) { const j2 = (j + 1) % np, a = i * np + j, b = i * np + j2, c = i2 * np + j2, d = i2 * np + j; idx.push(a, b, c, a, c, d); } }
  if (!cerrado) {
    const tri = THREE.ShapeUtils.triangulateShape(perfil.map(p => new THREE.Vector2(p[0], p[1])), []), o = (n - 1) * np;
    tri.forEach(t => { idx.push(t[0], t[1], t[2]); idx.push(o + t[2], o + t[1], o + t[0]); });
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function puntoEnPoligono(pt, pts) { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c; } return c; }

// ── Logos: SVG (contornos rellenos) o DXF (contornos cerrados) → formas con huecos, normalizadas a 100 cm de ancho
function normalizarFormas(formas, anchoCm = 100) {
  const todos = formas.flatMap(f => [...f.pts, ...f.holes.flat()]); if (!todos.length) return null;
  const xs = todos.map(p => p[0]), ys = todos.map(p => p[1]), minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  const k = anchoCm / ((maxx - minx) || 1), cx = (minx + maxx) / 2;
  const t = p => [Math.round((p[0] - cx) * k * 100) / 100, Math.round((p[1] - miny) * k * 100) / 100];
  const dec = a => { const paso = Math.max(1, Math.ceil(a.length / 350)); return a.filter((_, i) => i % paso === 0).map(t); };
  return { formas: formas.map(f => ({ pts: dec(f.pts), holes: f.holes.map(dec) })), alto: (maxy - miny) * k };
}
function formasDeSVG(texto) {
  const data = new SVGLoader().parse(texto), formas = [];
  data.paths.forEach(p => SVGLoader.createShapes(p).forEach(sh => formas.push({ pts: sh.getPoints(10).map(v => [v.x, -v.y]), holes: sh.holes.map(h => h.getPoints(10).map(v => [v.x, -v.y])) })));
  return formas;
}
function formasDeDXF(texto) {
  const lin = texto.split(/\r?\n/).map(s => s.trim()), pares = [];
  for (let i = 0; i + 1 < lin.length; i += 2) pares.push([parseInt(lin[i], 10), lin[i + 1]]);
  const ini = pares.findIndex((p, i) => p[0] === 2 && p[1] === 'ENTITIES' && i > 0 && pares[i - 1][1] === 'SECTION');
  const ents = []; let cur = null;
  for (let i = Math.max(0, ini); i < pares.length; i++) { const [c, v] = pares[i]; if (c === 0) { if (v === 'ENDSEC') break; cur = { t: v, d: [] }; ents.push(cur); } else if (cur) cur.d.push([c, v]); }
  const cerrados = [], abiertos = []; let poli = null;
  const lee = (d, c) => d.filter(p => p[0] === c).map(p => parseFloat(p[1]));
  const arco = (cx, cy, r, a1, a2) => { let d = a2 - a1; if (d <= 0) d += 360; const n = Math.max(6, Math.ceil(d / 8)); return Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos(((a1 + (d * i) / n) * Math.PI) / 180), cy + r * Math.sin(((a1 + (d * i) / n) * Math.PI) / 180)]); };
  ents.forEach(e => {
    const x = lee(e.d, 10), y = lee(e.d, 20), flag = parseInt((e.d.find(p => p[0] === 70) || [0, '0'])[1], 10) || 0;
    if (e.t === 'LWPOLYLINE') { const pts = x.map((v, i) => [v, y[i]]); (flag & 1 ? cerrados : abiertos).push(pts); }
    else if (e.t === 'POLYLINE') poli = { pts: [], cerrado: !!(flag & 1) };
    else if (e.t === 'VERTEX' && poli) poli.pts.push([x[0], y[0]]);
    else if (e.t === 'SEQEND' && poli) { (poli.cerrado ? cerrados : abiertos).push(poli.pts); poli = null; }
    else if (e.t === 'LINE') abiertos.push([[x[0], y[0]], [lee(e.d, 11)[0], lee(e.d, 21)[0]]]);
    else if (e.t === 'ARC') abiertos.push(arco(x[0], y[0], lee(e.d, 40)[0], lee(e.d, 50)[0], lee(e.d, 51)[0]));
    else if (e.t === 'CIRCLE') { const pts = arco(x[0], y[0], lee(e.d, 40)[0], 0, 360); pts.pop(); cerrados.push(pts); }
    else if (e.t === 'SPLINE') { const fx = lee(e.d, 11), fy = lee(e.d, 21), pts = fx.length ? fx.map((v, i) => [v, fy[i]]) : x.map((v, i) => [v, y[i]]); (flag & 1 ? cerrados : abiertos).push(pts); }
  });
  // unir los tramos abiertos que se tocan por los extremos hasta formar contornos cerrados
  const todos = [...cerrados, ...abiertos].flat(), ex = todos.map(p => p[0]), ey = todos.map(p => p[1]);
  const eps = Math.max(1e-6, (Math.max(...ex, 0) - Math.min(...ex, 0) + (Math.max(...ey, 0) - Math.min(...ey, 0))) * 1e-4);
  const igual = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= eps;
  let tramos = abiertos.filter(t => t.length >= 2).map(t => t.slice()), lazos = cerrados.filter(t => t.length >= 3).map(t => t.slice());
  while (tramos.length) {
    let t = tramos.shift(), unido = true;
    while (unido && !igual(t[0], t[t.length - 1])) {
      unido = false;
      for (let i = 0; i < tramos.length; i++) {
        const o = tramos[i];
        if (igual(t[t.length - 1], o[0])) { t = t.concat(o.slice(1)); }
        else if (igual(t[t.length - 1], o[o.length - 1])) { t = t.concat(o.slice().reverse().slice(1)); }
        else if (igual(t[0], o[o.length - 1])) { t = o.concat(t.slice(1)); }
        else if (igual(t[0], o[0])) { t = o.slice().reverse().concat(t.slice(1)); }
        else continue;
        tramos.splice(i, 1); unido = true; break;
      }
    }
    if (t.length >= 4 && igual(t[0], t[t.length - 1])) { t.pop(); lazos.push(t); }
  }
  if (!lazos.length) return [];
  // exteriores y huecos según la profundidad de anidamiento
  const area = p => Math.abs(p.reduce((s, q, i) => s + q[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * q[1], 0) / 2);
  lazos.sort((a, b) => area(b) - area(a));
  const prof = lazos.map((l, i) => lazos.filter((o, j) => j !== i && area(o) > area(l) && puntoEnPoligono(l[0], o)).length);
  const formas = [];
  lazos.forEach((l, i) => { if (prof[i] % 2 === 0) formas.push({ pts: l, holes: [], _i: i }); });
  lazos.forEach((l, i) => { if (prof[i] % 2 === 1) { const padre = formas.filter(f => area(lazos[f._i]) > area(l) && puntoEnPoligono(l[0], lazos[f._i])).pop(); if (padre) padre.holes.push(l); } });
  return formas.map(({ pts, holes }) => ({ pts, holes }));
}

// Contorno desplazado hacia dentro una distancia d (cm), con esquinas en inglete; vale para polígonos sencillos
function insetPoligono(pts, d) {
  const n = pts.length; if (n < 3) return pts;
  let a2 = 0; for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; a2 += p[0] * q[1] - q[0] * p[1]; }
  const sg = a2 > 0 ? 1 : -1; // orientación
  const rectas = pts.map((p, i) => {
    const q = pts[(i + 1) % n], L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, ux = (q[0] - p[0]) / L, uy = (q[1] - p[1]) / L;
    return { x: p[0] - sg * uy * d, y: p[1] + sg * ux * d, ux, uy }; // recta paralela, desplazada hacia dentro
  });
  const out = [];
  for (let i = 0; i < n; i++) {
    const A = rectas[(i + n - 1) % n], B = rectas[i], den = A.ux * B.uy - A.uy * B.ux;
    if (Math.abs(den) < 1e-6) { out.push([B.x, B.y]); continue; }
    const t = ((B.x - A.x) * B.uy - (B.y - A.y) * B.ux) / den;
    out.push([A.x + A.ux * t, A.y + A.uy * t]);
  }
  return out;
}
// Curva cerrada suave que pasa por los puntos (para contornos curvos)
function suavizar(pts) {
  if (pts.length < 3) return pts;
  const c = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], 0, p[1])), true, 'centripetal');
  return c.getPoints(Math.max(24, pts.length * 12)).slice(0, -1).map(v => [v.x, v.z]);
}
function color(hex, def) {
  try { return new THREE.Color(hex || def); } catch { return new THREE.Color(def); }
}

function muro(m, h0) {
  const [ax, ay] = m.a, [bx, by] = m.b;
  const L = Math.hypot(bx - ax, by - ay);
  if (L < 1) return null;
  const alto = (m.h || h0) ;
  const sh = new THREE.Shape();
  sh.moveTo(0, 0); sh.lineTo(L, 0); sh.lineTo(L, alto); sh.lineTo(0, alto); sh.closePath();
  for (const o of m.ab || []) {
    const x0 = Math.max(0.5, Math.min(L - 1, o.p)); // «p» = distancia desde el inicio del muro al borde del hueco
    const x1 = Math.max(x0 + 1, Math.min(L - 0.5, o.p + o.w));
    const y0 = Math.max(0, o.sill || 0);
    const y1 = Math.min(alto - 0.5, y0 + (o.h || 210));
    if (y1 <= y0) continue;
    const hole = new THREE.Path();
    hole.moveTo(x0, y0); hole.lineTo(x1, y0); hole.lineTo(x1, y1); hole.lineTo(x0, y1); hole.closePath();
    sh.holes.push(hole);
  }
  const t = m.t || 12;
  const g = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false });
  g.translate(0, 0, -t / 2);
  g.scale(CM, CM, CM);
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: m.estado === 'new' ? 0xf1ece6 : 0xe4e0db, roughness: 0.95 }));
  mesh.userData = { capa: 'muros', muroId: m.id };
  // puertas y ventanas: marco y hoja (puerta) o cristal (ventana), en el hueco del muro (el muro está en metros y centrado en su grosor)
  for (const o of m.ab || []) {
    const x0 = Math.max(0.5, Math.min(L - 1, o.p)), x1 = Math.max(x0 + 1, Math.min(L - 0.5, o.p + o.w));
    const y0 = Math.max(0, o.sill || 0), y1 = Math.min(alto - 0.5, y0 + (o.h || 210));
    if (y1 <= y0) continue;
    const w = (x1 - x0) * CM, h = (y1 - y0) * CM, cx = ((x0 + x1) / 2) * CM, cy = ((y0 + y1) / 2) * CM, tt = (m.t || 12) * CM;
    const fr = 0.05, marco = new THREE.MeshStandardMaterial({ color: o.t === 'door' || o.tipo === 'door' ? 0x8a6a4a : 0xf2f2f2, roughness: 0.6 });
    const parte = (bw, bh, bd, px, py, mat, extra) => { const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat); b.position.set(px, py, 0); b.castShadow = true; b.userData = { capa: 'huecos', hueco: { muroId: m.id, id: o.id || null, p: o.p, w: o.w, h: o.h, sill: o.sill || 0, tipo: o.tipo || o.t }, ...(extra || {}) }; mesh.add(b); return b; };
    parte(w, fr, tt * 1.02, cx, y1 * CM - fr / 2, marco); parte(w, fr, tt * 1.02, cx, y0 * CM + fr / 2, marco);
    parte(fr, h, tt * 1.02, x0 * CM + fr / 2, cy, marco); parte(fr, h, tt * 1.02, x1 * CM - fr / 2, cy, marco);
    if ((o.tipo || o.t) === 'door') parte(w - fr * 2, h - fr * 2, 0.04, cx, cy, new THREE.MeshStandardMaterial({ color: 0xc9a77c, roughness: 0.55 }));
    else parte(w - fr * 2, h - fr * 2, 0.01, cx, cy, new THREE.MeshStandardMaterial({ color: 0xaed4ea, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.35 }));
  }
  // El plano va en (x, y); en 3D, y del plano es z. El muro se dibuja a lo largo de X local y se gira hasta a→b.
  mesh.position.set(ax * CM, 0, ay * CM);
  mesh.rotation.y = -Math.atan2(by - ay, bx - ax);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

function suelo(s, i) {
  const pts = (s.pts || []).map(p => new THREE.Vector2(p[0] * CM, p[1] * CM));
  if (pts.length < 3) return null;
  const g = new THREE.ShapeGeometry(new THREE.Shape(pts));
  g.rotateX(Math.PI / 2); // el plano XY pasa a XZ (mirando hacia arriba)
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: color(s.suelo?.c, '#cfc9c2'), roughness: 0.85, side: THREE.DoubleSide }));
  mesh.position.y = 0.002;
  mesh.receiveShadow = true;
  mesh.userData = { capa: 'suelos', salaKey: s.idS || ('s' + i) };
  return mesh;
}

// Techo de una sala: una sola cara que mira hacia abajo, así desde arriba se ve el interior y desde dentro se ve el techo
function techo(s, i, alto) {
  const pts = (s.pts || []).map(p => new THREE.Vector2(p[0] * CM, p[1] * CM));
  if (pts.length < 3) return null;
  const g = new THREE.ShapeGeometry(new THREE.Shape(pts));
  g.rotateX(Math.PI / 2);
  const h = ((s.techo && s.techo.h) || alto || 260) * CM;
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: color(s.techo?.c, '#f6f4f1'), roughness: 0.95, side: THREE.FrontSide }));
  mesh.position.y = h;
  mesh.receiveShadow = true;
  mesh.userData = { capa: 'techos', techoKey: s.idT || ('s' + i) };
  return mesh;
}

function maquina(e) {
  const w = (e.largo || e.w || 100) * CM, d = (e.fondo || e.d || 100) * CM, h = (e.alto || 110) * CM;
  const g = new THREE.Group();
  const cuerpo = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color: e.estado === 'ex' ? 0xb8b8b8 : 0x2f6fa8, roughness: 0.5, metalness: 0.15 })
  );
  cuerpo.position.y = h / 2;
  cuerpo.castShadow = cuerpo.receiveShadow = true;
  g.add(cuerpo);
  g.position.set(e.cx * CM, 0, e.cy * CM);
  g.rotation.y = -(e.rot || 0) * Math.PI / 180;
  g.userData.capa = 'equipos';
  g.userData.equipo = e;
  g.userData.cuerpo = cuerpo;
  return g;
}

export function planta(m, z0) {
  const g = new THREE.Group();
  g.position.y = (z0 || 0) * CM;
  (m.salas || []).forEach((s, i) => { const x = suelo(s, i); if (x) g.add(x); const t = techo(s, i, m.altura); if (t) g.add(t); });
  (m.muros || []).forEach(w => { const x = muro(w, m.altura || 260); if (x) g.add(x); });
  (m.pilares || []).forEach(p => {
    const h = (m.altura || 260) * CM;
    const x = new THREE.Mesh(new THREE.BoxGeometry(p.w * CM, h, p.d * CM), new THREE.MeshStandardMaterial({ color: 0xd8d4cf, roughness: 0.9 }));
    x.position.set(p.cx * CM, h / 2, p.cy * CM); x.castShadow = x.receiveShadow = true; x.userData.capa = 'pilares'; g.add(x);
  });
  (m.equipos || []).forEach(e => g.add(maquina(e)));
  return g;
}

export default function Visor3D() {
  const { id } = useParams();
  const navigate = useNavigate();
  const caja = useRef(null);
  const [estado, setEstado] = useState('cargando');
  const [titulo, setTitulo] = useState('');
  const [calidad, setCalidad] = useState(() => { try { return localStorage.getItem('visor3dCalidad') || 'media'; } catch { return 'media'; } });
  const api3d = useRef({});
  const [seleccion, setSeleccion] = useState(null);
  const [objs, setObjs] = useState([]);            // objetos de la escena 3D
  const objsRef = useRef([]);
  const [selObj, setSelObj] = useState(null);      // id del objeto seleccionado
  const [herr, setHerr] = useState('sel');         // 'sel' | 'caja'
  const herrRef = useRef('sel');
  const [bibAbierta, setBibAbierta] = useState(false);
  const [biblioteca, setBiblioteca] = useState(null);
  const [filtro, setFiltro] = useState('');
  const [guardado, setGuardado] = useState('');
  const cargadaEscena = useRef(false);
  const [acab, setAcab] = useState({ muros: {}, salas: {}, techos: {}, todosMuros: null, todosSuelos: null, todosTechos: null });
  const [texturas, setTexturas] = useState([]);
  const [b3dAbierta, setB3dAbierta] = useState(false);
  const [b3d, setB3d] = useState(null);           // índice de la biblioteca 3D gratuita
  const [b3dTab, setB3dTab] = useState('modelos');
  const [b3dFiltro, setB3dFiltro] = useState('');
  const [b3dCat, setB3dCat] = useState('');
  const [selHueco, setSelHueco] = useState(null); // hueco del plano seleccionado, con sus medidas nuevas
  const [eqNuevo, setEqNuevo] = useState(null);     // medidas nuevas del equipo del plano seleccionado
  const [aviso, setAviso] = useState('');
  const [rodapie, setRodapie] = useState({ on: false, alto: 10, grosor: 1.5, color: '#ffffff' });
  const [guias, setGuias] = useState([]);
  const guiasRef = useRef([]);
  const puntosSnapRef = useRef([]);
  const [curvo, setCurvo] = useState(false);       // contorno curvo en las zonas
  const curvoRef = useRef(false);
  useEffect(() => { curvoRef.current = curvo; }, [curvo]);
  const [zonaMenu, setZonaMenu] = useState(false);
  const [sigueMenu, setSigueMenu] = useState(false);
  const [perfilSel, setPerfilSel] = useState('Rodapié recto');
  const perfilSelRef = useRef('Rodapié recto');
  useEffect(() => { perfilSelRef.current = perfilSel; }, [perfilSel]);
  const logoInput = useRef(null);
  const [lucesPl, setLucesPl] = useState([]);       // luminarias de la capa Iluminación del plano
  const [lumCat, setLumCat] = useState([]);          // catálogo de luminarias (lúmenes, vatios, kelvin)
  const [luzSel, setLuzSel] = useState(null);
  const [kindLuz, setKindLuz] = useState('foco');
  const [lucesAj, setLucesAj] = useState({});        // ajustes solo-3D: ángulo de apertura de cada foco
  const kindLuzRef = useRef('foco');
  useEffect(() => { kindLuzRef.current = kindLuz; }, [kindLuz]);
  const [matsCat, setMatsCat] = useState([]);  // materiales del catálogo de Ranuse (con foto)
  useEffect(() => { guiasRef.current = guias; }, [guias]);
  const [paleta, setPaleta] = useState([]);
  const [matAbierto, setMatAbierto] = useState(false);
  const [matSel, setMatSel] = useState(null);      // { hex } o { id } (textura)
  const matSelRef = useRef(null);
  useEffect(() => { matSelRef.current = matSel; }, [matSel]);
  const [selAcab, setSelAcab] = useState(null);  // { tipo: 'muro' | 'suelo', id }
  const [rev, setRev] = useState(0);             // sube cada vez que se rehace el plano 3D
  const [capasAbierto, setCapasAbierto] = useState(false);
  const [ocultas, setOcultas] = useState(() => { try { return JSON.parse(localStorage.getItem('visor3dOcultas') || '[]'); } catch { return []; } });
  const selAcabRef = useRef(null);
  useEffect(() => { selAcabRef.current = selAcab; }, [selAcab]);
  useEffect(() => { objsRef.current = objs; }, [objs]);
  useEffect(() => { herrRef.current = herr; }, [herr]);
  const seleccionRef = useRef(null);
  const [grosorMuro, setGrosorMuro] = useState(12);
  const grosorMuroRef = useRef(12);
  useEffect(() => { grosorMuroRef.current = grosorMuro; }, [grosorMuro]);
  const [medidaMuro, setMedidaMuro] = useState('');
  const selObjRef = useRef(null);
  useEffect(() => { selObjRef.current = selObj; }, [selObj]);
  useEffect(() => { seleccionRef.current = seleccion; }, [seleccion]);

  useEffect(() => { document.title = 'Vista 3D · Ranuse'; }, []);

  useEffect(() => {
    const el = caja.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    el.appendChild(renderer.domElement);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    {
      const cv = document.createElement('canvas'); cv.width = 2; cv.height = 256;
      const cx = cv.getContext('2d'), gr = cx.createLinearGradient(0, 0, 0, 256);
      gr.addColorStop(0, '#8db6dc'); gr.addColorStop(0.55, '#d8e6ef'); gr.addColorStop(1, '#efe9e0');
      cx.fillStyle = gr; cx.fillRect(0, 0, 2, 256);
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; scene.background = t;
    }
    const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
    const ctrl = new OrbitControls(cam, renderer.domElement);
    ctrl.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc8bf, 1.1));
    const sol = new THREE.DirectionalLight(0xffffff, 1.6);
    sol.castShadow = true;
    scene.add(sol);
    const raiz = new THREE.Group();
    scene.add(raiz);
    const esc = new THREE.Group(); // objetos colocados en el visor (biblioteca y cajas)
    scene.add(esc);
    const base = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0xd9d4cd, roughness: 1 }));
    base.rotation.x = -Math.PI / 2; base.position.y = -0.02; base.receiveShadow = true;
    scene.add(base);
    let raf = 0, vivo = true;
    const ajustar = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h);
      cam.aspect = w / h; cam.updateProjectionMatrix();
    };
    const bucle = () => { if (!vivo) return; raf = requestAnimationFrame(bucle); ctrl.update(); renderer.render(scene, cam); };
    ajustar(); bucle();
    window.addEventListener('resize', ajustar);
    api3d.current = { renderer, scene, cam, ctrl, sol, raiz, esc, base, el };

    let ultima = null, primera = true;
    const cargar = () => api.get('/medicion/' + id).then(r => {
      if (!vivo) return;
      const pl = r.data?.plano;
      if (!primera && pl?.updated === ultima) return; // sin cambios en el plano
      ultima = pl?.updated;
      setTitulo(pl?.nombre || 'Plano');
      if (primera && !cargadaEscena.current) { cargadaEscena.current = true; setGuardado('inicial'); setObjs(pl?.escena3d?.objetos || []); const ac = pl?.escena3d?.acabados; if (ac) setAcab({ muros: ac.muros || {}, salas: ac.salas || {}, techos: ac.techos || {}, todosMuros: ac.todosMuros || null, todosSuelos: ac.todosSuelos || null, todosTechos: ac.todosTechos || null }); setTexturas(pl?.escena3d?.texturas || []); setPaleta(pl?.escena3d?.paleta || []); if (pl?.escena3d?.rodapie) setRodapie(pl.escena3d.rodapie); setGuias(pl?.escena3d?.guias || []); setLucesAj(pl?.escena3d?.luces || {}); }
      const modelo = pl?.modelo3d || { muros: [], salas: [], pilares: [], equipos: [], altura: 260 };
      // se rehace el modelo con los datos nuevos, sin mover la cámara
      sel = null; setSeleccion(null);
      while (raiz.children.length) { const o = raiz.children[0]; raiz.remove(o); o.traverse(x => { x.geometry?.dispose(); x.material?.dispose?.(); }); }
      const plantas = modelo.plantas || [modelo];
      plantas.forEach(p => raiz.add(planta(p, p.z)));
      if (primera) {
        const caja3 = new THREE.Box3().setFromObject(raiz);
        const vacio = caja3.isEmpty();
        const c = vacio ? new THREE.Vector3(4, 0, 3) : caja3.getCenter(new THREE.Vector3()), s = vacio ? new THREE.Vector3(8, 0, 6) : caja3.getSize(new THREE.Vector3());
        const R = Math.max(s.x, s.z, 4);
        ctrl.target.copy(c);
        cam.position.set(c.x + R * 0.9, Math.max(R * 0.8, 6), c.z + R * 0.9);
        sol.position.set(c.x + R, R * 1.5, c.z + R * 0.5);
        sol.target.position.copy(c); scene.add(sol.target);
        const k = R * 1.2;
        Object.assign(sol.shadow.camera, { left: -k, right: k, top: k, bottom: -k, near: 0.5, far: R * 5 });
        sol.shadow.camera.updateProjectionMatrix();
        setEstado('listo');
      }
      // guardamos el modelo y los puntos a los que se «imanta» el dibujo (extremos de muros y esquinas de salas)
      api3d.current.modelo = modelo;
      {
        const nodos = Object.fromEntries((pl?.nodes || []).map(n => [n.id, n]));
        setLucesPl((pl?.pts || []).filter(p => p.v === 'ilum' && p.s !== 'dem' && nodos[p.n]).map(p => ({ id: p.id, kid: p.k, lid: p.lid || null, h: p.h, x: nodos[p.n].x + p.dx, y: nodos[p.n].y + p.dy })));
      }
      puntosSnapRef.current = (modelo.plantas || [modelo]).flatMap(pl => [
        ...(pl.muros || []).flatMap(m => [{ x: m.a[0], y: m.a[1] }, { x: m.b[0], y: m.b[1] }]),
        ...(pl.salas || []).flatMap(s => (s.pts || []).map(p => ({ x: p[0], y: p[1] }))),
      ]);
      setRev(v => v + 1);
      primera = false;
    }).catch(() => { if (vivo && primera) setEstado('error'); });
    cargar();
    api3d.current.recargar = () => { ultima = null; return cargar(); };
    // El plano se edita en otra pestaña: se mira si ha cambiado cada pocos segundos
    const reloj = setInterval(() => { if (!document.hidden) cargar(); }, 6000);

    // Clic en una máquina: se resalta y se enseña su ficha
    let sel = null;
    const rayo = new THREE.Raycaster(), p2 = new THREE.Vector2();
    let abajo = null;
    const dom = renderer.domElement;
    const onDown = e => { abajo = [e.clientX, e.clientY]; };
    const onUp = e => {
      if (herrRef.current === 'caja') return;
      if (!abajo || Math.hypot(e.clientX - abajo[0], e.clientY - abajo[1]) > 4) return; // fue arrastre, no clic
      const r = dom.getBoundingClientRect();
      p2.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      rayo.setFromCamera(p2, cam);
      const visible = o => { while (o) { if (!o.visible) return false; o = o.parent; } return true; };
      if (herrRef.current === 'pincel') {
        const h = rayo.intersectObjects([...raiz.children, ...esc.children], true).find(x => x.object.isMesh && !x.object.userData.hit && visible(x.object));
        if (h) aplicarPincel(h, e.shiftKey);
        return;
      }
      const primero = rayo.intersectObjects(raiz.children, true).find(h => visible(h.object));
      if (sel) sel.userData.cuerpo.material.emissive.setHex(0x000000);
      sel = null;
      setSelHueco(null);
      {
        const hl = api3d.current.luzG ? rayo.intersectObjects(api3d.current.luzG.children, false).find(x => x.object.userData.luzId) : null;
        if (hl) { setLuzSel(hl.object.userData.luzId); setSeleccion(null); setSelAcab(null); setSelObj(null); return; }
        setLuzSel(null);
      }
      const uh = primero?.object?.userData?.hueco;
      if (uh) { setSelHueco({ ...uh, nuevo: { w: uh.w, h: uh.h, sill: uh.sill, p: uh.p } }); setSeleccion(null); setSelAcab(null); setSelObj(null); return; }
      let eq = null; if (primero) { let o = primero.object; while (o && !o.userData.equipo) o = o.parent; eq = o; }
      if (eq) { sel = eq; eq.userData.cuerpo.material.emissive.setHex(0x335577); setSeleccion(eq.userData.equipo); setEqNuevo({ x: Math.round(eq.userData.equipo.cx), y: Math.round(eq.userData.equipo.cy), w: eq.userData.equipo.largo || eq.userData.equipo.w, d: eq.userData.equipo.fondo || eq.userData.equipo.d, rot: eq.userData.equipo.rot || 0 }); setSelAcab(null); }
      else {
        setSeleccion(null);
        const u = primero?.object?.userData || {};
        if (u.muroId) { setSelAcab({ tipo: 'muro', id: u.muroId }); setSelObj(null); }
        else if (u.salaKey) { setSelAcab({ tipo: 'suelo', id: u.salaKey }); setSelObj(null); }
        else setSelAcab(null);
      }
    };
    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointerup', onUp);

    // Diseño: mover objetos y dibujar cajas sobre el suelo
    const suelo = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), pt = new THREE.Vector3();
    const snap = v => Math.round(v / 5) * 5;
    const imantar = p => {
      let mejor = null, dmin = 12;
      for (const q of puntosSnapRef.current) { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < dmin) { dmin = d; mejor = { x: q.x, y: q.y }; } }
      if (mejor) return mejor;
      const gs = guiasRef.current;
      for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++) {
        const a = gs[i], b = gs[j], d1x = a.x2 - a.x1, d1y = a.y2 - a.y1, d2x = b.x2 - b.x1, d2y = b.y2 - b.y1, den = d1x * d2y - d1y * d2x;
        if (Math.abs(den) < 1e-6) continue;
        const t = ((b.x1 - a.x1) * d2y - (b.y1 - a.y1) * d2x) / den, q = { x: a.x1 + d1x * t, y: a.y1 + d1y * t };
        if (Math.hypot(q.x - p.x, q.y - p.y) < 14) return q;
      }
      for (const a of gs) {
        const dx = a.x2 - a.x1, dy = a.y2 - a.y1, L2 = dx * dx + dy * dy || 1, t = ((p.x - a.x1) * dx + (p.y - a.y1) * dy) / L2, q = { x: a.x1 + dx * t, y: a.y1 + dy * t };
        if (Math.hypot(q.x - p.x, q.y - p.y) < 8) return q;
      }
      return p;
    };
    const puntoSuelo = e => {
      const r = dom.getBoundingClientRect();
      p2.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      rayo.setFromCamera(p2, cam);
      return rayo.ray.intersectPlane(suelo, pt) ? imantar({ x: snap(pt.x / CM), y: snap(pt.z / CM) }) : null;
    };
    const sueloRaw = e => {
      const r = dom.getBoundingClientRect();
      p2.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      rayo.setFromCamera(p2, cam);
      return rayo.ray.intersectPlane(suelo, pt) ? { x: pt.x / CM, y: pt.z / CM } : null;
    };
    const objetoBajo = e => {
      const r = dom.getBoundingClientRect();
      p2.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      rayo.setFromCamera(p2, cam);
      const h = rayo.intersectObjects(esc.children, true)[0];
      let o = h?.object; while (o && !o.userData.oid) o = o.parent;
      return o && o.visible ? o : null;
    };
    let arrastre = null, trazo = null, previa = null;
    let poli = [], poliLinea = null, poliAbajo = null, empuje = null;
    let guiaA = null, guiaAbajo = null, guiaMarca = null, luzAbajo = null, eje3 = null;
    let muroA = null, muroAbajo = null, muroLinea = null, nodoDrag = null;
    const quitarMuroLinea = () => { if (muroLinea) { scene.remove(muroLinea); muroLinea.geometry.dispose(); muroLinea = null; } };
    const terminarMuros = () => { muroA = null; quitarMuroLinea(); setMedidaMuro(''); setHerr('sel'); };
    const esPoli = h => h === 'poli' || h === 'zonaS' || h === 'zonaT' || h === 'sigue';
    let cierraLazo = false;
    let poliP = null, pAbajo = null, pLinea = null;
    const muroPorId = idm => (api3d.current.modelo?.plantas || (api3d.current.modelo ? [api3d.current.modelo] : [])).flatMap(p => p.muros || []).find(m => m.id === idm);
    const golpePared = e => {
      const r = dom.getBoundingClientRect();
      p2.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      rayo.setFromCamera(p2, cam);
      const vis = o => { while (o) { if (!o.visible) return false; o = o.parent; } return true; };
      const h = rayo.intersectObjects(raiz.children, true).find(x => x.object.isMesh && vis(x.object));
      const u = h?.object?.userData; if (!u?.muroId) return null;
      const mu = muroPorId(u.muroId); if (!mu) return null;
      const L = Math.hypot(mu.b[0] - mu.a[0], mu.b[1] - mu.a[1]) || 1, ux = (mu.b[0] - mu.a[0]) / L, uy = (mu.b[1] - mu.a[1]) / L;
      const s = Math.round(((h.point.x / CM - mu.a[0]) * ux + (h.point.z / CM - mu.a[1]) * uy) / 5) * 5, yy = Math.max(0, Math.round(h.point.y / CM / 5) * 5);
      const lado = ((cam.position.x / CM - mu.a[0]) * -uy + (cam.position.z / CM - mu.a[1]) * ux) >= 0 ? 1 : -1;
      return { mu, s, y: yy, lado, id: u.muroId };
    };
    const aMundoPared = (mu, s, yy, lado) => {
      const L = Math.hypot(mu.b[0] - mu.a[0], mu.b[1] - mu.a[1]) || 1, ux = (mu.b[0] - mu.a[0]) / L, uy = (mu.b[1] - mu.a[1]) / L, off = lado * ((mu.t || 12) / 2 + 0.4);
      return new THREE.Vector3((mu.a[0] + ux * s - uy * off) * CM, yy * CM, (mu.a[1] + uy * s + ux * off) * CM);
    };
    const dibujarPared = (cursor) => {
      if (pLinea) { scene.remove(pLinea); pLinea.geometry.dispose(); pLinea = null; }
      if (!poliP) return;
      const pts = cursor ? [...poliP.pts, cursor] : poliP.pts;
      if (pts.length < 2) return;
      pLinea = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(p => aMundoPared(poliP.mu, p[0], p[1], poliP.lado))), new THREE.LineBasicMaterial({ color: 0x1b6dd6 }));
      scene.add(pLinea);
    };
    const cerrarPared = () => {
      if (poliP && poliP.pts.length >= 3) {
        const pts = curvoRef.current ? suavizar(poliP.pts) : poliP.pts;
        const nuevo = { id: idNuevo(), tipo: 'zona', plano: 'pared', muroId: poliP.id, lado: poliP.lado, nombre: 'Zona de pared', etiqueta: 'Zonas', cx: 0, cy: 0, rot: 0, w: 1, d: 1, alto: 1, z0: 0, color: '#c9b9a0', pts };
        setObjs(prev => [...prev, nuevo]); setSelObj(nuevo.id);
      }
      poliP = null; dibujarPared(null); setHerr('sel');
    };
    const idNuevo = () => 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const dibujarPoli = (cursor) => {
      if (poliLinea) { scene.remove(poliLinea); poliLinea.geometry.dispose(); poliLinea = null; }
      const pts = cursor ? [...poli, cursor] : poli;
      if (pts.length < 2) return;
      poliLinea = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p.x * CM, 0.03, p.y * CM))), new THREE.LineBasicMaterial({ color: 0x1b6dd6 }));
      scene.add(poliLinea);
    };
    const cerrarPoli = () => {
      // (Enter cierra el camino abierto; volver al primer punto lo cierra en lazo)
      if (herrRef.current === 'sigue' && poli.length >= 2) {
        const xs = poli.map(p => p.x), ys = poli.map(p => p.y);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2, nombre = perfilSelRef.current;
        const nuevo = { id: idNuevo(), tipo: 'barrido', nombre, perfilNombre: nombre, etiqueta: 'Molduras', cx, cy, rot: 0, w: 1, d: 1, alto: 1, z0: 0, color: '#ffffff', pts: poli.map(p => [p.x - cx, p.y - cy]), perfil: PERFILES[nombre], esc: 1, cerrado: cierraLazo && poli.length >= 3, lado: 1 };
        setObjs(prev => [...prev, nuevo]); setSelObj(nuevo.id);
      } else if (poli.length >= 3) {
        const xs = poli.map(p => p.x), ys = poli.map(p => p.y);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const rel = poli.map(p => [p.x - cx, p.y - cy]), modo = herrRef.current;
        const nuevo = modo === 'poli'
          ? { id: idNuevo(), tipo: 'prisma', nombre: 'Volumen', cx, cy, rot: 0, w: Math.max(...xs) - Math.min(...xs), d: Math.max(...ys) - Math.min(...ys), alto: 100, z0: 0, color: '#9aa3ad', pts: rel }
          : { id: idNuevo(), tipo: 'zona', plano: modo === 'zonaT' ? 'techo' : 'suelo', h: modo === 'zonaT' ? ((api3d.current.modelo?.altura) || 260) : undefined, nombre: modo === 'zonaT' ? 'Zona de techo' : 'Zona de suelo', etiqueta: 'Zonas', cx, cy, rot: 0, w: Math.max(...xs) - Math.min(...xs), d: Math.max(...ys) - Math.min(...ys), alto: 1, z0: 0, color: '#c9b9a0', pts: curvoRef.current ? suavizar(rel) : rel };
        setObjs(prev => [...prev, nuevo]); setSelObj(nuevo.id);
      }
      poli = []; dibujarPoli(null); setHerr('sel');
    };
    const onTecla = e => {
      if (herrRef.current === 'muro' && (e.key === 'Escape' || e.key === 'Enter')) { terminarMuros(); return; }
      if (herrRef.current === 'luz' && e.key === 'Escape') { setHerr('sel'); return; }
      if (herrRef.current === 'guia' && e.key === 'Escape') { guiaA = null; if (guiaMarca) { scene.remove(guiaMarca); guiaMarca = null; } setHerr('sel'); return; }
      if (herrRef.current === 'zonaP') { if (e.key === 'Enter') cerrarPared(); if (e.key === 'Escape') { poliP = null; dibujarPared(null); setHerr('sel'); } return; }
      if (!esPoli(herrRef.current)) return;
      if (e.key === 'Enter') cerrarPoli();
      if (e.key === 'Escape') { poli = []; dibujarPoli(null); setHerr('sel'); }
    };
    window.addEventListener('keydown', onTecla);
    const aplicarPincel = (hit, todos) => {
      const mat = matSelRef.current; if (!mat) return;
      const valor = mat.hex || ('tex:' + mat.id);
      const u = hit.object.userData;
      if (u.muroId) setAcab(a => (todos ? { ...a, muros: {}, todosMuros: valor } : { ...a, muros: { ...a.muros, [u.muroId]: valor } }));
      else if (u.salaKey) setAcab(a => (todos ? { ...a, salas: {}, todosSuelos: valor } : { ...a, salas: { ...a.salas, [u.salaKey]: valor } }));
      else if (u.techoKey) setAcab(a => (todos ? { ...a, techos: {}, todosTechos: valor } : { ...a, techos: { ...a.techos, [u.techoKey]: valor } }));
      else {
        let o = hit.object; while (o && !o.userData.oid) o = o.parent;
        if (o) {
          const idx = hit.face?.materialIndex, oid = o.userData.oid, zona = hit.object.userData.zona;
          setObjs(prev => prev.map(x => {
            if (x.id !== oid) return x;
            if (x.tipo === 'mueble') return todos ? { ...x, color: valor, colorFrente: valor } : (zona === 'frente' ? { ...x, colorFrente: valor } : { ...x, color: valor });
            if (todos || idx === undefined || !['caja', 'prisma', 'bloque'].includes(x.tipo)) return { ...x, color: valor, caras: undefined };
            return { ...x, caras: { ...(x.caras || {}), [idx]: valor } }; // solo esa cara
          }));
        }
      }
    };
    const onDownD = e => {
      if (e.button !== 0) return;
      if (herrRef.current === 'pincel') return;
      if (esPoli(herrRef.current)) { poliAbajo = [e.clientX, e.clientY]; return; }
      if (herrRef.current === 'zonaP') { pAbajo = [e.clientX, e.clientY]; return; }
      if (herrRef.current === 'guia') { guiaAbajo = [e.clientX, e.clientY]; return; }
      if (herrRef.current === 'luz') { luzAbajo = [e.clientX, e.clientY]; return; }
      if (herrRef.current === 'muro') { muroAbajo = [e.clientX, e.clientY]; return; }
      if (herrRef.current === 'empujar') {
        const r = dom.getBoundingClientRect();
        p2.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        rayo.setFromCamera(p2, cam);
        const h = rayo.intersectObjects(esc.children, true).find(x => x.object.isMesh && x.face);
        if (!h) return;
        const nrm = h.face.normal.clone().transformDirection(h.object.matrixWorld);
        if (nrm.y < 0.9) return; // solo se empuja o tira de la cara de arriba
        let o = h.object; while (o && !o.userData.oid) o = o.parent;
        const ob = o && objsRef.current.find(x => x.id === o.userData.oid); if (!ob || !o.userData.malla) return;
        setSelObj(ob.id); ctrl.enabled = false;
        empuje = { id: ob.id, alto0: ob.alto, z0: ob.z0 || 0, y0: e.clientY, malla: o.userData.malla, nuevo: null };
        e.stopPropagation(); return;
      }
      if (herrRef.current === 'caja') {
        const p = puntoSuelo(e); if (!p) return;
        ctrl.enabled = false; trazo = p;
        previa = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x2f6fa8, transparent: true, opacity: 0.45 }));
        scene.add(previa); e.stopPropagation(); return;
      }
      {
        const ngG = api3d.current.nodoG;
        if (ngG) {
          const r = dom.getBoundingClientRect();
          p2.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
          rayo.setFromCamera(p2, cam);
          const hn = rayo.intersectObjects(ngG.children, true)[0];
          if (hn) { ctrl.enabled = false; nodoDrag = { nodo: hn.object.userData.nodo, muroId: hn.object.userData.muroId, esfera: hn.object, p: null }; e.stopPropagation(); return; }
        }
      }
      {
        const gzG = api3d.current.gizmoG;
        if (gzG) {
          const r = dom.getBoundingClientRect();
          p2.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
          rayo.setFromCamera(p2, cam);
          const hg = rayo.intersectObjects(gzG.children, true)[0], ob0 = objsRef.current.find(x => x.id === selObjRef.current), eqp = !ob0 ? seleccionRef.current : null;
          if (hg && eqp) {
            let g3p = null; raiz.traverse(o => { if (o.userData.equipo && o.userData.equipo.id === eqp.id) g3p = o; });
            if (g3p) { ctrl.enabled = false; eje3 = { plan: true, eqId: eqp.id, g3: g3p, eje: hg.object.userData.eje, cx0: eqp.cx, cy0: eqp.cy, p0: sueloRaw(e), nuevo: {} }; e.stopPropagation(); return; }
          }
          if (hg && ob0) { ctrl.enabled = false; eje3 = { eje: hg.object.userData.eje, id: ob0.id, cx0: ob0.cx, cy0: ob0.cy, z00: ob0.z0 || 0, p0: sueloRaw(e), y0: e.clientY, nuevo: {} }; e.stopPropagation(); return; }
        }
      }
      const o = objetoBajo(e);
      if (!o) return;
      const ob = objsRef.current.find(x => x.id === o.userData.oid); if (!ob) return;
      setSelObj(ob.id); setSelAcab(null);
      if (o.userData.sinArrastre) return;
      const p = puntoSuelo(e); if (!p) return;
      ctrl.enabled = false; arrastre = { id: ob.id, dx: ob.cx - p.x, dy: ob.cy - p.y, mov: false };
      e.stopPropagation();
    };
    const onMoveD = e => {
      if (nodoDrag) { const p = puntoSuelo(e); if (p) { nodoDrag.p = p; nodoDrag.esfera.position.x = p.x * CM; nodoDrag.esfera.position.z = p.y * CM; } return; }
      if (herrRef.current === 'muro' && muroA) {
        let p = puntoSuelo(e); if (!p) return;
        if (e.shiftKey) { if (Math.abs(p.x - muroA.x) > Math.abs(p.y - muroA.y)) p = { x: p.x, y: muroA.y }; else p = { x: muroA.x, y: p.y }; }
        quitarMuroLinea();
        muroLinea = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(muroA.x * CM, 0.05, muroA.y * CM), new THREE.Vector3(p.x * CM, 0.05, p.y * CM)]), new THREE.LineBasicMaterial({ color: 0x1b6dd6 }));
        scene.add(muroLinea); setMedidaMuro(Math.round(Math.hypot(p.x - muroA.x, p.y - muroA.y)) + ' cm');
        return;
      }
      if (eje3) {
        const g3 = eje3.plan ? eje3.g3 : esc.children.find(x => x.userData.oid === eje3.id); if (!g3) return;
        if (eje3.eje === 'y') {
          const dist = cam.position.distanceTo(g3.position), cmPx = ((2 * dist * Math.tan(cam.fov * Math.PI / 360)) / dom.clientHeight) * 100;
          const z = Math.max(0, Math.round((eje3.z00 + (eje3.y0 - e.clientY) * cmPx) / 5) * 5); eje3.nuevo = { z0: z }; g3.position.y = (z - eje3.z00) * CM;
        } else {
          const p = sueloRaw(e);
          if (p && eje3.p0) {
            const dlt = eje3.eje === 'x' ? p.x - eje3.p0.x : p.y - eje3.p0.y, v = Math.round(((eje3.eje === 'x' ? eje3.cx0 : eje3.cy0) + dlt) / 5) * 5;
            if (eje3.eje === 'x') { eje3.nuevo = { cx: v }; g3.position.x = v * CM; } else { eje3.nuevo = { cy: v }; g3.position.z = v * CM; }
            if (eje3.plan) eje3.nuevoPlan = { x: eje3.nuevo.cx ?? eje3.nuevoPlan?.x ?? eje3.cx0, y: eje3.nuevo.cy ?? eje3.nuevoPlan?.y ?? eje3.cy0 };
          }
        }
        return;
      }
      if (esPoli(herrRef.current) && poli.length) { const p = puntoSuelo(e); if (p) dibujarPoli(p); return; }
      if (herrRef.current === 'zonaP' && poliP) { const g = golpePared(e); if (g && g.id === poliP.id) dibujarPared(new THREE.Vector3(...aMundoPared(g.mu, g.s, g.y, poliP.lado).toArray())); return; }
      if (empuje) {
        const m = empuje.malla, dist = cam.position.distanceTo(m.getWorldPosition(new THREE.Vector3()));
        const cmPorPx = (2 * dist * Math.tan(cam.fov * Math.PI / 360) / dom.clientHeight) * 100;
        const alto = Math.max(5, Math.round((empuje.alto0 + (empuje.y0 - e.clientY) * cmPorPx) / 5) * 5);
        empuje.nuevo = alto;
        const s = alto / empuje.alto0; m.scale.y = s;
        if (m.userData.centrado) m.position.y = (empuje.z0 + empuje.alto0 * s / 2) * CM;
        return;
      }
      if (trazo && previa) {
        const p = puntoSuelo(e); if (!p) return;
        const w = Math.max(5, Math.abs(p.x - trazo.x)), d = Math.max(5, Math.abs(p.y - trazo.y));
        previa.scale.set(w * CM, 1, d * CM); previa.position.set((p.x + trazo.x) / 2 * CM, 0.5, (p.y + trazo.y) / 2 * CM);
      } else if (arrastre) {
        const p = puntoSuelo(e); if (!p) return;
        arrastre.mov = true;
        const o = esc.children.find(x => x.userData.oid === arrastre.id);
        if (o) { o.position.x = (p.x + arrastre.dx) * CM; o.position.z = (p.y + arrastre.dy) * CM; arrastre.cx = p.x + arrastre.dx; arrastre.cy = p.y + arrastre.dy; }
      }
    };
    const onUpD = e => {
      if (nodoDrag) {
        const nd = nodoDrag; nodoDrag = null; ctrl.enabled = true;
        if (nd.p) api.patch('/medicion/' + id + '/muro/' + nd.muroId, { [nd.nodo]: { x: nd.p.x, y: nd.p.y } }).then(() => { setAviso('Muro movido en el plano ✓. Si tienes Planos abierto, recárgalo.'); api3d.current.recargar?.(); }).catch(er => setAviso(er.response?.data?.error || 'No se pudo mover el muro'));
        return;
      }
      if (muroAbajo) {
        const d0 = Math.hypot(e.clientX - muroAbajo[0], e.clientY - muroAbajo[1]); muroAbajo = null;
        if (d0 < 4) {
          let p = puntoSuelo(e);
          if (p) {
            if (muroA && e.shiftKey) { if (Math.abs(p.x - muroA.x) > Math.abs(p.y - muroA.y)) p = { x: p.x, y: muroA.y }; else p = { x: muroA.x, y: p.y }; }
            if (!muroA) muroA = p;
            else {
              const A = muroA; muroA = p; quitarMuroLinea();
              api.post('/medicion/' + id + '/muro', { x1: A.x, y1: A.y, x2: p.x, y2: p.y, t: grosorMuroRef.current }).then(() => { setGuardado('Muro creado en el plano ✓'); api3d.current.recargar?.(); }).catch(er => { setAviso(er.response?.data?.error || 'No se pudo crear el muro'); });
            }
          }
        }
        return;
      }
      if (eje3 && eje3.plan) {
        const a3 = eje3; eje3 = null; ctrl.enabled = true;
        if (a3.nuevoPlan) api.patch('/medicion/' + id + '/equipo', { eqId: a3.eqId, cambios: a3.nuevoPlan }).then(() => { setSeleccion(null); setAviso('Máquina movida en el plano ✓. Si tienes Planos abierto, recárgalo.'); api3d.current.recargar?.(); }).catch(er => setAviso(er.response?.data?.error || 'No se pudo mover la máquina'));
        return;
      }
      if (eje3) {
        const a3 = eje3; eje3 = null; ctrl.enabled = true;
        if (Object.keys(a3.nuevo).length) setObjs(prev => prev.map(x => (x.id === a3.id ? { ...x, ...a3.nuevo } : x)));
        return;
      }
      if (pAbajo) {
        const d0 = Math.hypot(e.clientX - pAbajo[0], e.clientY - pAbajo[1]); pAbajo = null;
        if (d0 < 4) {
          const g = golpePared(e);
          if (g) {
            if (!poliP) poliP = { id: g.id, mu: g.mu, lado: g.lado, pts: [] };
            if (g.id === poliP.id) {
              const P = poliP.pts;
              if (P.length >= 3 && Math.hypot(g.s - P[0][0], g.y - P[0][1]) < 12) cerrarPared();
              else { P.push([g.s, g.y]); dibujarPared(null); }
            }
          }
        }
        return;
      }
      if (luzAbajo) {
        const d0 = Math.hypot(e.clientX - luzAbajo[0], e.clientY - luzAbajo[1]); luzAbajo = null;
        if (d0 < 4) {
          const p = puntoSuelo(e);
          if (p) api.post('/medicion/' + id + '/luminaria', { x: p.x, y: p.y, kid: kindLuzRef.current }).then(() => { setGuardado('Luminaria colocada en el plano ✓'); api3d.current.recargar?.(); }).catch(er => setGuardado(er.response?.data?.error || 'No se pudo colocar la luminaria'));
        }
        return;
      }
      if (guiaAbajo) {
        const d0 = Math.hypot(e.clientX - guiaAbajo[0], e.clientY - guiaAbajo[1]); guiaAbajo = null;
        if (d0 < 4) {
          const p = puntoSuelo(e);
          if (p) {
            if (!guiaA) {
              guiaA = p;
              guiaMarca = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 12), new THREE.MeshBasicMaterial({ color: 0xd62bd6 })); guiaMarca.position.set(p.x * CM, 0.05, p.y * CM); scene.add(guiaMarca);
            } else {
              if (Math.hypot(p.x - guiaA.x, p.y - guiaA.y) > 5) { const A = guiaA; setGuias(prev => [...prev, { x1: A.x, y1: A.y, x2: p.x, y2: p.y }]); }
              guiaA = null; if (guiaMarca) { scene.remove(guiaMarca); guiaMarca.geometry.dispose(); guiaMarca.material.dispose(); guiaMarca = null; }
            }
          }
        }
        return;
      }
      if (poliAbajo) {
        const d0 = Math.hypot(e.clientX - poliAbajo[0], e.clientY - poliAbajo[1]); poliAbajo = null;
        if (d0 < 4) {
          const p = puntoSuelo(e);
          if (p) { if (poli.length >= 3 && Math.hypot(p.x - poli[0].x, p.y - poli[0].y) < 15) { cierraLazo = true; cerrarPoli(); cierraLazo = false; } else { poli.push(p); dibujarPoli(null); } }
        }
        return;
      }
      if (empuje) {
        const a = empuje; empuje = null; ctrl.enabled = true;
        if (a.nuevo) setObjs(prev => prev.map(x => (x.id === a.id ? { ...x, alto: a.nuevo } : x)));
        return;
      }
      if (trazo) {
        const p = puntoSuelo(e);
        scene.remove(previa); previa.geometry.dispose(); previa.material.dispose(); previa = null;
        const t = trazo; trazo = null; ctrl.enabled = true;
        if (p && Math.abs(p.x - t.x) >= 10 && Math.abs(p.y - t.y) >= 10) {
          const nuevo = { id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), tipo: 'caja', nombre: 'Caja', cx: (p.x + t.x) / 2, cy: (p.y + t.y) / 2, rot: 0, w: Math.abs(p.x - t.x), d: Math.abs(p.y - t.y), alto: 100, z0: 0, color: '#9aa3ad' };
          setObjs(prev => [...prev, nuevo]); setSelObj(nuevo.id); setHerr('sel');
        }
      } else if (arrastre) {
        const a = arrastre; arrastre = null; ctrl.enabled = true;
        if (a.mov && a.cx != null) setObjs(prev => prev.map(x => x.id === a.id ? { ...x, cx: a.cx, cy: a.cy } : x));
      }
    };
    el.addEventListener('pointerdown', onDownD, true);
    window.addEventListener('pointermove', onMoveD);
    window.addEventListener('pointerup', onUpD);

    return () => { window.removeEventListener('keydown', onTecla); el.removeEventListener('pointerdown', onDownD, true); window.removeEventListener('pointermove', onMoveD); window.removeEventListener('pointerup', onUpD); vivo = false; clearInterval(reloj); dom.removeEventListener('pointerdown', onDown); dom.removeEventListener('pointerup', onUp); cancelAnimationFrame(raf); window.removeEventListener('resize', ajustar); renderer.dispose(); el.removeChild(renderer.domElement); };
  }, [id]);

  // Colores de muros y suelos (cambian sin rehacer el plano)
  // (ver versión con texturas más abajo)
  useEffect(() => {
    const a = api3d.current; if (!a.raiz) return;
    a.raiz.traverse(o => {
      if (!o.isMesh) return;
      const u = o.userData;
      if (u.muroId) pintar(o, acab.muros[u.muroId] || acab.todosMuros, texturas, true);
      else if (u.salaKey) pintar(o, acab.salas[u.salaKey] || acab.todosSuelos, texturas, false);
      else if (u.techoKey) pintar(o, acab.techos[u.techoKey] || acab.todosTechos, texturas, false);
    });
  }, [acab, rev, estado, texturas]);

  // Capas (etiquetas): se ven u ocultan grupos de elementos
  useEffect(() => {
    const a = api3d.current; if (!a.raiz) return;
    const aplica = o => { if (o.userData.capa) o.visible = !ocultas.includes(o.userData.capa); };
    a.raiz.traverse(aplica);
    a.esc.children.forEach(g => { g.visible = !ocultas.includes('obj:' + (objsRef.current.find(x => x.id === g.userData.oid)?.etiqueta || '')); });
    try { localStorage.setItem('visor3dOcultas', JSON.stringify(ocultas)); } catch {}
  }, [ocultas, rev, objs, estado]);

  // Luminarias del plano: punto de luz visible y luz real (foco = cono con su ángulo de apertura)
  useEffect(() => {
    const a = api3d.current; if (!a.scene) return;
    if (a.luzG) { a.scene.remove(a.luzG); a.luzG.traverse(x => { x.geometry?.dispose(); x.material?.dispose?.(); if (x.isLight && x.target) a.scene.remove(x.target); }); }
    const g = new THREE.Group(); g.userData.capa = 'luces'; g.visible = !ocultas.includes('luces');
    const ALT = { foco: 255, plaf: 255, colg: 200, aplq: 180, pie: 120, suel: 5 };
    lucesPl.slice(0, 24).forEach(l => {
      const cat = lumCat.find(c => c.id === l.lid), lm = cat?.lm || 800, K = cat?.k || 3000;
      const hcm = l.h != null ? l.h : (ALT[l.kid] ?? 250), ap = lucesAj[l.id]?.ap ?? 60;
      const col = new THREE.Color().setHSL(0.1, K < 3500 ? 0.55 : K < 5000 ? 0.1 : 0.0, K < 3500 ? 0.8 : 0.95);
      const marca = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12), new THREE.MeshBasicMaterial({ color: sel2(l.id, luzSel) ? 0x4da3ff : col }));
      marca.position.set(l.x * CM, hcm * CM, l.y * CM); marca.userData = { luzId: l.id }; g.add(marca);
      const inten = Math.max(5, lm / 12.57) * 0.5;
      if (l.kid === 'foco' || l.kid === 'plaf') {
        const s = new THREE.SpotLight(col, inten * 4, 0, Math.max(0.1, (ap / 2) * Math.PI / 180), 0.45, 2);
        s.position.copy(marca.position); s.target.position.set(l.x * CM, 0, l.y * CM); g.add(s); g.add(s.target);
      } else { const p = new THREE.PointLight(col, inten, 0, 2); p.position.copy(marca.position); g.add(p); }
    });
    a.scene.add(g); a.luzG = g;
  }, [lucesPl, lumCat, lucesAj, luzSel, estado, ocultas]);

  // Medidas (cotas) y flechas de ejes del objeto seleccionado (también las máquinas del plano: solo medidas)
  useEffect(() => {
    const a = api3d.current; if (!a.scene) return;
    ['gizmoG', 'cotasG'].forEach(k => { if (a[k]) { a.scene.remove(a[k]); a[k].traverse(x => { x.geometry?.dispose(); x.material?.map?.dispose?.(); x.material?.dispose?.(); }); a[k] = null; } });
    const ob = objs.find(x => x.id === selObj);
    const d = ob ? { w: ob.w, d: ob.d, alto: ob.alto, cx: ob.cx, cy: ob.cy, rot: ob.rot || 0, z0: ob.z0 || 0, tipo: ob.tipo }
      : (seleccion ? { w: seleccion.largo || seleccion.w, d: seleccion.fondo || seleccion.d, alto: seleccion.alto || 110, cx: seleccion.cx, cy: seleccion.cy, rot: seleccion.rot || 0, z0: 0 } : null);
    if (!d) return;
    if (!['zona', 'falsotecho', 'barrido'].includes(d.tipo)) {
      const W = d.w * CM, D = d.d * CM, H = d.alto * CM, off = 0.14, g = new THREE.Group();
      g.position.set(d.cx * CM, d.z0 * CM, d.cy * CM); g.rotation.y = -d.rot * Math.PI / 180;
      const mat = new THREE.LineBasicMaterial({ color: 0xffc400, depthTest: false });
      const lin = (p, q) => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...p), new THREE.Vector3(...q)]), mat); l.renderOrder = 998; g.add(l); };
      const txt = (t, p) => { const s = cartel(t); s.position.set(...p); g.add(s); };
      lin([-W / 2, 0, D / 2 + off], [W / 2, 0, D / 2 + off]); lin([-W / 2, 0, D / 2 + off - 0.04], [-W / 2, 0, D / 2 + off + 0.04]); lin([W / 2, 0, D / 2 + off - 0.04], [W / 2, 0, D / 2 + off + 0.04]);
      txt(Math.round(d.w * 10) / 10 + ' cm', [0, 0.06, D / 2 + off + 0.12]);
      lin([W / 2 + off, 0, -D / 2], [W / 2 + off, 0, D / 2]); lin([W / 2 + off - 0.04, 0, -D / 2], [W / 2 + off + 0.04, 0, -D / 2]); lin([W / 2 + off - 0.04, 0, D / 2], [W / 2 + off + 0.04, 0, D / 2]);
      txt(Math.round(d.d * 10) / 10 + ' cm', [W / 2 + off + 0.14, 0.06, 0]);
      lin([-W / 2 - off, 0, D / 2 + off], [-W / 2 - off, H, D / 2 + off]); lin([-W / 2 - off - 0.04, H, D / 2 + off], [-W / 2 - off + 0.04, H, D / 2 + off]);
      txt(Math.round(d.alto * 10) / 10 + ' cm', [-W / 2 - off - 0.16, H / 2, D / 2 + off]);
      a.scene.add(g); a.cotasG = g;
    }
    const gz = ob || (seleccion ? { cx: seleccion.cx, cy: seleccion.cy, z0: 0, alto: seleccion.alto || 110, w: seleccion.largo || seleccion.w, d: seleccion.fondo || seleccion.d, plan: true } : null);
    if (gz && !(gz.tipo === 'zona' && gz.plano === 'pared') && gz.tipo !== 'falsotecho') {
      const G = new THREE.Group(); G.position.set(gz.cx * CM, (gz.z0 || 0) * CM + (gz.alto * CM) / 2, gz.cy * CM);
      const L = Math.max(0.5, Math.max(gz.w, gz.d, gz.alto) * CM * 0.6 + 0.25);
      const flecha = (col, eje) => {
        const g = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color: col, depthTest: false });
        const asta = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, L, 8), m); asta.position.y = L / 2;
        const punta = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 12), m); punta.position.y = L + 0.1;
        g.add(asta, punta);
        if (eje === 'x') g.rotation.z = -Math.PI / 2; else if (eje === 'z') g.rotation.x = Math.PI / 2;
        g.traverse(o => { o.userData.eje = eje; o.renderOrder = 999; });
        return g;
      };
      G.add(flecha(0xe5484d, 'x'), flecha(0x3e63dd, 'z')); if (!gz.plan) G.add(flecha(0x46a758, 'y'));
      a.scene.add(G); a.gizmoG = G;
    }
  }, [objs, selObj, seleccion, estado, rev]);

  // Asas azules en los extremos del muro seleccionado: arrastrarlas mueve el muro (y los muros conectados) en el plano
  useEffect(() => {
    const a = api3d.current; if (!a.scene) return;
    if (a.nodoG) { a.scene.remove(a.nodoG); a.nodoG.traverse(x => { x.geometry?.dispose(); x.material?.dispose?.(); }); a.nodoG = null; }
    if (!selAcab || selAcab.tipo !== 'muro' || !a.modelo) return;
    const mu = (a.modelo.plantas || [a.modelo]).flatMap(p => p.muros || []).find(m => m.id === selAcab.id); if (!mu) return;
    const g = new THREE.Group();
    [['a', mu.a], ['b', mu.b]].forEach(([k, p]) => {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 16), new THREE.MeshBasicMaterial({ color: 0x1b6dd6, depthTest: false }));
      s.position.set(p[0] * CM, ((mu.h || a.modelo.altura || 260) * CM) + 0.05, p[1] * CM); s.renderOrder = 999; s.userData = { nodo: k, muroId: mu.id }; g.add(s);
    });
    a.scene.add(g); a.nodoG = g;
  }, [selAcab, rev, estado]);

  // Rodapié: sigue el perímetro de cada sala (por dentro) y se interrumpe en las puertas
  useEffect(() => {
    const a = api3d.current; if (!a.scene) return;
    if (a.rod) { a.scene.remove(a.rod); a.rod.traverse(x => { x.geometry?.dispose(); x.material?.dispose?.(); }); a.rod = null; }
    const modelo = a.modelo; if (!rodapie.on || !modelo) return;
    const g = new THREE.Group(); g.userData.capa = 'rodapie'; g.visible = !ocultas.includes('rodapie');
    const mat = new THREE.MeshStandardMaterial({ color: color(rodapie.color, '#ffffff'), roughness: 0.6 });
    const dentro = (pt, pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > pt.y) !== (yj > pt.y) && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) c = !c; } return c; };
    (modelo.plantas || [modelo]).forEach(pl => {
      const z0 = (pl.z || 0) * CM;
      (pl.salas || []).forEach(s => {
        const P = s.pts || [];
        for (let i = 0; i < P.length; i++) {
          const A = { x: P[i][0], y: P[i][1] }, B = { x: P[(i + 1) % P.length][0], y: P[(i + 1) % P.length][1] };
          const L = Math.hypot(B.x - A.x, B.y - A.y); if (L < 5) continue;
          const u = { x: (B.x - A.x) / L, y: (B.y - A.y) / L };
          // huecos de puerta que caen sobre este lado
          const cortes = [];
          // (las puertas cortan el rodapié)
          (pl.muros || []).forEach(m => {
            const wl = Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1]); if (wl < 1) return;
            const v = { x: (m.b[0] - m.a[0]) / wl, y: (m.b[1] - m.a[1]) / wl };
            if (Math.abs(v.x * u.y - v.y * u.x) > 0.02) return;
            if (Math.abs((m.a[0] - A.x) * u.y - (m.a[1] - A.y) * u.x) > (m.t || 12) / 2 + 4) return;
            (m.ab || []).filter(o => (o.tipo || o.t) === 'door').forEach(o => {
              const t1 = (m.a[0] + v.x * o.p - A.x) * u.x + (m.a[1] + v.y * o.p - A.y) * u.y;
              const t2 = (m.a[0] + v.x * (o.p + o.w) - A.x) * u.x + (m.a[1] + v.y * (o.p + o.w) - A.y) * u.y;
              cortes.push([Math.min(t1, t2), Math.max(t1, t2)]);
            });
          });
          cortes.sort((p, q) => p[0] - q[0]);
          const tramos = []; let cur = 0;
          cortes.forEach(([c0, c1]) => { if (c0 > cur + 1) tramos.push([cur, Math.min(c0, L)]); cur = Math.max(cur, c1); });
          if (cur < L - 1) tramos.push([cur, L]);
          let n = { x: -u.y, y: u.x };
          const medio = { x: A.x + u.x * L / 2 + n.x * 5, y: A.y + u.y * L / 2 + n.y * 5 };
          if (!dentro(medio, P)) n = { x: -n.x, y: -n.y };
          tramos.forEach(([t0, t1]) => {
            if (t1 - t0 < 2) return;
            const c = { x: A.x + u.x * (t0 + t1) / 2 + n.x * rodapie.grosor / 2, y: A.y + u.y * (t0 + t1) / 2 + n.y * rodapie.grosor / 2 };
            const b = new THREE.Mesh(new THREE.BoxGeometry((t1 - t0) * CM, rodapie.alto * CM, rodapie.grosor * CM), mat);
            b.position.set(c.x * CM, z0 + rodapie.alto * CM / 2, c.y * CM); b.rotation.y = -Math.atan2(u.y, u.x); b.castShadow = b.receiveShadow = true; g.add(b);
          });
        }
      });
    });
    a.scene.add(g); a.rod = g;
  }, [rodapie, rev, estado, ocultas]);

  // Líneas guía (discontinuas, infinitas) para dibujar y alinear
  useEffect(() => {
    const a = api3d.current; if (!a.scene) return;
    if (a.guiaG) { a.scene.remove(a.guiaG); a.guiaG.traverse(x => { x.geometry?.dispose(); x.material?.dispose?.(); }); }
    const g = new THREE.Group();
    guias.forEach(gu => {
      const dx = gu.x2 - gu.x1, dy = gu.y2 - gu.y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, K = 5000;
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3((gu.x1 - ux * K) * CM, 0.04, (gu.y1 - uy * K) * CM), new THREE.Vector3((gu.x1 + ux * K) * CM, 0.04, (gu.y1 + uy * K) * CM)]), new THREE.LineDashedMaterial({ color: 0xd62bd6, dashSize: 0.15, gapSize: 0.1 }));
      l.computeLineDistances(); g.add(l);
    });
    a.scene.add(g); a.guiaG = g;
  }, [guias, estado]);

  // Los objetos de la escena se pintan a partir de la lista
  useEffect(() => {
    const a = api3d.current; if (!a.esc) return;
    while (a.esc.children.length) { const o = a.esc.children[0]; a.esc.remove(o); o.traverse(x => { x.geometry?.dispose(); x.material?.dispose?.(); }); }
    const todosMuros = (api3d.current.modelo?.plantas || (api3d.current.modelo ? [api3d.current.modelo] : [])).flatMap(p => p.muros || []);
    objs.forEach(o => {
      if (o.tipo === 'zona' && Array.isArray(o.pts) && o.pts.length >= 3) {
        const gz = new THREE.Group();
        const val = o.color, tx = val && String(val).startsWith('tex:') ? texturas.find(x => 'tex:' + x.id === val) : null;
        const mt = new THREE.MeshStandardMaterial({ color: color(/^#/.test(val || '') ? val : null, '#9aa3ad'), roughness: 0.7, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, emissive: o.id === selObj ? 0x335577 : 0x000000 });
        if (tx) { mt.map = texturaDe(tx, false); mt.color.setHex(0xffffff); }
        const geo = new THREE.ShapeGeometry(new THREE.Shape(o.pts.map(p => new THREE.Vector2(p[0] * CM, p[1] * CM))));
        const mesh = new THREE.Mesh(geo, mt); mesh.receiveShadow = true;
        if (o.plano === 'pared') {
          const mu = todosMuros.find(m => m.id === o.muroId); if (!mu) return;
          const holder = new THREE.Group(); holder.position.set(mu.a[0] * CM, 0, mu.a[1] * CM); holder.rotation.y = -Math.atan2(mu.b[1] - mu.a[1], mu.b[0] - mu.a[0]);
          mesh.position.z = (o.lado || 1) * (((mu.t || 12) / 2) * CM + 0.004); holder.add(mesh); gz.add(holder);
          gz.userData.sinArrastre = true;
        } else {
          geo.rotateX(Math.PI / 2);
          mesh.position.set(o.cx * CM, o.plano === 'techo' ? (o.h || 260) * CM - 0.004 : 0.005, o.cy * CM); gz.add(mesh);
        }
        gz.userData.oid = o.id; gz.visible = !ocultas.includes('obj:' + (o.etiqueta || ''));
        a.esc.add(gz);
        return;
      }
      if (o.tipo === 'barrido' && Array.isArray(o.pts) && o.pts.length >= 2) {
        const geo = geometriaBarrido(o.pts, o.perfil || PERFILES['Rodapié recto'], o.esc || 1, !!o.cerrado, o.lado === -1 ? -1 : 1); if (!geo) return;
        const val = o.color, tx = val && String(val).startsWith('tex:') ? texturas.find(x => 'tex:' + x.id === val) : null;
        const mt = new THREE.MeshStandardMaterial({ color: color(/^#/.test(val || '') ? val : null, '#ffffff'), roughness: 0.6, side: THREE.DoubleSide, emissive: o.id === selObj ? 0x335577 : 0x000000 });
        if (tx) { mt.map = texturaDe(tx, true); mt.color.setHex(0xffffff); }
        const mesh = new THREE.Mesh(geo, mt); mesh.castShadow = mesh.receiveShadow = true; mesh.position.y = (o.z0 || 0) * CM;
        const gb = new THREE.Group(); gb.position.set(o.cx * CM, 0, o.cy * CM); gb.add(mesh);
        gb.userData.oid = o.id; gb.visible = !ocultas.includes('obj:' + (o.etiqueta || ''));
        a.esc.add(gb);
        return;
      }
      if (o.tipo === 'logo' && Array.isArray(o.formas) && o.formas.length) {
        const k = (o.w || 100) / 100, geos = [];
        o.formas.forEach(f => {
          const sh = new THREE.Shape(f.pts.map(p => new THREE.Vector2(p[0] * CM * k, p[1] * CM * k)));
          (f.holes || []).forEach(h => sh.holes.push(new THREE.Path(h.map(p => new THREE.Vector2(p[0] * CM * k, p[1] * CM * k)))));
          try { geos.push(new THREE.ExtrudeGeometry(sh, { depth: Math.max(0.2, o.d || 2) * CM, bevelEnabled: false })); } catch (e) { /* forma no válida: se salta */ }
        });
        if (!geos.length) return;
        const geo = geos.length > 1 ? mergeGeometries(geos) : geos[0];
        if (o.plano === 'horizontal') geo.rotateX(-Math.PI / 2);
        const val = o.color, tx = val && String(val).startsWith('tex:') ? texturas.find(x => 'tex:' + x.id === val) : null;
        const mt = new THREE.MeshStandardMaterial({ color: color(/^#/.test(val || '') ? val : null, '#222222'), roughness: 0.5, metalness: 0.1, emissive: o.id === selObj ? 0x335577 : 0x000000 });
        if (tx) { mt.map = texturaDe(tx, false); mt.color.setHex(0xffffff); }
        const mesh = new THREE.Mesh(geo, mt); mesh.castShadow = mesh.receiveShadow = true; mesh.position.y = (o.z0 || 0) * CM;
        const gl = new THREE.Group(); gl.position.set(o.cx * CM, 0, o.cy * CM); gl.rotation.y = -(o.rot || 0) * Math.PI / 180; gl.add(mesh);
        gl.userData.oid = o.id; gl.visible = !ocultas.includes('obj:' + (o.etiqueta || ''));
        a.esc.add(gl);
        return;
      }
      if (o.tipo === 'falsotecho' && Array.isArray(o.pts) && o.pts.length >= 3) {
        const ft = o.ft || {}, D = ft.descenso ?? 15, H = (o.h || 260) * CM, inner = insetPoligono(o.pts, ft.gap ?? 12);
        const gf = new THREE.Group(); gf.position.set(o.cx * CM, 0, o.cy * CM);
        const val = o.color, tx = val && String(val).startsWith('tex:') ? texturas.find(x => 'tex:' + x.id === val) : null;
        const mt = new THREE.MeshStandardMaterial({ color: color(/^#/.test(val || '') ? val : null, '#f6f4f1'), roughness: 0.9, emissive: o.id === selObj ? 0x335577 : 0x000000 });
        if (tx) { mt.map = texturaDe(tx, false); mt.color.setHex(0xffffff); }
        const prof = Math.max(0.01, Math.abs(D) * CM);
        const geo = new THREE.ExtrudeGeometry(new THREE.Shape(inner.map(p => new THREE.Vector2(p[0] * CM, -p[1] * CM))), { depth: prof, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2);
        const losa = new THREE.Mesh(geo, mt); losa.position.y = D >= 0 ? H - prof : H; losa.castShadow = losa.receiveShadow = true; gf.add(losa);
        if (ft.luz !== false) {
          const K = ft.k || 3000, led = new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(0.1, K < 3500 ? 0.6 : K < 5000 ? 0.15 : 0.02, K < 3500 ? 0.85 : 0.97) });
          for (let i = 0; i < inner.length; i++) {
            const p = inner[i], q = inner[(i + 1) % inner.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (L < 2) continue;
            const b = new THREE.Mesh(new THREE.BoxGeometry(L * CM, 0.01, 0.02), led);
            b.position.set(((p[0] + q[0]) / 2) * CM, (D >= 0 ? H - 0.005 : H + prof + 0.005), ((p[1] + q[1]) / 2) * CM); b.rotation.y = -Math.atan2(q[1] - p[1], q[0] - p[0]); gf.add(b);
          }
        }
        if (o.id === selObj) { const l = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x1b6dd6 })); l.position.copy(losa.position); gf.add(l); }
        gf.userData.oid = o.id; gf.userData.sinArrastre = true; gf.visible = !ocultas.includes('obj:' + (o.etiqueta || ''));
        a.esc.add(gf);
        return;
      }
      if (o.tipo === 'mueble') {
        const gm = new THREE.Group();
        const cont = construirMueble(o, texturas); cont.position.y = (o.z0 || 0) * CM; gm.add(cont);
        const hit = new THREE.Mesh(new THREE.BoxGeometry(o.w * CM, o.alto * CM, o.d * CM), new THREE.MeshBasicMaterial({ visible: false }));
        hit.position.y = (o.alto * CM) / 2 + (o.z0 || 0) * CM; hit.userData.hit = true; gm.add(hit);
        if (o.id === selObj) { const l = new THREE.LineSegments(new THREE.EdgesGeometry(hit.geometry), new THREE.LineBasicMaterial({ color: 0x1b6dd6 })); l.position.copy(hit.position); gm.add(l); }
        gm.position.set(o.cx * CM, 0, o.cy * CM); gm.rotation.y = -(o.rot || 0) * Math.PI / 180;
        gm.userData.oid = o.id; gm.visible = !ocultas.includes('obj:' + (o.etiqueta || ''));
        a.esc.add(gm);
        return;
      }
      const w = o.w * CM, d = o.d * CM, h = o.alto * CM;
      const g = new THREE.Group();
      const mod = modeloDe(o);
      const esPrisma = o.tipo === 'prisma' && Array.isArray(o.pts) && o.pts.length >= 3;
      let geo;
      if (esPrisma) {
        const sh = new THREE.Shape(o.pts.map(p => new THREE.Vector2(p[0] * CM, -p[1] * CM)));
        geo = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2); // el contorno queda en el suelo y se eleva hacia arriba
      } else geo = new THREE.BoxGeometry(w, h, d);
      const liso = o.tipo === 'caja' || esPrisma;
      const mats = Array.from({ length: esPrisma ? 2 : 6 }, (_, i) => {
        const val = (o.caras && o.caras[i]) || o.color;
        const mt = new THREE.MeshStandardMaterial({ color: color(/^#/.test(val || '') ? val : null, liso ? '#9aa3ad' : '#2f6fa8'), roughness: 0.55, metalness: liso ? 0 : 0.15, emissive: o.id === selObj ? 0x335577 : 0x000000, transparent: !!mod, opacity: mod ? 0.18 : 1 });
        const tx = val && String(val).startsWith('tex:') ? texturas.find(x => 'tex:' + x.id === val) : null;
        if (tx) { const mp = texturaDe(tx, true).clone(); mp.needsUpdate = true; mp.repeat.set(Math.max(0.2, o.w / tx.tam), Math.max(0.2, o.alto / tx.tam)); mt.map = mp; mt.color.setHex(0xffffff); }
        return mt;
      });
      const fantasma = v => mats.forEach(mt => { mt.opacity = v; mt.transparent = v < 1; mt.needsUpdate = true; });
      const m = new THREE.Mesh(geo, mats);
      m.position.y = (esPrisma ? 0 : h / 2) + (o.z0 || 0) * CM; m.castShadow = !mod; m.receiveShadow = !mod;
      m.userData.centrado = !esPrisma;
      g.userData.malla = m;
      g.add(m);
      if (mod) {
        // mientras baja el modelo se ve la caja fantasma; después, el modelo real en su lugar
        cargarModelo(mod).then(raw => {
          if (!g.parent) return; // el objeto ya no está en la escena
          const mm = ajustarModelo(raw, w, d, h);
          if (!mm) return;
          mm.rotation.y = -((mod.rot || 0) + (o.rotM || 0)) * Math.PI / 180;
          mm.position.y = (o.z0 || 0) * CM;
          g.add(mm); fantasma(0);
        }).catch(() => { fantasma(1); });
      }
      if (o.id === selObj) { const l = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0x1b6dd6 })); l.position.copy(m.position); g.add(l); }
      g.position.set(o.cx * CM, 0, o.cy * CM); g.rotation.y = -(o.rot || 0) * Math.PI / 180;
      g.userData.oid = o.id;
      g.visible = !ocultas.includes('obj:' + (o.etiqueta || ''));
      a.esc.add(g);
    });
  }, [objs, selObj, estado, biblioteca, ocultas, texturas, rev]);

  // Guardado automático de la escena (sin pisar el dibujo del plano 2D)
  useEffect(() => {
    if (!cargadaEscena.current || estado !== 'listo') return;
    if (guardado === 'inicial') { setGuardado(''); return; }
    setGuardado('Guardando…');
    const t = setTimeout(() => {
      api.put('/medicion/' + id + '/escena3d', { objetos: objs, acabados: acab, paleta, rodapie, guias, luces: lucesAj }).then(() => setGuardado('Guardado ✓')).catch(() => setGuardado('No se pudo guardar'));
    }, 1200);
    return () => clearTimeout(t);
  }, [objs, acab, paleta, rodapie, guias, lucesAj]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.get('/medicion/catalogos').then(r => { setLumCat(r.data?.luminarias || []); setMatsCat((r.data?.materiales || []).filter(m => m.url)); return setBiblioteca((r.data?.maquinas || []).filter(m => m.w > 0 && m.d > 0)); }).catch(() => setBiblioteca([]));
  }, []);
  const modeloDe = o => o.mod || (o.cid && biblioteca?.find(m => m.id === o.cid)?.modelo3d) || null;

  useEffect(() => {
    if (!b3dAbierta || b3d) return;
    api.get('/biblioteca3d').then(r => setB3d(r.data || { modelos: [], texturas: [] })).catch(() => setB3d({ modelos: [], texturas: [], error: true }));
  }, [b3dAbierta, b3d]);
  const anadirModelo3d = m => {
    const { ctrl } = api3d.current;
    const nuevo = { id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), tipo: 'bloque', cid: null, nombre: m.nombre, etiqueta: m.categoria, cx: Math.round(ctrl.target.x / CM / 5) * 5, cy: Math.round(ctrl.target.z / CM / 5) * 5, rot: 0, w: m.w, d: m.d, alto: m.alto, z0: 0, color: null, mod: { url: m.url, tipo: 'gltf', rot: 0 } };
    setObjs(prev => [...prev, nuevo]); setSelObj(nuevo.id); setHerr('sel');
  };
  const usarMatCatalogo = async (mc) => {
    try {
      const r = await api.post('/medicion/' + id + '/textura-catalogo', { prodId: mc.id, tam: mc.tw });
      const nueva = r.data.textura;
      setTexturas(x => (x.some(y => y.id === nueva.id) ? x : [...x, nueva]));
      setMatSel({ id: nueva.id }); setHerr('pincel');
      setGuardado('Material del catálogo listo: haz clic en un muro, suelo o techo');
    } catch (e) { setGuardado(e.response?.data?.error || 'No se pudo usar el material'); }
  };
  const usarTexturaB3d = async (t) => {
    try {
      const r = await api.post('/medicion/' + id + '/textura-biblioteca', { texId: t.id, tam: t.tam });
      const nueva = r.data.textura;
      setTexturas(x => (x.some(y => y.id === nueva.id) ? x : [...x, nueva]));
      setMatSel({ id: nueva.id }); setHerr('pincel'); setMatAbierto(true);
      setGuardado('Textura lista: haz clic en un muro, suelo o techo');
    } catch (e) { setGuardado(e.response?.data?.error || 'No se pudo usar la textura'); }
  };
  const [muebleMenu, setMuebleMenu] = useState(false);
  const PLANTILLAS_MUEBLE = {
    'Bajo de cocina (3 módulos)': { d: 60, alto: 90, zocalo: 10, modulos: [{ t: 'puertas', w: 60, n: 1, nb: 1 }, { t: 'cajones', w: 60, n: 3 }, { t: 'puertas', w: 60, n: 2, nb: 1 }] },
    'Armario alto (2 puertas)': { d: 60, alto: 220, zocalo: 8, modulos: [{ t: 'puertas', w: 50, n: 1, nb: 5 }, { t: 'puertas', w: 50, n: 1, nb: 5 }] },
    'Mueble de TV': { d: 40, alto: 55, zocalo: 5, modulos: [{ t: 'puertas', w: 60, n: 1, nb: 0 }, { t: 'abierto', w: 80, nb: 0 }, { t: 'puertas', w: 60, n: 1, nb: 0 }] },
    'Estantería abierta': { d: 30, alto: 200, zocalo: 0, modulos: [{ t: 'abierto', w: 80, nb: 5 }, { t: 'abierto', w: 80, nb: 5 }] },
    'Mostrador / recepción': { d: 60, alto: 105, zocalo: 8, modulos: [{ t: 'cajones', w: 60, n: 3 }, { t: 'puertas', w: 90, n: 2, nb: 1 }, { t: 'puertas', w: 60, n: 1, nb: 1 }] },
    'Cajonera': { d: 45, alto: 75, zocalo: 5, modulos: [{ t: 'cajones', w: 80, n: 4 }] },
  };
  const crearMueble = (nombre) => {
    const p = PLANTILLAS_MUEBLE[nombre], { ctrl } = api3d.current;
    const nuevo = { id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), tipo: 'mueble', nombre: nombre.replace(/ \(.*\)/, ''), etiqueta: 'Muebles a medida', cx: Math.round(ctrl.target.x / CM / 5) * 5, cy: Math.round(ctrl.target.z / CM / 5) * 5, rot: 0, w: p.modulos.reduce((s, m) => s + m.w, 0), d: p.d, alto: p.alto, z0: 0, color: '#e8e2d8', colorFrente: '#f4f1ec', mueble: { esp: 1.8, zocalo: p.zocalo, tirador: 'barra', modulos: p.modulos.map(m => ({ ...m })) } };
    setObjs(prev => [...prev, nuevo]); setSelObj(nuevo.id); setHerr('sel'); setMuebleMenu(false);
  };
  const cambiarModulos = (idObj, fn, extra) => setObjs(prev => prev.map(o => {
    if (o.id !== idObj) return o;
    const mods = fn((o.mueble?.modulos || []).map(m => ({ ...m })));
    return { ...o, mueble: { ...o.mueble, modulos: mods, ...(extra || {}) }, w: mods.reduce((s, m) => s + (parseFloat(m.w) || 0), 0) };
  }));
  const crearFalsoTecho = (salaKey) => {
    const modelo = api3d.current.modelo; if (!modelo) return;
    const pl0 = (modelo.plantas || [modelo])[0], sala = (pl0.salas || []).find((s, i) => (s.idS || ('s' + i)) === salaKey);
    if (!sala) return;
    const xs = sala.pts.map(p => p[0]), ys = sala.pts.map(p => p[1]), cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const nuevo = { id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), tipo: 'falsotecho', nombre: 'Falso techo con foseado', etiqueta: 'Techos', cx, cy, rot: 0, w: Math.max(...xs) - Math.min(...xs), d: Math.max(...ys) - Math.min(...ys), alto: 1, z0: 0, h: pl0.altura || 260, color: '#f6f4f1', pts: sala.pts.map(p => [p[0] - cx, p[1] - cy]), ft: { descenso: 15, gap: 12, luz: true, k: 3000 } };
    setObjs(prev => [...prev, nuevo]); setSelObj(nuevo.id); setSelAcab(null);
  };
  const importarLogo = async (archivo) => {
    if (!archivo) return;
    try {
      const texto = await archivo.text();
      const esDXF = /\.dxf$/i.test(archivo.name);
      const formas = esDXF ? formasDeDXF(texto) : formasDeSVG(texto);
      const norm = formas.length ? normalizarFormas(formas) : null;
      if (!norm) { setAviso(esDXF ? 'No he encontrado contornos cerrados en ese DXF. Para que funcione, el logo debe estar hecho con líneas, arcos, círculos o polilíneas que formen contornos cerrados (si es un SVG o un PDF vectorial, mejor súbelo como SVG).' : 'No he encontrado formas rellenas en ese SVG. Si el logo está hecho solo con líneas, conviértelo antes a contornos (en Illustrator o Inkscape: «Contorno de trazo» o «Stroke to Path»).'); return; }
      const { ctrl } = api3d.current;
      const nuevo = { id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), tipo: 'logo', nombre: 'Logo ' + archivo.name.replace(/\.[^.]+$/, ''), etiqueta: 'Logos', cx: Math.round(ctrl.target.x / CM / 5) * 5, cy: Math.round(ctrl.target.z / CM / 5) * 5, rot: 0, w: 100, d: 2, alto: Math.round(norm.alto), ratio: norm.alto / 100, z0: 100, plano: 'vertical', color: '#222222', formas: norm.formas };
      setObjs(prev => [...prev, nuevo]); setSelObj(nuevo.id); setHerr('sel');
      setAviso('Logo creado (' + norm.formas.length + ' forma' + (norm.formas.length === 1 ? '' : 's') + '). Ajusta ancho, grosor y elevación en su ficha.');
    } catch (e) { setAviso('No se ha podido leer ese archivo: ' + (e.message || 'formato no válido')); }
  };
  const moldurasSala = (salaKey) => {
    const modelo = api3d.current.modelo; if (!modelo) return;
    const pl0 = (modelo.plantas || [modelo])[0], sala = (pl0.salas || []).find((s, i) => (s.idS || ('s' + i)) === salaKey); if (!sala) return;
    const xs = sala.pts.map(p => p[0]), ys = sala.pts.map(p => p[1]), cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const a = sala.pts[0], b = sala.pts[1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
    const lado = puntoEnPoligono([(a[0] + b[0]) / 2 + nx * 5, (a[1] + b[1]) / 2 + ny * 5], sala.pts) ? 1 : -1;
    const nombre = perfilSelRef.current;
    const nuevo = { id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), tipo: 'barrido', nombre, perfilNombre: nombre, etiqueta: 'Molduras', cx, cy, rot: 0, w: 1, d: 1, alto: 1, z0: 0, color: '#ffffff', pts: sala.pts.map(p => [p[0] - cx, p[1] - cy]), perfil: PERFILES[nombre], esc: 1, cerrado: true, lado };
    setObjs(prev => [...prev, nuevo]); setSelObj(nuevo.id); setSelAcab(null);
  };
  const anadirBloque = m => {
    const { ctrl } = api3d.current;
    const nuevo = { id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), tipo: 'bloque', cid: m.id, nombre: m.nombre, cx: Math.round(ctrl.target.x / CM / 5) * 5, cy: Math.round(ctrl.target.z / CM / 5) * 5, rot: 0, w: m.w, d: m.d, alto: m.alto || 110, z0: 0, color: null, skp: m.skp || null };
    setObjs(prev => [...prev, nuevo]); setSelObj(nuevo.id); setHerr('sel');
  };
  const cambiar = (idObj, campos) => setObjs(prev => prev.map(o => o.id === idObj ? { ...o, ...campos } : o));
  const borrar = idObj => { setObjs(prev => prev.filter(o => o.id !== idObj)); setSelObj(null); };
  const duplicar = idObj => {
    const o = objs.find(x => x.id === idObj); if (!o) return;
    const n = { ...o, id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), cx: o.cx + 30, cy: o.cy + 30 };
    setObjs(prev => [...prev, n]); setSelObj(n.id);
  };
  const objSel = objs.find(o => o.id === selObj) || null;
  const AVISO_PLANO = 'Guardado en el plano ✓. Si tienes Planos abierto en otra pestaña, recárgalo: si no, al guardar allí se perdería este cambio.';
  const aplicarHueco = async () => {
    if (!selHueco) return;
    try {
      await api.patch('/medicion/' + id + '/hueco', { opId: selHueco.id || undefined, muroId: selHueco.muroId, p0: selHueco.p, w0: selHueco.w, cambios: selHueco.nuevo });
      setSelHueco(null); setAviso(AVISO_PLANO); api3d.current.recargar?.();
    } catch (e) { setAviso(e.response?.data?.error || 'No se pudo cambiar el hueco'); }
  };
  const aplicarEquipo = async () => {
    if (!seleccion || !eqNuevo) return;
    try {
      await api.patch('/medicion/' + id + '/equipo', { eqId: seleccion.id, cambios: eqNuevo });
      setSeleccion(null); setAviso(AVISO_PLANO); api3d.current.recargar?.();
    } catch (e) { setAviso(e.response?.data?.error || 'No se pudo cambiar el equipo'); }
  };
  const [subiendo, setSubiendo] = useState('');
  const asignarModelo = async (archivo) => {
    if (!archivo || !objSel?.cid) return;
    if (/\.skp$/i.test(archivo.name)) { alert('Los archivos .skp de SketchUp no se pueden mostrar en el navegador. En SketchUp: Archivo → Exportar → Modelo 3D, y elige glTF (.glb) o COLLADA (.dae). Sube ese archivo.'); return; }
    setSubiendo('Subiendo el modelo…');
    try {
      const fd = new FormData(); fd.append('file', archivo);
      const r = await api.post('/catalog/products/' + objSel.cid + '/modelo3d', fd);
      const nuevo = r.data?.modelo3d;
      setBiblioteca(prev => (prev || []).map(m => m.id === objSel.cid ? { ...m, modelo3d: { url: nuevo.url, tipo: nuevo.tipo, rot: nuevo.rot } } : m));
      setSubiendo('Modelo asignado ✓ (vale para todas las copias de este producto)');
    } catch (e) { setSubiendo(e.response?.data?.error || 'No se pudo subir el modelo'); }
  };
  const quitarModelo = async () => {
    if (!objSel?.cid) return;
    try { await api.delete('/catalog/products/' + objSel.cid + '/modelo3d'); setBiblioteca(prev => (prev || []).map(m => m.id === objSel.cid ? { ...m, modelo3d: null } : m)); setSubiendo('Modelo quitado'); }
    catch { setSubiendo('No se pudo quitar'); }
  };

  // Calidad: en ordenadores sin tarjeta gráfica potente se baja la resolución y las sombras
  useEffect(() => {
    const a = api3d.current; if (!a.renderer) return;
    const q = { baja: [1, 0, 512], media: [Math.min(window.devicePixelRatio, 1.5), 1, 1024], alta: [window.devicePixelRatio, 1, 2048] }[calidad];
    a.renderer.setPixelRatio(q[0]);
    a.renderer.shadowMap.enabled = !!q[1];
    a.sol.castShadow = !!q[1];
    a.sol.shadow.mapSize.set(q[2], q[2]);
    a.sol.shadow.map?.dispose(); a.sol.shadow.map = null;
    a.raiz.traverse(o => { if (o.material) o.material.needsUpdate = true; });
    a.renderer.setSize(caja.current.clientWidth, caja.current.clientHeight);
    try { localStorage.setItem('visor3dCalidad', calidad); } catch {}
  }, [calidad, estado]);

  const vista = tipo => {
    const { cam, ctrl, raiz } = api3d.current;
    const b = new THREE.Box3().setFromObject(raiz), c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
    const R = Math.max(s.x, s.z, 4);
    ctrl.target.copy(c);
    if (tipo === 'planta') cam.position.set(c.x, R * 1.6, c.z + 0.01);
    else cam.position.set(c.x + R * 0.9, Math.max(R * 0.8, 6), c.z + R * 0.9);
  };
  // Render: una sola imagen grande con sombras suaves y de alta resolución (aunque el ordenador sea flojo, es un único fotograma)
  const [renderizando, setRenderizando] = useState(false);
  const renderAlta = () => {
    const { renderer, scene, cam, sol } = api3d.current;
    setRenderizando(true);
    setTimeout(() => {
      const el = caja.current, w0 = el.clientWidth, h0 = el.clientHeight, pr0 = renderer.getPixelRatio();
      const sombra = sol.castShadow, mapa = sol.shadow.mapSize.x;
      try {
        const W = 3200, H = Math.round(W * h0 / w0);
        renderer.setPixelRatio(1);
        renderer.setSize(W, H, false);
        cam.aspect = W / H; cam.updateProjectionMatrix();
        renderer.shadowMap.enabled = true; sol.castShadow = true;
        sol.shadow.mapSize.set(4096, 4096); sol.shadow.map?.dispose(); sol.shadow.map = null; sol.shadow.radius = 4;
        renderer.render(scene, cam);
        const a = document.createElement('a');
        a.href = renderer.domElement.toDataURL('image/png');
        a.download = (titulo || 'plano') + '-render.png';
        a.click();
      } catch (e) { alert('No se ha podido generar el render: ' + e.message + '. Prueba a bajar la calidad.'); }
      finally {
        renderer.setPixelRatio(pr0); renderer.setSize(w0, h0);
        cam.aspect = w0 / h0; cam.updateProjectionMatrix();
        sol.castShadow = sombra; sol.shadow.mapSize.set(mapa, mapa); sol.shadow.map?.dispose(); sol.shadow.map = null;
        setRenderizando(false);
      }
    }, 60);
  };
  // Render fotorrealista con IA: se manda la vista actual y vuelve mejorada
  const [ia, setIa] = useState(null); // { estado: 'trabajando' | 'listo' | 'error', imagen, mensaje, estancia, estilo, extra }
  const [iaForm, setIaForm] = useState(false);
  const [iaTxt, setIaTxt] = useState({ estancia: '', estilo: '', extra: '', libertad: 'equilibrado' });
  const renderIA = async () => {
    const { renderer, scene, cam } = api3d.current;
    setIaForm(false);
    setIa({ estado: 'trabajando' });
    try {
      const el = caja.current, w0 = el.clientWidth, h0 = el.clientHeight, pr0 = renderer.getPixelRatio();
      const W = 2048, H = Math.round(W * h0 / w0);
      renderer.setPixelRatio(1); renderer.setSize(W, H, false); cam.aspect = W / H; cam.updateProjectionMatrix();
      renderer.render(scene, cam);
      const imagen = renderer.domElement.toDataURL('image/jpeg', 0.95);
      renderer.setPixelRatio(pr0); renderer.setSize(w0, h0); cam.aspect = w0 / h0; cam.updateProjectionMatrix();
      const r = await api.post('/render-ia', { imagen, ...iaTxt }, { timeout: 180000 });
      setIa({ estado: 'listo', imagen: r.data.imagen, original: imagen });
    } catch (e) {
      setIa({ estado: 'error', mensaje: e.response?.data?.error || 'No se ha podido generar el render con IA' });
    }
  };
  const captura = () => {
    const { renderer, scene, cam } = api3d.current;
    renderer.render(scene, cam);
    const a = document.createElement('a');
    a.href = renderer.domElement.toDataURL('image/png');
    a.download = (titulo || 'plano') + '-3d.png';
    a.click();
  };

  const btn = { background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 13 };
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#eeeae5' }}>
      <div ref={caja} style={{ position: 'absolute', inset: 0, cursor: ['pincel', 'poli', 'caja', 'empujar', 'guia', 'luz', 'zonaS', 'zonaT', 'zonaP', 'sigue', 'muro'].includes(herr) ? 'crosshair' : 'default' }} />
      <div style={{ position: 'absolute', top: 12, left: 12, right: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button style={btn} onClick={() => (window.history.length > 1 ? navigate(-1) : window.close())}>← Volver</button>
        <b style={{ color: '#222', marginRight: 'auto' }}>{titulo}</b>
        <button style={{ ...btn, ...(herr === 'sel' ? { background: '#2f6fa8' } : {}) }} onClick={() => setHerr('sel')} title="Seleccionar y mover objetos">↖ Mover</button>
        <button style={{ ...btn, ...(herr === 'caja' ? { background: '#2f6fa8' } : {}) }} onClick={() => setHerr('caja')} title="Arrastra sobre el suelo para dibujar una caja; luego le das altura">▭ Dibujar caja</button>
        <button style={{ ...btn, ...(herr === 'poli' ? { background: '#2f6fa8' } : {}) }} onClick={() => setHerr('poli')} title="Haz clic punto a punto sobre el suelo; cierra con Enter o volviendo al primer punto. Luego se extruye (altura).">⬡ Contorno</button>
        <div style={{ position: 'relative' }}>
          <button style={{ ...btn, ...(muebleMenu ? { background: '#2f6fa8' } : {}) }} onClick={() => setMuebleMenu(v => !v)} title="Muebles a medida por módulos">🪑 Mueble a medida</button>
          {muebleMenu && <div style={{ position: 'absolute', top: 34, left: 0, background: 'rgba(20,20,20,0.97)', borderRadius: 8, padding: 6, zIndex: 8, width: 250 }}>
            {Object.keys(PLANTILLAS_MUEBLE).map(n => <div key={n} onClick={() => crearMueble(n)} style={{ color: '#fff', padding: '6px 8px', cursor: 'pointer', fontSize: 13, borderRadius: 4 }}>{n}</div>)}
          </div>}
        </div>
        <button style={{ ...btn, ...(herr === 'empujar' ? { background: '#2f6fa8' } : {}) }} onClick={() => setHerr('empujar')} title="Arrastra hacia arriba o abajo la cara de arriba de un objeto para cambiar su altura">⇅ Empujar/Tirar</button>
        <div style={{ position: 'relative' }}>
          <button style={{ ...btn, ...(herr === 'sigue' || sigueMenu ? { background: '#2f6fa8' } : {}) }} onClick={() => setSigueMenu(v => !v)} title="Un perfil recorre un camino (como «Sígueme» de SketchUp): rodapiés, molduras, tubos, bandejas…">➰ Sígueme</button>
          {sigueMenu && <div style={{ position: 'absolute', top: 34, left: 0, background: 'rgba(20,20,20,0.97)', borderRadius: 8, padding: 6, zIndex: 8, width: 230, color: '#fff', fontSize: 13 }}>
            <div style={{ opacity: 0.6, fontSize: 11, padding: '2px 8px' }}>Elige el perfil y dibuja el camino en el suelo (Enter termina; volver al primer punto cierra en lazo)</div>
            {Object.keys(PERFILES).map(n => <div key={n} onClick={() => { setPerfilSel(n); setHerr('sigue'); setSigueMenu(false); }} style={{ padding: '6px 8px', cursor: 'pointer', borderRadius: 4, background: perfilSel === n ? '#2a3a52' : 'transparent' }}>{n}</div>)}
          </div>}
        </div>
        <button style={btn} onClick={() => logoInput.current?.click()} title="Sube un logo en SVG (o DXF con contornos cerrados) y se convierte en un modelo 3D con grosor">🖼 Logo</button>
        <input ref={logoInput} type="file" accept=".svg,.dxf" style={{ display: 'none' }} onChange={e => { importarLogo(e.target.files?.[0]); e.target.value = ''; }} />
        <div style={{ position: 'relative' }}>
          <button style={{ ...btn, ...(['zonaS', 'zonaT', 'zonaP'].includes(herr) || zonaMenu ? { background: '#2f6fa8' } : {}) }} onClick={() => setZonaMenu(v => !v)} title="Dibuja una forma sobre un suelo, techo o pared y dale su propio material">▨ Zonas</button>
          {zonaMenu && <div style={{ position: 'absolute', top: 34, left: 0, background: 'rgba(20,20,20,0.97)', borderRadius: 8, padding: 6, zIndex: 8, width: 230, color: '#fff', fontSize: 13 }}>
            {[['zonaS', 'En el suelo'], ['zonaT', 'En el techo'], ['zonaP', 'En una pared (o media pared)']].map(([h, n]) => <div key={h} onClick={() => { setHerr(h); setZonaMenu(false); }} style={{ padding: '6px 8px', cursor: 'pointer', borderRadius: 4 }}>{n}</div>)}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderTop: '1px solid #333', cursor: 'pointer' }}><input type="checkbox" checked={curvo} onChange={e => setCurvo(e.target.checked)} /> Contorno curvo (suave)</label>
            <div style={{ opacity: 0.55, fontSize: 11, padding: '0 8px 4px' }}>Clic punto a punto; cierra con Enter o volviendo al primer punto.</div>
          </div>}
        </div>
        <button style={{ ...btn, ...(herr === 'guia' ? { background: '#d62bd6', borderColor: '#d62bd6' } : {}) }} onClick={() => setHerr('guia')} title="Clic en dos puntos para crear una línea guía infinita. El dibujo se imanta a las guías, a las esquinas y a los extremos de los muros. Esc para salir.">📏 Guía</button>
        <button style={{ ...btn, ...(herr === 'luz' ? { background: '#c9a21a', borderColor: '#c9a21a', color: '#111' } : {}) }} onClick={() => setHerr('luz')} title="Clic en el suelo para colocar una luminaria: se crea también en la capa Iluminación del plano. Esc para salir.">💡 Luz</button>
        <button style={{ ...btn, ...(herr === 'muro' ? { background: '#2f6fa8' } : {}) }} onClick={() => setHerr('muro')} title="Dibuja muros: clic para empezar, clic para cada punto siguiente (Mayús = recto). Enter o Esc para terminar. Se crean también en el plano.">🧱 Muro</button>
        {herr === 'muro' && <><select value={grosorMuro} onChange={e => setGrosorMuro(parseInt(e.target.value, 10))} style={btn} title="Grosor del muro">{[7, 10, 12, 15, 20, 25, 30].map(g => <option key={g} value={g}>{g} cm</option>)}</select>{medidaMuro && <b style={{ color: '#1b6dd6' }}>{medidaMuro}</b>}</>}
        {herr === 'luz' && <select value={kindLuz} onChange={e => setKindLuz(e.target.value)} style={btn}><option value="foco">Foco empotrado</option><option value="plaf">Plafón</option><option value="colg">Colgante</option><option value="aplq">Aplique</option><option value="pie">Lámpara de pie</option><option value="suel">Empotrado de suelo</option></select>}
        {guias.length > 0 && <button style={btn} onClick={() => setGuias([])} title="Quitar todas las guías">✕ Guías ({guias.length})</button>}
        <button style={{ ...btn, ...(bibAbierta ? { background: '#2f6fa8' } : {}) }} onClick={() => setBibAbierta(v => !v)} title="Tus productos del catálogo de Ranuse">📦 Catálogo</button>
        <button style={{ ...btn, ...(b3dAbierta ? { background: '#2f6fa8' } : {}) }} onClick={() => setB3dAbierta(v => !v)} title="Muebles y texturas gratuitos (Poly Haven, CC0)">🧰 Biblioteca 3D</button>
        <button style={{ ...btn, ...(capasAbierto ? { background: '#2f6fa8' } : {}) }} onClick={() => setCapasAbierto(v => !v)}>🏷 Capas</button>
        <button style={{ ...btn, ...(matAbierto || herr === 'pincel' ? { background: '#2f6fa8' } : {}) }} onClick={() => { setMatAbierto(v => !v); if (matAbierto && herr === 'pincel') setHerr('sel'); }}>🎨 Materiales</button>
        {guardado && guardado !== 'inicial' && <span style={{ color: '#555', fontSize: 12 }}>{guardado}</span>}
        <button style={btn} onClick={() => vista('persp')}>Perspectiva</button>
        <button style={btn} onClick={() => vista('planta')}>Planta</button>
        <select style={btn} value={calidad} onChange={e => setCalidad(e.target.value)} title="Si va lento, baja la calidad">
          <option value="baja">Calidad baja</option><option value="media">Calidad media</option><option value="alta">Calidad alta</option>
        </select>
        <button style={btn} onClick={captura}>📷 Captura</button>
        <button style={{ ...btn, background: '#7a4fc4', borderColor: '#7a4fc4' }} onClick={() => setIaForm(true)} disabled={estado !== 'listo' || ia?.estado === 'trabajando'} title="La IA convierte esta vista en una foto realista">✨ Render con IA</button>
        <button style={{ ...btn, background: '#2f6fa8', borderColor: '#2f6fa8' }} onClick={renderAlta} disabled={renderizando || estado !== 'listo'} title="Imagen grande con sombras suaves (3200 px)">{renderizando ? 'Renderizando…' : '🖼 Render HD'}</button>
      </div>
      {iaForm && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', zIndex: 5 }}>
          <div style={{ background: '#1d1d1d', color: '#fff', borderRadius: 10, padding: 18, width: 380, fontSize: 13 }}>
            <b style={{ fontSize: 15 }}>Render fotorrealista con IA</b>
            <p style={{ opacity: 0.7, margin: '6px 0 10px' }}>Se manda lo que ves ahora en pantalla. Colócate bien la cámara antes.</p>
            {[['estancia', 'Estancia (ej. salón, gimnasio privado)'], ['estilo', 'Estilo (ej. moderno, cálido, minimalista)'], ['extra', 'Algo más (ej. luz de tarde, suelo de roble claro)']].map(([k, ph]) => (
              <input key={k} value={iaTxt[k]} onChange={e => setIaTxt(t => ({ ...t, [k]: e.target.value }))} placeholder={ph} style={{ ...btn, width: '100%', boxSizing: 'border-box', marginBottom: 6 }} />
            ))}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <span style={{ opacity: 0.7 }}>Libertad de la IA</span>
              <select value={iaTxt.libertad} onChange={e => setIaTxt(t => ({ ...t, libertad: e.target.value }))} style={btn}>
                <option value="fiel">Fiel al modelo (solo pule)</option>
                <option value="equilibrado">Equilibrado (añade ambiente y luz)</option>
                <option value="creativo">Creativo (decora con criterio)</option>
              </select>
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
              <button style={btn} onClick={() => setIaForm(false)}>Cancelar</button>
              <button style={{ ...btn, background: '#7a4fc4', borderColor: '#7a4fc4' }} onClick={renderIA}>Generar</button>
            </div>
          </div>
        </div>
      )}
      {ia && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'grid', placeItems: 'center', zIndex: 6, padding: 16 }}>
          <div style={{ background: '#1d1d1d', color: '#fff', borderRadius: 10, padding: 16, maxWidth: '92vw', maxHeight: '92vh', overflow: 'auto', fontSize: 13 }}>
            {ia.estado === 'trabajando' && <p>Generando el render con IA… puede tardar un minuto.</p>}
            {ia.estado === 'error' && <><p style={{ color: '#ff9b9b' }}>{ia.mensaje}</p><button style={btn} onClick={() => setIa(null)}>Cerrar</button></>}
            {ia.estado === 'listo' && <>
              <img src={ia.imagen} alt="Render con IA" style={{ maxWidth: '86vw', maxHeight: '72vh', display: 'block', borderRadius: 6 }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <a style={{ ...btn, textDecoration: 'none' }} href={ia.imagen} download={(titulo || 'plano') + '-render-ia.png'}>Descargar</a>
                <button style={btn} onClick={() => setIa(null)}>Cerrar</button>
              </div>
            </>}
          </div>
        </div>
      )}
      {capasAbierto && (() => {
        const fijas = [['muros', 'Muros'], ['huecos', 'Puertas y ventanas'], ['suelos', 'Suelos'], ['techos', 'Techos'], ['rodapie', 'Rodapié'], ['luces', 'Luces'], ['pilares', 'Pilares'], ['equipos', 'Equipos del plano']];
        const propias = [...new Set(objs.map(o => o.etiqueta || ''))];
        const fila = (clave, nombre) => (
          <label key={clave} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', cursor: 'pointer' }}>
            <input type="checkbox" checked={!ocultas.includes(clave)} onChange={() => setOcultas(o => (o.includes(clave) ? o.filter(x => x !== clave) : [...o, clave]))} /> {nombre}
          </label>
        );
        return (
          <div style={{ position: 'absolute', left: 12 + (bibAbierta ? 280 : 0) + (b3dAbierta ? 280 : 0), top: 56, width: 210, background: 'rgba(20,20,20,0.94)', color: '#fff', borderRadius: 8, padding: '10px 12px', fontSize: 13, zIndex: 3 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Ver por capas</div>
            {fijas.map(([k, n]) => fila(k, n))}
            <div style={{ borderTop: '1px solid #333', marginTop: 6, paddingTop: 6 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginBottom: 4 }}><input type="checkbox" checked={rodapie.on} onChange={e => setRodapie(r => ({ ...r, on: e.target.checked }))} /> <b>Poner rodapié</b></label>
              {rodapie.on && <div style={{ fontSize: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}><span style={{ width: 62, opacity: 0.7 }}>Alto cm</span><input type="number" value={rodapie.alto} onChange={e => setRodapie(r => ({ ...r, alto: parseFloat(e.target.value) || 10 }))} style={{ ...btn, width: 60, padding: '2px 4px' }} /></label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}><span style={{ width: 62, opacity: 0.7 }}>Grosor cm</span><input type="number" step="0.5" value={rodapie.grosor} onChange={e => setRodapie(r => ({ ...r, grosor: parseFloat(e.target.value) || 1.5 }))} style={{ ...btn, width: 60, padding: '2px 4px' }} /></label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 62, opacity: 0.7 }}>Color</span><input type="color" value={rodapie.color} onChange={e => setRodapie(r => ({ ...r, color: e.target.value }))} /></label>
              </div>}
            </div>
            {propias.length > 0 && <div style={{ borderTop: '1px solid #333', marginTop: 6, paddingTop: 6, opacity: 0.7 }}>Tus objetos</div>}
            {propias.map(t => fila('obj:' + t, t || 'Sin etiqueta'))}
          </div>
        );
      })()}
      {luzSel && (() => {
        const l = lucesPl.find(x => x.id === luzSel); if (!l) return null;
        const cat = lumCat.find(c => c.id === l.lid), nombres = { foco: 'Foco empotrado', plaf: 'Plafón', colg: 'Luminaria colgante', aplq: 'Aplique', pie: 'Lámpara de pie', suel: 'Empotrado de suelo' };
        const ap = lucesAj[l.id]?.ap ?? 60, spot = l.kid === 'foco' || l.kid === 'plaf';
        return (
          <div style={{ position: 'absolute', right: 12, top: 56, width: 260, background: 'rgba(20,20,20,0.94)', color: '#fff', borderRadius: 8, padding: '12px 14px', fontSize: 13 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>💡 {nombres[l.kid] || 'Luminaria'} <span style={{ fontWeight: 400, opacity: 0.55, fontSize: 11 }}>(del plano)</span></div>
            <div style={{ opacity: 0.75, marginBottom: 6 }}>{cat ? cat.n + ' · ' + (cat.lm || '?') + ' lm · ' + (cat.w || '?') + ' W · ' + (cat.k || '?') + ' K' : 'Sin luminaria del catálogo asignada (se usa una estándar de 800 lm)'}</div>
            {spot && <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}><span style={{ width: 90, opacity: 0.7 }}>Apertura del haz</span><input type="range" min="10" max="120" value={ap} onChange={e => setLucesAj(a => ({ ...a, [l.id]: { ap: parseInt(e.target.value, 10) } }))} style={{ flex: 1 }} /><span style={{ width: 34 }}>{ap}°</span></label>}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}><span style={{ width: 90, opacity: 0.7 }}>Altura (cm)</span><input type="number" defaultValue={Math.round(l.h != null ? l.h : ({ foco: 255, plaf: 255, colg: 200, aplq: 180, pie: 120, suel: 5 }[l.kid] ?? 250))} onBlur={e => api.patch('/medicion/' + id + '/luminaria/' + l.id, { h: e.target.value }).then(() => { setAviso('Altura guardada en el plano ✓. Si tienes Planos abierto, recárgalo.'); api3d.current.recargar?.(); }).catch(() => setAviso('No se pudo cambiar la altura'))} style={{ ...btn, width: 80 }} /></label>
            <div style={{ opacity: 0.5, fontSize: 11, marginBottom: 8 }}>El ángulo de apertura se guarda en el 3D; la altura y la posición se guardan también en el plano.</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={{ ...btn, background: '#7a2b2b' }} onClick={() => api.delete('/medicion/' + id + '/luminaria/' + l.id).then(() => { setLuzSel(null); setAviso('Luminaria quitada del plano ✓. Si tienes Planos abierto, recárgalo.'); api3d.current.recargar?.(); }).catch(() => setAviso('No se pudo quitar'))}>Quitar</button>
              <button style={btn} onClick={() => setLuzSel(null)}>Cerrar</button>
            </div>
          </div>
        );
      })()}
      {aviso && (
        <div style={{ position: 'absolute', top: 56, left: '50%', transform: 'translateX(-50%)', maxWidth: 560, background: 'rgba(20,20,20,0.95)', color: '#fff', borderRadius: 8, padding: '8px 12px', fontSize: 13, zIndex: 7, display: 'flex', gap: 10, alignItems: 'center' }}>
          <span>{aviso}</span><button style={btn} onClick={() => setAviso('')}>OK</button>
        </div>
      )}
      {selHueco && (
        <div style={{ position: 'absolute', right: 12, top: 56, width: 250, background: 'rgba(20,20,20,0.94)', color: '#fff', borderRadius: 8, padding: '12px 14px', fontSize: 13 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{selHueco.tipo === 'door' ? 'Puerta' : selHueco.tipo === 'win' ? 'Ventana' : 'Hueco'} del plano</div>
          {[['w', 'Ancho'], ['h', 'Alto'], ['sill', 'Antepecho'], ['p', 'Posición']].map(([k, et]) => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ width: 70, opacity: 0.7 }}>{et} cm</span>
              <input type="number" value={selHueco.nuevo[k]} onChange={e => setSelHueco(s => ({ ...s, nuevo: { ...s.nuevo, [k]: e.target.value } }))} style={{ ...btn, width: 90 }} />
            </label>
          ))}
          <div style={{ opacity: 0.55, fontSize: 11, margin: '4px 0 8px' }}>Posición = distancia desde el inicio del muro hasta el borde del hueco. Se cambia también en el plano 2D.</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={{ ...btn, background: '#2f6fa8' }} onClick={aplicarHueco}>Aplicar al plano</button>
            <button style={btn} onClick={() => setSelHueco(null)}>Cerrar</button>
          </div>
        </div>
      )}
      {matAbierto && (() => {
        const base = ['#ffffff', '#f4f1ec', '#e8e2d8', '#d9cfc0', '#c9b9a0', '#b8a58c', '#a9b5a1', '#8fa3a8', '#7d8e9c', '#9d9a96', '#6e6a66', '#3a3a3c', '#c9a77c', '#8a6a4a', '#d9a7a0', '#b5695e'];
        const elegir = m => { setMatSel(m); setHerr('pincel'); };
        const esSel = m => matSel && ((m.hex && matSel.hex === m.hex) || (m.id && matSel.id === m.id));
        const anadirColor = () => {
          const nombre = (document.getElementById('mat-nombre')?.value || '').trim();
          const hex = document.getElementById('mat-hex')?.value;
          if (!/^#[0-9a-fA-F]{6}$/.test(hex || '')) return;
          setPaleta(p => [...p, { nombre: nombre || hex, hex }]);
          const e = document.getElementById('mat-nombre'); if (e) e.value = '';
        };
        const subir = async (archivo) => {
          if (!archivo) return;
          const tam = parseFloat(document.getElementById('mat-tam')?.value) || 60;
          setGuardado('Subiendo textura…');
          try {
            const fd = new FormData(); fd.append('file', archivo); fd.append('tam', String(tam));
            const r = await api.post('/medicion/' + id + '/textura', fd);
            setTexturas(t => [...t, r.data.textura]); setGuardado('Textura subida ✓');
          } catch (e) { setGuardado(e.response?.data?.error || 'No se pudo subir la textura'); }
        };
        const quitarTex = async (t) => {
          try { await api.delete('/medicion/' + id + '/textura/' + t.id); setTexturas(x => x.filter(y => y.id !== t.id)); if (matSel?.id === t.id) setMatSel(null); } catch { setGuardado('No se pudo quitar'); }
        };
        return (
          <div style={{ position: 'absolute', left: 12 + (bibAbierta ? 280 : 0) + (b3dAbierta ? 280 : 0) + (capasAbierto ? 222 : 0), top: 56, bottom: 12, width: 270, background: 'rgba(20,20,20,0.94)', color: '#fff', borderRadius: 8, padding: 10, overflow: 'auto', fontSize: 13, zIndex: 3 }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>🎨 Materiales (pincel)</div>
            <div style={{ opacity: 0.65, fontSize: 11, marginBottom: 8 }}>Elige un material y haz clic en un muro, suelo, techo u objeto. Con Mayús + clic se aplica a todos los de ese tipo.</div>
            <div style={{ opacity: 0.7, marginBottom: 4 }}>Colores</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
              {base.map(c => <span key={c} onClick={() => elegir({ hex: c })} title={c} style={{ width: 24, height: 24, background: c, borderRadius: 4, cursor: 'pointer', border: esSel({ hex: c }) ? '2px solid #4da3ff' : '1px solid #555' }} />)}
            </div>
            <div style={{ opacity: 0.7, marginBottom: 4 }}>Tu paleta (NCS, RAL, marcas…)</div>
            {paleta.map((p, i) => (
              <div key={i} onClick={() => elegir({ hex: p.hex })} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 2px', cursor: 'pointer', background: esSel({ hex: p.hex }) ? '#2a3a52' : 'transparent', borderRadius: 4 }}>
                <span style={{ width: 20, height: 20, background: p.hex, borderRadius: 4, border: '1px solid #555', flex: 'none' }} />
                <span style={{ flex: 1 }}>{p.nombre}</span><span style={{ opacity: 0.5, fontSize: 11 }}>{p.hex}</span>
                <span onClick={e => { e.stopPropagation(); setPaleta(x => x.filter((_, j) => j !== i)); }} style={{ opacity: 0.6, padding: '0 4px' }}>✕</span>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 5, margin: '6px 0 10px' }}>
              <input id="mat-nombre" placeholder="Nombre (ej. NCS S 1002-Y)" style={{ ...btn, flex: 1, minWidth: 0 }} />
              <input id="mat-hex" type="color" defaultValue="#d9cfc0" style={{ width: 34, height: 30, padding: 0, border: 'none', background: 'none' }} />
              <button style={btn} onClick={anadirColor}>+</button>
            </div>
            {matsCat.length > 0 && <>
              <div style={{ opacity: 0.7, marginBottom: 4 }}>Del catálogo de Ranuse</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 8 }}>
                {matsCat.slice(0, 60).map(mc => (
                  <div key={mc.id} onClick={() => usarMatCatalogo(mc)} title={mc.n + ' · ' + (mc.cat || '')} style={{ cursor: 'pointer', border: '1px solid #555', borderRadius: 4, overflow: 'hidden' }}>
                    <img src={mc.url} alt={mc.n} loading="lazy" style={{ width: '100%', height: 56, objectFit: 'cover', display: 'block' }} />
                    <div style={{ fontSize: 10, padding: '1px 3px', background: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{mc.n}</div>
                  </div>
                ))}
              </div>
            </>}
            <div style={{ opacity: 0.7, marginBottom: 4 }}>Texturas</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 8 }}>
              {texturas.map(t => (
                <div key={t.id} onClick={() => elegir({ id: t.id })} title={t.nombre + ' · ' + t.tam + ' cm'} style={{ position: 'relative', cursor: 'pointer', border: esSel({ id: t.id }) ? '2px solid #4da3ff' : '1px solid #555', borderRadius: 4, overflow: 'hidden' }}>
                  <img src={t.url} alt={t.nombre} style={{ width: '100%', height: 56, objectFit: 'cover', display: 'block' }} />
                  <div style={{ fontSize: 10, padding: '1px 3px', background: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.nombre}</div>
                  <span onClick={e => { e.stopPropagation(); quitarTex(t); }} style={{ position: 'absolute', top: 1, right: 3, background: '#000a', borderRadius: 3, padding: '0 4px', fontSize: 11 }}>✕</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <label style={{ ...btn, display: 'inline-block' }}>Subir textura…
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { subir(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              <span style={{ opacity: 0.7 }}>tamaño real</span>
              <input id="mat-tam" type="number" defaultValue={60} style={{ ...btn, width: 56 }} /><span style={{ opacity: 0.7 }}>cm</span>
            </div>
            <div style={{ opacity: 0.5, fontSize: 11, marginTop: 4 }}>«Tamaño real» es lo que mide en la vida real el lado de la foto (ej. una loseta de 60 cm), para que no salga gigante.</div>
            {herr === 'pincel' && <button style={{ ...btn, marginTop: 10, width: '100%' }} onClick={() => { setHerr('sel'); }}>Terminar pincel</button>}
          </div>
        );
      })()}
      {selAcab && !objSel && (() => {
        const esMuro = selAcab.tipo === 'muro';
        const actual = esMuro ? (acab.muros[selAcab.id] || acab.todosMuros) : (acab.salas[selAcab.id] || acab.todosSuelos);
        const poner = hex => setAcab(a => esMuro ? { ...a, muros: { ...a.muros, [selAcab.id]: hex } } : { ...a, salas: { ...a.salas, [selAcab.id]: hex } });
        const todos = hex => setAcab(a => esMuro ? { ...a, muros: {}, todosMuros: hex } : { ...a, salas: {}, todosSuelos: hex });
        const quitar = () => setAcab(a => {
          const m = { ...(esMuro ? a.muros : a.salas) }; delete m[selAcab.id];
          return esMuro ? { ...a, muros: m } : { ...a, salas: m };
        });
        const paleta = ['#ffffff', '#f4f1ec', '#e8e2d8', '#d9cfc0', '#c9b9a0', '#b8a58c', '#a9b5a1', '#8fa3a8', '#7d8e9c', '#9d9a96', '#6e6a66', '#3a3a3c', '#c9a77c', '#8a6a4a', '#d9a7a0', '#b5695e'];
        return (
          <div style={{ position: 'absolute', right: 12, top: 56, width: 250, background: 'rgba(20,20,20,0.94)', color: '#fff', borderRadius: 8, padding: '12px 14px', fontSize: 13 }}>
            {esMuro && (() => {
              const mu = (api3d.current.modelo?.plantas || (api3d.current.modelo ? [api3d.current.modelo] : [])).flatMap(p => p.muros || []).find(m => m.id === selAcab.id);
              if (!mu) return null;
              const parche = campos => api.patch('/medicion/' + id + '/muro/' + mu.id, campos).then(() => { setAviso('Muro cambiado en el plano ✓. Si tienes Planos abierto, recárgalo.'); api3d.current.recargar?.(); }).catch(er => setAviso(er.response?.data?.error || 'No se pudo cambiar el muro'));
              return (
                <div style={{ borderBottom: '1px solid #333', marginBottom: 8, paddingBottom: 8 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>Muro del plano</div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 80, opacity: 0.7 }}>Grosor cm</span><input key={'t' + mu.id + rev} type="number" defaultValue={mu.t || 12} onBlur={e => parche({ t: e.target.value })} style={{ ...btn, width: 70 }} /></label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 80, opacity: 0.7 }}>Alto cm</span><input key={'h' + mu.id + rev} type="number" defaultValue={Math.round(mu.h || api3d.current.modelo?.altura || 260)} onBlur={e => parche({ h: e.target.value })} style={{ ...btn, width: 70 }} /></label>
                  <div style={{ opacity: 0.55, fontSize: 11, marginBottom: 6 }}>Largo: {Math.round(Math.hypot(mu.b[0] - mu.a[0], mu.b[1] - mu.a[1]))} cm. Arrastra las bolas azules de los extremos para moverlo (mueve también los muros conectados).</div>
                  <button style={{ ...btn, background: '#7a2b2b' }} onClick={() => { if (window.confirm('¿Borrar este muro del plano? Sus puertas y ventanas también se quitan.')) api.delete('/medicion/' + id + '/muro/' + mu.id).then(() => { setSelAcab(null); setAviso('Muro borrado del plano ✓. Si tienes Planos abierto, recárgalo.'); api3d.current.recargar?.(); }).catch(er => setAviso(er.response?.data?.error || 'No se pudo borrar')); }}>Borrar muro</button>
                </div>
              );
            })()}
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{esMuro ? 'Muro' : 'Suelo'}: color</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
              {paleta.map(c => <span key={c} onClick={() => poner(c)} title={c} style={{ width: 24, height: 24, background: c, border: '1px solid #555', borderRadius: 4, cursor: 'pointer' }} />)}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <input type="color" value={/^#/.test(actual || '') ? actual : '#e4e0db'} onChange={e => poner(e.target.value)} />
              <input value={/^#/.test(actual || '') ? actual : ''} placeholder="#RRGGBB" onChange={e => { const v = e.target.value.trim(); if (/^#[0-9a-fA-F]{6}$/.test(v)) poner(v); }} style={{ ...btn, width: 100 }} />
            </label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {actual && <button style={btn} onClick={() => todos(actual)}>{esMuro ? 'A todos los muros' : 'A todos los suelos'}</button>}
              {!esMuro && <button style={btn} onClick={() => moldurasSala(selAcab.id)} title="Un perfil (el elegido en Sígueme: rodapié, moldura…) recorre todo el perímetro de la sala">Moldura en el perímetro</button>}
              {!esMuro && <button style={{ ...btn, background: '#2f6fa8' }} onClick={() => crearFalsoTecho(selAcab.id)} title="Crea un falso techo descolgado con un hueco perimetral (foseado) y luz LED">Falso techo con foseado</button>}
              <button style={btn} onClick={quitar}>Quitar color</button>
              <button style={btn} onClick={() => setSelAcab(null)}>Cerrar</button>
            </div>
          </div>
        );
      })()}
      {b3dAbierta && (() => {
        const lista = (b3d?.[b3dTab] || []).filter(m => (!b3dCat || m.categoria === b3dCat) && (!b3dFiltro || (m.nombre + ' ' + m.categoria).toLowerCase().includes(b3dFiltro.toLowerCase())));
        const cats = [...new Set((b3d?.[b3dTab] || []).map(m => m.categoria))].sort();
        return (
          <div style={{ position: 'absolute', left: 12 + (bibAbierta ? 280 : 0), top: 56, bottom: 12, width: 270, background: 'rgba(20,20,20,0.94)', color: '#fff', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', fontSize: 13, zIndex: 3 }}>
            <div style={{ fontWeight: 700 }}>🧰 Biblioteca 3D <span style={{ fontWeight: 400, opacity: 0.55, fontSize: 11 }}>gratis · CC0</span></div>
            <div style={{ display: 'flex', gap: 6, margin: '6px 0' }}>
              <button style={{ ...btn, flex: 1, ...(b3dTab === 'modelos' ? { background: '#2f6fa8' } : {}) }} onClick={() => { setB3dTab('modelos'); setB3dCat(''); }}>Muebles</button>
              <button style={{ ...btn, flex: 1, ...(b3dTab === 'texturas' ? { background: '#2f6fa8' } : {}) }} onClick={() => { setB3dTab('texturas'); setB3dCat(''); }}>Texturas</button>
            </div>
            <input value={b3dFiltro} onChange={e => setB3dFiltro(e.target.value)} placeholder="Buscar…" style={{ ...btn, width: '100%', boxSizing: 'border-box', marginBottom: 6 }} />
            <select value={b3dCat} onChange={e => setB3dCat(e.target.value)} style={{ ...btn, marginBottom: 8 }}>
              <option value="">Todas las categorías</option>{cats.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <div style={{ overflow: 'auto', flex: 1 }}>
              {!b3d && <p style={{ opacity: 0.6 }}>Cargando…</p>}
              {b3d?.vacia && <p style={{ opacity: 0.7 }}>La biblioteca todavía no está cargada.</p>}
              {b3dTab === 'modelos' && lista.map(m => (
                <div key={m.id} onClick={() => anadirModelo3d(m)} style={{ padding: '6px 4px', borderTop: '1px solid #333', cursor: 'pointer' }} title="Clic para colocarlo en el centro de la vista">
                  <div>{m.nombre}</div><div style={{ opacity: 0.55, fontSize: 11 }}>{m.categoria} · {m.w}×{m.d}×{m.alto} cm</div>
                </div>
              ))}
              {b3dTab === 'texturas' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                  {lista.map(t => (
                    <div key={t.id} onClick={() => usarTexturaB3d(t)} title={t.nombre + ' · ' + t.categoria} style={{ cursor: 'pointer', border: '1px solid #555', borderRadius: 4, overflow: 'hidden' }}>
                      <img src={t.url} alt={t.nombre} loading="lazy" style={{ width: '100%', height: 56, objectFit: 'cover', display: 'block' }} />
                      <div style={{ fontSize: 10, padding: '1px 3px', background: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.nombre}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ opacity: 0.45, fontSize: 10, marginTop: 6 }}>Modelos y texturas de Poly Haven (polyhaven.com), licencia CC0.</div>
          </div>
        );
      })()}
      {bibAbierta && (
        <div style={{ position: 'absolute', left: 12, top: 56, bottom: 12, width: 270, background: 'rgba(20,20,20,0.94)', color: '#fff', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', fontSize: 13 }}>
          <input value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Buscar en el catálogo…" style={{ ...btn, width: '100%', marginBottom: 8, boxSizing: 'border-box' }} />
          <div style={{ overflow: 'auto', flex: 1 }}>
            {!biblioteca && <p style={{ opacity: 0.6 }}>Cargando catálogo…</p>}
            {(biblioteca || []).filter(m => !filtro || (m.nombre + ' ' + (m.categoria || '') + ' ' + (m.marca || '')).toLowerCase().includes(filtro.toLowerCase())).slice(0, 80).map(m => (
              <div key={m.id} onClick={() => anadirBloque(m)} style={{ padding: '6px 4px', borderTop: '1px solid #333', cursor: 'pointer' }} title="Clic para colocarlo en el centro de la vista">
                <div>{m.nombre}</div>
                <div style={{ opacity: 0.55, fontSize: 11 }}>{m.categoria} · {Math.round(m.w)}×{Math.round(m.d)} cm</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {objSel && (
        <div style={{ position: 'absolute', right: 12, top: 56, width: 270, maxHeight: 'calc(100vh - 80px)', overflowY: 'auto', background: 'rgba(20,20,20,0.94)', color: '#fff', borderRadius: 8, padding: '12px 14px', fontSize: 13 }}>
          <input value={objSel.nombre} onChange={e => cambiar(objSel.id, { nombre: e.target.value })} style={{ ...btn, width: '100%', boxSizing: 'border-box', fontWeight: 700, marginBottom: 8 }} />
          {[['cx', 'Posición X'], ['cy', 'Posición Y'], ['w', 'Largo'], ['d', 'Fondo'], ['alto', 'Alto'], ['z0', 'Elevación'], ['rot', 'Giro °']].filter(([k]) => {
            const t = objSel.tipo;
            if (t === 'mueble' && k === 'w') return false;
            if (t === 'zona' && objSel.plano === 'pared') return false;
            if (['zona', 'falsotecho', 'barrido'].includes(t)) return k === 'cx' || k === 'cy' || (t === 'barrido' && k === 'z0');
            if (t === 'logo' && ['w', 'd', 'alto'].includes(k)) return false;
            return true;
          }).map(([k, et]) => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ width: 70, opacity: 0.7 }}>{et}</span>
              <input type="number" value={Math.round(objSel[k] * 10) / 10} onChange={e => cambiar(objSel.id, { [k]: parseFloat(e.target.value) || 0 })} style={{ ...btn, width: 90 }} />
            </label>
          ))}
          {objSel.tipo === 'barrido' && (
            <div style={{ borderTop: '1px solid #333', margin: '6px 0', paddingTop: 6 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Perfil que recorre el camino</div>
              <select value={objSel.perfilNombre || ''} onChange={e => cambiar(objSel.id, { perfilNombre: e.target.value, perfil: PERFILES[e.target.value] })} style={{ ...btn, width: '100%', marginBottom: 6 }}>{Object.keys(PERFILES).map(n => <option key={n} value={n}>{n}</option>)}</select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 90, opacity: 0.7 }}>Escala</span><input type="number" step="0.1" value={objSel.esc || 1} onChange={e => cambiar(objSel.id, { esc: parseFloat(e.target.value) || 1 })} style={{ ...btn, width: 70 }} /></label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, cursor: 'pointer' }}><input type="checkbox" checked={!!objSel.cerrado} onChange={e => cambiar(objSel.id, { cerrado: e.target.checked })} /> Cerrar en lazo</label>
              <button style={btn} onClick={() => cambiar(objSel.id, { lado: objSel.lado === -1 ? 1 : -1 })}>↔ Cambiar de lado</button>
              <div style={{ opacity: 0.5, fontSize: 11, marginTop: 4 }}>La elevación (arriba) sube o baja todo el perfil: 0 para un rodapié, cerca de la altura del techo para una cornisa.</div>
            </div>
          )}
          {objSel.tipo === 'logo' && (
            <div style={{ borderTop: '1px solid #333', margin: '6px 0', paddingTop: 6 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Logo</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 90, opacity: 0.7 }}>Ancho (cm)</span><input type="number" value={Math.round(objSel.w)} onChange={e => { const w = parseFloat(e.target.value) || 10; cambiar(objSel.id, { w, alto: Math.round(w * (objSel.ratio || 1)) }); }} style={{ ...btn, width: 80 }} /></label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 90, opacity: 0.7 }}>Grosor (cm)</span><input type="number" step="0.5" value={objSel.d} onChange={e => cambiar(objSel.id, { d: parseFloat(e.target.value) || 1 })} style={{ ...btn, width: 80 }} /></label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 90, opacity: 0.7 }}>Colocación</span><select value={objSel.plano || 'vertical'} onChange={e => cambiar(objSel.id, { plano: e.target.value })} style={btn}><option value="vertical">De pie (en pared)</option><option value="horizontal">Tumbado (en suelo)</option></select></label>
              <div style={{ opacity: 0.5, fontSize: 11 }}>Alto resultante: {Math.round(objSel.alto)} cm. Para pegarlo a una pared, muévelo hasta ella y gíralo; la elevación es la altura del borde inferior.</div>
            </div>
          )}
          {objSel.tipo === 'falsotecho' && (() => {
            const F = objSel.ft || { descenso: 15, gap: 12, luz: true, k: 3000 }, set = c => cambiar(objSel.id, { ft: { ...F, ...c } });
            return (
              <div style={{ borderTop: '1px solid #333', margin: '6px 0', paddingTop: 6 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Falso techo</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 110, opacity: 0.7 }}>Descenso (cm)</span><input type="number" value={F.descenso} onChange={e => set({ descenso: parseFloat(e.target.value) || 0 })} style={{ ...btn, width: 70 }} /></label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 110, opacity: 0.7 }}>Foseado (cm)</span><input type="number" value={F.gap} onChange={e => set({ gap: parseFloat(e.target.value) || 2 })} style={{ ...btn, width: 70 }} /></label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 110, opacity: 0.7 }}>Altura del techo</span><input type="number" value={objSel.h || 260} onChange={e => cambiar(objSel.id, { h: parseFloat(e.target.value) || 260 })} style={{ ...btn, width: 70 }} /></label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, cursor: 'pointer' }}><input type="checkbox" checked={F.luz !== false} onChange={e => set({ luz: e.target.checked })} /> Luz LED en el foseado</label>
                {F.luz !== false && <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 110, opacity: 0.7 }}>Temperatura</span><select value={F.k || 3000} onChange={e => set({ k: parseInt(e.target.value, 10) })} style={btn}><option value={2700}>2700 K cálida</option><option value={3000}>3000 K</option><option value={4000}>4000 K neutra</option><option value={6000}>6000 K fría</option></select></label>}
                <div style={{ opacity: 0.5, fontSize: 11 }}>Descenso negativo = el techo sube (relieve). El foseado es el hueco entre la pared y el falso techo.</div>
              </div>
            );
          })()}
          {objSel.tipo === 'zona' && <div style={{ opacity: 0.6, fontSize: 11, margin: '4px 0' }}>Zona pintable: cambia su color abajo, o usa el pincel 🎨 con una textura para darle otro material.</div>}
          {objSel.tipo === 'mueble' && (() => {
            const M = objSel.mueble || { modulos: [] }, desp = despieceMueble(objSel);
            const tipos = [['puertas', 'Puertas'], ['cajones', 'Cajones'], ['abierto', 'Abierto'], ['hueco', 'Hueco']];
            return (
              <div style={{ borderTop: '1px solid #333', margin: '6px 0', paddingTop: 6 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Módulos · ancho total {Math.round(objSel.w)} cm</div>
                {M.modulos.map((m, i) => (
                  <div key={i} style={{ background: '#2a2a2a', borderRadius: 6, padding: 6, marginBottom: 5 }}>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <select value={m.t} onChange={e => cambiarModulos(objSel.id, ms => { ms[i].t = e.target.value; return ms; })} style={{ ...btn, flex: 1, padding: '3px 4px' }}>{tipos.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>
                      <input type="number" value={m.w} onChange={e => cambiarModulos(objSel.id, ms => { ms[i].w = parseFloat(e.target.value) || 0; return ms; })} style={{ ...btn, width: 56, padding: '3px 4px' }} title="Ancho (cm)" />
                      <span onClick={() => cambiarModulos(objSel.id, ms => { if (i > 0) [ms[i - 1], ms[i]] = [ms[i], ms[i - 1]]; return ms; })} style={{ cursor: 'pointer', padding: '0 3px' }} title="Mover a la izquierda">◀</span>
                      <span onClick={() => cambiarModulos(objSel.id, ms => { if (i < ms.length - 1) [ms[i + 1], ms[i]] = [ms[i], ms[i + 1]]; return ms; })} style={{ cursor: 'pointer', padding: '0 3px' }} title="Mover a la derecha">▶</span>
                      <span onClick={() => cambiarModulos(objSel.id, ms => ms.filter((_, j) => j !== i))} style={{ cursor: 'pointer', padding: '0 3px', opacity: 0.7 }} title="Quitar módulo">✕</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, fontSize: 12 }}>
                      {m.t === 'puertas' && <label>Hojas <select value={m.n === 2 ? 2 : 1} onChange={e => cambiarModulos(objSel.id, ms => { ms[i].n = parseInt(e.target.value, 10); return ms; })} style={{ ...btn, padding: '2px' }}><option value={1}>1</option><option value={2}>2</option></select></label>}
                      {m.t === 'cajones' && <label>Cajones <input type="number" min="1" max="8" value={m.n || 3} onChange={e => cambiarModulos(objSel.id, ms => { ms[i].n = parseInt(e.target.value, 10) || 1; return ms; })} style={{ ...btn, width: 44, padding: '2px 4px' }} /></label>}
                      {(m.t === 'puertas' || m.t === 'abierto') && <label>Baldas <input type="number" min="0" max="10" value={m.nb ?? (m.t === 'abierto' ? 3 : 1)} onChange={e => cambiarModulos(objSel.id, ms => { ms[i].nb = parseInt(e.target.value, 10) || 0; return ms; })} style={{ ...btn, width: 44, padding: '2px 4px' }} /></label>}
                      {(m.t === 'puertas' || m.t === 'cajones') && <label style={{ cursor: 'pointer' }}><input type="checkbox" checked={!!m.abierto} onChange={e => cambiarModulos(objSel.id, ms => { ms[i].abierto = e.target.checked; return ms; })} /> Abierto</label>}
                    </div>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                  {tipos.map(([v, n]) => <button key={v} style={{ ...btn, padding: '3px 8px' }} onClick={() => cambiarModulos(objSel.id, ms => [...ms, { t: v, w: 60, n: v === 'cajones' ? 3 : 1, nb: v === 'abierto' ? 3 : 1 }])}>+ {n}</button>)}
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 70, opacity: 0.7 }}>Zócalo cm</span><input type="number" value={M.zocalo ?? 10} onChange={e => cambiar(objSel.id, { mueble: { ...M, zocalo: parseFloat(e.target.value) || 0 } })} style={{ ...btn, width: 70 }} /></label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 70, opacity: 0.7 }}>Tablero cm</span><input type="number" step="0.1" value={M.esp ?? 1.8} onChange={e => cambiar(objSel.id, { mueble: { ...M, esp: parseFloat(e.target.value) || 1.8 } })} style={{ ...btn, width: 70 }} /></label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 70, opacity: 0.7 }}>Tirador</span><select value={M.tirador || 'barra'} onChange={e => cambiar(objSel.id, { mueble: { ...M, tirador: e.target.value } })} style={btn}><option value="barra">Barra</option><option value="ninguno">Sin tirador</option></select></label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 70, opacity: 0.7 }}>Frentes</span><input type="color" value={/^#/.test(objSel.colorFrente || '') ? objSel.colorFrente : '#f4f1ec'} onChange={e => cambiar(objSel.id, { colorFrente: e.target.value })} /></label>
                <details style={{ marginTop: 4 }}>
                  <summary style={{ cursor: 'pointer', opacity: 0.8 }}>Despiece · {desp.area} m² de tablero</summary>
                  <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>{desp.filas.map(([k, n]) => <div key={k}>{n} × {k} cm</div>)}</div>
                </details>
                <div style={{ opacity: 0.5, fontSize: 11, marginTop: 4 }}>Con el pincel 🎨, clic en un frente cambia el color de los frentes; en el cuerpo, el del cuerpo.</div>
              </div>
            );
          })()}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 70, opacity: 0.7 }}>Etiqueta</span><input value={objSel.etiqueta || ''} placeholder="Mobiliario…" onChange={e => cambiar(objSel.id, { etiqueta: e.target.value })} style={{ ...btn, width: 120 }} /></label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '6px 0' }}><span style={{ width: 70, opacity: 0.7 }}>Color</span><input type="color" value={objSel.color || (objSel.tipo === 'caja' ? '#9aa3ad' : '#2f6fa8')} onChange={e => cambiar(objSel.id, { color: e.target.value })} /></label>
          {objSel.tipo === 'bloque' && objSel.cid && (
            <div style={{ borderTop: '1px solid #333', marginTop: 8, paddingTop: 8 }}>
              <div style={{ opacity: 0.7, marginBottom: 4 }}>Modelo 3D {modeloDe(objSel) ? '(asignado)' : '(sin modelo: se ve como caja)'}</div>
              <label style={{ ...btn, display: 'inline-block' }}>
                {modeloDe(objSel) ? 'Cambiar modelo…' : 'Asignar modelo 3D…'}
                <input type="file" accept=".glb,.gltf,.obj,.dae,.skp" style={{ display: 'none' }} onChange={e => { asignarModelo(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              {modeloDe(objSel) && <button style={{ ...btn, marginLeft: 6 }} onClick={quitarModelo}>Quitar</button>}
              {modeloDe(objSel) && <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}><span style={{ width: 70, opacity: 0.7 }}>Giro modelo</span><input type="number" step="90" value={objSel.rotM || 0} onChange={e => cambiar(objSel.id, { rotM: parseFloat(e.target.value) || 0 })} style={{ ...btn, width: 90 }} /></label>}
              {subiendo && <div style={{ fontSize: 11, opacity: 0.75, marginTop: 4 }}>{subiendo}</div>}
              <div style={{ fontSize: 11, opacity: 0.5, marginTop: 4 }}>Formatos: .glb, .gltf, .obj, .dae. Desde SketchUp: Archivo → Exportar → Modelo 3D.</div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            <button style={btn} onClick={() => cambiar(objSel.id, { rot: ((objSel.rot || 0) + 90) % 360 })}>⟳ 90°</button>
            <button style={btn} onClick={() => duplicar(objSel.id)}>Duplicar</button>
            <button style={{ ...btn, background: '#7a2b2b' }} onClick={() => borrar(objSel.id)}>Borrar</button>
          </div>
        </div>
      )}
      {seleccion && !objSel && (
        <div style={{ position: 'absolute', right: 12, bottom: 12, width: 250, background: 'rgba(20,20,20,0.92)', color: '#fff', borderRadius: 8, padding: '12px 14px', fontSize: 13, lineHeight: 1.5 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{seleccion.nombre || 'Equipo'}</div>
          <div style={{ marginBottom: 4 }}>Alto: {Math.round(seleccion.alto || 110)} cm</div>
          {eqNuevo && [['x', 'Posición X'], ['y', 'Posición Y'], ['w', 'Largo'], ['d', 'Fondo'], ['rot', 'Giro °']].map(([k, et]) => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ width: 70, opacity: 0.7 }}>{et}</span>
              <input type="number" value={eqNuevo[k]} onChange={e => setEqNuevo(s => ({ ...s, [k]: e.target.value }))} style={{ ...btn, width: 90 }} />
            </label>
          ))}
          <button style={{ ...btn, background: '#2f6fa8', marginTop: 6 }} onClick={aplicarEquipo}>Aplicar al plano</button>
          <div>Estado: {seleccion.estado === 'ex' ? 'existente' : 'nuevo'}</div>
          <button style={{ ...btn, marginTop: 8 }} onClick={() => setSeleccion(null)}>Cerrar</button>
        </div>
      )}
      {estado === 'cargando' && <p style={{ position: 'absolute', top: '45%', width: '100%', textAlign: 'center', color: '#555' }}>Cargando…</p>}
      {estado === 'sin-modelo' && <p style={{ position: 'absolute', top: '45%', width: '100%', textAlign: 'center', color: '#555' }}>Este plano todavía no tiene modelo 3D: ábrelo en Planos, dibuja algo y se guarda solo.</p>}
      {estado === 'error' && <p style={{ position: 'absolute', top: '45%', width: '100%', textAlign: 'center', color: '#a33' }}>No se ha podido cargar el plano.</p>}
    </div>
  );
}
