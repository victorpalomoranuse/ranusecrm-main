// Rocódromo doméstico: pared de escalada (vertical o con desplome) con presas y colchoneta, y monkey bars (barras de braquiación)
// colgadas del techo —útil en doble altura— o apoyadas en postes. Se dibuja en el visor 3D y calcula la lista de piezas.
import * as THREE from 'three';

const CM = 0.01;
export const TIPOS_ESCALADA = { pared: { n: 'Pared de escalada (vertical)' }, monkey: { n: 'Monkey bars' } };
export const COLORES_PANEL_ESC = { '#d9b98a': 'Contrachapado', '#e8e6e1': 'Blanco', '#2b2b2b': 'Grafito', '#1b6dd6': 'Azul', '#c8102e': 'Rojo', '#3f7d4e': 'Verde' };
export const COLORES_PRESAS = { multi: 'Multicolor', '#c8102e': 'Rojo', '#f2c200': 'Amarillo', '#1b6dd6': 'Azul', '#2e9e57': 'Verde', '#f5f5f5': 'Blanco', '#111111': 'Negro' };
const PALETA = ['#c8102e', '#f2c200', '#1b6dd6', '#2e9e57', '#f28c1b', '#8e44ad', '#f5f5f5'];
export const SOPORTES_MONKEY = { techo: 'Colgadas del techo (tirantes)', postes: 'Sobre postes al suelo' };
export const COLORES_BARRAS = { '#8a8a8a': 'Acero', '#111111': 'Negro', '#c8102e': 'Rojo', '#d9b98a': 'Madera' };

const num = (v, d, mn, mx) => { const n = Number(v); return Math.max(mn, Math.min(mx, Number.isFinite(n) ? n : d)); };
const hx = (v, d) => (/^#[0-9a-fA-F]{6}$/.test(v || '') ? v : d);

export function escaladaPorDefecto(tipo = 'pared') {
  const escalada = tipo === 'monkey'
    ? { tipo: 'monkey', largo: 360, ancho: 70, altBarras: 230, altTecho: 420, sep: 30, diam: 3.2, soporte: 'techo', colorBarras: '#8a8a8a', precios: {} }
    : { tipo: 'pared', ancho: 300, alto: 330, incl: 0, colorPanel: '#d9b98a', presas: 'multi', densidad: 18, semilla: 7, colchoneta: true, fondoColch: 150, grosColch: 20, colorColch: '#1b6dd6', precios: {} };
  return { escalada, ...dimEscalada(escalada) };
}
export function normalizaEscalada(o) {
  const r = (o && o.escalada) || {};
  const precios = {}; if (r.precios && typeof r.precios === 'object') Object.keys(r.precios).slice(0, 30).forEach(k => { if (/^[a-z]{2,20}$/.test(k)) precios[k] = Math.max(0, Math.min(1e6, num(r.precios[k], 0, 0, 1e6))); });
  if (r.tipo === 'monkey') {
    const altBarras = num(r.altBarras, 230, 150, 400);
    return {
      tipo: 'monkey', largo: num(r.largo, 360, 120, 800), ancho: num(r.ancho, 70, 40, 150), altBarras, altTecho: num(r.altTecho, 420, altBarras + 20, 900),
      sep: num(r.sep, 30, 20, 45), diam: num(r.diam, 3.2, 2.5, 4.5), soporte: r.soporte === 'postes' ? 'postes' : 'techo', colorBarras: hx(r.colorBarras, '#8a8a8a'), precios,
    };
  }
  return {
    tipo: 'pared', ancho: num(r.ancho, 300, 80, 1200), alto: num(r.alto, 330, 150, 900), incl: num(r.incl, 0, 0, 45), colorPanel: hx(r.colorPanel, '#d9b98a'),
    presas: r.presas === 'multi' ? 'multi' : hx(r.presas, 'multi'), densidad: num(r.densidad, 18, 0, 40), semilla: Math.round(num(r.semilla, 7, 1, 9999)),
    colchoneta: r.colchoneta !== false, fondoColch: num(r.fondoColch, 150, 60, 400), grosColch: num(r.grosColch, 20, 5, 40), colorColch: hx(r.colorColch, '#1b6dd6'), precios,
  };
}
const GROSOR = 12; // panel + trasdós de madera
export function dimEscalada(r) {
  const E = normalizaEscalada({ escalada: r });
  if (E.tipo === 'monkey') return { w: Math.round(E.largo + 10), d: Math.round(E.ancho + 10), alto: E.soporte === 'techo' ? E.altTecho : E.altBarras + 6 };
  const tan = Math.tan((E.incl * Math.PI) / 180), vuelo = E.alto * tan, prof = Math.max(vuelo + GROSOR, E.colchoneta ? GROSOR + E.fondoColch : 0);
  return { w: Math.round(E.ancho), d: Math.round(prof * 10) / 10, alto: E.alto };
}

const cacheMat = new Map();
function mat(color, extra = {}) {
  const k = color + JSON.stringify(extra);
  if (!cacheMat.has(k)) cacheMat.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.2, ...extra }));
  return cacheMat.get(k);
}
const caja = (w, h, d, m, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w * CM, h * CM, d * CM), m); o.position.set(x * CM, y * CM, z * CM); o.castShadow = o.receiveShadow = true; return o; };
const cil = (r, largo, m, x, y, z, eje = 'y', seg = 14) => {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r * CM, r * CM, largo * CM, seg), m); o.position.set(x * CM, y * CM, z * CM);
  if (eje === 'x') o.rotation.z = Math.PI / 2; else if (eje === 'z') o.rotation.x = Math.PI / 2;
  o.castShadow = o.receiveShadow = true; return o;
};
const azar = (s) => () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// rejilla de tuercas en T (cada 20 cm) como en un panel real
function texPanel(anchoCm, largoCm, base) {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
  const cx = cv.getContext('2d'); cx.fillStyle = base; cx.fillRect(0, 0, 64, 64);
  cx.fillStyle = 'rgba(0,0,0,0.55)'; cx.beginPath(); cx.arc(32, 32, 4.2, 0, Math.PI * 2); cx.fill();
  cx.fillStyle = 'rgba(255,255,255,0.18)'; cx.beginPath(); cx.arc(31, 31, 1.6, 0, Math.PI * 2); cx.fill();
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(anchoCm / 20, largoCm / 20); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function construirPared(E) {
  const g = new THREE.Group(), a = (E.incl * Math.PI) / 180, tan = Math.tan(a), L = E.alto / Math.cos(a), vuelo = E.alto * tan;
  const dm = dimEscalada(E), Dt = dm.d, zb = -Dt / 2 + GROSOR, zc = zb + vuelo / 2;
  // panel (grupo inclinado alrededor de su centro; sus hijos usan coordenadas locales)
  const gp = new THREE.Group(); gp.position.set(0, (E.alto / 2) * CM, zc * CM); gp.rotation.x = a;
  const mPanel = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.75, metalness: 0, map: texPanel(E.ancho, L, E.colorPanel) });
  const p = new THREE.Mesh(new THREE.BoxGeometry(E.ancho * CM, L * CM, 2 * CM), mPanel); p.position.z = -2 * CM; p.castShadow = p.receiveShadow = true; gp.add(p);
  // trasdós: montantes verticales de madera cada ~60 cm
  const mMad = mat('#a67c52', { roughness: 0.8, metalness: 0 }), nm = Math.max(2, Math.round(E.ancho / 60) + 1);
  for (let i = 0; i < nm; i++) gp.add(caja(4.5, L, 9, mMad, -E.ancho / 2 + 2.25 + (i * (E.ancho - 4.5)) / (nm - 1), 0, -7.5));
  // presas
  const rnd = azar(E.semilla), n = Math.min(600, Math.round((E.ancho / 100) * (L / 100) * E.densidad));
  const geoPresa = new THREE.IcosahedronGeometry(1, 0);
  for (let i = 0; i < n; i++) {
    const x = (rnd() - 0.5) * (E.ancho - 24), y = (rnd() - 0.5) * (L - 30), tam = 3.5 + rnd() * 5.5;
    const col = E.presas === 'multi' ? PALETA[Math.floor(rnd() * PALETA.length)] : E.presas;
    const m = new THREE.Mesh(geoPresa, mat(col, { roughness: 0.6, metalness: 0 }));
    m.scale.set(tam * CM * (0.9 + rnd() * 0.7), tam * CM * (0.7 + rnd() * 0.8), tam * CM * 0.55); m.rotation.z = rnd() * Math.PI * 2;
    m.position.set(x * CM, y * CM, -1 * CM + tam * 0.25 * CM); m.castShadow = true; gp.add(m);
  }
  g.add(gp);
  // refuerzos en diagonal por detrás cuando hay desplome (de lo alto del panel a la base del muro)
  if (vuelo > 10) {
    const posiciones = Math.max(2, Math.round(E.ancho / 120) + 1);
    for (let i = 0; i < posiciones; i++) {
      const x = -E.ancho / 2 + 5 + (i * (E.ancho - 10)) / (posiciones - 1), y1 = E.alto - 10, z1 = zb + (y1 / E.alto) * vuelo - 6, y0 = 15, z0 = -Dt / 2 + 3;
      const len = Math.hypot(y1 - y0, z1 - z0), ang = Math.atan2(z1 - z0, y1 - y0);
      const d = caja(5, len, 8, mMad, x, (y0 + y1) / 2, (z0 + z1) / 2); d.rotation.x = ang; g.add(d);
    }
  }
  // colchoneta
  if (E.colchoneta) {
    const m = new THREE.Mesh(new THREE.BoxGeometry((E.ancho + 40) * CM, E.grosColch * CM, E.fondoColch * CM), mat(E.colorColch, { roughness: 0.85, metalness: 0 }));
    m.position.set(0, (E.grosColch / 2) * CM, (-Dt / 2 + GROSOR + E.fondoColch / 2) * CM); m.castShadow = m.receiveShadow = true; g.add(m);
  }
  return g;
}

function construirMonkey(E) {
  const g = new THREE.Group(), mB = mat(E.colorBarras, { roughness: E.colorBarras === '#d9b98a' ? 0.8 : 0.3, metalness: E.colorBarras === '#d9b98a' ? 0 : 0.7 }), mT = mat('#2b2b2b', { roughness: 0.45, metalness: 0.5 }), mP = mat('#9aa0a6', { roughness: 0.3, metalness: 0.85 });
  const yb = E.altBarras, L = E.largo, A = E.ancho, r = E.diam / 2;
  // largueros laterales (tubo cuadrado 8×4) y peldaños
  [-1, 1].forEach(s => g.add(caja(L + 10, 8, 4, mT, 0, yb, (s * A) / 2)));
  const n = Math.max(2, Math.floor((L - 10) / E.sep) + 1), sep = (L - 10) / (n - 1);
  for (let i = 0; i < n; i++) g.add(cil(r, A, mB, -L / 2 + 5 + i * sep, yb + 4 + r - 0.5, 0, 'z', 12));
  // apoyos: en los extremos y cada ≤ 150 cm
  const k = Math.max(2, Math.ceil(L / 150) + 1), xs = Array.from({ length: k }, (_, i) => -L / 2 + 6 + (i * (L - 12)) / (k - 1));
  if (E.soporte === 'techo') {
    const H = E.altTecho - yb;
    xs.forEach(x => [-1, 1].forEach(s => {
      g.add(caja(5, H, 5, mT, x, yb + H / 2, (s * A) / 2));
      g.add(caja(16, 1.2, 16, mP, x, E.altTecho - 0.6, (s * A) / 2));
      g.add(caja(16, 1.2, 8, mP, x, yb - 3.4, (s * A) / 2));
    }));
    // arriostrado transversal arriba para que no oscile
    [xs[0], xs[xs.length - 1]].forEach(x => g.add(caja(4, 4, A, mT, x, E.altTecho - 12, 0)));
  } else {
    xs.forEach(x => [-1, 1].forEach(s => {
      g.add(caja(6, yb + 4, 6, mT, x, (yb + 4) / 2, (s * A) / 2));
      g.add(caja(18, 1.2, 18, mP, x, 0.6, (s * A) / 2));
    }));
    [xs[0], xs[xs.length - 1]].forEach(x => g.add(caja(5, 5, A, mT, x, yb - 22, 0)));
  }
  return g;
}

export function construirEscalada(o) {
  const E = normalizaEscalada(o), g = E.tipo === 'monkey' ? construirMonkey(E) : construirPared(E);
  g.userData.dim = dimEscalada(E);
  return g;
}

export function calculosEscalada(o) {
  const E = normalizaEscalada(o), lista = [], avisos = [];
  const add = (k, nombre, q, u) => { if (q > 0) lista.push([k, nombre, Math.round(q * 100) / 100, u]); };
  if (E.tipo === 'monkey') {
    const n = Math.max(2, Math.floor((E.largo - 10) / E.sep) + 1), k = Math.max(2, Math.ceil(E.largo / 150) + 1);
    add('peldanos', 'Peldaños Ø ' + E.diam + ' cm × ' + Math.round(E.ancho) + ' cm', n, 'ud'); add('largueros', 'Largueros laterales (' + Math.round(E.largo + 10) + ' cm)', 2, 'ud');
    if (E.soporte === 'techo') { add('tirantes', 'Tirantes de ' + Math.round(E.altTecho - E.altBarras) + ' cm con placas de anclaje al techo', k * 2, 'ud'); avisos.push('Colgada del techo: comprueba que la estructura del forjado/viga aguanta cargas dinámicas (usuario en movimiento, no solo su peso).'); }
    else { add('postes', 'Postes de ' + Math.round(E.altBarras + 4) + ' cm con placa de suelo', k * 2, 'ud'); avisos.push('Sobre postes: ancla las placas al suelo con tacos adecuados.'); }
    if (E.altBarras > 260) avisos.push('Barras a más de 260 cm: piden colchoneta gruesa o suelo de caucho amortiguante debajo.');
  } else {
    const L = E.alto / Math.cos((E.incl * Math.PI) / 180), m2 = (E.ancho / 100) * (L / 100), nm = Math.max(2, Math.round(E.ancho / 60) + 1);
    add('panel', 'Panel contrachapado 18 mm con tuercas en T cada 20 cm', m2, 'm²'); add('montantes', 'Montantes de madera ' + Math.round(L) + ' cm', nm, 'ud');
    add('presas', 'Presas y agarres (estimado)', Math.min(600, Math.round(m2 * E.densidad)), 'ud');
    if (E.incl > 3) add('refuerzos', 'Refuerzos diagonales traseros', Math.max(2, Math.round(E.ancho / 120) + 1), 'ud');
    if (E.colchoneta) add('colchoneta', 'Colchoneta ' + Math.round(E.ancho + 40) + ' × ' + Math.round(E.fondoColch) + ' × ' + Math.round(E.grosColch) + ' cm', 1, 'ud');
    avisos.push('Fija los montantes a muro o estructura resistente; cada presa debe ir con tornillo y tuerca en T.');
    if (E.alto > 400) avisos.push('Con más de 4 m, plantea una autoaseguradora o cuerda: la colchoneta sola no basta.');
    else if (E.alto > 300) avisos.push('Por encima de 3 m, valora arnés y cuerda; la colchoneta cubre solo caídas de bloque.');
  }
  avisos.push('Es un diseño orientativo: las medidas y la normativa dependen del fabricante.');
  let total = 0; lista.forEach(([k, , q]) => { total += (E.precios[k] || 0) * q; });
  return { E, lista, total, avisos, ...dimEscalada(E) };
}
export function textoEscalada(o) {
  const { E, lista, total, avisos, w, d, alto } = calculosEscalada(o), f = v => Number(v).toLocaleString('es-ES', { maximumFractionDigits: 2 });
  return [TIPOS_ESCALADA[E.tipo].n + ' · ' + f(w) + ' × ' + f(d) + ' × ' + f(alto) + ' cm', '', ...lista.map(([k, n, q, u]) => '- ' + n + ': ' + f(q) + ' ' + u + (E.precios[k] ? ' (' + f(E.precios[k] * q) + ' €)' : '')), ...(total > 0 ? ['', 'Total: ' + f(total) + ' €'] : []), '', ...avisos.map(a => '* ' + a)].join('\n');
}
