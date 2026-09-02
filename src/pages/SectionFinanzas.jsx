import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { Wallet, TrendingUp, TrendingDown, Plus, X, Trash2, BarChart2, Users, Check, Pencil, ChevronDown, ChevronUp } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import './SectionFinanzas.css';

function fmt(n) {
  return Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}

function fmtMesCorto(mes) {
  const [y, m] = mes.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('es-ES', { month: 'short' }).replace('.', '');
}

function fmtPeriodoLargo(clave, tipo) {
  if (tipo === 'año') return clave;
  if (tipo === 'trimestre') return clave.replace('-Q', ' · T');
  const [y, m] = clave.split('-');
  const nombre = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  return nombre.charAt(0).toUpperCase() + nombre.slice(1);
}

const CATEGORIAS_GASTO = ['Nóminas', 'Materiales', 'Marketing', 'Software', 'Alquiler', 'Comisiones', 'Devolución', 'Fiscal', 'Otros'];
const CATEGORIAS_INGRESO = ['Venta proyecto', 'Anticipo', 'Diseño', 'Otros'];
const METODOS_PAGO = ['Transferencia', 'Tarjeta', 'Efectivo', 'Bizum', 'Otro'];

function MovimientoModal({ tipoInicial, movimiento, onClose, onSaved }) {
  const isEdit = !!movimiento;
  const [tipo, setTipo] = useState(movimiento?.tipo || tipoInicial);
  const [categoria, setCategoria] = useState(movimiento?.categoria || '');
  const [concepto, setConcepto] = useState(movimiento?.concepto || '');
  const [monto, setMonto] = useState(movimiento?.monto ?? '');
  const [fecha, setFecha] = useState(movimiento?.fecha?.slice(0, 10) || new Date().toISOString().slice(0, 10));
  const [metodoPago, setMetodoPago] = useState(movimiento?.metodo_pago || '');
  const [notas, setNotas] = useState(movimiento?.notas || '');
  const [ventaId, setVentaId] = useState(movimiento?.venta_id || '');
  const [beneficiario, setBeneficiario] = useState(movimiento?.beneficiario || '');
  const [ventas, setVentas] = useState([]);
  const [proyectosPorVenta, setProyectosPorVenta] = useState({});
  const [empleados, setEmpleados] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const categorias = tipo === 'ingreso' ? CATEGORIAS_INGRESO : CATEGORIAS_GASTO;

  useEffect(() => {
    api.get('/ventas').then(r => setVentas(r.data.ventas || [])).catch(() => {});
    api.get('/client-projects').then(r => {
      const map = {};
      (r.data.projects || []).forEach(p => { if (p.venta_id) map[p.venta_id] = p.project_name; });
      setProyectosPorVenta(map);
    }).catch(() => {});
    api.get('/employees').then(r => setEmpleados(r.data.employees || [])).catch(() => {});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!categoria || !concepto.trim() || !monto) { setError('Completa categoría, concepto e importe'); return; }
    setLoading(true);
    try {
      const payload = { tipo, categoria, concepto, monto, fecha, metodo_pago: metodoPago || null, notas, venta_id: ventaId || null, beneficiario: beneficiario || null };
      const { data } = isEdit
        ? await api.put(`/finanzas/${movimiento.id}`, payload)
        : await api.post('/finanzas', payload);
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
          <h2>{isEdit ? 'Editar movimiento' : 'Nuevo movimiento'}</h2>
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
          <div className="ap-field">
            <label>Venta <span className="ap-optional">(opcional, pero enlázalo si es un cobro o gasto de una venta concreta)</span></label>
            <select className="ap-select" value={ventaId} onChange={e => setVentaId(e.target.value)}>
              <option value="">— Sin enlazar (gasto/ingreso general de empresa) —</option>
              {ventas.map(v => (
                <option key={v.id} value={v.id}>
                  {v.nombre} {v.fecha ? `(${v.fecha.slice(0,10)})` : ''}{proyectosPorVenta[v.id] ? ` — proyecto: ${proyectosPorVenta[v.id]}` : ''}
                </option>
              ))}
            </select>
          </div>
          {tipo === 'gasto' && (
            <div className="ap-field">
              <label>Pagado a <span className="ap-optional">(opcional, elige un empleado para poder ver luego todo lo que le has pagado)</span></label>
              <select className="ap-select" value={beneficiario} onChange={e => setBeneficiario(e.target.value)}>
                <option value="">—</option>
                {empleados.map(emp => <option key={emp.id} value={emp.name}>{emp.name}</option>)}
              </select>
            </div>
          )}
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
            <button type="submit" className="ap-btn ap-btn-primary" disabled={loading}>{loading ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Guardar movimiento'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

const ESCENARIOS = ['pesimista', 'realista', 'optimista'];
const ESCENARIO_LABEL = { pesimista: 'Pesimista', realista: 'Realista', optimista: 'Optimista' };
const PERIODO_TABS = [{ tipo: 'mes', label: 'Mes' }, { tipo: 'trimestre', label: 'Trimestre' }, { tipo: 'año', label: 'Año' }];

function añoActual() { return new Date().getFullYear(); }

function PanelObjetivosFinanzas() {
  const [periodoTipo, setPeriodoTipo] = useState('mes');
  const [mes, setMes] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [año, setAño] = useState(añoActual());
  const [trimestre, setTrimestre] = useState(Math.ceil((new Date().getMonth() + 1) / 3));
  const [valores, setValores] = useState({ pesimista: '', realista: '', optimista: '' });
  const [listado, setListado] = useState([]);
  const [progreso, setProgreso] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState('');
  const [alcance, setAlcance] = useState('propio');

  const periodo = periodoTipo === 'mes' ? mes : periodoTipo === 'trimestre' ? `${año}-Q${trimestre}` : String(año);

  const cargarListado = useCallback(() => {
    api.get('/objetivos', { params: { periodo_tipo: periodoTipo, año: periodoTipo !== 'mes' ? año : undefined, alcance } })
      .then(r => setListado(r.data.objetivos || []))
      .catch(() => setListado([]));
  }, [periodoTipo, año, alcance]);

  useEffect(() => { cargarListado(); }, [cargarListado]);

  useEffect(() => {
    api.get('/objetivos/progreso', { params: { periodo_tipo: periodoTipo, periodo, alcance } })
      .then(r => setProgreso(r.data))
      .catch(() => setProgreso(null));
  }, [periodoTipo, periodo, alcance]);

  useEffect(() => {
    const v = { pesimista: '', realista: '', optimista: '' };
    listado.filter(o => o.periodo === periodo).forEach(o => { v[o.escenario] = o.importe; });
    setValores(v);
  }, [periodo, listado]);

  const guardar = async (e) => {
    e.preventDefault();
    setGuardando(true); setMsg('');
    try {
      await Promise.all(
        ESCENARIOS.filter(esc => valores[esc] !== '' && valores[esc] !== null)
          .map(esc => api.put('/objetivos', { periodo_tipo: periodoTipo, periodo, escenario: esc, importe: parseFloat(valores[esc]) || 0, alcance }))
      );
      setMsg('Guardado');
      cargarListado();
      api.get('/objetivos/progreso', { params: { periodo_tipo: periodoTipo, periodo, alcance } }).then(r => setProgreso(r.data)).catch(() => {});
    } catch (err) {
      setMsg(err.response?.data?.detalle || 'Error al guardar');
    } finally {
      setGuardando(false);
      setTimeout(() => setMsg(''), 2500);
    }
  };

  const eliminar = async (id) => {
    try { await api.delete(`/objetivos/${id}`); cargarListado(); } catch {}
  };

  return (
    <div className="fz-chart-card" style={{ marginBottom: '1.5rem' }}>
      <p className="fz-chart-title"><BarChart2 size={15} /> Objetivos de facturación</p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button type="button" className={`ap-btn ap-btn-sm ${alcance === 'propio' ? 'ap-btn-primary' : 'ap-btn-ghost'}`} onClick={() => setAlcance('propio')}>Mis objetivos</button>
        <button type="button" className={`ap-btn ap-btn-sm ${alcance === 'equipo' ? 'ap-btn-primary' : 'ap-btn-ghost'}`} onClick={() => setAlcance('equipo')}>Objetivos del equipo</button>
      </div>
      <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: -6, marginBottom: 12 }}>
        {alcance === 'propio' ? 'Solo tú los ves — se comparan contra tu beneficio en caja.' : 'Los que ve el equipo en Ventas — se comparan contra el beneficio previsto (venta − costes directos).'}
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {PERIODO_TABS.map(t => (
          <button key={t.tipo} type="button" className={`ap-btn ap-btn-sm ${periodoTipo === t.tipo ? 'ap-btn-primary' : 'ap-btn-ghost'}`} onClick={() => setPeriodoTipo(t.tipo)}>{t.label}</button>
        ))}
      </div>

      <form onSubmit={guardar} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', marginBottom: 16 }}>
        {periodoTipo === 'mes' && (
          <div className="ap-field" style={{ minWidth: 160 }}><label>Mes</label><input type="month" className="ap-select" value={mes} onChange={e => setMes(e.target.value)} /></div>
        )}
        {periodoTipo === 'trimestre' && (
          <>
            <div className="ap-field" style={{ minWidth: 100 }}><label>Año</label><input type="number" className="ap-select" value={año} onChange={e => setAño(parseInt(e.target.value) || añoActual())} /></div>
            <div className="ap-field" style={{ minWidth: 120 }}><label>Trimestre</label>
              <select className="ap-select" value={trimestre} onChange={e => setTrimestre(parseInt(e.target.value))}>
                {[1, 2, 3, 4].map(q => <option key={q} value={q}>Q{q}</option>)}
              </select>
            </div>
          </>
        )}
        {periodoTipo === 'año' && (
          <div className="ap-field" style={{ minWidth: 100 }}><label>Año</label><input type="number" className="ap-select" value={año} onChange={e => setAño(parseInt(e.target.value) || añoActual())} /></div>
        )}
        {ESCENARIOS.map(esc => (
          <div className="ap-field" key={esc} style={{ minWidth: 130 }}>
            <label>{ESCENARIO_LABEL[esc]} (€)</label>
            <input type="number" step="0.01" min="0" className="ap-select" placeholder="0.00" value={valores[esc]} onChange={e => setValores(v => ({ ...v, [esc]: e.target.value }))} />
          </div>
        ))}
        <button type="submit" className="ap-btn ap-btn-primary" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar objetivo'}</button>
        {msg && <span style={{ fontSize: 12, color: msg === 'Guardado' ? '#8bae8f' : '#ae6b6b' }}>{msg}</span>}
      </form>

      {progreso && (progreso.porEscenario?.pesimista?.objetivo != null || progreso.porEscenario?.realista?.objetivo != null || progreso.porEscenario?.optimista?.objetivo != null) && (
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
          <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase' }}>Beneficio en caja (cuenta para tu objetivo)</div><strong style={{ fontSize: 15 }}>{fmt(progreso.beneficioLimpioPorProyecto)}</strong>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>Cobrado − gastos directos ya registrados</div>
          </div>
          <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase' }}>Beneficio previsto (lo que ve el equipo)</div><strong style={{ fontSize: 15, color: 'rgba(255,255,255,0.5)' }}>{fmt(progreso.beneficioPrevistoPeriodo)}</strong>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>Venta − costes directos previstos</div>
          </div>
          <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase' }}>Cobrado (referencia)</div><strong style={{ fontSize: 15, color: 'rgba(255,255,255,0.5)' }}>{fmt(progreso.facturacionCobrada)}</strong></div>
          <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase' }}>Vendido (referencia)</div><strong style={{ fontSize: 15, color: 'rgba(255,255,255,0.5)' }}>{fmt(progreso.facturacionVendida)}</strong>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{fmt(progreso.facturacionVendidaLimpia)} limpio · {fmt(progreso.facturacionVendidaEjecucion)} ejecución</div>
          </div>
          {progreso.facturacionNeta !== undefined && (
            <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase' }}>Neto empresa (cobrado − TODOS los gastos)</div><strong style={{ fontSize: 15, color: progreso.facturacionNeta >= 0 ? '#8bae8f' : '#ae6b6b' }}>{fmt(progreso.facturacionNeta)}</strong></div>
          )}
          {ESCENARIOS.filter(esc => progreso.porEscenario?.[esc]?.objetivo != null).map(esc => {
            const resta = alcance === 'propio' ? progreso.porEscenario[esc].restaBeneficioLimpio : progreso.porEscenario[esc].restaBeneficioPrevisto;
            return (
              <div key={esc}>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase' }}>Falta ({ESCENARIO_LABEL[esc]})</div>
                <strong style={{ fontSize: 15, color: resta > 0 ? '#f5b748' : '#8bae8f' }}>
                  {resta > 0 ? fmt(resta) : '¡Cumplido! 🎉'}
                </strong>
              </div>
            );
          })}
        </div>
      )}

      {listado.length > 0 && (
        <div className="fz-tabla">
          <div className="fz-row fz-row--head"><span>Periodo</span><span>Escenario</span><span>Importe</span><span></span></div>
          {listado.sort((a, b) => a.periodo.localeCompare(b.periodo)).map(o => (
            <div key={o.id} className="fz-row">
              <span>{o.periodo}</span>
              <span>{ESCENARIO_LABEL[o.escenario]}</span>
              <span className="fz-importe fz-importe--ingreso">{fmt(o.importe)}</span>
              <button className="ap-btn-icon" onClick={() => eliminar(o.id)}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EquipoPeriodos() {
  const [tipo, setTipo] = useState('mes');
  const [equipo, setEquipo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [abierto, setAbierto] = useState(null);
  const [periodoAbierto, setPeriodoAbierto] = useState(null);

  useEffect(() => {
    setLoading(true);
    api.get('/comisiones/equipo/periodos', { params: { tipo } })
      .then(r => setEquipo(r.data.equipo || []))
      .catch(() => setEquipo(null))
      .finally(() => setLoading(false));
  }, [tipo]);

  const conProyectos = (equipo || []).filter(m => m.modelo === 'por_proyecto');
  const sinProyectos = (equipo || []).filter(m => m.modelo !== 'por_proyecto');

  return (
    <div style={{ marginTop: 4, marginBottom: 20, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.4)', margin: 0 }}>Desglose por persona y periodo</p>
        <div style={{ display: 'flex', gap: 6 }}>
          {PERIODO_TABS.map(t => (
            <button key={t.tipo} type="button" className={`ap-btn ap-btn-xs ${tipo === t.tipo ? 'ap-btn-primary' : 'ap-btn-ghost'}`} onClick={() => setTipo(t.tipo)}>{t.label}</button>
          ))}
        </div>
      </div>

      {loading ? <div className="ap-loading">Calculando…</div> : !equipo || conProyectos.length === 0 ? (
        <p className="ap-empty-sm">Todavía nadie tiene proyectos asignados (modelo "por proyecto"). Asígnalos desde "Ver relación completa" de una venta.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {conProyectos.map(m => (
            <div key={m.nombre}>
              <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" style={{ justifyContent: 'space-between', width: '100%' }} onClick={() => setAbierto(a => a === m.nombre ? null : m.nombre)}>
                <span>{m.nombre}</span>
                <span style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}>{abierto === m.nombre ? 'Ocultar' : 'Ver desglose'}</span>
              </button>
              {abierto === m.nombre && (
                m.periodos.length === 0 ? <p className="ap-empty-sm" style={{ padding: '6px 12px' }}>Sin ingresos cobrados todavía.</p> : (
                  <div className="fz-tabla" style={{ marginTop: 4 }}>
                    <div className="fz-row fz-row--head"><span>Periodo</span><span>Generado</span><span>Cobrado</span><span>Pendiente</span></div>
                    {m.periodos.map(p => {
                      const clave = `${m.nombre}|${p.periodo}`;
                      return (
                        <div key={p.periodo}>
                          <div className="fz-row" style={{ cursor: p.porVenta?.length ? 'pointer' : 'default' }} onClick={() => p.porVenta?.length && setPeriodoAbierto(a => a === clave ? null : clave)}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              {p.porVenta?.length > 0 && (periodoAbierto === clave ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
                              {fmtPeriodoLargo(p.periodo, tipo)}
                            </span>
                            <span>{fmt(p.devengado)}</span>
                            <span style={{ color: '#22c55e' }}>{fmt(p.pagado)}</span>
                            <span style={{ color: p.pendiente > 0.01 ? '#f5b748' : 'rgba(255,255,255,0.4)' }}>{fmt(p.pendiente)}</span>
                          </div>
                          {periodoAbierto === clave && p.porVenta?.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 12px 12px 28px' }}>
                              {p.porVenta.map(v => (
                                <div key={v.ventaId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>
                                  <span>{v.ventaNombre}</span>
                                  <span>{fmt(v.devengado)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <div className="fz-row" style={{ fontWeight: 600, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                      <span>Total</span>
                      <span>{fmt(m.periodos.reduce((s, p) => s + p.devengado, 0))}</span>
                      <span style={{ color: '#22c55e' }}>{fmt(m.periodos.reduce((s, p) => s + p.pagado, 0))}</span>
                      <span style={{ color: '#f5b748' }}>{fmt(m.periodos.reduce((s, p) => s + p.pendiente, 0))}</span>
                    </div>
                  </div>
                )
              )}
            </div>
          ))}
          {sinProyectos.length > 0 && (
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>
              {sinProyectos.map(m => m.nombre).join(', ')} {sinProyectos.length === 1 ? 'sigue' : 'siguen'} en el modelo de % global — su desglose por periodo ya se ve arriba, cambiando de pestaña Mes/Trimestre/Año.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function PanelComisiones() {
  const [periodoTipo, setPeriodoTipo] = useState('mes');
  const [mes, setMes] = useState(new Date().toISOString().slice(0, 7));
  const [año, setAño] = useState(añoActual());
  const [trimestre, setTrimestre] = useState(Math.ceil((new Date().getMonth() + 1) / 3));
  const [calculo, setCalculo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pagando, setPagando] = useState(null);
  const [historico, setHistorico] = useState([]);
  const [verHistorico, setVerHistorico] = useState(false);
  const [modalConfig, setModalConfig] = useState(false);
  const [montosManual, setMontosManual] = useState({});
  const [verEquipoPeriodos, setVerEquipoPeriodos] = useState(false);

  const periodo = periodoTipo === 'mes' ? mes : periodoTipo === 'trimestre' ? `${año}-Q${trimestre}` : String(año);
  const periodoLabel = periodoTipo === 'mes' ? fmtMesCorto(mes) + ' ' + mes.slice(0, 4) : periodo;

  const cargar = useCallback(() => {
    setLoading(true);
    api.get('/comisiones/calculo', { params: { periodo_tipo: periodoTipo, periodo } })
      .then(r => {
        setCalculo(r.data);
        const iniciales = {};
        (r.data.porMiembro || []).forEach(m => { iniciales[m.nombre] = m.pendiente > 0 ? m.pendiente.toFixed(2) : ''; });
        setMontosManual(iniciales);
      })
      .catch(() => setCalculo(null))
      .finally(() => setLoading(false));
  }, [periodoTipo, periodo]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { if (verHistorico) api.get('/comisiones/historico').then(r => setHistorico(r.data.historico || [])).catch(() => {}); }, [verHistorico]);

  const pagar = async (nombre) => {
    const monto = parseFloat(montosManual[nombre]);
    if (!monto || monto <= 0) return;
    setPagando(nombre);
    try {
      await api.post('/comisiones/pagar', { nombre, monto, periodo_label: periodoLabel });
      cargar();
    } catch {
      // noop
    } finally {
      setPagando(null);
    }
  };

  return (
    <div className="fz-chart-card" style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <p className="fz-chart-title" style={{ margin: 0 }}><Users size={15} /> Comisiones del equipo</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => setVerEquipoPeriodos(v => !v)}>{verEquipoPeriodos ? 'Ocultar desglose por persona' : 'Ver desglose por persona y mes'}</button>
          <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => setVerHistorico(v => !v)}>{verHistorico ? 'Ver periodo actual' : 'Ver histórico total'}</button>
          <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => setModalConfig(true)}>Configurar %</button>
        </div>
      </div>
      {!verHistorico && <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: -6, marginBottom: 14 }}>"Le corresponde" es solo el cálculo automático de referencia — el importe que se registra cada mes lo pones tú a mano en "Importe a registrar". Si alguien tiene proyectos asignados (desde "Ver relación completa" de una venta), su cifra sale de sumar esos proyectos según lo cobrado hasta ahora, no del % de aquí abajo.</p>}

      {verEquipoPeriodos && <EquipoPeriodos />}

      {verHistorico ? (
        historico.length === 0 ? <div className="ap-empty"><p>Todavía no se ha registrado ningún pago de comisión.</p></div> : (
          <div className="fz-tabla">
            <div className="fz-row fz-row--head"><span>Persona</span><span></span><span></span><span></span><span>Total ganado contigo</span></div>
            {historico.map(h => (
              <div key={h.nombre} className="fz-row">
                <span>{h.nombre}</span><span></span><span></span><span></span>
                <span className="fz-importe fz-importe--ingreso">{fmt(h.total)}</span>
              </div>
            ))}
          </div>
        )
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {PERIODO_TABS.map(t => (
              <button key={t.tipo} type="button" className={`ap-btn ap-btn-sm ${periodoTipo === t.tipo ? 'ap-btn-primary' : 'ap-btn-ghost'}`} onClick={() => setPeriodoTipo(t.tipo)}>{t.label}</button>
            ))}
            {periodoTipo === 'mes' && <input type="month" className="ap-select" style={{ maxWidth: 160 }} value={mes} onChange={e => setMes(e.target.value)} />}
            {periodoTipo === 'trimestre' && (
              <>
                <input type="number" className="ap-select" style={{ maxWidth: 90 }} value={año} onChange={e => setAño(parseInt(e.target.value) || añoActual())} />
                <select className="ap-select" style={{ maxWidth: 90 }} value={trimestre} onChange={e => setTrimestre(parseInt(e.target.value))}>
                  {[1, 2, 3, 4].map(q => <option key={q} value={q}>Q{q}</option>)}
                </select>
              </>
            )}
            {periodoTipo === 'año' && <input type="number" className="ap-select" style={{ maxWidth: 90 }} value={año} onChange={e => setAño(parseInt(e.target.value) || añoActual())} />}
          </div>

          {loading ? <div className="ap-loading">Calculando…</div> : !calculo ? (
            <div className="ap-empty"><p>No se pudo calcular. Revisa que la migración de comisiones esté aplicada.</p></div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
                <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase' }}>Beneficio neto del periodo</div><strong style={{ fontSize: 15 }}>{fmt(calculo.beneficioNeto)}</strong></div>
                {calculo.reservaPendiente > 0 && (
                  <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase' }}>Reserva costes pendientes</div><strong style={{ fontSize: 15, color: '#f5b748' }}>-{fmt(calculo.reservaPendiente)}</strong></div>
                )}
                <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase' }}>Beneficio a repartir</div><strong style={{ fontSize: 15, color: '#a78bfa' }}>{fmt(calculo.beneficioDistribuible)}</strong></div>
                <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase' }}>Caja antes de pagar al equipo</div><strong style={{ fontSize: 15, color: '#8bae8f' }}>{fmt(calculo.cajaAntesDePagarEquipo)}</strong></div>
                <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase' }}>Caja después de pagar al equipo</div><strong style={{ fontSize: 15, color: calculo.cajaDespuesDePagarEquipo >= 0 ? '#8bae8f' : '#ae6b6b' }}>{fmt(calculo.cajaDespuesDePagarEquipo)}</strong></div>
              </div>
              {calculo.reservaPendiente > 0 && (
                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: -8, marginBottom: 12 }}>
                  Hay proyectos con ejecución en marcha cuyo coste final todavía no se conoce del todo — se reserva esa parte antes de calcular comisiones, para no repartir beneficio que en realidad está pendiente de gastar.
                </p>
              )}

              {calculo.porMiembro.length === 0 ? (
                <div className="ap-empty"><p>No hay miembros del equipo configurados. Pulsa "Configurar %".</p></div>
              ) : (
                <div className="fz-tabla">
                  <div className="fz-row fz-row--head"><span>Persona</span><span>%</span><span>Le corresponde</span><span>Ya pagado</span><span>Importe a registrar</span><span></span></div>
                  {calculo.porMiembro.map(m => (
                    <div key={m.nombre} className="fz-row">
                      <span>{m.nombre}</span>
                      <span>{m.modelo === 'por_proyecto' ? 'Por proyecto' : `${m.porcentaje}%`}</span>
                      <span>{fmt(m.comisionCalculada)}</span>
                      <span>{fmt(m.yaPagado)}</span>
                      <span>
                        <input
                          type="number" step="0.01" min="0"
                          value={montosManual[m.nombre] ?? ''}
                          onChange={e => setMontosManual(v => ({ ...v, [m.nombre]: e.target.value }))}
                          placeholder="0.00"
                          className="ap-select" style={{ width: 100, padding: '4px 8px' }}
                        />
                      </span>
                      <span>
                        <button className="ap-btn ap-btn-primary ap-btn-xs" disabled={pagando === m.nombre || !parseFloat(montosManual[m.nombre])} onClick={() => pagar(m.nombre)}>
                          {pagando === m.nombre ? '...' : <><Check size={12} /> Registrar</>}
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {modalConfig && <ComisionesConfigModal onClose={() => setModalConfig(false)} onSaved={() => { setModalConfig(false); cargar(); }} />}
    </div>
  );
}

function ComisionesConfigModal({ onClose, onSaved }) {
  const [equipo, setEquipo] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [loading, setLoading] = useState(true);
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [pctNuevo, setPctNuevo] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = () => { api.get('/comisiones/config').then(r => setEquipo(r.data.equipo || [])).catch(() => {}).finally(() => setLoading(false)); };
  useEffect(cargar, []);
  useEffect(() => { api.get('/employees').then(r => setEmpleados(r.data.employees || [])).catch(() => {}); }, []);

  const actualizarPct = async (nombre, porcentaje) => {
    try { await api.put('/comisiones/config', { nombre, porcentaje }); cargar(); } catch {}
  };

  const actualizarEmpleado = async (miembro, employee_id) => {
    try { await api.put('/comisiones/config', { nombre: miembro.nombre, porcentaje: miembro.porcentaje, employee_id: employee_id || null }); cargar(); } catch {}
  };

  const eliminar = async (id) => {
    try { await api.delete(`/comisiones/config/${id}`); cargar(); } catch {}
  };

  const añadir = async (e) => {
    e.preventDefault();
    if (!nombreNuevo.trim() || pctNuevo === '') return;
    setGuardando(true);
    try {
      await api.put('/comisiones/config', { nombre: nombreNuevo.trim(), porcentaje: pctNuevo });
      setNombreNuevo(''); setPctNuevo('');
      cargar();
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="ap-modal-overlay" onClick={onClose}>
      <div className="ap-modal" onClick={e => e.stopPropagation()}>
        <div className="ap-modal-head"><h2>Configurar comisiones</h2><button className="ap-modal-close" onClick={onClose}><X size={16} /></button></div>
        <div className="ap-modal-form">
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: -4 }}>% sobre el beneficio neto total de cada periodo. Enlaza a una cuenta del CRM para que esa persona pueda ver "Mis Comisiones" ella sola.</p>
          {!loading && equipo.map(m => (
            <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 80, fontSize: 13 }}>{m.nombre}</span>
              <input type="number" step="0.5" min="0" max="100" defaultValue={m.porcentaje} className="ap-select" style={{ width: 70 }}
                onBlur={e => { if (parseFloat(e.target.value) !== m.porcentaje) actualizarPct(m.nombre, e.target.value); }} />
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>%</span>
              <select className="ap-select" style={{ width: 150 }} defaultValue={m.employee_id || ''} onChange={e => actualizarEmpleado(m, e.target.value)}>
                <option value="">Sin cuenta CRM</option>
                {empleados.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <button className="ap-btn-icon" onClick={() => eliminar(m.id)}><Trash2 size={13} /></button>
            </div>
          ))}
          <form onSubmit={añadir} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12 }}>
            <input value={nombreNuevo} onChange={e => setNombreNuevo(e.target.value)} placeholder="Nombre" className="ap-select" style={{ flex: 1 }} />
            <input type="number" step="0.5" min="0" max="100" value={pctNuevo} onChange={e => setPctNuevo(e.target.value)} placeholder="%" className="ap-select" style={{ width: 80 }} />
            <button type="submit" className="ap-btn ap-btn-primary ap-btn-sm" disabled={guardando}>Añadir</button>
          </form>
          <div className="ap-modal-actions"><button type="button" className="ap-btn ap-btn-ghost" onClick={onClose}>Cerrar</button></div>
        </div>
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
  const [filtroBeneficiario, setFiltroBeneficiario] = useState('');
  const [empleados, setEmpleados] = useState([]);
  const [modal, setModal] = useState(null);
  const [movimientoEditando, setMovimientoEditando] = useState(null);
  const [confirmId, setConfirmId] = useState(null);

  useEffect(() => { api.get('/employees').then(r => setEmpleados(r.data.employees || [])).catch(() => {}); }, []);

  const loadResumen = useCallback(() => {
    api.get('/finanzas/resumen').then(r => setResumen(r.data)).catch(() => {});
  }, []);

  const loadMovimientos = useCallback(() => {
    const params = {};
    if (filtroTipo !== 'todos') params.tipo = filtroTipo;
    if (filtroMes) params.mes = filtroMes;
    if (filtroBeneficiario) params.beneficiario = filtroBeneficiario;
    api.get('/finanzas', { params }).then(r => setMovimientos(r.data.movimientos || [])).catch(() => {}).finally(() => setLoading(false));
  }, [filtroTipo, filtroMes, filtroBeneficiario]);

  useEffect(() => { loadResumen(); }, [loadResumen]);
  useEffect(() => { setLoading(true); loadMovimientos(); }, [loadMovimientos]);

  const handleSaved = (mov) => {
    setModal(null);
    setMovimientoEditando(null);
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

      <PanelObjetivosFinanzas />

      <PanelComisiones />

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
        <select className="ap-select" value={filtroBeneficiario} onChange={e => setFiltroBeneficiario(e.target.value)}>
          <option value="">Todos los empleados</option>
          {empleados.map(emp => <option key={emp.id} value={emp.name}>{emp.name}</option>)}
        </select>
        {filtroBeneficiario && <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => setFiltroBeneficiario('')}>Quitar filtro</button>}
      </div>

      {filtroBeneficiario && !loading && (
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: -8, marginBottom: 12 }}>
          Total pagado a <strong style={{ color: '#fff' }}>{filtroBeneficiario}</strong> (con estos filtros): <strong style={{ color: '#ae6b6b' }}>{fmt(movimientos.filter(m => m.tipo === 'gasto').reduce((s, m) => s + Number(m.monto), 0))}</strong>
        </p>
      )}

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
              <span className="fz-concepto">{m.concepto}{m.ventas?.nombre && <span className="fz-lead-tag">{m.ventas.nombre}</span>}{m.beneficiario && <span className="fz-lead-tag">→ {m.beneficiario}</span>}</span>
              <span>{m.categoria}</span>
              <span>{m.metodo_pago || '—'}</span>
              <span>{new Date(m.fecha).toLocaleDateString('es-ES')}</span>
              <span className={`fz-importe fz-importe--${m.tipo}`}>{m.tipo === 'gasto' ? '-' : '+'}{fmt(m.monto)}</span>
              <span style={{ display: 'flex', gap: 4 }}>
                <button className="ap-btn-icon" onClick={() => setMovimientoEditando(m)}><Pencil size={13} /></button>
                <button className="ap-btn-icon" onClick={() => setConfirmId(m.id)}><Trash2 size={13} /></button>
              </span>
            </div>
          ))}
        </div>
      )}

      {modal && <MovimientoModal tipoInicial="ingreso" onClose={() => setModal(null)} onSaved={handleSaved} />}
      {movimientoEditando && <MovimientoModal movimiento={movimientoEditando} onClose={() => setMovimientoEditando(null)} onSaved={handleSaved} />}
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
