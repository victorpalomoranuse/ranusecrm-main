import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import { Film, Upload, Mic, Video, Trash2, RefreshCw, Download, Plus, Check, Wand2, Settings2, Loader2, Music, Folder, ArrowLeft, Image as ImagenIcono, Play, X, Scissors } from 'lucide-react';

const card = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '0.85rem 1rem' };
const mut = { color: 'rgba(255,255,255,0.45)', fontSize: '0.78rem' };
const ESTILO_SELECT = '.ev-root select option { background:#1a1a1a; color:#fff; } .ev-root select { color-scheme: dark; }';
const ESTADOS = { pendiente: ['En cola', '#bba'], procesando: ['Montando…', '#f2c46d'], listo: ['Listo', '#7ccf8f'], error: ['Error', '#ef7b7b'] };
const fmtFecha = (iso) => { try { return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }); } catch { return ''; } };

async function subirArchivo(file, onProgreso, tipo) {
  const { data } = await api.post('/estudio-video/subida', { nombre: file.name, tipo });
  const cuerpo = new FormData(); cuerpo.append('cacheControl', '3600'); cuerpo.append('', file);
  await new Promise((ok, ko) => {
    const x = new XMLHttpRequest(); x.open('PUT', data.url); if (data.gcs) x.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgreso(Math.round(e.loaded / e.total * 100)); };
    x.onload = () => (x.status < 300 ? ok() : ko(new Error('La subida falló (' + x.status + ')')));
    x.onerror = () => ko(new Error('Sin conexión durante la subida'));
    x.send(data.gcs ? file : cuerpo);
  });
  return data.ruta;
}

const fmtDur = (s) => (s == null ? '' : Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'));
const urlMiniatura = (id) => { let t = ''; try { t = localStorage.getItem('admin_token') || ''; } catch { /* sin token */ } return (api.defaults.baseURL || '/api') + '/estudio-video/drive/miniatura/' + id + '?t=' + encodeURIComponent(t); };

// Selección con la que se hizo un vídeo: la elegida a mano o, si no hubo, los clips que realmente se usaron
function selInicial(t) {
  if ((t.recursos || []).length) return t.recursos;
  const vistos = new Set(), out = [];
  for (const c of (t.cortes || [])) { const id = c.drive_id; if (!id || vistos.has(id)) continue; vistos.add(id); out.push({ id, nombre: c.nombre || 'clip', tipo: c.es_imagen ? 'imagen' : 'video', ruta: '' }); }
  return out.slice(0, 60);
}

function Explorador({ seleccion, onCambio, titulo = 'Recursos (de dónde salen las escenas)', max = 0, vacio = 'Todo Drive indexado' }) {
  const [abierto, setAbierto] = useState(false), [ruta, setRuta] = useState([]), [items, setItems] = useState(null), [error, setError] = useState(''), [ver, setVer] = useState(null);
  const rutaTexto = (extra) => [...ruta.slice(1).map(r => r.nombre), ...(extra ? [extra] : [])].join('/');
  useEffect(() => { if (!abierto || ruta.length) return; api.get('/estudio-video/drive/raiz').then(r => { const x = (r.data.carpetas || [])[0]; if (x) setRuta([{ id: x.id, nombre: x.nombre }]); else setError('No hay carpetas compartidas con Drive todavía.'); }).catch(e => setError(e?.response?.data?.error || 'Drive no está disponible')); }, [abierto, ruta.length]);
  useEffect(() => { if (!ruta.length) return; let vivo = true; setItems(null); setError(''); api.get('/estudio-video/drive/carpeta/' + ruta[ruta.length - 1].id).then(r => vivo && setItems(r.data.elementos || [])).catch(e => vivo && setError(e?.response?.data?.error || 'No se pudo abrir la carpeta')); return () => { vivo = false; }; }, [ruta]);
  const esta = (id) => seleccion.some(s => s.id === id);
  const alterna = (it) => { const nuevo = { id: it.id, nombre: it.nombre, tipo: it.tipo, ruta: it.tipo === 'carpeta' ? rutaTexto(it.nombre) : rutaTexto() }; onCambio(esta(it.id) ? seleccion.filter(s => s.id !== it.id) : max === 1 ? [nuevo] : [...seleccion, nuevo]); };
  const nSel = seleccion.length;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ ...mut, marginBottom: 4 }}>{titulo}</div>
      <button type="button" className="ap-btn ap-btn-sm" onClick={() => setAbierto(!abierto)}>{nSel ? nSel + ' elegido(s)' : vacio} {abierto ? '▲' : '▼'}</button>
      {nSel > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>{seleccion.map(s => <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid rgba(255,255,255,0.15)', borderRadius: 20, padding: '2px 4px 2px 10px', fontSize: '0.78rem' }}>{s.tipo === 'carpeta' ? <Folder size={11} /> : s.tipo === 'audio' ? <Music size={11} /> : s.tipo === 'imagen' ? <ImagenIcono size={11} /> : <Film size={11} />}{s.nombre.length > 28 ? s.nombre.slice(0, 26) + '…' : s.nombre}<button type="button" onClick={() => onCambio(seleccion.filter(x => x.id !== s.id))} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', display: 'flex', padding: 2 }}><X size={11} /></button></span>)}<button type="button" className="ap-btn ap-btn-sm" onClick={() => onCambio([])}>Quitar todo</button></div>}
      {abierto && (
        <div style={{ marginTop: 8, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8, fontSize: '0.8rem' }}>
            {ruta.length > 1 && <button type="button" className="ap-btn ap-btn-sm" onClick={() => setRuta(ruta.slice(0, -1))}><ArrowLeft size={12} /></button>}
            {ruta.map((r, i) => <span key={r.id}>{i > 0 && ' / '}<a href="#" onClick={e => { e.preventDefault(); setRuta(ruta.slice(0, i + 1)); }} style={{ color: i === ruta.length - 1 ? '#fff' : 'rgba(255,255,255,0.55)' }}>{r.nombre}</a></span>)}
          </div>
          {error && <div className="ap-error">{error}</div>}
          {!error && items === null && <div style={mut}><Loader2 size={12} /> Cargando…</div>}
          {items && items.length === 0 && <div style={mut}>Carpeta vacía.</div>}
          {items && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: 8, maxHeight: 420, overflow: 'auto' }}>
            {items.map(it => (
              <div key={it.id} style={{ position: 'relative', border: '1px solid ' + (esta(it.id) ? 'rgba(205,187,167,0.9)' : 'rgba(255,255,255,0.1)'), background: esta(it.id) ? 'rgba(205,187,167,0.1)' : 'rgba(255,255,255,0.03)', borderRadius: 8, overflow: 'hidden' }}>
                {it.tipo === 'carpeta'
                  ? <div role="button" tabIndex={0} onClick={() => setRuta([...ruta, { id: it.id, nombre: it.nombre }])} style={{ aspectRatio: '9 / 12', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Folder size={34} style={{ opacity: 0.55 }} /></div>
                  : it.tipo === 'audio' ? <div role="button" tabIndex={0} onClick={() => setVer(it)} style={{ aspectRatio: '9 / 12', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Music size={30} style={{ opacity: 0.55 }} /></div>
                  : <div role="button" tabIndex={0} onClick={() => setVer(it)} style={{ aspectRatio: '9 / 12', cursor: 'pointer', background: '#000', position: 'relative' }}><img src={urlMiniatura(it.id)} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={e => { e.currentTarget.style.opacity = 0; }} />{it.tipo === 'video' && <span style={{ position: 'absolute', right: 4, bottom: 4, background: 'rgba(0,0,0,0.7)', borderRadius: 4, padding: '0 5px', fontSize: '0.68rem' }}><Play size={9} /> {fmtDur(it.duracion)}</span>}</div>}
                {!(max === 1 && !['video', 'audio'].includes(it.tipo)) && <label style={{ position: 'absolute', left: 4, top: 4, background: 'rgba(0,0,0,0.65)', borderRadius: 4, padding: '1px 4px', cursor: 'pointer', display: 'flex' }}><input type="checkbox" checked={esta(it.id)} onChange={() => alterna(it)} /></label>}
                <div style={{ padding: '4px 6px', fontSize: '0.72rem', lineHeight: 1.25, wordBreak: 'break-word', maxHeight: 34, overflow: 'hidden' }}>{it.nombre}</div>
              </div>
            ))}
          </div>}
          <div style={{ ...mut, marginTop: 8 }}>{max === 1 ? 'Marca el vídeo que quieres usar como base. Pulsa una miniatura para verlo.' : 'Marca una carpeta para usar todo lo que contiene, o vídeos e imágenes sueltos. Pulsa una miniatura para verla.'}</div>
        </div>
      )}
      {ver && (
        <div onClick={() => setVer(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 'min(460px, 100%)', background: '#0f0f0f', borderRadius: 12, padding: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}><div style={{ flex: 1, fontSize: '0.85rem', wordBreak: 'break-word' }}>{ver.nombre}</div><button type="button" className="ap-btn ap-btn-sm" onClick={() => setVer(null)}><X size={13} /></button></div>
            {ver.tipo === 'video' || ver.tipo === 'audio' ? <iframe title="vista previa" src={'https://drive.google.com/file/d/' + ver.id + '/preview'} allow="autoplay" style={{ width: '100%', aspectRatio: '9 / 14', border: 0, borderRadius: 8, background: '#000' }} /> : <img src={urlMiniatura(ver.id)} alt="" style={{ width: '100%', borderRadius: 8 }} />}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}><button type="button" className="ap-btn ap-btn-primary ap-btn-sm" onClick={() => { alterna(ver); setVer(null); }}>{esta(ver.id) ? 'Quitar de la selección' : 'Usar en el vídeo'}</button></div>
            {(ver.tipo === 'video' || ver.tipo === 'audio') && <div style={{ ...mut, marginTop: 6 }}>La vista previa usa tu sesión de Google: si no carga, inicia sesión en Drive con tu cuenta de Ranuse.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function Nuevo({ formatos, musica, carpetas, onCreado }) {
  const [origen, setOrigen] = useState('dispositivo'), [base, setBase] = useState([]), [recursos, setRecursos] = useState([]), [mus, setMus] = useState('auto'), [tipo, setTipo] = useState('voz'), [numClips, setNumClips] = useState(0), [durClip, setDurClip] = useState('25-70'), [fmt, setFmt] = useState(''), [file, setFile] = useState(null), [notas, setNotas] = useState(''), [prog, setProg] = useState(null), [error, setError] = useState('');
  const inp = useRef(null);
  useEffect(() => { if (!fmt && formatos[0]) setFmt(formatos[0].id); }, [formatos, fmt]);
  useEffect(() => { if (tipo === 'clips' && formatos.some(f => f.id === 'clips-dopaminicos')) setFmt('clips-dopaminicos'); }, [tipo, formatos]);
  const enviar = async () => {
    const extra = tipo === 'clips' ? { num_clips: numClips, dur_min: Number(durClip.split('-')[0]), dur_max: Number(durClip.split('-')[1]) } : {};
    const dDrive = tipo === 'base' || origen === 'drive';
    if ((dDrive ? !base.length : !file) || !fmt) return; setError(''); setProg(0);
    try {
      if (dDrive) await api.post('/estudio-video/trabajos', { tipo, formato: fmt, base: base[0], nombre_archivo: base[0].nombre, indicaciones: notas, musica: mus, recursos, ...extra });
      else { const ruta = await subirArchivo(file, setProg); await api.post('/estudio-video/trabajos', { tipo, formato: fmt, archivo: ruta, nombre_archivo: file.name, indicaciones: notas, musica: mus, recursos, ...extra }); }
      setFile(null); setBase([]); setNotas(''); setProg(null); if (inp.current) inp.current.value = ''; onCreado();
    } catch (e) { setError(e?.response?.data?.error || e.message || 'No se pudo enviar'); setProg(null); }
  };
  const opcion = (id, Icono, titulo, sub) => (
    <div key={id} role="button" tabIndex={0} onClick={() => setTipo(id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setTipo(id); }}
      style={{ flex: '1 1 220px', boxSizing: 'border-box', cursor: 'pointer', textAlign: 'left', padding: '0.75rem 0.9rem', borderRadius: 10, color: '#fff', whiteSpace: 'normal', lineHeight: 1.35, border: '1px solid ' + (tipo === id ? 'rgba(242,196,109,0.8)' : 'rgba(255,255,255,0.12)'), background: tipo === id ? 'rgba(242,196,109,0.09)' : 'rgba(255,255,255,0.03)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: '0.9rem' }}><Icono size={15} /> {titulo}</div>
      <div style={{ ...mut, marginTop: 4, fontWeight: 400 }}>{sub}</div>
    </div>
  );
  return (
    <div style={card}>
      <div style={{ fontWeight: 600, marginBottom: 10 }}>Nuevo vídeo</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {opcion('voz', Mic, 'Tengo la voz en off', 'Audio o vídeo hablando. La IA monta las escenas encima.')}
        {opcion('bruto', Video, 'Subo el bruto', 'Vídeo grabado hablando a cámara: corta pausas y pone subtítulos.')}
        {opcion('clips', Scissors, 'Entrevista larga → varios clips', 'Subes una entrevista o charla larga y la IA saca los mejores momentos como clips cortos con edición dopamínica.')}
        {opcion('base', Film, 'Vídeo de Drive como base', 'Eliges un vídeo de Drive y la IA superpone clips e imágenes del resto en los momentos clave.')}
      </div>
      {tipo !== 'base' && (<>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <button type="button" className={'ap-btn ap-btn-sm' + (origen === 'dispositivo' ? ' ap-btn-primary' : '')} onClick={() => setOrigen('dispositivo')}><Upload size={12} /> Desde el dispositivo</button>
        <button type="button" className={'ap-btn ap-btn-sm' + (origen === 'drive' ? ' ap-btn-primary' : '')} onClick={() => setOrigen('drive')}><Folder size={12} /> Desde Drive</button>
      </div>
      {origen === 'drive' && <Explorador seleccion={base} onCambio={setBase} max={1} titulo={tipo === 'voz' ? 'Audio o vídeo con la voz (de Drive)' : tipo === 'clips' ? 'Entrevista (de Drive)' : 'Vídeo en bruto (de Drive)'} vacio="Elegir archivo de Drive" />}
      {origen !== 'drive' && (<>
      <label style={{ ...mut, display: 'block', marginBottom: 4 }}>{tipo === 'voz' ? 'Audio o vídeo con la voz' : tipo === 'clips' ? 'Entrevista o charla larga' : 'Vídeo en bruto'}</label>
      <input ref={inp} type="file" accept={tipo === 'voz' ? 'audio/*,video/*' : 'video/*'} onChange={e => setFile(e.target.files?.[0] || null)} className="ap-field-input" style={{ width: '100%', marginBottom: 10 }} />
      </>)}
      </>)}
      <label style={{ ...mut, display: 'block', marginBottom: 4 }}>Formato</label>
      <select className="ap-field-input" style={{ width: '100%', marginBottom: 10 }} value={fmt} onChange={e => setFmt(e.target.value)}>{formatos.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}</select>
      {formatos.find(f => f.id === fmt)?.descripcion && <div style={{ ...mut, marginTop: -4, marginBottom: 10 }}>{formatos.find(f => f.id === fmt).descripcion}</div>}
      {tipo === 'clips' && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <label style={{ ...mut, flex: '1 1 160px' }}>Cuántos clips<select className="ap-field-input" style={{ width: '100%', marginTop: 4 }} value={numClips} onChange={e => setNumClips(Number(e.target.value))}><option value={0}>Los que merezcan la pena</option>{[1, 2, 3, 4, 5, 6, 8, 10].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
          <label style={{ ...mut, flex: '1 1 160px' }}>Duración de cada clip<select className="ap-field-input" style={{ width: '100%', marginTop: 4 }} value={durClip} onChange={e => setDurClip(e.target.value)}><option value="15-35">Cortos (15–35 s)</option><option value="25-70">Medios (25–70 s)</option><option value="50-110">Largos (50–110 s)</option></select></label>
        </div>
      )}
      {tipo === 'base' && <Explorador seleccion={base} onCambio={setBase} max={1} titulo="Vídeo base (el que se ve de fondo, con su voz)" vacio="Elegir el vídeo base" />}
      <Explorador seleccion={recursos} onCambio={setRecursos} titulo={tipo === 'voz' ? 'Recursos (de dónde salen las escenas)' : 'Recursos para superponer en momentos clave (opcional)'} vacio={tipo === 'voz' ? 'Todo Drive indexado' : 'Todo Drive indexado / elegir recursos'} />
      <label style={{ ...mut, display: 'block', marginBottom: 4 }}>Música de fondo</label>
      <select className="ap-field-input" style={{ width: '100%', marginBottom: 10 }} value={mus} onChange={e => setMus(e.target.value)}><option value="auto">Automática (la IA elige la que mejor encaje)</option><option value="ninguna">Sin música</option>{musica.map(p => <option key={p.nombre} value={p.nombre}>{p.nombre}{p.bpm ? ' · ' + Math.round(p.bpm) + ' bpm' : ''}</option>)}</select>
      <label style={{ ...mut, display: 'block', marginBottom: 4 }}>Indicaciones (opcional)</label>
      <textarea className="ap-field-input" style={{ width: '100%', minHeight: 60, marginBottom: 10 }} value={notas} onChange={e => setNotas(e.target.value)} placeholder="Ej.: enseña el proyecto de Rivas, tono directo, que empiece con un plano de obra…" />
      {error && <div className="ap-error" style={{ marginBottom: 8 }}>{error}</div>}
      <button className="ap-btn ap-btn-primary" disabled={((tipo === 'base' || origen === 'drive') ? !base.length : !file) || !fmt || prog !== null} onClick={enviar}>{prog !== null ? <><Loader2 size={14} /> Subiendo {prog}%</> : <><Wand2 size={14} /> Editar vídeo</>}</button>
    </div>
  );
}

function Trabajo({ t, formatos, onCambio }) {
  const [cambios, setCambios] = useState(''), [abierto, setAbierto] = useState(false), [fmt, setFmt] = useState(t.formato), [err, setErr] = useState(''), [panelReg, setPanelReg] = useState(false), [editando, setEditando] = useState(false), [editTexto, setEditTexto] = useState(false), [recs, setRecs] = useState(selInicial(t)), [baseSel, setBaseSel] = useState(t.base?.id ? [{ id: t.base.id, nombre: t.base.nombre, tipo: 'video', ruta: t.base.ruta || '' }] : []);
  const [txt, color] = ESTADOS[t.estado] || ESTADOS.pendiente;
  const vref = useRef(null);
  const regenerar = async () => { try { await api.post('/estudio-video/trabajos/' + t.id + '/rehacer', { formato: t.formato, recursos: recs, ...(baseSel[0] ? { base: baseSel[0] } : {}) }); setPanelReg(false); onCambio(); } catch (e) { setErr(e?.response?.data?.error || 'No se pudo'); } };
  const rehacer = async () => { if (!cambios.trim()) return; try { await api.post('/estudio-video/trabajos/' + t.id + '/rehacer', { indicaciones: cambios, formato: fmt }); setCambios(''); setAbierto(false); onCambio(); } catch (e) { setErr(e?.response?.data?.error || 'No se pudo'); } };
  const borrar = async () => { if (!window.confirm('¿Borrar este vídeo?')) return; try { await api.delete('/estudio-video/trabajos/' + t.id); onCambio(); } catch { setErr('No se pudo borrar'); } };
  return (
    <div style={card}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Film size={15} /><div style={{ fontWeight: 600, flex: 1, minWidth: 140, wordBreak: 'break-word' }}>{t.plan?.titulo || t.nombre_archivo || 'Vídeo'}{t.version > 1 ? ' · v' + t.version : ''}</div>
        <span style={{ fontSize: '0.72rem', color, border: '1px solid ' + color, borderRadius: 20, padding: '1px 9px' }}>{txt}</span>
      </div>
      <div style={{ ...mut, marginTop: 4 }}>{t.formato_nombre} · {t.tipo === 'voz' ? 'voz en off' : t.tipo === 'base' ? 'base de Drive' : t.tipo === 'clips' ? 'entrevista → clips' : t.padre ? 'clip de una entrevista' : 'bruto'} · {fmtFecha(t.creado)}{t.por ? ' · ' + t.por : ''}</div>
      {t.estado !== 'listo' && t.estado !== 'error' && (
        <div style={{ marginTop: 8 }}>
          <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}><div style={{ height: '100%', width: Math.max(t.estado === 'procesando' ? 3 : 0, Math.min(100, t.pct || 0)) + '%', background: '#CDBBA7', borderRadius: 4, transition: 'width 0.8s ease' }} /></div>
          <div style={{ ...mut, marginTop: 5, display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>{t.progreso || 'En cola'}</span><span>{t.estado === 'procesando' ? Math.round(t.pct || 0) + ' %' : 'esperando turno'}</span></div>
        </div>
      )}
      {t.estado === 'error' && <div className="ap-error" style={{ marginTop: 8 }}>{t.error || 'Ha fallado el montaje.'}</div>}
      {t.indicaciones && <div style={{ ...mut, marginTop: 6, whiteSpace: 'pre-wrap' }}>“{t.indicaciones}”</div>}
      {t.estado === 'listo' && t.url && (
        <div style={{ marginTop: 10 }}>
          <video ref={vref} src={t.url_movil || t.url} controls playsInline style={{ width: '100%', maxWidth: 300, borderRadius: 10, background: '#000', display: 'block' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <a className="ap-btn ap-btn-sm" href={t.url} download target="_blank" rel="noreferrer"><Download size={13} /> Descargar</a>
            <button className="ap-btn ap-btn-sm" title="Elige qué recursos usar y vuelve a montarlo" onClick={() => setPanelReg(!panelReg)}><Wand2 size={13} /> Regenerar</button>
            <button className="ap-btn ap-btn-sm" onClick={() => setAbierto(!abierto)}><RefreshCw size={13} /> Pedir cambios</button>
            {(t.cortes || []).length > 0 && <button className="ap-btn ap-btn-sm" title="Cambiar clips o moverlos a mano" onClick={() => setEditando(!editando)}><Scissors size={13} /> Editar cortes</button>}
            {(t.transcripcion || []).length > 0 && <button className="ap-btn ap-btn-sm" title="Quitar palabras o frases leyendo el texto" onClick={() => setEditTexto(!editTexto)}><Scissors size={13} /> Editar texto</button>}
          </div>
        </div>
      )}
      {t.clip?.score != null && (
        <div style={{ marginTop: 8, padding: 10, borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: t.clip.score >= 80 ? '#7ccf8f' : t.clip.score >= 60 ? '#f2c46d' : '#ef7b7b' }}>{t.clip.score}<span style={{ fontSize: '0.8rem', fontWeight: 400 }}>/100</span></div>
            <div style={{ ...mut }}>Potencial viral</div>
            {t.clip.sub && Object.entries(t.clip.sub).filter(([, v]) => v != null).map(([k, v]) => <span key={k} style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)' }}>{k} {v}</span>)}
          </div>
          {t.clip.motivo && <div style={{ ...mut, marginTop: 6 }}>{t.clip.motivo}</div>}
        </div>
      )}
      {t.estado === 'listo' && (t.faltan || []).length > 0 && (
        <div style={{ marginTop: 10, padding: 10, borderRadius: 10, border: '1px solid rgba(242,196,109,0.5)', background: 'rgba(242,196,109,0.08)' }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>La IA echa en falta clips</div>
          <div style={{ ...mut, marginBottom: 6 }}>En estas partes lo que se ve no encaja del todo con lo que dices o se repite por falta de material. Si subes o eliges estos clips, quedará mejor:</div>
          {t.faltan.map((x, i) => <div key={i} style={{ fontSize: '0.82rem', marginBottom: 4 }}>• <strong>“{x.parte}”</strong> → {x.necesitas}</div>)}
        </div>
      )}
      {editando && <EditorCortesPantalla t={t} onCerrar={() => setEditando(false)} onCambio={() => { setEditando(false); onCambio(); }} />}
      {editTexto && <EditorTextoPantalla t={t} onCerrar={() => setEditTexto(false)} onCambio={() => { setEditTexto(false); onCambio(); }} />}
      {panelReg && (
        <div style={{ marginTop: 10, padding: 10, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10 }}>
          <div style={{ ...mut, marginBottom: 6 }}>{(t.recursos || []).length ? 'Esta es la selección que elegiste para este vídeo.' : recs.length ? 'No elegiste recursos concretos: estos son los clips que la IA usó en este montaje.' : 'Este montaje usó todo Drive indexado (no hay clips guardados de esta versión).'} Quita o añade carpetas, vídeos o imágenes y regenera. Sin nada elegido se usa todo Drive indexado.</div>
          <div style={{ ...mut, marginBottom: 4 }}>{t.base?.id ? 'Audio o vídeo base (de Drive): ' + (t.base.nombre || '') : 'Audio o vídeo base: archivo subido desde el dispositivo' + (t.nombre_archivo ? ' (' + t.nombre_archivo + ')' : '') + '. Si eliges uno de Drive, sustituye a ese.'}</div>
          <Explorador seleccion={baseSel} onCambio={setBaseSel} max={1} titulo="Audio o vídeo base" vacio={t.base?.id ? 'Elegir otro archivo base' : 'Cambiar por un archivo de Drive'} />
          <Explorador seleccion={recs} onCambio={setRecs} titulo="Recursos (de dónde salen las escenas)" vacio="Todo Drive indexado" />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="ap-btn ap-btn-primary ap-btn-sm" onClick={regenerar}><Wand2 size={13} /> Regenerar con esta selección</button>
            <button className="ap-btn ap-btn-sm" onClick={() => { setRecs(selInicial(t)); setBaseSel(t.base?.id ? [{ id: t.base.id, nombre: t.base.nombre, tipo: 'video', ruta: t.base.ruta || '' }] : []); setPanelReg(false); }}>Cancelar</button>
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
      <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>{t.estado === 'error' && <button className="ap-btn ap-btn-sm" title="Elige qué recursos usar y vuelve a intentarlo" onClick={() => setPanelReg(!panelReg)}><Wand2 size={13} /> Regenerar</button>}<button className="ap-btn ap-btn-sm" onClick={borrar}><Trash2 size={13} /></button></div>
    </div>
  );
}

// Postproducción a mano: ver cada corte del vídeo, cambiar el clip o mover el punto de inicio dentro del clip, y montar una versión nueva
function EditorCortes({ t, vref, onCambio }) {
  const [filas, setFilas] = useState(() => (t.cortes || []).map(c => ({ ...c, desdeNuevo: c.desde, nuevo: null })));
  const [fila, setFila] = useState(null), [err, setErr] = useState(''), [enviando, setEnviando] = useState(false);
  const cambia = (k, parche) => setFilas(fs2 => fs2.map((f, i) => (i === k ? { ...f, ...parche } : f)));
  const mod = (f) => !!f.nuevo || Number(f.desdeNuevo) !== Number(f.desde);
  const nMod = filas.filter(mod).length;
  const ir = (f) => { const v = vref?.current; if (v) { try { v.currentTime = f.ini; v.play().catch(() => {}); v.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* sin vídeo */ } } };
  const aplicar = async () => {
    setErr(''); setEnviando(true);
    try {
      const cambios = filas.filter(mod).map(f => ({ de: f.de, ...(f.nuevo ? { video: { id: f.nuevo.id, nombre: f.nuevo.nombre, tipo: f.nuevo.tipo } } : {}), desde: Number(f.desdeNuevo) || 0 }));
      await api.post('/estudio-video/trabajos/' + t.id + '/editar', { cambios }); onCambio();
    } catch (e) { setErr(e?.response?.data?.error || 'No se pudo crear la versión editada'); setEnviando(false); }
  };
  return (
    <div style={{ marginTop: 10, padding: 10, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Editar cortes</div>
      <div style={{ ...mut, marginBottom: 8 }}>Pulsa "Ver" para ir a ese momento del vídeo. Cambia el clip de un corte o mueve el segundo de inicio dentro del clip, y monta la versión nueva. La voz, la música y los subtítulos se quedan como están.</div>
      <div style={{ maxHeight: 460, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filas.map((f, k) => (
          <div key={f.de + '-' + k} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 6, borderRadius: 8, background: mod(f) ? 'rgba(242,196,109,0.10)' : 'rgba(255,255,255,0.03)', border: '1px solid ' + (mod(f) ? 'rgba(242,196,109,0.5)' : 'transparent') }}>
            {(f.nuevo?.id || f.drive_id) ? <img src={urlMiniatura(f.nuevo?.id || f.drive_id)} alt="" loading="lazy" style={{ width: 40, height: 70, objectFit: 'cover', borderRadius: 6, background: '#000', flex: 'none' }} onError={e => { e.currentTarget.style.visibility = 'hidden'; }} /> : <div style={{ width: 40, height: 70, flex: 'none' }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.78rem' }}><strong>{k + 1}</strong> · {fmtDur(Math.round(f.ini))}–{fmtDur(Math.round(f.fin))} · “{f.texto}”</div>
              <div style={{ ...mut, wordBreak: 'break-word' }}>{f.nuevo ? 'Nuevo: ' + f.nuevo.nombre : (f.nombre || 'clip')}{f.dur_clip ? ' (' + Math.round(f.dur_clip) + ' s)' : ''}</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                {!f.es_imagen && (<label style={{ ...mut, display: 'flex', alignItems: 'center', gap: 4 }}>Empieza en el s
                  <input type="number" min="0" step="0.5" value={f.desdeNuevo} onChange={e => cambia(k, { desdeNuevo: e.target.value })} className="ap-field-input" style={{ width: 70, padding: '2px 6px' }} /></label>)}
                <button type="button" className="ap-btn ap-btn-sm" onClick={() => ir(f)}><Play size={12} /> Ver</button>
                <button type="button" className="ap-btn ap-btn-sm" onClick={() => setFila(fila === k ? null : k)}><RefreshCw size={12} /> Cambiar clip</button>
                {mod(f) && <button type="button" className="ap-btn ap-btn-sm" onClick={() => cambia(k, { nuevo: null, desdeNuevo: f.desde })}><X size={12} /> Deshacer</button>}
              </div>
            </div>
          </div>
        ))}
      </div>
      {fila !== null && (
        <div style={{ marginTop: 10 }}>
          <Explorador key={fila} seleccion={[]} max={1} titulo={'Clip nuevo para el corte ' + (fila + 1)} vacio="Elegir clip o imagen de Drive" onCambio={(sel) => { if (sel[0]) { cambia(fila, { nuevo: sel[0], desdeNuevo: 0 }); setFila(null); } }} />
        </div>
      )}
      {err && <div className="ap-error" style={{ marginTop: 8 }}>{err}</div>}
      <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="ap-btn ap-btn-primary ap-btn-sm" disabled={!nMod || enviando} onClick={aplicar}><Wand2 size={13} /> {enviando ? 'Enviando…' : 'Montar versión nueva con ' + nMod + ' cambio(s)'}</button>
      </div>
    </div>
  );
}

// Pantalla completa: se abre encima de todo, con su propio vídeo para ver el resultado mientras se edita (Esc o "Cerrar" para salir)
function PantallaCompleta({ titulo, onCerrar, children }) {
  useEffect(() => { const f = (e) => { if (e.key === 'Escape') onCerrar(); }; window.addEventListener('keydown', f); const ov = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { window.removeEventListener('keydown', f); document.body.style.overflow = ov; }; }, [onCerrar]);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100000, background: '#0d0c0b', color: '#f3efe9', overflow: 'auto', padding: '14px 18px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, position: 'sticky', top: 0, background: '#0d0c0b', paddingBottom: 8, zIndex: 2 }}>
        <div style={{ fontSize: '1.15rem', fontWeight: 700, flex: 1 }}>{titulo}</div>
        <button className="ap-btn ap-btn-sm" onClick={onCerrar}><X size={14} /> Cerrar (Esc)</button>
      </div>
      {children}
    </div>
  );
}
function EditorCortesPantalla({ t, onCambio, onCerrar }) {
  const vref2 = useRef(null);
  return (
    <PantallaCompleta titulo={'Editar cortes · ' + (t.plan?.titulo || t.nombre_archivo || 'Vídeo')} onCerrar={onCerrar}>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <video ref={vref2} src={t.url_movil || t.url} controls playsInline style={{ height: '46vh', maxHeight: 520, aspectRatio: '9 / 16', borderRadius: 12, background: '#000' }} />
        <div style={{ flex: 1, minWidth: 260, ...mut }}>
          <div style={{ fontWeight: 600, color: '#f3efe9', marginBottom: 6 }}>Cómo se usa</div>
          <div>· Pulsa un bloque de la línea de tiempo para elegirlo. · Arrastra su borde derecho (amarillo) para alargarlo o acortarlo. · Mueve el vídeo o pulsa en la regla y usa <strong>Dividir</strong> para cortar un bloque. · <strong>Cambiar clip</strong> te deja elegir otro de Drive. · <strong>Intercambiar</strong> cambia dos clips de sitio. · Al acabar, <strong>Montar versión nueva</strong>.</div>
          {(t.faltan || []).length > 0 && <div style={{ marginTop: 10 }}><div style={{ fontWeight: 600, color: '#f2c46d' }}>La IA echa en falta:</div>{t.faltan.map((x, i) => <div key={i} style={{ fontSize: '0.82rem', marginTop: 3 }}>• {x.necesitas}</div>)}</div>}
        </div>
      </div>
      <LineaTiempo t={t} vref={vref2} onCambio={onCambio} grande />
    </PantallaCompleta>
  );
}
function EditorTextoPantalla({ t, onCambio, onCerrar }) {
  return (<PantallaCompleta titulo={'Editar texto · ' + (t.plan?.titulo || t.nombre_archivo || 'Vídeo')} onCerrar={onCerrar}><EditorTexto t={t} onCambio={onCambio} grande /></PantallaCompleta>);
}

// ---------- Editor de texto: se ve lo que dices, se quitan palabras o frases con un clic y el vídeo se monta de nuevo sin ellas ----------
function EditorTexto({ t, onCambio, grande = false }) {
  const pal = t.transcripcion || [];
  const propuesta = () => new Set(pal.map((w, i) => (w[3] ? i : -1)).filter(i => i >= 0));
  const [fuera, setFuera] = useState(propuesta), [ult, setUlt] = useState(null), [err, setErr] = useState(''), [enviando, setEnviando] = useState(false);
  const alterna = (i, e) => {
    setFuera(prev => {
      const s2 = new Set(prev);
      if (e.shiftKey && ult !== null) { const a = Math.min(ult, i), b = Math.max(ult, i), quitar = !prev.has(i); for (let k = a; k <= b; k++) { if (quitar) s2.add(k); else s2.delete(k); } }
      else if (s2.has(i)) s2.delete(i); else s2.add(i);
      return s2;
    });
    setUlt(i);
  };
  const quedan = pal.reduce((n, w, i) => n + (fuera.has(i) ? 0 : Math.max(0.15, w[2] - w[1])), 0);
  const cambiado = (() => { const p = propuesta(); if (p.size !== fuera.size) return true; for (const i of p) if (!fuera.has(i)) return true; return false; })();
  const muletillas = () => setFuera(prev => { const s2 = new Set(prev); pal.forEach((w, i) => { if (/^(e+h+|e+m+|m{2,}|o ?sea|bueno|pues|vale|a ver|digamos)[.,]?$/i.test(String(w[0]).trim())) s2.add(i); }); return s2; });
  const aplicar = async () => {
    setErr(''); setEnviando(true);
    try { await api.post('/estudio-video/trabajos/' + t.id + '/editar-texto', { fuera: [...fuera] }); onCambio(); }
    catch (e) { setErr(e?.response?.data?.error || 'No se pudo crear la versión'); setEnviando(false); }
  };
  return (
    <div style={{ marginTop: 10, padding: 10, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Editar texto</div>
      <div style={{ ...mut, marginBottom: 8 }}>Esto es lo que se dice. Pulsa una palabra para quitarla o ponerla (con Mayús pulsada, un tramo entero). Lo tachado en rojo no se oirá ni se verá. La IA ha propuesto lo que ves tachado; tú decides.</div>
      <div style={{ maxHeight: grande ? '58vh' : 340, overflowY: 'auto', lineHeight: grande ? 2.3 : 2, fontSize: grande ? '1.1rem' : 'inherit', padding: '6px 4px', borderRadius: 8, background: 'rgba(255,255,255,0.03)' }}>
        {pal.map((w, i) => {
          const q = fuera.has(i), pausa = i > 0 && w[1] - pal[i - 1][2] > 0.7;
          return (<span key={i}>{pausa && <span style={{ ...mut, margin: '0 3px' }}>·</span>}
            <span onClick={e => alterna(i, e)} title={w[1].toFixed(1) + ' s'} style={{ cursor: 'pointer', padding: '1px 3px', margin: '0 1px', borderRadius: 4, userSelect: 'none', textDecoration: q ? 'line-through' : 'none', color: q ? '#ef7b7b' : 'inherit', background: q ? 'rgba(239,123,123,0.12)' : 'transparent', opacity: q ? 0.8 : 1 }}>{w[0]}</span> </span>);
        })}
      </div>
      <div style={{ ...mut, marginTop: 6 }}>Quedan unos {Math.round(quedan)} s de voz · {fuera.size} palabra(s) quitada(s) de {pal.length}</div>
      {err && <div className="ap-error" style={{ marginTop: 8 }}>{err}</div>}
      <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="ap-btn ap-btn-primary ap-btn-sm" disabled={!cambiado || enviando} onClick={aplicar}><Wand2 size={13} /> {enviando ? 'Enviando…' : 'Montar de nuevo con este texto'}</button>
        <button className="ap-btn ap-btn-sm" onClick={muletillas}>Quitar muletillas (eh, mmm, o sea…)</button>
        <button className="ap-btn ap-btn-sm" onClick={() => setFuera(propuesta())}>Volver a la propuesta de la IA</button>
        <button className="ap-btn ap-btn-sm" onClick={() => setFuera(new Set())}>Dejarlo todo</button>
      </div>
    </div>
  );
}

// ---------- Línea de tiempo tipo CapCut: los cortes como bloques; se alargan/acortan arrastrando el borde, se cambian, se dividen, se eliminan o se intercambian ----------
function LineaTiempo({ t, vref, onCambio, grande = false }) {
  const cs = t.cortes || [];
  const total = Math.max(1, Number(cs[cs.length - 1]?.fin) || 1);
  const [bloques, setBloques] = useState(() => cs.map((c, k) => ({ id: k, t0: Number(c.ini) || 0, videoInt: c.video, driveId: c.drive_id, nombre: c.nombre, esImagen: !!c.es_imagen, durClip: c.dur_clip, desde: Number(c.desde) || 0, texto: c.texto || '', nuevo: null })));
  const [sel, setSel] = useState(0), [pos, setPos] = useState(0), [pps, setPps] = useState(grande ? 84 : 46), [hist, setHist] = useState([]), [err, setErr] = useState(''), [enviando, setEnviando] = useState(false), [eligiendo, setEligiendo] = useState(false), [intercambio, setIntercambio] = useState(null);
  const n = bloques.length, fin = (k) => (k < n - 1 ? bloques[k + 1].t0 : total);
  const guarda = () => setHist(h => [...h.slice(-30), bloques]);
  const deshacer = () => setHist(h => { if (!h.length) return h; setBloques(h[h.length - 1]); return h.slice(0, -1); });
  useEffect(() => { const v = vref?.current; if (!v) return undefined; const f = () => setPos(v.currentTime || 0); v.addEventListener('timeupdate', f); v.addEventListener('seeked', f); return () => { v.removeEventListener('timeupdate', f); v.removeEventListener('seeked', f); }; }, [vref]);
  const ir = (seg) => { const v = vref?.current; if (v) { try { v.currentTime = seg; setPos(seg); } catch { /* sin vídeo */ } } };
  const arrastra = useRef(null);
  const iniciaBorde = (k, e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); guarda(); arrastra.current = { k, x0: e.clientX, b0: bloques[k + 1].t0 }; };
  const muevelBorde = (e) => { const a = arrastra.current; if (!a) return; const k = a.k, minB = bloques[k].t0 + 0.6, maxB = (k + 2 < n ? bloques[k + 2].t0 : total) - 0.6; const nb = Math.max(minB, Math.min(maxB, a.b0 + (e.clientX - a.x0) / pps)); setBloques(bs => bs.map((b, i) => (i === k + 1 ? { ...b, t0: Math.round(nb * 20) / 20 } : b))); };
  const sueltaBorde = () => { arrastra.current = null; };
  const clicBloque = (k) => {
    if (intercambio !== null && intercambio !== k) { guarda(); const A = intercambio, B = k; setBloques(bs => bs.map((b, i) => { const o = i === A ? bs[B] : i === B ? bs[A] : null; return o ? { ...b, videoInt: o.videoInt, driveId: o.driveId, nombre: o.nombre, esImagen: o.esImagen, durClip: o.durClip, desde: o.desde, nuevo: o.nuevo } : b; })); setIntercambio(null); setSel(k); return; }
    setSel(k); ir(bloques[k].t0);
  };
  const b = bloques[sel];
  const divide = () => { if (!b) return; const p = pos; if (p - b.t0 < 0.6 || fin(sel) - p < 0.6) { setErr('Pon el cursor dentro del bloque, a más de 0,6 s de los bordes (pulsa en la regla o mueve el vídeo).'); return; } setErr(''); guarda(); setBloques(bs => { const nuevo = { ...b, id: Date.now(), t0: Math.round(p * 20) / 20, desde: Math.round(((b.esImagen ? 0 : b.desde + (p - b.t0))) * 10) / 10 }; return [...bs.slice(0, sel + 1), nuevo, ...bs.slice(sel + 1)]; }); };
  const elimina = () => { if (n <= 1) return; guarda(); setBloques(bs => { const r = bs.filter((_, i) => i !== sel); if (sel === 0 && r.length) r[0] = { ...r[0], t0: 0 }; return r; }); setSel(Math.max(0, sel - 1)); };
  const cambiaDesde = (v) => setBloques(bs => bs.map((x, i) => (i === sel ? { ...x, desde: Math.max(0, Number(v) || 0) } : x)));
  const aplicar = async () => {
    setErr(''); setEnviando(true);
    try {
      const cortes = bloques.map(x => ({ t0: x.t0, desde: x.desde, ...(x.nuevo ? { video: { id: x.nuevo.id, nombre: x.nuevo.nombre, tipo: x.nuevo.tipo } } : { video_int: x.videoInt }) }));
      await api.post('/estudio-video/trabajos/' + t.id + '/editar', { cortes }); onCambio();
    } catch (e) { setErr(e?.response?.data?.error || 'No se pudo crear la versión editada'); setEnviando(false); }
  };
  const W = Math.ceil(total * pps) + 40, marcas = []; const paso = pps >= 60 ? 1 : pps >= 30 ? 2 : 5; for (let s2 = 0; s2 <= total; s2 += paso) marcas.push(s2);
  const hayCambios = hist.length > 0;
  return (
    <div style={{ marginTop: 10, padding: 10, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <div style={{ fontWeight: 600, flex: 1 }}>Línea de tiempo</div>
        <label style={{ ...mut, display: 'flex', alignItems: 'center', gap: 6 }}>Zoom<input type="range" min="20" max="220" value={pps} onChange={e => setPps(Number(e.target.value))} /></label>
        <button className="ap-btn ap-btn-sm" disabled={!hist.length} onClick={deshacer}>Deshacer</button>
      </div>
      <div style={{ ...mut, marginBottom: 8 }}>Pulsa un bloque para elegirlo. Arrastra el borde derecho de un bloque para alargarlo o acortarlo. La línea roja es el vídeo: pulsa en la regla o reproduce para moverla, y "Dividir" corta el bloque en ese punto.</div>
      <div style={{ overflowX: 'auto', paddingBottom: 6 }}>
        <div style={{ position: 'relative', width: W, height: grande ? 190 : 130, userSelect: 'none' }}>
          <div onClick={e => { const r = e.currentTarget.getBoundingClientRect(); ir(Math.max(0, Math.min(total, (e.clientX - r.left) / pps))); }} style={{ position: 'absolute', left: 0, top: 0, width: W, height: 22, cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.15)' }}>
            {marcas.map(m => <div key={m} style={{ position: 'absolute', left: m * pps, top: 0, height: 22, borderLeft: '1px solid rgba(255,255,255,0.25)', paddingLeft: 3, fontSize: 10, color: 'rgba(255,255,255,0.55)' }}>{fmtDur(Math.round(m))}</div>)}
          </div>
          {bloques.map((x, k) => {
            const w = Math.max(10, (fin(k) - x.t0) * pps - 2), activo = k === sel, id = x.nuevo?.id || x.driveId;
            return (
              <div key={x.id} onClick={() => clicBloque(k)} style={{ position: 'absolute', left: x.t0 * pps, top: 28, width: w, height: grande ? 150 : 92, borderRadius: 8, overflow: 'hidden', cursor: 'pointer', background: '#1d1b19', border: '2px solid ' + (activo ? '#f2c46d' : intercambio === k ? '#7ccf8f' : 'rgba(255,255,255,0.18)'), boxSizing: 'border-box' }}>
                {id && <img src={urlMiniatura(id)} alt="" loading="lazy" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.55 }} onError={e => { e.currentTarget.style.visibility = 'hidden'; }} />}
                <div style={{ position: 'relative', padding: '3px 5px', fontSize: 10, lineHeight: 1.25, textShadow: '0 1px 2px #000' }}><strong>{k + 1}</strong>{w > 70 ? ' · ' + (x.nuevo ? x.nuevo.nombre : x.nombre || 'clip') : ''}{w > 110 && <div style={{ opacity: 0.85 }}>{(fin(k) - x.t0).toFixed(1)} s</div>}</div>
                {k < n - 1 && <div onPointerDown={e => iniciaBorde(k, e)} onPointerMove={muevelBorde} onPointerUp={sueltaBorde} onClick={e => e.stopPropagation()} title="Arrastra para alargar o acortar" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 9, cursor: 'col-resize', background: 'rgba(242,196,109,0.7)' }} />}
              </div>
            );
          })}
          <div style={{ position: 'absolute', left: pos * pps, top: 0, bottom: 0, width: 2, background: '#ef4444', pointerEvents: 'none' }} />
        </div>
      </div>
      {b && (
        <div style={{ marginTop: 8, padding: 8, borderRadius: 8, background: 'rgba(255,255,255,0.04)' }}>
          <div style={{ fontSize: '0.8rem' }}><strong>Corte {sel + 1}</strong> · {fmtDur(Math.round(b.t0))}–{fmtDur(Math.round(fin(sel)))} · “{b.texto}”</div>
          <div style={{ ...mut, marginTop: 2 }}>{b.nuevo ? 'Clip nuevo: ' + b.nuevo.nombre : (b.nombre || 'clip')}{b.durClip ? ' (' + Math.round(b.durClip) + ' s)' : ''}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
            {!b.esImagen && <label style={{ ...mut, display: 'flex', alignItems: 'center', gap: 4 }}>Empieza en el s<input type="number" min="0" step="0.5" value={b.desde} onChange={e => cambiaDesde(e.target.value)} className="ap-field-input" style={{ width: 70, padding: '2px 6px' }} /></label>}
            <button className="ap-btn ap-btn-sm" onClick={() => setEligiendo(!eligiendo)}><RefreshCw size={12} /> Cambiar clip</button>
            <button className="ap-btn ap-btn-sm" onClick={divide}><Scissors size={12} /> Dividir en la línea roja</button>
            <button className="ap-btn ap-btn-sm" onClick={() => setIntercambio(intercambio === sel ? null : sel)}>{intercambio === sel ? 'Elige el otro bloque…' : 'Intercambiar con otro'}</button>
            <button className="ap-btn ap-btn-sm" disabled={n <= 1} onClick={elimina}><X size={12} /> Eliminar corte</button>
          </div>
          {eligiendo && <div style={{ marginTop: 8 }}><Explorador key={sel} seleccion={[]} max={1} titulo={'Clip nuevo para el corte ' + (sel + 1)} vacio="Elegir clip o imagen de Drive" onCambio={(s3) => { if (s3[0]) { guarda(); setBloques(bs => bs.map((x, i) => (i === sel ? { ...x, nuevo: s3[0], desde: 0, esImagen: s3[0].tipo === 'imagen' } : x))); setEligiendo(false); } }} /></div>}
        </div>
      )}
      {err && <div className="ap-error" style={{ marginTop: 8 }}>{err}</div>}
      <div style={{ marginTop: 10 }}>
        <button className="ap-btn ap-btn-primary ap-btn-sm" disabled={!hayCambios || enviando} onClick={aplicar}><Wand2 size={13} /> {enviando ? 'Enviando…' : 'Montar versión nueva'}</button>
      </div>
    </div>
  );
}

function PestanaMusica({ pistas, onCambio }) {
  const [prog, setProg] = useState(null), [error, setError] = useState('');
  const subir = async (files) => { setError(''); try { for (const f of Array.from(files)) { setProg(f.name + ' 0%'); await subirArchivo(f, p => setProg(f.name + ' ' + p + '%'), 'musica'); } setProg(null); onCambio(); } catch (e) { setError(e?.response?.data?.error || e.message || 'No se pudo subir'); setProg(null); } };
  const borrar = async (n) => { if (!window.confirm('¿Quitar "' + n + '" de la biblioteca?')) return; try { await api.delete('/estudio-video/musica/' + encodeURIComponent(n)); onCambio(); } catch { setError('No se pudo borrar'); } };
  return (
    <div style={card}>
      <div style={{ ...mut, marginBottom: 10 }}>Canciones instrumentales para el fondo de los vídeos. Suenan siempre por debajo de la voz y los cambios de escena se sincronizan con sus pulsos. Sube mp3, mp4, m4a o wav. El tempo (bpm) se calcula al montar el primer vídeo.</div>
      <input type="file" multiple accept="audio/*,video/mp4" disabled={prog !== null} onChange={e => e.target.files?.length && subir(e.target.files)} className="ap-field-input" style={{ width: '100%', marginBottom: 10 }} />
      {prog && <div style={mut}><Loader2 size={12} /> Subiendo {prog}</div>}{error && <div className="ap-error">{error}</div>}
      {pistas.length === 0 ? <div style={mut}>Todavía no hay música. Sube las canciones.</div> : pistas.map(p => (
        <div key={p.nombre} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <Music size={14} /><div style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{p.nombre}<div style={mut}>{p.bpm ? Math.round(p.bpm) + ' bpm · ' + Math.round(p.dur || 0) + ' s' : 'pendiente de analizar'}</div></div>
          <button className="ap-btn ap-btn-sm" onClick={() => borrar(p.nombre)}><Trash2 size={13} /></button>
        </div>
      ))}
    </div>
  );
}

function Campo({ etiqueta, children }) { return <label style={{ display: 'block', marginBottom: 8 }}><div style={{ ...mut, marginBottom: 3 }}>{etiqueta}</div>{children}</label>; }

// Voz y reglas de marca: la IA las aplica a todos los vídeos (qué decir, cómo, qué evitar)
function CajaReglas() {
  const [texto, setTexto] = useState(null), [base, setBase] = useState(''), [msg, setMsg] = useState(''), [abierto, setAbierto] = useState(false);
  useEffect(() => { api.get('/estudio-video/reglas').then(r => { setTexto(r.data.texto); setBase(r.data.base); }).catch(() => setTexto('')); }, []);
  if (texto === null) return null;
  const guardar = async () => { try { await api.put('/estudio-video/reglas', { texto }); setMsg('Guardado: se aplicará a los vídeos nuevos'); setTimeout(() => setMsg(''), 2500); } catch { setMsg('No se pudo guardar'); } };
  return (
    <div style={{ marginBottom: 14, padding: 10, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontWeight: 600, flex: 1 }}>Voz y reglas de marca (para todos los vídeos)</div>
        <button className="ap-btn ap-btn-sm" onClick={() => setAbierto(!abierto)}>{abierto ? 'Cerrar' : 'Ver y editar'}</button>
      </div>
      <div style={{ ...mut, marginTop: 4 }}>Cómo habla Ranuse, qué quiere transmitir y qué evitar. La IA lo tiene en cuenta al elegir y titular. Añade tus propias normas.</div>
      {abierto && (<>
        <textarea className="ap-field-input" style={{ width: '100%', minHeight: 190, marginTop: 8 }} value={texto} onChange={e => setTexto(e.target.value)} />
        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="ap-btn ap-btn-primary ap-btn-sm" onClick={guardar}>Guardar reglas</button>
          <button className="ap-btn ap-btn-sm" onClick={() => setTexto(base)}>Volver a las reglas por defecto</button>
          {msg && <span style={mut}>{msg}</span>}
        </div>
      </>)}
    </div>
  );
}

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
      <CajaReglas />
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
        <Campo etiqueta="Estilo de subtítulos"><select className="ap-field-input" style={{ width: '100%' }} value={r.estiloSubs || 'normal'} onChange={e => setR('estiloSubs', e.target.value)}><option value="normal">Normal (aparecen por frases)</option><option value="karaoke">Karaoke (se resalta la palabra que suena)</option></select></Campo>
        <Campo etiqueta="Tipografía de subtítulos"><select className="ap-field-input" style={{ width: '100%' }} value={r.fuente || 'Montserrat'} onChange={e => setR('fuente', e.target.value)}><option>Montserrat</option><option>Rubik</option></select></Campo>
        <Campo etiqueta="Volumen música (dB, -19 típico)">{num(r.musica?.volumen ?? -19, v => setR('musica', { volumen: v }))}</Campo>
        <Campo etiqueta="Zoom de encuadre (1 = sin)">{num(r.encuadreZoom, v => setR('encuadreZoom', v))}</Campo>
        <Campo etiqueta="Pausa que se corta (s)">{num(r.pausa, v => setR('pausa', v))}</Campo>
        <Campo etiqueta="Color de acento"><input type="color" value={r.acento || '#F2C46D'} onChange={e => setR('acento', e.target.value)} style={{ width: '100%', height: 34, background: 'none', border: 'none' }} /></Campo>
      </div>
      <div style={{ display: 'flex', gap: 16, margin: '4px 0 12px', flexWrap: 'wrap', fontSize: '0.85rem' }}>
        <label><input type="checkbox" checked={!!r.flash} onChange={e => setR('flash', e.target.checked)} /> Destello en cada corte</label>
        <label><input type="checkbox" checked={r.titulo !== false} onChange={e => setR('titulo', e.target.checked)} /> Título arriba</label>
        <label><input type="checkbox" checked={r.barra !== false} onChange={e => setR('barra', e.target.checked)} /> Barra de progreso</label>
        <label><input type="checkbox" checked={r.mayusculas !== false} onChange={e => setR('mayusculas', e.target.checked)} /> Subtítulos en mayúsculas</label>
        <label><input type="checkbox" checked={r.resaltar !== false} onChange={e => setR('resaltar', e.target.checked)} /> Resaltar palabras clave</label>
        <label><input type="checkbox" checked={!!r.encuadre} onChange={e => setR('encuadre', e.target.checked)} /> Centrar en la cara</label>
        <label><input type="checkbox" checked={!!r.subsBajoCara} onChange={e => setR('subsBajoCara', e.target.checked)} /> Subtítulos bajo la cara</label>
        <label><input type="checkbox" checked={!!r.graficos} onChange={e => setR('graficos', e.target.checked)} /> Gráficos animados (cifras)</label>
        <label><input type="checkbox" checked={!!r.horas} onChange={e => setR('horas', e.target.checked)} /> Etiquetas de hora (9:00…)</label>
        <label><input type="checkbox" checked={!!r.preguntaSoloEscrita} onChange={e => setR('preguntaSoloEscrita', e.target.checked)} /> Entrevistas: la pregunta solo sale escrita (no se oye al entrevistador)</label>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><button className="ap-btn ap-btn-primary ap-btn-sm" onClick={guardar}><Check size={13} /> Guardar formato</button><span style={mut}>{msg}</span></div>
    </div>
  );
}

export function SectionEstudioVideo() {
  const [tab, setTab] = useState('videos'), [carpetas, setCarpetas] = useState([]), [pistas, setPistas] = useState([]), [formatos, setFormatos] = useState([]), [trabajos, setTrabajos] = useState(null), [error, setError] = useState('');
  const cargarF = useCallback(() => api.get('/estudio-video/formatos').then(r => setFormatos(r.data.formatos || [])).catch(() => setError('No se han podido cargar los formatos')), []);
  const cargarT = useCallback(() => api.get('/estudio-video/trabajos').then(r => setTrabajos(r.data.trabajos || [])).catch(() => setTrabajos(t => t || [])), []);
  const cargarM = useCallback(() => api.get('/estudio-video/musica').then(r => setPistas(r.data.pistas || [])).catch(() => {}), []);
  useEffect(() => { cargarF(); cargarT(); cargarM(); api.get('/estudio-video/carpetas').then(r => setCarpetas(r.data.carpetas || [])).catch(() => {}); }, [cargarF, cargarT, cargarM]);
  const hayActivos = (trabajos || []).some(t => t.estado === 'pendiente' || t.estado === 'procesando');
  useEffect(() => { if (!hayActivos) return; const i = setInterval(cargarT, 3000); return () => clearInterval(i); }, [hayActivos, cargarT]);
  return (
    <div className="ev-root" style={{ maxWidth: 820 }}>
      <style>{ESTILO_SELECT}</style>
      <h1 className="ap-page-title" style={{ marginBottom: 6 }}>Estudio de vídeo</h1>
      <p style={{ ...mut, marginBottom: 16 }}>Sube una voz en off (audio o vídeo) o un vídeo en bruto, elige un formato y la IA lo edita con las escenas de la biblioteca. Cada formato guarda el estilo para que todos los vídeos salgan igual. Si no te gusta algo, pide cambios sobre el propio vídeo.</p>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        <button className={'ap-btn ap-btn-sm' + (tab === 'videos' ? ' ap-btn-primary' : '')} onClick={() => setTab('videos')}><Film size={13} /> Vídeos</button>
        <button className={'ap-btn ap-btn-sm' + (tab === 'formatos' ? ' ap-btn-primary' : '')} onClick={() => setTab('formatos')}><Settings2 size={13} /> Formatos</button>
        <button className={'ap-btn ap-btn-sm' + (tab === 'musica' ? ' ap-btn-primary' : '')} onClick={() => setTab('musica')}><Music size={13} /> Música</button>
      </div>
      {error && <div className="ap-error" style={{ marginBottom: 10 }}>{error}</div>}
      {tab === 'formatos' ? <Formatos formatos={formatos} onCambio={cargarF} /> : tab === 'musica' ? <PestanaMusica pistas={pistas} onCambio={cargarM} /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Nuevo formatos={formatos} musica={pistas} carpetas={carpetas} onCreado={cargarT} />
          {trabajos === null ? <div className="ap-loading">Cargando…</div> : trabajos.length === 0 ? <div style={mut}>Todavía no hay vídeos. Sube el primero arriba.</div> : trabajos.map(t => <Trabajo key={t.id} t={t} formatos={formatos} onCambio={cargarT} />)}
        </div>
      )}
    </div>
  );
}
