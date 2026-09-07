import jwt from 'jsonwebtoken';

// Token de muy corta duración para que el propio backend se llame a sí mismo
// (localhost) cuando una acción automática necesita pasar por una ruta ya
// protegida por authenticateToken/requireAdminSuperior — por ejemplo, que el
// Asistente IA genere y guarde el PDF de un presupuesto que acaba de crear.
// No se expone nunca al cliente ni se guarda en ningún sitio.
export function internalAdminToken() {
  return jwt.sign(
    { id: 'internal-system', email: 'sistema@ranusedesign.com', role: 'admin_superior' },
    process.env.JWT_SECRET,
    { expiresIn: '2m' }
  );
}
