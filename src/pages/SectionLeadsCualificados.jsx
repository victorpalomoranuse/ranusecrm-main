import { useState, useEffect, useRef } from 'react';
import { Pencil, Trash2, Plus, X, CheckCircle, AlertCircle, GripVertical, Download, Save } from 'lucide-react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, rectSortingStrategy, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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

const CUAL_ESTADOS = {
  en_cualificacion:    { label: 'En cualificación',    color: '#f59e0b' },
  diseño_en_curso:     { label: 'Diseño en curso',     color: '#8b5cf6' },
  render_enviado:      { label: 'Render enviado',      color: '#06b6d4' },
  presupuesto_enviado: { label: 'Presupuesto enviado', color: '#3b82f6' },
  negociacion:         { label: 'En negociación',      color: '#f97316' },
  convertido:          { label: 'Convertido ✓',        color: '#beb0a2' },
  descartado:          { label: 'Descartado',          color: '#6b7280' },
};
const CUAL_ORDEN = ['en_cualificacion','diseño_en_curso','render_enviado','presupuesto_enviado','negociacion','convertido','descartado'];
const ESTETICAS = [
  { val:'organica', label:'🌿 Orgánica' },
  { val:'oscura_tech', label:'⚡ Oscura / Tech' },
  { val:'negro_premium', label:'🖤 Negro Premium' },
  { val:'mixta', label:'🎨 Mixta' },
];
const TIPOS_ESPACIO = ['Bajo cubierta','Garaje','Habitación / sótano','Parcela exterior','Obra nueva','Local','Otro'];
const EQUIPAMIENTO_OPTS = ['Fuerza completa','Cardio premium','Crossfit / funcional','Pádel interior','Mixto','Solo cardio','Otro'];
const DOC_TYPES = ['plano','contrato','factura','presupuesto','otro'];
const fmtEur = n => n ? `${Number(n).toLocaleString('es-ES')}€` : '—';

// ── Renders ───────────────────────────────────────────────────────────
function SortableRenderThumb({ r, onDelete, isFirst }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: r.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  return (
    <div ref={setNodeRef} style={style} className={`ap-render-thumb${isFirst?' ap-render-thumb--hero':''}`}>
      <img src={r.url} alt={r.name} />
      {isFirst && <span className="ap-render-hero-badge">Hero</span>}
      <button {...attributes} {...listeners} className="ap-render-drag-handle" type="button"><GripVertical size={12}/></button>
      <div className="ap-render-overlay">
        <span className="ap-render-name">{r.name}</span>
        {r.version && <span className="ap-render-ver">{r.version}</span>}
        <button className="ap-btn-icon ap-render-del" onClick={() => onDelete(r.id)}><Trash2 size={13}/></button>
      </div>
    </div>
  );
}

function TabRenders({ lcId }) {
  const [renders, setRenders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState('');
  const [version, setVersion] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => { api.get(`/leads-cualificados/${lcId}/renders`).then(r => setRenders(r.data.renders||[])).catch(()=>{}).finally(()=>setLoading(false)); }, [lcId]);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true); setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      if (name) form.append('name', name);
      if (version) form.append('version', version);
      const { data } = await api.post(`/leads-cualificados/${lcId}/renders`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setRenders(prev => [...prev, data.render]);
      setName(''); setVersion(''); fileRef.current.value = '';
    } catch (err) { setError(err.response?.data?.error || 'Error al subir render'); }
    setUploading(false);
  };

  const handleDelete = async (id) => {
    try { await api.delete(`/leads-cualificados/${lcId}/renders/${id}`); setRenders(prev => prev.filter(r => r.id !== id)); }
    catch { setError('Error al eliminar render'); }
  };

  const handleDragEnd = async (event) => {
    const { active, over } = event; if (!active || !over || active.id === over.id) return;
    const newRenders = arrayMove(renders, renders.findIndex(r => r.id === active.id), renders.findIndex(r => r.id === over.id));
    setRenders(newRenders);
    try { await api.put(`/leads-cualificados/${lcId}/renders/reorder`, { ids: newRenders.map(r => r.id) }); }
    catch { setError('Error al guardar el orden'); }
  };

  return (
    <div className="ap-tab-content">
      <div className="ap-upload-row">
        <input className="ap-field-input" value={name} onChange={e => setName(e.target.value)} placeholder="Nombre del render" />
        <input className="ap-field-input" value={version} onChange={e => setVersion(e.target.value)} placeholder="Versión (ej: v1)" />
        <label className="ap-btn ap-btn-primary ap-btn-sm ap-upload-label">
          {uploading ? 'Subiendo…' : <><Plus size={13}/> Subir render</>}
          <input ref={fileRef} type="file" accept="image/*" onChange={handleUpload} disabled={uploading} style={{ display:'none' }} />
        </label>
      </div>
      {error && <p className="ap-error">{error}</p>}
      {renders.length > 0 && <p className="ap-order-hint" style={{ marginBottom:'0.5rem' }}>El primero se muestra como portada. Arrastra para reordenar.</p>}
      {loading ? <div className="ap-loading">Cargando…</div> : renders.length === 0 ? <div className="ap-empty"><p>No hay renders todavía.</p></div> : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={renders.map(r => r.id)} strategy={rectSortingStrategy}>
            <div className="ap-renders-grid">{renders.map((r, i) => <SortableRenderThumb key={r.id} r={r} onDelete={handleDelete} isFirst={i === 0} />)}</div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

// ── Documentos ────────────────────────────────────────────────────────
function TabDocumentos({ lcId }) {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [docName, setDocName] = useState('');
  const [docType, setDocType] = useState('otro');
  const [error, setError] = useState('');
  const fileRef = useRef();

  useEffect(() => { api.get(`/leads-cualificados/${lcId}/documents`).then(r => setDocuments(r.data.documents||[])).catch(()=>{}).finally(()=>setLoading(false)); }, [lcId]);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true); setError('');
    try {
      const form = new FormData();
      form.append('file', file); form.append('name', docName || file.name); form.append('doc_type', docType);
      const { data } = await api.post(`/leads-cualificados/${lcId}/documents`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setDocuments(prev => [data.document, ...prev]); setDocName(''); fileRef.current.value = '';
    } catch (err) { setError(err.response?.data?.error || 'Error al subir documento'); }
    setUploading(false);
  };

  const handleDelete = async (id) => {
    try { await api.delete(`/leads-cualificados/${lcId}/documents/${id}`); setDocuments(prev => prev.filter(d => d.id !== id)); }
    catch { setError('Error al eliminar documento'); }
  };

  return (
    <div className="ap-tab-content">
      <div className="ap-upload-row">
        <input className="ap-field-input" value={docName} onChange={e => setDocName(e.target.value)} placeholder="Nombre del documento" />
        <select className="ap-select ap-select-sm" value={docType} onChange={e => setDocType(e.target.value)}>
          {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="ap-btn ap-btn-primary ap-btn-sm ap-upload-label">
          {uploading ? 'Subiendo…' : <><Plus size={13}/> Subir archivo</>}
          <input ref={fileRef} type="file" accept="image/*,application/pdf" onChange={handleUpload} disabled={uploading} style={{ display:'none' }} />
        </label>
      </div>
      {error && <p className="ap-error">{error}</p>}
      {loading ? <div className="ap-loading">Cargando…</div> : documents.length === 0 ? <div className="ap-empty"><p>No hay documentos todavía.</p></div> : (
        <div className="ap-doc-list">
          {documents.map(d => (
            <div key={d.id} className="ap-doc-row">
              <span className={`ap-doc-type ap-doc-type--${d.doc_type}`}>{d.doc_type}</span>
              <a href={d.url} target="_blank" rel="noopener noreferrer" className="ap-doc-name">{d.name}</a>
              <button className="ap-btn-icon" onClick={() => handleDelete(d.id)}><Trash2 size={13}/></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tours ─────────────────────────────────────────────────────────────
function TabTour({ lcId }) {
  const [tours, setTours] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState(''); const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null); const [editName, setEditName] = useState(''); const [editUrl, setEditUrl] = useState('');

  useEffect(() => { api.get(`/leads-cualificados/${lcId}/tours`).then(r => setTours(r.data.tours||[])).catch(()=>{}).finally(()=>setLoading(false)); }, [lcId]);

  const handleAdd = async () => {
    if (!name.trim() || !url.trim()) { setError('Nombre y URL son requeridos'); return; }
    setSaving(true); setError('');
    try { const { data } = await api.post(`/leads-cualificados/${lcId}/tours`, { name, url }); setTours(prev => [...prev, data.tour]); setName(''); setUrl(''); }
    catch (err) { setError(err.response?.data?.error || 'Error al añadir tour'); }
    setSaving(false);
  };

  const handleSaveEdit = async (id) => {
    setSaving(true);
    try { const { data } = await api.put(`/leads-cualificados/${lcId}/tours/${id}`, { name: editName, url: editUrl }); setTours(prev => prev.map(t => t.id === id ? data.tour : t)); setEditingId(null); }
    catch { setError('Error al actualizar tour'); }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    try { await api.delete(`/leads-cualificados/${lcId}/tours/${id}`); setTours(prev => prev.filter(t => t.id !== id)); }
    catch { setError('Error al eliminar tour'); }
  };

  if (loading) return <div className="ap-loading">Cargando…</div>;
  return (
    <div className="ap-tab-content">
      <p className="ap-tab-desc">Añade links de tours virtuales o Keypano.</p>
      <div className="ap-tour-add">
        <input className="ap-field-input" value={name} onChange={e => setName(e.target.value)} placeholder="Nombre del tour" />
        <input className="ap-field-input ap-tour-url-input" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." type="url" />
        <button className="ap-btn ap-btn-primary ap-btn-sm" onClick={handleAdd} disabled={saving}><Plus size={13}/> Añadir</button>
      </div>
      {error && <p className="ap-error" style={{ marginTop:'0.5rem' }}>{error}</p>}
      {tours.length === 0 ? <p className="ap-empty-sm">Sin tours añadidos todavía.</p> : (
        <div className="ap-tour-list">
          {tours.map(t => (
            <div key={t.id} className="ap-tour-item">
              {editingId === t.id ? (
                <><input className="ap-field-input" value={editName} onChange={e => setEditName(e.target.value)} /><input className="ap-field-input ap-tour-url-input" value={editUrl} onChange={e => setEditUrl(e.target.value)} type="url" /><button className="ap-btn ap-btn-primary ap-btn-sm" onClick={() => handleSaveEdit(t.id)} disabled={saving}>Guardar</button><button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => setEditingId(null)}>Cancelar</button></>
              ) : (
                <><div className="ap-tour-info"><span className="ap-tour-name">{t.name}</span><a className="ap-tour-url" href={t.url} target="_blank" rel="noopener noreferrer">{t.url}</a></div><div className="ap-tour-actions"><button className="ap-btn-icon" onClick={() => { setEditingId(t.id); setEditName(t.name); setEditUrl(t.url); }}><Pencil size={13}/></button><button className="ap-btn-icon" onClick={() => handleDelete(t.id)}><Trash2 size={13}/></button></div></>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Notas ─────────────────────────────────────────────────────────────
function TabNotas({ lcId }) {
  const [notes, setNotes] = useState([]); const [loading, setLoading] = useState(true);
  const [text, setText] = useState(''); const [saving, setSaving] = useState(false); const [error, setError] = useState('');

  useEffect(() => { api.get(`/leads-cualificados/${lcId}/notes`).then(r => setNotes(r.data.notes||[])).catch(()=>{}).finally(()=>setLoading(false)); }, [lcId]);

  const handleAdd = async () => {
    if (!text.trim()) return; setSaving(true); setError('');
    try { const { data } = await api.post(`/leads-cualificados/${lcId}/notes`, { content: text.trim() }); setNotes(prev => [data.note, ...prev]); setText(''); }
    catch { setError('Error al añadir nota'); }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    try { await api.delete(`/leads-cualificados/${lcId}/notes/${id}`); setNotes(prev => prev.filter(n => n.id !== id)); }
    catch { setError('Error al eliminar nota'); }
  };

  if (loading) return <div className="ap-loading">Cargando…</div>;
  return (
    <div className="ap-tab-content">
      <div className="ap-field"><label>Nueva nota</label><textarea className="ap-diag-textarea" value={text} onChange={e => setText(e.target.value)} rows={4} placeholder="Observaciones, seguimiento..." /></div>
      <div className="ap-diag-save-row">{error && <p className="ap-error" style={{ margin:0 }}>{error}</p>}<button className="ap-btn ap-btn-primary ap-btn-sm" onClick={handleAdd} disabled={saving || !text.trim()}>{saving ? 'Añadiendo…' : <><Plus size={13}/> Añadir nota</>}</button></div>
      {notes.length > 0 && <div className="ap-notes-list">{notes.map(n => (<div key={n.id} className="ap-note-item"><p className="ap-note-content">{n.content}</p><div className="ap-note-footer"><span className="ap-note-date">{new Date(n.created_at).toLocaleDateString('es-ES', { day:'2-digit', month:'short', year:'numeric' })}</span><button className="ap-btn-icon" onClick={() => handleDelete(n.id)}><Trash2 size={13}/></button></div></div>))}</div>}
      {notes.length === 0 && <p className="ap-empty-sm">Sin notas todavía.</p>}
    </div>
  );
}

// ── Ficha ─────────────────────────────────────────────────────────────
function TabFicha({ lead, onSaved }) {
  const [form, setForm] = useState(lead);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const guardar = async () => {
    setSaving(true); setError('');
    try { const { data } = await api.put(`/leads-cualificados/${lead.id}`, form); onSaved(data.lead); }
    catch { setError('Error al guardar'); }
    setSaving(false);
  };

  return (
    <div className="ap-tab-content">
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 16px' }}>
        <div className="ap-field"><label>Instagram</label><input className="ap-field-input" value={form.instagram||''} onChange={e => setF('instagram', e.target.value)} placeholder="@handle" /></div>
        <div className="ap-field"><label>Teléfono</label><input className="ap-field-input" value={form.telefono||''} onChange={e => setF('telefono', e.target.value)} /></div>
        <div className="ap-field"><label>Ciudad</label><input className="ap-field-input" value={form.ubicacion_ciudad||''} onChange={e => setF('ubicacion_ciudad', e.target.value)} placeholder="Madrid" /></div>
        <div className="ap-field"><label>Tipo de espacio</label>
          <select className="ap-select" value={form.tipo_espacio||''} onChange={e => setF('tipo_espacio', e.target.value)}>
            <option value="">— Seleccionar —</option>
            {TIPOS_ESPACIO.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="ap-field"><label>Metros²</label><input className="ap-field-input" type="number" value={form.metros_cuadrados||''} onChange={e => setF('metros_cuadrados', e.target.value)} /></div>
        <div className="ap-field"><label>Inversión mín. (€)</label><input className="ap-field-input" type="number" value={form.inversion_min||''} onChange={e => setF('inversion_min', e.target.value)} /></div>
        <div className="ap-field"><label>Inversión máx. (€)</label><input className="ap-field-input" type="number" value={form.inversion_max||''} onChange={e => setF('inversion_max', e.target.value)} /></div>
        <div className="ap-field"><label>Urgencia</label>
          <select className="ap-select" value={form.urgencia||'normal'} onChange={e => setF('urgencia', e.target.value)}>
            <option value="urgente">🔴 Urgente</option>
            <option value="normal">🟡 Normal</option>
            <option value="flexible">🟢 Flexible</option>
          </select>
        </div>
        <div className="ap-field"><label>Inicio previsto</label><input className="ap-field-input" type="date" value={form.fecha_inicio_prevista?.slice(0,10)||''} onChange={e => setF('fecha_inicio_prevista', e.target.value)} /></div>
        <div className="ap-field"><label>Entrega prevista</label><input className="ap-field-input" type="date" value={form.fecha_entrega_prevista?.slice(0,10)||''} onChange={e => setF('fecha_entrega_prevista', e.target.value)} /></div>
      </div>
      <div className="ap-field">
        <label>Estética</label>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
          {ESTETICAS.map(e => (
            <button key={e.val} type="button" onClick={() => setF('estetica', e.val)}
              style={{ background: form.estetica===e.val ? 'rgba(190,176,162,0.15)' : 'rgba(255,255,255,0.03)', border:`1px solid ${form.estetica===e.val ? '#beb0a2' : 'rgba(255,255,255,0.1)'}`, borderRadius:8, padding:'8px 12px', cursor:'pointer', color: form.estetica===e.val ? '#beb0a2' : 'rgba(255,255,255,0.4)', fontFamily:'inherit', fontSize:12, textAlign:'left' }}>
              {e.label}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 16px' }}>
        <div className="ap-field"><label>Equipamiento</label>
          <select className="ap-select" value={form.equipamiento_clave||''} onChange={e => setF('equipamiento_clave', e.target.value)}>
            <option value="">— Seleccionar —</option>
            {EQUIPAMIENTO_OPTS.map(eq => <option key={eq}>{eq}</option>)}
          </select>
        </div>
        <div className="ap-field"><label>Marcas preferidas</label><input className="ap-field-input" value={form.marcas_preferidas||''} onChange={e => setF('marcas_preferidas', e.target.value)} placeholder="Akon, Technogym..." /></div>
        <div className="ap-field"><label>Personalización</label><input className="ap-field-input" value={form.personalizado||''} onChange={e => setF('personalizado', e.target.value)} placeholder="Logo, colores equipo..." /></div>
        <div className="ap-field"><label>Nº Presupuesto</label><input className="ap-field-input" value={form.id_presupuesto||''} onChange={e => setF('id_presupuesto', e.target.value)} placeholder="RAN-042" /></div>
        <div className="ap-field"><label>Link presupuesto</label><input className="ap-field-input" value={form.link_presupuesto||''} onChange={e => setF('link_presupuesto', e.target.value)} placeholder="https://..." /></div>
        <div className="ap-field"><label>Link moodboard</label><input className="ap-field-input" value={form.link_moodboard||''} onChange={e => setF('link_moodboard', e.target.value)} placeholder="https://..." /></div>
      </div>
      <div style={{ display:'flex', gap:16, margin:'8px 0' }}>
        <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, color:'rgba(255,255,255,0.6)' }}><input type="checkbox" checked={!!form.necesita_duchas} onChange={e => setF('necesita_duchas', e.target.checked)} /> Duchas / aseo</label>
        <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, color:'rgba(255,255,255,0.6)' }}><input type="checkbox" checked={!!form.necesita_sauna} onChange={e => setF('necesita_sauna', e.target.checked)} /> Sauna</label>
        <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, color:'rgba(255,255,255,0.6)' }}><input type="checkbox" checked={!!form.presupuesto_confirmado} onChange={e => setF('presupuesto_confirmado', e.target.checked)} /> Presupuesto confirmado</label>
      </div>
      <div className="ap-field"><label>Otras necesidades</label><textarea className="ap-field-input" value={form.otras_necesidades||''} onChange={e => setF('otras_necesidades', e.target.value)} rows={2} placeholder="TV, sonido, zona estiramiento..." /></div>
      <div className="ap-field"><label>Notas internas</label><textarea className="ap-field-input" value={form.notas_internas||''} onChange={e => setF('notas_internas', e.target.value)} rows={3} placeholder="Contexto, observaciones..." /></div>
      {error && <p className="ap-error">{error}</p>}
      <button className="ap-btn ap-btn-primary ap-btn-sm" onClick={guardar} disabled={saving} style={{ marginTop:8 }}>{saving ? 'Guardando…' : <><Save size={12}/> Guardar ficha</>}</button>
    </div>
  );
}

// ── Catálogo (igual que proyectos) ────────────────────────────────────
function SortableAssignedItem({ item, onUnassign, onUpdate, type }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  const [expanded, setExpanded] = useState(false);
  const [qty, setQty] = useState(item.quantity ?? 1);
  const [ytUrl, setYtUrl] = useState(item.youtube_url || '');
  const [extraImgs, setExtraImgs] = useState(item.extra_images || []);
  const [newImg, setNewImg] = useState('');
  const [saving, setSaving] = useState(false);
  const isMob = type === 'mobiliario';

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/leads-cualificados/${item.lc_id}/equipment/${item.id}`, { quantity: qty, youtube_url: ytUrl || null, extra_images: extraImgs });
      onUpdate({ ...item, quantity: qty, youtube_url: ytUrl || null, extra_images: extraImgs });
      setExpanded(false);
    } catch {}
    setSaving(false);
  };

  const addImg = () => { const url = newImg.trim(); if (!url || extraImgs.includes(url)) return; setExtraImgs(prev => [...prev, url]); setNewImg(''); };
  const removeImg = (url) => setExtraImgs(prev => prev.filter(u => u !== url));

  return (
    <div ref={setNodeRef} style={style} className="ap-catalog-product ap-catalog-product--expand">
      <button {...attributes} {...listeners} style={{ background:'none', border:'none', cursor:'grab', color:'rgba(255,255,255,0.3)', padding:'0 4px', flexShrink:0, display:'flex', alignItems:'center' }} type="button"><GripVertical size={13}/></button>
      {item.image_url && <img src={item.image_url} alt={item.name} className="ap-catalog-product-img" />}
      <div className="ap-catalog-product-info" style={{ flex:1 }}>
        <span className="ap-catalog-product-name">{item.name}</span>
        {item.category && <span className="ap-cat-meta">{item.category}</span>}
        {isMob && <span className="ap-cat-meta" style={{ color:'rgba(190,176,162,0.7)', marginLeft:4 }}>×{qty}{item.youtube_url && ' · 🎬'}{item.extra_images?.length > 0 && ` · ${item.extra_images.length} img`}</span>}
      </div>
      {isMob && <button className="ap-btn ap-btn-ghost ap-btn-sm" style={{ flexShrink:0, fontSize:'0.72rem' }} onClick={() => setExpanded(v => !v)} type="button"><Pencil size={11}/> {expanded ? 'Cerrar' : 'Detalle'}</button>}
      <button className="ap-btn-icon" onClick={() => onUnassign(item.id, type)}><X size={13}/></button>
      {expanded && isMob && (
        <div className="ap-eq-detail-panel">
          <div className="ap-field" style={{ marginBottom:'0.75rem' }}>
            <label style={{ fontSize:'0.7rem', color:'rgba(255,255,255,0.4)', marginBottom:'0.3rem', display:'block' }}>Cantidad</label>
            <div style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}>
              <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => setQty(q => Math.max(1, q-1))}>−</button>
              <input type="number" min="1" className="ap-field-input" style={{ width:60, textAlign:'center' }} value={qty} onChange={e => setQty(Math.max(1, parseInt(e.target.value)||1))} />
              <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => setQty(q => q+1)}>+</button>
            </div>
          </div>
          <div className="ap-field" style={{ marginBottom:'0.75rem' }}>
            <label style={{ fontSize:'0.7rem', color:'rgba(255,255,255,0.4)', marginBottom:'0.3rem', display:'block' }}>Vídeo YouTube (URL)</label>
            <input className="ap-field-input" value={ytUrl} onChange={e => setYtUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." />
          </div>
          <div className="ap-field" style={{ marginBottom:'0.75rem' }}>
            <label style={{ fontSize:'0.7rem', color:'rgba(255,255,255,0.4)', marginBottom:'0.3rem', display:'block' }}>Imágenes adicionales (URLs)</label>
            {extraImgs.length > 0 && (
              <div style={{ display:'flex', flexWrap:'wrap', gap:'0.4rem', marginBottom:'0.5rem' }}>
                {extraImgs.map(url => (
                  <div key={url} style={{ position:'relative', width:52, height:52 }}>
                    <img src={url} alt="" style={{ width:'100%', height:'100%', objectFit:'cover', borderRadius:6, border:'1px solid rgba(255,255,255,0.1)' }} />
                    <button type="button" onClick={() => removeImg(url)} style={{ position:'absolute', top:-5, right:-5, background:'#1a1a1a', border:'1px solid rgba(255,255,255,0.15)', borderRadius:'50%', width:16, height:16, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', padding:0, color:'rgba(255,255,255,0.6)' }}><X size={9}/></button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display:'flex', gap:'0.4rem' }}>
              <input className="ap-field-input" value={newImg} onChange={e => setNewImg(e.target.value)} placeholder="https://..." onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addImg())} />
              <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={addImg}><Plus size={12}/> Añadir</button>
            </div>
          </div>
          <button type="button" className="ap-btn ap-btn-primary ap-btn-sm" onClick={handleSave} disabled={saving} style={{ width:'100%' }}>{saving ? 'Guardando…' : <><Save size={12}/> Guardar cambios</>}</button>
        </div>
      )}
    </div>
  );
}

function TabCatalogo({ lcId }) {
  const [tab, setTab] = useState('material');
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [assigned, setAssigned] = useState({ materials: [], equipment: [] });
  const [loading, setLoading] = useState(true);
  const [expandedCat, setExpandedCat] = useState(null);
  const { toast } = useToast();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    Promise.all([
      api.get('/catalog/categories'),
      api.get('/catalog/products'),
      api.get(`/leads-cualificados/${lcId}/materials`),
      api.get(`/leads-cualificados/${lcId}/equipment`),
    ]).then(([cats, prods, mats, equip]) => {
      setCategories(cats.data.categories || []);
      setProducts(prods.data.products || []);
      setAssigned({ materials: mats.data.materials || [], equipment: equip.data.equipment || [] });
    }).catch(() => {}).finally(() => setLoading(false));
  }, [lcId]);

  const isAssigned = (productId, type) => {
    const list = type === 'material' ? assigned.materials : assigned.equipment;
    return list.some(a => a.catalog_product_id === productId);
  };

  const handleAssignedDragEnd = async (event) => {
    const { active, over } = event;
    if (!active || !over || active.id === over.id) return;
    const isMat = tab === 'material';
    const list = isMat ? assigned.materials : assigned.equipment;
    const newList = arrayMove(list, list.findIndex(a => a.id === active.id), list.findIndex(a => a.id === over.id));
    setAssigned(prev => isMat ? { ...prev, materials: newList } : { ...prev, equipment: newList });
    const endpoint = isMat ? `/leads-cualificados/${lcId}/materials/reorder` : `/leads-cualificados/${lcId}/equipment/reorder`;
    try { await api.put(endpoint, { ids: newList.map(a => a.id) }); }
    catch { toast.error('Error al guardar el orden'); }
  };

  const assign = async (product) => {
    const isMat = product.category?.type === 'material';
    const type = isMat ? 'material' : 'mobiliario';
    if (isAssigned(product.id, type)) { toast.error(`"${product.name}" ya está asignado`); return; }
    const endpoint = isMat ? `/leads-cualificados/${lcId}/materials` : `/leads-cualificados/${lcId}/equipment`;
    try {
      const payload = isMat
        ? { name: product.name, category: product.category?.name, catalog_product_id: product.id, image_url: product.photo_url || null }
        : { name: product.name, category: product.category?.name, catalog_product_id: product.id, quantity: 1, image_url: product.photo_url || null };
      const { data } = await api.post(endpoint, payload);
      setAssigned(prev => isMat
        ? { ...prev, materials: [data.material, ...prev.materials] }
        : { ...prev, equipment: [data.equipment, ...prev.equipment] }
      );
      toast.success(`"${product.name}" añadido`);
    } catch { toast.error('Error al asignar producto'); }
  };

  const unassign = async (id, type) => {
    const isMat = type === 'material';
    const endpoint = isMat ? `/leads-cualificados/${lcId}/materials/${id}` : `/leads-cualificados/${lcId}/equipment/${id}`;
    try {
      await api.delete(endpoint);
      setAssigned(prev => isMat
        ? { ...prev, materials: prev.materials.filter(m => m.id !== id) }
        : { ...prev, equipment: prev.equipment.filter(e => e.id !== id) }
      );
    } catch { toast.error('Error al quitar producto'); }
  };

  const handleItemUpdate = (updatedItem) => {
    setAssigned(prev => ({ ...prev, equipment: prev.equipment.map(e => e.id === updatedItem.id ? updatedItem : e) }));
    toast.success('Detalles guardados');
  };

  if (loading) return <div className="ap-loading">Cargando…</div>;

  const filteredCats = categories.filter(c => c.type === tab);
  const assignedList = tab === 'material' ? assigned.materials : assigned.equipment;

  return (
    <div className="ap-tab-content">
      <div className="ap-cat-tabs" style={{ marginBottom:'1.25rem' }}>
        <button className={`ap-cat-tab${tab === 'material' ? ' active' : ''}`} onClick={() => setTab('material')}>Materiales</button>
        <button className={`ap-cat-tab${tab === 'mobiliario' ? ' active' : ''}`} onClick={() => setTab('mobiliario')}>Mobiliario</button>
      </div>

      {assignedList.length > 0 && (
        <div style={{ marginBottom:'1.25rem' }}>
          <p style={{ fontSize:'0.7rem', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.08em', color:'rgba(255,255,255,0.3)', marginBottom:'0.5rem' }}>Asignados a esta ficha</p>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleAssignedDragEnd}>
            <SortableContext items={assignedList.map(a => a.id)} strategy={verticalListSortingStrategy}>
              <div className="ap-catalog-products" style={{ padding:0 }}>
                {assignedList.map(a => (
                  <SortableAssignedItem key={a.id} item={{ ...a, lc_id: lcId }} type={tab === 'material' ? 'material' : 'mobiliario'} onUnassign={unassign} onUpdate={handleItemUpdate} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}

      <p style={{ fontSize:'0.7rem', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.08em', color:'rgba(255,255,255,0.3)', marginBottom:'0.75rem' }}>Tu catálogo</p>
      {filteredCats.length === 0 && <p className="ap-empty-sm">No hay categorías en el catálogo todavía.</p>}
      <div className="ap-catalog-categories">
        {filteredCats.map(cat => {
          const catProducts = products.filter(p => p.category_id === cat.id);
          const isOpen = expandedCat === cat.id;
          return (
            <div key={cat.id} className="ap-catalog-cat">
              <div className="ap-catalog-cat-header">
                <button className="ap-catalog-cat-toggle" onClick={() => setExpandedCat(isOpen ? null : cat.id)}>
                  <span className="ap-catalog-cat-arrow">{isOpen ? '▾' : '▸'}</span>
                  <span className="ap-catalog-cat-name">{cat.name}</span>
                  <span className="ap-catalog-cat-count">{catProducts.length}</span>
                </button>
              </div>
              {isOpen && (
                <div className="ap-catalog-products">
                  {catProducts.length === 0 && <p className="ap-empty-sm" style={{ paddingLeft:'1rem' }}>Sin productos.</p>}
                  {catProducts.map(p => {
                    const already = isAssigned(p.id, tab);
                    return (
                      <div key={p.id} className="ap-catalog-product">
                        {p.photo_url && <img src={p.photo_url} alt={p.name} className="ap-catalog-product-img" />}
                        <div className="ap-catalog-product-info">
                          <span className="ap-catalog-product-name">{p.name}</span>
                          {p.price != null && <span className="ap-catalog-product-price">{Number(p.price).toLocaleString('es-ES', { style:'currency', currency:'EUR' })}</span>}
                          {p.link && <a href={p.link} target="_blank" rel="noopener noreferrer" className="ap-catalog-product-link">Ver producto ↗</a>}
                        </div>
                        <button className={`ap-btn ap-btn-sm ${already ? 'ap-btn-ghost' : 'ap-btn-primary'}`} onClick={() => !already && assign(p)} disabled={already} style={{ flexShrink:0 }}>{already ? '✓' : <Plus size={13}/>}</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Modal gestor ──────────────────────────────────────────────────────
const MGR_TABS = [
  { id:'renders', label:'Renders' },
  { id:'documentos', label:'Documentos' },
  { id:'tours', label:'Tour 3D' },
  { id:'notas', label:'Notas' },
  { id:'catalogo', label:'Catálogo' },
  { id:'ficha', label:'Ficha' },
];

function LCManagerModal({ lead, onClose, onSaved, onDownloadPdf }) {
  const [tab, setTab] = useState('renders');

  return (
    <div className="ap-modal-overlay" onClick={onClose}>
      <div className="ap-mgr-modal" onClick={e => e.stopPropagation()}>
        <div className="ap-mgr-head">
          <div>
            <h2 className="ap-mgr-title">{lead.nombre}</h2>
            <p className="ap-mgr-sub">
              {lead.ubicacion_ciudad && `📍 ${lead.ubicacion_ciudad} · `}
              {(lead.inversion_min || lead.inversion_max) && `💰 ${fmtEur(lead.inversion_min)} – ${fmtEur(lead.inversion_max)}`}
            </p>
          </div>
          <div style={{ display:'flex', gap:'0.5rem', alignItems:'center' }}>
            <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={onDownloadPdf}>
              <Download size={13}/> PDF materiales
            </button>
            <button className="ap-modal-close" onClick={onClose}><X size={16}/></button>
          </div>
        </div>
        <div className="ap-mgr-tabs">
          {MGR_TABS.map(t => <button key={t.id} className={`ap-mgr-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>)}
        </div>
        <div className="ap-mgr-body">
          {tab === 'renders'    && <TabRenders lcId={lead.id} />}
          {tab === 'documentos' && <TabDocumentos lcId={lead.id} />}
          {tab === 'tours'      && <TabTour lcId={lead.id} />}
          {tab === 'notas'      && <TabNotas lcId={lead.id} />}
          {tab === 'catalogo'   && <TabCatalogo lcId={lead.id} />}
          {tab === 'ficha'      && <TabFicha lead={lead} onSaved={(updated) => { onSaved(updated); }} />}
        </div>
      </div>
    </div>
  );
}

// ── Sección principal ─────────────────────────────────────────────────
export function SectionLeadsCualificados({ onNavigate }) {
  const { toasts, toast, remove } = useToast();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [managing, setManaging] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [filtroEstado, setFiltroEstado] = useState('all');
  const [busqueda, setBusqueda] = useState('');

  const cargar = async () => {
    setLoading(true);
    try { const { data } = await api.get('/leads-cualificados'); setLeads(data.leads || []); }
    catch { toast.error('Error al cargar fichas'); }
    setLoading(false);
  };

  useEffect(() => { cargar(); }, []);

  const filtrados = leads.filter(l => {
    if (filtroEstado !== 'all' && l.estado !== filtroEstado) return false;
    if (busqueda && !l.nombre.toLowerCase().includes(busqueda.toLowerCase())) return false;
    return true;
  });

  const cambiarEstado = async (id, estado) => {
    try {
      const { data } = await api.put(`/leads-cualificados/${id}`, { estado });
      setLeads(prev => prev.map(l => l.id === id ? data.lead : l));
      if (managing?.id === id) setManaging(data.lead);
    } catch { toast.error('Error al cambiar estado'); }
  };

  const handleConvert = async (lead) => {
    if (!window.confirm(`¿Convertir "${lead.nombre}" en proyecto? Se creará automáticamente con todo su equipamiento y un presupuesto borrador.`)) return;
    try {
      const { data } = await api.post(`/leads-cualificados/${lead.id}/convert`);
      setLeads(prev => prev.map(l => l.id === lead.id ? data.lead : l));
      if (managing?.id === lead.id) setManaging(data.lead);
      const budgetMsg = data.budget ? ` · Presupuesto ${data.budget.budget_number} creado` : '';
      toast.success(`✅ Proyecto creado: ${data.project.client_name}${budgetMsg}`);
      if (onNavigate) {
        setTimeout(() => onNavigate('proyectos'), 1800);
      }
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Error al convertir lead');
    }
  };

  const eliminar = async (id) => {
    try {
      await api.delete(`/leads-cualificados/${id}`);
      setLeads(prev => prev.filter(l => l.id !== id));
      if (managing?.id === id) setManaging(null);
      toast.success('Ficha eliminada');
    } catch { toast.error('Error al eliminar'); }
    setConfirm(null);
  };

  const downloadPdf = async (lead) => {
    try {
      const base = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
      const token = localStorage.getItem('admin_token');
      const res = await fetch(`${base}/leads-cualificados/${lead.id}/pdf-materiales`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `materiales-${lead.nombre}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Error al generar PDF'); }
  };

  const prioColor = { alta:'#f87171', media:'#f59e0b', baja:'#6b7280' };

  return (
    <div className="ap-section">
      <ToastContainer toasts={toasts} onRemove={remove} />
      {confirm && <ConfirmDialog message={confirm.message} onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />}

      <div className="ap-section-head">
        <div>
          <h1>Leads Cualificados</h1>
          <p>Diseño y presupuesto — paso previo al proyecto</p>
        </div>
      </div>

      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:12 }}>
        <button className={`ap-catalog-pill${filtroEstado==='all'?' active':''}`} onClick={() => setFiltroEstado('all')}>Todos ({leads.length})</button>
        {CUAL_ORDEN.map(e => {
          const n = leads.filter(l => l.estado === e).length;
          if (!n) return null;
          return (
            <button key={e} className={`ap-catalog-pill${filtroEstado===e?' active':''}`} onClick={() => setFiltroEstado(filtroEstado===e?'all':e)}
              style={{ borderColor: filtroEstado===e ? CUAL_ESTADOS[e].color : undefined, color: filtroEstado===e ? CUAL_ESTADOS[e].color : undefined }}>
              {CUAL_ESTADOS[e].label} <span className="ap-catalog-pill-count">{n}</span>
            </button>
          );
        })}
      </div>

      <div style={{ marginBottom:16 }}>
        <input placeholder="Buscar cliente..." value={busqueda} onChange={e => setBusqueda(e.target.value)} className="ap-field-input" style={{ maxWidth:260 }} />
      </div>

      {loading ? <div className="ap-loading">Cargando fichas…</div> : filtrados.length === 0 ? (
        <div className="ap-empty"><p>No hay fichas todavía. Se crean automáticamente cuando un lead pasa a estado "Diseño".</p></div>
      ) : (
        <div className="ap-cp-grid">
          {filtrados.map(lead => {
            const est = CUAL_ESTADOS[lead.estado];
            return (
              <div key={lead.id} className="ap-cp-card">
                <div className="ap-cp-header">
                  <div className="ap-cp-names">
                    <h3 className="ap-cp-client">{lead.nombre}</h3>
                    {lead.instagram && <p className="ap-cp-name">@{lead.instagram}</p>}
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    {lead.prioridad && <span style={{ width:8, height:8, borderRadius:'50%', background:prioColor[lead.prioridad]||'#6b7280', display:'inline-block' }} />}
                    <span style={{ background:`${est.color}20`, color:est.color, fontSize:10, fontWeight:700, padding:'3px 8px', borderRadius:5 }}>{est.label}</span>
                  </div>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'3px 10px', marginTop:8, fontSize:11, color:'rgba(255,255,255,0.4)' }}>
                  {lead.ubicacion_ciudad && <span>📍 {lead.ubicacion_ciudad}{lead.metros_cuadrados ? ` · ${lead.metros_cuadrados}m²` : ''}</span>}
                  {lead.tipo_espacio && <span>🏠 {lead.tipo_espacio}</span>}
                  {(lead.inversion_min||lead.inversion_max) && <span>💰 {fmtEur(lead.inversion_min)} – {fmtEur(lead.inversion_max)}</span>}
                  {lead.estetica && <span>🎨 {ESTETICAS.find(e=>e.val===lead.estetica)?.label||lead.estetica}</span>}
                </div>
                {lead.id_presupuesto && <div style={{ marginTop:8 }}><span style={{ fontSize:11, color:'#beb0a2', background:'rgba(190,176,162,0.1)', padding:'2px 8px', borderRadius:4 }}>{lead.id_presupuesto}</span></div>}
                <div className="ap-project-actions" style={{ marginTop:10 }}>
                  <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => setManaging(lead)}><Pencil size={13}/> Gestionar</button>
                  {lead.estado !== 'convertido' && <button className="ap-btn ap-btn-primary ap-btn-sm" onClick={() => handleConvert(lead)}>✅ Convertir</button>}
                  {lead.estado === 'convertido' && onNavigate && (
                    <>
                      <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => onNavigate('proyectos')} style={{ color:'#beb0a2', borderColor:'rgba(190,176,162,0.3)' }}>📁 Ver proyecto</button>
                      <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => onNavigate('presupuestos')} style={{ color:'#8b9eae', borderColor:'rgba(139,158,174,0.3)' }}>📄 Ver presupuesto</button>
                    </>
                  )}
                  <button className="ap-btn ap-btn-danger ap-btn-sm" onClick={() => setConfirm({ message:`¿Eliminar la ficha de ${lead.nombre}?`, onConfirm:()=>eliminar(lead.id) })}><Trash2 size={13}/></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {managing && (
        <LCManagerModal
          lead={managing}
          onClose={() => setManaging(null)}
          onDownloadPdf={() => downloadPdf(managing)}
          onSaved={(updated) => {
            setLeads(prev => prev.map(l => l.id === updated.id ? updated : l));
            setManaging(updated);
            toast.success('Ficha guardada');
          }}
        />
      )}
    </div>
  );
}
