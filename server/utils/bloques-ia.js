import sharp from 'sharp';
import { callClaude } from './anthropic.js';

// Bloques de producto generados por IA a partir de una foto, al estilo de Rayon:
// la IA NO dibuja las vistas a mano (salen incoherentes), sino que describe el
// producto como un ensamblaje 3D de piezas sencillas (cajas, cilindros, esferas)
// a escala real. Las tres vistas (planta, alzado, lateral) se calculan después por
// proyección ortogonal, así que coinciden entre sí por construcción.
//
// Ejes (cm, origen en la esquina trasera-izquierda del suelo):
//   x = ancho (izquierda → derecha, visto de frente)       0..LARGO
//   y = fondo (atrás → delante, donde se pone el usuario)  0..FONDO
//   z = altura desde el suelo                              0..ALTO

const SISTEMA = `Eres un delineante técnico de un estudio de gimnasios. Te enseñan la FOTO de un producto (máquina, rack, banco, cinta…) y sus medidas reales. Tienes que describirlo como un ENSAMBLAJE 3D de piezas sencillas a escala real, de forma que al proyectarlo desde arriba, de frente y de lado salgan sus planos (bloques CAD) fieles al producto.

Ejes (en cm): x = ancho (izquierda→derecha visto de frente), y = fondo (atrás→delante; delante es donde se coloca el usuario), z = altura desde el suelo. El producto ocupa x∈[0,LARGO], y∈[0,FONDO], z∈[0,ALTO]. Si lo ves en perspectiva, deduce la posición de cada pieza razonando sobre la geometría real (simetrías, alineaciones, perfiles de tubo estándar).

Responde SOLO con un JSON, sin texto alrededor:
{"partes":[ {...}, ... ], "nota":"qué has supuesto"}
Cada parte:
- "nombre": texto corto (ej. "montante frontal izq.", "banco", "columna de pesas").
- "tipo": "caja" | "cilindro" | "esfera".
- "centro": [x,y,z] del centro de la pieza.
- caja: "tam":[tx,ty,tz] (medidas a lo largo de x, y, z antes de rotar).
- cilindro: "d": diámetro, "l": longitud, "eje": "x" | "y" | "z" (a lo largo de qué eje va antes de rotar).
- esfera: "d": diámetro.
- opcional "rot":[rx,ry,rz] en grados, rotación alrededor de los ejes x, y, z que pasan por el centro (para piezas inclinadas: respaldos reclinados, palancas, brazos de prensa…). Comprueba el sentido de giro: una rotación positiva alrededor de x lleva +y hacia +z.
- "solido": true para estructura de tubo, perfiles, barras y piezas metálicas (se dibujan rellenas en negro); false para tapizados, paneles grandes y pesas (se dibujan solo con contorno).
Reglas:
- Descompón en las piezas que MÁS se notan en planta y en alzado/lateral: patas, montantes, travesaños, bases, columnas de pesas, asientos y respaldos, barras, rodillos, poleas (cilindros), pantallas. Entre 12 y 45 piezas. Simplifica los tornillos y agujeros: no los dibujes.
- Usa las medidas reales: las piezas deben llegar a los límites del recuadro (el producto toca x=0 y x=LARGO, y=0 y y=FONDO, z=0 y z=ALTO por alguna parte).
- Los tubos de estructura suelen medir 5-8 cm de sección; las barras olímpicas 5 cm de diámetro y 220 cm de largo (los extremos sobresalen).
- Piezas simétricas: crea las dos (izquierda y derecha).`;

function jsonDe(texto) {
  const m = String(texto).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('La IA no devolvió un ensamblaje válido. Inténtalo de nuevo.');
  try { return JSON.parse(m[0]); } catch { throw new Error('La IA devolvió el ensamblaje en un formato roto. Inténtalo de nuevo.'); }
}

// ── Geometría ──────────────────────────────────────────────────────────────
function rotar(p, rot) {
  let [x, y, z] = p;
  const [rx, ry, rz] = (Array.isArray(rot) ? rot : [0, 0, 0]).map(v => (Number(v) || 0) * Math.PI / 180);
  let c = Math.cos(rx), s = Math.sin(rx); [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(ry); s = Math.sin(ry); [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(rz); s = Math.sin(rz); [x, y] = [x * c - y * s, x * s + y * c];
  return [x, y, z];
}
function puntosDe(p) {
  const [cx, cy, cz] = p.centro.map(Number);
  const out = [];
  if (p.tipo === 'caja') {
    const [a, b, c] = p.tam.map(v => Math.max(0.5, Number(v)));
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) out.push([sx * a / 2, sy * b / 2, sz * c / 2]);
  } else if (p.tipo === 'cilindro') {
    const r = Math.max(0.5, Number(p.d)) / 2, l = Math.max(0.5, Number(p.l));
    for (let k = 0; k < 20; k++) {
      const t = k / 20 * Math.PI * 2, u = Math.cos(t) * r, v = Math.sin(t) * r;
      for (const e of [-l / 2, l / 2]) out.push(p.eje === 'x' ? [e, u, v] : p.eje === 'y' ? [u, e, v] : [u, v, e]);
    }
  } else { // esfera
    const r = Math.max(0.5, Number(p.d)) / 2;
    for (let k = 0; k < 24; k++) { const t = k / 24 * Math.PI * 2; out.push([Math.cos(t) * r, Math.sin(t) * r, 0], [Math.cos(t) * r, 0, Math.sin(t) * r], [0, Math.cos(t) * r, Math.sin(t) * r]); }
  }
  return out.map(q => { const r = rotar(q, p.rot); return [cx + r[0], cy + r[1], cz + r[2]]; });
}
function casco(pts) { // envolvente convexa 2D (cadena monótona)
  const P = [...new Map(pts.map(q => [q.join(','), q])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (P.length < 3) return P;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of [...P].reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
const r2 = n => Math.round(n * 100) / 100;

// Proyecta las piezas a las tres vistas. Coordenadas de cada vista = las del editor de bloques
// (planta: x, y con y=0 atrás; alzado: x y la altura invertida; lateral: y y la altura invertida,
// con el frente a la derecha).
export function proyectar(partes, { largo, fondo, alto }) {
  const vistas = { planta: [], alzado: [], lateral: [] };
  const lista = (partes || [])
    .filter(p => p && Array.isArray(p.centro) && p.centro.length === 3 && ['caja', 'cilindro', 'esfera'].includes(p.tipo))
    .filter(p => (p.tipo === 'caja' ? Array.isArray(p.tam) && p.tam.length === 3 : Number(p.d) > 0));
  for (const p of lista) {
    const P = puntosDe(p);
    const solido = p.solido === true;
    const prof = { planta: Math.max(...P.map(q => q[2])), alzado: Math.min(...P.map(q => q[1])), lateral: Math.min(...P.map(q => q[0])) };
    vistas.planta.push({ pts: casco(P.map(q => [q[0], q[1]])), solido, prof: prof.planta });
    vistas.alzado.push({ pts: casco(P.map(q => [q[0], alto - q[2]])), solido, prof: prof.alzado });
    vistas.lateral.push({ pts: casco(P.map(q => [q[1], alto - q[2]])), solido, prof: prof.lateral });
  }
  const dims = { planta: [largo, fondo], alzado: [largo, alto], lateral: [fondo, alto] };
  const salida = { svg: {}, shapes: {} };
  let id = 1;
  for (const v of ['planta', 'alzado', 'lateral']) {
    const [W, H] = dims[v];
    const polys = vistas[v].filter(q => q.pts.length >= 3).sort((a, b) => a.prof - b.prof);
    const shapes = polys.map(q => ({
      id: id++, t: 'poly', closed: true, f: q.solido, sw: q.solido ? 0.6 : 1.0,
      pts: q.pts.map(([x, y]) => [r2(Math.min(Math.max(x, -1), W + 1)), r2(Math.min(Math.max(y, -1), H + 1))]),
    }));
    salida.svg[v] = shapes.map(s => {
      const a = ` stroke="#000000" stroke-width="${s.sw}" fill="${s.f ? '#000000' : 'none'}" stroke-linecap="round"`;
      return `<polygon points="${s.pts.map(p => p[0] + ',' + p[1]).join(' ')}"${a}/>`;
    }).join('');
    if (v !== 'planta') { // línea de suelo
      const suelo = { id: id++, t: 'line', x1: -4, y1: H, x2: W + 4, y2: H, sw: 2.4 };
      shapes.push(suelo);
      salida.svg[v] += `<line x1="${suelo.x1}" y1="${suelo.y1}" x2="${suelo.x2}" y2="${suelo.y2}" stroke="#000000" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
    }
    salida.shapes[v] = shapes;
  }
  return salida;
}

// Vista previa (PNG) de las tres vistas, para que la IA se compare y para pruebas
export function svgVista(frag, w, h, color = '#1e1b18') {
  const pintado = frag.replace(/#000000|#000\b/g, color);
  const pad = Math.max(w, h) * 0.04;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${w + 2 * pad} ${h + 2 * pad}" width="${Math.round((w + 2 * pad) * 3)}" height="${Math.round((h + 2 * pad) * 3)}"><rect x="${-pad}" y="${-pad}" width="${w + 2 * pad}" height="${h + 2 * pad}" fill="#ffffff"/>${pintado}</svg>`;
}
export async function montaje(b) {
  const H = 480;
  const vistas = [[b.svg.planta, b.largo, b.fondo], [b.svg.alzado, b.largo, b.alto], [b.svg.lateral, b.fondo, b.alto]];
  const piezas = [];
  for (const [frag, w, h] of vistas) piezas.push(await sharp(Buffer.from(svgVista(frag, w, h))).resize({ height: H, width: 480, fit: 'contain', background: '#ffffff' }).png().toBuffer());
  return sharp({ create: { width: 480 * piezas.length, height: H, channels: 3, background: '#ffffff' } })
    .composite(piezas.map((input, i) => ({ input, left: i * 480, top: 0 }))).png().toBuffer();
}

// ── Generación ─────────────────────────────────────────────────────────────
export async function generarBloques({ imagen, largo, fondo, alto, nombre, refinar = true }) {
  const jpg = await sharp(imagen).rotate().resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 88 }).toBuffer();
  const L = Math.round(largo), D = Math.round(fondo), H = Math.round(alto || 150);
  const imgFoto = { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpg.toString('base64') } };
  const texto = `Producto: ${nombre || 'sin nombre'}.\nMedidas reales: LARGO (x) = ${L} cm, FONDO (y) = ${D} cm, ALTO (z) = ${H} cm.\nDescribe el ensamblaje 3D de piezas.`;
  const textoDe = (r) => (r.content || []).filter(x => x.type === 'text').map(x => x.text).join('');

  const r1 = await callClaude({ system: SISTEMA, maxTokens: 8000, messages: [{ role: 'user', content: [imgFoto, { type: 'text', text: texto }] }] });
  const j = jsonDe(textoDe(r1));
  let b = { ...proyectar(j.partes, { largo: L, fondo: D, alto: H }), largo: L, fondo: D, alto: H, nota: String(j.nota || '').slice(0, 300), partes: j.partes };
  if (!b.shapes.planta.length) throw new Error('La IA no devolvió piezas válidas. Inténtalo de nuevo.');

  if (refinar) { // la IA ve sus tres vistas junto a la foto y corrige el ensamblaje
    try {
      const dibujo = await montaje(b);
      const r2_ = await callClaude({
        system: SISTEMA, maxTokens: 8000,
        messages: [
          { role: 'user', content: [imgFoto, { type: 'text', text: texto }] },
          { role: 'assistant', content: JSON.stringify({ partes: j.partes, nota: j.nota }) },
          { role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: dibujo.toString('base64') } },
            { type: 'text', text: 'Estas son las tres vistas que salen de tu ensamblaje, de izquierda a derecha: PLANTA (vista desde arriba, delante abajo), ALZADO (de frente) y LATERAL (de lado, delante a la derecha). Compáralas con la foto y CORRIGE el ensamblaje: piezas mal colocadas, inclinaciones al revés, piezas que faltan o sobran, proporciones que no cuadran con las medidas, asimetrías erróneas. Devuelve el JSON completo con el mismo formato.' },
          ] },
        ],
      });
      const j2 = jsonDe(textoDe(r2_));
      const b2 = { ...proyectar(j2.partes, { largo: L, fondo: D, alto: H }), largo: L, fondo: D, alto: H, nota: String(j2.nota || b.nota).slice(0, 300), partes: j2.partes };
      if (b2.shapes.planta.length) b = b2;
    } catch (e) { console.error('bloques refinado:', e.message); }
  }
  return b;
}
