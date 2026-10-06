import { useState, useEffect } from 'react';
import { CalendarDays, Phone, Instagram, Target, TrendingUp, Wallet, AlertCircle } from 'lucide-react';
import api from '../services/api';
import { useAdminAuth } from '../auth/AdminAuthContext';

// "Mi día": mini dashboard personal de cada empleado. Solo ve SUS llamadas,
// SUS leads y SUS comisiones (las del mes publicado por el administrador).

const card = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '1rem 1.1rem' };
const muted = { fontSize: '0.72rem', color: 'rgba(255,255,255,0.45)' };
const fmtEur = (n) => (Number(n) || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const hhmm = (t) => (t || '').slice(0, 5);
const fmtFecha = (f) => new Date(`${f}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: 'short' });
const fmtMes = (clave) => {
  if (!clave || !/^\d{4}-\d{2}/.test(clave)) return clave || '';
  const d = new Date(`${clave.slice(0, 7)}-15T12:00:00`);
  return d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
};

function Llamada({ s, onClick }) {
  return (
    <div onClick={onClick} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ minWidth: 0 }}>
        <strong style={{ fontSize: '0.88rem' }}>{hhmm(s.hora_inicio)}</strong>{' '}
        <span style={{ fontSize: '0.88rem' }}>{s.lead?.nombre || 'Sin lead'}</span>
        <div style={{ ...muted, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {s.lead?.telefono && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Phone size={11} />{s.lead.telefono}</span>}
          {s.lead?.instagram && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Instagram size={11} />@{s.lead.instagram}</span>}
        </div>
      </div>
      <span style={{ ...muted, whiteSpace: 'nowrap' }}>{fmtFecha(s.fecha)}</span>
    </div>
  );
}

export function SectionMiDashboard({ ir }) {
  const { user } = useAdminAuth();
  const [datos, setDatos] = useState(null);
  const [comision, setComision] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/mi-dashboard').then(r => setDatos(r.data)).catch(() => setError('No se pudo cargar tu resumen'));
    api.get('/comisiones/mia/periodos').then(r => {
      const p = (r.data?.periodos || []);
      if (r.data?.encontrado && p.length) setComision(p.reduce((a, b) => (b.periodo > a.periodo ? b : a)));
    }).catch(() => {});
  }, []);

  if (error) return <div className="ap-section"><p className="ap-error">{error}</p></div>;
  if (!datos) return <div className="ap-section"><div className="ap-loading">Cargando…</div></div>;
  if (!datos.empleado) return <div className="ap-section"><div className="ap-section-head"><h1>Mi día</h1></div><p style={muted}>Tu usuario no está vinculado a ningún empleado.</p></div>;

  const hoy = datos.hoy;
  const deHoy = datos.proximas.filter(s => s.fecha === hoy);
  const siguientes = datos.proximas.filter(s => s.fecha > hoy);
  const saludo = (user?.name || datos.empleado.name || '').split(' ')[0];
  const l = datos.leads;

  return (
    <div className="ap-section">
      <div className="ap-section-head">
        <div><h1><CalendarDays size={20} style={{ verticalAlign: -3, marginRight: 8 }} />Hola, {saludo}</h1><p>Tu resumen de hoy: tus llamadas, tus leads y tus comisiones.</p></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
        <div style={card}>
          <strong style={{ fontSize: '0.9rem' }}>Llamadas de hoy</strong>
          {deHoy.length === 0 ? <p style={{ ...muted, marginTop: 8 }}>No tienes llamadas hoy.</p> : deHoy.map(s => <Llamada key={s.id} s={s} onClick={() => ir?.('mi-agenda')} />)}
          {siguientes.length > 0 && (
            <>
              <p style={{ ...muted, margin: '14px 0 2px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Próximas</p>
              {siguientes.slice(0, 5).map(s => <Llamada key={s.id} s={s} onClick={() => ir?.('mi-agenda')} />)}
            </>
          )}
          <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" style={{ marginTop: 12 }} onClick={() => ir?.('mi-agenda')}>Abrir mi agenda</button>
        </div>

        {datos.sinCerrar.length > 0 && (
          <div style={{ ...card, borderColor: 'rgba(245,183,72,0.35)' }}>
            <strong style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 6 }}><AlertCircle size={15} color="#f5b748" /> Llamadas por cerrar</strong>
            <p style={{ ...muted, margin: '4px 0 6px' }}>Ya han pasado y no tienen resumen. Añade el resumen y actualiza el estado del lead.</p>
            {datos.sinCerrar.map(s => <Llamada key={s.id} s={s} onClick={() => ir?.('mi-agenda')} />)}
          </div>
        )}

        {l && (
          <div style={card}>
            <strong style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 6 }}><Target size={15} /> Mis leads</strong>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 10 }}>
              {[['Activos', l.activos], ['Nuevos', l.nuevos], ['Agendados', l.agendados], ['En seguimiento', l.seguimiento], ['Ventas este mes', l.ventasMes], ['Asignados', l.asignados]].map(([etq, v]) => (
                <div key={etq}><div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{v}</div><div style={muted}>{etq}</div></div>
              ))}
            </div>
            <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" style={{ marginTop: 12 }} onClick={() => ir?.('setting')}><TrendingUp size={13} /> Ir a Setting</button>
          </div>
        )}

        {comision && (
          <div style={card}>
            <strong style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 6 }}><Wallet size={15} /> Mis comisiones</strong>
            <p style={{ ...muted, margin: '4px 0 10px' }}>Último mes publicado: {fmtMes(comision.periodo)}</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              <div><div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{fmtEur(comision.devengado)}</div><div style={muted}>Generado</div></div>
              <div><div style={{ fontSize: '1.4rem', fontWeight: 700, color: comision.pendiente > 0.01 ? '#f5b748' : 'inherit' }}>{fmtEur(comision.pendiente)}</div><div style={muted}>Pendiente de cobro</div></div>
            </div>
            <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" style={{ marginTop: 12 }} onClick={() => ir?.('mis-comisiones')}>Ver el detalle</button>
          </div>
        )}
      </div>
    </div>
  );
}
