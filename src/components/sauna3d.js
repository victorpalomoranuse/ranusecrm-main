// Diseñador de saunas: tradicional, híbrida (estufa + infrarrojos) e infrarrojos. Todo en cm; el grupo 3D va en metros (CM = 0.01).
// Origen del grupo: centro de la planta, en el suelo. Fondo de la sauna en z negativo; el frente (puerta y cristal) en z positivo.
import * as THREE from 'three';

const CM = 0.01;
export const MADERAS = {
  abeto: { n: 'Abeto nórdico', c: '#d9bb8c' },
  aspen: { n: 'Álamo temblón (aspen)', c: '#e6d2ab' },
  cedro: { n: 'Cedro rojo', c: '#b8774b' },
  hemlock: { n: 'Hemlock', c: '#cfa97a' },
  termo: { n: 'Madera termotratada', c: '#6e4d36' },
};
export const TIPOS_SAUNA = {
  tradicional: { n: 'Tradicional (estufa de piedras)', w: 200, d: 180, alto: 210 },
  hibrida: { n: 'Híbrida (estufa + infrarrojos)', w: 190, d: 170, alto: 210 },
  infrarrojos: { n: 'Infrarrojos', w: 130, d: 110, alto: 200 },
};

// Valores de partida de cada tipo
export function saunaPorDefecto(tipo = 'tradicional') {
  const t = TIPOS_SAUNA[tipo] || TIPOS_SAUNA.tradicional;
  const S = {
    tipo, madera: tipo === 'infrarrojos' ? 'hemlock' : 'abeto', niveles: tipo === 'infrarrojos' ? 1 : 2, forma: 'recto',
    estufa: { tipo: 'electrica', lado: 'der', kw: 0 },
    ir: { fondo: tipo === 'tradicional' ? 0 : tipo === 'hibrida' ? 2 : 3, lateral: tipo === 'tradicional' ? 0 : tipo === 'hibrida' ? 1 : 1, bajoBanco: tipo === 'infrarrojos' },
    frente: { tipo: 'cristal', puerta: 70, lado: 'izq', ventana: false },
    techo: true, luz: true, respaldos: true, precios: {},
  };
  return { w: t.w, d: t.d, alto: t.alto, sauna: S };
}

const TAMANOS_ESTUFA = [2.3, 3, 3.6, 4.5, 6, 6.8, 8, 9, 10.5, 12, 15]; // potencias comerciales habituales (kW)
const num = (v, def) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : def);
export function normalizaSauna(o) {
  const b = saunaPorDefecto(o?.sauna?.tipo || 'tradicional').sauna, S = o?.sauna || {};
  return {
    ...b, ...S, estufa: { ...b.estufa, ...(S.estufa || {}) }, ir: { ...b.ir, ...(S.ir || {}) }, frente: { ...b.frente, ...(S.frente || {}) }, precios: S.precios || {},
    niveles: Math.max(1, Math.min(3, Math.round(num(S.niveles, b.niveles)))),
  };
}

// Geometría interior (medidas libres entre paredes) y de los bancos
function medidas(o, S) {
  const T = 4, W = o.w, D = o.d, H = o.alto;
  const iw = W - 2 * T, id = D - 2 * T, ih = H - T - 5; // 5 cm de tarima en el suelo
  const prof = S.tipo === 'infrarrojos' ? Math.min(50, id - 30) : 55;
  const alturas = S.niveles === 1 ? [45] : S.niveles === 2 ? [45, 90] : [40, 80, 115];
  return { T, W, D, H, iw, id, ih, prof, alturas };
}

export function calculosSauna(o) {
  const S = normalizaSauna(o), m = medidas(o, S);
  const vol = (m.iw * m.id * m.ih) / 1e6; // m³ interiores
  const vidrioM2 = ((S.frente.tipo === 'cristal' ? (m.iw * Math.min(m.ih, 200)) : (S.frente.puerta * 190)) + (S.frente.ventana ? 60 * 80 : 0)) / 1e4;
  const volEf = vol + 1.2 * vidrioM2; // 1 m² de cristal se compensa con ~1,2 m³ extra
  const conEstufa = S.tipo !== 'infrarrojos', conIR = S.tipo !== 'tradicional';
  const kwEstufa = conEstufa ? (S.estufa.kw > 0 ? S.estufa.kw : (TAMANOS_ESTUFA.find(k => k >= volEf * (S.tipo === 'hibrida' ? 0.75 : 1)) || 15)) : 0;
  const nIR = conIR ? (S.ir.fondo + 2 * S.ir.lateral + (S.ir.bajoBanco ? 1 : 0)) : 0;
  const wIR = conIR ? Math.round((vol * (S.tipo === 'hibrida' ? 250 : 650)) / 50) * 50 : 0; // W totales orientativos de paneles
  const largoBancos = (m.iw + (S.forma === 'L' ? m.id - m.prof : 0)) * (S.niveles === 1 ? 1 : 1);
  const personas = Math.max(1, Math.floor(largoBancos / 60));
  const kgPiedras = conEstufa && S.estufa.tipo === 'electrica' ? Math.round(kwEstufa * 3.3) : conEstufa ? 20 : 0;
  const potenciaTotalW = Math.round(kwEstufa * 1000) + wIR + (S.luz ? 40 : 0);
  const fase = potenciaTotalW <= 3600 ? 'Monofásica 230 V (16 A)' : 'Trifásica 400 V';
  const amp = fase.startsWith('Mono') ? Math.ceil(potenciaTotalW / 230) : Math.ceil(potenciaTotalW / (400 * 1.732));
  // Materiales (m² de superficie de madera, etc.)
  const perim = 2 * (m.iw + m.id) - (S.frente.tipo === 'cristal' ? m.iw : 0);
  const m2Paredes = (perim * m.ih) / 1e4, m2Techo = S.techo ? (m.iw * m.id) / 1e4 : 0, m2Suelo = (m.iw * m.id) / 1e4;
  const m2Bancos = (S.niveles * largoBancos * m.prof) / 1e4 * (S.niveles >= 2 ? 0.75 : 1);
  const lista = [
    ['paredes', 'Revestimiento de paredes (' + MADERAS[S.madera].n + ')', Math.round(m2Paredes * 10) / 10, 'm²'],
    ['techo', 'Revestimiento de techo', Math.round(m2Techo * 10) / 10, 'm²'],
    ['suelo', 'Tarima de suelo', Math.round(m2Suelo * 10) / 10, 'm²'],
    ['bancos', 'Bancos (listones ' + (S.madera === 'aspen' ? 'aspen' : 'sin nudos') + ', ' + S.niveles + ' nivel' + (S.niveles > 1 ? 'es' : '') + ')', Math.round(m2Bancos * 10) / 10, 'm²'],
    ['cristal', 'Cristal templado (frente y ventana)', Math.round(vidrioM2 * 100) / 100, 'm²'],
    ['puerta', 'Puerta de cristal ' + S.frente.puerta + ' cm con herrajes', 1, 'ud'],
  ];
  if (conEstufa) { lista.push(['estufa', 'Estufa ' + (S.estufa.tipo === 'lena' ? 'de leña' : 'eléctrica') + (S.estufa.tipo === 'electrica' ? ' ' + kwEstufa + ' kW' : ''), 1, 'ud']); lista.push(['piedras', 'Piedras de sauna', kgPiedras, 'kg']); lista.push(['proteccion', 'Barandilla de protección de la estufa', 1, 'ud']); }
  if (conIR) lista.push(['ir', 'Paneles de infrarrojos (' + wIR + ' W en total)', nIR, 'ud']);
  if (S.luz) lista.push(['luz', 'Tira LED bajo bancos', Math.round(largoBancos) / 100, 'm']);
  if (S.estufa?.tipo === 'lena' && conEstufa) lista.push(['chimenea', 'Chimenea y paso de techo', 1, 'ud']);
  lista.push(['ventilacion', 'Rejillas de ventilación', 2, 'ud']);
  const total = lista.reduce((s, [k, , q]) => s + (num(S.precios[k], 0) * q), 0);
  const avisos = [];
  if (conEstufa && S.estufa.tipo === 'electrica' && kwEstufa > 9) avisos.push('Estufa de más de 9 kW: lo habitual es la regulación con control de potencia y una instalación eléctrica dedicada.');
  if (potenciaTotalW > 3600) avisos.push('Con esta potencia hace falta alimentación trifásica y una línea propia desde el cuadro, con protección diferencial.');
  if (m.ih < 190 && S.tipo !== 'infrarrojos') avisos.push('Altura interior baja: para sauna de piedras se recomienda al menos 2,10 m para que el vapor se reparta bien.');
  if (S.niveles >= 2 && m.ih < m.alturas?.[1]) avisos.push('El segundo nivel queda demasiado alto para la altura disponible.');
  if (S.tipo !== 'infrarrojos' && m.id < 150 && S.forma === 'L') avisos.push('Con el fondo tan corto, el banco en L deja poco paso: considera banco recto.');
  avisos.push('Valores orientativos de referencia del sector: antes de comprar o instalar, confirma potencia, distancias de seguridad y ventilación con la ficha del fabricante y con un instalador autorizado.');
  return { vol: Math.round(vol * 100) / 100, volEf: Math.round(volEf * 100) / 100, kwEstufa, nIR, wIR, personas, kgPiedras, potenciaTotalW, fase, amp, lista, total, avisos, vidrioM2: Math.round(vidrioM2 * 100) / 100 };
}

// Texto para copiar / pegar (lista de materiales)
export function textoMateriales(o) {
  const c = calculosSauna(o), S = normalizaSauna(o);
  const f = (v) => (Number.isFinite(v) ? v.toLocaleString('es-ES', { maximumFractionDigits: 2 }) : '');
  const lineas = [`${o.nombre || 'Sauna'} — ${TIPOS_SAUNA[S.tipo].n}`, `${Math.round(o.w)} × ${Math.round(o.d)} × ${Math.round(o.alto)} cm · ${c.personas} persona(s) · ${f(c.vol)} m³`, ''];
  c.lista.forEach(([k, n, q, u]) => { const p = num(S.precios[k], 0); lineas.push(`${n}: ${f(q)} ${u}${p ? ` × ${f(p)} € = ${f(p * q)} €` : ''}`); });
  if (c.total) lineas.push('', `Total: ${f(c.total)} €`);
  lineas.push('', `Potencia: ${c.kwEstufa ? c.kwEstufa + ' kW estufa' : ''}${c.kwEstufa && c.wIR ? ' + ' : ''}${c.wIR ? c.wIR + ' W infrarrojos' : ''} · ${c.fase} (≈ ${c.amp} A)`);
  return lineas.join('\n');
}

// ───────────────────────────── Geometría 3D ─────────────────────────────
export function construirSauna(o) {
  const S = normalizaSauna(o), m = medidas(o, S), { T, W, D, H, iw, id, ih, prof, alturas } = m;
  const g = new THREE.Group();
  const col = /^#[0-9a-fA-F]{6}$/.test(o.color || '') ? o.color : MADERAS[S.madera]?.c || '#d9bb8c';
  const base = new THREE.Color(col);
  const mat = (c, r = 0.75, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0, ...extra });
  const wood = mat(base), woodDark = mat(base.clone().multiplyScalar(0.8)), woodLight = mat(base.clone().lerp(new THREE.Color('#ffffff'), 0.18));
  const glass = new THREE.MeshPhysicalMaterial({ color: '#bcd7e2', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
  const frameM = mat('#1d1d1d', 0.4, { metalness: 0.5 }), steel = mat('#3a3a3a', 0.35, { metalness: 0.7 }), stone = mat('#6f6f73', 0.95);
  const irM = mat('#5a2a22', 0.6, { emissive: new THREE.Color('#ff3a14'), emissiveIntensity: 0.55 });
  const led = mat('#ffcf8a', 0.4, { emissive: new THREE.Color('#ffb25a'), emissiveIntensity: 1.2 });
  // caja(ancho, alto, fondo, x, y, z) en cm; (x,z) = centro, y = base
  const caja = (w, h, d, x, y, z, mt = wood, padre = g) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w, 0.1) * CM, Math.max(h, 0.1) * CM, Math.max(d, 0.1) * CM), mt);
    b.position.set(x * CM, (y + h / 2) * CM, z * CM); b.castShadow = b.receiveShadow = true; padre.add(b); return b;
  };
  const x0 = -W / 2, x1 = W / 2, zB = -D / 2, zF = D / 2;
  // suelo (tarima) y paredes
  caja(iw, 5, id, 0, 0, 0, woodDark);
  caja(W, ih + 5 + T, T, 0, 0, zB + T / 2, wood); // fondo
  caja(T, ih + 5 + T, D, x0 + T / 2, 0, 0, wood); // izquierda
  caja(T, ih + 5 + T, D, x1 - T / 2, 0, 0, wood); // derecha
  if (S.techo) caja(W, T, D, 0, H - T, 0, woodLight);
  // listones verticales (relieve) en el fondo y los costados
  for (let i = 0; i < Math.floor(iw / 14); i++) caja(0.5, ih, 0.5, -iw / 2 + 7 + i * 14, 5, zB + T + 0.25, woodDark);
  // ── frente: cristal y puerta ──
  const frente = new THREE.Group(); g.add(frente);
  const pw = Math.max(55, Math.min(S.frente.puerta, iw - 30)), ph = Math.min(ih - 6, 195), lado = S.frente.lado === 'der' ? 1 : -1;
  const pcx = lado * (iw / 2 - pw / 2 - 1);
  const panel = (w, h, x, y, grosor = 0.8) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w * CM, h * CM, grosor * CM), glass); b.position.set(x * CM, (y + h / 2) * CM, (zF - T / 2) * CM); frente.add(b); return b; };
  if (S.frente.tipo === 'cristal') {
    const wf = iw - pw - 2; if (wf > 5) panel(wf, ih, -lado * (pw / 2 + 1) + 0, 5); // cristal fijo
    if (wf > 5) { const xf = -lado * (pw / 2 + 1); caja(wf + 2, 2, 2, xf, 5 + ih, zF - T / 2, frameM, frente); caja(wf + 2, 2, 2, xf, 3, zF - T / 2, frameM, frente); }
    // sobre-puerta de cristal fijo
    if (ih - ph - 5 > 6) panel(pw, ih - ph - 5, pcx, 5 + ph);
  } else {
    // frente de madera con hueco para la puerta y ventana opcional
    const wR = iw - pw - 2; caja(wR, ih + T, T, -lado * (pw / 2 + 1), 0, zF - T / 2, wood, frente);
    caja(pw, ih - ph - 5 + T, T, pcx, 5 + ph, zF - T / 2, wood, frente);
  }
  // puerta (hoja de cristal con marco y tirador de barra del lado contrario a la bisagra)
  const hoja = new THREE.Group(); hoja.position.set((pcx - lado * pw / 2) * CM, 0, (zF - T / 2 + 1.5) * CM); // eje en el lado de la bisagra
  const hojaW = pw - 2; const hg = new THREE.Mesh(new THREE.BoxGeometry(hojaW * CM, ph * CM, 0.8 * CM), glass); hg.position.set(lado * hojaW / 2 * CM, (5 + ph / 2) * CM, 0); hoja.add(hg);
  [[hojaW, 2, 0, 5 + ph - 1], [hojaW, 2, 0, 6]].forEach(([w, h, x, y]) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w * CM, h * CM, 1.4 * CM), frameM); b.position.set((lado * hojaW / 2 + x) * CM, y * CM, 0); hoja.add(b); });
  [0, hojaW].forEach(x => { const b = new THREE.Mesh(new THREE.BoxGeometry(2 * CM, ph * CM, 1.4 * CM), frameM); b.position.set(lado * x * CM, (5 + ph / 2) * CM, 0); hoja.add(b); });
  const asa = new THREE.Mesh(new THREE.CylinderGeometry(0.9 * CM, 0.9 * CM, 90 * CM, 12), steel); asa.position.set(lado * (hojaW - 6) * CM, (5 + ph / 2) * CM, 5 * CM); hoja.add(asa);
  [-35, 35].forEach(dz => { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.9 * CM, 0.9 * CM, 5 * CM, 10), steel); p.rotation.x = Math.PI / 2; p.position.set(lado * (hojaW - 6) * CM, (5 + ph / 2 + dz) * CM, 2.5 * CM); hoja.add(p); });
  g.add(hoja);
  // ventana lateral de cristal (pared derecha o izquierda según el lado contrario a la estufa)
  if (S.frente.ventana) { const ladoV = S.estufa.lado === 'der' ? -1 : 1, wv = Math.min(70, id - 40), hv = 80, b = new THREE.Mesh(new THREE.BoxGeometry(0.8 * CM, hv * CM, wv * CM), glass); b.position.set(ladoV * (W / 2 - T / 2) * CM, (110 + hv / 2) * CM, (zB + T + wv / 2 + 20) * CM); g.add(b); [[2, hv, wv + 2, 0], [2, 2, wv + 2, hv / 2 - 1], [2, 2, wv + 2, -hv / 2 + 1]].forEach(([w, h, d, dy]) => { caja(w, h, d, ladoV * (W / 2 - T / 2), 110 + hv / 2 + dy - h / 2, zB + T + wv / 2 + 20, frameM); }); }
  // ── bancos ──
  const bancoNivel = (i) => {
    const hSeat = alturas[i], dz = zB + T + prof * (alturas.length - i - 0.5) * (S.niveles === 1 ? 1 : 1) ; // el nivel más alto va pegado al fondo
    const zc = zB + T + prof * (alturas.length - 1 - i) + prof / 2;
    const largo = iw - (S.forma === 'L' ? prof : 0), xc = (S.forma === 'L' ? prof / 2 : 0);
    const lis = Math.round(prof / 7);
    for (let k = 0; k < lis; k++) caja(largo, 2.6, 5.4, xc, hSeat - 2.6, zc - prof / 2 + 3.5 + k * (prof / lis), wood); // listones
    caja(largo, hSeat - 5 - 2.6, 3, xc, 5, zc + prof / 2 - 2, woodDark); // frente del banco (cenefa)
    [-largo / 2 + 3, 0, largo / 2 - 3].forEach(x => caja(4, hSeat - 5 - 2.6, prof - 8, xc + x, 5, zc, woodDark)); // soportes
    if (S.luz) caja(largo - 6, 0.8, 1, xc, hSeat - 5.5, zc + prof / 2 - 1, led);
    if (S.respaldos && i === alturas.length - 1) { const r = new THREE.Mesh(new THREE.BoxGeometry((largo - 10) * CM, 14 * CM, 2.6 * CM), wood); r.position.set(xc * CM, (hSeat + 32) * CM, (zB + T + 2) * CM); r.rotation.x = -0.18; r.castShadow = true; g.add(r); }
    return { zc, largo, xc };
  };
  const niv = alturas.map((_, i) => bancoNivel(i));
  // banco en L: lateral del lado opuesto a la estufa (a la altura del primer nivel)
  if (S.forma === 'L') { const xL = -iw / 2 + prof / 2; const lenL = id - prof; const zc = zB + T + prof + lenL / 2; for (let k = 0; k < Math.round(prof / 7); k++) caja(5.4, 2.6, lenL, xL - prof / 2 + 3.5 + k * (prof / Math.round(prof / 7)), alturas[0] - 2.6, zc, wood); caja(prof - 8, alturas[0] - 7.6, lenL - 4, xL, 5, zc, woodDark); }
  // ── estufa y protección ──
  if (S.tipo !== 'infrarrojos') {
    const sx = (S.estufa.lado === 'der' ? 1 : -1) * (iw / 2 - 28), sz = zF - T - 32;
    if (S.estufa.tipo === 'electrica') {
      caja(36, 58, 28, sx, 5, sz, steel);
      for (let i = 0; i < 26; i++) { const r = (3.5 + (i % 5)); const p = new THREE.Mesh(new THREE.DodecahedronGeometry(r * CM, 0), stone); p.position.set((sx + (((i * 37) % 31) - 15) * 0.9) * CM, (63 + ((i * 13) % 9)) * CM, (sz + (((i * 53) % 21) - 10) * 0.8) * CM); p.rotation.set(i, i * 2, 0); p.castShadow = true; g.add(p); }
    } else {
      caja(40, 70, 44, sx, 5, sz, steel);
      const ch = new THREE.Mesh(new THREE.CylinderGeometry(6 * CM, 6 * CM, (H - 75) * CM, 16), steel); ch.position.set(sx * CM, (75 + (H - 75) / 2) * CM, sz * CM); g.add(ch);
      for (let i = 0; i < 18; i++) { const p = new THREE.Mesh(new THREE.DodecahedronGeometry((4 + i % 4) * CM, 0), stone); p.position.set((sx + ((i * 31) % 25 - 12)) * CM, (76 + (i % 3) * 3) * CM, (sz + ((i * 47) % 21 - 10)) * CM); g.add(p); }
    }
    // protección de madera alrededor (3 lados)
    const pw2 = 62, pd = 56, hz = 70, cxp = sx, czp = sz - 4;
    [[pw2, 3, 2, cxp, hz, czp + pd / 2], [2, 3, pd, cxp + (S.estufa.lado === 'der' ? -pw2 / 2 : pw2 / 2), hz, czp]].forEach(([w, h, d, x, y, z]) => caja(w, h, d, x, y, z, wood));
    [[cxp - pw2 / 2, czp + pd / 2], [cxp + pw2 / 2, czp + pd / 2]].forEach(([x, z]) => caja(3, hz, 3, x, 5, z, wood));
    for (let k = 0; k < 4; k++) caja(pw2, 2.4, 1.4, cxp, 20 + k * 14, czp + pd / 2, wood);
  }
  // ── paneles de infrarrojos ──
  if (S.tipo !== 'tradicional') {
    const pan = (w, h, x, y, z, ry = 0) => { const gp = new THREE.Group(); const b = new THREE.Mesh(new THREE.BoxGeometry(w * CM, h * CM, 2.2 * CM), irM); gp.add(b); const mk = new THREE.Mesh(new THREE.BoxGeometry((w + 1.4) * CM, (h + 1.4) * CM, 1.6 * CM), woodDark); mk.position.z = -0.7 * CM; gp.add(mk); gp.position.set(x * CM, y * CM, z * CM); gp.rotation.y = ry; g.add(gp); };
    const nF = S.ir.fondo; for (let i = 0; i < nF; i++) pan(Math.min(40, (iw - 10) / nF - 3), 80, -iw / 2 + (iw / nF) * (i + 0.5), (alturas[alturas.length - 1] + 55), zB + T + 1.2);
    const nL = S.ir.lateral;
    // laterales (derecha e izquierda, mirando hacia dentro)
    for (let i = 0; i < nL; i++) {
      const zz = zB + T + 30 + (nL > 1 ? (i * (id - 60)) / (nL - 1) : (id - 60) / 2), pw3 = 40, ph3 = 80, yy = alturas[Math.min(1, alturas.length - 1)] + 55;
      pan(pw3, ph3, -iw / 2 + 1.2, yy, zz, Math.PI / 2); pan(pw3, ph3, iw / 2 - 1.2, yy, zz, -Math.PI / 2);
    }
    if (S.ir.bajoBanco) pan(Math.min(100, iw - 20), 30, 0, 22, zB + T + prof * alturas.length - 0.5, 0);
  }
  // rejillas de ventilación
  caja(14, 1.2, 1.4, (S.estufa.lado === 'der' ? 1 : -1) * (iw / 2 - 28), 8, zB + T + 0.7, frameM); // admisión (zona estufa, a ras de suelo)
  caja(14, 1.2, 1.4, (S.estufa.lado === 'der' ? -1 : 1) * (iw / 2 - 28), H - T - 14, zB + T + 0.7, frameM); // salida alta (diagonal opuesta)
  // luz ambiental muy tenue: sin focos reales para no recargar el visor
  g.userData.sauna = true;
  return g;
}
