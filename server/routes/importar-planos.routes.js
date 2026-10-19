import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';
import { cantidadesDePlano } from '../utils/planos.js';

// Volcar lo medido en los planos (equipos, luminarias y materiales de suelos, techos y paredes)
// a los Listados del proyecto, que es lo que ve el cliente en su historia. Lo que se vuelca
// es un punto de partida: después se edita como cualquier otro elemento del listado, y volver
// a traer desde los planos no pisa lo que se haya cambiado a mano (solo añade lo que falta).
const router = express.Router();
router.use(authenticateToken, requirePermission('proyectos'));

const fail = (res, e, msg) => { console.error(msg, e); res.status(500).json({ error: msg }); };
const UUID = /^[0-9a-f-]{36}$/i;
const norm = (s) => String(s || '').trim().toLowerCase();
const r1 = (n) => Math.round(Number(n) * 10) / 10;

// Todo lo que el plano propone, con su estado frente al listado actual del proyecto
async function propuesta(projectId, planoId) {
  const base = await cantidadesDePlano(projectId, planoId);
  if (!base.plano) return { planos: base.planos, plano: null, filas: [] };
  const r = base.resumen || {};

  const [{ data: equipos }, { data: materiales }] = await Promise.all([
    supabase.from('project_equipment_selections').select('id, name, quantity, catalog_product_id').eq('project_id', projectId),
    supabase.from('project_material_selections').select('id, name, quantity, catalog_product_id, location').eq('project_id', projectId),
  ]);

  // productos del catálogo de los materiales (suelos, techos y paredes) para heredar foto, marca y enlace
  const idsMat = [...new Set([...(r.suelos || []), ...(r.techos || []), ...(r.paredes || [])].map(m => m.id).filter(id => UUID.test(id || '')))];
  const prodMat = {};
  if (idsMat.length) {
    const { data } = await supabase.from('catalog_products').select('*, category:catalog_categories!catalog_products_category_id_fkey(id, name, type)').in('id', idsMat);
    (data || []).forEach(p => { prodMat[p.id] = p; });
  }

  const filas = [];
  const estadoEquipo = (p, nombre, cant) => {
    const ex = (equipos || []).find(e => (p && e.catalog_product_id === p.id) || norm(e.name) === norm(nombre));
    if (!ex) return { estado: 'nuevo' };
    return Math.abs((Number(ex.quantity) || 0) - cant) < 0.01 ? { estado: 'ya', existente_id: ex.id } : { estado: 'distinta', existente_id: ex.id, cantidad_listado: ex.quantity };
  };
  base.filas.filter(f => f.grupo === 'Equipamiento' || f.grupo === 'Iluminación').forEach(f => {
    const p = f.producto || null;
    const cant = Math.max(1, Math.ceil(Number(f.cantidad) || 1));
    filas.push({
      clave: `eq:${p ? p.id : norm(f.nombre)}`, tipo: 'equipo', grupo: f.grupo,
      nombre: p ? p.name : f.nombre, marca: p?.brand || '', imagen: p?.photo_url || '',
      cantidad: cant, unidad: f.unidad === 'ml' ? 'ml' : 'ud', catalogo: !!p, producto_id: p?.id || null,
      categoria: p?.category?.name || '', category_type: p?.category?.type || (f.grupo === 'Iluminación' ? 'iluminacion' : 'mobiliario'),
      ...estadoEquipo(p, p ? p.name : f.nombre, cant),
    });
  });
  const mat = (lista, zona) => (lista || []).forEach(m => {
    const p = prodMat[m.id] || null, cant = r1(m.m2);
    if (!(cant > 0)) return;
    const ex = (materiales || []).find(e => (p && e.catalog_product_id === p.id && norm(e.location) === norm(zona)) || (norm(e.name) === norm(m.nombre) && norm(e.location) === norm(zona)));
    filas.push({
      clave: `mat:${zona}:${p ? p.id : norm(m.nombre)}`, tipo: 'material', grupo: zona,
      nombre: p ? p.name : m.nombre, marca: p?.brand || '', imagen: p?.photo_url || '',
      cantidad: cant, unidad: 'm²', catalogo: !!p, producto_id: p?.id || null,
      categoria: p?.category?.name || zona, category_type: 'material', zona,
      ...(!ex ? { estado: 'nuevo' } : Math.abs((Number(ex.quantity) || 0) - cant) < 0.05 ? { estado: 'ya', existente_id: ex.id } : { estado: 'distinta', existente_id: ex.id, cantidad_listado: ex.quantity }),
    });
  });
  mat(r.suelos, 'Suelo'); mat(r.techos, 'Techo'); mat(r.paredes, 'Paredes');
  return { planos: base.planos, plano: base.plano, filas };
}

router.get('/:projectId', async (req, res) => {
  try {
    res.json(await propuesta(req.params.projectId, req.query.plano || null));
  } catch (e) { fail(res, e, 'No se pudo leer lo medido en los planos'); }
});

router.post('/:projectId', async (req, res) => {
  try {
    const claves = new Set(Array.isArray(req.body?.claves) ? req.body.claves.map(String) : []);
    if (!claves.size) return res.status(400).json({ error: 'No hay nada elegido' });
    const p = await propuesta(req.params.projectId, req.body?.plano_id || null);
    let anadidos = 0, actualizados = 0;
    for (const f of p.filas.filter(x => claves.has(x.clave))) {
      if (f.estado === 'ya') continue;
      if (f.estado === 'distinta') {
        // solo se cambia la cantidad; el resto de lo que hayas editado se respeta
        const tabla = f.tipo === 'material' ? 'project_material_selections' : 'project_equipment_selections';
        const { error } = await supabase.from(tabla).update({ quantity: f.tipo === 'material' ? f.cantidad : Math.round(f.cantidad) }).eq('id', f.existente_id).eq('project_id', req.params.projectId);
        if (error) throw error;
        actualizados++;
        continue;
      }
      if (f.tipo === 'material') {
        const { error } = await supabase.from('project_material_selections').insert({
          project_id: req.params.projectId, name: f.nombre, brand: f.marca || null, category: f.categoria || null, category_type: 'material',
          location: f.zona || null, notes: `Superficie medida en los planos: ${String(f.cantidad).replace('.', ',')} m²`,
          image_url: f.imagen || null, catalog_product_id: f.producto_id || null, quantity: f.cantidad,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.from('project_equipment_selections').insert({
          project_id: req.params.projectId, name: f.nombre, brand: f.marca || null, category: f.categoria || null, category_type: f.category_type || 'mobiliario',
          quantity: Math.round(f.cantidad), notes: f.unidad === 'ml' ? `${f.cantidad} ml medidos en los planos` : null,
          image_url: f.imagen || null, catalog_product_id: f.producto_id || null, show_quantity: true, show_purchase_link: false,
        });
        if (error) throw error;
      }
      anadidos++;
    }
    res.json({ anadidos, actualizados });
  } catch (e) { fail(res, e, 'No se pudo volcar al listado'); }
});

export default router;
