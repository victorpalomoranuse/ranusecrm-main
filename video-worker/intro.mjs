// Intro de apertura: la frase inicial de la voz aparece en el tercio inferior, en líneas cortas y centradas, con un solo tamaño,
// sobre un degradado oscuro suave (se lee sobre cualquier imagen y no tapa la cara). Cada línea entra cuando se dice su primera palabra
// y todas salen juntas al acabar la frase. La primera línea va en el color de acento de la marca.
const B = String.fromCharCode(92);

// palabras: [{ t, de, a }] en el tiempo del vídeo final. Devuelve { eventos, ultima (índice de la última palabra de la intro), fin (segundos) }
export function introLetras(palabras, tAss, limpia, { maxPalabras = 10, maxSeg = 5.2 } = {}) {
  let n = 0;
  for (; n < palabras.length && n < maxPalabras; n++) {
    const w = palabras[n]; if (w.de > maxSeg && n >= 3) break;
    if (/[.?!]$/.test(w.t) && n >= 2) { n++; break; }
  }
  if (n < 2) return { eventos: [], ultima: -1, fin: 0 };
  const fin = palabras[n - 1].a + 0.4, ev = [];
  const txt = (j) => limpia(palabras[j].t).toLowerCase().replace(/[.,;:¿¡?!]+$/, '');
  // líneas de hasta ~16 letras (máximo 4 líneas)
  const lineas = []; let cur = null;
  for (let j = 0; j < n; j++) {
    const w = txt(j); if (!w) continue;
    if (cur && (cur.texto + ' ' + w).length <= 16) { cur.texto += ' ' + w; cur.a = palabras[j].a; }
    else { cur = { texto: w, de: palabras[j].de, a: palabras[j].a }; lineas.push(cur); }
  }
  while (lineas.length > 4) { const ult = lineas.pop(); lineas[lineas.length - 1].texto += ' ' + ult.texto; }
  if (!lineas.length) return { eventos: [], ultima: -1, fin: 0 };
  const fs = 88, alto = 112, y0 = 1330 - (lineas.length - 1) * alto / 2;
  const t0 = lineas[0].de;
  // degradado oscuro bajo el texto (rectángulo con transparencia)
  const top = Math.round(y0 - 150), h = Math.round(lineas.length * alto + 300);
  ev.push('Dialogue: 4,' + tAss(t0) + ',' + tAss(fin) + ',Intro,,0,0,0,,{' + B + 'an7' + B + 'pos(0,' + top + ')' + B + 'p1' + B + 'c&H000000&' + B + 'alpha&H8C&' + B + 'fad(250,350)}m 0 0 l 1080 0 1080 ' + h + ' 0 ' + h + '{' + B + 'p0}');
  lineas.forEach((l, i) => {
    const y = Math.round(y0 + i * alto), col = i === 0 ? B + 'c&H' + 'B8D2E3' + '&' : '';
    ev.push('Dialogue: 5,' + tAss(l.de) + ',' + tAss(fin) + ',Intro,,0,0,0,,{' + B + 'an5' + B + 'pos(540,' + y + ')' + B + 'fs' + fs + col + B + 'fad(260,' + (i === lineas.length - 1 ? 350 : 350) + ')}' + l.texto);
  });
  return { eventos: ev, ultima: n - 1, fin };
}
export const ESTILO_INTRO = 'Style: Intro,Montserrat,88,&H00FFFFFF,&H000000FF,&H00000000,&H70000000,-1,0,0,0,100,100,0,0,1,0,3,5,40,40,40,1';
