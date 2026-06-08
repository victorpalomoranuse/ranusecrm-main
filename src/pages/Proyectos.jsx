import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';
import { LazyImage } from '../components/LazyImage';
import { Stars } from '../components/Stars';
import './Proyectos.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export function Proyectos() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/portfolio`)
      .then(r => r.json())
      .then(d => setProjects(d.projects || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="proyectos-page">
      <Stars count={140} style={{ position: 'fixed' }} />
      <Navbar />

      <main className="proyectos-main">
        <div className="proyectos-header">
          <h1>Proyectos</h1>
          <p>Todos nuestros trabajos de diseño de interiores deportivos</p>
        </div>

        {loading && <p style={{color:'#888', textAlign:'center', padding:'3rem'}}>Cargando proyectos...</p>}

        <div className="proyectos-grid">
          {projects.map((project) => {
            const cover = project.cover_url && !project.cover_url.startsWith('blob:')
              ? project.cover_url
              : project.images?.find(u => u && !u.startsWith('blob:'));
            return (
            <Link
              key={project.id}
              to={`/proyecto/${project.slug}`}
              className="proyectos-card"
            >
              <div className="proyectos-card-img">
                <LazyImage src={cover} alt={project.title} />
              </div>
              <div className="proyectos-card-info">
                <h2>{project.title}</h2>
                <p>{project.description}</p>
                <span className="proyectos-card-cta">Ver proyecto →</span>
              </div>
            </Link>
            );
          })}
        </div>
      </main>

      <Footer />
    </div>
  );
}
