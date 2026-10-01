import { useState } from 'react';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import format from 'date-fns/format';
import parse from 'date-fns/parse';
import startOfWeek from 'date-fns/startOfWeek';
import getDay from 'date-fns/getDay';
import es from 'date-fns/locale/es';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import './CallBigCalendar.css';

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales: { es },
});

// slot de call_slots (fecha "YYYY-MM-DD", hora_inicio/hora_fin "HH:mm:ss")
// -> evento de react-big-calendar (Date de verdad). Se combinan como hora
// LOCAL del navegador — como todo el equipo está en España, esto ya
// coincide con lo que se ve en la interfaz sin más conversión.
function slotToEvent(s, mostrarEmpleado) {
  const [y, m, d] = s.fecha.split('-').map(Number);
  const [h1, mi1] = s.hora_inicio.split(':').map(Number);
  const [h2, mi2] = s.hora_fin.split(':').map(Number);
  const nombreEmpleado = s.empleado?.name || '';
  const title = s.ocupado
    ? (s.lead?.nombre || 'Reservado') + (mostrarEmpleado && nombreEmpleado ? ` · ${nombreEmpleado}` : '')
    : `Libre · ${nombreEmpleado}`;
  return {
    id: s.id,
    title,
    start: new Date(y, m - 1, d, h1, mi1),
    end: new Date(y, m - 1, d, h2, mi2),
    resource: s,
  };
}

/**
 * Calendario visual grande (mes/semana/día), compartido entre "Mi Agenda"
 * (donde cada uno ve/gestiona sus propios huecos) y el selector de reserva
 * de Setting (donde Franco ve huecos libres de todos y reserva con un
 * clic). El color del evento distingue libre / reservado / mío.
 */
export function CallBigCalendar({ slots, onSelectEvent, height = 600, defaultView = 'week', mostrarEmpleado = false }) {
  const events = (slots || []).map(s => slotToEvent(s, mostrarEmpleado));
  // Controlado explícitamente (view/date + onView/onNavigate) — sin esto,
  // los botones de mes/semana/día y las flechas de navegación no
  // respondían (bug real comprobado: la vista se quedaba siempre clavada
  // en la semana inicial pase lo que pase).
  const [view, setView] = useState(defaultView);
  const [date, setDate] = useState(new Date());

  const eventPropGetter = (event) => {
    const s = event.resource;
    let background = '#6b7280';
    if (s.ocupado) background = '#a78bfa';
    else background = '#22c55e';
    return { style: { backgroundColor: background, border: 'none', color: '#0b0b0d', fontWeight: 600, fontSize: '0.72rem' } };
  };

  return (
    <div style={{ height }} className="call-big-calendar">
      <Calendar
        localizer={localizer}
        events={events}
        startAccessor="start"
        endAccessor="end"
        view={view}
        onView={setView}
        date={date}
        onNavigate={setDate}
        views={['month', 'week', 'day']}
        culture="es"
        eventPropGetter={eventPropGetter}
        onSelectEvent={onSelectEvent ? (event) => onSelectEvent(event.resource) : undefined}
        messages={{
          today: 'Hoy', previous: '←', next: '→',
          month: 'Mes', week: 'Semana', day: 'Día',
          noEventsInRange: 'Sin huecos en este rango.',
          showMore: (total) => `+${total} más`,
        }}
      />
    </div>
  );
}
