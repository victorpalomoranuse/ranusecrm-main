import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import api from '../services/api';

// Visor 3D de un plano de Planos (lee su modelo3d). Pensado para gimnasios: paredes con puertas y ventanas,
// suelos por sala, pilares y máquinas como bloques con sus medidas. Las medidas del plano van en cm.
const CM = 0.01;

// Texturas subidas: se descargan una vez y se reutilizan; la repetición se ajusta al tamaño real (cm) de cada textura
const cacheTex = new Map();
function texturaDe(t, uvEnCm) {
  const k = uvEnCm ? 1 / t.tam : 1 / (t.tam * CM), j = t.junta && t.junta.mm > 0 ? t.junta : null;
  const clave = t.url + '|' + k + '|' + (j ? j.hex + j.mm : '');
  let x = cacheTex.get(clave);
  if (!x) {
    if (j) {
      // textura con junta: la pieza se dibuja un poco más pequeña sobre un fondo del color de la junta
      const cv = document.createElement('canvas'); cv.width = cv.height = 512;
      const cx = cv.getContext('2d'); cx.fillStyle = j.hex; cx.fillRect(0, 0, 512, 512);
      x = new THREE.CanvasTexture(cv);
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => { const m = Math.min(0.4, j.mm / 10 / t.tam) * 512 / 2; cx.drawImage(img, m, m, 512 - 2 * m, 512 - 2 * m); x.needsUpdate = true; try { window.dispatchEvent(new Event('visor3d-tex')); } catch { /* sin ventana */ } };
      img.src = t.url;
    } else x = new THREE.TextureLoader().load(t.url);
    x.wrapS = x.wrapT = THREE.RepeatWrapping; x.colorSpace = THREE.SRGBColorSpace; x.anisotropy = 4; x.repeat.set(k, k);
    cacheTex.set(clave, x);
  }
  return x;
}
// Aplica un color (#hex) o una textura ('tex:ID') a una malla; si no hay valor, vuelve a su color de origen
function pintar(mesh, valor, texturas, uvEnCm, repBox) {
  const u = mesh.userData;
  if (u.col0 === undefined) u.col0 = mesh.material.color.getHex();
  const t = valor && String(valor).startsWith('tex:') ? texturas.find(x => 'tex:' + x.id === valor) : null;
  if (t) {
    let mp = texturaDe(t, uvEnCm);
    if (repBox) { mp = mp.clone(); mp.needsUpdate = true; mp.repeat.set(Math.max(0.2, repBox[0] / t.tam), Math.max(0.2, repBox[1] / t.tam)); }
    mesh.material.map = mp; mesh.material.color.setHex(0xffffff);
  }
  else { mesh.material.map = null; mesh.material.color.setHex(valor && /^#/.test(valor) ? parseInt(valor.slice(1), 16) : u.col0); }
  if (mesh.material.emissive && !Array.isArray(mesh.material)) {
    if (esLed(valor)) { mesh.material.emissive.set(valor.slice(0, 7)); mesh.material.emissiveIntensity = 1.8; u.ledAplicado = true; }
    else if (u.ledAplicado) { mesh.material.emissive.setHex(0x000000); mesh.material.emissiveIntensity = 1; u.ledAplicado = false; }
  }
  mesh.material.needsUpdate = true;
}

function aplicarValorMat(m, val, texturas, o) {
  if (!val) return;
  const t = String(val).startsWith('tex:') ? texturas.find(x => 'tex:' + x.id === val) : null;
  if (t) { const mp = texturaDe(t, true).clone(); mp.needsUpdate = true; const r = Math.max(1, (o?.w || 100) / t.tam); mp.repeat.set(r, r); m.map = mp; m.color.setHex(0xffffff); }
  else if (/^#/.test(val)) { m.map = null; m.color.setHex(parseInt(val.slice(1), 16)); ledEm(m, val); }
  m.needsUpdate = true;
}
// Cada copia de un modelo tiene sus propios materiales para poder pintarla sin tocar las demás; cada parte (malla) se puede pintar por separado
function sobrescribirModelo(mm, o, texturas) {
  let n = 0;
  mm.traverse(x => {
    if (!x.isMesh) return;
    const clave = x.name || x.material?.name || ('parte' + (n++));
    x.userData.parte = clave;
    const arr = Array.isArray(x.material) ? x.material : [x.material], nuevos = arr.map(m0 => m0.clone());
    const val = (o.partes && o.partes[clave]) || (/^#/.test(o.color || '') || String(o.color || '').startsWith('tex:') ? o.color : null);
    nuevos.forEach(m => aplicarValorMat(m, val, texturas, o));
    x.material = Array.isArray(x.material) ? nuevos : nuevos[0];
  });
}

// ── Pintar una CARA: se parte de un triángulo y se crece por los vecinos mientras la superficie sea «suave» (el ángulo entre triángulos
// contiguos no pase del límite). Así se pinta solo el asiento de un sillón, una cara de un muro o una chapa de una máquina.
function regionTriangulos(geo, seed, angDeg) {
  const pos = geo.attributes.position, idx = geo.index, nTri = idx ? idx.count / 3 : pos.count / 3;
  if (seed == null || seed < 0 || seed >= nTri) return new Set();
  geo.userData = geo.userData || {};
  const cc = geo.userData.regCache || (geo.userData.regCache = {}), ck = seed + '|' + angDeg;
  if (cc[ck]) return cc[ck];
  if (angDeg >= 180) { const todos = new Set(); for (let t = 0; t < nTri; t++) todos.add(t); return (cc[ck] = todos); }
  let ad = geo.userData.adj;
  if (!ad) {
    const normales = new Array(nTri), borde = new Map(), vi = (t, k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k);
    const hash = i => Math.round(pos.getX(i) * 1e4) + ',' + Math.round(pos.getY(i) * 1e4) + ',' + Math.round(pos.getZ(i) * 1e4);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let t = 0; t < nTri; t++) {
      a.fromBufferAttribute(pos, vi(t, 0)); b.fromBufferAttribute(pos, vi(t, 1)); c.fromBufferAttribute(pos, vi(t, 2));
      normales[t] = new THREE.Vector3().subVectors(b, a).cross(c.clone().sub(a)).normalize();
      const hs = [hash(vi(t, 0)), hash(vi(t, 1)), hash(vi(t, 2))];
      for (let e = 0; e < 3; e++) { const k = [hs[e], hs[(e + 1) % 3]].sort().join('|'); if (!borde.has(k)) borde.set(k, []); borde.get(k).push(t); }
    }
    const vecinos = Array.from({ length: nTri }, () => []);
    borde.forEach(l => { for (let i = 0; i < l.length; i++) for (let j = 0; j < l.length; j++) if (i !== j) vecinos[l[i]].push(l[j]); });
    ad = geo.userData.adj = { normales, vecinos };
  }
  const lim = Math.cos((angDeg * Math.PI) / 180), visto = new Set([seed]), cola = [seed];
  while (cola.length) {
    const t = cola.pop();
    for (const n of ad.vecinos[t]) if (!visto.has(n) && ad.normales[n].dot(ad.normales[t]) >= lim && ad.normales[n].dot(ad.normales[seed]) > 0) { visto.add(n); cola.push(n); }
  }
  return (cc[ck] = visto);
}
function crearOverlay(mesh, tris, valor, texturas, uvEnCm) {
  const geo = mesh.geometry, pos = geo.attributes.position, uv = geo.attributes.uv, idx = geo.index; if (!tris.size) return null;
  const P = [], U = [], vi = (t, k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k);
  tris.forEach(t => { for (let k = 0; k < 3; k++) { const i = vi(t, k); P.push(pos.getX(i), pos.getY(i), pos.getZ(i)); if (uv) U.push(uv.getX(i), uv.getY(i)); } });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.6, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const t = String(valor).startsWith('tex:') ? texturas.find(x => 'tex:' + x.id === valor) : null;
  if (t) { const mp = texturaDe(t, uvEnCm).clone(); mp.needsUpdate = true; if (!uvEnCm) { const r = 1; mp.repeat.set(r, r); } m.map = mp; m.color.setHex(0xffffff); }
  else if (/^#/.test(valor)) { m.color.setHex(parseInt(valor.slice(1), 16)); ledEm(m, valor); }
  const o = new THREE.Mesh(g, m); o.userData.overlay = true; o.receiveShadow = true; return o;
}
function nombreParte(grupo, malla) {
  if (malla.userData.parte !== undefined) return malla.userData.parte;
  let n = 0, res = null;
  grupo.traverse(x => { if (!x.isMesh || x.userData.overlay || x.userData.hit || x.userData.parte !== undefined) return; if (x === malla) res = 'i' + n; n++; });
  return res;
}
function claveRegion(hit) {
  const x = hit.object; if (!x.isMesh || x.userData.overlay || x.userData.hit || hit.faceIndex == null) return null;
  const u = x.userData;
  if (u.muroId) return 'm:' + u.muroId + ':i0';
  let ge = x; while (ge && !ge.userData.equipo) ge = ge.parent;
  if (ge && u.parte !== undefined) return 'e:' + ge.userData.equipo.id + ':' + u.parte;
  if (u.salaKey || u.techoKey || u.pilarId || u.hueco || ge) return null;
  let g = x; while (g && !g.userData.oid) g = g.parent;
  if (!g || g.userData.tipoObj === 'zona') return null;
  const nombre = nombreParte(g, x); if (nombre == null) return null;
  return 'o:' + g.userData.oid + ':' + nombre;
}
function aplicarRegiones(raizObj, prefijo, regiones, texturas) {
  const creados = []; if (!regiones) return creados;
  let n = 0;
  raizObj.traverse(x => {
    if (!x.isMesh || x.userData.overlay || x.userData.hit) return;
    const nombre = x.userData.parte !== undefined ? x.userData.parte : ('i' + (n++)), lista = regiones[prefijo + nombre];
    if (!lista || !lista.length) return;
    lista.forEach(r => { const ov = crearOverlay(x, regionTriangulos(x.geometry, r.tri, r.ang || 25), r.valor, texturas, !!x.userData.muroId); if (ov) { x.add(ov); creados.push(ov); } });
  });
  return creados;
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
  ledEm(m, valor);
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
    const TIP = M.tirador || 'barra';
    const tmat = M.tiradorColor ? new THREE.MeshStandardMaterial({ color: color(M.tiradorColor, '#b8b8b8'), roughness: 0.3, metalness: 0.8 }) : tiradorMat;
    const oscuro = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.75 });
    // fcx, fcy = centro del frente; z0 = cara delantera; fw, fh = medidas del frente; vert = puerta (tirador vertical); lado = borde libre de la hoja (1 derecha, -1 izquierda)
    const tir = (padre, fcx, fcy, z0, fw, fh, vert, lado) => {
      if (TIP === 'ninguno' || TIP === 'push') return;
      const hx = vert ? fcx + lado * (fw / 2 - 0.04) : fcx, hy = vert ? fcy : fcy + fh * 0.3;
      if (TIP === 'barra') { if (vert) caja(0.012, 0.14, 0.014, hx, hy, z0 + 0.007, tmat, 'frente', padre); else caja(Math.min(0.16, fw * 0.5), 0.012, 0.014, hx, hy, z0 + 0.007, tmat, 'frente', padre); }
      else if (TIP === 'asa') {
        if (vert) { const L = 0.14; caja(0.01, L, 0.01, hx, hy, z0 + 0.03, tmat, 'frente', padre); caja(0.01, 0.012, 0.03, hx, hy + L / 2 - 0.006, z0 + 0.015, tmat, 'frente', padre); caja(0.01, 0.012, 0.03, hx, hy - L / 2 + 0.006, z0 + 0.015, tmat, 'frente', padre); }
        else { const L = Math.min(0.16, fw * 0.5); caja(L, 0.01, 0.01, hx, hy, z0 + 0.03, tmat, 'frente', padre); caja(0.012, 0.01, 0.03, hx - L / 2 + 0.006, hy, z0 + 0.015, tmat, 'frente', padre); caja(0.012, 0.01, 0.03, hx + L / 2 - 0.006, hy, z0 + 0.015, tmat, 'frente', padre); }
      } else if (TIP === 'pomo' || TIP === 'pomoplano') {
        const r = TIP === 'pomo' ? 0.015 : 0.02, h = TIP === 'pomo' ? 0.03 : 0.015, c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), tmat);
        c.rotation.x = Math.PI / 2; c.position.set(hx, vert ? hy + 0.12 * 0 : hy, z0 + h / 2); c.userData.zona = 'frente'; c.castShadow = true; padre.add(c);
        if (TIP === 'pomo') { const s = new THREE.Mesh(new THREE.SphereGeometry(0.019, 14, 10), tmat); s.position.set(hx, hy, z0 + h + 0.004); s.userData.zona = 'frente'; padre.add(s); }
      } else if (TIP === 'unero') {
        // fresado en el canto: puerta, en el borde libre; cajón, en el borde de arriba
        if (vert) caja(0.022, Math.min(0.3, fh * 0.45), 0.004, fcx + lado * (fw / 2 - 0.012), fcy, z0 + 0.0005, oscuro, 'frente', padre);
        else caja(Math.min(fw * 0.85, 0.45), 0.022, 0.004, fcx, fcy + fh / 2 - 0.013, z0 + 0.0005, oscuro, 'frente', padre);
      } else if (TIP === 'gola') {
        // perfil de gola: canal continuo en el canto de arriba del frente
        caja(fw - 0.004, 0.035, 0.005, fcx, fcy + fh / 2 - 0.0185, z0 + 0.0005, oscuro, 'frente', padre);
        caja(fw - 0.004, 0.004, 0.012, fcx, fcy + fh / 2 - 0.037, z0 - 0.004, tmat, 'frente', padre);
      }
    };
    if (mod.t === 'puertas') {
      const nd = mod.n === 2 ? 2 : 1, wd = (W - 0.004) / nd, ang = 100 * Math.PI / 180;
      for (let k = 0; k < nd; k++) {
        const izq = nd === 1 || k === 0; // bisagra a la izquierda (la hoja derecha, a la derecha)
        const bis = izq ? x + 0.002 + wd * k : x + 0.002 + wd * (k + 1);
        const pivote = new THREE.Group(); pivote.position.set(bis, y0 + hc / 2, zf);
        if (mod.abierto) pivote.rotation.y = izq ? -ang : ang;
        caja(wd - 0.003, hc - 0.004, ef, izq ? wd / 2 : -wd / 2, 0, 0, frente, 'frente', pivote);
        tir(pivote, izq ? wd / 2 : -wd / 2, 0, ef / 2, wd - 0.003, hc - 0.004, true, izq ? 1 : -1);
        g.add(pivote);
      }
    } else if (mod.t === 'cajones') {
      const nc = Math.max(1, mod.n || 3), hf = (hc - 0.004) / nc, saca = mod.abierto ? 0.28 : 0;
      for (let i = 0; i < nc; i++) {
        const yc = y0 + 0.002 + hf * i + hf / 2;
        caja(W - 0.004, hf - 0.003, ef, cx, yc, zf + (i === 0 ? saca : 0), frente, 'frente');
        tir(g, cx, yc, zf + ef / 2 + (i === 0 ? saca : 0), W - 0.004, hf - 0.003, false, 0);
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
  let frentes = 0, ancho = 0;
  (M.modulos || []).forEach(m => { if (m.t === 'puertas') { frentes += m.n === 2 ? 2 : 1; ancho += m.w; } if (m.t === 'cajones') { const nc = Math.max(1, m.n || 3); frentes += nc; ancho += m.w * nc; } });
  const T = M.tirador || 'barra', NOM = { barra: 'Tirador de barra', asa: 'Tirador de asa', pomo: 'Pomo', pomoplano: 'Pomo plano' };
  const extra = NOM[T] ? [[NOM[T] + ' (herraje)', frentes]] : T === 'gola' ? [['Perfil de gola, ml', Math.round(ancho) / 100]] : T === 'unero' ? [['Fresado de uñero (frentes)', frentes]] : T === 'push' ? [['Mecanismo push open (frentes)', frentes]] : [];
  return { filas: [...Object.entries(filas), ...extra.map(([k, n]) => [k, n])], area: Math.round(area * 100) / 100 };
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
// Materiales emisivos (LED): un color acabado en «!» brilla por sí mismo
const esLed = v => /^#[0-9a-fA-F]{6}!$/.test(v || '');
const ledEm = (m, v) => { if (esLed(v)) { m.emissive.set(v.slice(0, 7)); m.emissiveIntensity = 1.8; } };
// Color de un cuerpo negro a la temperatura K (aproximación habitual), para luces y LED. KGLOBAL.luces = temperatura única para todas las luces artificiales
const KGLOBAL = { luces: null };
function kelvinColor(K) {
  const t = Math.max(1000, Math.min(12000, K)) / 100, cl = v => Math.max(0, Math.min(255, v));
  const r = t <= 66 ? 255 : cl(329.698727446 * Math.pow(t - 60, -0.1332047592)), g = t <= 66 ? cl(99.4708025861 * Math.log(t) - 161.1195681661) : cl(288.1221695283 * Math.pow(t - 60, -0.0755148492)), b = t >= 66 ? 255 : (t <= 19 ? 0 : cl(138.5177312231 * Math.log(t - 10) - 305.0447927307));
  return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
}
const kelvinHex = K => '#' + kelvinColor(KGLOBAL.luces || K).getHexString();
RectAreaLightUniformsLib.init();
// Luz de área (la que usan las tiras LED y los paneles luminosos): mira hacia dir; u = eje largo de la tira (si va en horizontal o vertical)
function luzArea(g, pos, dir, w, h, col, inten, presup, u) {
  if (presup.n >= 24) return; presup.n++;
  const rl = new THREE.RectAreaLight(col, inten, Math.max(0.01, w), Math.max(0.01, h));
  rl.position.copy(pos);
  if (Math.abs(dir.y) > 0.5) rl.up.copy(u ? new THREE.Vector3().crossVectors(dir.clone().negate(), u) : new THREE.Vector3(0, 0, 1)); else rl.up.set(0, 1, 0);
  rl.lookAt(pos.clone().add(dir)); g.add(rl);
}
function luzLedObjeto(g, o, presup, amb) {
  if (!esLed(o.color) || o.tipo !== 'caja') return;
  const w = o.w * CM, d = o.d * CM, h = o.alto * CM, y0 = (o.z0 || 0) * CM, col = new THREE.Color(o.color.slice(0, 7));
  const cfg = { abajo: [[0, y0 - 0.002, 0], [0, -1, 0], w, d], arriba: [[0, y0 + h + 0.002, 0], [0, 1, 0], w, d], frente: [[0, y0 + h / 2, d / 2 + 0.002], [0, 0, 1], w, h], atras: [[0, y0 + h / 2, -d / 2 - 0.002], [0, 0, -1], w, h], izq: [[-w / 2 - 0.002, y0 + h / 2, 0], [-1, 0, 0], d, h], der: [[w / 2 + 0.002, y0 + h / 2, 0], [1, 0, 0], d, h] }[o.ledDir || 'abajo'];
  luzArea(g, new THREE.Vector3(...cfg[0]), new THREE.Vector3(...cfg[1]), cfg[2], cfg[3], col, 8 * amb, presup);
}
// Tira LED: cinta luminosa que sigue un recorrido y alumbra de verdad hacia donde se le indique
function construirLed(o, presup, amb, seleccionado) {
  const g = new THREE.Group(), pts = o.pts || [], L = o.led || { ancho: 1.2, k: 3000, lm: 800, dir: 'abajo' }; if (pts.length < 2) return g;
  const n = pts.length, m = L.cerrado ? n : n - 1, y = (o.z0 || 250) * CM, ancho = Math.max(0.3, L.ancho) * CM, hex = kelvinHex(L.k), col = new THREE.Color(hex);
  const mat = new THREE.MeshBasicMaterial({ color: seleccionado ? 0x9cc8ff : col });
  for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % n], largo = Math.hypot(b[0] - a[0], b[1] - a[1]) * CM; if (largo < 0.01) continue;
    const ux = (b[0] - a[0]) / (largo / CM), uy = (b[1] - a[1]) / (largo / CM), mid = new THREE.Vector3(((a[0] + b[0]) / 2) * CM, y, ((a[1] + b[1]) / 2) * CM);
    const tira = new THREE.Mesh(new THREE.BoxGeometry(largo, 0.008, ancho), mat); tira.position.copy(mid); tira.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]); g.add(tira);
    const u = new THREE.Vector3(ux, 0, uy), dir = { abajo: new THREE.Vector3(0, -1, 0), arriba: new THREE.Vector3(0, 1, 0), izq: new THREE.Vector3(-uy, 0, ux), der: new THREE.Vector3(uy, 0, -ux) }[L.dir || 'abajo'];
    luzArea(g, mid.clone().add(dir.clone().multiplyScalar(0.006)), dir, largo, Math.max(0.03, ancho * 3), col, Math.max(1, Math.min(40, (L.lm || 800) / 80)) * amb, presup, u);
  }
  return g;
}
// Luminarias del plano con forma (antes solo eran un punto): foco empotrado, plafón, colgante, aplique, lámpara de pie y empotrado de suelo
function construirLuminaria(kid, col, sel, variante, tilt, yaw) {
  const g = new THREE.Group(), glow = new THREE.MeshBasicMaterial({ color: sel ? 0x4da3ff : col }), cuerpo = new THREE.MeshStandardMaterial({ color: sel ? 0x9cc8ff : 0xf2f2f2, roughness: 0.5 });
  let luzPos = new THREE.Vector3(0, -0.02, 0);
  if (variante && (kid === 'foco' || kid === 'plaf')) {
    const tr = ((tilt ?? 25) * Math.PI) / 180, yr = ((yaw || 0) * Math.PI) / 180;
    const dir = new THREE.Vector3(Math.sin(tr) * Math.cos(yr), -Math.cos(tr), Math.sin(tr) * Math.sin(yr)).normalize();
    const cab = new THREE.Group(), proy = variante === 'proy';
    let largo = 0.1, r = 0.037;
    if (variante === 'gimbal') { const aro = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.012, 24), cuerpo); aro.position.y = -0.006; g.add(aro); cab.position.y = -0.012; largo = 0.045; r = 0.03; }
    else { const tallo = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.02), cuerpo); tallo.position.y = -0.025; g.add(tallo); cab.position.y = -0.05; if (proy) largo = 0.12; }
    cab.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    const cuerpoM = new THREE.Mesh(proy ? new THREE.BoxGeometry(0.07, largo, 0.07) : new THREE.CylinderGeometry(r, r, largo, 20), new THREE.MeshStandardMaterial({ color: sel ? 0x9cc8ff : 0x2a2a2a, roughness: 0.5, metalness: 0.4 }));
    cuerpoM.position.y = -largo / 2; cab.add(cuerpoM);
    const lente = new THREE.Mesh(new THREE.CircleGeometry(proy ? 0.03 : r * 0.85, 20), glow); lente.rotation.x = Math.PI / 2; lente.position.y = -largo - 0.001; cab.add(lente);
    g.add(cab);
    luzPos = cab.position.clone().add(dir.clone().multiplyScalar(largo));
    return { grupo: g, luzPos, dir };
  }
  if (kid === 'foco') { const aro = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.012, 24), cuerpo); aro.position.y = -0.006; const d = new THREE.Mesh(new THREE.CircleGeometry(0.036, 24), glow); d.rotation.x = Math.PI / 2; d.position.y = -0.0125; g.add(aro, d); }
  else if (kid === 'plaf') { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.07, 32), cuerpo); c.position.y = -0.035; const d = new THREE.Mesh(new THREE.CircleGeometry(0.15, 32), glow); d.rotation.x = Math.PI / 2; d.position.y = -0.0705; g.add(c, d); luzPos = new THREE.Vector3(0, -0.08, 0); }
  else if (kid === 'colg') { const cab = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.55, 6), cuerpo); cab.position.y = -0.275; const pant = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.16, 0.18, 24, 1, true), new THREE.MeshStandardMaterial({ color: sel ? 0x9cc8ff : 0xe8e2d8, roughness: 0.6, side: THREE.DoubleSide })); pant.position.y = -0.64; const b = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 12), glow); b.position.y = -0.66; g.add(cab, pant, b); luzPos = new THREE.Vector3(0, -0.68, 0); }
  else if (kid === 'aplq') { const c = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.06), cuerpo); const d = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.02), glow); d.position.z = 0.04; g.add(c, d); luzPos = new THREE.Vector3(0, 0, 0.1); }
  else if (kid === 'pie') { const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.0, 8), cuerpo); pole.position.y = -0.5; const base = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 24), cuerpo); base.position.y = -1.0; const pant = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.17, 0.22, 24, 1, true), new THREE.MeshStandardMaterial({ color: sel ? 0x9cc8ff : 0xe8e2d8, side: THREE.DoubleSide })); pant.position.y = 0.0; const b = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 12), glow); b.position.y = -0.02; g.add(pole, base, pant, b); luzPos = new THREE.Vector3(0, 0.05, 0); }
  else { const d = new THREE.Mesh(new THREE.CircleGeometry(0.06, 20), glow); d.rotation.x = -Math.PI / 2; d.position.y = 0.002; const aro = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.01, 20), cuerpo); aro.position.y = 0; g.add(aro, d); luzPos = new THREE.Vector3(0, 0.05, 0); }
  return { grupo: g, luzPos };
}
function cartel(texto) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const cx = cv.getContext('2d'); cx.fillStyle = 'rgba(0,0,0,0.78)'; cx.beginPath(); cx.roundRect ? cx.roundRect(4, 8, 248, 48, 12) : cx.rect(4, 8, 248, 48); cx.fill();
  cx.fillStyle = '#ffd34d'; cx.font = 'bold 34px sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(texto, 128, 33);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true }));
  sp.scale.set(0.5, 0.125, 1); sp.renderOrder = 1000; return sp;
}
// ── Panorama 360°: se renderiza el cubo completo desde un punto y se convierte a una imagen equirrectangular (la que entienden los visores 360)
export function capturarEquirect(renderer, scene, pos, yaw, tam, ocultar) {
  const tamPrev = renderer.getSize(new THREE.Vector2()), prPrev = renderer.getPixelRatio(), vis = ocultar.map(o => o && o.visible);
  ocultar.forEach(o => { if (o) o.visible = false; });
  const rt = new THREE.WebGLCubeRenderTarget(tam, { generateMipmaps: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter });
  const cc = new THREE.CubeCamera(0.05, 800, rt); cc.position.copy(pos); scene.add(cc); cc.update(renderer, scene); scene.remove(cc);
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: rt.texture }, yaw: { value: yaw } }, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform samplerCube map; uniform float yaw; varying vec2 vUv;\nvoid main() { float lon = (vUv.x - 0.5) * 6.2831853 + yaw; float lat = (vUv.y - 0.5) * 3.1415926; vec3 d = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon)); gl_FragColor = vec4(textureCube(map, vec3(-d.x, d.y, d.z)).rgb, 1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat), qs = new THREE.Scene(); qs.add(quad);
  renderer.setPixelRatio(1); renderer.setSize(tam * 2, tam, false); renderer.render(qs, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
  const url = renderer.domElement.toDataURL('image/jpeg', 0.92);
  renderer.setPixelRatio(prPrev); renderer.setSize(tamPrev.x, tamPrev.y);
  ocultar.forEach((o, i) => { if (o) o.visible = vis[i]; });
  rt.dispose(); mat.dispose(); quad.geometry.dispose();
  return url;
}
// Visor 360 sencillo: arrastrar para mirar alrededor, rueda para acercar (también con el dedo en el móvil)
export function abrirVisor360(cont, url) {
  const w = cont.clientWidth || 800, h = cont.clientHeight || 450;
  const r = new THREE.WebGLRenderer({ antialias: true }); r.setSize(w, h); r.setPixelRatio(Math.min(window.devicePixelRatio, 2)); cont.appendChild(r.domElement);
  const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(75, w / h, 0.1, 1100);
  const tex = new THREE.TextureLoader().load(url); tex.colorSpace = THREE.SRGBColorSpace;
  const g = new THREE.SphereGeometry(500, 64, 40); g.scale(-1, 1, 1);
  sc.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex })));
  let lon = Math.PI, lat = 0, drag = null, vivo = true;
  const mira = () => { cam.lookAt(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)); };
  const dn = e => { drag = [e.clientX, e.clientY]; }, mv = e => { if (!drag) return; lon -= (e.clientX - drag[0]) * 0.2 * (Math.PI / 180) * (cam.fov / 75); lat = Math.max(-1.45, Math.min(1.45, lat + (e.clientY - drag[1]) * 0.2 * (Math.PI / 180) * (cam.fov / 75))); drag = [e.clientX, e.clientY]; };
  const up = () => { drag = null; }, wh = e => { e.preventDefault(); cam.fov = Math.max(25, Math.min(100, cam.fov + e.deltaY * 0.05)); cam.updateProjectionMatrix(); };
  r.domElement.style.touchAction = 'none'; r.domElement.addEventListener('pointerdown', dn); window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); r.domElement.addEventListener('wheel', wh, { passive: false });
  const bucle = () => { if (!vivo) return; requestAnimationFrame(bucle); mira(); r.render(sc, cam); }; bucle();
  const ajusta = () => { const W = cont.clientWidth, H = cont.clientHeight; if (W && H) { r.setSize(W, H); cam.aspect = W / H; cam.updateProjectionMatrix(); } };
  window.addEventListener('resize', ajusta);
  return () => { vivo = false; window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('resize', ajusta); r.dispose(); tex.dispose(); g.dispose(); if (r.domElement.parentNode) r.domElement.parentNode.removeChild(r.domElement); };
}

// ── Alzados y plantas de detalle: vista casi ortogonal de una parte (un muro, un suelo o un techo) con cotas automáticas
const cm0 = v => String(Math.round(v * 100));
export function construirAlzadoMuro(mu, lado, hCm, zonas) {
  const g = new THREE.Group(), L = Math.hypot(mu.b[0] - mu.a[0], mu.b[1] - mu.a[1]) * CM, H = hCm * CM, t = (mu.t || 12) * CM, z = lado * (t / 2 + 0.03), k = Math.max(0.6, Math.max(L, H) / 6);
  g.position.set(mu.a[0] * CM, 0, mu.a[1] * CM); g.rotation.y = -Math.atan2(mu.b[1] - mu.a[1], mu.b[0] - mu.a[0]);
  const lineMat = new THREE.LineBasicMaterial({ color: 0x111111, depthTest: false }), cotaMat = new THREE.LineBasicMaterial({ color: 0x0b3d91, depthTest: false }), rej = new THREE.LineBasicMaterial({ color: 0xd2d2d2, depthTest: false });
  const linea = (pts, mat) => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p[0], p[1], z))), mat); l.renderOrder = 997; g.add(l); };
  const txt = (s, x, y) => { if (!s) return; const sp = cartel(s); sp.scale.multiplyScalar(k); sp.position.set(x, y, z + lado * 0.02); g.add(sp); };
  const dimH = (x0, x1, y, s) => { linea([[x0, y], [x1, y]], cotaMat); linea([[x0, y - 0.06 * k], [x0, y + 0.06 * k]], cotaMat); linea([[x1, y - 0.06 * k], [x1, y + 0.06 * k]], cotaMat); txt(s, (x0 + x1) / 2, y + 0.13 * k); };
  const dimV = (y0, y1, x, s) => { linea([[x, y0], [x, y1]], cotaMat); linea([[x - 0.06 * k, y0], [x + 0.06 * k, y0]], cotaMat); linea([[x - 0.06 * k, y1], [x + 0.06 * k, y1]], cotaMat); txt(s, x - 0.3 * k, (y0 + y1) / 2); };
  for (let x = 0; x <= L + 1e-6; x += 0.5) linea([[x, 0], [x, H]], rej);
  for (let y = 0; y <= H + 1e-6; y += 0.5) linea([[0, y], [L, y]], rej);
  linea([[0, 0], [L, 0], [L, H], [0, H], [0, 0]], lineMat);
  dimH(0, L, H + 0.3 * k, cm0(L) + ' cm'); dimV(0, H, -0.3 * k, cm0(H));
  (mu.ab || []).forEach((o, i) => {
    const x0 = o.p * CM, x1 = (o.p + o.w) * CM, y0 = (o.sill || 0) * CM, y1 = y0 + o.h * CM, base = -(0.25 + 0.27 * i) * k;
    linea([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]], lineMat);
    txt(cm0(x1 - x0) + ' × ' + cm0(y1 - y0), (x0 + x1) / 2, (y0 + y1) / 2);
    dimH(0, x0, base, cm0(x0)); dimH(x0, x1, base, cm0(x1 - x0)); dimH(x1, L, base, cm0(L - x1));
    if (y0 > 0.005) dimV(0, y0, x1 + 0.18 * k, cm0(y0));
    dimV(y0, y1, x1 + 0.18 * k + (y0 > 0.005 ? 0 : 0), '');
  });
  zonas.forEach(zn => {
    const xs = zn.pts.map(p => p[0] * CM), ys = zn.pts.map(p => p[1] * CM), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    linea([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]], cotaMat); txt(cm0(x1 - x0) + ' × ' + cm0(y1 - y0), (x0 + x1) / 2, (y0 + y1) / 2);
    dimH(x0, x1, y0 - 0.12 * k, ''); dimV(0, y0, x0 - 0.12 * k, cm0(y0));
  });
  return g;
}
export function construirAlzadoPlanta(sala, yMundo, zonas) {
  const g = new THREE.Group(), pts = sala.pts || [], xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys), k = Math.max(0.6, Math.max(bx1 - bx0, by1 - by0) * CM / 6);
  const lineMat = new THREE.LineBasicMaterial({ color: 0x111111, depthTest: false }), cotaMat = new THREE.LineBasicMaterial({ color: 0x0b3d91, depthTest: false }), rej = new THREE.LineBasicMaterial({ color: 0xd2d2d2, depthTest: false });
  const V = (x, y) => new THREE.Vector3(x * CM, yMundo, y * CM);
  const linea = (arr, mat) => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(arr.map(p => V(p[0], p[1]))), mat); l.renderOrder = 997; g.add(l); };
  const txt = (s, x, y) => { if (!s) return; const sp = cartel(s); sp.scale.multiplyScalar(k); sp.position.copy(V(x, y)); g.add(sp); };
  for (let x = Math.ceil(bx0 / 50) * 50; x <= bx1; x += 50) linea([[x, by0], [x, by1]], rej);
  for (let y = Math.ceil(by0 / 50) * 50; y <= by1; y += 50) linea([[bx0, y], [bx1, y]], rej);
  linea([...pts, pts[0]], lineMat);
  const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (L < 5) return;
    const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2; let nx = -(q[1] - p[1]) / L, ny = (q[0] - p[0]) / L;
    if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; }
    const off = 40 * k;
    linea([[p[0] + nx * off, p[1] + ny * off], [q[0] + nx * off, q[1] + ny * off]], cotaMat);
    txt(String(Math.round(L)), mx + nx * off * 1.7, my + ny * off * 1.7);
  });
  const area = Math.abs(pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0) / 2) / 1e4;
  txt(area.toFixed(2).replace('.', ',') + ' m²', cx, cy);
  zonas.forEach(zn => {
    const zx = zn.pts.map(p => p[0] + zn.cx), zy = zn.pts.map(p => p[1] + zn.cy), x0 = Math.min(...zx), x1 = Math.max(...zx), y0 = Math.min(...zy), y1 = Math.max(...zy);
    linea([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]], cotaMat); txt(String(Math.round(x1 - x0)) + ' × ' + Math.round(y1 - y0), (x0 + x1) / 2, (y0 + y1) / 2);
  });
  return g;
}

// Menú desplegable del carril de herramientas: se coloca con position fixed junto al botón (sin recortes) y se sube si no cabe por abajo
export function MenuRail({ abierto, boton, ancho, children }) {
  const ref = useRef(null), mref = useRef(null), [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    if (!abierto || !ref.current) { setPos(null); return; }
    const r = ref.current.getBoundingClientRect(), h = mref.current ? mref.current.offsetHeight : 320;
    setPos({ left: r.right + 6, top: Math.max(54, Math.min(r.top, window.innerHeight - h - 8)) });
  }, [abierto]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {boton}
      {abierto && <div ref={mref} style={{ position: 'fixed', left: pos ? pos.left : -9999, top: pos ? pos.top : 0, background: 'rgba(20,20,20,0.98)', borderRadius: 10, padding: 6, zIndex: 20, width: ancho || 240, maxHeight: 'calc(100vh - 62px)', overflowY: 'auto', color: '#fff', fontSize: 13, boxShadow: '0 6px 24px rgba(0,0,0,0.45)' }}>{children}</div>}
    </div>
  );
}

// ── Puertas, ventanas y portones por tipo (los que usa Planos): hoja o cristal en su sitio y con la apertura que se quiera ver
const DOOR_TIPS = ['Abatible', 'Doble hoja', 'Corredera', 'Corredera 2 hojas', 'Corredera empotrada', 'Plegable', 'Hueco', 'Seccional', 'Basculante', 'Enrollable'];
const WIN_TIPS = ['Practicable', 'Doble hoja', 'Oscilobatiente', 'Corredera', 'Fija'];
const DOOR_MATS = ['Madera maciza', 'Vidrio templado', 'Chapa lacada', 'Panel sándwich', 'Lama de aluminio'];
export function construirHoja(o, mu, cfg, valHoja, texturas) {
  const g = new THREE.Group(), esPuerta = (o.tipo || o.t) === 'door', tip = String(o.tip || (esPuerta ? 'Abatible' : 'Practicable')).toLowerCase(), mat = String(o.mat || '');
  const t = (mu.t || 12) * CM, fr = 0.05, x0 = o.p * CM, x1 = (o.p + o.w) * CM, y0 = (o.sill || 0) * CM, y1 = y0 + o.h * CM;
  const ix0 = x0 + fr, ix1 = x1 - fr, iy0 = esPuerta ? y0 : y0 + fr, iy1 = y1 - fr, iw = ix1 - ix0, ih = iy1 - iy0, cx = (ix0 + ix1) / 2, cy = (iy0 + iy1) / 2;
  const vidrio = !esPuerta || /vidrio|cristal/i.test(mat), metal = /chapa|panel|lama|alum|metal/i.test(mat) || /seccional|basculante|enrollable/.test(tip);
  const hojaM = new THREE.MeshStandardMaterial({ color: metal ? 0x9aa0a6 : esPuerta ? 0xc9a77c : 0xf2f2f2, roughness: metal ? 0.45 : 0.6, metalness: metal ? 0.5 : 0 });
  aplicarValorMat(hojaM, valHoja, texturas, o);
  const vidM = new THREE.MeshStandardMaterial({ color: 0xaed4ea, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
  const manM = new THREE.MeshStandardMaterial({ color: 0xb8b8b8, roughness: 0.3, metalness: 0.8 });
  const info = { muroId: mu.id, id: o.id || null, p: o.p, w: o.w, h: o.h, sill: o.sill || 0, tipo: o.tipo || o.t, tip: o.tip, mat: o.mat };
  const pieza = (padre, bw, bh, bd, px, py, pz, m, zona) => { const b = new THREE.Mesh(new THREE.BoxGeometry(Math.max(bw, 0.002), Math.max(bh, 0.002), Math.max(bd, 0.002)), m); b.position.set(px, py, pz); b.castShadow = true; b.userData = { capa: 'huecos', hueco: info, zona }; padre.add(b); return b; };
  const sgn = cfg.sentido === 'B' ? -1 : 1, abierta = Math.max(0, Math.min(110, cfg.abierta || 0)), ang = (abierta * Math.PI) / 180, pct = Math.min(1, abierta / 100), izq = cfg.bisagra !== 'der';
  const hy = esPuerta ? Math.min(iy1 - 0.1, y0 + 1.0) : cy;
  // hoja con cristal: marco fino + cristal (ventanas y puertas de vidrio)
  const panelVidrio = (padre, w0, px, pz) => {
    pieza(padre, w0, 0.04, 0.045, px, iy1 - 0.02, pz, hojaM, 'hoja'); pieza(padre, w0, 0.04, 0.045, px, iy0 + 0.02, pz, hojaM, 'hoja');
    pieza(padre, 0.04, ih, 0.045, px - w0 / 2 + 0.02, cy, pz, hojaM, 'hoja'); pieza(padre, 0.04, ih, 0.045, px + w0 / 2 - 0.02, cy, pz, hojaM, 'hoja');
    pieza(padre, w0 - 0.08, ih - 0.08, 0.01, px, cy, pz, vidM, 'cristal');
  };
  const panelSolido = (padre, w0, px, pz, grosor = 0.04) => pieza(padre, w0 - 0.004, ih - 0.004, grosor, px, cy, pz, hojaM, 'hoja');
  const giratoria = (w0, centro, bisIzq) => {
    const pivot = new THREE.Group(); pivot.position.set(bisIzq ? centro - w0 / 2 : centro + w0 / 2, 0, 0); pivot.rotation.y = (bisIzq ? -ang : ang) * sgn;
    const off = bisIzq ? w0 / 2 : -w0 / 2;
    if (vidrio) panelVidrio(pivot, w0, off, 0); else panelSolido(pivot, w0, off, 0);
    if (!(tip === 'fija')) pieza(pivot, 0.012, 0.12, 0.03, bisIzq ? w0 - 0.06 : -w0 + 0.06, hy, 0.03, manM, 'hoja');
    g.add(pivot);
  };
  if (esPuerta) {
    if (tip === 'hueco') return g;
    if (tip.includes('corredera empotrada')) { const m1 = new THREE.Group(); m1.position.x = (izq ? 1 : -1) * pct * (iw + 0.04); if (vidrio) panelVidrio(m1, iw, cx, 0); else panelSolido(m1, iw, cx, 0); g.add(m1); return g; }
    if (tip.includes('corredera 2')) {
      const A = new THREE.Group(), B = new THREE.Group(); A.position.x = pct * (iw / 2); B.position.x = -pct * (iw / 2) * 0;
      const zA = sgn * (t / 2 + 0.03), zB = sgn * (t / 2 + 0.07);
      if (vidrio) { panelVidrio(A, iw / 2 + 0.03, ix0 + iw / 4, zA); panelVidrio(B, iw / 2 + 0.03, ix0 + (3 * iw) / 4, zB); } else { panelSolido(A, iw / 2 + 0.03, ix0 + iw / 4, zA); panelSolido(B, iw / 2 + 0.03, ix0 + (3 * iw) / 4, zB); }
      pieza(g, iw * 1.1, 0.03, 0.1, cx, iy1 + 0.035, sgn * (t / 2 + 0.05), manM, 'hoja'); g.add(A, B); return g;
    }
    if (tip.includes('corredera')) {
      const m1 = new THREE.Group(), z = sgn * (t / 2 + 0.03); m1.position.x = (izq ? 1 : -1) * pct * (iw + 0.04);
      if (vidrio) panelVidrio(m1, iw + 0.04, cx, z); else panelSolido(m1, iw + 0.04, cx, z);
      pieza(g, iw * 2 + 0.2, 0.03, 0.05, izq ? cx + iw / 2 : cx - iw / 2, iy1 + 0.035, z, manM, 'hoja'); g.add(m1); return g;
    }
    if (tip.includes('plegable')) {
      const n = 4, pw = iw / n, a = pct * 1.2; let x = ix0;
      for (let i = 0; i < n; i++) { const w1 = pw * Math.cos(a), m1 = pieza(g, pw - 0.004, ih - 0.004, 0.03, x + w1 / 2, cy, 0, hojaM, 'hoja'); m1.rotation.y = (i % 2 ? a : -a) * sgn; x += w1; }
      return g;
    }
    if (tip.includes('seccional')) {
      const n = 5, sh = ih / n; for (let i = 0; i < n; i++) pieza(g, iw - 0.004, sh - 0.012, 0.045, cx, iy0 + sh * (i + 0.5) + pct * ih, 0, hojaM, 'hoja');
      return g;
    }
    if (tip.includes('enrollable')) {
      const n = 26, sh = ih / n, vis = Math.ceil(n * (1 - pct)); for (let i = 0; i < vis; i++) pieza(g, iw - 0.004, sh - 0.004, 0.03, cx, iy1 - sh * (i + 0.5), 0, hojaM, 'hoja');
      pieza(g, iw + 0.04, 0.14, 0.16, cx, iy1 + 0.06, sgn * (t / 2 + 0.02), hojaM, 'hoja'); return g;
    }
    if (tip.includes('basculante')) {
      const pivot = new THREE.Group(); pivot.position.set(0, iy1, 0); pivot.rotation.x = pct * 1.45 * sgn; pivot.userData = {};
      pieza(pivot, iw - 0.004, ih - 0.004, 0.045, cx, -ih / 2, 0, hojaM, 'hoja'); g.add(pivot); return g;
    }
    if (tip.includes('doble')) { giratoria(iw / 2, ix0 + iw / 4, true); giratoria(iw / 2, ix0 + (3 * iw) / 4, false); return g; }
    giratoria(iw, cx, izq); return g;
  }
  // ventanas
  if (tip === 'fija') { pieza(g, iw, ih, 0.01, cx, cy, 0, vidM, 'cristal'); return g; }
  if (tip.includes('corredera')) {
    const A = new THREE.Group(); A.position.x = pct * (iw / 2);
    panelVidrio(A, iw / 2 + 0.03, ix0 + iw / 4, sgn * 0.02); panelVidrio(g, iw / 2 + 0.03, ix0 + (3 * iw) / 4, sgn * -0.02); g.add(A); return g;
  }
  if (tip.includes('doble')) { giratoria(iw / 2, ix0 + iw / 4, true); giratoria(iw / 2, ix0 + (3 * iw) / 4, false); return g; }
  giratoria(iw, cx, izq); return g;
}

// ── Carriles de iluminación (magnético o trifásico) con focos que se añaden donde se quiera
const TIPOS_FOCO = { spot: 'Spot (cilindro)', spotmini: 'Spot magnético mini', proyector: 'Proyector orientable', lineal: 'Lineal', colgante: 'Colgante' };
const FOCO_DEF = { spot: { lm: 800, ap: 36 }, spotmini: { lm: 400, ap: 30 }, proyector: { lm: 1500, ap: 24 }, lineal: { lm: 1800, ap: 110, largo: 60 }, colgante: { lm: 600, ap: 120 } };
function largoCamino(pts) { let L = 0; for (let i = 0; i < pts.length - 1; i++) L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); return L; }
function puntoEnCamino(pts, s) {
  let resto = Math.max(0, s);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    if (resto <= L || i === pts.length - 2) { const t = Math.min(1, resto / L); return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, ux: (b[0] - a[0]) / L, uy: (b[1] - a[1]) / L }; }
    resto -= L;
  }
  return null;
}
function proyectarEnCamino(pts, px, py) {
  let mejor = 0, dmin = Infinity, acum = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1, L = Math.sqrt(L2);
    const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / L2)), d = Math.hypot(px - (a[0] + dx * t), py - (a[1] + dy * t));
    if (d < dmin) { dmin = d; mejor = acum + t * L; }
    acum += L;
  }
  return mejor;
}
const colorK = K => kelvinColor(KGLOBAL.luces || K);
function construirCarril(o, presup, amb, seleccionado) {
  const g = new THREE.Group(), pts = o.pts || []; if (pts.length < 2) return g;
  const col = color(/^#/.test(o.color || '') ? o.color : null, '#111111');
  const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.5, metalness: 0.3, emissive: seleccionado ? 0x335577 : 0x000000 });
  const ancho = o.sistema === 'trifasico' ? 0.035 : 0.032, alto = o.sistema === 'trifasico' ? 0.03 : 0.025, y = (o.z0 || 250) * CM;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) * CM; if (L < 0.01) continue;
    const m = new THREE.Mesh(new THREE.BoxGeometry(L, alto, ancho), mat);
    m.position.set(((a[0] + b[0]) / 2) * CM, y - alto / 2, ((a[1] + b[1]) / 2) * CM); m.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]); m.castShadow = true; g.add(m);
  }
  if (o.suspendido) [pts[0], pts[pts.length - 1]].forEach(p => { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.4, 6), mat); c.position.set(p[0] * CM, y + 0.2, p[1] * CM); g.add(c); });
  const luz = (cd, ap, pos, dir, K) => {
    if (presup.n >= 24) return; presup.n++;
    const s = new THREE.SpotLight(colorK(K), cd * amb, 0, Math.max(0.1, (ap / 2) * Math.PI / 180), 0.45, 2);
    s.position.copy(pos); s.target.position.copy(pos.clone().add(dir.clone().multiplyScalar(2.5))); g.add(s); g.add(s.target);
  };
  (o.focos || []).forEach(f => {
    const P = puntoEnCamino(pts, f.s || 0); if (!P) return;
    const px = P.x * CM, pz = P.y * CM, yy = y - alto, K = f.k || 3000, lm = f.lm ?? 800, cd = (lm / 12.57) * 0.5 * 4;
    const tiltR = ((f.tilt ?? 20) * Math.PI) / 180, yawR = ((f.yaw || 0) * Math.PI) / 180;
    const dir = new THREE.Vector3(Math.sin(tiltR) * Math.cos(yawR), -Math.cos(tiltR), Math.sin(tiltR) * Math.sin(yawR)).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    const glow = new THREE.MeshBasicMaterial({ color: colorK(K) });
    if (f.t === 'spot' || f.t === 'spotmini' || f.t === 'proyector') {
      const mini = f.t === 'spotmini', largo = mini ? 0.05 : f.t === 'proyector' ? 0.11 : 0.09, r = mini ? 0.02 : 0.034;
      const tallo = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.02), mat); tallo.position.set(px, yy - 0.01, pz); g.add(tallo);
      const cab = new THREE.Group(); cab.position.set(px, yy - 0.025, pz); cab.quaternion.copy(q);
      const cuerpo = new THREE.Mesh(f.t === 'proyector' ? new THREE.BoxGeometry(0.07, largo, 0.07) : new THREE.CylinderGeometry(r, r, largo, 20), mat); cuerpo.position.y = -largo / 2; cuerpo.castShadow = true; cab.add(cuerpo);
      const lente = new THREE.Mesh(new THREE.CircleGeometry(r * 0.85, 20), glow); lente.rotation.x = Math.PI / 2; lente.position.y = -largo - 0.001; cab.add(lente);
      if (f.t === 'proyector') { const vis = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.004, 0.05), mat); vis.position.set(0, -largo, 0.045); cab.add(vis); }
      g.add(cab);
      luz(cd, f.ap || 36, new THREE.Vector3(px, yy - 0.025, pz).add(dir.clone().multiplyScalar(largo)), dir, K);
    } else if (f.t === 'lineal') {
      const len = (f.largo || 60) * CM, barra = new THREE.Mesh(new THREE.BoxGeometry(len, 0.03, 0.03), mat);
      barra.position.set(px, yy - 0.06, pz); barra.rotation.y = -yawR; barra.castShadow = true; g.add(barra);
      const tubo = new THREE.Mesh(new THREE.BoxGeometry(len * 0.96, 0.006, 0.022), glow); tubo.position.set(px, yy - 0.077, pz); tubo.rotation.y = -yawR; g.add(tubo);
      const colg = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.04, 0.008), mat); colg.position.set(px, yy - 0.02, pz); g.add(colg);
      luz(cd * 0.8, f.ap || 110, new THREE.Vector3(px, yy - 0.08, pz), new THREE.Vector3(0, -1, 0), K);
    } else if (f.t === 'colgante') {
      const cab = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.35, 6), mat); cab.position.set(px, yy - 0.175, pz); g.add(cab);
      const pant = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.13, 0.15, 24, 1, true), new THREE.MeshStandardMaterial({ color: col, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide })); pant.position.set(px, yy - 0.425, pz); pant.castShadow = true; g.add(pant);
      const bulbo = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 12), glow); bulbo.position.set(px, yy - 0.47, pz); g.add(bulbo);
      if (presup.n < 24) { presup.n++; const p = new THREE.PointLight(colorK(K), (lm / 12.57) * 0.5 * amb, 0, 2); p.position.set(px, yy - 0.48, pz); g.add(p); }
    }
  });
  return g;
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
// Puntos de un rectángulo u óvalo a partir de dos esquinas opuestas
function puntosForma(forma, x0, y0, x1, y1) {
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
  if (forma === 'oval') { const cx = (ax + bx) / 2, cy = (ay + by) / 2, rx = (bx - ax) / 2, ry = (by - ay) / 2; return Array.from({ length: 48 }, (_, i) => [cx + rx * Math.cos((i / 48) * 2 * Math.PI), cy + ry * Math.sin((i / 48) * 2 * Math.PI)]); }
  return [[ax, ay], [bx, ay], [bx, by], [ax, by]];
}
// Curva cerrada suave que pasa por los puntos (para contornos curvos)
function suavizar(pts) {
  if (pts.length < 3) return pts;
  const c = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], 0, p[1])), true, 'centripetal');
  return c.getPoints(Math.max(24, pts.length * 12)).slice(0, -1).map(v => [v.x, v.z]);
}
function color(hex, def) {
  try { return new THREE.Color(String(hex || def).replace(/!$/, '')); } catch { return new THREE.Color(def); }
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
    const parte = (bw, bh, bd, px, py, mat, extra) => { const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat); b.position.set(px, py, 0); b.castShadow = true; b.userData = { capa: 'huecos', hueco: { muroId: m.id, id: o.id || null, p: o.p, w: o.w, h: o.h, sill: o.sill || 0, tipo: o.tipo || o.t, tip: o.tip, mat: o.mat }, zona: mat === marco ? 'marco' : (mat.transparent ? 'cristal' : 'hoja'), ...(extra || {}) }; mesh.add(b); return b; };
    parte(w, fr, tt * 1.02, cx, y1 * CM - fr / 2, marco); parte(w, fr, tt * 1.02, cx, y0 * CM + fr / 2, marco);
    parte(fr, h, tt * 1.02, x0 * CM + fr / 2, cy, marco); parte(fr, h, tt * 1.02, x1 * CM - fr / 2, cy, marco);
    // la hoja o el cristal se construyen aparte (según el tipo: abatible, corredera, plegable…)
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
    x.position.set(p.cx * CM, h / 2, p.cy * CM); x.castShadow = x.receiveShadow = true; x.userData.capa = 'pilares'; x.userData.pilarId = p.id; g.add(x);
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
  const [acab, setAcab] = useState({ muros: {}, salas: {}, techos: {}, equipos: {}, pilares: {}, huecos: {}, regiones: {}, todosMuros: null, todosSuelos: null, todosTechos: null, todosPilares: null });
  const [texturas, setTexturas] = useState([]);
  const [b3dAbierta, setB3dAbierta] = useState(false);
  const [b3d, setB3d] = useState(null);           // índice de la biblioteca 3D gratuita
  const [b3dTab, setB3dTab] = useState('modelos');
  const [b3dFiltro, setB3dFiltro] = useState('');
  const [b3dCat, setB3dCat] = useState('');
  const [selHueco, setSelHueco] = useState(null); // hueco del plano seleccionado, con sus medidas nuevas
  const [eqNuevo, setEqNuevo] = useState(null);     // medidas nuevas del equipo del plano seleccionado
  const [aviso, setAviso] = useState('');
  const [hora, setHora] = useState(15);                       // hora del sol (6–21)
  const [ambiente, setAmbiente] = useState(() => { try { return { exposicion: 1, luces: 1, ...JSON.parse(localStorage.getItem('visor3dAmb') || '{}') }; } catch { return { exposicion: 1, luces: 1 }; } });
  const [ambAbierto, setAmbAbierto] = useState(false);
  const [imanActivo, setImanActivo] = useState(true);      // imán a paredes, vértices y guías
  const [gridCm, setGridCm] = useState(5);                    // salto de la rejilla al dibujar
  const [formaDib, setFormaDib] = useState('poli');           // poli | rect | oval
  const imanRef = useRef(true), gridRef = useRef(5), formaRef = useRef('poli');
  useEffect(() => { imanRef.current = imanActivo; }, [imanActivo]);
  useEffect(() => { gridRef.current = gridCm; }, [gridCm]);
  useEffect(() => { formaRef.current = formaDib; }, [formaDib]);
  const [alz, setAlz] = useState(null);                  // detalle abierto: { tipo: 'muro' | 'suelo' | 'techo', id, lado }
  const [profAlz, setProfAlz] = useState(120);
  const [zForm, setZForm] = useState({ x: 0, y: 90, w: 100, h: 100, forma: 'rect' });
  const [railCols, setRailCols] = useState(() => (typeof window !== 'undefined' && window.innerHeight < 700 ? 2 : 1));
  useEffect(() => { const f = () => setRailCols(window.innerHeight < 700 ? 2 : 1); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  const railW = railCols * 56 + 10;
  const [camAbierta, setCamAbierta] = useState(false);
  const [camInfo, setCamInfo] = useState(null);
  const [shiftY, setShiftY] = useState(0);
  const [mantenerNivel, setMantenerNivel] = useState(true);
  KGLOBAL.luces = ambiente.kLuces || null;
  const [ayudaAbierta, setAyudaAbierta] = useState(false);
  const [kindFoco, setKindFoco] = useState('spot');
  const kindFocoRef = useRef('spot');
  useEffect(() => { kindFocoRef.current = kindFoco; }, [kindFoco]);
  const [carrilSis, setCarrilSis] = useState('magnetico');
  const carrilSisRef = useRef('magnetico');
  useEffect(() => { carrilSisRef.current = carrilSis; }, [carrilSis]);
  const [carrilMenu, setCarrilMenu] = useState(false);
  const histRef = useRef({ past: [], future: [] });
  const prevSnapRef = useRef(null);
  const saltoRef = useRef(false);
  const ultimoCambioRef = useRef(0);
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
  const acabRef = useRef(null);
  const rodapieRef = useRef({});
  const [huecosCfg, setHuecosCfg] = useState({});          // apertura, bisagra y sentido de cada puerta y ventana (solo 3D)
  const [tapetas, setTapetas] = useState({});              // tapetas de puertas y ventanas, por hueco
  const [escenas, setEscenas] = useState([]);              // escenas guardadas: vista + capas + hora + textos de IA
  const [escAbierta, setEscAbierta] = useState(false);
  const [escNombre, setEscNombre] = useState('');
  const [lote, setLote] = useState(null);
  const panPrev = useRef({});
  const derPrev = useRef({});
  const [renders, setRenders] = useState([]);           // galería de renders y panoramas del plano
  const [galAbierta, setGalAbierta] = useState(false);
  const [pano, setPano] = useState(null);                  // { url, guardado, meta } visor 360 abierto
  const [generando360, setGenerando360] = useState(false);
  const panoCont = useRef(null);
  const [verRender, setVerRender] = useState(null);       // render de la galería ampliado
  const [modoPincel, setModoPincel] = useState('cara');   // cara | pieza | todo
  const [angCara, setAngCara] = useState(25);
  const modoPincelRef = useRef('cara');
  const angCaraRef = useRef(25);
  useEffect(() => { modoPincelRef.current = modoPincel; }, [modoPincel]);
  useEffect(() => { angCaraRef.current = angCara; }, [angCara]);
  const [medAbierta, setMedAbierta] = useState(false);
  const [medFilas, setMedFilas] = useState(null);
  const [refObj, setRefObj] = useState('');
  const [refEje, setRefEje] = useState('x');
  const [refGap, setRefGap] = useState(0);
  const [matrizN, setMatrizN] = useState(3);
  const [matrizDx, setMatrizDx] = useState(100);
  const [matrizDy, setMatrizDy] = useState(0);
  useEffect(() => { acabRef.current = acab; }, [acab]);
  useEffect(() => { rodapieRef.current = rodapie; }, [rodapie]);
  useEffect(() => { const f = () => setTexturas(t => [...t]); window.addEventListener('visor3d-tex', f); return () => window.removeEventListener('visor3d-tex', f); }, []);
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
    {
      const orig = cam.updateProjectionMatrix.bind(cam);
      cam.updateProjectionMatrix = () => { orig(); const s = api3d.current.shiftY || 0; if (s) { cam.projectionMatrix.elements[9] += 2 * s; cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert(); } };
    }
    const ctrl = new OrbitControls(cam, renderer.domElement);
    ctrl.enableDamping = true;
    const hemi = new THREE.HemisphereLight(0xffffff, 0xcfc8bf, 1.1);
    scene.add(hemi);
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
    const teclas = new Set(); let ultimoT = performance.now();
    const vF = new THREE.Vector3(), vR = new THREE.Vector3(), vM = new THREE.Vector3(), ARRIBA = new THREE.Vector3(0, 1, 0);
    const bucle = () => {
      if (!vivo) return; raf = requestAnimationFrame(bucle);
      const ahora = performance.now(), dt = Math.min(0.05, (ahora - ultimoT) / 1000); ultimoT = ahora;
      if (teclas.size) {
        cam.getWorldDirection(vF); vF.y = 0; if (vF.lengthSq() < 1e-6) vF.set(0, 0, -1); vF.normalize(); vR.crossVectors(vF, ARRIBA).normalize(); vM.set(0, 0, 0);
        if (teclas.has('w')) vM.add(vF); if (teclas.has('s')) vM.sub(vF); if (teclas.has('d')) vM.add(vR); if (teclas.has('a')) vM.sub(vR);
        if (teclas.has('e')) vM.y += 1; if (teclas.has('q')) vM.y -= 1;
        if (vM.lengthSq()) { vM.normalize().multiplyScalar(dt * (teclas.has('shift') ? 9 : 3)); cam.position.add(vM); ctrl.target.add(vM); }
      }
      ctrl.update(); renderer.render(scene, cam);
    };
    const enCampo = e => { const t = (e.target?.tagName || '').toLowerCase(); return t === 'input' || t === 'textarea' || t === 'select' || e.target?.isContentEditable; };
    const tDown = e => { if (enCampo(e) || e.ctrlKey || e.metaKey || e.altKey) return; const k = e.key.toLowerCase(); if (k.length === 1 && 'wasdqe'.includes(k)) { teclas.add(k); e.preventDefault(); } else if (k === 'shift') teclas.add('shift'); };
    const tUp = e => { teclas.delete(e.key.toLowerCase()); };
    window.addEventListener('keydown', tDown); window.addEventListener('keyup', tUp); window.addEventListener('blur', () => teclas.clear());
    ajustar(); bucle();
    window.addEventListener('resize', ajustar);
    api3d.current = { renderer, scene, cam, ctrl, sol, raiz, esc, base, el, hemi };

    let ultima = null, primera = true;
    const cargar = () => api.get('/medicion/' + id).then(r => {
      if (!vivo) return;
      const pl = r.data?.plano;
      if (!primera && pl?.updated === ultima) return; // sin cambios en el plano
      ultima = pl?.updated;
      setTitulo(pl?.nombre || 'Plano');
      if (primera && !cargadaEscena.current) { cargadaEscena.current = true; setGuardado('inicial'); setObjs(pl?.escena3d?.objetos || []); const ac = pl?.escena3d?.acabados; if (ac) setAcab({ muros: ac.muros || {}, salas: ac.salas || {}, techos: ac.techos || {}, equipos: ac.equipos || {}, pilares: ac.pilares || {}, huecos: ac.huecos || {}, regiones: ac.regiones || {}, todosMuros: ac.todosMuros || null, todosSuelos: ac.todosSuelos || null, todosTechos: ac.todosTechos || null, todosPilares: ac.todosPilares || null }); setTexturas(pl?.escena3d?.texturas || []); setPaleta(pl?.escena3d?.paleta || []); if (pl?.escena3d?.rodapie) setRodapie(pl.escena3d.rodapie); setGuias(pl?.escena3d?.guias || []); setLucesAj(pl?.escena3d?.luces || {}); setRenders(pl?.escena3d?.renders || []); setEscenas(pl?.escena3d?.escenas || []); setTapetas(pl?.escena3d?.tapetas || {}); setHuecosCfg(pl?.escena3d?.huecosCfg || {}); if (pl?.escena3d?.iaPrefs) setIaTxt(t => ({ ...t, ...Object.fromEntries(Object.entries(pl.escena3d.iaPrefs).filter(([, v]) => v)) })); if (pl?.escena3d?.hora != null) setHora(pl.escena3d.hora); saltoRef.current = true; }
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
        ctrl.target.copy(c); api3d.current.centro = c.clone(); api3d.current.R = R;
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
    api3d.current.limpiarSel = () => { if (sel) { sel.userData.cuerpo.material.emissive.setHex(0x000000); sel = null; } };
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
      if (herrRef.current === 'pincel' || herrRef.current === 'gotero') {
        const h = rayo.intersectObjects([...raiz.children, ...esc.children], true).find(x => x.object.isMesh && !x.object.userData.hit && visible(x.object));
        if (h) { if (herrRef.current === 'gotero' || e.altKey) tomarMaterial(h); else aplicarPincel(h, e.shiftKey || modoPincelRef.current === 'todo'); }
        return;
      }
      const primero = rayo.intersectObjects(raiz.children, true).find(h => visible(h.object));
      if (sel) sel.userData.cuerpo.material.emissive.setHex(0x000000);
      sel = null;
      setSelHueco(null);
      {
        const hl = api3d.current.luzG ? rayo.intersectObjects(api3d.current.luzG.children, true).find(x => x.object.userData.luzId) : null;
        if (hl) { setLuzSel(hl.object.userData.luzId); setSeleccion(null); setSelAcab(null); setSelObj(null); return; }
        setLuzSel(null);
      }
      const uh = primero?.object?.userData?.hueco;
      if (uh) { setSelHueco({ ...uh, nuevo: { w: uh.w, h: uh.h, sill: uh.sill, p: uh.p, tip: uh.tip, mat: uh.mat } }); setSeleccion(null); setSelAcab(null); setSelObj(null); return; }
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
    const snap = v => { const g = gridRef.current || 5; return Math.round(v / g) * g; };
    const imantar = p => {
      if (!imanRef.current) return p;
      let mejor = null, dmin = 12;
      for (const q of puntosSnapRef.current) { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < dmin) { dmin = d; mejor = { x: q.x, y: q.y }; } }
      if (mejor) return mejor;
      {
        const m = api3d.current.modelo;
        if (m) for (const pl of (m.plantas || [m])) for (const s of (pl.salas || [])) {
          const P = s.pts || [];
          for (let i = 0; i < P.length; i++) {
            const a = P[i], b = P[(i + 1) % P.length], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / L2)), q = { x: a[0] + dx * t, y: a[1] + dy * t };
            if (Math.hypot(q.x - p.x, q.y - p.y) < 7) return q;
          }
        }
      }
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
    let muroA = null, muroAbajo = null, muroLinea = null, nodoDrag = null, vertDrag = null;
    const quitarMuroLinea = () => { if (muroLinea) { scene.remove(muroLinea); muroLinea.geometry.dispose(); muroLinea = null; } };
    const terminarMuros = () => { muroA = null; quitarMuroLinea(); setMedidaMuro(''); setHerr('sel'); };
    const esPoli = h => h === 'poli' || h === 'zonaS' || h === 'zonaT' || h === 'sigue' || h === 'carril' || h === 'led';
    let focoAbajo = null;
    let cierraLazo = false;
    let poliP = null, pAbajo = null, pLinea = null;
    const muroPorId = idm => (api3d.current.modelo?.plantas || (api3d.current.modelo ? [api3d.current.modelo] : [])).flatMap(p => p.muros || []).find(m => m.id === idm);
    const snapPared = (mu, rs, ry, Lcm) => {
      const g = gridRef.current || 5; let s = Math.round(rs / g) * g, y = Math.round(ry / g) * g;
      if (!imanRef.current) return [s, y];
      const H = mu.h || api3d.current.modelo?.altura || 260, xsL = [0, Lcm], ysL = [0, H], pts = [[0, 0], [Lcm, 0], [Lcm, H], [0, H]];
      (mu.ab || []).forEach(o => { const x0 = o.p, x1 = o.p + o.w, y0 = o.sill || 0, y1 = y0 + o.h; xsL.push(x0, x1); ysL.push(y0, y1); pts.push([x0, y0], [x1, y0], [x1, y1], [x0, y1]); });
      objsRef.current.filter(o => o.tipo === 'zona' && o.plano === 'pared' && o.muroId === mu.id).forEach(o => o.pts.forEach(p => { pts.push([p[0], p[1]]); xsL.push(p[0]); ysL.push(p[1]); }));
      let mejor = null, dm = 10; pts.forEach(p => { const d = Math.hypot(p[0] - rs, p[1] - ry); if (d < dm) { dm = d; mejor = p; } });
      if (mejor) return [mejor[0], mejor[1]];
      xsL.forEach(x => { if (Math.abs(x - rs) < 6) s = x; }); ysL.forEach(yv => { if (Math.abs(yv - ry) < 6) y = yv; });
      return [s, y];
    };
    const golpePared = e => {
      const r = dom.getBoundingClientRect();
      p2.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      rayo.setFromCamera(p2, cam);
      const vis = o => { while (o) { if (!o.visible) return false; o = o.parent; } return true; };
      const h = rayo.intersectObjects(raiz.children, true).find(x => x.object.isMesh && vis(x.object));
      const u = h?.object?.userData; if (!u?.muroId) return null;
      const mu = muroPorId(u.muroId); if (!mu) return null;
      const L = Math.hypot(mu.b[0] - mu.a[0], mu.b[1] - mu.a[1]) || 1, ux = (mu.b[0] - mu.a[0]) / L, uy = (mu.b[1] - mu.a[1]) / L;
      const sn = snapPared(mu, (h.point.x / CM - mu.a[0]) * ux + (h.point.z / CM - mu.a[1]) * uy, h.point.y / CM, L), s = sn[0], yy = Math.max(0, sn[1]);
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
      const ptsF = cursor && poli.length === 1 && ['zonaS', 'zonaT', 'poli'].includes(herrRef.current) && formaRef.current !== 'poli' ? puntosForma(formaRef.current, poli[0].x, poli[0].y, cursor.x, cursor.y).map(([x, y]) => ({ x, y })) : null;
      const pts = ptsF ? [...ptsF, ptsF[0]] : (cursor ? [...poli, cursor] : poli);
      if (pts.length < 2) return;
      poliLinea = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p.x * CM, 0.03, p.y * CM))), new THREE.LineBasicMaterial({ color: 0x1b6dd6 }));
      scene.add(poliLinea);
    };
    const cerrarPoli = () => {
      // (Enter cierra el camino abierto; volver al primer punto lo cierra en lazo)
      if (herrRef.current === 'led' && poli.length >= 2) {
        const xs = poli.map(p => p.x), ys = poli.map(p => p.y);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const nuevo = { id: idNuevo(), tipo: 'led', nombre: 'Tira LED', etiqueta: 'Iluminación', cx, cy, rot: 0, w: Math.max(...xs) - Math.min(...xs), d: Math.max(...ys) - Math.min(...ys), alto: 2, z0: Math.max(50, ((api3d.current.modelo?.altura) || 260) - 8), pts: poli.map(p => [p.x - cx, p.y - cy]), led: { ancho: 1.2, k: 3000, lm: 800, dir: 'abajo', cerrado: cierraLazo && poli.length >= 3 } };
        setObjs(prev => [...prev, nuevo]); setSelObj(nuevo.id);
      } else if (herrRef.current === 'carril' && poli.length >= 2) {
        const xs = poli.map(p => p.x), ys = poli.map(p => p.y);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const nuevo = { id: idNuevo(), tipo: 'carril', nombre: carrilSisRef.current === 'trifasico' ? 'Carril trifásico' : 'Carril magnético', etiqueta: 'Iluminación', cx, cy, rot: 0, w: Math.max(...xs) - Math.min(...xs), d: Math.max(...ys) - Math.min(...ys), alto: 5, z0: Math.max(100, ((api3d.current.modelo?.altura) || 260) - 5), color: '#111111', sistema: carrilSisRef.current, suspendido: false, pts: poli.map(p => [p.x - cx, p.y - cy]), focos: [] };
        setObjs(prev => [...prev, nuevo]); setSelObj(nuevo.id);
      } else if (herrRef.current === 'sigue' && poli.length >= 2) {
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
      if (herrRef.current === 'focoC' && (e.key === 'Escape' || e.key === 'Enter')) { setHerr('sel'); return; }
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
      {
        const clave = (modoPincelRef.current === 'cara' || modoPincelRef.current === 'pieza') && !todos ? claveRegion(hit) : null;
        if (clave && (modoPincelRef.current === 'cara' || clave.startsWith('e:'))) {
          const seed = hit.faceIndex, ang = modoPincelRef.current === 'pieza' ? 181 : angCaraRef.current;
          setAcab(a => { const reg = { ...(a.regiones || {}) }; reg[clave] = [...(reg[clave] || []).filter(r => r.tri !== seed), { tri: seed, valor, ang }]; return { ...a, regiones: reg }; });
          return;
        }
      }
      if (u.muroId) setAcab(a => (todos ? { ...a, muros: {}, todosMuros: valor } : { ...a, muros: { ...a.muros, [u.muroId]: valor } }));
      else if (u.salaKey) setAcab(a => (todos ? { ...a, salas: {}, todosSuelos: valor } : { ...a, salas: { ...a.salas, [u.salaKey]: valor } }));
      else if (u.techoKey) setAcab(a => (todos ? { ...a, techos: {}, todosTechos: valor } : { ...a, techos: { ...a.techos, [u.techoKey]: valor } }));
      else if (u.pilarId) setAcab(a => (todos ? { ...a, pilares: {}, todosPilares: valor } : { ...a, pilares: { ...(a.pilares || {}), [u.pilarId]: valor } }));
      else if (u.hueco && (u.zona === 'marco' || u.zona === 'hoja' || u.zona === 'tapeta')) { const k = u.hueco.id || (u.hueco.muroId + ':' + u.hueco.p); setAcab(a => ({ ...a, huecos: { ...(a.huecos || {}), [k]: { ...((a.huecos || {})[k] || {}), [u.zona]: valor } } })); }
      else if (u.equipo || (() => { let q = hit.object; while (q && !q.userData.equipo) q = q.parent; return !!q; })()) { let q = hit.object; while (q && !q.userData.equipo) q = q.parent; const eid = q.userData.equipo.id; setAcab(a => ({ ...a, equipos: { ...(a.equipos || {}), [eid]: valor } })); }
      else if ((() => { let q = hit.object; while (q && q.userData.capa !== 'rodapie') q = q.parent; return !!q; })()) setRodapie(r => ({ ...r, color: valor }));
      else {
        let o = hit.object; while (o && !o.userData.oid) o = o.parent;
        if (o) {
          const idx = hit.face?.materialIndex, oid = o.userData.oid, zona = hit.object.userData.zona;
          setObjs(prev => prev.map(x => {
            if (x.id !== oid) return x;
            if (u.parte !== undefined && x.tipo === 'bloque') return todos ? { ...x, color: valor, partes: undefined } : { ...x, partes: { ...(x.partes || {}), [u.parte]: valor } };
            if (x.tipo === 'mueble') return todos ? { ...x, color: valor, colorFrente: valor } : (zona === 'frente' ? { ...x, colorFrente: valor } : { ...x, color: valor });
            if (todos || idx === undefined || !['caja', 'prisma', 'bloque'].includes(x.tipo)) return { ...x, color: valor, caras: undefined };
            return { ...x, caras: { ...(x.caras || {}), [idx]: valor } }; // solo esa cara
          }));
        }
      }
    };
    const tomarMaterial = (hit) => {
      const u = hit.object.userData, ac = acabRef.current || {}; let valor = null;
      let valorRegion = null;
      { const ck = claveRegion(hit), lista = ck ? (ac.regiones || {})[ck] || [] : []; for (let i = lista.length - 1; i >= 0 && !valorRegion; i--) { if (regionTriangulos(hit.object.geometry, lista[i].tri, lista[i].ang || 25).has(hit.faceIndex)) valorRegion = lista[i].valor; } }
      if (valorRegion) valor = valorRegion;
      else if (u.muroId) valor = ac.muros?.[u.muroId] || ac.todosMuros;
      else if (u.salaKey) valor = ac.salas?.[u.salaKey] || ac.todosSuelos;
      else if (u.techoKey) valor = ac.techos?.[u.techoKey] || ac.todosTechos;
      else if (u.pilarId) valor = ac.pilares?.[u.pilarId] || ac.todosPilares;
      else if (u.hueco) { const hh = u.hueco; valor = ac.huecos?.[hh.id || (hh.muroId + ':' + hh.p)]?.[u.zona === 'hoja' ? 'hoja' : u.zona === 'tapeta' ? 'tapeta' : 'marco']; }
      else {
        let eq = hit.object; while (eq && !eq.userData.equipo) eq = eq.parent;
        if (eq) valor = ac.equipos?.[eq.userData.equipo.id];
        else {
          let ro = hit.object; while (ro && ro.userData.capa !== 'rodapie') ro = ro.parent;
          if (ro) valor = rodapieRef.current.color;
          else {
            let o = hit.object; while (o && !o.userData.oid) o = o.parent; const ob = o && objsRef.current.find(x => x.id === o.userData.oid);
            if (ob) valor = (u.parte !== undefined && ob.partes?.[u.parte]) || (ob.tipo === 'mueble' && u.zona === 'frente' ? (ob.colorFrente || ob.color) : (hit.face?.materialIndex !== undefined && ob.caras?.[hit.face.materialIndex])) || ob.color;
          }
        }
      }
      if (!valor) { const mt = Array.isArray(hit.object.material) ? hit.object.material[hit.face?.materialIndex || 0] : hit.object.material; valor = mt?.color ? '#' + mt.color.getHexString() : null; }
      if (!valor) return;
      setMatSel(String(valor).startsWith('tex:') ? { id: String(valor).slice(4) } : { hex: valor });
      setHerr('pincel'); setMatAbierto(true); setGuardado('Material copiado: haz clic en lo que quieras pintar');
    };
    const onDownD = e => {
      if (e.button !== 0) return;
      if (herrRef.current === 'pincel' || herrRef.current === 'gotero') return;
      if (esPoli(herrRef.current)) { poliAbajo = [e.clientX, e.clientY]; return; }
      if (herrRef.current === 'zonaP') { pAbajo = [e.clientX, e.clientY]; return; }
      if (herrRef.current === 'guia') { guiaAbajo = [e.clientX, e.clientY]; return; }
      if (herrRef.current === 'luz') { luzAbajo = [e.clientX, e.clientY]; return; }
      if (herrRef.current === 'muro') { muroAbajo = [e.clientX, e.clientY]; return; }
      if (herrRef.current === 'focoC') { focoAbajo = [e.clientX, e.clientY]; return; }
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
        const vg = api3d.current.vertG, ob0 = objsRef.current.find(x => x.id === selObjRef.current);
        if (vg && ob0 && Array.isArray(ob0.pts)) {
          const r = dom.getBoundingClientRect();
          p2.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
          rayo.setFromCamera(p2, cam);
          const hv = rayo.intersectObjects(vg.children, true)[0];
          if (hv) {
            const u = hv.object.userData;
            if (u.mid !== undefined) { const i = u.mid, A = ob0.pts[i], B = ob0.pts[(i + 1) % ob0.pts.length], np = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2]; setObjs(prev => prev.map(x => (x.id === ob0.id ? { ...x, pts: [...x.pts.slice(0, i + 1), np, ...x.pts.slice(i + 1)] } : x))); }
            else { ctrl.enabled = false; vertDrag = { id: ob0.id, idx: u.vert, esfera: hv.object, ob: ob0, p: null }; }
            e.stopPropagation(); return;
          }
        }
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
      if (vertDrag) {
        const ob = vertDrag.ob, esf = vertDrag.esfera, r = dom.getBoundingClientRect();
        p2.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        rayo.setFromCamera(p2, cam);
        if (ob.tipo === 'zona' && ob.plano === 'pared') {
          const mu = muroPorId(ob.muroId); if (!mu) return;
          const L = Math.hypot(mu.b[0] - mu.a[0], mu.b[1] - mu.a[1]) || 1, ux = (mu.b[0] - mu.a[0]) / L, uy = (mu.b[1] - mu.a[1]) / L, lado = ob.lado || 1;
          const plano = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(-uy * lado, 0, ux * lado), new THREE.Vector3(mu.a[0] * CM, 0, mu.a[1] * CM));
          if (rayo.ray.intersectPlane(plano, pt)) { const sn = snapPared(mu, (pt.x / CM - mu.a[0]) * ux + (pt.z / CM - mu.a[1]) * uy, pt.y / CM, L), yy = Math.max(0, sn[1]); vertDrag.p = [sn[0], yy]; esf.position.copy(aMundoPared(mu, sn[0], yy, lado)); }
        } else {
          const plano = new THREE.Plane(new THREE.Vector3(0, 1, 0), -esf.position.y);
          if (rayo.ray.intersectPlane(plano, pt)) { const q = imantar({ x: snap(pt.x / CM), y: snap(pt.z / CM) }); vertDrag.p = [q.x - ob.cx, q.y - ob.cy]; esf.position.x = q.x * CM; esf.position.z = q.y * CM; }
        }
        return;
      }
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
      if (vertDrag) { const vd = vertDrag; vertDrag = null; ctrl.enabled = true; if (vd.p) setObjs(prev => prev.map(x => (x.id === vd.id ? { ...x, pts: x.pts.map((q, i) => (i === vd.idx ? vd.p : q)) } : x))); return; }
      if (focoAbajo) {
        const d0 = Math.hypot(e.clientX - focoAbajo[0], e.clientY - focoAbajo[1]); focoAbajo = null;
        if (d0 < 4) {
          const r = dom.getBoundingClientRect();
          p2.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
          rayo.setFromCamera(p2, cam);
          const h = rayo.intersectObjects(esc.children, true).find(x => { let o = x.object; while (o && !o.userData.oid) o = o.parent; return o && o.userData.carril && x.object.isMesh; });
          if (h) {
            let go = h.object; while (go && !go.userData.oid) go = go.parent;
            const ob = objsRef.current.find(x => x.id === go.userData.oid);
            if (ob) {
              const loc = go.worldToLocal(h.point.clone()), s = Math.round(proyectarEnCamino(ob.pts, loc.x / CM, loc.z / CM) / 5) * 5, t = kindFocoRef.current;
              const foco = { id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4), t, s, yaw: 0, tilt: t === 'spot' || t === 'spotmini' || t === 'proyector' ? 20 : 0, lm: FOCO_DEF[t].lm, k: 3000, ap: FOCO_DEF[t].ap, largo: FOCO_DEF[t].largo || 60 };
              setObjs(prev => prev.map(x => (x.id === ob.id ? { ...x, focos: [...(x.focos || []), foco] } : x)));
            }
          }
        }
        return;
      }
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
              else { P.push([g.s, g.y]); if (formaRef.current !== 'poli' && P.length === 2) { poliP.pts = puntosForma(formaRef.current, P[0][0], P[0][1], P[1][0], P[1][1]); cerrarPared(); } else dibujarPared(null); }
            }
          }
        }
        return;
      }
      if (luzAbajo) {
        const d0 = Math.hypot(e.clientX - luzAbajo[0], e.clientY - luzAbajo[1]); luzAbajo = null;
        if (d0 < 4) {
          const p = puntoSuelo(e);
          if (p) { const tipo = kindLuzRef.current, esSpot = tipo === 'spot'; api.post('/medicion/' + id + '/luminaria', { x: p.x, y: p.y, kid: esSpot ? 'foco' : tipo }).then(r => { if (esSpot && r.data?.id) setLucesAj(a => ({ ...a, [r.data.id]: { ap: 36, v: 'spot', tilt: 25, yaw: 0 } })); setGuardado('Luminaria colocada en el plano ✓'); api3d.current.recargar?.(); }).catch(er => setGuardado(er.response?.data?.error || 'No se pudo colocar la luminaria')); }
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
          if (p) {
            const formaTool = ['zonaS', 'zonaT', 'poli'].includes(herrRef.current) && formaRef.current !== 'poli';
            if (formaTool && poli.length === 1) { poli = puntosForma(formaRef.current, poli[0].x, poli[0].y, p.x, p.y).map(([x, y]) => ({ x, y })); cerrarPoli(); }
            else if (poli.length >= 3 && Math.hypot(p.x - poli[0].x, p.y - poli[0].y) < 15) { cierraLazo = true; cerrarPoli(); cierraLazo = false; }
            else { poli.push(p); dibujarPoli(null); }
          }
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

    return () => { window.removeEventListener('keydown', onTecla); el.removeEventListener('pointerdown', onDownD, true); window.removeEventListener('pointermove', onMoveD); window.removeEventListener('pointerup', onUpD); vivo = false; clearInterval(reloj); dom.removeEventListener('pointerdown', onDown); dom.removeEventListener('pointerup', onUp); cancelAnimationFrame(raf); window.removeEventListener('resize', ajustar); window.removeEventListener('keydown', tDown); window.removeEventListener('keyup', tUp); renderer.dispose(); el.removeChild(renderer.domElement); };
  }, [id]);

  // Colores de muros y suelos (cambian sin rehacer el plano)
  // (ver versión con texturas más abajo)
  useEffect(() => {
    const a = api3d.current; if (!a.raiz) return;
    a.raiz.traverse(o => {
      if (o.userData.equipo && o.userData.cuerpo) { const e = o.userData.equipo; pintar(o.userData.cuerpo, acab.equipos?.[e.id], texturas, true, [e.largo || e.w, e.alto || 110]); return; }
      if (!o.isMesh) return;
      const u = o.userData;
      if (u.pilarId) { pintar(o, acab.pilares?.[u.pilarId] || acab.todosPilares, texturas, true, u.dimBox || [30, 260]); return; }
      if (u.hueco && (u.zona === 'marco' || u.zona === 'hoja' || u.zona === 'tapeta')) { const hh = u.hueco; pintar(o, acab.huecos?.[hh.id || (hh.muroId + ':' + hh.p)]?.[u.zona], texturas, true, [hh.w || 90, hh.h || 210]); return; }
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
    lucesPl.slice(0, 16).forEach(l => {
      const cat = lumCat.find(c => c.id === l.lid), lm = lucesAj[l.id]?.lm ?? (cat?.lm || 800), K = lucesAj[l.id]?.k ?? (cat?.k || 3000);
      const hcm = l.h != null ? l.h : (ALT[l.kid] ?? 250), ap = lucesAj[l.id]?.ap ?? 60;
      const col = colorK(K);
      const aj = lucesAj[l.id] || {};
      const { grupo: marca, luzPos, dir: dirL } = construirLuminaria(l.kid, col, sel2(l.id, luzSel), aj.v, aj.tilt, aj.yaw);
      marca.position.set(l.x * CM, hcm * CM, l.y * CM); marca.traverse(x => { x.userData.luzId = l.id; }); g.add(marca);
      const luzMundo = marca.position.clone().add(luzPos);
      const inten = Math.max(5, lm / 12.57) * 0.5 * ambiente.luces;
      if (l.kid === 'foco' || l.kid === 'plaf') {
        const s = new THREE.SpotLight(col, inten * 4, 0, Math.max(0.1, (ap / 2) * Math.PI / 180), 0.45, 2);
        s.position.copy(luzMundo); if (dirL) s.target.position.copy(luzMundo.clone().add(dirL.clone().multiplyScalar(2.5))); else s.target.position.set(l.x * CM, 0, l.y * CM); g.add(s); g.add(s.target);
      } else { const p = new THREE.PointLight(col, inten, 0, 2); p.position.copy(luzMundo); g.add(p); }
    });
    a.scene.add(g); a.luzG = g;
  }, [lucesPl, lumCat, lucesAj, luzSel, estado, ocultas, ambiente.luces, ambiente.kLuces]);

  // Sol según la hora y exposición de la cámara
  useEffect(() => {
    const a = api3d.current; if (!a.sol || !a.centro) return;
    const t = Math.max(0, Math.min(1, (hora - 6) / 15)), elev = Math.max(0.05, Math.sin(Math.PI * t)) * (65 * Math.PI / 180), az = Math.PI * (1 - t), k = Math.sin(Math.PI * t);
    const d = (a.R || 8) * 3;
    a.sol.position.set(a.centro.x + d * Math.cos(az) * Math.cos(elev), a.centro.y + d * Math.sin(elev) + 1, a.centro.z + d * Math.sin(az) * Math.cos(elev));
    a.sol.intensity = 0.12 + 1.6 * Math.pow(Math.max(0, k), 0.7);
    if (ambiente.kSol) a.sol.color.copy(kelvinColor(ambiente.kSol)); else a.sol.color.setHSL(0.09, 0.5 * (1 - k) + 0.05, 0.75 + 0.2 * k);
    if (a.hemi) a.hemi.intensity = 0.35 + 0.8 * k;
    a.renderer.toneMappingExposure = ambiente.exposicion;
    try { localStorage.setItem('visor3dAmb', JSON.stringify({ exposicion: ambiente.exposicion, luces: ambiente.luces, kLuces: ambiente.kLuces ?? null, kSol: ambiente.kSol ?? null })); } catch { /* sin almacenamiento */ }
  }, [hora, ambiente.exposicion, ambiente.luces, ambiente.kSol, estado, rev]);

  // Varias plantas: se pueden ocultar por separado
  useEffect(() => {
    const a = api3d.current; if (!a.raiz) return;
    a.raiz.children.forEach((g, i) => { g.visible = !ocultas.includes('planta:' + i); });
  }, [ocultas, rev, estado]);

  // Medidas (cotas) y flechas de ejes del objeto seleccionado (también las máquinas del plano: solo medidas)
  useEffect(() => {
    const a = api3d.current; if (!a.scene) return;
    ['gizmoG', 'cotasG'].forEach(k => { if (a[k]) { a.scene.remove(a[k]); a[k].traverse(x => { x.geometry?.dispose(); x.material?.map?.dispose?.(); x.material?.dispose?.(); }); a[k] = null; } });
    const ob = objs.find(x => x.id === selObj);
    const d = ob ? { w: ob.w, d: ob.d, alto: ob.alto, cx: ob.cx, cy: ob.cy, rot: ob.rot || 0, z0: ob.z0 || 0, tipo: ob.tipo }
      : (seleccion ? { w: seleccion.largo || seleccion.w, d: seleccion.fondo || seleccion.d, alto: seleccion.alto || 110, cx: seleccion.cx, cy: seleccion.cy, rot: seleccion.rot || 0, z0: 0 } : null);
    if (!d) return;
    if (!['zona', 'falsotecho', 'barrido', 'carril', 'led'].includes(d.tipo)) {
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

  // Las máquinas del plano se ven con su modelo 3D del catálogo si lo tienen (así se pueden pintar por partes)
  useEffect(() => {
    const a = api3d.current; if (!a.raiz || !biblioteca) return;
    a.raiz.traverse(g => {
      const e = g.userData.equipo; if (!e || !e.cid || g.userData.modeloCargado) return;
      const mod = biblioteca.find(m => m.id === e.cid)?.modelo3d; if (!mod) return;
      g.userData.modeloCargado = true;
      cargarModelo(mod).then(raw => {
        if (!g.parent) return;
        const mm = ajustarModelo(raw, (e.largo || e.w) * CM, (e.fondo || e.d) * CM, (e.alto || 110) * CM); if (!mm) return;
        sobrescribirModelo(mm, {}, texturas); mm.userData.modeloEq = true; mm.rotation.y = -((mod.rot || 0) * Math.PI) / 180; g.add(mm);
        if (g.userData.cuerpo) { g.userData.cuerpo.material.visible = false; g.userData.cuerpo.castShadow = false; }
        const ov = aplicarRegiones(mm, 'e:' + e.id + ':', acabRef.current?.regiones, texturas); (a.overlaysRaiz = a.overlaysRaiz || []).push(...ov);
      }).catch(() => { g.userData.modeloCargado = false; });
    });
  }, [rev, biblioteca, estado]);

  // Caras pintadas en muros y en las máquinas del plano
  useEffect(() => {
    const a = api3d.current; if (!a.raiz) return;
    (a.overlaysRaiz || []).forEach(o => { o.parent?.remove(o); o.geometry.dispose(); o.material.dispose(); }); a.overlaysRaiz = [];
    const reg = acab.regiones || {};
    a.raiz.traverse(x => {
      if (x.isMesh && x.userData.muroId && !x.userData.overlay) a.overlaysRaiz.push(...aplicarRegiones(x, 'm:' + x.userData.muroId + ':', reg, texturas));
      else if (x.userData.equipo) x.children.filter(c => c.userData.modeloEq).forEach(mm => a.overlaysRaiz.push(...aplicarRegiones(mm, 'e:' + x.userData.equipo.id + ':', reg, texturas)));
    });
  }, [acab.regiones, rev, estado, texturas]);

  // Hojas de puertas y cristales de ventanas según su tipo, con la apertura elegida
  useEffect(() => {
    const a = api3d.current; if (!a.raiz) return;
    if (a.hojaG) { a.raiz.remove(a.hojaG); a.hojaG.traverse(x => { x.geometry?.dispose(); x.material?.dispose?.(); }); a.hojaG = null; }
    const modelo = a.modelo; if (!modelo) return;
    const g = new THREE.Group();
    (modelo.plantas || [modelo]).forEach(pl => (pl.muros || []).forEach(mu => (mu.ab || []).forEach(o => {
      const key = o.id || (mu.id + ':' + o.p), holder = new THREE.Group();
      holder.position.set(mu.a[0] * CM, (pl.z || 0) * CM, mu.a[1] * CM); holder.rotation.y = -Math.atan2(mu.b[1] - mu.a[1], mu.b[0] - mu.a[0]);
      holder.add(construirHoja(o, mu, huecosCfg[key] || {}, acab.huecos?.[key]?.hoja, texturas)); g.add(holder);
    })));
    a.raiz.add(g); a.hojaG = g;
  }, [huecosCfg, rev, estado, acab.huecos, texturas]);

  // Tapetas (molduras alrededor de puertas y ventanas): dintel y dos jambas por lado del muro, y alféizar opcional en ventanas
  useEffect(() => {
    const a = api3d.current; if (!a.raiz) return;
    if (a.tapG) { a.raiz.remove(a.tapG); a.tapG.traverse(x => { x.geometry?.dispose(); x.material?.dispose?.(); }); a.tapG = null; }
    const modelo = a.modelo; if (!modelo || !Object.keys(tapetas).length) return;
    const g = new THREE.Group();
    (modelo.plantas || [modelo]).forEach(pl => (pl.muros || []).forEach(mu => (mu.ab || []).forEach(o => {
      const key = o.id || (mu.id + ':' + o.p), c = tapetas[key]; if (!c || !c.on) return;
      const val = acab.huecos?.[key]?.tapeta, ancho = (c.ancho || 7) * CM, vuelo = (c.vuelo || 1.2) * CM, t = (mu.t || 12) * CM;
      const holder = new THREE.Group(); holder.position.set(mu.a[0] * CM, (pl.z || 0) * CM, mu.a[1] * CM); holder.rotation.y = -Math.atan2(mu.b[1] - mu.a[1], mu.b[0] - mu.a[0]);
      const x0 = o.p * CM, x1 = (o.p + o.w) * CM, y0 = (o.sill || 0) * CM, y1 = y0 + o.h * CM, w = x1 - x0;
      (c.lados === 'a' ? [1] : c.lados === 'b' ? [-1] : [1, -1]).forEach(s => {
        const mt = new THREE.MeshStandardMaterial({ color: color(/^#/.test(val || '') ? val : null, '#ffffff'), roughness: 0.55 });
        const tx = val && String(val).startsWith('tex:') ? texturas.find(x => 'tex:' + x.id === val) : null;
        if (tx) { mt.map = texturaDe(tx, true).clone(); mt.map.needsUpdate = true; mt.map.repeat.set(Math.max(0.2, o.w / tx.tam), 1); mt.color.setHex(0xffffff); }
        ledEm(mt, val);
        const z = s * (t / 2 + vuelo / 2);
        const tabla = (bw, bh, px, py, bd, pz) => {
          const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mt); b.position.set(px, py, pz); b.castShadow = b.receiveShadow = true;
          b.userData = { capa: 'huecos', hueco: { muroId: mu.id, id: o.id || null, p: o.p, w: o.w, h: o.h, sill: o.sill || 0, tipo: o.tipo || o.t, tip: o.tip, mat: o.mat }, zona: 'tapeta' }; holder.add(b);
        };
        tabla(w + 2 * ancho, ancho, (x0 + x1) / 2, y1 + ancho / 2, vuelo, z);        // dintel
        tabla(ancho, y1 - y0, x0 - ancho / 2, (y0 + y1) / 2, vuelo, z);               // jamba izquierda
        tabla(ancho, y1 - y0, x1 + ancho / 2, (y0 + y1) / 2, vuelo, z);               // jamba derecha
        if (c.alfeizar && (o.tipo || o.t) === 'win') tabla(w + 2 * ancho + 2 * vuelo, 0.022, (x0 + x1) / 2, y0 - 0.011, 0.04, s * (t / 2 + 0.02)); // alféizar
      });
      g.add(holder);
    })));
    a.raiz.add(g); a.tapG = g;
  }, [tapetas, rev, estado, acab.huecos, texturas]);

  // Alzado / planta de detalle: cotas automáticas de lo que se ve y corte para dejar solo esa parte
  useEffect(() => {
    const a = api3d.current; if (!a.scene) return;
    if (a.alzG) { a.scene.remove(a.alzG); a.alzG.traverse(x => { x.geometry?.dispose(); x.material?.map?.dispose?.(); x.material?.dispose?.(); }); a.alzG = null; }
    if (!alz || !a.modelo) { if (a.renderer) a.renderer.clippingPlanes = []; return; }
    const pl0 = (a.modelo.plantas || [a.modelo])[0], H = pl0.altura || 260, prof = (profAlz || 100) * CM;
    if (alz.tipo === 'muro') {
      const mu = (pl0.muros || []).find(x => x.id === alz.id); if (!mu) return;
      const L = Math.hypot(mu.b[0] - mu.a[0], mu.b[1] - mu.a[1]), ux = (mu.b[0] - mu.a[0]) / L, uy = (mu.b[1] - mu.a[1]) / L, n = new THREE.Vector3(-uy * alz.lado, 0, ux * alz.lado), c = new THREE.Vector3((mu.a[0] + ux * L / 2) * CM, 0, (mu.a[1] + uy * L / 2) * CM), t = ((mu.t || 12) / 2) * CM;
      a.renderer.clippingPlanes = [new THREE.Plane().setFromNormalAndCoplanarPoint(n.clone().negate(), c.clone().add(n.clone().multiplyScalar(t + prof))), new THREE.Plane().setFromNormalAndCoplanarPoint(n.clone(), c.clone().sub(n.clone().multiplyScalar(t + 0.05)))];
      a.alzG = construirAlzadoMuro(mu, alz.lado, mu.h || H, objs.filter(o => o.tipo === 'zona' && o.plano === 'pared' && o.muroId === mu.id));
    } else {
      const sala = (pl0.salas || []).find((s, i) => (s.idS || ('s' + i)) === alz.id); if (!sala) return;
      const y = alz.tipo === 'techo' ? H * CM - 0.02 : 0.02;
      a.renderer.clippingPlanes = [alz.tipo === 'techo' ? new THREE.Plane(new THREE.Vector3(0, 1, 0), -(H * CM - prof)) : new THREE.Plane(new THREE.Vector3(0, -1, 0), prof)];
      a.alzG = construirAlzadoPlanta(sala, y, objs.filter(o => o.tipo === 'zona' && o.plano === alz.tipo));
    }
    a.scene.add(a.alzG);
  }, [alz, objs, rev, estado, profAlz]);

  // Asas de los vértices de la forma seleccionada: azules = vértices (arrastrar), verdes = punto medio de un lado (clic para añadir un vértice)
  useEffect(() => {
    const a = api3d.current; if (!a.scene) return;
    if (a.vertG) { a.scene.remove(a.vertG); a.vertG.traverse(x => { x.geometry?.dispose(); x.material?.dispose?.(); }); a.vertG = null; }
    const ob = objs.find(x => x.id === selObj);
    if (!ob || !['zona', 'prisma', 'falsotecho'].includes(ob.tipo) || !Array.isArray(ob.pts) || ob.pts.length < 2 || !a.modelo) return;
    const H = a.modelo.altura || 260, muros = (a.modelo.plantas || [a.modelo]).flatMap(p => p.muros || []);
    const pared = ob.tipo === 'zona' && ob.plano === 'pared', mu = pared ? muros.find(m => m.id === ob.muroId) : null;
    if (pared && !mu) return;
    const mundo = p => {
      if (mu) { const L = Math.hypot(mu.b[0] - mu.a[0], mu.b[1] - mu.a[1]) || 1, ux = (mu.b[0] - mu.a[0]) / L, uy = (mu.b[1] - mu.a[1]) / L, off = (ob.lado || 1) * ((mu.t || 12) / 2 + 0.4); return new THREE.Vector3((mu.a[0] + ux * p[0] - uy * off) * CM, p[1] * CM, (mu.a[1] + uy * p[0] + ux * off) * CM); }
      const y = ob.tipo === 'zona' ? (ob.plano === 'techo' ? (ob.h || H) * CM - 0.02 : 0.03) : ob.tipo === 'prisma' ? ((ob.z0 || 0) + ob.alto) * CM + 0.02 : (ob.h || H) * CM;
      return new THREE.Vector3((ob.cx + p[0]) * CM, y, (ob.cy + p[1]) * CM);
    };
    const xs = ob.pts.map(p => p[0]), ys = ob.pts.map(p => p[1]), tam = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * CM, r = alz ? Math.max(0.06, tam / 55) : Math.max(0.04, Math.min(0.09, tam / 40));
    const g = new THREE.Group();
    ob.pts.forEach((p, i) => {
      const v = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 12), new THREE.MeshBasicMaterial({ color: 0x1b6dd6, depthTest: false })); v.position.copy(mundo(p)); v.renderOrder = 999; v.userData = { vert: i }; g.add(v);
      if (ob.pts.length >= 3 || i === 0) { const q = ob.pts[(i + 1) % ob.pts.length], m = new THREE.Mesh(new THREE.SphereGeometry(r * 0.6, 12, 10), new THREE.MeshBasicMaterial({ color: 0x2ecc71, depthTest: false })); m.position.copy(mundo([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2])); m.renderOrder = 999; m.userData = { mid: i }; g.add(m); }
    });
    a.scene.add(g); a.vertG = g;
  }, [objs, selObj, rev, estado, alz]);

  // Rodapié: sigue el perímetro de cada sala (por dentro) y se interrumpe en las puertas
  useEffect(() => {
    const a = api3d.current; if (!a.scene) return;
    if (a.rod) { a.scene.remove(a.rod); a.rod.traverse(x => { x.geometry?.dispose(); x.material?.dispose?.(); }); a.rod = null; }
    const modelo = a.modelo; if (!rodapie.on || !modelo) return;
    const g = new THREE.Group(); g.userData.capa = 'rodapie'; g.visible = !ocultas.includes('rodapie');
    const mat = new THREE.MeshStandardMaterial({ color: color(/^#/.test(rodapie.color || '') ? rodapie.color : null, '#ffffff'), roughness: 0.6 });
    if (String(rodapie.color || '').startsWith('tex:')) { const tx = texturas.find(x => 'tex:' + x.id === rodapie.color); if (tx) { mat.map = texturaDe(tx, true); mat.color.setHex(0xffffff); } }
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
    const presup = { n: 0 };
    const todosMuros = (api3d.current.modelo?.plantas || (api3d.current.modelo ? [api3d.current.modelo] : [])).flatMap(p => p.muros || []);
    objs.forEach(o => {
      if (o.tipo === 'zona' && Array.isArray(o.pts) && o.pts.length >= 3) {
        const gz = new THREE.Group();
        const val = o.color, tx = val && String(val).startsWith('tex:') ? texturas.find(x => 'tex:' + x.id === val) : null;
        const mt = new THREE.MeshStandardMaterial({ color: color(/^#/.test(val || '') ? val : null, '#9aa3ad'), roughness: 0.7, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, emissive: o.id === selObj ? 0x335577 : 0x000000 });
        if (tx) { mt.map = texturaDe(tx, false); mt.color.setHex(0xffffff); }
        ledEm(mt, val);
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
        if (esLed(o.color)) {
          const xs = o.pts.map(p => p[0]), ys = o.pts.map(p => p[1]), bw = (Math.max(...xs) - Math.min(...xs)) * CM, bh = (Math.max(...ys) - Math.min(...ys)) * CM, mx = ((Math.max(...xs) + Math.min(...xs)) / 2) * CM, my = ((Math.max(...ys) + Math.min(...ys)) / 2) * CM, colL = new THREE.Color(o.color.slice(0, 7));
          if (o.plano === 'pared') { const mu = todosMuros.find(m => m.id === o.muroId); if (mu) { const hld = new THREE.Group(); hld.position.set(mu.a[0] * CM, 0, mu.a[1] * CM); hld.rotation.y = -Math.atan2(mu.b[1] - mu.a[1], mu.b[0] - mu.a[0]); luzArea(hld, new THREE.Vector3(mx, my, (o.lado || 1) * (((mu.t || 12) / 2) * CM + 0.01)), new THREE.Vector3(0, 0, o.lado || 1), bw, bh, colL, 8 * ambiente.luces, presup); gz.add(hld); } }
          else luzArea(gz, new THREE.Vector3(o.cx * CM + (0), o.plano === 'techo' ? (o.h || 260) * CM - 0.01 : 0.01, o.cy * CM), new THREE.Vector3(0, o.plano === 'techo' ? -1 : 1, 0), bw, bh, colL, 8 * ambiente.luces, presup);
        }
        gz.userData.oid = o.id; gz.userData.tipoObj = 'zona'; gz.visible = !ocultas.includes('obj:' + (o.etiqueta || ''));
        a.esc.add(gz);
        return;
      }
      if (o.tipo === 'led' && Array.isArray(o.pts) && o.pts.length >= 2) {
        const gl = construirLed(o, presup, ambiente.luces, o.id === selObj);
        gl.position.set(o.cx * CM, 0, o.cy * CM); gl.userData.oid = o.id; gl.visible = !ocultas.includes('obj:' + (o.etiqueta || ''));
        a.esc.add(gl);
        return;
      }
      if (o.tipo === 'carril' && Array.isArray(o.pts) && o.pts.length >= 2) {
        const gc = construirCarril(o, presup, ambiente.luces, o.id === selObj);
        gc.position.set(o.cx * CM, 0, o.cy * CM); gc.userData.oid = o.id; gc.userData.carril = true; gc.visible = !ocultas.includes('obj:' + (o.etiqueta || ''));
        a.esc.add(gc);
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
          const K = ft.k || 3000, led = new THREE.MeshBasicMaterial({ color: colorK(K) });
          for (let i = 0; i < inner.length; i++) {
            const p = inner[i], q = inner[(i + 1) % inner.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (L < 2) continue;
            luzArea(gf, new THREE.Vector3(((p[0] + q[0]) / 2) * CM, (D >= 0 ? H - 0.012 : H + prof + 0.012), ((p[1] + q[1]) / 2) * CM), new THREE.Vector3(0, 1, 0), L * CM, 0.06, colorK(K), 6 * ambiente.luces, presup, new THREE.Vector3((q[0] - p[0]) / L, 0, (q[1] - p[1]) / L));
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
        ledEm(mt, val);
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
          sobrescribirModelo(mm, o, texturas);
          mm.rotation.y = -((mod.rot || 0) + (o.rotM || 0)) * Math.PI / 180;
          mm.position.y = (o.z0 || 0) * CM;
          g.add(mm); fantasma(0);
          aplicarRegiones(mm, 'o:' + o.id + ':', acab.regiones, texturas);
        }).catch(() => { fantasma(1); });
      }
      if (o.id === selObj) { const l = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0x1b6dd6 })); l.position.copy(m.position); g.add(l); }
      g.position.set(o.cx * CM, 0, o.cy * CM); g.rotation.y = -(o.rot || 0) * Math.PI / 180;
      luzLedObjeto(g, o, presup, ambiente.luces);
      g.userData.oid = o.id;
      g.visible = !ocultas.includes('obj:' + (o.etiqueta || ''));
      a.esc.add(g);
    });
    a.esc.children.forEach(gr => aplicarRegiones(gr, 'o:' + gr.userData.oid + ':', acab.regiones, texturas));
  }, [objs, selObj, estado, biblioteca, ocultas, texturas, rev, ambiente.luces, ambiente.kLuces, acab.regiones]);

  // Guardado automático de la escena (sin pisar el dibujo del plano 2D)
  useEffect(() => {
    if (!cargadaEscena.current || estado !== 'listo') return;
    if (guardado === 'inicial') { setGuardado(''); return; }
    setGuardado('Guardando…');
    const t = setTimeout(() => {
      api.put('/medicion/' + id + '/escena3d', { objetos: objs, acabados: acab, paleta, rodapie, guias, luces: lucesAj, hora, escenas, tapetas, huecosCfg }).then(() => setGuardado('Guardado ✓')).catch(() => setGuardado('No se pudo guardar'));
    }, 1200);
    return () => clearTimeout(t);
  }, [objs, acab, paleta, rodapie, guias, lucesAj, hora, escenas, tapetas, huecosCfg]); // eslint-disable-line react-hooks/exhaustive-deps

  // Los paneles de la izquierda (catálogo, biblioteca 3D, capas, materiales) no se solapan: abrir uno cierra los demás; igual con los de la derecha
  useEffect(() => {
    const cur = { cat: bibAbierta, b3d: b3dAbierta, capas: capasAbierto, mat: matAbierto }, nuevo = Object.keys(cur).find(k => cur[k] && !panPrev.current[k]);
    panPrev.current = cur;
    if (nuevo) { if (nuevo !== 'cat') setBibAbierta(false); if (nuevo !== 'b3d') setB3dAbierta(false); if (nuevo !== 'capas') setCapasAbierto(false); if (nuevo !== 'mat') setMatAbierto(false); }
  }, [bibAbierta, b3dAbierta, capasAbierto, matAbierto]);
  useEffect(() => {
    const cur = { gal: galAbierta, esc: escAbierta }, nuevo = Object.keys(cur).find(k => cur[k] && !derPrev.current[k]);
    derPrev.current = cur;
    if (nuevo === 'gal') setEscAbierta(false); if (nuevo === 'esc') setGalAbierta(false);
  }, [galAbierta, escAbierta]);

  // Historial para deshacer y rehacer (lo que se escribe en el plano 2D no se deshace desde aquí)
  useEffect(() => {
    const snap = { objs, acab, rodapie, guias };
    if (saltoRef.current) { saltoRef.current = false; prevSnapRef.current = snap; return; }
    const ahora = Date.now();
    if (prevSnapRef.current) {
      if (ahora - (ultimoCambioRef.current || 0) > 700) { histRef.current.past.push(prevSnapRef.current); if (histRef.current.past.length > 100) histRef.current.past.shift(); }
      histRef.current.future = [];
    }
    ultimoCambioRef.current = ahora;
    prevSnapRef.current = snap;
  }, [objs, acab, rodapie, guias]);

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
  const aplicarSnap = s => { saltoRef.current = true; setObjs(s.objs); setAcab(s.acab); setRodapie(s.rodapie); setGuias(s.guias); };
  const deshacer = () => {
    const h = histRef.current; if (!h.past.length) { setGuardado('Nada que deshacer'); return; }
    const s = h.past.pop(); h.future.push({ objs, acab, rodapie, guias }); aplicarSnap(s);
    if (selObj && !s.objs.some(o => o.id === selObj)) setSelObj(null);
    setGuardado('Deshecho (' + h.past.length + ' paso' + (h.past.length === 1 ? '' : 's') + ' más atrás)');
  };
  const rehacer = () => {
    const h = histRef.current; if (!h.future.length) { setGuardado('Nada que rehacer'); return; }
    const s = h.future.pop(); h.past.push({ objs, acab, rodapie, guias }); aplicarSnap(s);
    if (selObj && !s.objs.some(o => o.id === selObj)) setSelObj(null);
    setGuardado('Rehecho');
  };
  useEffect(() => {
    const onKey = e => {
      const tag = (e.target?.tagName || '').toLowerCase(), tipoIn = (e.target?.type || '').toLowerCase();
      const escribiendo = (tag === 'input' && !['number', 'range', 'color', 'checkbox'].includes(tipoIn)) || tag === 'textarea' || e.target?.isContentEditable;
      if (escribiendo) return;
      const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
      if ((tag === 'input' || tag === 'select') && !(ctrl && (k === 'z' || k === 'y'))) return;
      if (ctrl && k === 'z' && !e.shiftKey) { e.preventDefault(); deshacer(); return; }
      if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); rehacer(); return; }
      if (ctrl && k === 'd' && selObj) { e.preventDefault(); duplicar(selObj); return; }
      if (['poli', 'zonaS', 'zonaT', 'zonaP', 'sigue', 'carril', 'muro'].includes(herr) && (k === 'enter' || k === 'escape')) return; // lo gestiona la propia herramienta
      if ((k === 'delete' || k === 'backspace') && selObj) { e.preventDefault(); borrar(selObj); return; }
      if (selObj && !ctrl && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'pageup', 'pagedown'].includes(k)) {
        e.preventDefault(); const paso = e.shiftKey ? 50 : 5, o = objs.find(x => x.id === selObj); if (!o) return;
        const c = { arrowleft: { cx: o.cx - paso }, arrowright: { cx: o.cx + paso }, arrowup: { cy: o.cy - paso }, arrowdown: { cy: o.cy + paso }, pageup: { z0: (o.z0 || 0) + paso }, pagedown: { z0: Math.max(0, (o.z0 || 0) - paso) } }[k];
        cambiar(selObj, c); return;
      }
      if (k === 'r' && selObj && !ctrl) { const o = objs.find(x => x.id === selObj); if (o) cambiar(selObj, { rot: ((o.rot || 0) + 90) % 360 }); return; }
      if (ctrl) return;
      const mapa = { '1': 'sel', '2': 'caja', '3': 'poli', '4': 'empujar', '5': 'guia', '6': 'muro', '7': 'luz' }; // las letras W A S D Q E son para moverse
      if (mapa[k]) setHerr(mapa[k]);
      else if (k === 'escape' && alz) { salirAlzado(); }
      else if (k === 'escape') { setSelObj(null); setSelAcab(null); setSelHueco(null); setLuzSel(null); setSeleccion(null); api3d.current.limpiarSel?.(); }
      else if (k === ' ') { e.preventDefault(); document.activeElement?.blur?.(); setHerr('sel'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // se vuelve a registrar en cada cambio para leer siempre el estado actual
  const murosPlano = () => (api3d.current.modelo?.plantas || (api3d.current.modelo ? [api3d.current.modelo] : [])).flatMap(p => p.muros || []);
  const mitades = o => { const r = (o.rot || 0) * Math.PI / 180; return { hx: (Math.abs(o.w * Math.cos(r)) + Math.abs(o.d * Math.sin(r))) / 2, hy: (Math.abs(o.w * Math.sin(r)) + Math.abs(o.d * Math.cos(r))) / 2 }; };
  const distMuro = (o, dir) => {
    const { hx, hy } = mitades(o), D = { 'x-': [-1, 0], 'x+': [1, 0], 'y-': [0, -1], 'y+': [0, 1] }[dir], h = D[0] ? hx : hy;
    let mejor = null;
    murosPlano().forEach(mu => {
      const ex = mu.b[0] - mu.a[0], ey = mu.b[1] - mu.a[1], den = D[0] * ey - D[1] * ex; if (Math.abs(den) < 1e-6) return;
      const t = ((mu.a[0] - o.cx) * ey - (mu.a[1] - o.cy) * ex) / den, u = ((mu.a[0] - o.cx) * D[1] - (mu.a[1] - o.cy) * D[0]) / den;
      if (t <= 0 || u < 0 || u > 1) return;
      const L = Math.hypot(ex, ey) || 1, seno = Math.abs((D[0] * ey - D[1] * ex) / L), cara = t - ((mu.t || 12) / 2) / Math.max(0.2, seno) - h;
      if (!mejor || cara < mejor.d) mejor = { d: cara, mu };
    });
    return mejor;
  };
  const setDistMuro = (o, dir, nueva) => {
    const r = distMuro(o, dir); if (!r) return; const delta = r.d - nueva;
    cambiar(o.id, { 'x-': { cx: o.cx - delta }, 'x+': { cx: o.cx + delta }, 'y-': { cy: o.cy - delta }, 'y+': { cy: o.cy + delta } }[dir]);
  };
  const objetivos = () => [
    ...objs.filter(x => x.id !== selObj && !['zona', 'falsotecho', 'barrido', 'carril', 'led'].includes(x.tipo)).map(x => ({ k: 'o:' + x.id, n: x.nombre || x.tipo, cx: x.cx, cy: x.cy, ...mitades(x) })),
    ...(api3d.current.modelo?.plantas || (api3d.current.modelo ? [api3d.current.modelo] : [])).flatMap(p => p.equipos || []).map(e => ({ k: 'e:' + e.id, n: (e.nombre || 'Máquina') + ' (plano)', cx: e.cx, cy: e.cy, ...mitades({ w: e.largo || e.w, d: e.fondo || e.d, rot: e.rot || 0 }) })),
  ];
  const colocarRespecto = (o) => {
    const T = objetivos().find(t => t.k === refObj); if (!T) return;
    const O = mitades(o), g = parseFloat(refGap) || 0;
    if (refEje === 'x') cambiar(o.id, { cx: o.cx <= T.cx ? T.cx - T.hx - g - O.hx : T.cx + T.hx + g + O.hx });
    else cambiar(o.id, { cy: o.cy <= T.cy ? T.cy - T.hy - g - O.hy : T.cy + T.hy + g + O.hy });
  };
  const pegarAPared = (o) => {
    let mejor = null;
    murosPlano().forEach(mu => {
      const ex = mu.b[0] - mu.a[0], ey = mu.b[1] - mu.a[1], L2 = ex * ex + ey * ey || 1, t = Math.max(0, Math.min(1, ((o.cx - mu.a[0]) * ex + (o.cy - mu.a[1]) * ey) / L2));
      const px = mu.a[0] + ex * t, py = mu.a[1] + ey * t, d = Math.hypot(o.cx - px, o.cy - py);
      if (!mejor || d < mejor.d) { const L = Math.sqrt(L2); let nx = -ey / L, ny = ex / L; if ((o.cx - px) * nx + (o.cy - py) * ny < 0) { nx = -nx; ny = -ny; } mejor = { d, mu, px, py, nx, ny }; }
    });
    if (!mejor) { setAviso('No hay muros para pegarlo.'); return; }
    const mitad = (mejor.mu.t || 12) / 2 + o.d / 2;
    cambiar(o.id, { cx: Math.round((mejor.px + mejor.nx * mitad) * 10) / 10, cy: Math.round((mejor.py + mejor.ny * mitad) * 10) / 10, rot: (Math.round(Math.atan2(-mejor.nx, mejor.ny) * 180 / Math.PI) + 360) % 360 });
  };
  const centrarEnSala = (o) => {
    const pl = (api3d.current.modelo?.plantas || (api3d.current.modelo ? [api3d.current.modelo] : []))[0];
    const sala = (pl?.salas || []).find(s => puntoEnPoligono([o.cx, o.cy], s.pts));
    if (!sala) { setAviso('El objeto no está dentro de ninguna sala.'); return; }
    const xs = sala.pts.map(p => p[0]), ys = sala.pts.map(p => p[1]);
    cambiar(o.id, { cx: Math.round((Math.min(...xs) + Math.max(...xs)) / 2), cy: Math.round((Math.min(...ys) + Math.max(...ys)) / 2) });
  };
  const repetir = (o) => {
    const n = Math.max(2, Math.min(60, parseInt(matrizN, 10) || 2)), copias = [];
    for (let i = 1; i < n; i++) copias.push({ ...o, id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) + i, cx: o.cx + (parseFloat(matrizDx) || 0) * i, cy: o.cy + (parseFloat(matrizDy) || 0) * i });
    setObjs(prev => [...prev, ...copias]);
  };
  const espejo = (o) => {
    const dx = parseFloat(matrizDx) || 100, c = { ...o, id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), cx: o.cx + dx, rot: (360 - (o.rot || 0)) % 360 };
    setObjs(prev => [...prev, c]); setSelObj(c.id);
  };
  const abrirDespiece = async () => {
    setMedAbierta(true); setMedFilas(null);
    try { const r = await api.get('/medicion/' + id + '/mediciones3d'); setMedFilas(r.data?.filas || []); } catch { setMedFilas([]); setAviso('No se pudo calcular el despiece'); }
  };
  const refrescarModelosEq = () => {
    api3d.current.raiz?.traverse(g => {
      if (!g.userData.equipo) return;
      g.children.filter(c => c.userData.modeloEq).forEach(c => { g.remove(c); c.traverse(x => { x.geometry?.dispose(); }); });
      g.userData.modeloCargado = false;
      if (g.userData.cuerpo) { g.userData.cuerpo.material.visible = true; g.userData.cuerpo.castShadow = true; }
    });
  };
  const asignarModeloEq = async (archivo) => {
    if (!archivo || !seleccion?.cid) return;
    if (/\.skp$/i.test(archivo.name)) { alert('Los archivos .skp de SketchUp no se pueden mostrar en el navegador. En SketchUp: Archivo → Exportar → Modelo 3D, y elige glTF (.glb) o COLLADA (.dae). Sube ese archivo.'); return; }
    setSubiendo('Subiendo el modelo…');
    try {
      const fd = new FormData(); fd.append('file', archivo);
      const r = await api.post('/catalog/products/' + seleccion.cid + '/modelo3d', fd), nuevo = r.data?.modelo3d;
      setBiblioteca(prev => (prev || []).map(m => (m.id === seleccion.cid ? { ...m, modelo3d: { url: nuevo.url, tipo: nuevo.tipo, rot: nuevo.rot } } : m)));
      refrescarModelosEq(); setSubiendo('Modelo asignado ✓ (se guarda en el producto del catálogo)');
    } catch (e) { setSubiendo(e.response?.data?.error || 'No se pudo subir el modelo (¿es un producto del catálogo?)'); }
  };
  const quitarModeloEq = async () => {
    try { await api.delete('/catalog/products/' + seleccion.cid + '/modelo3d'); setBiblioteca(prev => (prev || []).map(m => (m.id === seleccion.cid ? { ...m, modelo3d: null } : m))); refrescarModelosEq(); setSubiendo('Modelo quitado: vuelve a verse como caja'); }
    catch { setSubiendo('No se pudo quitar el modelo'); }
  };
  const girarModeloEq = async (rot) => {
    try { const r = await api.put('/catalog/products/' + seleccion.cid + '/modelo3d', { rot }); setBiblioteca(prev => (prev || []).map(m => (m.id === seleccion.cid && m.modelo3d ? { ...m, modelo3d: { ...m.modelo3d, rot: r.data.modelo3d.rot } } : m))); refrescarModelosEq(); }
    catch { setSubiendo('No se pudo girar el modelo'); }
  };
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

  // Vista general: restablece focal y desplazamiento de lente (si no, tras un alzado o con otra focal se veía deformada) y encuadra TODO el plano
  const vista = tipo => {
    const a = api3d.current, { cam, ctrl, raiz, esc } = a;
    if (alz) salirAlzado();
    cam.fov = 45; a.shiftY = 0; setShiftY(0); cam.updateProjectionMatrix();
    const b = new THREE.Box3().setFromObject(raiz), be = new THREE.Box3().setFromObject(esc); if (!be.isEmpty()) b.union(be);
    const vacio = b.isEmpty(), cen = vacio ? new THREE.Vector3(4, 1, 3) : b.getCenter(new THREE.Vector3()), tam = vacio ? new THREE.Vector3(8, 2.6, 6) : b.getSize(new THREE.Vector3());
    const tg = Math.tan((cam.fov * Math.PI) / 360), asp = cam.aspect || 1.6;
    ctrl.target.copy(cen);
    if (tipo === 'planta') { const h = Math.max((tam.z * 0.6) / tg, (tam.x * 0.6) / asp / tg); cam.position.set(cen.x, cen.y + h + tam.y, cen.z + 0.001); }
    else { const r = Math.max(2, 0.5 * Math.hypot(tam.x, tam.y, tam.z)), dist = (r / Math.sin((cam.fov * Math.PI) / 360)) * 1.02; cam.position.copy(cen).add(new THREE.Vector3(0.75, 0.6, 0.75).normalize().multiplyScalar(dist)); }
    ctrl.update();
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
  const [iaTxt, setIaTxt] = useState({ estancia: '', estilo: '', extra: '', libertad: 'equilibrado', proveedor: 'openai' });
  const metaActual = (txt = iaTxt) => {
    const { cam, ctrl } = api3d.current;
    return { camara: { px: cam.position.x, py: cam.position.y, pz: cam.position.z, tx: ctrl.target.x, ty: ctrl.target.y, tz: ctrl.target.z, fov: cam.fov }, shift: api3d.current.shiftY || 0, hora, exposicion: ambiente.exposicion, luces: ambiente.luces, estancia: txt.estancia, estilo: txt.estilo, extra: txt.extra, libertad: txt.libertad };
  };
  const salaBajoCamara = () => {
    const { cam } = api3d.current, m = api3d.current.modelo; if (!m) return '';
    for (const pl of (m.plantas || [m])) for (const s of (pl.salas || [])) if (s.nombre && puntoEnPoligono([cam.position.x / CM, cam.position.z / CM], s.pts)) return s.nombre;
    return '';
  };
  const abrirFormIA = () => { setIaTxt(t => ({ ...t, estancia: t.estancia || salaBajoCamara() })); setIaForm(true); };
  const restaurarVista = (meta) => {
    const { cam, ctrl } = api3d.current, c = meta?.camara; if (!c || c.px == null) return;
    cam.position.set(c.px, c.py, c.pz); ctrl.target.set(c.tx, c.ty, c.tz); if (c.fov) cam.fov = c.fov; api3d.current.shiftY = meta.shift || 0; setShiftY(meta.shift || 0); cam.updateProjectionMatrix(); ctrl.update();
    if (meta.hora != null) setHora(meta.hora);
    if (meta.exposicion != null) setAmbiente(a => ({ ...a, exposicion: meta.exposicion, luces: meta.luces ?? a.luces }));
  };
  const guardarRender = async (tipo, imagen, meta, nombre) => {
    try { const r = await api.post('/medicion/' + id + '/render', { imagen, tipo, nombre, meta }, { timeout: 120000 }); setRenders(x => [r.data.render, ...x]); setGuardado('Guardado en la galería ✓'); return r.data.render; }
    catch (e) { setAviso(e.response?.data?.error || 'No se pudo guardar en la galería'); return null; }
  };
  const hacer360 = () => {
    const a = api3d.current; setGenerando360(true);
    setTimeout(() => {
      try {
        const dir = new THREE.Vector3(); a.cam.getWorldDirection(dir);
        const url = capturarEquirect(a.renderer, a.scene, a.cam.position, Math.atan2(dir.x, dir.z), 1536, [a.gizmoG, a.cotasG, a.nodoG, a.guiaG, a.base ? null : null]);
        setPano({ url, guardado: false, meta: metaActual() });
      } catch (e) { setAviso('No se ha podido generar el panorama: ' + (e.message || 'error')); }
      setGenerando360(false);
    }, 60);
  };
  useEffect(() => {
    if (!pano || !panoCont.current) return;
    return abrirVisor360(panoCont.current, pano.url);
  }, [pano?.url]); // eslint-disable-line react-hooks/exhaustive-deps
  // Cámara: altura, inclinación, focal y desplazamiento de lente (para verticales rectas), con valores en vivo
  const camLee = () => {
    const { cam, ctrl } = api3d.current, d = new THREE.Vector3().subVectors(ctrl.target, cam.position);
    return { alt: Math.round(cam.position.y * 1000) / 10, pitch: Math.round(Math.atan2(d.y, Math.hypot(d.x, d.z)) * 1800 / Math.PI) / 10, f: Math.round(12 / Math.tan(cam.fov * Math.PI / 360)) };
  };
  useEffect(() => {
    if (!camAbierta) return;
    const f = () => { if (api3d.current.cam) setCamInfo(camLee()); }; f();
    const t = setInterval(f, 300); return () => clearInterval(t);
  }, [camAbierta]); // eslint-disable-line react-hooks/exhaustive-deps
  const camAltura = cm => { const { cam, ctrl } = api3d.current, dy = cm / 100 - cam.position.y; cam.position.y += dy; if (mantenerNivel) ctrl.target.y += dy; ctrl.update(); setCamInfo(camLee()); };
  const camNivelar = () => { const { cam, ctrl } = api3d.current; ctrl.target.y = cam.position.y; ctrl.update(); setCamInfo(camLee()); };
  const camPitch = g => { const { cam, ctrl } = api3d.current, h = Math.hypot(ctrl.target.x - cam.position.x, ctrl.target.z - cam.position.z) || 1; ctrl.target.y = cam.position.y + Math.tan(g * Math.PI / 180) * h; ctrl.update(); setCamInfo(camLee()); };
  const camFocal = f => { const { cam } = api3d.current; cam.fov = 2 * Math.atan(12 / f) * 180 / Math.PI; cam.updateProjectionMatrix(); setCamInfo(camLee()); };
  const camShift = v => { api3d.current.shiftY = v; setShiftY(v); api3d.current.cam.updateProjectionMatrix(); };
  // Entrar en un alzado (muro) o en una planta de detalle (suelo / techo): cámara casi ortogonal fija, fondo blanco, corte para ver solo esa parte y cotas
  const entrarAlzado = (tipo, idObj) => {
    const a = api3d.current, m = a.modelo; if (!m) return;
    const pl0 = (m.plantas || [m])[0], asp = a.cam.aspect || 1.6, VIS = 0.0873;
    let target, pos, lado = 1;
    if (tipo === 'muro') {
      const mu = (pl0.muros || []).find(x => x.id === idObj); if (!mu) return;
      const L = Math.hypot(mu.b[0] - mu.a[0], mu.b[1] - mu.a[1]), ux = (mu.b[0] - mu.a[0]) / L, uy = (mu.b[1] - mu.a[1]) / L, H = mu.h || pl0.altura || 260;
      lado = ((a.cam.position.x / CM - mu.a[0]) * -uy + (a.cam.position.z / CM - mu.a[1]) * ux) >= 0 ? 1 : -1;
      target = new THREE.Vector3(((mu.a[0] + ux * L / 2)) * CM, (H / 2) * CM, ((mu.a[1] + uy * L / 2)) * CM);
      const dist = Math.max(H * CM * 1.45, L * CM * 1.25 / asp) / VIS;
      pos = target.clone().add(new THREE.Vector3(-uy * lado, 0, ux * lado).multiplyScalar(dist));
      setProfAlz(120);
    } else {
      const sala = (pl0.salas || []).find((s, i) => (s.idS || ('s' + i)) === idObj); if (!sala) return;
      const xs = sala.pts.map(p => p[0]), ys = sala.pts.map(p => p[1]), W = Math.max(...xs) - Math.min(...xs), D = Math.max(...ys) - Math.min(...ys), H = pl0.altura || 260;
      target = new THREE.Vector3(((Math.min(...xs) + Math.max(...xs)) / 2) * CM, tipo === 'techo' ? H * CM : 0, ((Math.min(...ys) + Math.max(...ys)) / 2) * CM);
      const dist = Math.max(D * CM * 1.45, W * CM * 1.25 / asp) / VIS;
      pos = target.clone().add(new THREE.Vector3(0, tipo === 'techo' ? -dist : dist, 0.0001));
      setProfAlz(tipo === 'suelo' ? 100 : 60);
    }
    a.alzPrev = { pos: a.cam.position.clone(), target: a.ctrl.target.clone(), fov: a.cam.fov, bg: a.scene.background, shift: a.shiftY || 0 };
    a.shiftY = 0; a.cam.fov = 5; a.cam.updateProjectionMatrix(); a.cam.position.copy(pos); a.ctrl.target.copy(target); a.ctrl.enableRotate = false; a.ctrl.update();
    a.scene.background = new THREE.Color(0xffffff); if (a.base) a.base.visible = false;
    setSelAcab(null); setSelObj(null); setAlz({ tipo, id: idObj, lado });
  };
  const salirAlzado = () => {
    const a = api3d.current, p = a.alzPrev;
    if (p) { a.cam.fov = p.fov; a.shiftY = p.shift; a.cam.updateProjectionMatrix(); a.cam.position.copy(p.pos); a.ctrl.target.copy(p.target); a.scene.background = p.bg; }
    a.ctrl.enableRotate = true; if (a.base) a.base.visible = true; a.renderer.clippingPlanes = []; a.alzPrev = null; setAlz(null); a.ctrl.update();
  };
  // Zona por medidas: se escriben posición y tamaño exactos (cm) y se crea sobre el muro, el suelo o el techo que se está viendo
  const crearZonaMedidas = () => {
    const a = api3d.current, m = a.modelo, pl0 = m && (m.plantas || [m])[0]; if (!alz || !pl0) return;
    const X = parseFloat(zForm.x) || 0, Y = parseFloat(zForm.y) || 0, W = Math.max(1, parseFloat(zForm.w) || 100), Hh = Math.max(1, parseFloat(zForm.h) || 100);
    const col = matSel?.hex || (matSel?.id ? 'tex:' + matSel.id : '#c9b9a0');
    const forma = (cx0, cy0) => (zForm.forma === 'oval' ? Array.from({ length: 48 }, (_, i) => [cx0 + (W / 2) * Math.cos((i / 48) * 2 * Math.PI), cy0 + (Hh / 2) * Math.sin((i / 48) * 2 * Math.PI)]) : [[cx0 - W / 2, cy0 - Hh / 2], [cx0 + W / 2, cy0 - Hh / 2], [cx0 + W / 2, cy0 + Hh / 2], [cx0 - W / 2, cy0 + Hh / 2]]);
    const id2 = 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    if (alz.tipo === 'muro') {
      setObjs(prev => [...prev, { id: id2, tipo: 'zona', plano: 'pared', muroId: alz.id, lado: alz.lado, nombre: 'Zona de pared', etiqueta: 'Zonas', cx: 0, cy: 0, rot: 0, w: W, d: 1, alto: Hh, z0: 0, color: col, pts: forma(X + W / 2, Y + Hh / 2) }]);
    } else {
      const sala = (pl0.salas || []).find((s, i) => (s.idS || ('s' + i)) === alz.id); if (!sala) return;
      const bx0 = Math.min(...sala.pts.map(p => p[0])), by0 = Math.min(...sala.pts.map(p => p[1])), cx = bx0 + X + W / 2, cy = by0 + Y + Hh / 2;
      setObjs(prev => [...prev, { id: id2, tipo: 'zona', plano: alz.tipo, h: alz.tipo === 'techo' ? (pl0.altura || 260) : undefined, nombre: alz.tipo === 'techo' ? 'Zona de techo' : 'Zona de suelo', etiqueta: 'Zonas', cx, cy, rot: 0, w: W, d: Hh, alto: 1, z0: 0, color: col, pts: forma(0, 0) }]);
    }
    setSelObj(id2);
  };
  const esperar = ms => new Promise(r => setTimeout(r, ms));
  const ocultarAyudas = () => { const a = api3d.current, gs = [a.gizmoG, a.cotasG, a.nodoG, a.guiaG], v = gs.map(x => x && x.visible); gs.forEach(x => { if (x) x.visible = false; }); return () => gs.forEach((x, i) => { if (x) x.visible = v[i]; }); };
  const soltarSeleccion = async () => { setSelObj(null); setSelAcab(null); setSelHueco(null); setLuzSel(null); setSeleccion(null); api3d.current.limpiarSel?.(); await esperar(150); };
  const renderHDurl = async () => {
    await soltarSeleccion();
    const { renderer, scene, cam, sol } = api3d.current, el = caja.current, w0 = el.clientWidth, h0 = el.clientHeight, pr0 = renderer.getPixelRatio();
    const sombra = sol.castShadow, mapa = sol.shadow.mapSize.x, restaura = ocultarAyudas();
    try {
      const W = 3200, H = Math.round(W * h0 / w0);
      renderer.setPixelRatio(1); renderer.setSize(W, H, false); cam.aspect = W / H; cam.updateProjectionMatrix();
      renderer.shadowMap.enabled = true; sol.castShadow = true; sol.shadow.mapSize.set(4096, 4096); sol.shadow.map?.dispose(); sol.shadow.map = null; sol.shadow.radius = 4;
      renderer.render(scene, cam);
      return renderer.domElement.toDataURL('image/jpeg', 0.92);
    } finally {
      restaura(); renderer.setPixelRatio(pr0); renderer.setSize(w0, h0); cam.aspect = w0 / h0; cam.updateProjectionMatrix();
      sol.castShadow = sombra; sol.shadow.mapSize.set(mapa, mapa); sol.shadow.map?.dispose(); sol.shadow.map = null;
    }
  };
  // ov = textos concretos (estancia, estilo…) y opc.autoGuardar = guardar directamente en la galería (para las escenas)
  const renderIA = async (ov, opc = {}) => {
    const { renderer, scene, cam } = api3d.current, txt = ov && ov.estilo !== undefined ? ov : iaTxt;
    setIaForm(false); setIa({ estado: 'trabajando' });
    try {
      await soltarSeleccion();
      const el = caja.current, w0 = el.clientWidth, h0 = el.clientHeight, pr0 = renderer.getPixelRatio(), restaura = ocultarAyudas();
      const W = 2048, H = Math.round(W * h0 / w0);
      renderer.setPixelRatio(1); renderer.setSize(W, H, false); cam.aspect = W / H; cam.updateProjectionMatrix();
      renderer.render(scene, cam);
      const imagen = renderer.domElement.toDataURL('image/jpeg', 0.95);
      restaura(); renderer.setPixelRatio(pr0); renderer.setSize(w0, h0); cam.aspect = w0 / h0; cam.updateProjectionMatrix();
      const meta = metaActual(txt);
      const r = await api.post('/render-ia', { imagen, ...txt }, { timeout: 180000 });
      if (opc.autoGuardar) { await guardarRender('ia', r.data.imagen, meta, opc.nombre); setIa(null); return true; }
      setIa({ estado: 'listo', imagen: r.data.imagen, original: imagen, meta, guardado: false });
      return true;
    } catch (e) {
      setIa({ estado: 'error', mensaje: e.response?.data?.error || 'No se ha podido generar el render con IA' });
      return false;
    }
  };
  // ── Escenas: una vista guardada (cámara, hora, luces, capas visibles y textos de IA) a la que se vuelve y desde la que se renderiza
  const txtDe = e => ({ estancia: e.meta?.estancia || '', estilo: e.meta?.estilo || '', extra: e.meta?.extra || '', libertad: e.meta?.libertad || 'equilibrado', proveedor: iaTxt.proveedor });
  const irAEscena = async (e) => { restaurarVista(e.meta); setOcultas(e.ocultas || []); setIaTxt(t => ({ ...t, ...txtDe(e) })); await esperar(450); };
  const guardarEscena = () => { const nombre = (escNombre || '').trim() || ('Escena ' + (escenas.length + 1)); setEscenas(x => [...x, { id: 'e' + Date.now().toString(36), nombre, meta: metaActual(), ocultas }]); setEscNombre(''); };
  const actualizarEscena = id2 => { setEscenas(x => x.map(e => (e.id === id2 ? { ...e, meta: metaActual(), ocultas } : e))); setGuardado('Escena actualizada con la vista de ahora'); };
  const renderEscena = async (e, tipo) => {
    await irAEscena(e);
    if (tipo === 'ia') return renderIA(txtDe(e), { autoGuardar: true, nombre: e.nombre });
    try { const u = await renderHDurl(); const r = await guardarRender('hd', u, metaActual(txtDe(e)), e.nombre); return !!r; } catch { return false; }
  };
  const renderTodas = async (tipo) => {
    if (!escenas.length) return;
    if (!window.confirm(tipo === 'ia' ? 'Se generarán ' + escenas.length + ' renders con IA, uno por escena. Cada uno consume crédito de Gemini. ¿Continuar?' : 'Se generarán ' + escenas.length + ' renders HD, uno por escena, y se guardarán en la galería. ¿Continuar?')) return;
    for (let i = 0; i < escenas.length; i++) {
      setLote({ i: i + 1, n: escenas.length, tipo, nombre: escenas[i].nombre });
      const ok = await renderEscena(escenas[i], tipo);
      if (!ok && !window.confirm('No se ha podido hacer «' + escenas[i].nombre + '». ¿Continuar con las demás?')) break;
    }
    setLote(null); setGalAbierta(true); setAviso('Renders de las escenas terminados: están en la Galería.');
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
  // ── interfaz común: barra superior, carril de herramientas y menús
  const bTop = { background: '#333', color: '#fff', border: '1px solid #4a4a4a', borderRadius: 7, padding: '5px 10px', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' };
  const bOn = { background: '#2f6fa8', borderColor: '#2f6fa8' };
  const sepTop = { width: 1, height: 22, background: '#444', margin: '0 2px', flex: 'none' };
  const itemMenu = { padding: '6px 8px', cursor: 'pointer', borderRadius: 4 };
  const railBtn = (activo, icono, etiqueta, titulo, onClick, color) => (
    <button key={etiqueta} title={titulo} onClick={onClick} style={{ width: 50, padding: '3px 1px 2px', background: activo ? (color || '#2f6fa8') : 'transparent', color: activo && color === '#c9a21a' ? '#111' : '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
      <span style={{ fontSize: 16, lineHeight: '18px' }}>{icono}</span><span style={{ fontSize: 9, opacity: 0.85, whiteSpace: 'nowrap' }}>{etiqueta}</span>
    </button>
  );
  const grupoRail = (hijos, ultimo) => <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '2px 0 4px', marginBottom: ultimo ? 0 : 4, borderBottom: ultimo ? 'none' : '1px solid #3a3a3a' }}>{hijos}</div>;
  const menuRail = (abierto, setAbierto, boton, contenido, ancho) => <MenuRail key={'m' + (boton.key || '')} abierto={abierto} ancho={ancho} boton={boton}>{contenido}</MenuRail>;
  const AYUDA_HERR = {
    sel: null, caja: ['Caja', 'Arrastra sobre el suelo para dibujar el rectángulo'], poli: ['Contorno', 'Clic punto a punto; Enter o volver al primer punto para cerrar'], empujar: ['Empujar/Tirar', 'Arrastra la cara de arriba de un objeto'],
    muro: ['Muro', 'Clic para empezar y cada punto; Mayús = recto; Enter termina'], zonaS: ['Zona en suelo', 'Clic punto a punto; Enter cierra'], zonaT: ['Zona en techo', 'Clic punto a punto; Enter cierra'], zonaP: ['Zona en pared', 'Clic punto a punto sobre una pared; Enter cierra'],
    sigue: ['Sígueme', 'Dibuja el camino por donde pasará el perfil; Enter termina'], carril: ['Carril', 'Dibuja el recorrido; Enter termina'], led: ['Tira LED', 'Dibuja el recorrido; Enter termina'], focoC: ['Focos', 'Clic en el carril para colocar; Esc sale'],
    luz: ['Luz', 'Clic en el suelo para colocar la luminaria en el plano'], guia: ['Guía', 'Clic en dos puntos para crear una línea guía'], pincel: ['Pincel', 'Clic en lo que quieras pintar · Mayús = todo el elemento · Alt = copiar material'], gotero: ['Gotero', 'Clic en lo que quieras copiar'],
  };
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#eeeae5' }}>
      <div ref={caja} style={{ position: 'absolute', inset: 0, cursor: ['pincel', 'poli', 'caja', 'empujar', 'guia', 'luz', 'zonaS', 'zonaT', 'zonaP', 'sigue', 'muro', 'carril', 'focoC', 'gotero', 'led'].includes(herr) ? 'crosshair' : 'default' }} />
      {/* ── Barra superior: plano, historial, vistas, ambiente y salidas (render, 360, galería, despiece) ── */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 46, background: 'rgba(24,24,24,0.94)', color: '#fff', display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', zIndex: 7, boxShadow: '0 2px 10px rgba(0,0,0,0.25)', overflowX: 'auto' }}>
        <button style={bTop} onClick={() => (window.history.length > 1 ? navigate(-1) : window.close())}>← Volver</button>
        <b style={{ maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{titulo}</b>
        {guardado && guardado !== 'inicial' && <span style={{ opacity: 0.55, fontSize: 11, whiteSpace: 'nowrap' }}>{guardado}</span>}
        <span style={sepTop} />
        <button style={bTop} onClick={() => deshacer()} title="Deshacer (Ctrl+Z)">↶</button>
        <button style={bTop} onClick={() => rehacer()} title="Rehacer (Ctrl+Y)">↷</button>
        <span style={sepTop} />
        <button style={bTop} onClick={() => vista('persp')} title="Vista en perspectiva de todo el plano">Perspectiva</button>
        <button style={bTop} onClick={() => vista('planta')} title="Vista desde arriba">Planta</button>
        <button style={bTop} onClick={() => { const { cam, ctrl } = api3d.current; const dy = 1.6 - cam.position.y; cam.position.y = 1.6; ctrl.target.y += dy; ctrl.update(); }} title="Pone la cámara a la altura de los ojos (1,60 m): ideal antes de un render o un panorama">👁 Ojos</button>
        <button style={{ ...bTop, ...(ambAbierto ? bOn : {}) }} onClick={() => setAmbAbierto(v => !v)} title="Hora del sol, exposición e intensidad de las luces">☀ Ambiente</button>
        <button style={{ ...bTop, ...(camAbierta ? bOn : {}) }} onClick={() => setCamAbierta(v => !v)} title="Altura de la cámara, nivelarla, focal y verticales rectas">🎥 Cámara</button>
        <button style={{ ...bTop, ...(escAbierta ? bOn : {}) }} onClick={() => setEscAbierta(v => !v)} title="Escenas guardadas: vistas a las que volver y desde las que renderizar">🎬 Escenas{escenas.length ? ' (' + escenas.length + ')' : ''}</button>
        <span style={{ flex: 1, minWidth: 8 }} />
        <select style={bTop} value={calidad} onChange={e => setCalidad(e.target.value)} title="Si va lento, baja la calidad"><option value="baja">Calidad baja</option><option value="media">Calidad media</option><option value="alta">Calidad alta</option></select>
        <button style={bTop} onClick={captura} title="Guarda la vista actual como imagen">📷</button>
        <button style={bTop} onClick={async () => { setRenderizando(true); try { const u = await renderHDurl(); const el = document.createElement('a'); el.href = u; el.download = (titulo || 'plano') + '-render.jpg'; el.click(); } catch (e) { setAviso('No se ha podido generar el render: ' + (e.message || 'error')); } setRenderizando(false); }} disabled={renderizando || estado !== 'listo'} title="Render HD limpio (3200 px) con sombras suaves">{renderizando ? 'Renderizando…' : '🖼 Render HD'}</button>
        <button style={{ ...bTop, background: '#7a4fc4', borderColor: '#7a4fc4' }} onClick={abrirFormIA} disabled={estado !== 'listo' || ia?.estado === 'trabajando'} title="La IA convierte esta vista en una foto realista">✨ Render IA</button>
        <button style={bTop} onClick={hacer360} disabled={generando360 || estado !== 'listo'} title="Panorama 360° desde donde está la cámara ahora mismo">{generando360 ? 'Generando…' : '🌐 360°'}</button>
        <button style={{ ...bTop, ...(galAbierta ? bOn : {}) }} onClick={() => setGalAbierta(v => !v)} title="Renders y panoramas guardados">🖼 Galería{renders.length ? ' (' + renders.length + ')' : ''}</button>
        <button style={bTop} onClick={abrirDespiece} title="Despiece y cantidades de todo lo diseñado (también salen en «Desde planos» del presupuesto)">📋 Despiece</button>
        <button style={bTop} onClick={() => setAyudaAbierta(v => !v)} title="Atajos de teclado">?</button>
      </div>

      {/* ── Carril de herramientas (izquierda), agrupadas por tarea ── */}
      <div style={{ position: 'absolute', top: 54, left: 8, display: 'flex', flexDirection: 'column', flexWrap: 'wrap', alignContent: 'flex-start', gap: 0, width: railCols * 54, maxHeight: 'calc(100vh - 62px)', background: 'rgba(24,24,24,0.94)', borderRadius: 12, padding: '4px 2px', zIndex: 7, boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}>
        {grupoRail([
          railBtn(herr === 'sel', '↖', 'Seleccionar', 'Seleccionar y mover objetos (Espacio)', () => setHerr('sel')),
          railBtn(herr === 'pincel' || matAbierto, '🎨', 'Materiales', 'Colores, texturas y LED: elige y pinta (cara, pieza o entero)', () => { setMatAbierto(v => !v); if (matAbierto && herr === 'pincel') setHerr('sel'); }),
          railBtn(herr === 'gotero', '💧', 'Gotero', 'Copia el material de lo que toques y pásalo con el pincel (Alt + clic con el pincel)', () => setHerr('gotero')),
        ])}
        {grupoRail([
          railBtn(herr === 'muro', '🧱', 'Muro', 'Dibuja muros: clic para empezar y cada punto; Mayús = recto. Se crean también en Planos (6)', () => setHerr('muro')),
          railBtn(herr === 'caja', '▭', 'Caja', 'Arrastra sobre el suelo para dibujar una caja y luego dale altura (2)', () => setHerr('caja')),
          railBtn(herr === 'poli', '⬡', 'Contorno', 'Clic punto a punto sobre el suelo; cierra con Enter. Luego se extruye (3)', () => setHerr('poli')),
          railBtn(herr === 'empujar', '⇅', 'Empujar', 'Arrastra la cara de arriba de un objeto para cambiar su altura (4)', () => setHerr('empujar')),
          menuRail(zonaMenu, setZonaMenu, railBtn(['zonaS', 'zonaT', 'zonaP'].includes(herr) || zonaMenu, '▨', 'Zonas', 'Dibuja una forma sobre un suelo, techo o pared y dale su propio material', () => setZonaMenu(v => !v)), (<>
            {[['zonaS', 'En el suelo'], ['zonaT', 'En el techo'], ['zonaP', 'En una pared (o media pared)']].map(([h, n]) => <div key={h} onClick={() => { setHerr(h); setZonaMenu(false); }} style={itemMenu}>{n}</div>)}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderTop: '1px solid #333', cursor: 'pointer' }}><input type="checkbox" checked={curvo} onChange={e => setCurvo(e.target.checked)} /> Contorno curvo (suave)</label>
            <div style={{ opacity: 0.55, fontSize: 11, padding: '0 8px 4px' }}>Clic punto a punto; cierra con Enter o volviendo al primer punto.</div>
          </>)),
          menuRail(sigueMenu, setSigueMenu, railBtn(herr === 'sigue' || sigueMenu, '➰', 'Sígueme', 'Un perfil recorre un camino: rodapiés, molduras, tubos, bandejas…', () => setSigueMenu(v => !v)), (<>
            <div style={{ opacity: 0.6, fontSize: 11, padding: '2px 8px' }}>Elige el perfil y dibuja el camino en el suelo (Enter termina; volver al primer punto cierra en lazo)</div>
            {Object.keys(PERFILES).map(n => <div key={n} onClick={() => { setPerfilSel(n); setHerr('sigue'); setSigueMenu(false); }} style={{ ...itemMenu, background: perfilSel === n ? '#2a3a52' : 'transparent' }}>{n}</div>)}
          </>)),
        ])}
        {grupoRail([
          railBtn(bibAbierta, '📦', 'Catálogo', 'Tus productos del catálogo de Ranuse', () => setBibAbierta(v => !v)),
          railBtn(b3dAbierta, '🧰', 'Biblioteca', 'Muebles y texturas gratuitos (Poly Haven, CC0)', () => setB3dAbierta(v => !v)),
          menuRail(muebleMenu, setMuebleMenu, railBtn(muebleMenu, '🪑', 'A medida', 'Muebles a medida por módulos', () => setMuebleMenu(v => !v)), (<>
            {Object.keys(PLANTILLAS_MUEBLE).map(n => <div key={n} onClick={() => crearMueble(n)} style={itemMenu}>{n}</div>)}
          </>), 250),
          railBtn(false, '🖼', 'Logo', 'Sube un logo en SVG (o DXF con contornos cerrados) y se convierte en 3D', () => logoInput.current?.click()),
        ])}
        {grupoRail([
          menuRail(carrilMenu, setCarrilMenu, railBtn(['luz', 'carril', 'led', 'focoC'].includes(herr) || carrilMenu, '💡', 'Iluminación', 'Luminarias, spots, tiras LED y carriles con focos', () => setCarrilMenu(v => !v), '#c9a21a'), (<>
            <div style={{ opacity: 0.6, fontSize: 11, padding: '2px 8px' }}>Luminarias (se crean también en Planos)</div>
            {[['foco', 'Foco empotrado'], ['spot', 'Spot orientable'], ['plaf', 'Plafón'], ['colg', 'Luminaria colgante'], ['aplq', 'Aplique de pared'], ['pie', 'Lámpara de pie'], ['suel', 'Empotrado de suelo']].map(([k, n]) => <div key={k} onClick={() => { setKindLuz(k); setHerr('luz'); setCarrilMenu(false); }} style={itemMenu}>{n}</div>)}
            <div style={{ opacity: 0.6, fontSize: 11, padding: '6px 8px 2px', borderTop: '1px solid #333', marginTop: 4 }}>Luz lineal</div>
            <div onClick={() => { setHerr('led'); setCarrilMenu(false); }} style={itemMenu} title="Cinta LED que sigue un recorrido y alumbra hacia abajo, arriba o a un lado">Tira LED</div>
            <div style={{ opacity: 0.6, fontSize: 11, padding: '6px 8px 2px', borderTop: '1px solid #333', marginTop: 4 }}>Carriles (después se les añaden spots, lineales, proyectores o colgantes)</div>
            {[['magnetico', 'Carril magnético (48 V, ultrafino)'], ['trifasico', 'Carril trifásico (230 V)']].map(([v, n]) => <div key={v} onClick={() => { setCarrilSis(v); setHerr('carril'); setCarrilMenu(false); }} style={itemMenu}>{n}</div>)}
          </>), 270),
        ])}
        {grupoRail([
          railBtn(herr === 'guia', '📏', 'Guía', 'Clic en dos puntos para crear una línea guía; el dibujo se imanta a ellas (5)', () => setHerr('guia'), '#d62bd6'),
          railBtn(capasAbierto, '🏷', 'Capas', 'Mostrar u ocultar muros, suelos, techos, plantas y etiquetas', () => setCapasAbierto(v => !v)),
        ], true)}
        <input ref={logoInput} type="file" accept=".svg,.dxf" style={{ display: 'none' }} onChange={e => { importarLogo(e.target.files?.[0]); e.target.value = ''; }} />
      </div>

      {/* ── Barra de opciones de la herramienta activa ── */}
      {AYUDA_HERR[herr] && (
        <div style={{ position: 'absolute', top: 56, left: '50%', transform: 'translateX(-50%)', background: 'rgba(24,24,24,0.94)', color: '#fff', borderRadius: 18, padding: '5px 14px', fontSize: 12, display: 'flex', gap: 10, alignItems: 'center', zIndex: 6, maxWidth: '70vw', boxShadow: '0 2px 10px rgba(0,0,0,0.25)' }}>
          <b>{AYUDA_HERR[herr][0]}</b><span style={{ opacity: 0.75 }}>{AYUDA_HERR[herr][1]}</span>
          {herr === 'muro' && <><select value={grosorMuro} onChange={e => setGrosorMuro(parseInt(e.target.value, 10))} style={bTop} title="Grosor del muro">{[7, 10, 12, 15, 20, 25, 30].map(g => <option key={g} value={g}>{g} cm</option>)}</select>{medidaMuro && <b style={{ color: '#6fb3ff' }}>{medidaMuro}</b>}</>}
          {herr === 'luz' && <select value={kindLuz} onChange={e => setKindLuz(e.target.value)} style={bTop}><option value="foco">Foco empotrado</option><option value="spot">Spot orientable</option><option value="plaf">Plafón</option><option value="colg">Colgante</option><option value="aplq">Aplique</option><option value="pie">Lámpara de pie</option><option value="suel">Empotrado de suelo</option></select>}
          {herr === 'focoC' && <select value={kindFoco} onChange={e => setKindFoco(e.target.value)} style={bTop}>{Object.entries(TIPOS_FOCO).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>}
          {herr === 'pincel' && <span style={{ opacity: 0.9 }}>Modo: <b>{modoPincel === 'cara' ? 'Cara' : modoPincel === 'pieza' ? 'Pieza' : 'Entero'}</b></span>}
          {herr === 'guia' && guias.length > 0 && <button style={bTop} onClick={() => setGuias([])}>✕ Quitar guías ({guias.length})</button>}
          {['poli', 'zonaS', 'zonaT', 'zonaP'].includes(herr) && <select value={formaDib} onChange={e => setFormaDib(e.target.value)} style={bTop} title="Forma que se dibuja"><option value="poli">Polígono (clic a clic)</option><option value="rect">Rectángulo (2 clics)</option><option value="oval">Óvalo (2 clics)</option></select>}
          {['poli', 'zonaS', 'zonaT', 'zonaP', 'muro', 'sigue', 'carril', 'led', 'guia', 'luz'].includes(herr) && <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} title="Atrae el dibujo a paredes, esquinas, vértices y guías. Desmárcalo para dibujar libre, sin conectar"><input type="checkbox" checked={imanActivo} onChange={e => setImanActivo(e.target.checked)} /> Imán</label>
            <select value={gridCm} onChange={e => setGridCm(parseFloat(e.target.value))} style={bTop} title="Salto de la rejilla al dibujar"><option value={1}>1 cm</option><option value={5}>5 cm</option><option value={10}>10 cm</option><option value={50}>50 cm</option></select>
          </>}
        </div>
      )}
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
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <span style={{ opacity: 0.7 }}>Motor de imagen</span>
              <select value={iaTxt.proveedor || 'openai'} onChange={e => setIaTxt(t => ({ ...t, proveedor: e.target.value }))} style={btn}>
                <option value="openai">ChatGPT (OpenAI)</option>
                <option value="gemini">Gemini (Google)</option>
              </select>
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
              <button style={btn} onClick={() => setIaForm(false)}>Cancelar</button>
              <button style={{ ...btn, background: '#7a4fc4', borderColor: '#7a4fc4' }} onClick={() => renderIA()}>Generar</button>
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
                <button style={{ ...btn, background: ia.guardado ? '#2a6b3a' : '#7a4fc4', borderColor: 'transparent' }} disabled={ia.guardado} onClick={async () => { const r = await guardarRender('ia', ia.imagen, ia.meta); if (r) setIa(x => ({ ...x, guardado: true })); }}>{ia.guardado ? 'Guardado en la galería ✓' : '⭐ Guardar en la galería'}</button>
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
          <div style={{ position: 'absolute', left: railW, top: 56, width: 210, background: 'rgba(20,20,20,0.94)', color: '#fff', borderRadius: 8, padding: '10px 12px', fontSize: 13, zIndex: 3 }}>
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
            {(api3d.current.modelo?.plantas || []).length > 1 && <div style={{ borderTop: '1px solid #333', marginTop: 6, paddingTop: 6 }}><div style={{ opacity: 0.7, marginBottom: 2 }}>Plantas</div>{api3d.current.modelo.plantas.map((pl, i) => fila('planta:' + i, pl.nombre || ('Planta ' + (i + 1))))}</div>}
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
            {spot && <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}><span style={{ width: 90, opacity: 0.7 }}>Apertura del haz</span><input type="range" min="10" max="120" value={ap} onChange={e => setLucesAj(a => ({ ...a, [l.id]: { ...(a[l.id] || {}), ap: parseInt(e.target.value, 10) } }))} style={{ flex: 1 }} /><span style={{ width: 34 }}>{ap}°</span></label>}
            {(l.kid === 'foco' || l.kid === 'plaf') && <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 90, opacity: 0.7 }}>Tipo de foco</span>
                <select value={lucesAj[l.id]?.v || ''} onChange={e => setLucesAj(a => ({ ...a, [l.id]: { ...(a[l.id] || {}), ap: a[l.id]?.ap ?? 60, v: e.target.value || undefined, tilt: a[l.id]?.tilt ?? 25, yaw: a[l.id]?.yaw ?? 0 } }))} style={btn}>
                  <option value="">{l.kid === 'plaf' ? 'Plafón fijo' : 'Empotrado fijo'}</option><option value="gimbal">Empotrado orientable</option><option value="spot">Spot de superficie</option><option value="proy">Proyector</option>
                </select></label>
              {lucesAj[l.id]?.v && <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 90, opacity: 0.7 }}>Inclinación °</span><input type="number" step="5" value={lucesAj[l.id]?.tilt ?? 25} onChange={e => setLucesAj(a => ({ ...a, [l.id]: { ...(a[l.id] || {}), tilt: parseFloat(e.target.value) || 0 } }))} style={{ ...btn, width: 70 }} /></label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 90, opacity: 0.7 }}>Giro °</span><input type="number" step="15" value={lucesAj[l.id]?.yaw ?? 0} onChange={e => setLucesAj(a => ({ ...a, [l.id]: { ...(a[l.id] || {}), yaw: parseFloat(e.target.value) || 0 } }))} style={{ ...btn, width: 70 }} /></label>
              </>}
            </>}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 90, opacity: 0.7 }}>Temperatura</span>
              <select value={String(lucesAj[l.id]?.k ?? (cat?.k || 3000))} onChange={e => setLucesAj(a => ({ ...a, [l.id]: { ...(a[l.id] || {}), ap: a[l.id]?.ap ?? 60, k: parseInt(e.target.value, 10) } }))} style={btn}>{[2200, 2700, 3000, 3500, 4000, 5000, 6500].map(k => <option key={k} value={k}>{k} K{k <= 2700 ? ' cálida' : k >= 5000 ? ' fría' : ''}</option>)}{![2200, 2700, 3000, 3500, 4000, 5000, 6500].includes(lucesAj[l.id]?.k ?? (cat?.k || 3000)) && <option value={lucesAj[l.id]?.k ?? (cat?.k || 3000)}>{lucesAj[l.id]?.k ?? (cat?.k || 3000)} K</option>}</select>
              <span style={{ width: 14, height: 14, borderRadius: 7, background: kelvinHex(lucesAj[l.id]?.k ?? (cat?.k || 3000)), border: '1px solid #666' }} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 90, opacity: 0.7 }}>Lúmenes</span><input type="number" step="50" value={lucesAj[l.id]?.lm ?? (cat?.lm || 800)} onChange={e => setLucesAj(a => ({ ...a, [l.id]: { ...(a[l.id] || {}), ap: a[l.id]?.ap ?? 60, lm: parseFloat(e.target.value) || 0 } }))} style={{ ...btn, width: 80 }} /></label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}><span style={{ width: 90, opacity: 0.7 }}>Altura (cm)</span><input type="number" defaultValue={Math.round(l.h != null ? l.h : ({ foco: 255, plaf: 255, colg: 200, aplq: 180, pie: 120, suel: 5 }[l.kid] ?? 250))} onBlur={e => api.patch('/medicion/' + id + '/luminaria/' + l.id, { h: e.target.value }).then(() => { setAviso('Altura guardada en el plano ✓. Si tienes Planos abierto, recárgalo.'); api3d.current.recargar?.(); }).catch(() => setAviso('No se pudo cambiar la altura'))} style={{ ...btn, width: 80 }} /></label>
            <div style={{ opacity: 0.5, fontSize: 11, marginBottom: 8 }}>El ángulo de apertura se guarda en el 3D; la altura y la posición se guardan también en el plano.</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={{ ...btn, background: '#7a2b2b' }} onClick={() => api.delete('/medicion/' + id + '/luminaria/' + l.id).then(() => { setLuzSel(null); setAviso('Luminaria quitada del plano ✓. Si tienes Planos abierto, recárgalo.'); api3d.current.recargar?.(); }).catch(() => setAviso('No se pudo quitar'))}>Quitar</button>
              <button style={btn} onClick={() => setLuzSel(null)}>Cerrar</button>
            </div>
          </div>
        );
      })()}
      {pano && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 10, display: 'flex', flexDirection: 'column', padding: 12, gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#fff', flexWrap: 'wrap' }}>
            <b style={{ flex: 1 }}>🌐 Panorama 360° <span style={{ fontWeight: 400, opacity: 0.6, fontSize: 12 }}>arrastra para mirar alrededor · rueda para acercar</span></b>
            {!pano.guardado && !pano.id && <button style={{ ...btn, background: '#7a4fc4' }} onClick={async () => { const r = await guardarRender('360', pano.url, pano.meta); if (r) setPano(p => ({ ...p, guardado: true })); }}>⭐ Guardar en la galería</button>}
            {pano.guardado && <span style={{ color: '#7bd88f' }}>Guardado ✓</span>}
            <a style={{ ...btn, textDecoration: 'none' }} href={pano.url} download={(titulo || 'plano') + '-panorama-360.jpg'}>Descargar</a>
            <button style={btn} onClick={() => setPano(null)}>Cerrar</button>
          </div>
          <div ref={panoCont} style={{ flex: 1, minHeight: 0, borderRadius: 8, overflow: 'hidden', background: '#000' }} />
          <div style={{ color: '#fff', opacity: 0.5, fontSize: 11 }}>La imagen descargada es un panorama equirrectangular estándar: se abre en cualquier visor 360 (Facebook, Google Fotos, Kuula, etc.).</div>
        </div>
      )}
      {escAbierta && (
        <div style={{ position: 'absolute', right: 12, top: 56, bottom: 12, width: 330, background: 'rgba(24,24,24,0.95)', color: '#fff', borderRadius: 10, padding: 10, overflow: 'auto', fontSize: 13, zIndex: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>🎬 Escenas <span style={{ fontWeight: 400, opacity: 0.55, fontSize: 11 }}>vistas guardadas</span></div>
          <div style={{ opacity: 0.6, fontSize: 11, marginBottom: 8 }}>Una escena recuerda la cámara, la hora, las luces, las capas visibles y los textos de la IA. Colócate, ponle nombre y guárdala: luego vuelves a ella o la renderizas.</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <input value={escNombre} onChange={e => setEscNombre(e.target.value)} placeholder="Nombre (ej. Salón desde la entrada)" onKeyDown={e => { if (e.key === 'Enter') guardarEscena(); }} style={{ ...btn, flex: 1, minWidth: 0 }} />
            <button style={{ ...btn, background: '#2f6fa8' }} onClick={guardarEscena} title="Guarda la vista actual como escena">＋ Guardar</button>
          </div>
          {!escenas.length && <p style={{ opacity: 0.65 }}>Aún no hay escenas.</p>}
          {escenas.map(e => (
            <div key={e.id} style={{ borderTop: '1px solid #333', padding: '8px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input defaultValue={e.nombre} key={e.id + e.nombre} onBlur={ev => { if (ev.target.value !== e.nombre) setEscenas(x => x.map(y => (y.id === e.id ? { ...y, nombre: ev.target.value } : y))); }} style={{ ...btn, flex: 1, padding: '3px 6px', fontWeight: 700 }} />
                <span onClick={() => { if (window.confirm('¿Borrar la escena «' + e.nombre + '»?')) setEscenas(x => x.filter(y => y.id !== e.id)); }} style={{ cursor: 'pointer', opacity: 0.6, padding: '0 4px' }} title="Borrar">✕</span>
              </div>
              <div style={{ opacity: 0.6, fontSize: 11, margin: '3px 0 5px' }}>{e.meta?.estancia ? e.meta.estancia + ' · ' : ''}{e.meta?.hora != null ? e.meta.hora + ' h' : ''}{(e.ocultas || []).length ? ' · ' + e.ocultas.length + ' capa(s) oculta(s)' : ''}</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <button style={{ ...btn, padding: '3px 9px' }} onClick={() => irAEscena(e)}>Ir a la escena</button>
                <button style={{ ...btn, padding: '3px 9px' }} onClick={() => actualizarEscena(e.id)} title="Sustituye la escena por la vista de ahora">Actualizar</button>
                <button style={{ ...btn, padding: '3px 9px', background: '#7a4fc4' }} disabled={!!lote} onClick={() => renderEscena(e, 'ia')} title="Va a la escena y genera el render con IA, que se guarda en la galería">✨ IA</button>
                <button style={{ ...btn, padding: '3px 9px' }} disabled={!!lote} onClick={() => renderEscena(e, 'hd')} title="Va a la escena y guarda un render HD en la galería">🖼 HD</button>
              </div>
            </div>
          ))}
          {escenas.length > 1 && (
            <div style={{ borderTop: '1px solid #333', paddingTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button style={{ ...btn, background: '#7a4fc4' }} disabled={!!lote} onClick={() => renderTodas('ia')}>✨ Todas con IA ({escenas.length})</button>
              <button style={btn} disabled={!!lote} onClick={() => renderTodas('hd')}>🖼 Todas en HD</button>
            </div>
          )}
          {lote && <div style={{ marginTop: 8, color: '#8fb8de' }}>Renderizando {lote.i} de {lote.n}: {lote.nombre}…</div>}
        </div>
      )}
      {galAbierta && (
        <div style={{ position: 'absolute', right: 12, top: 56, bottom: 12, width: 330, background: 'rgba(24,24,24,0.95)', color: '#fff', borderRadius: 10, padding: 10, overflow: 'auto', fontSize: 13, zIndex: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>🖼 Galería <span style={{ fontWeight: 400, opacity: 0.55, fontSize: 11 }}>renders y panoramas guardados</span></div>
          {!renders.length && <p style={{ opacity: 0.65 }}>Aún no has guardado ninguno. Genera un render con IA o un panorama 360° y pulsa «Guardar en la galería»: se guarda con la vista, la hora y los textos con los que lo hiciste.</p>}
          {renders.map(rd => (
            <div key={rd.id} style={{ borderTop: '1px solid #333', paddingTop: 8, marginTop: 8 }}>
              <img src={rd.thumb} alt={rd.nombre} onClick={() => (rd.tipo === '360' ? setPano({ url: rd.url, guardado: true, id: rd.id, meta: rd.meta }) : setVerRender(rd))} style={{ width: '100%', borderRadius: 6, cursor: 'pointer', display: 'block' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <input defaultValue={rd.nombre} key={rd.id + rd.nombre} onBlur={e => { if (e.target.value !== rd.nombre) api.patch('/medicion/' + id + '/render/' + rd.id, { nombre: e.target.value }).then(r => setRenders(x => x.map(y => (y.id === rd.id ? r.data.render : y)))).catch(() => setAviso('No se pudo renombrar')); }} style={{ ...btn, flex: 1, padding: '2px 6px' }} />
                <span style={{ opacity: 0.55, fontSize: 10 }}>{rd.tipo === '360' ? '360°' : rd.tipo === 'hd' ? 'HD' : 'IA'}</span>
              </div>
              <div style={{ opacity: 0.6, fontSize: 11, marginTop: 2 }}>{new Date(rd.creado).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}{rd.meta?.estancia ? ' · ' + rd.meta.estancia : ''}{rd.meta?.estilo ? ' · ' + rd.meta.estilo : ''}</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                <button style={{ ...btn, padding: '2px 8px' }} onClick={() => { restaurarVista(rd.meta); setAviso('Vista restaurada: cámara, hora y luces como cuando se hizo.'); }} title="Vuelve a la cámara, la hora y las luces de ese render">Ir a esta vista</button>
                {rd.tipo === 'ia' && <button style={{ ...btn, padding: '2px 8px' }} onClick={() => { restaurarVista(rd.meta); setIaTxt(t => ({ ...t, estancia: rd.meta?.estancia || '', estilo: rd.meta?.estilo || '', extra: rd.meta?.extra || '', libertad: rd.meta?.libertad || 'equilibrado' })); setIaForm(true); }} title="Vuelve a esa vista con los mismos textos y lo prepara para generar otro">Repetir con IA</button>}
                <a style={{ ...btn, padding: '2px 8px', textDecoration: 'none' }} href={rd.url} download={rd.nombre + '.jpg'}>Descargar</a>
                <button style={{ ...btn, padding: '2px 8px', background: '#7a2b2b' }} onClick={() => { if (window.confirm('¿Borrar «' + rd.nombre + '» de la galería?')) api.delete('/medicion/' + id + '/render/' + rd.id).then(() => setRenders(x => x.filter(y => y.id !== rd.id))).catch(() => setAviso('No se pudo borrar')); }}>Borrar</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {verRender && (
        <div onClick={() => setVerRender(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 10, display: 'grid', placeItems: 'center', padding: 16, cursor: 'zoom-out' }}>
          <img src={verRender.url} alt={verRender.nombre} style={{ maxWidth: '94vw', maxHeight: '90vh', borderRadius: 6 }} />
        </div>
      )}
      {medAbierta && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'grid', placeItems: 'center', zIndex: 9, padding: 16 }}>
          <div style={{ background: '#1d1d1d', color: '#fff', borderRadius: 10, padding: 16, width: 'min(720px, 94vw)', maxHeight: '88vh', overflow: 'auto', fontSize: 13 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}><b style={{ fontSize: 15, flex: 1 }}>📋 Despiece y cantidades del 3D</b><button style={btn} onClick={abrirDespiece}>Actualizar</button><button style={btn} onClick={() => setMedAbierta(false)}>Cerrar</button></div>
            {!medFilas && <p style={{ opacity: 0.7 }}>Calculando…</p>}
            {medFilas && !medFilas.length && <p style={{ opacity: 0.7 }}>Todavía no hay nada diseñado en el 3D que se pueda medir (muebles a medida, carriles, zonas, molduras, logos, objetos o acabados).</p>}
            {medFilas && medFilas.length > 0 && <>
              {[...new Set(medFilas.map(f => f.grupo))].map(gr => (
                <div key={gr} style={{ marginBottom: 10 }}>
                  <div style={{ fontWeight: 700, color: '#8fb8de', marginBottom: 2 }}>{gr}</div>
                  {medFilas.filter(f => f.grupo === gr).map((f, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, padding: '3px 0', borderTop: '1px solid #2a2a2a' }}>
                      <div style={{ flex: 1 }}>{f.nombre}{f.detalle && <div style={{ opacity: 0.55, fontSize: 11 }}>{f.detalle}</div>}{f.acabado && <div style={{ opacity: 0.55, fontSize: 11 }}>Acabado: {f.acabado}</div>}</div>
                      <div style={{ width: 90, textAlign: 'right' }}>{f.cantidad} {f.unidad}</div>
                    </div>
                  ))}
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <button style={btn} onClick={() => { const t = medFilas.map(f => [f.grupo, f.nombre, f.cantidad, f.unidad, f.detalle || ''].join('\t')).join('\n'); navigator.clipboard?.writeText(t); setGuardado('Copiado'); }}>Copiar</button>
                <button style={btn} onClick={() => { const csv = ['Grupo;Concepto;Cantidad;Unidad;Detalle', ...medFilas.map(f => [f.grupo, f.nombre, String(f.cantidad).replace('.', ','), f.unidad, f.detalle || ''].map(x => '"' + String(x).replace(/"/g, '""') + '"').join(';'))].join('\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })); a.download = (titulo || 'plano') + '-despiece-3d.csv'; a.click(); }}>Descargar CSV</button>
              </div>
              <div style={{ opacity: 0.5, fontSize: 11, marginTop: 6 }}>Estas mismas cantidades salen en «Desde planos» al crear un presupuesto. Los muebles y acabados del catálogo salen con su precio.</div>
            </>}
          </div>
        </div>
      )}
      {alz && (
        <div style={{ position: 'absolute', left: '50%', bottom: 12, transform: 'translateX(-50%)', background: 'rgba(24,24,24,0.96)', color: '#fff', borderRadius: 12, padding: '8px 14px', fontSize: 12, zIndex: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.35)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', maxWidth: '96vw' }}>
          <b style={{ fontSize: 13 }}>📐 {alz.tipo === 'muro' ? 'Alzado del muro' : alz.tipo === 'suelo' ? 'Planta del suelo' : 'Planta del techo'}</b>
          <label title={alz.tipo === 'muro' ? 'Hasta qué distancia delante del muro se ven los objetos (muebles, máquinas…)' : alz.tipo === 'suelo' ? 'Altura del corte horizontal' : 'Hasta cuántos cm bajo el techo se ve'}>Corte <input type="number" value={profAlz} onChange={e => setProfAlz(parseFloat(e.target.value) || 100)} style={{ ...btn, width: 62, padding: '2px 6px' }} /> cm</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} title="Atrae el dibujo a esquinas, bordes de huecos y vértices. Desmárcalo para dibujar libre"><input type="checkbox" checked={imanActivo} onChange={e => setImanActivo(e.target.checked)} /> Imán</label>
          <select value={gridCm} onChange={e => setGridCm(parseFloat(e.target.value))} style={{ ...btn, padding: '2px 6px' }} title="Salto de la rejilla"><option value={1}>1 cm</option><option value={5}>5 cm</option><option value={10}>10 cm</option></select>
          <span style={{ width: 1, height: 20, background: '#444' }} />
          <b>Zona por medidas</b>
          <select value={zForm.forma} onChange={e => setZForm(f => ({ ...f, forma: e.target.value }))} style={{ ...btn, padding: '2px 6px' }}><option value="rect">Rectángulo</option><option value="oval">Óvalo</option></select>
          {[['x', alz.tipo === 'muro' ? 'desde inicio' : 'desde esquina X'], ['y', alz.tipo === 'muro' ? 'desde suelo' : 'desde esquina Y'], ['w', 'ancho'], ['h', 'alto']].map(([k, et]) => <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 3 }}><span style={{ opacity: 0.65 }}>{et}</span><input type="number" value={zForm[k]} onChange={e => setZForm(f => ({ ...f, [k]: e.target.value }))} style={{ ...btn, width: 58, padding: '2px 5px' }} /></label>)}
          <button style={{ ...btn, background: '#2f6fa8' }} onClick={crearZonaMedidas} title="Crea la zona con el material que tengas elegido en 🎨 Materiales (o beige si no hay ninguno)">＋ Crear zona</button>
          <span style={{ width: 1, height: 20, background: '#444' }} />
          <button style={btn} onClick={async () => { try { const u = await renderHDurl(); const el = document.createElement('a'); el.href = u; el.download = (titulo || 'plano') + '-' + alz.tipo + '-' + alz.id + '.jpg'; el.click(); } catch (e) { setAviso('No se ha podido generar la lámina: ' + (e.message || 'error')); } }} title="Guarda esta vista con todas sus cotas como imagen">⬇ Lámina</button>
          <button style={{ ...btn, background: '#7a2b2b' }} onClick={salirAlzado}>Salir (Esc)</button>
          <div style={{ flexBasis: '100%', opacity: 0.55, fontSize: 11 }}>Medidas en cm. Dibuja con las herramientas normales (▨ Zonas, 🎨 pincel…): al ser una vista de frente, todo cae exactamente donde haces clic. Rueda para acercar, arrastrar con el botón central o derecho para desplazarte.</div>
        </div>
      )}
      {camAbierta && camInfo && (
        <div style={{ position: 'absolute', top: 56, left: railW + 6, width: 300, background: 'rgba(24,24,24,0.96)', color: '#fff', borderRadius: 10, padding: '10px 14px', fontSize: 13, zIndex: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}>
          <div style={{ fontWeight: 700, marginBottom: 6, display: 'flex', alignItems: 'center' }}><span style={{ flex: 1 }}>🎥 Cámara</span><span onClick={() => setCamAbierta(false)} style={{ cursor: 'pointer', opacity: 0.6 }}>✕</span></div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 110, opacity: 0.75 }}>Altura (cm)</span><input type="number" step="5" value={camInfo.alt} onChange={e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) camAltura(Math.max(5, v)); }} style={{ ...btn, width: 80 }} /></label>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
            {[[160, 'De pie'], [120, 'Sentado'], [90, 'Mesa'], [400, 'Alta'], [900, 'Dron']].map(([v, n]) => <button key={v} style={{ ...btn, padding: '2px 8px', fontSize: 11 }} onClick={() => camAltura(v)}>{n} {v}</button>)}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, cursor: 'pointer', fontSize: 12 }}><input type="checkbox" checked={mantenerNivel} onChange={e => setMantenerNivel(e.target.checked)} /> Al cambiar la altura, mantener la inclinación</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 110, opacity: 0.75 }}>Inclinación °</span><input type="number" step="1" value={camInfo.pitch} onChange={e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) camPitch(Math.max(-89, Math.min(89, v))); }} style={{ ...btn, width: 80 }} /><button style={{ ...btn, padding: '3px 8px', background: '#2f6fa8' }} onClick={camNivelar} title="Pone la cámara a nivel: mira al horizonte, sin subir ni bajar">Nivelar</button></label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 110, opacity: 0.75 }}>Focal (mm)</span><input type="range" min="12" max="70" value={Math.max(12, Math.min(70, camInfo.f))} onChange={e => camFocal(parseInt(e.target.value, 10))} style={{ flex: 1 }} /><span style={{ width: 36, textAlign: 'right' }}>{camInfo.f}</span></label>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>{[[16, 'Muy ancha'], [24, 'Ancha'], [35, 'Normal'], [50, 'Corta']].map(([v, n]) => <button key={v} style={{ ...btn, padding: '2px 8px', fontSize: 11 }} onClick={() => camFocal(v)} title={n}>{v}</button>)}</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 110, opacity: 0.75 }}>Verticales rectas</span><input type="range" min="-0.5" max="0.5" step="0.01" value={shiftY} onChange={e => camShift(parseFloat(e.target.value))} style={{ flex: 1 }} /><button style={{ ...btn, padding: '2px 8px', fontSize: 11 }} onClick={() => camShift(0)}>0</button></label>
          <div style={{ opacity: 0.55, fontSize: 11 }}>Para fotos de interior: <b>nivela</b> la cámara (horizonte recto) y usa «Verticales rectas» para encuadrar más arriba o más abajo sin inclinarla, así las paredes no se «caen». El horizonte nunca se ladea. La altura, la focal y el desplazamiento se guardan en las escenas.</div>
        </div>
      )}
      {ambAbierto && (
        <div style={{ position: 'absolute', top: 56, left: '50%', transform: 'translateX(-50%)', width: 300, background: 'rgba(20,20,20,0.95)', color: '#fff', borderRadius: 8, padding: '10px 14px', fontSize: 13, zIndex: 6 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>☀ Ambiente</div>
          {[['Hora del sol', hora, 6, 21, 0.5, v => setHora(v), hora + ':00'.slice(0, 0) + ' h'], ['Exposición', ambiente.exposicion, 0.3, 2.5, 0.05, v => setAmbiente(a => ({ ...a, exposicion: v })), ambiente.exposicion.toFixed(2)], ['Intensidad luces', ambiente.luces, 0.2, 4, 0.1, v => setAmbiente(a => ({ ...a, luces: v })), '×' + ambiente.luces.toFixed(1)]].map(([n, v, mn, mx, st, fn, tx]) => (
            <label key={n} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 100, opacity: 0.75 }}>{n}</span><input type="range" min={mn} max={mx} step={st} value={v} onChange={e => fn(parseFloat(e.target.value))} style={{ flex: 1 }} /><span style={{ width: 44, textAlign: 'right' }}>{tx}</span></label>
          ))}
          <div style={{ borderTop: '1px solid #333', margin: '6px 0', paddingTop: 6 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, cursor: 'pointer' }}><input type="checkbox" checked={ambiente.kLuces != null} onChange={e => setAmbiente(a => ({ ...a, kLuces: e.target.checked ? 3000 : null }))} /> Misma temperatura para todas las luces</label>
            {ambiente.kLuces != null && <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 100, opacity: 0.75 }}>Temperatura</span><input type="range" min="2200" max="6500" step="100" value={ambiente.kLuces} onChange={e => setAmbiente(a => ({ ...a, kLuces: parseInt(e.target.value, 10) }))} style={{ flex: 1 }} /><span style={{ width: 52, textAlign: 'right' }}>{ambiente.kLuces} K</span><span style={{ width: 14, height: 14, borderRadius: 7, background: kelvinHex(ambiente.kLuces), border: '1px solid #666' }} /></label>}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, cursor: 'pointer' }}><input type="checkbox" checked={ambiente.kSol != null} onChange={e => setAmbiente(a => ({ ...a, kSol: e.target.checked ? 5500 : null }))} /> Temperatura del sol manual</label>
            {ambiente.kSol != null && <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 100, opacity: 0.75 }}>Sol</span><input type="range" min="3000" max="8000" step="100" value={ambiente.kSol} onChange={e => setAmbiente(a => ({ ...a, kSol: parseInt(e.target.value, 10) }))} style={{ flex: 1 }} /><span style={{ width: 52, textAlign: 'right' }}>{ambiente.kSol} K</span></label>}
            <div style={{ opacity: 0.5, fontSize: 11 }}>Sin marcar, cada luz usa su propia temperatura (la de su luminaria, carril o tira LED) y el sol cambia con la hora.</div>
          </div>
          <div style={{ opacity: 0.5, fontSize: 11 }}>Si las luces se ven muy fuertes o muy flojas, ajusta «Intensidad luces». La exposición aclara u oscurece toda la escena.</div>
        </div>
      )}
      {ayudaAbierta && (
        <div style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', width: 420, background: 'rgba(20,20,20,0.95)', color: '#fff', borderRadius: 8, padding: '10px 14px', fontSize: 12, zIndex: 6, lineHeight: 1.6 }}>
          <b>Atajos</b> <span style={{ opacity: 0.6 }}>(no funcionan escribiendo en un campo)</span><br />
          <b>Ctrl+Z</b> deshacer · <b>Ctrl+Y</b> rehacer · <b>Supr</b> borrar · <b>Ctrl+D</b> duplicar · <b>R</b> girar 90°<br />
          <b>Flechas</b> mover 5 cm (con Mayús 50) · <b>Re Pág / Av Pág</b> subir/bajar<br />
          <b>W A S D</b> moverse (delante, atrás, lados) · <b>Q / E</b> bajar / subir · <b>Mayús</b> más rápido<br /><b>1</b> mover · <b>2</b> caja · <b>3</b> contorno · <b>4</b> empujar · <b>5</b> guía · <b>6</b> muro · <b>7</b> luz · <b>Esc</b> deseleccionar (o cancelar lo que estés dibujando) · <b>Espacio</b> herramienta Seleccionar
        </div>
      )}
      {aviso && (
        <div style={{ position: 'absolute', top: 56, left: '50%', transform: 'translateX(-50%)', maxWidth: 560, background: 'rgba(20,20,20,0.95)', color: '#fff', borderRadius: 8, padding: '8px 12px', fontSize: 13, zIndex: 7, display: 'flex', gap: 10, alignItems: 'center' }}>
          <span>{aviso}</span><button style={btn} onClick={() => setAviso('')}>OK</button>
        </div>
      )}
      {selHueco && (
        <div style={{ position: 'absolute', right: 12, top: 56, width: 250, background: 'rgba(20,20,20,0.94)', color: '#fff', borderRadius: 8, padding: '12px 14px', fontSize: 13 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{selHueco.tipo === 'door' ? 'Puerta' : selHueco.tipo === 'win' ? 'Ventana' : 'Hueco'} del plano</div>
          {[['w', 'Ancho'], ['h', 'Alto'], ['sill', selHueco.tipo === 'door' ? 'Altura suelo' : 'Antepecho'], ['p', 'Posición']].map(([k, et]) => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ width: 70, opacity: 0.7 }}>{et} cm</span>
              <input type="number" value={selHueco.nuevo[k]} onChange={e => setSelHueco(s => ({ ...s, nuevo: { ...s.nuevo, [k]: e.target.value } }))} style={{ ...btn, width: 90 }} />
            </label>
          ))}
          {(() => {
            const esP = selHueco.tipo === 'door', key = selHueco.id || (selHueco.muroId + ':' + selHueco.p), c = huecosCfg[key] || { abierta: 0, bisagra: 'izq', sentido: 'A' }, set = n => setHuecosCfg(t => ({ ...t, [key]: { ...c, ...n } }));
            const tip = selHueco.nuevo.tip || (esP ? 'Abatible' : 'Practicable'), tips = esP ? DOOR_TIPS : WIN_TIPS, corredera = /corredera|seccional|enrollable|plegable|basculante/i.test(tip);
            return (
              <div style={{ borderBottom: '1px solid #333', marginBottom: 6, paddingBottom: 6 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 70, opacity: 0.7 }}>Tipo</span>
                  <select value={tip} onChange={e => setSelHueco(s => ({ ...s, nuevo: { ...s.nuevo, tip: e.target.value } }))} style={btn}>{[...new Set([...tips, tip])].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
                {esP && <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 70, opacity: 0.7 }}>Hoja</span>
                  <select value={selHueco.nuevo.mat || ''} onChange={e => setSelHueco(s => ({ ...s, nuevo: { ...s.nuevo, mat: e.target.value || undefined } }))} style={btn}><option value="">(la del plano)</option>{DOOR_MATS.map(n => <option key={n} value={n}>{n}</option>)}</select></label>}
                {tip !== 'Hueco' && tip !== 'Fija' && <>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 70, opacity: 0.7 }}>{corredera ? 'Abierta %' : 'Abierta °'}</span><input type="range" min="0" max={corredera ? 100 : 110} value={c.abierta || 0} onChange={e => set({ abierta: parseInt(e.target.value, 10) })} style={{ flex: 1 }} /><span style={{ width: 34, textAlign: 'right' }}>{c.abierta || 0}</span></label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 70, opacity: 0.7 }}>Bisagra</span>
                    <select value={c.bisagra || 'izq'} onChange={e => set({ bisagra: e.target.value })} style={btn}><option value="izq">Izquierda</option><option value="der">Derecha</option></select>
                    <select value={c.sentido || 'A'} onChange={e => set({ sentido: e.target.value })} style={btn} title="Hacia qué lado del muro abre"><option value="A">Abre al lado A</option><option value="B">Abre al lado B</option></select></label>
                </>}
                <div style={{ opacity: 0.5, fontSize: 11 }}>El tipo y la hoja se escriben en el plano al pulsar «Aplicar al plano». La apertura es solo para verla en el 3D.</div>
              </div>
            );
          })()}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6, fontSize: 12 }}>
            <span style={{ opacity: 0.7 }}>Subir / bajar {selHueco.tipo === 'door' ? 'la puerta' : 'la ventana'}</span>
            {[[-10, '−10'], [-5, '−5'], [5, '+5'], [10, '+10']].map(([d, n]) => <button key={d} style={{ ...btn, padding: '2px 7px', fontSize: 11 }} onClick={() => setSelHueco(s => ({ ...s, nuevo: { ...s.nuevo, sill: Math.max(0, (parseFloat(s.nuevo.sill) || 0) + d) } }))}>{n}</button>)}
          </div>
          {(() => {
            const key = selHueco.id || (selHueco.muroId + ':' + selHueco.p), c = tapetas[key] || { on: false, ancho: 7, vuelo: 1.2, lados: 'ambos', alfeizar: false }, set = n => setTapetas(t => ({ ...t, [key]: { ...c, ...n } }));
            return (
              <div style={{ borderTop: '1px solid #333', margin: '4px 0 6px', paddingTop: 6 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, cursor: 'pointer', fontWeight: 700 }}><input type="checkbox" checked={!!c.on} onChange={e => set({ on: e.target.checked })} /> Tapetas</label>
                {c.on && <>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}><span style={{ width: 90, opacity: 0.7 }}>Ancho cm</span><input type="number" step="0.5" value={c.ancho} onChange={e => set({ ancho: parseFloat(e.target.value) || 7 })} style={{ ...btn, width: 70 }} /></label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}><span style={{ width: 90, opacity: 0.7 }}>Vuelo cm</span><input type="number" step="0.2" value={c.vuelo} onChange={e => set({ vuelo: parseFloat(e.target.value) || 1.2 })} style={{ ...btn, width: 70 }} /></label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}><span style={{ width: 90, opacity: 0.7 }}>En</span><select value={c.lados} onChange={e => set({ lados: e.target.value })} style={btn}><option value="ambos">Ambos lados</option><option value="a">Un lado (A)</option><option value="b">El otro lado (B)</option></select></label>
                  {selHueco.tipo === 'win' && <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, cursor: 'pointer' }}><input type="checkbox" checked={!!c.alfeizar} onChange={e => set({ alfeizar: e.target.checked })} /> Con alféizar</label>}
                  <div style={{ opacity: 0.5, fontSize: 11 }}>Para darles otro color o material, usa el pincel 🎨 sobre la tapeta. Salen en el despiece (metros lineales).</div>
                </>}
              </div>
            );
          })()}
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
          <div style={{ position: 'absolute', left: railW, top: 56, bottom: 12, width: 270, background: 'rgba(20,20,20,0.94)', color: '#fff', borderRadius: 8, padding: 10, overflow: 'auto', fontSize: 13, zIndex: 3 }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>🎨 Materiales (pincel)</div>
            <div style={{ opacity: 0.65, fontSize: 11, marginBottom: 6 }}>Elige un material y haz clic en lo que quieras pintar. Alt + clic copia el material de lo que toques (gotero).</div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
              {[['cara', 'Cara'], ['pieza', 'Pieza'], ['todo', 'Entero']].map(([v, n]) => <button key={v} style={{ ...btn, flex: 1, ...(modoPincel === v ? { background: '#2f6fa8' } : {}) }} onClick={() => setModoPincel(v)}>{n}</button>)}
            </div>
            <div style={{ opacity: 0.6, fontSize: 11, marginBottom: 6 }}>{modoPincel === 'cara' ? 'Cara: pinta solo la superficie que tocas (el asiento de un sillón, un lado de una pared, una chapa de una máquina), hasta donde llegue la curva suave.' : modoPincel === 'pieza' ? 'Pieza: pinta la parte completa (todo el muro, toda una pieza del modelo).' : 'Entero: pinta todo el elemento (todos los muros, todo el mueble…).'}</div>
            {modoPincel === 'cara' && <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 95, opacity: 0.7 }}>Sensibilidad</span><input type="range" min="5" max="75" value={angCara} onChange={e => setAngCara(parseInt(e.target.value, 10))} style={{ flex: 1 }} /><span style={{ width: 34 }}>{angCara}°</span></label>
              <div style={{ opacity: 0.5, fontSize: 11, marginBottom: 4 }}>Baja el número si la pintura se «escapa» a otras caras; súbelo si deja trozos sin pintar.</div>
              {Object.keys(acab.regiones || {}).length > 0 && <button style={{ ...btn, marginBottom: 8 }} onClick={() => { if (window.confirm('¿Quitar la pintura de todas las caras?')) setAcab(a => ({ ...a, regiones: {} })); }}>Quitar pintura de caras ({Object.values(acab.regiones).reduce((s, l) => s + l.length, 0)})</button>}
            </>}
            <div style={{ opacity: 0.7, marginBottom: 4 }}>Colores</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
              {base.map(c => <span key={c} onClick={() => elegir({ hex: c })} title={c} style={{ width: 24, height: 24, background: c, borderRadius: 4, cursor: 'pointer', border: esSel({ hex: c }) ? '2px solid #4da3ff' : '1px solid #555' }} />)}
            </div>
            <div style={{ opacity: 0.7, marginBottom: 4 }}>💡 Luz LED (material emisivo)</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 4 }}>
              {[['#ffa757', '2700 K cálida'], ['#ffb16e', '3000 K'], ['#ffcb9f', '4000 K neutra'], ['#ffe4ce', '5000 K'], ['#fff9fd', '6500 K fría'], ['#ff2a2a', 'Rojo'], ['#22ff66', 'Verde'], ['#2a5bff', 'Azul'], ['#ff2ad4', 'Magenta'], ['#2affea', 'Cian']].map(([h, n]) => <span key={h} onClick={() => elegir({ hex: h + '!' })} title={'LED ' + n} style={{ width: 24, height: 24, background: h, borderRadius: 12, cursor: 'pointer', boxShadow: '0 0 8px ' + h, border: esSel({ hex: h + '!' }) ? '2px solid #4da3ff' : '1px solid #555' }} />)}
            </div>
            <div style={{ opacity: 0.5, fontSize: 11, marginBottom: 8 }}>Pinta con ellos una cara, una caja o una zona y se ilumina. Una <b>caja</b> o una <b>zona</b> LED además alumbra la sala.</div>
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
            {matSel?.id && (() => {
              const t = texturas.find(x => x.id === matSel.id); if (!t) return null;
              const guarda = (junta, tam) => api.patch('/medicion/' + id + '/textura/' + t.id, { junta, tam }).then(r => setTexturas(xs => xs.map(x => (x.id === t.id ? r.data.textura : x)))).catch(() => setGuardado('No se pudo cambiar la textura'));
              return (
                <div style={{ borderTop: '1px solid #333', marginTop: 10, paddingTop: 8 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>Textura elegida: {t.nombre}</div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 90, opacity: 0.7 }}>Tamaño real cm</span><input key={'tam' + t.id + t.tam} id="tx-tam" type="number" defaultValue={t.tam} style={{ ...btn, width: 70 }} /></label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 90, opacity: 0.7 }}>Junta (color)</span><input key={'jc' + t.id + (t.junta?.hex || '')} id="tx-jc" type="color" defaultValue={t.junta?.hex || '#bdbdbd'} /></label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}><span style={{ width: 90, opacity: 0.7 }}>Junta (mm)</span><input key={'jm' + t.id + (t.junta?.mm || 0)} id="tx-jm" type="number" step="0.5" defaultValue={t.junta?.mm || 0} style={{ ...btn, width: 70 }} /></label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button style={{ ...btn, background: '#2f6fa8' }} onClick={() => guarda({ hex: document.getElementById('tx-jc').value, mm: parseFloat(document.getElementById('tx-jm').value) || 0 }, parseFloat(document.getElementById('tx-tam').value) || t.tam)}>Aplicar</button>
                    <button style={btn} onClick={() => guarda(null, parseFloat(document.getElementById('tx-tam').value) || t.tam)}>Sin junta</button>
                  </div>
                  <div style={{ opacity: 0.5, fontSize: 11, marginTop: 4 }}>La junta sirve para baldosas, azulejos y microlosetas: la foto debe ser UNA pieza y el tamaño real, lo que mide esa pieza.</div>
                </div>
              );
            })()}
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
              {esMuro && <button style={{ ...btn, background: '#2f6fa8' }} onClick={() => entrarAlzado('muro', selAcab.id)} title="Vista de frente de este muro solo, con todas sus medidas, para dibujar y marcar con precisión">📐 Alzado de este muro</button>}
              {!esMuro && <button style={{ ...btn, background: '#2f6fa8' }} onClick={() => entrarAlzado('suelo', selAcab.id)} title="Vista desde arriba de este suelo solo, con sus medidas">📐 Planta del suelo</button>}
              {!esMuro && <button style={{ ...btn, background: '#2f6fa8' }} onClick={() => entrarAlzado('techo', selAcab.id)} title="Vista del techo desde abajo, con sus medidas">📐 Planta del techo</button>}
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
          <div style={{ position: 'absolute', left: railW, top: 56, bottom: 12, width: 270, background: 'rgba(20,20,20,0.94)', color: '#fff', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', fontSize: 13, zIndex: 3 }}>
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
        <div style={{ position: 'absolute', left: railW, top: 56, bottom: 12, width: 270, background: 'rgba(20,20,20,0.94)', color: '#fff', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', fontSize: 13 }}>
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
          {[['cx', 'Posición X'], ['cy', 'Posición Y'], ['w', 'Largo'], ['d', 'Fondo'], ['alto', 'Alto'], ['z0', 'Altura desde suelo'], ['rot', 'Giro °']].filter(([k]) => {
            const t = objSel.tipo;
            if (t === 'mueble' && k === 'w') return false;
            if (t === 'zona' && objSel.plano === 'pared') return false;
            if (['zona', 'falsotecho', 'barrido', 'carril', 'led'].includes(t)) return k === 'cx' || k === 'cy' || ((t === 'barrido' || t === 'carril' || t === 'led') && k === 'z0');
            if (t === 'logo' && ['w', 'd', 'alto'].includes(k)) return false;
            return true;
          }).map(([k, et]) => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ width: 70, opacity: 0.7 }}>{et}</span>
              <input type="number" value={Math.round(objSel[k] * 10) / 10} onChange={e => cambiar(objSel.id, { [k]: parseFloat(e.target.value) || 0 })} style={{ ...btn, width: 90 }} />
            </label>
          ))}
          {!['zona', 'falsotecho', 'barrido', 'carril', 'led'].includes(objSel.tipo) && (
            <div style={{ borderTop: '1px solid #333', margin: '6px 0', paddingTop: 6 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Distancias hasta el muro (cm)</div>
              {[['x-', '← izquierda'], ['x+', '→ derecha'], ['y-', '↑ arriba'], ['y+', '↓ abajo']].map(([dir, et]) => { const r = distMuro(objSel, dir); return (
                <label key={dir + objSel.id + Math.round(objSel.cx) + Math.round(objSel.cy) + Math.round(objSel.rot || 0)} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <span style={{ width: 90, opacity: 0.7 }}>{et}</span>
                  <input type="number" disabled={!r} defaultValue={r ? Math.round(r.d * 10) / 10 : ''} placeholder="sin muro" onBlur={e => { if (r && e.target.value !== '') setDistMuro(objSel, dir, parseFloat(e.target.value)); }} style={{ ...btn, width: 80 }} />
                </label>
              ); })}
              <div style={{ opacity: 0.5, fontSize: 11, marginBottom: 6 }}>Mide desde el borde del objeto hasta la cara del muro. Escribe otro valor y el objeto se mueve.</div>
              <details>
                <summary style={{ cursor: 'pointer', opacity: 0.85 }}>Distancia a otro objeto</summary>
                <div style={{ marginTop: 4 }}>
                  <select value={refObj} onChange={e => setRefObj(e.target.value)} style={{ ...btn, width: '100%', marginBottom: 4 }}><option value="">Elige el objeto de referencia…</option>{objetivos().map(t => <option key={t.k} value={t.k}>{t.n}</option>)}</select>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                    <select value={refEje} onChange={e => setRefEje(e.target.value)} style={btn}><option value="x">En horizontal (X)</option><option value="y">En vertical (Y)</option></select>
                    <input type="number" value={refGap} onChange={e => setRefGap(e.target.value)} style={{ ...btn, width: 70 }} title="Separación entre bordes (cm)" /><span style={{ opacity: 0.7 }}>cm</span>
                  </div>
                  {(() => { const T = objetivos().find(t => t.k === refObj); if (!T) return null; const O = mitades(objSel), ahora = refEje === 'x' ? Math.abs(objSel.cx - T.cx) - T.hx - O.hx : Math.abs(objSel.cy - T.cy) - T.hy - O.hy; return <div style={{ opacity: 0.65, fontSize: 11, marginBottom: 4 }}>Ahora hay {Math.round(ahora * 10) / 10} cm entre bordes.</div>; })()}
                  <button style={{ ...btn, background: '#2f6fa8' }} disabled={!refObj} onClick={() => colocarRespecto(objSel)}>Colocar a esa distancia</button>
                </div>
              </details>
              <details style={{ marginTop: 4 }}>
                <summary style={{ cursor: 'pointer', opacity: 0.85 }}>Otras formas de colocar</summary>
                <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <button style={btn} onClick={() => pegarAPared(objSel)} title="Lo apoya contra el muro más cercano, con la parte de atrás hacia el muro">Pegar a la pared más cercana</button>
                  <button style={btn} onClick={() => centrarEnSala(objSel)}>Centrar en su sala</button>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }}>
                    <span style={{ opacity: 0.7 }}>Repetir</span><input type="number" value={matrizN} onChange={e => setMatrizN(e.target.value)} style={{ ...btn, width: 44, padding: '2px 4px' }} />
                    <span style={{ opacity: 0.7 }}>cada X</span><input type="number" value={matrizDx} onChange={e => setMatrizDx(e.target.value)} style={{ ...btn, width: 54, padding: '2px 4px' }} />
                    <span style={{ opacity: 0.7 }}>Y</span><input type="number" value={matrizDy} onChange={e => setMatrizDy(e.target.value)} style={{ ...btn, width: 54, padding: '2px 4px' }} />
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}><button style={btn} onClick={() => repetir(objSel)}>Repetir en fila</button><button style={btn} onClick={() => espejo(objSel)} title="Copia simétrica a la distancia X indicada">Copia espejo (X)</button></div>
                </div>
              </details>
            </div>
          )}
          {['zona', 'prisma', 'falsotecho'].includes(objSel.tipo) && Array.isArray(objSel.pts) && (() => {
            const pared = objSel.tipo === 'zona' && objSel.plano === 'pared', off = pared ? [0, 0] : [objSel.cx, objSel.cy];
            const setPt = (i, k, v) => setObjs(prev => prev.map(x => (x.id === objSel.id ? { ...x, pts: x.pts.map((q, j) => (j === i ? (k === 0 ? [v - off[0], q[1]] : [q[0], v - off[1]]) : q)) } : x)));
            return (
              <div style={{ borderTop: '1px solid #333', margin: '6px 0', paddingTop: 6 }}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>Vértices (cm)</div>
                <div style={{ opacity: 0.55, fontSize: 11, marginBottom: 4 }}>{pared ? 'Desde el inicio del muro y desde el suelo.' : 'Coordenadas en el plano.'} Arrastra las bolas azules; clic en una verde añade un vértice a ese lado.</div>
                {objSel.pts.map((p, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                    <b style={{ width: 16, fontSize: 11 }}>{i + 1}</b>
                    <input type="number" value={Math.round((p[0] + off[0]) * 10) / 10} onChange={e => setPt(i, 0, parseFloat(e.target.value) || 0)} style={{ ...btn, width: 68, padding: '2px 4px' }} />
                    <input type="number" value={Math.round((p[1] + off[1]) * 10) / 10} onChange={e => setPt(i, 1, parseFloat(e.target.value) || 0)} style={{ ...btn, width: 68, padding: '2px 4px' }} />
                    <span onClick={() => { if (objSel.pts.length > 3) setObjs(prev => prev.map(x => (x.id === objSel.id ? { ...x, pts: x.pts.filter((_, j) => j !== i) } : x))); }} style={{ cursor: objSel.pts.length > 3 ? 'pointer' : 'default', opacity: objSel.pts.length > 3 ? 0.7 : 0.25, padding: '0 4px' }} title="Quitar vértice">✕</span>
                  </div>
                ))}
                <button style={{ ...btn, marginTop: 4 }} onClick={() => setObjs(prev => prev.map(x => { if (x.id !== objSel.id) return x; const A = x.pts[x.pts.length - 1], B = x.pts[0]; return { ...x, pts: [...x.pts, [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2]] }; }))}>＋ Añadir vértice</button>
              </div>
            );
          })()}
          {objSel.tipo === 'led' && (() => {
            const Lk = objSel.led || { ancho: 1.2, k: 3000, lm: 800, dir: 'abajo' }, set = c => cambiar(objSel.id, { led: { ...Lk, ...c } }), ml = largoCamino(objSel.pts || []) / 100;
            return (
              <div style={{ borderTop: '1px solid #333', margin: '6px 0', paddingTop: 6 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Tira LED · {ml.toFixed(2)} m</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 90, opacity: 0.7 }}>Temperatura</span><select value={Lk.k} onChange={e => set({ k: parseInt(e.target.value, 10) })} style={btn}><option value={2700}>2700 K cálida</option><option value={3000}>3000 K</option><option value={4000}>4000 K neutra</option><option value={5000}>5000 K</option><option value={6500}>6500 K fría</option></select></label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 90, opacity: 0.7 }}>Lúmenes / m</span><input type="number" step="50" value={Lk.lm} onChange={e => set({ lm: parseFloat(e.target.value) || 800 })} style={{ ...btn, width: 80 }} /></label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 90, opacity: 0.7 }}>Ancho cm</span><input type="number" step="0.2" value={Lk.ancho} onChange={e => set({ ancho: parseFloat(e.target.value) || 1 })} style={{ ...btn, width: 80 }} /></label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 90, opacity: 0.7 }}>Alumbra hacia</span><select value={Lk.dir || 'abajo'} onChange={e => set({ dir: e.target.value })} style={btn}><option value="abajo">Abajo</option><option value="arriba">Arriba (techo)</option><option value="izq">Lado izquierdo</option><option value="der">Lado derecho</option></select></label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, cursor: 'pointer' }}><input type="checkbox" checked={!!Lk.cerrado} onChange={e => set({ cerrado: e.target.checked })} /> Cerrar en lazo</label>
                <div style={{ opacity: 0.5, fontSize: 11 }}>La «Altura desde suelo» de arriba es dónde va la tira. Sale en el despiece con su fuente de alimentación. Si alumbra poco o demasiado, ajusta «Intensidad luces» en ☀ Ambiente.</div>
              </div>
            );
          })()}
          {objSel.tipo === 'caja' && esLed(objSel.color) && (
            <div style={{ borderTop: '1px solid #333', margin: '6px 0', paddingTop: 6 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 90, opacity: 0.7 }}>Alumbra hacia</span><select value={objSel.ledDir || 'abajo'} onChange={e => cambiar(objSel.id, { ledDir: e.target.value })} style={btn}><option value="abajo">Abajo</option><option value="arriba">Arriba</option><option value="frente">Frente</option><option value="atras">Atrás</option><option value="izq">Izquierda</option><option value="der">Derecha</option></select></label>
              <div style={{ opacity: 0.5, fontSize: 11, marginTop: 2 }}>Este objeto es un material LED y emite luz: úsalo para paneles luminosos, cajones de luz o rótulos.</div>
            </div>
          )}
          {objSel.tipo === 'carril' && (() => {
            const F = objSel.focos || [], L = Math.round(largoCamino(objSel.pts || []));
            const setFoco = (fid, c) => cambiar(objSel.id, { focos: F.map(f => (f.id === fid ? { ...f, ...c } : f)) });
            const resumen = Object.entries(F.reduce((m, f) => { m[f.t] = (m[f.t] || 0) + 1; return m; }, {}));
            const num = (v, fn, w = 60, st = 1) => <input type="number" step={st} value={v} onChange={e => fn(parseFloat(e.target.value) || 0)} style={{ ...btn, width: w, padding: '2px 4px' }} />;
            return (
              <div style={{ borderTop: '1px solid #333', margin: '6px 0', paddingTop: 6 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Carril · {L} cm ({(L / 100).toFixed(2)} m)</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 70, opacity: 0.7 }}>Sistema</span><select value={objSel.sistema || 'magnetico'} onChange={e => cambiar(objSel.id, { sistema: e.target.value })} style={btn}><option value="magnetico">Magnético</option><option value="trifasico">Trifásico</option></select></label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, cursor: 'pointer' }}><input type="checkbox" checked={!!objSel.suspendido} onChange={e => cambiar(objSel.id, { suspendido: e.target.checked })} /> Suspendido con cables</label>
                <div style={{ display: 'flex', gap: 6, margin: '6px 0', flexWrap: 'wrap' }}>
                  <select value={kindFoco} onChange={e => setKindFoco(e.target.value)} style={btn}>{Object.entries(TIPOS_FOCO).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
                  <button style={{ ...btn, background: '#c9a21a', borderColor: '#c9a21a', color: '#111' }} onClick={() => setHerr('focoC')} title="Haz clic en el carril las veces que quieras">+ Añadir con clic</button>
                  <button style={btn} onClick={() => { const t = kindFoco, foco = { id: 'f' + Date.now().toString(36), t, s: Math.round(L / 2), yaw: 0, tilt: t === 'lineal' || t === 'colgante' ? 0 : 20, lm: FOCO_DEF[t].lm, k: 3000, ap: FOCO_DEF[t].ap, largo: FOCO_DEF[t].largo || 60 }; cambiar(objSel.id, { focos: [...F, foco] }); }}>+ Al centro</button>
                </div>
                {F.map((f, i) => (
                  <div key={f.id} style={{ background: '#2a2a2a', borderRadius: 6, padding: 6, marginBottom: 5, fontSize: 12 }}>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 3 }}>
                      <b style={{ width: 18 }}>{i + 1}</b>
                      <select value={f.t} onChange={e => setFoco(f.id, { t: e.target.value, ap: FOCO_DEF[e.target.value].ap, lm: FOCO_DEF[e.target.value].lm })} style={{ ...btn, flex: 1, padding: '2px 4px' }}>{Object.entries(TIPOS_FOCO).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
                      <span onClick={() => cambiar(objSel.id, { focos: F.filter(x => x.id !== f.id) })} style={{ cursor: 'pointer', opacity: 0.7, padding: '0 4px' }} title="Quitar">✕</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto 1fr', gap: '3px 6px', alignItems: 'center' }}>
                      <span style={{ opacity: 0.65 }}>Pos cm</span>{num(Math.round(f.s), v => setFoco(f.id, { s: Math.max(0, Math.min(L, v)) }), 56, 5)}
                      <span style={{ opacity: 0.65 }}>Lúm.</span>{num(f.lm ?? 800, v => setFoco(f.id, { lm: v }), 56, 50)}
                      <span style={{ opacity: 0.65 }}>Giro °</span>{num(Math.round(f.yaw || 0), v => setFoco(f.id, { yaw: v }), 56, 15)}
                      <span style={{ opacity: 0.65 }}>Kelvin</span>{num(f.k || 3000, v => setFoco(f.id, { k: v }), 56, 100)}
                      {(f.t === 'spot' || f.t === 'spotmini' || f.t === 'proyector') && <><span style={{ opacity: 0.65 }}>Inclin. °</span>{num(Math.round(f.tilt ?? 20), v => setFoco(f.id, { tilt: v }), 56, 5)}<span style={{ opacity: 0.65 }}>Haz °</span>{num(Math.round(f.ap || 36), v => setFoco(f.id, { ap: v }), 56, 2)}</>}
                      {f.t === 'lineal' && <><span style={{ opacity: 0.65 }}>Largo cm</span>{num(Math.round(f.largo || 60), v => setFoco(f.id, { largo: v }), 56, 10)}<span /><span /></>}
                    </div>
                  </div>
                ))}
                <details style={{ marginTop: 4 }}>
                  <summary style={{ cursor: 'pointer', opacity: 0.8 }}>Lista de material</summary>
                  <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>
                    <div>1 × Carril {objSel.sistema === 'trifasico' ? 'trifásico' : 'magnético'} · {(L / 100).toFixed(2)} m</div>
                    {resumen.map(([t, n]) => <div key={t}>{n} × {TIPOS_FOCO[t]}</div>)}
                  </div>
                </details>
                <div style={{ opacity: 0.5, fontSize: 11, marginTop: 4 }}>La «Elevación» de arriba es la altura del carril. Los focos del carril se ven y alumbran solo en el 3D (no se pasan todavía a la capa Iluminación de Planos).</div>
              </div>
            );
          })()}
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
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 70, opacity: 0.7 }}>Tirador</span><select value={M.tirador || 'barra'} onChange={e => cambiar(objSel.id, { mueble: { ...M, tirador: e.target.value } })} style={btn}><option value="barra">Barra</option><option value="asa">Asa</option><option value="pomo">Pomo</option><option value="pomoplano">Pomo plano</option><option value="unero">Uñero (fresado)</option><option value="gola">Gola (perfil)</option><option value="push">Push open (sin tirador)</option><option value="ninguno">Sin tirador</option></select></label>
                {['barra', 'asa', 'pomo', 'pomoplano', 'gola'].includes(M.tirador || 'barra') && <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 70, opacity: 0.7 }}>Herraje</span><select value={M.tiradorColor || ''} onChange={e => cambiar(objSel.id, { mueble: { ...M, tiradorColor: e.target.value || undefined } })} style={btn}><option value="">Inox</option><option value="#1a1a1a">Negro</option><option value="#c9a54a">Latón</option><option value="#f2f2f2">Blanco</option><option value="#b87333">Cobre</option></select></label>}
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
          {seleccion.cid && (() => {
            const mod = biblioteca?.find(m => m.id === seleccion.cid)?.modelo3d;
            return (
              <div style={{ borderTop: '1px solid #333', marginTop: 8, paddingTop: 8 }}>
                <div style={{ opacity: 0.75, marginBottom: 4 }}>Modelo 3D del producto {mod ? '(asignado)' : '(se ve como caja)'}</div>
                <label style={{ ...btn, display: 'inline-block' }}>{mod ? 'Reemplazar por mi archivo…' : 'Subir mi modelo 3D…'}
                  <input type="file" accept=".glb,.gltf,.obj,.dae,.skp" style={{ display: 'none' }} onChange={e => { asignarModeloEq(e.target.files?.[0]); e.target.value = ''; }} />
                </label>
                {mod && <button style={{ ...btn, marginLeft: 6 }} onClick={quitarModeloEq}>Quitar</button>}
                {mod && <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}><span style={{ opacity: 0.7 }}>Giro del modelo</span><select value={mod.rot || 0} onChange={e => girarModeloEq(parseInt(e.target.value, 10))} style={btn}>{[0, 90, 180, 270].map(g => <option key={g} value={g}>{g}°</option>)}</select></label>}
                {subiendo && <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>{subiendo}</div>}
                <div style={{ fontSize: 11, opacity: 0.5, marginTop: 4 }}>Formatos: .glb, .gltf, .obj, .dae (desde SketchUp: Archivo → Exportar → Modelo 3D). Se guarda en el producto del catálogo y se ve igual en todos los planos. Si sale girado, usa «Giro del modelo».</div>
              </div>
            );
          })()}
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
