import { useState, useEffect } from 'react';
import api from '../services/api';
import { X } from 'lucide-react';
import { useAdminAuth } from '../auth/AdminAuthContext';

function fmt(n) {
  return Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}

const FASE_LABELS = { 1: 'Diagnóstico', 2: 'Diseño', 3: 'Producción', 4: 'Instalación', 5: 'Entregado' };

function EjecucionVenta({ ventaId, ejecucion, onLinked }) {
  const [proyectos, setProyectos] = useState([]);
  const [seleccion, setSeleccion] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/client-projects').then(r => setProyectos(r.data.projects || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleLink = async () => {
    if (!seleccion) return;
    setGuardando(true);
    try {
      await api.put(`/client-projects/${seleccion}`, { venta_id: ventaId });
      onLinked();
    } catch {} finally { setGuardando(false); }
  };

  const handleUnlink = async () => {
    setGuardando(true);
    try {
      await api.put(`/client-projects/${ejecucion.id}`, { venta_id: null });
      onLinked();
    } catch {} finally { setGuardando(false); }
  };

  if (ejecucion) {
    return (
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '10px 14px', fontSize: 13 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <strong>{ejecucion.nombre}</strong> — {FASE_LABELS[ejecucion.fase] || ejecucion.fase}
          <button className="ap-btn ap-btn-ghost ap-btn-xs" onClick={handleUnlink} disabled={guardando}>Desenlazar</button>
        </div>
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 4 }}>
          Urgencia: {ejecucion.urgencia} · Responsable: {ejecucion.responsable || '—'} · Código: {ejecucion.codigoAcceso}
        </div>
      </div>
    );
  }

  if (loading) return null;

  const disponibles = proyectos.filter(p => !p.venta_id);

  return (
    <div>
      <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>Todavía no hay un proyecto de ejecución enlazado a esta venta.</p>
      {disponibles.length === 0 ? (
        <p className="ap-empty-sm">No hay proyectos sin enlazar. Créalo primero en Proyectos.</p>
      ) : (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <select className="ap-select" value={seleccion} onChange={e => setSeleccion(e.target.value)} style={{ minWidth: 220, flex: 1 }}>
            <option value="">Elige un proyecto…</option>
            {disponibles.map(p => <option key={p.id} value={p.id}>{p.client_name} — {p.project_name}</option>)}
          </select>
          <button className="ap-btn ap-btn-primary ap-btn-sm" onClick={handleLink} disabled={!seleccion || guardando}>Enlazar</button>
        </div>
      )}
    </div>
  );
}

function ComisionesVentaAdmin({ ventaId }) {
  const [comisiones, setComisiones] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [loading, setLoading] = useState(true);
  const [employeeId, setEmployeeId] = useState('');
  const [tipo, setTipo] = useState('porcentaje');
  const [valor, setValor] = useState('');
  const [notas, setNotas] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = () => {
    Promise.all([
      api.get(`/comisiones/venta/${ventaId}`),
      api.get('/employees'),
    ]).then(([c, e]) => {
      setComisiones(c.data.comisiones || []);
      setEmpleados(e.data.employees || []);
    }).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { cargar(); }, [ventaId]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!employeeId || !valor) return;
    setGuardando(true);
    try {
      await api.post(`/comisiones/venta/${ventaId}`, { employee_id: employeeId, tipo, valor, notas });
      setEmployeeId(''); setValor(''); setNotas('');
      cargar();
    } catch {} finally { setGuardando(false); }
  };

  const handleDelete = async (id) => {
    try { await api.delete(`/comisiones/venta/${ventaId}/${id}`); cargar(); } catch {}
  };

  if (loading) return null;

  return (
    <div>
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Comisiones de este proyecto</div>
      {comisiones.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
          {comisiones.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '6px 10px' }}>
              <span style={{ flex: 1, fontWeight: 600 }}>{c.nombre}</span>
              <span style={{ color: 'rgba(255,255,255,0.5)' }}>{c.tipo === 'fijo' ? fmt(c.valor) : `${c.valor}%`}</span>
              {c.calculo && (
                <>
                  <span style={{ color: 'rgba(255,255,255,0.4)' }}>{c.calculo.proporcionCobradaPct}% cobrado</span>
                  <span style={{ color: '#22c55e' }}>Devengado {fmt(c.calculo.devengada)}</span>
                  <span style={{ color: '#f5b748' }}>Pendiente {fmt(c.calculo.pendiente)}</span>
                </>
              )}
              <button className="ap-btn-icon" onClick={() => handleDelete(c.id)}><X size={12} /></button>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={handleAdd} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <select className="ap-select" value={employeeId} onChange={e => setEmployeeId(e.target.value)} style={{ minWidth: 140, flex: 1 }}>
          <option value="">Empleado…</option>
          {empleados.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select className="ap-select" value={tipo} onChange={e => setTipo(e.target.value)} style={{ maxWidth: 110 }}>
          <option value="porcentaje">%</option>
          <option value="fijo">Importe fijo</option>
        </select>
        <input className="ap-select" type="number" step="0.01" min="0" value={valor} onChange={e => setValor(e.target.value)} placeholder={tipo === 'porcentaje' ? '%' : '€'} style={{ maxWidth: 90 }} />
        <input className="ap-select" value={notas} onChange={e => setNotas(e.target.value)} placeholder="Notas (opc.)" style={{ minWidth: 100, flex: 1 }} />
        <button type="submit" className="ap-btn ap-btn-primary ap-btn-xs" disabled={guardando}>+ Añadir</button>
      </form>
    </div>
  );
}

// Autoservicio: quien no es admin_superior ni tiene permiso de Finanzas solo
// ve su propia fila de comisión en esta venta (si tiene alguna), en solo
// lectura — nunca las de sus compañeros.
function ComisionesVentaMia({ ventaId }) {
  const [comisiones, setComisiones] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/comisiones/venta/${ventaId}/mia`).then(r => setComisiones(r.data.comisiones || [])).catch(() => {}).finally(() => setLoading(false));
  }, [ventaId]);

  if (loading || comisiones.length === 0) return null;

  return (
    <div>
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Tu comisión en este proyecto</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {comisiones.map(c => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '6px 10px' }}>
            <span style={{ color: 'rgba(255,255,255,0.5)' }}>{c.tipo === 'fijo' ? fmt(c.valor) : `${c.valor}%`}</span>
            <span style={{ color: 'rgba(255,255,255,0.4)' }}>{c.proporcionCobradaPct}% cobrado</span>
            <span style={{ color: '#22c55e' }}>Devengado {fmt(c.devengada)}</span>
            <span style={{ color: '#f5b748' }}>Pendiente {fmt(c.pendiente)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ComisionesVenta({ ventaId }) {
  const { user } = useAdminAuth();
  const puedeGestionar = user?.role === 'admin_superior' || user?.permissions?.finanzas === true;
  return puedeGestionar ? <ComisionesVentaAdmin ventaId={ventaId} /> : <ComisionesVentaMia ventaId={ventaId} />;
}

/**
 * Ficha única de una venta, con TODO lo que ya está registrado en el
 * sistema (datos de la venta, pagos, gastos, margen, fase de ejecución) —
 * no pide meter nada nuevo, solo junta lo que ya existe.
 * Requiere permiso 'finanzas' (muestra gastos y margen real).
 */
export function ProyectoCompletoModal({ ventaId, onClose }) {
  const [datos, setDatos] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editandoCostes, setEditandoCostes] = useState(false);
  const [costesInput, setCostesInput] = useState('');
  const [guardandoCostes, setGuardandoCostes] = useState(false);

  const cargar = () => {
    api.get(`/ventas/${ventaId}/completo`)
      .then(r => { setDatos(r.data); setCostesInput(r.data.venta.previsionGastos ?? ''); })
      .catch(err => setError(err.response?.data?.error || 'No se pudo cargar la venta'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { cargar(); }, [ventaId]);

  const guardarCostes = async () => {
    setGuardandoCostes(true);
    try {
      await api.put(`/ventas/${ventaId}`, { prevision_gastos: costesInput === '' ? null : costesInput });
      setEditandoCostes(false);
      cargar();
    } catch {
      // noop
    } finally {
      setGuardandoCostes(false);
    }
  };

  return (
    <div className="ap-modal-overlay" onClick={onClose}>
      <div className="ap-modal" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
        <div className="ap-modal-head">
          <h2>{datos?.venta?.nombre || 'Venta completa'}</h2>
          <button className="ap-modal-close" onClick={onClose}><X size={16} /></button>
        </div>

        {loading ? (
          <div className="ap-loading">Cargando…</div>
        ) : error ? (
          <div className="ap-empty"><p>{error}</p></div>
        ) : (
          <div style={{ padding: '0 1.25rem 1.25rem', display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Datos de la venta */}
            <div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Venta</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', fontSize: 13 }}>
                <div><span style={{ color: 'rgba(255,255,255,0.4)' }}>Cliente: </span>{datos.venta.clienteNombre || '—'}</div>
                <div><span style={{ color: 'rgba(255,255,255,0.4)' }}>Canal: </span>{datos.venta.canal || '—'}{datos.venta.campaña ? ` (${datos.venta.campaña})` : ''}</div>
                <div><span style={{ color: 'rgba(255,255,255,0.4)' }}>Comercial: </span>{datos.venta.comercial || '—'}</div>
                <div><span style={{ color: 'rgba(255,255,255,0.4)' }}>Tipo: </span>{datos.venta.tipoProyecto === 'con_ejecucion' ? 'Con ejecución' : 'Solo diseño (limpio)'}</div>
                <div><span style={{ color: 'rgba(255,255,255,0.4)' }}>Fecha venta: </span>{datos.venta.fecha?.slice(0, 10) || '—'}</div>
              </div>
              {datos.venta.notas && <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 8 }}>{datos.venta.notas}</p>}
            </div>

            {/* Resumen financiero */}
            <div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Finanzas</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '10px 14px' }}>
                <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Presupuesto</div><strong>{fmt(datos.venta.presupuesto)}</strong></div>
                <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Cobrado</div><strong style={{ color: '#22c55e' }}>{fmt(datos.resumen.cobrado)}</strong></div>
                <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Pendiente</div><strong style={{ color: datos.resumen.pendiente > 0 ? '#f5b748' : 'rgba(255,255,255,0.4)' }}>{fmt(datos.resumen.pendiente)}</strong></div>
                <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Gastos reales</div><strong style={{ color: '#ae6b6b' }}>{fmt(datos.resumen.totalGastos)}</strong></div>
                <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Margen real (hasta ahora)</div><strong style={{ color: datos.resumen.margenReal >= 0 ? '#8bae8f' : '#ae6b6b' }}>{fmt(datos.resumen.margenReal)}</strong></div>
              </div>

              {datos.venta.tipoProyecto === 'con_ejecucion' && (
                <div style={{ marginTop: 10, background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.25)', borderRadius: 10, padding: '10px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ fontSize: 10, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: 1 }}>Margen estimado al terminar</div>
                    {!editandoCostes && <button className="ap-btn ap-btn-ghost ap-btn-xs" onClick={() => setEditandoCostes(true)}>{datos.venta.previsionGastos != null ? 'Editar coste previsto' : '+ Estimar coste'}</button>}
                  </div>
                  {editandoCostes ? (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Coste total previsto del proyecto:</span>
                      <input type="number" step="0.01" min="0" value={costesInput} onChange={e => setCostesInput(e.target.value)} placeholder="0.00" className="ap-select" style={{ width: 120 }} autoFocus />
                      <button className="ap-btn ap-btn-primary ap-btn-xs" disabled={guardandoCostes} onClick={guardarCostes}>{guardandoCostes ? '...' : 'Guardar'}</button>
                      <button className="ap-btn ap-btn-ghost ap-btn-xs" onClick={() => { setEditandoCostes(false); setCostesInput(datos.venta.previsionGastos ?? ''); }}>Cancelar</button>
                    </div>
                  ) : datos.venta.previsionGastos != null ? (
                    <div style={{ display: 'flex', gap: 20, marginTop: 6 }}>
                      <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Coste previsto</div><strong>{fmt(datos.venta.previsionGastos)}</strong></div>
                      <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Margen estimado</div><strong style={{ color: datos.resumen.margenEstimado >= 0 ? '#a78bfa' : '#ae6b6b' }}>{fmt(datos.resumen.margenEstimado)}</strong></div>
                    </div>
                  ) : (
                    <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 6, marginBottom: 0 }}>
                      Sin coste previsto todavía — hasta que lo pongas, el margen real de arriba es la única cifra fiable (y probablemente esté inflado, porque aún faltan gastos por registrar).
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Pagos */}
            {datos.pagos.length > 0 && (
              <div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Pagos recibidos ({datos.pagos.length})</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {datos.pagos.map(p => (
                    <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <span>{p.concepto}{p.metodo_pago ? ` · ${p.metodo_pago}` : ''}</span>
                      <span style={{ color: 'rgba(255,255,255,0.4)' }}>{p.fecha?.slice(0, 10)}</span>
                      <span style={{ color: '#22c55e' }}>{fmt(p.monto)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Gastos */}
            {datos.gastos.length > 0 && (
              <div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Gastos reales ({datos.gastos.length})</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {datos.gastos.map(g => (
                    <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <span>{g.concepto}{g.categoria ? ` · ${g.categoria}` : ''}</span>
                      <span style={{ color: 'rgba(255,255,255,0.4)' }}>{g.fecha?.slice(0, 10)}</span>
                      <span style={{ color: '#ae6b6b' }}>-{fmt(g.monto)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Proyecto de ejecución */}
            <div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Ejecución</div>
              <EjecucionVenta ventaId={ventaId} ejecucion={datos.ejecucion} onLinked={cargar} />
            </div>

            {/* Comisiones */}
            <ComisionesVenta ventaId={ventaId} />
          </div>
        )}
      </div>
    </div>
  );
}
