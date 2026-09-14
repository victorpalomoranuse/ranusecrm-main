import { X, CheckCircle, Circle, Trash2, AlertCircle } from 'lucide-react';
import api from '../services/api';

const PRIORITIES = {
  baja: { label: 'Baja', color: '#8bae8f' },
  normal: { label: 'Normal', color: '#beb0a2' },
  alta: { label: 'Alta', color: '#ae9e8b' },
  urgente: { label: 'Urgente', color: '#ae8b8b' },
};

export function TaskDetailModal({ task, onClose, onUpdated, onDeleted }) {
  if (!task) return null;
  const pri = PRIORITIES[task.priority] || PRIORITIES.normal;
  const overdue = task.due_date && !task.done && new Date(task.due_date) < new Date(new Date().toDateString());

  const toggleDone = async () => {
    try {
      const { data } = await api.put(`/tasks/${task.id}`, { done: !task.done });
      onUpdated?.(data.task);
    } catch {}
  };

  const remove = async () => {
    try {
      await api.delete(`/tasks/${task.id}`);
      onDeleted?.(task.id);
      onClose();
    } catch {}
  };

  return (
    <div className="ap-modal-overlay" onClick={onClose}>
      <div className="ap-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="ap-modal-head">
          <h2 style={{ fontSize: '1rem' }}>{task.title}</h2>
          <button className="ap-modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div style={{ padding: '0 1.5rem 1.5rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <span style={{ fontSize: '0.72rem', padding: '3px 10px', borderRadius: 20, border: `1px solid ${pri.color}`, color: pri.color }}>{pri.label}</span>
            {task.due_date && (
              <span style={{ fontSize: '0.72rem', padding: '3px 10px', borderRadius: 20, background: overdue ? 'rgba(174,139,139,0.15)' : 'rgba(255,255,255,0.06)', color: overdue ? '#ae8b8b' : 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center', gap: 4 }}>
                {overdue && <AlertCircle size={11} />}
                {new Date(task.due_date + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'long' })}
              </span>
            )}
            {task.project && (
              <span style={{ fontSize: '0.72rem', padding: '3px 10px', borderRadius: 20, background: 'rgba(190,176,162,0.1)', color: '#beb0a2' }}>
                {task.project.client_name}{task.project.project_name ? ` — ${task.project.project_name}` : ''}{task.category?.name && ` · ${task.category.name}`}
              </span>
            )}
          </div>

          {task.description ? (
            <p style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.75)', lineHeight: 1.5, whiteSpace: 'pre-wrap', marginBottom: '1rem' }}>{task.description}</p>
          ) : (
            <p style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.3)', marginBottom: '1rem' }}>Sin descripción.</p>
          )}

          {task.employee?.name && (
            <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.45)', marginBottom: '1rem' }}>Asignada a <strong style={{ color: '#fff' }}>{task.employee.name}</strong></p>
          )}

          <div className="ap-modal-actions" style={{ justifyContent: 'space-between' }}>
            <button type="button" className="ap-btn ap-btn-ghost" onClick={remove} style={{ color: '#ae8b8b' }}><Trash2 size={13} style={{ marginRight: 4, verticalAlign: -2 }} />Eliminar</button>
            <button type="button" className="ap-btn ap-btn-primary" onClick={toggleDone}>
              {task.done ? <CheckCircle size={14} style={{ marginRight: 4, verticalAlign: -2 }} /> : <Circle size={14} style={{ marginRight: 4, verticalAlign: -2 }} />}
              {task.done ? 'Marcar pendiente' : 'Marcar completada'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
