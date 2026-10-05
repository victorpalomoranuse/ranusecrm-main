import { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, Trash2, ChevronUp, ChevronDown, Eye, EyeOff, Upload, Sparkles, X, ExternalLink, FileText } from 'lucide-react';
import api from '../services/api';

// Editor de la "Historia" del Proyecto creativo (Servicio 1): capítulos,
// bloques, servicios del espacio y entregables. Solo se usa en proyectos
// con tipo de proyecto / capítulos; el resto del admin no lo necesita.

const TIPOS_PROYECTO = [
  { id: 'comercial', label: 'Gimnasio comercial' },
  { id: 'home_gym', label: 'Home gym' },
];
const TIPOS_BLOQUE = [
  { id: 'imagen_texto', label: 'Imagen + texto' },
  { id: 'render', label: 'Render grande' },
  { id: 'zona', label: 'Zona' },
  { id: 'detalle', label: 'Detalle' },
  { id: 'galeria', label: 'Galería de renders' },
  { id: 'equipo', label: 'Equipo (de Listados)' },
];
const ETIQUETAS = [
  { id: 'incluido', label: 'Incluido' },
  { id: 'extra', label: 'Extra' },
  { id: 'wow', label: 'Wow' },
];
const ESTADOS = [
  { id: 'pendiente', label: 'Pendiente' },
  { id: 'en_curso', label: 'En curso' },
  { id: 'entregado', label: 'Entregado' },
];

const box = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '0.9rem 1rem' };
const muted = { fontSize: '0.72rem', color: 'rgba(255,255,255,0.45)' };
const row = { display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' };

// ── Selector de tipo + capítulos a incluir (crear proyecto / generar) ──
export function SelectorTipoHistoria({ tipo, setTipo, seleccion, setSeleccion, extras = [], setExtras }) {
  const [plantilla, setPlantilla] = useState([]);
  const [catalogoExtras, setCatalogoExtras] = useState([]);
  useEffect(() => { if (setExtras) api.get('/historia/extras').then(r => setCatalogoExtras(r.data.extras || [])).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleExtra = (id) => setExtras(e => (e.includes(id) ? e.filter(x => x !== id) : [...e, id]));

  useEffect(() => {
    if (!tipo) { setPlantilla([]); setSeleccion([]); return; }
    api.get(`/historia/plantillas/${tipo}`).then(r => {
      const caps = r.data.capitulos || [];
      setPlantilla(caps);
      setSeleccion(caps.map(c => c.orden));
    }).catch(() => setPlantilla([]));
  }, [tipo]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (orden) => setSeleccion(s => s.includes(orden) ? s.filter(o => o !== orden) : [...s, orden]);

  return (
    <div>
      <div style={row}>
        <button type="button" className={`ap-btn ap-btn-sm ${!tipo ? 'ap-btn-primary' : 'ap-btn-ghost'}`} onClick={() => setTipo('')}>Sin historia (proyecto clásico)</button>
        {TIPOS_PROYECTO.map(t => (
          <button key={t.id} type="button" className={`ap-btn ap-btn-sm ${tipo === t.id ? 'ap-btn-primary' : 'ap-btn-ghost'}`} onClick={() => setTipo(t.id)}>{t.label}</button>
        ))}
      </div>
      {tipo && plantilla.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <p style={muted}>Capítulos a incluir (desmarca los que no apliquen, p. ej. Recuperación):</p>
          <div style={{ ...row, marginTop: 6 }}>
            {plantilla.map(c => (
              <label key={c.orden} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.82rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={seleccion.includes(c.orden)} onChange={() => toggle(c.orden)} /> {c.titulo}
              </label>
            ))}
          </div>
          {setExtras && catalogoExtras.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <p style={muted}>Capítulos extra (opcional): zonas que este espacio también tiene, p. ej. una zona de grabación de contenido.</p>
              <div style={{ ...row, marginTop: 6 }}>
                {catalogoExtras.map(x => (
                  <label key={x.id} title={x.descripcion || ''} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.82rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={extras.includes(x.id)} onChange={() => toggleExtra(x.id)} /> {x.titulo}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Campo de texto con guardado al salir y botones de IA ───────────────
function Campo({ value, onSave, rows = 0, placeholder, ia = false, contexto, onReescribir, label }) {
  const [draft, setDraft] = useState(value || '');
  const [propuesta, setPropuesta] = useState(null);
  const [cargando, setCargando] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { setDraft(value || ''); }, [value]);

  const guardar = (v) => { if ((v || '') !== (value || '')) onSave(v); };

  const pedir = async (modo) => {
    setError(''); setCargando(modo);
    try {
      const { data } = modo === 'corregir'
        ? await api.post('/historia/ia/corregir', { texto: draft, contexto })
        : await onReescribir();
      setPropuesta(data.propuesta);
    } catch (e) { setError(e.response?.data?.error || 'La IA no ha podido responder'); }
    finally { setCargando(''); }
  };

  const Tag = rows ? 'textarea' : 'input';
  return (
    <div className="ap-field" style={{ marginBottom: 8 }}>
      {label && <label>{label}</label>}
      <Tag value={draft} rows={rows || undefined} placeholder={placeholder}
        onChange={e => setDraft(e.target.value)} onBlur={() => guardar(draft)} />
      {ia && (
        <div style={{ ...row, marginTop: 4 }}>
          <button type="button" className="ap-btn ap-btn-ghost ap-btn-xs" disabled={!draft.trim() || !!cargando} onClick={() => pedir('corregir')}>
            <Sparkles size={11} /> {cargando === 'corregir' ? 'Corrigiendo…' : 'Corregir con IA'}
          </button>
          {onReescribir && (
            <button type="button" className="ap-btn ap-btn-ghost ap-btn-xs" disabled={!!cargando} onClick={() => pedir('reescribir')}>
              <Sparkles size={11} /> {cargando === 'reescribir' ? 'Escribiendo…' : 'Reescribir con datos del proyecto'}
            </button>
          )}
        </div>
      )}
      {error && <p className="ap-error" style={{ marginTop: 4 }}>{error}</p>}
      {propuesta && (
        <div style={{ ...box, marginTop: 6, borderColor: 'rgba(190,176,162,0.5)' }}>
          <p style={{ ...muted, marginBottom: 4 }}>Propuesta de la IA (no se guarda hasta que la uses):</p>
          <p style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>{propuesta}</p>
          <div style={{ ...row, marginTop: 8 }}>
            <button type="button" className="ap-btn ap-btn-primary ap-btn-xs" onClick={() => { setDraft(propuesta); onSave(propuesta); setPropuesta(null); }}>Usar propuesta</button>
            <button type="button" className="ap-btn ap-btn-ghost ap-btn-xs" onClick={() => setPropuesta(null)}>Descartar</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Subida de imagen / PDF ─────────────────────────────────────────────
function Subir({ projectId, onUrl, label = 'Subir', accept = 'image/*' }) {
  const ref = useRef(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState('');
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(''); setSubiendo(true);
    try {
      const form = new FormData(); form.append('file', file);
      const { data } = await api.post(`/historia/${projectId}/subir`, form);
      onUrl(data.url);
    } catch (err) { setError(err.response?.data?.error || 'Error al subir'); }
    finally { setSubiendo(false); if (ref.current) ref.current.value = ''; }
  };
  return (
    <span>
      <input ref={ref} type="file" accept={accept} style={{ display: 'none' }} onChange={onFile} />
      <button type="button" className="ap-btn ap-btn-ghost ap-btn-xs" disabled={subiendo} onClick={() => ref.current?.click()}>
        <Upload size={11} /> {subiendo ? 'Subiendo…' : label}
      </button>
      {error && <span className="ap-error" style={{ marginLeft: 6 }}>{error}</span>}
    </span>
  );
}

// Sube varias imágenes de golpe y las reparte: primero el render principal si
// está vacío, luego los huecos de render vacíos y, si sobran, crea bloques
// de render nuevos. Así subir los renders de un capítulo es un solo paso.
function SubirVariosRenders({ projectId, capitulo, bloques, llamar }) {
  const ref = useRef(null);
  const [estado, setEstado] = useState('');
  const [error, setError] = useState('');
  const onFiles = async (e) => {
    const files = [...(e.target.files || [])];
    if (!files.length) return;
    setError('');
    let principalLibre = !capitulo.render_url;
    const huecos = bloques.filter(b => b.tipo === 'render' && !b.imagen_url).map(b => b.id);
    try {
      for (let i = 0; i < files.length; i++) {
        setEstado(`Subiendo ${i + 1} de ${files.length}…`);
        const form = new FormData(); form.append('file', files[i]);
        const { data } = await api.post(`/historia/${projectId}/subir`, form);
        if (principalLibre) { await api.put(`/historia/capitulos/${capitulo.id}`, { render_url: data.url }); principalLibre = false; }
        else if (huecos.length) await api.put(`/historia/bloques/${huecos.shift()}`, { imagen_url: data.url });
        else await api.post(`/historia/capitulos/${capitulo.id}/bloques`, { tipo: 'render', imagen_url: data.url });
      }
    } catch (err) { setError(err.response?.data?.error || 'Error al subir los renders'); }
    finally { setEstado(''); if (ref.current) ref.current.value = ''; await llamar(async () => {}); }
  };
  return (
    <span>
      <input ref={ref} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={onFiles} />
      <button type="button" className="ap-btn ap-btn-primary ap-btn-sm" disabled={!!estado} onClick={() => ref.current?.click()}>
        <Upload size={12} /> {estado || 'Subir renders (varios a la vez)'}
      </button>
      {error && <span className="ap-error" style={{ marginLeft: 6 }}>{error}</span>}
    </span>
  );
}

function Miniatura({ url, onQuitar }) {
  if (!url) return null;
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <img src={url} alt="" style={{ height: 54, borderRadius: 6, display: 'block' }} />
      <button type="button" onClick={onQuitar} title="Quitar imagen"
        style={{ position: 'absolute', top: -6, right: -6, background: '#000', color: '#fff', border: 'none', borderRadius: '50%', width: 18, height: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
    </span>
  );
}

// ── Pestaña principal ──────────────────────────────────────────────────
export function TabHistoria({ project }) {
  const projectId = project.id;
  const [data, setData] = useState(null);
  const [vista, setVista] = useState('capitulos');
  const [capSel, setCapSel] = useState(null);
  const [error, setError] = useState('');
  const [tipoGen, setTipoGen] = useState('');
  const [selGen, setSelGen] = useState([]);
  const [extrasGen, setExtrasGen] = useState([]);
  const [generando, setGenerando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const { data: h } = await api.get(`/historia/${projectId}`);
      setData(h);
      setCapSel(prev => (prev === 'plano' || h.capitulos.some(c => c.id === prev) ? prev : h.capitulos[0]?.id || null));
    } catch { setError('No se pudo cargar la historia'); }
  }, [projectId]);
  useEffect(() => { cargar(); }, [cargar]);

  const llamar = async (fn) => {
    setError('');
    try { await fn(); await cargar(); }
    catch (e) { setError(e.response?.data?.error || 'Error al guardar'); }
  };

  if (!data) return <p style={muted}>{error || 'Cargando…'}</p>;

  // Proyecto sin historia: se puede generar (esto cambia lo que ve el cliente)
  if (!data.capitulos.length) {
    const generar = async () => {
      if (!tipoGen) return;
      if (!window.confirm('Al generar la historia, el cliente verá este proyecto como una historia por capítulos en lugar de las categorías actuales. ¿Continuar?')) return;
      setGenerando(true); setError('');
      try { await api.post(`/historia/${projectId}/generar`, { tipo: tipoGen, capitulos_orden: selGen, capitulos_extra: extrasGen }); await cargar(); }
      catch (e) { setError(e.response?.data?.error || 'Error al generar la historia'); }
      finally { setGenerando(false); }
    };
    return (
      <div style={box}>
        <h3 style={{ marginBottom: 6 }}>Este proyecto no tiene historia</h3>
        <p style={{ ...muted, marginBottom: 12 }}>El portal del cliente se muestra como siempre. Si generas la historia, pasará a verse como un recorrido por capítulos (Proyecto creativo).</p>
        <SelectorTipoHistoria tipo={tipoGen} setTipo={setTipoGen} seleccion={selGen} setSeleccion={setSelGen} extras={extrasGen} setExtras={setExtrasGen} />
        {error && <p className="ap-error" style={{ marginTop: 8 }}>{error}</p>}
        <div style={{ marginTop: 12 }}>
          <button type="button" className="ap-btn ap-btn-primary" disabled={!tipoGen || !selGen.length || generando} onClick={generar}>{generando ? 'Generando…' : 'Generar historia'}</button>
        </div>
      </div>
    );
  }

  const capitulo = data.capitulos.find(c => c.id === capSel) || data.capitulos[0];

  return (
    <div>
      <div style={{ ...row, justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={row}>
          {[['capitulos', 'Capítulos'], ['servicios', 'Soluciones y servicios'], ['entregables', 'Entregables']].map(([id, label]) => (
            <button key={id} type="button" className={`ap-btn ap-btn-sm ${vista === id ? 'ap-btn-primary' : 'ap-btn-ghost'}`} onClick={() => setVista(id)}>{label}</button>
          ))}
        </div>
        <a className="ap-btn ap-btn-ghost ap-btn-sm" href={`/mi-proyecto?code=${project.access_code}`} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} /> Ver portal del cliente</a>
      </div>
      {error && <p className="ap-error" style={{ marginBottom: 8 }}>{error}</p>}

      {vista === 'capitulos' && (
        <VistaCapitulos projectId={projectId} data={data} capitulo={capitulo} esPlano={capSel === 'plano'} setCapSel={setCapSel} llamar={llamar} project={project} />
      )}
      {vista === 'servicios' && <VistaServicios projectId={projectId} data={data} llamar={llamar} />}
      {vista === 'entregables' && <VistaEntregables projectId={projectId} data={data} llamar={llamar} />}
    </div>
  );
}

// ── Capítulos + bloques ────────────────────────────────────────────────
function VistaCapitulos({ projectId, data, capitulo, esPlano, setCapSel, llamar, project }) {
  const caps = data.capitulos;
  const bloques = data.bloques.filter(b => b.capitulo_id === capitulo.id).sort((a, b) => a.orden - b.orden);

  const mover = (idx, dir) => {
    const ids = caps.map(c => c.id); const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    llamar(() => api.put(`/historia/${projectId}/capitulos/orden`, { ids }));
  };
  const [anadiendo, setAnadiendo] = useState(false);
  const [catalogo, setCatalogo] = useState([]);
  const [tituloNuevo, setTituloNuevo] = useState('');
  const abrirAnadir = () => {
    setAnadiendo(a => !a);
    if (!catalogo.length) api.get('/historia/extras').then(r => setCatalogo(r.data.extras || [])).catch(() => {});
  };
  const anadirExtra = (id) => { setAnadiendo(false); llamar(() => api.post(`/historia/${projectId}/capitulos/extra`, { extra_id: id })); };
  const anadirBlanco = () => {
    if (!tituloNuevo.trim()) return;
    const t = tituloNuevo; setTituloNuevo(''); setAnadiendo(false);
    llamar(() => api.post(`/historia/${projectId}/capitulos`, { titulo: t }));
  };
  const borrarCapitulo = () => {
    if (window.confirm(`¿Eliminar el capítulo "${capitulo.titulo}" con sus bloques? (Si solo quieres quitarlo del portal, ocúltalo.)`)) llamar(() => api.delete(`/historia/capitulos/${capitulo.id}`));
  };
  const guardarCap = (campos) => llamar(() => api.put(`/historia/capitulos/${capitulo.id}`, campos));

  const moverBloque = (idx, dir) => {
    const ids = bloques.map(b => b.id); const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    llamar(() => api.put(`/historia/capitulos/${capitulo.id}/bloques/orden`, { ids }));
  };
  const nuevoBloque = (tipo) => llamar(() => api.post(`/historia/capitulos/${capitulo.id}/bloques`, { tipo, titulo: '' }));

  return (
    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div style={{ ...box, flex: '0 0 230px', minWidth: 200 }}>
        <div style={{ ...row, flexWrap: 'nowrap', padding: '8px 6px', borderRadius: 6, cursor: 'pointer', background: esPlano ? 'rgba(190,176,162,0.16)' : 'transparent', borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: 6 }} onClick={() => setCapSel('plano')}>
          <span style={{ width: 18 }}>📐</span>
          <span style={{ flex: 1, fontSize: '0.85rem', fontWeight: 600 }}>Plano y recorrido</span>
        </div>
        {caps.map((c, i) => (
          <div key={c.id} style={{ ...row, flexWrap: 'nowrap', padding: '6px 4px', borderRadius: 6, cursor: 'pointer', background: !esPlano && c.id === capitulo.id ? 'rgba(190,176,162,0.16)' : 'transparent', opacity: c.visible ? 1 : 0.45 }}
            onClick={() => setCapSel(c.id)}>
            <span style={{ ...muted, width: 18 }}>{i + 1}</span>
            <span style={{ flex: 1, fontSize: '0.85rem' }}>{c.titulo}</span>
            <button type="button" className="ap-btn-icon" title="Subir" onClick={e => { e.stopPropagation(); mover(i, -1); }}><ChevronUp size={13} /></button>
            <button type="button" className="ap-btn-icon" title="Bajar" onClick={e => { e.stopPropagation(); mover(i, 1); }}><ChevronDown size={13} /></button>
          </div>
        ))}
        <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" style={{ marginTop: 8, width: '100%' }} onClick={abrirAnadir}><Plus size={12} /> Añadir capítulo o zona</button>
        {anadiendo && (
          <div style={{ ...box, marginTop: 8, padding: '0.6rem' }}>
            <p style={{ ...muted, marginBottom: 6 }}>Elige una zona ya preparada (con texto y bloques sugeridos):</p>
            {catalogo.map(x => (
              <button key={x.id} type="button" className="ap-btn ap-btn-ghost ap-btn-xs" style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 4 }} title={x.descripcion || ''} onClick={() => anadirExtra(x.id)}>
                {x.titulo}
              </button>
            ))}
            <p style={{ ...muted, margin: '8px 0 4px' }}>O empieza en blanco:</p>
            <div style={row}>
              <input value={tituloNuevo} onChange={e => setTituloNuevo(e.target.value)} onKeyDown={e => e.key === 'Enter' && anadirBlanco()} placeholder="Título del capítulo" style={{ flex: 1, minWidth: 120 }} />
              <button type="button" className="ap-btn ap-btn-primary ap-btn-xs" onClick={anadirBlanco}>Crear</button>
            </div>
          </div>
        )}
      </div>

      {esPlano ? <PlanoEditor projectId={projectId} project={project} caps={caps} /> : (
      <div style={{ flex: 1, minWidth: 280 }}>
        <div style={{ ...box, marginBottom: '1rem' }}>
          <div style={{ ...row, justifyContent: 'space-between', marginBottom: 8 }}>
            <strong>Capítulo {caps.findIndex(c => c.id === capitulo.id) + 1}</strong>
            <div style={row}>
              <button type="button" className="ap-btn ap-btn-ghost ap-btn-xs" onClick={() => guardarCap({ visible: !capitulo.visible })}>
                {capitulo.visible ? <><Eye size={11} /> Visible al cliente</> : <><EyeOff size={11} /> Oculto</>}
              </button>
              <button type="button" className="ap-btn ap-btn-danger ap-btn-xs" onClick={borrarCapitulo}><Trash2 size={11} /></button>
            </div>
          </div>
          <div style={{ ...box, marginBottom: 10, borderColor: 'rgba(190,176,162,0.35)' }}>
            <div style={{ ...row, justifyContent: 'space-between', marginBottom: 6 }}>
              <strong style={{ fontSize: '0.85rem' }}>Renders del capítulo</strong>
              <SubirVariosRenders projectId={projectId} capitulo={capitulo} bloques={bloques} llamar={llamar} />
            </div>
            <p style={{ ...muted, marginBottom: 6 }}>Selecciona todos los renders de este capítulo a la vez: el primero será el principal (a pantalla completa) y los demás van a los huecos de render de abajo.</p>
            <div style={row}>
              {capitulo.render_url ? <Miniatura url={capitulo.render_url} onQuitar={() => guardarCap({ render_url: null })} /> : <span style={{ ...muted, color: '#f5b748' }}>Falta el render principal</span>}
              {bloques.filter(b => b.tipo === 'render' && b.imagen_url).map(b => <Miniatura key={b.id} url={b.imagen_url} onQuitar={() => llamar(() => api.put(`/historia/bloques/${b.id}`, { imagen_url: null }))} />)}
            </div>
          </div>
          <Campo label="Título" value={capitulo.titulo} onSave={v => v.trim() && guardarCap({ titulo: v })} />
          <Campo label="Texto de entrada" rows={4} value={capitulo.texto} onSave={v => guardarCap({ texto: v })}
            ia contexto={`Introducción del capítulo "${capitulo.titulo}"`}
            onReescribir={() => api.post(`/historia/capitulos/${capitulo.id}/ia-reescribir`, {})} />
          <Campo label="Detalle sensorial (guía interna: luz, olor, sonido, tacto)" value={capitulo.sensorial} onSave={v => guardarCap({ sensorial: v })} />
          <div className="ap-field" style={{ marginBottom: 8 }}>
            <label>Render principal del capítulo</label>
            <div style={row}>
              <Miniatura url={capitulo.render_url} onQuitar={() => guardarCap({ render_url: null })} />
              <Subir projectId={projectId} label={capitulo.render_url ? 'Cambiar render' : 'Subir render'} onUrl={u => guardarCap({ render_url: u })} />
            </div>
          </div>
          <Campo label="Tour virtual (opcional, solo si el proyecto lo lleva)" value={capitulo.tour_url} placeholder="https://…" onSave={v => guardarCap({ tour_url: v })} />
        </div>

        <div style={box}>
          <div style={{ ...row, justifyContent: 'space-between', marginBottom: 8 }}>
            <strong>Bloques del capítulo</strong>
            <div style={row}>
              {TIPOS_BLOQUE.map(t => (
                <button key={t.id} type="button" className="ap-btn ap-btn-ghost ap-btn-xs" onClick={() => nuevoBloque(t.id)}><Plus size={11} /> {t.label}</button>
              ))}
            </div>
          </div>
          <p style={{ ...muted, marginBottom: 8 }}>Un bloque sin texto ni imagen no se muestra al cliente. La guía es solo para el equipo.</p>
          {bloques.length === 0 && <p style={muted}>Todavía no hay bloques.</p>}
          {bloques.map((b, i) => (
            <BloqueEditor key={b.id} projectId={projectId} b={b} idx={i} total={bloques.length} mover={moverBloque} llamar={llamar} />
          ))}
        </div>
      </div>
      )}
    </div>
  );
}

// Plano de distribución con el recorrido: sección propia del portal, entre "La atmósfera" y el capítulo 1
function PlanoEditor({ projectId, project, caps }) {
  const [plano, setPlano] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get(`/historia/${projectId}/plano`).then(r => setPlano(r.data)).catch(() => setError('No se pudo cargar el plano (¿has ejecutado el SQL v65?)'));
  }, [projectId]);
  const guardar = async (campos) => {
    setError('');
    try { await api.put(`/historia/${projectId}/plano`, campos); setPlano(p => ({ ...p, ...campos })); }
    catch (e) { setError(e.response?.data?.error || 'Error al guardar el plano'); }
  };
  return (
    <div style={{ flex: 1, minWidth: 280 }}>
      <div style={box}>
        <strong>Plano de distribución con el recorrido</strong>
        <p style={{ ...muted, margin: '6px 0 10px' }}>
          Es una sección propia del portal: aparece al principio del portal, justo después de la portada y antes de "La atmósfera" y los capítulos, para que el cliente entienda el espacio desde el primer momento. Lleva una leyenda numerada que lleva a cada capítulo.
          Sube aquí el plano como <strong>imagen</strong> (JPG o PNG, con el recorrido numerado). El <strong>PDF</strong> del plano se sube aparte en Entregables → Generales y es el que el cliente descarga en su dossier.
        </p>
        {error && <p className="ap-error" style={{ marginBottom: 8 }}>{error}</p>}
        {plano && (
          <>
            <div className="ap-field" style={{ marginBottom: 10 }}>
              <label>Imagen del plano</label>
              {plano.imagen_url && <img src={plano.imagen_url} alt="" style={{ maxWidth: '100%', maxHeight: 260, objectFit: 'contain', borderRadius: 6, background: '#fff', display: 'block', marginBottom: 8 }} />}
              <div style={row}>
                <Subir projectId={projectId} label={plano.imagen_url ? 'Cambiar plano' : 'Subir plano'} onUrl={u => guardar({ imagen_url: u })} />
                {plano.imagen_url && <button type="button" className="ap-btn ap-btn-ghost ap-btn-xs" onClick={() => guardar({ imagen_url: null })}>Quitar</button>}
              </div>
              {!plano.imagen_url && <p style={{ ...muted, color: '#f5b748', marginTop: 6 }}>Sin imagen: la sección no se muestra al cliente.</p>}
            </div>
            <Campo label="Frase bajo el plano (opcional)" value={plano.texto} placeholder="Así se organiza tu espacio y así lo recorres, paso a paso." onSave={v => guardar({ texto: v })} ia contexto="Frase corta bajo un plano de distribución con recorrido" />
            <p style={{ ...muted, marginTop: 8 }}>La leyenda que verá el cliente: {caps.filter(c => c.visible).map((c, i) => `${i + 1} ${c.titulo}`).join(' · ')}</p>
          </>
        )}
      </div>
    </div>
  );
}

// Galería: varios renders del mismo espacio en un solo bloque (se guardan en "elementos")
function GaleriaBloque({ projectId, b, guardar }) {
  const ref = useRef(null);
  const [estado, setEstado] = useState('');
  const fotos = b.elementos || [];
  const onFiles = async (e) => {
    const files = [...(e.target.files || [])];
    if (!files.length) return;
    let lista = [...fotos];
    try {
      for (let i = 0; i < files.length; i++) {
        setEstado(`Subiendo ${i + 1} de ${files.length}…`);
        const form = new FormData(); form.append('file', files[i]);
        const { data } = await api.post(`/historia/${projectId}/subir`, form);
        lista = [...lista, data.url];
      }
      await guardar({ elementos: lista });
    } finally { setEstado(''); if (ref.current) ref.current.value = ''; }
  };
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ ...row, marginBottom: 6 }}>
        {fotos.map((u, i) => <Miniatura key={u + i} url={u} onQuitar={() => guardar({ elementos: fotos.filter((_, k) => k !== i) })} />)}
        {!fotos.length && <span style={{ ...muted, color: '#f5b748' }}>Sin renders todavía: el bloque no se muestra</span>}
      </div>
      <input ref={ref} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={onFiles} />
      <button type="button" className="ap-btn ap-btn-ghost ap-btn-xs" disabled={!!estado} onClick={() => ref.current?.click()}><Upload size={11} /> {estado || 'Añadir renders (varios a la vez)'}</button>
      <p style={{ ...muted, marginTop: 4 }}>El primero se muestra grande y los demás debajo.</p>
    </div>
  );
}

function BloqueEditor({ projectId, b, idx, mover, llamar }) {
  const guardar = (campos) => llamar(() => api.put(`/historia/bloques/${b.id}`, campos));
  const vacio = b.tipo === 'equipo' ? false : b.tipo === 'galeria' ? !(b.elementos || []).length : (!b.texto?.trim() && !b.imagen_url);
  return (
    <div style={{ ...box, marginBottom: 10, opacity: b.visible ? 1 : 0.55 }}>
      <div style={{ ...row, justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={row}>
          <select className="ap-select" style={{ width: 'auto' }} value={b.tipo} onChange={e => guardar({ tipo: e.target.value })}>
            {TIPOS_BLOQUE.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          {vacio && <span style={{ ...muted, color: '#f5b748' }}>Vacío: no se muestra</span>}
        </div>
        <div style={row}>
          <button type="button" className="ap-btn-icon" onClick={() => mover(idx, -1)}><ChevronUp size={13} /></button>
          <button type="button" className="ap-btn-icon" onClick={() => mover(idx, 1)}><ChevronDown size={13} /></button>
          <button type="button" className="ap-btn-icon" title={b.visible ? 'Ocultar' : 'Mostrar'} onClick={() => guardar({ visible: !b.visible })}>{b.visible ? <Eye size={13} /> : <EyeOff size={13} />}</button>
          <button type="button" className="ap-btn-icon" onClick={() => window.confirm('¿Eliminar este bloque?') && llamar(() => api.delete(`/historia/bloques/${b.id}`))}><Trash2 size={13} /></button>
        </div>
      </div>
      {b.guia && <p style={{ ...muted, marginBottom: 6 }}>💡 {b.guia}</p>}
      <Campo placeholder="Título" value={b.titulo} onSave={v => guardar({ titulo: v })} />
      <Campo rows={3} placeholder="Texto" value={b.texto} onSave={v => guardar({ texto: v })} ia contexto={`Bloque "${b.titulo || b.tipo}" de una historia de proyecto`} />
      {b.tipo === 'zona' && (
        <Campo rows={3} placeholder="Qué incluye la zona (una línea por elemento)" value={(b.elementos || []).join('\n')}
          onSave={v => guardar({ elementos: v.split('\n') })} />
      )}
      {b.tipo === 'galeria' && <GaleriaBloque projectId={projectId} b={b} guardar={guardar} />}
      {b.tipo === 'equipo' && <p style={muted}>Se rellena solo con el equipamiento de la pestaña Listados (solo salen los equipos que tengan foto).</p>}
      {b.tipo === 'plano' && <p style={{ ...muted, marginBottom: 6 }}>Sube el plano como imagen (JPG/PNG). Debajo se genera sola la leyenda con los capítulos. El PDF del plano se sube en Entregables.</p>}
      <div style={{ ...row, display: b.tipo === 'galeria' || b.tipo === 'equipo' ? 'none' : 'flex' }}>
        <Miniatura url={b.imagen_url} onQuitar={() => guardar({ imagen_url: null })} />
        <Subir projectId={projectId} label={b.imagen_url ? 'Cambiar imagen' : 'Subir imagen'} onUrl={u => guardar({ imagen_url: u })} />
        {b.tipo === 'imagen_texto' && (
          <select className="ap-select" style={{ width: 'auto' }} value={b.lado} onChange={e => guardar({ lado: e.target.value })}>
            <option value="derecha">Imagen a la derecha</option>
            <option value="izquierda">Imagen a la izquierda</option>
          </select>
        )}
      </div>
    </div>
  );
}

// ── Servicios del espacio ──────────────────────────────────────────────
function VistaServicios({ projectId, data, llamar }) {
  const nuevo = () => {
    const nombre = window.prompt('Nombre del servicio (p. ej. Servicio de toallas)');
    if (nombre?.trim()) llamar(() => api.post(`/historia/${projectId}/servicios`, { nombre, capitulos: [] }));
  };
  return (
    <div>
      <div style={{ ...row, justifyContent: 'space-between', marginBottom: 8 }}>
        <p style={muted}>Cada servicio se escribe una vez y se muestra en todos los capítulos que marques. Sin descripción ni imagen no se muestra al cliente.</p>
        <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={nuevo}><Plus size={12} /> Servicio</button>
      </div>
      {data.servicios.length === 0 && <p style={muted}>No hay servicios todavía.</p>}
      {data.servicios.map(s => {
        const guardar = (campos) => llamar(() => api.put(`/historia/servicios/${s.id}`, campos));
        return (
          <div key={s.id} style={{ ...box, marginBottom: 10 }}>
            <div style={{ ...row, justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={row}>
                {ETIQUETAS.map(e => (
                  <button key={e.id} type="button" className={`ap-btn ap-btn-xs ${s.etiqueta === e.id ? 'ap-btn-primary' : 'ap-btn-ghost'}`} onClick={() => guardar({ etiqueta: e.id })}>{e.label}</button>
                ))}
              </div>
              <button type="button" className="ap-btn-icon" onClick={() => window.confirm(`¿Eliminar "${s.nombre}"?`) && llamar(() => api.delete(`/historia/servicios/${s.id}`))}><Trash2 size={13} /></button>
            </div>
            {s.guia && <p style={{ ...muted, marginBottom: 6 }}>💡 {s.guia}</p>}
            <Campo placeholder="Nombre" value={s.nombre} onSave={v => v.trim() && guardar({ nombre: v })} />
            <Campo rows={2} placeholder="Descripción para el cliente" value={s.descripcion} onSave={v => guardar({ descripcion: v })} ia contexto={`Servicio del espacio: ${s.nombre}`} />
            <div style={{ ...row, marginBottom: 8 }}>
              <Miniatura url={s.imagen_url} onQuitar={() => guardar({ imagen_url: null })} />
              <Subir projectId={projectId} label={s.imagen_url ? 'Cambiar imagen' : 'Subir imagen'} onUrl={u => guardar({ imagen_url: u })} />
            </div>
            <p style={muted}>Aparece en estos capítulos:</p>
            <div style={{ ...row, marginTop: 4 }}>
              {data.capitulos.map(c => {
                const on = s.capitulos.includes(c.id);
                return (
                  <label key={c.id} style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: '0.8rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={on} onChange={() => guardar({ capitulos: on ? s.capitulos.filter(x => x !== c.id) : [...s.capitulos, c.id] })} /> {c.titulo}
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Entregables (checklist del equipo) ─────────────────────────────────
function VistaEntregables({ projectId, data, llamar }) {
  const grupos = [{ id: null, titulo: 'Generales del proyecto' }, ...data.capitulos.map(c => ({ id: c.id, titulo: c.titulo }))];
  const total = data.entregables.length;
  const hechos = data.entregables.filter(e => e.estado === 'entregado').length;

  const nuevo = (capitulo_id) => {
    const nombre = window.prompt('¿Qué hay que entregar? (p. ej. Plano de iluminación)');
    if (nombre?.trim()) llamar(() => api.post(`/historia/${projectId}/entregables`, { nombre, capitulo_id }));
  };

  return (
    <div>
      <p style={{ ...muted, marginBottom: 10 }}>
        Qué hay que entregar en cada parte. {hechos}/{total} entregados. Al cliente solo le llegan los marcados como visibles <em>y</em> con archivo subido.
      </p>
      {grupos.map(g => {
        const items = data.entregables.filter(e => (e.capitulo_id || null) === g.id);
        return (
          <div key={g.id || 'general'} style={{ ...box, marginBottom: 10 }}>
            <div style={{ ...row, justifyContent: 'space-between', marginBottom: 6 }}>
              <strong style={{ fontSize: '0.9rem' }}>{g.titulo}</strong>
              <button type="button" className="ap-btn ap-btn-ghost ap-btn-xs" onClick={() => nuevo(g.id)}><Plus size={11} /> Entregable</button>
            </div>
            {items.length === 0 && <p style={muted}>Sin entregables.</p>}
            {items.map(e => {
              const guardar = (campos) => llamar(() => api.put(`/historia/entregables/${e.id}`, campos));
              return (
                <div key={e.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '8px 0' }}>
                  <div style={{ ...row, justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.85rem' }}>{e.nombre} {e.opcional && <span style={muted}>(opcional)</span>} {e.formato && <span style={muted}>· {e.formato}</span>}</span>
                    <div style={row}>
                      <select className="ap-select" style={{ width: 'auto' }} value={e.estado} onChange={ev => guardar({ estado: ev.target.value })}>
                        {ESTADOS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>
                      <button type="button" className="ap-btn-icon" onClick={() => window.confirm('¿Eliminar este entregable?') && llamar(() => api.delete(`/historia/entregables/${e.id}`))}><Trash2 size={13} /></button>
                    </div>
                  </div>
                  {e.descripcion && <p style={{ ...muted, margin: '2px 0 4px' }}>{e.descripcion}</p>}
                  <div style={row}>
                    {e.archivo_url && <a href={e.archivo_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.78rem' }}><FileText size={11} /> Ver archivo</a>}
                    {(e.formato || '').startsWith('Imagen') ? (
                      <span style={muted}>Los renders se suben en su capítulo (pestaña Capítulos). Aquí solo marca el estado.</span>
                    ) : (
                      <>
                        <Subir projectId={projectId} accept="image/*,application/pdf" label={e.archivo_url ? 'Cambiar archivo' : 'Subir archivo'} onUrl={u => guardar({ archivo_url: u })} />
                        <label style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: '0.78rem', cursor: 'pointer' }}>
                          <input type="checkbox" checked={e.visible_cliente} onChange={() => guardar({ visible_cliente: !e.visible_cliente })} /> Visible para el cliente
                        </label>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ── Guía de orden de trabajo (disclaimer plegable en Gestionar proyecto) ──
const CLAVE_GUIA = 'ap_guia_proyecto_cerrada';
export function GuiaProyecto() {
  const [abierta, setAbierta] = useState(() => { try { return localStorage.getItem(CLAVE_GUIA) !== '1'; } catch { return true; } });
  const alternar = () => {
    const nueva = !abierta; setAbierta(nueva);
    try { localStorage.setItem(CLAVE_GUIA, nueva ? '0' : '1'); } catch { /* sin storage */ }
  };
  const paso = (n, titulo, texto) => (
    <li style={{ marginBottom: 6 }}><strong>{n}. {titulo}</strong> — {texto}</li>
  );
  return (
    <div style={{ ...box, marginBottom: 12, borderColor: 'rgba(190,176,162,0.35)' }}>
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <strong style={{ fontSize: '0.85rem' }}>Cómo trabajar un proyecto, en orden</strong>
        <button type="button" className="ap-btn ap-btn-ghost ap-btn-xs" onClick={alternar}>{abierta ? 'Ocultar guía' : 'Ver guía'}</button>
      </div>
      {abierta && (
        <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.7)', marginTop: 8, lineHeight: 1.55 }}>
          <ol style={{ margin: 0, paddingLeft: '1.1rem' }}>
            {paso(1, 'Necesidades', 'lo que pide el cliente, y las fotos, planos y medidas del espacio actual (el "antes"). Es lo primero: de aquí sale todo.')}
            {paso(2, 'Portada', 'la imagen principal con la que se abre el portal del cliente.')}
            {paso(3, 'Moodboard', 'referencias y paleta de colores. En el portal es "La atmósfera".')}
            {paso(4, 'Historia', 'el recorrido por capítulos: textos, un render grande por capítulo, bloques (imagen + texto, zonas, detalles), servicios del espacio y la checklist de entregables.')}
          </ol>
          <p style={{ margin: '8px 0 4px' }}><strong>Después, según haga falta:</strong></p>
          <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
            <li><strong>Listados</strong> (materiales y mobiliario), <strong>Documentos</strong> (planos y archivos) y <strong>Notas</strong>: salen al final del portal, en "Tu dossier".</li>
            <li><strong>Tour 3D</strong>: opcional, solo en los proyectos que lo lleven.</li>
            <li><strong>Facturas</strong>: interno, el cliente nunca lo ve. <strong>Trabajos web</strong>: portfolio público de la web.</li>
          </ul>
          <p style={{ margin: '8px 0 4px' }}><strong>¿Y Categorías y Resultado?</strong></p>
          <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
            <li><strong>Proyecto con Historia:</strong> Categorías y Resultado <u>no se muestran al cliente</u>. Los renders van dentro de cada capítulo. No hace falta usarlas.</li>
            <li><strong>Proyecto sin Historia</strong> (los de antes): el portal funciona exactamente como siempre, con Categorías y Resultado.</li>
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Estilo del proyecto: la IA analiza paleta + imágenes del moodboard ──
export function EstiloMoodboard({ projectId }) {
  const [estilo, setEstilo] = useState(null);
  const [propuesta, setPropuesta] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/historia/${projectId}/estilo`).then(r => setEstilo(r.data)).catch(() => setError('No se pudo cargar el estilo (¿has ejecutado el SQL v61?)'));
  }, [projectId]);

  const guardar = async (campos) => {
    setError('');
    try { await api.put(`/historia/${projectId}/estilo`, campos); setEstilo(e => ({ ...e, ...campos })); }
    catch (e) { setError(e.response?.data?.error || 'Error al guardar el estilo'); }
  };
  const definir = async () => {
    setError(''); setCargando(true);
    try { const { data } = await api.post(`/historia/${projectId}/ia-estilo`, {}); setPropuesta(data); }
    catch (e) { setError(e.response?.data?.error || 'La IA no ha podido analizar el moodboard'); }
    finally { setCargando(false); }
  };
  const usar = async () => {
    await guardar({ nombre: propuesta.nombre, texto: propuesta.texto });
    setPropuesta(null);
  };

  if (!estilo) return error ? <p className="ap-error">{error}</p> : null;
  return (
    <div style={{ ...box, marginTop: 16, borderColor: 'rgba(190,176,162,0.35)' }}>
      <div style={{ ...row, justifyContent: 'space-between', marginBottom: 6 }}>
        <strong style={{ fontSize: '0.9rem' }}>Estilo del proyecto</strong>
        <button type="button" className="ap-btn ap-btn-primary ap-btn-sm" disabled={cargando} onClick={definir}>
          <Sparkles size={12} /> {cargando ? 'Analizando el moodboard…' : 'Definir el estilo con la IA'}
        </button>
      </div>
      <p style={{ ...muted, marginBottom: 10 }}>La IA mira las imágenes y la paleta del moodboard y propone el nombre del estilo y un texto que lo describe. Es lo que verá el cliente en "La atmósfera"; el texto de arriba (cómo combinar los colores) pasa a un desplegable. Nada se guarda hasta que lo aceptes.</p>
      {error && <p className="ap-error" style={{ marginBottom: 8 }}>{error}</p>}
      {propuesta && (
        <div style={{ ...box, marginBottom: 10, borderColor: 'rgba(190,176,162,0.5)' }}>
          <p style={{ ...muted, marginBottom: 4 }}>Propuesta de la IA{propuesta.imagenes_analizadas ? ` (analizó ${propuesta.imagenes_analizadas} imágenes)` : ''}:</p>
          <p style={{ fontWeight: 600, marginBottom: 4 }}>{propuesta.nombre}</p>
          <p style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>{propuesta.texto}</p>
          <div style={{ ...row, marginTop: 8 }}>
            <button type="button" className="ap-btn ap-btn-primary ap-btn-xs" onClick={usar}>Usar propuesta</button>
            <button type="button" className="ap-btn ap-btn-ghost ap-btn-xs" onClick={definir} disabled={cargando}>Otra versión</button>
            <button type="button" className="ap-btn ap-btn-ghost ap-btn-xs" onClick={() => setPropuesta(null)}>Descartar</button>
          </div>
        </div>
      )}
      <Campo label="Nombre del estilo" value={estilo.nombre} placeholder="p. ej. Industrial cálido y urbano" onSave={v => guardar({ nombre: v })} />
      <Campo label="Texto del estilo" rows={5} value={estilo.texto} onSave={v => guardar({ texto: v })} ia contexto="Descripción del estilo de un proyecto de diseño de espacio deportivo" />
    </div>
  );
}
