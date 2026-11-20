// Amplía la biblioteca 3D con los modelos de mobiliario, decoración, iluminación y electrónica de Poly Haven (licencia CC0) que aún no están.
// Descarga cada modelo (glTF 1k + texturas), lo sube a biblioteca3d/modelos/<id>/ y lo añade al índice (con copia de seguridad previa).
// Uso (desde /server):  node scripts/ampliar-polyhaven-modelos.mjs --dry   → solo cuenta lo que añadiría y lo que pesa
//                       node scripts/ampliar-polyhaven-modelos.mjs         → sube y actualiza el índice
import 'dotenv/config';
import { supabase } from '../config/supabase.js';

const BUCKET = 'project-documents', RUTA = 'biblioteca3d/indice.json', dry = process.argv.includes('--dry');
const MAX_MB = 12; // los modelos más pesados se saltan
// categoría de Poly Haven → categoría de la biblioteca
const CATS = [
  ['seating', 'Asientos'], ['table', 'Mesas'], ['shelves', 'Estanterías y armarios'], ['lighting', 'Iluminación'], ['electronics', 'Electrónica'], ['appliances', 'Electrodomésticos'],
  ['office', 'Oficina'], ['decorative', 'Decoración'], ['plants', 'Plantas'], ['furniture', 'Mobiliario'],
];
const EXCLUIR = /barrel|cheese|coffeecart|cigarette|bleach|cleaner|compost|alarm_clock|can_rusted|cardboard|lantern|dartboard|goblet|bull_head|statue|chess|flood|fire_alarm|bottle|brass_pan|brass_pot|skull|cannon|crate|sack|rope|anvil|bucket|pallet/i;

// solo los de aspecto actual / industrial / neutro (el resto de Poly Haven es rústico, antiguo o de museo)
const INCLUIR = /^(modern_|industrial_|hanging_industrial|steel_frame|bar_chair|dining_chair_02|ceiling_fan|gaming_console|electric_stove|hanging_picture_frame|standing_picture_frame|side_table_tall|small_wooden_table|round_wooden_table|wooden_table_02|drawer_cabinet|Shelf_01|SchoolDesk|outdoor_table_chair|celandine|dandelion|periwinkle|ceramic_vase|jug_01|book_encyclopedia|Camera_01|WetFloor|folding_wooden_stool|wooden_stool_02)/i;
const info = await (await fetch('https://api.polyhaven.com/assets?t=models')).json();
const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(RUTA);
const ind = await (await fetch(pub.publicUrl + '?t=' + Date.now())).json();
const tengo = new Set((ind.modelos || []).map(m => m.id));
const cand = Object.entries(info).filter(([id, m]) => !tengo.has(id) && !EXCLUIR.test(id) && INCLUIR.test(id) && !(m.categories || []).some(c => c.startsWith('collection')) && CATS.some(([c]) => (m.categories || []).includes(c)));
console.log('candidatos:', cand.length);

const pool = async (lista, n, f) => { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < lista.length) { const k = i++; out[k] = await f(lista[k], k); } })); return out; };
const nuevos = []; let bytes = 0;
await pool(cand, 4, async ([id, m]) => {
  try {
    const f = await (await fetch('https://api.polyhaven.com/files/' + id)).json(), g = f.gltf?.['1k']?.gltf; if (!g) return;
    const inc = Object.entries(g.include || {}), total = g.size + inc.reduce((s, [, v]) => s + (v.size || 0), 0);
    if (total > MAX_MB * 1048576) { console.log('  salta (pesa', Math.round(total / 1048576), 'MB):', id); return; }
    const cat = (CATS.find(([c]) => (m.categories || []).includes(c)) || [])[1] || 'Mobiliario', dim = m.dimensions || [];
    const cm = v => Math.max(1, Math.round((v || 0) / 10));
    if (!dry) {
      const sube = async (rel, url, tipo) => { const r = await fetch(url); if (!r.ok) throw new Error('descarga ' + rel); const buf = Buffer.from(await r.arrayBuffer()); const { error } = await supabase.storage.from(BUCKET).upload('biblioteca3d/modelos/' + id + '/' + rel, buf, { contentType: tipo, upsert: true, cacheControl: '31536000' }); if (error) throw error; };
      await sube(id + '_1k.gltf', g.url, 'model/gltf+json');
      for (const [rel, v] of inc) await sube(rel, v.url, /\.bin$/.test(rel) ? 'application/octet-stream' : /\.png$/.test(rel) ? 'image/png' : 'image/jpeg');
    }
    bytes += total;
    const url = supabase.storage.from(BUCKET).getPublicUrl('biblioteca3d/modelos/' + id + '/' + id + '_1k.gltf').data.publicUrl;
    nuevos.push({ id, nombre: m.name, categoria: cat, url, w: cm(dim[0]), d: cm(dim[1]), alto: cm(dim[2]), licencia: 'CC0', autor: Object.keys(m.authors || {}).join(', ') });
    console.log('  ok', id, cat, Math.round(total / 1024), 'KB');
  } catch (e) { console.log('  error', id, String(e.message || e).slice(0, 80)); }
});
console.log('nuevos:', nuevos.length, '· peso total aprox.', Math.round(bytes / 1048576), 'MB');
if (dry || !nuevos.length) process.exit(0);
await supabase.storage.from(BUCKET).upload('biblioteca3d/indice.copia-' + Date.now() + '.json', Buffer.from(JSON.stringify(ind)), { contentType: 'application/json' });
ind.modelos = [...(ind.modelos || []), ...nuevos]; ind.generado = new Date().toISOString();
const { error } = await supabase.storage.from(BUCKET).upload(RUTA, Buffer.from(JSON.stringify(ind)), { contentType: 'application/json', upsert: true, cacheControl: '0' });
if (error) throw error;
console.log('índice actualizado:', ind.modelos.length, 'modelos');
process.exit(0);
