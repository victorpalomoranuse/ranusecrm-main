import { supabase } from '../config/supabase.js';

// Cantidades medidas en los planos de un proyecto, listas para convertirse en
// partidas de presupuesto. Las usan el botón "Desde planos" y el Asistente IA.
// Equipos y luminarias que existen en el catálogo salen como producto del
// catálogo (con su precio); el resto de lo medido sale como partida libre.

export async function cantidadesDePlano(projectId, planoId) {
  const { data: planos, error } = await supabase.from('mediciones').select('id, nombre, resumen, updated_at').eq('project_id', projectId).order('updated_at', { ascending: false });
  if (error) throw error;
  const lista = (planos || []).map(p => ({ id: p.id, nombre: p.nombre || 'Sin nombre', actualizado: p.updated_at }));
  const plano = (planos || []).find(p => p.id === planoId) || (planos || [])[0];
  if (!plano || !plano.resumen) return { planos: lista, plano: null, filas: [], resumen: null };
  const r = plano.resumen;

  const ids = [...(r.equipos || []).map(e => e.cid), ...(r.luminarias || []).map(l => l.lid)].filter(x => /^[0-9a-f-]{36}$/i.test(x || ''));
  const productos = {};
  if (ids.length) {
    const { data } = await supabase.from('catalog_products').select('*, category:catalog_categories!catalog_products_category_id_fkey(id, name, type)').in('id', ids);
    (data || []).forEach(p => { productos[p.id] = p; });
  }

  const filas = [];
  const cat = (grupo, id, nombre, n, ml) => {
    const p = productos[id];
    if (p) {
      const porMetro = /^(ml|m)$/i.test(p.pricing_unit || '');
      const cantidad = porMetro && ml > 0 ? Math.ceil(ml * 10) / 10 : n;
      filas.push({ grupo, tipo: 'catalogo', producto: p, nombre: p.name, unidad: p.pricing_unit || 'ud', cantidad });
    } else {
      filas.push({ grupo, tipo: 'libre', nombre, categoria: 'mobiliario', unidad: ml > 0 ? 'ml' : 'ud', cantidad: ml > 0 ? Math.ceil(ml * 10) / 10 : n, aviso: 'Sin producto en el catálogo' });
    }
  };
  (r.equipos || []).forEach(e => cat('Equipamiento', e.cid, e.nombre, e.n, 0));
  (r.luminarias || []).forEach(l => cat('Iluminación', l.lid, l.nombre, l.n, l.ml));

  const libre = (grupo, nombre, unidad, cantidad) => { if (cantidad > 0) filas.push({ grupo, tipo: 'libre', nombre, categoria: 'reformas', unidad, cantidad }); };
  const m = r.muros || {};
  libre('Reforma', 'Demolición de tabiquería (muros a demoler)', 'm²', m.demoler_m2);
  libre('Reforma', 'Levantado de suelo existente', 'm²', r.levantar_suelo_m2);
  libre('Reforma', 'Desmontaje de techo existente', 'm²', r.desmontar_techo_m2);
  libre('Reforma', 'Construcción de muros nuevos', 'm²', m.nuevo_m2);
  (r.suelos || []).forEach(s => libre('Reforma', `Suelo: ${s.nombre}`, 'm²', s.m2));
  (r.techos || []).forEach(s => libre('Reforma', `Techo: ${s.nombre}`, 'm²', s.m2));
  (r.paredes || []).forEach(s => libre('Reforma', `Acabado de paredes: ${s.nombre}`, 'm²', s.m2));
  const porMed = {};
  (r.carpinterias || []).filter(c => c.estado === 'new').forEach(c => { const k = `${c.tipo}|${c.ancho}|${c.alto}`; (porMed[k] ||= { ...c, n: 0 }).n++; });
  Object.values(porMed).forEach(c => libre('Reforma', `${c.tipo === 'puerta' ? 'Puerta' : 'Ventana'} nueva ${c.ancho}×${c.alto} cm`, 'ud', c.n));
  (r.electricidad || []).forEach(e => libre('Reforma', `Electricidad: ${e.nombre}`, 'ud', e.n));
  (r.cubiertas || []).forEach(c => {
    const sala = c.sala ? ` (${c.sala})` : '';
    if (c.forma !== 'plano') libre('Reforma', `${c.forma === 'dos' ? 'Cubierta a dos aguas' : 'Cubierta a un agua'}${sala}`, 'm²', c.cubierta_m2);
    if (c.vigas) libre('Reforma', `Vigas ${c.vigas.w}×${c.vigas.h} cm cada ${c.vigas.s} cm${sala} (${c.vigas.n} piezas)`, 'ml', c.vigas.ml);
    if (c.correas) libre('Reforma', `Correas cada ${c.correas.s} cm${sala} (${c.correas.n} piezas)`, 'ml', c.correas.ml);
    if (c.tragaluces) libre('Reforma', `Tragaluces${sala}`, 'ud', c.tragaluces.n);
  });
  libre('Reforma', 'Retirada de instalaciones existentes (reparar hueco)', 'ud', r.instalaciones_retirar);

  return { planos: lista, plano: { id: plano.id, nombre: plano.nombre || 'Sin nombre' }, filas, resumen: r };
}
