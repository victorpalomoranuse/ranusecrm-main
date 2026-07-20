import { useState, useEffect } from 'react';
import api from '../services/api';
import { TrendingUp, Euro, Hash, ChevronDown, ChevronUp } from 'lucide-react';
import './SectionVentas.css';

function fmt(n) {
  return Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}

function fmtMes(mes) {
  if (mes === 'sin_fecha') return 'Sin fecha';
  const [y, m] = mes.split('-');
  const nombre = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  return nombre.charAt(0).toUpperCase() + nombre.slice(1);
}

export function SectionVentas() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openMes, setOpenMes] = useState(null);

  useEffect(() => {
    api.get('/ventas')
      .then(r => {
        setData(r.data);
        if (r.data.porMes?.length) setOpenMes(r.data.porMes[0].mes);
      })
      .catch(() => setError('No se pudieron cargar las ventas'))
      .finally(() => setLoading(false));
  }, []);

  const { porMes = [], resumen = { total: 0, valorTotal: 0, valorMedio: 0 } } = data || {};

  if (loading) return (
    <div className="ap-section">
      <div className="ap-section-head"><h1>Ventas</h1></div>
      <div className="ap-loading">Cargando ventas…</div>
    </div>
  );

  if (error) return (
    <div className="ap-section">
      <div className="ap-section-head"><h1>Ventas</h1></div>
      <div className="ap-empty"><p>{error}</p></div>
    </div>
  );

  return (
    <div className="ap-section">
      <div className="ap-section-head">
        <div><h1>Ventas</h1><p>Ventas cerradas, agrupadas por mes, con el valor de cada lead.</p></div>
      </div>

      <div className="vt-stats">
        <div className="vt-stat-card">
          <div className="vt-stat-icon"><Hash size={18} /></div>
          <div className="vt-stat-body"><span>Ventas totales</span><strong>{resumen.total}</strong></div>
        </div>
        <div className="vt-stat-card">
          <div className="vt-stat-icon"><Euro size={18} /></div>
          <div className="vt-stat-body"><span>Valor total</span><strong>{fmt(resumen.valorTotal)}</strong></div>
        </div>
        <div className="vt-stat-card">
          <div className="vt-stat-icon"><TrendingUp size={18} /></div>
          <div className="vt-stat-body"><span>Valor medio / venta</span><strong>{fmt(resumen.valorMedio)}</strong></div>
        </div>
      </div>

      {porMes.length === 0 ? (
        <div className="ap-empty"><p>Todavía no hay ventas registradas.</p></div>
      ) : (
        <div className="vt-meses">
          {porMes.map(m => {
            const open = openMes === m.mes;
            return (
              <div key={m.mes} className="vt-mes-card">
                <button className="vt-mes-head" onClick={() => setOpenMes(open ? null : m.mes)}>
                  <div className="vt-mes-title">
                    <span className="vt-mes-nombre">{fmtMes(m.mes)}</span>
                    <span className="vt-mes-count">{m.count} venta{m.count !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="vt-mes-right">
                    <strong className="vt-mes-total">{fmt(m.total)}</strong>
                    {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </button>
                {open && (
                  <div className="vt-mes-table">
                    <div className="vt-row vt-row--head">
                      <span>Lead</span><span>Perfil</span><span>Canal</span><span>Comercial</span><span>Fecha</span><span>Valor</span>
                    </div>
                    {m.ventas.map(v => (
                      <div key={v.id} className="vt-row">
                        <span className="vt-lead-nombre">{v.nombre}</span>
                        <span>{v.perfil || '—'}</span>
                        <span>{v.canal || '—'}</span>
                        <span>{v.comercial || '—'}</span>
                        <span>{v.fecha_venta ? new Date(v.fecha_venta).toLocaleDateString('es-ES') : '—'}</span>
                        <span className="vt-valor">{fmt(v.valor)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
