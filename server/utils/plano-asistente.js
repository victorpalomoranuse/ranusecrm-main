// mupdf se carga aquí y no al arrancar el servidor: si no estuviera disponible, solo fallan los planos desde PDF, no el resto
let mupdf = null;
try { mupdf = await import('mupdf'); } catch (e) { console.error('mupdf no disponible (no se podrán leer PDFs de planos):', e.message); }
const necesitaMupdf = () => { if (!mupdf) throw new Error('El lector de PDF no está disponible en el servidor'); };

// Del PDF o imagen de un plano del cliente a un plano nuevo de la herramienta Planos (estado actual: muros, puertas, ventanas y pilares).
// La lectura con IA es la misma de la herramienta (POST /api/medicion/plano-ia); aquí se prepara la imagen y se monta el plano
// con la misma lógica que el editor (planoIAConstruir / piaEscala de public/medicion/index.html, copiadas tal cual).
const LADO_MAX = 1568; // igual que el editor

export function infoPdf(buffer) {
  necesitaMupdf();
  const doc = mupdf.Document.openDocument(buffer, 'application/pdf'), n = doc.countPages(), paginas = [];
  for (let i = 0; i < n; i++) {
    let txt = ''; try { txt = doc.loadPage(i).toStructuredText('preserve-whitespace').asText().replace(/\s+/g, ' ').trim(); } catch { /* sin texto */ }
    paginas.push({ n: i + 1, texto: txt.slice(0, 110) });
  }
  return { paginas: n, lista: paginas };
}

// página (1..n) → imagen JPEG como data URL, con el mismo tamaño máximo que usa el editor
export function paginaAImagen(buffer, pagina) {
  necesitaMupdf();
  const doc = mupdf.Document.openDocument(buffer, 'application/pdf'), n = doc.countPages();
  if (!(pagina >= 1 && pagina <= n)) throw new Error('El PDF tiene ' + n + ' páginas; la ' + pagina + ' no existe.');
  const p = doc.loadPage(pagina - 1), [x0, y0, x1, y1] = p.getBounds(), esc = LADO_MAX / Math.max(x1 - x0, y1 - y0);
  const pix = p.toPixmap(mupdf.Matrix.scale(esc, esc), mupdf.ColorSpace.DeviceRGB, false, true);
  return { data: 'data:image/jpeg;base64,' + Buffer.from(pix.asJPEG(88, false)).toString('base64'), w: pix.getWidth(), h: pix.getHeight() };
}

// ── copia del editor: escala (cm por píxel) a partir de las cotas que la IA midió sobre la imagen ──
export function escalaDe(p) {
  const r = [];
  (p.escala || []).forEach(e => { const d = Math.hypot(e.x2 - e.x1, e.y2 - e.y1); if (d > 30 && e.cm > 20) r.push(e.cm / d); });
  if (!r.length) return null;
  r.sort((a, b) => a - b);
  const med = r[r.length >> 1], bien = r.filter(x => Math.abs(x / med - 1) < 0.15);
  return { cm: bien[bien.length >> 1], n: bien.length, de: r.length };
}
function piaAgrupa(vals, tol) {
  const idx = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]), out = vals.slice();
  let i = 0;
  while (i < idx.length) {
    let j = i; const ini = vals[idx[i]];
    while (j + 1 < idx.length && vals[idx[j + 1]] - vals[idx[j]] <= tol && vals[idx[j + 1]] - ini <= tol * 2) j++;
    let sum = 0, q; for (q = i; q <= j; q++) sum += vals[idx[q]];
    const m = sum / (j - i + 1); for (q = i; q <= j; q++) out[idx[q]] = m;
    i = j + 1;
  }
  return out;
}
// ── copia del editor: del resultado de la IA (píxeles) a muros, puertas, ventanas y pilares (cm) ──
export function construirPlano(p, cm) {
  let seq = 1; const uid = (pre) => pre + (seq++);
  const W = p.w, H = p.h, tol = Math.max(3, Math.min(7, 0.004 * Math.max(W, H)));
  const segs = (p.muros || []).filter(m => Math.hypot(m.x2 - m.x1, m.y2 - m.y1) >= 2 * tol);
  let xs = [], ys = [];
  segs.forEach(m => { xs.push(m.x1, m.x2); ys.push(m.y1, m.y2); });
  xs = piaAgrupa(xs, tol); ys = piaAgrupa(ys, tol);
  const pts = [], seg = [], key = {};
  const pt = (x, y) => { const k = x.toFixed(1) + ',' + y.toFixed(1); if (key[k] == null) { key[k] = pts.length; pts.push({ x, y }); } return key[k]; };
  segs.forEach((m, i) => {
    const a = pt(xs[2 * i], ys[2 * i]), b = pt(xs[2 * i + 1], ys[2 * i + 1]);
    if (a !== b && !seg.some(q => (q.a === a && q.b === b) || (q.a === b && q.b === a))) seg.push({ a, b, e: m.espesor_px || 0 });
  });
  const dsp = (n, q) => { const A = pts[q.a], B = pts[q.b], dx = B.x - A.x, dy = B.y - A.y, L2 = dx * dx + dy * dy, t = ((n.x - A.x) * dx + (n.y - A.y) * dy) / L2; return { t, d: Math.hypot(n.x - (A.x + t * dx), n.y - (A.y + t * dy)), L: Math.sqrt(L2) }; };
  for (let it = 0, cambio = true; cambio && it < 2000; it++) {
    cambio = false;
    for (let ni = 0; ni < pts.length && !cambio; ni++) for (let si = 0; si < seg.length && !cambio; si++) {
      const q = seg[si]; if (q.a === ni || q.b === ni) continue;
      const r = dsp(pts[ni], q);
      if (r.t > 0 && r.t < 1 && r.d <= tol * 1.3 && r.t * r.L > tol * 1.5 && (1 - r.t) * r.L > tol * 1.5) { const b0 = q.b; q.b = ni; seg.push({ a: ni, b: b0, e: q.e }); cambio = true; }
    }
  }
  let minx = Infinity, miny = Infinity; pts.forEach(q => { minx = Math.min(minx, q.x); miny = Math.min(miny, q.y); });
  const X = (x) => Math.round((x - minx) * cm), Y = (y) => Math.round((y - miny) * cm);
  const nodes = pts.map(q => ({ id: uid('n'), x: X(q.x), y: Y(q.y) }));
  const ge = seg.map(q => q.e).filter(e => e > 0).sort((a, b) => a - b), emed = ge.length ? ge[ge.length >> 1] : 0;
  const walls = seg.map(q => { let e = Math.round((q.e || emed) * cm); if (!(e >= 6)) e = 15; e = Math.max(6, Math.min(60, e)); return { id: uid('w'), a: nodes[q.a].id, b: nodes[q.b].id, len: null, m: false, s: 'ex', t: e }; });
  const ops = [];
  const hueco = (h, door) => {
    const cx = X(h.x), cy = Y(h.y); let best = null;
    walls.forEach(w => {
      const A = nodes.filter(n => n.id === w.a)[0], B = nodes.filter(n => n.id === w.b)[0], dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy); if (L < 30) return;
      let t = ((cx - A.x) * dx + (cy - A.y) * dy) / (L * L); t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(cx - (A.x + t * dx), cy - (A.y + t * dy));
      if (!best || d < best.d) best = { w, d, s: t * L, L };
    });
    if (!best || best.d > Math.max(30, 16 * cm)) return;
    let ow = h.ancho_cm >= 50 && h.ancho_cm <= 400 ? h.ancho_cm : (h.ancho_px > 0 ? h.ancho_px * cm : (door ? 82 : 100));
    ow = Math.round(Math.max(40, Math.min(door ? 300 : 400, ow)));
    if (best.L < ow + 10) ow = Math.max(30, Math.round(best.L - 10));
    ops.push({ id: uid('o'), wall: best.w.id, t: door ? 'door' : 'win', p: Math.round(Math.max(0, Math.min(best.L - ow, best.s - ow / 2))), w: ow, h: door ? 210 : 120, sill: door ? 0 : 100, side: 1, flip: false, s: 'ex' });
  };
  (p.puertas || []).forEach(h => hueco(h, true));
  (p.ventanas || []).forEach(h => hueco(h, false));
  const pil = [];
  (p.pilares || []).forEach(c => {
    const cx = X(c.x), cy = Y(c.y); let nn = null;
    nodes.forEach(n => { const d = Math.hypot(n.x - cx, n.y - cy); if (!nn || d < nn.d) nn = { n, d }; });
    if (!nn) return;
    const w = Math.max(10, Math.min(150, Math.round((c.ancho_px || 0) * cm) || 30)), d = Math.max(10, Math.min(150, Math.round((c.fondo_px || 0) * cm) || w));
    pil.push({ id: uid('p'), n: nn.n.id, dx: cx - nn.n.x, dy: cy - nn.n.y, w, d, s: 'ex' });
  });
  return { nodes, walls, ops, pil, seq, extension_cm: { ancho: Math.round(Math.max(...nodes.map(n => n.x), 0)), alto: Math.round(Math.max(...nodes.map(n => n.y), 0)) } };
}

// registro de plano con los valores por defecto del editor (los mismos campos que los planos ya existentes)
export function registroPlano({ id, B, nombre, cliente, direccion = '', altura = 300, planta = 'Planta baja' }) {
  return {
    id, nombre, cliente, direccion, planta, fecha: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), notas: '', altura, paso: 80, seq: B.seq + 1, cb: 'int', cbv: 2,
    nodes: B.nodes, walls: B.walls, ops: B.ops, pil: B.pil,
    cn: [], dr: [], eq: [], fz: [], lm: [], mm: [], rc: [], rz: [], sp: [], tx: [], zn: [], cal: [], ctl: [], eqa: [], pts: [],
    det: { off: {}, over: {}, extra: [] }, updated: Date.now(),
  };
}
