import { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, Trash2, ChevronUp, ChevronDown, Eye, EyeOff, Upload, Sparkles, X, ExternalLink, FileText } from 'lucide-react';
import api from '../services/api';
import RenderInteractivoEditor from './RenderInteractivoEditor';

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
  { id: 'equipo', label: 'Equipamiento y materiales' },
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
        <div style={{ ...box, marginTop: 6, borderColor: 'rgba(186,175,165,0.5)' }}>
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

// Planos del espacio que el cliente ve paso a paso en «Entendemos el espacio» (también se publican desde la herramienta de Planos)
const PASOS_PLANO = [
  { titulo: 'Estado actual', paso: 'Paso 1', ayuda: 'Plano del espacio tal como está hoy.' },
  { titulo: 'Demoliciones', paso: 'Paso 2', ayuda: 'Solo si hay demoliciones.' },
  { titulo: 'Implantación', paso: 'Paso 2', ayuda: 'Solo si hay obra nueva (tabiques, trasdosados…).' },
  { titulo: 'Distribución', paso: 'Paso 3', ayuda: 'Plano con las zonas y la maquinaria.' },
];
const esPasoPlano = (b) => b.tipo === 'plano' && PASOS_PLANO.some(p => p.titulo === b.titulo);

function PlanosEspacio({ projectId, capitulo, bloques, llamar }) {
  const guardar = (titulo, existente, url) => llamar(() => existente
    ? api.put(`/historia/bloques/${existente.id}`, { imagen_url: url })
    : api.post(`/historia/capitulos/${capitulo.id}/bloques`, { tipo: 'plano', titulo, imagen_url: url }));
  return (
    <div style={{ ...box, marginBottom: 10, borderColor: 'rgba(186,175,165,0.35)' }}>
      <strong style={{ fontSize: '0.85rem' }}>Planos del espacio (el cliente los ve paso a paso)</strong>
      <p style={{ ...muted, margin: '4px 0 8px' }}>Sube aquí una imagen (JPG o PNG) de cada plano, o publícalos directamente desde la herramienta de Planos con «Publicar en la historia del cliente». Después de estos pasos van las zonas con sus renders. Los pasos que no subas no se muestran.</p>
      {PASOS_PLANO.map(p => {
        const b = bloques.find(x => x.tipo === 'plano' && x.titulo === p.titulo);
        return (
          <div key={p.titulo} style={{ ...row, justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ flex: '1 1 160px' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{p.paso} · {p.titulo}</div>
              <div style={muted}>{p.ayuda}</div>
            </div>
            <div style={row}>
              {b?.imagen_url ? <Miniatura url={b.imagen_url} onQuitar={() => llamar(() => api.delete(`/historia/bloques/${b.id}`))} /> : <span style={muted}>Sin subir</span>}
              <Subir projectId={projectId} label={b?.imagen_url ? 'Cambiar' : 'Subir plano'} onUrl={u => guardar(p.titulo, b, u)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Miniatura({ url, onQuitar }) {
  const [grande, setGrande] = useState(false);
  useEffect(() => {
    if (!grande) return undefined;
    const k = (e) => { if (e.key === 'Escape') setGrande(false); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [grande]);
  if (!url) return null;
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <img src={url} alt="" title="Pulsa para verla en grande" onClick={() => setGrande(true)} style={{ height: 54, borderRadius: 6, display: 'block', cursor: 'zoom-in' }} />
      <button type="button" onClick={onQuitar} title="Quitar imagen"
        style={{ position: 'absolute', top: -6, right: -6, background: '#000', color: '#fff', border: 'none', borderRadius: '50%', width: 18, height: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
      {grande && (
        <div role="dialog" aria-modal="true" onClick={() => setGrande(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, cursor: 'zoom-out' }}>
          <img src={url} alt="" style={{ maxWidth: '96vw', maxHeight: '92vh', objectFit: 'contain', background: '#fff', borderRadius: 6 }} />
          <button type="button" onClick={() => setGrande(false)} aria-label="Cerrar"
            style={{ position: 'fixed', top: 14, right: 18, background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', borderRadius: '50%', width: 36, height: 36, fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
      )}
    </span>
  );
}

// ── Renders del capítulo con su botón de recorrido (efecto de movimiento al deslizar) ──
function RendersConRecorrido({ projectId, capitulo, bloques, llamar, inter, recargarInter, sinTabla }) {
  const [abierto, setAbierto] = useState(null);
  const vistos = new Set();
  const items = [
    ...(capitulo.render_url ? [{ url: capitulo.render_url, quitar: () => llamar(() => api.put('/historia/capitulos/' + capitulo.id, { render_url: null })) }] : []),
    ...bloques.filter(b => b.tipo === 'render' && b.imagen_url).map(b => ({ url: b.imagen_url, quitar: () => llamar(() => api.put('/historia/bloques/' + b.id, { imagen_url: null })) })),
  ].filter(it => (vistos.has(it.url) ? false : vistos.add(it.url)));
  return (
    <div>
      <div style={{ ...row, alignItems: 'flex-start', gap: '0.9rem' }}>
        {items.map(it => (
          <div key={it.url} style={{ display: 'grid', gap: 5, justifyItems: 'center' }}>
            <Miniatura url={it.url} onQuitar={it.quitar} />
            <button type="button" className={'ap-btn ap-btn-xs ' + (inter[it.url] ? 'ap-btn-primary' : 'ap-btn-ghost')} title="Que el render se mueva al deslizar, como si caminaras por el espacio" onClick={() => setAbierto(it.url)}>
              {inter[it.url] ? '✓ Con recorrido' : '✨ Recorrido'}
            </button>
          </div>
        ))}
        {!items.length && <span style={{ ...muted, color: '#f5b748' }}>Todavía no hay renders: sube el primero y será el principal del capítulo.</span>}
      </div>
      {sinTabla && <p style={{ ...muted, color: '#f5b748', marginTop: 6 }}>Para guardar recorridos falta ejecutar el SQL v78 (te lo pasa Claude).</p>}
      {abierto && (
        <RenderInteractivoEditor projectId={projectId} url={abierto} existente={inter[abierto]}
          onGuardado={async () => { setAbierto(null); await recargarInter(); }} onCerrar={() => setAbierto(null)} />
      )}
    </div>
  );
}

// ── Modo guiado: el proyecto paso a paso, en el orden de trabajo del estudio ──
// 1 Necesidades · 2 Entender el espacio · 3 Estilo · 4 Renders · 5 Detalles diferenciales · 6 Equipamiento · 7 Listados y entrega · 8 Revisar
const PASOS_GUIA = [
  { id: 'necesidades', t: 'Necesidades' },
  { id: 'espacio', t: 'Entender el espacio' },
  { id: 'estilo', t: 'Estilo' },
  { id: 'renders', t: 'Renders' },
  { id: 'detalles', t: 'Detalles' },
  { id: 'equipamiento', t: 'Equipamiento' },
  { id: 'entrega', t: 'Listados y entrega' },
  { id: 'revisar', t: 'Revisar' },
];
const lleno = (b) => b.texto?.trim() || b.imagen_url || b.tipo === 'equipo' || (b.tipo === 'galeria' && b.elementos?.length);

function estadoCapitulo(c, bloques) {
  const bl = bloques.filter(b => b.capitulo_id === c.id);
  return {
    texto: (c.texto || '').trim().length > 15,
    render: !!c.render_url || bl.some(b => b.tipo === 'render' && b.imagen_url),
    detalles: bl.filter(b => !['render', 'equipo', 'plano'].includes(b.tipo) && lleno(b)).length,
    equipo: bl.some(b => b.tipo === 'equipo'),
  };
}

function Seccion({ n, titulo, ok, children, abierta = false, nota }) {
  return (
    <details open={abierta} style={{ ...box, marginBottom: 10 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem', display: 'flex', gap: 8, alignItems: 'center', listStyle: 'none' }}>
        <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'inline-grid', placeItems: 'center', fontSize: '0.72rem', background: ok ? 'rgba(80,200,120,0.25)' : 'rgba(255,255,255,0.1)', color: ok ? '#7fe3a0' : 'inherit', flex: 'none' }}>{ok ? '✓' : n}</span>
        {titulo}
        {nota && <span style={{ ...muted, fontWeight: 400 }}>{nota}</span>}
      </summary>
      <div style={{ marginTop: 10 }}>{children}</div>
    </details>
  );
}

function Intro({ n, titulo, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <h3 style={{ marginBottom: 4 }}>{n} · {titulo}</h3>
      <p style={muted}>{children}</p>
    </div>
  );
}

function AnadirCapitulo({ projectId, llamar }) {
  const [abierto, setAbierto] = useState(false);
  const [catalogo, setCatalogo] = useState([]);
  const [titulo, setTitulo] = useState('');
  const abrir = () => { setAbierto(a => !a); if (!catalogo.length) api.get('/historia/extras').then(r => setCatalogo(r.data.extras || [])).catch(() => {}); };
  return (
    <div style={{ marginTop: 10 }}>
      <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={abrir}><Plus size={12} /> Añadir capítulo o zona</button>
      {abierto && (
        <div style={{ ...box, marginTop: 8 }}>
          <p style={{ ...muted, marginBottom: 6 }}>Elige una zona ya preparada (con texto y bloques sugeridos):</p>
          <div style={row}>
            {catalogo.map(x => (
              <button key={x.id} type="button" className="ap-btn ap-btn-ghost ap-btn-xs" title={x.descripcion || ''} onClick={() => { setAbierto(false); llamar(() => api.post('/historia/' + projectId + '/capitulos/extra', { extra_id: x.id })); }}>{x.titulo}</button>
            ))}
          </div>
          <p style={{ ...muted, margin: '10px 0 4px' }}>O empieza en blanco:</p>
          <div style={row}>
            <input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Título del capítulo" style={{ flex: 1, minWidth: 140 }} />
            <button type="button" className="ap-btn ap-btn-primary ap-btn-xs" onClick={() => { if (!titulo.trim()) return; const t = titulo; setTitulo(''); setAbierto(false); llamar(() => api.post('/historia/' + projectId + '/capitulos', { titulo: t })); }}>Crear</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Ordenar, ocultar, añadir o eliminar capítulos (desplegable, para no estorbar)
function GestionCapitulos({ projectId, caps, llamar }) {
  const mover = (i, dir) => {
    const ids = caps.map(c => c.id); const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    llamar(() => api.put('/historia/' + projectId + '/capitulos/orden', { ids }));
  };
  return (
    <details style={{ ...box, marginBottom: 12 }}>
      <summary style={{ cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>Ordenar, ocultar o añadir capítulos</summary>
      <div style={{ marginTop: 10 }}>
        {caps.map((c, i) => (
          <div key={c.id} style={{ ...row, flexWrap: 'nowrap', padding: '5px 2px', opacity: c.visible ? 1 : 0.5 }}>
            <span style={{ ...muted, width: 20 }}>{i + 1}</span>
            <span style={{ flex: 1, fontSize: '0.85rem' }}>{c.titulo}</span>
            <button type="button" className="ap-btn-icon" title="Subir" onClick={() => mover(i, -1)}><ChevronUp size={14} /></button>
            <button type="button" className="ap-btn-icon" title="Bajar" onClick={() => mover(i, 1)}><ChevronDown size={14} /></button>
            <button type="button" className="ap-btn-icon" title={c.visible ? 'Ocultar al cliente' : 'Mostrar al cliente'} onClick={() => llamar(() => api.put('/historia/capitulos/' + c.id, { visible: !c.visible }))}>{c.visible ? <Eye size={14} /> : <EyeOff size={14} />}</button>
            <button type="button" className="ap-btn-icon" title="Eliminar capítulo" onClick={() => window.confirm('¿Eliminar el capítulo "' + c.titulo + '" con todo lo que tiene? (Si solo quieres quitarlo del portal, ocúltalo.)') && llamar(() => api.delete('/historia/capitulos/' + c.id))}><Trash2 size={14} /></button>
          </div>
        ))}
        <AnadirCapitulo projectId={projectId} llamar={llamar} />
      </div>
    </details>
  );
}

function PasoRenders({ projectId, data, llamar, inter, recargarInter, sinTabla }) {
  const caps = data.capitulos;
  const primeroIncompleto = caps.findIndex(c => { const e = estadoCapitulo(c, data.bloques); return c.visible && !(e.texto && e.render); });
  return (
    <div>
      <Intro n={4} titulo="Renders">Por cada capítulo: escribe el texto que lee el cliente y sube sus renders. El primero que subas es el principal (a pantalla completa). Pulsa «✨ Recorrido» en un render para que se mueva al deslizar, como si caminaras por el espacio.</Intro>
      <GestionCapitulos projectId={projectId} caps={caps} llamar={llamar} />
      {caps.map((c, i) => {
        const e = estadoCapitulo(c, data.bloques);
        const bloques = data.bloques.filter(b => b.capitulo_id === c.id).sort((a, b) => a.orden - b.orden);
        return (
          <Seccion key={c.id} n={i + 1} titulo={c.titulo} ok={e.texto && e.render} abierta={i === primeroIncompleto} nota={!c.visible ? '· oculto al cliente' : (!e.texto || !e.render) ? '· ' + [!e.texto && 'falta texto', !e.render && 'falta render'].filter(Boolean).join(' y ') : ''}>
            <Campo label="Título" value={c.titulo} onSave={v => v.trim() && llamar(() => api.put('/historia/capitulos/' + c.id, { titulo: v }))} />
            <Campo label="Texto de entrada (lo que lee el cliente)" rows={5} value={c.texto} onSave={v => llamar(() => api.put('/historia/capitulos/' + c.id, { texto: v }))}
              ia contexto={'Introducción del capítulo "' + c.titulo + '"'} onReescribir={() => api.post('/historia/capitulos/' + c.id + '/ia-reescribir', {})} />
            <div style={{ margin: '4px 0 10px' }}><SubirVariosRenders projectId={projectId} capitulo={c} bloques={bloques} llamar={llamar} /></div>
            <RendersConRecorrido projectId={projectId} capitulo={c} bloques={bloques} llamar={llamar} inter={inter} recargarInter={recargarInter} sinTabla={sinTabla} />
            <details style={{ marginTop: 10 }}>
              <summary style={{ ...muted, cursor: 'pointer' }}>Notas internas y tour virtual (opcional)</summary>
              <div style={{ marginTop: 8 }}>
                <Campo label="Detalle sensorial (guía interna: luz, olor, sonido, tacto)" value={c.sensorial} onSave={v => llamar(() => api.put('/historia/capitulos/' + c.id, { sensorial: v }))} />
                <Campo label="Tour virtual (solo si el proyecto lo lleva)" value={c.tour_url} placeholder="https://…" onSave={v => llamar(() => api.put('/historia/capitulos/' + c.id, { tour_url: v }))} />
              </div>
            </details>
          </Seccion>
        );
      })}
    </div>
  );
}

// Detalles diferenciales: lo que hace especial cada zona (bloques de imagen + texto, zona, detalle, galería)
function PasoDetalles({ projectId, data, llamar }) {
  return (
    <div>
      <Intro n={5} titulo="Detalles diferenciales">Lo que hace especial cada zona: un material, una luz, una solución a medida. Añade bloques de imagen y texto, de zona, de detalle o una galería. Un bloque sin texto ni imagen no se muestra al cliente. Es opcional.</Intro>
      {data.capitulos.map((c, i) => {
        const bloques = data.bloques.filter(b => b.capitulo_id === c.id).sort((a, b) => a.orden - b.orden);
        const otros = bloques.filter(b => !['render', 'equipo', 'plano'].includes(b.tipo));
        const mover = (idx, dir) => {
          const ids = otros.map(b => b.id); const j = idx + dir;
          if (j < 0 || j >= ids.length) return;
          [ids[idx], ids[j]] = [ids[j], ids[idx]];
          llamar(() => api.put('/historia/capitulos/' + c.id + '/bloques/orden', { ids: [...ids, ...bloques.filter(b => !ids.includes(b.id)).map(b => b.id)] }));
        };
        return (
          <Seccion key={c.id} n={i + 1} titulo={c.titulo} ok={otros.some(lleno)} abierta={otros.length > 0 && i === data.capitulos.findIndex(x => data.bloques.some(b => b.capitulo_id === x.id && !['render', 'equipo', 'plano'].includes(b.tipo)))} nota={otros.length ? '· ' + otros.length + ' bloque' + (otros.length === 1 ? '' : 's') : ''}>
            <div style={{ ...row, marginBottom: 10 }}>
              {TIPOS_BLOQUE.filter(t => !['render', 'equipo'].includes(t.id)).map(t => (
                <button key={t.id} type="button" className="ap-btn ap-btn-ghost ap-btn-xs" onClick={() => llamar(() => api.post('/historia/capitulos/' + c.id + '/bloques', { tipo: t.id, titulo: '' }))}><Plus size={11} /> {t.label}</button>
              ))}
            </div>
            {otros.length === 0 && <p style={muted}>Todavía no hay detalles en este capítulo.</p>}
            {otros.map((b, k) => <BloqueEditor key={b.id} projectId={projectId} b={b} idx={k} total={otros.length} mover={mover} llamar={llamar} />)}
          </Seccion>
        );
      })}
    </div>
  );
}

// Equipamiento: primero la selección que ha hecho el estudio (Listados), destacada; después, qué se enseña en cada capítulo
function PasoEquipamiento({ projectId, data, llamar, irATab }) {
  const [eq, setEq] = useState([]);
  const [mat, setMat] = useState([]);
  useEffect(() => {
    Promise.all([api.get('/client-projects/' + projectId + '/equipment'), api.get('/client-projects/' + projectId + '/materials')])
      .then(([a, m]) => { setEq(a.data.equipment || []); setMat(m.data.materials || []); }).catch(() => {});
  }, [projectId, data.bloques]);
  const items = [...eq.map(e => ({ ...e, _t: 'Equipo' })), ...mat.map(m => ({ ...m, _t: 'Material' }))];
  const conFoto = items.filter(i => i.image_url);
  return (
    <div>
      <Intro n={6} titulo="Equipamiento">Aquí se luce la selección que ha hecho el estudio para este espacio. Primero revisa que esté completa y con foto; luego elige qué equipos y materiales se enseñan en cada capítulo.</Intro>
      <div style={{ ...box, borderColor: 'rgba(186,175,165,0.5)', marginBottom: 14 }}>
        <div style={{ ...row, justifyContent: 'space-between', marginBottom: 8 }}>
          <strong>Nuestra selección · {items.length} elemento{items.length === 1 ? '' : 's'}</strong>
          {irATab && <button type="button" className="ap-btn ap-btn-ghost ap-btn-xs" onClick={() => irATab('catalogo')}>Gestionar en Listados →</button>}
        </div>
        {items.length === 0 && <p style={muted}>Todavía no hay equipamiento ni materiales elegidos. Se eligen en la pestaña Listados.</p>}
        {items.length > 0 && conFoto.length < items.length && <p style={{ ...muted, color: '#f5b748', marginBottom: 8 }}>{items.length - conFoto.length} sin foto: con foto se ve mucho mejor en el portal.</p>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(110px,1fr))', gap: 8 }}>
          {items.map(i => (
            <div key={i._t + i.id} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: 6, textAlign: 'center' }}>
              {i.image_url ? <img src={i.image_url} alt="" style={{ width: '100%', height: 76, objectFit: 'contain' }} /> : <div style={{ height: 76, display: 'grid', placeItems: 'center', ...muted }}>sin foto</div>}
              <div style={{ fontSize: '0.74rem', marginTop: 4, lineHeight: 1.25 }}>{i.name}</div>
              <div style={muted}>{i.brand || i._t}</div>
            </div>
          ))}
        </div>
      </div>
      {data.capitulos.map((c, ci) => {
        const eqs = data.bloques.filter(b => b.capitulo_id === c.id && b.tipo === 'equipo').sort((a, b) => a.orden - b.orden);
        return (
          <Seccion key={c.id} n={ci + 1} titulo={c.titulo} ok={eqs.some(b => (b.elementos || []).includes('#sel'))} nota={eqs.length ? '' : '· no enseña equipamiento'}>
            {eqs.length === 0 && (
              <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => llamar(() => api.post('/historia/capitulos/' + c.id + '/bloques', { tipo: 'equipo', titulo: 'Equipamiento y materiales' }))}><Plus size={12} /> Enseñar equipamiento en este capítulo</button>
            )}
            {eqs.map((b, k) => <BloqueEditor key={b.id} projectId={projectId} b={b} idx={k} total={eqs.length} mover={() => {}} llamar={llamar} />)}
          </Seccion>
        );
      })}
    </div>
  );
}

function PasoRevisar({ project, data, plano, estilo, inter, irA }) {
  const avisos = [];
  const ok = [];
  data.capitulos.forEach((c, i) => {
    const e = estadoCapitulo(c, data.bloques);
    if (!c.visible) { avisos.push({ nivel: 'info', t: '«' + c.titulo + '» está oculto: el cliente no lo ve.', paso: 'renders' }); return; }
    if (!e.texto) avisos.push({ nivel: 'falta', t: 'Capítulo ' + (i + 1) + ' «' + c.titulo + '»: falta el texto.', paso: 'renders' });
    if (!e.render) avisos.push({ nivel: 'falta', t: 'Capítulo ' + (i + 1) + ' «' + c.titulo + '»: falta el render principal.', paso: 'renders' });
  });
  if (!plano?.imagen_url) avisos.push({ nivel: 'info', t: 'No hay plano de distribución: esa sección no se muestra (es opcional).', paso: 'espacio' });
  if (!estilo?.nombre && !estilo?.texto) avisos.push({ nivel: 'info', t: 'Todavía no se ha definido el estilo del proyecto.', paso: 'estilo' });
  if (!data.bloques.some(b => b.tipo === 'equipo' && (b.elementos || []).includes('#sel'))) avisos.push({ nivel: 'info', t: 'Ningún capítulo enseña todavía la selección de equipamiento.', paso: 'equipamiento' });
  const pend = data.entregables.filter(e => e.estado !== 'entregado').length;
  if (pend) avisos.push({ nivel: 'info', t: pend + ' entregable' + (pend === 1 ? '' : 's') + ' sin marcar como entregado.', paso: 'entrega' });
  const conRec = Object.keys(inter).length;
  if (conRec) ok.push(conRec + ' render' + (conRec === 1 ? '' : 's') + ' con recorrido.');
  const nCap = data.capitulos.filter(c => c.visible).length;
  ok.push(nCap + ' capítulo' + (nCap === 1 ? '' : 's') + ' visible' + (nCap === 1 ? '' : 's') + ' para el cliente.');
  const faltan = avisos.filter(a => a.nivel === 'falta').length;
  return (
    <div>
      <Intro n={8} titulo="Revisar">Un repaso antes de enseñárselo al cliente.</Intro>
      <div style={{ ...box, borderColor: faltan ? 'rgba(245,183,72,0.5)' : 'rgba(80,200,120,0.45)', marginBottom: 12 }}>
        <strong>{faltan ? 'Casi listo: ' + faltan + ' cosa' + (faltan === 1 ? '' : 's') + ' por completar' : '¡Todo lo importante está!'}</strong>
        <p style={{ ...muted, marginTop: 4 }}>El cliente ve la historia en cuanto entra con su código; no hay que «publicar». Esto es solo una revisión.</p>
      </div>
      {avisos.map((a, i) => (
        <div key={i} style={{ ...row, justifyContent: 'space-between', padding: '8px 4px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <span style={{ fontSize: '0.85rem', color: a.nivel === 'falta' ? '#f5b748' : 'inherit' }}>{a.nivel === 'falta' ? '⚠ ' : 'ℹ '}{a.t}</span>
          <button type="button" className="ap-btn ap-btn-ghost ap-btn-xs" onClick={() => irA(a.paso)}>Ir a arreglarlo</button>
        </div>
      ))}
      {ok.map((t, i) => <p key={i} style={{ fontSize: '0.85rem', padding: '6px 4px' }}>✓ {t}</p>)}
      <div style={{ marginTop: 14 }}>
        <a className="ap-btn ap-btn-primary" href={'/mi-proyecto?code=' + project.access_code} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> Ver el portal del cliente</a>
      </div>
    </div>
  );
}

function HistoriaGuiada({ project, projectId, data, llamar, inter, recargarInter, sinTabla, error, onAvanzado, irATab }) {
  const [paso, setPaso] = useState(() => { try { return localStorage.getItem('ap_historia_paso_' + projectId) || 'renders'; } catch { return 'renders'; } });
  const [plano, setPlano] = useState(null);
  const [estilo, setEstilo] = useState(null);
  useEffect(() => { api.get('/historia/' + projectId + '/plano').then(r => setPlano(r.data)).catch(() => setPlano({})); }, [projectId, paso]);
  useEffect(() => { api.get('/historia/' + projectId + '/estilo').then(r => setEstilo(r.data)).catch(() => setEstilo({})); }, [projectId, paso]);

  const caps = data.capitulos;
  const estados = caps.map(c => estadoCapitulo(c, data.bloques));
  const visibles = caps.filter(c => c.visible);
  const completos = caps.filter((c, i) => !c.visible || (estados[i].texto && estados[i].render)).length;
  const hechos = (id) => (id === 'espacio' ? !!plano?.imagen_url
    : id === 'estilo' ? !!(estilo?.nombre || estilo?.texto)
    : id === 'renders' ? completos === caps.length && caps.length > 0
    : id === 'detalles' ? estados.some(e => e.detalles > 0)
    : id === 'equipamiento' ? data.bloques.some(b => b.tipo === 'equipo' && (b.elementos || []).includes('#sel'))
    : id === 'entrega' ? data.entregables.length > 0 && data.entregables.every(e => e.estado === 'entregado')
    : false);
  const idx = PASOS_GUIA.findIndex(p => p.id === paso);
  const irA = (p) => { setPaso(p); try { localStorage.setItem('ap_historia_paso_' + projectId, p); } catch { /* sin storage */ } window.scrollTo?.({ top: 0 }); };
  const pct = visibles.length ? Math.round(visibles.filter(c => { const e = estadoCapitulo(c, data.bloques); return e.texto && e.render; }).length / visibles.length * 100) : 0;
  const enlace = (tab, texto) => <button type="button" className="ap-btn ap-btn-primary" onClick={() => irATab?.(tab)} disabled={!irATab}>{texto} →</button>;

  return (
    <div>
      <div style={{ ...row, justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <strong>El proyecto, paso a paso</strong>
          <div style={muted}>Capítulos con texto y render: {pct} %</div>
        </div>
        <div style={row}>
          <a className="ap-btn ap-btn-ghost ap-btn-sm" href={'/mi-proyecto?code=' + project.access_code} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} /> Ver portal</a>
          <button type="button" className="ap-btn ap-btn-ghost ap-btn-xs" title="Todas las opciones juntas, como antes" onClick={onAvanzado}>Vista avanzada</button>
        </div>
      </div>

      <div style={{ ...row, gap: 6, marginBottom: 14 }}>
        {PASOS_GUIA.map((p, i) => (
          <button key={p.id} type="button" onClick={() => irA(p.id)} className={'ap-btn ap-btn-sm ' + (paso === p.id ? 'ap-btn-primary' : 'ap-btn-ghost')} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <span style={{ width: 18, height: 18, borderRadius: '50%', display: 'inline-grid', placeItems: 'center', fontSize: '0.68rem', background: hechos(p.id) ? 'rgba(80,200,120,0.3)' : 'rgba(255,255,255,0.12)' }}>{hechos(p.id) ? '✓' : i + 1}</span>
            {p.t}
          </button>
        ))}
      </div>
      {error && <p className="ap-error" style={{ marginBottom: 8 }}>{error}</p>}

      {paso === 'necesidades' && (
        <div>
          <Intro n={1} titulo="Programa de necesidades">Siempre lo primero: qué pide el cliente y cómo es el espacio actual (fotos, medidas, planos). De aquí sale todo lo demás.</Intro>
          <div style={box}>
            <p style={{ fontSize: '0.88rem', marginBottom: 10 }}>El programa de necesidades se rellena en su propia pestaña.</p>
            {enlace('necesidades', 'Abrir el programa de necesidades')}
          </div>
        </div>
      )}

      {paso === 'espacio' && (
        <div>
          <Intro n={2} titulo="Entender el espacio">El plano del espacio, con el recorrido: es lo primero que ve el cliente después de la portada. Si todavía no lo tienes, puedes saltar este paso y volver luego.</Intro>
          <PlanoEditor projectId={projectId} project={project} caps={caps} />
          {caps.filter(c => /entendemos el espacio/i.test(c.titulo)).map(c => (
            <div key={c.id} style={{ marginTop: 12 }}><PlanosEspacio projectId={projectId} capitulo={c} bloques={data.bloques.filter(b => b.capitulo_id === c.id)} llamar={llamar} /></div>
          ))}
          <div style={{ ...box, marginTop: 12 }}>
            <p style={{ fontSize: '0.85rem', marginBottom: 8 }}>¿Aún no tienes los planos? Se dibujan en la herramienta de Planos (estado actual, demoliciones, distribución) y desde allí se publican aquí con un botón.</p>
            {irATab && <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => irATab('medicion')}>Abrir la herramienta de Planos →</button>}
          </div>
        </div>
      )}

      {paso === 'estilo' && (
        <div>
          <Intro n={3} titulo="Definir el estilo">La paleta y las imágenes del moodboard son la base: la IA las analiza y propone el nombre y la descripción del estilo, que el cliente ve en «La atmósfera».</Intro>
          <EstiloMoodboard projectId={projectId} />
          <div style={{ ...box, marginTop: 12 }}>
            <p style={{ fontSize: '0.85rem', marginBottom: 8 }}>La paleta y las imágenes de referencia se suben en la pestaña Moodboard.</p>
            {irATab && <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => irATab('moodboard')}>Abrir el moodboard →</button>}
          </div>
        </div>
      )}

      {paso === 'renders' && <PasoRenders projectId={projectId} data={data} llamar={llamar} inter={inter} recargarInter={recargarInter} sinTabla={sinTabla} />}
      {paso === 'detalles' && <PasoDetalles projectId={projectId} data={data} llamar={llamar} />}
      {paso === 'equipamiento' && <PasoEquipamiento projectId={projectId} data={data} llamar={llamar} irATab={irATab} />}

      {paso === 'entrega' && (
        <div>
          <Intro n={7} titulo="Listados y entrega">Lo que cierra el proyecto: las soluciones y servicios del espacio, los listados de materiales y mobiliario, los documentos y la lista de lo que hay que entregar.</Intro>
          <div style={{ ...row, marginBottom: 14 }}>
            {irATab && <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => irATab('catalogo')}>Listados →</button>}
            {irATab && <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => irATab('documentos')}>Documentos →</button>}
            {irATab && <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => irATab('notas')}>Notas →</button>}
          </div>
          <h4 style={{ margin: '4px 0 8px' }}>Soluciones y servicios del espacio</h4>
          <VistaServicios projectId={projectId} data={data} llamar={llamar} />
          <h4 style={{ margin: '18px 0 8px' }}>Entregables</h4>
          <VistaEntregables projectId={projectId} data={data} llamar={llamar} />
        </div>
      )}

      {paso === 'revisar' && <PasoRevisar project={project} data={data} plano={plano} estilo={estilo} inter={inter} irA={irA} />}

      <div style={{ ...row, justifyContent: 'space-between', marginTop: 18, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <button type="button" className="ap-btn ap-btn-ghost" disabled={idx <= 0} onClick={() => irA(PASOS_GUIA[idx - 1].id)}>← Anterior</button>
        {idx < PASOS_GUIA.length - 1
          ? <button type="button" className="ap-btn ap-btn-primary" onClick={() => irA(PASOS_GUIA[idx + 1].id)}>Siguiente: {PASOS_GUIA[idx + 1].t} →</button>
          : <span style={muted}>Último paso</span>}
      </div>
    </div>
  );
}

// ── Pestaña principal ──────────────────────────────────────────────────
export function TabHistoria({ project, irATab }) {
  const projectId = project.id;
  const [data, setData] = useState(null);
  const [vista, setVista] = useState('capitulos');
  const [capSel, setCapSel] = useState(null);
  const [error, setError] = useState('');
  const [tipoGen, setTipoGen] = useState('');
  const [selGen, setSelGen] = useState([]);
  const [extrasGen, setExtrasGen] = useState([]);
  const [generando, setGenerando] = useState(false);
  const [modo, setModo] = useState(() => { try { return localStorage.getItem('ap_historia_modo') === 'avanzado' ? 'avanzado' : 'guiado'; } catch { return 'guiado'; } });
  const [inter, setInter] = useState({});
  const [sinTabla, setSinTabla] = useState(false);
  const cambiarModo = (m) => { setModo(m); try { localStorage.setItem('ap_historia_modo', m); } catch { /* sin storage */ } };
  const recargarInter = useCallback(async () => {
    try {
      const { data: r } = await api.get('/historia/' + projectId + '/interactivos');
      const m = {}; (r.interactivos || []).forEach(i => { m[i.imagen_url] = i; });
      setInter(m); setSinTabla(!!r.sinTabla);
    } catch { /* sin recorridos */ }
  }, [projectId]);
  useEffect(() => { recargarInter(); }, [recargarInter]);

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

  if (modo === 'guiado') {
    return <HistoriaGuiada project={project} projectId={projectId} data={data} llamar={llamar} inter={inter} recargarInter={recargarInter} sinTabla={sinTabla} error={error} onAvanzado={() => cambiarModo('avanzado')} irATab={irATab} />;
  }

  return (
    <div>
      <div style={{ ...row, justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={row}>
          {[['capitulos', 'Capítulos'], ['servicios', 'Soluciones y servicios'], ['entregables', 'Entregables']].map(([id, label]) => (
            <button key={id} type="button" className={`ap-btn ap-btn-sm ${vista === id ? 'ap-btn-primary' : 'ap-btn-ghost'}`} onClick={() => setVista(id)}>{label}</button>
          ))}
        </div>
        <div style={row}>
          <button type="button" className="ap-btn ap-btn-primary ap-btn-sm" onClick={() => cambiarModo('guiado')}>Volver a la vista paso a paso</button>
          <a className="ap-btn ap-btn-ghost ap-btn-sm" href={`/mi-proyecto?code=${project.access_code}`} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} /> Ver portal del cliente</a>
        </div>
      </div>
      {error && <p className="ap-error" style={{ marginBottom: 8 }}>{error}</p>}

      {vista === 'capitulos' && (
        <VistaCapitulos projectId={projectId} data={data} capitulo={capitulo} esPlano={capSel === 'plano'} setCapSel={setCapSel} llamar={llamar} project={project} inter={inter} recargarInter={recargarInter} sinTabla={sinTabla} />
      )}
      {vista === 'servicios' && <VistaServicios projectId={projectId} data={data} llamar={llamar} />}
      {vista === 'entregables' && <VistaEntregables projectId={projectId} data={data} llamar={llamar} />}
    </div>
  );
}

// ── Capítulos + bloques ────────────────────────────────────────────────
function VistaCapitulos({ projectId, data, capitulo, esPlano, setCapSel, llamar, project, inter = {}, recargarInter = async () => {}, sinTabla = false }) {
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
        <div style={{ ...row, flexWrap: 'nowrap', padding: '8px 6px', borderRadius: 6, cursor: 'pointer', background: esPlano ? 'rgba(186,175,165,0.16)' : 'transparent', borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: 6 }} onClick={() => setCapSel('plano')}>
          <span style={{ width: 18 }}>📐</span>
          <span style={{ flex: 1, fontSize: '0.85rem', fontWeight: 600 }}>Plano y recorrido</span>
        </div>
        {caps.map((c, i) => (
          <div key={c.id} style={{ ...row, flexWrap: 'nowrap', padding: '6px 4px', borderRadius: 6, cursor: 'pointer', background: !esPlano && c.id === capitulo.id ? 'rgba(186,175,165,0.16)' : 'transparent', opacity: c.visible ? 1 : 0.45 }}
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
          {/entendemos el espacio/i.test(capitulo.titulo) && <PlanosEspacio projectId={projectId} capitulo={capitulo} bloques={bloques} llamar={llamar} />}
          <div style={{ ...box, marginBottom: 10, borderColor: 'rgba(186,175,165,0.35)' }}>
            <div style={{ ...row, justifyContent: 'space-between', marginBottom: 6 }}>
              <strong style={{ fontSize: '0.85rem' }}>Renders del capítulo</strong>
              <SubirVariosRenders projectId={projectId} capitulo={capitulo} bloques={bloques} llamar={llamar} />
            </div>
            <p style={{ ...muted, marginBottom: 6 }}>Selecciona todos los renders de este capítulo a la vez: el primero será el principal (a pantalla completa) y los demás van a los huecos de render de abajo.</p>
            <RendersConRecorrido projectId={projectId} capitulo={capitulo} bloques={bloques} llamar={llamar} inter={inter} recargarInter={recargarInter} sinTabla={sinTabla} />
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
          {bloques.filter(b => !esPasoPlano(b)).map((b, i) => (
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

// Equipamiento y materiales de un capítulo: se eligen, se crean y se ordenan aquí mismo.
// Todo vive en Listados (lo que se crea aquí aparece allí) y el bloque solo guarda cuáles se enseñan y en qué orden:
// elementos = ['#sel', 'e:<id de equipo>', 'm:<id de material>', ...]. Sin '#sel' el bloque funciona como siempre
// (todos los equipos con foto de Listados), así que los proyectos antiguos no cambian.
function EquipoCapitulo({ projectId, b, guardar }) {
  const [eq, setEq] = useState([]);
  const [mat, setMat] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState('');
  const [nuevo, setNuevo] = useState(null);
  const [anadir, setAnadir] = useState('');
  const recargar = useCallback(async () => {
    try {
      const [a, m] = await Promise.all([api.get(`/client-projects/${projectId}/equipment`), api.get(`/client-projects/${projectId}/materials`)]);
      setEq(a.data.equipment || []); setMat(m.data.materials || []);
    } catch { setAviso('No se pudo cargar Listados'); }
    finally { setCargando(false); }
  }, [projectId]);
  useEffect(() => { recargar(); }, [recargar]);

  const todos = [...eq.map(e => ({ ...e, _id: 'e:' + e.id, _t: 'Equipo' })), ...mat.map(m => ({ ...m, _id: 'm:' + m.id, _t: 'Material' }))];
  const modoSel = (b.elementos || []).includes('#sel');
  const ids = (b.elementos || []).filter(x => /^[em]:/.test(x));
  const elegidos = ids.map(id => todos.find(t => t._id === id)).filter(Boolean);
  const libres = todos.filter(t => !ids.includes(t._id));
  const poner = (lista) => guardar({ elementos: ['#sel', ...lista] });
  const mover = (i, d) => { const n = [...ids]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; poner(n); };
  const quitar = (id) => poner(ids.filter(x => x !== id));
  const ruta = (t) => `/client-projects/${projectId}/${t._t === 'Equipo' ? 'equipment' : 'materials'}/${t.id}`;
  const cambiar = async (t, campos) => { try { await api.put(ruta(t), campos); await recargar(); } catch (e) { setAviso(e.response?.data?.error || 'No se pudo guardar'); } };
  const crear = async () => {
    if (!nuevo?.name?.trim()) { setAviso('Ponle un nombre'); return; }
    setAviso('');
    try {
      const esEq = nuevo.tipo === 'Equipo';
      const { data } = await api.post(`/client-projects/${projectId}/${esEq ? 'equipment' : 'materials'}`, { name: nuevo.name, brand: nuevo.brand || null, image_url: nuevo.image_url || null, category_type: esEq ? 'mobiliario' : 'material' });
      const creado = esEq ? data.equipment : data.material;
      setNuevo(null);
      await recargar();
      poner([...ids, (esEq ? 'e:' : 'm:') + creado.id]);
    } catch (e) { setAviso(e.response?.data?.error || 'No se pudo crear'); }
  };
  const miniatura = { width: 46, height: 46, objectFit: 'contain', background: 'rgba(255,255,255,0.06)', borderRadius: 6, flex: 'none' };

  return (
    <div style={{ marginTop: 6 }}>
      {!modoSel && <p style={{ ...muted, color: '#f5b748', marginBottom: 6 }}>Ahora este bloque enseña todos los equipos con foto de Listados (como siempre). Elige aquí los de este capítulo y se enseñarán solo esos.</p>}
      {cargando && <p style={muted}>Cargando Listados…</p>}
      {modoSel && !elegidos.length && !cargando && <p style={muted}>Este capítulo no enseña ningún equipo ni material todavía.</p>}
      {elegidos.map((t, i) => (
        <div key={t._id} style={{ ...row, marginBottom: 6, padding: '6px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
          {t.image_url ? <img src={t.image_url} alt="" style={miniatura} /> : <div style={{ ...miniatura, display: 'grid', placeItems: 'center', ...muted }}>sin foto</div>}
          <div style={{ flex: 1, minWidth: 150 }}>
            <input className="ap-field-input" style={{ marginBottom: 3 }} defaultValue={t.name} onBlur={e => e.target.value.trim() && e.target.value.trim() !== t.name && cambiar(t, { name: e.target.value })} />
            <div style={row}>
              <input className="ap-field-input" style={{ flex: 1, minWidth: 90 }} placeholder="Marca" defaultValue={t.brand || ''} onBlur={e => (e.target.value.trim() || '') !== (t.brand || '') && cambiar(t, { brand: e.target.value })} />
              <span style={muted}>{t._t}</span>
            </div>
          </div>
          <Subir projectId={projectId} label={t.image_url ? 'Cambiar foto' : 'Subir foto'} onUrl={u => cambiar(t, { image_url: u })} />
          <button type="button" className="ap-btn-icon" title="Subir" onClick={() => mover(i, -1)}><ChevronUp size={13} /></button>
          <button type="button" className="ap-btn-icon" title="Bajar" onClick={() => mover(i, 1)}><ChevronDown size={13} /></button>
          <button type="button" className="ap-btn-icon" title="Quitar de este capítulo (sigue en Listados)" onClick={() => quitar(t._id)}><X size={13} /></button>
        </div>
      ))}
      <div style={{ ...row, marginTop: 6 }}>
        <select className="ap-select" style={{ width: 'auto', maxWidth: 260 }} value={anadir} onChange={e => setAnadir(e.target.value)}>
          <option value="">Añadir desde Listados…</option>
          {libres.map(t => <option key={t._id} value={t._id}>{t._t}: {t.name}{t.brand ? ' · ' + t.brand : ''}</option>)}
        </select>
        <button type="button" className="ap-btn ap-btn-ghost ap-btn-xs" disabled={!anadir} onClick={() => { poner([...ids, anadir]); setAnadir(''); }}><Plus size={11} /> Añadir</button>
        {libres.some(t => t.image_url) && <button type="button" className="ap-btn ap-btn-ghost ap-btn-xs" onClick={() => poner([...ids, ...libres.filter(t => t.image_url).map(t => t._id)])}>Añadir todos los que tienen foto</button>}
        {!nuevo && <button type="button" className="ap-btn ap-btn-ghost ap-btn-xs" onClick={() => setNuevo({ tipo: 'Equipo', name: '', brand: '', image_url: '' })}><Plus size={11} /> Crear nuevo en Listados</button>}
      </div>
      {nuevo && (
        <div style={{ ...box, marginTop: 8 }}>
          <div style={{ ...row, marginBottom: 6 }}>
            <select className="ap-select" style={{ width: 'auto' }} value={nuevo.tipo} onChange={e => setNuevo({ ...nuevo, tipo: e.target.value })}>
              <option>Equipo</option><option>Material</option>
            </select>
            <input className="ap-field-input" style={{ flex: 1, minWidth: 140 }} placeholder="Nombre (por ejemplo, Cinta de correr X2)" value={nuevo.name} onChange={e => setNuevo({ ...nuevo, name: e.target.value })} />
            <input className="ap-field-input" style={{ flex: 1, minWidth: 100 }} placeholder="Marca" value={nuevo.brand} onChange={e => setNuevo({ ...nuevo, brand: e.target.value })} />
          </div>
          <div style={row}>
            {nuevo.image_url && <img src={nuevo.image_url} alt="" style={miniatura} />}
            <Subir projectId={projectId} label={nuevo.image_url ? 'Cambiar foto' : 'Subir foto'} onUrl={u => setNuevo(n => ({ ...n, image_url: u }))} />
            <button type="button" className="ap-btn ap-btn-primary ap-btn-sm" onClick={crear}>Crear y añadir a este capítulo</button>
            <button type="button" className="ap-btn ap-btn-ghost ap-btn-xs" onClick={() => { setNuevo(null); setAviso(''); }}>Cancelar</button>
          </div>
          <p style={{ ...muted, marginTop: 4 }}>Se crea en la pestaña Listados del proyecto: allí lo podrás completar (precio, enlace, ficha…).</p>
        </div>
      )}
      {aviso && <p className="ap-error" style={{ marginTop: 6 }}>{aviso}</p>}
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
      {b.tipo === 'equipo' && <EquipoCapitulo projectId={projectId} b={b} guardar={guardar} />}
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
    <div style={{ ...box, marginBottom: 12, borderColor: 'rgba(186,175,165,0.35)' }}>
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
    <div style={{ ...box, marginTop: 16, borderColor: 'rgba(186,175,165,0.35)' }}>
      <div style={{ ...row, justifyContent: 'space-between', marginBottom: 6 }}>
        <strong style={{ fontSize: '0.9rem' }}>Estilo del proyecto</strong>
        <button type="button" className="ap-btn ap-btn-primary ap-btn-sm" disabled={cargando} onClick={definir}>
          <Sparkles size={12} /> {cargando ? 'Analizando el moodboard…' : 'Definir el estilo con la IA'}
        </button>
      </div>
      <p style={{ ...muted, marginBottom: 10 }}>La IA mira las imágenes y la paleta del moodboard y propone el nombre del estilo y un texto que lo describe. Es lo que verá el cliente en "La atmósfera"; el texto de arriba (cómo combinar los colores) pasa a un desplegable. Nada se guarda hasta que lo aceptes.</p>
      {error && <p className="ap-error" style={{ marginBottom: 8 }}>{error}</p>}
      {propuesta && (
        <div style={{ ...box, marginBottom: 10, borderColor: 'rgba(186,175,165,0.5)' }}>
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
