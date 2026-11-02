// Amplía la biblioteca 3D gratuita con texturas de ambientCG (licencia CC0): piel y cuero (también negra), tejidos, moquetas, hormigón, baldosas, terrazo y mármol.
// Uso (desde /server):  node scripts/ampliar-ambientcg.mjs --dry     → solo cuenta lo que añadiría
//                       node scripts/ampliar-ambientcg.mjs           → descarga, sube y actualiza el índice
// No borra nada: guarda una copia del índice anterior y solo añade texturas que no estén ya (ids «acg-…»).
import 'dotenv/config';
import sharp from 'sharp';
import JSZip from 'jszip';
import { supabase } from '../config/supabase.js';

const BUCKET = 'project-documents', RUTA = 'biblioteca3d/indice.json';
const dry = process.argv.includes('--dry');

// consulta en ambientCG → categoría de la biblioteca, prefijo del nombre, tamaño real aproximado de la muestra (cm) y cuántas se añaden
const BUSQUEDAS = [
  { q: 'leather', extra: 'black', cat: 'Piel y cuero', base: 'Piel', tam: 40, n: 14 },
  { q: 'leather', cat: 'Piel y cuero', base: 'Piel', tam: 40, n: 30 },
  { q: 'fabric', cat: 'Tejidos', base: 'Tejido', tam: 30, n: 45 },
  { q: 'carpet', cat: 'Tejidos', base: 'Moqueta', tam: 60, n: 18 },
  { q: 'concrete', cat: 'Yeso y hormigón', base: 'Hormigón', tam: 200, n: 45 },
  { q: 'tiles', cat: 'Baldosas', base: 'Baldosa', tam: 80, n: 55 },
  { q: 'terrazzo', cat: 'Baldosas', base: 'Terrazo', tam: 100, n: 12 },
  { q: 'marble', cat: 'Piedra y mármol', base: 'Mármol', tam: 150, n: 25 },
];
const COLORES = { black: 'negro', brown: 'marrón', white: 'blanco', red: 'rojo', grey: 'gris', gray: 'gris', blue: 'azul', green: 'verde', beige: 'beige', yellow: 'amarillo', orange: 'naranja', pink: 'rosa', purple: 'morado' };

const json = async url => { const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); };
const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(RUTA);
const ind = await json(pub.publicUrl + '?t=' + Date.now());
const tengo = new Set((ind.texturas || []).map(t => t.id));

const elegidas = [], vistas = new Set();
for (const b of BUSQUEDAS) {
  const qs = b.q + (b.extra ? ' ' + b.extra : '');
  const r = await json('https://ambientcg.com/api/v2/full_json?type=Material&sort=Popular&limit=100&include=downloadData,tagData&q=' + encodeURIComponent(qs));
  let cuenta = 0;
  for (const a of r.foundAssets || []) {
    if (cuenta >= b.n) break;
    const id = 'acg-' + a.assetId.toLowerCase();
    if (tengo.has(id) || vistas.has(id)) continue;
    // la búsqueda libre trae cosas raras: se exige que el nombre o las etiquetas hablen de lo que se busca
    const tags = (a.tags || []).map(t => String(t).toLowerCase());
    if (!(a.assetId.toLowerCase().startsWith(b.q) || tags.includes(b.q))) continue;
    if (b.extra && !tags.includes(b.extra)) continue;
    const zip = ((a.downloadFolders?.default?.downloadFiletypeCategories?.zip?.downloads) || []).find(d => d.attribute === '1K-JPG');
    if (!zip) continue;
    vistas.add(id); cuenta++;
    const color = tags.map(t => COLORES[t]).find(Boolean);
    const num = (a.assetId.match(/\d+$/) || [''])[0];
    elegidas.push({ id, nombre: b.base + ' ' + num + (color ? ' ' + color : ''), categoria: b.cat, tam: b.tam, zip: zip.downloadLink });
  }
  console.log(qs, '→', cuenta);
}
console.log('Ya hay', tengo.size, '· se añadirán', elegidas.length);
if (dry) process.exit(0);

await supabase.storage.from(BUCKET).upload('biblioteca3d/indice.copia-acg-' + new Date().toISOString().slice(0, 10) + '.json', Buffer.from(JSON.stringify(ind)), { contentType: 'application/json', upsert: true, cacheControl: '0' });

const nuevas = [];
const guardarIndice = async () => {
  const out = { ...ind, texturas: [...ind.texturas, ...nuevas], generado: new Date().toISOString() };
  const { error } = await supabase.storage.from(BUCKET).upload(RUTA, Buffer.from(JSON.stringify(out)), { contentType: 'application/json', upsert: true, cacheControl: '0' });
  if (error) throw error;
};
let i = 0, fallos = 0;
async function trabajo() {
  while (i < elegidas.length) {
    const e = elegidas[i++];
    try {
      const r = await fetch(e.zip); if (!r.ok) throw new Error('descarga ' + r.status);
      const z = await JSZip.loadAsync(Buffer.from(await r.arrayBuffer()));
      const f = Object.values(z.files).find(x => /_Color\.jpg$/i.test(x.name));
      if (!f) throw new Error('sin color');
      const buf = await sharp(await f.async('nodebuffer')).resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
      const ruta = 'biblioteca3d/texturas/' + e.id + '.jpg';
      const { error } = await supabase.storage.from(BUCKET).upload(ruta, buf, { contentType: 'image/jpeg', upsert: true });
      if (error) throw error;
      nuevas.push({ id: e.id, nombre: e.nombre, categoria: e.categoria, url: supabase.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl, tam: e.tam });
      if (nuevas.length % 20 === 0) { await guardarIndice(); console.log('guardadas', nuevas.length); }
    } catch (err) { fallos++; console.log('FALLO', e.id, err.message); }
  }
}
await Promise.all([trabajo(), trabajo(), trabajo()]);
await guardarIndice();
console.log('Listo: añadidas', nuevas.length, 'texturas. Fallos:', fallos);
