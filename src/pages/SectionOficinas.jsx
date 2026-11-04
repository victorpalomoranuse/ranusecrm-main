import { useState, useEffect, useCallback } from 'react';
import { PencilRuler, Phone, Calculator, Wallet, Users, ArrowRight, CalendarDays, AlertCircle } from 'lucide-react';
import api from '../services/api';
import { PlanificarProyecto } from '../components/PlanificarProyecto';

// Oficinas virtuales: el negocio como un plano de oficinas. Cada departamento es una sala con su semáforo y sus cifras;
// la sala de diseño tiene una mesa por proyecto en marcha (semáforo, entrega, avance) y desde ahí se planifican los entregables.

const ICONO = { diseno: PencilRuler, ventas: Phone, presupuestos: Calculator, finanzas: Wallet, equipo: Users };
const LUZ = { rojo: '#e0705a', ambar: '#e0a24a', gris: '#8a8580', verde: '#6cc08d' };
const TEXTO_LUZ = { rojo: 'Atención', ambar: 'Ojo', gris: 'Sin planificar', verde: 'Al día' };
const pared = '3px solid rgba(186,175,165,0.28)';
const suelo = { backgroundImage: 'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)', backgroundSize: '24px 24px' };
const fmt = (iso, hoy) => {
  if (!iso) return 'Sin fecha';
  const d = Math.round((new Date(`${iso}T12:00:00`) - new Date(`${hoy}T12:00:00`)) / 86400000);
  const base = new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  return d === 0 ? 'Hoy' : d === 1 ? 'Mañana' : d < 0 ? `${base} (pasada)` : `${base} (${d} d)`;
};

function Puerta() { return <span aria-hidden style={{ position: 'absolute', bottom: -3, left: '50%', transform: 'translateX(-50%)', width: 34, height: 3, background: '#0a0a0a', borderRadius: 2 }} />; }
function Luz({ c, titulo }) { return <span title={titulo} style={{ width: 10, height: 10, borderRadius: '50%', background: LUZ[c], boxShadow: `0 0 8px ${LUZ[c]}88`, flexShrink: 0 }} />; }

function Sala({ d, ir }) {
  const Icono = ICONO[d.id] || Users;
  return (
    <div onClick={() => ir(d.ir)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') ir(d.ir); }}
      style={{ position: 'relative', cursor: 'pointer', border: pared, borderRadius: 10, padding: '0.9rem 1rem 1rem', background: 'rgba(20,18,16,0.55)', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 150 }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(186,175,165,0.6)'; }} onMouseLeave={e => { e.currentTarget.style.borderColor = ''; }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icono size={17} style={{ color: '#baafa5' }} />
        <b style={{ fontSize: '0.92rem', flex: 1 }}>{d.nombre}</b>
        <Luz c={d.alerta} titulo={TEXTO_LUZ[d.alerta]} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px' }}>
        {d.datos.map(([k, v]) => (
          <div key={k} style={{ minWidth: 70 }}>
            <div style={{ fontSize: '1.35rem', fontWeight: 700, lineHeight: 1.1 }}>{v}</div>
            <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)' }}>{k}</div>
          </div>
        ))}
      </div>
      <span style={{ marginTop: 'auto', fontSize: '0.74rem', color: '#baafa5', display: 'flex', alignItems: 'center', gap: 4 }}>Entrar <ArrowRight size={12} /></span>
      <Puerta />
    </div>
  );
}

function Mesa({ p, hoy, ir, onPlanificar, onEntrega }) {
  const t = p.tareas, pct = t.total ? Math.round((t.hechas / t.total) * 100) : 0;
  return (
    <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', borderLeft: `4px solid ${LUZ[p.semaforo]}`, borderRadius: 10, padding: '0.7rem 0.8rem', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.86rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.nombre}>{p.nombre}</div>
          <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.45)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.cliente} · Fase {p.fase}</div>
        </div>
        <Luz c={p.semaforo} titulo={TEXTO_LUZ[p.semaforo]} />
      </div>
      <div style={{ fontSize: '0.74rem', color: LUZ[p.semaforo] }}>{p.motivo}</div>
      {t.total > 0 && (
        <div>
          <div style={{ height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: LUZ.verde }} /></div>
          <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.45)', marginTop: 3 }}>{t.hechas}/{t.total} tareas{t.hoy ? ` · ${t.hoy} para hoy` : ''}{t.proxima ? ` · próxima ${fmt(t.proxima, hoy)}` : ''}</div>
        </div>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)' }}>
        Entrega
        <input type="date" value={p.entrega || ''} onChange={e => onEntrega(p, e.target.value)} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, color: '#fff', padding: '2px 6px', fontSize: '0.74rem', minWidth: 0, flex: 1 }} />
      </label>
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="ap-btn ap-btn-primary ap-btn-sm" style={{ flex: 1 }} onClick={() => onPlanificar(p)}><CalendarDays size={12} /> {p.planificado ? 'Re-planificar' : 'Planificar'}</button>
        <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => ir('proyectos')}>Abrir</button>
      </div>
    </div>
  );
}

export function SectionOficinas({ ir }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filtro, setFiltro] = useState('todos');
  const [plan, setPlan] = useState(null);
  const [aviso, setAviso] = useState('');

  const cargar = useCallback(() => {
    api.get('/oficinas').then(r => { setData(r.data); setError(''); }).catch(e => setError(e.response?.data?.error || 'No se pudieron cargar las oficinas'));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const cambiarEntrega = async (p, entrega) => {
    try { await api.put(`/oficinas/proyectos/${p.id}/entrega`, { entrega: entrega || null }); cargar(); } catch { setAviso('No se pudo guardar la fecha'); }
  };

  if (error) return <div className="ap-section"><div className="ap-empty"><p>{error}</p></div></div>;
  if (!data) return <div className="ap-loading">Cargando…</div>;

  const diseno = data.departamentos.find(d => d.id === 'diseno');
  const otras = data.departamentos.filter(d => d.id !== 'diseno');
  const cuenta = (...xs) => data.proyectos.filter(p => xs.includes(p.semaforo)).length;
  const visibles = data.proyectos.filter(p => filtro === 'todos' || (filtro === 'atencion' && (p.semaforo === 'rojo' || p.semaforo === 'ambar')) || (filtro === 'sinplan' && p.semaforo === 'gris'));
  const chip = (id, txt, n) => (
    <button key={id} onClick={() => setFiltro(id)} className="ap-btn ap-btn-sm" style={{ background: filtro === id ? '#fff' : 'rgba(255,255,255,0.07)', color: filtro === id ? '#000' : '#fff', border: '1px solid rgba(255,255,255,0.12)' }}>{txt} ({n})</button>
  );

  return (
    <div className="ap-section">
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0 }}>Oficinas</h1>
        <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: 'rgba(255,255,255,0.5)' }}>{data.proyectos.length} proyectos en marcha · {cuenta('rojo')} con atención · {cuenta('gris')} sin planificar</p>
      </div>

      {data.tareasSinFecha > 0 && (
        <div onClick={() => ir('tareas')} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(224,162,74,0.12)', border: '1px solid rgba(224,162,74,0.35)', borderRadius: 10, padding: '8px 12px', marginBottom: 14, fontSize: '0.82rem' }}>
          <AlertCircle size={16} style={{ color: LUZ.ambar }} /> Tienes <b>{data.tareasSinFecha}</b> tareas pendientes sin fecha. Sin fecha no se pueden repartir en el tiempo: planifica el proyecto o ponles día. <ArrowRight size={13} style={{ marginLeft: 'auto' }} />
        </div>
      )}
      {aviso && <div style={{ fontSize: '0.8rem', color: '#ae8b8b', marginBottom: 8 }}>{aviso}</div>}

      <div style={{ ...suelo, border: '1px dashed rgba(255,255,255,0.12)', borderRadius: 16, padding: 14, display: 'grid', gap: 14 }}>
        <div style={{ position: 'relative', border: pared, borderRadius: 10, padding: '0.9rem 0.9rem 1.1rem', background: 'rgba(20,18,16,0.55)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <PencilRuler size={18} style={{ color: '#baafa5' }} />
            <b style={{ fontSize: '1rem' }}>{diseno?.nombre || 'Diseño y proyectos'}</b>
            <Luz c={diseno?.alerta || 'verde'} titulo={TEXTO_LUZ[diseno?.alerta || 'verde']} />
            <span style={{ flex: 1 }} />
            {chip('todos', 'Todos', data.proyectos.length)}{chip('atencion', 'Atención', cuenta('rojo', 'ambar'))}{chip('sinplan', 'Sin planificar', cuenta('gris'))}
          </div>
          {visibles.length === 0
            ? <p style={{ fontSize: '0.84rem', color: 'rgba(255,255,255,0.5)', margin: 0 }}>No hay proyectos en esta vista.</p>
            : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10 }}>
              {visibles.map(p => <Mesa key={p.id} p={p} hoy={data.hoy} ir={ir} onPlanificar={setPlan} onEntrega={cambiarEntrega} />)}
            </div>}
          <Puerta />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
          {otras.map(d => <Sala key={d.id} d={d} ir={ir} />)}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 12, fontSize: '0.72rem', color: 'rgba(255,255,255,0.5)' }}>
        {Object.keys(LUZ).map(k => <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Luz c={k} /> {TEXTO_LUZ[k]}</span>)}
      </div>

      {plan && <PlanificarProyecto proyecto={plan} onClose={() => setPlan(null)} onHecho={() => { setAviso(''); cargar(); }} />}
    </div>
  );
}
