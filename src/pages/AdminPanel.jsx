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
