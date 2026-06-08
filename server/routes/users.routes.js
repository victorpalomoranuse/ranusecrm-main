import express from 'express';
import bcrypt from 'bcrypt';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdmin, requireAdminSuperior } from '../middleware/auth.middleware.js';

const router = express.Router();

/**
 * GET /api/users
 * Listar usuarios (filtrar por role)
 */
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { role } = req.query;

    let query = supabase
      .from('users')
      .select('id, email, role, created_at')
      .order('created_at', { ascending: false });

    // Filtrar por rol si se especifica
    if (role) {
      query = query.eq('role', role);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    res.json({ users: data });

  } catch (error) {
    console.error('Error al listar usuarios:', error);
    res.status(500).json({ error: 'Error al listar usuarios' });
  }
});

/**
 * GET /api/users/:id
 * Obtener un usuario por ID
 */
router.get('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('users')
      .select('id, email, role, created_at')
      .eq('id', id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json(data);

  } catch (error) {
    console.error('Error al obtener usuario:', error);
    res.status(500).json({ error: 'Error al obtener usuario' });
  }
});

/**
 * POST /api/users/cliente
 * Crear un nuevo cliente
 */
router.post('/cliente', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validación
    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Email y contraseña son requeridos' 
      });
    }

    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ 
        error: 'Formato de email inválido' 
      });
    }

    // Verificar si el email ya existe
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (existingUser) {
      return res.status(400).json({ 
        error: 'El email ya está registrado' 
      });
    }

    // Hashear contraseña
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Crear cliente
    const { data, error } = await supabase
      .from('users')
      .insert({
        email: email.toLowerCase().trim(),
        password_hash: passwordHash,
        role: 'cliente',
        created_by: req.user.id
      })
      .select('id, email, role, created_at')
      .single();

    if (error) {
      throw error;
    }

    res.status(201).json({
      message: 'Cliente creado exitosamente',
      user: data
    });

  } catch (error) {
    console.error('Error al crear cliente:', error);
    res.status(500).json({ error: 'Error al crear cliente' });
  }
});

/**
 * POST /api/users/trabajador
 * Crear un nuevo trabajador (solo admin superior)
 */
router.post('/trabajador', authenticateToken, requireAdminSuperior, async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validación
    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Email y contraseña son requeridos' 
      });
    }

    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ 
        error: 'Formato de email inválido' 
      });
    }

    // Verificar si el email ya existe
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (existingUser) {
      return res.status(400).json({ 
        error: 'El email ya está registrado' 
      });
    }

    // Hashear contraseña
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Crear trabajador
    const { data, error } = await supabase
      .from('users')
      .insert({
        email: email.toLowerCase().trim(),
        password_hash: passwordHash,
        role: 'trabajador',
        created_by: req.user.id
      })
      .select('id, email, role, created_at')
      .single();

    if (error) {
      throw error;
    }

    res.status(201).json({
      message: 'Trabajador creado exitosamente',
      user: data
    });

  } catch (error) {
    console.error('Error al crear trabajador:', error);
    res.status(500).json({ error: 'Error al crear trabajador' });
  }
});

/**
 * PUT /api/users/:id/password
 * Cambiar contraseña de un usuario
 */
router.put('/:id/password', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({ 
        error: 'Nueva contraseña es requerida' 
      });
    }

    // Hashear nueva contraseña
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(newPassword, saltRounds);

    // Actualizar contraseña
    const { error } = await supabase
      .from('users')
      .update({ password_hash: passwordHash })
      .eq('id', id);

    if (error) {
      throw error;
    }

    res.json({ message: 'Contraseña actualizada exitosamente' });

  } catch (error) {
    console.error('Error al cambiar contraseña:', error);
    res.status(500).json({ error: 'Error al cambiar contraseña' });
  }
});

/**
 * DELETE /api/users/:id
 * Eliminar un usuario (trabajador o cliente)
 */
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Obtener el usuario a eliminar
    const { data: userToDelete, error: fetchError } = await supabase
      .from('users')
      .select('role')
      .eq('id', id)
      .single();

    if (fetchError || !userToDelete) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Solo admin superior puede eliminar trabajadores
    if (userToDelete.role === 'trabajador' && req.user.role !== 'admin_superior') {
      return res.status(403).json({ 
        error: 'Solo el admin superior puede eliminar trabajadores' 
      });
    }

    // No se puede eliminar al admin superior
    if (userToDelete.role === 'admin_superior') {
      return res.status(403).json({ 
        error: 'No se puede eliminar al admin superior' 
      });
    }

    // Eliminar usuario (se usa select() para confirmar que se borró)
    const { data: deleted, error } = await supabase
      .from('users')
      .delete()
      .eq('id', id)
      .select('id');

    if (error) {
      throw error;
    }

    if (!deleted || deleted.length === 0) {
      return res.status(404).json({ error: 'No se pudo eliminar: usuario no encontrado en la base de datos' });
    }

    res.json({ message: 'Usuario eliminado exitosamente' });

  } catch (error) {
    console.error('Error al eliminar usuario:', error);
    res.status(500).json({ error: 'Error al eliminar usuario' });
  }
});

/**
 * GET /api/users/:id/client-projects
 * Proyectos asignados a un cliente
 */
router.get('/:id/client-projects', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('client_user_projects')
      .select('client_projects(id, client_name, project_name, phase)')
      .eq('user_id', req.params.id);

    if (error) throw error;
    const projects = data.map(r => r.client_projects).filter(Boolean);
    res.json({ projects });
  } catch (error) {
    console.error('Error al obtener proyectos del cliente:', error);
    res.status(500).json({ error: 'Error al obtener proyectos' });
  }
});

/**
 * POST /api/users/:id/client-projects
 * Asignar un proyecto a un cliente
 */
router.post('/:id/client-projects', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { client_project_id } = req.body;
    if (!client_project_id) {
      return res.status(400).json({ error: 'client_project_id es requerido' });
    }

    const { error } = await supabase
      .from('client_user_projects')
      .insert({ user_id: req.params.id, client_project_id });

    if (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Este proyecto ya está asignado al cliente' });
      }
      throw error;
    }

    res.status(201).json({ message: 'Proyecto asignado' });
  } catch (error) {
    console.error('Error al asignar proyecto:', error);
    res.status(500).json({ error: 'Error al asignar proyecto' });
  }
});

/**
 * DELETE /api/users/:id/client-projects/:projectId
 * Desasignar un proyecto de un cliente
 */
router.delete('/:id/client-projects/:projectId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase
      .from('client_user_projects')
      .delete()
      .eq('user_id', req.params.id)
      .eq('client_project_id', req.params.projectId);

    if (error) throw error;
    res.json({ message: 'Proyecto desasignado' });
  } catch (error) {
    console.error('Error al desasignar proyecto:', error);
    res.status(500).json({ error: 'Error al desasignar proyecto' });
  }
});

export default router;