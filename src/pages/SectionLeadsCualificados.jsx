import { useState, useEffect } from 'react';
import { Pencil, Trash2, Plus, X, CheckCircle, AlertCircle } from 'lucide-react';
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
  { val: 'organica',      label: '🌿 Orgánica / Cálida' },
  { val: 'oscura_tech',   label: '⚡ Oscura / Tech' },
  { val: 'negro_premium', label: '🖤 Negro Premium' },
  { val: 'mixta',         label: '🎨 Mixta' },
];
const TIPOS_ESPACIO = ['Bajo cubierta','Garaje','Habitación / sótano','Parcela exterior','Obra nueva','Local comercial','Otro'];
const EQUIPAMIENTO  = ['Fuerza completa','Cardio premium','Crossfit / funcional','Pádel interior','Mixto equilibrado','Solo cardio','Otro'];

const fmtEur = n => n ? `${Number(n).toLocaleString('es-ES')}€` : '—';

// ─────────────────────────────────────────────────────────────
// SECCIÓN LEADS CUALIFICADOS
// ─────────────────────────────────────────────────────────────
function SectionLeadsCualificados() {
  const { toasts, toast, remove } = useToast();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [panel, setPanel] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [tabModal, setTabModal] = useState('datos');
  const [filtroEstado, setFiltroEstado] = useState('all');
  const [busqueda, setBusqueda] = useState('');

  const EMPTY = {
    nombre:'', instagram:'', telefono:'', email:'',
    ubicacion_ciudad:'', ubicacion_pais:'España', direccion:'',
    metros_cuadrados:'', tipo_espacio:'',
    inversion_min:'', inversion_max:'', presupuesto_confirmado:false,
    fecha_inicio_prevista:'', fecha_entrega_prevista:'', urgencia:'normal',
    estetica:'', referencias_link:'', equipamiento_clave:'',
    marcas_preferidas:'', personalizado:'',
    necesita_duchas:false, necesita_sauna:false, otras_necesidades:'',
    notas_internas:'', prioridad:'media',
    estado:'en_cualificacion',
    link_render:'', link_presupuesto:'', link_moodboard:'', id_presupuesto:'',
    fecha_ficha: new Date().toISOString().slice(0,10),
  };
  const [form, setForm] = useState(EMPTY);

  const cargar = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/leads-cualificados');
      setLeads(data.leads || []);
    } catch { toast.error('Error al cargar fichas'); }
    setLoading(false);
  };

  useEffect(() => { cargar(); }, []);

  const filtrados = leads.filter(l => {
    if (filtroEstado !== 'all' && l.estado !== filtroEstado) return false;
    if (busqueda && !l.nombre.toLowerCase().includes(busqueda.toLowerCase())) return false;
    return true;
  });

  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const guardar = async (e) => {
    e.preventDefault();
    if (!form.nombre.trim()) return;
    setSaving(true);
    try {
      const isEdit = modal !== 'new';
      const method = isEdit ? 'put' : 'post';
      const url    = isEdit ? `/leads-cualificados/${modal.id}` : '/leads-cualificados';
      const { data } = await api[method](url, form);
      if (isEdit) {
        setLeads(prev => prev.map(l => l.id === modal.id ? data.lead : l));
        if (panel?.id === modal.id) setPanel(data.lead);
        toast.success('Ficha actualizada');
      } else {
        setLeads(prev => [data.lead, ...prev]);
        toast.success('Ficha creada');
      }
      setModal(null);
    } catch { toast.error('Error al guardar'); }
    setSaving(false);
  };

  const cambiarEstado = async (id, estado) => {
    try {
      const { data } = await api.put(`/leads-cualificados/${id}`, { estado });
      setLeads(prev => prev.map(l => l.id === id ? data.lead : l));
      if (panel?.id === id) setPanel(data.lead);
    } catch { toast.error('Error al cambiar estado'); }
  };

  const eliminar = async (id) => {
    try {
      await api.delete(`/leads-cualificados/${id}`);
      setLeads(prev => prev.filter(l => l.id !== id));
      if (panel?.id === id) setPanel(null);
      toast.success('Ficha eliminada');
    } catch { toast.error('Error al eliminar'); }
    setConfirm(null);
  };

  const abrirEditar = (lead) => {
    setForm({
      ...lead,
      fecha_inicio_prevista: lead.fecha_inicio_prevista?.slice(0,10) || '',
      fecha_entrega_prevista: lead.fecha_entrega_prevista?.slice(0,10) || '',
      fecha_ficha: lead.fecha_ficha?.slice(0,10) || '',
    });
    setTabModal('datos');
    setModal(lead);
  };

  const prioColor = { alta:'#f87171', media:'#f59e0b', baja:'#6b7280' };

  return (
    <div className="ap-section">
      <ToastContainer toasts={toasts} onRemove={remove} />
      {confirm && <ConfirmDialog message={confirm.message} onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />}

      <div className="ap-section-head">
        <div>
          <h1>Leads Cualificados</h1>
          <p>Fichas de diseño y presupuesto — antes de convertirse en proyectos</p>
        </div>
        <button className="ap-btn ap-btn-primary" onClick={() => { setForm(EMPTY); setTabModal('datos'); setModal('new'); }}>
          <Plus size={15} /> Nueva ficha
        </button>
      </div>

      {/* Pills de estado con conteo */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:12 }}>
        <button className={`ap-catalog-pill${filtroEstado==='all'?' active':''}`} onClick={() => setFiltroEstado('all')}>
          Todas ({leads.length})
        </button>
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

      {/* Buscar */}
      <div style={{ marginBottom:16 }}>
        <input placeholder="Buscar cliente..." value={busqueda} onChange={e => setBusqueda(e.target.value)} className="ap-field-input" style={{ maxWidth:260 }} />
      </div>

      {/* Grid de fichas */}
      {loading ? <div className="ap-loading">Cargando fichas…</div> : filtrados.length === 0 ? (
        <div className="ap-empty"><p>No hay fichas todavía.</p></div>
      ) : (
        <div className="ap-cp-grid">
          {filtrados.map(lead => {
            const est = CUAL_ESTADOS[lead.estado];
            return (
              <div key={lead.id} className="ap-cp-card" onClick={() => setPanel(lead)} style={{ cursor:'pointer' }}
                onMouseEnter={e => e.currentTarget.style.borderColor='rgba(190,176,162,0.3)'}
                onMouseLeave={e => e.currentTarget.style.borderColor=''}>
                <div className="ap-cp-header">
                  <div className="ap-cp-names">
                    <h3 className="ap-cp-client">{lead.nombre}</h3>
                    {lead.instagram && <p className="ap-cp-name">@{lead.instagram}</p>}
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    {lead.prioridad && <span style={{ width:8, height:8, borderRadius:'50%', background:prioColor[lead.prioridad]||'#6b7280', display:'inline-block' }}/>}
                    <span style={{ background:`${est.color}20`, color:est.color, fontSize:10, fontWeight:700, padding:'3px 8px', borderRadius:5, whiteSpace:'nowrap' }}>{est.label}</span>
                  </div>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'4px 10px', marginTop:8, fontSize:12, color:'rgba(255,255,255,0.5)' }}>
                  {lead.ubicacion_ciudad && <span>📍 {lead.ubicacion_ciudad}{lead.metros_cuadrados?` · ${lead.metros_cuadrados}m²`:''}</span>}
                  {lead.tipo_espacio && <span>🏠 {lead.tipo_espacio}</span>}
                  {(lead.inversion_min||lead.inversion_max) && <span>💰 {fmtEur(lead.inversion_min)} – {fmtEur(lead.inversion_max)}</span>}
                  {lead.estetica && <span>🎨 {ESTETICAS.find(e=>e.val===lead.estetica)?.label?.slice(3)||lead.estetica}</span>}
                </div>
                {(lead.link_render||lead.link_presupuesto||lead.id_presupuesto) && (
                  <div style={{ display:'flex', gap:6, marginTop:10 }} onClick={e => e.stopPropagation()}>
                    {lead.link_render && <a href={lead.link_render} target="_blank" rel="noreferrer" style={{ fontSize:11, color:'#8b5cf6', background:'#3b1f6e33', padding:'3px 8px', borderRadius:4, textDecoration:'none' }}>🖼 Render</a>}
                    {lead.link_presupuesto && <a href={lead.link_presupuesto} target="_blank" rel="noreferrer" style={{ fontSize:11, color:'#06b6d4', background:'#0a3d4a33', padding:'3px 8px', borderRadius:4, textDecoration:'none' }}>📄 Ppto</a>}
                    {lead.id_presupuesto && <span style={{ fontSize:11, color:'#beb0a2', background:'rgba(190,176,162,0.1)', padding:'3px 8px', borderRadius:4 }}>{lead.id_presupuesto}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Panel lateral detalle */}
      {panel && (
        <div style={{ position:'fixed', top:0, right:0, width:380, height:'100vh', background:'#1a1612', borderLeft:'1px solid rgba(255,255,255,0.08)', zIndex:200, overflowY:'auto', padding:24 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:14 }}>
            <div>
              <div style={{ fontSize:17, fontWeight:700, color:'#beb0a2' }}>{panel.nombre}</div>
              {panel.instagram && <div style={{ fontSize:12, color:'rgba(255,255,255,0.3)' }}>@{panel.instagram}</div>}
            </div>
            <button onClick={() => setPanel(null)} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.3)', fontSize:18, cursor:'pointer' }}>✕</button>
          </div>

          {/* Estado + cambio rápido */}
          <div style={{ marginBottom:14 }}>
            <span style={{ background:`${CUAL_ESTADOS[panel.estado]?.color}20`, border:`1px solid ${CUAL_ESTADOS[panel.estado]?.color}40`, borderRadius:8, padding:'6px 14px', color:CUAL_ESTADOS[panel.estado]?.color, fontWeight:700, fontSize:13 }}>
              {CUAL_ESTADOS[panel.estado]?.label}
            </span>
            <div style={{ marginTop:8, display:'flex', gap:5, flexWrap:'wrap' }}>
              {CUAL_ORDEN.filter(e => e !== panel.estado).map(e => (
                <button key={e} onClick={() => cambiarEstado(panel.id, e)}
                  style={{ fontSize:10, background:`${CUAL_ESTADOS[e].color}15`, color:CUAL_ESTADOS[e].color, border:`1px solid ${CUAL_ESTADOS[e].color}30`, borderRadius:4, padding:'3px 7px', cursor:'pointer', fontFamily:'inherit' }}>
                  {CUAL_ESTADOS[e].label}
                </button>
              ))}
            </div>
          </div>

          {/* Info en filas */}
          {[
            ['Ciudad',       panel.ubicacion_ciudad ? `${panel.ubicacion_ciudad}${panel.ubicacion_pais&&panel.ubicacion_pais!=='España'?`, ${panel.ubicacion_pais}`:''}` : '—'],
            ['Espacio',      panel.tipo_espacio || '—'],
            ['Metros²',      panel.metros_cuadrados ? `${panel.metros_cuadrados} m²` : '—'],
            ['Inversión',    (panel.inversion_min||panel.inversion_max) ? `${fmtEur(panel.inversion_min)} – ${fmtEur(panel.inversion_max)}` : '—'],
            ['Confirmado',   panel.presupuesto_confirmado ? '✅ Sí' : '⬜ No'],
            ['Urgencia',     panel.urgencia || '—'],
            ['Inicio prev.', panel.fecha_inicio_prevista?.slice(0,10) || '—'],
            ['Estética',     ESTETICAS.find(e=>e.val===panel.estetica)?.label || '—'],
            ['Equipamiento', panel.equipamiento_clave || '—'],
            ['Marcas',       panel.marcas_preferidas || '—'],
            ['Personaliz.',  panel.personalizado || '—'],
            ['Duchas',       panel.necesita_duchas ? '✅ Sí' : 'No'],
            ['Sauna',        panel.necesita_sauna ? '✅ Sí' : 'No'],
            ['Nº Presup.',   panel.id_presupuesto || '—'],
          ].map(([k,v]) => (
            <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:'1px solid rgba(255,255,255,0.05)', fontSize:12 }}>
              <span style={{ color:'rgba(255,255,255,0.3)' }}>{k}</span>
              <span style={{ color:'#e5ddd5', textAlign:'right', maxWidth:'60%' }}>{v}</span>
            </div>
          ))}

          {(panel.link_render||panel.link_presupuesto||panel.link_moodboard) && (
            <div style={{ marginTop:14 }}>
              <div style={{ fontSize:11, color:'rgba(255,255,255,0.3)', textTransform:'uppercase', letterSpacing:1, marginBottom:6 }}>Archivos</div>
              {panel.link_render && <a href={panel.link_render} target="_blank" rel="noreferrer" style={{ display:'block', color:'#8b5cf6', fontSize:12, marginBottom:4 }}>🖼 Render</a>}
              {panel.link_presupuesto && <a href={panel.link_presupuesto} target="_blank" rel="noreferrer" style={{ display:'block', color:'#06b6d4', fontSize:12, marginBottom:4 }}>📄 Presupuesto</a>}
              {panel.link_moodboard && <a href={panel.link_moodboard} target="_blank" rel="noreferrer" style={{ display:'block', color:'#f59e0b', fontSize:12 }}>📌 Moodboard</a>}
            </div>
          )}

          {panel.notas_internas && (
            <div style={{ marginTop:14, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:8, padding:12, fontSize:13, color:'rgba(255,255,255,0.5)', lineHeight:1.6 }}>
              {panel.notas_internas}
            </div>
          )}

          <div style={{ display:'flex', gap:8, marginTop:18, flexWrap:'wrap' }}>
            <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => { abrirEditar(panel); setPanel(null); }}>
              <Pencil size={13}/> Editar ficha
            </button>
            <button className="ap-btn ap-btn-danger ap-btn-sm" onClick={() => setConfirm({ message:`¿Eliminar la ficha de ${panel.nombre}?`, onConfirm:()=>eliminar(panel.id) })}>
              <Trash2 size={13}/>
            </button>
          </div>
          {panel.estado !== 'convertido' && (
            <button className="ap-btn ap-btn-primary ap-btn-sm" style={{ width:'100%', marginTop:8, justifyContent:'center' }} onClick={() => cambiarEstado(panel.id,'convertido')}>
              ✅ Convertir en Proyecto
            </button>
          )}
        </div>
      )}

      {/* Modal ficha completa con tabs */}
      {modal && (
        <div className="ap-modal-overlay" onClick={() => setModal(null)}>
          <div className="ap-mgr-modal" onClick={e => e.stopPropagation()} style={{ maxWidth:600 }}>
            <div className="ap-mgr-head">
              <div>
                <h2 style={{ fontSize:16, fontWeight:700, color:'#beb0a2', margin:0 }}>
                  {modal === 'new' ? 'Nueva ficha de cualificación' : `Editar — ${modal.nombre}`}
                </h2>
              </div>
              <button className="ap-modal-close" onClick={() => setModal(null)}><X size={16}/></button>
            </div>

            {/* Tabs */}
            <div className="ap-mgr-tabs">
              {[{id:'datos',label:'📋 Datos'},{id:'espacio',label:'📍 Espacio'},{id:'diseño',label:'🎨 Diseño'},{id:'gestion',label:'⚙️ Gestión'}].map(t => (
                <button key={t.id} className={`ap-mgr-tab${tabModal===t.id?' active':''}`} onClick={() => setTabModal(t.id)}>{t.label}</button>
              ))}
            </div>

            <form onSubmit={guardar}>
              <div className="ap-mgr-body" style={{ maxHeight:'60vh', overflowY:'auto', padding:'20px 24px' }}>

                {/* TAB DATOS */}
                {tabModal === 'datos' && (
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 16px' }}>
                    <div className="ap-field" style={{ gridColumn:'1/-1' }}><label>Nombre *</label><input value={form.nombre} onChange={e=>setF('nombre',e.target.value)} required autoFocus placeholder="Juan Lebrón"/></div>
                    <div className="ap-field"><label>Instagram</label><input value={form.instagram} onChange={e=>setF('instagram',e.target.value)} placeholder="@handle sin @"/></div>
                    <div className="ap-field"><label>Teléfono</label><input value={form.telefono} onChange={e=>setF('telefono',e.target.value)} placeholder="+34 600 000 000"/></div>
                    <div className="ap-field"><label>Email</label><input value={form.email} onChange={e=>setF('email',e.target.value)} placeholder="correo@gmail.com"/></div>
                    <div className="ap-field"><label>Estado</label>
                      <select className="ap-select" value={form.estado} onChange={e=>setF('estado',e.target.value)}>
                        {CUAL_ORDEN.map(e=><option key={e} value={e}>{CUAL_ESTADOS[e].label}</option>)}
                      </select>
                    </div>
                    <div className="ap-field"><label>Prioridad</label>
                      <select className="ap-select" value={form.prioridad} onChange={e=>setF('prioridad',e.target.value)}>
                        <option value="alta">🔴 Alta</option>
                        <option value="media">🟡 Media</option>
                        <option value="baja">🟢 Baja</option>
                      </select>
                    </div>
                    <div className="ap-field"><label>Fecha ficha</label><input type="date" value={form.fecha_ficha} onChange={e=>setF('fecha_ficha',e.target.value)}/></div>
                  </div>
                )}

                {/* TAB ESPACIO */}
                {tabModal === 'espacio' && (
                  <>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 16px' }}>
                      <div className="ap-field"><label>Ciudad</label><input value={form.ubicacion_ciudad} onChange={e=>setF('ubicacion_ciudad',e.target.value)} placeholder="Madrid, Barcelona..."/></div>
                      <div className="ap-field"><label>País</label><input value={form.ubicacion_pais} onChange={e=>setF('ubicacion_pais',e.target.value)}/></div>
                      <div className="ap-field"><label>Metros²</label><input type="number" value={form.metros_cuadrados} onChange={e=>setF('metros_cuadrados',e.target.value)} placeholder="50"/></div>
                      <div className="ap-field"><label>Tipo de espacio</label>
                        <select className="ap-select" value={form.tipo_espacio} onChange={e=>setF('tipo_espacio',e.target.value)}>
                          <option value="">— Seleccionar —</option>
                          {TIPOS_ESPACIO.map(t=><option key={t}>{t}</option>)}
                        </select>
                      </div>
                      <div className="ap-field"><label>Inversión mínima (€)</label><input type="number" value={form.inversion_min} onChange={e=>setF('inversion_min',e.target.value)} placeholder="15000"/></div>
                      <div className="ap-field"><label>Inversión máxima (€)</label><input type="number" value={form.inversion_max} onChange={e=>setF('inversion_max',e.target.value)} placeholder="40000"/></div>
                      <div className="ap-field"><label>Urgencia</label>
                        <select className="ap-select" value={form.urgencia} onChange={e=>setF('urgencia',e.target.value)}>
                          <option value="urgente">🔴 Urgente (&lt;1 mes)</option>
                          <option value="normal">🟡 Normal (1-3 meses)</option>
                          <option value="flexible">🟢 Flexible (&gt;3 meses)</option>
                        </select>
                      </div>
                      <div className="ap-field"><label>Inicio previsto</label><input type="date" value={form.fecha_inicio_prevista} onChange={e=>setF('fecha_inicio_prevista',e.target.value)}/></div>
                      <div className="ap-field"><label>Entrega prevista</label><input type="date" value={form.fecha_entrega_prevista} onChange={e=>setF('fecha_entrega_prevista',e.target.value)}/></div>
                    </div>
                    <div className="ap-field"><label>Dirección</label><input value={form.direccion} onChange={e=>setF('direccion',e.target.value)} placeholder="Calle, número, piso..."/></div>
                    <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, color:'rgba(255,255,255,0.6)', marginTop:4 }}>
                      <input type="checkbox" checked={form.presupuesto_confirmado} onChange={e=>setF('presupuesto_confirmado',e.target.checked)}/>
                      Presupuesto confirmado por el cliente
                    </label>
                  </>
                )}

                {/* TAB DISEÑO */}
                {tabModal === 'diseño' && (
                  <>
                    <div className="ap-field">
                      <label>Estética deseada</label>
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                        {ESTETICAS.map(e => (
                          <button key={e.val} type="button" onClick={() => setF('estetica', e.val)}
                            style={{ background: form.estetica===e.val ? 'rgba(190,176,162,0.15)' : 'rgba(255,255,255,0.03)', border:`1px solid ${form.estetica===e.val ? '#beb0a2' : 'rgba(255,255,255,0.1)'}`, borderRadius:8, padding:'10px 14px', cursor:'pointer', color: form.estetica===e.val ? '#beb0a2' : 'rgba(255,255,255,0.4)', fontFamily:'inherit', fontSize:13, textAlign:'left' }}>
                            {e.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 16px' }}>
                      <div className="ap-field"><label>Equipamiento clave</label>
                        <select className="ap-select" value={form.equipamiento_clave} onChange={e=>setF('equipamiento_clave',e.target.value)}>
                          <option value="">— Seleccionar —</option>
                          {EQUIPAMIENTO.map(eq=><option key={eq}>{eq}</option>)}
                        </select>
                      </div>
                      <div className="ap-field"><label>Marcas preferidas</label><input value={form.marcas_preferidas} onChange={e=>setF('marcas_preferidas',e.target.value)} placeholder="Akon, Technogym, Rogue..."/></div>
                    </div>
                    <div className="ap-field"><label>Personalización</label><input value={form.personalizado} onChange={e=>setF('personalizado',e.target.value)} placeholder="Logo del jugador, colores del equipo..."/></div>
                    <div className="ap-field"><label>Referencias / moodboard (link)</label><input value={form.referencias_link} onChange={e=>setF('referencias_link',e.target.value)} placeholder="https://..."/></div>
                    <div style={{ display:'flex', gap:20, margin:'12px 0' }}>
                      <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, color:'rgba(255,255,255,0.6)' }}>
                        <input type="checkbox" checked={form.necesita_duchas} onChange={e=>setF('necesita_duchas',e.target.checked)}/> Zona de duchas / aseo
                      </label>
                      <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, color:'rgba(255,255,255,0.6)' }}>
                        <input type="checkbox" checked={form.necesita_sauna} onChange={e=>setF('necesita_sauna',e.target.checked)}/> Sauna / recuperación
                      </label>
                    </div>
                    <div className="ap-field"><label>Otras necesidades</label><textarea value={form.otras_necesidades} onChange={e=>setF('otras_necesidades',e.target.value)} rows={3} placeholder="Zona de estiramientos, TV, sonido..."/></div>
                  </>
                )}

                {/* TAB GESTIÓN */}
                {tabModal === 'gestion' && (
                  <>
                    <div className="ap-field"><label>Nº Presupuesto Ranuse</label><input value={form.id_presupuesto} onChange={e=>setF('id_presupuesto',e.target.value)} placeholder="RAN-042"/></div>
                    <div className="ap-field"><label>Link Render / D5</label><input value={form.link_render} onChange={e=>setF('link_render',e.target.value)} placeholder="https://..."/></div>
                    <div className="ap-field"><label>Link Presupuesto PDF</label><input value={form.link_presupuesto} onChange={e=>setF('link_presupuesto',e.target.value)} placeholder="https://..."/></div>
                    <div className="ap-field"><label>Link Moodboard / Keypano</label><input value={form.link_moodboard} onChange={e=>setF('link_moodboard',e.target.value)} placeholder="https://..."/></div>
                    <div className="ap-field"><label>Notas internas</label><textarea value={form.notas_internas} onChange={e=>setF('notas_internas',e.target.value)} rows={4} placeholder="Observaciones, seguimiento, contexto interno..."/></div>
                  </>
                )}
              </div>

              {/* Footer */}
              <div style={{ padding:'14px 24px', borderTop:'1px solid rgba(255,255,255,0.08)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div style={{ display:'flex', gap:6 }}>
                  {[{id:'datos',label:'Datos'},{id:'espacio',label:'Espacio'},{id:'diseño',label:'Diseño'},{id:'gestion',label:'Gestión'}].map(t=>(
                    <button key={t.id} type="button" onClick={()=>setTabModal(t.id)} style={{ background:'none', border:'none', color: tabModal===t.id ? '#beb0a2' : 'rgba(255,255,255,0.25)', fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>{t.label}</button>
                  ))}
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <button type="button" className="ap-btn ap-btn-ghost" onClick={() => setModal(null)}>Cancelar</button>
                  <button type="submit" className="ap-btn ap-btn-primary" disabled={saving || !form.nombre.trim()}>
                    {saving ? 'Guardando...' : modal === 'new' ? 'Crear ficha' : 'Guardar cambios'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export { SectionLeadsCualificados };
