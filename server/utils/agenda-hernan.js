import { supabase } from '../config/supabase.js';
import { avisarLlamada } from './aviso-llamada.js';

// Cuando una llamada se agenda (o cambia/cancela) en un lead — desde el
// Asistente Setter o a mano en Setting — tiene que aparecer en el calendario
// de Hernán (call_slots), no solo en el lead: si ya tenía un hueco libre a
// esa hora se reserva, y si no se crea uno ya ocupado de 30 min. Antes de
// reservar se liberan los huecos que ese lead tuviera. fechaLlamada es el
// instante guardado en el lead (ISO); null = cancelada.
export async function asignarLlamadaAHernan(leadId, fechaLlamada) {
  const { data: hernan } = await supabase.from('employees').select('id, name, email').ilike('name', 'Hern%').limit(1).maybeSingle();
  if (!hernan) return { error: 'No encuentro a Hernán entre los empleados.' };

  let fecha = null, hora = null;
  if (fechaLlamada) {
    const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(fechaLlamada)).map(p => [p.type, p.value]));
    fecha = `${partes.year}-${partes.month}-${partes.day}`;
    hora = `${partes.hour}:${partes.minute}:00`;
  }

  const { data: lead } = await supabase.from('setting_leads').select('nombre, telefono, instagram, objetivo').eq('id', leadId).maybeSingle();
  const { data: previos } = await supabase.from('call_slots').select('id, fecha, hora_inicio, generado_por_regla').eq('setting_lead_id', leadId).eq('ocupado', true);
  let hadPrevio = false;
  let previa = null;
  for (const p of previos || []) {
    hadPrevio = true; previa = p;
    if (fecha && p.fecha === fecha && p.hora_inicio === hora) return { asignada: true, mensaje: 'Ya estaba en el calendario de Hernán a esa hora.' };
    if (p.generado_por_regla) await supabase.from('call_slots').update({ ocupado: false, setting_lead_id: null, recordatorio_enviado: false, recordatorio_30_enviado: false, recordatorio_5_enviado: false, updated_at: new Date().toISOString() }).eq('id', p.id);
    else await supabase.from('call_slots').delete().eq('id', p.id);
  }
  if (!fecha) {
    if (previa) await avisarLlamada({ empleado: hernan, lead, fecha: previa.fecha, hora: previa.hora_inicio, tipo: 'cancelada' });
    return { asignada: false, mensaje: 'Llamada cancelada: se ha quitado del calendario de Hernán.' };
  }

  const { data: libre } = await supabase.from('call_slots').select('id').eq('employee_id', hernan.id).eq('fecha', fecha).eq('hora_inicio', hora).eq('ocupado', false).limit(1).maybeSingle();
  if (libre) {
    await supabase.from('call_slots').update({ ocupado: true, setting_lead_id: leadId, updated_at: new Date().toISOString() }).eq('id', libre.id);
  } else {
    const [h, m] = hora.split(':').map(Number);
    const fin = h * 60 + m + 30;
    const horaFin = `${String(Math.floor(fin / 60) % 24).padStart(2, '0')}:${String(fin % 60).padStart(2, '0')}:00`;
    const { error } = await supabase.from('call_slots').insert({ employee_id: hernan.id, fecha, hora_inicio: hora, hora_fin: horaFin, ocupado: true, setting_lead_id: leadId });
    if (error) throw error;
  }
  // Una llamada que ya pasó (datos históricos que se meten a posteriori) se
  // coloca en el calendario pero no se avisa a Hernán por email.
  const yaPasada = new Date(fechaLlamada).getTime() < Date.now();
  if (!yaPasada) await avisarLlamada({ empleado: hernan, lead, fecha, hora, tipo: hadPrevio ? 'cambiada' : 'nueva' });
  return { asignada: true, mensaje: `Llamada colocada en el calendario de ${hernan.name} el ${fecha} a las ${hora.slice(0, 5)}.` };
}
