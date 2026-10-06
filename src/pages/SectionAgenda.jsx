import { useState, useEffect } from 'react';
import { CalendarDays, Plus, Trash2, Phone, Instagram, Save, LayoutGrid, List as ListIcon, X, RefreshCw, Search, CalendarCheck, Users, User, Clock } from 'lucide-react';
import api from '../services/api';
import { useAdminAuth } from '../auth/AdminAuthContext';
import { CallBigCalendar } from '../components/CallBigCalendar';

const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function useToast() {
  const [toasts, setToasts] = useState([]);
  const add = (message, type = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  };
  const remove = (id) => setToasts(prev => prev.filter(t => t.id !== id));
  return { toasts, toast: { success: m => add(m, 'success'), error: m => add(m, 'error') }, remove };
}

function fmtFecha(fecha) {
  const [y, m, d] = fecha.split('-');
  return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('es-ES', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

function hhmm(t) {
  return (t || '').slice(0, 5);
}

// Regla de disponibilidad recurrente ("Lunes a Viernes 10-14h, llamadas de 30 min").
function ReglasDisponibilidad({ reglas, onChange, toast }) {
  const [dia, setDia] = useState('1');
  const [inicio, setInicio] = useState('');
  const [fin, setFin] = useState('');
  const [duracion, setDuracion] = useState('30');
  const [saving, setSaving] = useState(false);

  const crear = async (e) => {
    e.preventDefault();
    if (!inicio || !fin) return;
    if (fin <= inicio) { toast.error('La hora de fin debe ser posterior a la de inicio'); return; }
    setSaving(true);
    try {
      const { data } = await api.post('/call-slots/rules', { dia_semana: Number(dia), hora_inicio: inicio, hora_fin: fin, duracion_llamada_min: Number(duracion) });
      onChange(prev => [...prev, data.regla]);
      toast.success('Disponibilidad recurrente añadida — ya se han generado los huecos de las próximas semanas');
      setInicio(''); setFin('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error al crear la regla');
    } finally {
      setSaving(false);
    }
  };

  const toggleActivo = async (regla) => {
    try {
      const { data } = await api.put(`/call-slots/rules/${regla.id}`, { activo: !regla.activo });
      onChange(prev => prev.map(r => r.id === regla.id ? data.regla : r));
    } catch {
      toast.error('Error al actualizar la regla');
    }
  };

  const eliminar = async (regla) => {
    try {
      await api.delete(`/call-slots/rules/${regla.id}`);
      onChange(prev => prev.filter(r => r.id !== regla.id));
      toast.success('Regla eliminada');
    } catch {
      toast.error('Error al eliminar la regla');
    }
  };

  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '1rem', marginBottom: '1.25rem' }}>
      <p style={{ fontSize: '0.78rem', fontWeight: 700, color: '#fff', marginBottom: 4 }}>Disponibilidad recurrente cada semana</p>
      <p style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', marginBottom: '0.75rem' }}>En vez de ir día a día: di qué día de la semana, en qué rango de horas, y de cuánto dura cada llamada — se generan solos los huecos de las próximas 6 semanas.</p>

      {reglas.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: '0.85rem' }}>
          {reglas.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '0.5rem 0.75rem', opacity: r.activo ? 1 : 0.45 }}>
              <span style={{ fontSize: '0.78rem', color: '#fff' }}>
                <strong>{DIAS_SEMANA[r.dia_semana]}</strong> · {hhmm(r.hora_inicio)}–{hhmm(r.hora_fin)} · llamadas de {r.duracion_llamada_min} min
              </span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button type="button" onClick={() => toggleActivo(r)} className="ap-btn ap-btn-ghost ap-btn-sm">{r.activo ? 'Desactivar' : 'Reactivar'}</button>
                <button type="button" onClick={() => eliminar(r)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', cursor: 'pointer' }}><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={crear} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="ap-field" style={{ margin: 0 }}>
          <label>Día</label>
          <select className="ap-select" value={dia} onChange={e => setDia(e.target.value)}>
            {DIAS_SEMANA.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
        </div>
        <div className="ap-field" style={{ margin: 0 }}>
          <label>Desde</label>
          <input type="time" className="ap-field-input" value={inicio} onChange={e => setInicio(e.target.value)} required />
        </div>
        <div className="ap-field" style={{ margin: 0 }}>
          <label>Hasta</label>
          <input type="time" className="ap-field-input" value={fin} onChange={e => setFin(e.target.value)} required />
        </div>
        <div className="ap-field" style={{ margin: 0 }}>
          <label>Duración por llamada</label>
          <select className="ap-select" value={duracion} onChange={e => setDuracion(e.target.value)}>
            <option value="15">15 min</option>
            <option value="20">20 min</option>
            <option value="30">30 min</option>
            <option value="45">45 min</option>
            <option value="60">60 min</option>
          </select>
        </div>
        <button type="submit" className="ap-btn ap-btn-primary ap-btn-sm" disabled={saving}><Plus size={14} /> Añadir disponibilidad</button>
      </form>
    </div>
  );
}

// Formulario para añadir un hueco suelto (para un día concreto, fuera de la
// disponibilidad recurrente).
function NuevoHuecoForm({ onCreado, toast }) {
  const [fecha, setFecha] = useState('');
  const [inicio, setInicio] = useState('');
  const [fin, setFin] = useState('');
  const [saving, setSaving] = useState(false);

  const crear = async (e) => {
    e.preventDefault();
    if (!fecha || !inicio || !fin) return;
    if (fin <= inicio) { toast.error('La hora de fin debe ser posterior a la de inicio'); return; }
    setSaving(true);
    try {
      const { data } = await api.post('/call-slots', { fecha, hora_inicio: inicio, hora_fin: fin });
      onCreado(data.slots);
      toast.success('Hueco añadido');
      setInicio(''); setFin('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error al crear el hueco');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={crear} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '0.85rem 1rem', marginBottom: '1.25rem' }}>
      <div className="ap-field" style={{ margin: 0 }}>
        <label>Fecha</label>
        <input type="date" className="ap-field-input" value={fecha} onChange={e => setFecha(e.target.value)} required />
      </div>
      <div className="ap-field" style={{ margin: 0 }}>
        <label>Desde</label>
        <input type="time" className="ap-field-input" value={inicio} onChange={e => setInicio(e.target.value)} required />
      </div>
      <div className="ap-field" style={{ margin: 0 }}>
        <label>Hasta</label>
        <input type="time" className="ap-field-input" value={fin} onChange={e => setFin(e.target.value)} required />
      </div>
      <button type="submit" className="ap-btn ap-btn-primary ap-btn-sm" disabled={saving}><Plus size={14} /> Añadir hueco suelto</button>
    </form>
  );
}

// Fila de un hueco ya reservado — deja rellenar el resumen de la llamada.
function ResumenLlamada({ slot, onGuardado, toast }) {
  const [texto, setTexto] = useState(slot.resumen_llamada || '');
  const [editando, setEditando] = useState(false);
  const [saving, setSaving] = useState(false);

  const guardar = async () => {
    setSaving(true);
    try {
      const { data } = await api.put(`/call-slots/${slot.id}`, { resumen_llamada: texto });
      onGuardado(data.slot);
      toast.success('Resumen guardado');
      setEditando(false);
    } catch {
      toast.error('Error al guardar el resumen');
    } finally {
      setSaving(false);
    }
  };

  if (!editando && slot.resumen_llamada) {
    return (
      <div style={{ marginTop: 6 }}>
        <p style={{ margin: 0, fontSize: '0.78rem', color: 'rgba(255,255,255,0.7)', whiteSpace: 'pre-wrap' }}>{slot.resumen_llamada}</p>
        <button type="button" onClick={() => setEditando(true)} style={{ background: 'none', border: 'none', color: '#beb0a2', fontSize: '0.72rem', cursor: 'pointer', padding: 0, marginTop: 4 }}>Editar resumen</button>
      </div>
    );
  }
  if (!editando) {
    return <button type="button" onClick={() => setEditando(true)} className="ap-btn ap-btn-ghost ap-btn-sm" style={{ marginTop: 6 }}>+ Añadir resumen de la llamada</button>;
  }
  return (
    <div style={{ marginTop: 6, display: 'flex', gap: 6, flexDirection: 'column' }}>
      <textarea className="ap-diag-textarea" rows={3} value={texto} onChange={e => setTexto(e.target.value)} placeholder="Cómo fue la llamada, qué se acordó, próximos pasos…" autoFocus />
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" className="ap-btn ap-btn-primary ap-btn-sm" disabled={saving} onClick={guardar}><Save size={12} /> Guardar</button>
        <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => { setEditando(false); setTexto(slot.resumen_llamada || ''); }}>Cancelar</button>
      </div>
    </div>
  );
}

// Busca un lead de la base de Setting (por nombre, teléfono o Instagram) y
// permite reservar el hueco directamente para él, sin tener que ir antes a
// la ficha del lead en Setting.
function BuscarLeadPicker({ slotId, onReservado, toast }) {
  const [query, setQuery] = useState('');
  const [leads, setLeads] = useState(null); // null = aún no cargados
  const [seleccionado, setSeleccionado] = useState(null);
  const [reservando, setReservando] = useState(false);

  useEffect(() => {
    api.get('/setting').then(r => setLeads(r.data.registros || [])).catch(() => setLeads([]));
  }, []);

  const q = query.trim().toLowerCase();
  const resultados = q.length < 2 || !leads ? [] : leads.filter(l =>
    [l.nombre, l.telefono, l.instagram].some(v => (v || '').toLowerCase().includes(q))
  ).slice(0, 8);

  const reservar = async () => {
    if (!seleccionado) return;
    setReservando(true);
    try {
      const { data } = await api.post(`/call-slots/${slotId}/reservar`, { setting_lead_id: seleccionado.id });
      onReservado(data.slot);
      toast.success(`Llamada agendada con ${seleccionado.nombre}`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se ha podido reservar');
    } finally {
      setReservando(false);
    }
  };

  if (seleccionado) {
    return (
      <div style={{ marginTop: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '0.6rem 0.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.82rem', color: '#fff' }}><strong>{seleccionado.nombre}</strong> {seleccionado.telefono && `· ${seleccionado.telefono}`}</span>
          <button type="button" onClick={() => setSeleccionado(null)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer' }}><X size={13} /></button>
        </div>
        <button type="button" className="ap-btn ap-btn-primary ap-btn-sm" style={{ marginTop: 8 }} disabled={reservando} onClick={reservar}>
          <CalendarCheck size={13} /> Reservar para este lead
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ position: 'relative' }}>
        <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.35)' }} />
        <input
          className="ap-field-input"
          style={{ paddingLeft: 28, fontSize: '0.8rem' }}
          placeholder="Buscar lead de Setting por nombre, teléfono o Instagram…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>
      {q.length >= 2 && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {resultados.length === 0 && <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.35)', margin: '4px 0 0' }}>Sin resultados en Setting.</p>}
          {resultados.map(l => (
            <button key={l.id} type="button" onClick={() => setSeleccionado(l)}
              style={{ textAlign: 'left', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: '0.4rem 0.6rem', cursor: 'pointer', fontSize: '0.78rem', color: '#fff' }}>
              <strong>{l.nombre}</strong>
              {l.telefono && <span style={{ color: 'rgba(255,255,255,0.4)' }}> · {l.telefono}</span>}
              {l.instagram && <span style={{ color: 'rgba(255,255,255,0.4)' }}> · @{l.instagram}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Panel que se abre al pinchar un hueco en el calendario grande.
const ESTADOS_LEAD = [
  ['nuevo', 'Nuevo'], ['interesado', 'Interesado'], ['no_califica', 'No califica'], ['contacto_nuevo', 'Contacto Nuevo'],
  ['pitcheo_agenda', 'Pitcheo Agenda'], ['agendado', 'Agendado'], ['recolectando_info', 'Recolectando Info.'], ['prioridad', 'Prioridad'],
  ['venta_1', 'Venta 1 ✓'], ['venta_2', 'Venta 2 ✓'], ['venta_extra', 'Venta extra ✓'], ['rechazo', 'Rechazo'], ['seguimiento_futuro', 'Seguimiento futuro'], ['no_responde', 'No responde'],
];

// Estado del lead y enlace de la grabación (Fathom) de la llamada, editables
// desde el propio hueco para no tener que ir a Setting a cambiarlo.
function EstadoYFathom({ slot, onGuardado, toast }) {
  const [fathom, setFathom] = useState(slot.fathom_url || '');
  const [savingF, setSavingF] = useState(false);
  const [savingE, setSavingE] = useState(false);

  const cambiarEstado = async (estado) => {
    setSavingE(true);
    try {
      const { data } = await api.put(`/call-slots/${slot.id}`, { estado_lead: estado });
      onGuardado(data.slot);
      toast.success('Estado del lead actualizado');
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se ha podido cambiar el estado');
    } finally { setSavingE(false); }
  };
  const guardarFathom = async () => {
    setSavingF(true);
    try {
      const { data } = await api.put(`/call-slots/${slot.id}`, { fathom_url: fathom });
      onGuardado(data.slot);
      toast.success(fathom.trim() ? 'Enlace de Fathom guardado' : 'Enlace quitado');
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se ha podido guardar el enlace');
    } finally { setSavingF(false); }
  };

  return (
    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <label style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Estado del lead</label>
        <select className="ap-select" value={slot.lead?.estado || ''} onChange={e => cambiarEstado(e.target.value)} disabled={savingE} style={{ marginTop: 4 }}>
          {ESTADOS_LEAD.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div>
        <label style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Grabación (Fathom)</label>
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <input className="ap-field-input" value={fathom} onChange={e => setFathom(e.target.value)} placeholder="https://fathom.video/..." style={{ flex: 1 }} />
          <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={guardarFathom} disabled={savingF || fathom.trim() === (slot.fathom_url || '')}>{savingF ? '…' : 'Guardar'}</button>
        </div>
        {slot.fathom_url && <a href={slot.fathom_url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 6, fontSize: '0.74rem', color: '#beb0a2' }}>Abrir grabación ↗</a>}
      </div>
    </div>
  );
}

// Cambiar la fecha y la hora de una llamada (o de un hueco libre) desde la agenda.
// Mantiene la duración, avisa a quien tiene la llamada y actualiza el lead en Setting.
function ReprogramarLlamada({ slot, onReprogramado, toast }) {
  const [abierto, setAbierto] = useState(false);
  const [fecha, setFecha] = useState(slot.fecha);
  const [hora, setHora] = useState(hhmm(slot.hora_inicio));
  const [saving, setSaving] = useState(false);
  useEffect(() => { setFecha(slot.fecha); setHora(hhmm(slot.hora_inicio)); setAbierto(false); }, [slot.id, slot.fecha, slot.hora_inicio]);

  const guardar = async () => {
    setSaving(true);
    try {
      const { data } = await api.put(`/call-slots/${slot.id}/reprogramar`, { fecha, hora_inicio: hora });
      onReprogramado(data.slot);
      toast.success(slot.ocupado ? 'Llamada cambiada de hora' : 'Hueco cambiado de hora');
      setAbierto(false);
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se ha podido cambiar la hora');
    } finally { setSaving(false); }
  };

  if (!abierto) {
    return <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" style={{ marginTop: 12 }} onClick={() => setAbierto(true)}><Clock size={13} /> Cambiar fecha u hora</button>;
  }
  return (
    <div style={{ marginTop: 12, padding: '0.75rem', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div className="ap-field" style={{ margin: 0, flex: 1, minWidth: 130 }}>
          <label>Nueva fecha</label>
          <input type="date" className="ap-field-input" value={fecha} onChange={e => setFecha(e.target.value)} />
        </div>
        <div className="ap-field" style={{ margin: 0, flex: 1, minWidth: 100 }}>
          <label>Nueva hora</label>
          <input type="time" className="ap-field-input" value={hora} onChange={e => setHora(e.target.value)} />
        </div>
      </div>
      {slot.ocupado && <p style={{ margin: '8px 0 0', fontSize: '0.72rem', color: 'rgba(255,255,255,0.45)' }}>Se avisa por email a {slot.empleado?.name || 'quien tiene la llamada'} y se actualiza el lead en Setting. La duración se mantiene.</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button type="button" className="ap-btn ap-btn-primary ap-btn-sm" onClick={guardar} disabled={saving || !fecha || !hora}>{saving ? 'Guardando…' : 'Guardar cambio'}</button>
        <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => setAbierto(false)}>Cancelar</button>
      </div>
    </div>
  );
}

function DetalleHuecoModal({ slot, onClose, onGuardado, onEliminado, onReservado, onReprogramado, toast }) {
  return (
    <div className="ap-modal-overlay" onClick={onClose}>
      <div className="ap-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="ap-modal-head">
          <h2>{fmtFecha(slot.fecha)}, {hhmm(slot.hora_inicio)}–{hhmm(slot.hora_fin)}</h2>
          <button className="ap-modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div style={{ padding: '0 1.5rem 1.5rem' }}>
          {slot.ocupado ? (
            <>
              <span style={{ fontSize: '0.68rem', padding: '2px 9px', borderRadius: 20, background: 'rgba(167,139,250,0.15)', color: '#a78bfa' }}>Reservado</span>
              {slot.lead && (
                <div style={{ marginTop: 10, display: 'flex', gap: 12, fontSize: '0.82rem', color: 'rgba(255,255,255,0.7)', flexWrap: 'wrap' }}>
                  <strong style={{ color: '#fff' }}>{slot.lead.nombre}</strong>
                  {slot.lead.telefono && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Phone size={12} />{slot.lead.telefono}</span>}
                  {slot.lead.instagram && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Instagram size={12} />@{slot.lead.instagram}</span>}
                </div>
              )}
              <ReprogramarLlamada slot={slot} onReprogramado={onReprogramado} toast={toast} />
              <EstadoYFathom slot={slot} onGuardado={onGuardado} toast={toast} />
              <ResumenLlamada slot={slot} onGuardado={onGuardado} toast={toast} />
            </>
          ) : (
            <>
              <span style={{ fontSize: '0.68rem', padding: '2px 9px', borderRadius: 20, background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}>Libre</span>
              <BuscarLeadPicker slotId={slot.id} onReservado={onReservado} toast={toast} />
              <ReprogramarLlamada slot={slot} onReprogramado={onReprogramado} toast={toast} />
              <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 10 }}>
                <button type="button" className="ap-btn ap-btn-ghost" style={{ color: '#ae8b8b' }} onClick={() => onEliminado(slot)}><Trash2 size={13} /> Eliminar este hueco</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Agendar una llamada desde el calendario del equipo (vista de admin): elegir
// con quién, día y hora, y enlazarla a un lead de Setting o crear uno nuevo.
function AgendarLlamadaEquipo({ onAgendado, toast }) {
  const [abierto, setAbierto] = useState(false);
  const [empleados, setEmpleados] = useState([]);
  const [leads, setLeads] = useState(null);
  const [empleadoId, setEmpleadoId] = useState('');
  const [fecha, setFecha] = useState('');
  const [hora, setHora] = useState('');
  const [modo, setModo] = useState('existente');
  const [query, setQuery] = useState('');
  const [leadSel, setLeadSel] = useState(null);
  const [nuevo, setNuevo] = useState({ nombre: '', telefono: '', instagram: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!abierto || leads) return;
    api.get('/employees').then(r => {
      const lista = r.data.employees || [];
      setEmpleados(lista);
      const hernan = lista.find(e => (e.name || '').toLowerCase().startsWith('hern'));
      setEmpleadoId(prev => prev || hernan?.id || lista[0]?.id || '');
    }).catch(() => {});
    api.get('/setting').then(r => setLeads(r.data.registros || [])).catch(() => setLeads([]));
  }, [abierto, leads]);

  const q = query.trim().toLowerCase();
  const resultados = q.length < 2 || !leads ? [] : leads.filter(l => [l.nombre, l.telefono, l.instagram].some(v => (v || '').toLowerCase().includes(q))).slice(0, 6);

  const listo = empleadoId && fecha && hora && (modo === 'existente' ? leadSel : nuevo.nombre.trim());

  const agendar = async () => {
    setSaving(true);
    try {
      const body = { employee_id: empleadoId, fecha, hora_inicio: hora };
      if (modo === 'existente') body.setting_lead_id = leadSel.id; else body.nuevo_lead = nuevo;
      const { data } = await api.post('/call-slots/agendar', body);
      onAgendado(data.slot);
      toast.success(`Llamada agendada con ${data.slot.lead?.nombre || 'el lead'}`);
      setLeadSel(null); setQuery(''); setNuevo({ nombre: '', telefono: '', instagram: '' }); setHora(''); setLeads(null);
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se ha podido agendar la llamada');
    } finally { setSaving(false); }
  };

  if (!abierto) {
    return <button type="button" className="ap-btn ap-btn-primary" style={{ marginBottom: '1rem' }} onClick={() => setAbierto(true)}><CalendarCheck size={14} /> Agendar llamada</button>;
  }
  const lbl = { fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.5 };
  return (
    <div style={{ marginBottom: '1.25rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '1rem 1.1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <strong style={{ fontSize: '0.9rem' }}>Agendar llamada</strong>
        <button type="button" onClick={() => setAbierto(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer' }}><X size={15} /></button>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ flex: '1 1 180px' }}><label style={lbl}>Con quién</label>
          <select className="ap-select" value={empleadoId} onChange={e => setEmpleadoId(e.target.value)} style={{ marginTop: 4 }}>
            {empleados.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select></div>
        <div><label style={lbl}>Día</label><input type="date" className="ap-field-input" value={fecha} onChange={e => setFecha(e.target.value)} style={{ marginTop: 4 }} /></div>
        <div><label style={lbl}>Hora</label><input type="time" className="ap-field-input" value={hora} onChange={e => setHora(e.target.value)} style={{ marginTop: 4 }} /></div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {[['existente', 'Lead existente'], ['nuevo', 'Lead nuevo']].map(([v, l]) => (
          <button key={v} type="button" className={`ap-btn ap-btn-sm ${modo === v ? 'ap-btn-primary' : 'ap-btn-ghost'}`} onClick={() => setModo(v)}>{l}</button>
        ))}
      </div>
      {modo === 'existente' ? (
        leadSel ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '0.5rem 0.75rem' }}>
            <span style={{ fontSize: '0.84rem' }}><strong>{leadSel.nombre}</strong> {leadSel.telefono && `· ${leadSel.telefono}`}</span>
            <button type="button" onClick={() => setLeadSel(null)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer' }}><X size={13} /></button>
          </div>
        ) : (
          <>
            <div style={{ position: 'relative' }}>
              <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.35)' }} />
              <input className="ap-field-input" style={{ paddingLeft: 28 }} placeholder="Buscar lead por nombre, teléfono o Instagram…" value={query} onChange={e => setQuery(e.target.value)} />
            </div>
            {q.length >= 2 && (
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {resultados.length === 0 && <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.35)', margin: '4px 0 0' }}>Sin resultados — prueba con "Lead nuevo".</p>}
                {resultados.map(l => (
                  <button key={l.id} type="button" onClick={() => setLeadSel(l)} style={{ textAlign: 'left', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: '0.4rem 0.6rem', cursor: 'pointer', fontSize: '0.78rem', color: '#fff' }}>
                    <strong>{l.nombre}</strong> <span style={{ color: 'rgba(255,255,255,0.45)' }}>{[l.telefono, l.instagram && `@${l.instagram}`].filter(Boolean).join(' · ')}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input className="ap-field-input" style={{ flex: '2 1 180px' }} placeholder="Nombre *" value={nuevo.nombre} onChange={e => setNuevo(n => ({ ...n, nombre: e.target.value }))} />
          <input className="ap-field-input" style={{ flex: '1 1 130px' }} placeholder="Teléfono" value={nuevo.telefono} onChange={e => setNuevo(n => ({ ...n, telefono: e.target.value }))} />
          <input className="ap-field-input" style={{ flex: '1 1 130px' }} placeholder="@instagram" value={nuevo.instagram} onChange={e => setNuevo(n => ({ ...n, instagram: e.target.value }))} />
        </div>
      )}
      <button type="button" className="ap-btn ap-btn-primary" style={{ marginTop: 12 }} disabled={!listo || saving} onClick={agendar}>
        {saving ? 'Agendando…' : 'Agendar llamada'}
      </button>
    </div>
  );
}

export function SectionAgenda() {
  const { user } = useAdminAuth();
  const [slots, setSlots] = useState([]);
  const [reglas, setReglas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [vista, setVista] = useState('calendario');
  const [detalle, setDetalle] = useState(null);
  const [verTodos, setVerTodos] = useState(false);
  const { toasts, toast, remove } = useToast();
  const esAdmin = user?.role === 'admin_superior';

  const cargar = () => {
    Promise.all([api.get('/call-slots'), api.get('/call-slots/rules')])
      .then(([r1, r2]) => { setSlots(r1.data.slots || []); setReglas(r2.data.reglas || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(() => { cargar(); }, []);

  // El backend devuelve los huecos/reglas de TODOS (para que Franco los vea
  // al reservar) — aquí en "Mi Agenda" cada uno gestiona solo los suyos, pero
  // el admin puede activar "Ver todo el equipo" para verlos todos de un
  // vistazo (sin que eso cambie lo que gestiona: añadir huecos/reglas sigue
  // siendo siempre sobre los propios).
  const misHuecos = slots.filter(s => s.empleado?.email === user?.email);
  const misReglas = reglas.filter(r => r.empleado?.email === user?.email);
  const huecosVisibles = esAdmin && verTodos ? slots : misHuecos;

  const eliminarSlot = async (slot) => {
    try {
      await api.delete(`/call-slots/${slot.id}`);
      setSlots(prev => prev.filter(s => s.id !== slot.id));
      toast.success('Hueco eliminado');
      setDetalle(null);
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se ha podido eliminar');
    }
  };

  const hoy = new Date().toISOString().slice(0, 10);
  const porFecha = {};
  huecosVisibles.filter(s => s.fecha >= hoy).forEach(s => { (porFecha[s.fecha] ||= []).push(s); });
  const fechasOrdenadas = Object.keys(porFecha).sort();

  if (loading) return <div className="ap-loading">Cargando…</div>;

  return (
    <div className="ap-section">
      <div className="ap-toasts">
        {toasts.map(t => (
          <div key={t.id} className={`ap-toast ap-toast--${t.type}`}>
            <span>{t.message}</span>
            <button onClick={() => remove(t.id)}><X size={13} /></button>
          </div>
        ))}
      </div>

      {detalle && (
        <DetalleHuecoModal
          slot={detalle}
          onClose={() => setDetalle(null)}
          onGuardado={(upd) => { setSlots(prev => prev.map(x => x.id === upd.id ? { ...x, ...upd } : x)); setDetalle(upd); }}
          onReservado={(upd) => { setSlots(prev => prev.map(x => x.id === upd.id ? { ...x, ...upd } : x)); setDetalle(upd); }}
          onReprogramado={(nuevo) => { cargar(); setDetalle(nuevo); }}
          onEliminado={eliminarSlot}
          toast={toast}
        />
      )}

      <div className="ap-section-head">
        <div>
          <h1><CalendarDays size={20} style={{ verticalAlign: -3, marginRight: 6 }} />{esAdmin && verTodos ? 'Agenda del equipo' : 'Mi Agenda'}</h1>
          <p>{esAdmin && verTodos
            ? 'Llamadas y disponibilidad de todo el equipo, de un vistazo.'
            : 'Marca tu disponibilidad para llamadas — el equipo de Setting reserva directamente para sus leads, y te avisamos por email 24h antes.'}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {esAdmin && (
            <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => setVerTodos(v => !v)}>
              {verTodos ? <><User size={13} /> Ver solo la mía</> : <><Users size={13} /> Ver todo el equipo</>}
            </button>
          )}
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: 2 }}>
            <button type="button" onClick={() => setVista('calendario')} title="Vista calendario"
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '0.4rem 0.6rem', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: '0.72rem', background: vista === 'calendario' ? 'rgba(255,255,255,0.1)' : 'transparent', color: vista === 'calendario' ? '#fff' : 'rgba(255,255,255,0.45)' }}>
              <CalendarDays size={13} /> Calendario
            </button>
            <button type="button" onClick={() => setVista('lista')} title="Vista lista"
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '0.4rem 0.6rem', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: '0.72rem', background: vista === 'lista' ? 'rgba(255,255,255,0.1)' : 'transparent', color: vista === 'lista' ? '#fff' : 'rgba(255,255,255,0.45)' }}>
              <ListIcon size={13} /> Lista
            </button>
          </div>
        </div>
      </div>

      {esAdmin && verTodos && (
        <AgendarLlamadaEquipo
          onAgendado={(nuevo) => setSlots(prev => [...prev.filter(x => x.id !== nuevo.id && x.setting_lead_id !== nuevo.setting_lead_id), nuevo])}
          toast={toast}
        />
      )}

      {!(esAdmin && verTodos) && (
        <>
          <ReglasDisponibilidad reglas={misReglas} onChange={(fn) => setReglas(prev => fn(prev))} toast={toast} />
          <NuevoHuecoForm onCreado={(nuevos) => setSlots(prev => [...prev, ...nuevos])} toast={toast} />
        </>
      )}

      {vista === 'calendario' ? (
        <CallBigCalendar slots={huecosVisibles} onSelectEvent={setDetalle} mostrarEmpleado={esAdmin && verTodos} />
      ) : (
        <>
          {fechasOrdenadas.length === 0 && (
            <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.85rem' }}>{esAdmin && verTodos ? 'No hay ningún hueco del equipo todavía.' : 'No tienes ningún hueco todavía — añade disponibilidad arriba.'}</p>
          )}
          {fechasOrdenadas.map(fecha => (
            <div key={fecha} style={{ marginBottom: '1.25rem' }}>
              <p style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'capitalize', color: 'rgba(255,255,255,0.5)', marginBottom: '0.5rem' }}>{fmtFecha(fecha)}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {porFecha[fecha].sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio)).map(s => (
                  <div key={s.id} onClick={() => setDetalle(s)} style={{ cursor: 'pointer', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '0.75rem 1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <strong style={{ fontSize: '0.85rem', color: '#fff' }}>
                        {hhmm(s.hora_inicio)} – {hhmm(s.hora_fin)}
                        {esAdmin && verTodos && <span style={{ fontWeight: 400, color: 'rgba(255,255,255,0.4)', marginLeft: 8 }}>{s.empleado?.name || ''}</span>}
                      </strong>
                      {s.ocupado ? (
                        <span style={{ fontSize: '0.68rem', padding: '2px 9px', borderRadius: 20, background: 'rgba(167,139,250,0.15)', color: '#a78bfa' }}>Reservado{s.lead ? `: ${s.lead.nombre}` : ''}</span>
                      ) : (
                        <span style={{ fontSize: '0.68rem', padding: '2px 9px', borderRadius: 20, background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}>Libre</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
