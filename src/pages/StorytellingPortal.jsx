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
    const existente = (b.tipo === 'zona' || b.tipo === 'detalle' || b.tipo === 'render') ? grupos.find(g => g.tipo === b.tipo) : null;
    if (existente) existente.items.push(b);
    else grupos.push({ tipo: b.tipo, items: [b] });
  });
  return grupos;
}

// Planos del espacio que se enseñan uno tras otro en «Entendemos el espacio»:
// 1 Estado actual · 2 Demoliciones e implantación (cuando las hay) · 3 Distribución · y después las zonas con sus renders
const PASOS_PLANO = [
  { k: 'estado', nombre: 'Estado actual', titulos: ['Estado actual'], texto: 'Así es el espacio hoy: medidas reales, estructura y todo lo que condiciona el diseño.' },
  { k: 'obra', nombre: 'Demoliciones e implantación', titulos: ['Demoliciones', 'Implantación'], texto: 'Lo que se retira y lo que se construye de nuevo para preparar el espacio.' },
  { k: 'distrib', nombre: 'Distribución', titulos: ['Distribución'], texto: 'Cómo se reparte el espacio: las zonas, la maquinaria y los recorridos.' },
];
const TITULOS_PASO = PASOS_PLANO.flatMap(p => p.titulos);
const esPaso = (b) => b.tipo === 'plano' && !!b.imagen_url && TITULOS_PASO.includes(b.titulo);

function PasosPlano({ bloques }) {
  const items = bloques.filter(esPaso);
  const pasos = PASOS_PLANO.map(p => ({ ...p, bl: p.titulos.map(t => items.find(b => b.titulo === t)).filter(Boolean) })).filter(p => p.bl.length);
  if (!pasos.length) return null;
  return (
    <div className="sp-pasos">
      {pasos.map((p, i) => (
        <div key={p.k} className="sp-paso sp-blk sp-blk--wide">
          <p className="sp-lbl sp-rv">Paso {i + 1} · {p.nombre}</p>
          <div className={`sp-paso-im sp-paso-im--${p.bl.length} sp-rv`}>
            {p.bl.map(b => (
              <figure key={b.id} className="sp-plano">
                <img src={b.imagen_url} alt={b.titulo} loading="lazy" style={{ objectFit: 'contain' }} />
                {p.bl.length > 1 && <figcaption>{b.titulo}</figcaption>}
              </figure>
            ))}
          </div>
          <p className="sp-plano-t sp-rv">{p.bl.find(b => b.texto)?.texto || p.texto}</p>
        </div>
      ))}
      <p className="sp-lbl sp-rv sp-paso-sig" style={{ textAlign: 'center', marginTop: '8vh' }}>Y ahora, las zonas</p>
    </div>
  );
}

function irA(id) { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }); }

// Imágenes que se pueden ampliar al pulsarlas (no el logo ni la portada)
const SEL_AMPLIAR = '.sp-full:not(.sp-blur) img, .sp-rends img, .sp-zona-i img, .sp-dt-i img, .sp-im img, .sp-gal img, .sp-tiles img, .sp-plano img, .sp-card-i img, .sp-eq-img img';

// Galería de renders de una zona: 1 = a toda pantalla, 2 = en dos columnas, 3 o más = una grande y el resto debajo
function Renders({ items, tituloZona, textoZona, primero }) {
  // Portada del capítulo (id 'main'): si debajo hay más renders, va desenfocada y el render nítido se ve dentro del capítulo
  const hayMas = items.some(r => r.id !== 'main' && r.imagen_url);
  const portadaDesenfocada = hayMas && items.some(r => r.id === 'main' && r.imagen_url);
  const lista = items.filter(r => r.imagen_url && !(portadaDesenfocada && r.id === 'main'));
  if (!lista.length) return null;
  const pie = (r) => {
    const t = r.titulo && r.titulo !== tituloZona ? r.titulo : '';
    const x = r.texto && r.texto.length <= 140 && !(textoZona || '').startsWith(r.texto.slice(0, 40)) ? r.texto : '';
    return [t, x].filter(Boolean).join(' — ');
  };
  const portadaImg = portadaDesenfocada ? items.find(r => r.id === 'main').imagen_url : null;
  const hero = portadaImg ? <div className="sp-full sp-blur sp-rv"><img src={portadaImg} alt="" loading={primero ? 'eager' : 'lazy'} /></div> : null;
  if (lista.length === 1) {
    const r = lista[0];
    return (
      <div>
        {hero}
        <div className="sp-full sp-rv"><img src={r.imagen_url} alt={r.titulo || tituloZona || ''} loading={primero ? 'eager' : 'lazy'} /></div>
        {pie(r) && <p className="sp-cap">{pie(r)}</p>}
      </div>
    );
  }
  return (
    <>
    {hero}
    <div className={`sp-rends sp-rends--${Math.min(lista.length, 4)} sp-rv`}>
      {lista.map((r, i) => (
        <figure key={r.id || i} className={i === 0 ? 'sp-rend-main' : ''}>
          <img src={r.imagen_url} alt={r.titulo || tituloZona || ''} loading={primero && i === 0 ? 'eager' : 'lazy'} />
          {pie(r) && <figcaption>{pie(r)}</figcaption>}
        </figure>
      ))}
    </div>
    </>
  );
}

// Visor a pantalla completa: flechas, teclado y gesto de deslizar
function Visor({ fotos, i, onCambiar, onCerrar }) {
  const t0 = useRef(null);
  useEffect(() => {
    const k = (e) => {
      if (e.key === 'Escape') onCerrar();
      else if (e.key === 'ArrowRight') onCambiar(1);
      else if (e.key === 'ArrowLeft') onCambiar(-1);
    };
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [onCambiar, onCerrar]);
  const f = fotos[i];
  if (!f) return null;
  return (
    <div className="sp-lb" role="dialog" aria-modal="true" aria-label="Imagen ampliada" onClick={onCerrar}
      onTouchStart={e => { t0.current = e.touches[0].clientX; }}
      onTouchEnd={e => { if (t0.current == null) return; const d = e.changedTouches[0].clientX - t0.current; t0.current = null; if (Math.abs(d) > 50) onCambiar(d < 0 ? 1 : -1); }}>
      <img src={f.src} alt={f.alt || ''} onClick={e => e.stopPropagation()} />
      {fotos.length > 1 && <button type="button" className="sp-lb-n sp-lb-prev" aria-label="Anterior" onClick={e => { e.stopPropagation(); onCambiar(-1); }}>‹</button>}
      {fotos.length > 1 && <button type="button" className="sp-lb-n sp-lb-next" aria-label="Siguiente" onClick={e => { e.stopPropagation(); onCambiar(1); }}>›</button>}
      <button type="button" className="sp-lb-x" aria-label="Cerrar" onClick={onCerrar}>×</button>
      <div className="sp-lb-i">{f.alt ? f.alt + ' · ' : ''}{i + 1} / {fotos.length}</div>
    </div>
  );
}

function Bloques({ bloques, capitulos, equipo, materiales }) {

  return agrupar(bloques).map((g, gi) => {
    if (g.tipo === 'render') {
      return <div key={gi} style={{ marginTop: '6vh' }}><Renders items={g.items} /></div>;
    }
    if (g.tipo === 'plano') {
      const b = g.items[0];
      if (!b.imagen_url) return null;
      return (
        <div key={b.id} className="sp-blk">
          <p className="sp-lbl sp-rv">{b.titulo || 'El recorrido'}</p>
          <div className="sp-plano sp-rv"><img src={b.imagen_url} alt={b.titulo || 'Plano de distribución'} loading="lazy" style={{ objectFit: 'contain' }} /></div>
          {b.texto && <p className="sp-plano-t sp-rv">{b.texto}</p>}
          <ol className="sp-leyenda sp-rv">
            {capitulos.map((c, i) => (
              <li key={c.id}><button type="button" onClick={() => irA(`sp-c-${c.id}`)}><b>{i + 1}</b> {c.titulo}</button></li>
            ))}
          </ol>
        </div>
      );
    }
    if (g.tipo === 'galeria') {
      const b = g.items[0]; const fotos = b.elementos || [];
      if (!fotos.length) return null;
      return (
        <div key={b.id} className="sp-blk sp-blk--wide">
          {(b.titulo || b.texto) && <p className="sp-lbl sp-rv">{b.titulo}</p>}
          <div className={`sp-gal sp-gal--${Math.min(fotos.length, 4)} sp-rv`}>
            {fotos.map((u, i) => <div key={i} className={i === 0 ? 'sp-gal-main' : ''}><img src={u} alt={b.titulo || ''} loading="lazy" /></div>)}
          </div>
          {b.texto && <p className="sp-cap" style={{ padding: '14px 0' }}>{b.texto}</p>}
        </div>
      );
    }
    if (g.tipo === 'equipo') {
      const b = g.items[0];
      // Con «#sel» en el bloque: solo lo elegido para este capítulo, en su orden. Sin él (proyectos antiguos): todos los equipos con foto, como siempre.
      const elegido = (b.elementos || []).includes('#sel');
      const items = elegido
        ? (b.elementos || []).filter(x => /^[em]:/.test(x)).map(x => (x[0] === 'e' ? equipo : materiales || []).find?.(e => String(e.id) === x.slice(2))).filter(Boolean).slice(0, 12)
        : (equipo || []).filter(e => e.image_url).slice(0, 8);
      if (!items.length) return null;
      return (
        <div key={b.id} className="sp-blk">
          <p className="sp-lbl sp-rv">{b.titulo || 'Lo que tendrás a mano'}</p>
          {b.texto && <p className="sp-lead sp-rv" style={{ margin: '0 0 22px' }}>{b.texto}</p>}
          <div className="sp-eq sp-rv">
            {items.map(e => (
              <div key={e.id || e.name} className="sp-eq-i">
                <div className="sp-eq-img">{e.image_url ? <img src={e.image_url} alt={e.name} loading="lazy" style={{ objectFit: 'contain' }} /> : null}</div>
                <h5>{e.name}</h5>
                {e.brand && <p>{e.brand}</p>}
                {e.show_quantity !== false && e.quantity > 0 && <p className="sp-eq-q">Cantidad: {e.quantity}</p>}
              </div>
            ))}
          </div>
        </div>
      );
    }
    if (g.tipo === 'zona') {
      return (
        <div key={gi} className="sp-blk">
          <p className="sp-lbl sp-rv">{g.items.length > 1 ? 'Dentro de esta zona' : 'La zona'}</p>
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
          <p className="sp-lbl sp-rv">Detalles de esta zona</p>
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

const PARRAFOS = new RegExp(String.fromCharCode(10) + '[ \t]*' + String.fromCharCode(10));
export function StorytellingPortal({ project, dossier, code }) {
  // Planos subidos desde la herramienta (dossier de ejecución, láminas): se enseñan en «De la historia a la obra»
  const docsTecnicos = (project.documents || []).filter(d => d.doc_type === 'plano');
  const historia = project.historia;
  const capitulos = historia.capitulos;
  const moodboard = project.moodboard || {};
  const imagenesMood = (moodboard.images || []).slice(0, 8);
  const paleta = moodboard.palette || [];
  const estilo = historia.estilo || null;
  const plano = historia.plano || null;
  const objetivo = historia.objetivo || null;
  const hayMood = imagenesMood.length > 0 || paleta.length > 0 || !!moodboard.description || !!estilo;
  const planos = historia.entregables || [];
  const esHome = historia.tipo_proyecto === 'home_gym';
  const portada = project.cover_image_url || capitulos.find(c => c.render_url)?.render_url || project.renders?.[0]?.url || null;

  const secciones = [
    { id: 'sp-top', label: 'Portada' },
    ...(objetivo ? [{ id: 'sp-objetivo', label: 'El objetivo' }] : []),
    ...(plano ? [{ id: 'sp-plano', label: 'El recorrido' }] : []),
    ...(hayMood ? [{ id: 'sp-atmosfera', label: 'La atmósfera' }] : []),
    ...capitulos.map((c, i) => ({ id: `sp-c-${c.id}`, label: c.titulo || `Capítulo ${i + 1}` })),
    { id: 'sp-dossier', label: 'Tu dossier' },
    { id: 'sp-siguiente', label: 'Siguiente paso' },
  ];
  const [activa, setActiva] = useState(0);
  const barRef = useRef(null);
  const rootRef = useRef(null);
  const [visor, setVisor] = useState(null); // { fotos, i }
  const abrirVisor = (e) => {
    const img = e.target.closest && e.target.closest('img');
    if (!img || !img.matches(SEL_AMPLIAR)) return;
    const nodos = Array.from(rootRef.current.querySelectorAll(SEL_AMPLIAR));
    const i = nodos.indexOf(img);
    if (i < 0) return;
    setVisor({ i, fotos: nodos.map(n => ({ src: n.currentSrc || n.src, alt: n.alt || '' })) });
  };
  const cambiarVisor = (d) => setVisor(v => v && ({ ...v, i: (v.i + d + v.fotos.length) % v.fotos.length }));
  const cerrarVisor = () => setVisor(null);

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
  }, [capitulos.length, hayMood, !!plano, !!objetivo]); // eslint-disable-line react-hooks/exhaustive-deps

  const base = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
  const urlZip = code ? `${base}/historia-publica/${encodeURIComponent(code)}/renders.zip` : null;
  const urlPdf = code ? `${base}/historia-publica/${encodeURIComponent(code)}/historia.pdf` : null;
  const hayRenders = capitulos.some(c => c.render_url || c.bloques.some(b => b.imagen_url));

  const asunto = encodeURIComponent(`Quiero pasar a la ejecución — ${project.project_name || ''}`);
  const hrefEjecucion = project.responsible_email ? `mailto:${project.responsible_email}?subject=${asunto}` : WA_LINK;

  return (
    <div className="sp" ref={rootRef} onClick={abrirVisor}>
      {visor && <Visor fotos={visor.fotos} i={visor.i} onCambiar={cambiarVisor} onCerrar={cerrarVisor} />}
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

      {objetivo && (
        <section className="sp-mood sp-objetivo" id="sp-objetivo">
          <p className="sp-label sp-rv">El punto de partida</p>
          <h2 className="sp-rv">{esHome ? 'Lo que buscas en tu home gym.' : 'Lo que buscas con este proyecto.'}</h2>
          {objetivo.split(PARRAFOS).filter(p => p.trim()).map((p, i) => <p key={i} className="sp-lead sp-rv" style={{ whiteSpace: 'pre-line' }}>{p.trim()}</p>)}
        </section>
      )}

      {plano && (
        <section className="sp-planosec" id="sp-plano">
          <p className="sp-label sp-rv">El recorrido</p>
          <h2 className="sp-rv">Así se organiza tu espacio.</h2>
          {plano.texto && <p className="sp-lead sp-rv" style={{ marginBottom: 30 }}>{plano.texto}</p>}
          <div className="sp-plano sp-rv"><img src={plano.imagen_url} alt="Plano de distribución con el recorrido" loading="lazy" style={{ objectFit: 'contain' }} /></div>
          <ol className="sp-leyenda sp-rv">
            {capitulos.map((c, i) => (
              <li key={c.id}><button type="button" onClick={() => irA(`sp-c-${c.id}`)}><b>{i + 1}</b> {c.titulo}</button></li>
            ))}
          </ol>
        </section>
      )}

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
            {capitulos.length > 1 && <div className="sp-num">{String(i + 1).padStart(2, '0')}</div>}
            <div>
              <p className="sp-label" style={{ marginBottom: 10 }}>{capitulos.length > 1 ? 'Zona' : 'Tu espacio'}</p>
              <h2>{c.titulo}</h2>
              {c.texto && <p className="sp-text">{c.texto}</p>}
            </div>
          </div>
          <Renders primero={i === 0} tituloZona={c.titulo} textoZona={c.texto} items={[...(c.render_url ? [{ id: 'main', imagen_url: c.render_url, titulo: c.titulo }] : []), ...c.bloques.filter(b => b.tipo === 'render')]} />
          <PasosPlano bloques={c.bloques} />
          <Bloques bloques={c.bloques.filter(b => b.tipo !== 'render' && !esPaso(b))} capitulos={capitulos} equipo={project.equipment} materiales={project.materials} />
          {c.servicios.length > 0 && (
            <div className="sp-blk">
              <p className="sp-lbl sp-rv">Soluciones y servicios</p>
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
        {docsTecnicos.length > 0 ? (
          <>
            <p className="sp-label sp-rv">Tu proyecto de ejecución</p>
            <h2 className="sp-rv">Los planos para construirlo</h2>
            <p className="sp-cta-t sp-rv">La historia ya está diseñada y los planos de ejecución están listos. Aquí tienes la documentación técnica para llevarla a obra.</p>
          </>
        ) : (
          <>
            <p className="sp-label sp-rv">El siguiente paso</p>
            <h2 className="sp-rv">De la historia a la obra</h2>
            <p className="sp-cta-t sp-rv">Con la experiencia diseñada, nos ocupamos de que se construya exactamente así: documentación técnica, proveedores, partidas y acompañamiento.</p>
            <div className="sp-s2 sp-rv"><div>Documentación técnica y especificaciones</div><div>Proveedores y partidas</div><div>Acompañamiento en obra</div></div>
          </>
        )}
        {docsTecnicos.length > 0 && (
          <div className="sp-docs-tec sp-rv">
            <p>Planos y documentación técnica</p>
            {docsTecnicos.map(d => <a key={d.id} href={d.url} target="_blank" rel="noopener noreferrer">{d.name || 'Documento'} <span>Descargar →</span></a>)}
          </div>
        )}
        <a className="sp-btn sp-rv" href={hrefEjecucion} target={project.responsible_email ? undefined : '_blank'} rel="noopener noreferrer">{docsTecnicos.length > 0 ? 'Hablar con mi responsable' : 'Quiero pasar a la ejecución'}</a>
      </section>
      <footer className="sp-footer">Ranuse Design</footer>
    </div>
  );
}
