// Estructuras modulares de gimnasio (racks perforados): jaula de 4 patas, media jaula a pared o solo estantería, con bahías a elegir
// (peso libre, dominadas, estantería con accesorios, Smith, poleas con pesas). Se dibuja en el visor 3D y calcula la lista de piezas.
import * as THREE from 'three';

const CM = 0.01;
export const COLORES_RACK = { '#111111': 'Negro', '#2b2b2b': 'Grafito', '#8a8a8a': 'Gris', '#c8102e': 'Rojo', '#1b6dd6': 'Azul', '#f2c200': 'Amarillo', '#f5f5f5': 'Blanco' };
export const PERFILES_RACK = { 50: 'Ligero 50×50 mm', 75: 'Pesado 75×75 mm', 100: 'XL 100×100 mm' };
export const TIPOS_RACK = {
  jaula: { n: 'Jaula · 4 patas', fondo: 120, alto: 230 },
  pared: { n: 'Media jaula a pared', fondo: 45, alto: 230 },
  estanteria: { n: 'Solo estantería', fondo: 50, alto: 200 },
};
export const TIPOS_BAHIA = { libre: 'Peso libre (J-cups y seguridad)', dominadas: 'Dominadas', estanteria: 'Estantería con accesorios', smith: 'Smith', poleas: 'Poleas con pesas', vacia: 'Vacía (solo estructura)' };
export const ACCESORIOS = { kb: 'Kettlebells', mancuernas: 'Mancuernas', wallballs: 'Wall balls', discos: 'Discos', balones: 'Balones medicinales', vacio: 'Vacío' };

const num = (v, d, mn, mx) => { const n = Number(v); return Math.max(mn, Math.min(mx, Number.isFinite(n) ? n : d)); };
const hx = (v, d) => (/^#[0-9a-fA-F]{6}$/.test(v || '') ? v : d);

export function bahiaPorDefecto(tipo = 'libre') {
  return { tipo, niveles: 3, accesorios: ['kb', 'mancuernas', 'wallballs', 'discos', 'balones'], altJ: 130, altSeg: 75, barra: false };
}
export function rackPorDefecto(tipo = 'jaula') {
  const t = TIPOS_RACK[tipo] || TIPOS_RACK.jaula;
  const bahias = tipo === 'estanteria' ? [bahiaPorDefecto('estanteria'), bahiaPorDefecto('estanteria')] : [bahiaPorDefecto('libre'), bahiaPorDefecto('dominadas')];
  const rack = { tipo, perfil: 75, color: '#111111', agujeros: 5, anchoBahia: 125, fondo: t.fondo, alto: t.alto, bahias, precios: {} };
  return { rack, ...dimRack(rack) };
}
export function normalizaRack(o) {
  const r = (o && o.rack) || {};
  const tipo = TIPOS_RACK[r.tipo] ? r.tipo : 'jaula', t = TIPOS_RACK[tipo];
  const bahias = (Array.isArray(r.bahias) && r.bahias.length ? r.bahias : [bahiaPorDefecto('libre')]).slice(0, 8).map(b => {
    const d = bahiaPorDefecto(TIPOS_BAHIA[b && b.tipo] ? b.tipo : 'libre');
    return {
      tipo: d.tipo, niveles: Math.round(num(b && b.niveles, 3, 2, 6)), altJ: num(b && b.altJ, 130, 60, 200), altSeg: num(b && b.altSeg, 75, 30, 160), barra: !!(b && b.barra),
      accesorios: Array.from({ length: 6 }, (_, i) => (ACCESORIOS[b && b.accesorios && b.accesorios[i]] ? b.accesorios[i] : d.accesorios[i % d.accesorios.length])),
    };
  });
  const precios = {}; if (r.precios && typeof r.precios === 'object') Object.keys(r.precios).slice(0, 30).forEach(k => { if (/^[a-z]{2,20}$/.test(k)) precios[k] = Math.max(0, Math.min(1e6, num(r.precios[k], 0, 0, 1e6))); });
  return { tipo, perfil: [50, 75, 100].includes(Number(r.perfil)) ? Number(r.perfil) : 75, color: hx(r.color, '#111111'), agujeros: Number(r.agujeros) === 2.5 ? 2.5 : 5, anchoBahia: num(r.anchoBahia, 125, 60, 250), fondo: num(r.fondo, t.fondo, 25, 250), alto: num(r.alto, t.alto, 120, 320), bahias, precios };
}
export function dimRack(r) {
  const R = normalizaRack({ rack: r }), p = R.perfil / 10;
  return { w: Math.round((R.bahias.length * R.anchoBahia + p) * 10) / 10, d: R.fondo, alto: R.alto };
}

// ── materiales y geometrías compartidas ──
const cacheMat = new Map(), cacheTex = new Map();
function texPerforada(altoCm, paso, ancho) {
  const k = Math.round(altoCm) + '|' + paso;
  if (cacheTex.has(k)) return cacheTex.get(k);
  const cv = document.createElement('canvas'); cv.width = 32; cv.height = 32;
  const cx = cv.getContext('2d'); cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, 32, 32); cx.fillStyle = '#1a1a1a'; cx.beginPath(); cx.arc(16, 16, 5.5, 0, Math.PI * 2); cx.fill();
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, altoCm / paso); t.colorSpace = THREE.SRGBColorSpace;
  cacheTex.set(k, t); return t;
}
function mat(color, extra = {}) {
  const k = color + JSON.stringify(extra);
  if (!cacheMat.has(k)) cacheMat.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3, ...extra }));
  return cacheMat.get(k);
}
const caja = (w, h, d, m, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w * CM, h * CM, d * CM), m); o.position.set(x * CM, y * CM, z * CM); o.castShadow = o.receiveShadow = true; return o; };
const cil = (r, largo, m, x, y, z, eje = 'y') => {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r * CM, r * CM, largo * CM, 14), m); o.position.set(x * CM, y * CM, z * CM);
  if (eje === 'x') o.rotation.z = Math.PI / 2; else if (eje === 'z') o.rotation.x = Math.PI / 2;
  o.castShadow = o.receiveShadow = true; return o;
};
const esfera = (r, m, x, y, z) => { const o = new THREE.Mesh(new THREE.SphereGeometry(r * CM, 18, 12), m); o.position.set(x * CM, y * CM, z * CM); o.castShadow = o.receiveShadow = true; return o; };

export const nAccesorios = (tipo, bw) => Math.max(0, tipo === 'kb' ? Math.floor((bw - 4) / 26) : tipo === 'mancuernas' ? Math.floor((bw - 4) / 30) : tipo === 'wallballs' ? Math.floor((bw - 4) / 36) : tipo === 'discos' ? Math.floor((bw - 6) / 5) : tipo === 'balones' ? Math.floor((bw - 4) / 26) : 0);

function accesorios(g, tipo, xc, yTab, zc, bw, prof) {
  const n = nAccesorios(tipo, bw); if (!n) return;
  const COL = ['#1a1a1a', '#c8102e', '#1b6dd6', '#f2c200'];
  const paso = tipo === 'discos' ? 5 : (bw - 4) / n, x0 = xc - ((n - 1) * paso) / 2;
  for (let i = 0; i < n; i++) {
    const x = x0 + i * paso;
    if (tipo === 'kb') {
      const r = 8.5 + (i % 3) * 1.6, m = mat(COL[i % 3 === 0 ? 0 : i % 3], { roughness: 0.6, metalness: 0.2 });
      g.add(esfera(r, m, x, yTab + r, zc));
      const asa = new THREE.Mesh(new THREE.TorusGeometry(r * 0.55 * CM, r * 0.13 * CM, 8, 16), m); asa.position.set(x * CM, (yTab + r * 2.05) * CM, zc * CM); asa.castShadow = true; g.add(asa);
    } else if (tipo === 'mancuernas') {
      const m = mat('#2a2a2a', { roughness: 0.5, metalness: 0.5 });
      g.add(cil(1.3, 15, m, x, yTab + 4.5, zc, 'x')); g.add(cil(4.5, 6, m, x - 8, yTab + 4.5, zc, 'x')); g.add(cil(4.5, 6, m, x + 8, yTab + 4.5, zc, 'x'));
    } else if (tipo === 'wallballs') {
      g.add(esfera(16, mat(COL[i % 4], { roughness: 0.85, metalness: 0 }), x, yTab + 16, zc));
    } else if (tipo === 'discos') {
      g.add(cil(22.5, 3.5, mat('#1d1d1d', { roughness: 0.6, metalness: 0.3 }), x, yTab + 22.5, zc, 'z'));
    } else if (tipo === 'balones') {
      g.add(esfera(11, mat(COL[(i + 1) % 4], { roughness: 0.85, metalness: 0 }), x, yTab + 11, zc));
    }
  }
}

export function construirRack(o) {
  const R = normalizaRack(o), g = new THREE.Group(), p = R.perfil / 10, n = R.bahias.length, W = n * R.anchoBahia + p, D = R.fondo, H = R.alto;
  const mP = new THREE.MeshStandardMaterial({ color: R.color, roughness: 0.5, metalness: 0.35, map: texPerforada(H, R.agujeros, p) });
  const mL = mat(R.color, { roughness: 0.5, metalness: 0.35 }), mM = mat('#9aa0a6', { roughness: 0.25, metalness: 0.9 }), mD = mat('#202020', { roughness: 0.5, metalness: 0.4 });
  const xs = Array.from({ length: n + 1 }, (_, i) => -W / 2 + p / 2 + i * R.anchoBahia);
  const pared = R.tipo === 'pared', zf = D / 2 - p / 2, zr = -D / 2 + p / 2;
  // postes
  const poste = (x, z) => { const o = caja(p, H, p, mP, x, H / 2, z); g.add(o); };
  xs.forEach(x => { poste(x, pared ? zr : zr); if (!pared) poste(x, zf); });
  // travesaños y pies
  if (R.tipo === 'jaula') {
    [zf, zr].forEach(z => g.add(caja(W, p, p, mL, 0, H - p / 2, z)));
    xs.forEach(x => { g.add(caja(p, p, D, mL, x, H - p / 2, 0)); g.add(caja(p, p, D, mL, x, p / 2, 0)); });
  } else if (pared) {
    g.add(caja(W, p, p, mL, 0, H - p / 2, zr));
    xs.forEach(x => { g.add(caja(p, p, D, mL, x, p / 2, -D / 2 + D / 2)); g.add(caja(p + 4, 8, 1, mD, x, H - 30, -D / 2 - 0.5)); g.add(caja(p + 4, 8, 1, mD, x, 40, -D / 2 - 0.5)); });
  } else {
    g.add(caja(W, p * 0.6, p * 0.6, mL, 0, H - p * 0.3, zr)); g.add(caja(W, p * 0.6, p * 0.6, mL, 0, H - p * 0.3, zf));
  }
  // bahías
  R.bahias.forEach((b, k) => {
    const x1 = xs[k], x2 = xs[k + 1], xc = (x1 + x2) / 2, bw = R.anchoBahia - p, zJ = pared ? zr + p / 2 + 5 : zf;
    if (b.tipo === 'libre') {
      [x1 + p / 2 + 2.5, x2 - p / 2 - 2.5].forEach((x, i) => {
        g.add(caja(5, 7, 10, mM, x, b.altJ, zJ + (pared ? 0 : -1))); g.add(caja(5, 5, 2, mM, x, b.altJ + 5, zJ + (pared ? 5 : 4)));
        if (pared) g.add(caja(4, 4, 38, mL, x, b.altSeg, zr + p / 2 + 19));
        else g.add(cil(1.6, D - p, mM, x, b.altSeg, 0, 'z'));
        void i;
      });
      if (b.barra) {
        g.add(cil(1.4, 220, mM, xc, b.altJ + 7, zJ, 'x'));
        [-1, 1].forEach(s => { for (let j = 0; j < 2; j++) g.add(cil(22.5, 3.2, mD, xc + s * (bw / 2 + 4 + j * 3.6), b.altJ + 7, zJ, 'x')); });
      }
    } else if (b.tipo === 'dominadas') {
      if (pared) { [x1 + p / 2 + 2, x2 - p / 2 - 2].forEach(x => g.add(caja(4, 4, 30, mL, x, H - 10, zr + p / 2 + 15))); g.add(cil(1.6, bw, mM, xc, H - 10, zr + p / 2 + 30, 'x')); }
      else g.add(cil(1.6, bw, mM, xc, H - p - 6, zf, 'x'));
    } else if (b.tipo === 'estanteria') {
      const niv = b.niveles, prof = pared ? 36 : D - p, zc = pared ? zr + p / 2 + prof / 2 : 0, y0 = 28, y1 = H - 28;
      for (let j = 0; j < niv; j++) {
        const y = niv === 1 ? y0 : y0 + (j * (y1 - y0)) / (niv - 1);
        g.add(caja(bw, 2.5, prof, mD, xc, y, zc));
        accesorios(g, b.accesorios[j], xc, y + 1.25, zc, bw, prof);
      }
    } else if (b.tipo === 'smith') {
      const zS = pared ? zr + p / 2 + 12 : 0, sep = Math.min(bw / 2 - 8, 60);
      [-sep, sep].forEach(s => { g.add(cil(1.3, H - 20, mM, xc + s, (H - 20) / 2 + 8, zS)); g.add(caja(3, 3, 3, mD, xc + s, 125, zS)); });
      g.add(cil(1.4, sep * 2 + 40, mM, xc, 125, zS + 1, 'x'));
      [-sep, sep].forEach(s => g.add(caja(5, 8, 4, mL, xc + s, 70, zS)));
    } else if (b.tipo === 'poleas') {
      const zP = zr + p / 2 + 3, sep = Math.min(bw / 2 - 12, 42);
      [-sep, sep].forEach(s => {
        g.add(caja(3, H - 24, 3, mL, xc + s, (H - 24) / 2 + 6, zP)); g.add(cil(6, 2, mM, xc + s, H - 16, zP + 4, 'z')); g.add(cil(6, 2, mM, xc + s, 24, zP + 4, 'z'));
        g.add(caja(6, 8, 6, mM, xc + s, 115, zP + 4)); g.add(cil(0.35, 90, mD, xc + s + 1, 70, zP + 4)); g.add(cil(1.2, 14, mM, xc + s, 70, zP + 10, 'z'));
        for (let i = 0; i < 9; i++) g.add(caja(20, 10, 18, mD, xc + s, 8 + i * 11.5, zP - 12));
      });
    }
  });
  g.userData.dim = { w: W, d: D, alto: H };
  return g;
}

export function calculosRack(o) {
  const R = normalizaRack(o), p = R.perfil / 10, n = R.bahias.length, pared = R.tipo === 'pared', avisos = [];
  const postes = (n + 1) * (pared ? 1 : 2), lista = [];
  const add = (k, nombre, q, u) => { if (q > 0) lista.push([k, nombre, q, u]); };
  add('postes', 'Postes perforados ' + R.perfil + ' mm × ' + R.alto + ' cm (agujeros cada ' + R.agujeros + ' cm)', postes, 'ud');
  if (R.tipo === 'jaula') { add('travesanos', 'Travesaños superiores en largo (' + Math.round(n * R.anchoBahia + p) + ' cm)', 2, 'ud'); add('laterales', 'Travesaños laterales y bases (' + R.fondo + ' cm)', (n + 1) * 2, 'ud'); }
  if (pared) { add('travesanos', 'Travesaño superior (' + Math.round(n * R.anchoBahia + p) + ' cm)', 1, 'ud'); add('anclajes', 'Placas de anclaje a muro', (n + 1) * 2, 'ud'); add('bases', 'Pies de apoyo (' + R.fondo + ' cm)', n + 1, 'ud'); }
  if (R.tipo === 'estanteria') add('travesanos', 'Travesaños superiores en largo', 2, 'ud');
  let jc = 0, seg = 0, barras = 0, dom = 0, bal = 0, smith = 0, pol = 0; const acc = { kb: 0, mancuernas: 0, wallballs: 0, discos: 0, balones: 0 };
  R.bahias.forEach(b => {
    if (b.tipo === 'libre') { jc++; seg++; if (b.barra) barras++; } else if (b.tipo === 'dominadas') dom++;
    else if (b.tipo === 'estanteria') { bal += b.niveles; for (let j = 0; j < b.niveles; j++) { const a = b.accesorios[j]; if (acc[a] !== undefined) acc[a] += nAccesorios(a, R.anchoBahia - p); } }
    else if (b.tipo === 'smith') smith++; else if (b.tipo === 'poleas') pol++;
  });
  add('jcups', 'Pares de J-cups', jc, 'par'); add('seguridad', pared ? 'Pares de brazos de seguridad' : 'Pares de barras de seguridad', seg, 'par'); add('dominadas', 'Barras de dominadas', dom, 'ud');
  add('baldas', 'Baldas de estantería (' + Math.round(R.anchoBahia - p) + ' cm)', bal, 'ud'); add('smith', 'Máquinas Smith (guías y barra)', smith, 'ud'); add('poleas', 'Torres de poleas con pila de pesas', pol, 'ud'); add('barra', 'Barras olímpicas con discos', barras, 'ud');
  add('kb', 'Kettlebells', acc.kb, 'ud'); add('manc', 'Mancuernas (unidades)', acc.mancuernas * 2, 'ud'); add('wall', 'Wall balls', acc.wallballs, 'ud'); add('discos', 'Discos', acc.discos, 'ud'); add('balones', 'Balones medicinales', acc.balones, 'ud');
  let total = 0; lista.forEach(([k, , q]) => { total += (R.precios[k] || 0) * q; });
  if (pared) avisos.push('A pared: comprueba que el muro aguanta los anclajes (hormigón o bloque macizo).');
  if (R.alto > 260) avisos.push('Con más de 260 cm de alto, comprueba la altura libre de la sala.');
  if (R.bahias.some(b => b.tipo === 'poleas') && R.fondo < 90 && !pared) avisos.push('Las torres de poleas piden fondo: 90 cm o más.');
  avisos.push('Es un diseño orientativo: las medidas reales dependen del fabricante.');
  return { R, lista, total, avisos, ...dimRack(R) };
}
export function textoRack(o) {
  const { R, lista, total, avisos, w, d, alto } = calculosRack(o), f = v => Number(v).toLocaleString('es-ES', { maximumFractionDigits: 2 });
  return ['Rack modular · ' + TIPOS_RACK[R.tipo].n + ' · ' + f(w) + ' × ' + f(d) + ' × ' + f(alto) + ' cm', 'Bahías: ' + R.bahias.map((b, i) => (i + 1) + ' ' + TIPOS_BAHIA[b.tipo]).join(' | '), '', ...lista.map(([k, n, q, u]) => '- ' + n + ': ' + f(q) + ' ' + u + (R.precios[k] ? ' (' + f(R.precios[k] * q) + ' €)' : '')), ...(total > 0 ? ['', 'Total: ' + f(total) + ' €'] : []), '', ...avisos.map(a => '* ' + a)].join('\n');
}
