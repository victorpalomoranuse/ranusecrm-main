import { supabase } from '../config/supabase.js';

// Cantidades medidas en los planos de un proyecto, listas para convertirse en
// partidas de presupuesto. Las usan el botón "Desde planos" y el Asistente IA.
// Equipos y luminarias que existen en el catálogo salen como producto del
// catálogo (con su precio); el resto de lo medido sale como partida libre.

const TIPOS_FOCO = { spot: 'Spot (cilindro)', spotmini: 'Spot magnético mini', proyector: 'Proyector orientable', lineal: 'Foco lineal', colgante: 'Luminaria colgante' };
const areaM2 = (pts) => Math.abs((pts || []).reduce((s, p, i, a) => s + p[0] * a[(i + 1) % a.length][1] - a[(i + 1) % a.length][0] * p[1], 0) / 2) / 1e4;
const largoCm = (pts, cerrado) => (pts || []).reduce((s, p, i, a) => (i < a.length - 1 || cerrado ? s + Math.hypot(a[(i + 1) % a.length][0] - p[0], a[(i + 1) % a.length][1] - p[1]) : s), 0);

// Devuelve { filas, porCid, porProd } de la escena 3D: muebles a medida (con despiece), carriles y focos, molduras, zonas pintadas,
// falsos techos, logos, objetos colocados y superficies acabadas (por material). porCid / porProd se resuelven luego contra el catálogo.
export function filasEscena3d(esc, m3) {
  const filas = [], porCid = {}, porProd = {};
  if (!esc) return { filas, porCid, porProd };
  const libre = (grupo, nombre, unidad, cantidad, extra = {}) => { if (cantidad > 0) filas.push({ grupo, tipo: 'libre', nombre, categoria: 'reformas', unidad, cantidad: Math.round(cantidad * 100) / 100, ...extra }); };
  const texturas = esc.texturas || [], objs = esc.objetos || [], ac = esc.acabados || {};
  const nombreAc = v => { if (!v) return null; if (String(v).startsWith('tex:')) { const t = texturas.find(x => 'tex:' + x.id === v); return t ? t.nombre : 'Textura'; } return 'Color ' + v; };
  const prodDe = v => { const t = String(v || '').startsWith('tex:') ? texturas.find(x => 'tex:' + x.id === v) : null; return t?.prod || null; };

  // muebles a medida: una fila por mueble y el despiece sumado
  let tablero = 0;
  objs.filter(o => o.tipo === 'mueble' && o.mueble).forEach(o => {
    const M = o.mueble, e = M.esp || 1.8, hc = o.alto - (M.zocalo ?? 10), D = o.d, piezas = {};
    const suma = (n, a, b, c = 1) => { const k = n + ' ' + Math.round(a * 10) / 10 + ' × ' + Math.round(b * 10) / 10 + ' cm'; piezas[k] = (piezas[k] || 0) + c; };
    let area = 0;
    (M.modulos || []).forEach(m => {
      const wi = m.w - 2 * e; suma('Lateral', hc, D, 2); suma('Base y tapa', wi, D, 2); suma('Trasera', wi, hc - 2 * e); area += (2 * hc * D + 2 * wi * D + wi * (hc - 2 * e)) / 1e4;
      const nb = m.t === 'abierto' ? (m.nb ?? 3) : m.t === 'puertas' ? (m.nb ?? 1) : 0; if (nb) { suma('Balda', wi, D - 2, nb); area += nb * wi * (D - 2) / 1e4; }
      if (m.t === 'puertas') { const nd = m.n === 2 ? 2 : 1; suma('Puerta', m.w / nd - 0.3, hc - 0.4, nd); area += nd * (m.w / nd - 0.3) * (hc - 0.4) / 1e4; }
      if (m.t === 'cajones') { const nc = Math.max(1, m.n || 3); suma('Frente de cajón', m.w - 0.4, hc / nc - 0.3, nc); area += nc * (m.w - 0.4) * (hc / nc - 0.3) / 1e4; }
    });
    tablero += area;
    {
      let frentes = 0, ancho = 0;
      (M.modulos || []).forEach(m => { if (m.t === 'puertas') { const nd = m.n === 2 ? 2 : 1; frentes += nd; ancho += m.w; } if (m.t === 'cajones') { const nc = Math.max(1, m.n || 3); frentes += nc; ancho += m.w * nc; } });
      const T = M.tirador || 'barra', NOM = { barra: 'Tirador de barra', asa: 'Tirador de asa', pomo: 'Pomo', pomoplano: 'Pomo plano' };
      if (NOM[T]) piezas[NOM[T] + ' (herraje)'] = frentes;
      else if (T === 'gola') piezas['Perfil de gola (ml)'] = Math.round(ancho) / 100;
      else if (T === 'unero') piezas['Fresado de uñero (frentes)'] = frentes;
      else if (T === 'push') piezas['Mecanismo push open (frentes)'] = frentes;
    }
    libre('Muebles a medida', (o.nombre || 'Mueble') + ' (' + Math.round(o.w) + ' × ' + Math.round(o.d) + ' × ' + Math.round(o.alto) + ' cm, ' + (M.modulos || []).length + ' módulos)', 'ud', 1, { detalle: Object.entries(piezas).map(([k, n]) => n + ' × ' + k).join('; '), acabado: [nombreAc(o.color), nombreAc(o.colorFrente)].filter(Boolean).join(' / ') });
  });
  libre('Muebles a medida', 'Tablero de muebles a medida (según despiece)', 'm²', tablero);

  // iluminación con carriles
  objs.filter(o => o.tipo === 'carril').forEach(o => {
    libre('Iluminación 3D', 'Carril ' + (o.sistema === 'trifasico' ? 'trifásico' : 'magnético') + (o.nombre ? ' · ' + o.nombre : ''), 'ml', largoCm(o.pts) / 100);
    const n = {}; (o.focos || []).forEach(f => { n[f.t] = (n[f.t] || 0) + 1; });
    Object.entries(n).forEach(([t, c]) => libre('Iluminación 3D', (TIPOS_FOCO[t] || t) + ' para carril', 'ud', c));
  });
  objs.filter(o => o.tipo === 'led' && o.led).forEach(o => { const ml = largoCm(o.pts, o.led.cerrado) / 100; libre('Iluminación 3D', 'Tira LED ' + o.led.k + ' K, ' + o.led.lm + ' lm/m' + (o.nombre ? ' · ' + o.nombre : ''), 'ml', ml); libre('Iluminación 3D', 'Fuente de alimentación para tira LED (1 cada 5 m)', 'ud', Math.ceil(ml / 5)); });
  // molduras y rodapié
  objs.filter(o => o.tipo === 'barrido').forEach(o => libre('Molduras 3D', 'Moldura: ' + (o.perfilNombre || 'perfil') + (o.esc && o.esc !== 1 ? ' (escala ' + o.esc + ')' : ''), 'ml', largoCm(o.pts, o.cerrado) / 100));
  const pl0 = m3 ? (m3.plantas || [m3])[0] : null;
  if (esc.rodapie?.on && pl0) {
    const perim = (pl0.salas || []).reduce((s, sa) => s + largoCm(sa.pts, true), 0);
    const puertas = (pl0.muros || []).reduce((s, mu) => s + (mu.ab || []).filter(a => (a.tipo || a.t) === 'door').reduce((q, a) => q + (a.w || 0), 0), 0);
    libre('Molduras 3D', 'Rodapié de ' + esc.rodapie.alto + ' cm (perímetro de salas, descontadas puertas)', 'ml', Math.max(0, perim - puertas) / 100);
  }
  // zonas, falsos techos, logos
  objs.filter(o => o.tipo === 'zona').forEach(o => libre('Acabados 3D', 'Zona pintada (' + o.plano + '): ' + (nombreAc(o.color) || 'sin material'), 'm²', areaM2(o.pts)));
  objs.filter(o => o.tipo === 'falsotecho').forEach(o => {
    libre('Techos 3D', 'Falso techo con foseado (descenso ' + (o.ft?.descenso ?? 15) + ' cm)', 'm²', areaM2(o.pts));
    libre('Techos 3D', 'Foseado perimetral con luz LED', 'ml', largoCm(o.pts, true) / 100);
  });
  objs.filter(o => o.tipo === 'logo').forEach(o => libre('Rotulación 3D', 'Logo ' + (o.nombre || '') + ' ' + Math.round(o.w) + ' × ' + Math.round(o.alto) + ' cm, grosor ' + o.d + ' cm', 'ud', 1));
  // objetos colocados
  const cont = {};
  objs.filter(o => ['bloque', 'caja', 'prisma'].includes(o.tipo)).forEach(o => {
    if (o.cid) { (porCid[o.cid] ||= { nombre: o.nombre, n: 0 }).n++; return; }
    const g = o.mod ? 'Mobiliario (biblioteca 3D)' : 'Volúmenes 3D', k = g + '|' + (o.nombre || o.tipo) + '|' + Math.round(o.w) + 'x' + Math.round(o.d) + 'x' + Math.round(o.alto);
    (cont[k] ||= { g, nombre: (o.nombre || o.tipo) + ' ' + Math.round(o.w) + ' × ' + Math.round(o.d) + ' × ' + Math.round(o.alto) + ' cm', n: 0 }).n++;
  });
  Object.values(cont).forEach(c => libre(c.g, c.nombre, 'ud', c.n));
  // superficies acabadas por material (muros, suelos y techos de la planta 1)
  if (pl0) {
    const m2 = {}; const suma = (v, a) => { if (v && a > 0) m2[v] = (m2[v] || 0) + a; };
    (pl0.muros || []).forEach(mu => {
      const L = Math.hypot(mu.b[0] - mu.a[0], mu.b[1] - mu.a[1]) / 100, h = (mu.h || pl0.altura || 260) / 100, huecos = (mu.ab || []).reduce((s, a) => s + (a.w || 0) * (a.h || 0), 0) / 1e4;
      suma(ac.muros?.[mu.id] || ac.todosMuros, L * h - huecos);
    });
    (pl0.salas || []).forEach((s, i) => { suma(ac.salas?.[s.idS || 's' + i] || ac.todosSuelos, areaM2(s.pts)); suma(ac.techos?.[s.idT || 's' + i] || ac.todosTechos, areaM2(s.pts)); });
    Object.entries(m2).forEach(([v, a]) => { const p = prodDe(v); if (p) (porProd[p] ||= { nombre: nombreAc(v), m2: 0 }).m2 += a; else libre('Acabados 3D', 'Acabado: ' + nombreAc(v), 'm²', a); });
  }
  return { filas, porCid, porProd };
}

export async function cantidadesDePlano(projectId, planoId) {
  const { data: planos, error } = await supabase.from('mediciones').select('id, nombre, resumen, updated_at, escena:data->escena3d, m3:data->modelo3d').eq('project_id', projectId).order('updated_at', { ascending: false });
  if (error) throw error;
  const lista = (planos || []).map(p => ({ id: p.id, nombre: p.nombre || 'Sin nombre', actualizado: p.updated_at }));
  const plano = (planos || []).find(p => p.id === planoId) || (planos || [])[0];
  if (!plano || !plano.resumen) return { planos: lista, plano: null, filas: [], resumen: null };
  const r = plano.resumen;

  const e3 = filasEscena3d(plano.escena, plano.m3);
  const ids = [...(r.equipos || []).map(e => e.cid), ...(r.luminarias || []).map(l => l.lid), ...Object.keys(e3.porCid), ...Object.keys(e3.porProd)].filter(x => /^[0-9a-f-]{36}$/i.test(x || ''));
  const productos = {};
  if (ids.length) {
    const { data } = await supabase.from('catalog_products').select('*, category:catalog_categories!catalog_products_category_id_fkey(id, name, type)').in('id', ids);
    (data || []).forEach(p => { productos[p.id] = p; });
  }

  const filas = [];
  const cat = (grupo, id, nombre, n, ml, ex) => {
    const p = productos[id];
    if (p) {
      const porMetro = /^(ml|m)$/i.test(p.pricing_unit || '');
      const cantidad = porMetro && ml > 0 ? Math.ceil(ml * 10) / 10 : n;
      filas.push({ grupo, tipo: 'catalogo', producto: p, nombre: p.name, unidad: p.pricing_unit || 'ud', cantidad });
    } else {
      filas.push({ grupo, tipo: 'libre', nombre, categoria: 'mobiliario', unidad: ml > 0 ? 'ml' : 'ud', cantidad: ml > 0 ? Math.ceil(ml * 10) / 10 : n, aviso: 'Sin producto en el catálogo', medidas: ex && ex.w > 0 && ex.d > 0 ? `${Math.round(ex.w * 10) / 10} × ${Math.round(ex.d * 10) / 10}${ex.alto > 0 ? ' × ' + Math.round(ex.alto * 10) / 10 : ''} cm` : null, familia: ex?.categoria || '' });
    }
  };
  (r.equipos || []).forEach(e => cat('Equipamiento', e.cid, e.nombre, e.n, 0, e));
  (r.luminarias || []).forEach(l => cat('Iluminación', l.lid, l.nombre, l.n, l.ml));

  Object.entries(e3.porCid).forEach(([id, c]) => cat('Mobiliario 3D', id, c.nombre, c.n, 0));
  Object.entries(e3.porProd).forEach(([id, c]) => cat('Acabados 3D', id, c.nombre, Math.ceil(c.m2 * 10) / 10, 0));
  filas.push(...e3.filas);
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
    if (c.forma !== 'plano') libre('Reforma', `${c.forma === 'dos' ? 'Cubierta a dos aguas' : c.forma === 'boveda' ? 'Cubierta curva (bóveda)' : 'Cubierta a un agua'}${sala}`, 'm²', c.cubierta_m2);
    if (c.vigas) libre('Reforma', `Vigas ${c.vigas.w}×${c.vigas.h} cm cada ${c.vigas.s} cm${sala} (${c.vigas.n} piezas)`, 'ml', c.vigas.ml);
    if (c.correas) libre('Reforma', `Correas cada ${c.correas.s} cm${sala} (${c.correas.n} piezas)`, 'ml', c.correas.ml);
    if (c.tragaluces) libre('Reforma', `Tragaluces${sala}`, 'ud', c.tragaluces.n);
  });
  libre('Reforma', 'Retirada de instalaciones existentes (reparar hueco)', 'ud', r.instalaciones_retirar);

  return { planos: lista, plano: { id: plano.id, nombre: plano.nombre || 'Sin nombre' }, filas, resumen: r };
}
