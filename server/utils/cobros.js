import { supabase } from '../config/supabase.js';

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
export const hoyISO = () => new Date().toISOString().slice(0, 10);

// Planes por defecto. El 2.º y el 3.º hito de reformas se activan por avance de obra.
const PLAN_REFORMAS = [
  { concepto: 'Aceptación del presupuesto', pct: 35, disparador: 'aprobacion', avance_minimo: null },
  { concepto: 'Preparación, instalaciones puntuales y pintura', pct: 30, disparador: 'avance_obra', avance_minimo: 35 },
  { concepto: 'Suelos, paneles y espejos', pct: 30, disparador: 'avance_obra', avance_minimo: 70 },
  { concepto: 'Obra terminada', pct: 5, disparador: 'avance_obra', avance_minimo: 100 },
];
const PLAN_DEFECTO = [
  { concepto: 'Aceptación del presupuesto', pct: 50, disparador: 'aprobacion', avance_minimo: null },
  { concepto: 'Entrega / finalización', pct: 50, disparador: 'manual', avance_minimo: null },
];

/** Plan de hitos de un presupuesto: su calendario de pagos si lo tiene, si no la plantilla (reformas u otra). */
export function planPara(budget, items) {
  const cal = Array.isArray(budget?.payment_schedule) ? budget.payment_schedule.filter(h => h && parseFloat(h.pct) > 0) : [];
  if (cal.length) return cal.map((h, i) => ({ concepto: String(h.concepto || 'Pago ' + (i + 1)), pct: parseFloat(h.pct), disparador: i === 0 ? 'aprobacion' : 'manual', avance_minimo: null }));
  const esReforma = (items || []).some(i => i.category === 'reformas') || /reforma/i.test(budget?.budget_name || '');
  return esReforma ? PLAN_REFORMAS : PLAN_DEFECTO;
}

/** Crea los hitos de un presupuesto recién aprobado (solo si aún no tiene). Importe sobre el total sin IVA. */
export async function generarHitos(budget, items, total) {
  if (!budget?.project_id || !(total > 0)) return { creados: 0 };
  const { data: ya } = await supabase.from('payment_milestones').select('id').eq('budget_id', budget.id).limit(1);
  if (ya?.length) return { creados: 0 };
  const plan = planPara(budget, items);
  const suma = plan.reduce((s, h) => s + h.pct, 0) || 100;
  const filas = plan.map((h, i) => ({
    project_id: budget.project_id, budget_id: budget.id, orden: i + 1, concepto: h.concepto,
    porcentaje: r2(h.pct * 100 / suma), importe: r2(total * h.pct / suma),
    disparador: h.disparador, avance_minimo: h.avance_minimo,
  }));
  // que la suma cuadre al céntimo: el ajuste va al último hito
  const dif = r2(total - filas.reduce((s, f) => s + f.importe, 0));
  if (filas.length && dif) filas[filas.length - 1].importe = r2(filas[filas.length - 1].importe + dif);
  const { error } = await supabase.from('payment_milestones').insert(filas);
  if (error) throw error;
  return { creados: filas.length };
}

/** Estado visible: «vencido» se calcula (no cobrado y con la fecha prevista pasada). */
export function estadoVisible(h, hoy = hoyISO()) {
  if (h.estado === 'cobrado') return 'cobrado';
  if (h.fecha_prevista && h.fecha_prevista < hoy) return 'vencido';
  return h.estado || 'pendiente';
}

/** Totales de una lista de hitos. */
export function totalesHitos(hitos) {
  const total = hitos.reduce((s, h) => s + Number(h.importe), 0);
  const cobrado = hitos.filter(h => h.estado === 'cobrado').reduce((s, h) => s + Number(h.importe), 0);
  return { total: r2(total), cobrado: r2(cobrado), pendiente: r2(total - cobrado), pct: total > 0 ? Math.round(cobrado * 100 / total) : 0 };
}

/**
 * Punto de enganche para recordatorios al cliente (WhatsApp / email).
 * De momento NO envía nada: solo devuelve los hitos que se acercan (≤ dias) o han vencido.
 */
export async function avisosHitos(dias = 7) {
  const hoy = hoyISO(), lim = new Date(Date.now() + dias * 864e5).toISOString().slice(0, 10);
  const { data } = await supabase.from('payment_milestones')
    .select('id, project_id, budget_id, concepto, importe, fecha_prevista, estado, project:client_projects(client_name, project_name)')
    .neq('estado', 'cobrado').not('fecha_prevista', 'is', null).lte('fecha_prevista', lim);
  return (data || []).map(h => ({ ...h, vencido: h.fecha_prevista < hoy }));
}
