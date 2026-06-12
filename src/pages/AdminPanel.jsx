import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdminAuth } from '../auth/AdminAuthContext';
import api from '../services/api';
import { LayoutGrid, Users, UserCheck, LogOut, ChevronUp, ChevronDown, Pencil, Trash2, Plus, Star, X, CheckCircle, AlertCircle, FolderOpen, Copy, RefreshCw, Settings, BookOpen, ShoppingCart, Eye, EyeOff, Bookmark, Phone, Download, ExternalLink, Image, GripVertical, BarChart2, Calculator, Save } from 'lucide-react';
import { SectionPresupuestos } from './SectionPresupuestos';
import { SectionTareas } from './SectionTareas';
import { SectionAjustes } from './SectionAjustes';
import { SectionDashboard } from './SectionDashboard';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, rectSortingStrategy, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import './AdminPanel.css';

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

function useToast() {
  const [toasts, setToasts] = useState([]);
  const add = useCallback((message, type = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);
  const remove = useCallback(id => setToasts(prev => prev.filter(t => t.id !== id)), []);
  return { toasts, toast: { success: m => add(m, 'success'), error: m => add(m, 'error') }, remove };
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

function Pagination({ page, total, pageSize, onPage }) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;
  return (
    <div className="ap-pagination">
      <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => onPage(page - 1)} disabled={page === 1}>← Anterior</button>
      <span className="ap-pagination-info">{page} / {totalPages}</span>
      <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => onPage(page + 1)} disabled={page === totalPages}>Siguiente →</button>
    </div>
  );
}

const PHASE_LABELS = { 1: 'Diagnóstico y mediciones', 2: 'Prediseño', 3: 'Diseño detallado', 4: 'Compras y coordinación', 5: 'Dirección de obra' };
const URGENCY_OPTIONS = ['baja', 'normal', 'alta', 'urgente'];

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function ClientProjectModal({ project, onClose, onSaved }) {
  const isEdit = !!project;
  const [clientName, setClientName] = useState(project?.client_name || '');
  const [projectName, setProjectName] = useState(project?.project_name || '');
  const [clientEmail, setClientEmail] = useState(project?.client_email || '');
  const [accessCode, setAccessCode] = useState(project?.access_code || generateCode());
  const [phase, setPhase] = useState(project?.phase || 1);
  const [urgency, setUrgency] = useState(project?.urgency || 'normal');
  const [notes, setNotes] = useState(project?.notes || '');
  const [clientNif, setClientNif] = useState(project?.client_nif || '');
  const [clientPhone, setClientPhone] = useState(project?.client_phone || '');
  const [clientAddress, setClientAddress] = useState(project?.client_address || '');
  const [clientCity, setClientCity] = useState(project?.client_city || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [employees, setEmployees] = useState([]);
  const [responsibleId, setResponsibleId] = useState(project?.responsible?.id || project?.responsible_id || '');

  useEffect(() => { api.get('/employees').then(r => setEmployees(r.data.employees || [])).catch(() => {}); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const payload = { client_name: clientName, project_name: projectName, client_email: clientEmail || null, access_code: accessCode, phase, urgency, notes: notes || null, responsible_id: responsibleId || null, client_nif: clientNif || null, client_phone: clientPhone || null, client_address: clientAddress || null, client_city: clientCity || null };
      let saved;
      if (isEdit) { const { data } = await api.put(`/client-projects/${project.id}`, payload); saved = data.project; }
      else { const { data } = await api.post('/client-projects', payload); saved = data.project; }
      onSaved(saved);
    } catch (err) { setError(err.response?.data?.error || 'Error al guardar el proyecto'); } finally { setLoading(false); }
  };

  return (
    <div className="ap-modal-overlay" onClick={onClose}>
      <div className="ap-modal" onClick={e => e.stopPropagation()}>
        <div className="ap-modal-head"><h2>{isEdit ? 'Editar proyecto' : 'Nuevo proyecto'}</h2><button className="ap-modal-close" onClick={onClose}><X size={16} /></button></div>
        <form onSubmit={handleSubmit} className="ap-modal-form">
          <div className="ap-field"><label>Nombre del cliente *</label><input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Pedro García" required /></div>
          <div className="ap-field"><label>Nombre del proyecto *</label><input value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="Home gym residencia Madrid" required /></div>
          <div className="ap-field"><label>Correo del cliente <span className="ap-optional">(opcional)</span></label><input type="email" value={clientEmail} onChange={e => setClientEmail(e.target.value)} placeholder="pedro@email.com" /></div>
          <div className="ap-field"><label>Teléfono del cliente <span className="ap-optional">(opcional)</span></label><input value={clientPhone} onChange={e => setClientPhone(e.target.value)} placeholder="+34 600 000 000" /></div>
          <div className="ap-field"><label>NIF / NIE <span className="ap-optional">(opcional)</span></label><input value={clientNif} onChange={e => setClientNif(e.target.value)} placeholder="12345678A" /></div>
          <div className="ap-field"><label>Dirección <span className="ap-optional">(opcional)</span></label><input value={clientAddress} onChange={e => setClientAddress(e.target.value)} placeholder="Calle Mayor 1, 2ºA" /></div>
          <div className="ap-field"><label>Ciudad <span className="ap-optional">(opcional)</span></label><input value={clientCity} onChange={e => setClientCity(e.target.value)} placeholder="Madrid, 28001" /></div>
          <div className="ap-field">
            <label>Código de acceso *</label>
            <div className="ap-code-input-row">
              <input value={accessCode} onChange={e => !isEdit && setAccessCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,12))} placeholder="XXXXXXXX" required readOnly={isEdit} className="ap-code-input" />
              {!isEdit && <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => setAccessCode(generateCode())}><RefreshCw size={13}/> Regenerar</button>}
            </div>
            {!isEdit && <span className="ap-field-hint">El cliente usará este código para acceder a su proyecto.</span>}
          </div>
          <div className="ap-field">
            <label>Fase</label>
            <div className="ap-phase-selector">{[1,2,3,4,5].map(n => <button key={n} type="button" className={`ap-phase-btn${phase===n?' active':''}`} onClick={() => setPhase(n)}>{n} · {PHASE_LABELS[n]}</button>)}</div>
          </div>
          <div className="ap-field">
            <label>Urgencia</label>
            <div className="ap-urgency-selector">{URGENCY_OPTIONS.map(u => <button key={u} type="button" className={`ap-urgency-btn ap-urgency--${u}${urgency===u?' active':''}`} onClick={() => setUrgency(u)}>{u}</button>)}</div>
          </div>
          <div className="ap-field">
            <label>Responsable <span className="ap-optional">(opcional)</span></label>
            <select value={responsibleId} onChange={e => setResponsibleId(e.target.value)} className="ap-select">
              <option value="">Sin asignar</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name} — {e.email}</option>)}
            </select>
          </div>
          <div className="ap-field"><label>Notas internas <span className="ap-optional">(opcional)</span></label><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Notas sobre el proyecto..." /></div>
          {error && <p className="ap-error">{error}</p>}
          <div className="ap-modal-actions">
            <button type="button" className="ap-btn ap-btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" className="ap-btn ap-btn-primary" disabled={loading}>{loading ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear proyecto'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function slugify(text) {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s-]/g,'').trim().replace(/\s+/g,'-');
}

function ProjectModal({ project, onClose, onSaved }) {
  const isEdit = !!project;
  const [title, setTitle] = useState(project?.title || '');
  const [slug, setSlug] = useState(project?.slug || '');
  const [description, setDescription] = useState(project?.description || '');
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState(project?.images || []);
  const [coverUrl, setCoverUrl] = useState(project?.cover_url || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef();

  const handleTitleChange = (e) => { setTitle(e.target.value); if (!isEdit) setSlug(slugify(e.target.value)); };
  const handleFiles = (e) => { const newFiles = Array.from(e.target.files); setFiles(prev => [...prev, ...newFiles]); setPreviews(prev => [...prev, ...newFiles.map(f => URL.createObjectURL(f))]); };
  const removeNewFile = (index) => { const existingCount = isEdit ? (project.images?.length || 0) : 0; const fileIndex = index - existingCount; if (fileIndex >= 0) setFiles(prev => prev.filter((_,i) => i !== fileIndex)); setPreviews(prev => prev.filter((_,i) => i !== index)); };
  const deleteExistingImage = async (imgUrl) => {
    try { await api.delete(`/portfolio/${project.id}/images`, { data: { imageUrl: imgUrl } }); setPreviews(prev => prev.filter(u => u !== imgUrl)); if (coverUrl === imgUrl) { const next = previews.find(u => u !== imgUrl && !u.startsWith('blob:')); setCoverUrl(next || null); } } catch { setError('Error al eliminar la imagen'); }
  };
  const handleSubmit = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      if (isEdit) {
        const safeCover = coverUrl && !coverUrl.startsWith('blob:') ? coverUrl : null;
        await api.put(`/portfolio/${project.id}`, { title, slug, description, cover_url: safeCover });
        if (files.length > 0) { const form = new FormData(); files.forEach(f => form.append('images', f)); await api.post(`/portfolio/${project.id}/images`, form, { headers: { 'Content-Type': 'multipart/form-data' } }); }
      } else {
        const form = new FormData(); form.append('title', title); form.append('slug', slug); form.append('description', description); files.forEach(f => form.append('images', f));
        await api.post('/portfolio', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      onSaved();
    } catch (err) { setError(err.response?.data?.error || 'Error al guardar el proyecto'); } finally { setLoading(false); }
  };

  return (
    <div className="ap-modal-overlay" onClick={onClose}>
      <div className="ap-modal" onClick={e => e.stopPropagation()}>
        <div className="ap-modal-head"><h2>{isEdit ? 'Editar proyecto' : 'Nuevo proyecto'}</h2><button className="ap-modal-close" onClick={onClose}><X size={16} /></button></div>
        <form onSubmit={handleSubmit} className="ap-modal-form">
          <div className="ap-field"><label>Título *</label><input value={title} onChange={handleTitleChange} placeholder="F11 · Centro de Fútbol" required /></div>
          <div className="ap-field"><label>Slug (URL) *</label><input value={slug} onChange={e => setSlug(e.target.value)} placeholder="f11-futbol" required /><span className="ap-field-hint">/proyecto/{slug || '...'}</span></div>
          <div className="ap-field"><label>Descripción</label><textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Descripción breve del proyecto..." /></div>
          <div className="ap-field">
            <label>Imágenes</label>
            <div className="ap-images-grid">
              {previews.map((src, i) => (
                <div key={i} className={`ap-img-thumb ${coverUrl === src ? 'is-cover' : ''}`}>
                  <img src={src} alt={`img ${i}`} />
                  <div className="ap-img-actions">
                    {isEdit && project.images?.includes(src) ? (<><button type="button" onClick={() => setCoverUrl(src)}><Star size={13}/></button><button type="button" onClick={() => deleteExistingImage(src)}><X size={13}/></button></>) : (<button type="button" onClick={() => removeNewFile(i)}><X size={13}/></button>)}
                  </div>
                  {coverUrl === src && <span className="ap-cover-badge">Portada</span>}
                </div>
              ))}
              <button type="button" className="ap-add-img" onClick={() => fileInputRef.current.click()}><Plus size={18}/><span>Añadir</span></button>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFiles} style={{display:'none'}} />
          </div>
          {error && <p className="ap-error">{error}</p>}
          <div className="ap-modal-actions"><button type="button" className="ap-btn ap-btn-ghost" onClick={onClose}>Cancelar</button><button type="submit" className="ap-btn ap-btn-primary" disabled={loading}>{loading ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear proyecto'}</button></div>
        </form>
      </div>
    </div>
  );
}

const MGR_TABS = [{ id:'renders',label:'Renders'},{id:'documentos',label:'Documentos'},{id:'tours',label:'Tour 3D'},{id:'notas',label:'Notas'},{id:'catalogo',label:'Catálogo'}];
const DOC_TYPES = ['plano','contrato','factura','otro'];

function SortableRenderThumb({ r, onDelete, isFirst }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: r.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1, zIndex: isDragging ? 10 : undefined };
  return (
    <div ref={setNodeRef} style={style} className={`ap-render-thumb${isFirst?' ap-render-thumb--hero':''}`}>
      <img src={r.url} alt={r.name}/>
      {isFirst && <span className="ap-render-hero-badge">Hero</span>}
      <button {...attributes} {...listeners} className="ap-render-drag-handle" type="button"><GripVertical size={12}/></button>
      <div className="ap-render-overlay"><span className="ap-render-name">{r.name}</span>{r.version&&<span className="ap-render-ver">{r.version}</span>}<button className="ap-btn-icon ap-render-del" onClick={()=>onDelete(r.id)}><Trash2 size={13}/></button></div>
    </div>
  );
}

function TabRenders({ projectId }) {
  const [renders, setRenders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState('');
  const [version, setVersion] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => { api.get(`/client-projects/${projectId}/renders`).then(r=>setRenders(r.data.renders||[])).catch(()=>{}).finally(()=>setLoading(false)); },[projectId]);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]; if (!file) return; setUploading(true); setError('');
    try { const form = new FormData(); form.append('file',file); if(name) form.append('name',name); if(version) form.append('version',version); const {data} = await api.post(`/client-projects/${projectId}/renders`,form,{headers:{'Content-Type':'multipart/form-data'}}); setRenders(prev=>[...prev,data.render]); setName(''); setVersion(''); fileRef.current.value=''; } catch(err){setError(err.response?.data?.error||'Error al subir render');} finally{setUploading(false);}
  };
  const handleDelete = async (id) => { try{await api.delete(`/client-projects/${projectId}/renders/${id}`);setRenders(prev=>prev.filter(r=>r.id!==id));}catch{setError('Error al eliminar render');} };
  const handleDragEnd = async (event) => {
    const {active,over}=event; if(!active||!over||active.id===over.id) return;
    const oldIndex=renders.findIndex(r=>r.id===active.id); const newIndex=renders.findIndex(r=>r.id===over.id);
    const newRenders=arrayMove(renders,oldIndex,newIndex); setRenders(newRenders);
    try{await api.put(`/client-projects/${projectId}/renders/reorder`,{ids:newRenders.map(r=>r.id)});}catch{setError('Error al guardar el orden');}
  };

  return (
    <div className="ap-tab-content">
      <div className="ap-upload-row">
        <input className="ap-field-input" value={name} onChange={e=>setName(e.target.value)} placeholder="Nombre del render"/>
        <input className="ap-field-input" value={version} onChange={e=>setVersion(e.target.value)} placeholder="Versión (ej: v1)"/>
        <label className="ap-btn ap-btn-primary ap-btn-sm ap-upload-label">{uploading?'Subiendo…':<><Plus size={13}/> Subir imagen</>}<input ref={fileRef} type="file" accept="image/*" onChange={handleUpload} disabled={uploading} style={{display:'none'}}/></label>
      </div>
      {error && <p className="ap-error">{error}</p>}
      {renders.length>0&&<p className="ap-order-hint" style={{marginBottom:'0.5rem'}}>El primero se muestra como portada. Arrastra para reordenar.</p>}
      {loading?<div className="ap-loading">Cargando…</div>:renders.length===0?<div className="ap-empty"><p>No hay renders todavía.</p></div>:(
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={renders.map(r=>r.id)} strategy={rectSortingStrategy}>
            <div className="ap-renders-grid">{renders.map((r,i)=><SortableRenderThumb key={r.id} r={r} onDelete={handleDelete} isFirst={i===0}/>)}</div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

function TabDocumentos({ projectId }) {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [docName, setDocName] = useState('');
  const [docType, setDocType] = useState('otro');
  const [error, setError] = useState('');
  const fileRef = useRef();

  useEffect(()=>{api.get(`/client-projects/${projectId}/documents`).then(r=>setDocuments(r.data.documents||[])).catch(()=>{}).finally(()=>setLoading(false));},[projectId]);
  const handleUpload = async (e) => {
    const file=e.target.files?.[0]; if(!file) return; setUploading(true); setError('');
    try{const form=new FormData(); form.append('file',file); form.append('name',docName||file.name); form.append('doc_type',docType); const{data}=await api.post(`/client-projects/${projectId}/documents`,form,{headers:{'Content-Type':'multipart/form-data'}}); setDocuments(prev=>[data.document,...prev]); setDocName(''); fileRef.current.value='';}catch(err){setError(err.response?.data?.error||'Error al subir documento');}finally{setUploading(false);}
  };
  const handleDelete = async (id)=>{try{await api.delete(`/client-projects/${projectId}/documents/${id}`);setDocuments(prev=>prev.filter(d=>d.id!==id));}catch{setError('Error al eliminar documento');}};

  return (
    <div className="ap-tab-content">
      <div className="ap-upload-row">
        <input className="ap-field-input" value={docName} onChange={e=>setDocName(e.target.value)} placeholder="Nombre del documento"/>
        <select className="ap-select ap-select-sm" value={docType} onChange={e=>setDocType(e.target.value)}>{DOC_TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select>
        <label className="ap-btn ap-btn-primary ap-btn-sm ap-upload-label">{uploading?'Subiendo…':<><Plus size={13}/> Subir archivo</>}<input ref={fileRef} type="file" accept="image/*,application/pdf" onChange={handleUpload} disabled={uploading} style={{display:'none'}}/></label>
      </div>
      {error&&<p className="ap-error">{error}</p>}
      {loading?<div className="ap-loading">Cargando…</div>:documents.length===0?<div className="ap-empty"><p>No hay documentos todavía.</p></div>:(
        <div className="ap-doc-list">{documents.map(d=>(<div key={d.id} className="ap-doc-row"><span className={`ap-doc-type ap-doc-type--${d.doc_type}`}>{d.doc_type}</span><a href={d.url} target="_blank" rel="noopener noreferrer" className="ap-doc-name">{d.name}</a><button className="ap-btn-icon" onClick={()=>handleDelete(d.id)}><Trash2 size={13}/></button></div>))}</div>
      )}
    </div>
  );
}

function TabTour({ projectId }) {
  const [tours,setTours]=useState([]); const [loading,setLoading]=useState(true); const [name,setName]=useState(''); const [url,setUrl]=useState(''); const [saving,setSaving]=useState(false); const [error,setError]=useState(''); const [editingId,setEditingId]=useState(null); const [editName,setEditName]=useState(''); const [editUrl,setEditUrl]=useState('');
  useEffect(()=>{api.get(`/client-projects/${projectId}/tours`).then(r=>setTours(r.data.tours||[])).catch(()=>{}).finally(()=>setLoading(false));},[projectId]);
  const handleAdd=async()=>{if(!name.trim()||!url.trim()){setError('Nombre y URL son requeridos');return;}setSaving(true);setError('');try{const{data}=await api.post(`/client-projects/${projectId}/tours`,{name,url});setTours(prev=>[...prev,data.tour]);setName('');setUrl('');}catch(err){setError(err.response?.data?.error||'Error al añadir tour');}finally{setSaving(false);}};
  const handleSaveEdit=async(id)=>{setSaving(true);setError('');try{const{data}=await api.put(`/client-projects/${projectId}/tours/${id}`,{name:editName,url:editUrl});setTours(prev=>prev.map(t=>t.id===id?data.tour:t));setEditingId(null);}catch(err){setError(err.response?.data?.error||'Error al actualizar tour');}finally{setSaving(false);}};
  const handleDelete=async(id)=>{try{await api.delete(`/client-projects/${projectId}/tours/${id}`);setTours(prev=>prev.filter(t=>t.id!==id));}catch{setError('Error al eliminar tour');}};
  if(loading) return <div className="ap-loading">Cargando…</div>;
  return (
    <div className="ap-tab-content">
      <p className="ap-tab-desc">Añade links de muestras 3D interactivas.</p>
      <div className="ap-tour-add"><input className="ap-field-input" value={name} onChange={e=>setName(e.target.value)} placeholder="Nombre del tour"/><input className="ap-field-input ap-tour-url-input" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://..." type="url"/><button className="ap-btn ap-btn-primary ap-btn-sm" onClick={handleAdd} disabled={saving}><Plus size={13}/> Añadir</button></div>
      {error&&<p className="ap-error" style={{marginTop:'0.5rem'}}>{error}</p>}
      {tours.length===0?<p className="ap-empty-sm">Sin tours añadidos todavía.</p>:(
        <div className="ap-tour-list">{tours.map(t=>(<div key={t.id} className="ap-tour-item">{editingId===t.id?(<><input className="ap-field-input" value={editName} onChange={e=>setEditName(e.target.value)}/><input className="ap-field-input ap-tour-url-input" value={editUrl} onChange={e=>setEditUrl(e.target.value)} type="url"/><button className="ap-btn ap-btn-primary ap-btn-sm" onClick={()=>handleSaveEdit(t.id)} disabled={saving}>Guardar</button><button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={()=>setEditingId(null)}>Cancelar</button></>):(<><div className="ap-tour-info"><span className="ap-tour-name">{t.name}</span><a className="ap-tour-url" href={t.url} target="_blank" rel="noopener noreferrer">{t.url}</a></div><div className="ap-tour-actions"><button className="ap-btn-icon" onClick={()=>{setEditingId(t.id);setEditName(t.name);setEditUrl(t.url);}}><Pencil size={13}/></button><button className="ap-btn-icon" onClick={()=>handleDelete(t.id)}><Trash2 size={13}/></button></div></>)}</div>))}</div>
      )}
    </div>
  );
}

function TabNotas({ projectId }) {
  const [notes,setNotes]=useState([]); const [loading,setLoading]=useState(true); const [text,setText]=useState(''); const [saving,setSaving]=useState(false); const [error,setError]=useState('');
  useEffect(()=>{api.get(`/client-projects/${projectId}/notes`).then(r=>setNotes(r.data.notes||[])).catch(()=>{}).finally(()=>setLoading(false));},[projectId]);
  const handleAdd=async()=>{if(!text.trim()) return;setSaving(true);setError('');try{const{data}=await api.post(`/client-projects/${projectId}/notes`,{content:text.trim()});setNotes(prev=>[data.note,...prev]);setText('');}catch{setError('Error al añadir nota');}finally{setSaving(false);}};
  const handleDelete=async(id)=>{try{await api.delete(`/client-projects/${projectId}/notes/${id}`);setNotes(prev=>prev.filter(n=>n.id!==id));}catch{setError('Error al eliminar nota');}};
  if(loading) return <div className="ap-loading">Cargando…</div>;
  return (
    <div className="ap-tab-content">
      <div className="ap-field"><label>Nueva nota para el cliente</label><textarea className="ap-diag-textarea" value={text} onChange={e=>setText(e.target.value)} rows={4} placeholder="Escribe una nota…"/></div>
      <div className="ap-diag-save-row">{error&&<p className="ap-error" style={{margin:0}}>{error}</p>}<button className="ap-btn ap-btn-primary ap-btn-sm" onClick={handleAdd} disabled={saving||!text.trim()}>{saving?'Añadiendo…':<><Plus size={13}/> Añadir nota</>}</button></div>
      {notes.length>0&&(<div className="ap-notes-list">{notes.map(n=>(<div key={n.id} className="ap-note-item"><p className="ap-note-content">{n.content}</p><div className="ap-note-footer"><span className="ap-note-date">{new Date(n.created_at).toLocaleDateString('es-ES',{day:'2-digit',month:'short',year:'numeric'})}</span><button className="ap-btn-icon" onClick={()=>handleDelete(n.id)}><Trash2 size={13}/></button></div></div>))}</div>)}
      {notes.length===0&&<p className="ap-empty-sm">Sin notas todavía.</p>}
    </div>
  );
}

function ProductModal({ categories, product, onClose, onSaved }) {
  const isEdit = !!product;
  const [name,setName]=useState(product?.name||''); const [brand,setBrand]=useState(product?.brand||''); const [categoryId,setCategoryId]=useState(product?.category_id||categories[0]?.id||''); const [price,setPrice]=useState(product?.price!=null?String(product.price):''); const [link,setLink]=useState(product?.link||''); const [notes,setNotes]=useState(product?.notes||''); const [file,setFile]=useState(null); const [preview,setPreview]=useState(product?.photo_url||null); const [saving,setSaving]=useState(false); const [error,setError]=useState('');
  const inputId=useRef(`file-${Math.random()}`).current;
  useEffect(()=>{document.body.style.overflow='hidden';return()=>{document.body.style.overflow='';};},[]);
  const handleFile=(e)=>{const f=e.target.files?.[0];if(!f)return;setFile(f);setPreview(URL.createObjectURL(f));};
  const handleSubmit=async(e)=>{e.preventDefault();if(!name.trim()||!categoryId)return;setSaving(true);setError('');try{const form=new FormData();form.append('category_id',categoryId);form.append('name',name.trim());if(brand)form.append('brand',brand.trim());if(price)form.append('price',price);if(link)form.append('link',link.trim());if(notes)form.append('notes',notes.trim());if(file)form.append('file',file);let data;if(isEdit){({data}=await api.put(`/catalog/products/${product.id}`,form,{headers:{'Content-Type':'multipart/form-data'}}));}else{({data}=await api.post('/catalog/products',form,{headers:{'Content-Type':'multipart/form-data'}}));}onSaved(data.product);onClose();}catch{setError('Error al guardar producto');}finally{setSaving(false);}};
  return (
    <div className="ap-confirm-overlay" onClick={onClose}>
      <div className="ap-modal-inner" style={{maxWidth:420}} onClick={e=>e.stopPropagation()}>
        <div className="ap-modal-header"><h3>{isEdit?'Editar producto':'Nuevo producto'}</h3><button className="ap-modal-close" onClick={onClose}><X size={16}/></button></div>
        <form onSubmit={handleSubmit} className="ap-modal-body">
          <div className="ap-field"><label htmlFor={inputId}>Foto</label><label htmlFor={inputId} className="ap-photo-drop">{preview?<img src={preview} alt="preview" style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:8}}/>:<span style={{color:'rgba(255,255,255,0.3)',fontSize:'0.82rem'}}>Haz clic para subir imagen</span>}</label><input id={inputId} type="file" accept="image/*" onChange={handleFile} style={{display:'none'}}/></div>
          <div className="ap-field"><label>Nombre *</label><input className="ap-field-input" value={name} onChange={e=>setName(e.target.value)} placeholder="ej: Roble natural 20mm" required autoFocus/></div>
          <div className="ap-field"><label>Marca</label><input className="ap-field-input" value={brand} onChange={e=>setBrand(e.target.value)} placeholder="ej: Tarkett…"/></div>
          <div className="ap-field"><label>Categoría *</label><select className="ap-select" value={categoryId} onChange={e=>setCategoryId(e.target.value)} required><option value="">Seleccionar…</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div className="ap-field"><label>Precio (€)</label><input className="ap-field-input" type="number" step="0.01" min="0" value={price} onChange={e=>setPrice(e.target.value)} placeholder="0.00"/></div>
          <div className="ap-field"><label>Link del producto</label><input className="ap-field-input" value={link} onChange={e=>setLink(e.target.value)} placeholder="https://..."/></div>
          <div className="ap-field"><label>Notas</label><input className="ap-field-input" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Observaciones opcionales"/></div>
          {error&&<p className="ap-error" style={{margin:0}}>{error}</p>}
          <div className="ap-modal-footer"><button type="button" className="ap-btn ap-btn-ghost" onClick={onClose}>Cancelar</button><button type="submit" className="ap-btn ap-btn-primary" disabled={saving||!name.trim()||!categoryId}>{saving?'Guardando…':isEdit?'Guardar cambios':'Guardar producto'}</button></div>
        </form>
      </div>
    </div>
  );
}

function CartPanel({ cart, onRemove, onClear, onClose, toast }) {
  const [projects,setProjects]=useState([]); const [projectId,setProjectId]=useState(''); const [assignedIds,setAssignedIds]=useState(new Set()); const [loadingAssigned,setLoadingAssigned]=useState(false); const [assigning,setAssigning]=useState(false);
  useEffect(()=>{api.get('/client-projects').then(r=>{const list=r.data.projects||[];setProjects(list);if(list.length>0)setProjectId(list[0].id);}).catch(()=>{});},[]);
  useEffect(()=>{if(!projectId)return;setLoadingAssigned(true);Promise.all([api.get(`/client-projects/${projectId}/materials`),api.get(`/client-projects/${projectId}/equipment`)]).then(([mats,equip])=>{const ids=new Set([...(mats.data.materials||[]).map(m=>m.catalog_product_id).filter(Boolean),...(equip.data.equipment||[]).map(e=>e.catalog_product_id).filter(Boolean)]);setAssignedIds(ids);}).catch(()=>{}).finally(()=>setLoadingAssigned(false));},[projectId]);
  const duplicates=cart.filter(p=>assignedIds.has(p.id)); const hasDuplicates=duplicates.length>0;
  const handleAssign=async()=>{if(!projectId||hasDuplicates)return;setAssigning(true);let ok=0;let fail=0;for(const product of cart){const isMat=product.category?.type==='material';const endpoint=isMat?`/client-projects/${projectId}/materials`:`/client-projects/${projectId}/equipment`;const payload=isMat?{name:product.name,category:product.category?.name,catalog_product_id:product.id,image_url:product.photo_url||null}:{name:product.name,category:product.category?.name,catalog_product_id:product.id,quantity:1,image_url:product.photo_url||null};try{await api.post(endpoint,payload);ok++;}catch{fail++;}}setAssigning(false);if(ok>0){toast.success(`${ok} producto${ok>1?'s':''} asignado${ok>1?'s':''} al proyecto`);onClear();onClose();}if(fail>0)toast.error(`${fail} producto(s) no se pudieron asignar`);};
  return (
    <div className="ap-cart-overlay" onClick={onClose}>
      <div className="ap-cart-panel" onClick={e=>e.stopPropagation()}>
        <div className="ap-cart-header"><span className="ap-cart-title"><ShoppingCart size={16}/> Carrito ({cart.length})</span><button className="ap-btn-icon" onClick={onClose}><X size={15}/></button></div>
        <div className="ap-cart-items">{cart.map(p=>{const isDup=assignedIds.has(p.id);return(<div key={p.id} className={`ap-cart-item${isDup?' ap-cart-item--dup':''}`}>{p.photo_url?<img src={p.photo_url} alt={p.name} className="ap-cart-item-img"/>:<div className="ap-cart-item-img ap-cart-item-no-img"/>}<div className="ap-cart-item-info"><span className="ap-cart-item-name">{p.name}</span>{isDup?<span className="ap-cart-item-dup-tag">Ya asignado</span>:p.category&&<span className="ap-cart-item-cat">{p.category.name}</span>}</div><button className="ap-btn-icon" onClick={()=>onRemove(p.id)}><X size={12}/></button></div>);})}</div>
        <div className="ap-cart-footer">
          <label style={{fontSize:'0.72rem',color:'rgba(255,255,255,0.4)',marginBottom:'0.35rem',display:'block'}}>Asignar al proyecto</label>
          <select className="ap-select" value={projectId} onChange={e=>setProjectId(e.target.value)}>{projects.map(p=>(<option key={p.id} value={p.id}>{p.client_name} — {p.project_name}</option>))}</select>
          {hasDuplicates&&<p className="ap-cart-dup-warning">{duplicates.length} producto(s) ya están en este proyecto.</p>}
          <button className="ap-btn ap-btn-primary" style={{width:'100%',marginTop:'0.75rem'}} onClick={handleAssign} disabled={assigning||!projectId||hasDuplicates||loadingAssigned}>{assigning?'Asignando…':loadingAssigned?'Comprobando…':hasDuplicates?'Resuelve los duplicados':`Asignar ${cart.length} producto${cart.length>1?'s':''}`}</button>
          <button className="ap-btn ap-btn-ghost" style={{width:'100%',marginTop:'0.4rem',fontSize:'0.78rem'}} onClick={onClear}>Vaciar carrito</button>
        </div>
      </div>
    </div>
  );
}

function RendersLibrary() {
  const [renders,setRenders]=useState([]); const [loading,setLoading]=useState(true); const [filterProject,setFilterProject]=useState('all'); const [downloading,setDownloading]=useState(null); const [confirm,setConfirm]=useState(null);
  const {toast}=useToast();
  useEffect(()=>{api.get('/client-projects/all-renders').then(r=>setRenders(r.data.renders||[])).catch(()=>{}).finally(()=>setLoading(false));},[]);
  const projects=[...new Map(renders.map(r=>[r.project_id,r.project])).values()].filter(Boolean);
  const visible=filterProject==='all'?renders:renders.filter(r=>r.project_id===filterProject);
  const handleDownload=async(url,name)=>{setDownloading(url);try{const res=await fetch(url);const blob=await res.blob();const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name||'render';document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(a.href);}catch{}finally{setDownloading(null);}};
  const handleDeleteRender=(render)=>{setConfirm({message:`¿Eliminar el render "${render.name||'Sin nombre'}"?`,onConfirm:async()=>{try{await api.delete(`/client-projects/${render.project_id}/renders/${render.id}`);setRenders(prev=>prev.filter(r=>r.id!==render.id));toast.success('Render eliminado');}catch{toast.error('Error al eliminar el render');}setConfirm(null);},onCancel:()=>setConfirm(null)});};
  if(loading) return <div className="ap-loading">Cargando renders…</div>;
  if(renders.length===0) return <div className="ap-empty"><p>No hay renders subidos todavía.</p></div>;
  return (
    <div className="ap-renders-lib">
      {confirm&&<ConfirmDialog {...confirm}/>}
      <div className="ap-renders-lib-filters"><button className={`ap-catalog-pill${filterProject==='all'?' active':''}`} onClick={()=>setFilterProject('all')}>Todos ({renders.length})</button>{projects.map(p=>(<button key={p.id} className={`ap-catalog-pill${filterProject===p.id?' active':''}`} onClick={()=>setFilterProject(p.id)}>{p.client_name} — {p.project_name}<span className="ap-catalog-pill-count">{renders.filter(r=>r.project_id===p.id).length}</span></button>))}</div>
      <div className="ap-renders-lib-grid">{visible.map(r=>(<div key={r.id} className="ap-render-lib-card"><div className="ap-render-lib-img"><img src={r.url} alt={r.name}/><button className="ap-render-lib-dl" onClick={()=>handleDownload(r.url,r.name)} disabled={downloading===r.url}><Download size={14}/></button><button className="ap-render-lib-del" onClick={()=>handleDeleteRender(r)}><Trash2 size={14}/></button></div><div className="ap-render-lib-info"><span className="ap-render-lib-name">{r.name||'Sin nombre'}</span>{r.version&&<span className="ap-render-lib-ver">{r.version}</span>}<span className="ap-render-lib-project">{r.project?.client_name} — {r.project?.project_name}</span></div></div>))}</div>
    </div>
  );
}

function CatalogoLibrary() {
  const [tab,setTab]=useState('material'); const [activeCat,setActiveCat]=useState('all'); const [categories,setCategories]=useState([]); const [products,setProducts]=useState([]); const [loading,setLoading]=useState(true); const [newCatName,setNewCatName]=useState(''); const [addingCat,setAddingCat]=useState(false); const [showCatInput,setShowCatInput]=useState(false); const [showProductModal,setShowProductModal]=useState(false); const [editProduct,setEditProduct]=useState(null); const [confirm,setConfirm]=useState(null); const [cart,setCart]=useState([]); const [showCart,setShowCart]=useState(false);
  const {toast}=useToast();
  const sensors=useSensors(useSensor(PointerSensor,{activationConstraint:{distance:5}}));
  const addToCart=(product)=>setCart(prev=>prev.some(p=>p.id===product.id)?prev:[...prev,product]);
  const removeFromCart=(id)=>setCart(prev=>prev.filter(p=>p.id!==id));
  const clearCart=()=>setCart([]);
  useEffect(()=>{Promise.all([api.get('/catalog/categories'),api.get('/catalog/products')]).then(([cats,prods])=>{setCategories(cats.data.categories||[]);setProducts(prods.data.products||[]);}).catch(()=>toast.error('Error al cargar catálogo')).finally(()=>setLoading(false));},[]);
  const handleTabChange=(t)=>{setTab(t);setActiveCat('all');};
  const filteredCats=categories.filter(c=>c.type===tab);
  const visibleProducts=products.filter(p=>p.category?.type===tab&&(activeCat==='all'||p.category_id===activeCat)).sort((a,b)=>{if(activeCat==='all'){const catA=a.category?.name||'';const catB=b.category?.name||'';if(catA!==catB)return catA.localeCompare(catB);}return(a.display_order??999999)-(b.display_order??999999);});
  const handleAddCategory=async(e)=>{e.preventDefault();if(!newCatName.trim())return;setAddingCat(true);try{const{data}=await api.post('/catalog/categories',{name:newCatName.trim(),type:tab});setCategories(prev=>[...prev,data.category].sort((a,b)=>a.name.localeCompare(b.name)));setNewCatName('');setShowCatInput(false);}catch{toast.error('Error al crear categoría');}finally{setAddingCat(false);}};
  const handleDeleteCategory=(id,name)=>{setConfirm({message:`¿Eliminar "${name}" y todos sus productos?`,onConfirm:async()=>{try{await api.delete(`/catalog/categories/${id}`);setCategories(prev=>prev.filter(c=>c.id!==id));setProducts(prev=>prev.filter(p=>p.category_id!==id));if(activeCat===id)setActiveCat('all');toast.success('Categoría eliminada');}catch{toast.error('Error al eliminar');}setConfirm(null);},onCancel:()=>setConfirm(null)});};
  const handleDeleteProduct=(id)=>{setConfirm({message:'¿Eliminar este producto del catálogo?',onConfirm:async()=>{try{await api.delete(`/catalog/products/${id}`);setProducts(prev=>prev.filter(p=>p.id!==id));toast.success('Producto eliminado');}catch{toast.error('Error al eliminar producto');}setConfirm(null);},onCancel:()=>setConfirm(null)});};
  const handleProductSaved=(product)=>{setProducts(prev=>{const idx=prev.findIndex(p=>p.id===product.id);if(idx>=0){const updated=[...prev];updated[idx]=product;return updated;}return[...prev,product];});setActiveCat(product.category_id);};
  const handleCatalogDragEnd=async(event)=>{const{active,over}=event;if(!active||!over||active.id===over.id||activeCat==='all')return;const oldIndex=visibleProducts.findIndex(p=>p.id===active.id);const newIndex=visibleProducts.findIndex(p=>p.id===over.id);const newVisible=arrayMove(visibleProducts,oldIndex,newIndex);setProducts(prev=>prev.map(p=>{const idx=newVisible.findIndex(v=>v.id===p.id);if(idx>=0)return{...p,display_order:idx};return p;}));try{await api.put('/catalog/products/reorder',{ids:newVisible.map(p=>p.id)});}catch{toast.error('Error al guardar el orden');const{data}=await api.get('/catalog/products');setProducts(data.products||[]);}};
  if(loading) return <div className="ap-loading">Cargando catálogo…</div>;
  return (
    <div className="ap-catalog-shell">
      {confirm&&<ConfirmDialog {...confirm}/>}
      {showProductModal&&<ProductModal categories={categories} onClose={()=>setShowProductModal(false)} onSaved={handleProductSaved}/>}
      {editProduct&&<ProductModal categories={categories} product={editProduct} onClose={()=>setEditProduct(null)} onSaved={(p)=>{handleProductSaved(p);setEditProduct(null);}}/>}
      {showCart&&<CartPanel cart={cart} onRemove={removeFromCart} onClear={clearCart} onClose={()=>setShowCart(false)} toast={toast}/>}
      <div className="ap-catalog-type-tabs">
        <button className={`ap-catalog-type-btn${tab==='material'?' active':''}`} onClick={()=>handleTabChange('material')}>Materiales</button>
        <button className={`ap-catalog-type-btn${tab==='mobiliario'?' active':''}`} onClick={()=>handleTabChange('mobiliario')}>Mobiliario y equipamiento</button>
        <button className={`ap-catalog-type-btn${tab==='renders'?' active':''}`} onClick={()=>handleTabChange('renders')}><Image size={13}/> Renders</button>
      </div>
      {tab==='renders'&&<RendersLibrary/>}
      {tab!=='renders'&&<div className="ap-catalog-filters">
        <div className="ap-catalog-filter-pills">
          <button className={`ap-catalog-pill${activeCat==='all'?' active':''}`} onClick={()=>setActiveCat('all')}>Todo ({products.filter(p=>p.category?.type===tab).length})</button>
          {filteredCats.map(cat=>(<button key={cat.id} className={`ap-catalog-pill${activeCat===cat.id?' active':''}`} onClick={()=>setActiveCat(cat.id)}>{cat.name}<span className="ap-catalog-pill-count">{products.filter(p=>p.category_id===cat.id).length}</span><span className="ap-catalog-pill-del" role="button" onClick={e=>{e.stopPropagation();handleDeleteCategory(cat.id,cat.name);}}>×</span></button>))}
          {showCatInput?(<form onSubmit={handleAddCategory} className="ap-catalog-cat-form"><input className="ap-catalog-cat-input" value={newCatName} onChange={e=>setNewCatName(e.target.value)} placeholder="Nueva categoría…" autoFocus/><button type="submit" className="ap-btn ap-btn-primary ap-btn-sm" disabled={addingCat||!newCatName.trim()}>{addingCat?'…':'Crear'}</button><button type="button" className="ap-btn-icon" onClick={()=>{setShowCatInput(false);setNewCatName('');}}><X size={13}/></button></form>):(<button className="ap-catalog-pill ap-catalog-pill--add" onClick={()=>setShowCatInput(true)}><Plus size={11}/> Categoría</button>)}
        </div>
        <button className="ap-btn ap-btn-primary ap-btn-sm" onClick={()=>setShowProductModal(true)}><Plus size={13}/> Producto</button>
      </div>}
      {tab!=='renders'&&(visibleProducts.length===0?(<p className="ap-empty-sm" style={{textAlign:'center',paddingTop:'2rem'}}>{filteredCats.length===0?'Crea una categoría primero.':'No hay productos. Añade el primero.'}</p>):(
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleCatalogDragEnd}>
          <SortableContext items={visibleProducts.map(p=>p.id)} strategy={rectSortingStrategy}>
            <div className="ap-catalog-grid">{visibleProducts.map(p=>(<SortableCatalogCard key={p.id} p={p} inCart={cart.some(c=>c.id===p.id)} onEdit={setEditProduct} onDelete={handleDeleteProduct} onCart={addToCart} onRemoveCart={removeFromCart} showHandle={activeCat!=='all'}/>))}</div>
          </SortableContext>
        </DndContext>
      ))}
      {cart.length>0&&(<button className="ap-cart-bar" onClick={()=>setShowCart(true)}><ShoppingCart size={16}/><span>{cart.length} producto{cart.length>1?'s':''} en el carrito</span><span className="ap-cart-bar-arrow">→</span></button>)}
    </div>
  );
}

function SortableCatalogCard({ p, inCart, onEdit, onDelete, onCart, onRemoveCart, showHandle }) {
  const {attributes,listeners,setNodeRef,transform,transition,isDragging}=useSortable({id:p.id});
  const style={transform:CSS.Transform.toString(transform),transition,opacity:isDragging?0.4:1,zIndex:isDragging?10:undefined};
  return (
    <div ref={setNodeRef} style={style} className={`ap-catalog-card${inCart?' in-cart':''}`}>
      {showHandle&&(<button {...attributes} {...listeners} className="ap-catalog-drag-handle" type="button"><GripVertical size={13}/></button>)}
      <div className="ap-catalog-card-img-wrap">
        {p.photo_url?<img src={p.photo_url} alt={p.name}/>:<div className="ap-catalog-card-no-img"><Plus size={20} style={{opacity:0.2}}/></div>}
        <button className="ap-catalog-card-del" onClick={()=>onDelete(p.id)}><Trash2 size={12}/></button>
        <button className="ap-catalog-card-edit" onClick={()=>onEdit(p)}><Pencil size={12}/></button>
        <button className={`ap-catalog-card-cart-btn${inCart?' added':''}`} onClick={()=>inCart?onRemoveCart(p.id):onCart(p)}>{inCart?<X size={12}/>:<Plus size={12}/>}</button>
        {p.category&&<span className="ap-catalog-card-cat">{p.category.name}</span>}
      </div>
      <div className="ap-catalog-card-body">
        <span className="ap-catalog-card-name">{p.name}</span>
        {p.brand&&<span className="ap-catalog-card-brand">{p.brand}</span>}
        {p.price!=null&&<span className="ap-catalog-card-price">{Number(p.price).toLocaleString('es-ES',{style:'currency',currency:'EUR'})}</span>}
        {p.notes&&<span className="ap-catalog-card-notes">{p.notes}</span>}
        {p.link&&<a href={p.link} target="_blank" rel="noopener noreferrer" className="ap-catalog-card-link">Ver ↗</a>}
      </div>
    </div>
  );
}

function SectionCatalogo() {
  return (
    <div className="ap-section">
      <div className="ap-section-head"><h2 className="ap-section-title">Catálogo</h2><p className="ap-section-sub">Tu biblioteca de materiales y mobiliario</p></div>
      <CatalogoLibrary/>
    </div>
  );
}

function SortableAssignedItem({ item, onUnassign, onUpdate, type }) {
  const {attributes,listeners,setNodeRef,transform,transition,isDragging}=useSortable({id:item.id});
  const style={transform:CSS.Transform.toString(transform),transition,opacity:isDragging?0.4:1};
  const [expanded,setExpanded]=useState(false); const [qty,setQty]=useState(item.quantity??1); const [ytUrl,setYtUrl]=useState(item.youtube_url||''); const [extraImgs,setExtraImgs]=useState(item.extra_images||[]); const [newImg,setNewImg]=useState(''); const [saving,setSaving]=useState(false);
  const isMob=type==='mobiliario';
  const handleSave=async()=>{setSaving(true);try{await api.put(`/client-projects/${item.project_id}/equipment/${item.id}`,{quantity:qty,youtube_url:ytUrl||null,extra_images:extraImgs});onUpdate({...item,quantity:qty,youtube_url:ytUrl||null,extra_images:extraImgs});setExpanded(false);}catch{}finally{setSaving(false);}};
  const addImg=()=>{const url=newImg.trim();if(!url||extraImgs.includes(url))return;setExtraImgs(prev=>[...prev,url]);setNewImg('');};
  const removeImg=(url)=>setExtraImgs(prev=>prev.filter(u=>u!==url));
  return (
    <div ref={setNodeRef} style={style} className="ap-catalog-product ap-catalog-product--expand">
      <button {...attributes} {...listeners} style={{background:'none',border:'none',cursor:'grab',color:'rgba(255,255,255,0.3)',padding:'0 4px',flexShrink:0,display:'flex',alignItems:'center'}} type="button"><GripVertical size={13}/></button>
      {item.image_url&&<img src={item.image_url} alt={item.name} className="ap-catalog-product-img"/>}
      <div className="ap-catalog-product-info" style={{flex:1}}>
        <span className="ap-catalog-product-name">{item.name}</span>
        {item.category&&<span className="ap-cat-meta">{item.category}</span>}
        {isMob&&<span className="ap-cat-meta" style={{color:'rgba(190,176,162,0.7)',marginLeft:4}}>×{qty}{item.youtube_url&&' · 🎬'}{item.extra_images?.length>0&&` · ${item.extra_images.length} img`}</span>}
      </div>
      {isMob&&(<button className="ap-btn ap-btn-ghost ap-btn-sm" style={{flexShrink:0,fontSize:'0.72rem'}} onClick={()=>setExpanded(v=>!v)} type="button"><Pencil size={11}/> {expanded?'Cerrar':'Detalle'}</button>)}
      <button className="ap-btn-icon" onClick={()=>onUnassign(item.id,type)}><X size={13}/></button>
      {expanded&&isMob&&(
        <div className="ap-eq-detail-panel">
          <div className="ap-field" style={{marginBottom:'0.75rem'}}>
            <label style={{fontSize:'0.7rem',color:'rgba(255,255,255,0.4)',marginBottom:'0.3rem',display:'block'}}>Cantidad</label>
            <div style={{display:'flex',alignItems:'center',gap:'0.4rem'}}>
              <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={()=>setQty(q=>Math.max(1,q-1))}>−</button>
              <input type="number" min="1" className="ap-field-input" style={{width:60,textAlign:'center'}} value={qty} onChange={e=>setQty(Math.max(1,parseInt(e.target.value)||1))}/>
              <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={()=>setQty(q=>q+1)}>+</button>
            </div>
          </div>
          <div className="ap-field" style={{marginBottom:'0.75rem'}}>
            <label style={{fontSize:'0.7rem',color:'rgba(255,255,255,0.4)',marginBottom:'0.3rem',display:'block'}}>Vídeo YouTube (URL)</label>
            <input className="ap-field-input" value={ytUrl} onChange={e=>setYtUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=..."/>
          </div>
          <div className="ap-field" style={{marginBottom:'0.75rem'}}>
            <label style={{fontSize:'0.7rem',color:'rgba(255,255,255,0.4)',marginBottom:'0.3rem',display:'block'}}>Imágenes adicionales (URLs)</label>
            {extraImgs.length>0&&(<div style={{display:'flex',flexWrap:'wrap',gap:'0.4rem',marginBottom:'0.5rem'}}>{extraImgs.map(url=>(<div key={url} style={{position:'relative',width:52,height:52}}><img src={url} alt="" style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:6,border:'1px solid rgba(255,255,255,0.1)'}}/><button type="button" onClick={()=>removeImg(url)} style={{position:'absolute',top:-5,right:-5,background:'#1a1a1a',border:'1px solid rgba(255,255,255,0.15)',borderRadius:'50%',width:16,height:16,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',padding:0,color:'rgba(255,255,255,0.6)'}}><X size={9}/></button></div>))}</div>)}
            <div style={{display:'flex',gap:'0.4rem'}}>
              <input className="ap-field-input" value={newImg} onChange={e=>setNewImg(e.target.value)} placeholder="https://..." onKeyDown={e=>e.key==='Enter'&&(e.preventDefault(),addImg())}/>
              <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={addImg}><Plus size={12}/> Añadir</button>
            </div>
          </div>
          <button type="button" className="ap-btn ap-btn-primary ap-btn-sm" onClick={handleSave} disabled={saving} style={{width:'100%'}}>{saving?'Guardando…':<><Save size={12}/> Guardar cambios</>}</button>
        </div>
      )}
    </div>
  );
}

function TabAsignaciones({ projectId }) {
  const [tab,setTab]=useState('material'); const [categories,setCategories]=useState([]); const [products,setProducts]=useState([]); const [assigned,setAssigned]=useState({materials:[],equipment:[]}); const [loading,setLoading]=useState(true); const [expandedCat,setExpandedCat]=useState(null);
  const {toast}=useToast();
  const sensors=useSensors(useSensor(PointerSensor,{activationConstraint:{distance:5}}));
  useEffect(()=>{Promise.all([api.get('/catalog/categories'),api.get('/catalog/products'),api.get(`/client-projects/${projectId}/materials`),api.get(`/client-projects/${projectId}/equipment`)]).then(([cats,prods,mats,equip])=>{setCategories(cats.data.categories||[]);setProducts(prods.data.products||[]);setAssigned({materials:mats.data.materials||[],equipment:equip.data.equipment||[]});}).catch(()=>{}).finally(()=>setLoading(false));},[projectId]);
  const isAssigned=(productId,type)=>{const list=type==='material'?assigned.materials:assigned.equipment;return list.some(a=>a.catalog_product_id===productId);};
  const handleAssignedDragEnd=async(event)=>{const{active,over}=event;if(!active||!over||active.id===over.id)return;const isMat=tab==='material';const list=isMat?assigned.materials:assigned.equipment;const oldIndex=list.findIndex(a=>a.id===active.id);const newIndex=list.findIndex(a=>a.id===over.id);const newList=arrayMove(list,oldIndex,newIndex);setAssigned(prev=>isMat?{...prev,materials:newList}:{...prev,equipment:newList});const endpoint=isMat?`/client-projects/${projectId}/materials/reorder`:`/client-projects/${projectId}/equipment/reorder`;try{await api.put(endpoint,{ids:newList.map(a=>a.id)});}catch{toast.error('Error al guardar el orden');}};
  const assign=async(product)=>{const isMat=product.category?.type==='material';const type=isMat?'material':'mobiliario';if(isAssigned(product.id,type)){toast.error(`"${product.name}" ya está asignado`);return;}const endpoint=isMat?`/client-projects/${projectId}/materials`:`/client-projects/${projectId}/equipment`;try{const payload=isMat?{name:product.name,category:product.category?.name,catalog_product_id:product.id,image_url:product.photo_url||null}:{name:product.name,category:product.category?.name,catalog_product_id:product.id,quantity:1,image_url:product.photo_url||null,extra_images:[],youtube_url:null};const{data}=await api.post(endpoint,payload);setAssigned(prev=>isMat?{...prev,materials:[data.material,...prev.materials]}:{...prev,equipment:[data.equipment,...prev.equipment]});toast.success(`"${product.name}" añadido`);}catch{toast.error('Error al asignar producto');}};
  const unassign=async(id,type)=>{const isMat=type==='material';const endpoint=isMat?`/client-projects/${projectId}/materials/${id}`:`/client-projects/${projectId}/equipment/${id}`;try{await api.delete(endpoint);setAssigned(prev=>isMat?{...prev,materials:prev.materials.filter(m=>m.id!==id)}:{...prev,equipment:prev.equipment.filter(e=>e.id!==id)});}catch{toast.error('Error al quitar producto');}};
  const handleItemUpdate=(updatedItem)=>{setAssigned(prev=>({...prev,equipment:prev.equipment.map(e=>e.id===updatedItem.id?updatedItem:e)}));toast.success('Detalles guardados');};
  if(loading) return <div className="ap-loading">Cargando…</div>;
  const filteredCats=categories.filter(c=>c.type===tab);
  const assignedList=tab==='material'?assigned.materials:assigned.equipment;
  return (
    <div className="ap-tab-content">
      <div className="ap-cat-tabs" style={{marginBottom:'1.25rem'}}>
        <button className={`ap-cat-tab${tab==='material'?' active':''}`} onClick={()=>setTab('material')}>Materiales</button>
        <button className={`ap-cat-tab${tab==='mobiliario'?' active':''}`} onClick={()=>setTab('mobiliario')}>Mobiliario</button>
      </div>
      {assignedList.length>0&&(<div style={{marginBottom:'1.25rem'}}><p style={{fontSize:'0.7rem',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.08em',color:'rgba(255,255,255,0.3)',marginBottom:'0.5rem'}}>Asignados a este proyecto</p><DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleAssignedDragEnd}><SortableContext items={assignedList.map(a=>a.id)} strategy={verticalListSortingStrategy}><div className="ap-catalog-products" style={{padding:0}}>{assignedList.map(a=>(<SortableAssignedItem key={a.id} item={{...a,project_id:projectId}} type={tab==='material'?'material':'mobiliario'} onUnassign={unassign} onUpdate={handleItemUpdate}/>))}</div></SortableContext></DndContext></div>)}
      <p style={{fontSize:'0.7rem',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.08em',color:'rgba(255,255,255,0.3)',marginBottom:'0.75rem'}}>Tu catálogo</p>
      {filteredCats.length===0&&<p className="ap-empty-sm">No hay categorías en el catálogo todavía.</p>}
      <div className="ap-catalog-categories">{filteredCats.map(cat=>{const catProducts=products.filter(p=>p.category_id===cat.id);const isOpen=expandedCat===cat.id;return(<div key={cat.id} className="ap-catalog-cat"><div className="ap-catalog-cat-header"><button className="ap-catalog-cat-toggle" onClick={()=>setExpandedCat(isOpen?null:cat.id)}><span className="ap-catalog-cat-arrow">{isOpen?'▾':'▸'}</span><span className="ap-catalog-cat-name">{cat.name}</span><span className="ap-catalog-cat-count">{catProducts.length}</span></button></div>{isOpen&&(<div className="ap-catalog-products">{catProducts.length===0&&<p className="ap-empty-sm" style={{paddingLeft:'1rem'}}>Sin productos.</p>}{catProducts.map(p=>{const already=isAssigned(p.id,tab);return(<div key={p.id} className="ap-catalog-product">{p.photo_url&&<img src={p.photo_url} alt={p.name} className="ap-catalog-product-img"/>}<div className="ap-catalog-product-info"><span className="ap-catalog-product-name">{p.name}</span>{p.price!=null&&<span className="ap-catalog-product-price">{Number(p.price).toLocaleString('es-ES',{style:'currency',currency:'EUR'})}</span>}{p.link&&<a href={p.link} target="_blank" rel="noopener noreferrer" className="ap-catalog-product-link">Ver producto ↗</a>}</div><button className={`ap-btn ap-btn-sm ${already?'ap-btn-ghost':'ap-btn-primary'}`} onClick={()=>!already&&assign(p)} disabled={already} style={{flexShrink:0}}>{already?'✓':<Plus size={13}/>}</button></div>);})}</div>)}</div>);})}</div>
    </div>
  );
}

function ProjectManagerModal({ project, onClose }) {
  const [tab, setTab] = useState('renders');

  const handlePdfMateriales = async () => {
    try {
      const base = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
      const token = localStorage.getItem('admin_token');
      const res = await fetch(`${base}/client-projects/${project.id}/pdf-materiales`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `materiales-${project.client_name}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {}
  };

  return (
    <div className="ap-modal-overlay" onClick={onClose}>
      <div className="ap-mgr-modal" onClick={e => e.stopPropagation()}>
        <div className="ap-mgr-head">
          <div>
            <h2 className="ap-mgr-title">{project.client_name}</h2>
            <p className="ap-mgr-sub">{project.project_name} · <span className="ap-code-val" style={{fontSize:'0.78rem'}}>{project.access_code}</span></p>
          </div>
          <div style={{display:'flex', gap:'0.5rem', alignItems:'center'}}>
            <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={handlePdfMateriales}>
              <Download size={13}/> PDF materiales
            </button>
            <button className="ap-modal-close" onClick={onClose}><X size={16}/></button>
          </div>
        </div>
        <div className="ap-mgr-tabs">{MGR_TABS.map(t=>(<button key={t.id} className={`ap-mgr-tab${tab===t.id?' active':''}`} onClick={()=>setTab(t.id)}>{t.label}</button>))}</div>
        <div className="ap-mgr-body">
          {tab==='renders'&&<TabRenders projectId={project.id}/>}
          {tab==='documentos'&&<TabDocumentos projectId={project.id}/>}
          {tab==='tours'&&<TabTour projectId={project.id}/>}
          {tab==='notas'&&<TabNotas projectId={project.id}/>}
          {tab==='catalogo'&&<TabAsignaciones projectId={project.id}/>}
        </div>
      </div>
    </div>
  );
}

function SectionTrabajos() {
  const [projects,setProjects]=useState([]); const [savedProjects,setSavedProjects]=useState([]); const [loading,setLoading]=useState(true); const [saving,setSaving]=useState(false); const [modal,setModal]=useState(null); const [confirmId,setConfirmId]=useState(null); const [brokenCovers,setBrokenCovers]=useState({});
  const {toasts,toast,remove}=useToast();
  const loadProjects=async()=>{try{const{data}=await api.get('/portfolio');const list=data.projects||[];const broken=list.filter(p=>{const invalid=!p.cover_url||p.cover_url.startsWith('blob:');const hasReplacement=p.images?.some(u=>u&&!u.startsWith('blob:'));return invalid&&hasReplacement;});if(broken.length>0){await Promise.all(broken.map(p=>{const newCover=p.images.find(u=>u&&!u.startsWith('blob:'));return api.put(`/portfolio/${p.id}`,{cover_url:newCover}).catch(()=>null);}));const healed=list.map(p=>{const fix=broken.find(b=>b.id===p.id);if(!fix)return p;return{...p,cover_url:p.images.find(u=>u&&!u.startsWith('blob:'))};});setProjects(healed);setSavedProjects(healed);}else{setProjects(list);setSavedProjects(list);}}catch{}finally{setLoading(false);}};
  useEffect(()=>{loadProjects();},[]);
  const isDirty=projects.length===savedProjects.length&&projects.some((p,i)=>savedProjects[i]?.id!==p.id);
  const handleDelete=async()=>{try{await api.delete(`/portfolio/${confirmId}`);setProjects(prev=>prev.filter(p=>p.id!==confirmId));setSavedProjects(prev=>prev.filter(p=>p.id!==confirmId));toast.success('Proyecto eliminado correctamente');}catch{toast.error('Error al eliminar el proyecto');}finally{setConfirmId(null);}};
  const handleMove=(index,direction)=>{const swapIndex=index+direction;if(swapIndex<0||swapIndex>=projects.length)return;const updated=[...projects];[updated[index],updated[swapIndex]]=[updated[swapIndex],updated[index]];setProjects(updated);};
  const handleSaveOrder=async()=>{setSaving(true);try{const changed=projects.map((p,i)=>({p,newOrder:i+1})).filter(({p,newOrder})=>p.display_order!==newOrder);await Promise.all(changed.map(({p,newOrder})=>api.put(`/portfolio/${p.id}`,{display_order:newOrder})));const synced=projects.map((p,i)=>({...p,display_order:i+1}));setProjects(synced);setSavedProjects(synced);toast.success('Orden guardado correctamente');}catch{toast.error('Error al guardar el orden');}finally{setSaving(false);}};
  const handleDiscardOrder=()=>{setProjects(savedProjects);toast.success('Cambios descartados');};
  return (
    <div className="ap-section">
      <ToastContainer toasts={toasts} onRemove={remove}/>
      <div className="ap-section-head"><div><h1>Trabajos</h1><p>Gestiona los trabajos del portfolio. Los 3 primeros aparecen en la página de inicio.</p></div><div style={{display:'flex',gap:'0.5rem',alignItems:'center',flexWrap:'wrap'}}>{isDirty&&(<><button className="ap-btn ap-btn-ghost" onClick={handleDiscardOrder} disabled={saving}><X size={14}/> Descartar</button><button className="ap-btn ap-btn-primary" onClick={handleSaveOrder} disabled={saving}><Save size={14}/> {saving?'Guardando...':'Guardar orden'}</button></>)}<button className="ap-btn ap-btn-primary" onClick={()=>setModal('new')}><Plus size={15}/> Nuevo proyecto</button></div></div>
      {loading?<div className="ap-loading">Cargando proyectos...</div>:projects.length===0?<div className="ap-empty"><p>No hay proyectos todavía.</p></div>:(
        <><p className="ap-order-hint">Usa ↑↓ para cambiar el orden.{isDirty&&<span style={{color:'#f5b748',marginLeft:'0.5rem'}}>Tienes cambios sin guardar.</span>}</p>
        <div className="ap-projects-grid">{projects.map((p,i)=>{const validCover=p.cover_url&&!p.cover_url.startsWith('blob:')&&!brokenCovers[p.id];const fallback=p.images?.find(u=>u&&!u.startsWith('blob:'));const src=validCover?p.cover_url:fallback;return(<div key={p.id} className={`ap-project-card${i<3?' is-featured':''}`}><div className="ap-project-img">{src?<img src={src} alt={p.title} onError={()=>setBrokenCovers(prev=>({...prev,[p.id]:true}))}/>:<div className="ap-project-no-img">Sin imagen</div>}<span className="ap-project-count">{p.images?.length||0} fotos</span>{i<3&&<span className="ap-featured-badge">En inicio</span>}</div><div className="ap-project-info"><h3>{p.title}</h3>{p.description&&<p>{p.description}</p>}<span className="ap-project-slug">/{p.slug}</span></div><div className="ap-project-actions"><div className="ap-order-btns"><button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={()=>handleMove(i,-1)} disabled={i===0}><ChevronUp size={14}/></button><button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={()=>handleMove(i,1)} disabled={i===projects.length-1}><ChevronDown size={14}/></button></div><button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={()=>setModal(p)}><Pencil size={13}/> Editar</button><button className="ap-btn ap-btn-danger ap-btn-sm" onClick={()=>setConfirmId(p.id)}><Trash2 size={13}/></button></div></div>);})}</div></>
      )}
      {modal&&<ProjectModal project={modal==='new'?null:modal} onClose={()=>setModal(null)} onSaved={()=>{setModal(null);loadProjects();toast.success('Proyecto guardado correctamente');}}/>}
      {confirmId&&<ConfirmDialog message="¿Eliminar este proyecto? Esta acción no se puede deshacer." onConfirm={handleDelete} onCancel={()=>setConfirmId(null)}/>}
    </div>
  );
}

const PAGE_SIZE_PROYECTOS=6;

function SectionProyectos() {
  const [projects,setProjects]=useState([]); const [loading,setLoading]=useState(true); const [modal,setModal]=useState(null); const [confirmId,setConfirmId]=useState(null); const [manageProject,setManageProject]=useState(null); const [page,setPage]=useState(1);
  const {toasts,toast,remove}=useToast();
  const loadProjects=async()=>{try{const{data}=await api.get('/client-projects');setProjects(data.projects||[]);}catch{}finally{setLoading(false);}};
  useEffect(()=>{loadProjects();},[]);
  const handleDelete=async()=>{try{await api.delete(`/client-projects/${confirmId}`);setProjects(prev=>prev.filter(p=>p.id!==confirmId));toast.success('Proyecto eliminado');}catch{toast.error('Error al eliminar el proyecto');}finally{setConfirmId(null);}};
  const copyCode=(code)=>{navigator.clipboard.writeText(code);toast.success('Código copiado');};
  const copyLink=(code)=>{const url=`${window.location.origin}/mi-proyecto?code=${code}`;navigator.clipboard.writeText(url);toast.success('Enlace copiado');};
  return (
    <div className="ap-section">
      <ToastContainer toasts={toasts} onRemove={remove}/>
      <div className="ap-section-head"><div><h1>Proyectos</h1><p>Genera proyectos con códigos de acceso para tus clientes.</p></div><button className="ap-btn ap-btn-primary" onClick={()=>setModal('new')}><Plus size={15}/> Generar proyecto</button></div>
      {loading?<div className="ap-loading">Cargando proyectos...</div>:projects.length===0?<div className="ap-empty"><p>No hay proyectos todavía.</p></div>:(
        <><div className="ap-cp-grid">{projects.slice((page-1)*PAGE_SIZE_PROYECTOS,page*PAGE_SIZE_PROYECTOS).map(p=>(<div key={p.id} className="ap-cp-card"><div className="ap-cp-header"><div className="ap-cp-names"><h3 className="ap-cp-client">{p.client_name}</h3><p className="ap-cp-name">{p.project_name}</p></div><span className={`ap-urgency-badge ap-urgency--${p.urgency}`}>{p.urgency}</span></div><div className="ap-cp-phase-row"><div className="ap-cp-dots">{[1,2,3,4,5].map(n=>(<div key={n} className={`ap-phase-dot${n<=p.phase?' active':''}`} title={PHASE_LABELS[n]}/>))}</div><span className="ap-phase-label">{PHASE_LABELS[p.phase]}</span></div><div className="ap-cp-code-row"><span className="ap-code-val">{p.access_code}</span><button className="ap-btn-icon" onClick={()=>copyCode(p.access_code)}><Copy size={13}/></button></div><div className="ap-cp-link-row"><span className="ap-cp-link-text">/mi-proyecto?code={p.access_code}</span><button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={()=>copyLink(p.access_code)}><Copy size={12}/> Copiar enlace</button></div>{p.client_email&&<p className="ap-cp-email">{p.client_email}</p>}<div className="ap-project-actions"><button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={()=>setManageProject(p)}><Settings size={13}/> Gestionar</button><button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={()=>setModal(p)}><Pencil size={13}/> Editar</button><button className="ap-btn ap-btn-danger ap-btn-sm" onClick={()=>setConfirmId(p.id)}><Trash2 size={13}/></button></div></div>))}</div><Pagination page={page} total={projects.length} pageSize={PAGE_SIZE_PROYECTOS} onPage={setPage}/></>
      )}
      {modal&&<ClientProjectModal project={modal==='new'?null:modal} onClose={()=>setModal(null)} onSaved={(saved)=>{if(modal==='new')setProjects(prev=>[saved,...prev]);else setProjects(prev=>prev.map(p=>p.id===saved.id?saved:p));setModal(null);toast.success('Proyecto guardado correctamente');}}/>}
      {confirmId&&<ConfirmDialog message="¿Eliminar este proyecto? El código de acceso quedará inválido." onConfirm={handleDelete} onCancel={()=>setConfirmId(null)}/>}
      {manageProject&&<ProjectManagerModal project={manageProject} onClose={()=>setManageProject(null)}/>}
    </div>
  );
}

function EmpleadoModal({ onClose, onSaved }) {
  const [name,setName]=useState(''); const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [loading,setLoading]=useState(false); const [error,setError]=useState('');
  const handleSubmit=async(e)=>{e.preventDefault();setError('');setLoading(true);try{const{data}=await api.post('/employees',{name,email,password});onSaved(data.employee);}catch(err){setError(err.response?.data?.error||'Error al crear el empleado');}finally{setLoading(false);}};
  return (<div className="ap-modal-overlay" onClick={onClose}><div className="ap-modal" onClick={e=>e.stopPropagation()}><div className="ap-modal-head"><h2>Nuevo empleado</h2><button className="ap-modal-close" onClick={onClose}><X size={16}/></button></div><form onSubmit={handleSubmit} className="ap-modal-form"><div className="ap-field"><label>Nombre *</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="Carlos Rodríguez" required/></div><div className="ap-field"><label>Email *</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="carlos@ranusedesign.com" required/></div><div className="ap-field"><label>Contraseña *</label><input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" required minLength={6}/></div>{error&&<p className="ap-error">{error}</p>}<div className="ap-modal-actions"><button type="button" className="ap-btn ap-btn-ghost" onClick={onClose}>Cancelar</button><button type="submit" className="ap-btn ap-btn-primary" disabled={loading}>{loading?'Creando...':'Crear empleado'}</button></div></form></div></div>);
}

const PAGE_SIZE_EMPLEADOS=8;

function SectionEmpleados() {
  const {user}=useAdminAuth(); const isSuper=user?.role==='admin_superior'; const [employees,setEmployees]=useState([]); const [loading,setLoading]=useState(true); const [showModal,setShowModal]=useState(false); const [confirmId,setConfirmId]=useState(null); const [page,setPage]=useState(1); const [visiblePass,setVisiblePass]=useState({});
  const {toasts,toast,remove}=useToast();
  const loadEmployees=async()=>{try{const{data}=await api.get('/employees');setEmployees(data.employees||[]);}catch{}finally{setLoading(false);}};
  useEffect(()=>{loadEmployees();},[]);
  const handleDelete=async()=>{const emp=employees.find(e=>e.id===confirmId);if(emp?.is_admin_profile){toast.error('No puedes eliminar tu propio perfil');setConfirmId(null);return;}try{await api.delete(`/employees/${confirmId}`);setEmployees(prev=>prev.filter(e=>e.id!==confirmId));toast.success('Empleado eliminado');}catch{toast.error('Error al eliminar el empleado');}finally{setConfirmId(null);}};
  const togglePass=(id)=>setVisiblePass(prev=>({...prev,[id]:!prev[id]}));
  return (
    <div className="ap-section">
      <ToastContainer toasts={toasts} onRemove={remove}/>
      <div className="ap-section-head"><div><h1>Empleados</h1><p>Gestiona el equipo.</p></div><button className="ap-btn ap-btn-primary" onClick={()=>setShowModal(true)}><Plus size={15}/> Añadir empleado</button></div>
      {loading?<div className="ap-loading">Cargando empleados…</div>:employees.length===0?<div className="ap-empty"><p>No hay empleados todavía.</p></div>:(
        <><div className="ap-emp-list">{employees.slice((page-1)*PAGE_SIZE_EMPLEADOS,page*PAGE_SIZE_EMPLEADOS).map(e=>(<div key={e.id} className={`ap-emp-row${e.is_admin_profile?' ap-emp-row--admin':''}`}><div className="ap-emp-avatar" style={e.is_admin_profile?{background:'rgba(190,176,162,0.2)',color:'#beb0a2'}:{}}>{e.name.charAt(0).toUpperCase()}</div><div className="ap-emp-info"><span className="ap-emp-name">{e.name}{e.is_admin_profile&&<span className="ap-emp-badge">Admin</span>}</span><span className="ap-emp-email">{e.email}</span>{isSuper&&!e.is_admin_profile&&e.plain_password&&(<span className="ap-emp-pass-row"><span className="ap-emp-pass-val">{visiblePass[e.id]?e.plain_password:'••••••••'}</span><button className="ap-btn-icon ap-emp-pass-eye" onClick={()=>togglePass(e.id)}>{visiblePass[e.id]?<EyeOff size={12}/>:<Eye size={12}/>}</button></span>)}</div><span className={`ap-emp-status${e.active?' active':''}`}>{e.active?'Activo':'Inactivo'}</span>{!e.is_admin_profile&&(<button className="ap-btn ap-btn-danger ap-btn-sm" onClick={()=>setConfirmId(e.id)}><Trash2 size={13}/></button>)}</div>))}</div><Pagination page={page} total={employees.length} pageSize={PAGE_SIZE_EMPLEADOS} onPage={setPage}/></>
      )}
      {showModal&&<EmpleadoModal onClose={()=>setShowModal(false)} onSaved={(emp)=>{setEmployees(prev=>[emp,...prev]);setShowModal(false);toast.success('Empleado creado correctamente');}}/>}
      {confirmId&&<ConfirmDialog message="¿Eliminar este empleado? Perderá el acceso al panel." onConfirm={handleDelete} onCancel={()=>setConfirmId(null)}/>}
    </div>
  );
}

function SectionClientes() {
  const {toasts,toast,remove}=useToast(); const [clients,setClients]=useState([]); const [loading,setLoading]=useState(true); const [showModal,setShowModal]=useState(false); const [expandedId,setExpandedId]=useState(null); const [clientProjects,setClientProjects]=useState({}); const [allProjects,setAllProjects]=useState([]); const [confirmDelete,setConfirmDelete]=useState(null); const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [creating,setCreating]=useState(false); const [formError,setFormError]=useState('');
  const loadClients=async()=>{try{const{data}=await api.get('/users?role=cliente');setClients(data.users||[]);}catch{}finally{setLoading(false);}};
  useEffect(()=>{loadClients();api.get('/client-projects').then(r=>setAllProjects(r.data.projects||[])).catch(()=>{});},[]);
  const loadClientProjects=async(clientId)=>{if(clientProjects[clientId]!==undefined)return;try{const{data}=await api.get(`/users/${clientId}/client-projects`);setClientProjects(prev=>({...prev,[clientId]:data.projects||[]}));}catch{setClientProjects(prev=>({...prev,[clientId]:[]}));}};
  const toggleExpand=(id)=>{if(expandedId===id){setExpandedId(null);return;}setExpandedId(id);loadClientProjects(id);};
  const handleCreate=async(e)=>{e.preventDefault();setFormError('');setCreating(true);try{const{data}=await api.post('/users/cliente',{email,password});setClients(prev=>[data.user,...prev]);setEmail('');setPassword('');setShowModal(false);toast.success('Cliente creado');}catch(err){setFormError(err.response?.data?.error||'Error al crear el cliente');}finally{setCreating(false);}};
  const handleDeleteClient=async(clientId)=>{try{await api.delete(`/users/${clientId}`);setClients(prev=>prev.filter(c=>c.id!==clientId));toast.success('Cliente eliminado');}catch(err){toast.error(err.response?.data?.error||'Error al eliminar el cliente');}finally{setConfirmDelete(null);}};
  const handleAssign=async(clientId,projectId)=>{try{await api.post(`/users/${clientId}/client-projects`,{client_project_id:projectId});const project=allProjects.find(p=>p.id===projectId);if(project)setClientProjects(prev=>({...prev,[clientId]:[...(prev[clientId]||[]),project]}));toast.success('Proyecto asignado');}catch(err){toast.error(err.response?.data?.error||'Error al asignar proyecto');}};
  const handleUnassign=async(clientId,projectId)=>{try{await api.delete(`/users/${clientId}/client-projects/${projectId}`);setClientProjects(prev=>({...prev,[clientId]:prev[clientId].filter(p=>p.id!==projectId)}));toast.success('Proyecto desasignado');}catch(err){toast.error(err.response?.data?.error||'Error al desasignar proyecto');}};
  const assignableProjects=(clientId)=>{const assigned=(clientProjects[clientId]||[]).map(p=>p.id);return allProjects.filter(p=>!assigned.includes(p.id));};
  return (
    <div className="ap-section">
      <ToastContainer toasts={toasts} onRemove={remove}/>
      {confirmDelete&&<ConfirmDialog message="¿Eliminar este cliente?" onConfirm={()=>handleDeleteClient(confirmDelete)} onCancel={()=>setConfirmDelete(null)}/>}
      <div className="ap-section-head"><div><h1>Clientes</h1><p>Crea cuentas para tus clientes y asígnales sus proyectos.</p></div><button className="ap-btn ap-btn-primary" onClick={()=>setShowModal(true)}><Plus size={15}/> Nuevo cliente</button></div>
      {showModal&&(<div className="ap-modal-overlay" onClick={()=>setShowModal(false)}><div className="ap-modal" onClick={e=>e.stopPropagation()}><div className="ap-modal-head"><h2>Nuevo cliente</h2><button className="ap-modal-close" onClick={()=>setShowModal(false)}><X size={16}/></button></div><form onSubmit={handleCreate} className="ap-modal-form"><div className="ap-field"><label>Email *</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="cliente@email.com" required autoFocus/></div><div className="ap-field"><label>Contraseña *</label><input type="text" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Contraseña que le darás al cliente" required/><span className="ap-field-hint">El cliente usará estas credenciales para iniciar sesión.</span></div>{formError&&<p className="ap-error">{formError}</p>}<div className="ap-modal-actions"><button type="button" className="ap-btn ap-btn-ghost" onClick={()=>setShowModal(false)}>Cancelar</button><button type="submit" className="ap-btn ap-btn-primary" disabled={creating}>{creating?'Creando...':'Crear cliente'}</button></div></form></div></div>)}
      {loading?<div className="ap-loading">Cargando clientes…</div>:clients.length===0?<div className="ap-empty"><p>No hay clientes todavía.</p></div>:(
        <div className="ap-cl-list">{clients.map(client=>{const isExpanded=expandedId===client.id;const assigned=clientProjects[client.id]||[];const available=assignableProjects(client.id);return(<div key={client.id} className={`ap-cl-row${isExpanded?' expanded':''}`}><div className="ap-cl-main" onClick={()=>toggleExpand(client.id)}><div className="ap-cl-avatar">{client.email.charAt(0).toUpperCase()}</div><div className="ap-cl-info"><span className="ap-cl-email">{client.email}</span><span className="ap-cl-meta">{new Date(client.created_at).toLocaleDateString('es-ES',{day:'2-digit',month:'short',year:'numeric'})}</span></div><div className="ap-cl-actions"><button className="ap-btn ap-btn-danger ap-btn-sm" onClick={e=>{e.stopPropagation();setConfirmDelete(client.id);}}><Trash2 size={13}/></button><span className="ap-cl-chevron">{isExpanded?<ChevronUp size={15}/>:<ChevronDown size={15}/>}</span></div></div>{isExpanded&&(<div className="ap-cl-projects"><p className="ap-cl-projects-title">Proyectos asignados</p>{assigned.length===0?<p className="ap-cl-projects-empty">Sin proyectos asignados.</p>:(<div className="ap-cl-proj-list">{assigned.map(p=>(<div key={p.id} className="ap-cl-proj-item"><span className="ap-cl-proj-name">{p.project_name}</span><span className="ap-cl-proj-client">{p.client_name}</span><button className="ap-btn ap-btn-danger ap-btn-xs" onClick={()=>handleUnassign(client.id,p.id)}><X size={12}/></button></div>))}</div>)}{available.length>0&&(<div className="ap-cl-assign"><select className="ap-select ap-cl-proj-select" defaultValue="" onChange={e=>{if(e.target.value){handleAssign(client.id,e.target.value);e.target.value='';} }}><option value="" disabled>+ Asignar proyecto…</option>{available.map(p=>(<option key={p.id} value={p.id}>{p.project_name} — {p.client_name}</option>))}</select></div>)}</div>)}</div>);})}</div>
      )}
    </div>
  );
}

function SectionReferencias() {
  const [references,setReferences]=useState([]); const [loading,setLoading]=useState(true); const [modal,setModal]=useState(null); const [confirm,setConfirm]=useState(null); const [activeCategory,setActiveCategory]=useState('all');
  const {toasts,toast,remove}=useToast();
  useEffect(()=>{api.get('/references').then(r=>setReferences(r.data.references||[])).catch(()=>toast.error('Error al cargar referencias')).finally(()=>setLoading(false));},[]);
  const categories=[...new Set(references.map(r=>r.category).filter(Boolean))].sort();
  const visible=activeCategory==='all'?references:references.filter(r=>r.category===activeCategory);
  const handleSaved=(ref,isEdit)=>{setReferences(prev=>isEdit?prev.map(r=>r.id===ref.id?ref:r):[ref,...prev]);toast.success(isEdit?'Referencia actualizada':'Referencia añadida');};
  const handleDelete=(id)=>{setConfirm({message:'¿Eliminar esta referencia?',onConfirm:async()=>{try{await api.delete(`/references/${id}`);setReferences(prev=>prev.filter(r=>r.id!==id));toast.success('Referencia eliminada');}catch{toast.error('Error al eliminar');}setConfirm(null);},onCancel:()=>setConfirm(null)});};
  const getDomain=(url)=>{try{return new URL(url).hostname.replace('www.','');}catch{return url;}};
  const ReferenceModal=({reference,onClose,onSaved})=>{const isEdit=!!reference;const [title,setTitle]=useState(reference?.title||'');const [url,setUrl]=useState(reference?.url||'');const [description,setDescription]=useState(reference?.description||'');const [category,setCategory]=useState(reference?.category||'');const [imageUrl,setImageUrl]=useState(reference?.image_url||'');const [saving,setSaving]=useState(false);const [error,setError]=useState('');const handleSubmit=async(e)=>{e.preventDefault();if(!title.trim())return;setSaving(true);setError('');try{const payload={title:title.trim(),url:url.trim()||null,description:description.trim()||null,category:category.trim()||null,image_url:imageUrl.trim()||null};let data;if(isEdit){({data}=await api.put(`/references/${reference.id}`,payload));onSaved(data.reference,true);}else{({data}=await api.post('/references',payload));onSaved(data.reference,false);}onClose();}catch{setError('Error al guardar');}finally{setSaving(false);}};return(<div className="ap-modal-overlay" onClick={onClose}><div className="ap-modal" onClick={e=>e.stopPropagation()}><div className="ap-modal-head"><h2>{isEdit?'Editar referencia':'Nueva referencia'}</h2><button className="ap-modal-close" onClick={onClose}><X size={16}/></button></div><form onSubmit={handleSubmit} className="ap-modal-form"><div className="ap-field"><label>Título *</label><input value={title} onChange={e=>setTitle(e.target.value)} required autoFocus/></div><div className="ap-field"><label>URL</label><input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://..."/></div><div className="ap-field"><label>Categoría</label><input list="ref-cats" value={category} onChange={e=>setCategory(e.target.value)}/><datalist id="ref-cats">{categories.map(c=><option key={c} value={c}/>)}</datalist></div><div className="ap-field"><label>Imagen (URL)</label><input value={imageUrl} onChange={e=>setImageUrl(e.target.value)} placeholder="https://..."/>{imageUrl&&<img src={imageUrl} alt="" style={{marginTop:'0.5rem',width:'100%',maxHeight:160,objectFit:'cover',borderRadius:8}} onError={e=>e.target.style.display='none'}/>}</div><div className="ap-field"><label>Descripción</label><textarea value={description} onChange={e=>setDescription(e.target.value)} rows={3}/></div>{error&&<p className="ap-error">{error}</p>}<div className="ap-modal-actions"><button type="button" className="ap-btn ap-btn-ghost" onClick={onClose}>Cancelar</button><button type="submit" className="ap-btn ap-btn-primary" disabled={saving||!title.trim()}>{saving?'Guardando…':isEdit?'Guardar cambios':'Añadir'}</button></div></form></div></div>);};
  return (
    <div className="ap-section">
      <ToastContainer toasts={toasts} onRemove={remove}/>
      {confirm&&<ConfirmDialog {...confirm}/>}
      {modal&&<ReferenceModal reference={modal==='new'?null:modal} onClose={()=>setModal(null)} onSaved={handleSaved}/>}
      <div className="ap-section-head"><div><h1>Referencias</h1><p>Tu tablero de inspiración.</p></div><button className="ap-btn ap-btn-primary" onClick={()=>setModal('new')}><Plus size={15}/> Añadir referencia</button></div>
      {categories.length>0&&(<div className="ap-ref-filters"><button className={`ap-catalog-pill${activeCategory==='all'?' active':''}`} onClick={()=>setActiveCategory('all')}>Todas ({references.length})</button>{categories.map(cat=>(<button key={cat} className={`ap-catalog-pill${activeCategory===cat?' active':''}`} onClick={()=>setActiveCategory(cat)}>{cat}<span className="ap-catalog-pill-count">{references.filter(r=>r.category===cat).length}</span></button>))}</div>)}
      {loading?<div className="ap-loading">Cargando…</div>:references.length===0?<div className="ap-empty"><p>No hay referencias todavía.</p></div>:(<div className="ap-ref-grid">{visible.map(ref=>(<div key={ref.id} className="ap-ref-card"><div className="ap-ref-card-img">{ref.image_url?(<img src={ref.image_url} alt={ref.title} onError={e=>{e.target.onerror=null;e.target.style.display='none';}}/>):ref.url?(<img src={`https://www.google.com/s2/favicons?domain=${getDomain(ref.url)}&sz=64`} alt={ref.title} className="ap-ref-favicon"/>):(<Bookmark size={24} style={{opacity:0.3}}/>)}</div><div className="ap-ref-card-body">{ref.category&&<span className="ap-ref-category">{ref.category}</span>}<h3 className="ap-ref-title">{ref.title}</h3>{ref.description&&<p className="ap-ref-desc">{ref.description}</p>}{ref.url&&<span className="ap-ref-domain">{getDomain(ref.url)}</span>}</div><div className="ap-ref-card-actions">{ref.url&&(<a href={ref.url} target="_blank" rel="noopener noreferrer" className="ap-btn ap-btn-primary ap-btn-sm"><ExternalLink size={12}/> Abrir</a>)}<button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={()=>setModal(ref)}><Pencil size={12}/></button><button className="ap-btn ap-btn-danger ap-btn-sm" onClick={()=>handleDelete(ref.id)}><Trash2 size={12}/></button></div></div>))}</div>)}
    </div>
  );
}

function SectionContactos() {
  const [contacts,setContacts]=useState([]); const [loading,setLoading]=useState(true); const [modal,setModal]=useState(null); const [confirm,setConfirm]=useState(null); const [activeSector,setActiveSector]=useState('all');
  const {toasts,toast,remove}=useToast();
  useEffect(()=>{api.get('/contacts').then(r=>setContacts(r.data.contacts||[])).catch(()=>toast.error('Error al cargar contactos')).finally(()=>setLoading(false));},[]);
  const sectors=[...new Set(contacts.map(c=>c.sector).filter(Boolean))].sort();
  const visible=activeSector==='all'?contacts:contacts.filter(c=>c.sector===activeSector);
  const handleSaved=(contact,isEdit)=>{setContacts(prev=>{const updated=isEdit?prev.map(c=>c.id===contact.id?contact:c):[contact,...prev];return updated.sort((a,b)=>a.name.localeCompare(b.name));});toast.success(isEdit?'Contacto actualizado':'Contacto añadido');};
  const handleDelete=(id)=>{setConfirm({message:'¿Eliminar este contacto?',onConfirm:async()=>{try{await api.delete(`/contacts/${id}`);setContacts(prev=>prev.filter(c=>c.id!==id));toast.success('Contacto eliminado');}catch{toast.error('Error al eliminar');}setConfirm(null);},onCancel:()=>setConfirm(null)});};
  const ContactModal=({contact,onClose,onSaved})=>{const isEdit=!!contact;const [name,setName]=useState(contact?.name||'');const [phone,setPhone]=useState(contact?.phone||'');const [email,setEmail]=useState(contact?.email||'');const [sector,setSector]=useState(contact?.sector||'');const [companyUrl,setCompanyUrl]=useState(contact?.company_url||'');const [description,setDescription]=useState(contact?.description||'');const [saving,setSaving]=useState(false);const [error,setError]=useState('');const handleSubmit=async(e)=>{e.preventDefault();if(!name.trim())return;setSaving(true);setError('');try{const payload={name:name.trim(),phone:phone.trim()||null,email:email.trim()||null,sector:sector.trim()||null,company_url:companyUrl.trim()||null,description:description.trim()||null};let data;if(isEdit){({data}=await api.put(`/contacts/${contact.id}`,payload));onSaved(data.contact,true);}else{({data}=await api.post('/contacts',payload));onSaved(data.contact,false);}onClose();}catch{setError('Error al guardar');}finally{setSaving(false);}};return(<div className="ap-modal-overlay" onClick={onClose}><div className="ap-modal" onClick={e=>e.stopPropagation()}><div className="ap-modal-head"><h2>{isEdit?'Editar contacto':'Nuevo contacto'}</h2><button className="ap-modal-close" onClick={onClose}><X size={16}/></button></div><form onSubmit={handleSubmit} className="ap-modal-form"><div className="ap-field"><label>Nombre *</label><input value={name} onChange={e=>setName(e.target.value)} required autoFocus/></div><div className="ap-field"><label>Sector</label><input list="contact-sectors" value={sector} onChange={e=>setSector(e.target.value)}/><datalist id="contact-sectors">{sectors.map(s=><option key={s} value={s}/>)}</datalist></div><div className="ap-field"><label>Teléfono</label><input value={phone} onChange={e=>setPhone(e.target.value)}/></div><div className="ap-field"><label>Correo</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)}/></div><div className="ap-field"><label>Web</label><input value={companyUrl} onChange={e=>setCompanyUrl(e.target.value)} placeholder="https://..."/></div><div className="ap-field"><label>Descripción</label><textarea value={description} onChange={e=>setDescription(e.target.value)} rows={3}/></div>{error&&<p className="ap-error">{error}</p>}<div className="ap-modal-actions"><button type="button" className="ap-btn ap-btn-ghost" onClick={onClose}>Cancelar</button><button type="submit" className="ap-btn ap-btn-primary" disabled={saving||!name.trim()}>{saving?'Guardando…':isEdit?'Guardar cambios':'Añadir contacto'}</button></div></form></div></div>);};
  return (
    <div className="ap-section">
      <ToastContainer toasts={toasts} onRemove={remove}/>
      {confirm&&<ConfirmDialog {...confirm}/>}
      {modal&&<ContactModal contact={modal==='new'?null:modal} onClose={()=>setModal(null)} onSaved={handleSaved}/>}
      <div className="ap-section-head"><div><h1>Contactos</h1><p>Tus proveedores y contactos de confianza.</p></div><button className="ap-btn ap-btn-primary" onClick={()=>setModal('new')}><Plus size={15}/> Nuevo contacto</button></div>
      {sectors.length>0&&(<div className="ap-ref-filters"><button className={`ap-catalog-pill${activeSector==='all'?' active':''}`} onClick={()=>setActiveSector('all')}>Todos ({contacts.length})</button>{sectors.map(s=>(<button key={s} className={`ap-catalog-pill${activeSector===s?' active':''}`} onClick={()=>setActiveSector(s)}>{s}<span className="ap-catalog-pill-count">{contacts.filter(c=>c.sector===s).length}</span></button>))}</div>)}
      {loading?<div className="ap-loading">Cargando…</div>:contacts.length===0?<div className="ap-empty"><p>No hay contactos todavía.</p></div>:(<div className="ap-contacts-list">{visible.map(c=>(<div key={c.id} className="ap-contact-row"><div className="ap-contact-avatar">{c.name.charAt(0).toUpperCase()}</div><div className="ap-contact-info"><div className="ap-contact-header"><span className="ap-contact-name">{c.name}</span>{c.sector&&<span className="ap-contact-sector">{c.sector}</span>}</div><div className="ap-contact-details">{c.phone&&(<a href={`tel:${c.phone}`} className="ap-contact-detail"><Phone size={11}/> {c.phone}</a>)}{c.email&&(<a href={`mailto:${c.email}`} className="ap-contact-detail">{c.email}</a>)}{c.company_url&&(<a href={c.company_url} target="_blank" rel="noopener noreferrer" className="ap-contact-detail ap-contact-web"><ExternalLink size={11}/> Web</a>)}</div>{c.description&&<p className="ap-contact-desc">{c.description}</p>}</div><div className="ap-contact-actions"><button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={()=>setModal(c)}><Pencil size={12}/> Editar</button><button className="ap-btn ap-btn-danger ap-btn-sm" onClick={()=>handleDelete(c.id)}><Trash2 size={12}/></button></div></div>))}</div>)}
    </div>
  );
}

const NAV_ITEMS = [
  { id:'dashboard', label:'Dashboard', Icon:BarChart2, adminOnly:true },
  { id:'trabajos', label:'Trabajos', Icon:LayoutGrid },
  { id:'proyectos', label:'Proyectos', Icon:FolderOpen },
  { id:'clientes', label:'Clientes', Icon:UserCheck },
  { id:'empleados', label:'Empleados', Icon:Users, adminOnly:true },
  { id:'presupuestos', label:'Presupuestos', Icon:Calculator, adminOnly:true },
  { id:'tareas', label:'Tareas', Icon:CheckCircle, adminOnly:true },
  { id:'catalogo', label:'Catálogo', Icon:BookOpen },
  { id:'referencias', label:'Referencias', Icon:Bookmark },
  { id:'contactos', label:'Contactos', Icon:Phone },
  { id:'ajustes', label:'Ajustes', Icon:Settings, adminOnly:true },
];

export function AdminPanel() {
  const {user,logout}=useAdminAuth();
  const navigate=useNavigate();
  const [section,setSection]=useState(user?.role==='admin_superior'?'dashboard':'trabajos');
  const handleLogout=()=>{logout();navigate('/admin');};
  return (
    <div className="ap">
      <aside className="ap-sidebar">
        <div className="ap-sidebar-logo"><img src="/iconoRanuse.ico" alt="Ranuse"/><span>Ranuse Design</span></div>
        <nav className="ap-nav">{NAV_ITEMS.filter(item=>!item.adminOnly||user?.role==='admin_superior').map(item=>(<button key={item.id} className={`ap-nav-item${section===item.id?' active':''}`} onClick={()=>setSection(item.id)}><item.Icon size={17} className="ap-nav-icon"/><span>{item.label}</span></button>))}</nav>
        <div className="ap-sidebar-footer"><p className="ap-user">{user?.email}</p><button className="ap-logout" onClick={handleLogout}><LogOut size={13}/> Cerrar sesión</button></div>
      </aside>
      <main className="ap-main">
        {section==='dashboard'&&<SectionDashboard/>}
        {section==='trabajos'&&<SectionTrabajos/>}
        {section==='proyectos'&&<SectionProyectos/>}
        {section==='clientes'&&<SectionClientes/>}
        {section==='empleados'&&<SectionEmpleados/>}
        {section==='presupuestos'&&<SectionPresupuestos/>}
        {section==='tareas'&&<SectionTareas/>}
        {section==='ajustes'&&<SectionAjustes/>}
        {section==='catalogo'&&<SectionCatalogo/>}
        {section==='referencias'&&<SectionReferencias/>}
        {section==='contactos'&&<SectionContactos/>}
      </main>
    </div>
  );
}
