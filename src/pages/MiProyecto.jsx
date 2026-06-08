import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Stars } from '../components/Stars';
import './MiProyecto.css';

const PHASE_LABELS = [
  'Diagnóstico y mediciones',
  'Prediseño',
  'Diseño detallado',
  'Compras y coordinación',
  'Dirección de obra',
];

function Lightbox({ src, alt, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="mp-lb" onClick={onClose}>
      <button className="mp-lb-close" onClick={onClose}>✕</button>
      <img src={src} alt={alt} onClick={e => e.stopPropagation()} />
    </div>
  );
}

function TourSection({ tours }) {
  if (!tours?.length) return null;
  return (
    <section className="mp-tours">
      <p className="mp-tours-label">Tour virtual 3D</p>
      <div className="mp-tours-grid">
        {tours.map(t => (
          <a key={t.id} href={t.url} target="_blank" rel="noopener noreferrer" className="mp-tour-btn">
            <svg className="mp-tour-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22C12 22 3 17 3 10a9 9 0 1 1 18 0c0 7-9 12-9 12z"/>
              <circle cx="12" cy="10" r="3"/>
            </svg>
            <span className="mp-tour-name">{t.name}</span>
            <svg className="mp-tour-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 17L17 7M17 7H7M17 7v10"/>
            </svg>
          </a>
        ))}
      </div>
    </section>
  );
}

function HeroRender({ render, onClick }) {
  return (
    <div className="mp-hero-render" onClick={onClick} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && onClick()}>
      <img src={render.url} alt={render.name || ''} loading="eager" />
    </div>
  );
}

function RendersSection({ renders }) {
  const [active, setActive] = useState(null);
  const rest = renders?.slice(1);
  if (!rest?.length) return null;
  return (
    <section className="mp-block">
      <p className="mp-block-label">Diseños</p>
      <div className="mp-img-grid">
        {rest.map(r => (
          <button key={r.id} className="mp-img-thumb" onClick={() => setActive(r)}>
            <img src={r.url} alt={r.name || ''} loading="lazy" />
            {r.name && <span className="mp-img-name">{r.name}</span>}
          </button>
        ))}
      </div>
      {active && <Lightbox src={active.url} alt={active.name || ''} onClose={() => setActive(null)} />}
    </section>
  );
}

function MaterialesSection({ materials }) {
  const [active, setActive] = useState(null);
  if (!materials?.length) return null;
  return (
    <section className="mp-block">
      <p className="mp-block-label">Materiales</p>
      <div className="mp-sel-grid">
        {materials.map(m => (
          <div
            key={m.id}
            className={`mp-sel-card${m.image_url ? ' mp-sel-card--photo' : ''}`}
            onClick={() => m.image_url && setActive(m)}
            style={m.image_url ? { cursor: 'pointer' } : {}}
          >
            {m.image_url && (
              <div className="mp-sel-img">
                <img src={m.image_url} alt={m.name} loading="lazy" />
              </div>
            )}
            <div className="mp-sel-info">
              <span className="mp-sel-name">{m.name}</span>
              {m.brand && <span className="mp-sel-sub">{m.brand}</span>}
              {m.category && <span className="mp-sel-tag">{m.category}</span>}
              {m.location && <span className="mp-sel-location">→ {m.location}</span>}
            </div>
          </div>
        ))}
      </div>
      {active && <Lightbox src={active.image_url} alt={active.name} onClose={() => setActive(null)} />}
    </section>
  );
}

function getYoutubeId(url) {
  if (!url) return null;
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /embed\/([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function MobiliarioSection({ equipment }) {
  const [activeItem, setActiveItem] = useState(null);
  const [galleryIdx, setGalleryIdx] = useState(0);

  if (!equipment?.length) return null;

  const allImages = (item) => {
    const imgs = [];
    if (item.image_url) imgs.push(item.image_url);
    if (item.extra_images?.length) imgs.push(...item.extra_images);
    return imgs;
  };

  const handleOpen = (item) => { setActiveItem(item); setGalleryIdx(0); };
  const handleClose = () => setActiveItem(null);
  const ytId = activeItem ? getYoutubeId(activeItem.youtube_url) : null;

  return (
    <section className="mp-block">
      <p className="mp-block-label">Mobiliario y equipamiento</p>
      <div className="mp-sel-grid">
        {equipment.map(e => {
          const imgs = allImages(e);
          const clickable = imgs.length > 0 || !!e.youtube_url;
          return (
            <div
              key={e.id}
              className={`mp-sel-card${imgs.length > 0 ? ' mp-sel-card--photo' : ''}`}
              onClick={() => clickable && handleOpen(e)}
              style={clickable ? { cursor: 'pointer' } : {}}
            >
              {imgs[0] && (
                <div className="mp-sel-img">
                  <img src={imgs[0]} alt={e.name} loading="lazy" />
                  {imgs.length > 1 && (
                    <span style={{ position:'absolute', bottom:5, right:5, background:'rgba(0,0,0,0.6)', color:'#fff', fontSize:'0.62rem', fontWeight:600, padding:'2px 6px', borderRadius:20 }}>
                      +{imgs.length - 1}
                    </span>
                  )}
                  {e.youtube_url && (
                    <span style={{ position:'absolute', top:5, right:5, background:'rgba(200,0,0,0.8)', color:'#fff', width:20, height:20, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    </span>
                  )}
                </div>
              )}
              {!imgs[0] && e.youtube_url && (
                <div className="mp-sel-img" style={{ display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(255,255,255,0.04)', minHeight:80 }}>
                  <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" style={{ opacity:0.35 }}><path d="M8 5v14l11-7z"/></svg>
                </div>
              )}
              <div className="mp-sel-info">
                <span className="mp-sel-name">{e.name}</span>
                {e.brand && <span className="mp-sel-sub">{e.brand}</span>}
                {e.category && <span className="mp-sel-tag">{e.category}</span>}
                {e.quantity > 1 && <span className="mp-sel-qty">×{e.quantity}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {activeItem && (
        <div className="mp-eq-overlay" onClick={handleClose}>
          <div className="mp-eq-modal" onClick={e => e.stopPropagation()}>
            <button className="mp-eq-close" onClick={handleClose}>✕</button>

            <div className="mp-eq-header">
              <h3 className="mp-eq-name">{activeItem.name}</h3>
              <div className="mp-eq-meta">
                {activeItem.brand && <span className="mp-eq-brand">{activeItem.brand}</span>}
                {activeItem.category && <span className="mp-sel-tag">{activeItem.category}</span>}
                {activeItem.quantity > 1 && <span className="mp-eq-qty">Cantidad: <strong>{activeItem.quantity}</strong></span>}
              </div>
            </div>

            {allImages(activeItem).length > 0 && (
              <div className="mp-eq-gallery">
                <div className="mp-eq-gallery-main">
                  <img src={allImages(activeItem)[galleryIdx]} alt={activeItem.name} loading="lazy" />
                  {allImages(activeItem).length > 1 && (
                    <>
                      <button className="mp-eq-arrow mp-eq-arrow--prev" onClick={() => setGalleryIdx(i => (i - 1 + allImages(activeItem).length) % allImages(activeItem).length)}>‹</button>
                      <button className="mp-eq-arrow mp-eq-arrow--next" onClick={() => setGalleryIdx(i => (i + 1) % allImages(activeItem).length)}>›</button>
                      <span className="mp-eq-counter">{galleryIdx + 1} / {allImages(activeItem).length}</span>
                    </>
                  )}
                </div>
                {allImages(activeItem).length > 1 && (
                  <div className="mp-eq-thumbs">
                    {allImages(activeItem).map((url, i) => (
                      <button key={url} className={`mp-eq-thumb${i === galleryIdx ? ' active' : ''}`} onClick={() => setGalleryIdx(i)}>
                        <img src={url} alt="" loading="lazy" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {ytId && (
              <div className="mp-eq-video">
                <p className="mp-eq-video-label">Vídeo del producto</p>
                <div className="mp-eq-video-wrap">
                  <iframe
                    src={`https://www.youtube.com/embed/${ytId}`}
                    title={activeItem.name}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    loading="lazy"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function NotasSection({ notes }) {
  if (!notes?.length) return null;
  return (
    <section className="mp-block">
      <p className="mp-block-label">Notas de tu diseñador</p>
      <div className="mp-notes-list">
        {notes.map(n => (
          <div key={n.id} className="mp-note">
            <p className="mp-note-content">{n.content}</p>
            <span className="mp-note-date">
              {new Date(n.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function DocumentosSection({ documents }) {
  if (!documents?.length) return null;
  const isPdf = (url) => url?.toLowerCase().includes('.pdf') || url?.toLowerCase().includes('pdf');
  return (
    <section className="mp-block">
      <p className="mp-block-label">Documentos</p>
      <div className="mp-docs">
        {documents.map(d => (
          <a key={d.id} href={d.url} target="_blank" rel="noopener noreferrer" className="mp-doc">
            <span className="mp-doc-icon">{isPdf(d.url) ? '⬜' : '⬜'}</span>
            <svg className="mp-doc-file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              {isPdf(d.url)
                ? <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13h6M9 17h4"/></>
                : <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>
              }
            </svg>
            <div className="mp-doc-info">
              <span className="mp-doc-name">{d.name || 'Documento'}</span>
              {d.doc_type && d.doc_type !== 'otro' && <span className="mp-doc-type">{d.doc_type}</span>}
            </div>
            <svg className="mp-doc-dl" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </a>
        ))}
      </div>
    </section>
  );
}

export function MiProyecto() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const code = params.get('code');

  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [heroLightbox, setHeroLightbox] = useState(null);

  useEffect(() => {
    if (!code) { setLoading(false); setError('Sin código.'); return; }
    const base = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
    fetch(`${base}/client-projects/by-code/${encodeURIComponent(code)}`)
      .then(async r => {
        const data = await r.json();
        if (!r.ok || !data.project) setError(data.error || 'Código no válido');
        else setProject(data.project);
      })
      .catch(() => setError('No se pudo conectar.'))
      .finally(() => setLoading(false));
  }, [code]);

  if (loading) return <div className="mp mp--center"><Stars count={120} style={{ position: 'fixed' }} /><div className="mp-spinner" /></div>;

  if (error || !project) {
    return (
      <div className="mp mp--center">
        <Stars count={120} style={{ position: 'fixed' }} />
        <div className="mp-err">
          <div className="mp-err-icon">✕</div>
          <h2>Código no válido</h2>
          <p>{error || 'El código no existe o ha expirado.'}</p>
          <button onClick={() => navigate('/')}>Volver al inicio</button>
        </div>
      </div>
    );
  }

  const phase = project.phase || 1;
  const heroRender = project.renders?.[0] || null;
  const hasContent = project.tours?.length || project.renders?.length || project.materials?.length ||
    project.equipment?.length || project.documents?.length || project.notes?.length;

  return (
    <div className="mp">
      <Stars count={120} style={{ position: 'fixed' }} />
      <header className="mp-header">
        <a href="/" className="mp-logo">
          <img src="/iconoRanuse.ico" alt="Ranuse" />
          <span>Ranuse Design</span>
        </a>
      </header>

      <main className="mp-main">
        {heroRender && (
          <>
            <HeroRender render={heroRender} onClick={() => setHeroLightbox(heroRender)} />
            {heroLightbox && <Lightbox src={heroLightbox.url} alt={heroLightbox.name || ''} onClose={() => setHeroLightbox(null)} />}
          </>
        )}

        <div className="mp-hero">
          <p className="mp-hi">Hola, <strong>{project.client_name}</strong></p>
          <h1 className="mp-project-name">{project.project_name}</h1>

          <div className="mp-stepper">
            {PHASE_LABELS.map((label, i) => {
              const n = i + 1;
              const done = n < phase;
              const current = n === phase;
              const last = n === PHASE_LABELS.length;
              return (
                <div key={n} className="mp-st-row">
                  <div className="mp-st-col">
                    <div className={`mp-st-dot${done ? ' done' : ''}${current ? ' current' : ''}`}>
                      {done && (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path d="M2 5l2.5 2.5 3.5-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                    {!last && <div className={`mp-st-line${done ? ' done' : ''}`} />}
                  </div>
                  <span className={`mp-st-label${current ? ' current' : ''}${done ? ' done' : ''}`}>
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {hasContent ? (
          <div className="mp-sections">
            <TourSection tours={project.tours} />
            <NotasSection notes={project.notes} />
            <RendersSection renders={project.renders} />
            <MaterialesSection materials={project.materials} />
            <MobiliarioSection equipment={project.equipment} />
            <DocumentosSection documents={project.documents} />
          </div>
        ) : (
          <p className="mp-empty-msg">Tu diseñador irá añadiendo el contenido de tu proyecto aquí.</p>
        )}
      </main>

      <footer className="mp-footer">
        {project.responsible_email ? (
          <a href={`mailto:${project.responsible_email}`} className="mp-contact">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2"/>
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
            </svg>
            Contactar a tu diseñador
          </a>
        ) : (
          <a href="https://api.whatsapp.com/message/XSSED6I72WM3P1?autoload=1&app_absent=0" target="_blank" rel="noopener noreferrer" className="mp-contact mp-contact--wa">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
              <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.118 1.524 5.849L0 24l6.336-1.498A11.955 11.955 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.812 9.812 0 0 1-5.007-1.374l-.36-.214-3.732.882.937-3.617-.235-.372A9.817 9.817 0 0 1 2.182 12C2.182 6.57 6.57 2.182 12 2.182S21.818 6.57 21.818 12 17.43 21.818 12 21.818z"/>
            </svg>
            Contactar a tu diseñador
          </a>
        )}
      </footer>
    </div>
  );
}
