// Maqueta del cliente: vistas de la planta en 3D generadas una sola vez en el visor (modo Render), con los puntos donde se hizo cada render final.
// El cliente solo descarga esas imágenes: no se calcula nada en su dispositivo.

const num = v => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : NaN);

// Puntos de la maqueta: posición de cada render en la imagen (0..1). Se descarta lo que no sea un número dentro de la imagen.
export function limpiaPines(pines) {
  if (!Array.isArray(pines)) return [];
  return pines.slice(0, 40).map(p => ({ id: String(p?.id || '').slice(0, 40), x: num(p?.x), y: num(p?.y) }))
    .filter(p => p.id && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)
    .map(p => ({ id: p.id, x: Math.round(p.x * 10000) / 10000, y: Math.round(p.y * 10000) / 10000 }));
}

// La última maqueta generada (todas sus vistas comparten «grupo»), ordenada por ángulo
export function maquetaDeTour(escena3d) {
  const todas = (escena3d?.renders || []).filter(r => r && r.tipo === 'maqueta' && r.url);
  if (!todas.length) return [];
  const ultimo = todas.reduce((a, r) => (String(r.creado) > String(a.creado) ? r : a));
  const grupo = ultimo.meta?.grupo || '';
  return todas.filter(r => (r.meta?.grupo || '') === grupo)
    .sort((a, b) => (num(a.meta?.az) || 0) - (num(b.meta?.az) || 0))
    .map(r => ({ id: r.id, url: r.url, az: num(r.meta?.az) || 0, pines: limpiaPines(r.meta?.pines) }));
}
