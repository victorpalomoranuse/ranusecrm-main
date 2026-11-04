import { useState, useEffect } from 'react';
import { X, CalendarDays, Plus, Trash2, AlertTriangle, Settings2 } from 'lucide-react';
import api from '../services/api';

// Planificador de un proyecto: eliges qué entregables lleva, pones la fecha de entrega al cliente y el CRM reparte las fechas
// a un ritmo parejo (con unos días de margen antes de la entrega) y crea las tareas. Se puede editar cada fecha antes de crearlas.

const card = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '0.9rem 1rem' };
const muted = { fontSize: '0.74rem', color: 'rgba(255,255,255,0.5)' };
const fmt = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }) : '—');

export function PlanificarProyecto({ proyecto, onClose, onHecho }) {
  const [cargando, setCargando] = useState(true);
  const [catalogo, setCatalogo] = useState([]);
  const [plan, setPlan] = useState(null);
  const [hoy, setHoy] = useState('');
  const [sel, setSel] = useState({}); // id -> horas (si está en el objeto, está marcado)
  const [entrega, setEntrega] = useState(proyecto.entrega || '');
  const [margen, setMargen] = useState(2);
  const [horasDia, setHorasDia] = useState(5);
  const [prop, setProp] = useState(null);
  const [items, setItems] = useState([]);
  const [reemplazar, setReemplazar] = useState(true);
  const [trabajando, setTrabajando] = useState(false);
  const [msg, setMsg] = useState('');
  const [editCat, setEditCat] = useState(false);

  useEffect(() => {
    api.get(`/oficinas/proyectos/${proyecto.id}/plan`).then(r => {
      setCatalogo(r.data.catalogo || []); setPlan(r.data.plan); setHoy(r.data.hoy);
      const p = r.data.plan;
      if (p?.items?.length) {
        const s = {}; p.items.forEach(i => { s[i.id || i.nombre] = i.horas; }); setSel(s);
        if (p.entrega) setEntrega(p.entrega); if (p.margenDias != null) setMargen(p.margenDias); if (p.horasDia) setHorasDia(p.horasDia);
      }
    }).catch(() => setMsg('No se pudo cargar el plan')).finally(() => setCargando(false));
  }, [proyecto.id]);

  const marcados = catalogo.filter(c => sel[c.id] !== undefined);
  const total = marcados.reduce((s, c) => s + (Number(sel[c.id]) || 0), 0);

  const calcular = async () => {
    setMsg(''); setTrabajando(true);
    try {
      const r = await api.post(`/oficinas/proyectos/${proyecto.id}/propuesta`, { entregables: marcados.map(c => ({ id: c.id, nombre: c.nombre, horas: Number(sel[c.id]) || c.horas })), entrega, margenDias: margen, horasDia });
      setProp(r.data); setItems(r.data.items);
    } catch (e) { setMsg(e.response?.data?.error || 'No se pudo calcular'); }
    setTrabajando(false);
  };
  const aplicar = async () => {
    setMsg(''); setTrabajando(true);
    try {
      const r = await api.post(`/oficinas/proyectos/${proyecto.id}/aplicar`, { entrega, margenDias: margen, horasDia, cabe: prop?.cabe, faltanHoras: prop?.faltanHoras, items: items.map(i => ({ id: i.id, nombre: i.nombre, horas: i.horas, fecha: i.fecha })), reemplazar: reemplazar && !!plan?.tareas?.length });
      onHecho?.(r.data.creadas); onClose();
    } catch (e) { setMsg(e.response?.data?.error || 'No se pudieron crear las tareas'); setTrabajando(false); }
  };
  const guardarCatalogo = async () => {
    try { const r = await api.put('/oficinas/catalogo', { catalogo }); setCatalogo(r.data.catalogo); setEditCat(false); setMsg('Catálogo guardado'); }
    catch (e) { setMsg(e.response?.data?.error || 'No se pudo guardar el catálogo'); }
  };

  const input = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: '#fff', padding: '6px 8px', fontSize: '0.85rem', minWidth: 0 };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 2000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 12px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#1a1816', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, width: 'min(720px, 100%)', padding: '1.1rem 1.2rem 1.3rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
          <CalendarDays size={20} style={{ color: '#baafa5', marginTop: 3 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Planificar entregables</h2>
            <div style={muted}>{proyecto.nombre}{proyecto.cliente ? ` · ${proyecto.cliente}` : ''}</div>
          </div>
          <button className="ap-btn-icon" onClick={onClose} aria-label="Cerrar"><X size={16} /></button>
        </div>

        {cargando ? <div className="ap-loading">Cargando…</div> : (
          <>
            <div style={{ ...card, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <b style={{ fontSize: '0.86rem' }}>1 · ¿Qué hay que entregar en este proyecto?</b>
                <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => setEditCat(v => !v)}><Settings2 size={12} /> {editCat ? 'Cerrar catálogo' : 'Editar catálogo'}</button>
              </div>
              {!editCat ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 6 }}>
                  {catalogo.map(c => {
                    const on = sel[c.id] !== undefined;
                    return (
                      <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, background: on ? 'rgba(186,175,165,0.12)' : 'rgba(255,255,255,0.03)', border: `1px solid ${on ? 'rgba(186,175,165,0.4)' : 'rgba(255,255,255,0.06)'}`, cursor: 'pointer' }}>
                        <input type="checkbox" checked={on} onChange={e => setSel(s => { const n = { ...s }; if (e.target.checked) n[c.id] = c.horas; else delete n[c.id]; return n; })} />
                        <span style={{ flex: 1, fontSize: '0.82rem' }}>{c.nombre}</span>
                        {on && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }} onClick={e => e.preventDefault()}>
                          <input type="number" min="0.5" step="0.5" value={sel[c.id]} onChange={e => setSel(s => ({ ...s, [c.id]: e.target.value }))} style={{ ...input, width: 54, padding: '3px 5px' }} aria-label={`Horas de ${c.nombre}`} /><span style={muted}>h</span>
                        </span>}
                        {!on && <span style={muted}>{c.horas} h</span>}
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div>
                  {catalogo.map((c, i) => (
                    <div key={c.id + i} style={{ display: 'flex', gap: 6, marginBottom: 5 }}>
                      <input style={{ ...input, flex: 1 }} value={c.nombre} onChange={e => setCatalogo(l => l.map((x, k) => (k === i ? { ...x, nombre: e.target.value } : x)))} />
                      <input type="number" min="0.5" step="0.5" style={{ ...input, width: 64 }} value={c.horas} onChange={e => setCatalogo(l => l.map((x, k) => (k === i ? { ...x, horas: e.target.value } : x)))} />
                      <button className="ap-btn-icon" onClick={() => setCatalogo(l => l.filter((_, k) => k !== i))} aria-label="Quitar"><Trash2 size={13} /></button>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => setCatalogo(l => [...l, { id: 'e' + Date.now().toString(36), nombre: '', horas: 2 }])}><Plus size={12} /> Añadir entregable</button>
                    <button className="ap-btn ap-btn-primary ap-btn-sm" onClick={guardarCatalogo}>Guardar catálogo</button>
                  </div>
                  <div style={{ ...muted, marginTop: 6 }}>Las horas son lo que sueles tardar de media. Con el tiempo las ajustas a tu ritmo real.</div>
                </div>
              )}
            </div>

            <div style={{ ...card, marginBottom: 12 }}>
              <b style={{ fontSize: '0.86rem' }}>2 · Fecha de entrega y ritmo</b>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
                <label style={{ display: 'grid', gap: 3, fontSize: '0.74rem', color: 'rgba(255,255,255,0.55)' }}>Entrega al cliente<input type="date" value={entrega} min={hoy} onChange={e => setEntrega(e.target.value)} style={input} /></label>
                <label style={{ display: 'grid', gap: 3, fontSize: '0.74rem', color: 'rgba(255,255,255,0.55)' }}>Terminar antes (días)<input type="number" min="0" max="15" value={margen} onChange={e => setMargen(e.target.value)} style={{ ...input, width: 80 }} /></label>
                <label style={{ display: 'grid', gap: 3, fontSize: '0.74rem', color: 'rgba(255,255,255,0.55)' }}>Horas al día en este proyecto<input type="number" min="1" max="12" step="0.5" value={horasDia} onChange={e => setHorasDia(e.target.value)} style={{ ...input, width: 80 }} /></label>
              </div>
              <div style={{ ...muted, marginTop: 8 }}>{marcados.length} entregable{marcados.length === 1 ? '' : 's'} · {total} h en total. Se reparte de lunes a viernes, desde hoy hasta {margen} día{Number(margen) === 1 ? '' : 's'} laborable{Number(margen) === 1 ? '' : 's'} antes de la entrega.</div>
              <button className="ap-btn ap-btn-primary ap-btn-sm" style={{ marginTop: 10 }} disabled={!marcados.length || !entrega || trabajando} onClick={calcular}>{trabajando && !prop ? 'Calculando…' : 'Calcular fechas'}</button>
            </div>

            {prop && (
              <div style={{ ...card, marginBottom: 12 }}>
                <b style={{ fontSize: '0.86rem' }}>3 · Calendario propuesto</b>
                <div style={{ ...muted, margin: '4px 0 8px' }}>Fecha interna de entrega: <b style={{ color: '#fff' }}>{fmt(prop.interna)}</b> · {prop.diasDisponibles} días hábiles · ritmo de {prop.ritmo} h al día. Puedes cambiar cualquier fecha.</div>
                {!prop.cabe && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: 'rgba(174,139,139,0.15)', border: '1px solid rgba(174,139,139,0.4)', borderRadius: 8, padding: '8px 10px', marginBottom: 8, fontSize: '0.8rem' }}>
                    <AlertTriangle size={16} style={{ color: '#ae8b8b', flexShrink: 0, marginTop: 1 }} />
                    <span>Con {horasDia} h al día <b>no da tiempo</b>: faltan {prop.faltanHoras} h. Opciones: mover la entrega, quitar algún entregable, subir las horas al día o terminar con menos margen.</span>
                  </div>
                )}
                {items.map((i, k) => (
                  <div key={i.id + k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: k ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                    <span style={{ flex: 1, fontSize: '0.83rem', minWidth: 0 }}>{i.nombre}{i.fuera && <span style={{ color: '#ae8b8b', marginLeft: 6, fontSize: '0.72rem' }}>fuera de plazo</span>}</span>
                    <span style={muted}>{i.horas} h</span>
                    <input type="date" value={i.fecha} onChange={e => setItems(l => l.map((x, j) => (j === k ? { ...x, fecha: e.target.value } : x)))} style={{ ...input, width: 138 }} aria-label={`Fecha de ${i.nombre}`} />
                  </div>
                ))}
                {plan?.tareas?.length > 0 && (
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, fontSize: '0.78rem', color: 'rgba(255,255,255,0.65)' }}>
                    <input type="checkbox" checked={reemplazar} onChange={e => setReemplazar(e.target.checked)} /> Sustituir lo planificado antes (solo se quitan las tareas pendientes que creó el planificador; las hechas y las tuyas no se tocan)
                  </label>
                )}
                <button className="ap-btn ap-btn-primary" style={{ marginTop: 12, width: '100%' }} disabled={trabajando || !items.length || items.some(i => !i.fecha)} onClick={aplicar}>{trabajando ? 'Creando…' : `Crear ${items.length} tarea${items.length === 1 ? '' : 's'} con estas fechas`}</button>
              </div>
            )}
          </>
        )}
        {msg && <div style={{ fontSize: '0.8rem', color: '#baafa5', marginTop: 6 }}>{msg}</div>}
      </div>
    </div>
  );
}
