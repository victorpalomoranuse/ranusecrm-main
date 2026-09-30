import { useState, useEffect } from 'react';
import { CalendarDays, Plus, Trash2, Phone, Instagram, Save } from 'lucide-react';
import api from '../services/api';
import { useAdminAuth } from '../auth/AdminAuthContext';

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
  // fecha viene como "YYYY-MM-DD" (columna date de Postgres)
  const [y, m, d] = fecha.split('-');
  return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('es-ES', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

function hhmm(t) {
  return (t || '').slice(0, 5);
}

// Formulario para añadir un hueco libre nuevo.
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
      <button type="submit" className="ap-btn ap-btn-primary ap-btn-sm" disabled={saving}><Plus size={14} /> Añadir hueco libre</button>
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

export function SectionAgenda() {
  const { user } = useAdminAuth();
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const { toasts, toast, remove } = useToast();

  const cargar = () => {
    api.get('/call-slots').then(r => setSlots(r.data.slots || [])).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { cargar(); }, []);

  // El backend devuelve los huecos de TODOS (para que Franco pueda verlos al
  // reservar desde Setting) — aquí en "Mi Agenda" cada uno gestiona solo los
  // suyos, filtrando por su propio email.
  const misHuecos = slots.filter(s => s.empleado?.email === user?.email);

  const handleDelete = async () => {
    try {
      await api.delete(`/call-slots/${confirmDelete.id}`);
      setSlots(prev => prev.filter(s => s.id !== confirmDelete.id));
      toast.success('Hueco eliminado');
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se ha podido eliminar');
    } finally {
      setConfirmDelete(null);
    }
  };

  // Agrupados por fecha, futuros primero.
  const hoy = new Date().toISOString().slice(0, 10);
  const porFecha = {};
  misHuecos.filter(s => s.fecha >= hoy).forEach(s => { (porFecha[s.fecha] ||= []).push(s); });
  const fechasOrdenadas = Object.keys(porFecha).sort();

  if (loading) return <div className="ap-loading">Cargando…</div>;

  return (
    <div className="ap-section">
      <div className="ap-toasts">
        {toasts.map(t => (
          <div key={t.id} className={`ap-toast ap-toast--${t.type}`}>
            <span>{t.message}</span>
            <button onClick={() => remove(t.id)}><Plus size={13} style={{ transform: 'rotate(45deg)' }} /></button>
          </div>
        ))}
      </div>

      {confirmDelete && (
        <div className="ap-confirm-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="ap-confirm" onClick={e => e.stopPropagation()}>
            <div className="ap-confirm-icon"><Trash2 size={24} /></div>
            <p className="ap-confirm-msg">¿Eliminar este hueco libre ({fmtFecha(confirmDelete.fecha)}, {hhmm(confirmDelete.hora_inicio)}–{hhmm(confirmDelete.hora_fin)})?</p>
            <div className="ap-confirm-actions">
              <button className="ap-btn ap-btn-ghost" onClick={() => setConfirmDelete(null)}>Cancelar</button>
              <button className="ap-btn ap-btn-danger" onClick={handleDelete}>Eliminar</button>
            </div>
          </div>
        </div>
      )}

      <div className="ap-section-head">
        <div>
          <h1><CalendarDays size={20} style={{ verticalAlign: -3, marginRight: 6 }} />Mi Agenda</h1>
          <p>Marca tus huecos libres para llamadas — el equipo de Setting los reserva directamente para sus leads, y te avisamos por email 24h antes.</p>
        </div>
      </div>

      <NuevoHuecoForm onCreado={(nuevos) => setSlots(prev => [...prev, ...nuevos])} toast={toast} />

      {fechasOrdenadas.length === 0 && (
        <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.85rem' }}>No tienes ningún hueco creado todavía — añade uno arriba.</p>
      )}

      {fechasOrdenadas.map(fecha => (
        <div key={fecha} style={{ marginBottom: '1.25rem' }}>
          <p style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'capitalize', color: 'rgba(255,255,255,0.5)', marginBottom: '0.5rem' }}>{fmtFecha(fecha)}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {porFecha[fecha].sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio)).map(s => (
              <div key={s.id} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '0.75rem 1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <strong style={{ fontSize: '0.85rem', color: '#fff' }}>{hhmm(s.hora_inicio)} – {hhmm(s.hora_fin)}</strong>
                  {s.ocupado ? (
                    <span style={{ fontSize: '0.68rem', padding: '2px 9px', borderRadius: 20, background: 'rgba(167,139,250,0.15)', color: '#a78bfa' }}>Reservado</span>
                  ) : (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: '0.68rem', padding: '2px 9px', borderRadius: 20, background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}>Libre</span>
                      <button onClick={() => setConfirmDelete(s)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', cursor: 'pointer' }}><Trash2 size={13} /></button>
                    </div>
                  )}
                </div>
                {s.ocupado && s.lead && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ display: 'flex', gap: 12, fontSize: '0.78rem', color: 'rgba(255,255,255,0.6)' }}>
                      <span>{s.lead.nombre}</span>
                      {s.lead.telefono && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Phone size={11} />{s.lead.telefono}</span>}
                      {s.lead.instagram && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Instagram size={11} />@{s.lead.instagram}</span>}
                    </div>
                    <ResumenLlamada slot={s} onGuardado={(upd) => setSlots(prev => prev.map(x => x.id === upd.id ? { ...x, ...upd } : x))} toast={toast} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
