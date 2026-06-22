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

const ESTADOS = {
  contacto:               { label: 'Contacto',              color: '#3b82f6', fecha: 'fecha_contacto' },
  respuesta_chat:         { label: 'Respuesta chat',        color: '#f59e0b', fecha: 'fecha_respuesta' },
  llamada_descubrimiento: { label: 'Llamada',               color: '#8b5cf6', fecha: 'fecha_llamada' },
  diseño:                 { label: 'Diseño',                color: '#06b6d4', fecha: 'fecha_diseño' },
  venta:                  { label: 'Venta ✓',               color: '#beb0a2', fecha: 'fecha_venta' },
  rechazo:                { label: 'Rechazo',               color: '#f87171', fecha: null },
  enfriado:               { label: 'Enfriado',              color: '#f97316', fecha: null },
  descartado:             { label: 'Descartado',            color: '#6b7280', fecha: null },
};
const ORDEN = ['contacto','respuesta_chat','llamada_descubrimiento','diseño','venta','rechazo','enfriado','descartado'];
const CANALES = ['instagram','whatsapp','web','recomendacion','ads','evento','agente','otro'];
const DEPORTES = ['Fútbol','Pádel','Baloncesto','Tenis','MotoGP','Ciclismo','Otro'];
const LIGAS = ['LaLiga','Hypermotion','Primera RFEF','Liga F','ACB','WPT','Bundesliga','Premier','Serie A','Otro'];

const fmtEur = n => n ? `${Number(n).toLocaleString('es-ES')}€` : '—';
const fmtPct = n => `${n}%`;

const EMPTY = {
  nombre:'', perfil:'', deporte:'Fútbol', liga:'', instagram:'',
  telefono:'', email:'', origen:'outbound', canal:'instagram',
  estado:'contacto', valor_estimado:'', pct_cierre:20, notas:'',
  fecha_contacto: new Date().toISOString().slice(0,10),
  fecha_respuesta:'', fecha_llamada:'', fecha_diseño:'', fecha_venta:'',
};

export function SectionLeads() {
  const { toasts, toast, remove } = useToast();
  const [leads, setLeads] = useState([]);
  const [metricas, setMetricas] = useState({});
  const [porEstado, setPorEstado] = useState({});
  const [porCanal, setPorCanal] = useState({});
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [panel, setPanel] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [filtroEstado, setFiltroEstado] = useState('all');
  const [filtroOrigen, setFiltroOrigen] = useState('all');
  const [busqueda, setBusqueda] = useState('');
  const [vistaMetricas, setVistaMetricas] = useState(false);

  const cargar = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/leads');
      setLeads(data.leads || []);
      setMetricas(data.metricas || {});
      setPorEstado(data.porEstado || {});
      setPorCanal(data.porCanal || {});
    } catch { toast.error('Error al cargar leads'); }
    setLoading(false);
  };

  useEffect(() => { cargar(); }, []);

  const filtrados = leads.filter(l => {
    if (filtroEstado !== 'all' && l.estado !== filtroEstado) return false;
    if (filtroOrigen !== 'all' && l.origen !== filtroOrigen) return false;
    if (busqueda && !l.nombre.toLowerCase().includes(busqueda.toLowerCase()) &&
        !(l.instagram||'').toLowerCase().includes(busqueda.toLowerCase())) return false;
    return true;
  });

  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const guardar = async (e) => {
    e.preventDefault();
    if (!form.nombre.trim()) return;
    setSaving(true);
    try {
      const isEdit = modal !== 'new';
      const { data } = await api[isEdit ? 'put' : 'post'](isEdit ? `/leads/${modal.id}` : '/leads', form);
      toast.success(isEdit ? 'Lead actualizado' : 'Lead creado');
      await cargar();
      setModal(null);
      if (isEdit && panel?.id === modal.id) setPanel(data.lead);
    } catch { toast.error('Error al guardar'); }
    setSaving(false);
  };

  const cambiarEstado = async (id, estado) => {
    try {
      // Si pasa a diseño, crear ficha de cualificado automáticamente
      const lead = leads.find(l => l.id === id);
      const { data } = await api.put(`/leads/${id}`, { estado });
      if (estado === 'diseño' && lead) {
        try {
          await api.post('/leads-cualificados', {
            lead_id: id,
            nombre: lead.nombre,
            instagram: lead.instagram,
            telefono: lead.telefono,
            email: lead.email,
            estado: 'en_cualificacion',
          });
          toast.success('Lead movido a Diseño y ficha de cualificación creada');
        } catch { /* ya existe o error menor */ }
      }
      setLeads(prev => prev.map(l => l.id === id ? data.lead : l));
      if (panel?.id === id) setPanel(data.lead);
    } catch { toast.error('Error al cambiar estado'); }
  };

  const eliminar = async (id) => {
    try {
      await api.delete(`/leads/${id}`);
      setLeads(prev => prev.filter(l => l.id !== id));
      if (panel?.id === id) setPanel(null);
      toast.success('Lead eliminado');
    } catch { toast.error('Error al eliminar'); }
    setConfirm(null);
  };

  const abrirEditar = (lead) => {
    setForm({
      ...lead,
      fecha_contacto: lead.fecha_contacto?.slice(0,10) || '',
      fecha_respuesta: lead.fecha_respuesta?.slice(0,10) || '',
      fecha_llamada: lead.fecha_llamada?.slice(0,10) || '',
      fecha_diseño: lead.fecha_diseño?.slice(0,10) || '',
      fecha_venta: lead.fecha_venta?.slice(0,10) || '',
    });
    setModal(lead);
  };

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="ap-section">
      <ToastContainer toasts={toasts} onRemove={remove} />
      {confirm && <ConfirmDialog message={confirm.message} onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />}

      {/* Header */}
      <div className="ap-section-head">
        <div>
          <h1>Leads</h1>
          <p>Pipeline de ventas — inbound y outbound</p>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="ap-btn ap-btn-ghost" onClick={() => setVistaMetricas(v => !v)}>
            {vistaMetricas ? 'Ver kanban' : '📊 Ver métricas'}
          </button>
          <button className="ap-btn ap-btn-primary" onClick={() => { setForm(EMPTY); setModal('new'); }}>
            <Plus size={15} /> Nuevo lead
          </button>
        </div>
      </div>

      {/* Métricas resumen siempre visible */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))', gap:8, marginBottom:16 }}>
        {[
          { label:'Total',          val: metricas.total || 0 },
          { label:'Activos',        val: metricas.activos || 0 },
          { label:'Ventas',         val: metricas.ventas || 0, color:'#beb0a2' },
          { label:'Cierre global',  val: fmtPct(metricas.tasaCierreGlobal || 0), color:'#beb0a2' },
          { label:'Resp. chat',     val: fmtPct(metricas.tasaRespuesta || 0) },
          { label:'→ Llamada',      val: fmtPct(metricas.tasaLlamada || 0) },
          { label:'→ Diseño',       val: fmtPct(metricas.tasaDiseño || 0) },
          { label:'→ Venta',        val: fmtPct(metricas.tasaVenta || 0), color:'#22c55e' },
        ].map(m => (
          <div key={m.label} style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:8, padding:'10px 14px' }}>
            <div style={{ fontSize:10, color:'rgba(255,255,255,0.3)', textTransform:'uppercase', letterSpacing:1, marginBottom:3 }}>{m.label}</div>
            <div style={{ fontSize:18, fontWeight:700, color: m.color || '#fff' }}>{m.val}</div>
          </div>
        ))}
      </div>

      {/* Vista métricas detalladas */}
      {vistaMetricas && (
        <div style={{ marginBottom:20 }}>
          {/* Funnel visual */}
          <div style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:10, padding:'16px 20px', marginBottom:12 }}>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.3)', textTransform:'uppercase', letterSpacing:1, marginBottom:12 }}>Embudo de ventas</div>
            <div style={{ display:'flex', gap:4, alignItems:'flex-end' }}>
              {ORDEN.slice(0,5).map((e, i) => {
                const n = porEstado[e] || 0;
                const max = porEstado['contacto'] || 1;
                const height = Math.max(20, Math.round((n / max) * 100));
                return (
                  <div key={e} style={{ flex:1, textAlign:'center' }}>
                    <div style={{ fontSize:12, fontWeight:700, color: ESTADOS[e].color, marginBottom:4 }}>{n}</div>
                    <div style={{ height, background:`${ESTADOS[e].color}40`, border:`1px solid ${ESTADOS[e].color}60`, borderRadius:'4px 4px 0 0', transition:'height .3s' }} />
                    <div style={{ fontSize:9, color:'rgba(255,255,255,0.3)', marginTop:4, textTransform:'uppercase', letterSpacing:0.5 }}>{ESTADOS[e].label}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Por canal */}
          <div style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:10, padding:'16px 20px' }}>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.3)', textTransform:'uppercase', letterSpacing:1, marginBottom:12 }}>Por canal</div>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {Object.entries(porCanal).sort((a,b) => b[1].total - a[1].total).map(([canal, d]) => {
                const tasa = d.total > 0 ? Math.round((d.ventas / d.total) * 100) : 0;
                const pct = d.total > 0 ? Math.round((d.total / (metricas.total || 1)) * 100) : 0;
                return (
                  <div key={canal} style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <div style={{ width:90, fontSize:12, color:'#beb0a2', textTransform:'capitalize' }}>{canal}</div>
                    <div style={{ flex:1, height:6, background:'rgba(255,255,255,0.05)', borderRadius:3, overflow:'hidden' }}>
                      <div style={{ width:`${pct}%`, height:'100%', background:'#beb0a2', borderRadius:3 }} />
                    </div>
                    <div style={{ width:30, fontSize:12, color:'rgba(255,255,255,0.5)', textAlign:'right' }}>{d.total}</div>
                    <div style={{ width:50, fontSize:11, color: tasa > 0 ? '#22c55e' : 'rgba(255,255,255,0.2)', textAlign:'right' }}>{tasa}% vta</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16, alignItems:'center' }}>
        <input placeholder="Buscar..." value={busqueda} onChange={e => setBusqueda(e.target.value)} className="ap-field-input" style={{ maxWidth:200 }} />
        <select className="ap-select" value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
          <option value="all">Todos los estados</option>
          {ORDEN.map(e => <option key={e} value={e}>{ESTADOS[e].label} ({porEstado[e]||0})</option>)}
        </select>
        <select className="ap-select" value={filtroOrigen} onChange={e => setFiltroOrigen(e.target.value)}>
          <option value="all">Inbound + Outbound</option>
          <option value="inbound">📥 Inbound</option>
          <option value="outbound">📤 Outbound</option>
        </select>
        <span style={{ marginLeft:'auto', color:'rgba(255,255,255,0.3)', fontSize:13 }}>{filtrados.length} leads</span>
      </div>

      {/* Kanban */}
      {loading ? <div className="ap-loading">Cargando leads…</div> : (
        <div style={{ overflowX:'auto' }}>
          <div style={{ display:'flex', gap:10, minWidth:1000 }}>
            {ORDEN.map(estado => {
              const col = filtrados.filter(l => l.estado === estado);
              const est = ESTADOS[estado];
              return (
                <div key={estado} style={{ flex:1, minWidth:130 }}>
                  <div style={{ background:`${est.color}15`, border:`1px solid ${est.color}30`, borderRadius:'8px 8px 0 0', padding:'6px 10px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ color:est.color, fontWeight:700, fontSize:10, textTransform:'uppercase', letterSpacing:1 }}>{est.label}</span>
                    <span style={{ background:`${est.color}30`, color:est.color, borderRadius:999, padding:'1px 6px', fontSize:10, fontWeight:700 }}>{col.length}</span>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                    {col.length === 0 && (
                      <div style={{ border:`1px dashed ${est.color}20`, borderRadius:'0 0 8px 8px', padding:12, textAlign:'center', color:'rgba(255,255,255,0.1)', fontSize:11 }}>vacío</div>
                    )}
                    {col.map((lead, i) => (
                      <div key={lead.id} onClick={() => setPanel(lead)}
                        style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)', borderRadius: i === col.length-1 ? '0 0 8px 8px' : 6, padding:'9px 10px', cursor:'pointer' }}
                        onMouseEnter={e => e.currentTarget.style.borderColor='rgba(190,176,162,0.3)'}
                        onMouseLeave={e => e.currentTarget.style.borderColor='rgba(255,255,255,0.08)'}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:4 }}>
                          <span style={{ fontSize:12, fontWeight:600, color:'#e5ddd5', lineHeight:1.3 }}>{lead.nombre}</span>
                          <span style={{ fontSize:8, background: lead.origen==='inbound' ? '#0a3d4a' : '#3b1f6e', color: lead.origen==='inbound' ? '#06b6d4' : '#8b5cf6', borderRadius:3, padding:'2px 4px', whiteSpace:'nowrap', flexShrink:0 }}>
                            {lead.origen === 'inbound' ? 'IN' : 'OUT'}
                          </span>
                        </div>
                        {lead.deporte && <div style={{ fontSize:10, color:'rgba(255,255,255,0.3)', marginTop:2 }}>{lead.deporte}</div>}
                        {lead.valor_estimado > 0 && <div style={{ fontSize:11, color:'#beb0a2', fontWeight:600, marginTop:4 }}>{Number(lead.valor_estimado).toLocaleString('es-ES')}€</div>}
                        {/* Cambio rápido */}
                        <div onClick={e => e.stopPropagation()} style={{ marginTop:6, display:'flex', gap:3, flexWrap:'wrap' }}>
                          {ORDEN.filter(e => e !== estado).slice(0,2).map(e => (
                            <button key={e} onClick={() => cambiarEstado(lead.id, e)}
                              style={{ fontSize:8, background:`${ESTADOS[e].color}15`, color:ESTADOS[e].color, border:`1px solid ${ESTADOS[e].color}40`, borderRadius:3, padding:'2px 4px', cursor:'pointer', fontFamily:'inherit' }}>
                              {ESTADOS[e].label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Panel lateral */}
      {panel && (
        <div style={{ position:'fixed', top:0, right:0, width:360, height:'100vh', background:'#1a1612', borderLeft:'1px solid rgba(255,255,255,0.08)', zIndex:200, overflowY:'auto', padding:24 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:14 }}>
            <div>
              <div style={{ fontSize:17, fontWeight:700, color:'#beb0a2' }}>{panel.nombre}</div>
              {panel.instagram && <div style={{ fontSize:12, color:'rgba(255,255,255,0.3)' }}>@{panel.instagram}</div>}
            </div>
            <button onClick={() => setPanel(null)} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.3)', fontSize:18, cursor:'pointer' }}>✕</button>
          </div>

          <div style={{ marginBottom:12 }}>
            <span style={{ background:`${ESTADOS[panel.estado]?.color}20`, border:`1px solid ${ESTADOS[panel.estado]?.color}40`, borderRadius:8, padding:'5px 12px', color:ESTADOS[panel.estado]?.color, fontWeight:700, fontSize:12 }}>
              {ESTADOS[panel.estado]?.label}
            </span>
          </div>
          <div style={{ marginBottom:14, display:'flex', gap:4, flexWrap:'wrap' }}>
            {ORDEN.filter(e => e !== panel.estado).map(e => (
              <button key={e} onClick={() => cambiarEstado(panel.id, e)}
                style={{ fontSize:9, background:`${ESTADOS[e].color}15`, color:ESTADOS[e].color, border:`1px solid ${ESTADOS[e].color}30`, borderRadius:4, padding:'3px 6px', cursor:'pointer', fontFamily:'inherit' }}>
                {ESTADOS[e].label}
              </button>
            ))}
          </div>

          {[
            ['Origen',      panel.origen === 'inbound' ? '📥 Inbound' : '📤 Outbound'],
            ['Canal',       panel.canal || '—'],
            ['Deporte',     [panel.deporte, panel.liga].filter(Boolean).join(' · ') || '—'],
            ['Teléfono',    panel.telefono || '—'],
            ['Email',       panel.email || '—'],
            ['Inversión',   fmtEur(panel.valor_estimado)],
            ['% Cierre',    `${panel.pct_cierre||0}%`],
            ['📅 Contacto', panel.fecha_contacto?.slice(0,10) || '—'],
            ['📅 Respuesta',panel.fecha_respuesta?.slice(0,10) || '—'],
            ['📅 Llamada',  panel.fecha_llamada?.slice(0,10) || '—'],
            ['📅 Diseño',   panel.fecha_diseño?.slice(0,10) || '—'],
            ['📅 Venta',    panel.fecha_venta?.slice(0,10) || '—'],
          ].map(([k,v]) => (
            <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:'1px solid rgba(255,255,255,0.05)', fontSize:12 }}>
              <span style={{ color:'rgba(255,255,255,0.3)' }}>{k}</span>
              <span style={{ color:'#e5ddd5' }}>{v}</span>
            </div>
          ))}

          {panel.notas && (
            <div style={{ marginTop:12, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:8, padding:10, fontSize:12, color:'rgba(255,255,255,0.5)', lineHeight:1.6 }}>
              {panel.notas}
            </div>
          )}

          <div style={{ display:'flex', gap:8, marginTop:16 }}>
            <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => { abrirEditar(panel); setPanel(null); }}>
              <Pencil size={13}/> Editar
            </button>
            <button className="ap-btn ap-btn-danger ap-btn-sm" onClick={() => setConfirm({ message:`¿Eliminar a ${panel.nombre}?`, onConfirm:()=>eliminar(panel.id) })}>
              <Trash2 size={13}/>
            </button>
          </div>
        </div>
      )}

      {/* Modal crear/editar */}
      {modal && (
        <div className="ap-modal-overlay" onClick={() => setModal(null)}>
          <div className="ap-modal" onClick={e => e.stopPropagation()} style={{ maxWidth:580 }}>
            <div className="ap-modal-head">
              <h2>{modal === 'new' ? 'Nuevo lead' : 'Editar lead'}</h2>
              <button className="ap-modal-close" onClick={() => setModal(null)}><X size={16}/></button>
            </div>
            <form onSubmit={guardar} className="ap-modal-form">
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 16px' }}>
                <div className="ap-field" style={{ gridColumn:'1/-1' }}><label>Nombre *</label><input value={form.nombre} onChange={e => setF('nombre', e.target.value)} required autoFocus placeholder="Ej: Rubén Yáñez" /></div>
                <div className="ap-field"><label>Perfil</label><input value={form.perfil} onChange={e => setF('perfil', e.target.value)} placeholder="Portero, Delantero..." /></div>
                <div className="ap-field"><label>Deporte</label>
                  <select className="ap-select" value={form.deporte} onChange={e => setF('deporte', e.target.value)}>
                    {DEPORTES.map(d => <option key={d}>{d}</option>)}
                  </select>
                </div>
                <div className="ap-field"><label>Liga</label>
                  <select className="ap-select" value={form.liga} onChange={e => setF('liga', e.target.value)}>
                    <option value="">— sin liga —</option>
                    {LIGAS.map(l => <option key={l}>{l}</option>)}
                  </select>
                </div>
                <div className="ap-field"><label>Instagram</label><input value={form.instagram} onChange={e => setF('instagram', e.target.value)} placeholder="handle sin @" /></div>
                <div className="ap-field"><label>Teléfono</label><input value={form.telefono} onChange={e => setF('telefono', e.target.value)} placeholder="+34 600 000 000" /></div>
                <div className="ap-field"><label>Email</label><input value={form.email} onChange={e => setF('email', e.target.value)} placeholder="correo@gmail.com" /></div>
                <div className="ap-field"><label>Origen</label>
                  <select className="ap-select" value={form.origen} onChange={e => setF('origen', e.target.value)}>
                    <option value="outbound">📤 Outbound</option>
                    <option value="inbound">📥 Inbound</option>
                  </select>
                </div>
                <div className="ap-field"><label>Canal</label>
                  <select className="ap-select" value={form.canal} onChange={e => setF('canal', e.target.value)}>
                    {CANALES.map(c => <option key={c} value={c} style={{ textTransform:'capitalize' }}>{c}</option>)}
                  </select>
                </div>
                <div className="ap-field"><label>Estado</label>
                  <select className="ap-select" value={form.estado} onChange={e => setF('estado', e.target.value)}>
                    {ORDEN.map(e => <option key={e} value={e}>{ESTADOS[e].label}</option>)}
                  </select>
                </div>
                <div className="ap-field"><label>Inversión estimada (€)</label><input type="number" value={form.valor_estimado} onChange={e => setF('valor_estimado', e.target.value)} placeholder="25000" /></div>
                <div className="ap-field"><label>% Cierre estimado</label><input type="number" min={0} max={100} value={form.pct_cierre} onChange={e => setF('pct_cierre', Number(e.target.value))} /></div>
              </div>

              <div style={{ fontSize:11, color:'rgba(255,255,255,0.3)', textTransform:'uppercase', letterSpacing:1, margin:'12px 0 8px' }}>Fechas del proceso</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 16px' }}>
                <div className="ap-field"><label>📅 Contacto</label><input type="date" value={form.fecha_contacto} onChange={e => setF('fecha_contacto', e.target.value)} /></div>
                <div className="ap-field"><label>📅 Respuesta chat</label><input type="date" value={form.fecha_respuesta} onChange={e => setF('fecha_respuesta', e.target.value)} /></div>
                <div className="ap-field"><label>📅 Llamada</label><input type="date" value={form.fecha_llamada} onChange={e => setF('fecha_llamada', e.target.value)} /></div>
                <div className="ap-field"><label>📅 Diseño enviado</label><input type="date" value={form.fecha_diseño} onChange={e => setF('fecha_diseño', e.target.value)} /></div>
                <div className="ap-field"><label>📅 Venta</label><input type="date" value={form.fecha_venta} onChange={e => setF('fecha_venta', e.target.value)} /></div>
              </div>

              <div className="ap-field"><label>Notas</label><textarea value={form.notas} onChange={e => setF('notas', e.target.value)} rows={3} placeholder="Contexto, observaciones..." /></div>

              <div className="ap-modal-actions">
                <button type="button" className="ap-btn ap-btn-ghost" onClick={() => setModal(null)}>Cancelar</button>
                <button type="submit" className="ap-btn ap-btn-primary" disabled={saving || !form.nombre.trim()}>
                  {saving ? 'Guardando...' : modal === 'new' ? 'Crear lead' : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
