import { supabase } from '../config/supabase.js';
import { generarBloques } from './bloques-ia.js';
import { generarBloques3D } from './bloques-3d.js';

// Genera los bloques (planta, alzado, lateral) de un producto del catálogo a partir de su foto y sus medidas
// y los guarda en catalog_products.bloques (los mismos que se ven en la herramienta de planos).
export async function generarBloqueProducto(p) {
  if (!p.photo_url) throw new Error('el producto no tiene foto');
  const dims = { largo: Number(p.longitud), fondo: Number(p.ancho), alto: Number(p.altura) };
  if (![dims.largo, dims.fondo, dims.alto].every(n => n > 0)) throw new Error('faltan sus medidas (largo, ancho y alto)');
  const r = await fetch(p.photo_url);
  if (!r.ok) throw new Error('no se pudo leer la foto');
  const imagen = Buffer.from(await r.arrayBuffer());
  let b;
  try { b = await generarBloques3D({ imagen, ...dims }); }
  catch { b = await generarBloques({ imagen, ...dims, nombre: p.name }); b.metodo = 'piezas'; }
  if (!b?.svg?.planta) throw new Error('no se pudo sacar un dibujo de la foto');
  const bloques = { largo: dims.largo, fondo: dims.fondo, alto: dims.alto, shapes: b.shapes || null, svg: { planta: b.svg.planta || '', alzado: b.svg.alzado || '', lateral: b.svg.lateral || '' }, actualizado: new Date().toISOString(), automatico: true, metodo: b.metodo || null };
  const { error } = await supabase.from('catalog_products').update({ bloques }).eq('id', p.id);
  if (error) throw error;
  return b.metodo || '3d';
}

// Cola en segundo plano (de uno en uno: el servicio de modelos 3D es lento). El estado se consulta con estadoBloques().
const estado = new Map();
let cadena = Promise.resolve();
export function encolarBloques(productos) {
  for (const p of productos) {
    estado.set(p.id, { nombre: p.name, estado: 'en cola', hora: Date.now() });
    cadena = cadena.then(async () => {
      estado.set(p.id, { nombre: p.name, estado: 'generando', hora: Date.now() });
      try { const m = await generarBloqueProducto(p); estado.set(p.id, { nombre: p.name, estado: 'listo', metodo: m, hora: Date.now() }); }
      catch (e) { estado.set(p.id, { nombre: p.name, estado: 'error', mensaje: String(e.message || e).slice(0, 160), hora: Date.now() }); }
    });
  }
}
export function estadoBloques(ids) {
  const out = [];
  for (const [id, v] of estado) if (!ids?.length || ids.includes(id)) out.push({ producto_id: id, ...v });
  return out;
}
