// Lámina de zonas para el cliente: un plano bonito (no de ejecución) que enseña cómo se organiza la sala.
// Lee las máquinas colocadas en Planos, la IA las clasifica por tipo (pin, discos, cardio, poleas…) y por grupo muscular (pecho, espalda, pierna…),
// se agrupan por cercanía y se dibujan como manchas de color con su nombre, la leyenda al lado y la marca de Ranuse.
// El mismo dibujo (lista de primitivas) sale como SVG (vista previa) o como vectores en un PDF (pdfkit).
import { callClaude } from './anthropic.js';

export const TIPOS = ['cardio', 'pin', 'discos', 'poleas', 'libre', 'funcional', 'otro'];
export const COLOR = { cardio: '#2a9d8f', pin: '#7a64c4', discos: '#d9774f', poleas: '#3f84c9', libre: '#d9a232', funcional: '#c9628f', otro: '#9a948d' };
export const NOMBRE = { cardio: 'Cardio', pin: 'Máquinas de pin', discos: 'Discos y palanca', poleas: 'Poleas', libre: 'Peso libre', funcional: 'Funcional', otro: 'Otros' };
const GRUPOS = ['Pecho', 'Espalda', 'Hombro', 'Brazos', 'Pierna', 'Glúteo', 'Abdomen', 'Cardio', 'Funcional', 'Peso libre', 'Otros'];
export const clave = (e) => String(e.nm || e.cid || 'sin nombre').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120);
const txt = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// ── 1) clasificación con IA (una sola vez por nombre; lo que corrija el usuario manda)
export async function clasificaNombres(nombres) {
  const lista = nombres.slice(0, 120);
  const r = await callClaude({ maxTokens: 3500, system: 'Eres técnico de equipamiento de gimnasios. Clasificas máquinas por su nombre. Responde SOLO con JSON.', messages: [{ role: 'user', content: 'Clasifica cada máquina o mueble por TIPO y GRUPO.\nTIPO: cardio (cintas, bicis, elípticas, remo ergómetro…), pin (máquina de placa con pin/selectorizada), discos (carga de discos: palanca, plate-loaded, prensa, hack, hip thrust de discos, T-bar), poleas (poleas, cable crossover, torre de poleas, jaula funcional con poleas), libre (racks, bancos, mancuernero, barras, discos, power rack), funcional (trineos, cajones, cuerdas, suspensión, suelo funcional), otro (cualquier otra cosa: mobiliario, mostrador…).\nGRUPO (uno de): ' + GRUPOS.join(', ') + '.\nMÁQUINAS:\n' + lista.map((n, i) => i + ': ' + n).join('\n') + '\n\nJSON: {"items":[{"i":0,"tipo":"pin","grupo":"Pecho"}]}' }] });
  const j = /\{[\s\S]*\}/.exec((r.content || []).map(b => b.text || '').join('')); const out = {};
  if (j) (JSON.parse(j[0]).items || []).forEach(x => { const n = lista[Number(x.i)]; if (n) out[n] = { tipo: TIPOS.includes(x.tipo) ? x.tipo : 'otro', grupo: GRUPOS.includes(x.grupo) ? x.grupo : 'Otros' }; });
  nombres.forEach(n => { if (!out[n]) out[n] = { tipo: 'otro', grupo: 'Otros' }; });
  return out;
}

// ── 2) geometría (todo en cm del plano)
const nodoMap = (d) => Object.fromEntries((d.nodes || []).map(n => [n.id, n]));
function esquinas(e, N) {
  const n = N[e.n]; if (!n) return null; const cx = n.x + (e.dx || 0), cy = n.y + (e.dy || 0), a = ((e.rot || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), hw = (e.w || 60) / 2, hd = (e.d || 60) / 2;
  return { cx, cy, w: e.w || 60, d: e.d || 60, rot: e.rot || 0, pts: [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]) };
}
function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (p.length < 3) return p;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
  p.forEach(q => { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); });
  [...p].reverse().forEach(q => { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); });
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
const bbox = (g) => { const xs = g.pts.map(p => p[0]), ys = g.pts.map(p => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
const dBox = (a, b) => Math.hypot(Math.max(0, Math.max(a[0], b[0]) - Math.min(a[2], b[2])), Math.max(0, Math.max(a[1], b[1]) - Math.min(a[3], b[3])));
const mezcla = (hex, con, k) => { const h = (x) => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16)); const a = h(hex), b = h(con); return '#' + a.map((v, i) => Math.round(v * (1 - k) + b[i] * k).toString(16).padStart(2, '0')).join(''); };

export function construye(data, clasif, opciones = {}) {
  const personalizados = data.zonasLamina?.tipos || [];
  const tipos = [...TIPOS, ...personalizados.map(t => t.id)];
  const colores = { ...COLOR, ...Object.fromEntries(personalizados.map(t => [t.id, t.color])) };
  const nombres = { ...NOMBRE, ...Object.fromEntries(personalizados.map(t => [t.id, t.nombre])) };
  const N = nodoMap(data), BG = '#f6f3ee', vivo = (o) => o && o.s !== 'dem';
  const maq = (data.eq || []).filter(vivo).map(e => { const g = esquinas(e, N); if (!g) return null; const c = clasif[clave(e)] || { tipo: 'otro', grupo: 'Otros' }; return { e, g, tipo: c.tipo, grupo: c.grupo, nombre: txt(e.nm, 80) || 'Máquina' }; }).filter(Boolean);
  // zonas: por tipo, juntando las máquinas que están a menos de ~2 m unas de otras
  const zonas = [], UMBRAL = opciones.umbral || 200;
  tipos.filter(t => t !== 'otro').forEach(t => {
    const l = maq.filter(m => m.tipo === t), caja = l.map(m => bbox(m.g)), padre = l.map((_, i) => i), raiz = (i) => (padre[i] === i ? i : (padre[i] = raiz(padre[i])));
    for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) if (dBox(caja[i], caja[j]) <= UMBRAL) padre[raiz(i)] = raiz(j);
    const gr = {}; l.forEach((m, i) => { (gr[raiz(i)] = gr[raiz(i)] || []).push(m); });
    Object.values(gr).forEach(ms => { const pts = ms.flatMap(m => m.g.pts), xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); zonas.push({ tipo: t, ms, hull: hull(pts), cx: (Math.min(...xs) + Math.max(...xs)) / 2, ytop: Math.min(...ys), cy: (Math.min(...ys) + Math.max(...ys)) / 2 }); });
  });
  // encuadre: muros, máquinas y pilares
  const px = [], py = []; (data.nodes || []).forEach(n => { px.push(n.x); py.push(n.y); }); maq.forEach(m => m.g.pts.forEach(p => { px.push(p[0]); py.push(p[1]); }));
  if (!px.length) throw new Error('El plano no tiene muros ni máquinas');
  const x0 = Math.min(...px) - 60, y0 = Math.min(...py) - 60, x1 = Math.max(...px) + 60, y1 = Math.max(...py) + 60;
  const prim = [];
  // manchas de zona (color suave sin transparencias, para que se vea igual en pantalla y en PDF)
  zonas.forEach(z => prim.push({ k: 'poly', pts: z.hull, fill: mezcla(colores[z.tipo], BG, 0.8), stroke: mezcla(colores[z.tipo], BG, 0.8), sw: 70 }));
  // muros, huecos y pilares
  const W = Object.fromEntries((data.walls || []).map(w => [w.id, w]));
  (data.walls || []).filter(vivo).forEach(w => { const a = N[w.a], b = N[w.b]; if (a && b) prim.push({ k: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, sw: Math.max(8, Math.min(40, w.t || 15)), col: '#3a3530', cap: 'square' }); });
  (data.ops || []).filter(vivo).forEach(o => { const w = W[o.wall]; if (!w || !vivo(w)) return; const a = N[w.a], b = N[w.b]; if (!a || !b) return; const L = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / L, uy = (b.y - a.y) / L, p = Math.max(0, Math.min(L - o.w, o.p || 0)), t = Math.max(8, Math.min(40, w.t || 15));
    const xa = a.x + ux * p, ya = a.y + uy * p, xb = a.x + ux * (p + o.w), yb = a.y + uy * (p + o.w);
    prim.push({ k: 'line', x1: xa, y1: ya, x2: xb, y2: yb, sw: t + 2, col: BG, cap: 'butt' });
    prim.push(o.t === 'door' ? { k: 'line', x1: xa, y1: ya, x2: xb, y2: yb, sw: 3, col: '#b9b2a8', cap: 'butt' } : { k: 'line', x1: xa, y1: ya, x2: xb, y2: yb, sw: 6, col: '#a9c4d3', cap: 'butt' }); });
  // máquinas: el tono varía un poco por grupo muscular dentro de cada tipo
  const tonos = {}; maq.forEach(m => { const k = m.tipo; tonos[k] = tonos[k] || []; if (!tonos[k].includes(m.grupo)) tonos[k].push(m.grupo); });
  maq.forEach(m => { const gs = tonos[m.tipo], i = gs.indexOf(m.grupo), k = gs.length > 1 ? (i / (gs.length - 1)) * 0.42 : 0, base = colores[m.tipo]; m.col = mezcla(base, '#ffffff', k);
    prim.push({ k: 'rrect', cx: m.g.cx, cy: m.g.cy, w: m.g.w, h: m.g.d, rot: m.g.rot, r: 7, fill: m.col, stroke: '#ffffff', sw: 2 }); });
  (data.pil || []).filter(vivo).forEach(p => { const n = N[p.n]; if (n) prim.push({ k: 'rrect', cx: n.x + (p.dx || 0), cy: n.y + (p.dy || 0), w: p.w || 40, h: p.d || 40, rot: 0, r: 2, fill: '#3a3530', stroke: '#3a3530', sw: 1 }); });
  // rótulos: nombre de la zona y, si hay varios grupos, el grupo muscular
  zonas.forEach(z => { prim.push({ k: 'etiqueta', x: z.cx, y: z.ytop - 52, txt: nombres[z.tipo], size: 11, col: '#ffffff', bg: colores[z.tipo] }); const g = {}; z.ms.forEach(m => { (g[m.grupo] = g[m.grupo] || []).push(m); });
    if (Object.keys(g).length > 1) Object.entries(g).forEach(([nom, ms]) => { const cx = ms.reduce((s, m) => s + m.g.cx, 0) / ms.length, cy = ms.reduce((s, m) => s + m.g.cy, 0) / ms.length; prim.push({ k: 'etiqueta', x: cx, y: cy, txt: nom, size: 8, col: '#3a3530', bg: '#ffffffd9' }); }); });
  // leyenda: tipo → grupo → máquinas
  const leyenda = tipos.filter(t => maq.some(m => m.tipo === t)).map(t => { const l = maq.filter(m => m.tipo === t), g = {}; l.forEach(m => { const x = (g[m.grupo] = g[m.grupo] || {}); x[m.nombre] = (x[m.nombre] || 0) + 1; }); return { tipo: t, nombre: nombres[t], color: colores[t], total: l.length, grupos: Object.entries(g).map(([nom, mp]) => ({ nombre: nom, n: Object.values(mp).reduce((a, b) => a + b, 0), maquinas: Object.entries(mp).map(([n, c]) => n + (c > 1 ? ' ×' + c : '')) })) }; });
  return { prim, caja: [x0, y0, x1, y1], bg: BG, leyenda, total: maq.length, zonas: zonas.length };
}

// ── 3) renderizado
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const estW = (t, size) => t.length * size * 0.56 + 12;
export function laminaSvg(g, titulo, subtitulo) {
  const [x0, y0, x1, y1] = g.caja, anchoP = x1 - x0, altoP = y1 - y0, S = Math.min(640 / anchoP, 500 / altoP), px = (v) => ((v - x0) * S).toFixed(1), py = (v) => ((v - y0) * S).toFixed(1);
  const w = anchoP * S, h = altoP * S; let s = '';
  g.prim.forEach(p => {
    if (p.k === 'poly') s += `<polygon points="${p.pts.map(q => px(q[0]) + ',' + py(q[1])).join(' ')}" fill="${p.fill}" stroke="${p.stroke}" stroke-width="${(p.sw * S).toFixed(1)}" stroke-linejoin="round"/>`;
    else if (p.k === 'line') s += `<line x1="${px(p.x1)}" y1="${py(p.y1)}" x2="${px(p.x2)}" y2="${py(p.y2)}" stroke="${p.col}" stroke-width="${(p.sw * S).toFixed(1)}" stroke-linecap="${p.cap}"/>`;
    else if (p.k === 'rrect') s += `<rect x="${(-p.w * S / 2).toFixed(1)}" y="${(-p.h * S / 2).toFixed(1)}" width="${(p.w * S).toFixed(1)}" height="${(p.h * S).toFixed(1)}" rx="${(p.r * S).toFixed(1)}" fill="${p.fill}" stroke="${p.stroke}" stroke-width="${(p.sw * S).toFixed(1)}" transform="translate(${px(p.cx)} ${py(p.cy)}) rotate(${p.rot})"/>`;
    else if (p.k === 'etiqueta') { const tw = estW(p.txt, p.size); s += `<rect x="${(px(p.x) - tw / 2).toFixed(1)}" y="${(py(p.y) - p.size * 0.95).toFixed(1)}" width="${tw.toFixed(1)}" height="${(p.size * 1.7).toFixed(1)}" rx="${(p.size * 0.85).toFixed(1)}" fill="${p.bg}"/><text x="${px(p.x)}" y="${(Number(py(p.y)) + p.size * 0.3).toFixed(1)}" text-anchor="middle" font-size="${p.size}" font-weight="600" fill="${p.col}">${esc(p.txt)}</text>`; }
  });
  const ancho = Math.round(w + 300), alto = Math.round(h + 110);
  let ly = 70; let leg = '';
  g.leyenda.forEach(z => { leg += `<rect x="${Math.round(w) + 36}" y="${ly - 11}" width="14" height="14" rx="3" fill="${z.color}"/><text x="${Math.round(w) + 58}" y="${ly}" font-size="13" font-weight="600" fill="#1e1b18">${esc(z.nombre)} · ${z.total}</text>`; ly += 18; z.grupos.forEach(q => { leg += `<text x="${Math.round(w) + 58}" y="${ly}" font-size="11" fill="#6b6560">${esc(q.nombre)} (${q.n})</text>`; ly += 15; }); ly += 8; });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.max(ancho, 700)} ${Math.max(alto, ly + 20)}" width="100%" font-family="Helvetica, Arial, sans-serif"><rect width="100%" height="100%" fill="${g.bg}"/><text x="30" y="34" font-size="20" fill="#1e1b18">${esc(titulo)}</text>${subtitulo ? `<text x="30" y="54" font-size="12" fill="#6b6560">${esc(subtitulo)}</text>` : ''}<g transform="translate(30 70)">${s}</g><g>${leg}</g></svg>`;
}

// Dibuja la lámina en un documento pdfkit (A4 apaisado) ya creado: cabecera de marca, plano a la izquierda y leyenda a la derecha.
export function laminaPdf(doc, g, titulo, subtitulo, logoPath) {
  const W = 842, H = 595, OSC = '#1e1b18';
  doc.rect(0, 0, W, H).fill(g.bg); doc.rect(0, 0, W, 56).fill(OSC);
  try { if (logoPath) doc.image(logoPath, 30, 10, { height: 36 }); } catch { /* sin logo */ }
  doc.fillColor('#9a948d').font('Helvetica').fontSize(8).text('DISTRIBUCIÓN POR ZONAS', 0, 24, { align: 'right', width: W - 30, lineBreak: false });
  doc.fillColor(OSC).font('Helvetica').fontSize(20).text(titulo, 30, 74, { width: 560, lineBreak: false }); if (subtitulo) doc.fillColor('#6b6560').fontSize(10).text(subtitulo, 30, 100, { width: 560, lineBreak: false });
  const [x0, y0, x1, y1] = g.caja, areaX = 30, areaY = 124, areaW = 540, areaH = H - areaY - 40, S = Math.min(areaW / (x1 - x0), areaH / (y1 - y0)), ox = areaX + (areaW - (x1 - x0) * S) / 2, oy = areaY + (areaH - (y1 - y0) * S) / 2;
  const X = (v) => ox + (v - x0) * S, Y = (v) => oy + (v - y0) * S;
  g.prim.forEach(p => {
    if (p.k === 'poly') { doc.save().lineJoin('round').lineWidth(p.sw * S).fillColor(p.fill).strokeColor(p.stroke); doc.moveTo(X(p.pts[0][0]), Y(p.pts[0][1])); p.pts.slice(1).forEach(q => doc.lineTo(X(q[0]), Y(q[1]))); doc.closePath().fillAndStroke(p.fill, p.stroke); doc.restore(); }
    else if (p.k === 'line') { doc.save().lineWidth(p.sw * S).lineCap(p.cap === 'square' ? 'square' : 'butt').strokeColor(p.col).moveTo(X(p.x1), Y(p.y1)).lineTo(X(p.x2), Y(p.y2)).stroke().restore(); }
    else if (p.k === 'rrect') { doc.save().translate(X(p.cx), Y(p.cy)).rotate(p.rot).lineWidth(p.sw * S).roundedRect(-p.w * S / 2, -p.h * S / 2, p.w * S, p.h * S, p.r * S).fillAndStroke(p.fill, p.stroke).restore(); }
  });
  g.prim.filter(p => p.k === 'etiqueta').forEach(p => { const tw = estW(p.txt, p.size * 0.8), hx = p.bg.length > 7 ? p.bg.slice(0, 7) : p.bg, op = p.bg.length > 7 ? 0.85 : 1; doc.save().fillOpacity(op).fillColor(hx).roundedRect(X(p.x) - tw / 2, Y(p.y) - p.size * 0.7, tw, p.size * 1.45, p.size * 0.7).fill().restore(); doc.fillColor(p.col).font('Helvetica-Bold').fontSize(p.size * 0.8).text(p.txt, X(p.x) - tw / 2, Y(p.y) - p.size * 0.38, { width: tw, align: 'center', lineBreak: false }); });
  let ly = 130; const lx = 600, lw = W - lx - 30;
  g.leyenda.forEach(z => {
    if (ly > H - 70) return; doc.roundedRect(lx, ly, 11, 11, 2.5).fill(z.color); doc.fillColor(OSC).font('Helvetica-Bold').fontSize(10.5).text(z.nombre + ' · ' + z.total, lx + 18, ly, { width: lw - 18, lineBreak: false }); ly += 17;
    z.grupos.forEach(q => { if (ly > H - 50) return; doc.fillColor('#3a3530').font('Helvetica-Bold').fontSize(8).text(q.nombre + ' (' + q.n + ')', lx + 18, ly, { width: lw - 18, continued: false, lineBreak: false }); ly += 11; if (g.total <= 40) { const t = q.maquinas.join(', '); doc.fillColor('#8a847c').font('Helvetica').fontSize(7).text(t, lx + 18, ly, { width: lw - 18 }); ly = doc.y + 3; } });
    ly += 8;
  });
  doc.fillColor('#9a948d').font('Helvetica').fontSize(7).text('Ranuse Design · esquema orientativo de la distribución por zonas', 30, H - 24, { width: W - 60, align: 'center', lineBreak: false });
}
