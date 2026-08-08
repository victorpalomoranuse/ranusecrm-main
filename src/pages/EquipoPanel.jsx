import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEquipoAuth } from '../auth/EquipoAuthContext';
import equipoApi from '../services/equipoApi';
import { LogOut, Copy, ChevronLeft, ChevronRight, CheckCircle, Circle, AlertCircle, X } from 'lucide-react';
import './EquipoPanel.css';

const PHASE_LABELS = { 0: 'Diseño previo', 1: 'Arquitectura', 2: 'Instalaciones', 3: 'Interiorismo y materialidad', 4: 'Maquinaria y equipamiento', 5: 'Documentación de apoyo' };

function useToast() {
  const [toasts, setToasts] = useState([]);
  const add = useCallback((message, type = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);
  const remove = useCallback(id => setToasts(prev => prev.filter(t => t.id !== id)), []);
  return { toasts, toast: { success: m => add(m, 'success'), error: m => add(m, 'error') }, remove };
}

function ToastContainer({ toasts, onRemove }) {
  return (
    <div className="ep-toasts">
      {toasts.map(t => (
        <div key={t.id} className={`ep-toast ep-toast--${t.type}`}>
          {t.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          <span>{t.message}</span>
          <button onClick={() => onRemove(t.id)}><X size={13} /></button>
        </div>
      ))}
    </div>
  );
}

function MisTareas() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const loadTasks = () => {
    equipoApi.get('/tasks').then(r => setTasks(r.data.tasks || [])).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { loadTasks(); }, []);

  const toggleDone = async (task) => {
    try {
      const { data } = await equipoApi.put(`/tasks/${task.id}`, { done: !task.done });
      setTasks(prev => prev.map(t => t.id === task.id ? data.task : t));
    } catch {
      toast.error('Error al actualizar la tarea');
    }
  };

  if (loading) return <div className="ep-loading">Cargando tareas…</div>;

  const pending = tasks.filter(t => !t.done);
  const done = tasks.filter(t => t.done);
  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <div className="ep-section-head">
        <h1>Mis tareas</h1>
        <p>Tareas que te ha asignado tu diseñador.</p>
      </div>
      {tasks.length === 0 ? (
        <div className="ep-empty">No tienes tareas asignadas todavía.</div>
      ) : (
        <div className="ep-tasks-list">
          {pending.map(t => {
            const overdue = t.due_date && t.due_date < todayStr;
            return (
              <div key={t.id} className="ep-task-row">
                <button className="ep-task-check" onClick={() => toggleDone(t)}><Circle size={17} /></button>
                <div className="ep-task-body">
                  <p className="ep-task-title">{t.title}</p>
                  {t.description && <p className="ep-task-desc">{t.description}</p>}
                  <div className="ep-task-meta">
                    {t.project && <span className="ep-task-tag">{t.project.client_name}{t.phase_number != null && ` · Fase ${t.phase_number}`}</span>}
                    {t.due_date && (
                      <span className={`ep-task-due${overdue ? ' overdue' : ''}`}>
                        {overdue && <AlertCircle size={11} />}
                        {new Date(t.due_date + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {done.length > 0 && (
            <>
              <p className="ep-tasks-done-label">Completadas ({done.length})</p>
              {done.map(t => (
                <div key={t.id} className="ep-task-row ep-task-row--done">
                  <button className="ep-task-check ep-task-check--done" onClick={() => toggleDone(t)}><CheckCircle size={17} /></button>
                  <div className="ep-task-body">
                    <p className="ep-task-title ep-task-title--done">{t.title}</p>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function EquipoPanel() {
  const { user, logout } = useEquipoAuth();
  const navigate = useNavigate();
  const { toasts, toast, remove } = useToast();

  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);
  const [tab, setTab] = useState('proyectos');

  const loadProjects = async () => {
    try {
      const { data } = await equipoApi.get('/client-projects');
      setProjects((data.projects || []).filter(p => (p.status || 'en_marcha') === 'en_marcha'));
    } catch { } finally { setLoading(false); }
  };

  useEffect(() => { loadProjects(); }, []);

  const handleLogout = () => { logout(); navigate('/equipo'); };

  const changePhase = async (project, delta) => {
    const newPhase = project.phase + delta;
    if (newPhase < 0 || newPhase > 5) return;
    setUpdatingId(project.id);
    try {
      const { data } = await equipoApi.put(`/client-projects/${project.id}`, { phase: newPhase });
      setProjects(prev => prev.map(p => p.id === project.id ? data.project : p));
      toast.success(`Fase actualizada: ${PHASE_LABELS[newPhase]}`);
    } catch {
      toast.error('Error al actualizar la fase');
    } finally {
      setUpdatingId(null);
    }
  };

  const copyCode = (code) => {
    navigator.clipboard.writeText(code);
    toast.success('Código copiado');
  };

  return (
    <div className="ep">
      <ToastContainer toasts={toasts} onRemove={remove} />

      <header className="ep-header">
        <div className="ep-header-logo">
          <img src="/iconoRanuse.ico" alt="Ranuse" />
          <span>Ranuse Design</span>
        </div>
        <div className="ep-header-right">
          <span className="ep-user">{user?.email}</span>
          <button className="ep-logout" onClick={handleLogout}>
            <LogOut size={14} /> Salir
          </button>
        </div>
      </header>

      <main className="ep-main">
        <div className="ep-tabs">
          <button className={`ep-tab${tab === 'proyectos' ? ' active' : ''}`} onClick={() => setTab('proyectos')}>Proyectos</button>
          <button className={`ep-tab${tab === 'tareas' ? ' active' : ''}`} onClick={() => setTab('tareas')}>Mis tareas</button>
        </div>

        {tab === 'tareas' ? (
          <MisTareas />
        ) : (
        <>
        <div className="ep-section-head">
          <h1>Proyectos</h1>
          <p>Gestiona el estado de los proyectos de cliente.</p>
        </div>

        {loading ? (
          <div className="ep-loading">Cargando proyectos…</div>
        ) : projects.length === 0 ? (
          <div className="ep-empty">No hay proyectos activos.</div>
        ) : (
          <div className="ep-grid">
            {projects.map(p => {
              const isUpdating = updatingId === p.id;
              return (
                <div key={p.id} className="ep-card">
                  <div className="ep-card-header">
                    <div>
                      <h3 className="ep-client">{p.client_name}</h3>
                      <p className="ep-project">{p.project_name}</p>
                    </div>
                    <span className={`ep-urgency ep-urgency--${p.urgency}`}>{p.urgency}</span>
                  </div>

                  <div className="ep-phase-control">
                    <button
                      className="ep-phase-arrow"
                      onClick={() => changePhase(p, -1)}
                      disabled={p.phase <= 0 || isUpdating}
                      title="Fase anterior"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <div className="ep-phase-center">
                      <span className="ep-phase-num">Fase {p.phase}</span>
                      <span className="ep-phase-name">{PHASE_LABELS[p.phase]}</span>
                      <div className="ep-phase-dots">
                        {[0,1,2,3,4,5].map(n => (
                          <div key={n} className={`ep-dot${n <= p.phase ? ' active' : ''}`} />
                        ))}
                      </div>
                    </div>
                    <button
                      className="ep-phase-arrow"
                      onClick={() => changePhase(p, 1)}
                      disabled={p.phase >= 5 || isUpdating}
                      title="Fase siguiente"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>

                  <div className="ep-code-row">
                    <span className="ep-code">{p.access_code}</span>
                    <button className="ep-copy-btn" onClick={() => copyCode(p.access_code)} title="Copiar">
                      <Copy size={12} />
                    </button>
                  </div>

                  {p.client_email && <p className="ep-email">{p.client_email}</p>}
                </div>
              );
            })}
          </div>
        )}
        </>
        )}
      </main>
    </div>
  );
}
