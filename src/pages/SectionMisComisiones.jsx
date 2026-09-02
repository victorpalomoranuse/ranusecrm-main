import { useState, useEffect } from 'react';
import api from '../services/api';
import { Wallet, TrendingUp, Clock } from 'lucide-react';

function fmt(n) {
  return Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}

function periodoActual(tipo) {
  const hoy = new Date();
  const y = hoy.getFullYear();
  if (tipo === 'año') return String(y);
  if (tipo === 'trimestre') return `${y}-Q${Math.ceil((hoy.getMonth() + 1) / 3)}`;
  return `${y}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
}

const PERIODO_TABS = [{ tipo: 'mes', label: 'Mes' }, { tipo: 'trimestre', label: 'Trimestre' }, { tipo: 'año', label: 'Año' }];

export function SectionMisComisiones() {
  const [periodoTipo, setPeriodoTipo] = useState('mes');
  const [mia, setMia] = useState(null);
  const [historico, setHistorico] = useState(null);
  const [loading, setLoading] = useState(true);
  const [verHistorico, setVerHistorico] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get('/comisiones/mia', { params: { periodo_tipo: periodoTipo, periodo: periodoActual(periodoTipo) } })
      .then(r => setMia(r.data))
      .catch(() => setMia(null))
      .finally(() => setLoading(false));
  }, [periodoTipo]);

  useEffect(() => {
    if (verHistorico && !historico) {
      api.get('/comisiones/mi-historico').then(r => setHistorico(r.data)).catch(() => {});
    }
  }, [verHistorico, historico]);

  return (
    <div className="ap-section">
      <div className="ap-section-head">
        <div><h1>Mis Comisiones</h1><p>Lo que te corresponde, lo que ya se te ha pagado y lo que queda pendiente.</p></div>
        <button className="ap-btn ap-btn-ghost" onClick={() => setVerHistorico(v => !v)}>{verHistorico ? 'Ver periodo actual' : 'Ver histórico total'}</button>
      </div>

      {verHistorico ? (
        !historico ? (
          <div className="ap-loading">Cargando…</div>
        ) : !historico.encontrado ? (
          <div className="ap-empty"><p>Todavía no tienes comisiones configuradas. Pídele a tu admin que te enlace en Finanzas → Comisiones.</p></div>
        ) : (
          <>
            <div className="vt-stats">
              <div className="vt-stat-card">
                <div className="vt-stat-icon"><Wallet size={18} /></div>
                <div className="vt-stat-body"><span>Total cobrado contigo (histórico)</span><strong>{fmt(historico.total)}</strong></div>
              </div>
            </div>
            {historico.pagos.length === 0 ? (
              <div className="ap-empty"><p>Todavía no se te ha registrado ningún pago.</p></div>
            ) : (
              <div className="fz-tabla">
                <div className="fz-row fz-row--head"><span>Concepto</span><span></span><span></span><span>Fecha</span><span>Importe</span></div>
                {historico.pagos.map((p, i) => (
                  <div key={i} className="fz-row">
                    <span>{p.concepto}</span><span></span><span></span>
                    <span>{new Date(p.fecha).toLocaleDateString('es-ES')}</span>
                    <span className="fz-importe fz-importe--ingreso">{fmt(p.monto)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )
      ) : (
        <>
          {mia?.modelo === 'global' && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {PERIODO_TABS.map(t => (
                <button key={t.tipo} className={`ap-btn ap-btn-sm ${periodoTipo === t.tipo ? 'ap-btn-primary' : 'ap-btn-ghost'}`} onClick={() => setPeriodoTipo(t.tipo)}>{t.label}</button>
              ))}
            </div>
          )}

          {loading ? (
            <div className="ap-loading">Cargando…</div>
          ) : !mia?.encontrado ? (
            <div className="ap-empty"><p>{mia?.mensaje || 'Todavía no tienes comisiones configuradas. Pídele a tu admin que te enlace en Finanzas → Comisiones.'}</p></div>
          ) : (
            <>
              <div className="vt-stats">
                <div className="vt-stat-card">
                  <div className="vt-stat-icon"><TrendingUp size={18} /></div>
                  <div className="vt-stat-body"><span>{mia.modelo === 'global' ? `Te corresponde este periodo (${mia.porcentaje}%)` : 'Te corresponde en total'}</span><strong>{fmt(mia.comisionEstimada)}</strong></div>
                </div>
                <div className="vt-stat-card">
                  <div className="vt-stat-icon" style={{ color: '#22c55e' }}><Wallet size={18} /></div>
                  <div className="vt-stat-body"><span>Ya te han pagado</span><strong style={{ color: '#22c55e' }}>{fmt(mia.yaPagado)}</strong></div>
                </div>
                <div className="vt-stat-card">
                  <div className="vt-stat-icon" style={{ color: '#f5b748' }}><Clock size={18} /></div>
                  <div className="vt-stat-body"><span>Pendiente de cobrar</span><strong style={{ color: '#f5b748' }}>{fmt(mia.pendiente)}</strong></div>
                </div>
              </div>
              {mia.nota && (
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>{mia.nota}</p>
              )}

              {mia.modelo === 'por_proyecto' && (
                <div style={{ marginTop: 24 }}>
                  <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.35)', marginBottom: 8 }}>De dónde sale ese número</p>
                  {mia.porVenta.length === 0 ? (
                    <p className="ap-empty-sm">Todavía no tienes proyectos asignados.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {mia.porVenta.map(v => (
                        <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px 12px', flexWrap: 'wrap' }}>
                          <span style={{ flex: 1, fontWeight: 600, minWidth: 140 }}>{v.ventaNombre}</span>
                          <span style={{ color: 'rgba(255,255,255,0.5)' }}>{v.tipo === 'fijo' ? fmt(v.valor) : `${v.valor}%`}</span>
                          <span style={{ color: 'rgba(255,255,255,0.4)' }}>{v.proporcionCobradaPct}% cobrado</span>
                          <span style={{ color: '#22c55e' }}>Devengado {fmt(v.devengada)}</span>
                          <span style={{ color: '#f5b748' }}>Por cobrar {fmt(v.pendiente)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
