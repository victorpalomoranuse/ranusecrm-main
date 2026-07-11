import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabase.js';
import { authenticateToken } from '../middleware/auth.middleware.js';

const router = express.Router();

/**
 * POST /api/auth/login
 * Login de usuarios (admin, trabajador, cliente)
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validación
    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Email y contraseña son requeridos' 
      });
    }

    // Buscar usuario por email
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (error || !user) {
      return res.status(401).json({ 
        error: 'Credenciales inválidas' 
      });
    }

    // Verificar contraseña
    const validPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!validPassword) {
      return res.status(401).json({ 
        error: 'Credenciales inválidas' 
      });
    }

    // Si es trabajador, cargar su perfil de empleado (nombre + rol + permisos)
    let name = null;
    let permissions = null;
    let puesto = null;
    if (user.role === 'trabajador') {
      const { data: employee } = await supabase
        .from('employees')
        .select('name, permissions, active, employee_roles(name, permissions)')
        .eq('email', user.email)
        .single();

      if (employee) {
        if (employee.active === false) {
          return res.status(403).json({ error: 'Tu cuenta está desactivada. Contacta con el administrador.' });
        }
        name = employee.name;
        // Los permisos del rol asignado mandan; si no tiene rol, se usa el
        // campo legado employees.permissions (empleados creados antes del sistema de roles).
        permissions = employee.employee_roles?.permissions || employee.permissions || {};
        puesto = employee.employee_roles?.name || null;
      }
    }

    // Generar JWT token
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        role: user.role,
        ...(permissions !== null && { permissions })
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Respuesta
    res.json({
      message: 'Login exitoso',
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        ...(name !== null && { name }),
        ...(puesto !== null && { puesto }),
        ...(permissions !== null && { permissions })
      }
    });

  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ 
      error: 'Error al procesar el login' 
    });
  }
});

/**
 * POST /api/auth/verify
 * Verificar si el token es válido
 */
router.post('/verify', authenticateToken, async (req, res) => {
  let name = null;
  let puesto = null;
  let permissions = req.user.permissions;
  let refreshedToken = null;

  if (req.user.role === 'trabajador') {
    const { data: employee } = await supabase
      .from('employees')
      .select('name, permissions, active, employee_roles(name, permissions)')
      .eq('email', req.user.email)
      .single();

    if (employee) {
      if (employee.active === false) {
        return res.status(403).json({ error: 'Tu cuenta está desactivada. Contacta con el administrador.' });
      }
      name = employee.name;
      puesto = employee.employee_roles?.name || null;
      permissions = employee.employee_roles?.permissions || employee.permissions || {};

      // Reemitir el token con los permisos actuales, por si el rol cambió
      // desde el último login (sin esto, el cambio no se aplicaría hasta que caduque el JWT).
      refreshedToken = jwt.sign(
        { id: req.user.id, email: req.user.email, role: req.user.role, permissions },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );
    }
  }

  res.json({
    valid: true,
    ...(refreshedToken && { token: refreshedToken }),
    user: {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
      ...(name !== null && { name }),
      ...(puesto !== null && { puesto }),
      ...(permissions !== undefined && { permissions })
    }
  });
});

/**
 * POST /api/auth/logout
 * Logout
 */
router.post('/logout', authenticateToken, (req, res) => {
  res.json({ 
    message: 'Logout exitoso' 
  });
});

export default router;
