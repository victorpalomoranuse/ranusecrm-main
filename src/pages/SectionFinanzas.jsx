import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { Wallet, TrendingUp, TrendingDown, Plus, X, Trash2, BarChart2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import './SectionFinanzas.css';

function fmt(n) {
  return Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}

function fmtMesCorto(mes) {
  const [y, m] = mes.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('es-ES', { month: 'short' }).replace('.', '');
}

const CATEGORIAS_GASTO = ['Nóminas', 'Materiales', 'Marketing', 'Software', 'Alquiler', 'Comisiones', 'Fiscal', 'Otros'];
const CATEGORIAS_INGRESO = ['Venta proyecto', 'Anticipo', 'Diseño', 'Otros'];
const METODOS_PAGO = ['Transferencia', 'Tarjeta', 'Efectivo', 'Bizum', 'Otro'];

function MovimientoModal({ tipoInicial, onClose, onSaved }) {
  const [tipo, setTipo] = useState(tipoInicial);
  const [categoria, setCategoria] = useState('');
  const [concepto, setConcepto] = useState('');
  const [monto, setMonto] = useState('');
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [metodoPago, setMetodoPago] = useState('');
  const [notas, setNotas] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const categorias = tipo === 'ingreso' ? CATEGORIAS_INGRESO : CATEGORIAS_GASTO;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!categoria || !concepto.trim() || !monto) { setError('Completa categoría, concepto e importe'); return; }
    setLoading(true);
    try {
      const { data } = await api.post('/finanzas', {
        tipo, categoria, concepto, monto, fecha, metodo_pago: metodoPago || null, notas,
      });
      onSaved(data.movimiento);
    } catch (err) {
      setError(err.response?.data?.error || 'Error al guardar el movimiento');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ap-modal-overlay" onClick={onClose}>
      <div className="ap-modal" onClick={e => e.stopPropagation()}>
        <div className="ap-modal-head">
          <h2>Nuevo movimiento</h2>
          <button className="ap-modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="ap-modal-form">
          <div className="fz-tipo-toggle">
            <button type="button" className={`fz-tipo-btn fz-tipo-btn--ingreso${tipo === 'ingreso' ? ' active' : ''}`} onClick={() => { setTipo('ingreso'); setCategoria(''); }}>Ingreso</button>
            <button type="button" className={`fz-tipo-btn fz-tipo-btn--gasto${tipo === 'gasto' ? ' active' : ''}`} onClick={() => { setTipo('gasto'); setCategoria(''); }}>Gasto</button>
          </div>

          <div className="ap-field">
            <label>Categoría *</label>
            <select className="ap-select" value={categoria} onChange={e => setCategoria(e.target.value)} required>
              <option value="">Selecciona una categoría</option>
              {categorias.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="ap-field">
            <label>Concepto *</label>
            <input value={concepto} onChange={e => setConcepto(e.target.value)} placeholder="Ej: Pago proveedor renders" required />
          </div>
          <div className="fz-field-row">
            <div className="ap-field">
              <label>Importe (€) *</label>
              <input type="number" step="0.01" min="0" value={monto} onChange={e => setMonto(e.target.value)} placeholder="0.00" required />
            </div>
            <div className="ap-field">
              <label>Fecha</label>
              <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
            </div>
          </div>
          <div className="ap-field">
            <label>Método de pago <span className="ap-optional">(opcional)</span></label>
            <select className="ap-select" value={metodoPago} onChange={e => setMetodoPago(e.target.value)}>
              <option value="">—</option>
              {METODOS_PAGO.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="ap-field">
            <label>Notas <span className="ap-optional">(opcional)</span></label>
            <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2} />
          </div>

          {error && <p className="ap-error">{error}</p>}
          <div className="ap-modal-actions">
            <button type="button" className="ap-btn ap-btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" className="ap-btn ap-btn-primary" disabled={loading}>{loading ? 'Guardando...' : 'Guardar movimiento'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function SectionFinanzas() {
  const [resumen, setResumen] = useState(null);
  const [movimientos, setMovimientos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [filtroMes, setFiltroMes] = useState('');
  const [modal, setModal] = useState(null);
  const [confirmId, setConfirmId] = useState(null);

  const loadResumen = useCallback(() => {
    api.get('/finanzas/resumen').then(r => setResumen(r.data)).catch(() => {});
  }, []);

  const loadMovimientos = useCallback(() => {
    const params = {};
    if (filtroTipo !== 'todos') params.tipo = filtroTipo;
    if (filtroMes) params.mes = filtroMes;
    api.get('/finanzas', { params }).then(r => setMovimientos(r.data.movimientos || [])).catch(() => {}).finally(() => setLoading(false));
  }, [filtroTipo, filtroMes]);

  useEffect(() => { loadResumen(); }, [loadResumen]);
  useEffect(() => { setLoading(true); loadMovimientos(); }, [loadMovimientos]);

  const handleSaved = (mov) => {
    setModal(null);
    loadResumen();
    loadMovimientos();
  };

  const handleDelete = async () => {
    try {
      await api.delete(`/finanzas/${confirmId}`);
      loadResumen();
      loadMovimientos();
    } catch {
      // noop
    } finally {
      setConfirmId(null);
    }
  };

  const chartData = (resumen?.porMes || []).slice(0, 6).reverse().map(m => ({ mes: fmtMesCorto(m.mes), Ingresos: m.ingresos, Gastos: m.gastos }));

  return (
    <div className="ap-section">
      <div className="ap-section-head">
        <div><h1>Finanzas</h1><p>Ingresos, gastos y caja del negocio.</p></div>
        <button className="ap-btn ap-btn-primary" onClick={() => setModal('new')}><Plus size={15} /> Nuevo movimiento</button>
      </div>

      <div className="fz-stats">
        <div className="fz-stat-card">
          <div className="fz-stat-icon" style={{ background: 'rgba(190,176,162,0.15)', color: '#beb0a2' }}><Wallet size={18} /></div>
          <div className="fz-stat-body"><span>Caja actual</span><strong>{fmt(resumen?.caja)}</strong></div>
        </div>
        <div className="fz-stat-card">
          <div className="fz-stat-icon" style={{ background: 'rgba(139,174,143,0.15)', color: '#8bae8f' }}><TrendingUp size={18} /></div>
          <div className="fz-stat-body"><span>Ingresos totales</span><strong>{fmt(resumen?.ingresosTotales)}</strong></div>
        </div>
        <div className="fz-stat-card">
          <div className="fz-stat-icon" style={{ background: 'rgba(174,107,107,0.15)', color: '#ae6b6b' }}><TrendingDown size={18} /></div>
          <div className="fz-stat-body"><span>Gastos totales</span><strong>{fmt(resumen?.gastosTotales)}</strong></div>
        </div>
      </div>

      {chartData.length > 0 && (
        <div className="fz-chart-card">
          <p className="fz-chart-title"><BarChart2 size={15} /> Últimos meses</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} barCategoryGap="30%" barGap={3}>
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="mes" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} width={50} />
              <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
              <Bar dataKey="Ingresos" fill="#8bae8f" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Gastos" fill="#ae6b6b" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="fz-filters">
        <select className="ap-select" value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}>
          <option value="todos">Todos los movimientos</option>
          <option value="ingreso">Solo ingresos</option>
          <option value="gasto">Solo gastos</option>
        </select>
        <input type="month" className="ap-select" value={filtroMes} onChange={e => setFiltroMes(e.target.value)} />
        {filtroMes && <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => setFiltroMes('')}>Limpiar mes</button>}
      </div>

      {loading ? (
        <div className="ap-loading">Cargando movimientos…</div>
      ) : movimientos.length === 0 ? (
        <div className="ap-empty"><p>No hay movimientos con estos filtros.</p></div>
      ) : (
        <div className="fz-tabla">
          <div className="fz-row fz-row--head">
            <span>Concepto</span><span>Categoría</span><span>Método</span><span>Fecha</span><span>Importe</span><span></span>
          </div>
          {movimientos.map(m => (
            <div key={m.id} className="fz-row">
              <span className="fz-concepto">{m.concepto}{m.leads?.nombre && <span className="fz-lead-tag">{m.leads.nombre}</span>}</span>
              <span>{m.categoria}</span>
              <span>{m.metodo_pago || '—'}</span>
              <span>{new Date(m.fecha).toLocaleDateString('es-ES')}</span>
              <span className={`fz-importe fz-importe--${m.tipo}`}>{m.tipo === 'gasto' ? '-' : '+'}{fmt(m.monto)}</span>
              <button className="ap-btn-icon" onClick={() => setConfirmId(m.id)}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}

      {modal && <MovimientoModal tipoInicial="ingreso" onClose={() => setModal(null)} onSaved={handleSaved} />}
      {confirmId && (
        <div className="ap-modal-overlay" onClick={() => setConfirmId(null)}>
          <div className="ap-modal ap-modal--sm" onClick={e => e.stopPropagation()}>
            <p style={{ marginBottom: '1.25rem' }}>¿Eliminar este movimiento? Esta acción no se puede deshacer.</p>
            <div className="ap-modal-actions">
              <button className="ap-btn ap-btn-ghost" onClick={() => setConfirmId(null)}>Cancelar</button>
              <button className="ap-btn ap-btn-danger" onClick={handleDelete}>Eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
