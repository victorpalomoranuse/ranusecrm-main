// Tipografías disponibles para los subtítulos y rótulos. Los archivos están en public/fonts (incluidos en la imagen) o en video-worker/fonts.
import fs from 'fs';
import path from 'path';

// nombre de la familia (el que se usa en el estilo del formato) → archivo
export const FUENTES = {
  'Montserrat': 'Montserrat-Bold.ttf',
  'Rubik': 'Rubik-Bold.ttf',
  'Anton': 'Anton-Regular.ttf',
  'Bebas Neue': 'BebasNeue-Regular.ttf',
  'Archivo Black': 'ArchivoBlack-Regular.ttf',
  'Oswald': 'Oswald.ttf',
  'Staatliches': 'Staatliches-Regular.ttf',
  'Russo One': 'RussoOne-Regular.ttf',
  'Righteous': 'Righteous-Regular.ttf',
  'Playfair Display': 'PlayfairDisplay.ttf',
  'Abril Fatface': 'AbrilFatface-Regular.ttf',
  'Cinzel': 'Cinzel.ttf',
};
const BUSCA = [new URL('../public/fonts/', import.meta.url), new URL('./fonts/', import.meta.url)].map(u => u.pathname.replace(/^\/([A-Za-z]:)/, '$1'));

export function rutaFuente(familia) {
  const f = FUENTES[familia]; if (!f) return null;
  for (const d of BUSCA) { const p = path.join(d, f); if (fs.existsSync(p)) return p; }
  return null;
}
// Copia a la carpeta de trabajo los archivos de las familias pedidas (para el quemado con ffmpeg y para HyperFrames)
export function copiaFuentes(destino, familias) {
  fs.mkdirSync(destino, { recursive: true }); const hechas = [];
  for (const fam of familias) { const o = rutaFuente(fam); if (!o) continue; const d = path.join(destino, path.basename(o)); if (!fs.existsSync(d)) fs.copyFileSync(o, d); hechas.push(fam); }
  return hechas;
}
export const familiaDeArchivo = (archivo) => Object.keys(FUENTES).find(k => FUENTES[k] === path.basename(archivo)) || null;
