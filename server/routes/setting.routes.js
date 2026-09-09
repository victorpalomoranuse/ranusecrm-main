import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdminSuperior, requirePermission } from '../middleware/auth.middleware.js';

const router = express.Router();
// Misma sección de la que ya disponen los que gestionan Leads (mismo
// permiso) — Setting es un embudo previo, independiente del de Leads.
const requireSetting = requirePermission('leads');

export const ESTADOS_VALIDOS = ['ads', 'interesado', 'no_califica', 'contacto_nuevo', 'pitcheo_agenda', 'recolectando_info', 'prioridad', 'venta', 'no_responde'];

router.get('/', authenticateToken, requireSetting, async (req, res) => {
  try {
    const { data: registros, error } = await supabase
      .from('setting_leads')
      .select('*, empleado:employees(id, name)')
      .order('created_at', { ascending: false });
    if (error) throw error;

    const total = registros.length;
    const porEstado = {};
    ESTADOS_VALIDOS.forEach(e => { porEstado[e] = 0; });
    registros.forEach(r => { if (porEstado[r.estado] !== undefined) porEstado[r.estado]++; });

    const ventas = porEstado.venta || 0;
    const noResponde = porEstado.no_responde || 0;
    const noCalifica = porEstado.no_califica || 0;
    const cerrados = ventas + noResponde + noCalifica;
    const activos = total - cerrados;
    const tasaCierre = total > 0 ? Math.round((ventas / total) * 100) : 0;
    const tasaCalificacion = total > 0 ? Math.round(((total - noCalifica) / total) * 100) : 0;

    const porCanal = {};
    registros.forEach(r => {
      const c = r.canal || 'otro';
      if (!porCanal[c]) porCanal[c] = { total: 0, ventas: 0 };
      porCanal[c].total++;
      if (r.estado === 'venta') porCanal[c].ventas++;
    });

    res.json({
      registros,
      metricas: { total, activos, ventas, noResponde, noCalifica, tasaCierre, tasaCalificacion },
      porEstado,
      porCanal,
    });
  } catch (error) {
    console.error('Error al listar setting:', error);
    res.status(500).json({ error: 'Error al listar setting' });
  }
});

router.get('/:id', authenticateToken, requireSetting, async (req, res) => {
  try {
    const { data, error } = await supabase.from('setting_leads').select('*, empleado:employees(id, name)').eq('id', req.params.id).single();
    if (error || !data) return res.status(404).json({ error: 'Registro no encontrado' });
    res.json({ registro: data });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener registro' });
  }
});

router.post('/', authenticateToken, requireSetting, async (req, res) => {
  try {
    const { nombre, telefono, instagram, email, canal, estado, objetivo, medidas, maquinarias, notas, assigned_to } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es requerido' });

    const { data, error } = await supabase
      .from('setting_leads')
      .insert({
        nombre: nombre.trim(),
        telefono: telefono?.trim() || null,
        instagram: instagram?.trim() || null,
        email: email?.trim() || null,
        canal: canal?.trim() || null,
        estado: ESTADOS_VALIDOS.includes(estado) ? estado : 'ads',
        objetivo: objetivo?.trim() || null,
        medidas: medidas?.trim() || null,
        maquinarias: maquinarias?.trim() || null,
        notas: notas?.trim() || null,
        assigned_to: assigned_to || null,
        created_by: req.user.id,
      })
      .select('*, empleado:employees(id, name)')
      .single();
    if (error) throw error;
    res.status(201).json({ registro: data });
  } catch (error) {
    console.error('Error al crear registro de setting:', error);
    res.status(500).json({ error: 'Error al crear registro' });
  }
});

router.put('/:id', authenticateToken, requireSetting, async (req, res) => {
  try {
    const { nombre, telefono, instagram, email, canal, estado, objetivo, medidas, maquinarias, notas, assigned_to } = req.body;
    const updates = { updated_at: new Date().toISOString() };
    if (nombre !== undefined) updates.nombre = nombre.trim();
    if (telefono !== undefined) updates.telefono = telefono?.trim() || null;
    if (instagram !== undefined) updates.instagram = instagram?.trim() || null;
    if (email !== undefined) updates.email = email?.trim() || null;
    if (canal !== undefined) updates.canal = canal?.trim() || null;
    if (estado !== undefined && ESTADOS_VALIDOS.includes(estado)) updates.estado = estado;
    if (objetivo !== undefined) updates.objetivo = objetivo?.trim() || null;
    if (medidas !== undefined) updates.medidas = medidas?.trim() || null;
    if (maquinarias !== undefined) updates.maquinarias = maquinarias?.trim() || null;
    if (notas !== undefined) updates.notas = notas?.trim() || null;
    if (assigned_to !== undefined) updates.assigned_to = assigned_to || null;

    const { data, error } = await supabase.from('setting_leads').update(updates).eq('id', req.params.id).select('*, empleado:employees(id, name)').single();
    if (error) throw error;
    res.json({ registro: data });
  } catch (error) {
    console.error('Error al actualizar registro de setting:', error);
    res.status(500).json({ error: 'Error al actualizar registro' });
  }
});

router.delete('/:id', authenticateToken, requireAdminSuperior, async (req, res) => {
  try {
    const { error } = await supabase.from('setting_leads').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Registro eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar registro' });
  }
});

export default router;
