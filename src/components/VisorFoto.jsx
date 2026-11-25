import { useEffect, useRef, useState } from 'react';

// Un render a pantalla completa para el cliente: se abre ENTERO (también en el móvil, para no verlo demasiado de cerca),
// se acerca con doble toque, pellizco o rueda y, ampliado, se arrastra para recorrerlo. Con el móvil en horizontal se ve más grande.
const PANEL = 'rgba(24,20,17,0.82)', LINEA = 'rgba(255,240,220,0.16)';
export const limpiaNombreRender = n => String(n || '').replace(/(\s*·\s*v\d+)+\s*$/i, '').trim() || 'Vista';

export function VisorFoto({ fotos, inicio, onCerrar, cerrarTexto = '✕ Cerrar' }) {
  const [i, setI] = useState(inicio), [z, setZ] = useState(1), [pan, setPan] = useState([0, 0]), [ar, setAr] = useState(0), [dim, setDim] = useState({ w: innerWidth, h: innerHeight });
  const pts = useRef(new Map()), pinza = useRef(null), arr = useRef(null), ultimo = useRef(0);
  const f = fotos[i];
  const ir = d => { setI(x => (x + d + fotos.length) % fotos.length); setAr(0); setZ(1); setPan([0, 0]); };
  useEffect(() => { const k = e => { if (e.key === 'Escape') onCerrar(); else if (e.key === 'ArrowLeft') ir(-1); else if (e.key === 'ArrowRight') ir(1); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const r = () => { setDim({ w: innerWidth, h: innerHeight }); setZ(1); setPan([0, 0]); }; addEventListener('resize', r); return () => removeEventListener('resize', r); }, []);
  // el desplazamiento se limita al borde de la imagen tal como se ve (entera y luego ampliada)
  const limita = (p, zz) => {
    const W = dim.w, H = dim.h, a = ar || W / H, s = Math.min(W, H * a), iw = s * zz, ih = (s / a) * zz;
    const mx = Math.max(0, (iw - W) / 2), my = Math.max(0, (ih - H) / 2); return [Math.max(-mx, Math.min(mx, p[0])), Math.max(-my, Math.min(my, p[1]))];
  };
  const vertical = dim.h > dim.w && ar > 1.2;
  const btn = { font: '600 13px Montserrat, system-ui, sans-serif', color: '#f4ede3', background: PANEL, border: '1px solid ' + LINEA, borderRadius: 999, padding: '9px 14px', cursor: 'pointer' };
  const quieto = e => e.stopPropagation();
  return (
    <div role="dialog" aria-modal="true" aria-label={limpiaNombreRender(f.nombre)} style={{ position: 'fixed', inset: 0, background: '#0b0a09', zIndex: 50, touchAction: 'none', userSelect: 'none', fontFamily: 'Montserrat, system-ui, sans-serif' }}
      onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); pts.current.set(e.pointerId, [e.clientX, e.clientY]);
        if (pts.current.size === 2) { const [a, b] = [...pts.current.values()]; pinza.current = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z }; arr.current = null; return; }
        arr.current = { x: e.clientX, y: e.clientY, p: pan }; const t = performance.now(); if (t - ultimo.current < 300) { const nz = z > 1.3 ? 1 : 2.2; setZ(nz); setPan(nz === 1 ? [0, 0] : limita(pan, nz)); } ultimo.current = t; }}
      onPointerMove={e => { if (!pts.current.has(e.pointerId)) return; pts.current.set(e.pointerId, [e.clientX, e.clientY]);
        if (pinza.current && pts.current.size === 2) { const [a, b] = [...pts.current.values()]; const nz = Math.max(1, Math.min(4, pinza.current.z * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinza.current.d)); setZ(nz); setPan(p => limita(p, nz)); return; }
        if (arr.current && z > 1) setPan(limita([arr.current.p[0] + e.clientX - arr.current.x, arr.current.p[1] + e.clientY - arr.current.y], z)); }}
      onPointerUp={e => { e.stopPropagation(); const a = arr.current; pts.current.delete(e.pointerId); if (pts.current.size < 2) pinza.current = null; if (!pts.current.size) arr.current = null;
        if (a && z <= 1.01) { const dx = e.clientX - a.x; if (Math.abs(dx) > 60) ir(dx < 0 ? 1 : -1); } }}
      onPointerCancel={e => { pts.current.delete(e.pointerId); pinza.current = null; arr.current = null; }}
      onWheel={e => { const nz = Math.max(1, Math.min(4, z * (e.deltaY > 0 ? 0.9 : 1.1))); setZ(nz); setPan(p => limita(p, nz)); }}>
      <img src={f.url} alt={limpiaNombreRender(f.nombre)} draggable={false} onLoad={e => setAr(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', transform: `translate(${pan[0]}px, ${pan[1]}px) scale(${z})`, transition: pts.current.size ? 'none' : 'transform .25s ease-out' }} />
      <div style={{ position: 'absolute', left: 12, right: 12, top: 'calc(env(safe-area-inset-top, 0px) + 10px)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }} onPointerDown={quieto} onPointerUp={quieto}>
        <span style={{ ...btn, cursor: 'default' }}>{limpiaNombreRender(f.nombre)}</span>
        <button type="button" style={btn} onClick={onCerrar} autoFocus>{cerrarTexto}</button>
      </div>
      {vertical && z <= 1.01 && <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', marginTop: dim.w / ar / 2 + 14, textAlign: 'center', fontSize: 12, color: '#bfb3a3', pointerEvents: 'none' }}>Gira el móvil para verlo más grande · doble toque para acercar</div>}
      {fotos.length > 1 && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)', display: 'flex', justifyContent: 'center', gap: 8 }} onPointerDown={quieto} onPointerUp={quieto}>
          <button type="button" style={btn} onClick={() => ir(-1)}>‹ Anterior</button>
          <button type="button" style={btn} onClick={() => ir(1)}>Siguiente ›</button>
        </div>
      )}
    </div>
  );
}
