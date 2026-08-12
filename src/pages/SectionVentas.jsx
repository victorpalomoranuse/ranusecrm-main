import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { TrendingUp, Euro, Hash, ChevronDown, ChevronUp, Target, Plus, X, Users, Pencil, Trash2 } from 'lucide-react';
import { ProyectoCompletoModal } from './ProyectoCompleto';
import './SectionVentas.css';

const CANALES = ['instagram','tiktok','whatsapp','web','recomendacion','prospeccion','ads','evento','agente','otro'];

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
const ESCENARIOS_ORDEN = ['pesimista', 'realista', 'optimista'];
const PERIODO_TABS = [{ tipo: 'mes', label: 'Mes' }, { tipo: 'trimestre', label: 'Trimestre' }, { tipo: 'año', label: 'Año' }];
const FASE_LABELS = { 1: 'Diagnóstico', 2: 'Diseño', 3: 'Producción', 4: 'Instalación', 5: 'Entregado' };

function PanelObjetivos() {
  const [periodoTipo, setPeriodoTipo] = useState('mes');
  const [progreso, setProgreso] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    setCargando(true);
    api.get('/objetivos/progreso', { params: { periodo_tipo: periodoTipo, periodo: periodoActual(periodoTipo), alcance: 'equipo' } })
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
            <div><span>Beneficio previsto (venta − costes)</span><strong>{fmt(progreso.beneficioPrevistoPeriodo)}</strong></div>
            <div><span>Beneficio cobrado (ya en caja)</span><strong style={{ color: '#22c55e' }}>{fmt(progreso.beneficioCobradoPeriodo)}</strong></div>
            <div><span>Vendido (referencia)</span><strong style={{ color: 'rgba(255,255,255,0.5)' }}>{fmt(progreso.facturacionVendida)}</strong></div>
          </div>

          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Según lo vendido</div>
          <div className="vt-objetivos-lista">
            {escenarios.map(esc => {
              const e = progreso.porEscenario[esc];
              const pct = Math.min(e.cumplidoBeneficioPrevistoPct ?? 0, 100);
              return (
                <div key={esc} className="vt-objetivo-row">
                  <div className="vt-objetivo-row-head">
                    <span className="vt-objetivo-nombre" style={{ color: ESCENARIO_COLOR[esc] }}>{ESCENARIO_LABEL[esc]}</span>
                    <span className="vt-objetivo-meta">{fmt(progreso.beneficioPrevistoPeriodo)} / {fmt(e.objetivo)} · resta {fmt(e.restaBeneficioPrevisto)}</span>
                  </div>
                  <div className="vt-objetivo-bar"><div className="vt-objetivo-bar-fill" style={{ width: `${pct}%`, background: ESCENARIO_COLOR[esc] }} /></div>
                </div>
              );
            })}
          </div>

          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '14px 0 6px' }}>Según lo cobrado</div>
          <div className="vt-objetivos-lista">
            {escenarios.map(esc => {
              const e = progreso.porEscenario[esc];
              const pct = Math.min(e.cumplidoBeneficioCobradoPct ?? 0, 100);
              return (
                <div key={`${esc}-cobrado`} className="vt-objetivo-row">
                  <div className="vt-objetivo-row-head">
                    <span className="vt-objetivo-nombre" style={{ color: ESCENARIO_COLOR[esc] }}>{ESCENARIO_LABEL[esc]}</span>
                    <span className="vt-objetivo-meta">{fmt(progreso.beneficioCobradoPeriodo)} / {fmt(e.objetivo)} · resta {fmt(e.restaBeneficioCobrado)}</span>
                  </div>
                  <div className="vt-objetivo-bar"><div className="vt-objetivo-bar-fill" style={{ width: `${pct}%`, background: '#22c55e' }} /></div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function PanelRitmo() {
  const [año, setAño] = useState(String(new Date().getFullYear()));
  const [ritmo, setRitmo] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    setCargando(true);
    api.get('/objetivos/ritmo', { params: { año, alcance: 'equipo' } })
      .then(r => setRitmo(r.data))
      .catch(() => setRitmo(null))
      .finally(() => setCargando(false));
  }, [año]);

  const escenarios = ESCENARIOS_ORDEN.filter(esc => ritmo?.porEscenario?.[esc]);

  return (
    <div className="vt-objetivos-card">
      <div className="vt-objetivos-head">
        <div className="vt-objetivos-title"><Target size={16} /><span>Ritmo necesario para cumplir el objetivo anual</span></div>
        <input type="number" value={año} onChange={e => setAño(e.target.value)} className="ap-select" style={{ width: 90 }} />
      </div>

      {cargando ? (
        <div className="ap-loading">Calculando…</div>
      ) : !ritmo || escenarios.length === 0 ? (
        <div className="ap-empty"><p>Define primero un objetivo ANUAL de equipo para ver el ritmo necesario.</p></div>
      ) : (
        <>
          <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: -4, marginBottom: 14 }}>
            {ritmo.mesesTranscurridos} mes{ritmo.mesesTranscurridos !== 1 ? 'es' : ''} transcurrido{ritmo.mesesTranscurridos !== 1 ? 's' : ''} de {año} · quedan {ritmo.mesesRestantes} mes{ritmo.mesesRestantes !== 1 ? 'es' : ''} ({ritmo.trimestresRestantes} trimestre{ritmo.trimestresRestantes !== 1 ? 's' : ''})
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', fontSize: 10.5, textAlign: 'left' }}>
                  <th style={{ padding: '4px 8px' }}>Escenario</th>
                  <th style={{ padding: '4px 8px' }}>Objetivo anual</th>
                  <th style={{ padding: '4px 8px' }}>Ritmo actual /mes</th>
                  <th style={{ padding: '4px 8px', color: '#f5b748' }}>Necesitas /mes</th>
                  <th style={{ padding: '4px 8px', color: '#f5b748' }}>Necesitas /trimestre</th>
                </tr>
              </thead>
              <tbody>
                {escenarios.map(esc => {
                  const e = ritmo.porEscenario[esc];
                  const vaBien = e.ritmoActualMensualCobrado != null && e.ritmoNecesarioMensualCobrado != null && e.ritmoActualMensualCobrado >= e.ritmoNecesarioMensualCobrado;
                  return (
                    <tr key={esc} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                      <td style={{ padding: '8px', color: ESCENARIO_COLOR[esc], fontWeight: 600 }}>{ESCENARIO_LABEL[esc]}</td>
                      <td style={{ padding: '8px' }}>{fmt(e.objetivoAnual)}</td>
                      <td style={{ padding: '8px', color: vaBien ? '#22c55e' : '#f5b748' }}>{e.ritmoActualMensualCobrado != null ? fmt(e.ritmoActualMensualCobrado) : '—'}</td>
                      <td style={{ padding: '8px', fontWeight: 600 }}>{e.ritmoNecesarioMensualCobrado != null ? fmt(e.ritmoNecesarioMensualCobrado) : '¡Cumplido! 🎉'}</td>
                      <td style={{ padding: '8px', fontWeight: 600 }}>{e.ritmoNecesarioTrimestralCobrado != null ? fmt(e.ritmoNecesarioTrimestralCobrado) : '¡Cumplido! 🎉'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.3)', marginTop: 10 }}>
            "Ritmo actual" = lo cobrado hasta ahora (en beneficio) ÷ meses transcurridos. "Necesitas" = lo que falta ÷ meses o trimestres que quedan. Basado en beneficio COBRADO, no en lo vendido.
          </p>
        </>
      )}
    </div>
  );
}

function VentaModal({ venta, onClose, onSaved }) {
  const isEdit = !!venta;
  const [nombre, setNombre] = useState(venta?.nombre || '');
  const [clienteNombre, setClienteNombre] = useState(venta?.clienteNombre || '');
  const [instagram, setInstagram] = useState(venta?.cliente_instagram || '');
  const [email, setEmail] = useState(venta?.cliente_email || '');
  const [telefono, setTelefono] = useState(venta?.cliente_telefono || '');
  const [valor, setValor] = useState(venta?.valor ?? '');
  const [fecha, setFecha] = useState(venta?.fecha?.slice(0, 10) || new Date().toISOString().slice(0, 10));
  const [canal, setCanal] = useState(venta?.canal || 'recomendacion');
  const [campaña, setCampaña] = useState(venta?.campaña || '');
  const [tipoProyecto, setTipoProyecto] = useState(venta?.tipoProyecto || 'solo_diseno');
  const [previsionIngresos, setPrevisionIngresos] = useState(venta?.prevision_ingresos ?? '');
  const [previsionGastos, setPrevisionGastos] = useState(venta?.previsionGastos ?? venta?.prevision_gastos ?? '');
  const [comercialId, setComercialId] = useState(venta?.comercial_id || '');
  const [notas, setNotas] = useState(venta?.notas || '');
  const [empleados, setEmpleados] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api.get('/employees').then(r => setEmpleados(r.data.employees || [])).catch(() => {}); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!nombre.trim()) { setError('El nombre de la venta es obligatorio'); return; }
    if (!valor) { setError('Indica el valor de la venta'); return; }
    setError(''); setLoading(true);
    try {
      const payload = {
        nombre: nombre.trim(), cliente_nombre: clienteNombre.trim() || nombre.trim(),
        cliente_instagram: instagram || null, cliente_email: email || null, cliente_telefono: telefono || null,
        valor, fecha, canal, campaña: canal === 'ads' ? campaña : null, tipo_proyecto: tipoProyecto,
        prevision_ingresos: previsionIngresos || null, prevision_gastos: previsionGastos || null,
        comercial_id: comercialId || null, notas: notas || null,
      };
      if (isEdit) await api.put(`/ventas/${venta.id}`, payload);
      else await api.post('/ventas', payload);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al guardar la venta');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ap-modal-overlay" onClick={onClose}>
      <div className="ap-modal" onClick={e => e.stopPropagation()}>
        <div className="ap-modal-head"><h2>{isEdit ? 'Editar venta' : 'Nueva venta'}</h2><button className="ap-modal-close" onClick={onClose}><X size={16} /></button></div>
        <form onSubmit={handleSubmit} className="ap-modal-form">
          <div className="ap-field"><label>Nombre del proyecto / venta *</label><input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej. Home gym residencia Madrid" required autoFocus /></div>
          <div className="ap-field"><label>Cliente <span className="ap-optional">(opcional, si es distinto al nombre de arriba)</span></label><input value={clienteNombre} onChange={e => setClienteNombre(e.target.value)} placeholder="Nombre del cliente" /></div>
          <div className="fz-field-row">
            <div className="ap-field"><label>Instagram</label><input value={instagram} onChange={e => setInstagram(e.target.value)} placeholder="handle sin @" /></div>
            <div className="ap-field"><label>Email</label><input value={email} onChange={e => setEmail(e.target.value)} placeholder="correo@gmail.com" /></div>
          </div>
          <div className="fz-field-row">
            <div className="ap-field"><label>Valor de venta (€) *</label><input type="number" step="0.01" min="0" value={valor} onChange={e => setValor(e.target.value)} placeholder="0.00" required /></div>
            <div className="ap-field"><label>Fecha</label><input type="date" value={fecha} onChange={e => setFecha(e.target.value)} /></div>
          </div>
          <div className="fz-field-row">
            <div className="ap-field"><label>Canal</label>
              <select className="ap-select" value={canal} onChange={e => setCanal(e.target.value)}>
                {CANALES.map(c => <option key={c} value={c} style={{ textTransform: 'capitalize' }}>{c}</option>)}
              </select>
            </div>
            {canal === 'ads' && (
              <div className="ap-field"><label>Campaña</label><input value={campaña} onChange={e => setCampaña(e.target.value)} placeholder="Ej. Verano26_IG" /></div>
            )}
          </div>
          <div className="ap-field"><label>Tipo de proyecto</label>
            <select className="ap-select" value={tipoProyecto} onChange={e => setTipoProyecto(e.target.value)}>
              <option value="solo_diseno">Solo diseño (limpio)</option>
              <option value="con_ejecucion">Con ejecución (lleva gastos)</option>
            </select>
          </div>
          <div className="fz-field-row">
            <div className="ap-field"><label>Previsión de ingresos <span className="ap-optional">(si difiere del valor)</span></label><input type="number" step="0.01" min="0" value={previsionIngresos} onChange={e => setPrevisionIngresos(e.target.value)} placeholder={valor || '0.00'} /></div>
            <div className="ap-field"><label>Costes previstos <span className="ap-optional">(opcional)</span></label><input type="number" step="0.01" min="0" value={previsionGastos} onChange={e => setPrevisionGastos(e.target.value)} placeholder="0.00" /></div>
          </div>
          <div className="ap-field"><label>Comercial <span className="ap-optional">(opcional)</span></label>
            <select className="ap-select" value={comercialId} onChange={e => setComercialId(e.target.value)}>
              <option value="">— Sin asignar —</option>
              {empleados.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div className="ap-field"><label>Notas <span className="ap-optional">(opcional)</span></label><textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2} /></div>
          {error && <p className="ap-error">{error}</p>}
          <div className="ap-modal-actions">
            <button type="button" className="ap-btn ap-btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" className="ap-btn ap-btn-primary" disabled={loading}>{loading ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Registrar venta'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FichaConectada({ ventaId }) {
  const [ficha, setFicha] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [verCompleto, setVerCompleto] = useState(false);

  useEffect(() => {
    setCargando(true);
    api.get(`/ventas/${ventaId}/ficha`)
      .then(r => setFicha(r.data))
      .catch(() => setFicha(null))
      .finally(() => setCargando(false));
  }, [ventaId]);

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
      <div className="vt-ficha-dato" style={{ justifyContent: 'center' }}>
        <button className="ap-btn ap-btn-ghost ap-btn-xs" onClick={() => setVerCompleto(true)}>Ver ficha completa</button>
      </div>
      {verCompleto && <ProyectoCompletoModal ventaId={ventaId} onClose={() => setVerCompleto(false)} />}
    </div>
  );
}

function PanelClientes({ onEditar }) {
  const [clientes, setClientes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [abierto, setAbierto] = useState(null);
  const [verProyecto, setVerProyecto] = useState(null);

  const cargar = () => {
    setLoading(true);
    api.get('/ventas/clientes').then(r => setClientes(r.data.clientes || [])).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { cargar(); }, []);

  if (loading) return <div className="ap-loading">Cargando clientes…</div>;
  if (clientes.length === 0) return <div className="ap-empty"><p>Todavía no hay ventas registradas.</p></div>;

  return (
    <div className="vt-meses">
      {clientes.map(c => {
        const open = abierto === c.clienteId;
        return (
          <div key={c.clienteId} className="vt-mes-card">
            <button className="vt-mes-head" onClick={() => setAbierto(open ? null : c.clienteId)}>
              <div className="vt-mes-title">
                <span className="vt-mes-nombre" style={{ textTransform: 'none' }}>{c.nombre}</span>
                <span className="vt-mes-count">{c.numCompras} venta{c.numCompras !== 1 ? 's' : ''}{c.numCompras > 1 ? ' 🔁' : ''}</span>
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
                  <span>Venta</span><span>Canal</span><span>Proyecto</span><span>Fecha</span><span>Cobrado</span><span>Valor</span>
                </div>
                {c.compras.map((compra) => (
                  <div key={compra.ventaId} className="vt-row" onClick={() => setVerProyecto(compra.ventaId)} style={{ cursor: 'pointer' }}>
                    <span className="vt-lead-nombre">{compra.nombre}</span>
                    <span style={{ textTransform: 'capitalize' }}>{compra.canal || '—'}</span>
                    <span>{compra.tipoProyecto === 'con_ejecucion' ? 'Ejecución' : 'Limpio'}</span>
                    <span>{compra.fecha ? new Date(compra.fecha).toLocaleDateString('es-ES') : '—'}</span>
                    <span>{fmt(compra.cobrado)}</span>
                    <span className="vt-valor">{fmt(compra.valor)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {verProyecto && <ProyectoCompletoModal ventaId={verProyecto} onClose={() => setVerProyecto(null)} />}
    </div>
  );
}

export function SectionVentas() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [vista, setVista] = useState('tabla');
  const [modalVenta, setModalVenta] = useState(null);
  const [ventaAbierta, setVentaAbierta] = useState(null);
  const [openMes, setOpenMes] = useState(null);
  const [confirmId, setConfirmId] = useState(null);

  const cargar = useCallback(() => {
    setLoading(true);
    api.get('/ventas').then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const handleDelete = async () => {
    try { await api.delete(`/ventas/${confirmId}`); setConfirmId(null); cargar(); } catch {}
  };

  const { ventas = [], resumen = { total: 0, valorTotal: 0, valorLimpio: 0, valorEjecucion: 0, valorMedio: 0, beneficioPagadoTotal: 0 } } = data || {};

  return (
    <div className="ap-section">
      <div className="ap-section-head">
        <div><h1>Ventas</h1><p>Cada venta con su valor, previsión de coste/beneficio, cobros y pendiente.</p></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={`ap-btn ap-btn-sm ${vista === 'tabla' ? 'ap-btn-primary' : 'ap-btn-ghost'}`} onClick={() => setVista('tabla')}><Hash size={13} /> Todas</button>
          <button className={`ap-btn ap-btn-sm ${vista === 'mes' ? 'ap-btn-primary' : 'ap-btn-ghost'}`} onClick={() => setVista('mes')}><Hash size={13} /> Por mes</button>
          <button className={`ap-btn ap-btn-sm ${vista === 'cliente' ? 'ap-btn-primary' : 'ap-btn-ghost'}`} onClick={() => setVista('cliente')}><Users size={13} /> Por cliente</button>
          <button className="ap-btn ap-btn-primary ap-btn-sm" onClick={() => setModalVenta('new')}><Plus size={13} /> Nueva venta</button>
        </div>
      </div>

      <PanelObjetivos />

      <PanelRitmo />

      <div className="vt-stats">
        <div className="vt-stat-card">
          <div className="vt-stat-icon"><Hash size={18} /></div>
          <div className="vt-stat-body"><span>Ventas totales</span><strong>{resumen.total}</strong></div>
        </div>
        <div className="vt-stat-card">
          <div className="vt-stat-icon"><Euro size={18} /></div>
          <div className="vt-stat-body"><span>Valor total vendido</span><strong>{fmt(resumen.valorTotal)}</strong></div>
        </div>
        <div className="vt-stat-card">
          <div className="vt-stat-icon"><TrendingUp size={18} /></div>
          <div className="vt-stat-body"><span>Valor medio / venta</span><strong>{fmt(resumen.valorMedio)}</strong></div>
        </div>
        <div className="vt-stat-card">
          <div className="vt-stat-icon" style={{ color: '#22c55e' }}><Euro size={18} /></div>
          <div className="vt-stat-body"><span>Beneficio cobrado</span><strong style={{ color: '#22c55e' }}>{fmt(resumen.beneficioPagadoTotal)}</strong></div>
        </div>
        <div className="vt-stat-card">
          <div className="vt-stat-icon" style={{ color: '#f5b748' }}><Euro size={18} /></div>
          <div className="vt-stat-body"><span>Con ejecución</span><strong style={{ color: '#f5b748' }}>{fmt(resumen.valorEjecucion)}</strong></div>
        </div>
      </div>

      {loading ? (
        <div className="ap-loading">Cargando ventas…</div>
      ) : vista === 'cliente' ? (
        <PanelClientes />
      ) : vista === 'mes' ? (
        (data?.porMes || []).length === 0 ? (
          <div className="ap-empty"><p>Todavía no hay ventas registradas.</p></div>
        ) : (
          <div className="vt-meses">
            {data.porMes.map(m => {
              const open = openMes === m.mes;
              return (
                <div key={m.mes} className="vt-mes-card">
                  <button className="vt-mes-head" onClick={() => setOpenMes(open ? null : m.mes)}>
                    <div className="vt-mes-title">
                      <span className="vt-mes-nombre">{fmtMes(m.mes)}</span>
                      <span className="vt-mes-count">{m.count} venta{m.count !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="vt-mes-right">
                      <span style={{ fontSize: 12, color: '#22c55e' }}>Beneficio pagado {fmt(m.totalBeneficioPagado)}</span>
                      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Cobrado {fmt(m.totalCobrado)}</span>
                      <strong className="vt-mes-total">{fmt(m.total)}</strong>
                      {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                  </button>
                  {open && (
                    <div className="vt-mes-table">
                      <div className="vt-row vt-row--head" style={{ gridTemplateColumns: '1.5fr 1.2fr 0.9fr 0.9fr 0.9fr 0.9fr 0.9fr' }}>
                        <span>Cliente / lead</span><span>Proyecto</span><span>Valor venta</span><span>Beneficio previsto</span><span>Pagado</span><span>Beneficio pagado</span><span>Pendiente</span>
                      </div>
                      {m.ventas.map(v => (
                        <div key={v.id}>
                          <div className="vt-row" style={{ gridTemplateColumns: '1.5fr 1.2fr 0.9fr 0.9fr 0.9fr 0.9fr 0.9fr', cursor: 'pointer' }} onClick={() => setVentaAbierta(ventaAbierta === v.id ? null : v.id)}>
                            <span className="vt-lead-nombre">{v.clienteNombre || v.nombre}</span>
                            <span>{v.nombre}</span>
                            <span className="vt-valor">{fmt(v.valor)}</span>
                            <span style={{ color: v.costesConocidos === false ? '#f5b748' : '#a78bfa', fontWeight: 600 }} title={v.costesConocidos === false ? 'Falta poner el coste previsto para saber el beneficio real' : ''}>{v.costesConocidos === false ? '¿? sin coste' : fmt(v.beneficioPrevisto)}</span>
                            <span style={{ color: '#22c55e' }}>{fmt(v.cobrado)}</span>
                            <span style={{ color: '#22c55e', fontWeight: 600 }}>{fmt(v.beneficioPagado)}</span>
                            <span style={{ color: v.pendiente > 0 ? '#f5b748' : 'rgba(255,255,255,0.4)' }}>{fmt(v.pendiente)}</span>
                          </div>
                          {ventaAbierta === v.id && <FichaConectada ventaId={v.id} />}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : ventas.length === 0 ? (
        <div className="ap-empty"><p>Todavía no hay ventas registradas. Pulsa "Nueva venta" para añadir la primera.</p></div>
      ) : (
        <div className="vt-mes-table" style={{ marginTop: 8 }}>
          <div className="vt-row vt-row--head" style={{ gridTemplateColumns: '1.5fr 1.2fr 0.9fr 0.9fr 0.9fr 0.9fr 0.9fr 0.9fr 90px' }}>
            <span>Cliente / lead</span><span>Proyecto</span><span>Valor venta</span><span>Costes previstos</span><span>Beneficio previsto</span><span>Pagado</span><span>Beneficio pagado</span><span>Pendiente</span><span></span>
          </div>
          {ventas.map(v => (
            <div key={v.id}>
              <div className="vt-row" style={{ gridTemplateColumns: '1.5fr 1.2fr 0.9fr 0.9fr 0.9fr 0.9fr 0.9fr 0.9fr 90px', cursor: 'pointer' }} onClick={() => setVentaAbierta(ventaAbierta === v.id ? null : v.id)}>
                <span className="vt-lead-nombre">{v.clienteNombre || v.nombre}</span>
                <span>{v.nombre}</span>
                <span className="vt-valor">{fmt(v.valor)}</span>
                <span>{v.previsionGastos != null ? fmt(v.previsionGastos) : '—'}</span>
                <span style={{ color: v.costesConocidos === false ? '#f5b748' : '#a78bfa', fontWeight: 600 }} title={v.costesConocidos === false ? 'Falta poner el coste previsto para saber el beneficio real' : ''}>{v.costesConocidos === false ? '¿? sin coste' : fmt(v.beneficioPrevisto)}</span>
                <span style={{ color: '#22c55e' }}>{fmt(v.cobrado)}</span>
                <span style={{ color: '#22c55e', fontWeight: 600 }}>{fmt(v.beneficioPagado)}</span>
                <span style={{ color: v.pendiente > 0 ? '#f5b748' : 'rgba(255,255,255,0.4)' }}>{fmt(v.pendiente)}</span>
                <span style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                  <button className="ap-btn-icon" onClick={() => setModalVenta(v)}><Pencil size={13} /></button>
                  <button className="ap-btn-icon" onClick={() => setConfirmId(v.id)}><Trash2 size={13} /></button>
                </span>
              </div>
              {ventaAbierta === v.id && <FichaConectada ventaId={v.id} />}
            </div>
          ))}
        </div>
      )}

      {modalVenta && (
        <VentaModal
          venta={modalVenta === 'new' ? null : modalVenta}
          onClose={() => setModalVenta(null)}
          onSaved={() => { setModalVenta(null); cargar(); }}
        />
      )}

      {confirmId && (
        <div className="ap-modal-overlay" onClick={() => setConfirmId(null)}>
          <div className="ap-modal" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <div className="ap-modal-head"><h2>Eliminar venta</h2></div>
            <div className="ap-modal-form">
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>¿Seguro? Los pagos/gastos que tuviera enlazados se quedarán sin venta asociada.</p>
              <div className="ap-modal-actions">
                <button className="ap-btn ap-btn-ghost" onClick={() => setConfirmId(null)}>Cancelar</button>
                <button className="ap-btn ap-btn-danger" onClick={handleDelete}>Eliminar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
