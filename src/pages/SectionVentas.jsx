import { useState, useEffect } from 'react';
import api from '../services/api';
import { TrendingUp, Euro, Hash, ChevronDown, ChevronUp, Target, Plus, X, Users } from 'lucide-react';
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

function periodoActual(tipo) {
  const hoy = new Date();
  const y = hoy.getFullYear();
  if (tipo === 'año') return String(y);
  if (tipo === 'trimestre') return `${y}-Q${Math.ceil((hoy.getMonth() + 1) / 3)}`;
  return `${y}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
}

const ESCENARIO_LABEL = { pesimista: 'Pesimista', realista: 'Realista', optimista: 'Optimista' };
const ESCENARIO_COLOR = { pesimista: '#f87171', realista: '#beb0a2', optimista: '#22c55e' };
const PERIODO_TABS = [{ tipo: 'mes', label: 'Mes' }, { tipo: 'trimestre', label: 'Trimestre' }, { tipo: 'año', label: 'Año' }];

function PanelObjetivos() {
  const [periodoTipo, setPeriodoTipo] = useState('mes');
  const [progreso, setProgreso] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    setCargando(true);
    api.get('/objetivos/progreso', { params: { periodo_tipo: periodoTipo, periodo: periodoActual(periodoTipo) } })
      .then(r => setProgreso(r.data))
      .catch(() => setProgreso(null))
      .finally(() => setCargando(false));
  }, [periodoTipo]);

  const escenarios = ESCENARIOS_ORDEN.filter(esc => progreso?.porEscenario?.[esc]?.objetivo != null);

  return (
    <div className="vt-objetivos-card">
      <div className="vt-objetivos-head">
        <div className="vt-objetivos-title"><Target size={16} /><span>Objetivos de facturación</span></div>
        <div className="vt-objetivos-tabs">
          {PERIODO_TABS.map(t => (
            <button key={t.tipo} className={`ap-btn ap-btn-sm ${periodoTipo === t.tipo ? 'ap-btn-primary' : 'ap-btn-ghost'}`} onClick={() => setPeriodoTipo(t.tipo)}>{t.label}</button>
          ))}
        </div>
      </div>

      {cargando ? (
        <div className="ap-loading">Cargando objetivos…</div>
      ) : !progreso || escenarios.length === 0 ? (
        <div className="ap-empty"><p>Todavía no hay objetivos definidos para este periodo.</p></div>
      ) : (
        <>
          <div className="vt-objetivos-facturacion">
            <div><span>Cobrado</span><strong>{fmt(progreso.facturacionCobrada)}</strong></div>
            <div><span>Vendido (referencia)</span><strong style={{ color: 'rgba(255,255,255,0.5)' }}>{fmt(progreso.facturacionVendida)}</strong></div>
          </div>
          <div className="vt-objetivos-lista">
            {escenarios.map(esc => {
              const e = progreso.porEscenario[esc];
              const pct = Math.min(e.cumplidoCobradoPct ?? 0, 100);
              return (
                <div key={esc} className="vt-objetivo-row">
                  <div className="vt-objetivo-row-head">
                    <span className="vt-objetivo-nombre" style={{ color: ESCENARIO_COLOR[esc] }}>{ESCENARIO_LABEL[esc]}</span>
                    <span className="vt-objetivo-meta">{fmt(progreso.facturacionCobrada)} / {fmt(e.objetivo)} · resta {fmt(e.restaCobrado)}</span>
                  </div>
                  <div className="vt-objetivo-bar"><div className="vt-objetivo-bar-fill" style={{ width: `${pct}%`, background: ESCENARIO_COLOR[esc] }} /></div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

const ESCENARIOS_ORDEN = ['pesimista', 'realista', 'optimista'];
const TIPO_COLOR = { diseño_1: '#06b6d4', diseño_2: '#beb0a2' };

const FASE_LABELS = { 1: 'Diagnóstico', 2: 'Diseño', 3: 'Producción', 4: 'Instalación', 5: 'Entregado' };

function FichaConectada({ leadId }) {
  const [ficha, setFicha] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    setCargando(true);
    api.get(`/leads/${leadId}/ficha-cliente`)
      .then(r => setFicha(r.data))
      .catch(() => setFicha(null))
      .finally(() => setCargando(false));
  }, [leadId]);

  if (cargando) return <div className="vt-ficha-conectada"><span className="ap-loading" style={{ padding: 0 }}>Cargando…</span></div>;
  if (!ficha) return <div className="vt-ficha-conectada"><span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>No se pudo cargar la ficha.</span></div>;

  return (
    <div className="vt-ficha-conectada">
      <div className="vt-ficha-dato"><span>Presupuesto</span><strong>{fmt(ficha.presupuesto)}</strong></div>
      <div className="vt-ficha-dato"><span>Cobrado</span><strong style={{ color: '#22c55e' }}>{fmt(ficha.cobrado)}</strong></div>
      <div className="vt-ficha-dato"><span>Pendiente</span><strong style={{ color: ficha.pendiente > 0 ? '#f5b748' : 'rgba(255,255,255,0.4)' }}>{fmt(ficha.pendiente)}</strong></div>
      <div className="vt-ficha-dato">
        <span>Proyecto</span>
        <strong>{ficha.proyecto ? `${FASE_LABELS[ficha.proyecto.phase] || ficha.proyecto.phase} · ${ficha.proyecto.project_name}` : 'Sin proyecto enlazado'}</strong>
      </div>
    </div>
  );
}

function NuevaVentaClienteModal({ cliente: clientePreseleccionado, onClose, onSaved }) {
  const [clientes, setClientes] = useState([]);
  const [cargandoClientes, setCargandoClientes] = useState(!clientePreseleccionado);
  const [clienteId, setClienteId] = useState(clientePreseleccionado?.clienteId || '');
  const [valor, setValor] = useState('');
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [tipoProyecto, setTipoProyecto] = useState('solo_diseno');
  const [notas, setNotas] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (clientePreseleccionado) return;
    api.get('/ventas/clientes').then(r => setClientes(r.data.clientes || [])).catch(() => {}).finally(() => setCargandoClientes(false));
  }, [clientePreseleccionado]);

  const cliente = clientePreseleccionado || clientes.find(c => c.clienteId === clienteId);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!cliente) { setError('Elige un cliente'); return; }
    if (!valor) { setError('Indica el valor de la venta'); return; }
    setError(''); setLoading(true);
    try {
      await api.post('/leads', {
        nombre: cliente.nombre,
        instagram: cliente.instagram || undefined,
        email: cliente.email || undefined,
        telefono: cliente.telefono || undefined,
        estado: 'venta',
        valor_estimado: valor,
        fecha_venta: fecha,
        fecha_contacto: fecha,
        canal: 'recomendacion',
        tipo_proyecto: tipoProyecto,
        notas: notas || `Venta adicional a cliente existente (${cliente.numCompras} compra${cliente.numCompras !== 1 ? 's' : ''} previa${cliente.numCompras !== 1 ? 's' : ''})`,
        pct_cierre: 100,
      });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al registrar la venta');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ap-modal-overlay" onClick={onClose}>
      <div className="ap-modal" onClick={e => e.stopPropagation()}>
        <div className="ap-modal-head"><h2>{cliente ? `Nueva venta a ${cliente.nombre}` : 'Nueva venta a cliente existente'}</h2><button className="ap-modal-close" onClick={onClose}><X size={16} /></button></div>
        <form onSubmit={handleSubmit} className="ap-modal-form">
          {!clientePreseleccionado && (
            <div className="ap-field">
              <label>Cliente *</label>
              {cargandoClientes ? (
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Cargando clientes…</p>
              ) : clientes.length === 0 ? (
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Todavía no hay ningún cliente con ventas registradas.</p>
              ) : (
                <select className="ap-select" value={clienteId} onChange={e => setClienteId(e.target.value)} required autoFocus>
                  <option value="">— Selecciona un cliente —</option>
                  {clientes.map(c => <option key={c.clienteId} value={c.clienteId}>{c.nombre} · {c.numCompras} compra{c.numCompras !== 1 ? 's' : ''} · {fmt(c.totalVendido)}</option>)}
                </select>
              )}
            </div>
          )}
          {cliente && (
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: -4 }}>
              Cliente ya identificado{cliente.instagram ? ` (@${cliente.instagram})` : ''} — {cliente.numCompras} compra{cliente.numCompras !== 1 ? 's' : ''} previa{cliente.numCompras !== 1 ? 's' : ''}, {fmt(cliente.totalVendido)} en total.
            </p>
          )}
          <div className="ap-field"><label>Valor de la venta (€) *</label><input type="number" step="0.01" min="0" value={valor} onChange={e => setValor(e.target.value)} placeholder="0.00" required /></div>
          <div className="ap-field"><label>Fecha de venta</label><input type="date" value={fecha} onChange={e => setFecha(e.target.value)} /></div>
          <div className="ap-field"><label>Tipo de proyecto</label>
            <select className="ap-select" value={tipoProyecto} onChange={e => setTipoProyecto(e.target.value)}>
              <option value="solo_diseno">Solo diseño (limpio)</option>
              <option value="con_ejecucion">Con ejecución (lleva gastos)</option>
            </select>
          </div>
          <div className="ap-field"><label>Notas <span className="ap-optional">(opcional)</span></label><textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2} /></div>
          {error && <p className="ap-error">{error}</p>}
          <div className="ap-modal-actions">
            <button type="button" className="ap-btn ap-btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" className="ap-btn ap-btn-primary" disabled={loading}>{loading ? 'Guardando…' : 'Registrar venta'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PanelClientes() {
  const [clientes, setClientes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [abierto, setAbierto] = useState(null);
  const [modalCliente, setModalCliente] = useState(null);

  const cargar = () => {
    setLoading(true);
    api.get('/ventas/clientes').then(r => setClientes(r.data.clientes || [])).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { cargar(); }, []);

  if (loading) return <div className="ap-loading">Cargando clientes…</div>;
  if (clientes.length === 0) return <div className="ap-empty"><p>Todavía no hay clientes con ventas registradas.</p></div>;

  return (
    <div className="vt-meses">
      {clientes.map(c => {
        const open = abierto === c.clienteId;
        return (
          <div key={c.clienteId} className="vt-mes-card">
            <button className="vt-mes-head" onClick={() => setAbierto(open ? null : c.clienteId)}>
              <div className="vt-mes-title">
                <span className="vt-mes-nombre" style={{ textTransform: 'none' }}>{c.nombre}</span>
                <span className="vt-mes-count">{c.numCompras} compra{c.numCompras !== 1 ? 's' : ''}{c.numCompras > 1 ? ' 🔁' : ''}</span>
              </div>
              <div className="vt-mes-right">
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Cobrado {fmt(c.totalCobrado)}</span>
                <strong className="vt-mes-total">{fmt(c.totalVendido)}</strong>
                {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </div>
            </button>
            {open && (
              <div className="vt-mes-table">
                <div className="vt-row vt-row--head">
                  <span>Tipo</span><span>Canal</span><span>Proyecto</span><span>Fecha</span><span>Cobrado</span><span>Valor</span>
                </div>
                {c.compras.map((compra, i) => (
                  <div key={i} className="vt-row">
                    <span><span className="vt-tipo-badge" style={{ background: `${TIPO_COLOR[compra.tipo]}20`, color: TIPO_COLOR[compra.tipo] }}>{compra.tipoLabel}</span></span>
                    <span style={{ textTransform: 'capitalize' }}>{compra.canal || '—'}</span>
                    <span>{compra.tipoProyecto === 'con_ejecucion' ? 'Ejecución' : 'Limpio'}</span>
                    <span>{compra.fecha ? new Date(compra.fecha).toLocaleDateString('es-ES') : '—'}</span>
                    <span>{fmt(compra.cobrado)}</span>
                    <span className="vt-valor">{fmt(compra.valor)}</span>
                  </div>
                ))}
                <div style={{ padding: '10px 12px' }}>
                  <button className="ap-btn ap-btn-primary ap-btn-sm" onClick={() => setModalCliente(c)}><Plus size={13} /> Nueva venta a este cliente</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {modalCliente && (
        <NuevaVentaClienteModal cliente={modalCliente} onClose={() => setModalCliente(null)} onSaved={() => { setModalCliente(null); cargar(); }} />
      )}
    </div>
  );
}

export function SectionVentas() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openMes, setOpenMes] = useState(null);
  const [filtroTipo, setFiltroTipo] = useState('todas');
  const [ventaAbierta, setVentaAbierta] = useState(null);
  const [vista, setVista] = useState('mes');
  const [modalNuevaVenta, setModalNuevaVenta] = useState(false);

  const cargarVentas = () => {
    api.get('/ventas')
      .then(r => {
        setData(r.data);
        if (r.data.porMes?.length) setOpenMes(r.data.porMes[0].mes);
      })
      .catch(() => setError('No se pudieron cargar las ventas'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { cargarVentas(); }, []);

  const { ventas: todasLasVentas = [], resumen = { total: 0, valorTotal: 0, valorLimpio: 0, valorEjecucion: 0, valorMedio: 0, totalDiseño1: 0, totalDiseño2: 0 } } = data || {};

  // Recalcula la agrupación por mes en función del filtro de tipo seleccionado
  const ventasFiltradas = filtroTipo === 'todas' ? todasLasVentas : todasLasVentas.filter(v => v.tipo === filtroTipo);
  const porMesMap = {};
  ventasFiltradas.forEach(v => {
    const mes = v.fecha ? v.fecha.slice(0, 7) : 'sin_fecha';
    if (!porMesMap[mes]) porMesMap[mes] = { mes, total: 0, count: 0, ventas: [] };
    porMesMap[mes].total += v.valor;
    porMesMap[mes].count += 1;
    porMesMap[mes].ventas.push(v);
  });
  const porMes = Object.values(porMesMap).sort((a, b) => b.mes.localeCompare(a.mes));

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
        <div><h1>Ventas</h1><p>Venta Diseño 1 (se vende el diseño) y Venta Diseño 2 (venta final del proyecto), agrupadas por mes.</p></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={`ap-btn ap-btn-sm ${vista === 'mes' ? 'ap-btn-primary' : 'ap-btn-ghost'}`} onClick={() => setVista('mes')}><Hash size={13} /> Por mes</button>
          <button className={`ap-btn ap-btn-sm ${vista === 'cliente' ? 'ap-btn-primary' : 'ap-btn-ghost'}`} onClick={() => setVista('cliente')}><Users size={13} /> Por cliente</button>
          <button className="ap-btn ap-btn-primary ap-btn-sm" onClick={() => setModalNuevaVenta(true)}><Plus size={13} /> Venta a cliente existente</button>
        </div>
      </div>

      <PanelObjetivos />

      {vista === 'mes' ? (
        <>
          <div className="vt-stats">
            <div className="vt-stat-card">
              <div className="vt-stat-icon"><Hash size={18} /></div>
              <div className="vt-stat-body"><span>Ventas totales</span><strong>{resumen.total}</strong><span className="vt-stat-sub">{resumen.totalDiseño1} Diseño 1 · {resumen.totalDiseño2} Diseño 2</span></div>
            </div>
            <div className="vt-stat-card">
              <div className="vt-stat-icon"><Euro size={18} /></div>
              <div className="vt-stat-body"><span>Valor total</span><strong>{fmt(resumen.valorTotal)}</strong></div>
            </div>
            <div className="vt-stat-card">
              <div className="vt-stat-icon"><TrendingUp size={18} /></div>
              <div className="vt-stat-body"><span>Valor medio / venta</span><strong>{fmt(resumen.valorMedio)}</strong></div>
            </div>
            <div className="vt-stat-card">
              <div className="vt-stat-icon" style={{ color: '#22c55e' }}><Euro size={18} /></div>
              <div className="vt-stat-body"><span>Vendido limpio</span><strong style={{ color: '#22c55e' }}>{fmt(resumen.valorLimpio)}</strong><span className="vt-stat-sub">Solo diseño, sin gastos</span></div>
            </div>
            <div className="vt-stat-card">
              <div className="vt-stat-icon" style={{ color: '#f5b748' }}><Euro size={18} /></div>
              <div className="vt-stat-body"><span>Vendido con ejecución</span><strong style={{ color: '#f5b748' }}>{fmt(resumen.valorEjecucion)}</strong><span className="vt-stat-sub">Lleva gastos asociados</span></div>
            </div>
          </div>

          <div className="vt-filtros">
            <button className={`ap-btn ap-btn-sm ${filtroTipo === 'todas' ? 'ap-btn-primary' : 'ap-btn-ghost'}`} onClick={() => setFiltroTipo('todas')}>Todas</button>
            <button className={`ap-btn ap-btn-sm ${filtroTipo === 'diseño_1' ? 'ap-btn-primary' : 'ap-btn-ghost'}`} onClick={() => setFiltroTipo('diseño_1')}>Venta Diseño 1</button>
            <button className={`ap-btn ap-btn-sm ${filtroTipo === 'diseño_2' ? 'ap-btn-primary' : 'ap-btn-ghost'}`} onClick={() => setFiltroTipo('diseño_2')}>Venta Diseño 2</button>
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
                          <span>Lead</span><span>Tipo</span><span>Canal</span><span>Comercial</span><span>Fecha</span><span>Valor</span>
                        </div>
                        {m.ventas.map(v => (
                          <div key={v.id}>
                            <div className="vt-row" onClick={() => setVentaAbierta(ventaAbierta === v.id ? null : v.id)} style={{ cursor: 'pointer' }}>
                              <span className="vt-lead-nombre">{v.nombre}</span>
                              <span>
                                <span className="vt-tipo-badge" style={{ background: `${TIPO_COLOR[v.tipo]}20`, color: TIPO_COLOR[v.tipo] }}>{v.tipoLabel}</span>
                                {' '}
                                <span className="vt-tipo-badge" style={{ background: v.tipoProyecto === 'con_ejecucion' ? '#f5b74820' : '#22c55e20', color: v.tipoProyecto === 'con_ejecucion' ? '#f5b748' : '#22c55e' }}>
                                  {v.tipoProyecto === 'con_ejecucion' ? 'Ejecución' : 'Limpio'}
                                </span>
                              </span>
                              <span>{v.canal || '—'}</span>
                              <span>{v.comercial || '—'}</span>
                              <span>{v.fecha ? new Date(v.fecha).toLocaleDateString('es-ES') : '—'}</span>
                              <span className="vt-valor">{fmt(v.valor)}</span>
                            </div>
                            {ventaAbierta === v.id && <FichaConectada leadId={v.leadId} />}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <PanelClientes />
      )}

      {modalNuevaVenta && (
        <NuevaVentaClienteModal
          cliente={null}
          onClose={() => setModalNuevaVenta(false)}
          onSaved={() => { setModalNuevaVenta(false); cargarVentas(); }}
        />
      )}
    </div>
  );
}
