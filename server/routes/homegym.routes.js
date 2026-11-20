import express from 'express';
import crypto from 'crypto';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';
import { montaGymGlb } from '../utils/homegym-ar.js';

// Home Gym Studio: la parte pública (catálogo y solicitud de equipamiento) y la del equipo (revisar solicitudes y elegir qué máquinas salen).
const router = express.Router();

export const TIPOS_HOMEGYM = ['rack', 'banco', 'discos', 'mancu', 'polea', 'cinta', 'bici', 'remo', 'kettle', 'cajon'];
const SOLO_TEXTO = (v, max = 200) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, max);
const num = (v, d, mn, mx) => { const n = Number(v); return Number.isFinite(n) ? Math.min(mx, Math.max(mn, n)) : d; };

// Límite sencillo por IP (en memoria): evita que alguien llene el CRM de solicitudes falsas
const intentos = new Map();
function limitaIP(req) {
  const ip = req.ip || 'x', ahora = Date.now(), ventana = 60 * 60 * 1000;
  const lista = (intentos.get(ip) || []).filter(t => ahora - t < ventana);
  if (lista.length >= 6) return false;
  lista.push(ahora); intentos.set(ip, lista);
  if (intentos.size > 5000) intentos.clear();
  return true;
}

// ── Público: catálogo para la herramienta (sin comisiones ni precios de compra) ──
router.get('/catalogo', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('catalog_products')
      .select('id, name, brand, price, longitud, ancho, altura, photo_url, link, homegym_tipo, homegym_orden, bloques')
      .not('homegym_tipo', 'is', null);
    if (error) throw error;
    const productos = (data || []).filter(p => TIPOS_HOMEGYM.includes(p.homegym_tipo) && Number(p.longitud) > 0 && Number(p.ancho) > 0 && Number(p.altura) > 0)
      .map(p => ({
        id: p.id, nombre: p.name, marca: p.brand || '', precio: Number(p.price) || 0,
        w: Number(p.longitud), d: Number(p.ancho), h: Number(p.altura),
        foto: p.photo_url || null, enlace: p.link || null, tipo: p.homegym_tipo, orden: Number(p.homegym_orden) || 0,
        modelo3d: p.bloques?.modelo3d?.url ? { url: p.bloques.modelo3d.url, tipo: p.bloques.modelo3d.tipo || 'glb', rot: Number(p.bloques.modelo3d.rot) || 0 } : null,
      }));
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ productos });
  } catch (err) {
    console.error('Home Gym · catálogo:', err);
    res.status(500).json({ error: 'No se pudo cargar el catálogo' });
  }
});

// ── Público: solicitud de equipamiento (cae en el CRM para revisarla) ──
router.post('/solicitud', async (req, res) => {
  try {
    if (req.body?.web) return res.json({ ok: true, ref: 'HG-0000' }); // campo trampa para bots
    if (!limitaIP(req)) return res.status(429).json({ error: 'Has enviado varias solicitudes seguidas. Inténtalo más tarde.' });

    const nombre = SOLO_TEXTO(req.body?.contacto?.nombre, 80);
    const email = SOLO_TEXTO(req.body?.contacto?.email, 120);
    const telefono = SOLO_TEXTO(req.body?.contacto?.telefono, 30);
    if (nombre.length < 2) return res.status(400).json({ error: 'Escribe tu nombre' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && telefono.replace(/\D/g, '').length < 7) return res.status(400).json({ error: 'Deja un email o un teléfono válido' });
    if (!req.body?.acepto) return res.status(400).json({ error: 'Acepta la política de privacidad para continuar' });

    const ids = [...new Set((Array.isArray(req.body?.items) ? req.body.items : []).map(i => String(i)).filter(i => /^[0-9a-f-]{36}$/i.test(i)))].slice(0, 20);
    if (!ids.length) return res.status(400).json({ error: 'No hay equipamiento elegido' });

    // Los precios y marcas se leen del catálogo, no de lo que mande el navegador
    const { data: prods, error: e1 } = await supabase.from('catalog_products').select('id, name, brand, price, link, homegym_tipo, homegym_comision').in('id', ids).not('homegym_tipo', 'is', null);
    if (e1) throw e1;
    if (!prods?.length) return res.status(400).json({ error: 'El equipamiento elegido ya no está disponible' });
    const items = prods.map(p => ({ id: p.id, nombre: p.name, marca: p.brand || '', precio: Number(p.price) || 0, enlace: p.link || null, comision_pct: p.homegym_comision != null ? Number(p.homegym_comision) : null }));
    const total = items.reduce((a, i) => a + i.precio, 0);
    const comisionEst = items.reduce((a, i) => a + (i.comision_pct != null ? i.precio * i.comision_pct / 100 : 0), 0);

    const e = req.body?.espacio || {};
    const espacio = {
      largo: num(e.L, 0, 100, 2000), ancho: num(e.W, 0, 100, 2000), alto: num(e.H, 0, 180, 500),
      puerta: ['arriba', 'abajo', 'izq', 'der'].includes(e.door) ? e.door : 'abajo',
      objetivo: ['fuerza', 'cardio', 'mixto', 'func'].includes(e.goal) ? e.goal : 'mixto',
      personas: num(e.people, 1, 1, 3), presupuesto: num(e.budget, 0, 0, 100000),
      origen: ['escrito', 'plano', 'movil'].includes(e.mode) ? e.mode : 'escrito',
    };
    const ref = 'HG-' + crypto.randomBytes(3).toString('hex').toUpperCase();

    // 1) Lead nuevo en Métricas / Setting, para que lo vea el equipo donde ya trabaja
    const resumen = items.map(i => `${i.nombre}${i.marca ? ' (' + i.marca + ')' : ''}`).join(', ');
    const { data: lead } = await supabase.from('setting_leads').insert({
      nombre, telefono: telefono || null, email: email || null, canal: 'Otro', estado: 'nuevo',
      objetivo: `Home Gym Studio · ${espacio.objetivo}, ${espacio.personas} persona(s), presupuesto ${espacio.presupuesto || '—'} €`,
      medidas: `${(espacio.largo / 100).toFixed(1)} × ${(espacio.ancho / 100).toFixed(1)} m, techo ${(espacio.alto / 100).toFixed(2)} m`,
      maquinarias: resumen.slice(0, 1500),
      notas: `Solicitud ${ref} desde Home Gym Studio. Total equipos ${Math.round(total)} €.`,
    }).select('id').single();

    // 2) Detalle completo de la solicitud (si la migración v94 aún no está aplicada, el lead de arriba ya basta)
    const { error: e2 } = await supabase.from('homegym_solicitudes').insert({
      ref, nombre, email: email || null, telefono: telefono || null, espacio, items, total, comision_est: comisionEst, setting_lead_id: lead?.id || null,
    });
    if (e2) console.error('Home Gym · guardar solicitud:', e2.message);

    res.status(201).json({ ok: true, ref });
  } catch (err) {
    console.error('Home Gym · solicitud:', err);
    res.status(500).json({ error: 'No se pudo enviar la solicitud. Inténtalo de nuevo.' });
  }
});

// ── Público: el gym completo colocado y a tamaño real, en un solo .glb para verlo en realidad aumentada ──
// Las medidas y los modelos salen del catálogo; del navegador solo se aceptan los ids y dónde coloca cada máquina el motor.
const arCache = new Map(); // hash → { buf, t }
const arIntentos = new Map();
function limitaAR(req) {
  const ip = req.ip || 'x', ahora = Date.now();
  const lista = (arIntentos.get(ip) || []).filter(t => ahora - t < 60 * 60 * 1000);
  if (lista.length >= 30) return false;
  lista.push(ahora); arIntentos.set(ip, lista);
  if (arIntentos.size > 5000) arIntentos.clear();
  return true;
}
router.post('/ar', async (req, res) => {
  try {
    if (!limitaAR(req)) return res.status(429).json({ error: 'Demasiadas vistas seguidas. Inténtalo en un rato.' });
    const sala = { L: num(req.body?.sala?.L, 0, 100, 2000), W: num(req.body?.sala?.W, 0, 100, 2000), door: ['arriba', 'abajo', 'izq', 'der'].includes(req.body?.sala?.door) ? req.body.sala.door : 'abajo' };
    const pedidos = (Array.isArray(req.body?.items) ? req.body.items : []).slice(0, 12)
      .filter(i => /^[0-9a-f-]{36}$/i.test(String(i?.id)))
      .map(i => ({ id: String(i.id), x: num(i.x, 0, -50, 2000), y: num(i.y, 0, -50, 2000), w: num(i.w, 0, 10, 400), d: num(i.d, 0, 10, 400) }));
    if (!sala.L || !sala.W || !pedidos.length) return res.status(400).json({ error: 'Faltan datos de la sala o del equipamiento' });

    const { data: prods, error } = await supabase.from('catalog_products').select('id, name, longitud, ancho, altura, homegym_tipo, bloques').in('id', pedidos.map(p => p.id)).not('homegym_tipo', 'is', null);
    if (error) throw error;
    const porId = new Map((prods || []).map(p => [p.id, p]));
    const items = pedidos.map(p => {
      const pr = porId.get(p.id); if (!pr) return null;
      const girada = Math.abs(p.w - Number(pr.longitud)) > 1 && Math.abs(p.w - Number(pr.ancho)) <= 1;
      const m = pr.bloques?.modelo3d;
      return { nombre: pr.name, x: p.x, y: p.y, w: p.w, d: p.d, h: Number(pr.altura) || 100, cat: ({ rack: 'fuerza', banco: 'fuerza', discos: 'fuerza', mancu: 'fuerza', polea: 'fuerza', cinta: 'cardio', bici: 'cardio', remo: 'cardio' })[pr.homegym_tipo] || 'func',
        rot: (Number(m?.rot) || 0) + (girada ? 90 : 0), modelo3d: m?.url && (m.tipo || 'glb') === 'glb' ? { url: m.url } : null };
    }).filter(Boolean);
    if (!items.length) return res.status(400).json({ error: 'El equipamiento elegido ya no está disponible' });

    const hash = crypto.createHash('sha1').update(JSON.stringify([sala, items.map(i => [i.nombre, i.x, i.y, i.w, i.d, i.h, i.rot, i.modelo3d?.url || ''])])).digest('hex').slice(0, 20);
    if (!arCache.has(hash)) {
      const buf = await montaGymGlb(items, sala);
      arCache.set(hash, { buf, t: Date.now() });
      if (arCache.size > 30) arCache.delete(arCache.keys().next().value);
    }
    res.json({ path: `/homegym/ar/${hash}.glb`, modelos: items.filter(i => i.modelo3d).length, cajas: items.filter(i => !i.modelo3d).length });
  } catch (err) {
    console.error('Home Gym · AR:', err);
    res.status(500).json({ error: 'No se pudo preparar la vista en realidad aumentada' });
  }
});
router.get('/ar/:hash.glb', (req, res) => {
  const e = arCache.get(String(req.params.hash));
  if (!e) return res.status(404).json({ error: 'La vista caducó. Vuelve a abrirla.' });
  res.set({ 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' });
  res.send(e.buf);
});

// ── Equipo: solicitudes recibidas ──
router.get('/solicitudes', authenticateToken, requirePermission('leads'), async (req, res) => {
  try {
    const { data, error } = await supabase.from('homegym_solicitudes').select('*').order('created_at', { ascending: false }).limit(300);
    if (error) throw error;
    res.json({ solicitudes: data || [] });
  } catch (err) {
    console.error('Home Gym · listar solicitudes:', err);
    res.status(500).json({ error: 'No se pudieron cargar las solicitudes (¿está aplicada la migración v94?)' });
  }
});

router.put('/solicitudes/:id', authenticateToken, requirePermission('leads'), async (req, res) => {
  try {
    const cambios = { updated_at: new Date().toISOString() };
    if (['nueva', 'en_revision', 'enviada_marca', 'cerrada', 'descartada'].includes(req.body?.estado)) cambios.estado = req.body.estado;
    if (req.body?.nota_equipo !== undefined) cambios.nota_equipo = SOLO_TEXTO(req.body.nota_equipo, 2000);
    const { data, error } = await supabase.from('homegym_solicitudes').update(cambios).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json({ solicitud: data });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo guardar' });
  }
});

// ── Equipo: elegir qué máquinas del catálogo salen en la herramienta ──
router.get('/admin/catalogo', authenticateToken, requirePermission('catalogo'), async (req, res) => {
  try {
    const { data, error } = await supabase.from('catalog_products')
      .select('id, name, brand, price, longitud, ancho, altura, photo_url, homegym_tipo, homegym_orden, homegym_comision')
      .order('brand', { ascending: true }).order('name', { ascending: true });
    if (error) throw error;
    res.json({ productos: data || [], tipos: TIPOS_HOMEGYM });
  } catch (err) {
    console.error('Home Gym · catálogo admin:', err);
    res.status(500).json({ error: 'No se pudo cargar el catálogo (¿está aplicada la migración v94?)' });
  }
});

router.put('/admin/catalogo/:id', authenticateToken, requirePermission('catalogo'), async (req, res) => {
  try {
    const tipo = req.body?.tipo ? String(req.body.tipo) : null;
    if (tipo && !TIPOS_HOMEGYM.includes(tipo)) return res.status(400).json({ error: 'Tipo no válido' });
    const com = req.body?.comision === '' || req.body?.comision == null ? null : num(req.body.comision, null, 0, 100);
    const { error } = await supabase.from('catalog_products').update({
      homegym_tipo: tipo, homegym_orden: Math.round(num(req.body?.orden, 0, 0, 5)), homegym_comision: com,
    }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo guardar' });
  }
});

export default router;
