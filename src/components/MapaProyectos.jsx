import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, Search, ArrowRight, Package } from 'lucide-react';
import api from '../services/api';

// Mapa de obras: cada proyecto en su sitio (España, Panamá, Marruecos…) con el color de cómo va y, al pulsarlo, el recorrido de sus pedidos
// (por pedir → pedido → en preparación → en camino → entregado, falta montar → montado). Abajo, el tablero de pedidos por estado.
const LUZ = { rojo: '#ff6b57', ambar: '#ffb347', gris: '#8f8a85', verde: '#4be3a0' };
const ESTADOS = [
  { k: 'pendiente', t: 'Por pedir', c: '#9aa0a6' },
  { k: 'pedido', t: 'Pedido', c: '#8b9eae' },
  { k: 'preparacion', t: 'En preparación', c: '#e0b25a' },
  { k: 'transito', t: 'En camino', c: '#6fb3e0' },
  { k: 'entregado', t: 'Entregado · falta montar', c: '#c79bff' },
  { k: 'montado', t: 'Montado', c: '#4be3a0' },
];
const vidrio = { background: 'rgba(12,12,16,0.86)', border: '1px solid rgba(186,175,165,0.28)', borderRadius: 14, backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', color: '#fff' };
const mut = { fontSize: '0.72rem', color: 'rgba(255,255,255,0.55)' };
const fmt = (iso, hoy) => {
  if (!iso) return '';
  const d = Math.round((new Date(iso + 'T12:00:00') - new Date(hoy + 'T12:00:00')) / 86400000);
  const base = new Date(iso + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  return d === 0 ? 'Hoy' : d === 1 ? 'Mañana' : d < 0 ? base + ' (pasada)' : base + ' (' + d + ' d)';
};
const Barra = ({ estados, total }) => (
  <div style={{ display: 'flex', height: 8, borderRadius: 6, overflow: 'hidden', background: 'rgba(255,255,255,0.08)' }}>
    {ESTADOS.map(e => (estados[e.k] ? <div key={e.k} title={e.t + ': ' + estados[e.k]} style={{ width: (estados[e.k] / Math.max(1, total) * 100) + '%', background: e.c }} /> : null))}
  </div>
);

export function MapaProyectos({ data, ir }) {
  const [mapa, setMapa] = useState(null), [error, setError] = useState(''), [sel, setSel] = useState(null), [tablero, setTablero] = useState(true);
  const [editando, setEditando] = useState(null), [ciudad, setCiudad] = useState(''), [pais, setPais] = useState(''), [buscando, setBuscando] = useState(false), [aviso, setAviso] = useState('');
  const caja = useRef(null), mapRef = useRef(null), capaRef = useRef(null);

  const cargar = () => api.get('/oficinas/mapa').then(r => { setMapa(r.data); setError(''); }).catch(e => setError(e.response?.data?.error || 'No se pudo cargar el mapa'));
  useEffect(() => { cargar(); }, []);

  const luz = useMemo(() => { const m = {}; (data?.proyectos || []).forEach(p => { m[p.id] = p; }); return m; }, [data]);
  const proyectos = mapa?.proyectos || [], ubicados = proyectos.filter(p => p.lat !== null), sinUbicar = proyectos.filter(p => p.lat === null);
  const actual = proyectos.find(p => p.id === sel) || null;

  // el mapa: se crea una vez; oscuro, para que combine con el resto del programa
  useEffect(() => {
    if (!caja.current || mapRef.current) return undefined;
    const m = L.map(caja.current, { zoomControl: false, worldCopyJump: true, minZoom: 2 }).setView([30, -5], 3);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 18 }).addTo(m);
    capaRef.current = L.layerGroup().addTo(m); mapRef.current = m;
    setTimeout(() => m.invalidateSize(), 60);
    return () => { m.remove(); mapRef.current = null; };
  }, []);

  // un pin por obra: color = cómo va el proyecto; número = piezas que aún no están montadas
  useEffect(() => {
    const m = mapRef.current, capa = capaRef.current; if (!m || !capa) return;
    capa.clearLayers();
    ubicados.forEach(p => {
      const col = LUZ[luz[p.id]?.semaforo || 'gris'], pend = p.pedidos.total - p.pedidos.estados.montado, activo = p.id === sel;
      const html = '<div style="position:relative;width:' + (activo ? 46 : 38) + 'px;height:' + (activo ? 46 : 38) + 'px"><div style="position:absolute;inset:0;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:' + col + ';border:3px solid #fff;box-shadow:0 4px 16px rgba(0,0,0,.6)"></div><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#111;font:800 ' + (activo ? 15 : 13) + 'px Montserrat,Arial,sans-serif;padding-bottom:4px">' + (pend > 0 ? pend : '✓') + '</div></div>';
      const mk = L.marker([p.lat, p.lng], { icon: L.divIcon({ html, className: '', iconSize: [38, 38], iconAnchor: [19, 38] }), title: p.nombre }).addTo(capa);
      mk.on('click', () => setSel(p.id));
      L.tooltip({ permanent: !activo ? false : true, direction: 'top', offset: [0, -34], opacity: 0.95 }).setContent(p.nombre).setLatLng([p.lat, p.lng]).addTo(capa);
    });
  }, [mapa, sel, luz]); // eslint-disable-line react-hooks/exhaustive-deps

  // al abrir, se encuadran todas las obras; al elegir una, el mapa vuela hasta ella
  const encuadrado = useRef(false);
  useEffect(() => { const m = mapRef.current; if (!m || encuadrado.current || !ubicados.length) return; encuadrado.current = true; m.fitBounds(L.latLngBounds(ubicados.map(p => [p.lat, p.lng])), { paddingTopLeft: [400, 100], paddingBottomRight: [60, 270], maxZoom: 6 }); }, [mapa]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const m = mapRef.current; if (m && actual && actual.lat !== null) m.flyTo([actual.lat, actual.lng], Math.max(m.getZoom(), 6), { duration: 0.8 }); }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  const ubicar = async (p) => {
    if (!ciudad.trim()) { setAviso('Escribe la ciudad de la obra'); return; }
    setBuscando(true); setAviso('');
    try { await api.put('/oficinas/ubicacion/' + p.id, { ciudad, pais }); setEditando(null); setCiudad(''); setPais(''); await cargar(); setSel(p.id); }
    catch (e) { setAviso(e.response?.data?.error || 'No se pudo ubicar'); }
    setBuscando(false);
  };
  const abrirEditar = (p) => { setEditando(p.id); setCiudad(p.ciudad || p.ciudadCliente || ''); setPais(p.pais || ''); setAviso(''); };
  const formUbicar = (p) => (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={ciudad} onChange={e => setCiudad(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') ubicar(p); }} placeholder="Ciudad (ej. Panamá)" style={{ flex: 1, minWidth: 0, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)', color: '#fff', borderRadius: 8, padding: '7px 9px', fontSize: '0.8rem' }} />
        <input value={pais} onChange={e => setPais(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') ubicar(p); }} placeholder="País" style={{ width: 90, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)', color: '#fff', borderRadius: 8, padding: '7px 9px', fontSize: '0.8rem' }} />
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
        <button className="ap-btn ap-btn-primary ap-btn-sm" disabled={buscando} onClick={() => ubicar(p)}><Search size={12} /> {buscando ? 'Buscando…' : 'Ubicar'}</button>
        <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => setEditando(null)}>Cancelar</button>
        {aviso && <span style={{ color: LUZ.rojo, fontSize: '0.72rem' }}>{aviso}</span>}
      </div>
    </div>
  );

  // tablero de pedidos: una columna por estado con las obras que tienen piezas en ese estado
  const columnas = ESTADOS.map(e => ({ ...e, filas: proyectos.map(p => ({ p, n: p.pedidos.estados[e.k] })).filter(x => x.n > 0) }));

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 2 }}>
      <style>{'.mp-oscuro .leaflet-tile-pane{filter:invert(1) hue-rotate(200deg) brightness(.9) contrast(.92) saturate(.55)} .mp-oscuro .leaflet-container{background:#0c0c10} .mp-oscuro .leaflet-control-attribution{background:rgba(12,12,16,.7);color:#8f8a85} .mp-oscuro .leaflet-control-attribution a{color:#baafa5} .mp-oscuro .leaflet-bar a{background:#1a1a20;color:#fff;border-color:#333}'}</style>
      <div ref={caja} className="mp-oscuro" style={{ position: 'absolute', inset: 0, background: '#0c0c10' }} />

      {/* lista de obras */}
      <div style={{ ...vidrio, position: 'absolute', top: 76, left: 14, width: 'min(340px, calc(100% - 28px))', maxHeight: tablero ? 'calc(100% - 330px)' : 'calc(100% - 140px)', display: 'flex', flexDirection: 'column', zIndex: 500, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <b style={{ fontSize: '0.98rem' }}>Obras en el mapa</b>
          <div style={mut}>{ubicados.length} ubicadas · {sinUbicar.length} sin ubicar</div>
          {error && <div style={{ color: LUZ.rojo, fontSize: '0.75rem', marginTop: 4 }}>{error}</div>}
          {mapa && mapa.ubicaciones === false && <div style={{ color: LUZ.ambar, fontSize: '0.74rem', marginTop: 6, lineHeight: 1.45 }}>Falta un paso: ejecuta en Supabase el archivo <b>supabase_migration_v96.sql</b> para poder guardar la ubicación de cada obra.</div>}
        </div>
        <div style={{ overflowY: 'auto', padding: '8px 12px 14px' }}>
          {!mapa && !error && <p style={mut}>Cargando…</p>}
          {[...ubicados, ...sinUbicar].map(p => {
            const l = luz[p.id], col = LUZ[l?.semaforo || 'gris'], pend = p.pedidos.total - p.pedidos.estados.montado, ub = p.lat !== null;
            return (
              <div key={p.id} onClick={() => ub && setSel(p.id)} style={{ padding: '11px 13px', margin: '6px 0', borderRadius: 12, cursor: ub ? 'pointer' : 'default', background: sel === p.id ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)', borderLeft: '3px solid ' + col }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <MapPin size={14} color={ub ? col : '#8f8a85'} />
                  <b style={{ fontSize: '0.86rem', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nombre}</b>
                  {pend > 0 && <span style={{ ...mut, border: '1px solid rgba(255,255,255,0.18)', borderRadius: 6, padding: '1px 7px' }}>{pend} pend.</span>}
                </div>
                <div style={{ ...mut, marginTop: 3 }}>{ub ? [p.ciudad, p.pais].filter(Boolean).join(', ') : p.ciudadCliente ? 'Sin ubicar · ciudad del cliente: ' + p.ciudadCliente : 'Sin ubicar'}</div>
                {!ub && editando !== p.id && <button className="ap-btn ap-btn-ghost ap-btn-xs" style={{ marginTop: 8 }} onClick={e => { e.stopPropagation(); abrirEditar(p); }}><MapPin size={11} /> Ubicar en el mapa</button>}
                {!ub && editando === p.id && formUbicar(p)}
              </div>
            );
          })}
        </div>
      </div>

      {/* ficha de la obra elegida: recorrido de sus pedidos */}
      {actual && (
        <div style={{ ...vidrio, position: 'absolute', top: 76, right: 14, width: 'min(380px, calc(100% - 28px))', maxHeight: tablero ? 'calc(100% - 330px)' : 'calc(100% - 140px)', overflowY: 'auto', zIndex: 500, padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}><b style={{ fontSize: '1.02rem' }}>{actual.nombre}</b><div style={mut}>{actual.cliente} · {[actual.ciudad, actual.pais].filter(Boolean).join(', ')}</div></div>
            <button onClick={() => setSel(null)} aria-label="Cerrar" style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 18 }}>×</button>
          </div>
          {luz[actual.id] && <div style={{ marginTop: 8, fontSize: '0.8rem', color: LUZ[luz[actual.id].semaforo] }}>{luz[actual.id].motivo}</div>}
          <div style={{ marginTop: 14 }}>
            <div style={{ ...mut, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Pedidos · {actual.pedidos.total} piezas</div>
            {actual.pedidos.total === 0 ? <div style={mut}>Este proyecto aún no tiene piezas en pedidos (se crean al aprobar el presupuesto).</div> : (
              <>
                <Barra estados={actual.pedidos.estados} total={actual.pedidos.total} />
                <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
                  {ESTADOS.map(e => (
                    <div key={e.k} style={{ display: 'flex', alignItems: 'center', gap: 9, opacity: actual.pedidos.estados[e.k] ? 1 : 0.4, fontSize: '0.8rem' }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: e.c, flexShrink: 0 }} /><span style={{ flex: 1 }}>{e.t}</span><b>{actual.pedidos.estados[e.k]}</b>
                    </div>
                  ))}
                </div>
                {actual.pedidos.proximaEntrega && <div style={{ marginTop: 10, fontSize: '0.78rem' }}>Próxima entrega: <b>{fmt(actual.pedidos.proximaEntrega, mapa.hoy)}</b></div>}
                {(actual.pedidos.grupos || []).length > 0 && (
                  <>
                    <div style={{ marginTop: 14, ...mut, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Pedidos hechos</div>
                    {actual.pedidos.grupos.map(g => {
                      const k = ESTADOS.slice().reverse().find(e => g.estados[e.k] === g.n) || null, rec = g.estados.entregado + g.estados.montado;
                      const dom = k || ESTADOS.find(e => g.estados[e.k] > 0);
                      return (
                        <div key={g.ref} style={{ marginTop: 8, padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.05)', borderLeft: '4px solid ' + (dom ? dom.c : '#baafa5') }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: '0.82rem' }}><b>{g.ref}</b><span style={{ color: dom ? dom.c : '#fff', fontWeight: 600 }}>{k ? k.t : 'Estados distintos'}</span></div>
                          <div style={{ ...mut, marginTop: 3 }}>{g.proveedor} · {g.n} pieza{g.n === 1 ? '' : 's'} · {rec} de {g.n} entregada{rec === 1 ? '' : 's'}{g.entrega ? ' · entrega ' + fmt(g.entrega, mapa.hoy) : ''}</div>
                          <div style={{ marginTop: 6 }}><Barra estados={g.estados} total={g.n} /></div>
                        </div>
                      );
                    })}
                  </>
                )}
                {actual.pedidos.sinPedir > 0 && <div style={{ marginTop: 10, padding: '8px 11px', borderRadius: 10, background: 'rgba(154,160,166,0.14)', fontSize: '0.78rem' }}>Sin pedir todavía: <b>{actual.pedidos.sinPedir}</b> pieza{actual.pedidos.sinPedir === 1 ? '' : 's'}</div>}
                <div style={{ marginTop: 14, ...mut, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Por proveedor</div>
                {actual.pedidos.proveedores.map(pv => (
                  <div key={pv.nombre} style={{ marginTop: 8, padding: '9px 11px', borderRadius: 10, background: 'rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}><b>{pv.nombre}</b><span style={mut}>{pv.n} pieza{pv.n === 1 ? '' : 's'}</span></div>
                    <div style={{ marginTop: 6 }}><Barra estados={pv.estados} total={pv.n} /></div>
                  </div>
                ))}
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
            <button className="ap-btn ap-btn-primary ap-btn-sm" onClick={() => ir('pedidos')}><Package size={12} /> Ver pedidos <ArrowRight size={12} /></button>
            <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => abrirEditar(actual)}><MapPin size={12} /> Cambiar ubicación</button>
          </div>
          {editando === actual.id && formUbicar(actual)}
        </div>
      )}

      {/* tablero de pedidos por estado */}
      <div style={{ position: 'absolute', left: 14, right: 14, bottom: 34, zIndex: 500 }}>
        {!tablero && <button onClick={() => setTablero(true)} style={{ ...vidrio, padding: '8px 16px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>▲ Tablero de pedidos</button>}
        {tablero && (
          <div style={{ ...vidrio, padding: '12px 14px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}><b style={{ fontSize: '0.9rem', flex: 1 }}>Tablero de pedidos</b><button onClick={() => setTablero(false)} style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '0.8rem' }}>▼ Ocultar</button></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(130px, 1fr))', gap: 8, overflowX: 'auto' }}>
              {columnas.map(c => (
                <div key={c.k} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: '8px 9px', borderTop: '3px solid ' + c.c, minHeight: 92, maxHeight: 150, overflowY: 'auto' }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: 700, color: c.c, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{c.t} <span style={{ opacity: 0.7 }}>· {c.filas.reduce((a, x) => a + x.n, 0)}</span></div>
                  {c.filas.length === 0 && <div style={{ ...mut, fontSize: '0.7rem' }}>—</div>}
                  {c.filas.map(({ p, n }) => (
                    <div key={p.id} onClick={() => p.lat !== null && setSel(p.id)} style={{ fontSize: '0.74rem', padding: '5px 7px', marginBottom: 4, borderRadius: 7, background: 'rgba(255,255,255,0.07)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nombre}</span><b>{n}</b>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
