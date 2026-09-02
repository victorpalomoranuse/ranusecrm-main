import { useState, useEffect } from 'react';
import api from '../services/api';
import { Wallet, TrendingUp, Clock, ChevronDown, ChevronUp } from 'lucide-react';

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

function fmtPeriodo(clave, tipo) {
  if (tipo === 'año') return clave;
  if (tipo === 'trimestre') return clave.replace('-Q', ' · T');
  const [y, m] = clave.split('-');
  const nombre = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  return nombre.charAt(0).toUpperCase() + nombre.slice(1);
}

const PERIODO_TABS = [{ tipo: 'mes', label: 'Mes' }, { tipo: 'trimestre', label: 'Trimestre' }, { tipo: 'año', label: 'Año' }];

function explicacion(v) {
  const pctCobrado = v.presupuesto > 0 ? Math.round((v.montoCobrado / v.presupuesto) * 100) : 0;
  if (v.tipo === 'fijo') {
    return `Cobraste ${fmt(v.montoCobrado)} este periodo (${pctCobrado}% del presupuesto). Tu comisión en este proyecto es fija — ${fmt(v.valorConfig)} en total — así que te corresponde esa parte: ${fmt(v.devengado)}.`;
  }
  return `Cobraste ${fmt(v.montoCobrado)} este periodo, que a tu margen previsto (beneficio ${fmt(v.beneficioPrevisto)} sobre ${fmt(v.presupuesto)}) es ${fmt(v.montoCobrado * (v.beneficioPrevisto / v.presupuesto))} de beneficio. Tu comisión es el ${v.valorConfig}% de eso → ${fmt(v.devengado)}.`;
}

function ResumenPorPeriodo({ periodos, tipo }) {
  const [abierto, setAbierto] = useState(null);

  if (!periodos || periodos.length === 0) return <p className="ap-empty-sm">Todavía no hay ingresos cobrados en tus proyectos.</p>;

  const totalDevengado = periodos.reduce((s, p) => s + p.devengado, 0);
  const totalPagado = periodos.reduce((s, p) => s + p.pagado, 0);

  return (
    <div className="fz-tabla">
      <div className="fz-row fz-row--head"><span>Periodo</span><span>Generado</span><span>Cobrado</span><span>Pendiente</span></div>
      {periodos.map(p => (
        <div key={p.periodo}>
          <div className="fz-row" style={{ cursor: p.porVenta?.length ? 'pointer' : 'default' }} onClick={() => p.porVenta?.length && setAbierto(a => a === p.periodo ? null : p.periodo)}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {p.porVenta?.length > 0 && (abierto === p.periodo ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
              {fmtPeriodo(p.periodo, tipo)}
            </span>
            <span>{fmt(p.devengado)}</span>
            <span style={{ color: '#22c55e' }}>{fmt(p.pagado)}</span>
            <span style={{ color: p.pendiente > 0.01 ? '#f5b748' : 'rgba(255,255,255,0.4)' }}>{fmt(p.pendiente)}</span>
          </div>
          {abierto === p.periodo && p.porVenta?.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 12px 12px 28px' }}>
              {p.porVenta.map(v => (
                <div key={v.ventaId} style={{ fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'rgba(255,255,255,0.75)', fontWeight: 600, marginBottom: 2 }}>
                    <span>{v.ventaNombre}</span>
                    <span>{fmt(v.devengado)}</span>
                  </div>
                  <p style={{ margin: 0, color: 'rgba(255,255,255,0.4)', lineHeight: 1.4 }}>{explicacion(v)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="fz-row" style={{ fontWeight: 600, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
        <span>Total</span>
        <span>{fmt(totalDevengado)}</span>
        <span style={{ color: '#22c55e' }}>{fmt(totalPagado)}</span>
        <span style={{ color: '#f5b748' }}>{fmt(totalDevengado - totalPagado)}</span>
      </div>
    </div>
  );
}

export function SectionMisComisiones() {
  const [periodoTipo, setPeriodoTipo] = useState('mes');
  const [mia, setMia] = useState(null);
  const [historico, setHistorico] = useState(null);
  const [loading, setLoading] = useState(true);
  const [verHistorico, setVerHistorico] = useState(false);
  const [periodos, setPeriodos] = useState(null);
  const [cargandoPeriodos, setCargandoPeriodos] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get('/comisiones/mia', { params: { periodo_tipo: periodoTipo, periodo: periodoActual(periodoTipo) } })
      .then(r => setMia(r.data))
      .catch(() => setMia(null))
      .finally(() => setLoading(false));
  }, [periodoTipo]);

  useEffect(() => {
    if (mia?.modelo !== 'por_proyecto') return;
    setCargandoPeriodos(true);
    api.get('/comisiones/mia/periodos', { params: { tipo: periodoTipo } })
      .then(r => setPeriodos(r.data.periodos || []))
      .catch(() => setPeriodos(null))
      .finally(() => setCargandoPeriodos(false));
  }, [periodoTipo, mia?.modelo]);

  useEffect(() => {
    if (verHistorico && !historico) {
      api.get('/comisiones/mi-historico').then(r => setHistorico(r.data)).catch(() => {});
    }
  }, [verHistorico, historico]);

  return (
    <div className="ap-section">
      <div className="ap-section-head">
        <div><h1>Mis Comisiones</h1><p>Lo que te corresponde, lo que ya se te ha pagado y lo que queda pendiente.</p></div>
        <button className="ap-btn ap-btn-ghost" onClick={() => setVerHistorico(v => !v)}>{verHistorico ? 'Ver mes a mes' : 'Ver pagos recibidos'}</button>
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
          {loading ? (
            <div className="ap-loading">Cargando…</div>
          ) : !mia?.encontrado ? (
            <div className="ap-empty"><p>{mia?.mensaje || 'Todavía no tienes comisiones configuradas. Pídele a tu admin que te enlace en Finanzas → Comisiones.'}</p></div>
          ) : (
            <>
              <div className="vt-stats">
                <div className="vt-stat-card">
                  <div className="vt-stat-icon"><TrendingUp size={18} /></div>
                  <div className="vt-stat-body"><span>{mia.modelo === 'global' ? `Te corresponde este periodo (${mia.porcentaje}%)` : 'Total acumulado (desde siempre)'}</span><strong>{fmt(mia.comisionEstimada)}</strong></div>
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
                    <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.35)', margin: 0 }}>Mes a mes</p>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {PERIODO_TABS.map(t => (
                        <button key={t.tipo} className={`ap-btn ap-btn-xs ${periodoTipo === t.tipo ? 'ap-btn-primary' : 'ap-btn-ghost'}`} onClick={() => setPeriodoTipo(t.tipo)}>{t.label}</button>
                      ))}
                    </div>
                  </div>
                  <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: -2, marginBottom: 10 }}>
                    Lo que se generó según lo que fuiste cobrando cada {periodoTipo === 'mes' ? 'mes' : periodoTipo === 'trimestre' ? 'trimestre' : 'año'} (aunque el proyecto siga abierto), lo que ya se te pagó de eso, y lo que queda pendiente. Toca un periodo para ver de qué proyectos sale.
                  </p>
                  {cargandoPeriodos ? <div className="ap-loading">Cargando…</div> : <ResumenPorPeriodo periodos={periodos} tipo={periodoTipo} />}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
