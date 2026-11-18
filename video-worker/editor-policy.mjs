// Restricciones verificables: no dependen de que el modelo obedezca el prompt.
export function aceptaClip(c) {
  const j = c.juicio;
  return !!j && j.veredicto === 'publicar' && j.entiendeSolo === true && !j.incompleto && !j.mezcla && Number.isFinite(j.nota) && j.nota >= 60;
}
export function efectosPermitidos(r) {
  const sobria = !r.intensidad || r.intensidad === 'sobria';
  return [...(sobria ? ['zoom', 'abierto', 'empuje', 'palabra'] : ['zoom', 'zoomFuerte', 'abierto', 'empuje', 'temblor', 'glitch', 'blancoNegro', 'vineta', 'apagon', 'barrido', 'calido', 'palabra']), ...(r.flash === true || r.flash === 'si' ? ['flash', 'flashColor', 'impacto'] : [])];
}
export function admiteDestello(tipo, t, ultimo) {
  return !['flash', 'flashColor', 'impacto'].includes(tipo) || t - ultimo >= 10;
}
export function geometriaSuperposicion(modo) {
  return modo === 'ventana'
    ? { escala: 'scale=680:450:force_original_aspect_ratio=decrease', x: '(W-w)/2', y: 'H-h-350' }
    : { escala: 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920', x: '0', y: '0' };
}

export function filtrosSuperposicion({ index, prev, k, a, d, modo }) {
  const geo = geometriaSuperposicion(modo);
  return [
    '[' + index + ':v]' + geo.escala + ',fps=30,setsar=1,format=yuva420p,fade=t=in:st=0:d=0.18:alpha=1,fade=t=out:st=' + (d - 0.18).toFixed(2) + ':d=0.18:alpha=1,setpts=PTS+' + a.toFixed(3) + '/TB[i' + k + ']',
    '[' + prev + '][i' + k + ']overlay=x=' + geo.x + ':y=' + geo.y + ":enable='between(t," + a.toFixed(3) + ',' + (a+d).toFixed(3) + ")':eof_action=pass[oi" + k + ']',
  ];
}
