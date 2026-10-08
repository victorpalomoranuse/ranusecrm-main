import express from 'express';
import multer from 'multer';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdminSuperior } from '../middleware/auth.middleware.js';
import { ingestarDocumento, ASISTENTES_CONOCIMIENTO } from '../utils/conocimiento.js';

// Biblioteca de conocimiento de las IA (solo administrador)
const router = express.Router();
router.use(authenticateToken, requireAdminSuperior);

const subir = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => (file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname || '') ? cb(null, true) : cb(new Error('Solo se admiten PDFs'), false)),
  limits: { fileSize: 60 * 1024 * 1024, files: 1 },
}).single('file');

const fail = (res, e, msg) => { console.error(msg, e); res.status(500).json({ error: msg }); };

export async function extraerPaginasPdf(buffer) {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: false });
  return text;
}

router.get('/docs', async (req, res) => {
  try {
    const { data, error } = await supabase.from('ia_conocimiento_docs').select('id, titulo, fuente, num_paginas, num_fragmentos, asistentes, created_at').order('titulo', { ascending: true });
    if (error) throw error;
    res.json({ docs: data });
  } catch (e) { fail(res, e, 'Error al cargar la biblioteca (¿has ejecutado el SQL v69?)'); }
});

router.post('/docs', (req, res, next) => subir(req, res, (err) => (err ? res.status(400).json({ error: err.message }) : next())), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Falta el PDF' });
    const asistentes = String(req.body.asistentes || '').split(',').map(s => s.trim()).filter(a => ASISTENTES_CONOCIMIENTO.includes(a));
    const paginas = await extraerPaginasPdf(req.file.buffer);
    const titulo = (req.body.titulo || '').trim() || String(req.file.originalname || 'Documento').replace(/\.pdf$/i, '');
    const doc = await ingestarDocumento({ titulo, fuente: req.file.originalname, paginas, asistentes: asistentes.length ? asistentes : ASISTENTES_CONOCIMIENTO });
    res.status(201).json({ doc });
  } catch (e) {
    console.error('Error al añadir el PDF a la biblioteca:', e);
    res.status(500).json({ error: e.message || 'Error al añadir el PDF' });
  }
});

router.put('/docs/:id', async (req, res) => {
  try {
    const updates = {};
    if (typeof req.body.titulo === 'string' && req.body.titulo.trim()) updates.titulo = req.body.titulo.trim();
    if (Array.isArray(req.body.asistentes)) updates.asistentes = req.body.asistentes.filter(a => ASISTENTES_CONOCIMIENTO.includes(a));
    const { data, error } = await supabase.from('ia_conocimiento_docs').update(updates).eq('id', req.params.id).select('*').single();
    if (error) throw error;
    res.json({ doc: data });
  } catch (e) { fail(res, e, 'Error al actualizar el documento'); }
});

router.delete('/docs/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('ia_conocimiento_docs').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { fail(res, e, 'Error al borrar el documento'); }
});

export default router;
