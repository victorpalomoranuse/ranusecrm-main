function SortableAssignedItem({ item, onUnassign, onUpdate, type }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  const [expanded, setExpanded]   = useState(false);
  const [qty, setQty]             = useState(item.quantity ?? 1);
  const [ytUrl, setYtUrl]         = useState(item.youtube_url || '');
  const [extraImgs, setExtraImgs] = useState(item.extra_images || []);
  const [newImg, setNewImg]       = useState('');
  const [saving, setSaving]       = useState(false);

  const isMob = type === 'mobiliario';

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/client-projects/${item.project_id}/equipment/${item.id}`, {
        quantity: qty,
        youtube_url: ytUrl || null,
        extra_images: extraImgs,
      });
      onUpdate({ ...item, quantity: qty, youtube_url: ytUrl || null, extra_images: extraImgs });
      setExpanded(false);
    } catch {
    } finally {
      setSaving(false);
    }
  };

  const addImg = () => {
    const url = newImg.trim();
    if (!url || extraImgs.includes(url)) return;
    setExtraImgs(prev => [...prev, url]);
    setNewImg('');
  };

  const removeImg = (url) => setExtraImgs(prev => prev.filter(u => u !== url));

  return (
    <div ref={setNodeRef} style={style} className="ap-catalog-product ap-catalog-product--expand">
      <button
        {...attributes} {...listeners}
        style={{ background:'none', border:'none', cursor:'grab', color:'rgba(255,255,255,0.3)', padding:'0 4px', flexShrink:0, display:'flex', alignItems:'center' }}
        type="button"
      >
        <GripVertical size={13}/>
      </button>

      {item.image_url && (
        <img src={item.image_url} alt={item.name} className="ap-catalog-product-img" />
      )}

      <div className="ap-catalog-product-info" style={{ flex: 1 }}>
        <span className="ap-catalog-product-name">{item.name}</span>
        {item.category && <span className="ap-cat-meta">{item.category}</span>}
        {isMob && (
          <span className="ap-cat-meta" style={{ color: 'rgba(190,176,162,0.7)', marginLeft: 4 }}>
            ×{qty}
            {item.youtube_url && ' · 🎬'}
            {item.extra_images?.length > 0 && ` · ${item.extra_images.length} img`}
          </span>
        )}
      </div>

      {isMob && (
        <button
          className="ap-btn ap-btn-ghost ap-btn-sm"
          style={{ flexShrink: 0, fontSize: '0.72rem' }}
          onClick={() => setExpanded(v => !v)}
          type="button"
        >
          <Pencil size={11}/> {expanded ? 'Cerrar' : 'Detalle'}
        </button>
      )}

      <button className="ap-btn-icon" onClick={() => onUnassign(item.id, type)}>
        <X size={13}/>
      </button>

      {expanded && isMob && (
        <div className="ap-eq-detail-panel">
          <div className="ap-field" style={{ marginBottom: '0.75rem' }}>
            <label style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', marginBottom: '0.3rem', display: 'block' }}>Cantidad</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => setQty(q => Math.max(1, q - 1))}>−</button>
              <input
                type="number" min="1"
                className="ap-field-input"
                style={{ width: 60, textAlign: 'center' }}
                value={qty}
                onChange={e => setQty(Math.max(1, parseInt(e.target.value) || 1))}
              />
              <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => setQty(q => q + 1)}>+</button>
            </div>
          </div>

          <div className="ap-field" style={{ marginBottom: '0.75rem' }}>
            <label style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', marginBottom: '0.3rem', display: 'block' }}>Vídeo YouTube (URL)</label>
            <input
              className="ap-field-input"
              value={ytUrl}
              onChange={e => setYtUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
            />
          </div>

          <div className="ap-field" style={{ marginBottom: '0.75rem' }}>
            <label style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', marginBottom: '0.3rem', display: 'block' }}>Imágenes adicionales (URLs)</label>
            {extraImgs.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.5rem' }}>
                {extraImgs.map(url => (
                  <div key={url} style={{ position: 'relative', width: 52, height: 52 }}>
                    <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)' }} />
                    <button
                      type="button"
                      onClick={() => removeImg(url)}
                      style={{ position: 'absolute', top: -5, right: -5, background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '50%', width: 16, height: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, color: 'rgba(255,255,255,0.6)' }}
                    >
                      <X size={9}/>
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <input
                className="ap-field-input"
                value={newImg}
                onChange={e => setNewImg(e.target.value)}
                placeholder="https://..."
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addImg())}
              />
              <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={addImg}>
                <Plus size={12}/> Añadir
              </button>
            </div>
          </div>

          <button
            type="button"
            className="ap-btn ap-btn-primary ap-btn-sm"
            onClick={handleSave}
            disabled={saving}
            style={{ width: '100%' }}
          >
            {saving ? 'Guardando…' : <><Save size={12}/> Guardar cambios</>}
          </button>
        </div>
      )}
    </div>
  );
}

function TabAsignaciones({ projectId }) {
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
      api.get(`/client-projects/${projectId}/materials`),
      api.get(`/client-projects/${projectId}/equipment`),
    ]).then(([cats, prods, mats, equip]) => {
      setCategories(cats.data.categories || []);
      setProducts(prods.data.products || []);
      setAssigned({ materials: mats.data.materials || [], equipment: equip.data.equipment || [] });
    }).catch(() => {}).finally(() => setLoading(false));
  }, [projectId]);

  const isAssigned = (productId, type) => {
    const list = type === 'material' ? assigned.materials : assigned.equipment;
    return list.some(a => a.catalog_product_id === productId);
  };

  const handleAssignedDragEnd = async (event) => {
    const { active, over } = event;
    if (!active || !over || active.id === over.id) return;
    const isMat = tab === 'material';
    const list = isMat ? assigned.materials : assigned.equipment;
    const oldIndex = list.findIndex(a => a.id === active.id);
    const newIndex = list.findIndex(a => a.id === over.id);
    const newList = arrayMove(list, oldIndex, newIndex);
    setAssigned(prev => isMat ? { ...prev, materials: newList } : { ...prev, equipment: newList });
    const endpoint = isMat
      ? `/client-projects/${projectId}/materials/reorder`
      : `/client-projects/${projectId}/equipment/reorder`;
    try {
      await api.put(endpoint, { ids: newList.map(a => a.id) });
    } catch {
      toast.error('Error al guardar el orden');
    }
  };

  const assign = async (product) => {
    const isMat = product.category?.type === 'material';
    const type = isMat ? 'material' : 'mobiliario';
    if (isAssigned(product.id, type)) {
      toast.error(`"${product.name}" ya está asignado a este proyecto`);
      return;
    }
    const endpoint = isMat ? `/client-projects/${projectId}/materials` : `/client-projects/${projectId}/equipment`;
    try {
      const payload = isMat
        ? { name: product.name, category: product.category?.name, catalog_product_id: product.id, image_url: product.photo_url || null }
        : { name: product.name, category: product.category?.name, catalog_product_id: product.id, quantity: 1, image_url: product.photo_url || null, extra_images: [], youtube_url: null };
      const { data } = await api.post(endpoint, payload);
      setAssigned(prev => isMat
        ? { ...prev, materials: [data.material, ...prev.materials] }
        : { ...prev, equipment: [data.equipment, ...prev.equipment] }
      );
      toast.success(`"${product.name}" añadido al proyecto`);
    } catch {
      toast.error('Error al asignar producto');
    }
  };

  const unassign = async (id, type) => {
    const isMat = type === 'material';
    const endpoint = isMat ? `/client-projects/${projectId}/materials/${id}` : `/client-projects/${projectId}/equipment/${id}`;
    try {
      await api.delete(endpoint);
      setAssigned(prev => isMat
        ? { ...prev, materials: prev.materials.filter(m => m.id !== id) }
        : { ...prev, equipment: prev.equipment.filter(e => e.id !== id) }
      );
    } catch {
      toast.error('Error al quitar producto');
    }
  };

  const handleItemUpdate = (updatedItem) => {
    setAssigned(prev => ({
      ...prev,
      equipment: prev.equipment.map(e => e.id === updatedItem.id ? updatedItem : e),
    }));
    toast.success('Detalles guardados');
  };

  if (loading) return <div className="ap-loading">Cargando…</div>;

  const filteredCats = categories.filter(c => c.type === tab);
  const assignedList = tab === 'material' ? assigned.materials : assigned.equipment;

  return (
    <div className="ap-tab-content">
      <div className="ap-cat-tabs" style={{ marginBottom: '1.25rem' }}>
        <button className={`ap-cat-tab${tab === 'material' ? ' active' : ''}`} onClick={() => setTab('material')}>Materiales</button>
        <button className={`ap-cat-tab${tab === 'mobiliario' ? ' active' : ''}`} onClick={() => setTab('mobiliario')}>Mobiliario</button>
      </div>

      {assignedList.length > 0 && (
        <div style={{ marginBottom: '1.25rem' }}>
          <p style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.3)', marginBottom: '0.5rem' }}>
            Asignados a este proyecto
          </p>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleAssignedDragEnd}>
            <SortableContext items={assignedList.map(a => a.id)} strategy={verticalListSortingStrategy}>
              <div className="ap-catalog-products" style={{ padding: 0 }}>
                {assignedList.map(a => (
                  <SortableAssignedItem
                    key={a.id}
                    item={{ ...a, project_id: projectId }}
                    type={tab === 'material' ? 'material' : 'mobiliario'}
                    onUnassign={unassign}
                    onUpdate={handleItemUpdate}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}

      <p style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.3)', marginBottom: '0.75rem' }}>
        Tu catálogo
      </p>
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
                  {catProducts.length === 0 && <p className="ap-empty-sm" style={{ paddingLeft: '1rem' }}>Sin productos.</p>}
                  {catProducts.map(p => {
                    const already = isAssigned(p.id, tab);
                    return (
                      <div key={p.id} className="ap-catalog-product">
                        {p.photo_url && <img src={p.photo_url} alt={p.name} className="ap-catalog-product-img" />}
                        <div className="ap-catalog-product-info">
                          <span className="ap-catalog-product-name">{p.name}</span>
                          {p.price != null && <span className="ap-catalog-product-price">{Number(p.price).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}</span>}
                          {p.link && <a href={p.link} target="_blank" rel="noopener noreferrer" className="ap-catalog-product-link">Ver producto ↗</a>}
                        </div>
                        <button
                          className={`ap-btn ap-btn-sm ${already ? 'ap-btn-ghost' : 'ap-btn-primary'}`}
                          onClick={() => !already && assign(p)}
                          disabled={already}
                          style={{ flexShrink: 0 }}
                        >
                          {already ? '✓' : <Plus size={13}/>}
                        </button>
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
function ProjectManagerModal({ project, onClose }) {
  const [tab, setTab] = useState('renders');
  return (
    <div className="ap-modal-overlay" onClick={onClose}>
      <div className="ap-mgr-modal" onClick={e => e.stopPropagation()}>
        <div className="ap-mgr-head">
          <div><h2 className="ap-mgr-title">{project.client_name}</h2><p className="ap-mgr-sub">{project.project_name} · <span className="ap-code-val" style={{fontSize:'0.78rem'}}>{project.access_code}</span></p></div>
          <button className="ap-modal-close" onClick={onClose}><X size={16}/></button>
        </div>
        <div className="ap-mgr-tabs">{MGR_TABS.map(t => (<button key={t.id} className={`ap-mgr-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>))}</div>
        <div className="ap-mgr-body">
          {tab === 'renders'    && <TabRenders      projectId={project.id} />}
          {tab === 'documentos' && <TabDocumentos   projectId={project.id} />}
          {tab === 'tours'      && <TabTour         projectId={project.id} />}
          {tab === 'notas'      && <TabNotas        projectId={project.id} />}
          {tab === 'catalogo'   && <TabAsignaciones projectId={project.id} />}
        </div>
      </div>
    </div>
  );
}
El `ProjectManagerModal` está pero sigue faltando todo lo demás. Necesitas añadir esto al final del archivo, después de la última `}`:

```jsx
function SectionTrabajos() {
  const [projects, setProjects] = useState([]);
  const [savedProjects, setSavedProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [brokenCovers, setBrokenCovers] = useState({});
  const { toasts, toast, remove } = useToast();
  const loadProjects = async () => {
    try {
      const { data } = await api.get('/portfolio');
      const list = data.projects || [];
      const broken = list.filter(p => { const invalid = !p.cover_url || p.cover_url.startsWith('blob:'); const hasReplacement = p.images?.some(u => u && !u.startsWith('blob:')); return invalid && hasReplacement; });
      if (broken.length > 0) { await Promise.all(broken.map(p => { const newCover = p.images.find(u => u && !u.startsWith('blob:')); return api.put(`/portfolio/${p.id}`, { cover_url: newCover }).catch(() => null); })); const healed = list.map(p => { const fix = broken.find(b => b.id === p.id); if (!fix) return p; return { ...p, cover_url: p.images.find(u => u && !u.startsWith('blob:')) }; }); setProjects(healed); setSavedProjects(healed); }
      else { setProjects(list); setSavedProjects(list); }
    } catch {} finally { setLoading(false); }
  };
  useEffect(() => { loadProjects(); }, []);
  const isDirty = projects.length === savedProjects.length && projects.some((p, i) => savedProjects[i]?.id !== p.id);
  const handleDelete = async () => { try { await api.delete(`/portfolio/${confirmId}`); setProjects(prev => prev.filter(p => p.id !== confirmId)); setSavedProjects(prev => prev.filter(p => p.id !== confirmId)); toast.success('Proyecto eliminado correctamente'); } catch { toast.error('Error al eliminar el proyecto'); } finally { setConfirmId(null); } };
  const handleMove = (index, direction) => { const swapIndex = index + direction; if (swapIndex < 0 || swapIndex >= projects.length) return; const updated = [...projects]; [updated[index], updated[swapIndex]] = [updated[swapIndex], updated[index]]; setProjects(updated); };
  const handleSaveOrder = async () => { setSaving(true); try { const changed = projects.map((p, i) => ({ p, newOrder: i + 1 })).filter(({ p, newOrder }) => p.display_order !== newOrder); await Promise.all(changed.map(({ p, newOrder }) => api.put(`/portfolio/${p.id}`, { display_order: newOrder }))); const synced = projects.map((p, i) => ({ ...p, display_order: i + 1 })); setProjects(synced); setSavedProjects(synced); toast.success('Orden guardado correctamente'); } catch { toast.error('Error al guardar el orden'); } finally { setSaving(false); } };
  const handleDiscardOrder = () => { setProjects(savedProjects); toast.success('Cambios descartados'); };
  return (
    <div className="ap-section">
      <ToastContainer toasts={toasts} onRemove={remove} />
      <div className="ap-section-head">
        <div><h1>Trabajos</h1><p>Gestiona los trabajos del portfolio. Los 3 primeros aparecen en la página de inicio.</p></div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {isDirty && (<><button className="ap-btn ap-btn-ghost" onClick={handleDiscardOrder} disabled={saving}><X size={14} /> Descartar</button><button className="ap-btn ap-btn-primary" onClick={handleSaveOrder} disabled={saving}><Save size={14} /> {saving ? 'Guardando...' : 'Guardar orden'}</button></>)}
          <button className="ap-btn ap-btn-primary" onClick={() => setModal('new')}><Plus size={15} /> Nuevo proyecto</button>
        </div>
      </div>
      {loading ? <div className="ap-loading">Cargando proyectos...</div> : projects.length === 0 ? <div className="ap-empty"><p>No hay proyectos todavía.</p></div> : (
        <>
          <p className="ap-order-hint">Usa ↑↓ para cambiar el orden. Los primeros 3 se muestran en el inicio.{isDirty && <span style={{ color: '#f5b748', marginLeft: '0.5rem' }}>Tienes cambios sin guardar.</span>}</p>
          <div className="ap-projects-grid">
            {projects.map((p, i) => { const validCover = p.cover_url && !p.cover_url.startsWith('blob:') && !brokenCovers[p.id]; const fallback = p.images?.find(u => u && !u.startsWith('blob:')); const src = validCover ? p.cover_url : fallback; return (
              <div key={p.id} className={`ap-project-card${i < 3 ? ' is-featured' : ''}`}>
                <div className="ap-project-img">{src ? <img src={src} alt={p.title} onError={() => setBrokenCovers(prev => ({ ...prev, [p.id]: true }))} /> : <div className="ap-project-no-img">Sin imagen</div>}<span className="ap-project-count">{p.images?.length || 0} fotos</span>{i < 3 && <span className="ap-featured-badge">En inicio</span>}</div>
                <div className="ap-project-info"><h3>{p.title}</h3>{p.description && <p>{p.description}</p>}<span className="ap-project-slug">/{p.slug}</span></div>
                <div className="ap-project-actions"><div className="ap-order-btns"><button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => handleMove(i, -1)} disabled={i === 0}><ChevronUp size={14} /></button><button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => handleMove(i, 1)} disabled={i === projects.length - 1}><ChevronDown size={14} /></button></div><button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => setModal(p)}><Pencil size={13} /> Editar</button><button className="ap-btn ap-btn-danger ap-btn-sm" onClick={() => setConfirmId(p.id)}><Trash2 size={13} /></button></div>
              </div>
            ); })}
          </div>
        </>
      )}
      {modal && <ProjectModal project={modal === 'new' ? null : modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); loadProjects(); toast.success('Proyecto guardado correctamente'); }} />}
      {confirmId && <ConfirmDialog message="¿Eliminar este proyecto? Esta acción no se puede deshacer." onConfirm={handleDelete} onCancel={() => setConfirmId(null)} />}
    </div>
  );
}

const PAGE_SIZE_PROYECTOS = 6;

function SectionProyectos() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [manageProject, setManageProject] = useState(null);
  const [page, setPage] = useState(1);
  const { toasts, toast, remove } = useToast();
  const loadProjects = async () => { try { const { data } = await api.get('/client-projects'); setProjects(data.projects || []); } catch {} finally { setLoading(false); } };
  useEffect(() => { loadProjects(); }, []);
  const handleDelete = async () => { try { await api.delete(`/client-projects/${confirmId}`); setProjects(prev => prev.filter(p => p.id !== confirmId)); toast.success('Proyecto eliminado'); } catch { toast.error('Error al eliminar el proyecto'); } finally { setConfirmId(null); } };
  const copyCode = (code) => { navigator.clipboard.writeText(code); toast.success('Código copiado'); };
  const copyLink = (code) => { const url = `${window.location.origin}/mi-proyecto?code=${code}`; navigator.clipboard.writeText(url); toast.success('Enlace copiado'); };
  return (
    <div className="ap-section">
      <ToastContainer toasts={toasts} onRemove={remove} />
      <div className="ap-section-head"><div><h1>Proyectos</h1><p>Genera proyectos con códigos de acceso para tus clientes.</p></div><button className="ap-btn ap-btn-primary" onClick={() => setModal('new')}><Plus size={15} /> Generar proyecto</button></div>
      {loading ? <div className="ap-loading">Cargando proyectos...</div> : projects.length === 0 ? <div className="ap-empty"><p>No hay proyectos todavía.</p></div> : (
        <>
          <div className="ap-cp-grid">
            {projects.slice((page - 1) * PAGE_SIZE_PROYECTOS, page * PAGE_SIZE_PROYECTOS).map(p => (
              <div key={p.id} className="ap-cp-card">
                <div className="ap-cp-header"><div className="ap-cp-names"><h3 className="ap-cp-client">{p.client_name}</h3><p className="ap-cp-name">{p.project_name}</p></div><span className={`ap-urgency-badge ap-urgency--${p.urgency}`}>{p.urgency}</span></div>
                <div className="ap-cp-phase-row"><div className="ap-cp-dots">{[1,2,3,4,5].map(n => (<div key={n} className={`ap-phase-dot${n <= p.phase ? ' active' : ''}`} title={PHASE_LABELS[n]} />))}</div><span className="ap-phase-label">{PHASE_LABELS[p.phase]}</span></div>
                <div className="ap-cp-code-row"><span className="ap-code-val">{p.access_code}</span><button className="ap-btn-icon" onClick={() => copyCode(p.access_code)} title="Copiar código"><Copy size={13} /></button></div>
                <div className="ap-cp-link-row"><span className="ap-cp-link-text">/mi-proyecto?code={p.access_code}</span><button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => copyLink(p.access_code)}><Copy size={12}/> Copiar enlace</button></div>
                {p.client_email && <p className="ap-cp-email">{p.client_email}</p>}
                <div className="ap-project-actions"><button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => setManageProject(p)}><Settings size={13} /> Gestionar</button><button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => setModal(p)}><Pencil size={13} /> Editar</button><button className="ap-btn ap-btn-danger ap-btn-sm" onClick={() => setConfirmId(p.id)}><Trash2 size={13} /></button></div>
              </div>
            ))}
          </div>
          <Pagination page={page} total={projects.length} pageSize={PAGE_SIZE_PROYECTOS} onPage={setPage} />
        </>
      )}
      {modal && <ClientProjectModal project={modal === 'new' ? null : modal} onClose={() => setModal(null)} onSaved={(saved) => { if (modal === 'new') setProjects(prev => [saved, ...prev]); else setProjects(prev => prev.map(p => p.id === saved.id ? saved : p)); setModal(null); toast.success('Proyecto guardado correctamente'); }} />}
      {confirmId && <ConfirmDialog message="¿Eliminar este proyecto? El código de acceso quedará inválido." onConfirm={handleDelete} onCancel={() => setConfirmId(null)} />}
      {manageProject && <ProjectManagerModal project={manageProject} onClose={() => setManageProject(null)} />}
    </div>
  );
}

function EmpleadoModal({ onClose, onSaved }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const handleSubmit = async (e) => { e.preventDefault(); setError(''); setLoading(true); try { const { data } = await api.post('/employees', { name, email, password }); onSaved(data.employee); } catch (err) { setError(err.response?.data?.error || 'Error al crear el empleado'); } finally { setLoading(false); } };
  return (
    <div className="ap-modal-overlay" onClick={onClose}>
      <div className="ap-modal" onClick={e => e.stopPropagation()}>
        <div className="ap-modal-head"><h2>Nuevo empleado</h2><button className="ap-modal-close" onClick={onClose}><X size={16} /></button></div>
        <form onSubmit={handleSubmit} className="ap-modal-form">
          <div className="ap-field"><label>Nombre *</label><input value={name} onChange={e => setName(e.target.value)} placeholder="Carlos Rodríguez" required /></div>
          <div className="ap-field"><label>Email *</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="carlos@ranusedesign.com" required /></div>
          <div className="ap-field"><label>Contraseña *</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" required minLength={6} /></div>
          {error && <p className="ap-error">{error}</p>}
          <div className="ap-modal-actions"><button type="button" className="ap-btn ap-btn-ghost" onClick={onClose}>Cancelar</button><button type="submit" className="ap-btn ap-btn-primary" disabled={loading}>{loading ? 'Creando...' : 'Crear empleado'}</button></div>
        </form>
      </div>
    </div>
  );
}

const PAGE_SIZE_EMPLEADOS = 8;

function SectionEmpleados() {
  const { user } = useAdminAuth();
  const isSuper = user?.role === 'admin_superior';
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const [page, setPage] = useState(1);
  const [visiblePass, setVisiblePass] = useState({});
  const { toasts, toast, remove } = useToast();
  const loadEmployees = async () => { try { const { data } = await api.get('/employees'); setEmployees(data.employees || []); } catch {} finally { setLoading(false); } };
  useEffect(() => { loadEmployees(); }, []);
  const handleDelete = async () => { const emp = employees.find(e => e.id === confirmId); if (emp?.is_admin_profile) { toast.error('No puedes eliminar tu propio perfil de responsable'); setConfirmId(null); return; } try { await api.delete(`/employees/${confirmId}`); setEmployees(prev => prev.filter(e => e.id !== confirmId)); toast.success('Empleado eliminado'); } catch { toast.error('Error al eliminar el empleado'); } finally { setConfirmId(null); } };
  const togglePass = (id) => setVisiblePass(prev => ({ ...prev, [id]: !prev[id] }));
  return (
    <div className="ap-section">
      <ToastContainer toasts={toasts} onRemove={remove} />
      <div className="ap-section-head"><div><h1>Empleados</h1><p>Gestiona el equipo.</p></div><button className="ap-btn ap-btn-primary" onClick={() => setShowModal(true)}><Plus size={15}/> Añadir empleado</button></div>
      {loading ? <div className="ap-loading">Cargando empleados…</div> : employees.length === 0 ? <div className="ap-empty"><p>No hay empleados todavía.</p></div> : (
        <>
          <div className="ap-emp-list">
            {employees.slice((page - 1) * PAGE_SIZE_EMPLEADOS, page * PAGE_SIZE_EMPLEADOS).map(e => (
              <div key={e.id} className={`ap-emp-row${e.is_admin_profile ? ' ap-emp-row--admin' : ''}`}>
                <div className="ap-emp-avatar" style={e.is_admin_profile ? {background:'rgba(190,176,162,0.2)',color:'#beb0a2'} : {}}>{e.name.charAt(0).toUpperCase()}</div>
                <div className="ap-emp-info"><span className="ap-emp-name">{e.name}{e.is_admin_profile && <span className="ap-emp-badge">Admin</span>}</span><span className="ap-emp-email">{e.email}</span>{isSuper && !e.is_admin_profile && e.plain_password && (<span className="ap-emp-pass-row"><span className="ap-emp-pass-val">{visiblePass[e.id] ? e.plain_password : '••••••••'}</span><button className="ap-btn-icon ap-emp-pass-eye" onClick={() => togglePass(e.id)}>{visiblePass[e.id] ? <EyeOff size={12}/> : <Eye size={12}/>}</button></span>)}</div>
                <span className={`ap-emp-status${e.active ? ' active' : ''}`}>{e.active ? 'Activo' : 'Inactivo'}</span>
                {!e.is_admin_profile && (<button className="ap-btn ap-btn-danger ap-btn-sm" onClick={() => setConfirmId(e.id)}><Trash2 size={13}/></button>)}
              </div>
            ))}
          </div>
          <Pagination page={page} total={employees.length} pageSize={PAGE_SIZE_EMPLEADOS} onPage={setPage} />
        </>
      )}
      {showModal && <EmpleadoModal onClose={() => setShowModal(false)} onSaved={(emp) => { setEmployees(prev => [emp, ...prev]); setShowModal(false); toast.success('Empleado creado correctamente'); }} />}
      {confirmId && <ConfirmDialog message="¿Eliminar este empleado? Perderá el acceso al panel." onConfirm={handleDelete} onCancel={() => setConfirmId(null)} />}
    </div>
  );
}

function SectionClientes() {
  const { toasts, toast, remove } = useToast();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [clientProjects, setClientProjects] = useState({});
  const [allProjects, setAllProjects] = useState([]);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');
  const loadClients = async () => { try { const { data } = await api.get('/users?role=cliente'); setClients(data.users || []); } catch {} finally { setLoading(false); } };
  useEffect(() => { loadClients(); api.get('/client-projects').then(r => setAllProjects(r.data.projects || [])).catch(() => {}); }, []);
  const loadClientProjects = async (clientId) => { if (clientProjects[clientId] !== undefined) return; try { const { data } = await api.get(`/users/${clientId}/client-projects`); setClientProjects(prev => ({ ...prev, [clientId]: data.projects || [] })); } catch { setClientProjects(prev => ({ ...prev, [clientId]: [] })); } };
  const toggleExpand = (id) => { if (expandedId === id) { setExpandedId(null); return; } setExpandedId(id); loadClientProjects(id); };
  const handleCreate = async (e) => { e.preventDefault(); setFormError(''); setCreating(true); try { const { data } = await api.post('/users/cliente', { email, password }); setClients(prev => [data.user, ...prev]); setEmail(''); setPassword(''); setShowModal(false); toast.success('Cliente creado'); } catch (err) { setFormError(err.response?.data?.error || 'Error al crear el cliente'); } finally { setCreating(false); } };
  const handleDeleteClient = async (clientId) => { try { await api.delete(`/users/${clientId}`); setClients(prev => prev.filter(c => c.id !== clientId)); toast.success('Cliente eliminado'); } catch (err) { toast.error(err.response?.data?.error || 'Error al eliminar el cliente'); } finally { setConfirmDelete(null); } };
  const handleAssign = async (clientId, projectId) => { try { await api.post(`/users/${clientId}/client-projects`, { client_project_id: projectId }); const project = allProjects.find(p => p.id === projectId); if (project) { setClientProjects(prev => ({ ...prev, [clientId]: [...(prev[clientId] || []), project] })); } toast.success('Proyecto asignado'); } catch (err) { toast.error(err.response?.data?.error || 'Error al asignar proyecto'); } };
  const handleUnassign = async (clientId, projectId) => { try { await api.delete(`/users/${clientId}/client-projects/${projectId}`); setClientProjects(prev => ({ ...prev, [clientId]: prev[clientId].filter(p => p.id !== projectId) })); toast.success('Proyecto desasignado'); } catch (err) { toast.error(err.response?.data?.error || 'Error al desasignar proyecto'); } };
  const assignableProjects = (clientId) => { const assigned = (clientProjects[clientId] || []).map(p => p.id); return allProjects.filter(p => !assigned.includes(p.id)); };
  return (
    <div className="ap-section">
      <ToastContainer toasts={toasts} onRemove={remove} />
      {confirmDelete && <ConfirmDialog message="¿Eliminar este cliente? Se perderán todas sus asignaciones." onConfirm={() => handleDeleteClient(confirmDelete)} onCancel={() => setConfirmDelete(null)} />}
      <div className="ap-section-head"><div><h1>Clientes</h1><p>Crea cuentas para tus clientes y asígnales sus proyectos.</p></div><button className="ap-btn ap-btn-primary" onClick={() => setShowModal(true)}><Plus size={15} /> Nuevo cliente</button></div>
      {showModal && (<div className="ap-modal-overlay" onClick={() => setShowModal(false)}><div className="ap-modal" onClick={e => e.stopPropagation()}><div className="ap-modal-head"><h2>Nuevo cliente</h2><button className="ap-modal-close" onClick={() => setShowModal(false)}><X size={16} /></button></div><form onSubmit={handleCreate} className="ap-modal-form"><div className="ap-field"><label>Email *</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="cliente@email.com" required autoFocus /></div><div className="ap-field"><label>Contraseña *</label><input type="text" value={password} onChange={e => setPassword(e.target.value)} placeholder="Contraseña que le darás al cliente" required /><span className="ap-field-hint">El cliente usará estas credenciales para iniciar sesión.</span></div>{formError && <p className="ap-error">{formError}</p>}<div className="ap-modal-actions"><button type="button" className="ap-btn ap-btn-ghost" onClick={() => setShowModal(false)}>Cancelar</button><button type="submit" className="ap-btn ap-btn-primary" disabled={creating}>{creating ? 'Creando...' : 'Crear cliente'}</button></div></form></div></div>)}
      {loading ? <div className="ap-loading">Cargando clientes…</div> : clients.length === 0 ? <div className="ap-empty"><p>No hay clientes todavía.</p></div> : (
        <div className="ap-cl-list">
          {clients.map(client => { const isExpanded = expandedId === client.id; const assigned = clientProjects[client.id] || []; const available = assignableProjects(client.id); return (
            <div key={client.id} className={`ap-cl-row${isExpanded ? ' expanded' : ''}`}>
              <div className="ap-cl-main" onClick={() => toggleExpand(client.id)}><div className="ap-cl-avatar">{client.email.charAt(0).toUpperCase()}</div><div className="ap-cl-info"><span className="ap-cl-email">{client.email}</span><span className="ap-cl-meta">{new Date(client.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}</span></div><div className="ap-cl-actions"><button className="ap-btn ap-btn-danger ap-btn-sm" onClick={e => { e.stopPropagation(); setConfirmDelete(client.id); }}><Trash2 size={13} /></button><span className="ap-cl-chevron">{isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</span></div></div>
              {isExpanded && (<div className="ap-cl-projects"><p className="ap-cl-projects-title">Proyectos asignados</p>{assigned.length === 0 ? <p className="ap-cl-projects-empty">Sin proyectos asignados.</p> : (<div className="ap-cl-proj-list">{assigned.map(p => (<div key={p.id} className="ap-cl-proj-item"><span className="ap-cl-proj-name">{p.project_name}</span><span className="ap-cl-proj-client">{p.client_name}</span><button className="ap-btn ap-btn-danger ap-btn-xs" onClick={() => handleUnassign(client.id, p.id)}><X size={12} /></button></div>))}</div>)}{available.length > 0 && (<div className="ap-cl-assign"><select className="ap-select ap-cl-proj-select" defaultValue="" onChange={e => { if (e.target.value) { handleAssign(client.id, e.target.value); e.target.value = ''; } }}><option value="" disabled>+ Asignar proyecto…</option>{available.map(p => (<option key={p.id} value={p.id}>{p.project_name} — {p.client_name}</option>))}</select></div>)}</div>)}
            </div>
          ); })}
        </div>
      )}
    </div>
  );
}

function ReferenceModal({ reference, existingCategories, onClose, onSaved }) {
  const isEdit = !!reference;
  const [title, setTitle] = useState(reference?.title || '');
  const [url, setUrl] = useState(reference?.url || '');
  const [description, setDescription] = useState(reference?.description || '');
  const [category, setCategory] = useState(reference?.category || '');
  const [imageUrl, setImageUrl] = useState(reference?.image_url || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const handleSubmit = async (e) => { e.preventDefault(); if (!title.trim()) return; setSaving(true); setError(''); try { const payload = { title: title.trim(), url: url.trim() || null, description: description.trim() || null, category: category.trim() || null, image_url: imageUrl.trim() || null }; let data; if (isEdit) { ({ data } = await api.put(`/references/${reference.id}`, payload)); onSaved(data.reference, true); } else { ({ data } = await api.post('/references', payload)); onSaved(data.reference, false); } onClose(); } catch { setError('Error al guardar'); } finally { setSaving(false); } };
  return (
    <div className="ap-modal-overlay" onClick={onClose}><div className="ap-modal" onClick={e => e.stopPropagation()}><div className="ap-modal-head"><h2>{isEdit ? 'Editar referencia' : 'Nueva referencia'}</h2><button className="ap-modal-close" onClick={onClose}><X size={16}/></button></div><form onSubmit={handleSubmit} className="ap-modal-form"><div className="ap-field"><label>Título *</label><input value={title} onChange={e => setTitle(e.target.value)} placeholder="ej: Tarkett · Suelos deportivos" required autoFocus /></div><div className="ap-field"><label>URL</label><input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." /></div><div className="ap-field"><label>Categoría</label><input list="ref-categories" value={category} onChange={e => setCategory(e.target.value)} placeholder="ej: Suelos, Iluminación, Diseño…" /><datalist id="ref-categories">{(existingCategories || []).map(cat => <option key={cat} value={cat} />)}</datalist></div><div className="ap-field"><label>Imagen</label><input value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://ejemplo.com/imagen.jpg" />{imageUrl && <img src={imageUrl} alt="preview" style={{marginTop:'0.5rem',width:'100%',maxHeight:160,objectFit:'cover',borderRadius:8,opacity:0.85}} onError={e => e.target.style.display='none'} />}</div><div className="ap-field"><label>Descripción</label><textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="¿Qué te inspira de esto?" /></div>{error && <p className="ap-error">{error}</p>}<div className="ap-modal-actions"><button type="button" className="ap-btn ap-btn-ghost" onClick={onClose}>Cancelar</button><button type="submit" className="ap-btn ap-btn-primary" disabled={saving || !title.trim()}>{saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Añadir referencia'}</button></div></form></div></div>
  );
}

function SectionReferencias() {
  const [references, setReferences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [activeCategory, setActiveCategory] = useState('all');
  const { toasts, toast, remove } = useToast();
  useEffect(() => { api.get('/references').then(r => setReferences(r.data.references || [])).catch(() => toast.error('Error al cargar referencias')).finally(() => setLoading(false)); }, []);
  const categories = [...new Set(references.map(r => r.category).filter(Boolean))].sort();
  const visible = activeCategory === 'all' ? references : references.filter(r => r.category === activeCategory);
  const handleSaved = (ref, isEdit) => { setReferences(prev => isEdit ? prev.map(r => r.id === ref.id ? ref : r) : [ref, ...prev]); toast.success(isEdit ? 'Referencia actualizada' : 'Referencia añadida'); };
  const handleDelete = (id) => { setConfirm({ message: '¿Eliminar esta referencia?', onConfirm: async () => { try { await api.delete(`/references/${id}`); setReferences(prev => prev.filter(r => r.id !== id)); toast.success('Referencia eliminada'); } catch { toast.error('Error al eliminar'); } setConfirm(null); }, onCancel: () => setConfirm(null) }); };
  const getDomain = (url) => { try { return new URL(url).hostname.replace('www.', ''); } catch { return url; } };
  return (
    <div className="ap-section">
      <ToastContainer toasts={toasts} onRemove={remove} />
      {confirm && <ConfirmDialog {...confirm} />}
      {modal && <ReferenceModal reference={modal === 'new' ? null : modal} existingCategories={categories} onClose={() => setModal(null)} onSaved={handleSaved} />}
      <div className="ap-section-head"><div><h1>Referencias</h1><p>Tu tablero de inspiración.</p></div><button className="ap-btn ap-btn-primary" onClick={() => setModal('new')}><Plus size={15}/> Añadir referencia</button></div>
      {categories.length > 0 && (<div className="ap-ref-filters"><button className={`ap-catalog-pill${activeCategory === 'all' ? ' active' : ''}`} onClick={() => setActiveCategory('all')}>Todas ({references.length})</button>{categories.map(cat => (<button key={cat} className={`ap-catalog-pill${activeCategory === cat ? ' active' : ''}`} onClick={() => setActiveCategory(cat)}>{cat}<span className="ap-catalog-pill-count">{references.filter(r => r.category === cat).length}</span></button>))}</div>)}
      {loading ? <div className="ap-loading">Cargando…</div> : references.length === 0 ? <div className="ap-empty"><p>No hay referencias todavía.</p></div> : (
        <div className="ap-ref-grid">{visible.map(ref => (<div key={ref.id} className="ap-ref-card"><div className="ap-ref-card-img">{ref.image_url ? (<img src={ref.image_url} alt={ref.title} onError={e => { e.target.onerror=null; e.target.style.display='none'; }} />) : ref.url ? (<img src={`https://www.google.com/s2/favicons?domain=${getDomain(ref.url)}&sz=64`} alt={ref.title} className="ap-ref-favicon" />) : (<Bookmark size={24} style={{opacity:0.3}}/>)}</div><div className="ap-ref-card-body">{ref.category && <span className="ap-ref-category">{ref.category}</span>}<h3 className="ap-ref-title">{ref.title}</h3>{ref.description && <p className="ap-ref-desc">{ref.description}</p>}{ref.url && <span className="ap-ref-domain">{getDomain(ref.url)}</span>}</div><div className="ap-ref-card-actions">{ref.url && (<a href={ref.url} target="_blank" rel="noopener noreferrer" className="ap-btn ap-btn-primary ap-btn-sm"><ExternalLink size={12}/> Abrir</a>)}<button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => setModal(ref)}><Pencil size={12}/></button><button className="ap-btn ap-btn-danger ap-btn-sm" onClick={() => handleDelete(ref.id)}><Trash2 size={12}/></button></div></div>))}</div>
      )}
    </div>
  );
}

function ContactModal({ contact, existingSectors, onClose, onSaved }) {
  const isEdit = !!contact;
  const [name, setName] = useState(contact?.name || '');
  const [phone, setPhone] = useState(contact?.phone || '');
  const [email, setEmail] = useState(contact?.email || '');
  const [sector, setSector] = useState(contact?.sector || '');
  const [companyUrl, setCompanyUrl] = useState(contact?.company_url || '');
  const [description, setDescription] = useState(contact?.description || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const handleSubmit = async (e) => { e.preventDefault(); if (!name.trim()) return; setSaving(true); setError(''); try { const payload = { name: name.trim(), phone: phone.trim() || null, email: email.trim() || null, sector: sector.trim() || null, company_url: companyUrl.trim() || null, description: description.trim() || null }; let data; if (isEdit) { ({ data } = await api.put(`/contacts/${contact.id}`, payload)); onSaved(data.contact, true); } else { ({ data } = await api.post('/contacts', payload)); onSaved(data.contact, false); } onClose(); } catch { setError('Error al guardar'); } finally { setSaving(false); } };
  return (
    <div className="ap-modal-overlay" onClick={onClose}><div className="ap-modal" onClick={e => e.stopPropagation()}><div className="ap-modal-head"><h2>{isEdit ? 'Editar contacto' : 'Nuevo contacto'}</h2><button className="ap-modal-close" onClick={onClose}><X size={16}/></button></div><form onSubmit={handleSubmit} className="ap-modal-form"><div className="ap-field"><label>Nombre *</label><input value={name} onChange={e => setName(e.target.value)} placeholder="ej: Juan Martínez" required autoFocus /></div><div className="ap-field"><label>Sector</label><input list="contact-sectors" value={sector} onChange={e => setSector(e.target.value)} placeholder="ej: Suelos, Iluminación…" /><datalist id="contact-sectors">{(existingSectors || []).map(s => <option key={s} value={s} />)}</datalist></div><div className="ap-field"><label>Teléfono</label><input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+34 600 000 000" /></div><div className="ap-field"><label>Correo</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="contacto@empresa.com" /></div><div className="ap-field"><label>Web</label><input value={companyUrl} onChange={e => setCompanyUrl(e.target.value)} placeholder="https://..." /></div><div className="ap-field"><label>Descripción</label><textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Proveedor de parquet deportivo…" /></div>{error && <p className="ap-error">{error}</p>}<div className="ap-modal-actions"><button type="button" className="ap-btn ap-btn-ghost" onClick={onClose}>Cancelar</button><button type="submit" className="ap-btn ap-btn-primary" disabled={saving || !name.trim()}>{saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Añadir contacto'}</button></div></form></div></div>
  );
}

function SectionContactos() {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [activeSector, setActiveSector] = useState('all');
  const { toasts, toast, remove } = useToast();
  useEffect(() => { api.get('/contacts').then(r => setContacts(r.data.contacts || [])).catch(() => toast.error('Error al cargar contactos')).finally(() => setLoading(false)); }, []);
  const sectors = [...new Set(contacts.map(c => c.sector).filter(Boolean))].sort();
  const visible = activeSector === 'all' ? contacts : contacts.filter(c => c.sector === activeSector);
  const handleSaved = (contact, isEdit) => { setContacts(prev => { const updated = isEdit ? prev.map(c => c.id === contact.id ? contact : c) : [contact, ...prev]; return updated.sort((a, b) => a.name.localeCompare(b.name)); }); toast.success(isEdit ? 'Contacto actualizado' : 'Contacto añadido'); };
  const handleDelete = (id) => { setConfirm({ message: '¿Eliminar este contacto?', onConfirm: async () => { try { await api.delete(`/contacts/${id}`); setContacts(prev => prev.filter(c => c.id !== id)); toast.success('Contacto eliminado'); } catch { toast.error('Error al eliminar'); } setConfirm(null); }, onCancel: () => setConfirm(null) }); };
  return (
    <div className="ap-section">
      <ToastContainer toasts={toasts} onRemove={remove} />
      {confirm && <ConfirmDialog {...confirm} />}
      {modal && <ContactModal contact={modal === 'new' ? null : modal} existingSectors={sectors} onClose={() => setModal(null)} onSaved={handleSaved} />}
      <div className="ap-section-head"><div><h1>Contactos</h1><p>Tus proveedores y contactos de confianza.</p></div><button className="ap-btn ap-btn-primary" onClick={() => setModal('new')}><Plus size={15}/> Nuevo contacto</button></div>
      {sectors.length > 0 && (<div className="ap-ref-filters"><button className={`ap-catalog-pill${activeSector === 'all' ? ' active' : ''}`} onClick={() => setActiveSector('all')}>Todos ({contacts.length})</button>{sectors.map(s => (<button key={s} className={`ap-catalog-pill${activeSector === s ? ' active' : ''}`} onClick={() => setActiveSector(s)}>{s}<span className="ap-catalog-pill-count">{contacts.filter(c => c.sector === s).length}</span></button>))}</div>)}
      {loading ? <div className="ap-loading">Cargando…</div> : contacts.length === 0 ? <div className="ap-empty"><p>No hay contactos todavía.</p></div> : (
        <div className="ap-contacts-list">{visible.map(c => (<div key={c.id} className="ap-contact-row"><div className="ap-contact-avatar">{c.name.charAt(0).toUpperCase()}</div><div className="ap-contact-info"><div className="ap-contact-header"><span className="ap-contact-name">{c.name}</span>{c.sector && <span className="ap-contact-sector">{c.sector}</span>}</div><div className="ap-contact-details">{c.phone && (<a href={`tel:${c.phone}`} className="ap-contact-detail"><Phone size={11}/> {c.phone}</a>)}{c.email && (<a href={`mailto:${c.email}`} className="ap-contact-detail">{c.email}</a>)}{c.company_url && (<a href={c.company_url} target="_blank" rel="noopener noreferrer" className="ap-contact-detail ap-contact-web"><ExternalLink size={11}/> Web</a>)}</div>{c.description && <p className="ap-contact-desc">{c.description}</p>}</div><div className="ap-contact-actions"><button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => setModal(c)}><Pencil size={12}/> Editar</button><button className="ap-btn ap-btn-danger ap-btn-sm" onClick={() => handleDelete(c.id)}><Trash2 size={12}/></button></div></div>))}</div>
      )}
    </div>
  );
}

const NAV_ITEMS = [
  { id: 'dashboard',    label: 'Dashboard',    Icon: BarChart2,   adminOnly: true },
  { id: 'trabajos',     label: 'Trabajos',     Icon: LayoutGrid },
  { id: 'proyectos',    label: 'Proyectos',    Icon: FolderOpen },
  { id: 'clientes',     label: 'Clientes',     Icon: UserCheck },
  { id: 'empleados',    label: 'Empleados',    Icon: Users,       adminOnly: true },
  { id: 'presupuestos', label: 'Presupuestos', Icon: Calculator,  adminOnly: true },
  { id: 'catalogo',     label: 'Catálogo',     Icon: BookOpen },
  { id: 'referencias',  label: 'Referencias',  Icon: Bookmark },
  { id: 'contactos',    label: 'Contactos',    Icon: Phone },
];

export function AdminPanel() {
  const { user, logout } = useAdminAuth();
  const navigate = useNavigate();
  const [section, setSection] = useState(user?.role === 'admin_superior' ? 'dashboard' : 'trabajos');
  const handleLogout = () => { logout(); navigate('/admin'); };
  return (
    <div className="ap">
      <aside className="ap-sidebar">
        <div className="ap-sidebar-logo"><img src="/iconoRanuse.ico" alt="Ranuse" /><span>Ranuse Design</span></div>
        <nav className="ap-nav">
          {NAV_ITEMS.filter(item => !item.adminOnly || user?.role === 'admin_superior').map(item => (
            <button key={item.id} className={`ap-nav-item${section === item.id ? ' active' : ''}`} onClick={() => setSection(item.id)}><item.Icon size={17} className="ap-nav-icon" /><span>{item.label}</span></button>
          ))}
        </nav>
        <div className="ap-sidebar-footer"><p className="ap-user">{user?.email}</p><button className="ap-logout" onClick={handleLogout}><LogOut size={13} /> Cerrar sesión</button></div>
      </aside>
      <main className="ap-main">
        {section === 'dashboard'    && <SectionDashboard />}
        {section === 'trabajos'     && <SectionTrabajos />}
        {section === 'proyectos'    && <SectionProyectos />}
        {section === 'clientes'     && <SectionClientes />}
        {section === 'empleados'    && <SectionEmpleados />}
        {section === 'presupuestos' && <SectionPresupuestos />}
        {section === 'catalogo'     && <SectionCatalogo />}
        {section === 'referencias'  && <SectionReferencias />}
        {section === 'contactos'    && <SectionContactos />}
      </main>
    </div>
  );
}
