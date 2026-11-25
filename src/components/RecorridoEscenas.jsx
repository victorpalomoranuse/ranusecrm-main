import { useCallback, useEffect, useRef, useState } from 'react';
import './RenderRecorrido.css';

// Galería de renders del proyecto, en orden y zona tras zona: una imagen cada vez, a la mayor calidad, entera y sin recortes.
// Se pasa con las flechas, deslizando de lado, con el teclado o con las miniaturas; se puede ver a pantalla completa.
// Cada escena: { src, puntos (puntos tocables en % de la imagen), alt, inicio (primera de su zona), zona: { num, titulo, texto } }.

const recorta = (t, n = 190) => {
  const s = String(t || '').trim().replace(/\s+/g, ' ');
  if (s.length <= n) return s;
  const corte = s.slice(0, n), p = Math.max(corte.lastIndexOf('. '), corte.lastIndexOf('? '), corte.lastIndexOf('! '));
  return p > 60 ? corte.slice(0, p + 1) : corte.replace(/\s+\S*$/, '') + '…';
};

export default function RecorridoEscenas({ escenas }) {
  const N = escenas.length;
  const [i, setI] = useState(0);
  const [abierto, setAbierto] = useState(null);
  const [pleno, setPleno] = useState(false);
  const raiz = useRef(null), tira = useRef(null), toque = useRef(null);
  const ir = useCallback((k) => { setAbierto(null); setI(v => Math.max(0, Math.min(N - 1, typeof k === 'function' ? k(v) : k))); }, [N]);

  // teclado: solo cuando la galería está a la vista
  useEffect(() => {
    const tecla = (e) => {
      if (e.target && /^(input|textarea|select)$/i.test(e.target.tagName)) return;
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const el = raiz.current; if (!el) return;
      const r = el.getBoundingClientRect();
      if (!(r.top < window.innerHeight * 0.6 && r.bottom > window.innerHeight * 0.4)) return;
      e.preventDefault(); ir(v => v + (e.key === 'ArrowRight' ? 1 : -1));
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [ir]);

  // precarga la anterior y la siguiente
  useEffect(() => {
    [i - 1, i + 1, i + 2].forEach(k => { if (k >= 0 && k < N && escenas[k]) { const im = new Image(); im.src = escenas[k].src; } });
  }, [i, N, escenas]);

  // la miniatura activa se mantiene a la vista
  useEffect(() => {
    const t = tira.current; if (!t) return;
    const b = t.children[i]; if (b) t.scrollTo({ left: b.offsetLeft - t.clientWidth / 2 + b.clientWidth / 2, behavior: 'smooth' });
  }, [i]);

  useEffect(() => {
    const cambia = () => setPleno(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', cambia);
    return () => document.removeEventListener('fullscreenchange', cambia);
  }, []);
  const alternaPleno = () => {
    const el = raiz.current; if (!el) return;
    try { if (document.fullscreenElement) document.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen(); } catch { /* sin pantalla completa */ }
  };

  const alTocar = (e) => { const t = e.touches[0]; toque.current = { x: t.clientX, y: t.clientY }; };
  const alSoltarToque = (e) => {
    const s = toque.current; toque.current = null; if (!s) return;
    const t = e.changedTouches[0], dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) ir(v => v + (dx < 0 ? 1 : -1));
  };

  if (!N) return null;
  const e = escenas[Math.min(i, N - 1)], z = e.zona;
  return (
    <div ref={raiz} className={'rg' + (pleno ? ' rg-pleno' : '')} onClick={() => setAbierto(null)}>
      {z && z.titulo && (
        <div className="rg-zona" key={'z' + i}>
          {z.num && <span>Zona {z.num}</span>}
          <strong>{z.titulo}</strong>
          {e.inicio && z.texto && <p>{recorta(z.texto, 120)}</p>}
        </div>
      )}
      <div className="rg-vista" onTouchStart={alTocar} onTouchEnd={alSoltarToque}>
        <div className="rg-marco" key={'m' + i}>
          <img className="rg-img" src={e.src} alt={e.alt || ''} draggable={false} decoding="async" />
          {(e.puntos || []).map((p, n) => (
            <button key={n} type="button" className={'rg-punto' + (abierto && abierto.n === n ? ' on' : '')} style={{ left: p.x + '%', top: p.y + '%' }} aria-label={p.titulo || 'Punto'}
              onClick={(ev) => { ev.stopPropagation(); setAbierto(abierto && abierto.n === n ? null : { e: p, n }); }}><i /></button>
          ))}
        </div>
        {N > 1 && <button type="button" className="rg-flecha rg-ant" aria-label="Imagen anterior" disabled={i === 0} onClick={ev => { ev.stopPropagation(); ir(i - 1); }}>‹</button>}
        {N > 1 && <button type="button" className="rg-flecha rg-sig" aria-label="Imagen siguiente" disabled={i === N - 1} onClick={ev => { ev.stopPropagation(); ir(i + 1); }}>›</button>}
        {abierto && (abierto.e.titulo || abierto.e.texto) && (
          <div className="rr-ficha" role="status" onClick={ev => ev.stopPropagation()}>
            {abierto.e.titulo && <b>{abierto.e.titulo}</b>}
            {abierto.e.texto && <span>{abierto.e.texto}</span>}
            <button type="button" aria-label="Cerrar" onClick={() => setAbierto(null)}>×</button>
          </div>
        )}
        <button type="button" className="rg-pleno-btn" onClick={ev => { ev.stopPropagation(); alternaPleno(); }} title="Ver a pantalla completa">{pleno ? 'Salir' : 'Pantalla completa'}</button>
        {N > 1 && <div className="rg-cont" aria-hidden="true">{String(i + 1).padStart(2, '0')} / {String(N).padStart(2, '0')}</div>}
      </div>
      {N > 1 && (
        <div className="rg-tira" ref={tira}>
          {escenas.map((s, k) => (
            <button key={k} type="button" className={k === i ? 'on' : ''} aria-label={'Ir a la imagen ' + (k + 1)} onClick={ev => { ev.stopPropagation(); ir(k); }}>
              <img src={s.src} alt="" loading="lazy" decoding="async" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
