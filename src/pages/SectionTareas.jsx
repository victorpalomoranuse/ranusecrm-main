import { useState, useEffect } from 'react';
import api from '../services/api';
import { Plus, Trash2, CheckCircle, Circle, AlertCircle, ChevronLeft, ChevronRight, X } from 'lucide-react';

const PRIORITIES = [
  { value: 'baja', label: 'Baja', color: '#8bae8f' },
  { value: 'normal', label: 'Normal', color: '#beb0a2' },
  { value: 'alta', label: 'Alta', color: '#ae9e8b' },
  { value: 'urgente', label: 'Urgente', color: '#ae8b8b' },
];

const EVENT_COLORS = ['#beb0a2', '#8b9eae', '#8bae8f', '#ae9e8b', '#ae8b8b', '#9e8bae'];

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year, month) {
  const day = new Date(year, month, 1).getDay();
  return day === 0 ? 6 : day - 1;
}

export function SectionTareas() {
  const [tasks, setTasks] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('ambos'); // 'ambos' | 'tareas' | 'calendario'

  // Task form
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [taskPriority, setTaskPriority] = useState('normal');
  const [taskDue, setTaskDue] = useState('');
  const [addingTask, setAddingTask] = useState(false);

  // Event form
  const [showEventForm, setShowEventForm] = useState(false);
  const [eventTitle, setEventTitle] = useState('');
  const [eventDesc, setEventDesc] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventTime, setEventTime] = useState('');
  const [eventColor, setEventColor] = useState('#beb0a2');
  const [addingEvent, setAddingEvent] = useState(false);

  // Calendar
  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState(null);

  useEffect(() => {
    Promise.all([api.get('/tasks'), api.get('/events')])
      .then(([t, e]) => { setTasks(t.data.tasks || []); setEvents(e.data.events || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleAddTask = async (e) => {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    setAddingTask(true);
    try {
      const { data } = await api.post('/tasks', { title: taskTitle, description: taskDesc, priority: taskPriority, due_date: taskDue || null });
      setTasks(prev => [data.task, ...prev]);
      setTaskTitle(''); setTaskDesc(''); setTaskPriority('normal'); setTaskDue('');
      setShowTaskForm(false);
    } catch {} finally { setAddingTask(false); }
  };

  const handleAddEvent = async (e) => {
    e.preventDefault();
    if (!eventTitle.trim() || !eventDate) return;
    setAddingEvent(true);
    try {
      const { data } = await api.post('/events', { title: eventTitle, description: eventDesc, date: eventDate, time: eventTime || null, color: eventColor });
      setEvents(prev => [...prev, data.event].sort((a, b) => a.date.localeCompare(b.date)));
      setEventTitle(''); setEventDesc(''); setEventDate(''); setEventTime(''); setEventColor('#beb0a2');
      setShowEventForm(false);
    } catch {} finally { setAddingEvent(false); }
  };

  const toggleDone = async (task) => {
    try {
      const { data } = await api.put(`/tasks/${task.id}`, { done: !task.done });
      setTasks(prev => prev.map(t => t.id === task.id ? data.task : t).sort((a, b) => a.done - b.done));
    } catch {}
  };

  const deleteTask = async (id) => {
    try { await api.delete(`/tasks/${id}`); setTasks(prev => prev.filter(t => t.id !== id)); } catch {}
  };

  const deleteEvent = async (id) => {
    try { await api.delete(`/events/${id}`); setEvents(prev => prev.filter(e => e.id !== id)); } catch {}
  };

  const isOverdue = (task) => {
    if (!task.due_date || task.done) return false;
    return new Date(task.due_date) < new Date(new Date().toDateString());
  };

  const getPriority = (value) => PRIORITIES.find(p => p.value === value) || PRIORITIES[1];

  // Calendar helpers
  const daysInMonth = getDaysInMonth(calYear, calMonth);
  const firstDay = getFirstDayOfMonth(calYear, calMonth);
  const monthName = new Date(calYear, calMonth, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

  const getItemsForDay = (day) => {
    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayEvents = events.filter(e => e.date === dateStr);
    const dayTasks = tasks.filter(t => t.due_date && t.due_date.slice(0, 10) === dateStr);
    return { events: dayEvents, tasks: dayTasks };
  };

  const selectedDateStr = selectedDay
    ? `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`
    : null;

  const selectedItems = selectedDay ? getItemsForDay(selectedDay) : null;

  const pending = tasks.filter(t => !t.done);
  const done = tasks.filter(t => t.done);

  const WEEK_DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  return (
    <div className="ap-section">
      <div className="ap-section-head">
        <div><h1>Tareas y Calendario</h1><p>Gestiona tus pendientes y eventos.</p></div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 3 }}>
            {['ambos', 'tareas', 'calendario'].map(v => (
              <button key={v} onClick={() => setView(v)} style={{ padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: '0.78rem', background: view === v ? '#beb0a2' : 'transparent', color: view === v ? '#0a0a0a' : 'rgba(255,255,255,0.5)', fontWeight: view === v ? 600 : 400 }}>
                {v === 'ambos' ? 'Todo' : v === 'tareas' ? 'Tareas' : 'Calendario'}
              </button>
            ))}
          </div>
          <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => { setShowEventForm(v => !v); setShowTaskForm(false); }}>+ Evento</button>
          <button className="ap-btn ap-btn-primary ap-btn-sm" onClick={() => { setShowTaskForm(v => !v); setShowEventForm(false); }}>+ Tarea</button>
        </div>
      </div>

      {/* Task form */}
      {showTaskForm && (
        <form onSubmit={handleAddTask} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '1.25rem', marginBottom: '1.5rem' }}>
          <div className="ap-field"><label>Título *</label><input value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="Ej: Llamar a cliente Pedro" required autoFocus /></div>
          <div className="ap-field"><label>Descripción <span className="ap-optional">(opcional)</span></label><textarea value={taskDesc} onChange={e => setTaskDesc(e.target.value)} rows={2} placeholder="Detalles..." /></div>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <div className="ap-field" style={{ flex: 1, minWidth: 140 }}>
              <label>Prioridad</label>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                {PRIORITIES.map(p => (
                  <button key={p.value} type="button" onClick={() => setTaskPriority(p.value)}
                    style={{ padding: '4px 10px', borderRadius: 20, border: `1px solid ${p.color}`, background: taskPriority === p.value ? p.color : 'transparent', color: taskPriority === p.value ? '#0a0a0a' : p.color, fontSize: '0.75rem', cursor: 'pointer' }}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="ap-field" style={{ flex: 1, minWidth: 140 }}>
              <label>Fecha límite <span className="ap-optional">(opcional)</span></label>
              <input type="date" value={taskDue} onChange={e => setTaskDue(e.target.value)} className="ap-field-input" />
            </div>
          </div>
          <div className="ap-modal-actions">
            <button type="button" className="ap-btn ap-btn-ghost" onClick={() => setShowTaskForm(false)}>Cancelar</button>
            <button type="submit" className="ap-btn ap-btn-primary" disabled={addingTask || !taskTitle.trim()}>{addingTask ? 'Añadiendo…' : 'Añadir tarea'}</button>
          </div>
        </form>
      )}

      {/* Event form */}
      {showEventForm && (
        <form onSubmit={handleAddEvent} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '1.25rem', marginBottom: '1.5rem' }}>
          <div className="ap-field"><label>Título *</label><input value={eventTitle} onChange={e => setEventTitle(e.target.value)} placeholder="Ej: Reunión con cliente" required autoFocus /></div>
          <div className="ap-field"><label>Descripción <span className="ap-optional">(opcional)</span></label><textarea value={eventDesc} onChange={e => setEventDesc(e.target.value)} rows={2} placeholder="Detalles..." /></div>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <div className="ap-field" style={{ flex: 1, minWidth: 140 }}>
              <label>Fecha *</label>
              <input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} className="ap-field-input" required />
            </div>
            <div className="ap-field" style={{ flex: 1, minWidth: 140 }}>
              <label>Hora <span className="ap-optional">(opcional)</span></label>
              <input type="time" value={eventTime} onChange={e => setEventTime(e.target.value)} className="ap-field-input" />
            </div>
          </div>
          <div className="ap-field">
            <label>Color</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {EVENT_COLORS.map(c => (
                <button key={c} type="button" onClick={() => setEventColor(c)}
                  style={{ width: 24, height: 24, borderRadius: '50%', background: c, border: eventColor === c ? '3px solid #fff' : '2px solid transparent', cursor: 'pointer' }} />
              ))}
            </div>
          </div>
          <div className="ap-modal-actions">
            <button type="button" className="ap-btn ap-btn-ghost" onClick={() => setShowEventForm(false)}>Cancelar</button>
            <button type="submit" className="ap-btn ap-btn-primary" disabled={addingEvent || !eventTitle.trim() || !eventDate}>{addingEvent ? 'Añadiendo…' : 'Añadir evento'}</button>
          </div>
        </form>
      )}

      {loading ? <div className="ap-loading">Cargando…</div> : (
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>

          {/* CALENDARIO */}
          {(view === 'ambos' || view === 'calendario') && (
            <div style={{ flex: '1 1 320px', minWidth: 300 }}>
              <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '1.25rem' }}>
                {/* Nav */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <button className="ap-btn-icon" onClick={() => { if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); } else setCalMonth(m => m - 1); setSelectedDay(null); }}><ChevronLeft size={16}/></button>
                  <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#fff', textTransform: 'capitalize' }}>{monthName}</span>
                  <button className="ap-btn-icon" onClick={() => { if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); } else setCalMonth(m => m + 1); setSelectedDay(null); }}><ChevronRight size={16}/></button>
                </div>

                {/* Week headers */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
                  {WEEK_DAYS.map(d => <div key={d} style={{ textAlign: 'center', fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)', fontWeight: 600, padding: '2px 0' }}>{d}</div>)}
                </div>

                {/* Days */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
                  {Array.from({ length: firstDay }).map((_, i) => <div key={`empty-${i}`} />)}
                  {Array.from({ length: daysInMonth }).map((_, i) => {
                    const day = i + 1;
                    const items = getItemsForDay(day);
                    const hasItems = items.events.length > 0 || items.tasks.length > 0;
                    const isToday = day === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear();
                    const isSelected = day === selectedDay;
                    return (
                      <button key={day} onClick={() => setSelectedDay(isSelected ? null : day)}
                        style={{ position: 'relative', aspectRatio: '1', borderRadius: 8, border: isSelected ? '1px solid #beb0a2' : isToday ? '1px solid rgba(190,176,162,0.4)' : '1px solid transparent', background: isSelected ? 'rgba(190,176,162,0.15)' : isToday ? 'rgba(190,176,162,0.07)' : 'rgba(255,255,255,0.03)', cursor: 'pointer', fontSize: '0.78rem', color: isToday ? '#beb0a2' : '#fff', fontWeight: isToday ? 700 : 400, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                        {day}
                        {hasItems && (
                          <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
                            {items.events.slice(0, 2).map(e => <div key={e.id} style={{ width: 4, height: 4, borderRadius: '50%', background: e.color }} />)}
                            {items.tasks.slice(0, 2).map(t => <div key={t.id} style={{ width: 4, height: 4, borderRadius: '50%', background: getPriority(t.priority).color }} />)}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Selected day detail */}
                {selectedDay && selectedItems && (
                  <div style={{ marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '1rem' }}>
                    <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'rgba(255,255,255,0.4)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {selectedDay} {new Date(calYear, calMonth, selectedDay).toLocaleDateString('es-ES', { month: 'long' })}
                    </p>
                    {selectedItems.events.length === 0 && selectedItems.tasks.length === 0 && (
                      <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.25)' }}>Sin eventos ni tareas</p>
                    )}
                    {selectedItems.events.map(e => (
                      <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: e.color, flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: 0, fontSize: '0.82rem', color: '#fff' }}>{e.title}</p>
                          {e.time && <p style={{ margin: 0, fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)' }}>{e.time}</p>}
                        </div>
                        <button onClick={() => deleteEvent(e.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.2)' }}><X size={12}/></button>
                      </div>
                    ))}
                    {selectedItems.tasks.map(t => (
                      <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <button onClick={() => toggleDone(t)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.done ? '#8bae8f' : 'rgba(255,255,255,0.3)', flexShrink: 0 }}>
                          {t.done ? <CheckCircle size={14}/> : <Circle size={14}/>}
                        </button>
                        <p style={{ margin: 0, fontSize: '0.82rem', color: t.done ? 'rgba(255,255,255,0.4)' : '#fff', textDecoration: t.done ? 'line-through' : 'none', flex: 1 }}>{t.title}</p>
                        <button onClick={() => deleteTask(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.2)' }}><X size={12}/></button>
                      </div>
                    ))}
                    <button className="ap-btn ap-btn-ghost ap-btn-sm" style={{ marginTop: '0.5rem', width: '100%', fontSize: '0.72rem' }}
                      onClick={() => { setEventDate(selectedDateStr); setShowEventForm(true); setShowTaskForm(false); }}>
                      + Añadir evento este día
                    </button>
                  </div>
                )}
              </div>

              {/* Upcoming events */}
              <div style={{ marginTop: '1rem' }}>
                <p style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.3)', marginBottom: '0.5rem' }}>Próximos eventos</p>
                {events.filter(e => e.date >= new Date().toISOString().slice(0, 10)).slice(0, 5).length === 0
                  ? <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.25)' }}>Sin eventos próximos</p>
                  : events.filter(e => e.date >= new Date().toISOString().slice(0, 10)).slice(0, 5).map(e => (
                    <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: e.color, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: 0, fontSize: '0.82rem', color: '#fff' }}>{e.title}</p>
                        <p style={{ margin: 0, fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)' }}>
                          {new Date(e.date + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
                          {e.time && ` · ${e.time}`}
                        </p>
                      </div>
                      <button onClick={() => deleteEvent(e.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.2)' }}><X size={12}/></button>
                    </div>
                  ))
                }
              </div>
            </div>
          )}

          {/* TAREAS */}
          {(view === 'ambos' || view === 'tareas') && (
            <div style={{ flex: '1 1 300px', minWidth: 280 }}>
              {tasks.length === 0 ? (
                <div className="ap-empty"><p>No hay tareas todavía.</p></div>
              ) : (
                <div>
                  {pending.length > 0 && (
                    <div style={{ marginBottom: '1.5rem' }}>
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
                              <button onClick={() => deleteTask(task.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.2)', flexShrink: 0 }}><Trash2 size={14}/></button>
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
                            <button onClick={() => deleteTask(task.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.2)', flexShrink: 0 }}><Trash2 size={14}/></button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
