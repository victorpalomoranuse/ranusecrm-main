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

export async function proyectoEsDe(emp, projectId) {
  if (!projectId) return true;
  const { data } = await supabase.from('client_projects').select('responsible_id').eq('id', projectId).maybeSingle();
  return !!data && data.responsible_id === emp.id;
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
