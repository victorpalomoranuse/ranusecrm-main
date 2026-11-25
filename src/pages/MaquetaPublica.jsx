import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../services/api';

// Maqueta del cliente: imágenes ya generadas en el CRM (la planta en 3D en modo Render, desde 4 ángulos) con un punto en cada render.
// No hay 3D en el dispositivo del cliente: solo imágenes. Al tocar un punto se abre ese render a pantalla completa, con zoom.
const ORO = '#d2ad70', FONDO = '#1a1612', PANEL = 'rgba(24,20,17,0.82)', LINEA = 'rgba(255,240,220,0.16)';
const limpiaNombre = n => String(n || '').replace(/(\s*·\s*v\d+)+\s*$/i, '').trim() || 'Vista';

export default function MaquetaPublica() {
  const { id, firma } = useParams();
  const [datos, setDatos] = useState(null), [error, setError] = useState('');
  const [vista, setVista] = useState(0), [foto, setFoto] = useState(null), [dim, setDim] = useState({ w: innerWidth, h: innerHeight });
  const [aspectos, setAspectos] = useState({});
  const toque = useRef(null);

  useEffect(() => {
    api.get('/tour-publico/' + encodeURIComponent(id) + '/' + encodeURIComponent(firma) + '?fotos=1&maqueta=1')
      .then(r => { if (!r.data.maqueta?.length) setError('Esta maqueta todavía no se ha generado.'); else setDatos(r.data); })
      .catch(e => setError(e.response?.data?.error || 'No se pudo abrir la maqueta'));
  }, [id, firma]);
  useEffect(() => { const f = () => setDim({ w: innerWidth, h: innerHeight }); addEventListener('resize', f); return () => removeEventListener('resize', f); }, []);
  // las vistas se precargan para que girar sea instantáneo
  useEffect(() => { (datos?.maqueta || []).forEach(v => { const i = new Image(); i.onload = () => setAspectos(a => ({ ...a, [v.id]: i.naturalWidth / i.naturalHeight })); i.src = v.url; }); }, [datos]);

  if (error) return <div style={{ position: 'fixed', inset: 0, background: FONDO, color: '#f4ede3', display: 'grid', placeItems: 'center', fontFamily: 'Montserrat, system-ui, sans-serif', padding: 24, textAlign: 'center' }}>{error}</div>;
  if (!datos) return <div style={{ position: 'fixed', inset: 0, background: FONDO, color: '#bfb3a3', display: 'grid', placeItems: 'center', fontFamily: 'Montserrat, system-ui, sans-serif' }}>Cargando la maqueta…</div>;

  const vistas = datos.maqueta, v = vistas[vista % vistas.length], fotos = datos.fotos || [];
  const ar = aspectos[v.id] || 1.6, mg = 8;
  // la imagen ocupa todo lo posible: casi sin márgenes
  const w = Math.min(dim.w - mg * 2, (dim.h - mg * 2) * ar), h = w / ar;
  const gira = d => setVista(i => (i + d + vistas.length) % vistas.length);
  const btn = { font: '600 13px Montserrat, system-ui, sans-serif', color: '#f4ede3', background: PANEL, border: '1px solid ' + LINEA, borderRadius: 999, padding: '9px 14px', cursor: 'pointer', backdropFilter: 'blur(8px)' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: FONDO, color: '#f4ede3', fontFamily: 'Montserrat, system-ui, sans-serif', overflow: 'hidden', touchAction: 'none', userSelect: 'none' }}
      onPointerDown={e => { toque.current = { x: e.clientX, t: performance.now() }; }}
      onPointerUp={e => { const t = toque.current; toque.current = null; if (!t || foto) return; const dx = e.clientX - t.x; if (Math.abs(dx) > 50 && performance.now() - t.t < 700) gira(dx < 0 ? 1 : -1); }}>
      <style>{'@keyframes mq-latido{from{transform:scale(1);opacity:.9}to{transform:scale(2.6);opacity:0}}'}</style>
      <div style={{ position: 'absolute', left: (dim.w - w) / 2, top: (dim.h - h) / 2, width: w, height: h }}>
        {vistas.map((x, i) => <img key={x.id} src={x.url} alt={i === vista ? 'Maqueta del proyecto' : ''} draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: i === vista ? 1 : 0, transition: 'opacity .5s' }} />)}
        {v.pines.map(p => {
          const f = fotos.find(q => q.id === p.id); if (!f) return null;
          return (
            <button key={p.id} type="button" onClick={() => setFoto(fotos.indexOf(f))} aria-label={'Ver ' + limpiaNombre(f.nombre)}
              style={{ position: 'absolute', left: p.x * 100 + '%', top: p.y * 100 + '%', transform: 'translate(-50%,-100%)', background: 'none', border: 0, padding: 0, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, color: '#f4ede3' }}>
              <span style={{ font: '600 11px Montserrat, system-ui, sans-serif', background: PANEL, border: '1px solid ' + LINEA, borderRadius: 999, padding: '4px 9px', whiteSpace: 'nowrap' }}>{limpiaNombre(f.nombre)}</span>
              <span style={{ position: 'relative', width: 14, height: 14, borderRadius: '50%', background: ORO, boxShadow: '0 0 0 4px rgba(210,173,112,.28), 0 0 16px rgba(210,173,112,.8)' }}>
                <span style={{ position: 'absolute', inset: -4, borderRadius: '50%', border: '2px solid ' + ORO, animation: 'mq-latido 2.2s ease-out infinite' }} />
              </span>
            </button>
          );
        })}
      </div>
      <div style={{ position: 'absolute', left: 12, top: 'calc(env(safe-area-inset-top, 0px) + 10px)', fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: ORO, fontWeight: 600, textShadow: '0 1px 6px rgba(0,0,0,.6)', pointerEvents: 'none' }}>Ranuse Design · {datos.titulo}</div>
      {vistas.length > 1 && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)', display: 'flex', justifyContent: 'center', gap: 8 }}>
          <button type="button" style={btn} onClick={() => gira(-1)} aria-label="Girar la maqueta a la izquierda">⟲ Girar</button>
          <button type="button" style={btn} onClick={() => gira(1)} aria-label="Girar la maqueta a la derecha">Girar ⟳</button>
        </div>
      )}
      {foto != null && <VisorFoto fotos={fotos} inicio={foto} onCerrar={() => setFoto(null)} />}
    </div>
  );
}

// El render a pantalla completa: se ve entero, se acerca con doble toque, pellizco o rueda y se arrastra para recorrerlo
function VisorFoto({ fotos, inicio, onCerrar }) {
  const [i, setI] = useState(inicio), [z, setZ] = useState(1), [pan, setPan] = useState([0, 0]), [ar, setAr] = useState(0);
  const pts = useRef(new Map()), pinza = useRef(null), arr = useRef(null), ultimo = useRef(0);
  const f = fotos[i];
  // en vertical el render se abre llenando la pantalla a lo alto (se desliza a los lados); en horizontal se ve entero
  const zLlena = a => (a ? Math.max(1, Math.min(4, (innerHeight / innerWidth) * a)) : 1);
  const zInicio = a => (innerHeight > innerWidth ? zLlena(a) : 1);
  const ir = d => { setI(x => (x + d + fotos.length) % fotos.length); setAr(0); setZ(1); setPan([0, 0]); };
  useEffect(() => { const k = e => { if (e.key === 'Escape') onCerrar(); else if (e.key === 'ArrowLeft') ir(-1); else if (e.key === 'ArrowRight') ir(1); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }); // eslint-disable-line react-hooks/exhaustive-deps
  // el desplazamiento se limita al borde de la imagen tal como se ve (entera y luego ampliada)
  const limita = (p, zz) => {
    const W = innerWidth, H = innerHeight, a = ar || W / H, s = Math.min(W, H * a), iw = s * zz, ih = (s / a) * zz;
    const mx = Math.max(0, (iw - W) / 2), my = Math.max(0, (ih - H) / 2); return [Math.max(-mx, Math.min(mx, p[0])), Math.max(-my, Math.min(my, p[1]))];
  };
  const btn = { font: '600 13px Montserrat, system-ui, sans-serif', color: '#f4ede3', background: PANEL, border: '1px solid ' + LINEA, borderRadius: 999, padding: '9px 14px', cursor: 'pointer' };
  return (
    <div role="dialog" aria-modal="true" aria-label={limpiaNombre(f.nombre)} style={{ position: 'fixed', inset: 0, background: '#0b0a09', zIndex: 20, touchAction: 'none' }}
      onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); pts.current.set(e.pointerId, [e.clientX, e.clientY]);
        if (pts.current.size === 2) { const [a, b] = [...pts.current.values()]; pinza.current = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z }; arr.current = null; return; }
        arr.current = { x: e.clientX, y: e.clientY, p: pan }; const t = performance.now(); if (t - ultimo.current < 300) { const zi = zInicio(ar), nz = z > zi + 0.3 ? zi : Math.max(2.2, zi * 1.8); setZ(nz); setPan(p => limita(p, nz)); } ultimo.current = t; }}
      onPointerMove={e => { if (!pts.current.has(e.pointerId)) return; pts.current.set(e.pointerId, [e.clientX, e.clientY]);
        if (pinza.current && pts.current.size === 2) { const [a, b] = [...pts.current.values()]; const nz = Math.max(1, Math.min(4, pinza.current.z * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinza.current.d)); setZ(nz); setPan(p => limita(p, nz)); return; }
        if (arr.current) setPan(limita([arr.current.p[0] + e.clientX - arr.current.x, arr.current.p[1] + e.clientY - arr.current.y], z)); }}
      onPointerUp={e => { e.stopPropagation(); const a = arr.current; pts.current.delete(e.pointerId); if (pts.current.size < 2) pinza.current = null; if (!pts.current.size) arr.current = null;
        if (a && z <= zInicio(ar) + 0.01 && limita([1e6, 0], z)[0] < 1) { const dx = e.clientX - a.x; if (Math.abs(dx) > 60) ir(dx < 0 ? 1 : -1); } }}
      onPointerCancel={e => { pts.current.delete(e.pointerId); pinza.current = null; arr.current = null; }}
      onWheel={e => { const nz = Math.max(1, Math.min(4, z * (e.deltaY > 0 ? 0.9 : 1.1))); setZ(nz); setPan(p => limita(p, nz)); }}>
      <img src={f.url} alt={limpiaNombre(f.nombre)} draggable={false} onLoad={e => { const a = e.currentTarget.naturalWidth / e.currentTarget.naturalHeight; setAr(a); setZ(zInicio(a)); setPan([0, 0]); }} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', transform: `translate(${pan[0]}px, ${pan[1]}px) scale(${z})`, transition: pts.current.size ? 'none' : 'transform .25s ease-out' }} />
      <div style={{ position: 'absolute', left: 12, right: 12, top: 'calc(env(safe-area-inset-top, 0px) + 10px)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }} onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()}>
        <span style={{ ...btn, cursor: 'default' }}>{limpiaNombre(f.nombre)}</span>
        <button type="button" style={btn} onClick={onCerrar} autoFocus>✕ Maqueta</button>
      </div>
      {fotos.length > 1 && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)', display: 'flex', justifyContent: 'center', gap: 8 }} onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()}>
          <button type="button" style={btn} onClick={() => ir(-1)}>‹ Anterior</button>
          <button type="button" style={btn} onClick={() => ir(1)}>Siguiente ›</button>
        </div>
      )}
    </div>
  );
}
