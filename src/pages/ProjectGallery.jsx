import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';
import { LazyImage } from '../components/LazyImage';
import { Stars } from '../components/Stars';
import './ProjectGallery.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

function isEmbeddableVideo(url) {
  return /youtube\.com|youtu\.be|vimeo\.com/i.test(url || '');
}
function embedUrl(url) {
  const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([\w-]+)/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return url;
}

function ImageSection({ label, images, offset, onOpen }) {
  if (!images?.length) return null;
  return (
    <section className="pg-section">
      <p className="pg-section-label">{label}</p>
      <div className="pg-grid">
        {images.map((src, i) => (
          <button key={i} className="pg-thumb" onClick={() => onOpen(offset + i)} aria-label={`Ver imagen ${i + 1}`}>
            <LazyImage src={src} alt={`${label} · ${i + 1}`} />
          </button>
        ))}
      </div>
    </section>
  );
}

export function ProjectGallery() {
  const { projectId } = useParams();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lightboxIndex, setLightboxIndex] = useState(null);

  useEffect(() => {
    setLoading(true);
    fetch(`${API_URL}/client-projects/public/portfolio/${projectId}`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => setProject(d.project || null))
      .catch(() => setProject(null))
      .finally(() => setLoading(false));
  }, [projectId]);

  const allImages = useMemo(() => {
    if (!project) return [];
    return [...(project.moodboard_images || []), ...(project.before_photos || []), ...(project.result_images || [])];
  }, [project]);

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
  const prev = () => setLightboxIndex((i) => (i - 1 + allImages.length) % allImages.length);
  const next = () => setLightboxIndex((i) => (i + 1) % allImages.length);

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowLeft') prev();
    if (e.key === 'ArrowRight') next();
    if (e.key === 'Escape') closeLightbox();
  };

  const moodboardCount = project.moodboard_images?.length || 0;
  const beforeCount = project.before_photos?.length || 0;

  return (
    <div className="pg-page">
      <Stars count={140} style={{ position: 'fixed' }} />
      <Navbar />

      <main className="pg-main">
        <div className="pg-header">
          <Link to="/proyectos" className="pg-back">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Todos los proyectos
          </Link>
          <h1>{project.title}</h1>
          {project.concept && <p className="pg-concept">{project.concept}</p>}
        </div>

        {project.cover_url && (
          <div className="pg-cover">
            <LazyImage src={project.cover_url} alt={project.title} />
          </div>
        )}

        <ImageSection label="Moodboard" images={project.moodboard_images} offset={0} onOpen={openLightbox} />
        <ImageSection label="El antes" images={project.before_photos} offset={moodboardCount} onOpen={openLightbox} />
        <ImageSection label={project.is_result ? 'El resultado' : 'Renders'} images={project.result_images} offset={moodboardCount + beforeCount} onOpen={openLightbox} />

        {project.testimonial_video_url && (
          <section className="pg-section">
            <p className="pg-section-label">Testimonio</p>
            <div className="pg-video">
              {isEmbeddableVideo(project.testimonial_video_url) ? (
                <iframe
                  src={embedUrl(project.testimonial_video_url)}
                  title="Testimonio del cliente"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <video src={project.testimonial_video_url} controls playsInline />
              )}
            </div>
          </section>
        )}
      </main>

      <Footer />

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
              src={allImages[lightboxIndex]}
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
            {lightboxIndex + 1} / {allImages.length}
          </span>
        </div>
      )}
    </div>
  );
}
