// Cubiertas de panel sándwich (y chapa) con su estructura: geometría 3D + predimensionado.
// Todo en cm y kN. El cálculo es un PREDIMENSIONADO orientativo (viga biapoyada, pilar articulado, cargas de peso propio + nieve/mantenimiento),
// hecho con el método de los estados límite (Eurocódigo 3, acero S275). No sustituye al proyecto de un técnico, pero da una estructura coherente y medible.
import * as THREE from 'three';

const CM = 0.01;
export const TIPOS_CUBIERTA = {
  dosaguas: { n: 'A dos aguas (nave)', w: 800, d: 1200, hAlero: 400, pend: 15 },
  unaagua: { n: 'A una agua (porche, ampliación)', w: 500, d: 800, hAlero: 250, pend: 12 },
  cuatroaguas: { n: 'A cuatro aguas', w: 800, d: 1000, hAlero: 350, pend: 20 },
  plana: { n: 'Plana (pendiente mínima)', w: 600, d: 800, hAlero: 280, pend: 5 },
  marquesina: { n: 'Marquesina / pérgola (ligera)', w: 400, d: 600, hAlero: 250, pend: 8 },
};
export const COLORES_PANEL = { '#e9e9e6': 'Blanco', '#aeb4ba': 'Gris claro', '#3d4146': 'Antracita', '#9a4a3a': 'Rojo teja', '#3f5b4a': 'Verde', '#7a6a58': 'Marrón' };
// kg/m² del panel y separación máxima entre correas (m): valores típicos de panel PIR/PUR con chapa de 0,5 mm; mira siempre la tabla de cargas del fabricante
export const PANELES = { 30: { kg: 10, max: 1.4 }, 40: { kg: 10.9, max: 1.8 }, 50: { kg: 11.3, max: 2.0 }, 60: { kg: 11.7, max: 2.3 }, 80: { kg: 12.5, max: 2.8 }, 100: { kg: 13.3, max: 3.2 } };
// [nombre, Wel cm³, I cm⁴, kg/m, canto mm, ancho mm]
const IPE = [['IPE 80', 20, 80.1, 6, 80, 46], ['IPE 100', 34.2, 171, 8.1, 100, 55], ['IPE 120', 53, 318, 10.4, 120, 64], ['IPE 140', 77.3, 541, 12.9, 140, 73], ['IPE 160', 109, 869, 15.8, 160, 82], ['IPE 180', 146, 1317, 18.8, 180, 91], ['IPE 200', 194, 1943, 22.4, 200, 100], ['IPE 220', 252, 2772, 26.2, 220, 110], ['IPE 240', 324, 3892, 30.7, 240, 120], ['IPE 270', 429, 5790, 36.1, 270, 135], ['IPE 300', 557, 8356, 42.2, 300, 150], ['IPE 330', 713, 11770, 49.1, 330, 160], ['IPE 360', 904, 16270, 57.1, 360, 170], ['IPE 400', 1156, 23130, 66.3, 400, 180], ['IPE 450', 1500, 33740, 77.6, 450, 190], ['IPE 500', 1928, 48200, 90.7, 500, 200], ['IPE 550', 2441, 67120, 106, 550, 210], ['IPE 600', 3069, 92080, 122, 600, 220]];
// [nombre, canto mm, ancho mm, A cm², Iz cm⁴, kg/m]
const HEA = [['HEA 100', 96, 100, 21.2, 134, 16.7], ['HEA 120', 114, 120, 25.3, 231, 19.9], ['HEA 140', 133, 140, 31.4, 389, 24.7], ['HEA 160', 152, 160, 38.8, 616, 30.4], ['HEA 180', 171, 180, 45.3, 925, 35.5], ['HEA 200', 190, 200, 53.8, 1336, 42.3], ['HEA 220', 210, 220, 64.3, 1955, 50.5], ['HEA 240', 230, 240, 76.8, 2769, 60.3], ['HEA 260', 250, 260, 86.8, 3668, 68.2], ['HEA 280', 270, 280, 97.3, 4763, 76.4], ['HEA 300', 290, 300, 112.5, 6310, 88.3]];
const FYD = 27.5 / 1.05, E = 21000; // kN/cm²

const num = (v, d, mn, mx) => { const n = parseFloat(v); return isFinite(n) ? Math.max(mn, Math.min(mx, n)) : d; };

export function normalizaCubierta(o) {
  const c = (o && o.cubierta) || {}, tp = TIPOS_CUBIERTA[c.tipo] ? c.tipo : 'dosaguas', def = TIPOS_CUBIERTA[tp];
  const pa = c.panel || {}, es = c.estructura || {}, ca = c.cargas || {}, su = c.suelo || {};
  return {
    tipo: tp,
    pend: num(c.pend, def.pend, 1, 60), hAlero: num(c.hAlero, def.hAlero, 100, 1500), vuelo: num(c.vuelo, 30, 0, 150),
    sentido: c.sentido === 'w' ? 'w' : 'd',
    panel: { esp: PANELES[pa.esp] ? Number(pa.esp) : 40, color: /^#[0-9a-fA-F]{6}$/.test(pa.color || '') ? pa.color : '#e9e9e6' },
    estructura: { pilares: es.pilares !== false, zapatas: es.zapatas !== false, sepPorticos: num(es.sepPorticos, tp === 'marquesina' ? 400 : 500, 200, 1000), sepCorreas: num(es.sepCorreas, 0, 0, 400), verEstructura: es.verEstructura !== false, verPanel: es.verPanel !== false },
    cargas: { nieve: num(ca.nieve, 0.5, 0, 5), estructura: num(ca.estructura, 0.12, 0, 1) },
    suelo: { sigAdm: num(su.sigAdm, 200, 50, 600) },
    precios: (c.precios && typeof c.precios === 'object') ? c.precios : {},
  };
}
export function cubiertaPorDefecto(tipo = 'dosaguas') {
  const def = TIPOS_CUBIERTA[tipo] || TIPOS_CUBIERTA.dosaguas, o = { w: def.w, d: def.d, cubierta: { tipo } };
  return { w: def.w, d: def.d, alto: altoCubierta(o), cubierta: normalizaCubierta(o) };
}

// ejes: a = luz (de alero a alero), b = largo (dirección de la cumbrera)
function ejes(o, C) {
  let sentido = C.sentido;
  if (C.tipo === 'cuatroaguas') sentido = o.w <= o.d ? 'd' : 'w';
  return sentido === 'd' ? { a: o.w, b: o.d, sentido } : { a: o.d, b: o.w, sentido };
}
const altura = (C, a, b, aa, bb) => {
  const p = C.pend / 100;
  if (C.tipo === 'dosaguas') return C.hAlero + p * (a / 2 - Math.abs(aa));
  if (C.tipo === 'cuatroaguas') return C.hAlero + p * Math.min(a / 2 - Math.abs(aa), b / 2 - Math.abs(bb));
  return C.hAlero + p * (aa + a / 2);
};
export function altoCubierta(o) {
  const C = normalizaCubierta(o), { a, b } = ejes(o, C), t = PANELES[C.panel.esp] ? C.panel.esp / 10 : 4;
  return Math.round(Math.max(altura(C, a, b, 0, 0), altura(C, a, b, a / 2, 0), altura(C, a, b, -a / 2, 0)) + t);
}

// ── recorte de un polígono convexo con una recta {p·(dx,dy) = c}: devuelve los dos extremos del segmento
function corta(poly, dx, dy, c) {
  const pts = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], sp = p[0] * dx + p[1] * dy - c, sq = q[0] * dx + q[1] * dy - c;
    if ((sp <= 0 && sq >= 0) || (sp >= 0 && sq <= 0)) {
      if (Math.abs(sp - sq) < 1e-9) { pts.push(p, q); continue; }
      const t = sp / (sp - sq); pts.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  if (pts.length < 2) return null;
  const k = [-dy, dx]; let mn = pts[0], mx = pts[0];
  for (const q of pts) { if (q[0] * k[0] + q[1] * k[1] < mn[0] * k[0] + mn[1] * k[1]) mn = q; if (q[0] * k[0] + q[1] * k[1] > mx[0] * k[0] + mx[1] * k[1]) mx = q; }
  return [mn, mx];
}

// planos de cubierta (polígonos en el plano a-b) con el vuelo incluido
function planos(C, a, b) {
  const v = C.vuelo, A = a / 2 + v, B = b / 2 + v;
  if (C.tipo === 'dosaguas') return [[[-A, -B], [0, -B], [0, B], [-A, B]], [[0, -B], [A, -B], [A, B], [0, B]]];
  if (C.tipo === 'cuatroaguas') {
    const r = Math.max(0, B - A);
    return [[[-A, -B], [0, -r], [0, r], [-A, B]], [[A, -B], [A, B], [0, r], [0, -r]], [[-A, -B], [A, -B], [0, -r]], [[-A, B], [0, r], [A, B]]].filter(p => p.length >= 3);
  }
  return [[[-A, -B], [A, -B], [A, B], [-A, B]]];
}

// pórticos, pilares y demás puntos de la estructura
function disposicion(o, C) {
  const { a, b } = ejes(o, C), nf = Math.max(2, Math.ceil(b / C.estructura.sepPorticos) + 1), sepP = b / (nf - 1);
  const centrales = a > 1400 && (C.tipo === 'dosaguas' || C.tipo === 'plana');
  const pilares = [];
  for (let i = 0; i < nf; i++) {
    const bb = -b / 2 + i * sepP;
    pilares.push([-a / 2, bb], [a / 2, bb]); if (centrales) pilares.push([0, bb]);
  }
  if (C.tipo === 'cuatroaguas') {
    const na = Math.max(2, Math.ceil(a / C.estructura.sepPorticos) + 1);
    for (let i = 1; i < na - 1; i++) { const aa = -a / 2 + i * a / (na - 1); pilares.push([aa, -b / 2], [aa, b / 2]); }
  }
  return { a, b, nf, sepP, centrales, pilares, planos: planos(C, a, b) };
}

const area2 = P => { let s = 0; for (let i = 0; i < P.length; i++) { const q = P[(i + 1) % P.length]; s += P[i][0] * q[1] - q[0] * P[i][1]; } return Math.abs(s) / 2; };
const gradiente = (C, a, b, P) => {
  const h = q => altura(C, a, b, q[0], q[1]), [p0, p1, p2] = [P[0], P[1], P[2]];
  const ax = p1[0] - p0[0], ay = p1[1] - p0[1], bx = p2[0] - p0[0], by = p2[1] - p0[1], dh1 = h(p1) - h(p0), dh2 = h(p2) - h(p0), det = ax * by - ay * bx;
  if (Math.abs(det) < 1e-9) return [1, 0];
  const gx = (dh1 * by - dh2 * ay) / det, gy = (ax * dh2 - bx * dh1) / det, l = Math.hypot(gx, gy);
  return l < 1e-6 ? [1, 0] : [gx / l, gy / l];
};

const elige = (serie, ok) => { for (const s of serie) if (ok(s)) return s; return serie[serie.length - 1]; };

export function calculosCubierta(o) {
  const C = normalizaCubierta(o), D = disposicion(o, C), { a, b, sepP } = D, p = C.pend / 100, cosA = Math.cos(Math.atan(p)), pan = PANELES[C.panel.esp];
  // cargas (kN/m² en proyección horizontal)
  const G = pan.kg * 0.00981 / cosA + C.cargas.estructura, Q = Math.max(C.cargas.nieve, 0.4), qU = 1.35 * G + 1.5 * Q, qS = G + Q;
  // paneles y correas, plano a plano
  let areaPan = 0, nPan = 0, mCorreas = 0, sepCorMax = 0, longFaldonMax = 0, nCorLineas = 0;
  const sepMaxPan = Math.min(pan.max * 100, C.estructura.sepCorreas > 0 ? C.estructura.sepCorreas : 1e9);
  const segmCorreas = [];
  for (const P of D.planos) {
    const g = gradiente(C, a, b, P), ts = P.map(q => q[0] * g[0] + q[1] * g[1]), t0 = Math.min(...ts), t1 = Math.max(...ts), fac = Math.sqrt(1 + p * p);
    const largoFald = (t1 - t0) * fac, nl = Math.max(1, Math.ceil(largoFald / sepMaxPan)), sepR = largoFald / nl;
    areaPan += area2(P) * fac / 10000; /* cm² → m² */ longFaldonMax = Math.max(longFaldonMax, largoFald); sepCorMax = Math.max(sepCorMax, sepR);
    const ks = P.map(q => -q[0] * g[1] + q[1] * g[0]), anchoPl = Math.max(...ks) - Math.min(...ks);
    nPan += Math.ceil(anchoPl / 100) * Math.max(1, Math.ceil(largoFald / 1200));
    for (let k = 0; k <= nl; k++) {
      const s = corta(P, g[0], g[1], t0 + (t1 - t0) * (k / nl) + (k === 0 ? 0.5 : k === nl ? -0.5 : 0)); if (!s) continue;
      mCorreas += Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]); nCorLineas++; segmCorreas.push([s, g]);
    }
  }
  const areaPedido = areaPan * 1.05;
  // correa (viga biapoyada entre pórticos)
  const Lc = sepP, qCu = qU * (sepCorMax / 100) * cosA, qCs = qS * (sepCorMax / 100) * cosA;
  // resistencia: W ≥ M/fyd (kN·cm / kN/cm²) y flecha ≤ L/250: I ≥ 5·q·L³·250/(384·E)
  const corr = elige(IPE, s => s[1] >= (qCu / 100) * Lc * Lc / 8 / FYD && s[2] >= 5 * (qCs / 100) * Math.pow(Lc, 3) * 250 / (384 * E));
  // viga principal (pórtico)
  const Lv = D.centrales ? a / 2 : a, qVu = qU * sepP / 100, qVs = qS * sepP / 100;
  const viga = elige(IPE, s => s[1] >= (qVu / 100) * Lv * Lv / 8 / FYD && s[2] >= 5 * (qVs / 100) * Math.pow(Lv, 3) * 250 / (384 * E));
  // pilares: compresión con pandeo (curva b)
  const hMax = Math.max(altura(C, a, b, a / 2, 0), altura(C, a, b, -a / 2, 0), altura(C, a, b, 0, 0)), hPil = Math.round(hMax);
  const aTrib = D.centrales ? a / 2 : a / 2, nEd = qU * (sepP / 100) * (aTrib / 100);
  const pilar = elige(HEA, s => {
    const A = s[3], Iz = s[4], Lk = hPil, Ncr = Math.PI * Math.PI * E * Iz / (Lk * Lk), lam = Math.sqrt(A * 27.5 / Ncr), phi = 0.5 * (1 + 0.34 * (lam - 0.2) + lam * lam), chi = Math.min(1, 1 / (phi + Math.sqrt(Math.max(0, phi * phi - lam * lam))));
    return nEd <= chi * A * 27.5 / 1.05 && hPil / (Math.sqrt(Iz / A)) <= 250;
  });
  // zapatas
  const nPil = C.estructura.pilares ? D.pilares.length : 0, nSer = nEd / 1.4 * 1.1, sig = C.suelo.sigAdm;
  const lado = Math.max(60, Math.ceil(Math.sqrt(nSer / sig) * 100 / 10) * 10), canto = Math.max(40, Math.ceil(lado / 3 / 5) * 5), m3Zap = nPil * (lado / 100) * (lado / 100) * (canto / 100);
  // acero
  const nViga = D.nf, ladoR = Math.hypot(a / 2, altura(C, a, b, 0, 0) - C.hAlero), mViga = nViga * (C.tipo === 'dosaguas' || C.tipo === 'cuatroaguas' ? 2 * ladoR : Math.hypot(a, p * a)) / 100;
  const mLimas = C.tipo === 'cuatroaguas' ? 4 * Math.hypot(Math.min(a, b) / 2, Math.min(a, b) / 2, p * Math.min(a, b) / 2) / 100 : 0;
  const mCorr = mCorreas / 100, mPil = nPil * (hPil - 40) / 100;
  const kgCorr = mCorr * corr[3], kgViga = (mViga + mLimas) * viga[3], kgPil = mPil * pilar[5], kgPlacas = nPil * 14;
  const cruces = nPil > 0 ? 4 : 0, mCruce = cruces * 2 * Math.hypot(sepP, hPil) / 100, kgCruce = mCruce * 2.42;
  // remates
  const v = C.vuelo, perimBajo = C.tipo === 'dosaguas' ? 2 * (b + 2 * v) : C.tipo === 'cuatroaguas' ? 2 * (a + b + 4 * v) : (b + 2 * v);
  const mCumbrera = C.tipo === 'dosaguas' ? (b + 2 * v) : C.tipo === 'cuatroaguas' ? (Math.max(0, b - a) + 4 * Math.hypot(a / 2 + v, a / 2 + v)) : 0;
  const mLaterales = C.tipo === 'dosaguas' ? 4 * Math.hypot(a / 2 + v, p * (a / 2)) : (C.tipo === 'cuatroaguas' ? 0 : 2 * Math.hypot(a + 2 * v, p * a));
  const kgAcero = kgCorr + kgViga + kgPil + kgPlacas + kgCruce;
  const f = (x, d = 1) => Number(x.toFixed(d));
  const lista = [
    ['panel', 'Panel sándwich ' + C.panel.esp + ' mm (con 5 % de solape y recortes)', f(areaPedido), 'm²'],
    ['tornillos', 'Tornillería autotaladrante con arandela (≈ 6 por m²)', Math.ceil(areaPan * 6), 'ud'],
    ['correas', 'Correas ' + corr[0] + ' (' + f(mCorr) + ' m)', f(kgCorr, 0), 'kg'],
    ['vigas', 'Vigas de pórtico ' + viga[0] + ' (' + f(mViga + mLimas) + ' m)', f(kgViga, 0), 'kg'],
  ];
  if (nPil > 0) lista.push(['pilares', nPil + ' pilares ' + pilar[0] + ' (' + f(mPil) + ' m)', f(kgPil, 0), 'kg'], ['placas', 'Placas de anclaje con 4 pernos (' + nPil + ' ud)', nPil, 'ud'], ['cruces', 'Cruces de San Andrés para arriostrar (' + cruces + ' paños)', f(kgCruce, 0), 'kg']);
  if (nPil > 0 && C.estructura.zapatas) lista.push(['zapatas', 'Hormigón de zapatas ' + lado + '×' + lado + '×' + canto + ' cm (' + nPil + ' ud)', f(m3Zap, 2), 'm³'], ['armadura', 'Armadura de zapatas (≈ 80 kg/m³)', f(m3Zap * 80, 0), 'kg']);
  lista.push(['canalon', 'Canalón y bajantes (en el lado bajo)', f(perimBajo / 100), 'm']);
  if (mCumbrera > 0) lista.push(['cumbrera', 'Remate de cumbrera', f(mCumbrera / 100), 'm']);
  if (mLaterales > 0) lista.push(['laterales', 'Remates laterales de panel', f(mLaterales / 100), 'm']);
  let total = 0; for (const [k, , q] of lista) total += (parseFloat(C.precios[k]) || 0) * q;
  const avisos = [];
  if (C.pend < 7 && C.tipo !== 'plana') avisos.push('Pendiente de ' + C.pend + ' %: con paneles de juntas conviene como mínimo un 7 %; por debajo, pide panel sin solape transversal.');
  if (C.tipo === 'plana' && C.pend < 5) avisos.push('Una cubierta de panel necesita al menos un 5 % de pendiente para evacuar el agua.');
  if (longFaldonMax > 1200) avisos.push('El faldón mide ' + f(longFaldonMax / 100) + ' m: los paneles se parten en tramos de 12 m máximo.');
  if (a > 1500) avisos.push('Luz de ' + f(a / 100) + ' m: es grande para un pórtico de este tipo; pide revisión a un técnico.');
  if (sepP > 700) avisos.push('Los pórticos quedan a ' + f(sepP / 100) + ' m: se disparan los perfiles; prueba con más pórticos (menor separación).');
  if (sepCorMax > pan.max * 100 + 1) avisos.push('Las correas quedan más separadas de lo que aguanta ese panel.');
  if (hPil > 600) avisos.push('Con más de 6 m de altura el viento manda: el cálculo real debe incluir el viento y los pilares en voladizo.');
  if (C.estructura.pilares && nPil === 0) avisos.push('Sin pilares.');
  avisos.push('Predimensionado orientativo: peso propio + ' + (C.cargas.nieve >= 0.4 ? 'nieve ' + f(C.cargas.nieve, 2) : 'mantenimiento 0,40') + ' kN/m², acero S275, vigas biapoyadas y pilares articulados. No incluye viento, sismo ni uniones: lo debe validar un técnico antes de ejecutarlo.');
  return {
    C, a, b, nPorticos: D.nf, sepP, nPil, areaPan: f(areaPan), nPan, longFaldonMax, cargas: { G: f(G, 2), Q: f(Q, 2), qU: f(qU, 2) },
    perfiles: { correa: corr[0], viga: viga[0], pilar: pilar[0] }, sepCorreas: f(sepCorMax, 0), hPil, nEd: f(nEd, 1),
    zapata: { lado, canto, n: nPil, m3: f(m3Zap, 2) }, kgAcero: f(kgAcero, 0), lista, total, avisos,
  };
}
export function textoCubierta(o) {
  const R = calculosCubierta(o), C = R.C, f = x => Number(x).toLocaleString('es-ES', { maximumFractionDigits: 2 });
  let t = 'CUBIERTA ' + TIPOS_CUBIERTA[C.tipo].n.toUpperCase() + '\n' + f(R.a / 100) + ' × ' + f(R.b / 100) + ' m · pendiente ' + C.pend + ' % · alero a ' + f(C.hAlero / 100) + ' m · vuelo ' + C.vuelo + ' cm\n';
  t += 'Panel sándwich ' + C.panel.esp + ' mm · ' + f(R.areaPan) + ' m² · ' + R.nPan + ' paneles\n';
  t += 'Correas ' + R.perfiles.correa + ' cada ' + R.sepCorreas + ' cm · Vigas ' + R.perfiles.viga + ' · Pilares ' + R.perfiles.pilar + ' (' + R.nPil + ' ud, cada ' + f(R.sepP / 100) + ' m)\n';
  if (C.estructura.pilares && C.estructura.zapatas) t += 'Zapatas ' + R.zapata.lado + '×' + R.zapata.lado + '×' + R.zapata.canto + ' cm (σ adm ' + C.suelo.sigAdm + ' kN/m²)\n';
  t += 'Acero total aprox.: ' + f(R.kgAcero) + ' kg\n\nMATERIALES\n';
  for (const [k, n, q, u] of R.lista) t += '- ' + n + ': ' + f(q) + ' ' + u + (C.precios[k] > 0 ? ' · ' + f(C.precios[k] * q) + ' €' : '') + '\n';
  if (R.total > 0) t += 'TOTAL: ' + f(R.total) + ' €\n';
  t += '\n' + R.avisos.join('\n');
  return t;
}

// ── geometría 3D (origen en el centro de la huella, suelo en y = 0)
function barra(p0, p1, ancho, alto, mat) {
  const d = new THREE.Vector3().subVectors(p1, p0), L = d.length(); if (L < 1e-4) return null;
  const m = new THREE.Mesh(new THREE.BoxGeometry(L, alto, ancho), mat);
  m.position.copy(p0).add(p1).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.normalize());
  m.castShadow = m.receiveShadow = true; return m;
}
export function construirCubierta(o) {
  const C = normalizaCubierta(o), D = disposicion(o, C), { a, b } = D, g = new THREE.Group(), tPan = C.panel.esp / 10, p = C.pend / 100, fac = Math.sqrt(1 + p * p);
  const sentido = ejes(o, C).sentido;
  const P3 = (aa, h, bb) => (sentido === 'd' ? new THREE.Vector3(aa * CM, h * CM, bb * CM) : new THREE.Vector3(bb * CM, h * CM, aa * CM));
  const H = (aa, bb) => altura(C, a, b, aa, bb);
  const matPan = new THREE.MeshStandardMaterial({ color: C.panel.color, metalness: 0.35, roughness: 0.45, side: THREE.DoubleSide });
  const matAcero = new THREE.MeshStandardMaterial({ color: 0x5b6168, metalness: 0.6, roughness: 0.5 });
  const matHorm = new THREE.MeshStandardMaterial({ color: 0x9c9a95, roughness: 0.95 });
  const matLinea = new THREE.LineBasicMaterial({ color: new THREE.Color(C.panel.color).multiplyScalar(0.62) });
  const corr = calculosCubierta(o).perfiles, sc = IPE.find(s => s[0] === corr.correa) || IPE[2], sv = IPE.find(s => s[0] === corr.viga) || IPE[5], sp = HEA.find(s => s[0] === corr.pilar) || HEA[0];
  const hC = sc[4] / 10, bC = sc[5] / 10, hV = sv[4] / 10, bV = sv[5] / 10, hP = sp[1] / 10, bP = sp[2] / 10;
  // paneles
  if (C.estructura.verPanel) for (const P of D.planos) {
    const top = P.map(q => P3(q[0], H(q[0], q[1]), q[1])), bot = P.map(q => P3(q[0], H(q[0], q[1]) - tPan * fac, q[1])), pos = [];
    const tri = (A, B, Cc) => { const n = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(Cc, A)); if (n.y < 0) [B, Cc] = [Cc, B]; pos.push(A.x, A.y, A.z, B.x, B.y, B.z, Cc.x, Cc.y, Cc.z); };
    for (let i = 1; i < P.length - 1; i++) { tri(top[0], top[i], top[i + 1]); tri(bot[0], bot[i + 1], bot[i]); }
    for (let i = 0; i < P.length; i++) { const j = (i + 1) % P.length; tri(top[i], top[j], bot[j]); tri(top[i], bot[j], bot[i]); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, matPan); m.castShadow = true; m.receiveShadow = false; /* receiveShadow con panel de doble cara da error de muestreo en WebGL */ g.add(m);
    // juntas de los paneles cada 100 cm, siguiendo la pendiente
    const gr = gradiente(C, a, b, P), ks = P.map(q => -q[0] * gr[1] + q[1] * gr[0]), k0 = Math.min(...ks), k1 = Math.max(...ks), lp = [];
    for (let k = k0 + 100; k < k1 - 1; k += 100) { const s = corta(P, -gr[1], gr[0], k); if (!s) continue; const A = P3(s[0][0], H(s[0][0], s[0][1]) + 0.4, s[0][1]), B = P3(s[1][0], H(s[1][0], s[1][1]) + 0.4, s[1][1]); lp.push(A.x, A.y, A.z, B.x, B.y, B.z); }
    if (lp.length) { const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); g.add(new THREE.LineSegments(lg, matLinea)); }
    g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), matLinea));
  }
  if (C.estructura.verEstructura) {
    const dec = tPan * fac;
    // correas
    for (const P of D.planos) {
      const gr = gradiente(C, a, b, P), ts = P.map(q => q[0] * gr[0] + q[1] * gr[1]), t0 = Math.min(...ts), t1 = Math.max(...ts), fa = Math.sqrt(1 + p * p);
      const lf = (t1 - t0) * fa, pan = PANELES[C.panel.esp], sepMax = Math.min(pan.max * 100, C.estructura.sepCorreas > 0 ? C.estructura.sepCorreas : 1e9), nl = Math.max(1, Math.ceil(lf / sepMax));
      for (let k = 0; k <= nl; k++) {
        const s = corta(P, gr[0], gr[1], t0 + (t1 - t0) * (k / nl) + (k === 0 ? 1 : k === nl ? -1 : 0)); if (!s) continue;
        const y = q => H(q[0], q[1]) - dec - hC / 2, m = barra(P3(s[0][0], y(s[0]), s[0][1]), P3(s[1][0], y(s[1]), s[1][1]), bC * CM, hC * CM, matAcero); if (m) g.add(m);
      }
    }
    // vigas de pórtico (por cada pórtico, siguiendo la cubierta)
    for (let i = 0; i < D.nf; i++) {
      const bb = -b / 2 + i * D.sepP, pts = [-a / 2];
      if (C.tipo === 'dosaguas') pts.push(0); else if (C.tipo === 'cuatroaguas') { const r = a / 2 - (b / 2 - Math.abs(bb)); if (r > 0) pts.push(-r, r); else pts.push(0); }
      pts.push(a / 2); pts.sort((x, y) => x - y);
      for (let j = 0; j < pts.length - 1; j++) {
        const y = aa => H(aa, bb) - dec - hC - hV / 2, m = barra(P3(pts[j], y(pts[j]), bb), P3(pts[j + 1], y(pts[j + 1]), bb), bV * CM, hV * CM, matAcero); if (m) g.add(m);
      }
    }
    if (C.tipo === 'cuatroaguas') { // limas en las esquinas
      const r = Math.max(0, b / 2 - a / 2);
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sa, sb]) => { const y = (aa, bb) => H(aa, bb) - dec - hC - hV / 2, m = barra(P3(sa * a / 2, y(sa * a / 2, sb * b / 2), sb * b / 2), P3(0, y(0, sb * r), sb * r), bV * CM, hV * CM, matAcero); if (m) g.add(m); });
    }
    // pilares y zapatas
    if (C.estructura.pilares) {
      const R = calculosCubierta(o);
      D.pilares.forEach(([aa, bb]) => {
        const top = H(aa, bb) - dec - hC - hV, m = new THREE.Mesh(new THREE.BoxGeometry(bP * CM, top * CM, hP * CM), matAcero);
        m.position.copy(P3(aa, top / 2, bb)); m.castShadow = m.receiveShadow = true; g.add(m);
        const pl = new THREE.Mesh(new THREE.BoxGeometry((bP + 12) * CM, 2 * CM, (hP + 12) * CM), matAcero); pl.position.copy(P3(aa, 1, bb)); g.add(pl);
        if (C.estructura.zapatas) { const z = new THREE.Mesh(new THREE.BoxGeometry(R.zapata.lado * CM, R.zapata.canto * CM, R.zapata.lado * CM), matHorm); z.position.copy(P3(aa, -R.zapata.canto / 2, bb)); z.receiveShadow = true; g.add(z); }
      });
    }
  }
  return g;
}
