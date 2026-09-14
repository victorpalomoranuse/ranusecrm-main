import express from 'express';
import crypto from 'crypto';
import { supabase } from '../config/supabase.js';
import { authenticateToken } from '../middleware/auth.middleware.js';

const router = express.Router();

function feedToken() {
  return crypto.createHash('sha256').update(`${process.env.JWT_SECRET}:calendar-feed`).digest('hex').slice(0, 32);
}

/**
 * GET /api/calendar/feed-url
 * Devuelve la URL (https y webcal) del feed .ics para suscribirse desde
 * Google Calendar / Apple Calendar. El token es estable (derivado de
 * JWT_SECRET), no cambia entre peticiones.
 */
router.get('/feed-url', authenticateToken, (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  const path = `/api/calendar/feed/${feedToken()}.ics`;
  res.json({
    url: `${base}${path}`,
    webcal: `webcal://${req.get('host')}${path}`,
  });
});

function icsEscape(str) {
  return String(str || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function foldLine(line) {
  // RFC 5545: las líneas no deberían superar 75 octetos; se pliegan con \r\n + espacio.
  if (line.length <= 75) return line;
  let result = '';
  let rest = line;
  while (rest.length > 75) {
    result += rest.slice(0, 75) + '\r\n ';
    rest = rest.slice(75);
  }
  return result + rest;
}

function dateStamp(d) {
  return new Date(d).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/**
 * GET /api/calendar/feed/:token.ics
 * Feed público (sin login, protegido por el token en la URL) con todas las
 * tareas con fecha límite y todos los eventos, en formato iCalendar — para
 * suscribirse desde el móvil (Google Calendar / Apple Calendar). Solo
 * lectura: lo que se cree aquí no se puede editar desde el calendario.
 */
router.get('/feed/:token.ics', async (req, res) => {
  if (req.params.token !== feedToken()) {
    return res.status(404).send('Not found');
  }

  try {
    const [{ data: tasks }, { data: events }] = await Promise.all([
      supabase.from('tasks').select('id, title, description, due_date, done, project:client_projects(client_name, project_name)').not('due_date', 'is', null),
      supabase.from('events').select('id, title, description, date, time'),
    ]);

    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ranuse Design//CRM//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Ranuse CRM'];

    (tasks || []).forEach(t => {
      const dateOnly = t.due_date.slice(0, 10).replace(/-/g, '');
      const summary = t.done ? `✔ ${t.title}` : t.title;
      const descParts = [];
      if (t.description) descParts.push(t.description);
      if (t.project) descParts.push(`Obra: ${t.project.client_name} — ${t.project.project_name}`);
      lines.push('BEGIN:VEVENT');
      lines.push(foldLine(`UID:task-${t.id}@ranusedesign.com`));
      lines.push(`DTSTAMP:${dateStamp(new Date())}`);
      lines.push(`DTSTART;VALUE=DATE:${dateOnly}`);
      lines.push(foldLine(`SUMMARY:${icsEscape(summary)}`));
      if (descParts.length) lines.push(foldLine(`DESCRIPTION:${icsEscape(descParts.join(' — '))}`));
      lines.push(`STATUS:${t.done ? 'COMPLETED' : 'CONFIRMED'}`);
      lines.push('END:VEVENT');
    });

    (events || []).forEach(e => {
      lines.push('BEGIN:VEVENT');
      lines.push(foldLine(`UID:event-${e.id}@ranusedesign.com`));
      lines.push(`DTSTAMP:${dateStamp(new Date())}`);
      if (e.time) {
        const dt = `${e.date.replace(/-/g, '')}T${e.time.replace(/:/g, '').padEnd(6, '0')}`;
        lines.push(`DTSTART:${dt}`);
      } else {
        lines.push(`DTSTART;VALUE=DATE:${e.date.replace(/-/g, '')}`);
      }
      lines.push(foldLine(`SUMMARY:${icsEscape(e.title)}`));
      if (e.description) lines.push(foldLine(`DESCRIPTION:${icsEscape(e.description)}`));
      lines.push('END:VEVENT');
    });

    lines.push('END:VCALENDAR');

    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', 'inline; filename="ranuse-crm.ics"');
    res.send(lines.join('\r\n') + '\r\n');
  } catch (error) {
    console.error('Error generando feed de calendario:', error);
    res.status(500).send('Error generando calendario');
  }
});

export default router;
