import sharp from 'sharp';
import { callClaude } from './anthropic.js';

// Bloques 2D «al estilo delineante»: la IA mira una o varias fotos del producto (de frente, de lado, en perspectiva…)
// y DIBUJA directamente cada vista con primitivas CAD (rectángulos con esquinas cortadas, círculos, líneas) en cm, por capas
// (estructura, detalles, tapizado, elementos superiores). Es lo que hace un delineante: no reconstruye un volumen, dibuja lo que
// se ve en cada vista con sus detalles (pies, barras, discos, poleas, brazos…), y por eso sale mucho más legible que una silueta.

const SISTEMA = `Eres un delineante técnico de un estudio de interiorismo de gimnasios. Te enseñan una o varias FOTOS de un producto (rack, máquina, banco, cinta…) y sus medidas reales. Dibuja el producto en 2D, vista por vista, con el detalle de un plano de fabricante.

Vistas y ejes (en cm, siempre con origen en la esquina superior izquierda de la vista y el eje y hacia abajo):
- "planta": vista desde arriba. x = ancho (0..LARGO), y = fondo (0 = parte de atrás, FONDO = parte de delante, por donde se coloca el usuario).
- "alzado": vista de frente. x = ancho (0..LARGO), y = altura desde ARRIBA (0 = punto más alto, ALTO = suelo).
- "lateral": vista desde la derecha. x = fondo (0 = atrás, FONDO = delante), y = altura desde arriba (0 = punto más alto, ALTO = suelo).

Cada vista es una lista de elementos. Tipos:
- {"t":"rect","x":n,"y":n,"w":n,"h":n,"c":n,"capa":"..."}  rectángulo de esquina (x,y) y tamaño (w,h). "c" = chaflán de las esquinas en cm (como se dibujan los tubos y pletinas, 1-4 cm típico).
- {"t":"circ","x":n,"y":n,"r":n,"capa":"..."}  círculo de centro (x,y) y radio r.
- {"t":"linea","pts":[[x,y],[x,y],...],"capa":"..."}  línea o polilínea abierta.
- {"t":"poli","pts":[[x,y],...],"capa":"..."}  polígono cerrado.
Capas: "estructura" (tubos, bases, columnas, marcos: trazo principal), "detalles" (agujeros, topes, pestañas, barras, discos, poleas, pasadores, brazos de apoyo), "tapizado" (asientos, respaldos, almohadillas, rodillos), "superior" (lo que queda por ENCIMA del plano de corte o visto a través, p. ej. travesaños altos: se dibuja discontinuo).

Reglas:
- DIBUJA SOLO EL PRODUCTO (nada de personas, suelo, paredes ni fondo). Si en la foto lo usa alguien, imagina el producto sin esa persona.
- Usa todas las fotos a la vez: la de frente da el ancho y los detalles del alzado; la lateral da el fondo y el lateral; la de perspectiva ayuda a colocar lo que sobresale. Cruza las vistas para que coincidan entre sí (un montante que está en x=30 en la planta debe estar en x=30 en el alzado).
- Respeta las medidas reales: cada vista debe tocar los 4 bordes de su recuadro (planta: 0..LARGO × 0..FONDO). Los elementos que sobresalen (extremos de la barra, brazos, discos) cuentan.
- Estructura: los tubos y montantes típicos de 5-8 cm de sección dibújalos como "rect" con chaflán de 1-2 cm; en planta un montante lleva debajo su pie o placa (rectángulo más ancho) y, si procede, 1-2 círculos de 1-2 cm (tornillos). Los pies/bases son rectángulos más anchos que el montante.
- Barras olímpicas: 220 cm de largo, 5 cm de diámetro; los discos y los topes se dibujan como rectángulos o círculos según la vista. Las poleas son círculos de 8-15 cm. Las columnas de pesas se dibujan como un rectángulo con líneas horizontales.
- Detalle útil, no ruido: entre 25 y 90 elementos por vista. Que se entienda cada pieza, simétrica donde el producto lo sea. Sin textos ni cotas.
- Primero los elementos grandes (estructura), luego los de detalle.

Responde SOLO con un JSON, sin nada alrededor:
{"planta":[...],"alzado":[...],"lateral":[...],"nota":"qué has supuesto, en una frase"}`;

const CAPAS = {
  estructura: { sw: 1.4 },
  detalles: { sw: 0.7 },
  tapizado: { sw: 1.0 },
  superior: { sw: 0.7, dash: '6 3' },
};
const r2 = n => Math.round(n * 100) / 100;
const num = v => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

function chaflan(x, y, w, h, c) {
  c = Math.max(0, Math.min(c, w / 2 - 0.01, h / 2 - 0.01));
  if (!(c > 0.05)) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  return [[x + c, y], [x + w - c, y], [x + w, y + c], [x + w, y + h - c], [x + w - c, y + h], [x + c, y + h], [x, y + h - c], [x, y + c]];
}

// elementos → fragmento SVG en el mismo formato que el resto de bloques (trazo #000000, sin relleno, en cm)
export function dibujar(elementos, W, H) {
  const out = [];
  const lim = (x, y) => [r2(Math.min(Math.max(x, -2), W + 2)), r2(Math.min(Math.max(y, -2), H + 2))];
  for (const e of (Array.isArray(elementos) ? elementos : []).slice(0, 400)) {
    if (!e || typeof e !== 'object') continue;
    const capa = CAPAS[e.capa] || CAPAS.estructura;
    const estilo = ` stroke="#000000" stroke-width="${capa.sw}" fill="none" stroke-linecap="round" stroke-linejoin="round"${capa.dash ? ` stroke-dasharray="${capa.dash}"` : ''}`;
    if (e.t === 'rect') {
      const x = num(e.x), y = num(e.y), w = num(e.w), h = num(e.h);
      if ([x, y, w, h].some(v => v === null) || !(w > 0.2 && h > 0.2)) continue;
      const pts = chaflan(x, y, w, h, num(e.c) || 0).map(([a, b]) => lim(a, b));
      out.push(`<polygon points="${pts.map(p => p.join(',')).join(' ')}"${estilo}/>`);
    } else if (e.t === 'circ') {
      const x = num(e.x), y = num(e.y), r = num(e.r);
      if ([x, y, r].some(v => v === null) || !(r > 0.2 && r < Math.max(W, H))) continue;
      out.push(`<circle cx="${r2(x)}" cy="${r2(y)}" r="${r2(r)}"${estilo}/>`);
    } else if ((e.t === 'linea' || e.t === 'poli') && Array.isArray(e.pts)) {
      const pts = e.pts.map(p => (Array.isArray(p) ? [num(p[0]), num(p[1])] : [null, null])).filter(p => p[0] !== null && p[1] !== null).map(([a, b]) => lim(a, b));
      if (pts.length < 2) continue;
      out.push(e.t === 'poli' && pts.length >= 3
        ? `<polygon points="${pts.map(p => p.join(',')).join(' ')}"${estilo}/>`
        : `<path d="M${pts.map(p => p.join(' ')).join(' L')}"${estilo}/>`);
    }
  }
  return out.join('');
}

async function preparar(buf) {
  const jpg = await sharp(buf).rotate().resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer();
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpg.toString('base64') } };
}

export async function generarBloquesDirecto({ imagenes, largo, fondo, alto, nombre, model }) {
  const fotos = [];
  for (const b of (imagenes || []).slice(0, 5)) fotos.push(await preparar(b));
  if (!fotos.length) throw new Error('Falta la foto');
  const r = await callClaude({
    system: SISTEMA, model, maxTokens: 16000,
    messages: [{ role: 'user', content: [...fotos, { type: 'text', text: `Producto: ${nombre || 'sin nombre'}. ${fotos.length} foto(s). Medidas reales: LARGO ${largo} cm (ancho visto de frente), FONDO ${fondo} cm, ALTO ${alto} cm. Dibuja la planta, el alzado y el lateral.` }] }],
  });
  const txt = (r.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('La IA no devolvió un dibujo válido. Inténtalo de nuevo.');
  let j;
  try { j = JSON.parse(m[0]); } catch { throw new Error('La IA devolvió el dibujo en un formato roto. Inténtalo de nuevo.'); }
  const svg = { planta: dibujar(j.planta, largo, fondo), alzado: dibujar(j.alzado, largo, alto), lateral: dibujar(j.lateral, fondo, alto) };
  const suelo = (W, H) => `<line x1="-4" y1="${H}" x2="${W + 4}" y2="${H}" stroke="#000000" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
  if (svg.alzado) svg.alzado += suelo(largo, alto);
  if (svg.lateral) svg.lateral += suelo(fondo, alto);
  return { largo, fondo, alto, svg, metodo: 'dibujo', nota: String(j.nota || '').slice(0, 300) };
}
