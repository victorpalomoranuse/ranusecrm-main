import jwt from 'jsonwebtoken';

/**
 * Middleware para verificar el token JWT
 */
export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // "Bearer TOKEN"

  if (!token) {
    return res.status(401).json({ 
      error: 'Token de autenticación requerido' 
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ 
        error: 'Token inválido o expirado' 
      });
    }

    // Añadir información del usuario a la request
    req.user = user;
    next();
  });
};

/**
 * Middleware para verificar si el usuario es admin o trabajador
 */
export const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ 
      error: 'Autenticación requerida' 
    });
  }

  if (req.user.role !== 'admin_superior' && req.user.role !== 'trabajador') {
    return res.status(403).json({ 
      error: 'Acceso denegado. Se requiere rol de administrador.' 
    });
  }

  next();
};

/**
 * Middleware para verificar si el usuario es admin superior
 */
export const requireAdminSuperior = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ 
      error: 'Autenticación requerida' 
    });
  }

  if (req.user.role !== 'admin_superior') {
    return res.status(403).json({ 
      error: 'Acceso denegado. Se requiere rol de admin superior.' 
    });
  }

  next();
};

/**
 * Middleware para verificar si el usuario es cliente
 */
export const requireClient = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ 
      error: 'Autenticación requerida' 
    });
  }

  if (req.user.role !== 'cliente') {
    return res.status(403).json({ 
      error: 'Acceso denegado. Esta ruta es solo para clientes.' 
    });
  }

  next();
};

/**
 * Middleware para verificar si es admin o es el propio cliente
 */
export const requireAdminOrOwner = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ 
      error: 'Autenticación requerida' 
    });
  }

  const isAdmin = req.user.role === 'admin_superior' || req.user.role === 'trabajador';
  const isOwner = req.user.id === req.params.userId || req.user.id === req.params.clientId;

  if (!isAdmin && !isOwner) {
    return res.status(403).json({ 
      error: 'Acceso denegado.' 
    });
  }

  next();
};