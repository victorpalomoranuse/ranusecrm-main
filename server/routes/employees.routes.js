import express from 'express';
import bcrypt from 'bcrypt';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdmin, requireAdminSuperior } from '../middleware/auth.middleware.js';

const router = express.Router();

/**
 * GET /api/employees
 * Listar todos los empleados
 */
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const isSuper = req.user.role === 'admin_superior';
    const fields = isSuper
      ? 'id, name, email, role, active, created_at, plain_password, is_admin_profile'
      : 'id, name, email, role, active, created_at, is_admin_profile';

    const { data, error } = await supabase
      .from('employees')
      .select(fields)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ employees: data });
  } catch (error) {
    console.error('Error al listar empleados:', error);
    res.status(500).json({ error: 'Error al listar empleados' });
  }
});

/**
 * POST /api/employees/myself
 * El admin_superior se crea a sí mismo como responsable (sin cuenta de login)
 */
router.post('/myself', authenticateToken, requireAdminSuperior, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'El nombre es requerido' });

    const email = req.user.email;

    const { data: existing } = await supabase
      .from('employees')
      .select('id')
      .eq('email', email)
      .single();

    if (existing) return res.status(400).json({ error: 'Ya tienes un perfil de responsable creado' });

    const { data: employee, error } = await supabase
      .from('employees')
      .insert({ name: name.trim(), email, role: 'admin', active: true, is_admin_profile: true })
      .select('id, name, email, role, active, created_at, is_admin_profile')
      .single();

    if (error) throw error;
    res.status(201).json({ employee });
  } catch (error) {
    console.error('Error al crear perfil propio:', error);
    res.status(500).json({ error: 'Error al crear perfil' });
  }
});

/**
 * POST /api/employees
 * Crear un empleado (crea usuario en users + registro en employees)
 * Solo admin_superior
 */
router.post('/', authenticateToken, requireAdminSuperior, async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nombre, email y contraseña son requeridos' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const emailNorm = email.toLowerCase().trim();

    // Verificar que el email no esté en uso
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', emailNorm)
      .single();

    if (existingUser) {
      return res.status(400).json({ error: 'Este email ya está en uso' });
    }

    // Crear usuario con rol trabajador
    const passwordHash = await bcrypt.hash(password, 10);
    const { data: user, error: userError } = await supabase
      .from('users')
      .insert({ email: emailNorm, password_hash: passwordHash, role: 'trabajador' })
      .select('id')
      .single();

    if (userError) throw userError;

    // Crear registro en employees
    const { data: employee, error: empError } = await supabase
      .from('employees')
      .insert({ name: name.trim(), email: emailNorm, role: 'empleado', plain_password: password })
      .select('id, name, email, role, active, created_at, plain_password, is_admin_profile')
      .single();

    if (empError) {
      // Rollback: borrar el usuario recién creado
      await supabase.from('users').delete().eq('id', user.id);
      throw empError;
    }

    res.status(201).json({ employee });
  } catch (error) {
    console.error('Error al crear empleado:', error);
    res.status(500).json({ error: 'Error al crear empleado' });
  }
});

/**
 * DELETE /api/employees/:id
 * Eliminar un empleado (borra de employees + users)
 * Solo admin_superior
 */
router.delete('/:id', authenticateToken, requireAdminSuperior, async (req, res) => {
  try {
    const { data: employee, error: fetchError } = await supabase
      .from('employees')
      .select('email')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !employee) {
      return res.status(404).json({ error: 'Empleado no encontrado' });
    }

    // Eliminar usuario de la tabla users
    await supabase.from('users').delete().eq('email', employee.email);

    // Eliminar de employees
    const { error } = await supabase.from('employees').delete().eq('id', req.params.id);
    if (error) throw error;

    res.json({ message: 'Empleado eliminado' });
  } catch (error) {
    console.error('Error al eliminar empleado:', error);
    res.status(500).json({ error: 'Error al eliminar empleado' });
  }
});

export default router;
