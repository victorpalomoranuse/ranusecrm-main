import { useEffect, useRef, useState } from 'react';
import './StorytellingPortal.css';

// Vista de storytelling del portal del cliente. Solo se usa cuando el
// proyecto tiene capítulos (project.historia); los proyectos antiguos siguen
// con el portal de siempre.

const WA_LINK = 'https://api.whatsapp.com/message/XSSED6I72WM3P1?autoload=1&app_absent=0';

// Agrupa bloques consecutivos del mismo tipo (zonas y detalles van en rejilla)
function agrupar(bloques) {
  const grupos = [];
  bloques.forEach(b => {
    // Todas las zonas (y todos los detalles) de un capítulo van juntos, en la
    // posición de la primera, aunque haya otros bloques entre medias
    const existente = (b.tipo === 'zona' || b.tipo === 'detalle') ? grupos.find(g => g.tipo === b.tipo) : null;
    if (existente) existente.items.push(b);
    else grupos.push({ tipo: b.tipo, items: [b] });
  });
  return grupos;
}

function Bloques({ bloques }) {

  return agrupar(bloques).map((g, gi) => {
    if (g.tipo === 'render') {
      return g.items.map(b => b.imagen_url && (
        <div key={b.id}>
          <div className="sp-full sp-rv" style={{ marginTop: '9vh' }}><img src={b.imagen_url} alt={b.titulo || ''} loading="lazy" /></div>
          {(b.titulo || b.texto) && <p className="sp-cap">{[b.titulo, b.texto].filter(Boolean).join(' — ')}</p>}
        </div>
      ));
    }
    if (g.tipo === 'zona') {
      return (
        <div key={gi} className="sp-blk">
          <p className="sp-lbl sp-rv">{g.items.length > 1 ? 'Las zonas' : 'La zona'}</p>
          <div className="sp-zonas sp-rv">
            {g.items.map(z => (
              <div key={z.id} className="sp-zona">
                {z.imagen_url && <div className="sp-zona-i"><img src={z.imagen_url} alt={z.titulo || ''} loading="lazy" /></div>}
                <div className="sp-zona-b">
                  {z.titulo && <h4>{z.titulo}</h4>}
                  {z.texto && <p>{z.texto}</p>}
                  {z.elementos?.length > 0 && <ul>{z.elementos.map((el, i) => <li key={i}>{el}</li>)}</ul>}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }
    if (g.tipo === 'detalle') {
      return (
        <div key={gi} className="sp-blk">
          <p className="sp-lbl sp-rv">Detalles que marcan la diferencia</p>
          <div className="sp-det sp-rv">
            {g.items.map(d => (
              <div key={d.id} className="sp-dt">
                {d.imagen_url && <div className="sp-dt-i"><img src={d.imagen_url} alt={d.titulo || ''} loading="lazy" /></div>}
                {d.titulo && <h5>{d.titulo}</h5>}
                {d.texto && <p>{d.texto}</p>}
              </div>
            ))}
          </div>
        </div>
      );
    }
    // imagen_texto
    const b = g.items[0];
    const rev = b.lado !== 'izquierda'; // lado = dónde va la imagen; por defecto a la derecha
    if (!b.imagen_url) {
      return (
        <div key={b.id} className="sp-blk"><div className="sp-solo sp-rv">{b.titulo && <h3>{b.titulo}</h3>}{b.texto && <p>{b.texto}</p>}</div></div>
      );
    }
    return (
      <div key={b.id} className="sp-blk">
        <div className={`sp-split sp-rv${rev ? ' sp-rev' : ''}`}>
          <div className="sp-im"><img src={b.imagen_url} alt={b.titulo || ''} loading="lazy" /></div>
          <div>{b.titulo && <h3>{b.titulo}</h3>}{b.texto && <p>{b.texto}</p>}</div>
        </div>
      </div>
    );
  });
}

export function StorytellingPortal({ project, dossier, code }) {
  const historia = project.historia;
  const capitulos = historia.capitulos;
  const moodboard = project.moodboard || {};
  const imagenesMood = (moodboard.images || []).slice(0, 8);
  const paleta = moodboard.palette || [];
  const estilo = historia.estilo || null;
  const hayMood = imagenesMood.length > 0 || paleta.length > 0 || !!moodboard.description || !!estilo;
  const planos = historia.entregables || [];
  const esHome = historia.tipo_proyecto === 'home_gym';
  const portada = project.cover_image_url || capitulos.find(c => c.render_url)?.render_url || project.renders?.[0]?.url || null;

  const secciones = [
    { id: 'sp-top', label: 'Portada' },
    ...(hayMood ? [{ id: 'sp-atmosfera', label: 'La atmósfera' }] : []),
    ...capitulos.map((c, i) => ({ id: `sp-c-${c.id}`, label: c.titulo || `Capítulo ${i + 1}` })),
    { id: 'sp-dossier', label: 'Tu dossier' },
    { id: 'sp-siguiente', label: 'Siguiente paso' },
  ];
  const [activa, setActiva] = useState(0);
  const barRef = useRef(null);

  useEffect(() => {
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) e.target.classList.add('sp-in'); }), { threshold: 0.12 });
    const observar = () => document.querySelectorAll('.sp-rv, .sp-full').forEach(el => io.observe(el));
    observar();
    // contenido que aparece tras montar (la pestaña de detalles, etc.)
    const t = setTimeout(observar, 800);
    const onScroll = () => {
      const y = window.scrollY + window.innerHeight * 0.4;
      let k = 0;
      secciones.forEach((s, i) => { const el = document.getElementById(s.id); if (el && el.offsetTop <= y) k = i; });
      setActiva(k);
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (barRef.current) barRef.current.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + '%';
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => { io.disconnect(); clearTimeout(t); window.removeEventListener('scroll', onScroll); };
  }, [capitulos.length, hayMood]); // eslint-disable-line react-hooks/exhaustive-deps

  const base = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
  const urlZip = code ? `${base}/historia-publica/${encodeURIComponent(code)}/renders.zip` : null;
  const urlPdf = code ? `${base}/historia-publica/${encodeURIComponent(code)}/historia.pdf` : null;
  const hayRenders = capitulos.some(c => c.render_url || c.bloques.some(b => b.imagen_url));

  const asunto = encodeURIComponent(`Quiero pasar a la ejecución — ${project.project_name || ''}`);
  const hrefEjecucion = project.responsible_email ? `mailto:${project.responsible_email}?subject=${asunto}` : WA_LINK;

  return (
    <div className="sp">
      <div className="sp-bar" ref={barRef} />
      <header className="sp-header">
        <a className="sp-logo" href="/"><img src="/iconoRanuse.ico" alt="" /><span>Ranuse Design</span></a>
        {urlPdf && <a className="sp-pdf" href={urlPdf} download>Descargar PDF</a>}
      </header>

      <nav className="sp-rail" aria-label="Capítulos">
        {secciones.map((s, i) => (
          <a key={s.id} href={`#${s.id}`} className={activa === i ? 'sp-on' : ''}
            onClick={e => { e.preventDefault(); document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth' }); }}>
            <i /><span>{s.label}</span>
          </a>
        ))}
      </nav>

      <section className="sp-hero" id="sp-top">
        {portada && <div className="sp-hero-bg"><img src={portada} alt="" /></div>}
        <div className="sp-hero-t">
          <p className="sp-kicker">Proyecto creativo · {project.client_name}</p>
          <h1>{project.project_name || 'Un día en tu espacio'}</h1>
          <p className="sp-sub">Antes de dibujar un solo plano, hemos imaginado cómo se vive cada momento. {esHome ? 'Esta es la historia de un día de entrenamiento en tu nuevo home gym.' : 'Esta es la historia de tu gimnasio.'}</p>
        </div>
        <div className="sp-scroll">Desliza</div>
      </section>

      {hayMood && (
        <section className="sp-mood" id="sp-atmosfera">
          <p className="sp-label sp-rv">La atmósfera</p>
          <h2 className="sp-rv">{estilo?.nombre || 'El estilo que guía todo el proyecto.'}</h2>
          {estilo?.texto && <p className="sp-lead sp-rv" style={{ whiteSpace: 'pre-line' }}>{estilo.texto}</p>}
          {!estilo && moodboard.description && <p className="sp-lead sp-rv" style={{ whiteSpace: 'pre-line' }}>{moodboard.description}</p>}
          {paleta.length > 0 && <div className="sp-pal sp-rv">{paleta.map((hex, i) => <div key={i} title={hex} style={{ background: hex }} />)}</div>}
          {estilo && moodboard.description && (
            <details className="sp-recipe sp-rv">
              <summary>Cómo se combinan los colores</summary>
              <p style={{ whiteSpace: 'pre-line' }}>{moodboard.description}</p>
            </details>
          )}
          {imagenesMood.length > 0 && (
            <div className="sp-tiles sp-rv">{imagenesMood.map((img, i) => <div key={img.id}><img src={img.url} alt="" loading={i < 4 ? 'eager' : 'lazy'} /></div>)}</div>
          )}
        </section>
      )}

      {capitulos.map((c, i) => (
        <section className="sp-chap" id={`sp-c-${c.id}`} key={c.id}>
          <div className="sp-chap-head sp-rv">
            <div className="sp-num">{String(i + 1).padStart(2, '0')}</div>
            <div>
              <p className="sp-label" style={{ marginBottom: 10 }}>Capítulo</p>
              <h2>{c.titulo}</h2>
              {c.texto && <p className="sp-text">{c.texto}</p>}
            </div>
          </div>
          {c.render_url && <div className="sp-full sp-rv"><img src={c.render_url} alt={c.titulo} loading={i === 0 ? 'eager' : 'lazy'} /></div>}
          <Bloques bloques={c.bloques} />
          {c.servicios.length > 0 && (
            <div className="sp-blk">
              <p className="sp-lbl sp-rv">Servicios en este momento</p>
              <div className="sp-sv sp-rv">
                {c.servicios.map(s => (
                  <div key={s.id} className="sp-card">
                    {s.imagen_url && <div className="sp-card-i"><img src={s.imagen_url} alt={s.nombre} loading="lazy" /></div>}
                    <div className="sp-card-b">
                      <span className={`sp-tag sp-t-${s.etiqueta}`}>{s.etiqueta === 'wow' ? 'Wow' : s.etiqueta === 'extra' ? 'Extra' : 'Incluido'}</span>
                      <h5>{s.nombre}</h5>
                      {s.descripcion && <p>{s.descripcion}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {c.tour_url && <div className="sp-blk"><a className="sp-tour" href={c.tour_url} target="_blank" rel="noopener noreferrer">Recorrer este espacio en 360º</a></div>}
        </section>
      ))}

      <section className="sp-dossier" id="sp-dossier">
        <div className="sp-dossier-h">
          <p className="sp-label sp-rv">Tu dossier</p>
          <h2 className="sp-rv">Todo lo que necesitas para avanzar, en un solo lugar.</h2>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {urlPdf && <a className="sp-btn sp-rv" style={{ marginTop: 26, padding: '12px 28px' }} href={urlPdf} download>Descargar PDF del proyecto</a>}
            {urlZip && hayRenders && <a className="sp-btn sp-rv" style={{ marginTop: 26, padding: '12px 28px', background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,.35)' }} href={urlZip} download>Descargar todos los renders (ZIP)</a>}
          </div>
        </div>
        {planos.length > 0 && (
          <div className="sp-dgrid">
            {planos.map(p => (
              <div key={p.id} className="sp-dc">
                <b>{p.nombre}</b>
                {p.descripcion && <span>{p.descripcion}</span>}
                <a href={p.archivo_url} target="_blank" rel="noopener noreferrer">Ver / descargar →</a>
              </div>
            ))}
          </div>
        )}
        {dossier}
      </section>

      <section className="sp-cta" id="sp-siguiente">
        <p className="sp-label sp-rv">El siguiente paso</p>
        <h2 className="sp-rv">De la historia a la obra</h2>
        <p className="sp-cta-t sp-rv">Con la experiencia diseñada, nos ocupamos de que se construya exactamente así: documentación técnica, proveedores, partidas y acompañamiento.</p>
        <div className="sp-s2 sp-rv"><div>Documentación técnica y especificaciones</div><div>Proveedores y partidas</div><div>Acompañamiento en obra</div></div>
        <a className="sp-btn sp-rv" href={hrefEjecucion} target={project.responsible_email ? undefined : '_blank'} rel="noopener noreferrer">Quiero pasar a la ejecución</a>
      </section>
      <footer className="sp-footer">Ranuse Design</footer>
    </div>
  );
}
