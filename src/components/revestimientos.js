// Revestimientos de pared parametricos: palilleria (listones), lamas acusticas, panelados de cuadros (boiserie), paneles con juntas y molduras lineales
// (zocalos, cornisas, guardasillas, media cana). Todo en cm; el grupo 3D va en metros (CM = 0.01).
// Marco local del objeto: x a lo largo del muro (de -w/2 a w/2), y hacia arriba (0 a alto) y z hacia fuera del muro (0 a espesor).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const CM = 0.01;

// Perfiles de moldura: puntos [saliente desde el muro, altura] en cm (de abajo a arriba)
export const PERFILES_MOLDURA = {
  'Zócalo recto 10': [[0, 0], [1.6, 0], [1.6, 10], [0, 10]],
  'Zócalo alto biselado 15': [[0, 0], [2, 0], [2, 13], [1.2, 15], [0, 15]],
  'Zócalo clásico 12': [[0, 0], [2.2, 0], [2.2, 7], [1.6, 7.6], [1.6, 10], [1, 11], [0.6, 12], [0, 12]],
  'Cornisa clásica 10': [[0, 0], [1.2, 0], [1.2, 1.4], [4, 4.6], [9, 7.6], [9, 10], [0, 10]],
  'Cornisa lisa 6': [[0, 0], [6, 0], [6, 1.2], [1.2, 6], [0, 6]],
  'Cornisa para luz indirecta 12': [[0, 0], [12, 0], [12, 2], [2, 12], [0, 12]],
  'Guardasillas 6': [[0, 0], [1.8, 0], [1.8, 1], [2.6, 1.6], [2.6, 4], [1.8, 4.6], [1.8, 6], [0, 6]],
  'Moldura plana 2×8': [[0, 0], [2, 0], [2, 8], [0, 8]],
  'Media caña 4': Array.from({ length: 9 }, (_, i) => [4 * Math.sin((i / 8) * Math.PI / 2), 4 - 4 * Math.cos((i / 8) * Math.PI / 2)]).concat([[0, 4]]),
};

// Catalogo de modelos listos para aplicar
export const PRESETS_REVEST = [
  { id: 'pal-vert', cat: 'Palillería y lamas', nombre: 'Palillería vertical', desc: 'Listones de madera de 4 cm con fondo oscuro', tipo: 'lamas', color: '#b98b5e', p: { dir: 'v', ancho: 4, grueso: 2.5, sep: 2, forma: 'rect', fondo: 'oscuro' } },
  { id: 'pal-fina', cat: 'Palillería y lamas', nombre: 'Palillería fina', desc: 'Listones de 2 cm muy juntos', tipo: 'lamas', color: '#c9a577', p: { dir: 'v', ancho: 2, grueso: 2, sep: 1.5, forma: 'rect', fondo: 'oscuro' } },
  { id: 'pal-horiz', cat: 'Palillería y lamas', nombre: 'Palillería horizontal', desc: 'Listones tumbados', tipo: 'lamas', color: '#b98b5e', p: { dir: 'h', ancho: 4, grueso: 2.5, sep: 2, forma: 'rect', fondo: 'oscuro' } },
  { id: 'estriado', cat: 'Palillería y lamas', nombre: 'Estriado semicircular', desc: 'Medias cañas verticales', tipo: 'lamas', color: '#a8794d', p: { dir: 'v', ancho: 5, grueso: 2.5, sep: 0.4, forma: 'redondo', fondo: 'oscuro' } },
  { id: 'acustico', cat: 'Palillería y lamas', nombre: 'Lamas acústicas con fieltro', desc: 'Lamas sobre fieltro de color', tipo: 'lamas', color: '#a98563', p: { dir: 'v', ancho: 2.4, grueso: 2, sep: 1.4, forma: 'rect', fondo: 'fieltro' } },
  { id: 'boiserie', cat: 'Panelado', nombre: 'Panelado de cuadros (boiserie)', desc: 'Marcos de moldura formando cuadros', tipo: 'cuadros', color: '#f1ece6', p: { ancho: 60, filas: 1, sep: 10, moldura: 4, relieve: 1.8, zocalo: 0 } },
  { id: 'boiserie-2', cat: 'Panelado', nombre: 'Boiserie en dos filas', desc: 'Dos filas de cuadros', tipo: 'cuadros', color: '#f1ece6', p: { ancho: 55, filas: 2, sep: 8, moldura: 3, relieve: 1.5, zocalo: 0 } },
  { id: 'boiserie-zoc', cat: 'Panelado', nombre: 'Boiserie con zócalo', desc: 'Cuadros por encima de un zócalo alto', tipo: 'cuadros', color: '#e9e4dc', p: { ancho: 60, filas: 1, sep: 10, moldura: 4, relieve: 1.8, zocalo: 90 } },
  { id: 'paneles', cat: 'Panelado', nombre: 'Paneles con juntas', desc: 'Tableros de 60 × 120 con junta fina', tipo: 'paneles', color: '#d8d2c8', p: { ancho: 60, alto: 120, junta: 0.6, grueso: 1.2 } },
  { id: 'paneles-g', cat: 'Panelado', nombre: 'Paneles grandes', desc: 'Tableros de 120 × 240', tipo: 'paneles', color: '#cfc9bf', p: { ancho: 120, alto: 240, junta: 0.8, grueso: 1.2 } },
  { id: 'rel-pira', cat: 'Paneles 3D', nombre: 'Pirámides', desc: 'Relieve de pirámides pequeñas', tipo: 'relieve', color: '#efece6', p: { forma: 'piramide', celda: 12, altura: 4 } },
  { id: 'rel-hexa', cat: 'Paneles 3D', nombre: 'Hexágonos en relieve', desc: 'Panal de hexágonos en relieve', tipo: 'relieve', color: '#e8e4dc', p: { forma: 'hexa', celda: 12, altura: 3 } },
  { id: 'rel-cubos', cat: 'Paneles 3D', nombre: 'Cubos a distinta altura', desc: 'Cuadrados que sobresalen distinto', tipo: 'relieve', color: '#e8e4dc', p: { forma: 'cubos', celda: 10, altura: 5 } },
  { id: 'rel-tria', cat: 'Paneles 3D', nombre: 'Triángulos', desc: 'Prismas triangulares alternos', tipo: 'relieve', color: '#efece6', p: { forma: 'triangulo', celda: 14, altura: 4 } },
  { id: 'rel-onda', cat: 'Paneles 3D', nombre: 'Ondas', desc: 'Ondas verticales continuas', tipo: 'lamas', color: '#e9e5de', p: { dir: 'v', ancho: 6, grueso: 2.2, sep: 0, forma: 'redondo', fondo: 'ninguno' } },
  { id: 'rej-fina', cat: 'Rejillas y celosías', nombre: 'Panel de rejilla fina', desc: 'Retícula de barras finas cada 12 cm', tipo: 'relieve', color: '#2a2a2c', p: { forma: 'rejilla', celda: 12, altura: 3, barra: 1.4 } },
  { id: 'rej-grande', cat: 'Rejillas y celosías', nombre: 'Panel de rejilla grande', desc: 'Retícula de barras gruesas cada 30 cm', tipo: 'relieve', color: '#2a2a2c', p: { forma: 'rejilla', celda: 30, altura: 5, barra: 3 } },
  { id: 'celosia', cat: 'Rejillas y celosías', nombre: 'Celosía en diagonal', desc: 'Barras cruzadas en aspa', tipo: 'relieve', color: '#b98b5e', p: { forma: 'celosia', celda: 22, altura: 3, barra: 2 } },
  { id: 'perforado', cat: 'Rejillas y celosías', nombre: 'Panel perforado', desc: 'Discos en relieve tipo panel perforado', tipo: 'relieve', color: '#3a3a3c', p: { forma: 'perforado', celda: 8, altura: 1.5 } },
  { id: 'zocalo', cat: 'Molduras', nombre: 'Zócalo alto', desc: 'Rodapié biselado de 15 cm', tipo: 'moldura', color: '#f4f1ec', p: { perfil: 'Zócalo alto biselado 15', pos: 'suelo' } },
  { id: 'zocalo-cl', cat: 'Molduras', nombre: 'Zócalo clásico', desc: 'Rodapié moldurado de 12 cm', tipo: 'moldura', color: '#f4f1ec', p: { perfil: 'Zócalo clásico 12', pos: 'suelo' } },
  { id: 'cornisa', cat: 'Molduras', nombre: 'Cornisa clásica', desc: 'Moldura de techo de 10 cm', tipo: 'moldura', color: '#f4f1ec', p: { perfil: 'Cornisa clásica 10', pos: 'techo' } },
  { id: 'cornisa-luz', cat: 'Molduras', nombre: 'Cornisa para luz indirecta', desc: 'Gran cornisa para esconder una tira LED', tipo: 'moldura', color: '#f4f1ec', p: { perfil: 'Cornisa para luz indirecta 12', pos: 'techo' } },
  { id: 'guardasilla', cat: 'Molduras', nombre: 'Guardasillas', desc: 'Moldura a media altura', tipo: 'moldura', color: '#f4f1ec', p: { perfil: 'Guardasillas 6', pos: 'media', altura: 90 } },
  { id: 'plana', cat: 'Molduras', nombre: 'Moldura plana', desc: 'Listón plano de 2 × 8 cm', tipo: 'moldura', color: '#f4f1ec', p: { perfil: 'Moldura plana 2×8', pos: 'media', altura: 100 } },
];
export const preset = (id) => PRESETS_REVEST.find(p => p.id === id);

export function normalizaRevest(o) {
  const R = o?.revest || {}, base = preset(R.id) || PRESETS_REVEST[0];
  return { ...base, ...R, tipo: R.tipo || base.tipo, p: { ...base.p, ...(R.p || {}) }, huecos: Array.isArray(R.huecos) ? R.huecos : [] };
}

// Resta de rectangulos: lo que queda de r (x0,x1,y0,y1) al quitarle los huecos (puertas y ventanas)
function resta(r, huecos) {
  let piezas = [r];
  for (const h of huecos) {
    const sig = [];
    for (const q of piezas) {
      if (h.x1 <= q.x0 || h.x0 >= q.x1 || h.y1 <= q.y0 || h.y0 >= q.y1) { sig.push(q); continue; }
      if (h.x0 > q.x0) sig.push({ ...q, x1: h.x0 });
      if (h.x1 < q.x1) sig.push({ ...q, x0: h.x1 });
      const xa = Math.max(q.x0, h.x0), xb = Math.min(q.x1, h.x1);
      if (h.y0 > q.y0) sig.push({ ...q, x0: xa, x1: xb, y1: h.y0 });
      if (h.y1 < q.y1) sig.push({ ...q, x0: xa, x1: xb, y0: h.y1 });
    }
    piezas = sig;
  }
  return piezas.filter(q => q.x1 - q.x0 > 0.6 && q.y1 - q.y0 > 0.6);
}

export function construirRevest(o) {
  const R = normalizaRevest(o), P = R.p, W = Math.max(5, o.w), H = Math.max(2, o.alto), hu = R.huecos;
  const g = new THREE.Group();
  const col = /^#[0-9a-fA-F]{6}$/.test(o.color || '') ? o.color : R.color || '#d8d2c8';
  const mt = new THREE.MeshStandardMaterial({ color: col, roughness: 0.62, metalness: 0 });
  const mtOsc = new THREE.MeshStandardMaterial({ color: P.fondo === 'fieltro' ? (o.colorFondo || '#3a3a3d') : '#2a2623', roughness: 0.95 });
  const geos = [], geosOsc = [];
  const caja = (r, z0, z1, lista = geos, huecosR = hu) => {
    for (const q of resta(r, huecosR)) {
      const bg = new THREE.BoxGeometry((q.x1 - q.x0) * CM, (q.y1 - q.y0) * CM, (z1 - z0) * CM);
      bg.translate(((q.x0 + q.x1) / 2 - W / 2) * CM, ((q.y0 + q.y1) / 2) * CM, ((z0 + z1) / 2) * CM); lista.push(bg);
    }
  };
  const x0 = 0, x1 = W;
  if (R.tipo === 'lamas') {
    const fondoE = P.fondo === 'ninguno' ? 0 : 0.8;
    if (fondoE) caja({ x0, x1, y0: 0, y1: H }, 0, fondoE, geosOsc);
    const paso = P.ancho + P.sep, vert = P.dir !== 'h', largo = vert ? W : H, n = Math.max(1, Math.floor((largo + P.sep) / paso)), ini = (largo - (n * paso - P.sep)) / 2;
    for (let i = 0; i < n; i++) {
      const a = ini + i * paso, b = a + P.ancho, r = vert ? { x0: a, x1: b, y0: 0, y1: H } : { x0, x1, y0: a, y1: b };
      if (P.forma === 'redondo' && vert) {
        for (const q of resta(r, hu)) { const rad = P.ancho / 2, cg = new THREE.CylinderGeometry(rad * CM, rad * CM, (q.y1 - q.y0) * CM, 10, 1, false, -Math.PI / 2, Math.PI); cg.scale(1, 1, P.grueso / rad); cg.translate(((q.x0 + q.x1) / 2 - W / 2) * CM, ((q.y0 + q.y1) / 2) * CM, fondoE * CM); geos.push(cg); }
      } else caja(r, fondoE, fondoE + P.grueso);
    }
  } else if (R.tipo === 'cuadros') {
    caja({ x0, x1, y0: 0, y1: H }, 0, 1); // fondo liso
    const zoc = Math.min(P.zocalo || 0, H - 20), top = H - P.sep, base = zoc + (zoc ? 0 : P.sep), nf = Math.max(1, Math.round(P.filas || 1));
    if (zoc) { caja({ x0, x1, y0: 0, y1: zoc }, 1, 1 + P.relieve); caja({ x0, x1, y0: zoc, y1: zoc + 2.2 }, 1, 1 + P.relieve + 0.8); }
    const nc = Math.max(1, Math.round((W - P.sep) / (P.ancho + P.sep))), cw = (W - P.sep * (nc + 1)) / nc, alturaUtil = top - (zoc ? zoc + P.sep : P.sep), ch = (alturaUtil - P.sep * (nf - 1)) / nf;
    if (ch > P.moldura * 2 + 4 && cw > P.moldura * 2 + 4) for (let f = 0; f < nf; f++) for (let c = 0; c < nc; c++) {
      const a = P.sep + c * (cw + P.sep), b = a + cw, y0 = (zoc ? zoc + P.sep : P.sep) + f * (ch + P.sep), y1 = y0 + ch, m = P.moldura, z1 = 1 + P.relieve;
      caja({ x0: a, x1: b, y0, y1: y0 + m }, 1, z1); caja({ x0: a, x1: b, y0: y1 - m, y1 }, 1, z1);
      caja({ x0: a, x1: a + m, y0: y0 + m, y1: y1 - m }, 1, z1); caja({ x0: b - m, x1: b, y0: y0 + m, y1: y1 - m }, 1, z1);
      caja({ x0: a + m, x1: b - m, y0: y0 + m, y1: y1 - m }, 1, 1.4); // interior ligeramente en relieve
    }
  } else if (R.tipo === 'paneles') {
    const ex = P.junta || 0.6, pa = Math.max(10, P.ancho), pl = Math.max(10, P.alto), nx = Math.max(1, Math.round(W / pa)), ny = Math.max(1, Math.round(H / pl)), aw = W / nx, ah = H / ny;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) caja({ x0: i * aw + ex / 2, x1: (i + 1) * aw - ex / 2, y0: j * ah + ex / 2, y1: (j + 1) * ah - ex / 2 }, 0, P.grueso);
    caja({ x0, x1, y0: 0, y1: H }, 0, 0.2, geosOsc); // sombra de las juntas
  } else if (R.tipo === 'relieve') {
    caja({ x0, x1, y0: 0, y1: H }, 0, 1); // base lisa
    const c = Math.max(4, P.celda || 12), h = Math.max(1, P.altura || 4), choca = (a, b, c2, d) => hu.some(q => !(q.x1 <= a || q.x0 >= b || q.y1 <= c2 || q.y0 >= d));
    const pon = (gx, cx0, cy0) => { gx.translate((cx0 - W / 2) * CM, cy0 * CM, 0); geos.push(gx); };
    if (P.forma === 'cubos') {
      const nx = Math.floor(W / c), ny = Math.floor(H / c), ox = (W - nx * c) / 2, oy = (H - ny * c) / 2;
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        const a = ox + i * c, b = a + c, c2 = oy + j * c, d = c2 + c; if (choca(a, b, c2, d)) continue;
        const hh = 1 + (h - 1) * (0.3 + 0.7 * (((i * 7 + j * 13) % 3) / 2)); const bg = new THREE.BoxGeometry((c - 0.6) * CM, (c - 0.6) * CM, hh * CM); bg.translate(0, 0, (1 + hh / 2) * CM); pon(bg, (a + b) / 2, (c2 + d) / 2);
      }
    } else if (P.forma === 'rejilla' || P.forma === 'celosia') {
      const bw = Math.max(0.8, P.barra || 2), nx = Math.max(1, Math.floor(W / c)), ny = Math.max(1, Math.floor(H / c)), ox = (W - nx * c) / 2, oy = (H - ny * c) / 2;
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        const a = ox + i * c, b = a + c, c2 = oy + j * c, d = c2 + c; if (choca(a, b, c2, d)) continue;
        if (P.forma === 'rejilla') {
          const v = new THREE.BoxGeometry(bw * CM, c * CM, h * CM); v.translate(0, 0, (1 + h / 2) * CM); pon(v, a, (c2 + d) / 2);
          const hz = new THREE.BoxGeometry(c * CM, bw * CM, h * 0.8 * CM); hz.translate(0, 0, (1 + h * 0.4) * CM); pon(hz, (a + b) / 2, c2);
        } else {
          for (const sg of [1, -1]) { const g = new THREE.BoxGeometry(c * 1.414 * CM, bw * CM, h * (sg > 0 ? 1 : 0.8) * CM); g.rotateZ(sg * Math.PI / 4); g.translate(0, 0, (1 + h * (sg > 0 ? 0.5 : 0.4)) * CM); pon(g, (a + b) / 2, (c2 + d) / 2); }
        }
      }
    } else if (P.forma === 'perforado') {
      const nx = Math.max(1, Math.floor(W / c)), ny = Math.max(1, Math.floor(H / c)), ox = (W - nx * c) / 2, oy = (H - ny * c) / 2;
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        const a = ox + i * c, b = a + c, c2 = oy + j * c, d = c2 + c; if (choca(a, b, c2, d)) continue;
        const cg = new THREE.CylinderGeometry(c * 0.3 * CM, c * 0.3 * CM, h * CM, 14); cg.rotateX(Math.PI / 2); cg.translate(0, 0, (1 + h / 2) * CM); pon(cg, (a + b) / 2, (c2 + d) / 2);
      }
    } else if (P.forma === 'hexa') {
      const r = c / 2, dx = r * 1.5, dy = r * Math.sqrt(3), nx = Math.floor((W - r) / dx), ny = Math.floor((H - r) / dy);
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        const cx0 = r + i * dx, cy0 = r + j * dy + (i % 2 ? dy / 2 : 0); if (cy0 + r > H || choca(cx0 - r, cx0 + r, cy0 - r, cy0 + r)) continue;
        const cg = new THREE.CylinderGeometry((r - 0.5) * CM, (r - 0.5) * CM, h * CM, 6); cg.rotateX(Math.PI / 2); cg.translate(0, 0, (1 + h / 2) * CM); pon(cg, cx0, cy0);
      }
    } else if (P.forma === 'triangulo') {
      const nx = Math.floor(W / c), ny = Math.floor(H / c), ox = (W - nx * c) / 2, oy = (H - ny * c) / 2;
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        const a = ox + i * c, b = a + c, c2 = oy + j * c, d = c2 + c; if (choca(a, b, c2, d)) continue;
        const sh = new THREE.Shape(((i + j) % 2) ? [new THREE.Vector2(-c / 2, -c / 2), new THREE.Vector2(c / 2, -c / 2), new THREE.Vector2(0, c / 2)] : [new THREE.Vector2(-c / 2, c / 2), new THREE.Vector2(c / 2, c / 2), new THREE.Vector2(0, -c / 2)]);
        const eg = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false }); eg.scale(CM * 0.92, CM * 0.92, CM); eg.translate(0, 0, CM); pon(eg, (a + b) / 2, (c2 + d) / 2);
      }
    } else { // pirámides
      const nx = Math.floor(W / c), ny = Math.floor(H / c), ox = (W - nx * c) / 2, oy = (H - ny * c) / 2;
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        const a = ox + i * c, b = a + c, c2 = oy + j * c, d = c2 + c; if (choca(a, b, c2, d)) continue;
        const cg = new THREE.ConeGeometry((c / Math.SQRT2) * CM, h * CM, 4); cg.rotateY(Math.PI / 4); cg.rotateX(Math.PI / 2); cg.translate(0, 0, (1 + h / 2) * CM); pon(cg, (a + b) / 2, (c2 + d) / 2);
      }
    }
  } else if (R.tipo === 'moldura') {
    const pf = PERFILES_MOLDURA[P.perfil] || PERFILES_MOLDURA['Zócalo recto 10'], alto = Math.max(...pf.map(q => q[1])), y0 = P.pos === 'techo' ? H - alto : P.pos === 'media' ? (P.altura || 90) : 0;
    const huecosM = hu.filter(h => h.y1 > y0 && h.y0 < y0 + alto).map(h => ({ x0: h.x0, x1: h.x1, y0: 0, y1: 1e5 }));
    const tramos = resta({ x0, x1, y0: 0, y1: 1 }, huecosM);
    const sh = new THREE.Shape(pf.map(q => new THREE.Vector2(q[0], q[1] + y0)));
    for (const q of tramos) {
      const L = q.x1 - q.x0, eg = new THREE.ExtrudeGeometry(sh, { depth: L, bevelEnabled: false });
      const m4 = new THREE.Matrix4().set(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1); // (x,y,z) → (z, y, x): la extrusión pasa a ir a lo largo del muro
      eg.applyMatrix4(m4); eg.translate((q.x0 - W / 2), 0, 0); eg.scale(CM, CM, CM); geos.push(eg);
    }
  }
  const unir = (lista, material, sombra = true) => {
    if (!lista.length) return;
    const lim = lista.map(gx => { const n = gx.toNonIndexed ? (gx.index ? gx.toNonIndexed() : gx) : gx; if (n.attributes.uv === undefined) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2)); return n; });
    let mg = null; try { mg = mergeGeometries(lim, false); } catch { mg = null; }
    const sub = mg ? [mg] : lim;
    sub.forEach(gx => { const me = new THREE.Mesh(gx, material); me.castShadow = sombra; me.receiveShadow = true; g.add(me); });
  };
  mt.side = R.tipo === 'moldura' ? THREE.DoubleSide : THREE.FrontSide;
  unir(geosOsc, mtOsc, false); unir(geos, mt);
  g.userData.revest = true;
  return g;
}

// Datos de colocacion sobre un muro: centro, giro, largo y huecos locales (relativos al borde izquierdo del revestimiento)
export function colocaEnMuro(mu, lado, s0, s1, ordenarDesdeA = true) {
  const dx = mu.b[0] - mu.a[0], dy = mu.b[1] - mu.a[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
  const a = Math.max(0, Math.min(L, Math.min(s0, s1))), b = Math.max(0, Math.min(L, Math.max(s0, s1)));
  const nx = -uy, ny = ux, mid = (a + b) / 2, off = (mu.t || 12) / 2 * lado;
  const dir = lado >= 0 ? [ux, uy] : [-ux, -uy];
  const rot = Math.atan2(dir[1], dir[0]) * 180 / Math.PI;
  const huecos = (mu.ab || []).map(h => {
    const hp0 = Number(h.p) || 0, hp1 = hp0 + (Number(h.w) || 0);
    const lx0 = lado >= 0 ? hp0 - a : b - hp1, lx1 = lado >= 0 ? hp1 - a : b - hp0, y0 = Number(h.sill) || 0;
    return { x0: Math.round(lx0 * 10) / 10, x1: Math.round(lx1 * 10) / 10, y0, y1: y0 + (Number(h.h) || 0) };
  }).filter(h => h.x1 > 0 && h.x0 < b - a);
  return { cx: Math.round((mu.a[0] + ux * mid + nx * off) * 10) / 10, cy: Math.round((mu.a[1] + uy * mid + ny * off) * 10) / 10, rot: Math.round(rot * 10) / 10, w: Math.round((b - a) * 10) / 10, huecos, largoMuro: L };
}

// Zona realmente ocupada (para la caja de selección): una moldura solo ocupa su franja, no todo el alto del muro
export function cajaRevest(o) {
  const R = normalizaRevest(o);
  if (R.tipo !== 'moldura') return { y0: 0, y1: o.alto };
  const pf = PERFILES_MOLDURA[R.p.perfil] || PERFILES_MOLDURA['Zócalo recto 10'], alto = Math.max(...pf.map(q => q[1])), y0 = R.p.pos === 'techo' ? o.alto - alto : R.p.pos === 'media' ? (R.p.altura || 90) : 0;
  return { y0, y1: y0 + alto };
}
export function espesorRevest(o) {
  const R = normalizaRevest(o), P = R.p;
  return R.tipo === 'relieve' ? 1 + (P.altura || 4) : R.tipo === 'lamas' ? 0.8 + (P.grueso || 2.5) : R.tipo === 'cuadros' ? 1 + (P.relieve || 1.8) : R.tipo === 'paneles' ? (P.grueso || 1.2) : Math.max(...(PERFILES_MOLDURA[P.perfil] || [[2, 0]]).map(q => q[0]));
}
