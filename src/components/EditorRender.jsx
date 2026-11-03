import { useEffect, useRef, useState } from 'react';
import api from '../services/api';

// Editor de post-producción con IA: se abre un render, se pinta con el pincel la zona que se quiere cambiar, se escribe qué cambiar (y si se quiere
// se suben o pegan imágenes de referencia) y ChatGPT cambia solo esa zona. Cada resultado es una versión nueva: se puede volver atrás, comparar con el
// original, seguir editando sobre él y guardar la que guste en la galería. Sin zona marcada, la instrucción se aplica a toda la imagen.
const ORO = '#c9a46c';
const carga = src => new Promise((ok, ko) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = () => ko(new Error('No se pudo cargar la imagen')); i.src = src; });
const aDataUrl = (img, ancho, alto, tipo = 'image/png', calidad) => { const c = document.createElement('canvas'); c.width = ancho; c.height = alto; c.getContext('2d').drawImage(img, 0, 0, ancho, alto); return c.toDataURL(tipo, calidad); };
const leeArchivo = f => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ko; r.readAsDataURL(f); });

// Ajustes de imagen sin IA (gratis y al instante): brillo, contraste, saturación, temperatura, tinte, luces altas, sombras y viñeta, sobre los píxeles de la imagen
const AJ0 = { exp: 0, con: 1, sat: 1, temp: 0, tint: 0, luc: 0, som: 0, vig: 0 };
const AJUSTES = [['exp', 'Brillo', -2, 2, 0.05], ['con', 'Contraste', 0.5, 1.8, 0.02], ['sat', 'Saturación', 0, 2, 0.02], ['temp', 'Temperatura (frío ↔ cálido)', -1, 1, 0.02], ['tint', 'Tinte (verde ↔ magenta)', -1, 1, 0.02], ['luc', 'Luces altas', -1, 1, 0.02], ['som', 'Sombras', -1, 1, 0.02], ['vig', 'Viñeta', 0, 1, 0.02]];
const PRESETS_AJ = [['Cálido', { temp: 0.35, sat: 1.08 }], ['Frío', { temp: -0.35 }], ['Más contraste', { con: 1.2, sat: 1.05 }], ['Levantar sombras', { som: 0.5, luc: -0.2 }], ['Mate', { con: 0.88, sat: 0.92, som: 0.25 }]];
// El brillo y los colores se aplican en luz lineal (como una cámara) y las luces altas se comprimen con un hombro suave en vez de cortarse: así subir el brillo no «quema» la imagen
const A_LIN = new Float32Array(256); for (let i = 0; i < 256; i++) { const v = i / 255; A_LIN[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
const DE_LIN = new Float32Array(4097); for (let i = 0; i <= 4096; i++) { const v = i / 4096; DE_LIN[i] = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; }
const hombro = v => (v <= 0.8 ? (v < 0 ? 0 : v) : 0.8 + 0.2 * (1 - Math.exp(-(v - 0.8) / 0.2)));
function procesaAjustes(d, W, H, a) {
  const ex = Math.pow(2, a.exp), cx = W / 2, cy = H / 2, rm = Math.hypot(cx, cy), cl = v => (v < 0 ? 0 : v > 1 ? 1 : v), mezcla = Math.max(0, Math.min(1, (ex - 1) * 2)), gam = v => DE_LIN[Math.min(4096, ((mezcla ? hombro(v) * mezcla + cl(v) * (1 - mezcla) : cl(v)) * 4096) | 0)]; // el hombro suave solo entra al subir el brillo: sin ajustes la imagen queda idéntica
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    let r = A_LIN[d[i]] * ex, g = A_LIN[d[i + 1]] * ex, b = A_LIN[d[i + 2]] * ex;
    if (a.temp) { r *= 1 + 0.3 * a.temp; b *= 1 - 0.3 * a.temp; }
    if (a.tint) g *= 1 - 0.2 * a.tint;
    r = gam(r); g = gam(g); b = gam(b);
    if (a.som || a.luc) { const l0 = cl(0.299 * r + 0.587 * g + 0.114 * b), add = a.som * (1 - l0) * (1 - l0) * 0.35 + a.luc * l0 * l0 * 0.35; r += add; g += add; b += add; }
    if (a.con !== 1) { r = (r - 0.5) * a.con + 0.5; g = (g - 0.5) * a.con + 0.5; b = (b - 0.5) * a.con + 0.5; }
    if (a.sat !== 1) { const l = 0.299 * r + 0.587 * g + 0.114 * b; r = l + (r - l) * a.sat; g = l + (g - l) * a.sat; b = l + (b - l) * a.sat; }
    if (a.vig) { const x = (p % W) - cx, y = ((p / W) | 0) - cy, t = cl((Math.hypot(x, y) / rm - 0.35) / 0.65), fv = 1 - a.vig * t * t; r *= fv; g *= fv; b *= fv; }
    d[i] = cl(r) * 255; d[i + 1] = cl(g) * 255; d[i + 2] = cl(b) * 255;
  }
}
export default function EditorRender({ src, nombre, onCerrar, onGuardar, galeria = [], onElegir, renderInicial, onPublicar }) {
  const [historia, setHistoria] = useState([{ src: src + (src.startsWith('data:') ? '' : (src.includes('?') ? '&' : '?') + 'cors=1'), guardada: !!renderInicial, render: renderInicial || null }]);
  const [idx, setIdx] = useState(0);
  const [pincel, setPincel] = useState(36);
  const [borrando, setBorrando] = useState(false);
  const [texto, setTexto] = useState('');
  const [refs, setRefs] = useState([]);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState('');
  const [comparar, setComparar] = useState(false);
  const [pintado, setPintado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [autoGuardar, setAutoGuardar] = useState(() => { try { return localStorage.getItem('editorRenderAuto') !== '0'; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem('editorRenderAuto', autoGuardar ? '1' : '0'); } catch { /* sin almacenamiento */ } }, [autoGuardar]);
  const img = useRef(null), lienzo = useRef(null), dibujando = useRef(null), prev = useRef(null), pequena = useRef(null);
  const [aj, setAj] = useState(AJ0), [aplicandoAj, setAplicandoAj] = useState(false);
  const ajActivo = Object.keys(AJ0).some(k => aj[k] !== AJ0[k]);

  const actual = historia[idx];
  useEffect(() => {
    if (!ajActivo) return; let vivo = true;
    (async () => {
      if (pequena.current?.src !== actual.src) {
        const im = await carga(actual.src); if (!vivo) return;
        const k = Math.min(1, 1000 / Math.max(im.naturalWidth, im.naturalHeight)), cv = document.createElement('canvas'); cv.width = Math.round(im.naturalWidth * k); cv.height = Math.round(im.naturalHeight * k); cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
        pequena.current = { src: actual.src, cv };
      }
      const { cv } = pequena.current, p = prev.current; if (!p || !vivo) return;
      p.width = cv.width; p.height = cv.height; const g = p.getContext('2d'); g.drawImage(cv, 0, 0);
      const id = g.getImageData(0, 0, p.width, p.height); procesaAjustes(id.data, p.width, p.height, aj); g.putImageData(id, 0, 0);
    })().catch(() => {});
    return () => { vivo = false; };
  }, [aj, actual.src]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setAj(AJ0); }, [idx]);
  // aplicar los ajustes a la imagen completa: crea una versión nueva (sin gastar nada de OpenAI)
  const aplicarAjustes = async () => {
    setAplicandoAj(true); setError('');
    try {
      const im = await carga(actual.src), k = Math.min(1, 2600 / Math.max(im.naturalWidth, im.naturalHeight)), cv = document.createElement('canvas'); cv.width = Math.round(im.naturalWidth * k); cv.height = Math.round(im.naturalHeight * k);
      const g = cv.getContext('2d'); g.drawImage(im, 0, 0, cv.width, cv.height); const id = g.getImageData(0, 0, cv.width, cv.height); procesaAjustes(id.data, cv.width, cv.height, aj); g.putImageData(id, 0, 0);
      const url = cv.toDataURL('image/jpeg', 0.94), nombreAj = 'Ajustes de imagen';
      setHistoria(h => [...h.slice(0, idx + 1), { src: url, guardada: false, texto: nombreAj }]); setIdx(idx + 1); setAj(AJ0);
      if (autoGuardar) { try { const rr = await onGuardar?.(url, (nombre || 'Render') + ' · v' + (idx + 2)); if (rr) setHistoria(h => h.map((v, i) => (i === idx + 1 ? { ...v, guardada: true, render: rr } : v))); } catch { /* se puede guardar a mano */ } }
    } catch (e) { setError(e.message || 'No se pudieron aplicar los ajustes'); }
    setAplicandoAj(false);
  };
  // el lienzo de pintura tiene el tamaño real de la imagen
  const ajustaLienzo = () => { const i = img.current, c = lienzo.current; if (!i || !c || !i.naturalWidth) return; if (c.width !== i.naturalWidth || c.height !== i.naturalHeight) { c.width = i.naturalWidth; c.height = i.naturalHeight; } };
  const limpiaMascara = () => { const c = lienzo.current; if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height); setPintado(false); };
  useEffect(() => { limpiaMascara(); }, [idx]); // eslint-disable-line react-hooks/exhaustive-deps

  const punto = e => { const c = lienzo.current, r = c.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height, c.width / r.width]; };
  const trazo = (a, b, k) => {
    const c = lienzo.current, g = c.getContext('2d');
    g.globalCompositeOperation = borrando ? 'destination-out' : 'source-over'; g.strokeStyle = '#ff3b3b'; g.fillStyle = '#ff3b3b'; g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = pincel * k;
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
    if (a[0] === b[0] && a[1] === b[1]) { g.beginPath(); g.arc(b[0], b[1], (pincel * k) / 2, 0, Math.PI * 2); g.fill(); }
  };
  const abajo = e => { if (trabajando) return; ajustaLienzo(); e.currentTarget.setPointerCapture(e.pointerId); const p = punto(e); dibujando.current = p; trazo(p, p, p[2]); if (!borrando) setPintado(true); };
  const mueve = e => { if (!dibujando.current) return; const p = punto(e); trazo(dibujando.current, p, p[2]); dibujando.current = p; };
  const arriba = () => { dibujando.current = null; };

  const anadirRefs = async fs => {
    const lista = Array.from(fs || []).filter(f => String(f.type).startsWith('image')).slice(0, 3 - refs.length);
    const nuevas = [];
    for (const f of lista) { try { const u = await leeArchivo(f), i = await carga(u), k = Math.min(1, 1024 / Math.max(i.naturalWidth, i.naturalHeight)); nuevas.push(aDataUrl(i, Math.round(i.naturalWidth * k), Math.round(i.naturalHeight * k), 'image/jpeg', 0.9)); } catch { /* imagen no válida */ } }
    if (nuevas.length) setRefs(a => [...a, ...nuevas].slice(0, 3));
  };
  useEffect(() => {
    const pega = e => { const fs = Array.from(e.clipboardData?.files || []); if (fs.length && !['TEXTAREA', 'INPUT'].includes(document.activeElement?.tagName)) { e.preventDefault(); anadirRefs(fs); } };
    window.addEventListener('paste', pega); return () => window.removeEventListener('paste', pega);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const aplicar = async () => {
    if (!texto.trim()) { setError('Escribe qué quieres cambiar.'); return; }
    setError(''); setTrabajando(true);
    try {
      const base = await carga(actual.src), W0 = base.naturalWidth, H0 = base.naturalHeight, asp = W0 / H0;
      // OpenAI trabaja con 1536×1024, 1024×1536 o 1024×1024: se ajusta el formato (con un estirado leve que luego se deshace)
      const [tw, th] = asp > 1.25 ? [1536, 1024] : asp < 0.8 ? [1024, 1536] : [1024, 1024];
      const imagen = aDataUrl(base, tw, th);
      let mascara;
      if (pintado) {
        const mk = document.createElement('canvas'); mk.width = tw; mk.height = th; const g = mk.getContext('2d');
        g.fillStyle = '#000'; g.fillRect(0, 0, tw, th); g.globalCompositeOperation = 'destination-out'; g.drawImage(lienzo.current, 0, 0, tw, th);
        mascara = mk.toDataURL('image/png');
      }
      const r = await api.post('/render-ia/editar', { imagen, mascara, instruccion: texto.trim(), referencias: refs }, { timeout: 280000 });
      const sal = await carga(r.data.imagen);
      const url = aDataUrl(sal, W0, H0, 'image/jpeg', 0.93);
      setHistoria(h => [...h.slice(0, idx + 1), { src: url, guardada: false, texto: texto.trim() }]); setIdx(idx + 1);
      setTexto(''); setRefs([]);
      if (autoGuardar) { try { const rr = await onGuardar?.(url, (nombre || 'Render') + ' · v' + (idx + 2)); if (rr) setHistoria(h => h.map((v, i) => (i === idx + 1 ? { ...v, guardada: true, render: rr } : v))); } catch { /* se puede guardar a mano */ } }
    } catch (e) { setError(e.response?.data?.error || e.message || 'No se pudo editar la imagen'); }
    setTrabajando(false);
  };
  const guardar = async () => {
    setGuardando(true);
    let rr = null;
    try { rr = await onGuardar?.(actual.src, (nombre || 'Render') + ' · v' + (idx + 1)); if (rr) setHistoria(h => h.map((v, i) => (i === idx ? { ...v, guardada: true, render: rr } : v))); } catch { setError('No se pudo guardar'); }
    setGuardando(false);
    return rr;
  };
  // publicar en la historia del cliente: la versión que se ve se guarda primero en la galería (si no lo estaba) y se abre el cuadro de publicación
  const publicar = async () => { const rr = actual.render || (await guardar()); if (rr) onPublicar?.(rr); else setError('Primero hay que guardar la versión en la galería'); };

  const boton = { background: '#2c2824', color: '#fff', border: '1px solid #4a443f', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 13 };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: '#141210', color: '#fff', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid #2b2724' }}>
        <b>✏️ Editor de render con IA</b><span style={{ opacity: 0.6, fontSize: 12 }}>{nombre}</span>
        <span style={{ flex: 1 }} />
        <button style={boton} disabled={idx === 0} onClick={() => setIdx(idx - 1)} title="Versión anterior">↶</button>
        <span style={{ fontSize: 12, opacity: 0.8 }}>v{idx + 1} de {historia.length}</span>
        <button style={boton} disabled={idx >= historia.length - 1} onClick={() => setIdx(idx + 1)} title="Versión siguiente">↷</button>
        <button style={{ ...boton, ...(comparar ? { background: ORO, color: '#000' } : {}) }} disabled={idx === 0} onPointerDown={() => setComparar(true)} onPointerUp={() => setComparar(false)} onPointerLeave={() => setComparar(false)} title="Mantén pulsado para ver el original">Ver original</button>
        <a style={{ ...boton, textDecoration: 'none' }} href={actual.src} download={(nombre || 'render') + '-v' + (idx + 1) + '.jpg'}>Descargar</a>
        <button style={{ ...boton, background: actual.guardada ? '#2a6b3a' : '#8c8076' }} disabled={guardando || actual.guardada} onClick={guardar}>{actual.guardada ? 'Guardada ✓' : '⭐ Guardar en la galería'}</button>
        {onPublicar && <button style={{ ...boton, background: '#2f5f8a' }} disabled={guardando || trabajando} onClick={publicar} title="Publica esta versión en la historia del cliente, sin descargarla">📤 Publicar en la historia</button>}
        <button style={boton} onClick={onCerrar}>Cerrar</button>
      </div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 14, minWidth: 0, overflow: 'auto' }}>
          <div style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
            <img ref={img} src={comparar ? historia[0].src : actual.src} alt="" crossOrigin="anonymous" onLoad={ajustaLienzo} draggable={false} style={{ maxWidth: 'calc(100vw - 360px)', maxHeight: 'calc(100vh - 150px)', display: 'block', borderRadius: 4, userSelect: 'none' }} />
            <canvas ref={prev} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', display: ajActivo && !comparar ? 'block' : 'none', borderRadius: 4 }} />
            <canvas ref={lienzo} onPointerDown={abajo} onPointerMove={mueve} onPointerUp={arriba} onPointerCancel={arriba}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: comparar ? 0 : 0.5, cursor: trabajando ? 'wait' : 'crosshair', touchAction: 'none' }} />
            {trabajando && <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', lineHeight: 1.4, fontSize: 15 }}>ChatGPT está editando… (puede tardar un minuto)</div>}
          </div>
        </div>
        {galeria.length > 0 && (
          <div style={{ borderTop: '1px solid #2b2724', padding: '6px 12px 8px', flex: '0 0 auto' }}>
            <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>🖼 Galería de renders de este plano · pulsa uno para editarlo</div>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
              {galeria.map(g => <img key={g.id} src={g.thumb || g.url} alt={g.nombre} title={g.nombre} onClick={() => { if (!trabajando) onElegir?.(g); }} style={{ height: 62, borderRadius: 4, cursor: 'pointer', flex: '0 0 auto', outline: src.startsWith(g.url) ? '2px solid ' + ORO : 'none' }} />)}
            </div>
          </div>
        )}
        </div>
        <div style={{ width: 310, borderLeft: '1px solid #2b2724', padding: 12, overflowY: 'auto', fontSize: 13 }}>
          <details style={{ marginBottom: 12, background: '#1d1a17', borderRadius: 8, padding: '8px 10px' }} open>
            <summary style={{ cursor: 'pointer', fontWeight: 700 }}>🎚 Ajustes de imagen <span style={{ fontWeight: 400, opacity: 0.6, fontSize: 11 }}>· sin IA, gratis</span></summary>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', margin: '8px 0' }}>
              {PRESETS_AJ.map(([n, p]) => <button key={n} style={{ ...boton, padding: '2px 8px', fontSize: 11 }} onClick={() => setAj({ ...AJ0, ...p })}>{n}</button>)}
            </div>
            {AJUSTES.map(([k, n, mn, mx, st]) => (
              <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontSize: 12 }}>
                <span style={{ width: 112, opacity: 0.8 }}>{n}</span>
                <input type="range" min={mn} max={mx} step={st} value={aj[k]} onChange={e => setAj(a => ({ ...a, [k]: parseFloat(e.target.value) }))} onDoubleClick={() => setAj(a => ({ ...a, [k]: AJ0[k] }))} style={{ flex: 1 }} title="Doble clic para volver a 0" />
              </label>
            ))}
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <button style={{ ...boton, flex: 1, fontSize: 12 }} disabled={!ajActivo} onClick={() => setAj(AJ0)}>Restablecer</button>
              <button style={{ ...boton, flex: 2, fontSize: 12, background: ajActivo ? '#2f5f8a' : undefined, fontWeight: 700 }} disabled={!ajActivo || aplicandoAj || trabajando} onClick={aplicarAjustes}>{aplicandoAj ? 'Aplicando…' : '✔ Aplicar ajustes'}</button>
            </div>
            <div style={{ opacity: 0.5, fontSize: 11, marginTop: 5 }}>Se ve en directo. Al aplicar se crea una versión nueva, como con la IA, sin gastar nada. Doble clic en un deslizador lo pone a 0.</div>
          </details>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>1 · Marca la zona (opcional)</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
            <button style={{ ...boton, ...(borrando ? {} : { background: ORO, color: '#000' }) }} onClick={() => setBorrando(false)}>🖌 Pintar</button>
            <button style={{ ...boton, ...(borrando ? { background: ORO, color: '#000' } : {}) }} onClick={() => setBorrando(true)}>⌫ Borrar</button>
            <button style={boton} onClick={limpiaMascara} disabled={!pintado}>Limpiar</button>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>Grosor <input type="range" min="8" max="140" value={pincel} onChange={e => setPincel(parseInt(e.target.value, 10))} style={{ flex: 1 }} /></label>
          <div style={{ opacity: 0.55, fontSize: 11, marginBottom: 12 }}>{pintado ? 'Solo se cambiará lo pintado en rojo.' : 'Sin zona marcada, el cambio se aplica a toda la imagen.'}</div>

          <div style={{ fontWeight: 700, marginBottom: 6 }}>2 · Qué quieres cambiar</div>
          <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={4} placeholder="Ej.: cambia el suelo por microcemento oscuro; pon aquí el cuadro de la imagen de referencia; quita la planta…" style={{ ...boton, width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }} />
          <div style={{ fontWeight: 700, margin: '10px 0 6px' }}>3 · Referencias (opcional)</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            {refs.map((r, i) => <div key={i} style={{ position: 'relative' }}><img src={r} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 4 }} /><span onClick={() => setRefs(a => a.filter((_, j) => j !== i))} style={{ position: 'absolute', top: -5, right: -5, background: '#000c', borderRadius: 9, padding: '0 5px', fontSize: 11, cursor: 'pointer' }}>✕</span></div>)}
            {refs.length < 3 && <label style={{ ...boton, display: 'grid', placeItems: 'center', width: 64, height: 64, boxSizing: 'border-box', padding: 0, textAlign: 'center', fontSize: 11 }}>＋ Subir<input type="file" multiple accept="image/*" style={{ display: 'none' }} onChange={e => { anadirRefs(e.target.files); e.target.value = ''; }} /></label>}
          </div>
          <div style={{ opacity: 0.55, fontSize: 11, marginBottom: 10 }}>También puedes pegar imágenes con Ctrl+V (hasta 3): un cuadro, un material, un mueble…</div>
          <button style={{ ...boton, width: '100%', background: ORO, color: '#000', fontWeight: 700, padding: '9px 12px', opacity: trabajando ? 0.6 : 1 }} disabled={trabajando} onClick={aplicar}>{trabajando ? 'Editando…' : '✨ Aplicar cambio'}</button>
          {error && <div style={{ color: '#ff9c8a', marginTop: 8 }}>{error}</div>}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 12, cursor: 'pointer' }}><input type="checkbox" checked={autoGuardar} onChange={e => setAutoGuardar(e.target.checked)} /> Guardar cada versión en la galería automáticamente</label>
          <div style={{ opacity: 0.5, fontSize: 11, marginTop: 10, lineHeight: 1.4 }}>Cada cambio es una versión nueva y se edita sobre la versión que estás viendo. Puedes volver atrás con ↶ y comparar con el original. Cada aplicación se cobra en tu cuenta de OpenAI.</div>

          {historia.length > 1 && (
            <>
              <div style={{ fontWeight: 700, margin: '14px 0 6px' }}>Versiones</div>
              {historia.map((v, i) => (
                <div key={i} onClick={() => setIdx(i)} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 4, borderRadius: 6, cursor: 'pointer', background: i === idx ? '#2c2824' : 'transparent' }}>
                  <img src={v.src} alt="" style={{ width: 56, height: 40, objectFit: 'cover', borderRadius: 3 }} />
                  <div style={{ fontSize: 12, minWidth: 0 }}><b>v{i + 1}</b>{v.guardada && i > 0 ? ' ✓' : ''}<div style={{ opacity: 0.65, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i === 0 ? 'Original' : v.texto}</div></div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
