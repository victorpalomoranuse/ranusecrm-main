// Claves de identidad de una persona (instagram/email/teléfono normalizados),
// usadas para detectar si dos registros de venta son el mismo cliente, sin
// necesidad de una tabla de "clientes" separada.
export function clavesIdentidad(l) {
  const claves = [];
  if (l.instagram) claves.push('ig:' + l.instagram.trim().toLowerCase().replace(/^@/, ''));
  if (l.email) claves.push('email:' + l.email.trim().toLowerCase());
  if (l.telefono) claves.push('tel:' + l.telefono.replace(/\D/g, ''));
  return claves.filter(k => k.length > 4); // evita cruces por campos casi vacíos
}
