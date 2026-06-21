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

const LEADS_ESTADOS = {
  nuevo:       { label: 'Nuevo',       color: '#3b82f6' },
  contactado:  { label: 'Contactado',  color: '#f59e0b' },
  cualificado: { label: 'Cualificado', color: '#8b5cf6' },
  propuesta:   { label: 'Propuesta',   color: '#06b6d4' },
  ganado:      { label: 'Ganado',      color: '#beb0a2' },
  perdido:     { label: 'Perdido',     color: '#f87171' },
  descartado:  { label: 'Descartado',  color: '#6b7280' },
};
const LEADS_ORDEN_ESTADOS = ['nuevo','contactado','cualificado','propuesta','ganado','perdido','descartado'];
const LEADS_CANALES = ['instagram','web','recomendacion','whatsapp','evento','agente','otro'];
const LEADS_DEPORTES = ['Fútbol','Pádel','Baloncesto','Tenis','MotoGP','Ciclismo','Otro'];
const LEADS_LIGAS = ['LaLiga','Hypermotion','Primera RFEF','Liga F','ACB','WPT','Bundesliga','Premier','Serie A','Otro'];

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
// SECCIÓN LEADS
// ─────────────────────────────────────────────────────────────
function SectionLeads() {
  const { toasts, toast, remove } = useToast();
  const [leads, setLeads] = useState([]);
  const [metricas, setMetricas] = useState({});
  const [porCanal, setPorCanal] = useState({});
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);   // null | 'new' | lead
  const [panel, setPanel] = useState(null);   // lead abierto en sidebar
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);

  // Filtros
  const [filtroEstado, setFiltroEstado] = useState('all');
  const [filtroOrigen, setFiltroOrigen] = useState('all');
  const [busqueda, setBusqueda] = useState('');

  const EMPTY = {
    nombre:'', perfil:'', deporte:'Fútbol', liga:'', instagram:'',
    telefono:'', email:'', origen:'outbound', canal:'instagram',
    estado:'nuevo', valor_estimado:'', pct_cierre:20, notas:'',
    fecha_contacto: new Date().toISOString().slice(0,10), fecha_seguimiento:'',
  };
  const [form, setForm] = useState(EMPTY);

  const cargar = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/leads');
      setLeads(data.leads || []);
      setMetricas(data.metricas || {});
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
      const method = isEdit ? 'put' : 'post';
      const url    = isEdit ? `/leads/${modal.id}` : '/leads';
      const { data } = await api[method](url, form);
      if (isEdit) {
        setLeads(prev => prev.map(l => l.id === modal.id ? data.lead : l));
        if (panel?.id === modal.id) setPanel(data.lead);
        toast.success('Lead actualizado');
      } else {
        setLeads(prev => [data.lead, ...prev]);
        toast.success('Lead creado');
      }
      await cargar(); // recarga métricas
      setModal(null);
    } catch { toast.error('Error al guardar'); }
    setSaving(false);
  };

  const cambiarEstado = async (id, estado) => {
    try {
      const { data } = await api.put(`/leads/${id}`, { estado });
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
    setForm({ ...lead, fecha_contacto: lead.fecha_contacto?.slice(0,10)||'', fecha_seguimiento: lead.fecha_seguimiento?.slice(0,10)||'' });
    setModal(lead);
  };

  return (
    <div className="ap-section">
      <ToastContainer toasts={toasts} onRemove={remove} />
      {confirm && <ConfirmDialog message={confirm.message} onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />}

      {/* Header */}
      <div className="ap-section-head">
        <div>
          <h1>Leads</h1>
          <p>Pipeline de oportunidades — inbound y outbound</p>
        </div>
        <button className="ap-btn ap-btn-primary" onClick={() => { setForm(EMPTY); setModal('new'); }}>
          <Plus size={15} /> Nuevo lead
        </button>
      </div>

      {/* Métricas */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))', gap:10, marginBottom:16 }}>
        {[
          { label:'Total',       val: metricas.total || 0 },
          { label:'Activos',     val: metricas.activos || 0 },
          { label:'Inbound',     val: metricas.inbound || 0 },
          { label:'Outbound',    val: metricas.outbound || 0 },
          { label:'Ganados',     val: metricas.ganados || 0, color:'#beb0a2' },
          { label:'Pipeline',    val: fmtEur(metricas.valorPipeline), color:'#8b5cf6' },
        ].map(m => (
          <div key={m.label} style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:10, padding:'12px 16px' }}>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.3)', textTransform:'uppercase', letterSpacing:1, marginBottom:4 }}>{m.label}</div>
            <div style={{ fontSize:20, fontWeight:700, color: m.color || '#fff' }}>{m.val}</div>
          </div>
        ))}
      </div>

      {/* Canales */}
      {Object.keys(porCanal).length > 0 && (
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:14 }}>
          {Object.entries(porCanal).sort((a,b) => b[1].total - a[1].total).map(([canal, d]) => (
            <span key={canal} style={{ background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:6, padding:'4px 12px', fontSize:12 }}>
              <span style={{ textTransform:'capitalize', color:'#beb0a2' }}>{canal}</span>
              <span style={{ color:'rgba(255,255,255,0.3)', marginLeft:6 }}>{d.total}</span>
              {d.ganados > 0 && <span style={{ color:'#22c55e', marginLeft:4 }}>✓{d.ganados}</span>}
            </span>
          ))}
        </div>
      )}

      {/* Filtros */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16, alignItems:'center' }}>
        <input
          placeholder="Buscar nombre o @..."
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          className="ap-field-input"
          style={{ maxWidth:220 }}
        />
        <select className="ap-select" value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
          <option value="all">Todos los estados</option>
          {LEADS_ORDEN_ESTADOS.map(e => <option key={e} value={e}>{LEADS_ESTADOS[e].label}</option>)}
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
          <div style={{ display:'flex', gap:12, minWidth:900 }}>
            {LEADS_ORDEN_ESTADOS.map(estado => {
              const col = filtrados.filter(l => l.estado === estado);
              const est = LEADS_ESTADOS[estado];
              return (
                <div key={estado} style={{ flex:1, minWidth:150, maxWidth:220 }}>
                  <div style={{ background:`${est.color}15`, border:`1px solid ${est.color}30`, borderRadius:'8px 8px 0 0', padding:'7px 12px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ color:est.color, fontWeight:700, fontSize:11, textTransform:'uppercase', letterSpacing:1 }}>{est.label}</span>
                    <span style={{ background:`${est.color}30`, color:est.color, borderRadius:999, padding:'1px 7px', fontSize:11, fontWeight:700 }}>{col.length}</span>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    {col.length === 0 && (
                      <div style={{ border:`1px dashed ${est.color}20`, borderRadius:'0 0 8px 8px', padding:14, textAlign:'center', color:'rgba(255,255,255,0.15)', fontSize:12 }}>vacío</div>
                    )}
                    {col.map((lead, i) => (
                      <div
                        key={lead.id}
                        onClick={() => setPanel(lead)}
                        style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)', borderRadius: i === col.length-1 ? '0 0 8px 8px' : 6, padding:'10px 12px', cursor:'pointer' }}
                        onMouseEnter={e => e.currentTarget.style.borderColor='rgba(190,176,162,0.3)'}
                        onMouseLeave={e => e.currentTarget.style.borderColor='rgba(255,255,255,0.08)'}
                      >
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:4 }}>
                          <span style={{ fontSize:13, fontWeight:600, color:'#e5ddd5', lineHeight:1.3 }}>{lead.nombre}</span>
                          <span style={{ fontSize:9, background: lead.origen==='inbound' ? '#0a3d4a' : '#3b1f6e', color: lead.origen==='inbound' ? '#06b6d4' : '#8b5cf6', borderRadius:4, padding:'2px 5px', whiteSpace:'nowrap', flexShrink:0 }}>
                            {lead.origen === 'inbound' ? 'IN' : 'OUT'}
                          </span>
                        </div>
                        {lead.deporte && <div style={{ fontSize:11, color:'rgba(255,255,255,0.3)', marginTop:3 }}>{lead.deporte}{lead.liga ? ` · ${lead.liga}` : ''}</div>}
                        {lead.valor_estimado > 0 && (
                          <div style={{ marginTop:6, display:'flex', justifyContent:'space-between', fontSize:12 }}>
                            <span style={{ color:'#beb0a2', fontWeight:600 }}>{Number(lead.valor_estimado).toLocaleString('es-ES')}€</span>
                            <span style={{ color:'rgba(255,255,255,0.3)' }}>{lead.pct_cierre||0}%</span>
                          </div>
                        )}
                        {/* Cambio rápido de estado */}
                        <div onClick={e => e.stopPropagation()} style={{ marginTop:8, display:'flex', gap:3, flexWrap:'wrap' }}>
                          {LEADS_ORDEN_ESTADOS.filter(e => e !== lead.estado).slice(0,3).map(e => (
                            <button key={e} onClick={() => cambiarEstado(lead.id, e)}
                              style={{ fontSize:9, background:`${LEADS_ESTADOS[e].color}15`, color:LEADS_ESTADOS[e].color, border:`1px solid ${LEADS_ESTADOS[e].color}40`, borderRadius:4, padding:'2px 5px', cursor:'pointer', fontFamily:'inherit' }}>
                              {LEADS_ESTADOS[e].label}
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

      {/* Panel lateral detalle */}
      {panel && (
        <div style={{ position:'fixed', top:0, right:0, width:360, height:'100vh', background:'#1a1612', borderLeft:'1px solid rgba(255,255,255,0.08)', zIndex:200, overflowY:'auto', padding:24 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16 }}>
            <div>
              <div style={{ fontSize:17, fontWeight:700, color:'#beb0a2' }}>{panel.nombre}</div>
              {panel.instagram && <div style={{ fontSize:12, color:'rgba(255,255,255,0.3)' }}>@{panel.instagram}</div>}
            </div>
            <button onClick={() => setPanel(null)} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.3)', fontSize:18, cursor:'pointer' }}>✕</button>
          </div>

          {/* Estado badge */}
          <div style={{ marginBottom:14 }}>
            <span style={{ background:`${LEADS_ESTADOS[panel.estado]?.color}20`, border:`1px solid ${LEADS_ESTADOS[panel.estado]?.color}40`, borderRadius:8, padding:'6px 14px', color:LEADS_ESTADOS[panel.estado]?.color, fontWeight:700, fontSize:13 }}>
              {LEADS_ESTADOS[panel.estado]?.label}
            </span>
          </div>
          <div style={{ marginBottom:14, display:'flex', gap:5, flexWrap:'wrap' }}>
            {LEADS_ORDEN_ESTADOS.filter(e => e !== panel.estado).map(e => (
              <button key={e} onClick={() => cambiarEstado(panel.id, e)}
                style={{ fontSize:10, background:`${LEADS_ESTADOS[e].color}15`, color:LEADS_ESTADOS[e].color, border:`1px solid ${LEADS_ESTADOS[e].color}30`, borderRadius:4, padding:'3px 7px', cursor:'pointer', fontFamily:'inherit' }}>
                {LEADS_ESTADOS[e].label}
              </button>
            ))}
          </div>

          {[
            ['Origen',       panel.origen === 'inbound' ? '📥 Inbound' : '📤 Outbound'],
            ['Canal',        panel.canal || '—'],
            ['Deporte',      [panel.deporte, panel.liga].filter(Boolean).join(' · ') || '—'],
            ['Teléfono',     panel.telefono || '—'],
            ['Email',        panel.email || '—'],
            ['Inversión est.',fmtEur(panel.valor_estimado)],
            ['% Cierre',     `${panel.pct_cierre||0}%`],
            ['Pipeline',     fmtEur((panel.valor_estimado||0)*(panel.pct_cierre||0)/100)],
            ['Contacto',     panel.fecha_contacto?.slice(0,10) || '—'],
            ['Seguimiento',  panel.fecha_seguimiento?.slice(0,10) || '—'],
          ].map(([k,v]) => (
            <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid rgba(255,255,255,0.05)', fontSize:13 }}>
              <span style={{ color:'rgba(255,255,255,0.3)' }}>{k}</span>
              <span style={{ color:'#e5ddd5' }}>{v}</span>
            </div>
          ))}

          {panel.notas && (
            <div style={{ marginTop:14, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:8, padding:12, fontSize:13, color:'rgba(255,255,255,0.5)', lineHeight:1.6 }}>
              {panel.notas}
            </div>
          )}

          <div style={{ display:'flex', gap:8, marginTop:18, flexWrap:'wrap' }}>
            <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => { abrirEditar(panel); setPanel(null); }}>
              <Pencil size={13}/> Editar
            </button>
            <button className="ap-btn ap-btn-danger ap-btn-sm" onClick={() => setConfirm({ message:`¿Eliminar a ${panel.nombre}?`, onConfirm: () => eliminar(panel.id) })}>
              <Trash2 size={13}/>
            </button>
          </div>
        </div>
      )}

      {/* Modal crear / editar */}
      {modal && (
        <div className="ap-modal-overlay" onClick={() => setModal(null)}>
          <div className="ap-modal" onClick={e => e.stopPropagation()} style={{ maxWidth:560 }}>
            <div className="ap-modal-head">
              <h2>{modal === 'new' ? 'Nuevo lead' : 'Editar lead'}</h2>
              <button className="ap-modal-close" onClick={() => setModal(null)}><X size={16}/></button>
            </div>
            <form onSubmit={guardar} className="ap-modal-form">
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 16px' }}>
                <div className="ap-field"><label>Nombre *</label><input value={form.nombre} onChange={e => setF('nombre', e.target.value)} placeholder="Ej: Rubén Yáñez" required autoFocus /></div>
                <div className="ap-field"><label>Perfil</label><input value={form.perfil} onChange={e => setF('perfil', e.target.value)} placeholder="Portero, Delantero..." /></div>
                <div className="ap-field"><label>Deporte</label>
                  <select className="ap-select" value={form.deporte} onChange={e => setF('deporte', e.target.value)}>
                    {LEADS_DEPORTES.map(d => <option key={d}>{d}</option>)}
                  </select>
                </div>
                <div className="ap-field"><label>Liga / Circuito</label>
                  <select className="ap-select" value={form.liga} onChange={e => setF('liga', e.target.value)}>
                    <option value="">— sin liga —</option>
                    {LEADS_LIGAS.map(l => <option key={l}>{l}</option>)}
                  </select>
                </div>
                <div className="ap-field"><label>Instagram</label><input value={form.instagram} onChange={e => setF('instagram', e.target.value)} placeholder="handle sin @" /></div>
                <div className="ap-field"><label>Teléfono</label><input value={form.telefono} onChange={e => setF('telefono', e.target.value)} placeholder="+34 600 000 000" /></div>
                <div className="ap-field"><label>Origen</label>
                  <select className="ap-select" value={form.origen} onChange={e => setF('origen', e.target.value)}>
                    <option value="outbound">📤 Outbound</option>
                    <option value="inbound">📥 Inbound</option>
                  </select>
                </div>
                <div className="ap-field"><label>Canal</label>
                  <select className="ap-select" value={form.canal} onChange={e => setF('canal', e.target.value)}>
                    {LEADS_CANALES.map(c => <option key={c} value={c} style={{ textTransform:'capitalize' }}>{c}</option>)}
                  </select>
                </div>
                <div className="ap-field"><label>Estado</label>
                  <select className="ap-select" value={form.estado} onChange={e => setF('estado', e.target.value)}>
                    {LEADS_ORDEN_ESTADOS.map(e => <option key={e} value={e}>{LEADS_ESTADOS[e].label}</option>)}
                  </select>
                </div>
                <div className="ap-field"><label>% Cierre</label><input type="number" min={0} max={100} value={form.pct_cierre} onChange={e => setF('pct_cierre', Number(e.target.value))} /></div>
                <div className="ap-field"><label>Inversión estimada (€)</label><input type="number" value={form.valor_estimado} onChange={e => setF('valor_estimado', e.target.value)} placeholder="25000" /></div>
                <div className="ap-field"><label>Fecha contacto</label><input type="date" value={form.fecha_contacto} onChange={e => setF('fecha_contacto', e.target.value)} /></div>
                <div className="ap-field"><label>Próx. seguimiento</label><input type="date" value={form.fecha_seguimiento} onChange={e => setF('fecha_seguimiento', e.target.value)} /></div>
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

export { SectionLeads };
