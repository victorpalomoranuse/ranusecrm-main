import { X, Trash2, CheckCircle, Circle } from 'lucide-react';
import api from '../services/api';

export function EventDetailModal({ event, onClose, onUpdated, onDeleted }) {
  if (!event) return null;

  const remove = async () => {
    try {
      await api.delete(`/events/${event.id}`);
      onDeleted?.(event.id);
      onClose();
    } catch {}
  };

  const toggleDone = async () => {
    try {
      const { data } = await api.put(`/events/${event.id}`, { done: !event.done });
      onUpdated?.(data.event);
    } catch {}
  };

  return (
    <div className="ap-modal-overlay" onClick={onClose}>
      <div className="ap-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="ap-modal-head">
          <h2 style={{ fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 8, textDecoration: event.done ? 'line-through' : 'none', opacity: event.done ? 0.6 : 1 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: event.color, flexShrink: 0 }} />
            {event.title}
          </h2>
          <button className="ap-modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div style={{ padding: '0 1.5rem 1.5rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <span style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.45)' }}>
              {new Date(event.date + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}
              {event.time && ` · ${event.time}`}
            </span>
            {event.done && (
              <span style={{ fontSize: '0.7rem', padding: '2px 9px', borderRadius: 20, background: 'rgba(139,174,143,0.15)', color: '#8bae8f' }}>Finalizado</span>
            )}
          </div>
          {event.description ? (
            <p style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.75)', lineHeight: 1.5, whiteSpace: 'pre-wrap', marginBottom: '1rem' }}>{event.description}</p>
          ) : (
            <p style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.3)', marginBottom: '1rem' }}>Sin descripción.</p>
          )}
          <div className="ap-modal-actions" style={{ justifyContent: 'space-between' }}>
            <button type="button" className="ap-btn ap-btn-ghost" onClick={remove} style={{ color: '#ae8b8b' }}><Trash2 size={13} style={{ marginRight: 4, verticalAlign: -2 }} />Eliminar</button>
            <button type="button" className="ap-btn ap-btn-primary" onClick={toggleDone}>
              {event.done ? <Circle size={14} style={{ marginRight: 4, verticalAlign: -2 }} /> : <CheckCircle size={14} style={{ marginRight: 4, verticalAlign: -2 }} />}
              {event.done ? 'Marcar pendiente' : 'Marcar finalizado'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
