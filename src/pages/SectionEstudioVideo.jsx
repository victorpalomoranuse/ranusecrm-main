import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import { Film, Upload, Mic, Video, Trash2, RefreshCw, Download, Plus, Check, Wand2, Settings2, Loader2, Music, Folder, ArrowLeft, Image as ImagenIcono, Play, X } from 'lucide-react';

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
  const [origen, setOrigen] = useState('dispositivo'), [base, setBase] = useState([]), [recursos, setRecursos] = useState([]), [mus, setMus] = useState('auto'), [tipo, setTipo] = useState('voz'), [fmt, setFmt] = useState(''), [file, setFile] = useState(null), [notas, setNotas] = useState(''), [prog, setProg] = useState(null), [error, setError] = useState('');
  const inp = useRef(null);
  useEffect(() => { if (!fmt && formatos[0]) setFmt(formatos[0].id); }, [formatos, fmt]);
  const enviar = async () => {
    const dDrive = tipo === 'base' || origen === 'drive';
    if ((dDrive ? !base.length : !file) || !fmt) return; setError(''); setProg(0);
    try {
      if (dDrive) await api.post('/estudio-video/trabajos', { tipo, formato: fmt, base: base[0], nombre_archivo: base[0].nombre, indicaciones: notas, musica: mus, recursos });
      else { const ruta = await subirArchivo(file, setProg); await api.post('/estudio-video/trabajos', { tipo, formato: fmt, archivo: ruta, nombre_archivo: file.name, indicaciones: notas, musica: mus, recursos }); }
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
        {opcion('base', Film, 'Vídeo de Drive como base', 'Eliges un vídeo de Drive y la IA superpone clips e imágenes del resto en los momentos clave.')}
      </div>
      {tipo !== 'base' && (<>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <button type="button" className={'ap-btn ap-btn-sm' + (origen === 'dispositivo' ? ' ap-btn-primary' : '')} onClick={() => setOrigen('dispositivo')}><Upload size={12} /> Desde el dispositivo</button>
        <button type="button" className={'ap-btn ap-btn-sm' + (origen === 'drive' ? ' ap-btn-primary' : '')} onClick={() => setOrigen('drive')}><Folder size={12} /> Desde Drive</button>
      </div>
      {origen === 'drive' && <Explorador seleccion={base} onCambio={setBase} max={1} titulo={tipo === 'voz' ? 'Audio o vídeo con la voz (de Drive)' : 'Vídeo en bruto (de Drive)'} vacio="Elegir archivo de Drive" />}
      {origen !== 'drive' && (<>
      <label style={{ ...mut, display: 'block', marginBottom: 4 }}>{tipo === 'voz' ? 'Audio o vídeo con la voz' : 'Vídeo en bruto'}</label>
      <input ref={inp} type="file" accept={tipo === 'voz' ? 'audio/*,video/*' : 'video/*'} onChange={e => setFile(e.target.files?.[0] || null)} className="ap-field-input" style={{ width: '100%', marginBottom: 10 }} />
      </>)}
      </>)}
      <label style={{ ...mut, display: 'block', marginBottom: 4 }}>Formato</label>
      <select className="ap-field-input" style={{ width: '100%', marginBottom: 10 }} value={fmt} onChange={e => setFmt(e.target.value)}>{formatos.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}</select>
      {formatos.find(f => f.id === fmt)?.descripcion && <div style={{ ...mut, marginTop: -4, marginBottom: 10 }}>{formatos.find(f => f.id === fmt).descripcion}</div>}
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
  const [cambios, setCambios] = useState(''), [abierto, setAbierto] = useState(false), [fmt, setFmt] = useState(t.formato), [err, setErr] = useState(''), [panelReg, setPanelReg] = useState(false), [recs, setRecs] = useState(selInicial(t)), [baseSel, setBaseSel] = useState(t.base?.id ? [{ id: t.base.id, nombre: t.base.nombre, tipo: 'video', ruta: t.base.ruta || '' }] : []);
  const [txt, color] = ESTADOS[t.estado] || ESTADOS.pendiente;
  const regenerar = async () => { try { await api.post('/estudio-video/trabajos/' + t.id + '/rehacer', { formato: t.formato, recursos: recs, ...(baseSel[0] ? { base: baseSel[0] } : {}) }); setPanelReg(false); onCambio(); } catch (e) { setErr(e?.response?.data?.error || 'No se pudo'); } };
  const rehacer = async () => { if (!cambios.trim()) return; try { await api.post('/estudio-video/trabajos/' + t.id + '/rehacer', { indicaciones: cambios, formato: fmt }); setCambios(''); setAbierto(false); onCambio(); } catch (e) { setErr(e?.response?.data?.error || 'No se pudo'); } };
  const borrar = async () => { if (!window.confirm('¿Borrar este vídeo?')) return; try { await api.delete('/estudio-video/trabajos/' + t.id); onCambio(); } catch { setErr('No se pudo borrar'); } };
  return (
    <div style={card}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Film size={15} /><div style={{ fontWeight: 600, flex: 1, minWidth: 140, wordBreak: 'break-word' }}>{t.plan?.titulo || t.nombre_archivo || 'Vídeo'}{t.version > 1 ? ' · v' + t.version : ''}</div>
        <span style={{ fontSize: '0.72rem', color, border: '1px solid ' + color, borderRadius: 20, padding: '1px 9px' }}>{txt}</span>
      </div>
      <div style={{ ...mut, marginTop: 4 }}>{t.formato_nombre} · {t.tipo === 'voz' ? 'voz en off' : t.tipo === 'base' ? 'base de Drive' : 'bruto'} · {fmtFecha(t.creado)}{t.por ? ' · ' + t.por : ''}</div>
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
          <video src={t.url_movil || t.url} controls playsInline style={{ width: '100%', maxWidth: 300, borderRadius: 10, background: '#000', display: 'block' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <a className="ap-btn ap-btn-sm" href={t.url} download target="_blank" rel="noreferrer"><Download size={13} /> Descargar</a>
            <button className="ap-btn ap-btn-sm" title="Elige qué recursos usar y vuelve a montarlo" onClick={() => setPanelReg(!panelReg)}><Wand2 size={13} /> Regenerar</button>
            <button className="ap-btn ap-btn-sm" onClick={() => setAbierto(!abierto)}><RefreshCw size={13} /> Pedir cambios</button>
          </div>
        </div>
      )}
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
