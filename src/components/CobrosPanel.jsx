import { useEffect, useState, useCallback } from 'react';
import api from '../services/api';

const eur = n => (Number(n) || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const COL = { cobrado: '#8bae8f', vencido: '#e08a82', facturado: '#8b9eae', pendiente: '#baafa5' };
const NOMBRE = { cobrado: 'Cobrado', vencido: 'Vencido', facturado: 'Facturado', pendiente: 'Pendiente' };
const METODOS = ['Transferencia', 'Bizum', 'Tarjeta', 'Efectivo'];
const inp = { background: '#0f0f0f', color: '#fff', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '4px 7px', fontSize: '0.75rem', minWidth: 0 };

/** Barra fina de % cobrado (la usa la lista de presupuestos y el panel). */
export function BarraCobro({ cobrado = 0, total = 0, ancho = 70 }) {
  const pct = total > 0 ? Math.round(cobrado * 100 / total) : 0;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: ancho, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', overflow: 'hidden', display: 'inline-block' }}><span style={{ display: 'block', width: pct + '%', height: '100%', background: '#8bae8f' }} /></span>
      <span style={{ fontSize: '0.74rem', fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
    </span>
  );
}

/**
 * Cobros del cliente. Con `presupuestoId` muestra los hitos de ese presupuesto; con `proyectoId`, los de todo el proyecto (suma de sus presupuestos).
 * Solo lo ve quien tenga permiso de finanzas: si la API responde 403, no pinta nada.
 */
export default function CobrosPanel({ presupuestoId, proyectoId, onCambio }) {
  const [d, setD] = useState(null);
  const [prohibido, setProhibido] = useState(false);
  const [abierto, setAbierto] = useState(null); // hito en el que se está marcando el cobro
  const [form, setForm] = useState({});
  const [err, setErr] = useState('');
  const url = presupuestoId ? '/cobros/presupuesto/' + presupuestoId : '/cobros/proyecto/' + proyectoId;

  const carga = useCallback(() => {
    api.get(url).then(r => setD(r.data)).catch(e => { if (e?.response?.status === 403) setProhibido(true); });
  }, [url]);
  useEffect(() => { setD(null); carga(); }, [carga]);

  const guarda = async (id, cambios) => {
    setErr('');
    try { await api.put('/cobros/hito/' + id, cambios); setAbierto(null); carga(); onCambio?.(); }
    catch (e) { setErr(e?.response?.data?.error || 'No se pudo guardar'); }
  };
  const avance = async v => { try { const pid = d.project_id || proyectoId; await api.put('/cobros/proyecto/' + pid + '/avance', { avance: v }); carga(); } catch { setErr('No se pudo guardar el avance'); } };

  if (prohibido || !d) return null;
  const hitos = d.hitos || [];
  if (!hitos.length) return <div style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.45)', padding: '6px 0' }}>Los hitos de cobro se crean al aprobar el presupuesto (debe estar vinculado a un proyecto).</div>;
  const pid = d.project_id || proyectoId;
  const aviso = d.aviso || (d.avance > d.pct ? { texto: `La obra va al ${d.avance}% y solo se ha cobrado el ${d.pct}%.` } : null);

  return (
    <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '12px 14px', background: 'rgba(255,255,255,0.03)', width: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <b style={{ fontSize: '0.85rem' }}>Cobros del cliente</b>
        <span style={{ fontSize: '0.78rem', color: '#8bae8f' }}>Cobrado {eur(d.cobrado)}</span>
        <span style={{ fontSize: '0.78rem', color: '#baafa5' }}>Pendiente {eur(d.pendiente)}</span>
        <BarraCobro cobrado={d.cobrado} total={d.total} ancho={110} />
        <span style={{ fontSize: '0.66rem', color: 'rgba(255,255,255,0.35)' }}>importes sin IVA</span>
      </div>
      {aviso && <div style={{ background: 'rgba(224,138,130,0.12)', border: '1px solid rgba(224,138,130,0.4)', color: '#f0b2ab', borderRadius: 8, padding: '6px 10px', fontSize: '0.78rem', marginBottom: 8 }}>⚠ {aviso.texto} Toca cobrar el siguiente hito.</div>}
      {pid && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.76rem', marginBottom: 8, color: 'rgba(255,255,255,0.7)' }}>
          Avance de obra
          <input type="range" min="0" max="100" step="5" value={d.avance || 0} onChange={e => setD(x => ({ ...x, avance: parseInt(e.target.value) }))} onMouseUp={e => avance(parseInt(e.target.value))} onTouchEnd={e => avance(parseInt(e.target.value))} onKeyUp={e => avance(parseInt(e.target.value))} style={{ flex: 1, maxWidth: 220 }} />
          <b style={{ minWidth: 34 }}>{d.avance || 0}%</b>
        </label>
      )}
      {hitos.map(h => {
        const c = COL[h.estado_visible] || '#baafa5';
        return (
          <div key={h.id} style={{ borderTop: '1px solid rgba(255,255,255,0.07)', padding: '7px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: '0.8rem' }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: c, flex: 'none' }} />
              <span style={{ flex: 1, minWidth: 140 }}>{h.orden}. {h.concepto} <span style={{ opacity: 0.5 }}>· {h.porcentaje}%</span>
                {h.disparador === 'avance_obra' && h.estado !== 'cobrado' && <span style={{ marginLeft: 6, fontSize: '0.68rem', color: h.listo ? '#8bae8f' : 'rgba(255,255,255,0.4)' }}>{h.listo ? '● listo para cobrar' : '○ al ' + h.avance_minimo + '% de obra'}</span>}
              </span>
              <b style={{ fontVariantNumeric: 'tabular-nums' }}>{eur(h.importe)}</b>
              <input type="date" value={h.fecha_prevista || ''} onChange={e => guarda(h.id, { fecha_prevista: e.target.value })} title="Fecha prevista de cobro" style={{ ...inp, width: 124 }} />
              <span style={{ color: c, fontSize: '0.72rem', minWidth: 62, textAlign: 'right' }}>{NOMBRE[h.estado_visible] || h.estado_visible}{h.estado === 'cobrado' && h.fecha_cobro ? ' ' + h.fecha_cobro.slice(5).split('-').reverse().join('/') : ''}</span>
              {h.estado === 'cobrado'
                ? <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" style={{ fontSize: '0.68rem' }} onClick={() => { if (window.confirm('¿Deshacer este cobro? También se quita el ingreso que se apuntó en Finanzas.')) guarda(h.id, { estado: 'pendiente' }); }}>Deshacer</button>
                : <>
                    {h.estado === 'pendiente' && <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" style={{ fontSize: '0.68rem' }} onClick={() => guarda(h.id, { estado: 'facturado' })}>Facturado</button>}
                    <button type="button" className="ap-btn ap-btn-primary ap-btn-sm" style={{ fontSize: '0.68rem' }} onClick={() => { setAbierto(abierto === h.id ? null : h.id); setForm({ fecha: new Date().toISOString().slice(0, 10), metodo: h.metodo || 'Transferencia', factura: h.num_factura || '' }); }}>Cobrado</button>
                  </>}
            </div>
            {abierto === h.id && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 6, paddingLeft: 16 }}>
                <input type="date" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} style={inp} />
                <select value={form.metodo} onChange={e => setForm(f => ({ ...f, metodo: e.target.value }))} style={inp}>{METODOS.map(m => <option key={m}>{m}</option>)}</select>
                <input placeholder="Nº de factura" value={form.factura} onChange={e => setForm(f => ({ ...f, factura: e.target.value }))} style={{ ...inp, width: 130 }} />
                <button type="button" className="ap-btn ap-btn-primary ap-btn-sm" style={{ fontSize: '0.7rem' }} onClick={() => guarda(h.id, { estado: 'cobrado', fecha_cobro: form.fecha, metodo: form.metodo, num_factura: form.factura })}>Confirmar cobro</button>
              </div>
            )}
            {h.estado === 'cobrado' && (h.metodo || h.num_factura) && <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)', paddingLeft: 16 }}>{[h.metodo, h.num_factura && 'Factura ' + h.num_factura].filter(Boolean).join(' · ')}</div>}
          </div>
        );
      })}
      {err && <div style={{ color: '#e08a82', fontSize: '0.74rem', marginTop: 6 }}>{err}</div>}
    </div>
  );
}
