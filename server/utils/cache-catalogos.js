// Caché corta del catálogo que usa la herramienta de planos (/api/medicion/catalogos): son más de mil bloques con su dibujo y
// miniaturas, y recalcularlo en cada apertura tardaba segundos. Se guarda un minuto y se vacía en cuanto alguien cambia el catálogo
// o la biblioteca de bloques.
const TTL_MS = 60 * 1000;
const guardado = new Map();
export const catalogoEnCache = (clave) => { const h = guardado.get(clave); return h && Date.now() - h.t < TTL_MS ? h.body : null; };
export const guardaCatalogo = (clave, body) => { guardado.set(clave, { t: Date.now(), body }); };
export const invalidarCatalogos = () => { guardado.clear(); };
// middleware: tras cualquier cambio (POST, PUT, PATCH, DELETE) que termine, se vacía la caché
export const vaciaCacheAlEscribir = (req, res, next) => { if (req.method !== 'GET' && req.method !== 'OPTIONS') res.on('finish', invalidarCatalogos); next(); };
