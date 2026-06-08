import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEquipoAuth } from '../auth/EquipoAuthContext';
import equipoApi from '../services/equipoApi';
import { LogOut, Copy, ChevronLeft, ChevronRight, CheckCircle, AlertCircle, X } from 'lucide-react';
import './EquipoPanel.css';

const PHASE_LABELS = { 1: 'Diagnóstico', 2: 'Diseño', 3: 'Producción', 4: 'Instalación', 5: 'Entregado' };

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

export function EquipoPanel() {
  const { user, logout } = useEquipoAuth();
  const navigate = useNavigate();
  const { toasts, toast, remove } = useToast();

  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);

  const loadProjects = async () => {
    try {
      const { data } = await equipoApi.get('/client-projects');
      setProjects(data.projects || []);
    } catch { } finally { setLoading(false); }
  };

  useEffect(() => { loadProjects(); }, []);

  const handleLogout = () => { logout(); navigate('/equipo'); };

  const changePhase = async (project, delta) => {
    const newPhase = project.phase + delta;
    if (newPhase < 1 || newPhase > 5) return;
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
                      disabled={p.phase <= 1 || isUpdating}
                      title="Fase anterior"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <div className="ep-phase-center">
                      <span className="ep-phase-num">{p.phase}/5</span>
                      <span className="ep-phase-name">{PHASE_LABELS[p.phase]}</span>
                      <div className="ep-phase-dots">
                        {[1,2,3,4,5].map(n => (
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
      </main>
    </div>
  );
}
