import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdminSuperior } from '../middleware/auth.middleware.js';
import { logoDeSitio } from '../utils/logos.js';
import { leerPlanificacion, guardarPlanificacion, repartir, hoyMadrid } from '../utils/planificacion.js';

// Oficinas virtuales: una vista general del negocio por departamentos (diseño, ventas, presupuestos, finanzas, equipo) con lo que
// está atrasado o sin planificar, y el planificador de entregables de cada proyecto (reparte fechas y crea las tareas).
const router = express.Router();
router.use(authenticateToken, requireAdminSuperior);

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const sumarDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv'); };

router.get('/', async (req, res) => {
  try {
    const hoy = hoyMadrid();
    const [pr, ta, em, le, sl, bu, ve, pl, co, ccat, cprod] = await Promise.all([
      supabase.from('client_projects').select('id, client_name, project_name, phase, urgency, responsible_id, lead_id, venta_id, tipo_proyecto').eq('status', 'en_marcha').eq('active', true),
      supabase.from('tasks').select('id, title, done, due_date, project_id, assigned_to, priority').limit(5000),
      supabase.from('employees').select('id, name, is_admin_profile, employee_roles(name)').eq('active', true),
      supabase.from('setting_leads').select('id, nombre, estado, created_at').order('created_at', { ascending: false }).limit(5000),
      supabase.from('call_slots').select('id, hora_inicio, setting_lead_id').eq('fecha', hoy).eq('ocupado', true),
      supabase.from('budgets').select('status, project_id, budget_name, created_at').order('created_at', { ascending: false }).limit(5000),
      supabase.from('ventas').select('nombre, valor, cerrada, client_project_id').limit(5000),
      leerPlanificacion(),
      supabase.from('contacts').select('id, name, sector, company_url').order('name'),
      supabase.from('catalog_categories').select('id, name, type, display_order').order('display_order', { ascending: true, nullsFirst: false }),
      supabase.from('catalog_products').select('id, name, category_id, brand').limit(3000),
    ]);
    const tareas = ta.data || [], pend = tareas.filter(t => !t.done);
    const atrasada = t => !!t.due_date && t.due_date < hoy;

    const pendDe = (id) => pend.filter(t => t.project_id === id).sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')));
    const proyectos = (pr.data || []).map(p => {
      const mias = tareas.filter(t => t.project_id === p.id), pe = mias.filter(t => !t.done);
      const plan = pl.proyectos[p.id] || null, entrega = plan?.entrega || null;
      const atras = pe.filter(atrasada).length, hoyN = pe.filter(t => t.due_date === hoy).length, sinFecha = pe.filter(t => !t.due_date).length;
      const prox = pe.map(t => t.due_date).filter(d => d && d >= hoy).sort()[0] || null;
      let semaforo = 'verde', motivo = 'Al día';
      if (atras > 0) { semaforo = 'rojo'; motivo = atras + (atras === 1 ? ' tarea atrasada' : ' tareas atrasadas'); }
      else if (entrega && entrega < hoy && pe.length) { semaforo = 'rojo'; motivo = 'Entrega pasada con tareas pendientes'; }
      else if (plan && plan.cabe === false) { semaforo = 'rojo'; motivo = 'El plazo no da para todo (faltan ' + (plan.faltanHoras || '?') + ' h)'; }
      else if (entrega && entrega <= sumarDias(hoy, 3) && pe.length) { semaforo = 'ambar'; motivo = 'Entrega en pocos días'; }
      else if (!entrega) { semaforo = 'gris'; motivo = 'Sin fecha de entrega ni plan'; }
      else if (sinFecha > 0) { semaforo = 'ambar'; motivo = sinFecha + (sinFecha === 1 ? ' tarea sin fecha' : ' tareas sin fecha'); }
      // departamentos que intervienen: diseño siempre; ventas si viene de un lead; presupuestos si tiene presupuesto; finanzas si tiene una venta
      const deps = ['diseno'];
      if (p.lead_id || p.venta_id) deps.push('ventas');
      if ((bu.data || []).some(b => b.project_id === p.id)) deps.push('presupuestos');
      if (p.venta_id || (ve.data || []).some(v => v.client_project_id === p.id)) deps.push('finanzas');
      return { id: p.id, tipo: p.tipo_proyecto || null, deps, cliente: p.client_name, nombre: p.project_name, fase: p.phase, urgencia: p.urgency, entrega, semaforo, motivo, tareas: { total: mias.length, hechas: mias.length - pe.length, atrasadas: atras, hoy: hoyN, sinFecha, proxima: prox }, planificado: !!plan?.items?.length, lista: pendDe(p.id).slice(0, 8).map(t => ({ titulo: t.title, fecha: t.due_date || null, atrasada: !!t.due_date && t.due_date < hoy })), hechas: mias.length - pe.length };
    });
    const orden = { rojo: 0, ambar: 1, gris: 2, verde: 3 };
    proyectos.sort((a, b) => orden[a.semaforo] - orden[b.semaforo] || String(a.entrega || '9999').localeCompare(String(b.entrega || '9999')));
    // dónde está cada obra y cómo van sus pedidos (si aún no se han ejecutado las migraciones, simplemente no salen)
    try {
      const porPed = await pedidosPorProyecto(hoy), { data: ub, error: eub } = await supabase.from('client_projects').select('id, obra_ciudad, obra_pais').in('id', proyectos.map(p => p.id)), mu = {};
      if (!eub) (ub || []).forEach(u => { mu[u.id] = u; });
      proyectos.forEach(p => { p.ciudad = mu[p.id]?.obra_ciudad || ''; p.pais = mu[p.id]?.obra_pais || ''; const e = porPed[p.id]; p.pedidos = e ? { estados: e.estados, total: e.total } : { estados: {}, total: 0 }; });
    } catch { /* sin ubicaciones ni pedidos */ }

    // láminas que el asistente de diseño ha ido guardando en cada proyecto (solo se leen los proyectos que tienen archivo)
    const lamPor = {};
    try {
      const { data: fl } = await supabase.storage.from('project-documents').list('crm/diseno', { limit: 500 });
      const tiene = new Set((fl || []).map(f => f.name));
      await Promise.all(proyectos.filter(p => tiene.has(p.id + '.json')).slice(0, 40).map(async p => {
        try {
          const { data } = await supabase.storage.from('project-documents').download('crm/diseno/' + p.id + '.json');
          const j = JSON.parse(await data.text());
          lamPor[p.id] = (j.laminas || []).map(l => ({ titulo: l.titulo || 'Alzado', versiones: (l.versiones || []).length, actualizada: l.actualizada || null })).sort((a, b) => String(b.actualizada).localeCompare(String(a.actualizada)));
        } catch { /* sin láminas */ }
      }));
    } catch { /* el almacenamiento no responde: se ve sin láminas */ }
    proyectos.forEach(p => { p.laminas = lamPor[p.id] || []; });
    const recientesDiseno = proyectos.flatMap(p => p.laminas.map(l => ({ ...l, proyecto: p.nombre }))).sort((a, b) => String(b.actualizada).localeCompare(String(a.actualizada))).slice(0, 6);

    const estados = (le.data || []).map(l => l.estado);
    const cuenta = (...xs) => estados.filter(e => xs.includes(e)).length;
    const budg = (bu.data || []).map(b => b.status);
    const abiertas = (ve.data || []).filter(v => !v.cerrada);

    const nProy = Object.fromEntries((pr.data || []).map(p => [p.id, p.project_name]));
    const leadPorId = Object.fromEntries((le.data || []).map(l => [l.id, l.nombre]));
    const detalle = {
      diseno: proyectos.filter(p => p.tareas.total - p.tareas.hechas > 0).sort((a, b) => (b.tareas.total - b.tareas.hechas) - (a.tareas.total - a.tareas.hechas)).slice(0, 6).map(p => [p.nombre, `${p.tareas.total - p.tareas.hechas} tareas pendientes`]).concat(proyectos.filter(p => p.semaforo === 'gris').slice(0, 3).map(p => [p.nombre, 'Sin fecha de entrega ni plan'])),
      ventas: (sl.data || []).slice(0, 4).map(c => [leadPorId[c.setting_lead_id] || 'Llamada', `Llamada hoy · ${String(c.hora_inicio || '').slice(0, 5)}`]).concat((le.data || []).filter(l => ['nuevo', 'contacto_nuevo'].includes(l.estado)).slice(0, 5).map(l => [l.nombre || 'Lead', 'Lead nuevo'])),
      presupuestos: (bu.data || []).filter(b => b.status === 'borrador').slice(0, 6).map(b => [b.budget_name || nProy[b.project_id] || 'Presupuesto', 'Borrador']),
      finanzas: abiertas.slice(0, 6).map(v => [v.nombre || 'Venta', `${Math.round(Number(v.valor) || 0)} € abiertos`]),
      equipo: pend.filter(t => !t.assigned_to).slice(0, 6).map(t => [t.title, 'Sin asignar' + (t.due_date ? ` · ${t.due_date}` : '')]),
    };
    const departamentos = [
      { id: 'diseno', detalle: detalle.diseno, nombre: 'Diseño y proyectos', ir: 'proyectos', datos: [['En marcha', proyectos.length], ['Tareas atrasadas', pend.filter(atrasada).length], ['Sin planificar', proyectos.filter(p => p.semaforo === 'gris').length]], alerta: pend.filter(atrasada).length ? 'rojo' : proyectos.some(p => p.semaforo === 'gris') ? 'ambar' : 'verde' },
      { id: 'ventas', detalle: detalle.ventas, nombre: 'Ventas y leads', ir: 'setting', datos: [['Leads nuevos', cuenta('nuevo', 'contacto_nuevo')], ['Llamadas hoy', (sl.data || []).length], ['En seguimiento', cuenta('seguimiento_futuro', 'seguimiento_pago')]], alerta: (sl.data || []).length ? 'ambar' : 'verde' },
      { id: 'presupuestos', detalle: detalle.presupuestos, nombre: 'Presupuestos', ir: 'presupuestos', datos: [['Borradores', budg.filter(s => s === 'borrador').length], ['Aprobados', budg.filter(s => s === 'aprobado').length]], alerta: 'verde' },
      { id: 'finanzas', detalle: detalle.finanzas, nombre: 'Finanzas', ir: 'ventas', datos: [['Ventas abiertas', abiertas.length], ['Importe abierto', Math.round(abiertas.reduce((s, v) => s + (Number(v.valor) || 0), 0)) + ' €']], alerta: 'verde' },
      { id: 'equipo', detalle: detalle.equipo, nombre: 'Equipo', ir: 'tareas', datos: (em.data || []).map(e => { const mias = pend.filter(t => t.assigned_to === e.id); return [e.name.split(' ')[0] + (mias.filter(atrasada).length ? ' ⚠' : ''), mias.length]; }).filter(([, n]) => n > 0).slice(0, 6).concat([['Sin asignar', pend.filter(t => !t.assigned_to).length]]), alerta: pend.filter(t => !t.assigned_to && atrasada(t)).length ? 'rojo' : 'verde' },
    ];
    // personas del equipo: qué tienen en la mesa (para verlas trabajando en la oficina 3D)
    const nombreProy = Object.fromEntries((pr.data || []).map(p => [p.id, p.project_name]));
    const personas = (em.data || []).map(e => {
      const mias = pend.filter(t => t.assigned_to === e.id).sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')));
      const s0 = mias[0], lista = mias.slice(0, 8).map(t => ({ titulo: t.title, proyecto: nombreProy[t.project_id] || null, fecha: t.due_date || null, atrasada: !!t.due_date && t.due_date < hoy }));
      return { id: e.id, avatar: pl.avatares?.[e.id] || null, nombre: e.name, rol: e.employee_roles?.name || (e.is_admin_profile ? 'Administrador' : 'Sin categoría'), pendientes: mias.length, atrasadas: mias.filter(atrasada).length, hoy: mias.filter(t => t.due_date === hoy).length, lista, siguiente: s0 ? { titulo: s0.title, proyecto: nombreProy[s0.project_id] || null, fecha: s0.due_date || null } : null };
    });
    // agentes de IA del CRM, cada uno en su sala
    const agentes = [
      { id: 'setter', nombre: 'Asistente Setter', sala: 'ventas', ir: 'asistente-setter', hace: 'Mete leads y agenda llamadas' },
      { id: 'presupuestos', nombre: 'Asistente de presupuestos', sala: 'presupuestos', ir: 'asistente', hace: 'Prepara presupuestos con IA' },
      { id: 'finanzas', nombre: 'Asistente de finanzas', sala: 'finanzas', ir: 'asistente-finanzas', hace: 'Responde sobre las cuentas' },
      { id: 'diseno', nombre: 'Asistente de diseño', sala: 'diseno', ir: 'asistente-diseno', hace: 'Dibuja alzados con tus medidas', recientes: recientesDiseno },
      { id: 'ideas', nombre: 'Estudio de ideas', sala: 'diseno', ir: 'estudio-ideas', hace: 'Genera ideas y renders con IA' },
    ];
    // anexos: un edificio por sector de proveedores y colaboradores, con sus empresas dentro
    const porSector = {};
    (co.data || []).forEach(c => { const k = (c.sector || 'Otros').trim() || 'Otros'; (porSector[k] = porSector[k] || []).push({ id: c.id, nombre: c.name, url: c.company_url || null }); });
    const anexos = Object.entries(porSector).map(([sector, proveedores]) => ({ sector, n: proveedores.length, proveedores })).sort((a, b) => b.n - a.n || a.sector.localeCompare(b.sector)).slice(0, 10);
    // tareas que hay que mirar ya: atrasadas, de hoy y de la próxima semana (para el panel «Hoy» de la oficina)
    const finSemana = sumarDias(hoy, 7);
    const tareasHoy = pend.filter(t => t.due_date && t.due_date <= finSemana).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date))).slice(0, 25).map(t => ({ id: t.id, titulo: t.title, proyecto: nombreProy[t.project_id] || null, fecha: t.due_date, atrasada: t.due_date < hoy, prioridad: t.priority }));
    // almacén del catálogo: una estantería por categoría con sus productos
    const prodPorCat = {};
    (cprod.data || []).forEach(p => { (prodPorCat[p.category_id] = prodPorCat[p.category_id] || []).push({ nombre: p.name, marca: p.brand || null }); });
    const catalogo = (ccat.data || []).slice(0, 60).map(c => ({ id: c.id, nombre: String(c.name || '').replace(/^[A-Za-z]{1,2}[.]{0,2} ?[0-9]+[.]* */, '').trim() || c.name, familia: (String(c.name || '').match(/^([A-Za-z])/) || [])[1]?.toUpperCase() || 'S', n: (prodPorCat[c.id] || []).length, productos: (prodPorCat[c.id] || []).slice(0, 14) }));
    res.json({ hoy, departamentos, proyectos, personas, agentes, anexos, catalogo, totalProductos: (cprod.data || []).length, tareasHoy, tareasSinFecha: pend.filter(t => !t.due_date).length });
  } catch (err) { console.error('oficinas:', err); res.status(500).json({ error: 'No se pudieron cargar las oficinas' }); }
});

// logo de la web de un proveedor (PNG), para su stand en la oficina 3D; se pide con la sesión y se guarda 12 horas
// ── Mapa de obras: dónde está cada proyecto y cómo van sus pedidos (por pedir, preparando, en camino, entregado, montado)
const ESTADOS_PEDIDO = ['pendiente', 'pedido', 'preparacion', 'transito', 'entregado', 'montado'];
async function pedidosPorProyecto(hoy) {
    const leeBu = (extra) => supabase.from('budgets').select('id, status, project_id, items:budget_items(id, name, provider, brand, category, quantity, order_status, delivery_date' + extra + ')').eq('status', 'aprobado');
    let bu = await leeBu(', pedido_ref, pedido_fecha');
    if (bu.error) bu = await leeBu(''); // aún sin la migración de pedidos agrupados
    const por = {};
    (bu.data || []).forEach(b => (b.items || []).forEach(it => {
      if (it.category !== 'material' && it.category !== 'mobiliario') return;
      const e = por[b.project_id] || (por[b.project_id] = { estados: Object.fromEntries(ESTADOS_PEDIDO.map(k => [k, 0])), total: 0, proximaEntrega: null, proveedores: {}, grupos: {}, sinPedir: 0 });
      const st = ESTADOS_PEDIDO.includes(it.order_status) ? it.order_status : 'pendiente', prov = (it.provider || it.brand || 'Sin proveedor').trim();
      e.estados[st]++; e.total++;
      if (st !== 'montado' && st !== 'entregado' && it.delivery_date && it.delivery_date >= hoy && (!e.proximaEntrega || it.delivery_date < e.proximaEntrega)) e.proximaEntrega = it.delivery_date;
      const pv = e.proveedores[prov] || (e.proveedores[prov] = { nombre: prov, n: 0, estados: Object.fromEntries(ESTADOS_PEDIDO.map(k => [k, 0])) }); pv.n++; pv.estados[st]++;
      // pedidos agrupados (PED-2026-001): las piezas que se piden juntas a un proveedor
      if (it.pedido_ref) {
        const g = e.grupos[it.pedido_ref] || (e.grupos[it.pedido_ref] = { ref: it.pedido_ref, proveedor: prov, fecha: it.pedido_fecha || null, n: 0, estados: Object.fromEntries(ESTADOS_PEDIDO.map(k => [k, 0])), entrega: null });
        g.n++; g.estados[st]++; if (it.delivery_date && (!g.entrega || it.delivery_date > g.entrega)) g.entrega = it.delivery_date;
      } else if (st === 'pendiente') e.sinPedir++;
    }));
    return por;
}
router.get('/mapa', async (req, res) => {
  try {
    const hoy = hoyMadrid();
    let ubicaciones = true, pr = await supabase.from('client_projects').select('id, project_name, client_name, client_city, obra_ciudad, obra_pais, obra_lat, obra_lng').eq('status', 'en_marcha').eq('active', true);
    if (pr.error) { // la migración de ubicaciones aún no se ha ejecutado: se muestra igualmente la lista, sin coordenadas
      ubicaciones = false; pr = await supabase.from('client_projects').select('id, project_name, client_name, client_city').eq('status', 'en_marcha').eq('active', true);
      if (pr.error) throw pr.error;
    }
    const por = await pedidosPorProyecto(hoy);
    res.json({
      ubicaciones, hoy,
      proyectos: (pr.data || []).map(p => ({
        id: p.id, nombre: p.project_name, cliente: p.client_name, ciudadCliente: p.client_city || '', ciudad: p.obra_ciudad || '', pais: p.obra_pais || '',
        lat: Number.isFinite(p.obra_lat) ? p.obra_lat : null, lng: Number.isFinite(p.obra_lng) ? p.obra_lng : null,
        pedidos: por[p.id] ? { ...por[p.id], proveedores: Object.values(por[p.id].proveedores), grupos: Object.values(por[p.id].grupos).sort((a, b) => String(a.ref).localeCompare(String(b.ref))) } : { estados: Object.fromEntries(ESTADOS_PEDIDO.map(k => [k, 0])), total: 0, proximaEntrega: null, proveedores: [], grupos: [], sinPedir: 0 },
      })),
    });
  } catch (e) { console.error('oficinas mapa:', e); res.status(500).json({ error: 'No se pudo cargar el mapa' }); }
});

// Pone la ubicación de la obra: se escribe la ciudad (y país) y se busca en OpenStreetMap (Nominatim); también vale mandar lat y lng a mano
router.put('/ubicacion/:id', async (req, res) => {
  try {
    const ciudad = String(req.body?.ciudad || '').trim().slice(0, 120), pais = String(req.body?.pais || '').trim().slice(0, 80);
    let lat = parseFloat(req.body?.lat), lng = parseFloat(req.body?.lng), nombre = ciudad;
    if (!(Number.isFinite(lat) && Number.isFinite(lng))) {
      if (!ciudad) return res.status(400).json({ error: 'Escribe la ciudad de la obra' });
      const q = [ciudad, pais].filter(Boolean).join(', ');
      const rr = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=es&q=' + encodeURIComponent(q), { headers: { 'User-Agent': 'RanuseCRM-mapa/1.0' } });
      const j = await rr.json().catch(() => []);
      if (!Array.isArray(j) || !j[0]) return res.status(404).json({ error: 'No he encontrado «' + q + '». Prueba con la ciudad y el país, por ejemplo «Panamá, Panamá».' });
      lat = parseFloat(j[0].lat); lng = parseFloat(j[0].lon);
    }
    if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) return res.status(400).json({ error: 'Coordenadas no válidas' });
    const { error } = await supabase.from('client_projects').update({ obra_ciudad: nombre || null, obra_pais: pais || null, obra_lat: lat, obra_lng: lng }).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: /obra_/.test(error.message || '') ? 'Falta ejecutar la migración de ubicaciones en Supabase (supabase_migration_v96.sql).' : 'No se pudo guardar la ubicación' });
    res.json({ ok: true, lat, lng, ciudad: nombre, pais });
  } catch (e) { console.error('oficinas ubicacion:', e); res.status(500).json({ error: 'No se pudo buscar esa ubicación' }); }
});

router.get('/logo', async (req, res) => {
  try {
    const png = await logoDeSitio(req.query.url);
    if (!png) return res.status(404).json({ error: 'Sin logo' });
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=43200' }).send(png);
  } catch { res.status(404).json({ error: 'Sin logo' }); }
});

// ── muñeco de cada persona de la oficina 3D (peinado, barba, gafas, piel y ropa), para que se parezca a su dueño ──
const HEX = /^#[0-9a-fA-F]{6}$/;
router.put('/avatar/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const av = {};
    if (['corto', 'largo', 'rizado', 'calvo'].includes(b.pelo)) av.pelo = b.pelo;
    if (['no', 'corta', 'larga'].includes(b.barba)) av.barba = b.barba;
    av.gafas = b.gafas === true;
    ['piel', 'peloColor', 'ropa'].forEach(k => { if (HEX.test(b[k] || '')) av[k] = b[k]; });
    const p = await leerPlanificacion();
    p.avatares = { ...(p.avatares || {}), [String(req.params.id).slice(0, 60)]: av };
    const { error } = await guardarPlanificacion(p); if (error) throw error;
    res.json({ avatar: av });
  } catch (err) { res.status(500).json({ error: 'No se pudo guardar el muñeco' }); }
});

// ── catálogo de entregables (nombre + horas medias) ──
router.get('/catalogo', async (req, res) => { const p = await leerPlanificacion(); res.json({ catalogo: p.catalogo }); });
router.put('/catalogo', async (req, res) => {
  try {
    const lista = (Array.isArray(req.body?.catalogo) ? req.body.catalogo : []).slice(0, 40).map((c, i) => ({ id: String(c?.id || 'e' + i).replace(/[^\w-]/g, '').slice(0, 40) || 'e' + i, nombre: String(c?.nombre || '').trim().slice(0, 80), horas: Math.min(80, Math.max(0.5, Number(c?.horas) || 1)) })).filter(c => c.nombre);
    if (!lista.length) return res.status(400).json({ error: 'El catálogo no puede quedar vacío' });
    const p = await leerPlanificacion(); p.catalogo = lista;
    const { error } = await guardarPlanificacion(p); if (error) throw error;
    res.json({ catalogo: lista });
  } catch (err) { res.status(500).json({ error: 'No se pudo guardar el catálogo' }); }
});

// ── plan de un proyecto ──
router.get('/proyectos/:id/plan', async (req, res) => {
  const p = await leerPlanificacion();
  res.json({ plan: p.proyectos[req.params.id] || null, catalogo: p.catalogo, hoy: hoyMadrid() });
});
router.put('/proyectos/:id/entrega', async (req, res) => {
  try {
    const entrega = req.body?.entrega || null;
    if (entrega && !FECHA.test(entrega)) return res.status(400).json({ error: 'Fecha no válida' });
    const p = await leerPlanificacion();
    const actual = p.proyectos[req.params.id] || {};
    p.proyectos[req.params.id] = { ...actual, entrega, actualizado: new Date().toISOString() };
    if (!entrega && !actual.items) delete p.proyectos[req.params.id];
    const { error } = await guardarPlanificacion(p); if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'No se pudo guardar la fecha' }); }
});
router.post('/proyectos/:id/propuesta', (req, res) => {
  const b = req.body || {};
  if (!FECHA.test(b.entrega || '')) return res.status(400).json({ error: 'Pon la fecha de entrega al cliente' });
  const items = (Array.isArray(b.entregables) ? b.entregables : []).slice(0, 40).filter(i => i && String(i.nombre || '').trim());
  if (!items.length) return res.status(400).json({ error: 'Elige al menos un entregable' });
  const inicio = FECHA.test(b.inicio || '') ? b.inicio : hoyMadrid();
  res.json(repartir({ items: items.map(i => ({ id: String(i.id || ''), nombre: String(i.nombre).trim().slice(0, 80), horas: i.horas })), inicio, entrega: b.entrega, margenDias: b.margenDias, horasDia: b.horasDia }));
});
router.post('/proyectos/:id/aplicar', async (req, res) => {
  try {
    const b = req.body || {};
    if (!FECHA.test(b.entrega || '')) return res.status(400).json({ error: 'Falta la fecha de entrega' });
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 40).filter(i => i && String(i.nombre || '').trim() && FECHA.test(i.fecha || ''));
    if (!items.length) return res.status(400).json({ error: 'No hay entregables que crear' });
    const { data: proy } = await supabase.from('client_projects').select('id, responsible_id').eq('id', req.params.id).maybeSingle();
    if (!proy) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const p = await leerPlanificacion(), previo = p.proyectos[req.params.id];
    // volver a planificar sustituye solo las tareas pendientes que creó el planificador antes (las hechas y las tuyas no se tocan)
    if (b.reemplazar && previo?.tareas?.length) await supabase.from('tasks').delete().in('id', previo.tareas).eq('done', false);
    const filas = items.map(i => ({ title: String(i.nombre).trim().slice(0, 200), description: 'Planificado automáticamente · ' + (Number(i.horas) || 1) + ' h', priority: 'normal', due_date: i.fecha, project_id: proy.id, assigned_to: proy.responsible_id || null }));
    let r = await supabase.from('tasks').insert(filas).select('id');
    if (r.error) r = await supabase.from('tasks').insert(filas.map(f => ({ ...f, assigned_to: null }))).select('id');
    if (r.error) throw r.error;
    p.proyectos[req.params.id] = { entrega: b.entrega, margenDias: b.margenDias, horasDia: b.horasDia, cabe: b.cabe !== false, faltanHoras: Number(b.faltanHoras) || 0, items: items.map(i => ({ id: i.id || '', nombre: i.nombre, horas: i.horas, fecha: i.fecha })), tareas: [...(b.reemplazar ? [] : previo?.tareas || []), ...r.data.map(t => t.id)], actualizado: new Date().toISOString() };
    const { error } = await guardarPlanificacion(p); if (error) throw error;
    res.status(201).json({ creadas: r.data.length });
  } catch (err) { console.error('oficinas aplicar:', err); res.status(500).json({ error: 'No se pudieron crear las tareas' }); }
});

export default router;
