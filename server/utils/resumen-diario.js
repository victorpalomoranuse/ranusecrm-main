import { supabase } from '../config/supabase.js';
import { sendEmail } from '../services/email.service.js';

const HORA_ENVIO = 8; // hora de Madrid a partir de la cual se manda el resumen

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function ahoraMadrid() {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const g = (t) => p.find(x => x.type === t).value;
  return { fecha: `${g('year')}-${g('month')}-${g('day')}`, hora: parseInt(g('hour'), 10) };
}

// Una vez al día (a partir de las 8:00 Madrid) manda al admin un email con
// las tareas pendientes que vencen hoy o están atrasadas y los eventos de
// hoy. Si no hay nada, no manda nada. Nunca lanza.
export async function enviarResumenDiario() {
  try {
    const { fecha, hora } = ahoraMadrid();
    if (hora < HORA_ENVIO) return;

    const { data: ajustes, error: errAjustes } = await supabase.from('settings').select('resumen_diario_enviado, resumen_diario_email').eq('id', 1).maybeSingle();
    if (errAjustes) return; // migración v57 aún sin aplicar: no enviar (se repetiría)
    if (ajustes?.resumen_diario_enviado === fecha) return;

    let destino = ajustes?.resumen_diario_email?.trim();
    if (!destino) {
      const { data: admin } = await supabase.from('users').select('email').eq('role', 'admin_superior').order('created_at', { ascending: true }).limit(1).maybeSingle();
      destino = admin?.email;
    }
    if (!destino) return;

    const [{ data: tareas }, { data: eventos }] = await Promise.all([
      supabase.from('tasks').select('title, priority, due_date, project:client_projects(client_name, project_name)').eq('done', false).not('due_date', 'is', null).lte('due_date', fecha).order('due_date', { ascending: true }),
      supabase.from('events').select('title, time, description').eq('date', fecha).neq('done', true).order('time', { ascending: true, nullsFirst: true }),
    ]);

    // Marcamos antes de enviar para no repetir si hay varios arranques seguidos
    const { error: errMarca } = await supabase.from('settings').upsert({ id: 1, resumen_diario_enviado: fecha });
    if (errMarca) return;

    if (!(tareas || []).length && !(eventos || []).length) return;

    const fmt = new Date(`${fecha}T12:00:00Z`).toLocaleDateString('es-ES', { weekday: 'long', day: '2-digit', month: 'long', timeZone: 'Europe/Madrid' });
    const liEventos = (eventos || []).map(e => `<li><strong>${e.time ? esc(e.time.slice(0, 5)) + ' · ' : ''}</strong>${esc(e.title)}${e.description ? ` <span style="color:#777">— ${esc(e.description)}</span>` : ''}</li>`).join('');
    const liTareas = (tareas || []).map(t => {
      const atrasada = t.due_date < fecha;
      const proy = t.project ? ` <span style="color:#777">(${esc(t.project.client_name || t.project.project_name)})</span>` : '';
      return `<li>${esc(t.title)}${proy}${atrasada ? ' <span style="color:#c0392b">· atrasada desde ' + t.due_date.split('-').reverse().join('/') + '</span>' : ''}${t.priority === 'alta' || t.priority === 'high' ? ' 🔥' : ''}</li>`;
    }).join('');

    const html = `
      <div style="font-family: sans-serif; color: #222;">
        <h2>Tu día — ${fmt}</h2>
        ${liEventos ? `<h3>Eventos de hoy</h3><ul>${liEventos}</ul>` : ''}
        ${liTareas ? `<h3>Tareas pendientes (hoy y atrasadas)</h3><ul>${liTareas}</ul>` : ''}
        <p style="color:#777">Resumen automático de Ranuse CRM.</p>
      </div>`;
    await sendEmail({ to: destino, subject: `Tu día: ${(eventos || []).length} eventos y ${(tareas || []).length} tareas`, html });
  } catch (e) {
    console.error('Error en el resumen diario:', e);
  }
}
