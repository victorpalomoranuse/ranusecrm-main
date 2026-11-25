import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { enlacesDeFoto } from '../utils/tourFotos';

// Tour de renders para el cliente (enlace público, solo lectura): se recorre el espacio con los renders finales. Los puntos para moverse
// se colocan solos: cada render guarda la cámara del 3D con la que se hizo, y el lugar donde estaba la cámara de otro render se ve
// como un punto en el suelo de este. Lo que no cae dentro del encuadre se ofrece como flecha en el borde.
const OSCURO = '#141210', ORO = '#c9a46c';

export function TourFotos({ datos, id, firma }) {
  const fotos = datos.fotos;
  const [actual, setActual] = useState(0), [fase, setFase] = useState(''), [aspectos, setAspectos] = useState({});
  const [tam, setTam] = useState({ w: 0, h: 0 }), [ayuda, setAyuda] = useState(true), [vis, setVis] = useState({ a: 0, b: 1e9 });
  const escena = useRef(null), pan = useRef(null), ocupado = useRef(false), stage = useRef(null);
  const foto = fotos[actual], aspecto = aspectos[foto.id] || 16 / 9;
  const reducido = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Tamaño de la escena: con pantalla ancha se ve la foto entera; en el móvil se usa toda la altura y se desliza hacia los lados
  useEffect(() => {
    const medir = () => { const e = stage.current; if (e) setTam({ w: e.clientWidth, h: e.clientHeight }); };
    medir(); window.addEventListener('resize', medir); return () => window.removeEventListener('resize', medir);
  }, []);
  const dim = useMemo(() => {
    const { w, h } = tam; if (!w || !h) return { w: 0, h: 0 };
    if (w < h * aspecto * 0.82) return { w: h * aspecto, h };
    const ancho = Math.min(w, h * aspecto); return { w: ancho, h: ancho / aspecto };
  }, [tam, aspecto]);

  const enlaces = useMemo(() => enlacesDeFoto(fotos, actual, aspecto), [fotos, actual, aspecto]);
  const actualiza = useCallback(() => { const p = pan.current, e = escena.current; if (!p || !e) return; setVis({ a: p.scrollLeft - e.offsetLeft, b: p.scrollLeft - e.offsetLeft + p.clientWidth }); }, []);
  useEffect(() => { const p = pan.current; if (!p) return; p.scrollLeft = (p.scrollWidth - p.clientWidth) / 2; actualiza(); }, [actual, dim, actualiza]);

  // se van bajando las vistas más cercanas para que el salto sea inmediato
  useEffect(() => { enlaces.slice(0, 3).forEach(e => { const im = new Image(); im.src = fotos[e.i].url; }); }, [enlaces, fotos]);

  const ir = (i, punto) => {
    if (ocupado.current || i === actual) return; ocupado.current = true; setAyuda(false);
    if (reducido) { setActual(i); ocupado.current = false; return; }
    if (escena.current && punto && punto.x != null) escena.current.style.transformOrigin = punto.x + '% ' + punto.y + '%';
    setFase('sale');
    setTimeout(() => {
      if (escena.current) escena.current.style.transformOrigin = '50% 50%';
      setActual(i); setFase('entra');
      requestAnimationFrame(() => requestAnimationFrame(() => { setFase(''); setTimeout(() => { ocupado.current = false; }, 560); }));
    }, 520);
  };

  // minimapa: las vistas por su posición en el plano, con hacia dónde mira la actual
  const mapa = useMemo(() => {
    const xs = fotos.map(f => f.cam.px), zs = fotos.map(f => f.cam.pz), x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const W = 150, H = 110, pad = 16, k = Math.min((W - pad * 2) / Math.max(0.01, x1 - x0), (H - pad * 2) / Math.max(0.01, z1 - z0), 60);
    const ox = (W - (x1 - x0) * k) / 2, oz = (H - (z1 - z0) * k) / 2;
    return { W, H, pt: f => [ox + (f.cam.px - x0) * k, oz + (f.cam.pz - z0) * k] };
  }, [fotos]);
  const dir = (() => { const dx = foto.cam.tx - foto.cam.px, dz = foto.cam.tz - foto.cam.pz, l = Math.hypot(dx, dz) || 1; return [dx / l * 14, dz / l * 14]; })();

  const dentroVista = (e) => { if (!e.dentro) return false; const cx = dim.w * e.x / 100; return cx >= vis.a + 70 && cx <= vis.b - 70; };
  // si dos destinos caen casi en el mismo sitio (uno detrás del otro), se deja el más cercano: el otro se llega desde allí
  const puntos = enlaces.filter(dentroVista).reduce((out, e) => (out.some(o => Math.abs(o.x - e.x) < 10 && Math.abs(o.y - e.y) < 12) ? out : [...out, e]), []).slice(0, 6);
  const bordes = enlaces.filter(e => !dentroVista(e)).slice(0, 4).map(e => {
    const lado = e.x != null ? (dim.w * e.x / 100 < vis.a ? 'izq' : 'der') : e.lado; return { ...e, lado };
  });

  return (
    <div style={{ position: 'fixed', inset: 0, background: OSCURO, color: '#fff', fontFamily: 'system-ui, sans-serif', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <style>{`@keyframes tf-pulso{from{opacity:.9;transform:scale(1)}to{opacity:0;transform:scale(1.8)}}
        .tf-esc{transition:transform .55s cubic-bezier(.5,0,.2,1),opacity .55s ease}.tf-esc.sale{transform:scale(1.5);opacity:0}.tf-esc.entra{transition:none;opacity:0;transform:scale(1.08)}
        .tf-pan{scrollbar-width:none}.tf-pan::-webkit-scrollbar{display:none}
        @media (prefers-reduced-motion:reduce){.tf-esc,.tf-esc.sale,.tf-esc.entra{transition:none;transform:none}.tf-pulso{animation:none!important}}`}</style>
      <div style={{ padding: '14px 16px 8px', textShadow: '0 1px 6px rgba(0,0,0,0.7)', zIndex: 2 }}>
        <div style={{ fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', color: ORO }}>Ranuse Design · {datos.titulo}</div>
        <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{foto.nombre}</div>
        {foto.nota && <div style={{ fontSize: 14, opacity: 0.9, maxWidth: 520, marginTop: 4 }}>{foto.nota}</div>}
      </div>
      <div ref={stage} style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <div ref={pan} className="tf-pan" onScroll={actualiza} style={{ position: 'absolute', inset: 0, overflowX: 'auto', overflowY: 'hidden', display: 'flex', justifyContent: 'safe center', alignItems: 'center', WebkitOverflowScrolling: 'touch' }}>
          <div ref={escena} className={'tf-esc' + (fase ? ' ' + fase : '')} style={{ position: 'relative', flex: '0 0 auto', width: dim.w, height: dim.h }}>
            <img src={foto.url} alt={foto.nombre} draggable={false} onLoad={e => { const { naturalWidth: w, naturalHeight: h } = e.currentTarget; if (w && h) setAspectos(a => (a[foto.id] ? a : { ...a, [foto.id]: w / h })); }} style={{ display: 'block', width: '100%', height: '100%', userSelect: 'none' }} />
            {puntos.map(e => (
              <button key={fotos[e.i].id} type="button" onClick={() => ir(e.i, e)} aria-label={'Ir a ' + fotos[e.i].nombre}
                style={{ position: 'absolute', left: e.x + '%', top: e.y + '%', transform: 'translate(-50%,-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 4 }}>
                <span style={{ position: 'relative', width: 46, height: 46, borderRadius: '50%', border: '3px solid #fff', background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', fontSize: 22, boxShadow: '0 2px 10px rgba(0,0,0,0.5)' }}>
                  <span className="tf-pulso" style={{ position: 'absolute', inset: -3, borderRadius: '50%', border: '2px solid ' + ORO, animation: 'tf-pulso 2s ease-out infinite' }} />➤
                </span>
                <span style={{ fontSize: 12, background: 'rgba(0,0,0,0.6)', borderRadius: 10, padding: '2px 8px', whiteSpace: 'nowrap' }}>{fotos[e.i].nombre} · {e.dist.toFixed(1)} m</span>
              </button>
            ))}
          </div>
        </div>
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {bordes.map(e => (
            <button key={fotos[e.i].id} type="button" onClick={() => ir(e.i, null)}
              style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', [e.lado === 'izq' ? 'left' : 'right']: 8, pointerEvents: 'auto', background: 'rgba(14,13,12,0.85)', color: '#fff', border: '1px solid ' + ORO, borderRadius: 999, padding: '8px 12px', fontSize: 13, cursor: 'pointer', maxWidth: '46%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {e.lado === 'izq' ? '← ' : ''}{fotos[e.i].nombre}{e.lado === 'izq' ? '' : ' →'}
            </button>
          ))}
          {ayuda && <div style={{ position: 'absolute', left: '50%', bottom: 76, transform: 'translateX(-50%)', background: 'rgba(14,13,12,0.82)', borderRadius: 999, padding: '9px 14px', fontSize: 13, whiteSpace: 'nowrap', maxWidth: '92%', overflow: 'hidden', textOverflow: 'ellipsis' }}>Toca los puntos para moverte por el espacio</div>}
        </div>
        <svg width={mapa.W} height={mapa.H} style={{ position: 'absolute', right: 12, bottom: 64, background: 'rgba(0,0,0,0.45)', borderRadius: 10 }} aria-label="Plano de las vistas">
          {fotos.map((f, i) => { const [x, y] = mapa.pt(f); return (
            <g key={f.id} transform={'translate(' + x + ',' + y + ')'} style={{ cursor: 'pointer' }} onClick={() => ir(i, null)}>
              <title>{f.nombre}</title>
              {i === actual && <line x1="0" y1="0" x2={dir[0]} y2={dir[1]} stroke={ORO} strokeWidth="3" strokeLinecap="round" />}
              <circle r={i === actual ? 6 : 5} fill={i === actual ? ORO : '#fff'} stroke="#000" strokeOpacity="0.5" />
              <circle r="13" fill="transparent" />
            </g>
          ); })}
        </svg>
      </div>
      <div style={{ padding: '8px 12px 12px', display: 'flex', gap: 8, overflowX: 'auto', background: 'linear-gradient(transparent, rgba(0,0,0,0.65))', zIndex: 2 }}>
        {fotos.map((f, i) => (
          <button key={f.id} type="button" aria-current={i === actual} onClick={() => ir(i, null)} style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, background: i === actual ? ORO : 'rgba(255,255,255,0.14)', color: i === actual ? '#000' : '#fff', border: 'none', borderRadius: 20, padding: '4px 12px 4px 4px', cursor: 'pointer', fontSize: 13 }}>
            <img src={f.thumb} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />{f.nombre}
          </button>
        ))}
      </div>
      <a href={'/recorrido/' + encodeURIComponent(id) + '/' + encodeURIComponent(firma)} style={{ position: 'absolute', right: 14, top: 14, background: 'rgba(0,0,0,0.55)', color: '#fff', textDecoration: 'none', borderRadius: 20, padding: '8px 14px', fontSize: 13, zIndex: 3 }}>Caminar libremente</a>
    </div>
  );
}
