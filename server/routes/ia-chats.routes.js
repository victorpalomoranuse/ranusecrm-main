import express from 'express';
import sharp from 'sharp';
import crypto from 'crypto';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';
import { uploadProjectRender } from '../utils/storage.js';

// Chat de imágenes: conversaciones con la IA (fotos, logos, ideas) que se guardan, una galería propia y el envío de cada imagen
// a la historia de un proyecto o a la galería de un plano. Todo se guarda en el almacenamiento (crm/ia-chats y crm/ia-galeria).
// El motor que genera las imágenes es el mismo de /api/estudio-ideas/chat.
const router = express.Router();
router.use(authenticateToken, requirePermission('proyectos'));
const BUCKET = 'project-documents', CARPETA = 'crm/ia-chats', GAL = 'crm/ia-galeria';
const uid = () => crypto.randomBytes(5).toString('hex');
const txt = (v, n = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const idOk = (v) => /^[a-f0-9]{6,16}$/.test(String(v || ''));
const urlPublica = (p) => supabase.storage.from(BUCKET).getPublicUrl(p).data.publicUrl;
const BASE_URL = () => urlPublica('x').replace(/x$/, '');

async function leerJson(ruta) {
  try { const { data, error } = await supabase.storage.from(BUCKET).download(ruta); if (error || !data) return null; return JSON.parse(await data.text()); } catch { return null; }
}
async function guardaJson(ruta, obj) {
  const { error } = await supabase.storage.from(BUCKET).upload(ruta, Buffer.from(JSON.stringify(obj)), { contentType: 'application/json', upsert: true, cacheControl: '0' });
  if (error) throw error;
}
// una imagen del chat (data URL) se sube al almacenamiento: las generadas se quedan en PNG; las que sube el usuario, en JPG
async function subeImagen(dataUrl, ruta, comoPng) {
  const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(String(dataUrl || '')); if (!m) return null;
  const buf = Buffer.from(m[2], 'base64'); if (buf.length > 20e6) return null;
  const img = sharp(buf).resize({ width: 2400, withoutEnlargement: true });
  const out = comoPng ? await img.png().toBuffer() : await img.jpeg({ quality: 90 }).toBuffer();
  const { error } = await supabase.storage.from(BUCKET).upload(ruta + (comoPng ? '.png' : '.jpg'), out, { contentType: comoPng ? 'image/png' : 'image/jpeg', upsert: true });
  if (error) throw error;
  return urlPublica(ruta + (comoPng ? '.png' : '.jpg'));
}

// ── conversaciones
router.get('/', async (req, res) => {
  try { const ind = await leerJson(CARPETA + '/_indice.json'); res.json({ chats: (ind?.chats || []).slice(0, 200) }); }
  catch { res.status(500).json({ error: 'No se pudieron leer las conversaciones' }); }
});
router.get('/galeria', async (req, res) => {
  try { const g = await leerJson(GAL + '/_indice.json'); res.json({ items: (g?.items || []).slice(0, 500) }); }
  catch { res.status(500).json({ error: 'No se pudo leer la galería' }); }
});
router.post('/galeria', async (req, res) => {
  try {
    const url = String(req.body?.url || ''); if (!url.startsWith(BASE_URL())) return res.status(400).json({ error: 'Solo se pueden guardar imágenes del chat' });
    const g = (await leerJson(GAL + '/_indice.json')) || { items: [] };
    if (g.items.some(i => i.url === url)) return res.json({ ok: true, ya: true });
    const item = { id: uid(), url, nota: txt(req.body?.nota, 300), nombre: txt(req.body?.nombre, 80), chatId: idOk(req.body?.chatId) ? req.body.chatId : undefined, creado: new Date().toISOString() };
    g.items = [item, ...g.items].slice(0, 1000); await guardaJson(GAL + '/_indice.json', g);
    res.status(201).json({ ok: true, item });
  } catch (e) { console.error('ia-chats galería:', e); res.status(500).json({ error: 'No se pudo guardar en la galería' }); }
});
router.delete('/galeria/:id', async (req, res) => {
  try { const g = (await leerJson(GAL + '/_indice.json')) || { items: [] }; g.items = g.items.filter(i => i.id !== req.params.id); await guardaJson(GAL + '/_indice.json', g); res.json({ ok: true }); }
  catch { res.status(500).json({ error: 'No se pudo quitar de la galería' }); }
});

// ── destinos para enviar una imagen: proyectos del cliente (con sus capítulos de la historia y sus planos)
router.get('/destinos', async (req, res) => {
  try {
    const { data, error } = await supabase.from('projects').select('id, name').order('created_at', { ascending: false }).limit(300); if (error) throw error;
    res.json({ proyectos: (data || []).map(p => ({ id: p.id, nombre: p.name })) });
  } catch { res.status(500).json({ error: 'No se pudieron leer los proyectos' }); }
});
router.get('/destinos/:pid', async (req, res) => {
  try {
    const [c, p] = await Promise.all([
      supabase.from('capitulos').select('id, titulo, orden').eq('proyecto_id', req.params.pid).order('orden'),
      supabase.from('mediciones').select('id, data').eq('project_id', req.params.pid).order('updated_at', { ascending: false }).limit(30),
    ]);
    res.json({ capitulos: (c.data || []).map(x => ({ id: x.id, titulo: x.titulo })), planos: (p.data || []).map(x => ({ id: x.id, nombre: txt(x.data?.nombre || x.data?.titulo || 'Plano', 80) })) });
  } catch { res.status(500).json({ error: 'No se pudieron leer los capítulos y planos' }); }
});
router.post('/enviar', async (req, res) => {
  try {
    const url = String(req.body?.url || ''); if (!url.startsWith(BASE_URL())) return res.status(400).json({ error: 'Solo se pueden enviar imágenes del chat' });
    const pid = String(req.body?.proyectoId || ''); if (!pid) return res.status(400).json({ error: 'Elige el proyecto' });
    const rf = await fetch(url); if (!rf.ok) throw new Error('No se pudo leer la imagen');
    const buf = Buffer.from(await rf.arrayBuffer()), titulo = txt(req.body?.titulo, 80) || 'Imagen de IA', nota = txt(req.body?.nota, 600);
    if (req.body?.destino === 'plano') {
      const planoId = String(req.body?.planoId || ''); const { data: fila } = await supabase.from('mediciones').select('data, project_id').eq('id', planoId).maybeSingle();
      if (!fila || fila.project_id !== pid) return res.status(404).json({ error: 'Ese plano no es de este proyecto' });
      const rid = 'r' + Date.now().toString(36), base = 'renders3d/' + planoId + '/' + rid;
      const full = await sharp(buf).resize({ width: 2400, withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer(), thumb = await sharp(buf).resize({ width: 480, withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
      for (const [ruta, b] of [[base + '.jpg', full], [base + '-t.jpg', thumb]]) { const { error } = await supabase.storage.from(BUCKET).upload(ruta, b, { contentType: 'image/jpeg', upsert: true }); if (error) throw error; }
      const render = { id: rid, tipo: 'ia', nombre: titulo, url: urlPublica(base + '.jpg'), thumb: urlPublica(base + '-t.jpg'), creado: new Date().toISOString(), meta: { extra: nota } };
      const esc = fila.data?.escena3d || { objetos: [] }, todos = [render, ...(esc.renders || [])];
      const { error } = await supabase.from('mediciones').update({ data: { ...fila.data, escena3d: { ...esc, renders: todos.slice(0, 80) } } }).eq('id', planoId); if (error) throw error;
      return res.json({ ok: true, donde: 'la galería del plano' });
    }
    let capId = String(req.body?.capituloId || '');
    if (!capId || capId === 'nuevo') {
      const { data: u } = await supabase.from('capitulos').select('orden').eq('proyecto_id', pid).order('orden', { ascending: false }).limit(1).maybeSingle();
      const { data: nuevo, error: eC } = await supabase.from('capitulos').insert({ proyecto_id: pid, titulo: txt(req.body?.tituloCapitulo, 80) || 'Imágenes con IA', orden: (u?.orden ?? 0) + 1, visible: false }).select('id').single(); if (eC) throw eC; capId = nuevo.id;
    } else { const { data: cap } = await supabase.from('capitulos').select('id, proyecto_id').eq('id', capId).maybeSingle(); if (!cap || cap.proyecto_id !== pid) return res.status(404).json({ error: 'Ese capítulo no es de este proyecto' }); }
    const png = await sharp(buf).png().toBuffer(), destinoUrl = await uploadProjectRender(png, 'ia.png', 'image/png', pid);
    const { data: ult } = await supabase.from('capitulo_bloques').select('orden').eq('capitulo_id', capId).order('orden', { ascending: false }).limit(1).maybeSingle();
    // el bloque entra oculto: no se ve en la historia del cliente hasta que lo muestres en el editor de la historia
    const { data: bloque, error } = await supabase.from('capitulo_bloques').insert({ tipo: 'render', titulo, texto: nota, imagen_url: destinoUrl, visible: false, proyecto_id: pid, capitulo_id: capId, orden: (ult?.orden ?? 0) + 1 }).select('id').single(); if (error) throw error;
    res.json({ ok: true, donde: 'la historia del proyecto (oculta hasta que la muestres)', bloqueId: bloque.id });
  } catch (e) { console.error('ia-chats enviar:', e); res.status(500).json({ error: 'No se pudo enviar: ' + String(e.message || '').slice(0, 140) }); }
});

// ── guardar y abrir conversaciones
router.post('/guardar', async (req, res) => {
  try {
    let id = idOk(req.body?.id) ? req.body.id : uid();
    const previa = await leerJson(CARPETA + '/' + id + '.json'), ahora = new Date().toISOString();
    const base = BASE_URL(), msgs = [];
    for (const [i, m] of (Array.isArray(req.body?.mensajes) ? req.body.mensajes : []).slice(0, 200).entries()) {
      const imagenes = [];
      for (const [k, im] of (Array.isArray(m?.imagenes) ? m.imagenes : []).slice(0, 8).entries()) {
        if (typeof im === 'string' && im.startsWith(base)) imagenes.push(im);
        else if (typeof im === 'string' && im.startsWith('data:image/')) { const u = await subeImagen(im, CARPETA + '/img/' + id + '-' + i + '-' + k + '-' + uid(), m?.rol === 'ia'); if (u) imagenes.push(u); }
      }
      msgs.push({ rol: m?.rol === 'ia' ? 'ia' : 'yo', texto: String(m?.texto || '').slice(0, 8000), imagenes, ...(m?.etiquetas && typeof m.etiquetas === 'object' ? { etiquetas: m.etiquetas } : {}), ...(m?.idResp ? { idResp: txt(m.idResp, 120) } : {}) });
    }
    const primero = msgs.find(m => m.rol === 'yo' && m.texto), titulo = txt(req.body?.titulo, 80) || previa?.titulo || (primero ? txt(primero.texto, 60) : 'Conversación nueva');
    const portada = [...msgs].reverse().flatMap(m => m.imagenes).find(Boolean) || null;
    const chat = { id, titulo, creado: previa?.creado || ahora, actualizado: ahora, previo: /^resp_[A-Za-z0-9_-]{5,100}$/.test(String(req.body?.previo || '')) ? req.body.previo : null, marcaId: txt(req.body?.marcaId, 60), mensajes: msgs };
    await guardaJson(CARPETA + '/' + id + '.json', chat);
    const ind = (await leerJson(CARPETA + '/_indice.json')) || { chats: [] };
    ind.chats = [{ id, titulo, actualizado: ahora, n: msgs.length, portada }, ...ind.chats.filter(c => c.id !== id)].slice(0, 300);
    await guardaJson(CARPETA + '/_indice.json', ind);
    res.json({ id, titulo, mensajes: msgs, previo: chat.previo });
  } catch (e) { console.error('ia-chats guardar:', e); res.status(500).json({ error: 'No se pudo guardar la conversación' }); }
});
router.get('/:id', async (req, res) => {
  if (!idOk(req.params.id)) return res.status(400).json({ error: 'Conversación no válida' });
  const c = await leerJson(CARPETA + '/' + req.params.id + '.json'); if (!c) return res.status(404).json({ error: 'Conversación no encontrada' });
  res.json(c);
});
router.put('/:id/titulo', async (req, res) => {
  try {
    if (!idOk(req.params.id)) return res.status(400).json({ error: 'Conversación no válida' });
    const c = await leerJson(CARPETA + '/' + req.params.id + '.json'); if (!c) return res.status(404).json({ error: 'Conversación no encontrada' });
    c.titulo = txt(req.body?.titulo, 80) || c.titulo; await guardaJson(CARPETA + '/' + c.id + '.json', c);
    const ind = (await leerJson(CARPETA + '/_indice.json')) || { chats: [] }; ind.chats = ind.chats.map(x => (x.id === c.id ? { ...x, titulo: c.titulo } : x)); await guardaJson(CARPETA + '/_indice.json', ind);
    res.json({ ok: true, titulo: c.titulo });
  } catch { res.status(500).json({ error: 'No se pudo renombrar' }); }
});
router.delete('/:id', async (req, res) => {
  try {
    if (!idOk(req.params.id)) return res.status(400).json({ error: 'Conversación no válida' });
    await supabase.storage.from(BUCKET).remove([CARPETA + '/' + req.params.id + '.json']).catch(() => {});
    const ind = (await leerJson(CARPETA + '/_indice.json')) || { chats: [] }; ind.chats = ind.chats.filter(c => c.id !== req.params.id); await guardaJson(CARPETA + '/_indice.json', ind);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'No se pudo borrar' }); }
});

export default router;
