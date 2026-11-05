// Dibuja el alzado (SVG) a partir de la ficha que prepara el Asistente de diseño. Todo en cm; el dibujo es exacto, no lo inventa la IA.

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = n => { const r = Math.round(n * 10) / 10; return (Number.isInteger(r) ? String(r) : r.toFixed(1)).replace('.', ',') };

// Escala de impresión normalizada para A3 apaisado (zona de dibujo ~ 390 × 250 mm)
export function escalaImpresion(anchoCm, altoCm) {
  for (const n of [5, 10, 20, 25, 30, 40, 50, 75, 100, 150, 200]) if (anchoCm * 10 / n <= 390 && altoCm * 10 / n <= 250) return n;
  return 200;
}

export function alzadoSVG(spec, { fecha } = {}) {
  if (!spec?.pared) return '';
  const W = spec.pared.ancho, H = spec.pared.alto, u = Math.max(W, H) / 100;
  const fs = 1.55 * u, fsS = 1.2 * u, lw = 0.16 * u, lwF = 0.3 * u, lwFino = 0.08 * u;
  const ml = 12 * u, mr = 12 * u, mt = 5 * u, mb = 38 * u;
  const vx = -ml, vy = -mt, vw = W + ml + mr, vh = H + mt + mb;
  const INK = '#1f1f1f', GRIS = '#8a8580', COTA = '#b3361f';
  const o = [];
  const line = (x1, y1, x2, y2, st = INK, w = lw, extra = '') => o.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${st}" stroke-width="${w}" ${extra}/>`);
  const rect = (x, y, w, h, fill = 'none', st = INK, sw = lw, extra = '') => o.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${st}" stroke-width="${sw}" ${extra}/>`);
  const text = (x, y, t, { size = fs, anchor = 'middle', fill = INK, rot = 0, weight = 400 } = {}) => o.push(`<text x="${x}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${rot ? ` transform="rotate(${rot} ${x} ${y})"` : ''}>${esc(t)}</text>`);
  const tick = (x, y) => line(x - 0.45 * u, y + 0.45 * u, x + 0.45 * u, y - 0.45 * u, COTA, lw);
  // cota horizontal entre x1 y x2, con la línea a altura y (la lleva `desde` si se quiere prolongar)
  const cotaH = (x1, x2, y, t, desde) => {
    if (desde !== undefined) { line(x1, desde, x1, y + 0.7 * u, COTA, lwFino); line(x2, desde, x2, y + 0.7 * u, COTA, lwFino); }
    line(x1, y, x2, y, COTA, lw); tick(x1, y); tick(x2, y);
    const tw = String(t).length * fsS * 0.56;
    if (x2 - x1 >= tw + 0.8 * u) text((x1 + x2) / 2, y - 0.5 * u, t, { size: fsS, fill: COTA });
    else text((x1 + x2) / 2, y + 1.55 * u, t, { size: fsS * 0.85, fill: COTA });
  };
  const cotaV = (y1, y2, x, t, desde) => {
    if (desde !== undefined) { line(desde, y1, x - 0.7 * u, y1, COTA, lwFino); line(desde, y2, x - 0.7 * u, y2, COTA, lwFino); }
    line(x, y1, x, y2, COTA, lw); tick(x, y1); tick(x, y2);
    text(x - 0.6 * u, (y1 + y2) / 2, t, { size: fsS, fill: COTA, rot: -90 });
  };

  o.push(`<defs><pattern id="sombra" width="${1.2 * u}" height="${1.2 * u}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="${1.2 * u}" stroke="#c9c4bc" stroke-width="${lwFino}"/></pattern></defs>`);
  o.push(`<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="#ffffff"/>`);
  // pared y suelo
  rect(0, 0, W, H, '#fbfaf8', INK, lwF);
  line(-3 * u, H, W + 3 * u, H, INK, lwF * 1.4);

  // huecos de la pared
  (spec.huecos || []).forEach(h => {
    const y = H - h.y - h.alto;
    if (h.tipo === 'ventana') {
      rect(h.x, y, h.ancho, h.alto, '#e8f0f4', INK, lw); rect(h.x + 1.5, y + 1.5, h.ancho - 3, h.alto - 3, 'none', GRIS, lwFino);
      line(h.x + h.ancho / 2, y, h.x + h.ancho / 2, y + h.alto, GRIS, lwFino);
    } else if (h.tipo === 'puerta') {
      rect(h.x, y, h.ancho, h.alto, '#f2eee8', INK, lw);
      line(h.x, y, h.x + h.ancho, y + h.alto / 2, GRIS, lwFino, `stroke-dasharray="${0.8 * u} ${0.5 * u}"`); line(h.x, y + h.alto, h.x + h.ancho, y + h.alto / 2, GRIS, lwFino, `stroke-dasharray="${0.8 * u} ${0.5 * u}"`);
    } else rect(h.x, y, h.ancho, h.alto, '#eeeae4', INK, lw);
    text(h.x + h.ancho / 2, y + h.alto / 2 + fsS * 0.35, `${h.nombre || h.tipo} ${fmt(h.ancho)}×${fmt(h.alto)}`, { size: fsS * 0.9, fill: GRIS });
    if (h.y > 0) text(h.x + h.ancho / 2, y + h.alto + fsS * 1.2, `h. ${fmt(h.y)}`, { size: fsS * 0.8, fill: GRIS });
  });

  // mueble
  const m = spec.mueble;
  if (m?.modulos?.length) {
    const x0 = m.margenIzq, x1 = m.margenIzq + m.total, top = H - m.altura, zoc = m.zocalo, enc = m.encimera, cuerpoTop = top + enc, cuerpoBot = H - zoc;
    // zócalo
    rect(x0 + 1.5, cuerpoBot, m.total - 3, zoc, 'url(#sombra)', INK, lw);
    // módulos
    m.modulos.forEach(md => {
      const a = md.x, b = md.x + md.ancho, g = 0.25, yt = cuerpoTop + g, yb = cuerpoBot - g;
      rect(a, cuerpoTop, md.ancho, cuerpoBot - cuerpoTop, '#f4efe7', INK, lw);
      if (md.tipo === 'puertas') {
        const n = md.hojas || 1, hw = md.ancho / n;
        for (let i = 0; i < n; i++) {
          const xa = a + i * hw + g, xb = a + (i + 1) * hw - g, izq = n === 1 ? false : i < n / 2;  // 1 hoja: bisagra a la izquierda → se dibuja con bisagra izq.
          const bis = n === 1 ? 'izq' : (izq ? 'izq' : 'der');
          rect(xa, yt, xb - xa, yb - yt, '#ffffff', INK, lw);
          const ym = (yt + yb) / 2, d = `stroke-dasharray="${0.7 * u} ${0.45 * u}"`;
          if (bis === 'izq') { line(xa, ym, xb, yt, GRIS, lwFino, d); line(xa, ym, xb, yb, GRIS, lwFino, d); line(xb - 2.2, ym - 5, xb - 2.2, ym + 5, INK, lwF); }
          else { line(xb, ym, xa, yt, GRIS, lwFino, d); line(xb, ym, xa, yb, GRIS, lwFino, d); line(xa + 2.2, ym - 5, xa + 2.2, ym + 5, INK, lwF); }
        }
      } else if (md.tipo === 'cajones') {
        const n = md.cajones || 3, hh = (yb - yt) / n;
        for (let i = 0; i < n; i++) { const ya = yt + i * hh + (i ? g / 2 : 0), yh = hh - g; rect(a + g, ya, md.ancho - 2 * g, yh, '#ffffff', INK, lw); line(a + md.ancho / 2 - Math.min(8, md.ancho / 5), ya + 3.5, a + md.ancho / 2 + Math.min(8, md.ancho / 5), ya + 3.5, INK, lwF); }
      } else if (md.tipo === 'abierto') {
        rect(a + 1.5, cuerpoTop + 1.5, md.ancho - 3, cuerpoBot - cuerpoTop - 3, '#ebe5da', GRIS, lwFino);
        const nb = md.baldas ?? 2; for (let i = 1; i <= nb; i++) { const yy = cuerpoTop + 1.5 + i * (cuerpoBot - cuerpoTop - 3) / (nb + 1); line(a + 1.5, yy, b - 1.5, yy, INK, lw); }
        text((a + b) / 2, cuerpoTop + fsS * 1.6, 'abierto', { size: fsS * 0.8, fill: GRIS });
      } else {
        rect(a + 1.5, cuerpoTop + 1.5, md.ancho - 3, cuerpoBot - cuerpoTop - 3, '#ffffff', GRIS, lwFino, `stroke-dasharray="${0.8 * u} ${0.5 * u}"`);
        text((a + b) / 2, (cuerpoTop + cuerpoBot) / 2, md.nombre || 'hueco', { size: fsS, fill: GRIS });
      }
      // marca de módulo bajo la encimera (M1, M2…) fuera del dibujo del frente para no ensuciarlo: va en la cota inferior
    });
    // encimera (sobresale 1 cm por cada lado)
    rect(x0 - 1, top, m.total + 2, enc, '#d9cfbf', INK, lwF);
    // cotas: cadena de módulos bajo el suelo
    const yc1 = H + 7 * u, yc2 = H + 13 * u;
    const trozos = [];
    if (m.margenIzq > 0.05) trozos.push([0, m.margenIzq, fmt(m.margenIzq), true]);
    m.modulos.forEach(md => trozos.push([md.x, md.x + md.ancho, fmt(md.ancho), false, md.n]));
    if (m.margenDer > 0.05) trozos.push([x1, W, fmt(m.margenDer), true]);
    trozos.forEach(([a, b, t, libre, n]) => { cotaH(a, b, yc1, t, H); if (n) text((a + b) / 2, H + 3.6 * u, `M${n}`, { size: fsS * 0.9, fill: GRIS }); else text((a + b) / 2, H + 3.6 * u, 'libre', { size: fsS * 0.8, fill: GRIS }); });
    cotaH(0, W, yc2, fmt(W), H);
    // alturas: mueble a la derecha, pared a la izquierda
    cotaV(top, H, W + 6 * u, fmt(m.altura), W);
    cotaV(0, H, -6 * u, fmt(H), 0);
  } else {
    cotaH(0, W, H + 7 * u, fmt(W), H); cotaV(0, H, -6 * u, fmt(H), 0);
  }

  // cajetín
  const cy = H + 18 * u, ch = 15 * u;
  rect(0, cy, W, ch, '#ffffff', INK, lwF);
  line(W * 0.62, cy, W * 0.62, cy + ch, INK, lw);
  const esc1 = escalaImpresion(vw, vh);
  text(1.2 * u, cy + 4.2 * u, 'RANUSE DESIGN', { size: fs * 0.9, anchor: 'start', weight: 700 });
  text(1.2 * u, cy + 8.3 * u, spec.titulo || 'Alzado', { size: fs * 1.15, anchor: 'start', weight: 700 });
  text(1.2 * u, cy + 12 * u, [spec.proyecto && `Proyecto: ${spec.proyecto}`, m?.material && `Acabado: ${m.material}`, m?.profundidad && `Fondo: ${fmt(m.profundidad)}`, m && `Zócalo ${fmt(m.zocalo)} · Encimera ${fmt(m.encimera)}`].filter(Boolean).join('  ·  ') || 'Medidas en cm', { size: fsS, anchor: 'start', fill: GRIS });
  text(W * 0.62 + 1.2 * u, cy + 4.2 * u, `Escala 1:${esc1}  ·  Cotas en cm`, { size: fsS, anchor: 'start' });
  text(W * 0.62 + 1.2 * u, cy + 8 * u, fecha || '', { size: fsS, anchor: 'start', fill: GRIS });
  (spec.notas || []).slice(0, 3).forEach((n, i) => text(W * 0.62 + 1.2 * u, cy + (10.6 + 1.9 * i) * u, n.slice(0, 48), { size: fsS * 0.85, anchor: 'start', fill: GRIS }));

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="100%" style="max-height:100%;background:#fff" data-escala="${esc1}" data-w="${vw}" data-h="${vh}">${o.join('')}</svg>`;
}

// Abre una ventana lista para imprimir/guardar como PDF en A3 apaisado, a escala real.
