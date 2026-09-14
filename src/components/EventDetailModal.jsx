import { X, Trash2 } from 'lucide-react';
import api from '../services/api';

export function EventDetailModal({ event, onClose, onDeleted }) {
  if (!event) return null;

  const remove = async () => {
    try {
      await api.delete(`/events/${event.id}`);
      onDeleted?.(event.id);
      onClose();
    } catch {}
  };

  return (
    <div className="ap-modal-overlay" onClick={onClose}>
      <div className="ap-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="ap-modal-head">
          <h2 style={{ fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: event.color, flexShrink: 0 }} />
            {event.title}
          </h2>
          <button className="ap-modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div style={{ padding: '0 1.5rem 1.5rem' }}>
          <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.45)', marginBottom: '1rem' }}>
            {new Date(event.date + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}
            {event.time && ` · ${event.time}`}
          </p>
          {event.description ? (
            <p style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.75)', lineHeight: 1.5, whiteSpace: 'pre-wrap', marginBottom: '1rem' }}>{event.description}</p>
          ) : (
            <p style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.3)', marginBottom: '1rem' }}>Sin descripción.</p>
          )}
          <div className="ap-modal-actions" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="ap-btn ap-btn-ghost" onClick={remove} style={{ color: '#ae8b8b' }}><Trash2 size={13} style={{ marginRight: 4, verticalAlign: -2 }} />Eliminar</button>
          </div>
        </div>
      </div>
    </div>
  );
}
