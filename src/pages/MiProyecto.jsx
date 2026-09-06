import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Stars } from '../components/Stars';
import './MiProyecto.css';

const PHASE_STATUS_LABELS = {
  completado: 'Completado',
  en_curso: 'En curso',
  proximamente: 'Próximamente',
};

async function downloadRender(url, filename) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = filename || 'render.jpg';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objUrl);
  } catch {
    window.open(url, '_blank');
  }
}

function renderFilename(render, idx) {
  const ext = (render.url?.split('.').pop() || 'jpg').split('?')[0];
  const base = render.name?.trim() || `render-${idx + 1}`;
  return `${base}.${ext}`;
}

function DownloadButton({ url, filename, className }) {
  return (
    <button
      type="button"
      className={className}
      onClick={(e) => { e.stopPropagation(); downloadRender(url, filename); }}
      aria-label="Descargar render"
      title="Descargar"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    </button>
  );
}

function Lightbox({ src, alt, onClose, downloadUrl, downloadName }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="mp-lb" onClick={onClose}>
      <button className="mp-lb-close" onClick={onClose}>✕</button>
      {downloadUrl && <DownloadButton url={downloadUrl} filename={downloadName} className="mp-lb-download" />}
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

const DEFAULT_MOODBOARD_DESC = 'Estas imágenes muestran el estilo, los materiales y las soluciones que van a guiar el diseño de tu proyecto — la referencia visual sobre la que vamos a trabajar.';

function MoodboardSection({ moodboard }) {
  const [active, setActive] = useState(null);
  const images = moodboard?.images || [];
  const description = moodboard?.description || '';
  if (images.length === 0 && !description) return null;
  return (
    <section className="mp-moodboard">
      <div className="mp-moodboard-header">
        <p className="mp-moodboard-label">El estilo del proyecto</p>
        <h2 className="mp-moodboard-title">Moodboard</h2>
        <p className="mp-moodboard-desc">{description || DEFAULT_MOODBOARD_DESC}</p>
      </div>
      {images.length > 0 && (
        <div className="mp-moodboard-grid">
          {images.map((img, i) => (
            <div key={img.id} className="mp-moodboard-item" role="button" tabIndex={0} onClick={() => setActive(img)} onKeyDown={e => e.key === 'Enter' && setActive(img)}>
              <img src={img.url} alt="" loading={i < 4 ? 'eager' : 'lazy'} />
            </div>
          ))}
        </div>
      )}
      {active && (
        <Lightbox src={active.url} alt="" onClose={() => setActive(null)} downloadUrl={active.url} downloadName={`moodboard-${images.findIndex(i => i.id === active.id) + 1}.jpg`} />
      )}
    </section>
  );
}

function HeroRender({ render, onClick }) {
  return (
    <div className="mp-hero-render" onClick={onClick} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && onClick()}>
      <img src={render.url} alt={render.name || ''} loading="eager" />
      <DownloadButton url={render.url} filename={renderFilename(render, 0)} className="mp-hero-download" />
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
        {rest.map((r, i) => (
          <div
            key={r.id}
            className="mp-img-thumb"
            role="button"
            tabIndex={0}
            onClick={() => setActive(r)}
            onKeyDown={e => e.key === 'Enter' && setActive(r)}
          >
            <img src={r.url} alt={r.name || ''} loading="lazy" />
            <DownloadButton url={r.url} filename={renderFilename(r, i + 1)} className="mp-img-download" />
            {r.name && <span className="mp-img-name">{r.name}</span>}
          </div>
        ))}
      </div>
      {active && (
        <Lightbox
          src={active.url}
          alt={active.name || ''}
          onClose={() => setActive(null)}
          downloadUrl={active.url}
          downloadName={renderFilename(active, rest.findIndex(r => r.id === active.id) + 1)}
        />
      )}
    </section>
  );
}

function MaterialesSection({ materials, label }) {
  const [active, setActive] = useState(null);
  if (!materials?.length) return null;
  return (
    <section className="mp-block">
      <p className="mp-block-label">{label || 'Materiales'}</p>
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
              <span className="mp-sel-name">{m.name}{m.code && <span className="mp-sel-code"> #{m.code}</span>}</span>
              {m.brand && <span className="mp-sel-sub">{m.brand}</span>}
              {m.category && <span className="mp-sel-tag">{m.category}</span>}
              {m.location && <span className="mp-sel-location">→ {m.location}</span>}
              {m.datasheet_url && <a href={m.datasheet_url} target="_blank" rel="noopener noreferrer" className="mp-sel-datasheet" onClick={ev => ev.stopPropagation()}>Ficha técnica ↗</a>}
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

function MobiliarioSection({ equipment, label }) {
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
      <p className="mp-block-label">{label || 'Mobiliario y equipamiento'}</p>
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
                <span className="mp-sel-name">{e.name}{e.code && <span className="mp-sel-code"> #{e.code}</span>}</span>
                {e.brand && <span className="mp-sel-sub">{e.brand}</span>}
                {e.category && <span className="mp-sel-tag">{e.category}</span>}
                {e.location && <span className="mp-sel-location">→ {e.location}</span>}
                {e.show_quantity !== false && <span className="mp-sel-qty">×{e.quantity || 1}</span>}
                {e.datasheet_url && <a href={e.datasheet_url} target="_blank" rel="noopener noreferrer" className="mp-sel-datasheet" onClick={ev => ev.stopPropagation()}>Ficha técnica ↗</a>}
                {e.show_purchase_link && e.purchase_link && (
                  <a
                    href={e.purchase_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mp-sel-buy"
                    onClick={ev => ev.stopPropagation()}
                  >
                    Comprar ↗
                  </a>
                )}
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
                {activeItem.show_quantity !== false && activeItem.quantity > 1 && <span className="mp-eq-qty">Cantidad: <strong>{activeItem.quantity}</strong></span>}
              </div>
              {activeItem.show_purchase_link && activeItem.purchase_link && (
                <a
                  href={activeItem.purchase_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mp-eq-buy"
                >
                  Comprar este producto ↗
                </a>
              )}
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

const DEFAULT_LISTADOS_INTRO = 'Aquí tienes el listado completo de materiales y equipamiento seleccionados para tu proyecto, organizado por categoría, con su código de plano, unidades y enlace de compra cuando esté disponible.';

// Las categorías del catálogo se nombran "1. Racks y Jaulas", "2. Máquinas Gym"...
// Con ese número al principio, Víctor ya define el orden que quiere — lo usamos
// para ordenar los listados en vez de dejarlos en el orden en que se añadieron.
function leadingNumber(name) {
  const m = /^(\d+)\./.exec(name || '');
  return m ? parseInt(m[1], 10) : Infinity;
}

function ListadoGroup({ group, onZoom }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mp-listado-group">
      <button type="button" className="mp-listado-cat-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="mp-listado-cat">{group.name}</span>
        <svg className={`mp-ph-chevron${open ? ' open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {open && (
        <div className="mp-listado-table">
          {group.items.map(item => {
            const uds = item.quantity || 1;
            const showUds = item.kind === 'equipment' ? item.show_quantity !== false : true;
            return (
              <div key={item.id} className="mp-listado-row">
                <div className="mp-listado-img" onClick={() => item.image_url && onZoom(item)} role={item.image_url ? 'button' : undefined} tabIndex={item.image_url ? 0 : undefined}>
                  {item.image_url ? <img src={item.image_url} alt="" loading="lazy" /> : <span className="mp-listado-img-empty" />}
                </div>
                <div className="mp-listado-info">
                  <span className="mp-listado-desc">{item.name}{item.brand ? <span className="mp-listado-brand"> · {item.brand}</span> : null}</span>
                  <span className="mp-listado-meta">
                    {item.code && <span className="mp-listado-code">Cód. {item.code}</span>}
                    {showUds && <span className="mp-listado-uds">Uds: {uds}</span>}
                  </span>
                </div>
                {item.show_purchase_link && item.purchase_link && (
                  <a href={item.purchase_link} target="_blank" rel="noopener noreferrer" className="mp-listado-buy" onClick={e => e.stopPropagation()}>Comprar ↗</a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ListadosSection({ materials, equipment, intro, title }) {
  const [zoom, setZoom] = useState(null);
  const all = [
    ...(materials || []).map(m => ({ ...m, kind: 'material' })),
    ...(equipment || []).map(e => ({ ...e, kind: 'equipment' })),
  ];
  if (!all.length) return null;

  const groups = [];
  all.forEach(item => {
    const catName = item.category || 'Sin categoría';
    let g = groups.find(x => x.name === catName);
    if (!g) { g = { name: catName, items: [] }; groups.push(g); }
    g.items.push(item);
  });
  groups.sort((a, b) => leadingNumber(a.name) - leadingNumber(b.name) || a.name.localeCompare(b.name));

  return (
    <section className="mp-block">
      <p className="mp-block-label">{title || 'Listados'}</p>
      <p className="mp-ph-intro">{intro || DEFAULT_LISTADOS_INTRO}</p>
      <div className="mp-listados">
        {groups.map(g => <ListadoGroup key={g.name} group={g} onZoom={setZoom} />)}
      </div>
      {zoom && <Lightbox src={zoom.image_url} alt={zoom.name} onClose={() => setZoom(null)} />}
    </section>
  );
}

function CategoryDocuments({ items }) {
  const docs = items.filter(i => i.type === 'documento' && i.file_url);
  if (!docs.length) return null;
  return (
    <div className="mp-ph-docs">
      {docs.map(d => (
        <a key={d.id} href={d.file_url} target="_blank" rel="noopener noreferrer" className="mp-ph-doc">
          {d.code && <span className="mp-ph-doc-code">{d.code}</span>}
          <svg className="mp-doc-file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13h6M9 17h4"/>
          </svg>
          <span className="mp-ph-doc-name">{d.title}</span>
          <svg className="mp-doc-dl" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </a>
      ))}
    </div>
  );
}

function BlockItem({ item }) {
  const [active, setActive] = useState(null);
  const hasAny = item.body_text || item.images?.length || item.links?.length;
  if (!hasAny) return null;
  return (
    <div className="mp-block">
      <p className="mp-block-label">{item.title}</p>
      {item.body_text && <p className="mp-ph-intro">{item.body_text}</p>}
      {item.images?.length > 0 && (
        <div className="mp-img-grid">
          {item.images.map((img, i) => (
            <div key={i} className="mp-img-thumb" role="button" tabIndex={0} onClick={() => setActive(img)} onKeyDown={e => e.key === 'Enter' && setActive(img)}>
              <img src={img.url} alt={img.name || ''} loading="lazy" />
              <DownloadButton url={img.url} filename={img.name || `imagen-${i + 1}.jpg`} className="mp-img-download" />
            </div>
          ))}
        </div>
      )}
      {item.links?.length > 0 && (
        <div className="mp-tours-grid">
          {item.links.map((l, i) => (
            <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" className="mp-tour-btn">
              <svg className="mp-tour-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22C12 22 3 17 3 10a9 9 0 1 1 18 0c0 7-9 12-9 12z"/><circle cx="12" cy="10" r="3"/>
              </svg>
              <span className="mp-tour-name">{l.label}</span>
              <svg className="mp-tour-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 17L17 7M17 7H7M17 7v10"/>
              </svg>
            </a>
          ))}
        </div>
      )}
      {active && (
        <Lightbox src={active.url} alt={active.name || ''} onClose={() => setActive(null)} downloadUrl={active.url} downloadName={active.name} />
      )}
    </div>
  );
}

function CategoryBlock({ category }) {
  const status = category.status || 'en_curso';
  const [open, setOpen] = useState(status !== 'proximamente');

  const items = category.items || [];
  const blockItems = items.filter(i => i.type === 'bloque');
  // Materiales y equipamiento ya no se muestran aquí repartidos por fase —
  // van todos juntos en la sección "Listados", agrupados por categoría de
  // producto en vez de por fase de diseño.
  const hasContent = items.length > 0;

  return (
    <div className={`mp-ph mp-ph--${status}`}>
      <button type="button" className="mp-ph-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="mp-ph-label">{category.name}</span>
        <span className={`mp-ph-badge mp-ph-badge--${status}`}>{PHASE_STATUS_LABELS[status]}</span>
        <svg className={`mp-ph-chevron${open ? ' open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {open && (
        <div className="mp-ph-body">
          {category.intro_text && <p className="mp-ph-intro">{category.intro_text}</p>}
          {hasContent ? (
            <div className="mp-ph-content">
              <CategoryDocuments items={items} />
              {blockItems.map(item => <BlockItem key={item.id} item={item} />)}
            </div>
          ) : (
            <p className="mp-ph-empty">Tu diseñador irá añadiendo el contenido de esta categoría aquí.</p>
          )}
        </div>
      )}
    </div>
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

function NeedsFormQuestionField({ question, value, onChange, catalogProducts, references }) {
  switch (question.question_type) {
    case 'si_no':
      return (
        <div className="mp-nf-options">
          {['Sí', 'No'].map(opt => (
            <button key={opt} type="button" className={`mp-nf-opt${value === opt ? ' active' : ''}`} onClick={() => onChange(opt)}>{opt}</button>
          ))}
        </div>
      );
    case 'opcion_unica':
      return (
        <div className="mp-nf-options">
          {(question.options || []).map(opt => (
            <button key={opt} type="button" className={`mp-nf-opt${value === opt ? ' active' : ''}`} onClick={() => onChange(opt)}>{opt}</button>
          ))}
        </div>
      );
    case 'opcion_multiple': {
      const arr = Array.isArray(value) ? value : [];
      const toggle = (opt) => onChange(arr.includes(opt) ? arr.filter(o => o !== opt) : [...arr, opt]);
      return (
        <div className="mp-nf-options">
          {(question.options || []).map(opt => (
            <button key={opt} type="button" className={`mp-nf-opt${arr.includes(opt) ? ' active' : ''}`} onClick={() => toggle(opt)}>{opt}</button>
          ))}
        </div>
      );
    }
    case 'numero':
      return <input type="number" className="mp-nf-input" style={{ maxWidth: 160 }} value={value ?? ''} onChange={e => onChange(e.target.value === '' ? null : parseFloat(e.target.value))} />;
    case 'texto_largo':
      return <textarea className="mp-nf-input" rows={3} value={value || ''} onChange={e => onChange(e.target.value)} />;
    case 'catalogo_productos': {
      const arr = Array.isArray(value) ? value : [];
      const toggle = (id) => onChange(arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id]);
      return (
        <div className="mp-nf-picker">
          {catalogProducts.length === 0 && <p className="mp-nf-empty">Todavía no hay productos en el catálogo.</p>}
          {catalogProducts.map(p => {
            const selected = arr.includes(p.id);
            return (
              <button key={p.id} type="button" onClick={() => toggle(p.id)} className={`mp-nf-pick${selected ? ' active' : ''}`}>
                {p.photo_url ? <img src={p.photo_url} alt={p.name} /> : <div className="mp-nf-pick-noimg" />}
                <span>{p.name}</span>
              </button>
            );
          })}
        </div>
      );
    }
    case 'estilo_imagenes': {
      const arr = Array.isArray(value) ? value : [];
      const toggle = (id) => onChange(arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id]);
      return (
        <div className="mp-nf-picker">
          {references.length === 0 && <p className="mp-nf-empty">Tu diseñador todavía no ha añadido imágenes de referencia.</p>}
          {references.map(r => {
            const selected = arr.includes(r.id);
            return (
              <button key={r.id} type="button" onClick={() => toggle(r.id)} className={`mp-nf-pick${selected ? ' active' : ''}`}>
                {r.image_url ? <img src={r.image_url} alt={r.title} /> : <div className="mp-nf-pick-noimg" />}
                <span>{r.title}</span>
              </button>
            );
          })}
        </div>
      );
    }
    default:
      return <input className="mp-nf-input" value={value || ''} onChange={e => onChange(e.target.value)} />;
  }
}

function NeedsFormSection({ code }) {
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [answersDraft, setAnswersDraft] = useState({});
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState(false);
  const [newSpace, setNewSpace] = useState({ space_name: '', largo: '', ancho: '', alto: '', notes: '' });
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoRef = useRef();
  const base = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

  const load = () => {
    fetch(`${base}/needs-form/public/${encodeURIComponent(code)}`)
      .then(r => r.json())
      .then(data => {
        setBundle(data);
        const draft = {};
        (data.answers || []).forEach(a => { draft[a.question_id] = a.answer_value; });
        setAnswersDraft(draft);
        setName(data.form?.filled_by_name || '');
        setSent(data.form?.status === 'enviado');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [code]);

  const handleAddMeasurement = async () => {
    if (!newSpace.space_name.trim()) return;
    try {
      const r = await fetch(`${base}/needs-form/public/${encodeURIComponent(code)}/measurements`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSpace),
      });
      const data = await r.json();
      setBundle(prev => ({ ...prev, measurements: [...prev.measurements, data.measurement] }));
      setNewSpace({ space_name: '', largo: '', ancho: '', alto: '', notes: '' });
    } catch {}
  };

  const handleDeleteMeasurement = async (id) => {
    try {
      await fetch(`${base}/needs-form/public/${encodeURIComponent(code)}/measurements/${id}`, { method: 'DELETE' });
      setBundle(prev => ({ ...prev, measurements: prev.measurements.filter(m => m.id !== id) }));
    } catch {}
  };

  const handleUploadPhoto = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploadingPhoto(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await fetch(`${base}/needs-form/public/${encodeURIComponent(code)}/photos`, { method: 'POST', body: form });
      const data = await r.json();
      setBundle(prev => ({ ...prev, photos: [...prev.photos, data.photo] }));
    } catch {} finally { setUploadingPhoto(false); if (photoRef.current) photoRef.current.value = ''; }
  };

  const handleDeletePhoto = async (id) => {
    try {
      await fetch(`${base}/needs-form/public/${encodeURIComponent(code)}/photos/${id}`, { method: 'DELETE' });
      setBundle(prev => ({ ...prev, photos: prev.photos.filter(p => p.id !== id) }));
    } catch {}
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const answers = Object.entries(answersDraft).map(([question_id, answer_value]) => ({ question_id, answer_value }));
      await fetch(`${base}/needs-form/public/${encodeURIComponent(code)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers, filled_by_name: name || 'Cliente', status: 'enviado' }),
      });
      setSent(true);
    } catch {} finally { setSaving(false); }
  };

  if (loading || !bundle) return null;

  const summary = bundle.form?.client_summary || '';

  const sections = [];
  bundle.questions.forEach(q => {
    let sec = sections.find(s => s.name === (q.section || 'General'));
    if (!sec) { sec = { name: q.section || 'General', qs: [] }; sections.push(sec); }
    sec.qs.push(q);
  });

  return (
    <div className="mp-ph mp-ph--en_curso">
      <button type="button" className="mp-ph-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="mp-ph-label">Programa de Necesidades</span>
        <span className={`mp-ph-badge mp-ph-badge--${sent ? 'completado' : 'en_curso'}`}>{sent ? 'Enviado' : 'Pendiente'}</span>
        <svg className={`mp-ph-chevron${open ? ' open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {open && (
        <div className="mp-ph-body">
          {summary ? (
            <p className="mp-ph-intro">{summary}</p>
          ) : sent ? (
            <p className="mp-ph-intro">Gracias, hemos recibido tu programa de necesidades. Tu diseñador lo está revisando y pronto verás aquí un resumen.</p>
          ) : (
            <>
              <p className="mp-ph-intro">Cuéntanos sobre tu proyecto para que podamos diseñarlo a tu medida. Puedes rellenarlo tú o pedirle a tu diseñador que lo haga contigo.</p>

              <div className="mp-nf-block">
                <p className="mp-block-label">Mediciones</p>
                {bundle.measurements.map(m => (
                  <div key={m.id} className="mp-nf-measure-row">
                    <span>{m.space_name}</span>
                    <span className="mp-nf-measure-dims">{[m.largo, m.ancho, m.alto].filter(v => v != null).length ? `${m.largo ?? '—'} × ${m.ancho ?? '—'} × ${m.alto ?? '—'} m` : ''}</span>
                    <button onClick={() => handleDeleteMeasurement(m.id)}>✕</button>
                  </div>
                ))}
                <div className="mp-nf-measure-form">
                  <input value={newSpace.space_name} onChange={e => setNewSpace(s => ({ ...s, space_name: e.target.value }))} placeholder="Espacio (ej. Garaje)" />
                  <input value={newSpace.largo} onChange={e => setNewSpace(s => ({ ...s, largo: e.target.value }))} placeholder="Largo" />
                  <input value={newSpace.ancho} onChange={e => setNewSpace(s => ({ ...s, ancho: e.target.value }))} placeholder="Ancho" />
                  <input value={newSpace.alto} onChange={e => setNewSpace(s => ({ ...s, alto: e.target.value }))} placeholder="Alto" />
                  <button type="button" onClick={handleAddMeasurement}>+ Añadir</button>
                </div>
              </div>

              <div className="mp-nf-block">
                <p className="mp-block-label">Fotos del estado actual</p>
                <div className="mp-nf-photos">
                  {bundle.photos.map(p => (
                    <div key={p.id} className="mp-nf-photo">
                      <img src={p.url} alt="" />
                      <button onClick={() => handleDeletePhoto(p.id)}>✕</button>
                    </div>
                  ))}
                </div>
                <label className="mp-nf-upload-btn">{uploadingPhoto ? 'Subiendo…' : '+ Añadir foto'}<input ref={photoRef} type="file" accept="image/*" onChange={handleUploadPhoto} disabled={uploadingPhoto} style={{ display: 'none' }} /></label>
              </div>

              {sections.map(sec => (
                <div key={sec.name} className="mp-nf-block">
                  <p className="mp-block-label">{sec.name}</p>
                  <div className="mp-nf-questions">
                    {sec.qs.map(q => (
                      <div key={q.id} className="mp-nf-question">
                        <p>{q.question_text}</p>
                        <NeedsFormQuestionField question={q} value={answersDraft[q.id]} onChange={(v) => setAnswersDraft(prev => ({ ...prev, [q.id]: v }))} catalogProducts={bundle.catalog_products || []} references={bundle.references || []} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              <div className="mp-nf-submit">
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Tu nombre" className="mp-nf-input" style={{ maxWidth: 220 }} />
                <button type="button" onClick={handleSubmit} disabled={saving} className="mp-nf-submit-btn">{saving ? 'Guardando…' : 'Enviar'}</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
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

  const heroRender = project.renders?.[0] || null;
  // La portada que sube el diseñador manda sobre el primer render como
  // imagen destacada — pero se muestra con el mismo tratamiento visual
  // (recuadro redondeado y contenido), no como banner a todo lo ancho.
  const coverImage = project.cover_image_url
    ? { url: project.cover_image_url, name: project.project_name }
    : heroRender;
  const categories = project.categories || [];
  const hasGlobalContent = project.notes?.length || project.documents?.length;

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
        {coverImage && (
          <>
            <HeroRender render={coverImage} onClick={() => setHeroLightbox(coverImage)} />
            {heroLightbox && (
              <Lightbox
                src={heroLightbox.url}
                alt={heroLightbox.name || ''}
                onClose={() => setHeroLightbox(null)}
                downloadUrl={heroLightbox.url}
                downloadName={renderFilename(heroLightbox, 0)}
              />
            )}
          </>
        )}

        <div className="mp-hero">
          <p className="mp-hi">Hola, <strong>{project.client_name}</strong></p>
          <h1 className="mp-project-name">{project.project_name}</h1>
        </div>

        <div className="mp-phases">
          <NeedsFormSection code={code} />
          <MoodboardSection moodboard={project.moodboard} />
          {categories.map(category => (
            <CategoryBlock key={category.id} category={category} />
          ))}
          <ListadosSection materials={project.materials} equipment={project.equipment} intro={project.listados_intro_text} title={project.listados_title} />
        </div>

        {hasGlobalContent && (
          <div className="mp-sections">
            <NotasSection notes={project.notes} />
            <DocumentosSection documents={project.documents} />
          </div>
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
