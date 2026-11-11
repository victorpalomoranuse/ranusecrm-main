/* global document */
// Césped artificial para pistas de arrastre y trineo (sled / prowler): colores a elegir, líneas de metros, salida y llegada, carriles y números.
// La superficie lleva su propia textura dibujada (césped con grano + marcas), así que las líneas son exactas y se ven nítidas.
import * as THREE from 'three';

const CM = 0.01;
export const COLORES_CESPED = { '#d8d9d4': 'Gris casi blanco', '#8a8f94': 'Gris', '#1f1f1f': 'Negro', '#3f7d3a': 'Verde', '#b8553a': 'Terracota', '#2f5f9e': 'Azul', '#a9332e': 'Rojo', '#e3d2b8': 'Arena' };
export const COLORES_LINEA = { '#111111': 'Negro', '#ffffff': 'Blanco', '#f2c230': 'Amarillo', '#d8d9d4': 'Gris claro', '#b8553a': 'Terracota' };
export const PRESETS_CESPED = {
  gris: { n: 'Arrastre · gris claro con líneas negras', cesped: '#d8d9d4', linea: '#111111' },
  negro: { n: 'Arrastre · negro con líneas blancas', cesped: '#1f1f1f', linea: '#ffffff' },
  verde: { n: 'Verde con líneas blancas', cesped: '#3f7d3a', linea: '#ffffff' },
  terracota: { n: 'Terracota con líneas blancas', cesped: '#b8553a', linea: '#ffffff' },
  azul: { n: 'Azul con líneas blancas', cesped: '#2f5f9e', linea: '#ffffff' },
};

const num = (v, d, mn, mx) => { const n = parseFloat(v); return isFinite(n) ? Math.max(mn, Math.min(mx, n)) : d; };
const hex = (v, d) => (/^#[0-9a-fA-F]{6}$/.test(v || '') ? v : d);

// Diseños de marcaje listos para elegir (luego se ajustan a mano)
export const PRESETS_MARCAJE = {
  lineas_metros: { n: 'Líneas y metros', distancia: 'metros', separador: 'linea', elementos: [] },
  lineas_sin_numeros: { n: 'Solo líneas (sin números)', distancia: 'ninguna', separador: 'linea', elementos: [] },
  discontinuas: { n: 'Líneas discontinuas', distancia: 'ninguna', separador: 'discontinua', elementos: [] },
  solo_numeros: { n: 'Solo números (sin líneas)', distancia: 'numero', separador: 'ninguno', elementos: [] },
  flechas: { n: 'Flechas de avance', distancia: 'ninguna', separador: 'flecha', elementos: [] },
  puntos: { n: 'Puntos de referencia', distancia: 'ninguna', separador: 'punto', elementos: [] },
  frase: { n: 'Frase repetida', distancia: 'ninguna', separador: 'ninguno', elementos: [{ tipo: 'texto', texto: 'TU FRASE', pos: 'cada', cada: 1000, tam: 45, color: '#ffffff', carril: 0, rot: 0 }] },
  numeracion: { n: 'Numeración 1, 2, 3…', distancia: 'ninguna', separador: 'linea', elementos: [{ tipo: 'numeracion', texto: '', pos: 'cada', cada: 500, tam: 50, color: '#ffffff', carril: 0, rot: 0 }] },
  logo_inicio: { n: 'Logo al inicio', distancia: 'ninguna', separador: 'linea', elementos: [{ tipo: 'logo', texto: '', pos: 'inicio', cada: 1000, tam: 90, color: '#ffffff', carril: 0, rot: 0 }] },
  pista_sprint: { n: 'Pista de sprint (marcas en los bordes y 01, 02…)', distancia: 'indice', separador: 'marca_borde', elementos: [], salida: false, grosorLinea: 14, sep: 100 },
  marcas_borde: { n: 'Marcas cortas en los bordes (sin números)', distancia: 'ninguna', separador: 'marca_borde', elementos: [], salida: false, grosorLinea: 14, sep: 100 },
  sin_marcas: { n: 'Sin marcas', distancia: 'ninguna', separador: 'ninguno', elementos: [] },
};
const SEPARADORES = ['linea', 'discontinua', 'flecha', 'punto', 'marca_borde', 'ninguno'], DISTANCIAS = ['metros', 'numero', 'indice', 'ninguna'];
function normElemento(e, i) {
  const x = e && typeof e === 'object' ? e : {};
  return { id: String(x.id || 'm' + i).replace(/[^a-z0-9_-]/gi, '').slice(0, 14) || 'm' + i, tipo: ['texto', 'numeracion', 'logo'].includes(x.tipo) ? x.tipo : 'texto', texto: String(x.texto || '').slice(0, 60), tam: num(x.tam, 40, 8, 250), color: hex(x.color, '#ffffff'), pos: ['inicio', 'fin', 'centro', 'cada'].includes(x.pos) ? x.pos : 'cada', cada: num(x.cada, 1000, 100, 5000), carril: Math.round(num(x.carril, 0, 0, 8)), rot: [0, 90, 180, 270].includes(Number(x.rot)) ? Number(x.rot) : 0, logo: String(x.logo || '').slice(0, 60) };
}
export function aplicaPresetMarcaje(c, clave) {
  const p = PRESETS_MARCAJE[clave]; if (!p) return c;
  c.distancia = p.distancia; c.separador = p.separador; c.numeros = p.distancia !== 'ninguna'; if (p.salida !== undefined) c.salida = p.salida; if (p.grosorLinea) c.grosorLinea = p.grosorLinea; if (p.sep) c.sep = p.sep;
  c.elementos = p.elementos.map((e, i) => normElemento({ ...e, id: 'm' + Date.now().toString(36) + i }, i));
  return c;
}
export function normalizaCesped(o) {
  const c = (o && o.cesped) || {}, distancia = DISTANCIAS.includes(c.distancia) ? c.distancia : (c.numeros === false ? 'ninguna' : 'metros');
  return {
    distancia, separador: SEPARADORES.includes(c.separador) ? c.separador : 'linea', elementos: (Array.isArray(c.elementos) ? c.elementos : []).slice(0, 12).map(normElemento),
    cesped: hex(c.cesped, '#d8d9d4'), linea: hex(c.linea, '#111111'),
    carriles: Math.round(num(c.carriles, 1, 1, 8)), anchoCarril: num(c.anchoCarril, 200, 60, 400), sep: num(c.sep, 500, 100, 5000), grosorLinea: num(c.grosorLinea, 10, 2, 40),
    numeros: distancia !== 'ninguna', salida: c.salida !== false, lineasCarril: c.lineasCarril !== false, borde: c.borde !== false, grosor: num(c.grosor, 2.5, 1, 8),
    precios: (c.precios && typeof c.precios === 'object') ? c.precios : {},
  };
}
export function cespedPorDefecto(preset = 'gris') {
  const p = PRESETS_CESPED[preset] || PRESETS_CESPED.gris;
  const C = normalizaCesped({ cesped: { cesped: p.cesped, linea: p.linea } });
  return { w: 2000, d: C.carriles * C.anchoCarril, alto: C.grosor, cesped: C };
}

function aleatorio(semilla) { let s = semilla >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Dibuja el césped y sus marcas en un lienzo (1 píxel ≈ 1/px cm)
export function lienzoCesped(o) {
  const C = normalizaCesped(o), L = o.w, A = o.d, px = Math.min(5, 4096 / Math.max(L, A)), cw = Math.max(64, Math.round(L * px)), ch = Math.max(64, Math.round(A * px));
  const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; const g = cv.getContext('2d');
  g.fillStyle = C.cesped; g.fillRect(0, 0, cw, ch);
  // grano del césped: motitas claras y oscuras + franjas de cepillado muy suaves
  const rnd = aleatorio(Math.round(L * 7 + A * 13)), n = Math.min(90000, Math.round(cw * ch / 30));
  for (let i = 0; i < n; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.09)'; g.fillRect(rnd() * cw, rnd() * ch, 1 + rnd() * 2, 1 + rnd() * 3); }
  for (let y = 0; y < ch; y += Math.max(4, Math.round(12 * px))) { g.fillStyle = 'rgba(0,0,0,0.035)'; g.fillRect(0, y, cw, Math.max(2, Math.round(6 * px))); }
  const lw = Math.max(2, Math.round(C.grosorLinea * px)); g.fillStyle = C.linea;
  if (C.borde) { g.fillRect(0, 0, cw, lw); g.fillRect(0, ch - lw, cw, lw); g.fillRect(0, 0, lw, ch); g.fillRect(cw - lw, 0, lw, ch); }
  if (C.salida) { g.fillRect(0, 0, Math.round(lw * 2), ch); g.fillRect(cw - Math.round(lw * 2), 0, Math.round(lw * 2), ch); }
  // separadores transversales cada «sep», con el estilo elegido
  const aw = C.anchoCarril * px;
  for (let x = C.sep; x < L - 1 && C.separador !== 'ninguno'; x += C.sep) {
    const xp = Math.round(x * px);
    if (C.separador === 'marca_borde') { const l1 = Math.round(aw * 0.16), l2 = Math.round(aw * 0.08), lh = Math.max(2, Math.round(lw * 0.7)); g.fillRect(Math.round(xp - lh / 2), 0, lh, l1); g.fillRect(Math.round(xp - lh / 2), ch - l1, lh, l1); const xm = Math.round((x - C.sep / 2) * px); g.fillRect(Math.round(xm - lh / 2), 0, lh, l2); g.fillRect(Math.round(xm - lh / 2), ch - l2, lh, l2); }
    else if (C.separador === 'linea') g.fillRect(Math.round(xp - lw / 2), 0, lw, ch);
    else if (C.separador === 'discontinua') { const d = Math.max(6, Math.round(aw * 0.18)); for (let y = 0; y < ch; y += d * 2) g.fillRect(Math.round(xp - lw / 2), y, lw, Math.min(d, ch - y)); }
    else for (let k = 0; k < C.carriles; k++) {
      const yc = (k + 0.5) * aw;
      if (C.separador === 'flecha') { const s = Math.min(aw * 0.28, C.sep * px * 0.18); g.beginPath(); g.moveTo(xp - s, yc - s); g.lineTo(xp + s, yc); g.lineTo(xp - s, yc + s); g.lineTo(xp - s * 0.35, yc); g.closePath(); g.fill(); }
      else if (C.separador === 'punto') { g.beginPath(); g.arc(xp, yc, Math.max(lw * 0.9, aw * 0.05), 0, Math.PI * 2); g.fill(); }
    }
  }
  if (C.lineasCarril) for (let k = 1; k < C.carriles; k++) g.fillRect(0, Math.round(k * C.anchoCarril * px - lw / 2), cw, lw);
  if (C.distancia !== 'ninguna') {
    const fs = Math.max(10, Math.round(Math.min(C.anchoCarril * (C.distancia === 'indice' ? 0.2 : 0.22), C.sep * (C.distancia === 'indice' ? 0.3 : 0.18)) * px)); g.font = '700 ' + fs + 'px Montserrat, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = C.linea;
    for (let k = 0; k < C.carriles; k++) for (let x = C.sep; x < L - 1; x += C.sep) { const m = (x / 100).toLocaleString('es-ES', { maximumFractionDigits: 1 }), idx = String(Math.round(x / C.sep)).padStart(2, '0'); g.fillText(C.distancia === 'indice' ? idx : C.distancia === 'numero' ? m : m + ' m', Math.round((x + (C.distancia === 'indice' ? 0 : C.sep * 0.16)) * px), Math.round((k + 0.5) * C.anchoCarril * px)); }
  }
  // frases, numeración y logos
  const logos = [];
  for (const e of C.elementos) {
    const xs = e.pos === 'inicio' ? [Math.min(L * 0.06, 150 + e.tam)] : e.pos === 'fin' ? [L - Math.min(L * 0.06, 150 + e.tam)] : e.pos === 'centro' ? [L / 2] : (() => { const r = []; for (let x = e.cada / 2; x < L - 1; x += e.cada) r.push(x); return r; })();
    const lanes = e.carril > 0 && e.carril <= C.carriles ? [e.carril - 1] : Array.from({ length: C.carriles }, (_, k) => k);
    let n = 0;
    for (const k of lanes) xs.forEach((x, ix) => {
      const xp = Math.round(x * px), yp = Math.round((k + 0.5) * C.anchoCarril * px), h = Math.max(8, Math.round(e.tam * px));
      if (e.tipo === 'logo') { logos.push({ id: e.logo, x: xp, y: yp, h, rot: e.rot }); return; }
      const txt = e.tipo === 'numeracion' ? String(ix + 1) : e.texto; if (!txt) return;
      g.save(); g.translate(xp, yp); g.rotate(e.rot * Math.PI / 180); g.font = '800 ' + h + 'px Montserrat, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = e.color; g.fillText(txt, 0, 0, Math.max(40, Math.min(cw * 0.9, C.sep * px * 0.95))); g.restore(); n++;
    });
  }
  cv._logos = logos;
  return cv;
}

export function construirCesped(o) {
  const C = normalizaCesped(o), g = new THREE.Group(), L = o.w, A = o.d;
  const tex = new THREE.CanvasTexture(lienzoCesped(o)); tex.anisotropy = 8; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
  const lado = new THREE.MeshStandardMaterial({ color: new THREE.Color(C.cesped).multiplyScalar(0.55), roughness: 1 });
  const arriba = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, metalness: 0 });
  const cvs = tex.image; if (cvs && cvs._logos && cvs._logos.length) {
    const mapa = new Map((o._tex || []).map(x => [x.id, x.url])), cache = {}; let pendientes = 0;
    for (const lg of cvs._logos) { const url = mapa.get(lg.id); if (!url) continue; pendientes++; const img = cache[url] || (cache[url] = new Image()); const pinta = () => { const w = lg.h * (img.naturalWidth / Math.max(1, img.naturalHeight)), g2 = cvs.getContext('2d'); g2.save(); g2.translate(lg.x, lg.y); g2.rotate(lg.rot * Math.PI / 180); g2.drawImage(img, -w / 2, -lg.h / 2, w, lg.h); g2.restore(); tex.needsUpdate = true; }; if (img.complete && img.naturalWidth) pinta(); else { img.crossOrigin = 'anonymous'; if (!img.src) img.src = url; img.addEventListener('load', pinta); } }
  }
  const caja = new THREE.Mesh(new THREE.BoxGeometry(L * CM, C.grosor * CM, A * CM), [lado, lado, arriba, lado, lado, lado]);
  caja.position.y = (C.grosor / 2) * CM; caja.receiveShadow = true; caja.castShadow = false; g.add(caja);
  return g;
}

export function calculosCesped(o) {
  const C = normalizaCesped(o), L = o.w, A = o.d, m2 = L * A / 1e4, merma = 1.1;
  const nLin = ['linea', 'discontinua'].includes(C.separador) ? Math.max(0, Math.ceil((L - 1) / C.sep) - 1) : C.separador === 'marca_borde' ? Math.max(0, Math.ceil((L - 1) / C.sep) - 1) * 0.5 : 0, mLin = (nLin * A + (C.lineasCarril ? (C.carriles - 1) * L : 0) + (C.borde ? 2 * (L + A) : 0) + (C.salida ? 2 * A : 0)) / 100;
  const tiras = Math.ceil(A / 200), mUnion = Math.max(0, tiras - 1) * L / 100; // rollos de 2 m de ancho
  const lista = [
    ['cesped', 'Césped artificial (con 10 % de recortes)', Math.round(m2 * merma * 10) / 10, 'm²'],
    ['marcaje', 'Marcaje: líneas y números (' + (C.linea === '#ffffff' ? 'blancas' : C.linea === '#111111' ? 'negras' : 'de color') + ')', Math.round(mLin * 10) / 10, 'm'],
    ['union', 'Cinta y adhesivo de juntas (rollos de 2 m)', Math.round(mUnion * 10) / 10, 'm'],
    ['base', 'Base compactada o sub-base (zahorra o arena)', Math.round(m2 * 10) / 10, 'm²'],
  ];
  let total = 0; for (const [k, , q] of lista) total += (parseFloat(C.precios[k]) || 0) * q;
  const avisos = [];
  if (L < 1500 && C.carriles >= 1) avisos.push('Para arrastres con trineo conviene una pista de 15-20 m como mínimo (' + Math.round(L / 100) + ' m ahora).');
  if (C.anchoCarril < 120) avisos.push('Un carril de menos de 1,2 m es estrecho para empujar un trineo.');
  avisos.push('Mide la superficie real antes de pedir el césped: los rollos tienen 2 m de ancho y 25 m de largo (o 4 m). Las medidas incluyen un 10 % de recortes.');
  return { m2: Math.round(m2 * 10) / 10, mLin: Math.round(mLin * 10) / 10, tiras, lista, total, avisos, C };
}
export function textoCesped(o) {
  const R = calculosCesped(o), f = x => Number(x).toLocaleString('es-ES', { maximumFractionDigits: 2 });
  let t = 'CÉSPED DE ARRASTRES\n' + f(o.w / 100) + ' × ' + f(o.d / 100) + ' m (' + R.C.carriles + ' carril' + (R.C.carriles > 1 ? 'es' : '') + ' de ' + f(R.C.anchoCarril / 100) + ' m) · ' + f(R.m2) + ' m²\nMarcas cada ' + f(R.C.sep / 100) + ' m\n\nMATERIALES\n';
  for (const [k, n, q, u] of R.lista) t += '- ' + n + ': ' + f(q) + ' ' + u + (R.C.precios[k] > 0 ? ' · ' + f(R.C.precios[k] * q) + ' €' : '') + '\n';
  if (R.total > 0) t += 'TOTAL: ' + f(R.total) + ' €\n';
  return t + '\n' + R.avisos.join('\n');
}
