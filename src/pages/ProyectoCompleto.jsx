import { useState, useEffect } from 'react';
import api from '../services/api';
import { X } from 'lucide-react';

function fmt(n) {
  return Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}

const FASE_LABELS = { 1: 'Diagnóstico', 2: 'Diseño', 3: 'Producción', 4: 'Instalación', 5: 'Entregado' };

/**
 * Ficha única de un proyecto, con TODO lo que ya está registrado en el
 * sistema (venta, pagos, gastos, margen, fase de ejecución) — no pide
 * meter nada nuevo, solo junta lo que ya existe en Leads/Finanzas/Proyectos.
 * Requiere permiso 'finanzas' (muestra gastos y margen real).
 */
export function ProyectoCompletoModal({ leadId, onClose }) {
  const [datos, setDatos] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/finanzas/proyecto/${leadId}`)
      .then(r => setDatos(r.data))
      .catch(err => setError(err.response?.data?.error || 'No se pudo cargar el proyecto'))
      .finally(() => setLoading(false));
  }, [leadId]);

  return (
    <div className="ap-modal-overlay" onClick={onClose}>
      <div className="ap-modal" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
        <div className="ap-modal-head">
          <h2>{datos?.proyecto?.nombre || 'Proyecto completo'}</h2>
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
                <div><span style={{ color: 'rgba(255,255,255,0.4)' }}>Canal: </span>{datos.proyecto.canal || '—'}{datos.proyecto.campaña ? ` (${datos.proyecto.campaña})` : ''}</div>
                <div><span style={{ color: 'rgba(255,255,255,0.4)' }}>Comercial: </span>{datos.proyecto.comercial || '—'}</div>
                <div><span style={{ color: 'rgba(255,255,255,0.4)' }}>Tipo: </span>{datos.proyecto.tipoProyecto === 'con_ejecucion' ? 'Con ejecución' : 'Solo diseño (limpio)'}</div>
                <div><span style={{ color: 'rgba(255,255,255,0.4)' }}>Fecha venta: </span>{datos.proyecto.fechaVenta?.slice(0, 10) || '—'}</div>
              </div>
              {datos.proyecto.notas && <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 8 }}>{datos.proyecto.notas}</p>}
            </div>

            {/* Resumen financiero */}
            <div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Finanzas</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '10px 14px' }}>
                <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Presupuesto</div><strong>{fmt(datos.proyecto.presupuesto)}</strong></div>
                <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Cobrado</div><strong style={{ color: '#22c55e' }}>{fmt(datos.resumen.cobrado)}</strong></div>
                <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Pendiente</div><strong style={{ color: datos.resumen.pendiente > 0 ? '#f5b748' : 'rgba(255,255,255,0.4)' }}>{fmt(datos.resumen.pendiente)}</strong></div>
                <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Gastos</div><strong style={{ color: '#ae6b6b' }}>{fmt(datos.resumen.totalGastos)}</strong></div>
                <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Margen real</div><strong style={{ color: datos.resumen.margenReal >= 0 ? '#8bae8f' : '#ae6b6b' }}>{fmt(datos.resumen.margenReal)}</strong></div>
              </div>
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
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Gastos del proyecto ({datos.gastos.length})</div>
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
              {datos.ejecucion ? (
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '10px 14px', fontSize: 13 }}>
                  <div><strong>{datos.ejecucion.nombre}</strong> — {FASE_LABELS[datos.ejecucion.fase] || datos.ejecucion.fase}</div>
                  <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 4 }}>
                    Urgencia: {datos.ejecucion.urgencia} · Responsable: {datos.ejecucion.responsable || '—'} · Código: {datos.ejecucion.codigoAcceso}
                  </div>
                </div>
              ) : (
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Todavía no hay un proyecto de ejecución enlazado a esta venta.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
