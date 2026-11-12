import express from 'express';
import crypto from 'crypto';
import { supabase } from '../config/supabase.js';
import { leerModelosBib } from '../utils/modelos-bib.js';

// Tour 360° para el cliente: enlace de solo lectura con las paradas (panorámicas guardadas en la galería del plano y marcadas como «tour»).
// La firma es un HMAC del id del plano con el secreto del servidor: no se guarda nada y solo sirve para ese plano.
export function firmaTour(id) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET || 'sin-secreto').update(`tour:${id}`).digest('base64url').slice(0, 24);
}

// Paradas del tour de un plano, con su posición (en metros) y hacia dónde miraba la cámara al hacerlas
export function paradasDeTour(escena3d) {
  return (escena3d?.renders || []).filter(r => r.tipo === '360' && r.tour && r.meta?.camara && Number.isFinite(r.meta.camara.px))
    .sort((a, b) => (b.entrada ? 1 : 0) - (a.entrada ? 1 : 0) || String(a.creado).localeCompare(String(b.creado)))
    .map(r => {
      const c = r.meta.camara;
      return { id: r.id, nombre: r.nombre, nota: r.nota || '', url: r.url, thumb: r.thumb, x: c.px, z: c.pz, yaw: Math.atan2((c.tx ?? c.px) - c.px, (c.tz ?? c.pz + 1) - c.pz) };
    });
}

const router = express.Router();

router.get('/:id/:firma', async (req, res) => {
  try {
    const { id, firma } = req.params, esperada = firmaTour(id);
    if (firma.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return res.status(403).json({ error: 'Enlace no válido' });
    const { data, error } = await supabase.from('mediciones').select('nombre, data').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Tour no encontrado' });
    const paradas = paradasDeTour(data.data?.escena3d);
    if (!paradas.length) return res.status(404).json({ error: 'Este tour todavía no tiene paradas' });
    res.set('Cache-Control', 'no-store');
    res.json({ titulo: data.nombre || 'Tour', paradas });
  } catch (err) {
    console.error('tour-publico:', err);
    res.status(500).json({ error: 'No se pudo cargar el tour' });
  }
});

// Lo que necesita el visor 3D en modo cliente para recorrer el espacio: el modelo, la escena (acabados, luces, objetos) y los puntos de luz del plano.
// No se envía el resto de datos del plano (notas, importes, etc.).
router.get('/:id/:firma/plano', async (req, res) => {
  try {
    const { id, firma } = req.params, esperada = firmaTour(id);
    if (firma.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return res.status(403).json({ error: 'Enlace no válido' });
    const { data, error } = await supabase.from('mediciones').select('id, nombre, data, updated_at').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Plano no encontrado' });
    const d = data.data || {};
    res.set('Cache-Control', 'no-store');
    res.json({ plano: { nombre: data.nombre || d.nombre || 'Tour', modelo3d: d.modelo3d || null, escena3d: d.escena3d || null, nodes: d.nodes || [], pts: (d.pts || []).filter(p => p.v === 'ilum'), id: data.id, updated: new Date(data.updated_at).getTime() } });
  } catch (err) {
    console.error('tour-publico plano:', err);
    res.status(500).json({ error: 'No se pudo cargar el espacio' });
  }
});

// Modelos 3D de las máquinas que usa ese plano (y los genéricos de la biblioteca): sin esto el recorrido del cliente solo veía cajas.
// Solo se envía lo necesario para dibujarlas: id, medidas y modelo; nada de precios, enlaces ni fotos.
router.get('/:id/:firma/catalogo', async (req, res) => {
  try {
    const { id, firma } = req.params, esperada = firmaTour(id);
    if (firma.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return res.status(403).json({ error: 'Enlace no válido' });
    const { data, error } = await supabase.from('mediciones').select('data').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Plano no encontrado' });
    const cids = new Set(); for (const m of JSON.stringify(data.data || {}).matchAll(/"cid":"([^"]{1,80})"/g)) cids.add(m[1]);
    const uuids = [...cids].filter(c => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(c)).slice(0, 400);
    const maquinas = [];
    if (uuids.length) {
      const { data: ps } = await supabase.from('catalog_products').select('id, name, longitud, ancho, altura, bloques').in('id', uuids);
      for (const p of ps || []) { const m = p.bloques?.modelo3d; if (!m?.url) continue; maquinas.push({ id: p.id, nombre: p.name, w: Number(p.longitud) > 0 ? Number(p.longitud) : 100, d: Number(p.ancho) > 0 ? Number(p.ancho) : 80, alto: Number(p.altura) > 0 ? Number(p.altura) : null, modelo3d: { url: m.url, tipo: m.tipo || 'glb', rot: Number(m.rot) || 0, alineado: !!m.alineado, bytes: Number(m.bytes) || 0 } }); }
    }
    const mb = await leerModelosBib().catch(() => ({})), modelosGen = {};
    for (const [k, v] of Object.entries(mb)) {
      if (!v?.url) continue;
      if (!k.startsWith('bib-')) modelosGen[k] = { url: v.url, tipo: v.tipo || 'glb', rot: Number(v.rot) || 0 };
      else if (k.startsWith('bib-') && cids.has(k)) maquinas.push({ id: k, nombre: v.nombre || k, w: 100, d: 80, alto: null, modelo3d: { url: v.url, tipo: v.tipo || 'glb', rot: Number(v.rot) || 0, alineado: !!v.alineado, bytes: Number(v.bytes) || 0 } });
    }
    res.set('Cache-Control', 'no-store');
    res.json({ maquinas, modelosGen, luminarias: [], materiales: [] });
  } catch (err) {
    console.error('tour-publico catalogo:', err);
    res.status(500).json({ error: 'No se pudo cargar el catálogo' });
  }
});

export default router;
