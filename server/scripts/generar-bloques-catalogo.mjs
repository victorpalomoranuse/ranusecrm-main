// Genera los bloques (planta, alzado, lateral) de los productos del catálogo que aún no tienen.
// Uso (desde /server):  node scripts/generar-bloques-catalogo.mjs --dry      → solo cuenta
//                       node scripts/generar-bloques-catalogo.mjs [--max=N]  → genera y guarda
// Usa la misma generación que el editor de bloques (modelo 3D de la foto; si falla, ensamblaje de piezas con IA).
import 'dotenv/config';
import sharp from 'sharp';
import { supabase } from '../config/supabase.js';
import { generarBloques } from '../utils/bloques-ia.js';
import { generarBloques3D } from '../utils/bloques-3d.js';

const dry = process.argv.includes('--dry');
const max = Number((process.argv.find(a => a.startsWith('--max=')) || '').split('=')[1]) || Infinity;
const { data: cats } = await supabase.from('catalog_categories').select('id, name, type');
const mob = new Map((cats || []).filter(c => c.type === 'mobiliario').map(c => [c.id, c.name]));
const { data: prods, error } = await supabase.from('catalog_products').select('id, name, category_id, photo_url, longitud, ancho, altura, bloques');
if (error) throw error;
const todos = (prods || []).filter(p => mob.has(p.category_id));
const sinBloque = todos.filter(p => !p.bloques?.svg?.planta);
const listos = sinBloque.filter(p => p.photo_url && p.longitud > 0 && p.ancho > 0 && p.altura > 0);
console.log(`Productos de mobiliario: ${todos.length} · con bloque: ${todos.length - sinBloque.length} · sin bloque: ${sinBloque.length} · generables (foto y largo/ancho/alto): ${listos.length}`);
const faltan = sinBloque.filter(p => !listos.includes(p));
if (faltan.length) console.log('No generables (falta foto o medidas):', faltan.map(p => `${p.name} [${[!p.photo_url && 'foto', !(p.longitud > 0) && 'largo', !(p.ancho > 0) && 'ancho', !(p.altura > 0) && 'alto'].filter(Boolean).join(',')}]`).join(' | '));
if (dry) process.exit(0);

let ok = 0, mal = 0;
for (const p of listos.slice(0, max)) {
  try {
    const r = await fetch(p.photo_url);
    if (!r.ok) throw new Error('foto ilegible');
    const imagen = Buffer.from(await r.arrayBuffer());
    const dims = { largo: Number(p.longitud), fondo: Number(p.ancho), alto: Number(p.altura) };
    let b;
    try { b = await generarBloques3D({ imagen, ...dims }); }
    catch (e) { b = await generarBloques({ imagen, ...dims, nombre: p.name }); b.metodo = 'piezas'; }
    if (!b?.svg?.planta) throw new Error('sin planta');
    const bloques = { largo: dims.largo, fondo: dims.fondo, alto: dims.alto, shapes: b.shapes || null, svg: { planta: b.svg.planta || '', alzado: b.svg.alzado || '', lateral: b.svg.lateral || '' }, actualizado: new Date().toISOString(), automatico: true, metodo: b.metodo || null };
    const { error: e2 } = await supabase.from('catalog_products').update({ bloques }).eq('id', p.id);
    if (e2) throw e2;
    ok++; console.log(`OK   ${p.name} (${b.metodo || '?'})`);
  } catch (e) { mal++; console.log(`FALLA ${p.name}: ${String(e.message).slice(0, 120)}`); }
}
console.log(`Hecho: ${ok} generados, ${mal} con error.`);
