import { createContext, useContext } from 'react';

// ¿Puede esta persona descargar? Solo con usuario (equipo, o cliente con el proyecto asignado). Con el enlace a secas, el proyecto
// se ve como un portfolio. El servidor lo comprueba también: esto solo decide qué botones se enseñan.
export const PermisoDescarga = createContext(false);
export const usePuedeDescargar = () => useContext(PermisoDescarga);

// sesiones guardadas en este navegador: equipo (admin/equipo) y cliente. Se prueban en orden hasta que una tenga acceso al proyecto.
export function tokensSesion() {
  try { return ['admin_token', 'equipo_token', 'cliente_token'].map(k => localStorage.getItem(k)).filter(Boolean); } catch { return []; }
}

// descarga un archivo grande del portal: se pide un enlace firmado de 2 minutos con la sesión y el navegador lo descarga directamente
export async function descargarPortal(code, archivo) {
  const base = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
  let d = {}, ok = false;
  for (const tk of tokensSesion()) {
    const r = await fetch(`${base}/historia-publica/${encodeURIComponent(code)}/enlace`, { method: 'POST', headers: { Authorization: 'Bearer ' + tk } });
    d = await r.json().catch(() => ({}));
    if (r.ok && d.token) { ok = true; break; }
  }
  if (!ok) throw new Error(d.error || 'Para descargar necesitas acceder con tu usuario');
  window.location.href = `${base}/historia-publica/${encodeURIComponent(code)}/${archivo}?d=${encodeURIComponent(d.token)}`;
}

// botón de descarga; sin permiso no se pinta
export function BotonDescarga({ code, archivo, className, style, children }) {
  const puede = usePuedeDescargar();
  if (!puede) return null;
  return <button type="button" className={className} style={style} onClick={() => descargarPortal(code, archivo).catch(e => window.alert(e.message))}>{children}</button>;
}

// solo se enseña a quien puede descargar
export function SoloConPermiso({ children }) {
  return usePuedeDescargar() ? children : null;
}
