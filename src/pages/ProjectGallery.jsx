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

function ImageSection({ label, text, palette, images, offset, onOpen }) {
  if (!images?.length && !text) return null;
  return (
    <section className="pg-section">
      <div className="pg-section-head">
        <p className="pg-section-label">{label}</p>
        {images?.length > 0 && <span className="pg-section-count">{String(images.length).padStart(2, '0')}</span>}
      </div>
      {text && <p className="pg-section-text">{text}</p>}
      {palette?.length > 0 && (
        <div className="pg-palette">
          {palette.map((hex, i) => <span key={i} className="pg-palette-dot" style={{ background: hex }} title={hex} />)}
        </div>
      )}
      {images?.length > 0 && (
        <div className="pg-grid">
          {images.map((src, i) => (
            <button
              key={i}
              className={`pg-thumb${i === 0 ? ' pg-thumb--big' : ''}`}
              onClick={() => onOpen(offset + i)}
              aria-label={`Ver imagen ${i + 1}`}
            >
              <LazyImage src={src} alt={`${label} · ${i + 1}`} />
            </button>
          ))}
        </div>
      )}
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
    return [...(project.before_photos || []), ...(project.moodboard_images || []), ...(project.result_images || [])];
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

  const beforeCount = project.before_photos?.length || 0;
  const moodboardCount = project.moodboard_images?.length || 0;

  return (
    <div className="pg-page">
      <Stars count={140} style={{ position: 'fixed' }} />
      <Navbar />

      {project.cover_url ? (
        <div className="pg-hero">
          <LazyImage src={project.cover_url} alt={project.title} className="pg-hero-img" />
          <div className="pg-hero-scrim" />
          <Link to="/proyectos" className="pg-back pg-hero-back">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Todos los proyectos
          </Link>
          <div className="pg-hero-content">
            <h1>{project.title}</h1>
          </div>
        </div>
      ) : (
        <div className="pg-header pg-header--plain">
          <Link to="/proyectos" className="pg-back">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Todos los proyectos
          </Link>
          <h1>{project.title}</h1>
        </div>
      )}

      <main className="pg-main">
        <ImageSection label="El antes" text={project.before_text} images={project.before_photos} offset={0} onOpen={openLightbox} />
        <ImageSection label="Moodboard" text={project.concept} palette={project.moodboard_palette} images={project.moodboard_images} offset={beforeCount} onOpen={openLightbox} />
        <ImageSection label="El resultado" text={project.result_text} images={project.result_images} offset={beforeCount + moodboardCount} onOpen={openLightbox} />

        {project.testimonial_video_url && (
          <section className="pg-section">
            <div className="pg-section-head">
              <p className="pg-section-label">Testimonio</p>
            </div>
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

        <section className="pg-cta">
          <p className="pg-cta-title">¿Quieres un proyecto como este?</p>
          <p className="pg-cta-text">Cuéntanos tu idea por WhatsApp y te ayudamos a darle forma.</p>
          <a
            href={`https://wa.me/34673274303?text=${encodeURIComponent(`Hola, he visto el proyecto "${project.title}" y me gustaría más información`)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="pg-cta-btn"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21h.004c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.85 9.85 0 0 0 12.04 2m0 1.67a8.2 8.2 0 0 1 5.83 2.42 8.2 8.2 0 0 1 2.42 5.82c0 4.55-3.7 8.25-8.25 8.25a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.4c0-4.55 3.7-8.24 8.24-8.24m-4.53 4.7c-.16 0-.42.06-.64.3-.22.24-.85.83-.85 2.03s.87 2.36.99 2.52c.12.17 1.7 2.6 4.13 3.64.58.25 1.03.4 1.38.5.58.19 1.11.16 1.53.1.47-.07 1.44-.59 1.64-1.15s.2-1.05.14-1.15c-.06-.1-.22-.16-.46-.28s-1.44-.71-1.66-.79-.39-.12-.55.12-.63.79-.78.96c-.14.16-.29.18-.53.06-.25-.12-1.03-.38-1.97-1.21-.73-.65-1.22-1.45-1.36-1.7-.14-.24-.01-.37.11-.5.11-.11.25-.28.37-.42.12-.14.16-.24.24-.4.08-.17.04-.31-.02-.43-.06-.12-.55-1.35-.76-1.84-.2-.48-.4-.42-.55-.42h-.14" />
            </svg>
            Escríbenos por WhatsApp
          </a>
        </section>
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
