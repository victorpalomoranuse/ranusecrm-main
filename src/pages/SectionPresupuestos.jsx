import { useState, useEffect } from 'react';
import api from '../services/api';
import { ArrowLeft, Plus, Pencil, Trash2, RotateCcw, CheckCircle, AlertCircle } from 'lucide-react';
import './SectionPresupuestos.css';

const CATEGORIES = [
  { value: 'material',    label: 'Material',      color: '#beb0a2' },
  { value: 'mobiliario',  label: 'Mobiliario',     color: '#8b9eae' },
  { value: 'instalacion', label: 'Instalación',    color: '#ae9e8b' },
  { value: 'transporte',  label: 'Transporte',     color: '#8bae8f' },
  { value: 'otro',        label: 'Otro',           color: '#7d7d7d' },
];

const UNITS = ['ud', 'm²', 'm', 'ml', 'h', 'kg', 'l', 'lote'];

const STATUS_CFG = {
  borrador: { label: 'Borrador', color: 'rgba(255,255,255,0.35)' },
  enviado:  { label: 'Enviado',  color: '#8b9eae' },
  aprobado: { label: 'Aprobado', color: '#8bae8f' },
};

const FEE_TYPES = [
  { value: 'flat',       label: 'Honorario fijo (€)' },
  { value: 'percentage', label: '% del subtotal PVP' },
  { value: 'hourly',     label: 'Por hora (€/h × horas)' },
];

function fmt(n) {
  return Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
}

function computeSummary(items, b) {
  const itemCost = items.reduce((s, i) => s + (parseFloat(i.unit_cost)||0) * (parseFloat(i.quantity)||1), 0);
  const itemRev  = items.reduce((s, i) => s + (parseFloat(i.unit_price)||0) * (parseFloat(i.quantity)||1), 0);
  const fv = parseFloat(b.design_fee_value) || 0;
  let fee = 0;
  if (b.design_fee_type === 'flat') fee = fv;
  else if (b.design_fee_type === 'percentage') fee = itemRev * fv / 100;
  else if (b.design_fee_type === 'hourly') fee = (parseFloat(b.design_hours)||0) * fv;
  const totalRev = itemRev + fee;
  const profit = totalRev - itemCost;
  return { itemCost, itemRev, fee, totalRev, profit, margin: totalRev > 0 ? (profit / totalRev) * 100 : 0 };
}

function MsgBanner({ msg }) {
  if (!msg) return null;
  return (
    <span className={`pres-msg pres-msg--${msg.type}`}>
      {msg.type === 'success' ? <CheckCircle size={12}/> : <AlertCircle size={12}/>}
      {msg.text}
    </span>
  );
}

function BudgetList({ onOpen }) {
  const [projects, setProjects]   = useState([]);
  const [budgets, setBudgets]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [creating, setCreating]   = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    Promise.all([api.get('/client-projects'), api.get('/budgets')])
      .then(([p, b]) => { setProjects(p.data.projects || []); setBudgets(b.data.budgets || []); })
      .finally(() => setLoading(false));
  }, []);

  const budgetByProject = Object.fromEntries(budgets.map(b => [b.project_id, b]));

  const handleCreate = async (projectId) => {
    setCreating(projectId);
    try {
      const { data } = await api.post('/budgets', { project_id: projectId });
      setBudgets(prev => [data.budget, ...prev]);
      onOpen(data.budget.id);
    } catch (err) {
      if (err.response?.data?.error?.includes('ya tiene')) {
        const existing = budgets.find(b => b.project_id === projectId);
        if (existing) onOpen(existing.id);
      }
    } finally { setCreating(null); }
  };

  const handleDelete = async (budgetId, e) => {
    e.stopPropagation();
    if (!window.confirm('¿Eliminar este presupuesto y todas sus partidas?')) return;
    setDeletingId(budgetId);
    try {
      await api.delete(`/budgets/${budgetId}`);
      setBudgets(prev => prev.filter(b => b.id !== budgetId));
    } finally { setDeletingId(null); }
  };

  if (loading) return <div className="ap-loading">Cargando presupuestos…</div>;

  return (
    <div className="pres-list">
      {projects.length === 0 ? (
        <div className="ap-empty"><p>Crea proyectos primero para poder presupuestarlos.</p></div>
      ) : (
        <div className="pres-grid">
          {projects.map(p => {
            const b = budgetByProject[p.id];
            const st = b ? STATUS_CFG[b.status] : null;
            return (
              <div key={p.id} className={`pres-card${b ? ' pres-card--has-budget' : ''}`} onClick={() => b && onOpen(b.id)}>
                <div className="pres-card-head">
                  <div className="pres-card-names">
                    <p className="pres-card-client">{p.client_name}</p>
                    <p className="pres-card-project">{p.project_name}</p>
                  </div>
                  {st && <span className="pres-badge" style={{ color: st.color, borderColor: st.color }}>{st.label}</span>}
                </div>
                {b ? (
                  <>
                    <div className="pres-card-stats">
                      <div className="pres-cs"><span>Coste</span><strong>{fmt(b.itemCost)}</strong></div>
                      <div className="pres-cs"><span>PVP total</span><strong>{fmt(b.totalRevenue)}</strong></div>
                      <div className="pres-cs"><span>Beneficio</span><strong style={{ color: b.totalProfit >= 0 ? '#8bae8f' : '#ae8b8b' }}>{fmt(b.totalProfit)}</strong></div>
                      <div className="pres-cs"><span>Margen</span><strong style={{ color: b.margin >= 20 ? '#8bae8f' : b.margin >= 10 ? '#beb0a2' : '#ae8b8b' }}>{Number(b.margin||0).toFixed(1)}%</strong></div>
                    </div>
                    <div className="pres-card-foot">
                      <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={e => { e.stopPropagation(); onOpen(b.id); }}>Abrir presupuesto →</button>
                      <button className="ap-btn-icon" onClick={e => handleDelete(b.id, e)} disabled={deletingId === b.id} title="Eliminar presupuesto"><Trash2 size={13}/></button>
                    </div>
                  </>
                ) : (
                  <div className="pres-card-empty">
                    <p>Sin presupuesto</p>
                    <button className="ap-btn ap-btn-primary ap-btn-sm" onClick={e => { e.stopPropagation(); handleCreate(p.id); }} disabled={creating === p.id}>
                      {creating === p.id ? 'Creando…' : <><Plus size={12}/> Crear presupuesto</>}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ItemRowEdit({ item, onSave, onCancel }) {
  const [d, setD] = useState({ ...item });
  const handleCostChange = v => { const cost = parseFloat(v)||0, markup = parseFloat(d.markup_pct)||0; setD(p=>({...p, unit_cost:v, unit_price:(cost*(1+markup/100)).toFixed(2)})); };
  const handleMarkupChange = v => { const cost = parseFloat(d.unit_cost)||0, markup = parseFloat(v)||0; setD(p=>({...p, markup_pct:v, unit_price:(cost*(1+markup/100)).toFixed(2)})); };
  return (
    <tr className="pres-row pres-row--edit">
      <td><input className="pres-cell-input" value={d.name} onChange={e=>setD(p=>({...p,name:e.target.value}))} autoFocus /></td>
      <td><select className="pres-cell-select" value={d.category} onChange={e=>setD(p=>({...p,category:e.target.value}))}>{CATEGORIES.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}</select></td>
      <td><input className="pres-cell-input pres-cell-num" type="number" min="0" step="0.01" value={d.quantity} onChange={e=>setD(p=>({...p,quantity:e.target.value}))} /></td>
      <td><select className="pres-cell-select" value={d.unit} onChange={e=>setD(p=>({...p,unit:e.target.value}))}>{UNITS.map(u=><option key={u}>{u}</option>)}</select></td>
      <td><input className="pres-cell-input pres-cell-num" type="number" min="0" step="0.01" value={d.unit_cost} onChange={e=>handleCostChange(e.target.value)} /></td>
      <td><input className="pres-cell-input pres-cell-num" type="number" min="0" step="0.1" value={d.markup_pct} onChange={e=>handleMarkupChange(e.target.value)} /></td>
      <td><input className="pres-cell-input pres-cell-num" type="number" min="0" step="0.01" value={d.unit_price} onChange={e=>setD(p=>({...p,unit_price:e.target.value}))} /></td>
      <td className="pres-mono pres-col-cost">{fmt((parseFloat(d.unit_cost)||0)*(parseFloat(d.quantity)||1))}</td>
      <td className="pres-mono pres-col-pvp">{fmt((parseFloat(d.unit_price)||0)*(parseFloat(d.quantity)||1))}</td>
      <td className="pres-actions-cell">
        <button className="ap-btn ap-btn-primary ap-btn-sm" onClick={()=>onSave(d)} disabled={!d.name?.trim()}>✓</button>
        <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={onCancel}>✕</button>
      </td>
    </tr>
  );
}

function ItemRowDisplay({ item, onEdit, onDelete }) {
  const cat = CATEGORIES.find(c=>c.value===item.category)||CATEGORIES[0];
  return (
    <tr className="pres-row">
      <td><span className="pres-cat-dot" style={{background:cat.color}}/>{item.name}</td>
      <td><span className="pres-cat-chip" style={{borderColor:cat.color,color:cat.color}}>{cat.label}</span></td>
      <td className="pres-mono">{item.quantity}</td>
      <td className="pres-mono">{item.unit}</td>
      <td className="pres-mono">{fmt(item.unit_cost)}</td>
      <td className="pres-mono">{Number(item.markup_pct||0).toFixed(1)}%</td>
      <td className="pres-mono">{fmt(item.unit_price)}</td>
      <td className="pres-mono pres-col-cost">{fmt((item.unit_cost||0)*(item.quantity||1))}</td>
      <td className="pres-mono pres-col-pvp">{fmt((item.unit_price||0)*(item.quantity||1))}</td>
      <td className="pres-actions-cell">
        <button className="ap-btn-icon" onClick={onEdit} title="Editar"><Pencil size={12}/></button>
        <button className="ap-btn-icon pres-del" onClick={onDelete} title="Eliminar"><Trash2 size={12}/></button>
      </td>
    </tr>
  );
}

function NewItemRow({ onAdd }) {
  const blank = { name:'', category:'material', quantity:'1', unit:'ud', unit_cost:'0', markup_pct:'20', unit_price:'0' };
  const [d, setD] = useState(blank);
  const [saving, setSaving] = useState(false);
  const handleCostChange = v => { const cost=parseFloat(v)||0, markup=parseFloat(d.markup_pct)||0; setD(p=>({...p,unit_cost:v,unit_price:(cost*(1+markup/100)).toFixed(2)})); };
  const handleMarkupChange = v => { const cost=parseFloat(d.unit_cost)||0, markup=parseFloat(v)||0; setD(p=>({...p,markup_pct:v,unit_price:(cost*(1+markup/100)).toFixed(2)})); };
  const handleAdd = async () => { if(!d.name.trim()) return; setSaving(true); try { await onAdd(d); setD(blank); } finally { setSaving(false); } };
  return (
    <tr className="pres-row pres-row--new">
      <td><input className="pres-cell-input" value={d.name} onChange={e=>setD(p=>({...p,name:e.target.value}))} placeholder="Nueva partida…" onKeyDown={e=>e.key==='Enter'&&handleAdd()} /></td>
      <td><select className="pres-cell-select" value={d.category} onChange={e=>setD(p=>({...p,category:e.target.value}))}>{CATEGORIES.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}</select></td>
      <td><input className="pres-cell-input pres-cell-num" type="number" min="0" step="0.01" value={d.quantity} onChange={e=>setD(p=>({...p,quantity:e.target.value}))} /></td>
      <td><select className="pres-cell-select" value={d.unit} onChange={e=>setD(p=>({...p,unit:e.target.value}))}>{UNITS.map(u=><option key={u}>{u}</option>)}</select></td>
      <td><input className="pres-cell-input pres-cell-num" type="number" min="0" step="0.01" value={d.unit_cost} onChange={e=>handleCostChange(e.target.value)} /></td>
      <td><input className="pres-cell-input pres-cell-num" type="number" min="0" step="0.1" value={d.markup_pct} onChange={e=>handleMarkupChange(e.target.value)} /></td>
      <td><input className="pres-cell-input pres-cell-num" type="number" min="0" step="0.01" value={d.unit_price} onChange={e=>setD(p=>({...p,unit_price:e.target.value}))} /></td>
      <td className="pres-mono" style={{color:'rgba(255,255,255,0.25)'}}>{fmt((parseFloat(d.unit_cost)||0)*(parseFloat(d.quantity)||1))}</td>
      <td className="pres-mono" style={{color:'rgba(255,255,255,0.25)'}}>{fmt((parseFloat(d.unit_price)||0)*(parseFloat(d.quantity)||1))}</td>
      <td className="pres-actions-cell"><button className="ap-btn ap-btn-primary ap-btn-sm" onClick={handleAdd} disabled={saving||!d.name.trim()}>{saving?'…':<Plus size={13}/>}</button></td>
    </tr>
  );
}

function BudgetEditor({ id, onBack }) {
  const [budget, setBudget]   = useState(null);
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [importing, setImporting] = useState(false);
  const [savingFee, setSavingFee] = useState(false);
  const [msg, setMsg]         = useState(null);
  const [pdfIva, setPdfIva]   = useState('21');
  const [pdfIrpf, setPdfIrpf] = useState('0');
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const flash = (text, type='success') => { setMsg({text,type}); setTimeout(()=>setMsg(null), 2500); };

  const handlePdf = async () => {
    setGeneratingPdf(true);
    try {
      const base = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
      const token = localStorage.getItem('admin_token');
      const res = await fetch(`${base}/budgets/${id}/pdf-cliente?iva=${pdfIva}&irpf=${pdfIrpf}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'presupuesto-cliente.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      flash('Error al generar PDF', 'error');
    } finally {
      setGeneratingPdf(false);
    }
  };

  useEffect(() => {
    api.get(`/budgets/${id}`)
      .then(r => { setBudget(r.data.budget); setItems(r.data.budget.items||[]); })
      .catch(() => flash('Error al cargar', 'error'))
      .finally(() => setLoading(false));
  }, [id]);

  const saveFee = async (patch = {}) => {
    setSavingFee(true);
    try {
      const b = { ...budget, ...patch };
      const { data } = await api.put(`/budgets/${id}`, { status: b.status, design_fee_type: b.design_fee_type, design_fee_value: b.design_fee_value, design_hours: b.design_hours });
      setBudget(prev => ({ ...prev, ...data.budget, ...patch }));
      flash('Guardado');
    } catch { flash('Error al guardar', 'error'); }
    finally { setSavingFee(false); }
  };

  const handleAddItem = async (form) => {
    const { data } = await api.post(`/budgets/${id}/items`, { ...form, unit_cost: parseFloat(form.unit_cost)||0, unit_price: parseFloat(form.unit_price)||0, markup_pct: parseFloat(form.markup_pct)||20, quantity: parseFloat(form.quantity)||1 });
    setItems(prev => [...prev, data.item]);
  };

  const handleUpdateItem = async (itemId, d) => {
    const { data } = await api.put(`/budgets/${id}/items/${itemId}`, { name: d.name, category: d.category, quantity: parseFloat(d.quantity)||1, unit: d.unit, unit_cost: parseFloat(d.unit_cost)||0, markup_pct: parseFloat(d.markup_pct)||0, unit_price: parseFloat(d.unit_price)||0 });
    setItems(prev => prev.map(i => i.id === itemId ? data.item : i));
    setEditingId(null);
  };

  const handleDeleteItem = async (itemId) => {
    await api.delete(`/budgets/${id}/items/${itemId}`);
    setItems(prev => prev.filter(i => i.id !== itemId));
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const { data } = await api.post(`/budgets/${id}/import`);
      setItems(prev => [...prev, ...(data.items||[])]);
      flash(data.message || 'Importado');
    } catch { flash('Error al importar', 'error'); }
    finally { setImporting(false); }
  };

  if (loading) return <div className="ap-loading">Cargando…</div>;
  if (!budget) return null;

  const sum = computeSummary(items, budget);
  const totalItemCost = items.reduce((s,i)=>(parseFloat(i.unit_cost)||0)*(parseFloat(i.quantity)||1)+s, 0);
  const totalItemPvp  = items.reduce((s,i)=>(parseFloat(i.unit_price)||0)*(parseFloat(i.quantity)||1)+s, 0);

  return (
    <div className="pres-editor">
      <div className="pres-editor-head">
        <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={onBack}><ArrowLeft size={14}/> Volver</button>
        <div className="pres-editor-title">
          <span className="pres-editor-client">{budget.project?.client_name}</span>
          <h2>{budget.project?.project_name}</h2>
        </div>
        <div className="pres-editor-right">
          <MsgBanner msg={msg}/>
          <select className="pres-cell-select" value={budget.status} onChange={e => { const s=e.target.value; setBudget(b=>({...b,status:s})); saveFee({status:s}); }}>
            {Object.entries(STATUS_CFG).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
      </div>

      <div className="pres-summary">
        {[
          { label: 'Coste total',     val: fmt(sum.itemCost),    color: null },
          { label: 'PVP artículos',   val: fmt(sum.itemRev),     color: null },
          { label: 'Honorarios',      val: fmt(sum.fee),         color: null },
          { label: 'Total cliente',   val: fmt(sum.totalRev),    color: '#beb0a2', accent: true },
          { label: 'Beneficio bruto', val: fmt(sum.profit),      color: sum.profit >= 0 ? '#8bae8f' : '#ae8b8b' },
          { label: 'Margen',          val: `${sum.margin.toFixed(1)}%`, color: sum.margin >= 20 ? '#8bae8f' : sum.margin >= 10 ? '#beb0a2' : '#ae8b8b' },
        ].map(c => (
          <div key={c.label} className={`pres-sum-card${c.accent?' pres-sum-card--accent':''}`}>
            <span>{c.label}</span>
            <strong style={c.color?{color:c.color}:{}}>{c.val}</strong>
          </div>
        ))}
      </div>

      <div className="pres-fee-box">
        <span className="pres-fee-label">Honorarios</span>
        <select className="pres-cell-select" value={budget.design_fee_type} onChange={e=>setBudget(b=>({...b,design_fee_type:e.target.value}))} onBlur={()=>saveFee()}>
          {FEE_TYPES.map(f=><option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <div className="pres-fee-field">
          <span>{budget.design_fee_type==='percentage'?'%':'€'}</span>
          <input className="pres-cell-input pres-cell-num" type="number" min="0" step="0.01" value={budget.design_fee_value||0} onChange={e=>setBudget(b=>({...b,design_fee_value:e.target.value}))} onBlur={()=>saveFee()} />
        </div>
        {budget.design_fee_type==='hourly' && (
          <div className="pres-fee-field">
            <span>h</span>
            <input className="pres-cell-input pres-cell-num" type="number" min="0" step="0.5" value={budget.design_hours||0} onChange={e=>setBudget(b=>({...b,design_hours:e.target.value}))} onBlur={()=>saveFee()} placeholder="Horas" />
          </div>
        )}
        <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={()=>saveFee()} disabled={savingFee}>{savingFee?'…':'Guardar'}</button>
      </div>

      <div className="pres-items-wrap">
        <div className="pres-items-toolbar">
          <span className="pres-items-title">Partidas <span className="pres-items-count">{items.length}</span></span>
          <div style={{display:'flex',alignItems:'center',gap:'0.5rem',flexWrap:'wrap'}}>
            <div style={{display:'flex',alignItems:'center',gap:'0.4rem'}}>
              <span style={{fontSize:'0.72rem',color:'rgba(255,255,255,0.4)'}}>IVA%</span>
              <input className="ap-field-input" type="number" min="0" max="100" value={pdfIva} onChange={e=>setPdfIva(e.target.value)} style={{width:55}} />
              <span style={{fontSize:'0.72rem',color:'rgba(255,255,255,0.4)'}}>IRPF%</span>
              <input className="ap-field-input" type="number" min="0" max="100" value={pdfIrpf} onChange={e=>setPdfIrpf(e.target.value)} style={{width:55}} />
              <button className="ap-btn ap-btn-primary ap-btn-sm" onClick={handlePdf} disabled={generatingPdf}>
                {generatingPdf ? 'Generando…' : 'PDF cliente'}
              </button>
            </div>
            <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={handleImport} disabled={importing}>
              <RotateCcw size={13}/> {importing?'Importando…':'Importar del proyecto'}
            </button>
          </div>
        </div>

        <div className="pres-table-scroll">
          <table className="pres-table">
            <colgroup><col/><col/><col/><col/><col/><col/><col/><col/><col/><col/></colgroup>
            <thead>
              <tr>
                <th>Descripción</th><th>Categoría</th><th>Cant</th><th>Ud</th>
                <th>Coste ud.</th><th>Margen %</th><th>PVP ud.</th>
                <th className="pres-col-cost">Total coste</th>
                <th className="pres-col-pvp">Total PVP</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map(item =>
                editingId === item.id
                  ? <ItemRowEdit key={item.id} item={item} onSave={d=>handleUpdateItem(item.id,d)} onCancel={()=>setEditingId(null)} />
                  : <ItemRowDisplay key={item.id} item={item} onEdit={()=>setEditingId(item.id)} onDelete={()=>handleDeleteItem(item.id)} />
              )}
              <NewItemRow onAdd={handleAddItem} />
            </tbody>
            {items.length > 0 && (
              <tfoot>
                <tr className="pres-tfoot-row">
                  <td colSpan={7} style={{textAlign:'right',paddingRight:'0.75rem',color:'rgba(255,255,255,0.4)',fontSize:'0.72rem',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.06em'}}>SUBTOTAL PARTIDAS</td>
                  <td className="pres-mono pres-col-cost">{fmt(totalItemCost)}</td>
                  <td className="pres-mono pres-col-pvp">{fmt(totalItemPvp)}</td>
                  <td/>
                </tr>
                <tr className="pres-tfoot-row pres-tfoot-row--total">
                  <td colSpan={7} style={{textAlign:'right',paddingRight:'0.75rem',fontSize:'0.72rem',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em'}}>TOTAL CLIENTE (con honorarios)</td>
                  <td className="pres-mono pres-col-cost">{fmt(sum.itemCost)}</td>
                  <td className="pres-mono pres-col-pvp">{fmt(sum.totalRev)}</td>
                  <td/>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

export function SectionPresupuestos() {
  const [view, setView]         = useState('list');
  const [budgetId, setBudgetId] = useState(null);

  return (
    <div className="ap-section">
      {view === 'list' ? (
        <>
          <div className="ap-section-head">
            <div>
              <h1>Presupuestos</h1>
              <p>Calcula costes, márgenes y honorarios de cada proyecto.</p>
            </div>
          </div>
          <BudgetList onOpen={id => { setBudgetId(id); setView('editor'); }} />
        </>
      ) : (
        <>
          <div className="ap-section-head" style={{marginBottom:0}}>
            <h1>Presupuestos</h1>
          </div>
          <BudgetEditor id={budgetId} onBack={() => { setBudgetId(null); setView('list'); }} />
        </>
      )}
    </div>
  );
}
