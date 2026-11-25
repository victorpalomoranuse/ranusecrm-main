// Tour de renders: cada render final guarda desde dónde se hizo en el 3D (posición, objetivo y apertura de la cámara). Con eso se calcula
// en qué punto de la imagen de uno cae el lugar donde estaba la cámara de otro: ese es el punto que se toca para ir allí.
// Es la misma proyección que usa el visor 3D (three.js: Y arriba, la cámara mira hacia su objetivo, apertura vertical en grados).
const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const cruz = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const norma = (p) => { const l = Math.hypot(p[0], p[1], p[2]) || 1; return [p[0] / l, p[1] / l, p[2] / l]; };

export const ALTURA_OJOS = 1.55; // m: el punto se coloca en el suelo bajo la cámara de destino, que es donde se pondría uno de pie

// a, b: { px, py, pz, tx, ty, tz, fov } · aspect = ancho / alto de la imagen de «a» · shift = desplazamiento vertical de la lente de «a»
// Devuelve { x, y, dist, dentro, lado } con x e y en % de la imagen, o null si el destino queda detrás de la cámara.
export function puntoEnFoto(a, b, aspect, shift = 0, altura = ALTURA_OJOS) {
  if (![a?.px, a?.py, a?.pz, b?.px, b?.py, b?.pz].every(Number.isFinite)) return null;
  const pos = [a.px, a.py, a.pz], f = norma(sub([a.tx ?? a.px, a.ty ?? a.py, a.tz ?? a.pz + 1], pos));
  let der = cruz(f, [0, 1, 0]); if (Math.hypot(...der) < 1e-6) der = [1, 0, 0]; der = norma(der); // mirando recto arriba o abajo no hay «derecha»: se toma el eje X
  const arriba = cruz(der, f), d = sub([b.px, b.py - altura, b.pz], pos), zc = dot(d, f);
  const dist = Math.hypot(d[0], d[2]);
  if (zc < 0.15) return { x: null, y: null, dist, dentro: false, lado: dot(d, der) < 0 ? 'izq' : 'der' }; // detrás de la cámara: no se ve, pero se sabe hacia qué lado queda
  const tanV = Math.tan(((a.fov || 50) * Math.PI) / 360), nx = dot(d, der) / (zc * tanV * (aspect || 1.6)), ny = dot(d, arriba) / (zc * tanV) - 2 * (shift || 0);
  const x = (nx + 1) * 50, y = (1 - ny) * 50, dentro = nx >= -0.97 && nx <= 0.97 && ny >= -0.97 && ny <= 0.97;
  return { x: +x.toFixed(2), y: +y.toFixed(2), dist: +dist.toFixed(2), dentro, lado: nx < 0 ? 'izq' : 'der' };
}

// Para la foto «i»: los saltos posibles hacia las demás, del más cerca al más lejos. Los que caen dentro del encuadre llevan su punto (x, y);
// el resto se ofrece como flecha en el borde (izq / der).
export function enlacesDeFoto(fotos, i, aspect) {
  const a = fotos[i]; if (!a) return [];
  return fotos.map((b, k) => ({ k, r: k === i ? null : puntoEnFoto(a.cam, b.cam, aspect, a.shift) })).filter(e => e.r)
    .map(e => ({ i: e.k, ...e.r })).sort((p, q) => p.dist - q.dist);
}
