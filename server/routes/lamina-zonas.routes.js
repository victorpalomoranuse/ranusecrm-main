import express from 'express';
import PDFDocument from 'pdfkit';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';
import { disenadorDe, proyectoEsDe } from '../utils/asignados.js';
import { clasificaNombres, construye, laminaSvg, laminaPdf, clave, TIPOS, NOMBRE } from '../utils/lamina-zonas.js';

// Lámina de zonas para el cliente: se genera a partir del plano guardado (mediciones.data) y se guarda la clasificación (tipo y grupo de cada máquina)
// dentro del propio plano (data.zonasLamina), para que la IA clasifique solo lo nuevo y lo que corrija el usuario se respete.
const router = express.Router();
router.use(authenticateToken, requirePermission('proyectos'));
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GRUPOS = ['Pecho', 'Espalda', 'Hombro', 'Brazos', 'Pierna', 'Glúteo', 'Abdomen', 'Cardio', 'Funcional', 'Peso libre', 'Otros'];
const txt = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

async function cargar(req, res) {
  const { data: fila } = await supabase.from('mediciones').select('id, data, nombre, cliente, project_id, created_by').eq('id', req.params.id).maybeSingle();
  if (!fila) { res.status(404).json({ error: 'Plano no encontrado' }); return null; }
  const emp = await disenadorDe(req);
  if (emp && fila.created_by !== req.user.id && !(fila.project_id && proyectoEsDe(emp, fila.project_id))) { res.status(403).json({ error: 'Este plano es de un proyecto que no tienes asignado.' }); return null; }
  return fila;
}
// clasifica con IA los nombres que aún no tienen clasificación; lo ya clasificado (o corregido a mano) no se toca
async function asegura(fila) {
  const d = fila.data || {}, zl = (d.zonasLamina = d.zonasLamina || { clasif: {} }); zl.clasif = zl.clasif || {};
  const nombres = {}; (d.eq || []).filter(e => e.s !== 'dem').forEach(e => { const k = clave(e); if (!nombres[k]) nombres[k] = txt(e.nm, 100) || k; });
  const faltan = Object.keys(nombres).filter(k => !zl.clasif[k]);
  if (faltan.length) {
    const r = await clasificaNombres(faltan.map(k => nombres[k]));
    faltan.forEach(k => { const c = r[nombres[k]] || { tipo: 'otro', grupo: 'Otros' }; zl.clasif[k] = { tipo: c.tipo, grupo: c.grupo, nombre: nombres[k], auto: true }; });
    await supabase.from('mediciones').update({ data: d }).eq('id', fila.id);
  }
  return { zl, nombres };
}
const titulos = (fila, zl) => ({ titulo: txt(zl.titulo, 80) || (fila.nombre || 'Distribución') + ' · zonas', subtitulo: txt(zl.subtitulo, 120) });

router.get('/:id', async (req, res) => {
  try {
    const fila = await cargar(req, res); if (!fila) return;
    const { zl, nombres } = await asegura(fila), g = construye(fila.data, zl.clasif), t = titulos(fila, zl);
    const cuenta = {}; (fila.data.eq || []).filter(e => e.s !== 'dem').forEach(e => { const k = clave(e); cuenta[k] = (cuenta[k] || 0) + 1; });
    res.json({ ...t, plano: fila.nombre, svg: laminaSvg(g, t.titulo, t.subtitulo), total: g.total, zonas: g.zonas, tipos: TIPOS.map(x => ({ id: x, nombre: NOMBRE[x] })), grupos: GRUPOS,
      maquinas: Object.keys(nombres).map(k => ({ clave: k, nombre: nombres[k], cantidad: cuenta[k] || 0, tipo: zl.clasif[k]?.tipo || 'otro', grupo: zl.clasif[k]?.grupo || 'Otros' })).sort((a, b) => a.nombre.localeCompare(b.nombre)) });
  } catch (e) { console.error('lámina zonas:', e); res.status(500).json({ error: 'No se pudo preparar la lámina: ' + String(e.message || '').slice(0, 140) }); }
});
router.put('/:id', async (req, res) => {
  try {
    const fila = await cargar(req, res); if (!fila) return; const d = fila.data || {}, zl = (d.zonasLamina = d.zonasLamina || { clasif: {} }); zl.clasif = zl.clasif || {};
    (Array.isArray(req.body?.maquinas) ? req.body.maquinas : []).slice(0, 300).forEach(m => { const k = txt(m?.clave, 120); if (!k) return; zl.clasif[k] = { ...(zl.clasif[k] || {}), tipo: TIPOS.includes(m.tipo) ? m.tipo : 'otro', grupo: GRUPOS.includes(m.grupo) ? m.grupo : 'Otros', auto: false }; });
    if (typeof req.body?.titulo === 'string') zl.titulo = txt(req.body.titulo, 80); if (typeof req.body?.subtitulo === 'string') zl.subtitulo = txt(req.body.subtitulo, 120);
    const { error } = await supabase.from('mediciones').update({ data: d }).eq('id', fila.id); if (error) throw error;
    const g = construye(d, zl.clasif), t = titulos(fila, zl); res.json({ svg: laminaSvg(g, t.titulo, t.subtitulo), total: g.total, zonas: g.zonas });
  } catch (e) { console.error('lámina zonas guarda:', e); res.status(500).json({ error: 'No se pudo guardar la clasificación' }); }
});
router.post('/:id/pdf', async (req, res) => {
  try {
    const fila = await cargar(req, res); if (!fila) return; const { zl } = await asegura(fila), g = construye(fila.data, zl.clasif), t = titulos(fila, zl);
    const doc = new PDFDocument({ margin: 0, size: [842, 595] }), trozos = []; doc.on('data', c => trozos.push(c)); const fin = new Promise(ok => doc.on('end', ok));
    laminaPdf(doc, g, t.titulo, t.subtitulo, path.join(__dirname, '..', 'Icono Blanco.png')); doc.end(); await fin;
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="zonas.pdf"' }).send(Buffer.concat(trozos));
  } catch (e) { console.error('lámina zonas pdf:', e); res.status(500).json({ error: 'No se pudo crear el PDF' }); }
});
export default router;
