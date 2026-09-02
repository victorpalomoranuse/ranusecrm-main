import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { supabase } from '../config/supabase.js';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { sendEmail } from '../services/email.service.js';

const router = express.Router();
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://ranusedesign.com';

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

    // Cliente: nombre que puso al registrarse (o nulo, para cuentas creadas
    // antes de que existiera este campo).
    if (user.role === 'cliente') {
      name = user.name || null;
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

  if (req.user.role === 'cliente') {
    const { data: u } = await supabase.from('users').select('name').eq('id', req.user.id).maybeSingle();
    name = u?.name || null;
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

/**
 * POST /api/auth/register
 * Alta de cliente por sí mismo (nombre + email + contraseña). La cuenta
 * queda activa al momento; el admin puede enlazarla a un proyecto/venta
 * después desde el panel.
 */
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name?.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    if (!EMAIL_REGEX.test(email)) return res.status(400).json({ error: 'Formato de email inválido' });
    if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

    const emailNorm = email.toLowerCase().trim();
    const { data: existing } = await supabase.from('users').select('id').eq('email', emailNorm).maybeSingle();
    if (existing) return res.status(400).json({ error: 'Ya existe una cuenta con ese email' });

    const passwordHash = await bcrypt.hash(password, 10);
    const { data: user, error } = await supabase
      .from('users')
      .insert({ email: emailNorm, password_hash: passwordHash, role: 'cliente', name: name.trim() })
      .select('id, email, role, name, created_at')
      .single();
    if (error) throw error;

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });

    sendEmail({
      to: user.email,
      subject: 'Bienvenido/a a Ranuse Design',
      html: `<p>Hola ${user.name},</p><p>Tu cuenta en el área de clientes de Ranuse Design ya está activa. Ya puedes entrar con tu email y contraseña.</p><p>— Ranuse Design</p>`,
    }).catch(() => {});

    res.status(201).json({
      message: 'Cuenta creada correctamente',
      token,
      user: { id: user.id, email: user.email, role: user.role, name: user.name },
    });
  } catch (error) {
    console.error('Error en registro:', error);
    res.status(500).json({ error: 'Error al crear la cuenta' });
  }
});

/**
 * POST /api/auth/forgot-password
 * Genera un enlace de un solo uso (caduca en 1h) y lo envía por email. La
 * respuesta es siempre la misma exista o no el email, para no revelar qué
 * correos están registrados.
 */
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requerido' });

    const emailNorm = email.toLowerCase().trim();
    const { data: user } = await supabase.from('users').select('id, email, name').eq('email', emailNorm).maybeSingle();

    if (user) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1h

      const { error: errInsert } = await supabase
        .from('password_resets')
        .insert({ user_id: user.id, token_hash: tokenHash, expires_at: expiresAt });
      if (errInsert) throw errInsert;

      const resetUrl = `${FRONTEND_URL}/cliente/restablecer?token=${rawToken}`;
      sendEmail({
        to: user.email,
        subject: 'Restablecer tu contraseña — Ranuse Design',
        html: `<p>Hola${user.name ? ' ' + user.name : ''},</p><p>Pulsa el siguiente enlace para elegir una nueva contraseña (caduca en 1 hora):</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>Si no has pedido esto tú, ignora este correo — tu contraseña sigue igual.</p>`,
      }).catch(() => {});
    }

    res.json({ message: 'Si ese email tiene una cuenta, te hemos enviado un enlace para restablecer la contraseña.' });
  } catch (error) {
    console.error('Error en forgot-password:', error);
    res.status(500).json({ error: 'Error al procesar la solicitud' });
  }
});

/**
 * POST /api/auth/reset-password
 * Consume el token del enlace y fija la nueva contraseña.
 */
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token y contraseña son requeridos' });
    if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const { data: reset } = await supabase
      .from('password_resets')
      .select('*')
      .eq('token_hash', tokenHash)
      .is('used_at', null)
      .maybeSingle();

    if (!reset || new Date(reset.expires_at) < new Date()) {
      return res.status(400).json({ error: 'El enlace no es válido o ha caducado. Pide uno nuevo.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const { error: errUpdate } = await supabase.from('users').update({ password_hash: passwordHash }).eq('id', reset.user_id);
    if (errUpdate) throw errUpdate;

    await supabase.from('password_resets').update({ used_at: new Date().toISOString() }).eq('id', reset.id);

    res.json({ message: 'Contraseña actualizada correctamente' });
  } catch (error) {
    console.error('Error en reset-password:', error);
    res.status(500).json({ error: 'Error al restablecer la contraseña' });
  }
});

export default router;
