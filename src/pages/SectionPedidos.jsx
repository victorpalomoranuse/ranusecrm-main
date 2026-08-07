import { useState, useEffect } from 'react';
import api from '../services/api';
import { Download } from 'lucide-react';

const ORDER_STATUSES = [
  { value: 'pendiente', label: 'Por pedir', color: 'rgba(255,255,255,0.35)' },
  { value: 'pedido', label: 'Pedido', color: '#8b9eae' },
  { value: 'entregado', label: 'Entregado', color: '#8bae8f' },
];
const PAYMENT_STATUSES = [
  { value: 'pendiente', label: 'Por pagar', color: '#ae8b8b' },
  { value: 'pagado', label: 'Pagado', color: '#8bae8f' },
];

export function SectionPedidos() {
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pendientes'); // 'pendientes' | 'todos'

  useEffect(() => {
    api.get('/budgets/pedidos').then(r => setLines(r.data.lines || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const updateLine = async (line, updates) => {
    try {
      const { data } = await api.put(`/budgets/${line.budget_id}/items/${line.id}`, updates);
      setLines(prev => prev.map(l => l.id === line.id
        ? { ...l, ...data.item, effective_provider: data.item.provider?.trim() || data.item.brand?.trim() || 'Sin proveedor' }
        : l));
    } catch {}
  };

  const handleExport = async (provider) => {
    try {
      const base = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
      const token = localStorage.getItem('admin_token');
      const res = await fetch(`${base}/budgets/pedidos/export?provider=${encodeURIComponent(provider)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pedido-${provider}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {}
  };

  if (loading) {
    return (
      <div className="ap-section">
        <div className="ap-section-head"><h1>Pedidos</h1></div>
        <div className="ap-loading">Cargando…</div>
      </div>
    );
  }

  const visibleLines = filter === 'pendientes' ? lines.filter(l => l.order_status !== 'entregado') : lines;
  const groups = {};
  visibleLines.forEach(l => { (groups[l.effective_provider] ||= []).push(l); });
  const providerNames = Object.keys(groups).sort();

  return (
    <div className="ap-section">
      <div className="ap-section-head">
        <div>
          <h1>Pedidos</h1>
          <p>Qué falta por pedir de tus presupuestos aprobados, agrupado por proveedor/marca.</p>
        </div>
        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 3 }}>
          {['pendientes', 'todos'].map(v => (
            <button
              key={v}
              onClick={() => setFilter(v)}
              style={{
                padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: '0.78rem',
                background: filter === v ? '#beb0a2' : 'transparent',
                color: filter === v ? '#0a0a0a' : 'rgba(255,255,255,0.5)',
                fontWeight: filter === v ? 600 : 400,
              }}
            >
              {v === 'pendientes' ? 'Pendientes' : 'Todos'}
            </button>
          ))}
        </div>
      </div>

      {providerNames.length === 0 ? (
        <div className="ap-empty"><p>{filter === 'pendientes' ? 'Nada pendiente de pedir.' : 'No hay partidas en presupuestos aprobados.'}</p></div>
      ) : providerNames.map(provider => (
        <div key={provider} style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: '#fff', margin: 0 }}>
              {provider} <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400, fontSize: '0.78rem' }}>({groups[provider].length})</span>
            </h3>
            <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => handleExport(provider)}><Download size={13} /> Exportar PDF</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {groups[provider].map(line => (
              <div key={line.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '0.75rem 1rem' }}>
                <div style={{ flex: '1 1 220px', minWidth: 180 }}>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: '#fff', fontWeight: 500 }}>{line.name}</p>
                  <p style={{ margin: '2px 0 0', fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)' }}>
                    {line.project?.client_name} · {line.project?.project_name} · x{line.quantity} {line.unit}
                  </p>
                </div>
                <select className="ap-select ap-select-sm" value={line.order_status || 'pendiente'} onChange={e => updateLine(line, { order_status: e.target.value })}>
                  {ORDER_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
                <select className="ap-select ap-select-sm" value={line.payment_status || 'pendiente'} onChange={e => updateLine(line, { payment_status: e.target.value })}>
                  {PAYMENT_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
                <input
                  type="date"
                  className="ap-field-input"
                  style={{ maxWidth: 150 }}
                  value={line.delivery_date || ''}
                  onChange={e => updateLine(line, { delivery_date: e.target.value })}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
