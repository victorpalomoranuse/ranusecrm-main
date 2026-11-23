import { useState, useEffect, useMemo } from 'react';
import api from '../services/api';
import { Download, GripVertical, ChevronDown, ChevronRight, Search, PackageCheck, Undo2 } from 'lucide-react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// Pedidos: lo que hay que comprar de los presupuestos aprobados. Se ve por cliente → proyecto (o compra suelta) → proveedor.
// Dentro de cada proveedor, lo que aún no se ha pedido va suelto y lo que se pide de una vez forma un PEDIDO (PED-2026-001) con su fecha y su estado.
// Todo va plegado por defecto para que la lista no sea eterna: se abre lo que se quiere mirar.

// Recorrido de cada pieza, de principio a fin. «Entregado» sigue pendiente de trabajo hasta que se monta.
export const ORDER_STATUSES = [
  { value: 'pendiente', label: 'Por pedir', color: '#9aa0a6' },
  { value: 'pedido', label: 'Pedido al proveedor', color: '#8b9eae' },
  { value: 'preparacion', label: 'En preparación', color: '#e0b25a' },
  { value: 'transito', label: 'En camino', color: '#6fb3e0' },
  { value: 'entregado', label: 'Entregado · falta montar', color: '#c79bff' },
  { value: 'montado', label: 'Entregado y montado', color: '#4be3a0' },
];
const PAYMENT_STATUSES = [
  { value: 'pendiente', label: 'Por pagar', color: '#ae8b8b' },
  { value: 'pagado', label: 'Pagado', color: '#8bae8f' },
];
const ESTADO = Object.fromEntries(ORDER_STATUSES.map(s => [s.value, s]));
const colorDe = (v) => (ESTADO[v || 'pendiente'] || ESTADO.pendiente).color;
const mut = { fontSize: '0.74rem', color: 'rgba(255,255,255,0.45)' };

function normalizeKey(s) { return (s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function displayName(key) { return key.replace(/\b\w/g, c => c.toUpperCase()); }
function sortByPedidoOrder(arr) { return [...arr].sort((a, b) => (a.pedido_order ?? Infinity) - (b.pedido_order ?? Infinity)); }
const fmtFecha = (iso) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '');

// una pieza en una sola línea: casilla (para agrupar en un pedido), nombre, estado, pago y fecha
function LineaPieza({ line, onUpdate, sel, onSel, dragProps }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderLeft: '4px solid ' + colorDe(line.order_status), borderRadius: 9, padding: '0.5rem 0.8rem' }}>
      {dragProps && <button {...dragProps.attributes} {...dragProps.listeners} type="button" style={{ background: 'none', border: 'none', cursor: 'grab', color: 'rgba(255,255,255,0.3)', padding: 0, flexShrink: 0, display: 'flex' }}><GripVertical size={14} /></button>}
      {onSel && <input type="checkbox" checked={!!sel} onChange={() => onSel(line.id)} aria-label={'Elegir ' + line.name} />}
      <div style={{ flex: '1 1 200px', minWidth: 160 }}>
        <span style={{ fontSize: '0.84rem', color: '#fff', fontWeight: 500 }}>{line.name}</span>
        <span style={{ ...mut, marginLeft: 8 }}>x{line.quantity} {line.unit}</span>
      </div>
      <select className="ap-select ap-select-sm" value={line.order_status || 'pendiente'} onChange={e => onUpdate(line, { order_status: e.target.value })} style={{ minWidth: 175 }}>
        {ORDER_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
      <select className="ap-select ap-select-sm" value={line.payment_status || 'pendiente'} onChange={e => onUpdate(line, { payment_status: e.target.value })}>
        {PAYMENT_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
      <input type="date" className="ap-field-input" style={{ maxWidth: 140 }} value={line.delivery_date || ''} onChange={e => onUpdate(line, { delivery_date: e.target.value })} />
    </div>
  );
}
function LineaArrastrable({ line, onUpdate, sel, onSel }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: line.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1, zIndex: isDragging ? 10 : undefined }}>
      <LineaPieza line={line} onUpdate={onUpdate} sel={sel} onSel={onSel} dragProps={{ attributes, listeners }} />
    </div>
  );
}

// barrita de estados: cuántas piezas hay en cada estado
function Resumen({ lines }) {
  const cuenta = {}; lines.forEach(l => { const k = l.order_status || 'pendiente'; cuenta[k] = (cuenta[k] || 0) + 1; });
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {ORDER_STATUSES.filter(s => cuenta[s.value]).map(s => <span key={s.value} title={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.7rem', color: s.color }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color }} />{cuenta[s.value]}</span>)}
    </span>
  );
}
function Cabecera({ abierto, onToggle, children, nivel = 1, derecha }) {
  return (
    <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: nivel === 1 ? '12px 4px' : '8px 2px', userSelect: 'none' }}>
      {abierto ? <ChevronDown size={nivel === 1 ? 18 : 15} color="#baafa5" /> : <ChevronRight size={nivel === 1 ? 18 : 15} color="#baafa5" />}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>{children}</div>
      {derecha}
    </div>
  );
}

export function SectionPedidos() {
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pendientes'); // 'pendientes' | 'todos'
  const [includeFinished, setIncludeFinished] = useState(false);
  const [busca, setBusca] = useState('');
  const [estadoFiltro, setEstadoFiltro] = useState('');
  const [abiertos, setAbiertos] = useState({});
  const [sel, setSel] = useState({}); // id de pieza → true (para agrupar en un pedido)
  const [entrega, setEntrega] = useState({}); // fecha de entrega que se pondrá al crear un pedido, por proveedor
  const [msg, setMsg] = useState('');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const cargar = () => api.get('/budgets/pedidos').then(r => setLines(r.data.lines || [])).catch(() => {}).finally(() => setLoading(false));
  useEffect(() => { cargar(); }, []);

  const updateLine = async (line, updates) => {
    try {
      const { data } = await api.put(`/budgets/${line.budget_id}/items/${line.id}`, updates);
      setLines(prev => prev.map(l => l.id === line.id ? { ...l, ...data.item, effective_provider: data.item.provider?.trim() || data.item.brand?.trim() || 'Sin proveedor' } : l));
    } catch { /* se queda como estaba */ }
  };
  const handleReorder = async (grupo, event) => {
    const { active, over } = event;
    if (!active || !over || active.id === over.id) return;
    const newOrder = arrayMove(grupo, grupo.findIndex(l => l.id === active.id), grupo.findIndex(l => l.id === over.id));
    setLines(prev => sortByPedidoOrder(prev.map(l => { const idx = newOrder.findIndex(n => n.id === l.id); return idx >= 0 ? { ...l, pedido_order: idx } : l; })));
    try { await api.put('/budgets/pedidos/reorder', { ids: newOrder.map(l => l.id) }); } catch { /* sin guardar el orden */ }
  };
  const handleExport = async (providerKey, providerLabel, projectId, ref) => {
    try {
      const base = import.meta.env.VITE_API_URL || 'http://localhost:3001/api', token = localStorage.getItem('admin_token');
      const qs = new URLSearchParams({ provider: providerKey, ...(projectId ? { project_id: projectId } : {}), ...(ref ? { ref } : {}) });
      const res = await fetch(`${base}/budgets/pedidos/export?${qs.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error();
      const url = URL.createObjectURL(await res.blob()), a = document.createElement('a');
      a.href = url; a.download = `pedido-${ref || providerLabel}.pdf`; a.click(); URL.revokeObjectURL(url);
    } catch { setMsg('No se pudo exportar el PDF'); }
  };
  const toggle = (k, defecto = false) => setAbiertos(a => ({ ...a, [k]: !(a[k] ?? defecto) }));
  const toggleSel = (id) => setSel(s => { const n = { ...s }; if (n[id]) delete n[id]; else n[id] = true; return n; });
  const crearPedido = async (ids, clave) => {
    setMsg('');
    try { const r = await api.post('/budgets/pedidos/crear', { ids, entrega: entrega[clave] || undefined }); setSel(s => { const n = { ...s }; ids.forEach(i => delete n[i]); return n; }); setMsg('Pedido ' + r.data.ref + ' creado ✓'); await cargar(); }
    catch (e) { setMsg(e.response?.data?.error || 'No se pudo crear el pedido'); }
  };
  const cambiaPedido = async (ref, cambios) => { try { await api.put('/budgets/pedidos/estado', { ref, ...cambios }); await cargar(); } catch (e) { setMsg(e.response?.data?.error || 'No se pudo cambiar el pedido'); } };
  const deshacerPedido = async (ref) => { if (!window.confirm('¿Deshacer el pedido ' + ref + '? Las piezas siguen donde están, solo dejan de formar un grupo.')) return; try { await api.post('/budgets/pedidos/sacar', { ref }); await cargar(); } catch (e) { setMsg(e.response?.data?.error || 'No se pudo deshacer'); } };

  // ── filtros: pendientes/todos, activos, búsqueda y estado
  const base = useMemo(() => {
    let v = filter === 'pendientes' ? lines.filter(l => l.order_status !== 'montado') : lines;
    if (!includeFinished) v = v.filter(l => (l.project?.status || 'en_marcha') === 'en_marcha');
    const q = normalizeKey(busca);
    if (q) v = v.filter(l => normalizeKey([l.project?.client_name, l.budget_name, l.project?.project_name, l.effective_provider, l.name, l.pedido_ref].filter(Boolean).join(' ')).includes(q));
    return v;
  }, [lines, filter, includeFinished, busca]);
  const visibleLines = estadoFiltro ? base.filter(l => (l.order_status || 'pendiente') === estadoFiltro) : base;
  const buscando = !!busca.trim() || !!estadoFiltro; // al buscar o filtrar, se abre todo para ver los resultados

  // ── cliente → proyecto o compra suelta → proveedor → (piezas por pedir | pedidos)
  const clientes = useMemo(() => {
    const out = {};
    visibleLines.forEach(l => {
      const cliente = (l.project?.client_name || l.budget_name || 'Sin cliente').trim(), ck = normalizeKey(cliente);
      const c = out[ck] || (out[ck] = { key: ck, nombre: cliente, bloques: {}, lines: [] }); c.lines.push(l);
      const bk = l.project?.id || 'suelta-' + l.budget_id;
      const b = c.bloques[bk] || (c.bloques[bk] = { key: ck + '|' + bk, project: l.project || null, suelta: !l.project, nombre: l.project?.project_name || l.budget_name || '', providers: {}, lines: [] }); b.lines.push(l);
      const pk = normalizeKey(l.effective_provider), p = b.providers[pk] || (b.providers[pk] = { key: b.key + '|' + pk, pk, name: displayName(pk), sueltas: [], pedidos: {}, lines: [] }); p.lines.push(l);
      if (l.pedido_ref) (p.pedidos[l.pedido_ref] = p.pedidos[l.pedido_ref] || []).push(l); else p.sueltas.push(l);
    });
    return Object.values(out).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [visibleLines]);

  if (loading) return <div className="ap-section"><div className="ap-section-head"><h1>Pedidos</h1></div><div className="ap-loading">Cargando…</div></div>;

  const cuentaEstados = {}; base.forEach(l => { const k = l.order_status || 'pendiente'; cuentaEstados[k] = (cuentaEstados[k] || 0) + 1; });
  const abre = (k, defecto) => (buscando ? true : (abiertos[k] ?? defecto));
  const todosLosKeys = [];
  clientes.forEach(c => { todosLosKeys.push(c.key); Object.values(c.bloques).forEach(b => { todosLosKeys.push(b.key); Object.values(b.providers).forEach(p => { todosLosKeys.push(p.key); Object.keys(p.pedidos).forEach(ref => todosLosKeys.push(p.key + '|' + ref)); }); }); });
  const abrirTodo = (v) => setAbiertos(Object.fromEntries(todosLosKeys.map(k => [k, v])));

  return (
    <div className="ap-section">
      <div className="ap-section-head">
        <div>
          <h1>Pedidos</h1>
          <p>Por cliente, proyecto y proveedor. Lo que pides de una vez a un proveedor forma un <b>pedido</b> con su número y su estado.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', cursor: 'pointer' }}>
            <input type="checkbox" checked={includeFinished} onChange={e => setIncludeFinished(e.target.checked)} /> Incluir finalizados y archivados
          </label>
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 3 }}>
            {['pendientes', 'todos'].map(v => (
              <button key={v} onClick={() => setFilter(v)} style={{ padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: '0.78rem', background: filter === v ? '#baafa5' : 'transparent', color: filter === v ? '#0a0a0a' : 'rgba(255,255,255,0.5)', fontWeight: filter === v ? 600 : 400 }}>{v === 'pendientes' ? 'Pendientes' : 'Todos'}</button>
            ))}
          </div>
        </div>
      </div>

      {/* resumen por estado (pulsa uno para filtrar), buscador y plegar/desplegar todo */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '0.2rem 0 0.9rem' }}>
        {ORDER_STATUSES.map(s => (
          <button key={s.value} type="button" onClick={() => setEstadoFiltro(e => (e === s.value ? '' : s.value))} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 12px', borderRadius: 999, cursor: 'pointer', fontSize: '0.78rem', border: '1px solid ' + (estadoFiltro === s.value ? s.color : 'rgba(255,255,255,0.14)'), background: estadoFiltro === s.value ? s.color + '33' : 'rgba(255,255,255,0.04)', color: '#fff', opacity: cuentaEstados[s.value] || estadoFiltro === s.value ? 1 : 0.45 }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: s.color }} />{s.label}<b>{cuentaEstados[s.value] || 0}</b>
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 9, opacity: 0.5 }} />
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar cliente, proveedor o pieza…" className="ap-field-input" style={{ paddingLeft: 30, width: 260 }} />
        </div>
        <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => abrirTodo(true)}>Desplegar todo</button>
        <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => abrirTodo(false)}>Plegar todo</button>
      </div>
      {msg && <p style={{ fontSize: '0.8rem', color: msg.includes('✓') ? '#4be3a0' : '#ff9b8a', margin: '0 0 0.8rem' }}>{msg}</p>}

      {clientes.length === 0 ? (
        <div className="ap-empty"><p>{buscando ? 'Nada coincide con lo que buscas.' : filter === 'pendientes' ? 'Nada pendiente de pedir.' : 'No hay partidas en presupuestos aprobados.'}</p></div>
      ) : clientes.map(c => {
        const abC = abre(c.key, false), bloques = Object.values(c.bloques);
        return (
          <div key={c.key} style={{ marginBottom: '0.7rem', background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '0 16px' }}>
            <Cabecera abierto={abC} onToggle={() => toggle(c.key, false)} nivel={1} derecha={<Resumen lines={c.lines} />}>
              <b style={{ fontSize: '1.05rem' }}>{c.nombre}</b>
              <span style={mut}>{bloques.length} {bloques.length === 1 ? 'proyecto o compra' : 'proyectos o compras'} · {c.lines.length} pieza{c.lines.length !== 1 ? 's' : ''}</span>
            </Cabecera>
            {abC && bloques.map(b => {
              const abB = abre(b.key, true), provs = Object.values(b.providers).sort((x, y) => x.name.localeCompare(y.name));
              return (
                <div key={b.key} style={{ marginBottom: 10, paddingLeft: 12, borderLeft: '3px solid ' + (b.suelta ? '#e0b25a' : '#4be3a0') }}>
                  <Cabecera abierto={abB} onToggle={() => toggle(b.key, true)} nivel={2} derecha={<Resumen lines={b.lines} />}>
                    <span style={{ fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 6, background: b.suelta ? 'rgba(224,178,90,0.18)' : 'rgba(75,227,160,0.16)', color: b.suelta ? '#e0b25a' : '#4be3a0' }}>{b.suelta ? 'Compra suelta' : 'Proyecto'}</span>
                    <b style={{ fontSize: '0.92rem' }}>{b.nombre || (b.suelta ? 'Presupuesto sin nombre' : 'Sin nombre')}</b>
                    <span style={mut}>{b.lines.length} pieza{b.lines.length !== 1 ? 's' : ''}</span>
                  </Cabecera>
                  {abB && provs.map(p => {
                    const abP = abre(p.key, true), ids = p.sueltas.filter(l => sel[l.id]).map(l => l.id), refs = Object.keys(p.pedidos).sort();
                    return (
                      <div key={p.key} style={{ margin: '4px 0 14px 4px', paddingLeft: 12, borderLeft: '2px solid rgba(186,175,165,0.22)' }}>
                        <Cabecera abierto={abP} onToggle={() => toggle(p.key, true)} nivel={2}
                          derecha={<span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}><Resumen lines={p.lines} /><button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={e => { e.stopPropagation(); handleExport(p.pk, p.name, b.project?.id); }}><Download size={13} /> PDF</button></span>}>
                          <span style={{ fontSize: '0.86rem', fontWeight: 600, color: '#baafa5' }}>{p.name}</span>
                          <span style={mut}>{p.lines.length} pieza{p.lines.length !== 1 ? 's' : ''}{refs.length ? ' · ' + refs.length + ' pedido' + (refs.length !== 1 ? 's' : '') : ''}</span>
                        </Cabecera>
                        {abP && (
                          <div style={{ display: 'grid', gap: 10, paddingBottom: 4 }}>
                            {/* piezas aún sin pedido */}
                            {p.sueltas.length > 0 && (
                              <div>
                                <div style={{ ...mut, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, margin: '2px 0 6px' }}>Sin agrupar en un pedido · {p.sueltas.length}</div>
                                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={e => handleReorder(p.sueltas, e)}>
                                  <SortableContext items={p.sueltas.map(l => l.id)} strategy={verticalListSortingStrategy}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                      {p.sueltas.map(l => <LineaArrastrable key={l.id} line={l} onUpdate={updateLine} sel={sel[l.id]} onSel={toggleSel} />)}
                                    </div>
                                  </SortableContext>
                                </DndContext>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                                  <button className="ap-btn ap-btn-ghost ap-btn-xs" onClick={() => setSel(s => { const n = { ...s }; const todas = p.sueltas.every(l => n[l.id]); p.sueltas.forEach(l => { if (todas) delete n[l.id]; else n[l.id] = true; }); return n; })}>{p.sueltas.every(l => sel[l.id]) ? 'Quitar la selección' : 'Elegir todas'}</button>
                                  <span style={mut}>Entrega prevista:</span>
                                  <input type="date" className="ap-field-input" style={{ maxWidth: 140 }} value={entrega[p.key] || ''} onChange={e => setEntrega(x => ({ ...x, [p.key]: e.target.value }))} />
                                  <button className="ap-btn ap-btn-primary ap-btn-sm" disabled={!ids.length} onClick={() => crearPedido(ids, p.key)}><PackageCheck size={13} /> Crear pedido con {ids.length || ''} pieza{ids.length === 1 ? '' : 's'}</button>
                                </div>
                              </div>
                            )}
                            {/* pedidos de este proveedor */}
                            {refs.map(ref => {
                              const pl = sortByPedidoOrder(p.pedidos[ref]), clave = p.key + '|' + ref, abR = abre(clave, false);
                              const recibidas = pl.filter(l => ['entregado', 'montado'].includes(l.order_status)).length, montadas = pl.filter(l => l.order_status === 'montado').length;
                              const estados = [...new Set(pl.map(l => l.order_status || 'pendiente'))], estadoComun = estados.length === 1 ? estados[0] : '';
                              const entregaC = [...new Set(pl.map(l => l.delivery_date || ''))], entregaComun = entregaC.length === 1 ? entregaC[0] : '';
                              return (
                                <div key={ref} style={{ borderRadius: 12, background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.1)', borderLeft: '5px solid ' + (estadoComun ? colorDe(estadoComun) : '#baafa5') }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px' }}>
                                    <span onClick={() => toggle(clave, false)} style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>{abR ? <ChevronDown size={15} color="#baafa5" /> : <ChevronRight size={15} color="#baafa5" />}<b style={{ fontSize: '0.88rem' }}>{ref}</b></span>
                                    <span style={mut}>{pl[0].pedido_fecha ? 'pedido el ' + fmtFecha(pl[0].pedido_fecha) + ' · ' : ''}{pl.length} pieza{pl.length !== 1 ? 's' : ''} · {recibidas} de {pl.length} entregada{recibidas !== 1 ? 's' : ''}{montadas ? ' · ' + montadas + ' montada' + (montadas !== 1 ? 's' : '') : ''}</span>
                                    <span style={{ flex: 1 }} />
                                    <select className="ap-select ap-select-sm" value={estadoComun} onChange={e => e.target.value && cambiaPedido(ref, { order_status: e.target.value })} style={{ minWidth: 190 }} title="Cambia el estado de todas las piezas del pedido">
                                      {!estadoComun && <option value="">Estados distintos…</option>}
                                      {ORDER_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                                    </select>
                                    <input type="date" className="ap-field-input" style={{ maxWidth: 140 }} value={entregaComun} onChange={e => cambiaPedido(ref, { entrega: e.target.value })} title="Fecha prevista de entrega de todo el pedido" />
                                    <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => handleExport(p.pk, p.name, b.project?.id, ref)}><Download size={13} /> PDF</button>
                                    <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => deshacerPedido(ref)} title="Deshacer el grupo (las piezas no se borran)"><Undo2 size={13} /></button>
                                  </div>
                                  {abR && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 12px 12px' }}>
                                      {pl.map(l => <LineaPieza key={l.id} line={l} onUpdate={updateLine} />)}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
