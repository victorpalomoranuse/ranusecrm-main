import { supabase } from '../config/supabase.js';

// Los diseñadores solo ven los proyectos (y los planos) que tienen asignados:
// los proyectos cuyo «responsable» es su ficha de empleado, y los planos que
// ellos mismos crean. El administrador superior y el resto de roles lo ven todo.

const CACHE = new Map(); // email -> { t, emp }
const TTL = 60 * 1000;

// Devuelve { id } (su ficha de empleado) si la persona es diseñadora; null si ve todo
export async function disenadorDe(req) {
  const u = req.user;
  if (!u || u.role === 'admin_superior' || !u.email) return null;
  const c = CACHE.get(u.email);
  if (c && Date.now() - c.t < TTL) return c.emp;
  let emp = null;
  const { data: e } = await supabase.from('employees').select('id, role_id').eq('email', u.email).maybeSingle();
  if (e?.role_id) {
    const { data: r } = await supabase.from('employee_roles').select('name').eq('id', e.role_id).maybeSingle();
    if (r && /dise[ñn]ador/i.test(r.name || '')) emp = { id: e.id };
  }
  CACHE.set(u.email, { t: Date.now(), emp });
  return emp;
}

// Proyectos de un diseñador: donde es responsable + donde está en la lista de asignados (si la tabla aún no existe, solo los de responsable)
export async function proyectosDe(emp) {
  const [{ data: a }, { data: b }] = await Promise.all([
    supabase.from('client_projects').select('id').eq('responsible_id', emp.id),
    supabase.from('project_assignees').select('project_id').eq('employee_id', emp.id),
  ]);
  return [...new Set([...(a || []).map(p => p.id), ...(b || []).map(p => p.project_id)])];
}

export async function proyectoEsDe(emp, projectId) {
  if (!projectId) return true;
  const { data } = await supabase.from('client_projects').select('responsible_id').eq('id', projectId).maybeSingle();
  if (!data) return false;
  if (data.responsible_id === emp.id) return true;
  const { data: a } = await supabase.from('project_assignees').select('employee_id').eq('project_id', projectId).eq('employee_id', emp.id).maybeSingle();
  return !!a;
}

// Rutas /:id de proyectos: un diseñador solo entra en los suyos
export const guardiaProyecto = async (req, res, next) => {
  try {
    const emp = await disenadorDe(req);
    if (!emp || !req.params.id) return next();
    if (await proyectoEsDe(emp, req.params.id)) return next();
    return res.status(403).json({ error: 'Este proyecto no está asignado a ti.' });
  } catch (e) {
    console.error('guardia proyecto:', e);
    return res.status(500).json({ error: 'No se pudo comprobar el acceso al proyecto' });
  }
};
