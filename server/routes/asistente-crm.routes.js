import express from 'express';
import crypto from 'crypto';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdminSuperior } from '../middleware/auth.middleware.js';
import { leerJson, guardarJson, RUTA_RECORD, RUTA_DIARIO } from '../utils/asistente-personal.js';
import { RUTA_PERFIL, RUTA_PLAN, RUTA_REGISTRO, RUTA_MARCAS, ejecutarSalud } from '../utils/salud-asistente.js';

// Lo que el asistente personal sabe y hace, visible y editable desde el CRM (sección "Asistente personal").
const router = express.Router();
router.use(authenticateToken, requireAdminSuperior);
const RUTA_MEM = 'crm/asistente/memoria.json';
const RUTA_CHARLA = 'crm/asistente/charla.json';

router.get('/memoria', async (req, res) => {
  try { const m = await leerJson(RUTA_MEM, { hechos: [] }); res.json({ hechos: (m.hechos || []).slice().reverse() }); }
  catch { res.status(500).json({ error: 'No se pudo leer la memoria' }); }
});
router.post('/memoria', async (req, res) => {
  try {
    const texto = String(req.body?.texto || '').trim().slice(0, 600); if (!texto) return res.status(400).json({ error: 'Escribe algo para recordar' });
    const m = await leerJson(RUTA_MEM, { hechos: [] });
    m.hechos.push({ id: crypto.randomUUID().slice(0, 6), texto, etiqueta: String(req.body?.etiqueta || '').slice(0, 30) || null, fecha: new Date().toISOString().slice(0, 10) });
    await guardarJson(RUTA_MEM, m); res.status(201).json({ ok: true });
  } catch { res.status(500).json({ error: 'No se pudo guardar' }); }
});
router.put('/memoria/:id', async (req, res) => {
  try {
    const texto = String(req.body?.texto || '').trim().slice(0, 600); if (!texto) return res.status(400).json({ error: 'El texto no puede estar vacío' });
    const m = await leerJson(RUTA_MEM, { hechos: [] }); const h = m.hechos.find(x => x.id === req.params.id); if (!h) return res.status(404).json({ error: 'No existe ese recuerdo' });
    h.texto = texto; await guardarJson(RUTA_MEM, m); res.json({ ok: true });
  } catch { res.status(500).json({ error: 'No se pudo guardar' }); }
});
router.delete('/memoria/:id', async (req, res) => {
  try { const m = await leerJson(RUTA_MEM, { hechos: [] }); m.hechos = m.hechos.filter(x => x.id !== req.params.id); await guardarJson(RUTA_MEM, m); res.json({ ok: true }); }
  catch { res.status(500).json({ error: 'No se pudo borrar' }); }
});

router.get('/recordatorios', async (req, res) => {
  try { const l = await leerJson(RUTA_RECORD, []); res.json({ recordatorios: l.slice().sort((a, b) => String(a.cuando).localeCompare(String(b.cuando))) }); }
  catch { res.status(500).json({ error: 'No se pudieron leer los recordatorios' }); }
});
router.post('/recordatorios', async (req, res) => {
  try {
    const { texto, fecha, hora } = req.body || {};
    if (!String(texto || '').trim() || !/^\d{4}-\d{2}-\d{2}$/.test(fecha || '') || !/^\d{1,2}:\d{2}$/.test(hora || '')) return res.status(400).json({ error: 'Faltan texto, fecha u hora' });
    const l = await leerJson(RUTA_RECORD, []); l.push({ id: crypto.randomUUID().slice(0, 6), cuando: fecha + 'T' + String(hora).padStart(5, '0'), texto: String(texto).trim().slice(0, 300), enviado: false });
    await guardarJson(RUTA_RECORD, l.slice(-200)); res.status(201).json({ ok: true });
  } catch { res.status(500).json({ error: 'No se pudo guardar' }); }
});
router.delete('/recordatorios/:id', async (req, res) => {
  try { const l = await leerJson(RUTA_RECORD, []); await guardarJson(RUTA_RECORD, l.filter(x => x.id !== req.params.id)); res.json({ ok: true }); }
  catch { res.status(500).json({ error: 'No se pudo borrar' }); }
});

// PDFs que el asistente ha generado sin proyecto (los de un proyecto ya están en sus Documentos)
router.get('/informes', async (req, res) => {
  try {
    const { data, error } = await supabase.storage.from('project-documents').list('_asistente', { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });
    if (error) throw error;
    res.json({ informes: (data || []).filter(f => /\.pdf$/i.test(f.name)).map(f => ({ nombre: f.name.replace(/^\d+_/, ''), fecha: f.created_at, url: supabase.storage.from('project-documents').getPublicUrl('_asistente/' + f.name).data.publicUrl })) });
  } catch { res.status(500).json({ error: 'No se pudieron listar los informes' }); }
});

router.get('/conversacion', async (req, res) => {
  try {
    const c = await leerJson(RUTA_CHARLA, {}); const salida = [];
    for (const [k, v] of Object.entries(c)) if (/^(wa|tg):/.test(k)) for (const m of (v || []).filter(x => !x.privado)) salida.push({ canal: k.startsWith('wa') ? 'WhatsApp' : 'Telegram', rol: m.role, texto: typeof m.content === 'string' ? m.content : '' });
    res.json({ mensajes: salida.slice(-60) });
  } catch { res.status(500).json({ error: 'No se pudo leer la conversación' }); }
});

router.delete('/conversacion', async (req, res) => {
  try {
    const c = await leerJson(RUTA_CHARLA, {}); for (const k of Object.keys(c)) if (/^(wa|tg):/.test(k)) delete c[k];
    await guardarJson(RUTA_CHARLA, c); res.json({ ok: true });
  } catch { res.status(500).json({ error: 'No se pudo borrar la conversación' }); }
});

router.get('/diario', async (req, res) => {
  try { const d = await leerJson(RUTA_DIARIO, { entradas: [] }); res.json({ entradas: (d.entradas || []).slice().reverse() }); }
  catch { res.status(500).json({ error: 'No se pudo leer el diario' }); }
});
router.delete('/diario/:id', async (req, res) => {
  try { const d = await leerJson(RUTA_DIARIO, { entradas: [] }); d.entradas = (d.entradas || []).filter(e => e.id !== req.params.id); await guardarJson(RUTA_DIARIO, d); res.json({ ok: true }); }
  catch { res.status(500).json({ error: 'No se pudo borrar' }); }
});

// Salud, entrenamiento y hábitos: perfil, plan a largo plazo, registro de los últimos 30 días y marcas
router.get('/salud', async (req, res) => {
  try {
    const [perfil, plan, registro, marcas, hoy] = await Promise.all([leerJson(RUTA_PERFIL, {}), leerJson(RUTA_PLAN, {}), leerJson(RUTA_REGISTRO, { dias: {} }), leerJson(RUTA_MARCAS, {}), ejecutarSalud('salud_hoy', {})]);
    const desde = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const dias = Object.keys(registro.dias || {}).filter(d => d >= desde).sort().reverse().map(d => ({ fecha: d, ...registro.dias[d] }));
    res.json({ perfil, plan: Object.keys(plan).length ? plan : null, dias, marcas: Object.values(marcas), calculos: hoy.calculos || {}, hoy: { recomendacion: hoy.recomendacion_del_sistema, esta_semana: hoy.esta_semana } });
  } catch { res.status(500).json({ error: 'No se pudo leer la salud' }); }
});
router.put('/salud/perfil', async (req, res) => {
  try {
    const c = req.body?.campos && typeof req.body.campos === 'object' ? req.body.campos : {}; const r = await ejecutarSalud('salud_perfil', { accion: 'guardar', campos: c }); res.json(r);
  } catch { res.status(500).json({ error: 'No se pudo guardar el perfil' }); }
});

export default router;
