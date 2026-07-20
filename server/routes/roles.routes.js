import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdminSuperior } from '../middleware/auth.middleware.js';

const router = express.Router();
router.use(authenticateToken, requireAdminSuperior);

// Secciones que se pueden activar/desactivar por rol.
// "empleados" y "ajustes" quedan fuera a propósito: siguen siendo exclusivas
// del admin_superior para evitar que un rol mal configurado se dé a sí mismo
// (o a otros) permisos de administración total.
export const PERMISOS_VALIDOS = [
  'dashboard', 'trabajos', 'leads', 'leads-cualificados', 'proyectos',
  'clientes', 'catalogo', 'referencias', 'recursos', 'contactos',
  'ventas', 'finanzas',
];

function sanitizePermissions(input) {
  const out = {};
  PERMISOS_VALIDOS.forEach(k => { out[k] = input?.[k] === true; });
  return out;
}

/**
 * GET /api/roles
 * Listar categorías/roles de empleado (Comercial, Diseñador, etc.)
 */
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('employee_roles')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json({ roles: data });
  } catch (error) {
    console.error('Error al listar roles:', error);
    res.status(500).json({ error: 'Error al listar roles' });
  }
});

/**
 * POST /api/roles
 * Crear una categoría de empleado con su combinación de permisos
 */
router.post('/', async (req, res) => {
  try {
    const { name, permissions } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'El nombre del rol es requerido' });

    const { data, error } = await supabase
      .from('employee_roles')
      .insert({ name: name.trim(), permissions: sanitizePermissions(permissions) })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') return res.status(400).json({ error: 'Ya existe un rol con ese nombre' });
      throw error;
    }
    res.status(201).json({ role: data });
  } catch (error) {
    console.error('Error al crear rol:', error);
    res.status(500).json({ error: 'Error al crear rol' });
  }
});

/**
 * PUT /api/roles/:id
 * Editar nombre y/o permisos de un rol.
 * Al guardar, todos los empleados con este rol asignado heredan el cambio al instante
 * (los permisos se resuelven en cada login/verify, no se copian al empleado).
 */
router.put('/:id', async (req, res) => {
  try {
    const { name, permissions } = req.body;
    const updates = {};
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ error: 'El nombre no puede estar vacío' });
      updates.name = name.trim();
    }
    if (permissions !== undefined) updates.permissions = sanitizePermissions(permissions);

    const { data, error } = await supabase
      .from('employee_roles')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') return res.status(400).json({ error: 'Ya existe un rol con ese nombre' });
      throw error;
    }
    res.json({ role: data });
  } catch (error) {
    console.error('Error al actualizar rol:', error);
    res.status(500).json({ error: 'Error al actualizar rol' });
  }
});

/**
 * DELETE /api/roles/:id
 * Eliminar un rol. Los empleados que lo tuvieran quedan sin categoría (role_id = null),
 * no se eliminan.
 */
router.delete('/:id', async (req, res) => {
  try {
    await supabase.from('employees').update({ role_id: null }).eq('role_id', req.params.id);
    const { error } = await supabase.from('employee_roles').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Rol eliminado' });
  } catch (error) {
    console.error('Error al eliminar rol:', error);
    res.status(500).json({ error: 'Error al eliminar rol' });
  }
});

export default router;
