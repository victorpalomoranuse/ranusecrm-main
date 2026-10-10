import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import api from '../services/api';

// Presupuestos: trae las cantidades medidas en los planos del proyecto
// (equipamiento y luminarias del catálogo, más metros cuadrados de reforma)
// para añadirlas como partidas sin tener que contarlas a mano.

const muted = { fontSize: '0.74rem', color: 'rgba(255,255,255,0.45)' };

export function CantidadesPlanos({ projectId, onClose, onAdd }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [marcadas, setMarcadas] = useState({});
  const [cantidades, setCantidades] = useState({});
  const [enviando, setEnviando] = useState(false);

  const cargar = (planoId) => api.get('/medicion/cantidades', { params: { project_id: projectId, plano_id: planoId } })
    .then(r => {
      setDatos(r.data); setError('');
      const m = {}, c = {};
      (r.data.filas || []).forEach((f, i) => { m[i] = true; c[i] = f.cantidad; });
      setMarcadas(m); setCantidades(c);
    })
    .catch(e => setError(e.response?.data?.error || 'No se pudieron cargar los planos'));
  useEffect(() => { cargar(); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const filas = datos?.filas || [];
  const grupos = [...new Set(filas.map(f => f.grupo))];
  const seleccion = filas.map((f, i) => ({ ...f, cantidad: parseFloat(String(cantidades[i]).replace(',', '.')) || 0, i })).filter(f => marcadas[f.i] && f.cantidad > 0);

  const añadir = async () => {
    setEnviando(true);
    try { await onAdd(seleccion); onClose(); }
    catch { setError('No se pudieron añadir todas las partidas'); setEnviando(false); }
  };

  return (
    <div className="ap-modal-overlay" onClick={onClose}>
      <div className="ap-mgr-modal" style={{ maxWidth: 680 }} onClick={e => e.stopPropagation()}>
        <div className="ap-mgr-head">
          <div>
            <h2 className="ap-mgr-title">Cantidades desde los planos</h2>
            <p className="ap-mgr-sub">{datos?.plano ? `Plano: ${datos.plano.nombre}` : 'Proyecto vinculado'}</p>
          </div>
          <button className="ap-modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="ap-mgr-body">
          {error && <p className="ap-error">{error}</p>}
          {!datos && !error && <p style={muted}>Cargando…</p>}
          {datos && datos.planos.length > 1 && (
            <label style={{ ...muted, display: 'block', marginBottom: 10 }}>Plano:&nbsp;
              <select className="pres-cell-select" value={datos.plano?.id || ''} onChange={e => cargar(e.target.value)}>
                {datos.planos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </label>
          )}
          {datos && !datos.plano && <p style={muted}>Este proyecto todavía no tiene planos con medidas. Dibújalos en la pestaña «Planos» del proyecto.</p>}
          {datos && datos.plano && !filas.length && <p style={muted}>El plano no tiene todavía equipamiento, luminarias ni materiales marcados.</p>}
          {grupos.map(g => (
            <div key={g} style={{ marginBottom: 14 }}>
              <p style={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.35)', margin: '0 0 6px' }}>{g}</p>
              {filas.map((f, i) => f.grupo !== g ? null : (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <input type="checkbox" checked={!!marcadas[i]} onChange={() => setMarcadas(m => ({ ...m, [i]: !m[i] }))} />
                  <div style={{ flex: 1, minWidth: 0, fontSize: '0.84rem' }}>
                    {f.nombre}
                    {f.tipo === 'catalogo' && f.producto?.price != null && <span style={{ ...muted, marginLeft: 8 }}>{f.producto.price} € en catálogo</span>}
                    {f.aviso && <span style={{ ...muted, marginLeft: 8, color: '#e0a24a' }}>{f.aviso}</span>}
                    {f.tipo === 'libre' && !f.aviso && <span style={{ ...muted, marginLeft: 8 }}>partida sin precio</span>}
                  </div>
                  <input className="pres-cell-input" style={{ width: 70, textAlign: 'right' }} value={cantidades[i] ?? ''} onChange={e => setCantidades(c => ({ ...c, [i]: e.target.value }))} />
                  <span style={{ ...muted, width: 30 }}>{f.unidad}</span>
                </div>
              ))}
            </div>
          ))}
          {datos?.plano && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
              <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={onClose}>Cancelar</button>
              <button className="ap-btn ap-btn-primary ap-btn-sm" disabled={!seleccion.length || enviando} onClick={añadir}>
                {enviando ? 'Añadiendo…' : `Añadir ${seleccion.length} partida${seleccion.length === 1 ? '' : 's'}`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
