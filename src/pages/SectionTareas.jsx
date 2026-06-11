import { useState, useEffect } from 'react';
import api from '../services/api';
import { Plus, Trash2, CheckCircle, Circle, AlertCircle } from 'lucide-react';

const PRIORITIES = [
  { value: 'baja', label: 'Baja', color: '#8bae8f' },
  { value: 'normal', label: 'Normal', color: '#beb0a2' },
  { value: 'alta', label: 'Alta', color: '#ae9e8b' },
  { value: 'urgente', label: 'Urgente', color: '#ae8b8b' },
];

export function SectionTareas() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('normal');
  const [dueDate, setDueDate] = useState('');
  const [adding, setAdding] = useState(false);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    api.get('/tasks').then(r => setTasks(r.data.tasks || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setAdding(true);
    try {
      const { data } = await api.post('/tasks', { title, description, priority, due_date: dueDate || null });
      setTasks(prev => [data.task, ...prev]);
      setTitle(''); setDescription(''); setPriority('normal'); setDueDate('');
      setShowForm(false);
    } catch {} finally { setAdding(false); }
  };

  const toggleDone = async (task) => {
    try {
      const { data } = await api.put(`/tasks/${task.id}`, { done: !task.done });
      setTasks(prev => prev.map(t => t.id === task.id ? data.task : t).sort((a, b) => a.done - b.done));
    } catch {}
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/tasks/${id}`);
      setTasks(prev => prev.filter(t => t.id !== id));
    } catch {}
  };

  const pending = tasks.filter(t => !t.done);
  const done = tasks.filter(t => t.done);

  const isOverdue = (task) => {
    if (!task.due_date || task.done) return false;
    return new Date(task.due_date) < new Date(new Date().toDateString());
  };

  const getPriority = (value) => PRIORITIES.find(p => p.value === value) || PRIORITIES[1];

  return (
    <div className="ap-section">
      <div className="ap-section-head">
        <div><h1>Tareas</h1><p>Gestiona tus pendientes.</p></div>
        <button className="ap-btn ap-btn-primary" onClick={() => setShowForm(v => !v)}>
          <Plus size={15}/> Nueva tarea
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleAdd} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '1.25rem', marginBottom: '1.5rem' }}>
          <div className="ap-field"><label>Título *</label><input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ej: Llamar a cliente Pedro" required autoFocus /></div>
          <div className="ap-field"><label>Descripción <span className="ap-optional">(opcional)</span></label><textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="Detalles..." /></div>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <div className="ap-field" style={{ flex: 1, minWidth: 140 }}>
              <label>Prioridad</label>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                {PRIORITIES.map(p => (
                  <button key={p.value} type="button" onClick={() => setPriority(p.value)}
                    style={{ padding: '4px 10px', borderRadius: 20, border: `1px solid ${p.color}`, background: priority === p.value ? p.color : 'transparent', color: priority === p.value ? '#0a0a0a' : p.color, fontSize: '0.75rem', cursor: 'pointer' }}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="ap-field" style={{ flex: 1, minWidth: 140 }}>
              <label>Fecha límite <span className="ap-optional">(opcional)</span></label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="ap-field-input" />
            </div>
          </div>
          <div className="ap-modal-actions">
            <button type="button" className="ap-btn ap-btn-ghost" onClick={() => setShowForm(false)}>Cancelar</button>
            <button type="submit" className="ap-btn ap-btn-primary" disabled={adding || !title.trim()}>{adding ? 'Añadiendo…' : 'Añadir tarea'}</button>
          </div>
        </form>
      )}

      {loading ? <div className="ap-loading">Cargando…</div> : tasks.length === 0 ? (
        <div className="ap-empty"><p>No hay tareas todavía.</p></div>
      ) : (
        <div>
          {pending.length > 0 && (
            <div style={{ marginBottom: '2rem' }}>
              <p style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.3)', marginBottom: '0.75rem' }}>Pendientes ({pending.length})</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {pending.map(task => {
                  const pri = getPriority(task.priority);
                  const overdue = isOverdue(task);
                  return (
                    <div key={task.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '0.75rem 1rem' }}>
                      <button onClick={() => toggleDone(task)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', flexShrink: 0, paddingTop: 2 }}><Circle size={18}/></button>
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: 0, fontSize: '0.9rem', color: '#fff', fontWeight: 500 }}>{task.title}</p>
                        {task.description && <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'rgba(255,255,255,0.45)' }}>{task.description}</p>}
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 20, border: `1px solid ${pri.color}`, color: pri.color }}>{pri.label}</span>
                          {task.due_date && (
                            <span style={{ fontSize: '0.72rem', color: overdue ? '#ae8b8b' : 'rgba(255,255,255,0.4)', display: 'flex', alignItems: 'center', gap: 3 }}>
                              {overdue && <AlertCircle size={11}/>}
                              {new Date(task.due_date + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
                            </span>
                          )}
                        </div>
                      </div>
                      <button onClick={() => handleDelete(task.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.2)', flexShrink: 0 }}><Trash2 size={14}/></button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {done.length > 0 && (
            <div>
              <p style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.2)', marginBottom: '0.75rem' }}>Completadas ({done.length})</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {done.map(task => (
                  <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'rgba(255,255,255,0.015)', borderRadius: 10, padding: '0.6rem 1rem', opacity: 0.5 }}>
                    <button onClick={() => toggleDone(task)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8bae8f', flexShrink: 0 }}><CheckCircle size={18}/></button>
                    <p style={{ margin: 0, fontSize: '0.88rem', color: 'rgba(255,255,255,0.5)', textDecoration: 'line-through', flex: 1 }}>{task.title}</p>
                    <button onClick={() => handleDelete(task.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.2)', flexShrink: 0 }}><Trash2 size={14}/></button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
