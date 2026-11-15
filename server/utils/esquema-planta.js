// Generador de esquemas de distribución: a partir de las medidas del local y de las máquinas calcula las filas y los pasillos
// (pared + isla espalda con espalda + pared) y dibuja el esquema con cotas. Todo sale de números: no hay IA inventando medidas.
// El mismo cálculo se dibuja como SVG (pantalla) o como vectores en un PDF (pdfkit, sin imágenes ni tipografías externas).

export const COLORES_TIPO = { cardio: '#2a9d8f', pin: '#6a4fb3', discos: '#d1603d', poleas: '#2f7fd1', libre: '#e0a128', funcional: '#c2578b', maquina: '#8a8f98' };
export const NOMBRES_TIPO = { cardio: 'Cardio', pin: 'Máquinas de pin', discos: 'Discos / palanca', poleas: 'Poleas', libre: 'Peso libre', funcional: 'Funcional', maquina: 'Máquinas' };
const num = (v, d, mn, mx) => { if (v === undefined || v === null || String(v).trim() === '') return d; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? Math.max(mn, Math.min(mx, n)) : d; };
const r2 = (n) => Math.round(n * 100) / 100;

export function limpiaSpec(s = {}) {
  const ancho = num(s.ancho, 9, 2, 60), fondo = num(s.fondo, 10, 2, 60);
  return {
    titulo: String(s.titulo || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    ancho, fondo, orient: s.orient === 'y' ? 'y' : 'x',
    anchoMaq: num(s.anchoMaq, 1.1, 0.4, 4), fondoMaq: num(s.fondoMaq, 1.9, 0.4, 5), pasillo: num(s.pasillo, 1.1, 0.6, 3), hueco: num(s.hueco, 0.1, 0, 1),
    cortes: (Array.isArray(s.cortes) ? s.cortes : []).slice(0, 4).map(c => ({ x: num(c?.x, 0, 0, ancho), ancho: num(c?.ancho, 2, 0.5, 10), etiqueta: String(c?.etiqueta || 'Paso').slice(0, 20) })).filter(c => c.x + c.ancho <= ancho + 0.001),
    filasTipos: (Array.isArray(s.filasTipos) ? s.filasTipos : []).slice(0, 30).map(t => (COLORES_TIPO[t] ? t : 'maquina')),
  };
}

// La longitud de las filas va a lo largo del ancho (orient 'x') o del fondo (orient 'y'); los cortes (pasos) son siempre verticales en el dibujo.
export function distribuye(spec) {
  const s = limpiaSpec(spec), esX = s.orient === 'x';
  const L = esX ? s.ancho : s.fondo, D = esX ? s.fondo : s.ancho, d = s.fondoMaq, a = s.pasillo, pitch = s.anchoMaq + s.hueco;
  const cortes = esX ? s.cortes : [];
  const segs = []; let c0 = 0; [...cortes].sort((p, q) => p.x - q.x).forEach(c => { if (c.x > c0) segs.push([c0, c.x]); c0 = c.x + c.ancho; }); if (c0 < L) segs.push([c0, L]);
  const ys = [0]; let cur = d;
  for (let i = 0; i < 20; i++) {
    cur += a;
    if (cur + 2 * d <= D + 1e-6) { ys.push(cur, cur + d); cur += 2 * d; }
    else { if (cur + d <= D + 1e-6) ys.push(D - d); break; }
  }
  const filas = [];
  ys.forEach((y, i) => {
    const tipo = s.filasTipos.length ? s.filasTipos[Math.min(i, s.filasTipos.length - 1)] : 'maquina';
    segs.forEach(([a0, a1]) => { const n = Math.floor((a1 - a0 + 1e-6) / pitch); if (n > 0) filas.push({ y: r2(y), d, x0: r2(a0 + (a1 - a0 - n * pitch + s.hueco) / 2), n, pitch: r2(pitch), w: s.anchoMaq, tipo, fila: i + 1 }); });
  });
  const porTipo = {}; let total = 0; filas.forEach(f => { porTipo[f.tipo] = (porTipo[f.tipo] || 0) + f.n; total += f.n; });
  const usado = ys.length ? Math.max(...ys) + d : 0;
  return { spec: s, esX, L, D, filas, filasN: ys.length, total, porTipo, fondoUsado: r2(usado), sobra: r2(D - usado) };
}

// ── primitivas en metros del dibujo (x a la derecha, y hacia abajo) ──
function rectsDe(res) {
  const out = [];
  res.filas.forEach(f => { for (let i = 0; i < f.n; i++) { const along = f.x0 + i * f.pitch, across = f.y; out.push(res.esX ? { x: along, y: across, w: f.w, h: f.d, tipo: f.tipo } : { x: across, y: along, w: f.d, h: f.w, tipo: f.tipo }); } });
  return out;
}
const ancho = (res) => (res.esX ? res.L : res.D), fondo = (res) => (res.esX ? res.D : res.L);
const fmt = (n) => String(r2(n)).replace('.', ',');

export function esquemaSvg(spec, opciones = {}) {
  const res = distribuye(spec), W = ancho(res), H = fondo(res), S = Math.min(34, 600 / W), mx = 46, my = 56;
  const X = (m) => r2(mx + m * S), Y = (m) => r2(my + m * S);
  const tipos = Object.keys(res.porTipo), vw = Math.max(680, Math.round(mx * 2 + W * S)), vh = Math.round(my + H * S + 100 + Math.ceil(tipos.length / 3) * 20);
  let g = '';
  (res.spec.cortes || []).forEach(c => { g += `<rect x="${X(c.x)}" y="${Y(0)}" width="${r2(c.ancho * S)}" height="${r2(H * S)}" fill="none" stroke="#7a766f" stroke-width="1" stroke-dasharray="5 4"/><text x="${r2(X(c.x) + c.ancho * S / 2)}" y="${r2(Y(H / 2))}" text-anchor="middle" font-size="12" fill="#7a766f">${c.etiqueta} ${fmt(c.ancho)} m</text>`; });
  g += `<rect x="${X(0)}" y="${Y(0)}" width="${r2(W * S)}" height="${r2(H * S)}" fill="none" stroke="#1e1b18" stroke-width="3"/>`;
  rectsDe(res).forEach(m => { g += `<rect x="${X(m.x)}" y="${Y(m.y)}" width="${r2(m.w * S - 1)}" height="${r2(m.h * S - 1)}" rx="2" fill="${COLORES_TIPO[m.tipo]}" fill-opacity="0.78" stroke="${COLORES_TIPO[m.tipo]}" stroke-width="0.8"/>`; });
  g += `<line x1="${X(0)}" y1="${Y(H) + 18}" x2="${X(W)}" y2="${Y(H) + 18}" stroke="#7a766f" stroke-width="0.8"/><text x="${r2(X(W / 2))}" y="${Y(H) + 34}" text-anchor="middle" font-size="12" fill="#444">${fmt(W)} m</text>`;
  g += `<line x1="${X(W) + 16}" y1="${Y(0)}" x2="${X(W) + 16}" y2="${Y(H)}" stroke="#7a766f" stroke-width="0.8"/><text x="${X(W) + 22}" y="${r2(Y(H / 2))}" font-size="12" fill="#444">${fmt(H)} m</text>`;
  let lx = mx, ly = Y(H) + 58;
  tipos.forEach((t, i) => { if (i && i % 3 === 0) { lx = mx; ly += 20; } g += `<rect x="${lx}" y="${ly - 10}" width="14" height="14" rx="2" fill="${COLORES_TIPO[t]}" fill-opacity="0.78"/><text x="${lx + 20}" y="${ly + 1}" font-size="12" fill="#444">${NOMBRES_TIPO[t]}: ${res.porTipo[t]}</text>`; lx += 210; });
  const tit = (res.spec.titulo || opciones.titulo) ? `<text x="${mx}" y="30" font-size="16" font-weight="600" fill="#1e1b18">${String(res.spec.titulo || opciones.titulo).replace(/[<>&]/g, '')}</text>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}" width="100%" font-family="Helvetica, Arial, sans-serif">${tit}<text x="${vw - mx}" y="30" text-anchor="end" font-size="12" fill="#6b6560">${res.total} máquinas · ${res.filasN} filas · pasillos ${fmt(res.spec.pasillo)} m</text>${g}</svg>`;
  return { svg, resumen: resumenDe(res), res };
}

export function resumenDe(res) {
  return { total: res.total, filas: res.filasN, porTipo: res.porTipo, fondoUsado: res.fondoUsado, sobra: res.sobra, ancho: ancho(res), fondo: fondo(res), pasillo: res.spec.pasillo, maquina: res.spec.anchoMaq + ' x ' + res.spec.fondoMaq + ' m' };
}

// Dibuja el esquema en un documento pdfkit, dentro de un rectángulo (x, y, anchoMax, altoMax). Devuelve la altura usada.
export function esquemaPdf(doc, spec, x, y, anchoMax, altoMax) {
  const res = distribuye(spec), W = ancho(res), H = fondo(res), tipos = Object.keys(res.porTipo);
  const lead = 36 + Math.ceil(tipos.length / 3) * 14, S = Math.min((anchoMax - 40) / W, (altoMax - lead - 24) / H), ox = x + 20, oy = y + 4;
  (res.spec.cortes || []).forEach(c => { doc.save().dash(4, { space: 3 }).lineWidth(0.7).strokeColor('#7a766f').rect(ox + c.x * S, oy, c.ancho * S, H * S).stroke().undash().restore(); doc.fillColor('#7a766f').font('Helvetica').fontSize(7).text(c.etiqueta + ' ' + fmt(c.ancho) + ' m', ox + c.x * S, oy + H * S / 2, { width: c.ancho * S, align: 'center' }); });
  rectsDe(res).forEach(m => { doc.save().fillOpacity(0.78).fillColor(COLORES_TIPO[m.tipo]).roundedRect(ox + m.x * S, oy + m.y * S, Math.max(1, m.w * S - 0.8), Math.max(1, m.h * S - 0.8), 1.5).fill().restore(); });
  doc.save().lineWidth(1.8).strokeColor('#1e1b18').rect(ox, oy, W * S, H * S).stroke().restore();
  doc.fillColor('#444').font('Helvetica').fontSize(8).text(fmt(W) + ' m', ox, oy + H * S + 5, { width: W * S, align: 'center' });
  doc.text(fmt(H) + ' m', ox + W * S + 5, oy + H * S / 2 - 4, { lineBreak: false });
  let lx = ox, ly = oy + H * S + 22;
  tipos.forEach((t, i) => { if (i && i % 3 === 0) { lx = ox; ly += 14; } doc.save().fillOpacity(0.78).fillColor(COLORES_TIPO[t]).rect(lx, ly, 9, 9).fill().restore(); doc.fillColor('#444').fontSize(8).text(NOMBRES_TIPO[t] + ': ' + res.porTipo[t], lx + 13, ly + 1, { lineBreak: false }); lx += 150; });
  doc.fillColor('#6b6560').fontSize(8).text(res.total + ' máquinas · ' + res.filasN + ' filas · pasillos ' + fmt(res.spec.pasillo) + ' m · máquina ' + fmt(res.spec.anchoMaq) + ' × ' + fmt(res.spec.fondoMaq) + ' m', ox, ly + 16, { lineBreak: false });
  return oy - y + H * S + lead + 12;
}
