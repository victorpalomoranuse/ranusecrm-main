import { useState, useEffect } from 'react';
import api from '../services/api';
import { Hammer, ArrowLeft, Plus, Trash2 } from 'lucide-react';

function fmt(n) {
  return Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}

const CATEGORIAS_GASTO = ['Materiales', 'Mano de obra', 'Transporte', 'Instalaciones', 'Otros'];

function PagoRow({ pago, onDelete, onSavedProveedor }) {
  const [proveedor, setProveedor] = useState(pago.proveedor || '');
  const [saving, setSaving] = useState(false);

  const handleBlur = async () => {
    if (proveedor === (pago.proveedor || '')) return;
    setSaving(true);
    try {
      await api.put(`/finanzas/${pago.id}`, { proveedor: proveedor || null });
      onSavedProveedor?.();
    } catch {} finally { setSaving(false); }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, padding: '6px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: 8 }}>
      <span style={{ flex: 1 }}>{pago.concepto}</span>
      <input
        className="ap-field-input"
        value={proveedor}
        onChange={e => setProveedor(e.target.value)}
        onBlur={handleBlur}
        placeholder="Sin proveedor"
        style={{ maxWidth: 140, fontSize: 12, padding: '4px 8px', opacity: saving ? 0.5 : 1 }}
      />
      <span style={{ color: 'rgba(255,255,255,0.4)' }}>{pago.fecha?.slice(0, 10)}</span>
      <span style={{ color: '#ae6b6b', minWidth: 70, textAlign: 'right' }}>-{fmt(pago.monto)}</span>
      <button className="ap-btn-icon" onClick={() => onDelete(pago.id)}><Trash2 size={12} /></button>
    </div>
  );
}

function DetalleObra({ ventaId, onBack, onChanged }) {
  const [rel, setRel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [proveedor, setProveedor] = useState('');
  const [concepto, setConcepto] = useState('');
  const [categoria, setCategoria] = useState('Materiales');
  const [monto, setMonto] = useState('');
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [guardando, setGuardando] = useState(false);

  const cargar = () => {
    setLoading(true);
    api.get(`/obra/${ventaId}`).then(r => setRel(r.data)).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { cargar(); }, [ventaId]);

  const handleAddPago = async (e) => {
    e.preventDefault();
    if (!proveedor.trim() || !concepto.trim() || !monto) return;
    setGuardando(true);
    try {
      await api.post('/finanzas', {
        tipo: 'gasto', categoria, concepto, monto, fecha,
        venta_id: ventaId, proveedor: proveedor.trim(),
      });
      setConcepto(''); setMonto('');
      cargar();
      onChanged?.();
    } catch {} finally { setGuardando(false); }
  };

  const handleDeletePago = async (id) => {
    try {
      await api.delete(`/finanzas/${id}`);
      cargar();
      onChanged?.();
    } catch {}
  };

  if (loading || !rel) return <div className="ap-loading">Cargando…</div>;

  return (
    <div>
      <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={onBack} style={{ marginBottom: '1rem' }}><ArrowLeft size={13} /> Volver</button>

      <div className="ap-section-head" style={{ marginBottom: '1rem' }}>
        <div>
          <h1>{rel.venta.nombre}</h1>
          <p>{rel.venta.clienteNombre}{rel.proyecto ? ` · ${rel.proyecto.nombre}` : ''}</p>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '12px 16px', marginBottom: 20 }}>
        <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase' }}>Presupuestado (coste)</div><strong style={{ fontSize: 15 }}>{fmt(rel.presupuestoTotal)}</strong></div>
        <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase' }}>Pagado real</div><strong style={{ fontSize: 15, color: '#ae6b6b' }}>{fmt(rel.pagadoTotal)}</strong></div>
        <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase' }}>Diferencia</div><strong style={{ fontSize: 15, color: rel.diferenciaTotal >= 0 ? '#8bae8f' : '#ae6b6b' }}>{fmt(rel.diferenciaTotal)}</strong></div>
      </div>

      <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.35)', marginBottom: 8 }}>Por proveedor</p>
      {rel.proveedores.length === 0 ? (
        <div className="ap-empty" style={{ marginBottom: 20 }}><p>Este proyecto todavía no tiene un presupuesto aprobado ni pagos registrados.</p></div>
      ) : (
        <div className="fz-tabla" style={{ marginBottom: 24 }}>
          <div className="fz-row fz-row--head"><span>Proveedor</span><span>Presupuestado</span><span>Pagado</span><span>Diferencia</span></div>
          {rel.proveedores.map(p => (
            <div key={p.proveedor} className="fz-row">
              <span>{p.proveedor}</span>
              <span>{fmt(p.presupuestado)}</span>
              <span>{fmt(p.pagado)}</span>
              <span style={{ color: p.diferencia >= 0 ? '#8bae8f' : '#ae6b6b' }}>{fmt(p.diferencia)}</span>
            </div>
          ))}
        </div>
      )}

      <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.35)', marginBottom: 8 }}>Registrar un pago</p>
      <form onSubmit={handleAddPago} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 12 }}>
        <input className="ap-field-input" list="proveedores-obra" value={proveedor} onChange={e => setProveedor(e.target.value)} placeholder="Proveedor" style={{ minWidth: 140, flex: 1 }} />
        <datalist id="proveedores-obra">{rel.proveedores.map(p => <option key={p.proveedor} value={p.proveedor} />)}</datalist>
        <input className="ap-field-input" value={concepto} onChange={e => setConcepto(e.target.value)} placeholder="Concepto" style={{ minWidth: 140, flex: 1 }} />
        <select className="ap-select" value={categoria} onChange={e => setCategoria(e.target.value)} style={{ maxWidth: 150 }}>
          {CATEGORIAS_GASTO.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input className="ap-field-input" type="number" step="0.01" min="0" value={monto} onChange={e => setMonto(e.target.value)} placeholder="0.00" style={{ maxWidth: 110 }} />
        <input className="ap-field-input" type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={{ maxWidth: 150 }} />
        <button type="submit" className="ap-btn ap-btn-primary ap-btn-sm" disabled={guardando}><Plus size={13} /> Registrar</button>
      </form>

      <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.35)', marginBottom: 8 }}>Pagos registrados ({rel.pagos.length})</p>
      {rel.pagos.length === 0 ? <p className="ap-empty-sm">Todavía no hay pagos registrados para esta obra.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rel.pagos.map(p => (
            <PagoRow key={p.id} pago={p} onDelete={handleDeletePago} onSavedProveedor={cargar} />
          ))}
        </div>
      )}
    </div>
  );
}

export function SectionRelacionObra() {
  const [obras, setObras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  const cargar = () => {
    api.get('/obra').then(r => setObras(r.data.obras || [])).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { cargar(); }, []);

  if (selected) return <div className="ap-section"><DetalleObra ventaId={selected} onBack={() => setSelected(null)} onChanged={cargar} /></div>;

  return (
    <div className="ap-section">
      <div className="ap-section-head">
        <div><h1><Hammer size={20} style={{ verticalAlign: -3, marginRight: 6 }} />Relación de obra</h1><p>Lo presupuestado a cada proveedor frente a lo que realmente le has pagado, por cada proyecto con ejecución.</p></div>
      </div>

      {loading ? <div className="ap-loading">Cargando…</div> : obras.length === 0 ? (
        <div className="ap-empty"><p>No hay ventas con ejecución todavía.</p></div>
      ) : (
        <div className="fz-tabla">
          <div className="fz-row fz-row--head"><span>Obra</span><span>Presupuestado</span><span>Pagado</span><span>Diferencia</span></div>
          {obras.map(o => (
            <div key={o.ventaId} className="fz-row" style={{ cursor: 'pointer' }} onClick={() => setSelected(o.ventaId)}>
              <span>{o.nombre} <span style={{ color: 'rgba(255,255,255,0.4)' }}>· {o.clienteNombre}</span></span>
              <span>{fmt(o.presupuestoTotal)}</span>
              <span>{fmt(o.pagadoTotal)}</span>
              <span style={{ color: o.diferenciaTotal >= 0 ? '#8bae8f' : '#ae6b6b' }}>{fmt(o.diferenciaTotal)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
