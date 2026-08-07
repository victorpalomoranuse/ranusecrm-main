import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdminSuperior } from '../middleware/auth.middleware.js';

const router = express.Router();
router.use(authenticateToken);

function requireAdminOrTrabajador(req, res, next) {
  if (req.user.role === 'admin_superior' || req.user.role === 'trabajador') return next();
  return res.status(403).json({ error: 'Acceso denegado' });
}

async function getOwnEmployeeId(req) {
  if (req.user.role !== 'trabajador') return null;
  const { data } = await supabase.from('employees').select('id').eq('email', req.user.email).single();
  return data?.id || null;
}

const TASK_SELECT = '*, project:client_projects(id, client_name, project_name), employee:employees!assigned_to(id, name)';

router.get('/', requireAdminOrTrabajador, async (req, res) => {
  try {
    let query = supabase.from('tasks').select(TASK_SELECT)
      .order('done', { ascending: true })
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (req.query.project_id) query = query.eq('project_id', req.query.project_id);

    if (req.user.role === 'trabajador') {
      const employeeId = await getOwnEmployeeId(req);
      if (!employeeId) return res.json({ tasks: [] });
      query = query.eq('assigned_to', employeeId);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json({ tasks: data });
  } catch (err) { res.status(500).json({ error: 'Error al obtener tareas' }); }
});

router.post('/', requireAdminSuperior, async (req, res) => {
  try {
    const { title, description, priority, due_date, project_id, phase_number, assigned_to } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Título requerido' });
    const { data, error } = await supabase.from('tasks').insert({
      title: title.trim(),
      description: description?.trim() || null,
      priority: priority || 'normal',
      due_date: due_date || null,
      project_id: project_id || null,
      phase_number: phase_number != null && phase_number !== '' ? parseInt(phase_number) : null,
      assigned_to: assigned_to || null,
    }).select(TASK_SELECT).single();
    if (error) throw error;
    res.status(201).json({ task: data });
  } catch (err) { res.status(500).json({ error: 'Error al crear tarea' }); }
});

router.put('/:id', requireAdminOrTrabajador, async (req, res) => {
  try {
    if (req.user.role === 'trabajador') {
      // Un trabajador solo puede marcar como hecha/pendiente una tarea que sea suya
      const employeeId = await getOwnEmployeeId(req);
      const { data: existing } = await supabase.from('tasks').select('assigned_to').eq('id', req.params.id).single();
      if (!existing || existing.assigned_to !== employeeId) {
        return res.status(403).json({ error: 'No puedes modificar esta tarea' });
      }
      const { data, error } = await supabase.from('tasks').update({ done: req.body.done === true }).eq('id', req.params.id).select(TASK_SELECT).single();
      if (error) throw error;
      return res.json({ task: data });
    }

    const { title, description, done, priority, due_date, project_id, phase_number, assigned_to } = req.body;
    const updates = {};
    if (title !== undefined) updates.title = title.trim();
    if (description !== undefined) updates.description = description?.trim() || null;
    if (done !== undefined) updates.done = done;
    if (priority !== undefined) updates.priority = priority;
    if (due_date !== undefined) updates.due_date = due_date || null;
    if (project_id !== undefined) updates.project_id = project_id || null;
    if (phase_number !== undefined) updates.phase_number = phase_number != null && phase_number !== '' ? parseInt(phase_number) : null;
    if (assigned_to !== undefined) updates.assigned_to = assigned_to || null;
    const { data, error } = await supabase.from('tasks').update(updates).eq('id', req.params.id).select(TASK_SELECT).single();
    if (error) throw error;
    res.json({ task: data });
  } catch (err) { res.status(500).json({ error: 'Error al actualizar tarea' }); }
});

router.delete('/:id', requireAdminSuperior, async (req, res) => {
  try {
    const { error } = await supabase.from('tasks').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Tarea eliminada' });
  } catch (err) { res.status(500).json({ error: 'Error al eliminar tarea' }); }
});

export default router;
