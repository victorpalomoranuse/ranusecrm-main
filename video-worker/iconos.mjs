// Tarjetas gráficas animables (número + icono) dibujadas como SVG y pasadas a PNG con resvg.
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(new URL('../server/package.json', import.meta.url));
const { Resvg } = require('@resvg/resvg-js');
const FONT = new URL('../public/fonts/Montserrat-Bold.ttf', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// Iconos en caja 100x100. Se dibujan con el color de acento.
const ICONOS = {
  barra: c => `<g fill="${c}"><rect x="6" y="46" width="88" height="8" rx="3"/><rect x="16" y="26" width="9" height="48" rx="3"/><rect x="28" y="34" width="7" height="32" rx="3"/><rect x="75" y="26" width="9" height="48" rx="3"/><rect x="65" y="34" width="7" height="32" rx="3"/></g>`,
  mancuerna: c => `<g fill="${c}"><rect x="30" y="45" width="40" height="10" rx="3"/><rect x="12" y="28" width="18" height="44" rx="5"/><rect x="70" y="28" width="18" height="44" rx="5"/></g>`,
  disco: c => `<g fill="none" stroke="${c}" stroke-width="7"><circle cx="50" cy="50" r="40"/><circle cx="50" cy="50" r="10"/><circle cx="50" cy="50" r="26" stroke-width="3"/></g>`,
  regla: c => `<g fill="none" stroke="${c}" stroke-width="6" stroke-linejoin="round"><rect x="6" y="34" width="88" height="32" rx="4"/><path d="M22 34v14M38 34v10M54 34v14M70 34v10M86 34v14" stroke-linecap="round"/></g>`,
  euro: c => `<g fill="none" stroke="${c}" stroke-width="7"><circle cx="50" cy="50" r="40"/></g><text x="50" y="67" font-family="Montserrat" font-weight="700" font-size="52" text-anchor="middle" fill="${c}">€</text>`,
  reloj: c => `<g fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round"><circle cx="50" cy="50" r="40"/><path d="M50 26v26l17 10"/></g>`,
  check: c => `<g fill="none" stroke="${c}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"><circle cx="50" cy="50" r="40"/><path d="M30 52l14 14 27-30"/></g>`,
  alerta: c => `<g fill="none" stroke="${c}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"><path d="M50 10L92 84H8Z"/><path d="M50 38v25M50 74v1"/></g>`,
  personas: c => `<g fill="${c}"><circle cx="35" cy="34" r="14"/><path d="M8 82c0-19 12-28 27-28s27 9 27 28z"/><circle cx="70" cy="40" r="11" opacity=".75"/><path d="M60 82c0-12 4-22 14-22 12 0 20 8 20 22z" opacity=".75"/></g>`,
  flecha: c => `<g fill="none" stroke="${c}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"><path d="M22 78L78 22M36 22h42v42"/></g>`,
  calendario: c => `<g fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round"><rect x="10" y="20" width="80" height="68" rx="8"/><path d="M10 40h80M30 10v18M70 10v18"/></g>`,
  metros: c => `<g fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><rect x="12" y="12" width="76" height="76" rx="6" stroke-dasharray="1 0"/><path d="M26 74L74 26M26 56v18h18M56 26h18v18"/></g>`,
  rack: c => `<g fill="${c}"><rect x="16" y="10" width="9" height="82" rx="3"/><rect x="75" y="10" width="9" height="82" rx="3"/><rect x="16" y="24" width="68" height="7" rx="3"/><rect x="2" y="44" width="96" height="6" rx="3"/></g>`,
  estrella: c => `<path d="M50 8l12 27 29 3-22 20 7 29-26-15-26 15 7-29L9 38l29-3z" fill="${c}"/>`,
  maquina: c => `<g fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><path d="M18 88V22h30v66M48 38h34v50M30 54h6M30 70h6"/><circle cx="72" cy="22" r="8"/></g>`,
};
export const NOMBRES_ICONOS = Object.keys(ICONOS);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

// Tarjeta: caja oscura translúcida, filete de acento, icono + número grande + unidad (o solo texto).
export function tarjetaPNG({ valor = '', unidad = '', texto = '', icono = '', acento = '#F2C46D' }, salida) {
  const ic = ICONOS[icono] ? ICONOS[icono](acento) : '';
  const grande = valor ? String(valor) : esc(texto).toUpperCase();
  const fs1 = valor ? 120 : 64, fs2 = 54;
  const w1 = grande.length * fs1 * (valor ? 0.66 : 0.68), w2 = unidad ? String(unidad).length * fs2 * 0.7 + 18 : 0;
  const iconoW = ic ? 150 : 0, ancho = Math.round(70 + iconoW + (ic ? 26 : 0) + w1 + w2 + 70), alto = 230;
  const x0 = 70 + iconoW + (ic ? 26 : 0);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}">
  <rect x="0" y="0" width="${ancho}" height="${alto}" rx="30" fill="#0b0b0b" fill-opacity="0.72"/>
  <rect x="0.5" y="0.5" width="${ancho - 1}" height="${alto - 1}" rx="30" fill="none" stroke="${acento}" stroke-opacity="0.55" stroke-width="2"/>
  <rect x="34" y="${alto - 30}" width="${Math.min(ancho - 68, 140)}" height="5" rx="2.5" fill="${acento}"/>
  ${ic ? `<g transform="translate(50 ${(alto - 120) / 2 - 6}) scale(1.2)">${ic}</g>` : ''}
  <text x="${x0}" y="${valor ? 150 : 138}" font-family="Montserrat" font-weight="700" font-size="${fs1}" fill="#FFFFFF">${esc(grande)}</text>
  ${unidad ? `<text x="${x0 + w1 + 14}" y="150" font-family="Montserrat" font-weight="700" font-size="${fs2}" fill="${acento}">${esc(unidad).toUpperCase()}</text>` : ''}
</svg>`;
  const png = new Resvg(svg, { font: { fontFiles: [FONT], loadSystemFonts: false, defaultFontFamily: 'Montserrat' } }).render().asPng();
  fs.writeFileSync(salida, png); return { ancho, alto };
}
