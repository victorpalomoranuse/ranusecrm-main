import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import { Film, Upload, Mic, Video, Trash2, RefreshCw, Download, Plus, Check, Wand2, Settings2, Loader2 } from 'lucide-react';

const card = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '0.85rem 1rem' };
const mut = { color: 'rgba(255,255,255,0.45)', fontSize: '0.78rem' };
const ESTADOS = { pendiente: ['En cola', '#bba'], procesando: ['Montando…', '#f2c46d'], listo: ['Listo', '#7ccf8f'], error: ['Error', '#ef7b7b'] };
const fmtFecha = (iso) => { try { return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }); } catch { return ''; } };

async function subirArchivo(file, onProgreso) {
  const { data } = await api.post('/estudio-video/subida', { nombre: file.name });
  const cuerpo = new FormData(); cuerpo.append('cacheControl', '3600'); cuerpo.append('', file);
  await new Promise((ok, ko) => {
    const x = new XMLHttpRequest(); x.open('PUT', data.url);
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgreso(Math.round(e.loaded / e.total * 100)); };
    x.onload = () => (x.status < 300 ? ok() : ko(new Error('La subida falló (' + x.status + ')')));
    x.onerror = () => ko(new Error('Sin conexión durante la subida'));
    x.send(cuerpo);
  });
  return data.ruta;
}

function Nuevo({ formatos, onCreado }) {
  const [tipo, setTipo] = useState('voz'), [fmt, setFmt] = useState(''), [file, setFile] = useState(null), [notas, setNotas] = useState(''), [prog, setProg] = useState(null), [error, setError] = useState('');
  const inp = useRef(null);
  useEffect(() => { if (!fmt && formatos[0]) setFmt(formatos[0].id); }, [formatos, fmt]);
  const enviar = async () => {
    if (!file || !fmt) return; setError(''); setProg(0);
    try {
      const ruta = await subirArchivo(file, setProg);
      await api.post('/estudio-video/trabajos', { tipo, formato: fmt, archivo: ruta, nombre_archivo: file.name, indicaciones: notas });
      setFile(null); setNotas(''); setProg(null); if (inp.current) inp.current.value = ''; onCreado();
    } catch (e) { setError(e?.response?.data?.error || e.message || 'No se pudo enviar'); setProg(null); }
  };
  const Opcion = ({ id, Icono, titulo, sub }) => (
    <button onClick={() => setTipo(id)} className="ap-btn" style={{ flex: 1, minWidth: 150, textAlign: 'left', padding: '0.7rem', borderColor: tipo === id ? 'rgba(242,196,109,0.7)' : undefined, background: tipo === id ? 'rgba(242,196,109,0.08)' : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}><Icono size={15} /> {titulo}</div><div style={{ ...mut, marginTop: 3 }}>{sub}</div>
    </button>
  );
  return (
    <div style={card}>
      <div style={{ fontWeight: 600, marginBottom: 10 }}>Nuevo vídeo</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <Opcion id="voz" Icono={Mic} titulo="Tengo la voz en off" sub="Audio o vídeo hablando. La IA monta las escenas encima." />
        <Opcion id="bruto" Icono={Video} titulo="Subo el bruto" sub="Vídeo grabado hablando a cámara: corta pausas y pone subtítulos." />
      </div>
      <label style={{ ...mut, display: 'block', marginBottom: 4 }}>{tipo === 'voz' ? 'Audio o vídeo con la voz' : 'Vídeo en bruto'}</label>
      <input ref={inp} type="file" accept={tipo === 'voz' ? 'audio/*,video/*' : 'video/*'} onChange={e => setFile(e.target.files?.[0] || null)} className="ap-field-input" style={{ width: '100%', marginBottom: 10 }} />
      <label style={{ ...mut, display: 'block', marginBottom: 4 }}>Formato</label>
      <select className="ap-field-input" style={{ width: '100%', marginBottom: 10 }} value={fmt} onChange={e => setFmt(e.target.value)}>{formatos.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}</select>
      {formatos.find(f => f.id === fmt)?.descripcion && <div style={{ ...mut, marginTop: -4, marginBottom: 10 }}>{formatos.find(f => f.id === fmt).descripcion}</div>}
      <label style={{ ...mut, display: 'block', marginBottom: 4 }}>Indicaciones (opcional)</label>
      <textarea className="ap-field-input" style={{ width: '100%', minHeight: 60, marginBottom: 10 }} value={notas} onChange={e => setNotas(e.target.value)} placeholder="Ej.: enseña el proyecto de Rivas, tono directo, que empiece con un plano de obra…" />
      {error && <div className="ap-error" style={{ marginBottom: 8 }}>{error}</div>}
      <button className="ap-btn ap-btn-primary" disabled={!file || !fmt || prog !== null} onClick={enviar}>{prog !== null ? <><Loader2 size={14} /> Subiendo {prog}%</> : <><Wand2 size={14} /> Editar vídeo</>}</button>
    </div>
  );
}

function Trabajo({ t, formatos, onCambio }) {
  const [cambios, setCambios] = useState(''), [abierto, setAbierto] = useState(false), [fmt, setFmt] = useState(t.formato), [err, setErr] = useState('');
  const [txt, color] = ESTADOS[t.estado] || ESTADOS.pendiente;
  const rehacer = async () => { if (!cambios.trim()) return; try { await api.post('/estudio-video/trabajos/' + t.id + '/rehacer', { indicaciones: cambios, formato: fmt }); setCambios(''); setAbierto(false); onCambio(); } catch (e) { setErr(e?.response?.data?.error || 'No se pudo'); } };
  const borrar = async () => { if (!window.confirm('¿Borrar este vídeo?')) return; try { await api.delete('/estudio-video/trabajos/' + t.id); onCambio(); } catch { setErr('No se pudo borrar'); } };
  return (
    <div style={card}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Film size={15} /><div style={{ fontWeight: 600, flex: 1, minWidth: 140, wordBreak: 'break-word' }}>{t.plan?.titulo || t.nombre_archivo || 'Vídeo'}{t.version > 1 ? ' · v' + t.version : ''}</div>
        <span style={{ fontSize: '0.72rem', color, border: '1px solid ' + color, borderRadius: 20, padding: '1px 9px' }}>{txt}</span>
      </div>
      <div style={{ ...mut, marginTop: 4 }}>{t.formato_nombre} · {t.tipo === 'voz' ? 'voz en off' : 'bruto'} · {fmtFecha(t.creado)}{t.por ? ' · ' + t.por : ''}</div>
      {t.estado !== 'listo' && t.estado !== 'error' && <div style={{ ...mut, marginTop: 6 }}>{t.progreso}</div>}
      {t.estado === 'error' && <div className="ap-error" style={{ marginTop: 8 }}>{t.error || 'Ha fallado el montaje.'}</div>}
      {t.indicaciones && <div style={{ ...mut, marginTop: 6, whiteSpace: 'pre-wrap' }}>“{t.indicaciones}”</div>}
      {t.estado === 'listo' && t.url && (
        <div style={{ marginTop: 10 }}>
          <video src={t.url_movil || t.url} controls playsInline style={{ width: '100%', maxWidth: 300, borderRadius: 10, background: '#000', display: 'block' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <a className="ap-btn ap-btn-sm" href={t.url} download target="_blank" rel="noreferrer"><Download size={13} /> Descargar</a>
            <button className="ap-btn ap-btn-sm" onClick={() => setAbierto(!abierto)}><RefreshCw size={13} /> Pedir cambios</button>
          </div>
        </div>
      )}
      {abierto && (
        <div style={{ marginTop: 10 }}>
          <textarea className="ap-field-input" style={{ width: '100%', minHeight: 60, marginBottom: 8 }} value={cambios} onChange={e => setCambios(e.target.value)} placeholder="Qué cambiar: más rápido, otra escena en el segundo 10, título más corto, subtítulos más pequeños…" />
          <select className="ap-field-input" style={{ width: '100%', marginBottom: 8 }} value={fmt} onChange={e => setFmt(e.target.value)}>{formatos.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}</select>
          <button className="ap-btn ap-btn-primary ap-btn-sm" disabled={!cambios.trim()} onClick={rehacer}><Wand2 size={13} /> Rehacer con estos cambios</button>
        </div>
      )}
      {err && <div className="ap-error" style={{ marginTop: 8 }}>{err}</div>}
      <div style={{ marginTop: 8 }}><button className="ap-btn ap-btn-sm" onClick={borrar}><Trash2 size={13} /></button></div>
    </div>
  );
}

function Campo({ etiqueta, children }) { return <label style={{ display: 'block', marginBottom: 8 }}><div style={{ ...mut, marginBottom: 3 }}>{etiqueta}</div>{children}</label>; }

function Formatos({ formatos, onCambio }) {
  const [sel, setSel] = useState(null), [f, setF] = useState(null), [msg, setMsg] = useState('');
  useEffect(() => { const x = formatos.find(y => y.id === (sel || formatos[0]?.id)); if (x) { setF(JSON.parse(JSON.stringify(x))); setSel(x.id); } }, [formatos, sel]);
  if (!f) return null;
  const r = f.receta || {}; const setR = (k, v) => setF({ ...f, receta: { ...r, [k]: v } }); const setS = (k, v) => setF({ ...f, receta: { ...r, subs: { ...(r.subs || {}), [k]: v } } });
  const guardar = async () => { try { await api.put('/estudio-video/formatos/' + f.id, f); setMsg('Guardado'); onCambio(); setTimeout(() => setMsg(''), 1500); } catch (e) { setMsg(e?.response?.data?.error || 'No se pudo guardar'); } };
  const duplicar = async () => { const n = window.prompt('Nombre del nuevo formato'); if (!n) return; try { const { data } = await api.post('/estudio-video/formatos', { nombre: n, copiar_de: f.id }); setSel(data.formato.id); onCambio(); } catch { setMsg('No se pudo crear'); } };
  const borrar = async () => { if (!window.confirm('¿Borrar el formato "' + f.nombre + '"?')) return; try { await api.delete('/estudio-video/formatos/' + f.id); setSel(null); onCambio(); } catch (e) { setMsg(e?.response?.data?.error || 'No se pudo borrar'); } };
  const num = (v, fn) => <input className="ap-field-input" type="number" step="any" style={{ width: '100%' }} value={v ?? ''} onChange={e => fn(e.target.value === '' ? '' : Number(e.target.value))} />;
  return (
    <div style={card}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <select className="ap-field-input" style={{ flex: 1, minWidth: 160 }} value={f.id} onChange={e => setSel(e.target.value)}>{formatos.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select>
        <button className="ap-btn ap-btn-sm" onClick={duplicar}><Plus size={13} /> Duplicar como nuevo</button><button className="ap-btn ap-btn-sm" onClick={borrar}><Trash2 size={13} /></button>
      </div>
      <Campo etiqueta="Nombre"><input className="ap-field-input" style={{ width: '100%' }} value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} /></Campo>
      <Campo etiqueta="Descripción"><textarea className="ap-field-input" style={{ width: '100%', minHeight: 50 }} value={f.descripcion || ''} onChange={e => setF({ ...f, descripcion: e.target.value })} /></Campo>
      <Campo etiqueta="Criterio de montaje para la IA (cómo debe pensar este formato)"><textarea className="ap-field-input" style={{ width: '100%', minHeight: 70 }} value={f.notas || ''} onChange={e => setF({ ...f, notas: e.target.value })} placeholder="Ej.: serio, sin humor; empieza siempre con un plano potente; enseña producto en detalle cuando se hable de máquinas…" /></Campo>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10 }}>
        <Campo etiqueta="Corte mínimo (s)">{num(r.corte?.min, v => setR('corte', { ...r.corte, min: v }))}</Campo>
        <Campo etiqueta="Corte máximo (s)">{num(r.corte?.max, v => setR('corte', { ...r.corte, max: v }))}</Campo>
        <Campo etiqueta="Zoom lento (1 = sin)">{num(r.zoomFinal, v => setR('zoomFinal', v))}</Campo>
        <Campo etiqueta="Volumen whoosh (0-0.5)">{num(r.whoosh, v => setR('whoosh', v))}</Campo>
        <Campo etiqueta="Palabras por subtítulo">{num(r.subs?.palabrasPorBloque, v => setS('palabrasPorBloque', v))}</Campo>
        <Campo etiqueta="Tamaño subtítulo">{num(r.subs?.tam, v => setS('tam', v))}</Campo>
        <Campo etiqueta="Altura subtítulo">{num(r.subs?.margenV, v => setS('margenV', v))}</Campo>
        <Campo etiqueta="Color de acento"><input type="color" value={r.acento || '#F2C46D'} onChange={e => setR('acento', e.target.value)} style={{ width: '100%', height: 34, background: 'none', border: 'none' }} /></Campo>
      </div>
      <div style={{ display: 'flex', gap: 16, margin: '4px 0 12px', flexWrap: 'wrap', fontSize: '0.85rem' }}>
        <label><input type="checkbox" checked={!!r.flash} onChange={e => setR('flash', e.target.checked)} /> Destello en cada corte</label>
        <label><input type="checkbox" checked={r.titulo !== false} onChange={e => setR('titulo', e.target.checked)} /> Título arriba</label>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><button className="ap-btn ap-btn-primary ap-btn-sm" onClick={guardar}><Check size={13} /> Guardar formato</button><span style={mut}>{msg}</span></div>
    </div>
  );
}

export function SectionEstudioVideo() {
  const [tab, setTab] = useState('videos'), [formatos, setFormatos] = useState([]), [trabajos, setTrabajos] = useState(null), [error, setError] = useState('');
  const cargarF = useCallback(() => api.get('/estudio-video/formatos').then(r => setFormatos(r.data.formatos || [])).catch(() => setError('No se han podido cargar los formatos')), []);
  const cargarT = useCallback(() => api.get('/estudio-video/trabajos').then(r => setTrabajos(r.data.trabajos || [])).catch(() => setTrabajos(t => t || [])), []);
  useEffect(() => { cargarF(); cargarT(); }, [cargarF, cargarT]);
  const hayActivos = (trabajos || []).some(t => t.estado === 'pendiente' || t.estado === 'procesando');
  useEffect(() => { if (!hayActivos) return; const i = setInterval(cargarT, 6000); return () => clearInterval(i); }, [hayActivos, cargarT]);
  return (
    <div style={{ maxWidth: 820 }}>
      <h1 className="ap-page-title" style={{ marginBottom: 6 }}>Estudio de vídeo</h1>
      <p style={{ ...mut, marginBottom: 16 }}>Sube una voz en off (audio o vídeo) o un vídeo en bruto, elige un formato y la IA lo edita con las escenas de la biblioteca. Cada formato guarda el estilo para que todos los vídeos salgan igual. Si no te gusta algo, pide cambios sobre el propio vídeo.</p>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        <button className={'ap-btn ap-btn-sm' + (tab === 'videos' ? ' ap-btn-primary' : '')} onClick={() => setTab('videos')}><Film size={13} /> Vídeos</button>
        <button className={'ap-btn ap-btn-sm' + (tab === 'formatos' ? ' ap-btn-primary' : '')} onClick={() => setTab('formatos')}><Settings2 size={13} /> Formatos</button>
      </div>
      {error && <div className="ap-error" style={{ marginBottom: 10 }}>{error}</div>}
      {tab === 'formatos' ? <Formatos formatos={formatos} onCambio={cargarF} /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Nuevo formatos={formatos} onCreado={cargarT} />
          {trabajos === null ? <div className="ap-loading">Cargando…</div> : trabajos.length === 0 ? <div style={mut}>Todavía no hay vídeos. Sube el primero arriba.</div> : trabajos.map(t => <Trabajo key={t.id} t={t} formatos={formatos} onCambio={cargarT} />)}
        </div>
      )}
    </div>
  );
}
