import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken } from '../middleware/auth.middleware.js';

// Mini dashboard personal ("Mi día") para cada empleado: solo SUS datos —
// sus llamadas, sus leads y sus ventas del mes. Las comisiones salen del
// endpoint que ya existe (/comisiones/mia/periodos), que respeta el mes
// publicado por el administrador.
const router = express.Router();

const ESTADOS_CERRADOS = ['venta_1', 'venta_2', 'venta_extra', 'rechazo', 'no_responde', 'no_califica'];

const hoyMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const mesDe = (iso) => (iso ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit' }).format(new Date(iso)) : null);

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { data: emp } = await supabase.from('employees').select('id, name, email').eq('email', req.user.email).maybeSingle();
    if (!emp) return res.json({ empleado: null });

    const hoy = hoyMadrid();
    const hace14 = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    const SELECT = '*, lead:setting_leads(id, nombre, telefono, instagram, estado)';

    const [{ data: proximas }, { data: sinCerrar }] = await Promise.all([
      supabase.from('call_slots').select(SELECT).eq('employee_id', emp.id).eq('ocupado', true).gte('fecha', hoy).order('fecha', { ascending: true }).order('hora_inicio', { ascending: true }).limit(12),
      supabase.from('call_slots').select(SELECT).eq('employee_id', emp.id).eq('ocupado', true).lt('fecha', hoy).gte('fecha', hace14).is('resumen_llamada', null).order('fecha', { ascending: false }).limit(8),
    ]);

    let leads = null;
    const puedeLeads = req.user.role === 'admin_superior' || req.user.permissions?.leads === true;
    if (puedeLeads) {
      const { data: mios } = await supabase.from('setting_leads').select('id, estado, fecha_venta_1, fecha_venta_2, fecha_venta_extra, fecha_llamada').eq('assigned_to', emp.id);
      const lista = mios || [];
      const mes = hoy.slice(0, 7);
      leads = {
        asignados: lista.length,
        activos: lista.filter(l => !ESTADOS_CERRADOS.includes(l.estado)).length,
        agendados: lista.filter(l => l.estado === 'agendado').length,
        nuevos: lista.filter(l => ['nuevo', 'contacto_nuevo'].includes(l.estado)).length,
        seguimiento: lista.filter(l => l.estado === 'seguimiento_futuro').length,
        ventasMes: lista.filter(l => [l.fecha_venta_1, l.fecha_venta_2, l.fecha_venta_extra].some(f => mesDe(f) === mes)).length,
      };
    }

    res.json({
      empleado: { id: emp.id, name: emp.name },
      hoy,
      proximas: proximas || [],
      sinCerrar: sinCerrar || [],
      leads,
    });
  } catch (error) {
    console.error('Error en mi dashboard:', error);
    res.status(500).json({ error: 'Error al cargar tu resumen' });
  }
});

export default router;
