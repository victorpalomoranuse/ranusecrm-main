import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabase.js';

// El enlace de un proyecto (su código) sirve para VER el proyecto, como en un portfolio. Las descargas (PDF, ZIP de renders,
// documentos y entregables) solo son para quien entra con su usuario: el equipo, o un cliente con ese proyecto asignado.
// Los botones de descarga piden un enlace firmado de 2 minutos (así el navegador descarga archivos grandes sin cargarlos en memoria)
export const firmaDescarga = (projectId) => jwt.sign({ p: projectId, f: 'descarga' }, process.env.JWT_SECRET, { expiresIn: '2m' });
function enlaceValido(req, projectId) {
  const d = String(req.query?.d || '');
  if (!d) return false;
  try { const x = jwt.verify(d, process.env.JWT_SECRET); return x.f === 'descarga' && x.p === projectId; } catch { return false; }
}

export function usuarioOpcional(req) {
  const token = String(req.headers?.authorization || '').split(' ')[1];
  if (!token) return null;
  try { return jwt.verify(token, process.env.JWT_SECRET); } catch { return null; }
}

export async function puedeDescargar(req, projectId) {
  if (enlaceValido(req, projectId)) return true;
  const u = usuarioOpcional(req);
  if (!u) return false;
  if (u.role === 'admin_superior' || u.role === 'trabajador') return true;
  if (u.role === 'cliente') {
    const { data } = await supabase.from('client_user_projects').select('id').eq('user_id', u.id).eq('client_project_id', projectId).maybeSingle();
    return !!data;
  }
  return false;
}
