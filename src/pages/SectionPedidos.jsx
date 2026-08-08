import { useState, useEffect } from 'react';
import api from '../services/api';
import { Download, GripVertical } from 'lucide-react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const ORDER_STATUSES = [
  { value: 'pendiente', label: 'Por pedir', color: 'rgba(255,255,255,0.35)' },
  { value: 'pedido', label: 'Pedido', color: '#8b9eae' },
  { value: 'entregado', label: 'Entregado', color: '#8bae8f' },
];
const PAYMENT_STATUSES = [
  { value: 'pendiente', label: 'Por pagar', color: '#ae8b8b' },
  { value: 'pagado', label: 'Pagado', color: '#8bae8f' },
];

function normalizeKey(s) {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
function displayName(key) {
  return key.replace(/\b\w/g, c => c.toUpperCase());
}
function sortByPedidoOrder(arr) {
  return [...arr].sort((a, b) => (a.pedido_order ?? Infinity) - (b.pedido_order ?? Infinity));
}

function SortableLineRow({ line, onUpdate }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: line.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1, zIndex: isDragging ? 10 : undefined };
  return (
    <div ref={setNodeRef} style={{ ...style, display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '0.75rem 1rem' }}>
      <button {...attributes} {...listeners} type="button" style={{ background: 'none', border: 'none', cursor: 'grab', color: 'rgba(255,255,255,0.3)', padding: 0, flexShrink: 0, display: 'flex' }}><GripVertical size={14} /></button>
      <div style={{ flex: '1 1 220px', minWidth: 180 }}>
        <p style={{ margin: 0, fontSize: '0.85rem', color: '#fff', fontWeight: 500 }}>{line.name}</p>
        <p style={{ margin: '2px 0 0', fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)' }}>x{line.quantity} {line.unit}</p>
      </div>
      <select className="ap-select ap-select-sm" value={line.order_status || 'pendiente'} onChange={e => onUpdate(line, { order_status: e.target.value })}>
        {ORDER_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
      <select className="ap-select ap-select-sm" value={line.payment_status || 'pendiente'} onChange={e => onUpdate(line, { payment_status: e.target.value })}>
        {PAYMENT_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
      <input
        type="date"
        className="ap-field-input"
        style={{ maxWidth: 150 }}
        value={line.delivery_date || ''}
        onChange={e => onUpdate(line, { delivery_date: e.target.value })}
      />
    </div>
  );
}

export function SectionPedidos() {
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pendientes'); // 'pendientes' | 'todos'
  const [includeFinished, setIncludeFinished] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    api.get('/budgets/pedidos').then(r => setLines(r.data.lines || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const updateLine = async (line, updates) => {
    try {
      const { data } = await api.put(`/budgets/${line.budget_id}/items/${line.id}`, updates);
      setLines(prev => prev.map(l => l.id === line.id
        ? { ...l, ...data.item, effective_provider: data.item.provider?.trim() || data.item.brand?.trim() || 'Sin proveedor' }
        : l));
    } catch {}
  };

  const handleReorder = async (providerLines, event) => {
    const { active, over } = event;
    if (!active || !over || active.id === over.id) return;
    const oldIndex = providerLines.findIndex(l => l.id === active.id);
    const newIndex = providerLines.findIndex(l => l.id === over.id);
    const newOrder = arrayMove(providerLines, oldIndex, newIndex);
    setLines(prev => {
      const updated = prev.map(l => {
        const idx = newOrder.findIndex(n => n.id === l.id);
        return idx >= 0 ? { ...l, pedido_order: idx } : l;
      });
      return sortByPedidoOrder(updated);
    });
    try {
      await api.put('/budgets/pedidos/reorder', { ids: newOrder.map(l => l.id) });
    } catch {}
  };

  const handleExport = async (providerKey, providerLabel, projectId) => {
    try {
      const base = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
      const token = localStorage.getItem('admin_token');
      const qs = new URLSearchParams({ provider: providerKey, ...(projectId ? { project_id: projectId } : {}) });
      const res = await fetch(`${base}/budgets/pedidos/export?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pedido-${providerLabel}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {}
  };

  if (loading) {
    return (
      <div className="ap-section">
        <div className="ap-section-head"><h1>Pedidos</h1></div>
        <div className="ap-loading">Cargando…</div>
      </div>
    );
  }

  let visibleLines = filter === 'pendientes' ? lines.filter(l => l.order_status !== 'entregado') : lines;
  if (!includeFinished) visibleLines = visibleLines.filter(l => (l.project?.status || 'en_marcha') === 'en_marcha');

  const projectGroups = {};
  visibleLines.forEach(l => {
    const pid = l.project?.id || 'sin-proyecto';
    if (!projectGroups[pid]) projectGroups[pid] = { project: l.project, providers: {} };
    const key = normalizeKey(l.effective_provider);
    if (!projectGroups[pid].providers[key]) projectGroups[pid].providers[key] = { name: displayName(key), lines: [] };
    projectGroups[pid].providers[key].lines.push(l);
  });
  const projectIds = Object.keys(projectGroups).sort((a, b) => {
    const na = projectGroups[a].project?.client_name || '';
    const nb = projectGroups[b].project?.client_name || '';
    return na.localeCompare(nb);
  });

  return (
    <div className="ap-section">
      <div className="ap-section-head">
        <div>
          <h1>Pedidos</h1>
          <p>Qué falta por pedir de tus presupuestos aprobados, por proyecto y proveedor/marca. Arrastra las líneas para ordenarlas.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', cursor: 'pointer' }}>
            <input type="checkbox" checked={includeFinished} onChange={e => setIncludeFinished(e.target.checked)} />
            Incluir finalizados y archivados
          </label>
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 3 }}>
            {['pendientes', 'todos'].map(v => (
              <button
                key={v}
                onClick={() => setFilter(v)}
                style={{
                  padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: '0.78rem',
                  background: filter === v ? '#beb0a2' : 'transparent',
                  color: filter === v ? '#0a0a0a' : 'rgba(255,255,255,0.5)',
                  fontWeight: filter === v ? 600 : 400,
                }}
              >
                {v === 'pendientes' ? 'Pendientes' : 'Todos'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {projectIds.length === 0 ? (
        <div className="ap-empty"><p>{filter === 'pendientes' ? 'Nada pendiente de pedir.' : 'No hay partidas en presupuestos aprobados.'}</p></div>
      ) : projectIds.map(pid => {
        const { project, providers } = projectGroups[pid];
        const providerKeys = Object.keys(providers).sort((a, b) => providers[a].name.localeCompare(providers[b].name));
        const totalCount = providerKeys.reduce((s, k) => s + providers[k].lines.length, 0);
        return (
          <div key={pid} style={{ marginBottom: '2.5rem' }}>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#fff', margin: '0 0 0.15rem' }}>
              {project?.client_name || 'Sin proyecto'}
            </h2>
            <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.35)', margin: '0 0 1rem' }}>
              {project?.project_name} · {totalCount} partida{totalCount !== 1 ? 's' : ''}
            </p>

            {providerKeys.map(key => {
              const { name, lines: providerLines } = providers[key];
              return (
                <div key={key} style={{ marginBottom: '1.5rem', paddingLeft: '1rem', borderLeft: '2px solid rgba(190,176,162,0.2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                    <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: '#beb0a2', margin: 0 }}>
                      {name} <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400, fontSize: '0.75rem' }}>({providerLines.length})</span>
                    </h3>
                    <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => handleExport(key, name, project?.id)}><Download size={13} /> Exportar PDF</button>
                  </div>
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={e => handleReorder(providerLines, e)}>
                    <SortableContext items={providerLines.map(l => l.id)} strategy={verticalListSortingStrategy}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {providerLines.map(line => <SortableLineRow key={line.id} line={line} onUpdate={updateLine} />)}
                      </div>
                    </SortableContext>
                  </DndContext>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
