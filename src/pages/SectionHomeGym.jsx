import { useEffect, useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import api from '../services/api';
import { TIPOS } from '../utils/homegymMotor';

// Home Gym: solicitudes que llegan de /homegym y qué máquinas del catálogo salen en la herramienta (con su comisión).
const ESTADOS = [['nueva', 'Nueva'], ['en_revision', 'En revisión'], ['enviada_marca', 'Enviada a la marca'], ['cerrada', 'Cerrada'], ['descartada', 'Descartada']];
const eur = n => Math.round(Number(n) || 0).toLocaleString('es-ES') + ' €';
const caja = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '1rem' };
const campo = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, color: '#fff', padding: '6px 8px', fontSize: '0.8rem' };

function Solicitudes() {
  const [lista, setLista] = useState(null);
  const [error, setError] = useState('');
  const cargar = () => api.get('/homegym/solicitudes').then(r => setLista(r.data.solicitudes)).catch(e => { setError(e.response?.data?.error || 'No se pudieron cargar'); setLista([]); });
  useEffect(() => { cargar(); }, []);
  const guarda = async (id, cambios) => {
    setLista(l => l.map(s => (s.id === id ? { ...s, ...cambios } : s)));
    try { await api.put('/homegym/solicitudes/' + id, cambios); } catch { setError('No se pudo guardar el cambio'); cargar(); }
  };
  if (lista === null) return <p style={{ color: 'rgba(255,255,255,0.5)' }}>Cargando…</p>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {error && <p style={{ color: '#ae8b8b' }}>{error}</p>}
      {!lista.length && !error && <div className="ap-empty"><p>Aún no hay solicitudes. Llegarán cuando alguien termine el diseño en /homegym.</p></div>}
      {lista.map(s => (
        <div key={s.id} style={caja}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <b style={{ color: '#baafa5', letterSpacing: '.12em' }}>{s.ref}</b>
              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem', marginLeft: 10 }}>{new Date(s.created_at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}</span>
              <div style={{ fontSize: '1rem', fontWeight: 600, color: '#fff', marginTop: 2 }}>{s.nombre}</div>
              <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.6)' }}>{[s.email, s.telefono].filter(Boolean).join(' · ')}</div>
            </div>
            <select value={s.estado} onChange={e => guarda(s.id, { estado: e.target.value })} style={campo}>
              {ESTADOS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </select>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.6)', margin: '0.6rem 0' }}>
            Sala {((s.espacio?.largo || 0) / 100).toFixed(1)} × {((s.espacio?.ancho || 0) / 100).toFixed(1)} m, techo {((s.espacio?.alto || 0) / 100).toFixed(2)} m · puerta {s.espacio?.puerta} · {s.espacio?.objetivo} · {s.espacio?.personas} persona(s) · presupuesto {eur(s.espacio?.presupuesto)}
          </div>
          <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
            <tbody>
              {(s.items || []).map(i => (
                <tr key={i.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <td style={{ padding: '5px 0', color: '#fff' }}>{i.nombre}<span style={{ color: 'rgba(255,255,255,0.4)' }}>{i.marca ? ' · ' + i.marca : ''}</span> {i.enlace && <a href={i.enlace} target="_blank" rel="noreferrer" style={{ color: '#baafa5' }}><ExternalLink size={11} /></a>}</td>
                  <td style={{ textAlign: 'right', color: 'rgba(255,255,255,0.7)' }}>{eur(i.precio)}</td>
                  <td style={{ textAlign: 'right', color: 'rgba(255,255,255,0.4)', width: 70 }}>{i.comision_pct != null ? i.comision_pct + ' %' : 'sin %'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', justifyContent: 'space-between', margin: '0.6rem 0', fontSize: '0.85rem', color: '#fff' }}>
            <span>Total equipos <b>{eur(s.total)}</b></span><span>Comisión estimada <b style={{ color: '#8bae8f' }}>{eur(s.comision_est)}</b></span>
          </div>
          <textarea defaultValue={s.nota_equipo || ''} placeholder="Notas del equipo (revisión, plazos, qué se acordó)…" rows={2} style={{ ...campo, width: '100%' }}
            onBlur={e => { if (e.target.value !== (s.nota_equipo || '')) guarda(s.id, { nota_equipo: e.target.value }); }} />
        </div>
      ))}
    </div>
  );
}

function Catalogo() {
  const [prods, setProds] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [solo, setSolo] = useState(false);
  useEffect(() => { api.get('/homegym/admin/catalogo').then(r => setProds(r.data.productos)).catch(e => { setError(e.response?.data?.error || 'No se pudo cargar'); setProds([]); }); }, []);
  const guarda = async (p, cambios) => {
    const n = { ...p, ...cambios };
    setProds(l => l.map(x => (x.id === p.id ? n : x)));
    try { await api.put('/homegym/admin/catalogo/' + p.id, { tipo: n.homegym_tipo || null, orden: n.homegym_orden || 0, comision: n.homegym_comision ?? '' }); }
    catch { setError('No se pudo guardar'); }
  };
  const vista = useMemo(() => (prods || []).filter(p => (!solo || p.homegym_tipo) && (`${p.name} ${p.brand || ''}`).toLowerCase().includes(q.toLowerCase())), [prods, q, solo]);
  if (prods === null) return <p style={{ color: 'rgba(255,255,255,0.5)' }}>Cargando…</p>;
  const activas = prods.filter(p => p.homegym_tipo).length;
  return (
    <div>
      {error && <p style={{ color: '#ae8b8b' }}>{error}</p>}
      <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.8rem', margin: '0 0 0.8rem' }}>
        Elige de qué tipo es cada máquina para que salga en la herramienta. Solo salen las que tienen largo, ancho y alto. «Versión» 0 = la normal; 1 o 2 = alternativas compactas o de techo bajo. La comisión solo la ve el equipo. Ahora salen {activas}.
      </p>
      <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar máquina o marca…" style={{ ...campo, width: 260 }} />
        <label style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.6)' }}><input type="checkbox" checked={solo} onChange={e => setSolo(e.target.checked)} /> Solo las que salen</label>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead><tr style={{ color: 'rgba(255,255,255,0.4)', textAlign: 'left' }}><th>Máquina</th><th>Medidas (cm)</th><th>Precio</th><th>Tipo en Home Gym</th><th>Versión</th><th>Comisión %</th></tr></thead>
          <tbody>{vista.slice(0, 300).map(p => (
            <tr key={p.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: p.homegym_tipo ? 'rgba(186,175,165,0.07)' : 'transparent' }}>
              <td style={{ padding: '6px 0', color: '#fff' }}>{p.name}<span style={{ color: 'rgba(255,255,255,0.4)' }}>{p.brand ? ' · ' + p.brand : ''}</span></td>
              <td style={{ color: Number(p.longitud) > 0 && Number(p.ancho) > 0 && Number(p.altura) > 0 ? 'rgba(255,255,255,0.7)' : '#ae8b8b' }}>{p.longitud || '?'}×{p.ancho || '?'}×{p.altura || '?'}</td>
              <td style={{ color: 'rgba(255,255,255,0.7)' }}>{eur(p.price)}</td>
              <td><select value={p.homegym_tipo || ''} onChange={e => guarda(p, { homegym_tipo: e.target.value || null })} style={campo}><option value="">— no sale —</option>{Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v.n}</option>)}</select></td>
              <td><select value={p.homegym_orden || 0} disabled={!p.homegym_tipo} onChange={e => guarda(p, { homegym_orden: +e.target.value })} style={campo}>{[0, 1, 2].map(n => <option key={n} value={n}>{n}</option>)}</select></td>
              <td><input type="number" min="0" max="100" step="0.5" disabled={!p.homegym_tipo} defaultValue={p.homegym_comision ?? ''} style={{ ...campo, width: 70 }}
                onBlur={e => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== (p.homegym_comision ?? null)) guarda(p, { homegym_comision: v }); }} /></td>
            </tr>))}</tbody>
        </table>
      </div>
      {vista.length > 300 && <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem' }}>Se muestran las primeras 300. Usa el buscador.</p>}
    </div>
  );
}

export function SectionHomeGym() {
  const [tab, setTab] = useState('solicitudes');
  return (
    <div>
      <div className="ap-section-head">
        <div>
          <h1>Home Gym</h1>
          <p>Solicitudes de equipamiento que llegan de la herramienta pública y qué máquinas salen en ella.</p>
        </div>
        <a className="ap-btn ap-btn-ghost ap-btn-sm" href="/homegym" target="_blank" rel="noreferrer"><ExternalLink size={13} /> Abrir la herramienta</a>
      </div>
      <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 3, width: 'fit-content', marginBottom: '1rem' }}>
        {[['solicitudes', 'Solicitudes'], ['catalogo', 'Catálogo y comisiones']].map(([k, n]) => (
          <button key={k} onClick={() => setTab(k)} style={{ padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: '0.8rem', background: tab === k ? '#baafa5' : 'transparent', color: tab === k ? '#0a0a0a' : 'rgba(255,255,255,0.5)', fontWeight: tab === k ? 600 : 400 }}>{n}</button>
        ))}
      </div>
      {tab === 'solicitudes' ? <Solicitudes /> : <Catalogo />}
    </div>
  );
}
