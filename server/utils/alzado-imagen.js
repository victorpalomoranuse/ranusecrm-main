import path from 'path';
import { fileURLToPath } from 'url';
import { alzadoSVG } from './alzado-svg.js';

// Alzado (ficha de la lámina) → imagen PNG, para mandarlo por WhatsApp. Usa resvg con las fuentes incluidas (Liberation Sans, licencia OFL)
// para que el texto salga igual en cualquier servidor. El dibujo es el mismo que ve el CRM (utils/alzado-svg.js es copia de src/utils/alzado.js).
let Resvg = null;
try { ({ Resvg } = await import('@resvg/resvg-js')); } catch (e) { console.error('resvg no disponible (no se podrán mandar alzados como imagen):', e.message); }
const FUENTES = ['LiberationSans-Regular.ttf', 'LiberationSans-Bold.ttf'].map(f => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fonts', f));

export function alzadoPNG(spec, { fecha, ancho = 2000 } = {}) {
  if (!Resvg) throw new Error('El generador de imágenes no está disponible en el servidor');
  let svg = alzadoSVG(spec, { fecha }); if (!svg) throw new Error('La lámina no tiene pared definida');
  const vb = /viewBox="([-\d.\s]+)"/.exec(svg); const [, , vw, vh] = vb ? vb[1].trim().split(/\s+/).map(Number) : [0, 0, 400, 300];
  svg = svg.replace(/font-family="[^"]*"/g, 'font-family="Liberation Sans"').replace(/width="100%"/, 'width="' + vw + '" height="' + vh + '"').replace(/style="max-height:[^"]*"/, '');
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: ancho }, background: '#ffffff', font: { fontFiles: FUENTES, loadSystemFonts: false, defaultFontFamily: 'Liberation Sans' } });
  return r.render().asPng();
}
