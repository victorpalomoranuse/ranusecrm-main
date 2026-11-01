// Render final en la nube (Blender Cycles). INTERFAZ PREPARADA, NO IMPLEMENTADA: ningún servicio está conectado todavía.
// Cuando exista un proveedor, solo hay que completar enviarARenderNube y consultarRenderNube (y la ruta del servidor server/routes/render-nube.routes.js).
import api from '../services/api';

export async function renderNubeDisponible() {
  try { const { data } = await api.get('/render-nube/estado'); return data; } catch { return { disponible: false, motores: [], motivo: 'No se pudo consultar el servicio.' }; }
}

// escena = { glb: Blob, camara: { px, py, pz, tx, ty, tz, fov }, resolucion: { ancho, alto }, muestras, motor }
export async function enviarARenderNube(/* escena */) {
  throw new Error('El render en la nube todavía no está disponible.');
}

export async function consultarRenderNube(/* trabajoId */) {
  throw new Error('El render en la nube todavía no está disponible.');
}
