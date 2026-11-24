// Render realista en la nube (Blender Cycles en una GPU de RunPod). Servidor: server/routes/render-nube.routes.js; worker: server/render-worker.
import api from '../services/api';

export async function renderNubeDisponible() {
  try { const { data } = await api.get('/render-nube/estado'); return data; } catch { return { disponible: false, motores: [], motivo: 'No se pudo consultar el servicio.' }; }
}

const subir = async (url, cuerpo, tipo) => {
  const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': tipo, 'x-upsert': 'true' }, body: cuerpo });
  if (!r.ok) { let d = ''; try { d = (await r.text()).slice(0, 160); } catch { /* sin detalle */ } throw new Error('No se pudo subir la escena (' + r.status + ', ' + Math.round((cuerpo.size || 0) / 1048576 * 10) / 10 + ' MB)' + (d ? ': ' + d : '')); }
};
const esperar = ms => new Promise(r => setTimeout(r, ms));

// escena = { glb: Blob, info: { camara, luces, … }, calidad: 'previa' | 'hd' | '8k', exposicion, alAvanzar(texto) }. Devuelve la URL de la imagen.
export async function lanzarRenderNube({ glb, info, calidad = 'hd', exposicion = 3, alAvanzar = () => {}, galeria = null }) {
  alAvanzar('Subiendo la escena…');
  let t; try { t = (await api.post('/render-nube/crear')).data; } catch (e) { throw new Error('No se pudo preparar el render (' + (e.response?.status || 'sin conexión') + '): ' + (e.response?.data?.error || e.message)); }
  // Supabase no admite archivos de más de ~50 MB: si la escena pesa más, se sube comprimida y el servidor la descomprime para el worker
  let comprimida = false;
  if (glb.size > 45 * 1048576) {
    if (typeof CompressionStream === 'undefined') throw new Error('La escena pesa ' + Math.round(glb.size / 1048576) + ' MB y este navegador no puede comprimirla. Usa Chrome o Edge actualizado.');
    alAvanzar('Comprimiendo la escena (' + Math.round(glb.size / 1048576) + ' MB)…');
    const gz = await new Response(glb.stream().pipeThrough(new CompressionStream('gzip'))).blob();
    if (gz.size > 49 * 1048576) throw new Error('La escena sigue pesando demasiado (' + Math.round(gz.size / 1048576) + ' MB comprimida). Oculta alguna máquina muy detallada o renderiza una zona más pequeña.');
    alAvanzar('Subiendo la escena…');
    await subir(t.escenaGz, gz, 'application/gzip'); comprimida = true;
  } else await subir(t.escena, glb, 'model/gltf-binary');
  await subir(t.luces, new Blob([JSON.stringify(info)], { type: 'application/json' }), 'application/json');
  alAvanzar('Enviando a la GPU…');
  try { await api.post('/render-nube/iniciar', { id: t.id, calidad, exposicion, comprimida, galeria }); } catch (e) { throw new Error('No se pudo lanzar el render (' + (e.response?.status || 'sin conexión') + '): ' + (e.response?.data?.error || e.message) + (e.response?.data?.detalle ? ' · ' + JSON.stringify(e.response.data.detalle).slice(0, 120) : '')); }
  return t.id;
}

// Espera a que termine un render ya lanzado y devuelve la URL de la imagen.
export async function esperarRenderNube(id, alAvanzar = () => {}, completo = false) {
  const t0 = Date.now();
  for (;;) {
    await esperar(3000);
    const { data } = await api.get('/render-nube/estado/' + id);
    if (data.estado === 'listo' && data.url) return completo ? data : data.url;
    if (data.estado === 'error') throw new Error(data.mensaje || 'El render ha fallado');
    alAvanzar((data.estado === 'en_cola' ? 'En cola' : 'Renderizando') + ' · ' + Math.round((Date.now() - t0) / 1000) + ' s');
    if (Date.now() - t0 > 30 * 60 * 1000) throw new Error('El render tarda demasiado. Inténtalo de nuevo.');
  }
}

export async function enviarARenderNube(o) { const id = await lanzarRenderNube(o); return esperarRenderNube(id, o.alAvanzar); }
