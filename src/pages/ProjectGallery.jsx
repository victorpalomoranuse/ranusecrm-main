import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';
import { LazyImage } from '../components/LazyImage';
import { Stars } from '../components/Stars';
import './ProjectGallery.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export function ProjectGallery() {
  const { projectId } = useParams();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lightboxIndex, setLightboxIndex] = useState(null);

  useEffect(() => {
    fetch(`${API_URL}/portfolio`)
      .then(r => r.json())
      .then(d => {
        const found = (d.projects || []).find(p => p.slug === projectId);
        setProject(found || null);
      })
      .catch(() => setProject(null))
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) return (
    <div className="pg-not-found">
      <Stars count={140} style={{ position: 'fixed' }} />
      <Navbar />
      <div className="pg-not-found-body"><p style={{color:'rgba(255,255,255,0.35)'}}>Cargando...</p></div>
    </div>
  );

  if (!project) {
    return (
      <div className="pg-not-found">
        <Stars count={140} style={{ position: 'fixed' }} />
        <Navbar />
        <div className="pg-not-found-body">
          <h2>Proyecto no encontrado</h2>
          <Link to="/proyectos" className="pg-back-btn">Ver todos los proyectos</Link>
        </div>
      </div>
    );
  }

  const openLightbox = (index) => setLightboxIndex(index);
  const closeLightbox = () => setLightboxIndex(null);
  const prev = () => setLightboxIndex((i) => (i - 1 + project.images.length) % project.images.length);
  const next = () => setLightboxIndex((i) => (i + 1) % project.images.length);

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowLeft') prev();
    if (e.key === 'ArrowRight') next();
    if (e.key === 'Escape') closeLightbox();
  };

  return (
    <div className="pg-page">
      <Stars count={140} style={{ position: 'fixed' }} />
      <Navbar />

      <main className="pg-main">
        {/* Header */}
        <div className="pg-header">
          <Link to="/proyectos" className="pg-back">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Todos los proyectos
          </Link>
          <h1>{project.title}</h1>
          {project.description && <p>{project.description}</p>}
        </div>

        {/* Grid de fotos */}
        <div className="pg-grid">
          {project.images.map((src, i) => (
            <button
              key={i}
              className="pg-thumb"
              onClick={() => openLightbox(i)}
              aria-label={`Ver imagen ${i + 1}`}
            >
              <LazyImage src={src} alt={`${project.title} · ${i + 1}`} />
            </button>
          ))}
        </div>
      </main>

      <Footer />

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <div
          className="pg-lightbox"
          onClick={closeLightbox}
          onKeyDown={handleKeyDown}
          tabIndex={0}
          role="dialog"
          aria-modal="true"
        >
          <button className="pg-lb-close" onClick={closeLightbox} aria-label="Cerrar">✕</button>

          <button
            className="pg-lb-arrow pg-lb-arrow--prev"
            onClick={(e) => { e.stopPropagation(); prev(); }}
            aria-label="Anterior"
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          <div className="pg-lb-img-wrap" onClick={(e) => e.stopPropagation()}>
            <img
              src={project.images[lightboxIndex]}
              alt={`${project.title} · ${lightboxIndex + 1}`}
              className="pg-lb-img"
            />
          </div>

          <button
            className="pg-lb-arrow pg-lb-arrow--next"
            onClick={(e) => { e.stopPropagation(); next(); }}
            aria-label="Siguiente"
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>

          <span className="pg-lb-counter">
            {lightboxIndex + 1} / {project.images.length}
          </span>
        </div>
      )}
    </div>
  );
}
