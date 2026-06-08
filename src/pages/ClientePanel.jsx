import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useClienteAuth } from '../auth/ClienteAuthContext';
import clienteApi from '../services/clienteApi';
import { Stars } from '../components/Stars';
import './ClientePanel.css';

const PHASE_LABELS = [
  'Diagnóstico y mediciones',
  'Prediseño',
  'Diseño detallado',
  'Compras y coordinación',
  'Dirección de obra',
];

function ProjectCard({ project, onView }) {
  const phase = project.phase || 1;
  return (
    <div className="cp-card">
      <div className="cp-card-info">
        <p className="cp-card-name">{project.project_name}</p>
        <p className="cp-card-client">{project.client_name}</p>
        <div className="cp-card-phase">
          <div className="cp-phase-dots">
            {[1,2,3,4,5].map(n => (
              <div key={n} className={`cp-dot${n <= phase ? ' active' : ''}`} />
            ))}
          </div>
          <span className="cp-phase-label">{PHASE_LABELS[phase - 1]}</span>
        </div>
      </div>
      <button className="cp-view-btn" onClick={() => onView(project.access_code)}>
        Ver proyecto
      </button>
    </div>
  );
}

export function ClientePanel() {
  const { user, logout } = useClienteAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    clienteApi.get('/client-projects/my-projects')
      .then(r => setProjects(r.data.projects || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleLogout = () => { logout(); navigate('/cliente'); };

  const viewProject = (code) => {
    navigate(`/mi-proyecto?code=${encodeURIComponent(code)}`);
  };

  return (
    <div className="cp">
      <Stars count={120} style={{ position: 'fixed' }} />

      <header className="cp-header">
        <a href="/" className="cp-header-logo">
          <img src="/iconoRanuse.ico" alt="Ranuse" />
          <span>Ranuse Design</span>
        </a>
        <div className="cp-header-right">
          <span className="cp-user">{user?.email}</span>
          <button className="cp-logout" onClick={handleLogout}>Salir</button>
        </div>
      </header>

      <main className="cp-main">
        <div className="cp-hero">
          <h1>Mis proyectos</h1>
          <p className="cp-sub">Selecciona un proyecto para ver su estado y contenido.</p>
        </div>

        {loading ? (
          <div className="cp-loading"><div className="cp-spinner" /></div>
        ) : projects.length === 0 ? (
          <div className="cp-empty">
            <p>Aún no tienes proyectos asignados.</p>
            <p className="cp-empty-sub">Tu diseñador te asignará tus proyectos pronto.</p>
          </div>
        ) : (
          <div className="cp-grid">
            {projects.map(p => (
              <ProjectCard key={p.id} project={p} onView={viewProject} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
