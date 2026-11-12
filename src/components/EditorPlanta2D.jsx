import { useEffect, useMemo, useRef, useState } from 'react';

// Editor 2D ligero de la planta del techo y del suelo de una sala. Se dibuja con SVG (nada de 3D en esta vista: no se traba) y lo que se hace
// se ve a la vez en el modelo 3D de al lado.
//  · Techo: formas (rectángulo, óvalo, polígono) que quedan más abajo o más arriba del techo (± cm), con color y luz en el borde por lados.
//  · Suelo: zonas con su color o material.
const AZUL = '#1b6dd6';
const enPoli = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
const caja = pts => { const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; };
const hexOk = v => /^#[0-9a-fA-F]{6}$/.test(v || '');

export default function EditorPlanta2D({ tipo, sala, planta, off, objs, setObjs, texturas, colorPincel, onClose, btn }) {
  const esTecho = tipo === 'techo';
  const [ox, oy] = off, z = planta.z || 0, H = planta.altura || 260;
  const svgRef = useRef(null), contRef = useRef(null);
  const [herr, setHerr] = useState('sel');              // sel | rect | oval | poli | mano
  const [iman, setImanE] = useState(true), [paso, setPaso] = useState(5);
  const [selId, setSelId] = useState(null);
  const [vista, setVista] = useState(null);             // { x, y, w } en cm; el alto sale del aspecto
  const [tam, setTam] = useState({ w: 800, h: 600 });
  const [dib, setDib] = useState(null);                 // forma que se está dibujando { a, b } o { pts, cur }
  const accion = useRef(null);                          // arrastre en curso (mover, escalar, panear)

  const bb = useMemo(() => caja(sala.pts), [sala]);
  // vista inicial: ajustada a la sala
  useEffect(() => {
    const m = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) * 0.08 + 40;
    setVista(v => v || { x: bb.x0 - m, y: bb.y0 - m, w: bb.x1 - bb.x0 + 2 * m, ajusta: true });
  }, [bb]);
  useEffect(() => {
    const el = contRef.current; if (!el) return undefined;
    const f = () => setTam({ w: el.clientWidth || 800, h: el.clientHeight || 600 }); f();
    const ro = new ResizeObserver(f); ro.observe(el); return () => ro.disconnect();
  }, []);
  const asp = tam.h / Math.max(1, tam.w);
  const V = vista ? { x: vista.x, y: vista.y, w: vista.w, h: vista.w * asp } : { x: 0, y: 0, w: 1000, h: 1000 * asp };
  const encaja = () => { const m = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) * 0.08 + 40, w0 = bb.x1 - bb.x0 + 2 * m, h0 = bb.y1 - bb.y0 + 2 * m, w = Math.max(w0, h0 / asp); setVista({ x: (bb.x0 + bb.x1) / 2 - w / 2, y: (bb.y0 + bb.y1) / 2 - (w * asp) / 2, w }); };
  useEffect(() => { if (vista?.ajusta && tam.w > 10) { const m = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) * 0.08 + 40, w0 = bb.x1 - bb.x0 + 2 * m, h0 = bb.y1 - bb.y0 + 2 * m, w = Math.max(w0, h0 / asp); setVista({ x: (bb.x0 + bb.x1) / 2 - w / 2, y: (bb.y0 + bb.y1) / 2 - (w * asp) / 2, w }); } }, [tam.w, tam.h]); // eslint-disable-line react-hooks/exhaustive-deps
  const px = V.w / Math.max(1, tam.w); // cm por píxel

  // formas de esta sala y de esta planta
  const items = useMemo(() => objs.filter(o => (esTecho ? o.tipo === 'falsotecho' : (o.tipo === 'zona' && o.plano === 'suelo' && !o.guia)) && Array.isArray(o.pts) && o.pts.length >= 3 && Math.abs((o.z0 || 0) - z) <= 1
    && o.cx - ox >= bb.x0 - 120 && o.cx - ox <= bb.x1 + 120 && o.cy - oy >= bb.y0 - 120 && o.cy - oy <= bb.y1 + 120), [objs, esTecho, z, ox, oy, bb]);
  const abs = o => o.pts.map(p => [p[0] + o.cx - ox, p[1] + o.cy - oy]);
  const sel = items.find(o => o.id === selId) || null;

  const aCm = e => { const r = svgRef.current.getBoundingClientRect(); return [V.x + ((e.clientX - r.left) / r.width) * V.w, V.y + ((e.clientY - r.top) / r.height) * V.h]; };
  const ajusta = v => (iman ? Math.round(v / paso) * paso : Math.round(v * 10) / 10);
  const pAj = p => [ajusta(p[0]), ajusta(p[1])];

  const poneForma = (id, pts) => { // pts absolutos (cm de la planta) → el objeto guarda centro global y puntos relativos
    const c = caja(pts), cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2;
    setObjs(prev => prev.map(o => (o.id === id ? { ...o, cx: Math.round((cx + ox) * 10) / 10, cy: Math.round((cy + oy) * 10) / 10, w: Math.round(c.x1 - c.x0), d: Math.round(c.y1 - c.y0), pts: pts.map(p => [Math.round((p[0] - cx) * 10) / 10, Math.round((p[1] - cy) * 10) / 10]) } : o)));
  };
  const cambia = (id, c) => setObjs(prev => prev.map(o => (o.id === id ? { ...o, ...(typeof c === 'function' ? c(o) : c) } : o)));
  const nuevaForma = (pts, nombre) => {
    const c = caja(pts), cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2, id = 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const rel = pts.map(p => [Math.round((p[0] - cx) * 10) / 10, Math.round((p[1] - cy) * 10) / 10]);
    const base = { id, nombre, rot: 0, cx: Math.round((cx + ox) * 10) / 10, cy: Math.round((cy + oy) * 10) / 10, w: Math.round(c.x1 - c.x0), d: Math.round(c.y1 - c.y0), alto: 1, pts: rel };
    const o = esTecho
      ? { ...base, tipo: 'falsotecho', etiqueta: 'Techos', z0: z, h: H, color: '#f6f4f1', ft: { descenso: 10, gap: 3, luz: false, k: 3000 } }
      : { ...base, tipo: 'zona', plano: 'suelo', etiqueta: 'Zonas', z0: z, color: hexOk(colorPincel) ? colorPincel : '#c9b9a0' };
    setObjs(prev => [...prev, o]); setSelId(id); setHerr('sel');
  };
  const oval = (a, b) => Array.from({ length: 40 }, (_, i) => [(a[0] + b[0]) / 2 + (Math.abs(b[0] - a[0]) / 2) * Math.cos((i / 40) * 2 * Math.PI), (a[1] + b[1]) / 2 + (Math.abs(b[1] - a[1]) / 2) * Math.sin((i / 40) * 2 * Math.PI)]);
  const rect = (a, b) => [[Math.min(a[0], b[0]), Math.min(a[1], b[1])], [Math.max(a[0], b[0]), Math.min(a[1], b[1])], [Math.max(a[0], b[0]), Math.max(a[1], b[1])], [Math.min(a[0], b[0]), Math.max(a[1], b[1])]];
  const cierraPoli = pts => { if (pts.length >= 3) nuevaForma(pts, esTecho ? 'Forma de techo' : 'Zona de suelo'); setDib(null); };
  const borra = id => { setObjs(prev => prev.filter(o => o.id !== id)); setSelId(null); };

  // ── ratón
  const abajo = e => {
    if (e.button === 1 || e.button === 2 || herr === 'mano' || e.shiftKey && herr === 'sel' && false) { accion.current = { tipo: 'pan', x: e.clientX, y: e.clientY, v: { ...V } }; svgRef.current.setPointerCapture(e.pointerId); e.preventDefault(); return; }
    if (e.button !== 0) return;
    const p = pAj(aCm(e));
    if (herr === 'rect' || herr === 'oval') { setDib({ a: p, b: p }); accion.current = { tipo: 'dib' }; svgRef.current.setPointerCapture(e.pointerId); return; }
    if (herr === 'poli') {
      const pts = dib?.pts || [];
      if (pts.length >= 3 && Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) < 12 * px) { cierraPoli(pts); return; }
      setDib({ pts: [...pts, p], cur: p }); return;
    }
  };
  const abajoForma = (e, o) => {
    if (herr !== 'sel' || e.button !== 0) return;
    e.stopPropagation(); setSelId(o.id);
    accion.current = { tipo: 'mueve', id: o.id, p0: aCm(e), cx0: o.cx, cy0: o.cy }; svgRef.current.setPointerCapture(e.pointerId);
  };
  const abajoAsa = (e, ix, iy) => { // asas: iy/ix ∈ {0, .5, 1} = posición dentro de la caja
    e.stopPropagation(); if (!sel) return;
    accion.current = { tipo: 'escala', id: sel.id, ix, iy, pts0: abs(sel), c0: caja(abs(sel)) }; svgRef.current.setPointerCapture(e.pointerId);
  };
  const mueve = e => {
    const a = accion.current;
    if (a?.tipo === 'pan') { const dx = (e.clientX - a.x) * (a.v.w / tam.w), dy = (e.clientY - a.y) * (a.v.w / tam.w); setVista({ x: a.v.x - dx, y: a.v.y - dy, w: a.v.w }); return; }
    if (a?.tipo === 'dib') { setDib(d => (d ? { ...d, b: pAj(aCm(e)) } : d)); return; }
    if (a?.tipo === 'mueve') { const p = aCm(e), dx = ajusta(p[0] - a.p0[0]), dy = ajusta(p[1] - a.p0[1]); cambia(a.id, { cx: Math.round((a.cx0 + dx) * 10) / 10, cy: Math.round((a.cy0 + dy) * 10) / 10 }); return; }
    if (a?.tipo === 'escala') {
      const p = pAj(aCm(e)), c = a.c0; let { x0, x1, y0, y1 } = c;
      if (a.ix === 0) x0 = Math.min(p[0], x1 - 5); else if (a.ix === 1) x1 = Math.max(p[0], x0 + 5);
      if (a.iy === 0) y0 = Math.min(p[1], y1 - 5); else if (a.iy === 1) y1 = Math.max(p[1], y0 + 5);
      const kx = (x1 - x0) / Math.max(1, c.x1 - c.x0), ky = (y1 - y0) / Math.max(1, c.y1 - c.y0);
      poneForma(a.id, a.pts0.map(q => [x0 + (q[0] - c.x0) * kx, y0 + (q[1] - c.y0) * ky]));
      return;
    }
    if (herr === 'poli' && dib?.pts) setDib(d => ({ ...d, cur: pAj(aCm(e)) }));
  };
  const arriba = e => {
    const a = accion.current; accion.current = null;
    try { svgRef.current.releasePointerCapture(e.pointerId); } catch { /* ya suelto */ }
    if (a?.tipo === 'dib' && dib) {
      const w = Math.abs(dib.b[0] - dib.a[0]), h = Math.abs(dib.b[1] - dib.a[1]);
      if (w >= 5 && h >= 5) nuevaForma(herr === 'oval' ? oval(dib.a, dib.b) : rect(dib.a, dib.b), esTecho ? (herr === 'oval' ? 'Falso techo redondo' : 'Falso techo') : (herr === 'oval' ? 'Zona redonda' : 'Zona de suelo'));
      setDib(null);
    }
  };
  const rueda = e => {
    e.preventDefault(); const r = svgRef.current.getBoundingClientRect(), k = e.deltaY > 0 ? 1.15 : 1 / 1.15, w = Math.max(60, Math.min(20000, V.w * k));
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height, cx = V.x + fx * V.w, cy = V.y + fy * V.h;
    setVista({ x: cx - fx * w, y: cy - fy * (w * asp), w });
  };
  useEffect(() => { const el = svgRef.current; if (!el) return undefined; el.addEventListener('wheel', rueda, { passive: false }); return () => el.removeEventListener('wheel', rueda); });
  // teclas (se atienden aquí y no llegan al visor 3D)
  useEffect(() => {
    const k = e => {
      const t = (e.target?.tagName || '').toLowerCase(); if (t === 'input' || t === 'textarea' || t === 'select') return;
      if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); if (dib) setDib(null); else if (herr !== 'sel') setHerr('sel'); else if (selId) setSelId(null); else onClose(); }
      else if (e.key === 'Enter' && herr === 'poli' && dib?.pts) { e.stopImmediatePropagation(); cierraPoli(dib.pts); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selId && !dib) { e.stopImmediatePropagation(); e.preventDefault(); borra(selId); }
      else if (e.key === 'Backspace' && dib?.pts) { e.stopImmediatePropagation(); e.preventDefault(); setDib(d => (d.pts.length > 1 ? { ...d, pts: d.pts.slice(0, -1) } : null)); }
    };
    window.addEventListener('keydown', k, true); return () => window.removeEventListener('keydown', k, true);
  });

  // ── dibujo
  const colorForma = o => { const v = o.color; if (v && String(v).startsWith('tex:')) { const t = texturas.find(x => 'tex:' + x.id === v); return t?.color || '#c9b9a0'; } return hexOk(v) ? v : (esTecho ? '#f6f4f1' : '#c9b9a0'); };
  const texFill = o => { const v = o.color; if (v && String(v).startsWith('tex:')) { const t = texturas.find(x => 'tex:' + x.id === v); return t || null; } return null; };
  const lineaLuz = o => {
    if (!esTecho || o.ft?.luz === false) return null;
    const P = abs(o), c = P.reduce((q, p) => [q[0] + p[0] / P.length, q[1] + p[1] / P.length], [0, 0]), LD = o.ft?.lados || {}, col = hexOk(o.ft?.colorLuz) ? o.ft.colorLuz : '#ffb347';
    return P.map((p, i) => { const q = P[(i + 1) % P.length], dx = (p[0] + q[0]) / 2 - c[0], dy = (p[1] + q[1]) / 2 - c[1], lado = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'o') : (dy > 0 ? 's' : 'n'); return LD[lado] === false ? null : <line key={i} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke={col} strokeWidth={4 * px} strokeLinecap="round" />; });
  };
  const etiqueta = o => { if (!esTecho) return o.nombre || 'Zona'; const d = o.ft?.descenso ?? 10; return d > 0 ? '−' + d + ' cm' : d < 0 ? '+' + (-d) + ' cm' : '0 cm'; };
  const sz = (n) => n * px;
  const caja1 = sel ? caja(abs(sel)) : null;
  const asas = caja1 ? [[0, 0], [.5, 0], [1, 0], [0, .5], [1, .5], [0, 1], [.5, 1], [1, 1]].map(([fx, fy]) => ({ fx, fy, x: caja1.x0 + fx * (caja1.x1 - caja1.x0), y: caja1.y0 + fy * (caja1.y1 - caja1.y0), ix: fx === .5 ? null : fx, iy: fy === .5 ? null : fy })) : [];
  const medidaDib = dib?.a ? Math.round(Math.abs(dib.b[0] - dib.a[0])) + ' × ' + Math.round(Math.abs(dib.b[1] - dib.a[1])) + ' cm' : '';

  const lbl = { fontSize: 12, opacity: 0.7, marginBottom: 3 };
  const fila = { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 };
  const Hb = (id, txt, tit) => <button key={id} title={tit} onClick={() => { setHerr(id); setDib(null); }} style={{ ...btn, padding: '6px 10px', fontWeight: 600, ...(herr === id ? { background: '#2f6fa8' } : {}) }}>{txt}</button>;

  return (
    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 'min(74vw, 1100px)', background: '#f4f2ee', color: '#111', zIndex: 14, display: 'flex', flexDirection: 'column', boxShadow: '4px 0 24px rgba(0,0,0,0.35)', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: '#1c1c1c', color: '#fff', padding: '8px 12px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
        <b style={{ fontSize: 14 }}>{esTecho ? '⬒ Planta del techo' : '⬓ Planta del suelo'} · {sala.nombre || 'Sala'}</b>
        <span style={{ width: 1, height: 22, background: '#444' }} />
        {Hb('sel', '↖ Seleccionar', 'Pulsa una forma para elegirla, arrástrala para moverla y tira de los cuadritos para cambiar su tamaño')}
        {Hb('rect', '▭ Rectángulo', 'Arrastra de una esquina a la opuesta')}
        {Hb('oval', '◯ Óvalo / círculo', 'Arrastra de una esquina a la opuesta')}
        {Hb('poli', '⬠ Polígono', 'Clic en cada esquina; Enter o clic en el primer punto para cerrar')}
        {Hb('mano', '✋ Mover vista', 'Arrastra para desplazar el plano (también con el botón central del ratón)')}
        <span style={{ width: 1, height: 22, background: '#444' }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}><input type="checkbox" checked={iman} onChange={e => setImanE(e.target.checked)} />Imán</label>
        <select value={paso} onChange={e => setPaso(parseFloat(e.target.value))} style={{ ...btn, padding: '3px 4px' }}><option value="1">1 cm</option><option value="5">5 cm</option><option value="10">10 cm</option><option value="25">25 cm</option></select>
        <button style={btn} onClick={encaja} title="Ver la sala entera">⛶ Ajustar</button>
        <span style={{ flex: 1 }} />
        <button style={{ ...btn, background: '#7a2b2b' }} onClick={onClose}>Cerrar (Esc)</button>
      </div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div ref={contRef} style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <svg ref={svgRef} width="100%" height="100%" viewBox={V.x + ' ' + V.y + ' ' + V.w + ' ' + V.h} onPointerDown={abajo} onPointerMove={mueve} onPointerUp={arriba} onContextMenu={e => e.preventDefault()}
            style={{ display: 'block', touchAction: 'none', cursor: herr === 'mano' ? 'grab' : herr === 'sel' ? 'default' : 'crosshair', userSelect: 'none' }}>
            <defs>{items.map(o => { const t = texFill(o); return t ? <pattern key={o.id} id={'tx' + o.id} patternUnits="userSpaceOnUse" width={t.tam} height={t.tamH || t.tam}><image href={t.url} width={t.tam} height={t.tamH || t.tam} preserveAspectRatio="none" /></pattern> : null; })}</defs>
            {/* los demás muros, de fondo */}
            {(planta.muros || []).map((m, i) => <line key={i} x1={m.a[0]} y1={m.a[1]} x2={m.b[0]} y2={m.b[1]} stroke="#b9b4ab" strokeWidth={Math.max(sz(1.2), m.t || 12)} strokeLinecap="butt" />)}
            <polygon points={sala.pts.map(p => p.join(',')).join(' ')} fill="#ffffff" stroke="#3a3632" strokeWidth={sz(2)} />
            {(planta.equipos || []).filter(q => !q.cesped).map((q, i) => <rect key={i} x={-(q.w || 60) / 2} y={-(q.d || 60) / 2} width={q.w || 60} height={q.d || 60} fill={esTecho ? '#eceae6' : '#dedbd5'} stroke="#cfcbc4" strokeWidth={sz(0.8)} transform={'translate(' + q.cx + ' ' + q.cy + ') rotate(' + (q.rot || 0) + ')'} />)}
            {items.map(o => { const P = abs(o), t = texFill(o), c = caja(P); return (
              <g key={o.id} onPointerDown={e => abajoForma(e, o)} style={{ cursor: herr === 'sel' ? 'move' : undefined }}>
                <polygon points={P.map(p => p.join(',')).join(' ')} fill={t ? 'url(#tx' + o.id + ')' : colorForma(o)} fillOpacity={esTecho ? 0.92 : 1} stroke={o.id === selId ? AZUL : '#6b6560'} strokeWidth={o.id === selId ? sz(2.5) : sz(1.2)} />
                {lineaLuz(o)}
                <text x={(c.x0 + c.x1) / 2} y={(c.y0 + c.y1) / 2} fontSize={sz(13)} textAnchor="middle" dominantBaseline="middle" fill="#111" stroke="#fff" strokeWidth={sz(3)} paintOrder="stroke" style={{ pointerEvents: 'none' }}>{etiqueta(o)}</text>
              </g>); })}
            {dib?.a && (herr === 'oval' ? <polygon points={oval(dib.a, dib.b).map(p => p.join(',')).join(' ')} fill={AZUL} fillOpacity=".15" stroke={AZUL} strokeWidth={sz(2)} /> : <polygon points={rect(dib.a, dib.b).map(p => p.join(',')).join(' ')} fill={AZUL} fillOpacity=".15" stroke={AZUL} strokeWidth={sz(2)} />)}
            {dib?.a && <text x={(dib.a[0] + dib.b[0]) / 2} y={Math.min(dib.a[1], dib.b[1]) - sz(8)} fontSize={sz(13)} textAnchor="middle" fill="#0b3d91" stroke="#fff" strokeWidth={sz(3)} paintOrder="stroke">{medidaDib}</text>}
            {dib?.pts && <><polyline points={[...dib.pts, dib.cur || dib.pts[dib.pts.length - 1]].map(p => p.join(',')).join(' ')} fill="none" stroke={AZUL} strokeWidth={sz(2)} />{dib.pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={sz(i === 0 ? 6 : 4)} fill={i === 0 ? '#fff' : AZUL} stroke={AZUL} strokeWidth={sz(1.5)} />)}</>}
            {sel && herr === 'sel' && asas.map((a, i) => <rect key={i} x={a.x - sz(5)} y={a.y - sz(5)} width={sz(10)} height={sz(10)} fill="#fff" stroke={AZUL} strokeWidth={sz(1.5)} style={{ cursor: (a.ix == null ? 'ns' : a.iy == null ? 'ew' : (a.ix === a.iy ? 'nwse' : 'nesw')) + '-resize' }} onPointerDown={e => abajoAsa(e, a.ix, a.iy)} />)}
          </svg>
          <div style={{ position: 'absolute', left: 10, bottom: 8, fontSize: 12, background: 'rgba(255,255,255,0.85)', borderRadius: 8, padding: '4px 10px', pointerEvents: 'none', color: '#333' }}>
            {herr === 'sel' ? 'Pulsa una forma para elegirla · arrástrala para moverla · tira de los cuadritos para el tamaño · Supr la borra' : herr === 'poli' ? 'Clic en cada esquina · Enter o clic en el primer punto cierra · Retroceso borra el último' : herr === 'mano' ? 'Arrastra para mover el plano' : 'Arrastra de una esquina a la opuesta'} · Rueda = zoom
          </div>
        </div>
        <div style={{ width: 290, background: '#1c1c1c', color: '#fff', padding: 12, overflowY: 'auto', fontSize: 13 }}>
          {!sel ? (
            <>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{esTecho ? 'Formas del techo' : 'Zonas del suelo'}</div>
              <div style={{ opacity: 0.65, lineHeight: 1.45, marginBottom: 10 }}>{esTecho ? 'Dibuja un rectángulo, óvalo o polígono: es una forma en el techo. Luego le pones cuántos cm queda por debajo o por encima del techo, su color y su luz.' : 'Dibuja una zona y dale un color o un material.'}</div>
              {!items.length && <div style={{ opacity: 0.5 }}>Todavía no hay ninguna. Elige una herramienta arriba y dibuja sobre el plano.</div>}
              {items.map(o => <div key={o.id} onClick={() => { setSelId(o.id); setHerr('sel'); }} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: '#2a2a2a', borderRadius: 6, marginBottom: 4, cursor: 'pointer' }}><span style={{ width: 16, height: 16, borderRadius: 3, background: colorForma(o), border: '1px solid #666' }} /><span style={{ flex: 1 }}>{o.nombre || 'Forma'}</span><span style={{ opacity: 0.6 }}>{esTecho ? etiqueta(o) : ''}</span></div>)}
            </>
          ) : esTecho ? (
            <>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>{sel.nombre || 'Forma de techo'}</div>
              <div style={lbl}>Altura respecto al techo (cm)</div>
              <div style={fila}>
                <button style={btn} onClick={() => cambia(sel.id, o => ({ ft: { ...o.ft, descenso: (o.ft?.descenso ?? 10) + 5 } }))} title="Baja 5 cm">▼ 5</button>
                <input type="number" step="1" value={-(sel.ft?.descenso ?? 10)} onChange={e => cambia(sel.id, o => ({ ft: { ...o.ft, descenso: -(parseFloat(e.target.value) || 0) } }))} style={{ ...btn, width: 70, textAlign: 'center' }} />
                <button style={btn} onClick={() => cambia(sel.id, o => ({ ft: { ...o.ft, descenso: (o.ft?.descenso ?? 10) - 5 } }))} title="Sube 5 cm">▲ 5</button>
              </div>
              <div style={{ opacity: 0.6, fontSize: 12, marginBottom: 10 }}>{(sel.ft?.descenso ?? 10) > 0 ? (sel.ft?.descenso ?? 10) + ' cm por DEBAJO del techo' : (sel.ft?.descenso ?? 10) < 0 ? -(sel.ft?.descenso ?? 10) + ' cm por ENCIMA del techo (el techo se abre y sube)' : 'a la altura del techo'}</div>
              <div style={lbl}>Color</div>
              <div style={fila}><input type="color" value={hexOk(sel.color) ? sel.color : '#f6f4f1'} onChange={e => cambia(sel.id, { color: e.target.value })} style={{ width: 44, height: 30, padding: 0, border: '1px solid #666', borderRadius: 4 }} />
                {['#ffffff', '#f6f4f1', '#9a9a9a', '#2b2b2b', '#7a1f1f', '#1f3a5c'].map(h => <span key={h} onClick={() => cambia(sel.id, { color: h })} style={{ width: 22, height: 22, borderRadius: 11, background: h, border: '2px solid ' + (sel.color === h ? '#fff' : '#555'), cursor: 'pointer' }} />)}</div>
              <label style={{ ...fila, cursor: 'pointer' }}><input type="checkbox" checked={sel.ft?.luz !== false} onChange={e => cambia(sel.id, o => ({ ft: { ...o.ft, luz: e.target.checked } }))} /><b>Luz en el borde</b></label>
              {sel.ft?.luz !== false && (
                <div style={{ marginLeft: 4, marginBottom: 8 }}>
                  <div style={lbl}>En qué lados (como se ve en el plano)</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 6 }}>
                    {[['n', '↑ Arriba'], ['s', '↓ Abajo'], ['o', '← Izquierda'], ['e', '→ Derecha']].map(([k, n]) => <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}><input type="checkbox" checked={(sel.ft?.lados || {})[k] !== false} onChange={e => cambia(sel.id, o => ({ ft: { ...o.ft, lados: { n: true, s: true, e: true, o: true, ...(o.ft?.lados || {}), [k]: e.target.checked } } }))} />{n}</label>)}
                  </div>
                  <div style={fila}><span style={{ width: 90 }}>Color de la luz</span><input type="color" value={hexOk(sel.ft?.colorLuz) ? sel.ft.colorLuz : '#ffd9a0'} onChange={e => cambia(sel.id, o => ({ ft: { ...o.ft, colorLuz: e.target.value } }))} style={{ width: 40, height: 26, padding: 0, border: '1px solid #666', borderRadius: 4 }} />
                    <span onClick={() => cambia(sel.id, o => { const { colorLuz, ...r } = o.ft || {}; return { ft: r }; })} style={{ cursor: 'pointer', opacity: 0.65, fontSize: 11 }}>blanca</span></div>
                  <div style={fila}><span style={{ width: 90 }}>Foseado (cm)</span><input type="number" min="2" step="1" value={sel.ft?.gap ?? 3} onChange={e => cambia(sel.id, o => ({ ft: { ...o.ft, gap: Math.max(2, parseFloat(e.target.value) || 3) } }))} style={{ ...btn, width: 60 }} /></div>
                </div>
              )}
              <div style={{ ...lbl, marginTop: 6 }}>Medidas: {Math.round(sel.w)} × {Math.round(sel.d)} cm</div>
              <button style={{ ...btn, background: '#7a2b2b', width: '100%', marginTop: 8 }} onClick={() => borra(sel.id)}>🗑 Borrar esta forma</button>
              <button style={{ ...btn, width: '100%', marginTop: 6 }} onClick={() => setSelId(null)}>← Volver a la lista</button>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>{sel.nombre || 'Zona de suelo'}</div>
              <div style={lbl}>Color</div>
              <div style={fila}><input type="color" value={hexOk(sel.color) ? sel.color : '#c9b9a0'} onChange={e => cambia(sel.id, { color: e.target.value })} style={{ width: 44, height: 30, padding: 0, border: '1px solid #666', borderRadius: 4 }} />
                {hexOk(colorPincel) && <span onClick={() => cambia(sel.id, { color: colorPincel })} style={{ cursor: 'pointer', fontSize: 11, opacity: 0.75 }}>usar el color elegido en Materiales</span>}</div>
              <div style={lbl}>O un material</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4, marginBottom: 10 }}>
                {texturas.filter(t => t.url).map(t => <img key={t.id} src={t.url} alt={t.nombre} title={t.nombre} onClick={() => cambia(sel.id, { color: 'tex:' + t.id })} style={{ width: '100%', height: 36, objectFit: 'cover', borderRadius: 4, cursor: 'pointer', border: sel.color === 'tex:' + t.id ? '2px solid #1b6dd6' : '2px solid transparent' }} />)}
              </div>
              <div style={lbl}>Medidas: {Math.round(sel.w)} × {Math.round(sel.d)} cm</div>
              <button style={{ ...btn, background: '#7a2b2b', width: '100%', marginTop: 8 }} onClick={() => borra(sel.id)}>🗑 Borrar esta zona</button>
              <button style={{ ...btn, width: '100%', marginTop: 6 }} onClick={() => setSelId(null)}>← Volver a la lista</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
