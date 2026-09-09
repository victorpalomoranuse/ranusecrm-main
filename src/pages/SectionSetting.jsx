import { useState, useEffect } from 'react';
import { Pencil, Trash2, Plus, X, CheckCircle, AlertCircle, Target } from 'lucide-react';
import api from '../services/api';

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

function ToastContainer({ toasts, onRemove }) {
  return (
    <div className="ap-toasts">
      {toasts.map(t => (
        <div key={t.id} className={`ap-toast ap-toast--${t.type}`}>
          {t.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          <span>{t.message}</span>
          <button onClick={() => onRemove(t.id)}><X size={13} /></button>
        </div>
      ))}
    </div>
  );
}

function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <div className="ap-confirm-overlay" onClick={onCancel}>
      <div className="ap-confirm" onClick={e => e.stopPropagation()}>
        <div className="ap-confirm-icon"><AlertCircle size={28} /></div>
        <p className="ap-confirm-msg">{message}</p>
        <div className="ap-confirm-actions">
          <button className="ap-btn ap-btn-ghost" onClick={onCancel}>Cancelar</button>
          <button className="ap-btn ap-btn-danger" onClick={onConfirm}>Eliminar</button>
        </div>
      </div>
    </div>
  );
}

// Embudo previo de cualificación/agenda (independiente del de Leads, que no
// se toca): ADS → Interesado → No califica / Contacto Nuevo → Pitcheo
// Agenda → Recolectando Información → Prioridad → Venta / No responde.
const ESTADOS = {
  ads:                { label: 'ADS',                  color: '#3b82f6' },
  interesado:         { label: 'Interesado',            color: '#8b5cf6' },
  no_califica:        { label: 'No califica',            color: '#6b7280' },
  contacto_nuevo:     { label: 'Contacto Nuevo',          color: '#06b6d4' },
  pitcheo_agenda:     { label: 'Pitcheo Agenda',          color: '#f59e0b' },
  recolectando_info:  { label: 'Recolectando Info.',      color: '#f97316' },
  prioridad:          { label: 'Prioridad',                color: '#eab308' },
  venta:              { label: 'Venta ✓',                  color: '#22c55e' },
  no_responde:        { label: 'No responde',              color: '#ef4444' },
};
const ORDEN = ['ads','interesado','no_califica','contacto_nuevo','pitcheo_agenda','recolectando_info','prioridad','venta','no_responde'];
const CANALES = ['instagram','tiktok','whatsapp','web','recomendacion','prospeccion','ads','evento','agente','otro'];

const blank = { nombre:'', telefono:'', instagram:'', email:'', canal:'', estado:'ads', objetivo:'', medidas:'', maquinarias:'', notas:'', assigned_to:'' };

function RegistroModal({ registro, empleados, onClose, onSaved, toast }) {
  const isEdit = !!registro;
  const [form, setForm] = useState(registro ? {
    nombre: registro.nombre || '', telefono: registro.telefono || '', instagram: registro.instagram || '',
    email: registro.email || '', canal: registro.canal || '', estado: registro.estado || 'ads',
    objetivo: registro.objetivo || '', medidas: registro.medidas || '', maquinarias: registro.maquinarias || '',
    notas: registro.notas || '', assigned_to: registro.assigned_to || '',
  } : blank);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.nombre.trim()) return;
    setSaving(true);
    try {
      const payload = { ...form, assigned_to: form.assigned_to || null };
      if (isEdit) {
        const { data } = await api.put(`/setting/${registro.id}`, payload);
        onSaved(data.registro, true);
      } else {
        const { data } = await api.post('/setting', payload);
        onSaved(data.registro, false);
      }
      onClose();
    } catch {
      toast.error('Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ap-modal-overlay" onClick={onClose}>
      <div className="ap-modal" onClick={e => e.stopPropagation()}>
        <div className="ap-modal-head"><h2>{isEdit ? 'Editar registro' : 'Nuevo en Setting'}</h2><button className="ap-modal-close" onClick={onClose}><X size={16}/></button></div>
        <form onSubmit={handleSubmit} className="ap-modal-form">
          <div className="ap-field"><label>Nombre *</label><input className="ap-field-input" value={form.nombre} onChange={e=>set('nombre',e.target.value)} required autoFocus/></div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <div className="ap-field" style={{ flex:1, minWidth:140 }}><label>Teléfono</label><input className="ap-field-input" value={form.telefono} onChange={e=>set('telefono',e.target.value)}/></div>
            <div className="ap-field" style={{ flex:1, minWidth:140 }}><label>Instagram</label><input className="ap-field-input" value={form.instagram} onChange={e=>set('instagram',e.target.value)}/></div>
          </div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <div className="ap-field" style={{ flex:1, minWidth:140 }}><label>Email</label><input className="ap-field-input" type="email" value={form.email} onChange={e=>set('email',e.target.value)}/></div>
            <div className="ap-field" style={{ flex:1, minWidth:140 }}>
              <label>Canal</label>
              <select className="ap-select" value={form.canal} onChange={e=>set('canal',e.target.value)}>
                <option value="">—</option>
                {CANALES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="ap-field">
            <label>Estado</label>
            <select className="ap-select" value={form.estado} onChange={e=>set('estado',e.target.value)}>
              {ORDEN.map(e => <option key={e} value={e}>{ESTADOS[e].label}</option>)}
            </select>
          </div>
          <div className="ap-field">
            <label>Asignado a</label>
            <select className="ap-select" value={form.assigned_to} onChange={e=>set('assigned_to',e.target.value)}>
              <option value="">Sin asignar</option>
              {empleados.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
            </select>
          </div>
          <div style={{ borderTop:'1px solid rgba(255,255,255,0.07)', paddingTop:'0.75rem', marginTop:'0.25rem' }}>
            <p style={{ fontSize:'0.7rem', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.08em', color:'rgba(255,255,255,0.3)', marginBottom:'0.5rem' }}>Recolectando información</p>
            <div className="ap-field"><label>Objetivo</label><input className="ap-field-input" value={form.objetivo} onChange={e=>set('objetivo',e.target.value)} placeholder="ej: perder grasa, ganar fuerza, rehabilitación…"/></div>
            <div className="ap-field"><label>Medidas del espacio</label><input className="ap-field-input" value={form.medidas} onChange={e=>set('medidas',e.target.value)} placeholder="ej: garaje 4x6m, altura 2.4m"/></div>
            <div className="ap-field"><label>Maquinaria de interés</label><input className="ap-field-input" value={form.maquinarias} onChange={e=>set('maquinarias',e.target.value)} placeholder="ej: rack, cardio, mancuernas…"/></div>
          </div>
          <div className="ap-field"><label>Notas</label><textarea className="ap-diag-textarea" rows={3} value={form.notas} onChange={e=>set('notas',e.target.value)}/></div>
          <div className="ap-modal-actions">
            <button type="button" className="ap-btn ap-btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" className="ap-btn ap-btn-primary" disabled={saving || !form.nombre.trim()}>{saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function SectionSetting() {
  const [registros, setRegistros] = useState([]);
  const [metricas, setMetricas] = useState(null);
  const [empleados, setEmpleados] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // 'new' | registro object | null
  const [confirmDelete, setConfirmDelete] = useState(null);
  const { toasts, toast, remove } = useToast();

  const cargar = () => {
    api.get('/setting').then(r => { setRegistros(r.data.registros || []); setMetricas(r.data.metricas || null); }).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { cargar(); api.get('/employees').then(r => setEmpleados(r.data.employees || [])).catch(() => {}); }, []);

  const handleSaved = (registro, wasEdit) => {
    setRegistros(prev => wasEdit ? prev.map(r => r.id === registro.id ? registro : r) : [registro, ...prev]);
    toast.success(wasEdit ? 'Registro actualizado' : 'Registro creado');
    cargar();
  };

  const cambiarEstado = async (registro, estado) => {
    setRegistros(prev => prev.map(r => r.id === registro.id ? { ...r, estado } : r));
    try {
      await api.put(`/setting/${registro.id}`, { estado });
      cargar();
    } catch {
      toast.error('Error al mover el estado');
      cargar();
    }
  };

  const handleDelete = async () => {
    try {
      await api.delete(`/setting/${confirmDelete.id}`);
      setRegistros(prev => prev.filter(r => r.id !== confirmDelete.id));
      toast.success('Registro eliminado');
    } catch {
      toast.error('Solo un admin superior puede eliminar');
    } finally {
      setConfirmDelete(null);
    }
  };

  if (loading) return <div className="ap-loading">Cargando…</div>;

  return (
    <div className="ap-section">
      <ToastContainer toasts={toasts} onRemove={remove} />
      {confirmDelete && <ConfirmDialog message={`¿Eliminar a "${confirmDelete.nombre}" de Setting?`} onConfirm={handleDelete} onCancel={() => setConfirmDelete(null)} />}
      {modal && <RegistroModal registro={modal === 'new' ? null : modal} empleados={empleados} onClose={() => setModal(null)} onSaved={handleSaved} toast={toast} />}

      <div className="ap-section-head">
        <div>
          <h1><Target size={20} style={{ verticalAlign:-3, marginRight:6 }}/>Setting</h1>
          <p>Embudo de cualificación y agenda — independiente de Leads.</p>
        </div>
        <button className="ap-btn ap-btn-primary" onClick={() => setModal('new')}><Plus size={15}/> Nuevo</button>
      </div>

      {metricas && (
        <div style={{ display:'flex', gap:'0.75rem', flexWrap:'wrap', marginBottom:'1.5rem' }}>
          {[
            ['Total', metricas.total],
            ['Activos', metricas.activos],
            ['Ventas', metricas.ventas],
            ['No responde', metricas.noResponde],
            ['No califica', metricas.noCalifica],
            ['Tasa de cierre', metricas.tasaCierre + '%'],
            ['Tasa de calificación', metricas.tasaCalificacion + '%'],
          ].map(([label, val]) => (
            <div key={label} style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:10, padding:'0.75rem 1rem', minWidth:110 }}>
              <div style={{ fontSize:'0.65rem', color:'rgba(255,255,255,0.4)', textTransform:'uppercase', letterSpacing:'0.06em' }}>{label}</div>
              <div style={{ fontSize:'1.3rem', fontWeight:700, color:'#fff' }}>{val}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display:'flex', gap:'0.75rem', overflowX:'auto', paddingBottom:'0.5rem' }}>
        {ORDEN.map(estado => {
          const items = registros.filter(r => r.estado === estado);
          const est = ESTADOS[estado];
          return (
            <div key={estado} style={{ flex:'0 0 260px', background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:12, padding:'0.75rem', display:'flex', flexDirection:'column', gap:'0.5rem' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <span style={{ fontSize:'0.75rem', fontWeight:700, color: est.color }}>{est.label}</span>
                <span style={{ fontSize:'0.68rem', color:'rgba(255,255,255,0.35)' }}>{items.length}</span>
              </div>
              {items.length === 0 && <p style={{ fontSize:'0.72rem', color:'rgba(255,255,255,0.25)', margin:0 }}>Vacío</p>}
              {items.map(r => (
                <div key={r.id} style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:8, padding:'0.6rem 0.7rem', display:'flex', flexDirection:'column', gap:4 }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:6 }}>
                    <strong style={{ fontSize:'0.8rem', color:'#fff' }}>{r.nombre}</strong>
                    <div style={{ display:'flex', gap:4, flexShrink:0 }}>
                      <button onClick={() => setModal(r)} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.35)', cursor:'pointer' }}><Pencil size={12}/></button>
                      <button onClick={() => setConfirmDelete(r)} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.35)', cursor:'pointer' }}><Trash2 size={12}/></button>
                    </div>
                  </div>
                  {r.canal && <span style={{ fontSize:'0.68rem', color:'rgba(255,255,255,0.4)' }}>{r.canal}</span>}
                  {r.empleado?.name && <span style={{ fontSize:'0.68rem', color:'rgba(255,255,255,0.3)' }}>→ {r.empleado.name}</span>}
                  <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginTop:4 }}>
                    {ORDEN.filter(e => e !== estado).map(e => (
                      <button key={e} onClick={() => cambiarEstado(r, e)}
                        style={{ fontSize:8, background:`${ESTADOS[e].color}15`, color:ESTADOS[e].color, border:`1px solid ${ESTADOS[e].color}40`, borderRadius:3, padding:'2px 4px', cursor:'pointer', fontFamily:'inherit' }}>
                        {ESTADOS[e].label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
