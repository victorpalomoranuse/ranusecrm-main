// Intro con las palabras grandes apilándose por la pantalla (como en los vídeos de "mi día" de referencia):
// las primeras palabras de la voz aparecen una a una, enormes, en posiciones y tamaños distintos, y se quedan hasta acabar la frase de apertura.
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const POS = [[360, 540, 230], [650, 720, 300], [400, 900, 215], [640, 1070, 310]];

// palabras: [{ t, de, a }] en el tiempo del vídeo final. Devuelve { eventos, ultima (índice de la última palabra de la intro), fin (segundos) }
export function introLetras(palabras, tAss, limpia, { maxPalabras = 9, maxSeg = 4.8 } = {}) {
  let n = 0;
  for (; n < palabras.length && n < maxPalabras; n++) {
    const w = palabras[n]; if (w.de > maxSeg && n >= 3) break;
    if (/[.?!]$/.test(w.t) && n >= 2) { n++; break; }
  }
  if (n < 2) return { eventos: [], ultima: -1, fin: 0 };
  const fin = palabras[n - 1].a + 0.35, ev = [];
  // grupos de 3-4 palabras: cada grupo se apila y lo sustituye el siguiente
  const grupos = []; let g = [];
  for (let j = 0; j < n; j++) { g.push(j); if (g.length >= 4 || /[,.;:?!]$/.test(palabras[j].t) && g.length >= 2) { grupos.push(g); g = []; } }
  if (g.length) { if (g.length === 1 && grupos.length) grupos[grupos.length - 1].push(g[0]); else grupos.push(g); }
  grupos.forEach((gr, gi) => {
    const finG = gi < grupos.length - 1 ? palabras[grupos[gi + 1][0]].de : fin;
    gr.forEach((j, k) => {
      const w = palabras[j], txt = limpia(w.t).toLowerCase().replace(/[.,;:¿¡?!]+$/, ''); if (!txt) return;
      const [x0, y, fs0] = POS[k % POS.length];
      const fs = Math.round(Math.min(fs0, 960 / (txt.length * 0.62))), ancho = txt.length * fs * 0.66;
      const x = Math.round(clamp(x0, ancho / 2 + 40, 1040 - ancho / 2));
      ev.push('Dialogue: 5,' + tAss(w.de) + ',' + tAss(finG) + ',Intro,,0,0,0,,{\\an5\\pos(' + x + ',' + y + ')\\fs' + fs + '\\fscx55\\fscy55\\t(0,140,\\fscx100\\fscy100)\\fad(0,' + (gi < grupos.length - 1 ? 60 : 160) + ')}' + txt);
    });
  });
  return { eventos: ev, ultima: n - 1, fin };
}
export const ESTILO_INTRO = 'Style: Intro,Montserrat,150,&H00FFFFFF,&H000000FF,&H00000000,&H70000000,-1,0,0,0,100,100,0,0,1,0,4,5,40,40,40,1';
