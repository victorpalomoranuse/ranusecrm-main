import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdminSuperior } from '../middleware/auth.middleware.js';
import { ocupadoGoogle } from '../utils/google-busy.js';
import { madridToUtcDate } from '../utils/timezone.js';

// Mi agenda: junta en un solo día mis horarios, mis eventos del calendario, mis llamadas reservadas y lo ocupado en Google Calendar,
// para organizar reuniones y tareas sin que se pisen.
const router = express.Router();
router.use(authenticateToken, requireAdminSuperior);

const DURACION_DEF = 60;
const HORARIO_DEF = [1, 2, 3, 4, 5].flatMap(d => [{ dia: d, ini: '09:00', fin: '14:00' }, { dia: d, ini: '16:00', fin: '19:00' }]);

const aMin = (h) => { const [a, b] = String(h || '0:0').split(':'); return (+a || 0) * 60 + (+b || 0); };
const deMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const fechaValida = (f) => /^\d{4}-\d{2}-\d{2}$/.test(String(f || ''));
const diaSemana = (f) => { const [y, m, d] = f.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };

async function miEmpleado(req) {
  if (!req.user.email) return null;
  const { data } = await supabase.from('employees').select('id, name, google_ical_url').eq('email', req.user.email).maybeSingle();
  return data;
}

// Mis franjas de trabajo (si aún no las has definido o falta la tabla: lunes a viernes de 9 a 14 y de 16 a 19)
async function franjas(userId) {
  const { data, error } = await supabase.from('agenda_horarios').select('dia_semana, hora_inicio, hora_fin').eq('user_id', userId);
  if (error || !data || !data.length) return { definido: false, lista: HORARIO_DEF };
  return { definido: true, lista: data.map(r => ({ dia: r.dia_semana, ini: String(r.hora_inicio).slice(0, 5), fin: String(r.hora_fin).slice(0, 5) })) };
}

// Todo lo de un día, con las horas en minutos desde las 00:00 (hora de Madrid)
async function diaDe(req, fecha) {
  const emp = await miEmpleado(req);
  const [{ data: eventos }, { data: tareas }, hor] = await Promise.all([
    supabase.from('events').select('*').eq('date', fecha),
    supabase.from('tasks').select('id, title, priority, due_date, done, project:client_projects(project_name)').eq('done', false).lte('due_date', fecha),
    franjas(req.user.id),
  ]);
  const bloques = [];
  (eventos || []).forEach(e => {
    if (e.done) return;
    if (!e.time) { bloques.push({ id: e.id, tipo: 'evento', todoDia: true, titulo: e.title, color: e.color, detalle: e.description || '' }); return; }
    const ini = aMin(String(e.time).slice(0, 5)), dur = Number(e.duration_min) > 0 ? Number(e.duration_min) : DURACION_DEF;
    bloques.push({ id: e.id, tipo: 'evento', ini, fin: Math.min(ini + dur, 24 * 60), dur, titulo: e.title, color: e.color, detalle: e.description || '' });
  });
  let google = false;
  if (emp) {
    const { data: slots } = await supabase.from('call_slots').select('id, hora_inicio, hora_fin, ocupado, lead:setting_leads(nombre)').eq('employee_id', emp.id).eq('fecha', fecha);
    (slots || []).forEach(s => {
      const ini = aMin(String(s.hora_inicio).slice(0, 5)), fin = aMin(String(s.hora_fin).slice(0, 5));
      bloques.push({ id: s.id, tipo: s.ocupado ? 'llamada' : 'hueco', ini, fin, titulo: s.ocupado ? `Llamada${s.lead?.nombre ? ' · ' + s.lead.nombre : ''}` : 'Hueco de llamada libre' });
    });
    if (emp.google_ical_url) {
      try {
        const base = madridToUtcDate(fecha, '00:00:00').getTime();
        const ocup = await ocupadoGoogle(emp.google_ical_url, new Date(base - 3600000), new Date(base + 25 * 3600000));
        google = true;
        ocup.forEach(([x, y]) => { const a = Math.max(0, Math.round((x - base) / 60000)), b = Math.min(24 * 60, Math.round((y - base) / 60000)); if (b > a) bloques.push({ tipo: 'google', ini: a, fin: b, titulo: 'Ocupado (Google Calendar)' }); });
      } catch (err) { console.error('agenda: Google Calendar no disponible:', err.message); }
    }
  }
  const dow = diaSemana(fecha);
  const horario = hor.lista.filter(f => f.dia === dow).map(f => ({ ini: aMin(f.ini), fin: aMin(f.fin) })).sort((a, b) => a.ini - b.ini);
  // huecos libres: mi horario menos lo ocupado (eventos con hora, llamadas reservadas y Google)
  const ocupado = bloques.filter(b => b.ini != null && b.tipo !== 'hueco').sort((a, b) => a.ini - b.ini);
  const libres = [];
  horario.forEach(h => {
    let cur = h.ini;
    ocupado.forEach(o => { if (o.fin <= cur || o.ini >= h.fin) return; if (o.ini > cur) libres.push({ ini: cur, fin: Math.min(o.ini, h.fin) }); cur = Math.max(cur, o.fin); });
    if (cur < h.fin) libres.push({ ini: cur, fin: h.fin });
  });
  return {
    fecha, dia_semana: dow, horario, horario_definido: hor.definido, google, empleado: !!emp,
    bloques: bloques.sort((a, b) => (a.ini ?? -1) - (b.ini ?? -1)),
    libres: libres.filter(l => l.fin - l.ini >= 15),
    tareas: (tareas || []).map(t => ({ id: t.id, titulo: t.title, prioridad: t.priority, fecha: t.due_date, atrasada: String(t.due_date).slice(0, 10) < fecha, proyecto: t.project?.project_name || null })),
  };
}

/** GET /api/agenda/dia?fecha=YYYY-MM-DD */
router.get('/dia', async (req, res) => {
  try {
    const fecha = String(req.query.fecha || '');
    if (!fechaValida(fecha)) return res.status(400).json({ error: 'Fecha no válida' });
    const d = await diaDe(req, fecha);
    // las tareas atrasadas solo se enseñan en «hoy» (no en los días futuros, donde no tiene sentido)
    res.json(d);
  } catch (err) { console.error('agenda/dia:', err); res.status(500).json({ error: 'No se pudo cargar el día' }); }
});

/** GET /api/agenda/semana?desde=YYYY-MM-DD — cuántas cosas hay cada día (para la tira de días) */
router.get('/semana', async (req, res) => {
  try {
    const desde = String(req.query.desde || '');
    if (!fechaValida(desde)) return res.status(400).json({ error: 'Fecha no válida' });
    const [y, m, d] = desde.split('-').map(Number);
    const dias = Array.from({ length: 14 }, (_, i) => { const f = new Date(Date.UTC(y, m - 1, d + i)); return f.toISOString().slice(0, 10); });
    const emp = await miEmpleado(req);
    const [{ data: ev }, { data: ta }, sl] = await Promise.all([
      supabase.from('events').select('date, done').gte('date', dias[0]).lte('date', dias[13]),
      supabase.from('tasks').select('due_date, done').eq('done', false).gte('due_date', dias[0]).lte('due_date', dias[13]),
      emp ? supabase.from('call_slots').select('fecha').eq('employee_id', emp.id).eq('ocupado', true).gte('fecha', dias[0]).lte('fecha', dias[13]) : Promise.resolve({ data: [] }),
    ]);
    const cuenta = Object.fromEntries(dias.map(f => [f, { eventos: 0, tareas: 0, llamadas: 0 }]));
    (ev || []).forEach(e => { if (!e.done && cuenta[e.date]) cuenta[e.date].eventos++; });
    (ta || []).forEach(t => { const f = String(t.due_date).slice(0, 10); if (cuenta[f]) cuenta[f].tareas++; });
    (sl.data || []).forEach(s => { if (cuenta[s.fecha]) cuenta[s.fecha].llamadas++; });
    res.json({ dias: dias.map(f => ({ fecha: f, ...cuenta[f] })) });
  } catch (err) { console.error('agenda/semana:', err); res.status(500).json({ error: 'No se pudo cargar la semana' }); }
});

/** POST /api/agenda/conflictos { fecha, hora, duracion_min, excluir_id? } — ¿se pisa con algo? y huecos libres para moverlo */
router.post('/conflictos', async (req, res) => {
  try {
    const { fecha, hora, excluir_id } = req.body || {};
    const dur = Number(req.body?.duracion_min) > 0 ? Number(req.body.duracion_min) : DURACION_DEF;
    if (!fechaValida(fecha) || !/^\d{1,2}:\d{2}$/.test(String(hora || ''))) return res.status(400).json({ error: 'Fecha u hora no válidas' });
    const d = await diaDe(req, fecha);
    const ini = aMin(hora), fin = ini + dur;
    const choques = d.bloques.filter(b => b.ini != null && b.tipo !== 'hueco' && b.id !== excluir_id && b.ini < fin && b.fin > ini)
      .map(b => ({ tipo: b.tipo, titulo: b.titulo, ini: deMin(b.ini), fin: deMin(b.fin) }));
    const dentro = d.horario.some(h => ini >= h.ini && fin <= h.fin);
    const sugerencias = [];
    const cand = [];
    d.libres.forEach(l => { for (let t = Math.ceil(l.ini / 15) * 15; t + dur <= l.fin; t += 15) cand.push(t); });
    cand.sort((x, y) => Math.abs(x - ini) - Math.abs(y - ini)); // los más cercanos a la hora pedida
    const vistos = [];
    cand.forEach(t => { if (sugerencias.length < 4 && vistos.every(v => Math.abs(v - t) >= 30)) { vistos.push(t); sugerencias.push({ ini: deMin(t), fin: deMin(t + dur) }); } });
    sugerencias.sort((x, y) => aMin(x.ini) - aMin(y.ini));
    res.json({ choques, fuera_de_horario: d.horario.length > 0 && !dentro, sin_horario: d.horario.length === 0, sugerencias });
  } catch (err) { console.error('agenda/conflictos:', err); res.status(500).json({ error: 'No se pudo comprobar' }); }
});

/** GET /api/agenda/horarios — mis franjas · PUT /api/agenda/horarios { franjas: [{dia, ini, fin}] } — las sustituye */
router.get('/horarios', async (req, res) => {
  const h = await franjas(req.user.id);
  res.json({ definido: h.definido, franjas: h.lista });
});
router.put('/horarios', async (req, res) => {
  try {
    const lista = (Array.isArray(req.body?.franjas) ? req.body.franjas : []).slice(0, 40)
      .filter(f => Number.isInteger(+f.dia) && +f.dia >= 0 && +f.dia <= 6 && /^\d{1,2}:\d{2}$/.test(String(f.ini)) && /^\d{1,2}:\d{2}$/.test(String(f.fin)) && aMin(f.fin) > aMin(f.ini));
    const { error: e1 } = await supabase.from('agenda_horarios').delete().eq('user_id', req.user.id);
    if (e1) return res.status(409).json({ error: 'Falta ejecutar el SQL v81 en Supabase (tabla «agenda_horarios»)' });
    if (lista.length) {
      const { error } = await supabase.from('agenda_horarios').insert(lista.map(f => ({ user_id: req.user.id, dia_semana: +f.dia, hora_inicio: f.ini, hora_fin: f.fin })));
      if (error) throw error;
    }
    res.json({ ok: true, franjas: lista });
  } catch (err) { console.error('agenda/horarios:', err); res.status(500).json({ error: 'No se pudieron guardar los horarios' }); }
});

export default router;
