import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { OBJETIVOS, SALAS, DESCUENTO, CATALOGO_DEMO, construyeHuecos, recomienda, nivelRecomendado, razones, revisa, sitioPara } from '../utils/homegymMotor';
import './HomeGym.css';
const HomeGymAR = lazy(() => import('../components/HomeGymAR')); // el visor AR solo se descarga al abrirlo

// Home Gym Studio (público): la herramienta propone una distribución y el cliente la cambia a su gusto (arrastrar, girar, quitar, añadir).
// Una revisión automática le dice si está bien. Ranuse queda como soporte: si quiere cambiar algo o tiene dudas, pide una videollamada.

const eur = n => Math.round(n).toLocaleString('es-ES') + ' €';
const mt = cm => (cm / 100).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
const P = (x, y, z) => [(x - y) * 0.866, (x + y) * 0.5 - z];
const pts = a => a.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
const entre = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------- Vista 3D (isométrica) ---------- */
function VistaIso({ S, items, anim }) {
  const { L, W, H } = S;
  const esq = [P(0, 0, 0), P(L, 0, 0), P(L, W, 0), P(0, W, 0), P(0, 0, H), P(L, 0, H), P(0, W, H)];
  const xs = esq.map(p => p[0]), ys = esq.map(p => p[1]), pad = 50;
  const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad * 0.6, y1 = Math.max(...ys) + pad * 1.3;
  const vw = x1 - x0, fs = Math.max(17, vw / 34);
  const puertaPared = S.door === 'arriba' ? [P(L / 2 - 45, 0, 0), P(L / 2 + 45, 0, 0), P(L / 2 + 45, 0, 205), P(L / 2 - 45, 0, 205)]
    : S.door === 'izq' ? [P(0, W / 2 - 45, 0), P(0, W / 2 + 45, 0), P(0, W / 2 + 45, 205), P(0, W / 2 - 45, 205)] : null;
  const puertaSuelo = S.door === 'abajo' ? [P(L / 2 - 45, W, 0), P(L / 2 + 45, W, 0)] : [P(L, W / 2 - 45, 0), P(L, W / 2 + 45, 0)];
  const pl = S.door === 'arriba' ? P(L / 2, 0, 230) : S.door === 'izq' ? P(0, W / 2, 230) : S.door === 'abajo' ? P(L / 2, W + 26, 0) : P(L + 26, W / 2, 0);
  const ca = P(L / 2, W + 30, 0), cb = P(L + 30, W / 2, 0);
  const orden = [...items].sort((p, q) => (p.x + p.w + p.y + p.d) - (q.x + q.w + q.y + q.d));
  const lineas = [];
  for (let i = 100; i < L; i += 100) lineas.push(<polyline key={'a' + i} points={pts([P(i, 0, 0), P(i, W, 0)])} stroke="var(--grid)" strokeWidth="1" fill="none" />);
  for (let j = 100; j < W; j += 100) lineas.push(<polyline key={'b' + j} points={pts([P(0, j, 0), P(L, j, 0)])} stroke="var(--grid)" strokeWidth="1" fill="none" />);
  return (
    <svg viewBox={`${x0.toFixed(1)} ${y0.toFixed(1)} ${vw.toFixed(1)} ${(y1 - y0).toFixed(1)}`} role="img" aria-label="Tu sala en 3D con el equipamiento colocado">
      <defs><filter id="hgbl" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation={fs / 3} /></filter></defs>
      <polygon points={pts([P(0, 0, 0), P(0, W, 0), P(0, W, H), P(0, 0, H)])} fill="var(--wall)" opacity=".55" stroke="var(--line)" strokeWidth="1.5" />
      <polygon points={pts([P(0, 0, 0), P(L, 0, 0), P(L, 0, H), P(0, 0, H)])} fill="var(--wall)" opacity=".8" stroke="var(--line)" strokeWidth="1.5" />
      <polygon points={pts([P(0, 0, 0), P(L, 0, 0), P(L, W, 0), P(0, W, 0)])} fill="var(--floor)" stroke="var(--ink)" strokeOpacity=".5" strokeWidth="2" />
      {lineas}
      {puertaPared
        ? <polygon points={pts(puertaPared)} fill="var(--accent)" opacity=".28" stroke="var(--accent)" strokeWidth="2" />
        : <polyline points={pts(puertaSuelo)} stroke="var(--accent)" strokeWidth={fs / 2.2} strokeLinecap="round" fill="none" />}
      <text className="dimt" x={pl[0].toFixed(1)} y={pl[1].toFixed(1)} fontSize={fs * 0.85} style={{ fill: 'var(--accent)', fontWeight: 600 }}>Puerta</text>
      <text className="dimt" x={ca[0].toFixed(1)} y={(ca[1] + fs * 1.1).toFixed(1)} fontSize={fs}>{mt(L)} m</text>
      <text className="dimt" x={(cb[0] + fs * 1.2).toFixed(1)} y={(cb[1] + fs * 0.4).toFixed(1)} fontSize={fs}>{mt(W)} m</text>
      {orden.map((c, i) => {
        const { x, y, w, d } = c, h = c.it.h;
        const sh = [P(x + 10, y + 10, 0), P(x + w + 14, y + 10, 0), P(x + w + 14, y + d + 14, 0), P(x + 10, y + d + 14, 0)];
        const top = [P(x, y, h), P(x + w, y, h), P(x + w, y + d, h), P(x, y + d, h)];
        const lf = [P(x, y + d, 0), P(x + w, y + d, 0), P(x + w, y + d, h), P(x, y + d, h)];
        const rt = [P(x + w, y, 0), P(x + w, y + d, 0), P(x + w, y + d, h), P(x + w, y, h)];
        const c0 = P(x + w / 2, y + d / 2, h);
        return (
          <g key={c.it.id} className={anim ? 'drop' : ''} style={{ animationDelay: i * 90 + 'ms' }}>
            <polygon points={pts(sh)} fill="#000" opacity=".28" filter="url(#hgbl)" />
            <g className={'c-' + c.it.cat}>
              <polygon className="face" points={pts(lf)} /><polygon className="s1" points={pts(lf)} />
              <polygon className="face" points={pts(rt)} /><polygon className="s2" points={pts(rt)} />
              <polygon className="face" points={pts(top)} /><polygon className="hi" points={pts(top)} />
            </g>
            <text className="lab" x={c0[0].toFixed(1)} y={c0[1].toFixed(1)} fontSize={fs * 0.95}>{c.it.s}</text>
          </g>
        );
      })}
    </svg>
  );
}

/* ---------- Vista de planta (acotada) y editable: se arrastran las máquinas con el dedo o el ratón ---------- */
function VistaPlanta({ S, items, anim, malos, sel, onSel, onMove, editable }) {
  const { L, W } = S, pad = 60, fs = Math.max(13, L / 30), r = 90;
  const ref = useRef(null), arrastre = useRef(null);
  const dd = {
    abajo: [pad + L / 2 - 45, pad + W, pad + L / 2 + 45, pad + W, `M${pad + L / 2 - 45},${pad + W} A${r},${r} 0 0 1 ${pad + L / 2 + 45},${pad + W - r}`],
    arriba: [pad + L / 2 - 45, pad, pad + L / 2 + 45, pad, `M${pad + L / 2 + 45},${pad} A${r},${r} 0 0 1 ${pad + L / 2 - 45},${pad + r}`],
    izq: [pad, pad + W / 2 - 45, pad, pad + W / 2 + 45, `M${pad},${pad + W / 2 + 45} A${r},${r} 0 0 1 ${pad + r},${pad + W / 2 - 45}`],
    der: [pad + L, pad + W / 2 - 45, pad + L, pad + W / 2 + 45, `M${pad + L},${pad + W / 2 - 45} A${r},${r} 0 0 1 ${pad + L - r},${pad + W / 2 + 45}`],
  }[S.door];
  const lineas = [];
  for (let i = 100; i < L; i += 100) lineas.push(<line key={'a' + i} x1={pad + i} y1={pad} x2={pad + i} y2={pad + W} stroke="var(--grid)" />);
  for (let j = 100; j < W; j += 100) lineas.push(<line key={'b' + j} x1={pad} y1={pad + j} x2={pad + L} y2={pad + j} stroke="var(--grid)" />);

  // Convierte la posición del dedo/ratón a centímetros del plano
  const aPlano = e => {
    const svg = ref.current, pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return [p.x - pad, p.y - pad];
  };
  const empieza = (e, c) => {
    if (!editable) return;
    const [px, py] = aPlano(e);
    arrastre.current = { id: c.it.id, dx: px - c.x, dy: py - c.y };
    e.currentTarget.setPointerCapture(e.pointerId);
    onSel(c.it.id);
  };
  const mueve = (e, c) => {
    const a = arrastre.current; if (!a || a.id !== c.it.id) return;
    const [px, py] = aPlano(e);
    onMove(c.it.id, entre(Math.round((px - a.dx) / 5) * 5, 0, L - c.w), entre(Math.round((py - a.dy) / 5) * 5, 0, W - c.d));
  };
  const suelta = () => { arrastre.current = null; };

  return (
    <svg ref={ref} viewBox={`0 0 ${L + pad * 2} ${W + pad * 2}`} role="img" aria-label="Planta de tu sala acotada. Arrastra las máquinas para moverlas.">
      <rect x={pad} y={pad} width={L} height={W} fill="var(--wall)" stroke="var(--ink)" strokeWidth="6" />
      {lineas}
      <line x1={dd[0]} y1={dd[1]} x2={dd[2]} y2={dd[3]} stroke="var(--wall)" strokeWidth="9" />
      <path d={dd[4]} fill="none" stroke="var(--accent)" strokeWidth="3" strokeDasharray="8 6" />
      {items.map((c, i) => {
        const mal = malos && malos.has(c.it.id), elegida = sel === c.it.id;
        return (
          <g key={c.it.id} className={'c-' + c.it.cat + (anim ? ' drop' : '') + (editable ? ' hg-mov' : '')} style={{ animationDelay: i * 90 + 'ms' }}
            onPointerDown={e => empieza(e, c)} onPointerMove={e => mueve(e, c)} onPointerUp={suelta} onPointerCancel={suelta}>
            <rect className="face" x={pad + c.x} y={pad + c.y} width={c.w} height={c.d} rx="4"
              stroke={mal ? 'var(--bad)' : elegida ? 'var(--accent)' : 'var(--surface)'} strokeWidth={mal || elegida ? 5 : 2} strokeDasharray={elegida && !mal ? '10 6' : undefined} />
            <text className="lab" x={pad + c.x + c.w / 2} y={pad + c.y + c.d / 2 - fs * 0.45} fontSize={fs} pointerEvents="none">{c.it.s}</text>
            <text className="lab" x={pad + c.x + c.w / 2} y={pad + c.y + c.d / 2 + fs * 0.75} fontSize={fs * 0.8} style={{ fontWeight: 500 }} pointerEvents="none">{c.w}×{c.d}</text>
          </g>
        );
      })}
      <text className="dimt" x={pad + L / 2} y={pad - 24} fontSize={fs * 1.1}>{mt(L)} m</text>
      <text className="dimt" transform={`translate(${pad - 24} ${pad + W / 2}) rotate(-90)`} fontSize={fs * 1.1}>{mt(W)} m</text>
    </svg>
  );
}

/* ---------- Dibujar la sala con el dedo: se arrastran las esquinas y se mueve la puerta por las paredes ---------- */
function VistaSala({ S, onChange }) {
  const { L, W } = S, ref = useRef(null), arr = useRef(null);
  const aCm = e => { const svg = ref.current, pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const p = pt.matrixTransform(svg.getScreenCTM().inverse()); return [p.x, p.y]; };
  const empieza = (e, t) => { arr.current = t; e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault(); };
  const mueve = e => {
    const t = arr.current; if (!t) return;
    const [x, y] = aCm(e), snap = v => Math.round(v / 10) * 10;
    if (t === 'puerta') {
      const d = { arriba: Math.abs(y), abajo: Math.abs(y - W), izq: Math.abs(x), der: Math.abs(x - L) };
      onChange({ door: Object.entries(d).sort((a, b) => a[1] - b[1])[0][0] });
      return;
    }
    const c = {};
    if (t === 'x' || t === 'xy') c.L = entre(snap(x), 200, 1000);
    if (t === 'y' || t === 'xy') c.W = entre(snap(y), 200, 800);
    onChange(c);
  };
  const suelta = () => { arr.current = null; };
  const pd = { abajo: [L / 2, W], arriba: [L / 2, 0], izq: [0, W / 2], der: [L, W / 2] }[S.door];
  const lineas = [];
  for (let i = 100; i <= 1000; i += 100) lineas.push(<line key={'a' + i} x1={i} y1={0} x2={i} y2={800} stroke="var(--grid)" strokeWidth="2" />);
  for (let j = 100; j <= 800; j += 100) lineas.push(<line key={'b' + j} x1={0} y1={j} x2={1000} y2={j} stroke="var(--grid)" strokeWidth="2" />);
  const asa = (x, y, t, etiqueta) => (
    <g className="hg-handle" onPointerDown={e => empieza(e, t)} onPointerMove={mueve} onPointerUp={suelta} onPointerCancel={suelta} role="slider" aria-label={etiqueta}>
      <circle cx={x} cy={y} r="85" fill="transparent" />
      <circle cx={x} cy={y} r="34" fill="var(--accent)" stroke="var(--bg)" strokeWidth="8" />
    </g>
  );
  return (
    <svg ref={ref} viewBox="-100 -120 1300 1040" role="img" aria-label="Dibujo de tu sala. Arrastra los puntos para cambiar su tamaño.">
      <rect x="0" y="0" width="1000" height="800" fill="none" stroke="var(--line)" strokeWidth="3" strokeDasharray="14 12" />
      {lineas}
      <rect x="0" y="0" width={L} height={W} fill="var(--wall)" stroke="var(--ink)" strokeWidth="8" />
      <text className="dimt" x={L / 2} y="-52" fontSize="44">{mt(L)} m</text>
      <text className="dimt" transform={`translate(-52 ${W / 2}) rotate(-90)`} fontSize="44">{mt(W)} m</text>
      <text className="dimt" x={L / 2} y={W / 2} fontSize="40" style={{ opacity: 0.55 }}>{((L * W) / 10000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} m²</text>
      <g className="hg-handle" onPointerDown={e => empieza(e, 'puerta')} onPointerMove={mueve} onPointerUp={suelta} onPointerCancel={suelta} role="slider" aria-label="Puerta: arrástrala hasta la pared por donde se entra">
        <circle cx={pd[0]} cy={pd[1]} r="85" fill="transparent" />
        <rect x={pd[0] - 55} y={pd[1] - 18} width="110" height="36" rx="6" fill="var(--bg)" stroke="var(--accent)" strokeWidth="6" />
        <text x={pd[0]} y={pd[1]} fontSize="26" textAnchor="middle" dominantBaseline="middle" fill="var(--accent)" style={{ fontWeight: 700, letterSpacing: '.1em' }} pointerEvents="none">PUERTA</text>
      </g>
      {asa(L, W * 0.2, 'x', 'Largo de la sala')}
      {asa(L * 0.2, W, 'y', 'Ancho de la sala')}
      {asa(L, W, 'xy', 'Largo y ancho de la sala')}
    </svg>
  );
}

/* ---------- Subir un plano o una foto: se reduce en el móvil antes de enviarlo (más rápido y más barato) ---------- */
const aBase64 = blob => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = () => ko(new Error('No se pudo leer el archivo.')); r.readAsDataURL(blob); });
async function preparaArchivo(file) {
  if (file.type === 'application/pdf') {
    if (file.size > 5e6) throw new Error('El PDF pesa más de 5 MB. Prueba con una captura del plano.');
    return { tipo: file.type, data: await aBase64(file), vista: null };
  }
  if (!file.type.startsWith('image/')) throw new Error('Sube una imagen o un PDF.');
  const url = URL.createObjectURL(file);
  const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('No se pudo abrir la imagen.')); i.src = url; });
  const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return { tipo: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.85).split(',')[1], vista: url };
}
const ETIQ_CONF = { alta: 'Confianza alta', media: 'Confianza media', baja: 'Confianza baja' };

/* ---------- Campo de medida: número escrito + deslizador ---------- */
function Medida({ id, label, valor, min, max, paso, onChange }) {
  const [txt, setTxt] = useState(String(valor / 100));
  useEffect(() => { setTxt(String(valor / 100)); }, [valor]);
  const aplica = v => onChange(Math.round(Math.min(max, Math.max(min, v)) * 100));
  return (
    <div className="hg-fld">
      <div className="hg-fh">
        <label htmlFor={'n' + id}>{label}</label>
        <div className="hg-num">
          <input id={'n' + id} type="number" inputMode="decimal" min={min} max={max} step={paso} value={txt}
            onChange={e => { setTxt(e.target.value); const v = parseFloat(e.target.value); if (!isNaN(v)) aplica(v); }}
            onBlur={() => setTxt(String(valor / 100))} /> m
        </div>
      </div>
      <input type="range" min={min} max={max} step={paso} value={valor / 100} aria-label={label} onChange={e => aplica(parseFloat(e.target.value))} />
    </div>
  );
}

export function HomeGym() {
  const [paso, setPaso] = useState(0);
  const [S, setS] = useState({ ...SALAS[1], goal: 'mixto', people: 1, budget: 2500 });
  const [sala, setSala] = useState(1);
  const [modo, setModo] = useState('dibujar');
  const [pasos, setPasos] = useState({ l: '', a: '', p: 70 });
  const [nivel, setNivel] = useState(0);
  const [lay, setLay] = useState([]); // la distribución que se ve y que el cliente puede cambiar
  const [sel, setSel] = useState(null);
  const [vista, setVista] = useState('sala');
  const [ar, setAr] = useState(false);
  const [picker, setPicker] = useState(false);
  const [anim, setAnim] = useState(false);
  const [productos, setProductos] = useState(null);
  const [contacto, setContacto] = useState({ nombre: '', email: '', telefono: '', mensaje: '', acepto: false, web: '' });
  const [envio, setEnvio] = useState({ estado: 'idle', ref: '', error: '' });
  const [lectura, setLectura] = useState({ estado: 'idle', datos: null, vista: null, error: '' });

  useEffect(() => {
    document.title = 'Home Gym Studio · Ranuse Design';
    let vivo = true;
    api.get('/homegym/catalogo').then(r => { if (vivo) setProductos(r.data?.productos || []); }).catch(() => { if (vivo) setProductos([]); });
    return () => { vivo = false; };
  }, []);

  const demo = productos !== null && productos.length === 0;
  const huecos = useMemo(() => construyeHuecos(productos === null ? [] : demo ? CATALOGO_DEMO : productos), [productos, demo]);
  const todos = useMemo(() => Object.values(huecos).flat().sort((a, b) => a.nombre.localeCompare(b.nombre)), [huecos]);
  const R = useMemo(() => (paso >= 2 ? recomienda(S, huecos) : null), [paso, S.L, S.W, S.H, S.door, S.goal, S.people, huecos]); // eslint-disable-line react-hooks/exhaustive-deps
  const niv = R && R.niveles.length ? R.niveles[Math.min(nivel, R.niveles.length - 1)] : null;

  // Cada vez que cambia la sugerencia (o se elige otro nivel), la distribución parte de ella
  useEffect(() => { setLay(niv ? niv.lista.map(c => ({ it: c.it, x: c.x, y: c.y, w: c.w, d: c.d })) : []); setSel(null); }, [R, nivel]); // eslint-disable-line react-hooks/exhaustive-deps
  const activos = paso >= 2 ? lay : [];
  const rev = useMemo(() => revisa(S, activos), [S, activos]); // eslint-disable-line react-hooks/exhaustive-deps

  const ir = n => {
    if (n >= 2) {
      if (paso < 2) { const r = recomienda(S, huecos); setNivel(r.niveles.length ? nivelRecomendado(r.niveles, S.budget) : 0); }
      if (n === 2) setVista('pl'); // en la planta se pueden mover las máquinas
      setAnim(true);
    }
    if (n === 0) setVista('sala');
    else if (n === 1 && vista === 'sala') setVista('3d');
    setPaso(n);
    window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'auto' : 'smooth' });
  };
  const ponS = c => { setS(s => ({ ...s, ...c })); setSala(-1); };

  // Lee las medidas de un plano o una foto y las pone en los campos de abajo, para que el cliente las revise
  const leeEspacio = async file => {
    if (!file) return;
    setLectura({ estado: 'leyendo', datos: null, vista: null, error: '' });
    try {
      const a = await preparaArchivo(file);
      const r = await api.post('/homegym/leer-espacio', { tipo: a.tipo, data: a.data });
      const d = r.data, cambios = {};
      if (d.largo) cambios.L = entre(Math.round(d.largo * 100), 200, 1000);
      if (d.ancho) cambios.W = entre(Math.round(d.ancho * 100), 200, 800);
      if (d.alto) cambios.H = entre(Math.round(d.alto * 100), 200, 350);
      if (Object.keys(cambios).length) ponS(cambios);
      setLectura({ estado: 'ok', datos: d, vista: a.vista, error: '' });
    } catch (e) {
      setLectura({ estado: 'error', datos: null, vista: null, error: e.response?.data?.error || e.message || 'No se pudo leer el archivo.' });
    }
  };

  // Cambios del cliente sobre la distribución
  const mover = (id, x, y) => setLay(l => l.map(a => (a.it.id === id ? { ...a, x, y } : a)));
  const girar = id => setLay(l => l.map(a => {
    if (a.it.id !== id) return a;
    const cx = a.x + a.w / 2, cy = a.y + a.d / 2;
    return { ...a, w: a.d, d: a.w, x: entre(Math.round(cx - a.d / 2), 0, Math.max(0, S.L - a.d)), y: entre(Math.round(cy - a.w / 2), 0, Math.max(0, S.W - a.w)) };
  }));
  const quitar = id => { setLay(l => l.filter(a => a.it.id !== id)); setSel(s => (s === id ? null : s)); };
  const anadir = idProd => {
    const it = todos.find(t => t.id === idProd); if (!it) return;
    const pos = sitioPara(it, S, lay) || { x: 0, y: 0, w: it.w, d: it.d }; // si no hay sitio, entra igualmente y la revisión avisa
    setLay(l => [...l, { it, x: pos.x, y: pos.y, w: pos.w, d: pos.d }]); setSel(it.id);
  };

  const area = S.L * S.W, total = activos.reduce((a, c) => a + c.it.precio, 0), dto = total * DESCUENTO;
  const nombres = ['Tu sala', 'Tu objetivo', 'Tu gym', 'Guardar'];
  const itSel = activos.find(a => a.it.id === sel);

  // Guarda el plano como imagen (para llevárselo, enseñarlo o mandarlo a un montador). Se dibuja aparte para que salga igual en cualquier móvil.
  const descargaPlano = () => {
    const ANCHO = 1600, mar = 110, esc = Math.min((ANCHO - mar * 2) / S.L, 900 / S.W), pw = S.L * esc, ph = S.W * esc, fila = 56;
    const alto = Math.round(mar + ph + 150 + activos.length * fila + 190);
    const c = document.createElement('canvas'); c.width = ANCHO; c.height = alto;
    const g = c.getContext('2d'), ox = (ANCHO - pw) / 2, oy = mar + 40;
    const fuente = (p, t) => { g.font = `${p}px Montserrat, system-ui, sans-serif`; g.fillStyle = t; };
    g.fillStyle = '#0B0B0B'; g.fillRect(0, 0, ANCHO, alto);
    fuente('600 34', '#F4F1EC'); g.textAlign = 'left'; g.fillText('RANUSE DESIGN', 60, 70);
    fuente('500 24', '#BFB1A3'); g.fillText('Mi home gym · ' + mt(S.L) + ' × ' + mt(S.W) + ' m · techo ' + mt(S.H) + ' m', 60, 104);
    g.fillStyle = '#22211F'; g.fillRect(ox, oy, pw, ph);
    g.strokeStyle = '#2C2A27'; g.lineWidth = 2;
    for (let i = 100; i < S.L; i += 100) { g.beginPath(); g.moveTo(ox + i * esc, oy); g.lineTo(ox + i * esc, oy + ph); g.stroke(); }
    for (let j = 100; j < S.W; j += 100) { g.beginPath(); g.moveTo(ox, oy + j * esc); g.lineTo(ox + pw, oy + j * esc); g.stroke(); }
    g.strokeStyle = '#F4F1EC'; g.lineWidth = 8; g.strokeRect(ox, oy, pw, ph);
    // puerta
    g.strokeStyle = '#BFB1A3'; g.lineWidth = 14; g.beginPath();
    const pc = { arriba: [ox + pw / 2 - 45 * esc, oy, ox + pw / 2 + 45 * esc, oy], abajo: [ox + pw / 2 - 45 * esc, oy + ph, ox + pw / 2 + 45 * esc, oy + ph], izq: [ox, oy + ph / 2 - 45 * esc, ox, oy + ph / 2 + 45 * esc], der: [ox + pw, oy + ph / 2 - 45 * esc, ox + pw, oy + ph / 2 + 45 * esc] }[S.door];
    g.moveTo(pc[0], pc[1]); g.lineTo(pc[2], pc[3]); g.stroke();
    fuente('600 20', '#BFB1A3'); g.textAlign = 'center';
    g.fillText('PUERTA', (pc[0] + pc[2]) / 2, S.door === 'abajo' ? pc[1] + 40 : S.door === 'arriba' ? pc[1] - 22 : pc[1] + (pc[3] - pc[1]) / 2);
    // medidas de la sala
    fuente('500 24', '#9A948B'); g.fillText(mt(S.L) + ' m', ox + pw / 2, oy - 22);
    g.save(); g.translate(ox - 26, oy + ph / 2); g.rotate(-Math.PI / 2); g.fillText(mt(S.W) + ' m', 0, 0); g.restore();
    // máquinas numeradas
    const col = { fuerza: '#77726B', cardio: '#BFB1A3', func: '#E6E1DA' };
    activos.forEach((a, i) => {
      g.fillStyle = col[a.it.cat] || '#77726B'; g.fillRect(ox + a.x * esc, oy + a.y * esc, a.w * esc, a.d * esc);
      g.strokeStyle = '#0B0B0B'; g.lineWidth = 3; g.strokeRect(ox + a.x * esc, oy + a.y * esc, a.w * esc, a.d * esc);
      fuente('700 ' + Math.max(22, Math.min(44, a.d * esc * 0.5)), a.it.cat === 'fuerza' ? '#FFFFFF' : '#0B0B0B'); g.textAlign = 'center';
      g.fillText(String(i + 1), ox + (a.x + a.w / 2) * esc, oy + (a.y + a.d / 2) * esc + 12);
    });
    // lista
    let y = oy + ph + 90; g.textAlign = 'left';
    fuente('700 22', '#BFB1A3'); g.fillText('MIS MÁQUINAS', 60, y); y += 46;
    activos.forEach((a, i) => {
      fuente('700 26', '#F4F1EC'); g.fillText(String(i + 1), 60, y);
      fuente('500 26', '#F4F1EC'); g.fillText(a.it.nombre.length > 52 ? a.it.nombre.slice(0, 51) + '…' : a.it.nombre, 110, y);
      fuente('500 24', '#9A948B'); g.textAlign = 'right'; g.fillText(a.w + '×' + a.d + ' cm · ' + eur(a.it.precio), ANCHO - 60, y); g.textAlign = 'left'; y += fila;
    });
    fuente('700 28', '#F4F1EC'); g.fillText('Total orientativo', 60, y + 14); g.textAlign = 'right'; g.fillText(eur(total), ANCHO - 60, y + 14); g.textAlign = 'left';
    fuente('500 20', '#6E6A64'); g.fillText('Hecho con Home Gym Studio · Ranuse Design', 60, alto - 40);
    c.toBlob(b => { if (!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'mi-home-gym.png'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }, 'image/png');
  };

  const enviar = async () => {
    setEnvio({ estado: 'enviando', ref: '', error: '' });
    try {
      const r = await api.post('/homegym/solicitud', {
        contacto: { nombre: contacto.nombre, email: contacto.email, telefono: contacto.telefono }, mensaje: contacto.mensaje, videollamada: true, acepto: contacto.acepto, web: contacto.web,
        espacio: { L: S.L, W: S.W, H: S.H, door: S.door, goal: S.goal, people: S.people, budget: S.budget, mode: modo },
        items: activos.map(c => c.it.id),
      });
      setEnvio({ estado: 'ok', ref: r.data?.ref || '', error: '' });
    } catch (e) {
      setEnvio({ estado: 'error', ref: '', error: e.response?.data?.error || 'No se pudo enviar. Inténtalo de nuevo.' });
    }
  };

  /* ---------- Paneles ---------- */
  const p0 = (
    <>
      <div><span className="hg-kicker">Paso 1 de 4</span><h1>¿Dónde vas a montar tu gym?</h1><p className="hg-lead">Dibújala con el dedo, sube un plano o una foto, o mídela. Lo ves a la vez en el visor.</p></div>
      <div className="hg-seg" role="group" aria-label="Cómo quieres darnos tu espacio">
        {[['dibujar', 'Dibujar'], ['plano', 'Plano o foto'], ['movil', 'Medir']].map(([k, n]) => <button key={k} type="button" aria-pressed={modo === k} onClick={() => { setModo(k); if (k === 'dibujar') setVista('sala'); }}>{n}</button>)}
      </div>
      {modo === 'plano' && (
        <div className="hg-cap">
          <label className="hg-upl">{lectura.estado === 'leyendo' ? 'Leyendo tu archivo…' : 'Toca para subir un plano, un PDF o una foto'}
            <input type="file" accept="image/*,application/pdf" disabled={lectura.estado === 'leyendo'} onChange={e => { leeEspacio(e.target.files && e.target.files[0]); e.target.value = ''; }} />
          </label>
          {lectura.vista && <img className="hg-prev" src={lectura.vista} alt="Archivo que has subido" />}
          {lectura.estado === 'error' && <p className="hg-msg err">{lectura.error}</p>}
          {lectura.estado === 'ok' && lectura.datos && (
            <div className="hg-lect" role="status">
              <b>{lectura.datos.tipo === 'plano' ? 'Hemos leído tu plano' : lectura.datos.tipo === 'foto' ? 'Hemos mirado tu foto' : 'No parece una sala ni un plano'} · {ETIQ_CONF[lectura.datos.confianza]}</b>
              <span>Largo: {lectura.datos.largo ? mt(lectura.datos.largo * 100) + ' m' : 'no se ha podido leer'} · Ancho: {lectura.datos.ancho ? mt(lectura.datos.ancho * 100) + ' m' : 'no se ha podido leer'} · Techo: {lectura.datos.alto ? mt(lectura.datos.alto * 100) + ' m' : 'no se ha podido leer'}</span>
              {lectura.datos.nota && <span className="hg-note">{lectura.datos.nota}</span>}
              {!lectura.datos.formaRegular && <span className="hg-warn">La sala no es un rectángulo: usamos el rectángulo que la contiene.</span>}
              {lectura.datos.confianza === 'baja' && <span className="hg-warn">Es una estimación poco fiable. Confirma las medidas con un metro.</span>}
              {!lectura.datos.largo && !lectura.datos.ancho && <span className="hg-warn">No hemos podido sacar medidas. Escríbelas aquí debajo.</span>}
            </div>)}
          <span className="hg-note">En un plano leemos las cotas escritas. En una foto solo estimamos si se ve algo de tamaño conocido, como una puerta o un folio A4 en el suelo. <b>Revisa siempre las medidas de aquí debajo.</b></span>
        </div>)}
      {modo === 'dibujar' && <div className="hg-cap"><span><b>Arrastra los puntos</b> de la sala en el visor para hacerla más grande o más pequeña. Mueve el cuadro <b>PUERTA</b> hasta la pared por donde se entra.</span></div>}
      {modo === 'movil' && (
        <div className="hg-cap">
          <b>Medir con el móvil</b>
          <span><b>iPhone:</b> abre la app <b>Medida</b> (ya viene instalada), toca los extremos de cada pared y escribe los números aquí debajo.</span>
          <span><b>Sin metro ni app:</b> camina pegado a la pared contando pasos normales.</span>
          <div className="hg-pasos">
            <label>Pasos de largo<input type="number" inputMode="numeric" min="1" max="40" value={pasos.l} onChange={e => setPasos(p => ({ ...p, l: e.target.value }))} /></label>
            <label>Pasos de ancho<input type="number" inputMode="numeric" min="1" max="40" value={pasos.a} onChange={e => setPasos(p => ({ ...p, a: e.target.value }))} /></label>
            <label>Tu paso (cm)<input type="number" inputMode="numeric" min="40" max="100" value={pasos.p} onChange={e => setPasos(p => ({ ...p, p: e.target.value }))} /></label>
          </div>
          <button type="button" className="hg-ghost" disabled={!(+pasos.l > 0 && +pasos.a > 0 && +pasos.p > 0)}
            onClick={() => { ponS({ L: entre(Math.round(+pasos.l * +pasos.p / 10) * 10, 200, 1000), W: entre(Math.round(+pasos.a * +pasos.p / 10) * 10, 200, 800) }); setVista('sala'); }}>Usar estas medidas</button>
          <span className="hg-note">Es aproximado: un paso mide unos 70 cm. Para mayor precisión usa un metro.</span>
        </div>)}
      <div className="hg-presets">{SALAS.map((s, i) => <button key={s.n} type="button" className="hg-preset" aria-pressed={sala === i} onClick={() => { setS(o => ({ ...o, L: s.L, W: s.W, H: s.H, door: s.door })); setSala(i); }}>{s.n}</button>)}</div>
      <Medida id="L" label="Largo" valor={S.L} min={2} max={10} paso={0.1} onChange={v => ponS({ L: v })} />
      <Medida id="W" label="Ancho" valor={S.W} min={2} max={8} paso={0.1} onChange={v => ponS({ W: v })} />
      <Medida id="H" label="Altura del techo" valor={S.H} min={2} max={3.5} paso={0.05} onChange={v => ponS({ H: v })} />
      <div className="hg-fld"><div className="hg-fh"><span>¿Por dónde se entra?</span></div>
        <div className="hg-seg">{[['arriba', 'Arriba'], ['abajo', 'Abajo'], ['izq', 'Izquierda'], ['der', 'Derecha']].map(([k, n]) => <button key={k} type="button" aria-pressed={S.door === k} onClick={() => ponS({ door: k })}>{n}</button>)}</div></div>
      <div className="hg-nav"><button type="button" className="hg-primary" onClick={() => ir(1)}>Continuar</button></div>
    </>
  );
  const p1 = (
    <>
      <div><span className="hg-kicker">Paso 2 de 4</span><h1>¿Qué quieres entrenar?</h1><p className="hg-lead">Con esto te proponemos una distribución de partida. Después la cambias como quieras.</p></div>
      <div className="hg-goals">{Object.entries(OBJETIVOS).map(([k, v]) => <button key={k} type="button" className="hg-goal" aria-pressed={S.goal === k} onClick={() => setS(s => ({ ...s, goal: k }))}><b>{v.n}</b><span>{v.s}</span></button>)}</div>
      <div className="hg-fld"><div className="hg-fh"><span>¿Cuántas personas entrenan a la vez?</span></div>
        <div className="hg-seg">{[1, 2, 3].map(n => <button key={n} type="button" aria-pressed={S.people === n} onClick={() => setS(s => ({ ...s, people: n }))}>{n === 3 ? '3 o más' : n}</button>)}</div></div>
      <div className="hg-fld"><div className="hg-fh"><label htmlFor="hgbud">Presupuesto en equipos</label><b>{eur(S.budget)}</b></div>
        <input id="hgbud" type="range" min="500" max="8000" step="100" value={S.budget} onChange={e => setS(s => ({ ...s, budget: +e.target.value }))} /></div>
      <div className="hg-nav"><button type="button" className="hg-ghost" onClick={() => ir(0)}>Atrás</button><button type="button" className="hg-primary" onClick={() => ir(2)}>Ver mi propuesta</button></div>
    </>
  );
  const rec = R && R.niveles.length ? nivelRecomendado(R.niveles, S.budget) : 0;
  const enLay = new Set(activos.map(a => a.it.id));
  const p2 = !R ? null : !R.niveles.length ? (
    <>
      <div><span className="hg-kicker">Paso 3 de 4</span><h1>Esta sala es muy justa</h1><p className="hg-lead">Con estas medidas no entra ningún equipo con espacio para moverse. Prueba con otra sala o ajusta las medidas.</p></div>
      <div className="hg-nav"><button type="button" className="hg-ghost" onClick={() => ir(0)}>Cambiar medidas</button></div>
    </>
  ) : (
    <>
      <div><span className="hg-kicker">Paso 3 de 4</span><h1>Tu gym</h1><p className="hg-lead">Esta es nuestra propuesta. <b>Toca una máquina y arrástrala</b> para moverla. Si algo no encaja, te lo avisamos.</p></div>
      {demo && <div className="hg-demo">Catálogo de ejemplo. Las máquinas reales se activan desde el CRM.</div>}
      <div className={'hg-rev ' + rev.estado} role="status">
        <b>{rev.estado === 'ok' ? '✓ Tu distribución está bien' : rev.estado === 'aviso' ? '! Revisa estos detalles' : '✕ Hay cosas que arreglar'}</b>
        {rev.estado === 'ok'
          ? <span>Todo cabe dentro de la sala, sin choques, con la puerta libre y un {rev.libre} % de suelo libre para moverte.</span>
          : <ul>{rev.problemas.map((p, i) => <li key={i} className={p.nivel}>{p.texto}</li>)}</ul>}
      </div>
      <div className="hg-fld"><h3>Tus máquinas · {eur(total)}</h3>
        <div className="hg-items">{activos.map(c => (
          <div key={c.it.id} className={'hg-it' + (sel === c.it.id ? ' sel' : '')} onClick={() => setSel(c.it.id)}>
            {c.it.foto ? <img className="hg-th" src={c.it.foto} alt="" loading="lazy" /> : <i className="hg-sw" style={{ background: `var(--c-${c.it.cat})` }} />}
            <span><span className="n">{c.it.nombre}</span><span className="d">{c.it.marca ? c.it.marca + ' · ' : ''}{c.w}×{c.d}×{c.it.h} cm · {eur(c.it.precio)}</span></span>
            <span className="hg-acc"><button type="button" aria-label={'Girar ' + c.it.nombre} onClick={e => { e.stopPropagation(); girar(c.it.id); }}>Girar</button><button type="button" aria-label={'Quitar ' + c.it.nombre} onClick={e => { e.stopPropagation(); quitar(c.it.id); }}>Quitar</button></span>
          </div>))}
          {!activos.length && <p className="hg-note">No hay máquinas. Añade alguna aquí debajo.</p>}
        </div>
        <button type="button" className="hg-ghost hg-addbtn" onClick={() => setPicker(true)} disabled={!todos.some(t => !enLay.has(t.id))}>+ Añadir una máquina</button>
      </div>
      <details className="hg-more"><summary>Cambiar de propuesta</summary>
        <div className="hg-tiers">{R.niveles.map((x, i) => (
          <button key={x.nombre} type="button" className="hg-tier" aria-pressed={nivel === i} onClick={() => { setNivel(i); setAnim(true); }}>
            {i === rec && <span className="rec">RECOMENDADO</span>}<b>{x.nombre}</b><span className="pr">{eur(x.total * (1 - DESCUENTO))}</span><small>{x.n} equipos</small>
          </button>))}</div>
        <p className="hg-note">Al cambiar de propuesta se pierden los cambios que hayas hecho.</p>
      </details>
      <details className="hg-more"><summary>Por qué esta propuesta</summary>{niv &&<ul className="hg-why">{razones(S, niv, mt, eur).map((t, i) => <li key={i}><span>{t}</span></li>)}</ul>}
        {R.omitidos.filter(o => niv && o.idx < niv.maxIdx).length > 0 && <div className="hg-skip"><h3>No incluido en tu sala</h3>{R.omitidos.filter(o => niv && o.idx < niv.maxIdx).map(o => <span key={o.it.id}><b>{o.it.nombre}</b>: {o.r}.</span>)}</div>}
      </details>
      <div className="hg-fld">
        <button type="button" className="hg-ghost" disabled={demo || !activos.length || rev.estado === 'mal'} onClick={() => setAr(true)}>Ver mi gym en tu sala (3D real y AR)</button>
        {demo ? <p className="hg-note">Disponible cuando haya máquinas reales en el catálogo.</p> : rev.estado === 'mal' && <p className="hg-note">Arregla los problemas de arriba para poder verlo en tu sala.</p>}
      </div>
      <div className="hg-nav"><button type="button" className="hg-ghost" onClick={() => ir(1)}>Atrás</button><button type="button" className="hg-primary" disabled={!activos.length} onClick={() => ir(3)}>Continuar</button></div>
    </>
  );
  const puedeEnviar = contacto.nombre.trim().length > 1 && (contacto.email.trim() || contacto.telefono.trim()) && contacto.acepto && activos.length && !demo && envio.estado !== 'enviando';
  const p3 = envio.estado === 'ok' ? (
    <div className="hg-done">
      <span className="hg-kicker">Recibido</span><h1>Hablamos pronto</h1>
      <span className="hg-ref">{envio.ref}</span>
      <p className="hg-lead">Te escribiremos para cuadrar la videollamada. Tu distribución está guardada con esta referencia, así que no hace falta que la repitas.</p>
    </div>
  ) : (
    <>
      <div><span className="hg-kicker">Paso 4 de 4</span><h1>Tu diseño está listo</h1><p className="hg-lead">Guárdalo en tu móvil para tenerlo a mano, enseñarlo o mandarlo a quien te monte el gym.</p></div>
      <button type="button" className="hg-primary hg-guardar" onClick={descargaPlano} disabled={!activos.length}>Guardar mi plano (imagen)</button>
      <div className="hg-sum">
        {activos.map((c, i) => <div key={c.it.id}><span>{i + 1}. {c.it.nombre}</span><span>{eur(c.it.precio)}</span></div>)}
        <div className="tot"><span>Total orientativo</span><span>{eur(total - dto)}</span></div>
      </div>
      <div><h3>¿Dudas o quieres cambiar algo?</h3><p className="hg-lead">Lo vemos juntos en una <b>videollamada</b>. Déjanos tus datos y te escribimos.</p></div>
      <form className="hg-form" onSubmit={e => { e.preventDefault(); if (puedeEnviar) enviar(); }}>
        <input type="text" placeholder="Tu nombre" autoComplete="name" value={contacto.nombre} onChange={e => setContacto(c => ({ ...c, nombre: e.target.value }))} aria-label="Tu nombre" />
        <input type="email" placeholder="Email" autoComplete="email" value={contacto.email} onChange={e => setContacto(c => ({ ...c, email: e.target.value }))} aria-label="Email" />
        <input type="tel" placeholder="Teléfono (opcional si dejas email)" autoComplete="tel" value={contacto.telefono} onChange={e => setContacto(c => ({ ...c, telefono: e.target.value }))} aria-label="Teléfono" />
        <textarea placeholder="¿Qué quieres consultar? (opcional)" rows={3} value={contacto.mensaje} onChange={e => setContacto(c => ({ ...c, mensaje: e.target.value }))} aria-label="Qué quieres consultar" />
        <input className="hg-trap" type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" value={contacto.web} onChange={e => setContacto(c => ({ ...c, web: e.target.value }))} />
        <label className="hg-check"><input type="checkbox" checked={contacto.acepto} onChange={e => setContacto(c => ({ ...c, acepto: e.target.checked }))} /><span>He leído y acepto la <Link to="/privacidad" target="_blank">política de privacidad</Link>.</span></label>
        <p className={'hg-msg' + (envio.estado === 'error' ? ' err' : '')} role="status">{envio.error}</p>
        <div className="hg-nav"><button type="button" className="hg-ghost" onClick={() => ir(2)}>Atrás</button><button type="submit" className="hg-primary" disabled={!puedeEnviar}>{envio.estado === 'enviando' ? 'Enviando…' : 'Pedir videollamada'}</button></div>
        {demo && <p className="hg-note">Catálogo de ejemplo: el envío se activa cuando haya máquinas reales marcadas en el CRM.</p>}
      </form>
    </>
  );

  const editable = paso === 2 && vista === 'pl';
  return (
    <div className="hg">
      <div className="hg-stage">
        <header className="hg-top">
          <div className="hg-brand"><b>RANUSE DESIGN</b><span>Home Gym Studio</span></div>
          <nav className="hg-prog" aria-label="Pasos">{nombres.map((n, i) => <button key={n} type="button" className={i <= paso ? 'on' : ''} disabled={i > paso} onClick={() => ir(i)}><span>{n}</span><i /></button>)}</nav>
        </header>
        <div className="hg-vwrap">{vista === 'sala'
          ? <VistaSala S={S} onChange={ponS} />
          : vista === '3d'
            ? <VistaIso S={S} items={activos} anim={anim} />
            : <VistaPlanta S={S} items={activos} anim={anim} malos={paso === 2 ? rev.malos : null} sel={sel} onSel={setSel} onMove={mover} editable={editable} />}
          {editable && itSel && (
            <div className="hg-selbar" role="toolbar" aria-label={'Opciones de ' + itSel.it.nombre}>
              <span>{itSel.it.nombre}</span>
              <button type="button" onClick={() => girar(itSel.it.id)}>Girar</button>
              <button type="button" onClick={() => quitar(itSel.it.id)}>Quitar</button>
              <button type="button" onClick={() => setSel(null)} aria-label="Cerrar">✓</button>
            </div>)}
        </div>
        <div className="hg-vtools">
          <div className="hg-tabs" role="tablist">
            {paso === 0 && <button type="button" role="tab" aria-selected={vista === 'sala'} onClick={() => setVista('sala')}>Dibujo</button>}
            <button type="button" role="tab" aria-selected={vista === '3d'} onClick={() => setVista('3d')}>3D</button>
            {paso > 0 && <button type="button" role="tab" aria-selected={vista === 'pl'} onClick={() => setVista('pl')}>Planta</button>}
          </div>
          <div className="hg-chips">
            {vista === 'sala' && paso === 0 && <span className="hg-chip hl">Arrastra los puntos</span>}
            {editable && <span className="hg-chip hl">Arrastra para mover</span>}
            <span className="hg-chip">{mt(S.L)} × {mt(S.W)} m</span>
            <span className="hg-chip">{(area / 10000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} m²</span>
            <span className="hg-chip">techo {mt(S.H)} m</span>
            {activos.length > 0 && <span className="hg-chip">{rev.libre} % libre</span>}
          </div>
          <div className="hg-legend"><span><i style={{ background: 'var(--c-fuerza)' }} />Fuerza</span><span><i style={{ background: 'var(--c-cardio)' }} />Cardio</span><span><i style={{ background: 'var(--c-func)' }} />Funcional</span></div>
        </div>
        <section className="hg-panel">{[p0, p1, p2, p3][paso]}</section>
      </div>
      {picker && (
        <div className="hg-modal" role="dialog" aria-modal="true" aria-label="Añadir una máquina" onClick={() => setPicker(false)}>
          <div className="hg-modal-box" onClick={e => e.stopPropagation()}>
            <div className="hg-modal-head"><div><span className="hg-kicker">Catálogo</span><h1>¿Qué quieres añadir?</h1></div><button type="button" className="hg-ghost" onClick={() => setPicker(false)}>Cerrar</button></div>
            <div className="hg-grid">
              {todos.filter(t => !enLay.has(t.id)).map(t => (
                <button key={t.id} type="button" className="hg-card" onClick={() => { anadir(t.id); setPicker(false); }}>
                  <span className="hg-card-img">{t.foto ? <img src={t.foto} alt="" loading="lazy" /> : <i className="hg-sw" style={{ background: `var(--c-${t.cat})`, width: 28, height: 28, margin: 0 }} />}</span>
                  <b>{t.nombre}</b><small>{t.marca ? t.marca + ' · ' : ''}{t.w}×{t.d} cm</small><span className="p">{eur(t.precio)}</span>
                </button>))}
            </div>
          </div>
        </div>)}
      {ar && <Suspense fallback={null}><HomeGymAR S={S} items={activos} onClose={() => setAr(false)} /></Suspense>}
    </div>
  );
}
