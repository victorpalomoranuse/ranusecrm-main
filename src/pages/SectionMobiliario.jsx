import { useState, useEffect, useRef, useMemo } from 'react';
import api from '../services/api';
import { Search, Armchair, Plus, Upload, Trash2, Wand2, Loader2, ArrowLeft, FileDown, BookOpen, Receipt, Image as Img, ExternalLink, Check } from 'lucide-react';

const card = { background: 'linear-gradient(160deg,rgba(255,255,255,.055),rgba(255,255,255,.02))', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 16, padding: '1rem 1.1rem' };
const mut = { color: 'rgba(255,255,255,0.5)', fontSize: '0.78rem' };
const inp = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: '#fff', padding: '6px 9px', fontSize: '0.8rem', width: '100%', boxSizing: 'border-box' };
const eur = (n) => Number(n || 0).toLocaleString('es-ES', { maximumFractionDigits: 2 }) + ' €';
const pv = (p) => (Number(p.costo) > 0 ? Math.round(Number(p.costo) * (1 + (Number(p.margen) || 0) / 100) * 100) / 100 : Number(p.precioVenta) || 0);
const totales = (c, prods) => { let r = 0, k = 0; for (const it of c.productos) { const p = prods.find(x => x.id === it.id); if (!p) continue; const q = Number(p.cantidad) || 1; if (p.compra === 'ranuse') r += pv(p) * q; else k += (Number(p.precio) || 0) * q; } return { r, k }; };
const err = (e, d) => e?.response?.data?.error || d;

// Dibuja el moodboard (fotos + paleta + título) en un canvas y devuelve un PNG en base64
async function dibujaMoodboard(c, prods) {
  const cargar = (u) => new Promise(ok => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = () => ok(null); i.src = u; });
  const imgs = (await Promise.all(c.productos.map(it => { const p = prods.find(x => x.id === it.id); return p?.foto ? cargar(p.foto).then(i => i && { i, rol: it.rol }) : null; }))).filter(Boolean);
  const W = 1600, H = 1100, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
  g.fillStyle = '#f4f1ec'; g.fillRect(0, 0, W, H);
  const area = { x: 60, y: 60, w: W - 120, h: H - 280 };
  const n = imgs.length || 1, cols = n <= 2 ? n : n <= 4 ? 2 : 3, filas = Math.ceil(n / cols), gap = 24;
  const cw = (area.w - gap * (cols - 1)) / cols, ch = (area.h - gap * (filas - 1)) / filas;
  imgs.forEach(({ i }, k) => {
    const cx = area.x + (k % cols) * (cw + gap), cy = area.y + Math.floor(k / cols) * (ch + gap);
    g.fillStyle = '#fff'; g.shadowColor = 'rgba(0,0,0,.12)'; g.shadowBlur = 18; g.fillRect(cx, cy, cw, ch); g.shadowBlur = 0;
    const s = Math.min((cw - 30) / i.width, (ch - 30) / i.height), w = i.width * s, h = i.height * s;
    g.drawImage(i, cx + (cw - w) / 2, cy + (ch - h) / 2, w, h);
  });
  g.fillStyle = '#1e1b18'; g.font = '600 52px Montserrat, Arial, sans-serif'; g.fillText(c.titulo || '', 60, H - 150);
  g.fillStyle = '#6b6560'; g.font = '300 26px Montserrat, Arial, sans-serif'; g.fillText((c.idea || '').slice(0, 95), 60, H - 105);
  (c.paleta || []).slice(0, 6).forEach((q, k) => { g.fillStyle = q.hex; g.fillRect(60 + k * 150, H - 70, 140, 34); g.fillStyle = '#6b6560'; g.font = '16px Arial'; g.fillText((q.nombre || '').slice(0, 16), 60 + k * 150, H - 20); });
  g.fillStyle = '#b79a6b'; g.font = '600 20px Montserrat, Arial, sans-serif'; g.textAlign = 'right'; g.fillText('RANUSE DESIGN', W - 60, H - 30); g.textAlign = 'left';
  return cv.toDataURL('image/png');
}

function Producto({ p, onChange, onBorrar }) {
  const set = (k, v) => onChange({ ...p, [k]: v });
  return (
    <div style={{ ...card, padding: '.7rem', display: 'flex', gap: 10 }}>
      <img src={p.foto} alt="" style={{ width: 92, height: 92, objectFit: 'cover', borderRadius: 10, background: '#fff' }} />
      <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 5 }}>
        <input style={{ ...inp, fontWeight: 600 }} value={p.nombre} onChange={e => set('nombre', e.target.value)} />
        <div style={mut}>{[p.tipo, p.material, p.color, p.estilo].filter(Boolean).join(' · ')}</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select style={{ ...inp, width: 'auto' }} value={p.compra} onChange={e => set('compra', e.target.value)}>
            <option value="cliente">Lo compra el cliente</option><option value="ranuse">Lo vendo yo</option>
          </select>
          <input style={{ ...inp, width: 54 }} type="number" min="1" value={p.cantidad} onChange={e => set('cantidad', e.target.value)} title="Cantidad" />
          <button onClick={onBorrar} style={{ ...inp, width: 32, cursor: 'pointer' }} title="Quitar"><Trash2 size={13} /></button>
        </div>
        {p.compra === 'cliente' ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <input style={inp} placeholder="Enlace de compra https://…" value={p.enlace} onChange={e => set('enlace', e.target.value)} />
            <input style={{ ...inp, width: 90 }} type="number" placeholder="€ ref." value={p.precio || ''} onChange={e => set('precio', e.target.value)} />
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input style={{ ...inp, width: 90 }} type="number" placeholder="Coste €" value={p.costo || ''} onChange={e => set('costo', e.target.value)} />
            <input style={{ ...inp, width: 70 }} type="number" placeholder="Margen %" value={p.margen} onChange={e => set('margen', e.target.value)} />
            <span style={{ ...mut, color: '#e5c98f' }}>Venta: <b>{eur(pv(p))}</b></span>
          </div>
        )}
      </div>
    </div>
  );
}

function Tablero({ id, volver }) {
  const [t, setT] = useState(null), [proyectos, setProyectos] = useState([]), [ocupado, setOcupado] = useState(''), [aviso, setAviso] = useState('');
  const [sel, setSel] = useState({}), [destinos, setDestinos] = useState({ presupuestos: [], capitulos: [] }), [capSel, setCapSel] = useState('nuevo'), [presSel, setPresSel] = useState('');
  const [busq, setBusq] = useState({ abierto: false, estilo: '', busco: '', max: '' }), [props, setProps] = useState([]);
  const fileRef = useRef(null), guardar = useRef(null), compraNueva = useRef('cliente');
  const [compraDefecto, setCompraDefecto] = useState('cliente');
  const flash = (m) => { setAviso(m); setTimeout(() => setAviso(''), 4500); };

  useEffect(() => { api.get('/mobiliario/' + id).then(r => setT(r.data.tablero)).catch(() => flash('No se pudo abrir el tablero')); api.get('/mobiliario/proyectos').then(r => setProyectos(r.data.proyectos)).catch(() => {}); }, [id]);
  useEffect(() => { if (!t?.proyectoId) return; api.get('/mobiliario/proyectos/' + t.proyectoId + '/destinos').then(r => { setDestinos(r.data); setPresSel(s => s || r.data.presupuestos[0]?.id || ''); }).catch(() => {}); }, [t?.proyectoId]);
  const guardaLuego = (nuevo) => { setT(nuevo); clearTimeout(guardar.current); guardar.current = setTimeout(() => api.put('/mobiliario/' + id, { nombre: nuevo.nombre, espacio: nuevo.espacio, proyectoId: nuevo.proyectoId, proyecto: nuevo.proyecto, productos: nuevo.productos, combinaciones: nuevo.combinaciones }).catch(() => flash('No se pudo guardar')), 900); };
  const accion = async (nombre, fn) => { setOcupado(nombre); try { await fn(); } catch (e) { flash(err(e, 'Algo falló')); } setOcupado(''); };

  const subir = (files) => accion('subir', async () => {
    let cur = t;
    for (const f of files) { const fd = new FormData(); fd.append('file', f); fd.append('compra', compraDefecto); const r = await api.post('/mobiliario/' + id + '/productos', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 }); cur = { ...cur, productos: [...cur.productos, r.data.producto] }; setT(cur); }
    flash('Fotos leídas por la IA. Revisa nombre, enlace y precio.');
  });
  const buscar = () => accion('buscar', async () => { const r = await api.post('/mobiliario/' + id + '/buscar', { estilo: busq.estilo, busco: busq.busco, maxPrecio: busq.max }, { timeout: 240000 }); setProps(r.data.propuestas); });
  const añade = (p) => accion('add' + p.id, async () => { const r = await api.post('/mobiliario/' + id + '/propuesta', p, { timeout: 60000 }); setT(x => ({ ...x, productos: [...x.productos, r.data.producto] })); setProps(l => l.filter(k => k.id !== p.id)); flash(r.data.producto.foto ? 'Producto añadido al tablero.' : 'Añadido sin foto (la tienda no la dejó descargar): puedes subirla a mano.'); });
  const combinar = () => accion('combinar', async () => { await api.put('/mobiliario/' + id, { nombre: t.nombre, espacio: t.espacio, productos: t.productos }); const r = await api.post('/mobiliario/' + id + '/combinar', { espacio: t.espacio, cantidad: 3 }, { timeout: 180000 }); setT(r.data.tablero); flash('Combinaciones listas. Crea el moodboard de cada una.'); });
  const moodboard = (c) => accion('mb' + c.id, async () => { await api.put('/mobiliario/' + id, { productos: t.productos, combinaciones: t.combinaciones }); const img = await dibujaMoodboard(c, t.productos); const r = await api.post('/mobiliario/' + id + '/combinaciones/' + c.id + '/moodboard', { imagen: img }); setT(x => ({ ...x, combinaciones: x.combinaciones.map(k => k.id === c.id ? { ...k, moodboard: r.data.moodboard } : k) })); });
  const publicar = (c) => accion('pub' + c.id, async () => { await api.put('/mobiliario/' + id, { productos: t.productos, combinaciones: t.combinaciones }); const r = await api.post('/mobiliario/' + id + '/combinaciones/' + c.id + '/publicar', { proyectoId: t.proyectoId, capituloId: capSel }); setT(x => ({ ...x, combinaciones: x.combinaciones.map(k => k.id === c.id ? r.data.combinacion : k) })); flash('Publicada en la historia del cliente (capítulo oculto hasta que lo muestres).'); });
  const aPresupuesto = (c) => accion('pre' + c.id, async () => { await api.put('/mobiliario/' + id, { productos: t.productos, combinaciones: t.combinaciones }); const r = await api.post('/mobiliario/' + id + '/combinaciones/' + c.id + '/presupuesto', { budgetId: presSel }); flash(r.data.partidas + ' partidas añadidas al presupuesto.'); });
  const pdf = () => accion('pdf', async () => { await api.put('/mobiliario/' + id, { productos: t.productos, combinaciones: t.combinaciones }); const ids = Object.keys(sel).filter(k => sel[k]); const r = await api.post('/mobiliario/' + id + '/pdf', { combinaciones: ids }, { responseType: 'blob', timeout: 120000 }); const a = document.createElement('a'); a.href = URL.createObjectURL(r.data); a.download = (t.nombre || 'combinaciones') + '.pdf'; a.click(); });

  if (!t) return <div className="ap-loading">Cargando…</div>;
  const setProd = (p) => guardaLuego({ ...t, productos: t.productos.map(x => x.id === p.id ? p : x) });
  const borraProd = (p) => guardaLuego({ ...t, productos: t.productos.filter(x => x.id !== p.id), combinaciones: t.combinaciones.map(c => ({ ...c, productos: c.productos.filter(x => x.id !== p.id) })) });
  const btn = (extra) => ({ ...inp, width: 'auto', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, ...extra });

  return (
    <div style={{ padding: '24px 32px 70px', maxWidth: 1300, margin: '0 auto', color: '#fff' }}>
      <button onClick={volver} style={btn({ marginBottom: 12 })}><ArrowLeft size={14} /> Tableros</button>
      {aviso && <div style={{ ...card, marginBottom: 12, borderColor: '#b79a6b' }}>{aviso}</div>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <input style={{ ...inp, maxWidth: 320, fontSize: '1rem', fontWeight: 700 }} value={t.nombre} onChange={e => guardaLuego({ ...t, nombre: e.target.value })} />
        <select style={{ ...inp, maxWidth: 320 }} value={t.proyectoId || ''} onChange={e => { const p = proyectos.find(x => x.id === e.target.value); guardaLuego({ ...t, proyectoId: e.target.value || null, proyecto: p ? (p.client_name + ' · ' + p.project_name) : '' }); }}>
          <option value="">— Sin proyecto del cliente —</option>{proyectos.map(p => <option key={p.id} value={p.id}>{p.client_name} · {p.project_name}</option>)}
        </select>
      </div>
      <textarea style={{ ...inp, minHeight: 54, marginBottom: 14 }} placeholder="Describe el espacio: tipo de local, colores de suelos y paredes, ambiente que buscas… (la IA lo usa para combinar)" value={t.espacio} onChange={e => guardaLuego({ ...t, espacio: e.target.value })} />

      <div style={{ ...card, marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) subir(f); }} />
        <button style={btn({ background: '#b79a6b', color: '#1e1b18', fontWeight: 700 })} onClick={() => fileRef.current.click()} disabled={!!ocupado}>{ocupado === 'subir' ? <Loader2 size={14} className="spin" /> : <Upload size={14} />} Subir fotos de productos</button>
        <span style={mut}>Las nuevas fotos entran como:</span>
        <select style={{ ...inp, width: 'auto' }} value={compraDefecto} onChange={e => setCompraDefecto(e.target.value)}><option value="cliente">Lo compra el cliente</option><option value="ranuse">Lo vendo yo</option></select>
        <button style={btn()} onClick={() => setBusq(b => ({ ...b, abierto: !b.abierto }))} disabled={!!ocupado}><Search size={14} /> Buscar productos por estilo</button>
        <span style={{ flex: 1 }} />
        <button style={btn({ background: '#fff', color: '#1e1b18', fontWeight: 700 })} onClick={combinar} disabled={!!ocupado || t.productos.length < 2}>{ocupado === 'combinar' ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />} Combinar con IA</button>
      </div>

      {busq.abierto && (
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 110px auto', gap: 8, alignItems: 'center' }}>
            <input style={inp} placeholder="Estilo: japandi cálido, madera clara y negro mate…" value={busq.estilo} onChange={e => setBusq({ ...busq, estilo: e.target.value })} />
            <input style={inp} placeholder="Qué busco: 4 sillas, lámpara de pie…" value={busq.busco} onChange={e => setBusq({ ...busq, busco: e.target.value })} />
            <input style={inp} type="number" placeholder="Máx. € pieza" value={busq.max} onChange={e => setBusq({ ...busq, max: e.target.value })} />
            <button style={btn({ background: '#b79a6b', color: '#1e1b18', fontWeight: 700 })} onClick={buscar} disabled={!!ocupado}>{ocupado === 'buscar' ? <Loader2 size={14} className="spin" /> : <Search size={14} />} {ocupado === 'buscar' ? 'Buscando… (1-2 min)' : 'Buscar'}</button>
          </div>
          <div style={{ ...mut, marginTop: 6 }}>Sale con enlace de la tienda. Los precios son de referencia: abre el enlace para comprobar stock y precio.</div>
          {props.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))', gap: 10, marginTop: 12 }}>
              {props.map(p => (
                <div key={p.id} style={{ ...card, padding: '.6rem' }}>
                  {p.imagen ? <img src={p.imagen} alt="" referrerPolicy="no-referrer" style={{ width: '100%', height: 140, objectFit: 'contain', background: '#fff', borderRadius: 8 }} /> : <div style={{ ...mut, height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed rgba(255,255,255,.2)', borderRadius: 8 }}>Sin foto</div>}
                  <div style={{ fontWeight: 600, fontSize: '.82rem', marginTop: 6 }}>{p.nombre}</div>
                  <div style={mut}>{p.tienda}{p.precio > 0 ? ' · ≈ ' + eur(p.precio) : ''}</div>
                  <div style={{ ...mut, margin: '3px 0 6px' }}>{p.motivo}</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button style={btn({ padding: '4px 8px' })} onClick={() => añade(p)} disabled={!!ocupado}>{ocupado === 'add' + p.id ? <Loader2 size={12} className="spin" /> : <Plus size={12} />} Añadir</button>
                    <a href={p.enlace} target="_blank" rel="noreferrer" style={{ ...inp, width: 'auto', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}><ExternalLink size={12} /> Ver</a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(380px,1fr))', gap: 10, marginBottom: 26 }}>
        {t.productos.map(p => <Producto key={p.id} p={p} onChange={setProd} onBorrar={() => borraProd(p)} />)}
        {!t.productos.length && <div style={mut}>Sube fotos de sillas, mesas, lámparas… la IA las lee y las puede combinar.</div>}
      </div>

      {t.combinaciones.length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Combinaciones</h3><span style={{ flex: 1 }} />
          {t.proyectoId && <>
            <select style={{ ...inp, width: 'auto' }} value={capSel} onChange={e => setCapSel(e.target.value)}><option value="nuevo">Historia → capítulo nuevo «Mobiliario y ambientes»</option>{destinos.capitulos.map(c => <option key={c.id} value={c.id}>Historia → {c.titulo}</option>)}</select>
            <select style={{ ...inp, width: 'auto' }} value={presSel} onChange={e => setPresSel(e.target.value)}><option value="">Presupuesto…</option>{destinos.presupuestos.map(b => <option key={b.id} value={b.id}>{b.budget_number || ''} {b.budget_name || ''}</option>)}</select>
          </>}
          <button style={btn()} onClick={pdf} disabled={!!ocupado}><FileDown size={14} /> PDF {Object.values(sel).some(Boolean) ? 'de las marcadas' : 'de todas'}</button>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(440px,1fr))', gap: 14 }}>
        {t.combinaciones.map(c => {
          const prods = c.productos.map(x => t.productos.find(p => p.id === x.id)).filter(Boolean), tot = totales(c, t.productos);
          return (
            <div key={c.id} style={card}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={!!sel[c.id]} onChange={e => setSel({ ...sel, [c.id]: e.target.checked })} title="Incluir en el PDF" />
                <b style={{ flex: 1 }}>{c.titulo}</b>{c.publicada && <span style={{ ...mut, color: '#7bd88f' }}><Check size={12} /> en la historia</span>}
                <button style={btn({ padding: '4px 8px' })} onClick={() => guardaLuego({ ...t, combinaciones: t.combinaciones.filter(k => k.id !== c.id) })}><Trash2 size={12} /></button>
              </div>
              <div style={{ ...mut, margin: '4px 0 8px' }}>{c.idea}</div>
              {c.moodboard ? <img src={c.moodboard} alt="" style={{ width: '100%', borderRadius: 10 }} /> : <div style={{ ...mut, padding: 24, textAlign: 'center', border: '1px dashed rgba(255,255,255,.2)', borderRadius: 10 }}>Sin moodboard todavía</div>}
              <div style={{ display: 'flex', gap: 4, margin: '8px 0' }}>{(c.paleta || []).map((q, k) => <div key={k} title={q.nombre} style={{ width: 28, height: 18, borderRadius: 4, background: q.hex }} />)}</div>
              <div style={{ fontSize: '.78rem', color: 'rgba(255,255,255,.75)', marginBottom: 6 }}>{c.porque}</div>
              {c.evitar && <div style={{ ...mut, marginBottom: 6 }}><b>Cuidar:</b> {c.evitar}</div>}
              {prods.map(p => <div key={p.id} style={{ ...mut, display: 'flex', gap: 6, alignItems: 'center' }}>• {p.nombre} — {p.compra === 'ranuse' ? <span style={{ color: '#e5c98f' }}>Suministra Ranuse {pv(p) > 0 ? eur(pv(p) * p.cantidad) : ''}</span> : <>compra el cliente{p.enlace && <a href={p.enlace} target="_blank" rel="noreferrer" style={{ color: '#7fb4ff' }}><ExternalLink size={11} /></a>}</>}</div>)}
              <div style={{ margin: '8px 0', fontSize: '.8rem' }}>{tot.r > 0 && <div>A cargo de Ranuse: <b>{eur(tot.r)}</b></div>}{tot.k > 0 && <div>Compra el cliente (ref.): <b>≈ {eur(tot.k)}</b></div>}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button style={btn()} onClick={() => moodboard(c)} disabled={!!ocupado}>{ocupado === 'mb' + c.id ? <Loader2 size={13} className="spin" /> : <Img size={13} />} {c.moodboard ? 'Rehacer moodboard' : 'Crear moodboard'}</button>
                {t.proyectoId && c.moodboard && <button style={btn()} onClick={() => publicar(c)} disabled={!!ocupado}><BookOpen size={13} /> A la historia</button>}
                {t.proyectoId && presSel && prods.some(p => p.compra === 'ranuse') && <button style={btn()} onClick={() => aPresupuesto(c)} disabled={!!ocupado}><Receipt size={13} /> Mis productos al presupuesto</button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function SectionMobiliario() {
  const [lista, setLista] = useState(null), [abierto, setAbierto] = useState(null), [nombre, setNombre] = useState('');
  const cargar = () => api.get('/mobiliario').then(r => setLista(r.data.tableros)).catch(() => setLista([]));
  useEffect(() => { cargar(); }, []);
  const crear = async () => { try { const r = await api.post('/mobiliario', { nombre: nombre || 'Tablero nuevo' }); setNombre(''); setAbierto(r.data.tablero.id); } catch { alert('No se pudo crear'); } };
  const borrar = async (t) => { if (!window.confirm('¿Borrar el tablero «' + t.nombre + '» con sus fotos y combinaciones?')) return; await api.delete('/mobiliario/' + t.id).catch(() => {}); cargar(); };
  if (abierto) return <Tablero id={abierto} volver={() => { setAbierto(null); cargar(); }} />;
  return (
    <div style={{ padding: '28px 40px 70px', maxWidth: 1100, margin: '0 auto', color: '#fff' }}>
      <h2 style={{ margin: 0, display: 'flex', gap: 10, alignItems: 'center' }}><Armchair size={24} /> Mobiliario y ambientes</h2>
      <p style={mut}>Sube fotos de sillas, mesas, lámparas… la IA las lee, propone combinaciones con moodboard y las guarda en la historia del cliente.</p>
      <div style={{ display: 'flex', gap: 8, margin: '14px 0 20px' }}>
        <input style={{ ...inp, maxWidth: 300 }} placeholder="Nombre del tablero (p. ej. Zona recepción)" value={nombre} onChange={e => setNombre(e.target.value)} onKeyDown={e => e.key === 'Enter' && crear()} />
        <button onClick={crear} style={{ ...inp, width: 'auto', cursor: 'pointer', background: '#b79a6b', color: '#1e1b18', fontWeight: 700, display: 'inline-flex', gap: 6, alignItems: 'center' }}><Plus size={14} /> Nuevo tablero</button>
      </div>
      {lista === null ? <div className="ap-loading">Cargando…</div> : !lista.length ? <div style={mut}>Todavía no hay tableros.</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 12 }}>
          {lista.map(t => (
            <div key={t.id} style={{ ...card, cursor: 'pointer' }} onClick={() => setAbierto(t.id)}>
              <b>{t.nombre}</b><div style={mut}>{t.proyecto || 'Sin proyecto'}</div>
              <div style={mut}>{t.productos} productos · {t.combinaciones} combinaciones</div>
              <button onClick={e => { e.stopPropagation(); borrar(t); }} style={{ ...inp, width: 'auto', marginTop: 8, cursor: 'pointer' }}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
