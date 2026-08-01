import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';

const router = express.Router();
const requireFinanzas = requirePermission('finanzas');

const TIPOS_PERIODO = ['mes', 'trimestre', 'año'];
const ESCENARIOS = ['pesimista', 'realista', 'optimista'];

/**
 * GET /api/objetivos?periodo_tipo=mes&año=2026
 * Lista objetivos, opcionalmente filtrados por tipo de periodo y/o año.
 */
router.get('/', authenticateToken, requireFinanzas, async (req, res) => {
  try {
    let query = supabase.from('objetivos_financieros').select('*').order('periodo', { ascending: true });

    if (req.query.periodo_tipo && TIPOS_PERIODO.includes(req.query.periodo_tipo)) {
      query = query.eq('periodo_tipo', req.query.periodo_tipo);
    }
    if (req.query.año) {
      query = query.like('periodo', `${req.query.año}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json({ objetivos: data });
  } catch (error) {
    console.error('Error al listar objetivos:', error);
    res.status(500).json({ error: 'Error al listar objetivos' });
  }
});

/**
 * PUT /api/objetivos
 * Upsert de un objetivo (periodo_tipo + periodo + escenario es única).
 * Body: { periodo_tipo, periodo, escenario, importe }
 */
router.put('/', authenticateToken, requireFinanzas, async (req, res) => {
  try {
    const { periodo_tipo, periodo, escenario, importe } = req.body;

    if (!TIPOS_PERIODO.includes(periodo_tipo)) return res.status(400).json({ error: 'periodo_tipo inválido' });
    if (!periodo?.trim()) return res.status(400).json({ error: 'periodo requerido' });
    if (!ESCENARIOS.includes(escenario)) return res.status(400).json({ error: 'escenario inválido' });
    if (importe === undefined || isNaN(parseFloat(importe)) || parseFloat(importe) < 0) {
      return res.status(400).json({ error: 'importe inválido' });
    }

    const { data, error } = await supabase
      .from('objetivos_financieros')
      .upsert(
        {
          periodo_tipo,
          periodo: periodo.trim(),
          escenario,
          importe: parseFloat(importe),
          created_by: req.user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'periodo_tipo,periodo,escenario' }
      )
      .select()
      .single();

    if (error) throw error;
    res.json({ message: 'Objetivo guardado', objetivo: data });
  } catch (error) {
    console.error('Error al guardar objetivo:', error);
    res.status(500).json({ error: 'Error al guardar objetivo' });
  }
});

router.delete('/:id', authenticateToken, requireFinanzas, async (req, res) => {
  try {
    const { error } = await supabase.from('objetivos_financieros').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Objetivo eliminado' });
  } catch (error) {
    console.error('Error al eliminar objetivo:', error);
    res.status(500).json({ error: 'Error al eliminar objetivo' });
  }
});

// Convierte una fecha 'YYYY-MM-DD' a la clave de periodo correspondiente
function claveDePeriodo(fechaISO, tipo) {
  const [y, m] = fechaISO.slice(0, 7).split('-');
  if (tipo === 'año') return y;
  if (tipo === 'trimestre') return `${y}-Q${Math.ceil(Number(m) / 3)}`;
  return `${y}-${m}`; // mes
}

/**
 * GET /api/objetivos/progreso?periodo_tipo=mes&periodo=2026-08
 * Compara la facturación real (vendida y cobrada) del periodo con los
 * 3 escenarios definidos, y calcula lo que resta para cada uno.
 */
router.get('/progreso', authenticateToken, requireFinanzas, async (req, res) => {
  try {
    const periodo_tipo = TIPOS_PERIODO.includes(req.query.periodo_tipo) ? req.query.periodo_tipo : 'mes';
    const periodo = req.query.periodo;
    if (!periodo) return res.status(400).json({ error: 'periodo requerido (ej. 2026-08, 2026-Q3, 2026)' });

    const [{ data: objetivos, error: errObj }, { data: leads, error: errLeads }, { data: movimientos, error: errMov }] =
      await Promise.all([
        supabase.from('objetivos_financieros').select('*').eq('periodo_tipo', periodo_tipo).eq('periodo', periodo),
        supabase.from('leads').select('valor_estimado, fecha_venta, valor_diseño, fecha_venta_diseño_1').or('estado.eq.venta,tipo_diseño.eq.diseño_venta'),
        supabase.from('finanzas_movimientos').select('tipo, monto, fecha'),
      ]);
    if (errObj) throw errObj;
    if (errLeads) throw errLeads;
    if (errMov) throw errMov;

    // Facturación VENDIDA: importe de cada venta en la fecha en que se cerró
    let facturacionVendida = 0;
    leads.forEach(l => {
      if (l.fecha_venta && claveDePeriodo(l.fecha_venta, periodo_tipo) === periodo) {
        facturacionVendida += Number(l.valor_estimado || 0);
      }
      if (l.fecha_venta_diseño_1 && claveDePeriodo(l.fecha_venta_diseño_1, periodo_tipo) === periodo) {
        facturacionVendida += Number(l.valor_diseño || 0);
      }
    });

    // Facturación COBRADA: ingresos reales registrados en caja durante el periodo
    let facturacionCobrada = 0;
    let gastosPeriodo = 0;
    movimientos.forEach(m => {
      if (claveDePeriodo(m.fecha, periodo_tipo) !== periodo) return;
      if (m.tipo === 'ingreso') facturacionCobrada += Number(m.monto);
      else gastosPeriodo += Number(m.monto);
    });

    const porEscenario = {};
    ESCENARIOS.forEach(esc => {
      const obj = objetivos.find(o => o.escenario === esc);
      const importeObjetivo = obj ? Number(obj.importe) : null;
      porEscenario[esc] = {
        objetivo: importeObjetivo,
        restaVendido: importeObjetivo !== null ? Math.max(importeObjetivo - facturacionVendida, 0) : null,
        restaCobrado: importeObjetivo !== null ? Math.max(importeObjetivo - facturacionCobrada, 0) : null,
        cumplidoVendidoPct: importeObjetivo ? Math.round((facturacionVendida / importeObjetivo) * 100) : null,
        cumplidoCobradoPct: importeObjetivo ? Math.round((facturacionCobrada / importeObjetivo) * 100) : null,
      };
    });

    res.json({
      periodo_tipo,
      periodo,
      facturacionVendida,
      facturacionCobrada,
      gastosPeriodo,
      balanceCobrado: facturacionCobrada - gastosPeriodo,
      porEscenario,
    });
  } catch (error) {
    console.error('Error al calcular progreso de objetivos:', error);
    res.status(500).json({ error: 'Error al calcular progreso de objetivos' });
  }
});

export default router;
