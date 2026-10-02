import { supabase } from '../config/supabase.js';
import { sendEmail } from '../services/email.service.js';
import { madridToUtcDate } from './timezone.js';

// Email inmediato al dueño del hueco (Hernán) cuando le agendan, le cambian
// o le cancelan una llamada — además del recordatorio de 24h antes. tipo:
// 'nueva' | 'cambiada' | 'cancelada'. Nunca lanza: un fallo de email no puede
// romper la reserva.
const TEXTOS = {
  nueva: { asunto: 'Nueva llamada agendada', titulo: 'Te han agendado una llamada' },
  cambiada: { asunto: 'Llamada cambiada de hora', titulo: 'Se ha cambiado una llamada tuya' },
  cancelada: { asunto: 'Llamada cancelada', titulo: 'Se ha cancelado una llamada tuya' },
};

export async function avisarLlamada({ empleado, lead, fecha, hora, tipo }) {
  try {
    if (!empleado?.email || !fecha) return;
    const t = TEXTOS[tipo] || TEXTOS.nueva;
    const inicio = madridToUtcDate(fecha, hora.length === 5 ? `${hora}:00` : hora);
    const fechaFmt = inicio.toLocaleDateString('es-ES', { weekday: 'long', day: '2-digit', month: 'long', timeZone: 'Europe/Madrid' });
    const horaFmt = inicio.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
    const nombreLead = lead?.nombre || 'Prospecto sin nombre';
    const html = `
      <div style="font-family: sans-serif; color: #222;">
        <h2>${t.titulo}</h2>
        <p>Hola ${empleado.name || ''},</p>
        <ul>
          <li><strong>Con:</strong> ${nombreLead}</li>
          <li><strong>Cuándo:</strong> ${fechaFmt} a las ${horaFmt}</li>
          ${lead?.telefono ? `<li><strong>Teléfono:</strong> ${lead.telefono}</li>` : ''}
          ${lead?.instagram ? `<li><strong>Instagram:</strong> @${lead.instagram}</li>` : ''}
          ${lead?.objetivo ? `<li><strong>Objetivo:</strong> ${lead.objetivo}</li>` : ''}
        </ul>
        <p>${tipo === 'cancelada' ? 'Ya no aparece en tu calendario.' : 'Ya está en tu calendario del CRM (Mi Agenda). Te recordaremos otra vez 24h antes.'}</p>
      </div>`;
    await sendEmail({ to: empleado.email, subject: `${t.asunto}: ${nombreLead} — ${fechaFmt} ${horaFmt}`, html });
  } catch (e) {
    console.error('Error al avisar de la llamada:', e);
  }
}
