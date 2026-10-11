import fs from 'fs';
import os from 'os';
import path from 'path';
import { Client, handle_file } from '@gradio/client';
import sharp from 'sharp';

// Bloques de producto a partir de una foto, con un modelo de imagen→3D (Hunyuan3D, Space
// gratuito de Hugging Face; con HF_TOKEN en las variables se tiene más cuota). La malla
// 3D se proyecta en ortogonal (planta, alzado y lateral), así que las tres vistas son
// geométricamente coherentes, y cada silueta se vectoriza con sus huecos.
// Ejes de la malla (glTF): Y = arriba; los otros dos son largo y fondo (se asignan por proporción).

const SPACE = 'tencent/Hunyuan3D-2.1';

export async function mallaDesdeFoto(jpg) {
  const tmp = path.join(os.tmpdir(), `bq-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
  fs.writeFileSync(tmp, jpg);
  try {
    const client = await Client.connect(SPACE, process.env.HF_TOKEN ? { token: process.env.HF_TOKEN } : {});
    const r = await client.predict('/shape_generation', { image: handle_file(tmp), steps: 30, guidance_scale: 5, seed: 1234, octree_resolution: 256, check_box_rembg: true, num_chunks: 8000, randomize_seed: false });
    const f = r.data?.[0];
    const url = f?.value?.url || f?.url;
    if (!url) throw new Error('El servicio 3D no devolvió la malla');
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('No se pudo descargar la malla 3D');
    return Buffer.from(await resp.arrayBuffer());
  } finally { fs.rmSync(tmp, { force: true }); }
}

function leerGlb(buf) {
  const jl = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20 + jl).toString());
  const bin = buf.slice(20 + jl + 8);
  const acc = (i) => {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView], off = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const nC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type], n = a.count * nC;
    const T = { 5126: [Float32Array, 4], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5121: [Uint8Array, 1] }[a.componentType];
    return { d: new T[0](bin.buffer.slice(bin.byteOffset + off, bin.byteOffset + off + n * T[1])), count: a.count };
  };
  const P = [], I = [];
  let base = 0;
  json.meshes.forEach(m => m.primitives.forEach(p => {
    const pos = acc(p.attributes.POSITION);
    for (let i = 0; i < pos.count; i++) P.push(pos.d[i * 3], pos.d[i * 3 + 1], pos.d[i * 3 + 2]);
    if (p.indices != null) { const ix = acc(p.indices); for (let i = 0; i < ix.count; i++) I.push(ix.d[i] + base); }
    else for (let i = 0; i < pos.count; i++) I.push(i + base);
    base += pos.count;
  }));
  return { P: Float32Array.from(P), I: Uint32Array.from(I) };
}

// Rasteriza la malla en tres máscaras (una pasada). Cada vista: [eje horizontal, eje vertical]
function rasterizar(P, I, vistas, ext, mn, S) {
  const mas = vistas.map(([ua, va]) => {
    const w = ext[ua], h = ext[va], sc = S / Math.max(w, h);
    return { ua, va, sc, W: Math.max(4, Math.round(w * sc)) + 4, H: Math.max(4, Math.round(h * sc)) + 4, m: null };
  });
  mas.forEach(v => { v.m = new Uint8Array(v.W * v.H); });
  const nT = I.length / 3;
  for (let t = 0; t < nT; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    for (const v of mas) {
      const ax = 2 + (P[a + v.ua] - mn[v.ua]) * v.sc, ay = 2 + (ext[v.va] - (P[a + v.va] - mn[v.va])) * v.sc;
      const bx = 2 + (P[b + v.ua] - mn[v.ua]) * v.sc, by = 2 + (ext[v.va] - (P[b + v.va] - mn[v.va])) * v.sc;
      const cx = 2 + (P[c + v.ua] - mn[v.ua]) * v.sc, cy = 2 + (ext[v.va] - (P[c + v.va] - mn[v.va])) * v.sc;
      const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(den) < 1e-9) continue;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(v.W - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(v.H - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / den, l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / den, l3 = 1 - l1 - l2;
        if (l1 >= -0.03 && l2 >= -0.03 && l3 >= -0.03) v.m[y * v.W + x] = 1;
      }
    }
  }
  return mas;
}

// Contornos de una máscara (marching squares): bucles cerrados; exteriores y huecos con orientación opuesta
function contornos(m, W, H) {
  const W2 = W * 2 + 8;
  const k2 = (x, y) => y * W2 + x;
  const mapa = new Map();
  const add = (p, q) => { const k = k2(p[0], p[1]); (mapa.get(k) || mapa.set(k, []).get(k)).push(q); };
  const val = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? m[y * W + x] : 0);
  for (let y = -1; y < H; y++) for (let x = -1; x < W; x++) {
    const tl = val(x, y), tr = val(x + 1, y), br = val(x + 1, y + 1), bl = val(x, y + 1);
    const c = tl * 8 + tr * 4 + br * 2 + bl;
    if (c === 0 || c === 15) continue;
    const T = [2 * x + 4, 2 * y + 3], R = [2 * x + 5, 2 * y + 4], B = [2 * x + 4, 2 * y + 5], L = [2 * x + 3, 2 * y + 4];
    const S = (p, q) => add(p, q);
    switch (c) {
      case 1: S(L, B); break; case 2: S(B, R); break; case 3: S(L, R); break; case 4: S(R, T); break;
      case 5: S(L, T); S(R, B); break; case 6: S(B, T); break; case 7: S(L, T); break;
      case 8: S(T, L); break; case 9: S(T, B); break; case 10: S(T, R); S(B, L); break;
      case 11: S(T, R); break; case 12: S(R, L); break; case 13: S(R, B); break; case 14: S(B, L); break;
      default: break;
    }
  }
  const bucles = [];
  while (mapa.size) {
    const [k0] = mapa.entries().next().value;
    let x = k0 % W2, y = Math.floor(k0 / W2);
    const pts = [[x, y]];
    let guard = 0;
    for (;;) {
      const kk = k2(x, y), l = mapa.get(kk);
      if (!l || !l.length) break;
      const [nx, ny] = l.shift();
      if (!l.length) mapa.delete(kk);
      x = nx; y = ny; pts.push([x, y]);
      if (++guard > 600000) break;
      if (x === pts[0][0] && y === pts[0][1]) break;
    }
    if (pts.length > 8) bucles.push(pts.map(([a, b]) => [(a - 3) / 2, (b - 3) / 2]));
  }
  return bucles;
}
const area = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; };
function segD(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy; if (!l2) return Math.hypot(p[0] - a[0], p[1] - a[1]); const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)); return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)); }
function rdp(P, eps) {
  if (P.length < 3) return P;
  let d = 0, idx = 0; const a = P[0], b = P[P.length - 1];
  for (let i = 1; i < P.length - 1; i++) { const dd = segD(P[i], a, b); if (dd > d) { d = dd; idx = i; } }
  if (d > eps) { const l = rdp(P.slice(0, idx + 1), eps), r = rdp(P.slice(idx), eps); return l.slice(0, -1).concat(r); }
  return [a, b];
}
function simplificarCerrado(p, eps) {
  let far = 0, fd = 0;
  for (let i = 1; i < p.length; i++) { const d = Math.hypot(p[i][0] - p[0][0], p[i][1] - p[0][1]); if (d > fd) { fd = d; far = i; } }
  const a = rdp(p.slice(0, far + 1), eps), b = rdp(p.slice(far).concat([p[0]]), eps);
  return a.slice(0, -1).concat(b.slice(0, -1));
}
const dentro = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if (((a[1] > pt[1]) !== (b[1] > pt[1])) && (pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0])) c = !c; } return c; };
const r2 = (n) => Math.round(n * 100) / 100;

// Máscara → formas (un polígono por silueta, con sus huecos), escaladas a cm
function vectorizar(v, anchoCm, altoCm, idRef) {
  const bucles = contornos(v.m, v.W, v.H);
  const sx = anchoCm / (v.W - 4), sy = altoCm / (v.H - 4), total = (v.W - 4) * (v.H - 4);
  const info = bucles.map(b => ({ b, a: area(b) })).filter(o => Math.abs(o.a) > total * 0.0004);
  const eps = Math.max(0.9, Math.max(v.W, v.H) * 0.0035);
  const aCm = (p) => p.map(([x, y]) => [r2(Math.min(Math.max(x * sx, 0), anchoCm)), r2(Math.min(Math.max(y * sy, 0), altoCm))]);
  // el signo del bucle más grande es el de los exteriores; los de signo contrario son huecos
  const signo = info.length ? Math.sign(info.reduce((m, o) => (Math.abs(o.a) > Math.abs(m.a) ? o : m)).a) : 1;
  const exteriores = info.filter(o => Math.sign(o.a) === signo).map(o => ({ ...o, simp: simplificarCerrado(o.b, eps), huecos: [] }));
  const huecos = info.filter(o => Math.sign(o.a) !== signo).map(o => ({ ...o, simp: simplificarCerrado(o.b, eps) }));
  huecos.forEach(h => {
    const padre = exteriores.filter(e => dentro(h.simp[0], e.simp)).sort((a, b) => Math.abs(a.a) - Math.abs(b.a))[0];
    if (padre) padre.huecos.push(h.simp);
  });
  return exteriores.filter(e => e.simp.length >= 3).map(e => ({
    id: idRef.n++, t: 'poly', closed: true, f: true, sw: 0.6,
    pts: aCm(e.simp), holes: e.huecos.filter(h => h.length >= 3).map(aCm),
  }));
}
export function fragDe(shapes) {
  return shapes.map(s => {
    const sub = [s.pts, ...(s.holes || [])].map(p => 'M ' + p.map(q => q[0] + ' ' + q[1]).join(' L ') + ' Z').join(' ');
    return `<path d="${sub}" stroke="#000000" stroke-width="0.6" fill="#000000" stroke-linejoin="round"/>`;
  }).join('');
}

// Proyecta una malla GLB a planta, alzado y lateral (también se usa en pruebas con una malla ya generada)
export function bloquesDeMalla(glb, { largo, fondo, alto }) {
  const { P, I } = leerGlb(glb);
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[i + k]); mx[k] = Math.max(mx[k], P[i + k]); }
  const ext = mx.map((v, k) => v - mn[k]);
  // Y = arriba. De x y z, el que mejor encaje con la proporción largo/fondo es el largo
  const costeA = Math.abs(Math.log((ext[0] / largo) / (ext[2] / fondo))), costeB = Math.abs(Math.log((ext[2] / largo) / (ext[0] / fondo)));
  const axL = costeA <= costeB ? 0 : 2, axF = axL === 0 ? 2 : 0;
  const mas = rasterizar(P, I, [[axL, axF], [axL, 1], [axF, 1]], ext, mn, 900);
  const idRef = { n: 1 };
  const dims = [[largo, fondo], [largo, alto], [fondo, alto]];
  const nombres = ['planta', 'alzado', 'lateral'];
  const salida = { shapes: {}, svg: {} };
  mas.forEach((v, i) => {
    const sh = vectorizar(v, dims[i][0], dims[i][1], idRef);
    if (!sh.length) throw new Error(`No se pudo vectorizar la vista ${nombres[i]}`);
    salida.svg[nombres[i]] = fragDe(sh);
    if (i > 0) {
      sh.push({ id: idRef.n++, t: 'line', x1: -4, y1: dims[i][1], x2: dims[i][0] + 4, y2: dims[i][1], sw: 2.4 });
      salida.svg[nombres[i]] += `<line x1="-4" y1="${dims[i][1]}" x2="${dims[i][0] + 4}" y2="${dims[i][1]}" stroke="#000000" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
    }
    salida.shapes[nombres[i]] = sh;
  });
  return { ...salida, largo, fondo, alto, nota: 'Generado desde un modelo 3D de la foto. Si el frente sale al revés, usa «Girar 180°».', metodo: 'malla3d' };
}

export async function generarBloques3D({ imagen, largo, fondo, alto }) {
  const jpg = await sharp(imagen).rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();
  const glb = await mallaDesdeFoto(jpg);
  return bloquesDeMalla(glb, { largo, fondo, alto });
}
