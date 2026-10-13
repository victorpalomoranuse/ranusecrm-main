import { useState, useEffect } from 'react';
import { CheckCircle, Circle, AlertCircle, CalendarDays } from 'lucide-react';
import api from '../services/api';
import { TaskDetailModal } from './TaskDetailModal';
import { EventDetailModal } from './EventDetailModal';

// Panel de la pantalla de Inicio: tareas pendientes (vencidas, de hoy y
// próximas) y eventos que vienen. Las tareas se pueden marcar como hechas
// desde aquí; al pulsar una se abre su ficha. Los trabajadores ven solo sus
// tareas; los eventos son del administrador.

const card = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '1rem 1.1rem' };
const muted = { fontSize: '0.72rem', color: 'rgba(255,255,255,0.45)' };
const COLOR_PRIORIDAD = { baja: '#8bae8f', normal: '#baafa5', alta: '#ae9e8b', urgente: '#ae8b8b' };

const hoyISO = () => new Date().toLocaleDateString('sv'); // YYYY-MM-DD en hora local
const sumarDias = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv'); };
const fmtDia = (iso, hoy) => {
  if (!iso) return 'Sin fecha';
  if (iso === hoy) return 'Hoy';
  if (iso === sumarDias(hoy, 1)) return 'Mañana';
  if (iso === sumarDias(hoy, -1)) return 'Ayer';
  return new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
};

export function PanelTareasEventos({ puedeVerTareas, ir }) {
  const [tareas, setTareas] = useState(null);
  const [eventos, setEventos] = useState([]);
  const [verTodas, setVerTodas] = useState(false);
  const [detalleTarea, setDetalleTarea] = useState(null);
  const [detalleEvento, setDetalleEvento] = useState(null);
  const hoy = hoyISO();

  useEffect(() => {
    api.get('/tasks').then(r => setTareas(r.data.tasks || [])).catch(() => setTareas([]));
    api.get('/events').then(r => setEventos(r.data.events || [])).catch(() => setEventos([]));
  }, []);

  const marcar = async (t) => {
    try {
      const { data } = await api.put(`/tasks/${t.id}`, { done: !t.done });
      setTareas(prev => prev.map(x => (x.id === t.id ? data.task : x)));
    } catch { /* sin permiso o sin conexión */ }
  };

  const pendientes = (tareas || []).filter(t => !t.done)
    .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
  const vencidas = pendientes.filter(t => t.due_date && t.due_date < hoy);
  const deHoy = pendientes.filter(t => t.due_date === hoy);
  const proximas = pendientes.filter(t => t.due_date && t.due_date > hoy);
  const sinFecha = pendientes.filter(t => !t.due_date);
  const orden = [['Vencidas', vencidas, '#ae8b8b'], ['Hoy', deHoy, '#baafa5'], ['Próximas', proximas, null], ['Sin fecha', sinFecha, null]];
  const LIMITE = 8;
  let mostradas = 0;

  const proximosEventos = eventos.filter(e => !e.done && e.date >= hoy && e.date <= sumarDias(hoy, 21)).sort((a, b) => `${a.date} ${a.time || ''}`.localeCompare(`${b.date} ${b.time || ''}`));

  const fila = (t) => {
    const urgente = t.due_date && t.due_date < hoy;
    return (
      <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <button type="button" onClick={() => marcar(t)} title="Marcar como hecha" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', padding: 0, display: 'flex' }}>
          {t.done ? <CheckCircle size={17} color="#8bae8f" /> : <Circle size={17} />}
        </button>
        <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => setDetalleTarea(t)}>
          <div style={{ fontSize: '0.86rem', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: COLOR_PRIORIDAD[t.priority] || '#baafa5', flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</span>
          </div>
          <div style={muted}>
            {[t.project ? `${t.project.client_name}` : null, t.employee?.name, t.due_date ? fmtDia(t.due_date, hoy) : null].filter(Boolean).join(' · ')}
          </div>
        </div>
        {urgente && <AlertCircle size={14} color="#ae8b8b" />}
      </div>
    );
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginBottom: 24 }}>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
          <p style={{ fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.4)', margin: 0 }}>
            Tareas{tareas ? ` · ${pendientes.length} pendiente${pendientes.length === 1 ? '' : 's'}` : ''}
          </p>
          {puedeVerTareas && <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => ir('tareas')}>Abrir Tareas</button>}
        </div>
        {tareas === null && <p style={muted}>Cargando…</p>}
        {tareas && pendientes.length === 0 && <p style={{ ...muted, marginTop: 8 }}>No tienes tareas pendientes. 🎉</p>}
        {orden.map(([titulo, lista, color]) => {
          if (!lista.length) return null;
          const visibles = verTodas ? lista : lista.slice(0, Math.max(0, LIMITE - mostradas));
          mostradas += lista.length;
          if (!visibles.length) return null;
          return (
            <div key={titulo} style={{ marginTop: 10 }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 600, color: color || 'rgba(255,255,255,0.45)', marginBottom: 2 }}>{titulo} ({lista.length})</div>
              {visibles.map(fila)}
            </div>
          );
        })}
        {!verTodas && pendientes.length > LIMITE && (
          <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" style={{ marginTop: 10 }} onClick={() => setVerTodas(true)}>Ver las {pendientes.length} tareas</button>
        )}
      </div>

      <div style={card}>
        <p style={{ fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.4)', margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <CalendarDays size={13} /> Eventos próximos
        </p>
        {proximosEventos.length === 0 && <p style={{ ...muted, marginTop: 8 }}>No hay eventos en las próximas tres semanas.</p>}
        {proximosEventos.map(e => (
          <div key={e.id} onClick={() => setDetalleEvento(e)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer' }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: e.color || '#baafa5', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.86rem' }}>{e.title}</div>
              <div style={muted}>{fmtDia(e.date, hoy)}{e.time ? ` · ${String(e.time).slice(0, 5)}` : ''}</div>
            </div>
          </div>
        ))}
      </div>

      {detalleTarea && (
        <TaskDetailModal
          task={detalleTarea}
          onClose={() => setDetalleTarea(null)}
          onUpdated={u => { setTareas(prev => prev.map(t => (t.id === u.id ? u : t))); setDetalleTarea(u); }}
          onDeleted={id => { setTareas(prev => prev.filter(t => t.id !== id)); setDetalleTarea(null); }}
        />
      )}
      {detalleEvento && (
        <EventDetailModal
          event={detalleEvento}
          onClose={() => setDetalleEvento(null)}
          onUpdated={u => { setEventos(prev => prev.map(e => (e.id === u.id ? u : e))); setDetalleEvento(u); }}
          onDeleted={id => { setEventos(prev => prev.filter(e => e.id !== id)); setDetalleEvento(null); }}
        />
      )}
    </div>
  );
}
