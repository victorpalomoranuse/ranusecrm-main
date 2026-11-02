// Amplía la biblioteca 3D gratuita con más texturas de Poly Haven (licencia CC0) de interiores: suelos, paredes, madera, baldosas, hormigón, tejidos…
// Uso (desde /server):  node scripts/ampliar-texturas.mjs --dry          → solo cuenta lo que añadiría
//                       node scripts/ampliar-texturas.mjs [--max=N]      → descarga, sube y actualiza el índice
// No borra nada: guarda una copia del índice anterior (indice.copia-FECHA.json) y solo añade texturas que no estén ya.
import 'dotenv/config';
import sharp from 'sharp';
import { supabase } from '../config/supabase.js';

const BUCKET = 'project-documents', RUTA = 'biblioteca3d/indice.json';
const dry = process.argv.includes('--dry');
const max = Number((process.argv.find(a => a.startsWith('--max=')) || '').split('=')[1]) || 260;
const porCat = Number((process.argv.find(a => a.startsWith('--porcat=')) || '').split('=')[1]) || 45;

const BUENAS = ['wood', 'tiles', 'concrete', 'plaster', 'plaster-concrete', 'brick', 'metal', 'fabric', 'leather', 'carpet', 'sandstone', 'indoor', 'cotton', 'wool', 'velvet', 'denim'];
const MALAS = ['terrain', 'snow', 'bark', 'aerial', 'road', 'asphalt', 'gravel', 'sand', 'cobblestone', 'roofing', 'food', 'fur', 'natural'];

function categoria(a) {
  const c = a.categories || [], t = a.tags || [], nom = String(a.name || '').toLowerCase();
  if (c.includes('tiles') || /tile|azulej|mosaic|terrazzo|marble|granite/.test(nom + ' ' + t.join(' '))) return /marble|granite|stone|terrazzo/.test(nom + ' ' + t.join(' ')) ? 'Piedra y mármol' : 'Baldosas';
  if (c.includes('wood') || c.includes('raw wood')) return 'Madera';
  if (c.includes('brick')) return 'Ladrillo';
  if (c.includes('metal')) return 'Metal';
  if (c.some(x => ['fabric', 'leather', 'carpet', 'cotton', 'wool', 'velvet', 'denim', 'knitted', 'woven', 'suede', 'corduroy', 'jacquard', 'hessian', 'satin', 'crepe', 'stretchy'].includes(x))) return 'Tejidos';
  if (c.includes('concrete') || c.includes('plaster') || c.includes('plaster-concrete')) return 'Yeso y hormigón';
  if (c.includes('sandstone')) return 'Piedra y mármol';
  if (c.includes('floor')) return 'Suelos';
  return 'Paredes';
}

const json = async url => { const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); };
const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(RUTA);
const ind = await json(pub.publicUrl + '?t=' + Date.now());
const tengo = new Set((ind.texturas || []).map(t => t.id));
const todas = await json('https://api.polyhaven.com/assets?t=textures');

const cand = Object.entries(todas)
  .filter(([id, a]) => !tengo.has(id) && (a.categories || []).some(c => BUENAS.includes(c)) && !(a.categories || []).some(c => MALAS.includes(c) || c.startsWith('collection:')))
  .sort((x, y) => (y[1].date_published || 0) - (x[1].date_published || 0));

const contador = {}, elegidas = [];
for (const [id, a] of cand) {
  const cat = categoria(a);
  if ((contador[cat] || 0) >= porCat) continue;
  contador[cat] = (contador[cat] || 0) + 1; elegidas.push([id, a, cat]);
  if (elegidas.length >= max) break;
}
console.log('Ya hay', tengo.size, '· candidatas', cand.length, '· se añadirán', elegidas.length, contador);
if (dry) process.exit(0);

await supabase.storage.from(BUCKET).upload('biblioteca3d/indice.copia-' + new Date().toISOString().slice(0, 10) + '.json', Buffer.from(JSON.stringify(ind)), { contentType: 'application/json', upsert: true, cacheControl: '0' });

const nuevas = [];
const guardarIndice = async () => {
  const out = { ...ind, texturas: [...ind.texturas, ...nuevas], generado: new Date().toISOString() };
  const { error } = await supabase.storage.from(BUCKET).upload(RUTA, Buffer.from(JSON.stringify(out)), { contentType: 'application/json', upsert: true, cacheControl: '0' });
  if (error) throw error;
};
let i = 0, fallos = 0;
async function trabajo() {
  while (i < elegidas.length) {
    const [id, a, cat] = elegidas[i++];
    try {
      const f = await json('https://api.polyhaven.com/files/' + id);
      const url = f?.Diffuse?.['1k']?.jpg?.url || f?.Color?.['1k']?.jpg?.url;
      if (!url) throw new Error('sin difusa 1k');
      const r = await fetch(url); if (!r.ok) throw new Error('descarga ' + r.status);
      const buf = await sharp(Buffer.from(await r.arrayBuffer())).resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
      const ruta = 'biblioteca3d/texturas/' + id + '.jpg';
      const { error } = await supabase.storage.from(BUCKET).upload(ruta, buf, { contentType: 'image/jpeg', upsert: true });
      if (error) throw error;
      const tam = Math.max(20, Math.min(400, Math.round((a.dimensions?.[0] || 1000) / 10)));
      nuevas.push({ id, nombre: a.name, categoria: cat, url: supabase.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl, tam });
      if (nuevas.length % 25 === 0) { await guardarIndice(); console.log('guardadas', nuevas.length); }
    } catch (e) { fallos++; console.log('FALLO', id, e.message); }
  }
}
await Promise.all([trabajo(), trabajo(), trabajo(), trabajo()]);
await guardarIndice();
console.log('Listo: añadidas', nuevas.length, 'texturas. Fallos:', fallos);
