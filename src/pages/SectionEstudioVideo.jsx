import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import api from '../services/api';
import { Film, Upload, Mic, Video, Trash2, RefreshCw, Download, Plus, Check, Wand2, Settings2, Loader2, Music, Folder, ArrowLeft, Image as ImagenIcono, Play, X, Scissors } from 'lucide-react';

const card = { background: 'linear-gradient(160deg,rgba(255,255,255,.055),rgba(255,255,255,.02))', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 18, padding: '1.2rem 1.3rem' };
const mut = { color: 'rgba(255,255,255,0.45)', fontSize: '0.78rem' };
const ESTILO_REDES = `
.rd-wrap{padding:28px 40px 70px;max-width:1360px;margin:0 auto;box-sizing:border-box;width:100%}
.rd-head{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;flex-wrap:wrap;margin-bottom:22px}
.rd-title{font-size:2rem;font-weight:800;letter-spacing:-.025em;margin:0;line-height:1.1}
.rd-sub{color:rgba(255,255,255,.5);font-size:.92rem;margin-top:6px}
.rd-tabs{display:inline-flex;gap:4px;padding:4px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:14px;flex-wrap:wrap}
.rd-tab{display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border-radius:10px;border:0;background:transparent;color:rgba(255,255,255,.62);font-weight:600;font-size:.9rem;cursor:pointer;font-family:inherit;transition:background .15s,color .15s}
.rd-tab:hover{color:#fff;background:rgba(255,255,255,.07)}
.rd-tab.on{background:#e3d2b8;color:#161513}
.rd-grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(310px,1fr))}
.rd-grid2{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(340px,1fr))}
.rd-card{background:linear-gradient(160deg,rgba(255,255,255,.055),rgba(255,255,255,.02));border:1px solid rgba(255,255,255,.09);border-radius:18px;padding:20px;display:flex;flex-direction:column;gap:12px;min-width:0;box-sizing:border-box}
.rd-card h3{margin:0;font-size:1.02rem;font-weight:700}
.rd-kpis{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:18px}
.rd-kpi{background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:16px 18px}
.rd-kpi b{display:block;font-size:2rem;font-weight:800;letter-spacing:-.02em;line-height:1.1}
.rd-kpi span{color:rgba(255,255,255,.5);font-size:.8rem}
.rd-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;background:rgba(255,255,255,.08);font-size:.74rem;color:rgba(255,255,255,.75);white-space:nowrap}
.rd-chip.verde{background:rgba(124,207,143,.16);color:#8fdba0}.rd-chip.ambar{background:rgba(242,196,109,.16);color:#f2c46d}.rd-chip.rojo{background:rgba(239,123,123,.16);color:#f29a9a}.rd-chip.arena{background:rgba(227,210,184,.16);color:#e3d2b8}
.rd-gancho{font-size:1.12rem;font-weight:700;line-height:1.35;letter-spacing:-.01em}
.rd-btn{display:inline-flex;align-items:center;gap:7px;padding:8px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#fff;font-weight:600;font-size:.84rem;cursor:pointer;font-family:inherit}
.rd-btn:hover:not(:disabled){background:rgba(255,255,255,.12)}.rd-btn:disabled{opacity:.45;cursor:not-allowed}
.rd-btn.pri{background:#e3d2b8;color:#161513;border-color:#e3d2b8}.rd-btn.pri:hover:not(:disabled){background:#f0e3cf}
.rd-days{display:flex;gap:10px;overflow-x:auto;padding-bottom:6px;margin-bottom:6px}
.rd-day{flex:0 0 118px;border-radius:14px;padding:11px 12px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.08)}
.rd-day.hoy{border-color:#e3d2b8;background:rgba(227,210,184,.1)}.rd-day.vacio{opacity:.45}
.rd-day .n{font-size:1.35rem;font-weight:800;line-height:1}.rd-day .d{font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.5)}
.rd-day .t{font-size:.74rem;line-height:1.3;margin-top:6px;color:rgba(255,255,255,.82);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.rd-post{position:relative;border-radius:14px;overflow:hidden;background:#1b1a18;border:1px solid rgba(255,255,255,.09);aspect-ratio:4/5;display:flex;align-items:flex-end}
.rd-post img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.rd-post .vel{position:relative;width:100%;padding:34px 10px 10px;background:linear-gradient(transparent,rgba(0,0,0,.88));font-size:.76rem;line-height:1.3}
.rd-post .pt{position:absolute;top:8px;left:8px;background:#e3d2b8;color:#161513;font-weight:800;font-size:.8rem;padding:3px 9px;border-radius:999px}
.rd-bar{display:flex;align-items:center;gap:10px;font-size:.82rem;margin:5px 0}.rd-bar i{display:block;height:9px;border-radius:5px;background:linear-gradient(90deg,#b9a98f,#e3d2b8)}
.rd-lista{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:7px;font-size:.88rem;line-height:1.4}
.rd-lista li{padding-left:16px;position:relative}.rd-lista li:before{content:'';position:absolute;left:0;top:.55em;width:7px;height:7px;border-radius:50%;background:var(--pt,#e3d2b8)}
.ev-root .ap-btn{background:rgba(255,255,255,.07);color:#fff;border:1px solid rgba(255,255,255,.14);border-radius:10px;font-weight:600;font-family:inherit}
.ev-root .ap-btn:hover:not(:disabled){background:rgba(255,255,255,.13)}
.ev-root .ap-btn-primary{background:#e3d2b8;color:#161513;border-color:#e3d2b8}.ev-root .ap-btn-primary:hover:not(:disabled){background:#f0e3cf}
.ev-root .ap-field-input{border-radius:12px;padding:11px 14px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);color:#fff;font-family:inherit;box-sizing:border-box}
.ev-root .ap-field-input:focus{outline:none;border-color:#e3d2b8}
.rd-tipos{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));margin-bottom:16px}
.rd-tipo{cursor:pointer;padding:16px;border-radius:16px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);transition:border-color .15s,background .15s,transform .15s}
.rd-tipo:hover{border-color:rgba(227,210,184,.5);transform:translateY(-1px)}
.rd-tipo.on{border-color:#e3d2b8;background:rgba(227,210,184,.1);box-shadow:0 0 0 1px rgba(227,210,184,.25)}
.rd-tipo .ico{width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.08);margin-bottom:10px}.rd-tipo.on .ico{background:#e3d2b8;color:#161513}
.rd-tipo .tt{font-weight:700;font-size:.98rem}.rd-tipo .ss{color:rgba(255,255,255,.52);font-size:.8rem;line-height:1.4;margin-top:4px}
.rd-seg{display:inline-flex;padding:3px;border-radius:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.09);margin-bottom:12px}
.rd-seg button{display:inline-flex;align-items:center;gap:7px;padding:8px 16px;border:0;border-radius:9px;background:transparent;color:rgba(255,255,255,.65);font-weight:600;font-size:.86rem;cursor:pointer;font-family:inherit}.rd-seg button.on{background:#e3d2b8;color:#161513}
.rd-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:30px 16px;border:2px dashed rgba(255,255,255,.18);border-radius:16px;cursor:pointer;text-align:center;background:rgba(255,255,255,.025);margin-bottom:14px;transition:border-color .15s,background .15s}
.rd-drop:hover{border-color:#e3d2b8;background:rgba(227,210,184,.06)}.rd-drop b{font-size:1rem;word-break:break-word}
.rd-more{border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:2px 16px;margin:12px 0;background:rgba(255,255,255,.02)}.rd-more>summary{cursor:pointer;padding:12px 0;font-weight:600;font-size:.92rem}
.rd-form2{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
@media(max-width:700px){.rd-wrap{padding:18px 14px 60px}}
`;
const ESTILO_SELECT = '.ev-root select option { background:#1a1a1a; color:#fff; } .ev-root select { color-scheme: dark; }';
const ESTADOS = { pendiente: ['En cola', '#bba'], procesando: ['Montando…', '#f2c46d'], listo: ['Listo', '#7ccf8f'], error: ['Error', '#ef7b7b'] };
const fmtFecha = (iso) => { try { return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }); } catch { return ''; } };

// Subida por TROZOS con reintentos y reanudación: un vídeo de varios GB no se pierde si se corta la conexión (se retoma desde donde llegó)
const TROZO_SUBIDA = 16 * 1024 * 1024; // múltiplo de 256 KiB, como exige la nube
const espera = (ms) => new Promise(r => setTimeout(r, ms));
function putTrozo(url, cuerpo, rango, onBytes) {
  return new Promise((ok, ko) => {
    const x = new XMLHttpRequest(); x.open('PUT', url); x.setRequestHeader('Content-Range', rango);
    if (onBytes) x.upload.onprogress = (e) => { if (e.lengthComputable) onBytes(e.loaded); };
    x.onload = () => ok({ status: x.status, range: x.getResponseHeader('Range') });
    x.onerror = () => ko(new Error('Sin conexión durante la subida')); x.ontimeout = () => ko(new Error('La subida tardó demasiado')); x.timeout = 10 * 60 * 1000;
    x.send(cuerpo);
  });
}
async function subirATrozos(file, url, onProgreso, onAviso) {
  const total = file.size; let pos = 0, fallos = 0;
  if (!total) throw new Error('El archivo está vacío');
  const consulta = async () => { const r = await putTrozo(url, null, 'bytes */' + total); if (r.status === 200 || r.status === 201) return total; if (r.status === 308) return r.range ? parseInt(r.range.split('-')[1], 10) + 1 : 0; throw new Error('La nube respondió ' + r.status); };
  while (pos < total) {
    const fin = Math.min(pos + TROZO_SUBIDA, total), ini = pos;
    try {
      const r = await putTrozo(url, file.slice(ini, fin), 'bytes ' + ini + '-' + (fin - 1) + '/' + total, (b) => onProgreso(Math.min(99, Math.round((ini + b) / total * 100))));
      if (r.status === 200 || r.status === 201) { pos = total; }
      else if (r.status === 308) { pos = r.range ? parseInt(r.range.split('-')[1], 10) + 1 : fin; }
      else if (r.status >= 500 || r.status === 429 || r.status === 408) throw new Error('La nube respondió ' + r.status);
      else throw Object.assign(new Error('La subida falló (' + r.status + ')'), { fatal: true });
      fallos = 0; onAviso && onAviso('');
    } catch (e) {
      if (e.fatal || ++fallos > 12) throw e;
      onAviso && onAviso('Conexión inestable: reintentando la subida (' + fallos + '/12)…');
      await espera(Math.min(30000, 1500 * 2 ** (fallos - 1)));
      try { pos = await consulta(); } catch { /* se reintenta el mismo trozo */ }
    }
  }
  onProgreso(100);
}
async function subirArchivo(file, onProgreso, tipo, onAviso) {
  const { data } = await api.post('/estudio-video/subida', { nombre: file.name, tipo });
  if (data.gcs) { await subirATrozos(file, data.url, onProgreso, onAviso); return data.ruta; }
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
  const alterna = (it) => { const nuevo = { id: it.id, nombre: it.nombre, tipo: it.tipo, duracion: it.duracion || null, ruta: it.tipo === 'carpeta' ? rutaTexto(it.nombre) : rutaTexto() }; onCambio(esta(it.id) ? seleccion.filter(s => s.id !== it.id) : max === 1 ? [nuevo] : [...seleccion, nuevo]); };
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

// Estilos de edición (cómo se ve y se mueve un vídeo): se eligen aparte del formato
function useEstilos() {
  const [estilos, setEstilos] = useState([]);
  const recarga = useCallback(() => api.get('/estudio-video/estilos').then(r => setEstilos(r.data.estilos || [])).catch(() => {}), []);
  useEffect(() => { recarga(); }, [recarga]);
  return [estilos, recarga];
}
function SelectorEstilo({ estilos, formato, valor, onCambio, etiqueta = 'Estilo de edición (cómo se ve y se mueve)' }) {
  const e0 = estilos.find(x => x.id === (formato?.estilo || formato?.id));
  return (
    <label style={{ ...mut, display: 'block', marginBottom: 10 }}>{etiqueta}
      <select className="ap-field-input" style={{ width: '100%', marginTop: 4 }} value={valor} onChange={e => onCambio(e.target.value)}>
        <option value="">{formato?.id === 'auto-redes' ? '🤖 Lo decide la IA de redes (recomendado)' : 'El del formato' + (e0 ? ' (' + e0.nombre + ')' : '')}</option>
        {estilos.map(e => <option key={e.id} value={e.id}>{(formato?.id === 'auto-redes' ? 'Forzar: ' : '') + e.nombre}</option>)}
      </select>
      {formato?.id === 'auto-redes' && <span style={{ display: 'block', fontSize: '0.76rem', marginTop: 4 }}>Con el formato automático no hace falta elegir nada aquí: la IA decide cómo se ve y se mueve según lo que te funciona. Solo elige uno de abajo si quieres obligarla a usar un estilo concreto.</span>}
    </label>
  );
}
function Nuevo({ formatos, musica, carpetas, trabajos, onCreado }) {
  const [estilos] = useEstilos(); const [estilo, setEstilo] = useState('');
  const [origen, setOrigen] = useState('dispositivo'), [base, setBase] = useState([]), [recursos, setRecursos] = useState([]), [mus, setMus] = useState('auto'), [tipo, setTipo] = useState('voz'), [numClips, setNumClips] = useState(0), [durClip, setDurClip] = useState('auto'), [fmt, setFmt] = useState(''), [file, setFile] = useState(null), [notas, setNotas] = useState(''), [guion, setGuion] = useState(''), [files, setFiles] = useState([]), [soloTr, setSoloTr] = useState(false), [soloAudio, setSoloAudio] = useState(false), [asig, setAsig] = useState({}), [prog, setProg] = useState(null), [error, setError] = useState('');
  const inp = useRef(null);
  useEffect(() => { if (!fmt && formatos[0]) setFmt(formatos[0].id); }, [formatos, fmt]);
  useEffect(() => { try { const p = JSON.parse(localStorage.getItem('estudioPendiente') || 'null'); if (p) { if (p.guion) setGuion(p.guion); if (p.notas) setNotas(p.notas); localStorage.removeItem('estudioPendiente'); } } catch { /* nada pendiente */ } }, []);
  useEffect(() => { if (tipo === 'clips') { const a = formatos.find(f => f.id === 'auto-redes') || formatos.find(f => f.id === 'clips-dopaminicos'); if (a) setFmt(a.id); } }, [tipo, formatos]);
  const enviar = async () => {
    const extra = tipo === 'clips' ? { num_clips: numClips, ...(durClip === 'auto' ? { dur_auto: true } : { dur_min: Number(durClip.split('-')[0]), dur_max: Number(durClip.split('-')[1]) }) } : {};
    const dDrive = tipo === 'base' || origen === 'drive'; if (tipo === 'clips' && soloTr) extra.fase = 'transcribir'; if (tipo === 'voz' && soloAudio) extra.fase = 'audio';
    if ((dDrive ? !base.length : !(files.length || file)) || !fmt) return; setError(''); setProg(0);
    try {
      const partesG = partesDeGuion(guion); const reparto = tipo !== 'clips' ? partesG.map((texto, i) => ({ texto, clips: (asig[i] || []).map(x => ({ id: x.id, nombre: x.nombre, tipo: x.tipo, ruta: x.ruta })) })).filter(p => p.clips.length) : [];
      if (reparto.length) { const ya = new Set(recursos.map(r => r.id)); for (const p of reparto) for (const c of p.clips) if (!ya.has(c.id)) { ya.add(c.id); recursos.push(c); } extra.reparto = reparto; }
      // varias entrevistas a la vez: un trabajo por cada una, todos con el mismo guion (cada uno saca los clips que aparecen en su vídeo)
      if (dDrive) { for (const b of (tipo === 'clips' ? base : base.slice(0, 1))) await api.post('/estudio-video/trabajos', { tipo, formato: fmt, estilo: estilo || undefined, base: b, nombre_archivo: b.nombre, indicaciones: notas, guion, musica: mus, recursos, ...extra }); }
      else { for (const fl of (tipo === 'clips' && files.length ? files : [file])) { const ruta = await subirArchivo(fl, setProg); await api.post('/estudio-video/trabajos', { tipo, formato: fmt, estilo: estilo || undefined, archivo: ruta, nombre_archivo: fl.name, indicaciones: notas, guion, musica: mus, recursos, ...extra }); } }
      setFile(null); setFiles([]); setBase([]); setNotas(''); setGuion(''); setAsig({}); setSoloAudio(false); setProg(null); if (inp.current) inp.current.value = ''; onCreado();
    } catch (e) { setError(e?.response?.data?.error || e.message || 'No se pudo enviar'); setProg(null); }
  };
  const opcion = (id, Icono, titulo, sub) => (
    <div key={id} role="button" tabIndex={0} className={'rd-tipo' + (tipo === id ? ' on' : '')} onClick={() => setTipo(id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setTipo(id); }}>
      <div className="ico"><Icono size={20} /></div><div className="tt">{titulo}</div><div className="ss">{sub}</div>
    </div>
  );
  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 14px', fontSize: '1.3rem', fontWeight: 800 }}>Nuevo vídeo</h3>
      <div className="rd-tipos">
        {opcion('voz', Mic, 'Tengo la voz en off', 'Audio o vídeo hablando. La IA monta las escenas encima.')}
        {opcion('bruto', Video, 'Subo el bruto', 'Vídeo grabado hablando a cámara: corta pausas y pone subtítulos.')}
        {opcion('clips', Scissors, 'Entrevista larga → varios clips', 'Subes una entrevista o charla larga y la IA saca los mejores momentos como clips cortos con edición dopamínica.')}
        {opcion('base', Film, 'Vídeo de Drive como base', 'Eliges un vídeo de Drive y la IA superpone clips e imágenes del resto en los momentos clave.')}
      </div>
      {tipo !== 'base' && (<>
      <div className="rd-seg">
        <button type="button" className={origen === 'dispositivo' ? 'on' : ''} onClick={() => setOrigen('dispositivo')}><Upload size={14} /> Desde el dispositivo</button>
        <button type="button" className={origen === 'drive' ? 'on' : ''} onClick={() => setOrigen('drive')}><Folder size={14} /> Desde Drive</button>
      </div>
      {origen === 'drive' && <Explorador seleccion={base} onCambio={setBase} max={tipo === 'clips' ? 6 : 1} titulo={tipo === 'voz' ? 'Audio o vídeo con la voz (de Drive)' : tipo === 'clips' ? 'Entrevistas (de Drive; puedes elegir varias)' : 'Vídeo en bruto (de Drive)'} vacio="Elegir archivo de Drive" />}
      {origen !== 'drive' && (<>
      <label className="rd-drop">
        <Upload size={26} />
        <b>{files.length > 1 ? files.length + ' archivos: ' + files.map(x => x.name).join(', ') : file ? file.name : 'Elige el archivo o arrástralo aquí'}</b>
        <span style={mut}>{tipo === 'voz' ? 'Audio o vídeo con la voz' : tipo === 'clips' ? 'Entrevistas o charlas largas (puedes elegir varias)' : 'Vídeo en bruto'} · aguanta vídeos pesados y reanuda si se corta</span>
        <input ref={inp} type="file" accept={tipo === 'voz' ? 'audio/*,video/*' : 'video/*'} multiple={tipo === 'clips'} onChange={e => { setFile(e.target.files?.[0] || null); setFiles(Array.from(e.target.files || [])); }} style={{ display: 'none' }} />
      </label>
      </>)}
      </>)}
      {tipo === 'voz' && <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, fontSize: '0.9rem' }}><input type="checkbox" checked={soloAudio} onChange={e => setSoloAudio(e.target.checked)} /> Por pasos: primero solo preparo el audio (lo ajusto con el guion) y después elijo los clips</label>}
      {tipo === 'clips' && <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, fontSize: '0.9rem' }}><input type="checkbox" checked={soloTr} onChange={e => setSoloTr(e.target.checked)} /> Primero solo transcribir: yo elijo en el texto los tramos de cada clip</label>}
      <div className="rd-form2" style={{ marginBottom: 6 }}>
        <label style={{ ...mut, display: 'block' }}>Formato (qué tipo de vídeo)
          <select className="ap-field-input" style={{ width: '100%', marginTop: 5 }} value={fmt} onChange={e => setFmt(e.target.value)}>{formatos.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}</select>
        </label>
        <SelectorEstilo estilos={estilos} formato={formatos.find(f => f.id === fmt)} valor={estilo} onCambio={setEstilo} etiqueta="Estilo de edición (cómo se ve y se mueve)" />
      </div>
      {formatos.find(f => f.id === fmt)?.descripcion && <div style={{ ...mut, marginBottom: 12 }}>{formatos.find(f => f.id === fmt).descripcion}</div>}
      <EjemploFormato fmt={fmt} onCambio={onCreado} />
      {tipo === 'clips' && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <label style={{ ...mut, flex: '1 1 160px' }}>Cuántos clips<select className="ap-field-input" style={{ width: '100%', marginTop: 4 }} value={numClips} onChange={e => setNumClips(Number(e.target.value))}><option value={0}>Los que merezcan la pena</option>{[1, 2, 3, 4, 5, 6, 8, 10].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
          <label style={{ ...mut, flex: '1 1 160px' }}>Duración de cada clip<select className="ap-field-input" style={{ width: '100%', marginTop: 4 }} value={durClip} onChange={e => setDurClip(e.target.value)}><option value="auto">Automática: la que te ayuda a crecer</option><option value="15-35">Cortos (15–35 s)</option><option value="25-70">Medios (25–70 s)</option><option value="50-110">Largos (50–110 s)</option></select>{durClip === 'auto' && <span style={{ fontSize: '0.74rem' }}>Usa la duración que mejor te funciona según tus reels analizados (si aún no los has analizado, 20–50 s).</span>}</label>
        </div>
      )}
      {tipo === 'base' && <Explorador seleccion={base} onCambio={setBase} max={1} titulo="Vídeo base (el que se ve de fondo, con su voz)" vacio="Elegir el vídeo base" />}
      <details className="rd-more"><summary>🎞 Escenas y recursos (opcional)</summary>
      <Explorador seleccion={recursos} onCambio={setRecursos} titulo={tipo === 'voz' ? 'Recursos (de dónde salen las escenas)' : 'Recursos para superponer en momentos clave (opcional)'} vacio={tipo === 'voz' ? 'Todo Drive indexado' : 'Todo Drive indexado / elegir recursos'} />
      <SubirRecursos onSubidos={(n) => setRecursos(r => [...r, ...n])} />
      <CopiarSeleccion trabajos={trabajos} onCopiar={(x) => { setRecursos(x.recursos || []); if (x.guion && !guion.trim()) setGuion(x.guion); setAsig(asigDesdeReparto(x, x.guion && !guion.trim() ? x.guion : guion)); }} />
      </details>
      <label style={{ ...mut, display: 'block', marginBottom: 4 }}>Música de fondo</label>
      <select className="ap-field-input" style={{ width: '100%', marginBottom: 10 }} value={mus} onChange={e => setMus(e.target.value)}><option value="auto">Automática (la IA elige la que mejor encaje)</option><option value="ninguna">Sin música</option>{musica.map(p => <option key={p.nombre} value={p.nombre}>{p.nombre}{p.bpm ? ' · ' + Math.round(p.bpm) + ' bpm' : ''}</option>)}</select>
      <details className="rd-more" open={!!(guion || notas)}><summary>📝 Guion e indicaciones (opcional)</summary>
      <div style={{ ...mut, marginBottom: 4 }}>Guion del vídeo (opcional): pégalo aquí. En una entrevista, pon las preguntas o temas que quieres sacar; en una voz en off o un bruto, el texto que quieres que se diga.</div>
      <textarea className="ap-field-input" style={{ width: '100%', minHeight: 90, marginBottom: 10 }} value={guion} onChange={e => setGuion(e.target.value)} placeholder="Pega aquí el guion (da igual si al grabar cambiaste alguna palabra: la IA lo encuentra igualmente)…" />
      {tipo !== 'clips' && !(tipo === 'voz' && soloAudio) && <Desglose guion={guion} asig={asig} setAsig={setAsig} />}
      <label style={{ ...mut, display: 'block', marginBottom: 4 }}>Indicaciones (opcional)</label>
      <textarea className="ap-field-input" style={{ width: '100%', minHeight: 60, marginBottom: 10 }} value={notas} onChange={e => setNotas(e.target.value)} placeholder="Ej.: enseña el proyecto de Rivas, tono directo, que empiece con un plano de obra…" />
      </details>
      {error && <div className="ap-error" style={{ marginBottom: 8 }}>{error}</div>}
      <button className="ap-btn ap-btn-primary" disabled={((tipo === 'base' || origen === 'drive') ? !base.length : !file) || !fmt || prog !== null} onClick={enviar}>{prog !== null ? <><Loader2 size={14} /> Subiendo {prog}%</> : <><Wand2 size={14} /> Editar vídeo</>}</button>
    </div>
  );
}

// Reconstruye la selección por parte (índice → vídeos) a partir del reparto guardado en el trabajo
function asigDesdeReparto(t, guionDestino) {
  const out = {}; const rep = Array.isArray(t.reparto) ? t.reparto : []; if (!rep.length) return out;
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const partes = partesDeGuion(guionDestino != null ? guionDestino : (t.guion || ''));
  partes.forEach((p, i) => { const r = rep.find(x => norm(x.texto) === norm(p)); if (r && (r.clips || []).length) { out[i] = r.clips; if (r.extra) out['x' + i] = r.extra; } });
  // otro guion: si no casa ningún texto pero hay las mismas partes, se copian por orden
  if (!Object.keys(out).length && guionDestino != null && partes.length === rep.length) rep.forEach((r, i) => { if ((r.clips || []).length) { out[i] = r.clips; if (r.extra) out['x' + i] = r.extra; } });
  return out;
}
// Copiar la selección (recursos y vídeos por parte) de un vídeo anterior, para no tener que volver a elegirlos
function CopiarSeleccion({ trabajos, onCopiar }) {
  const cand = (trabajos || []).filter(x => (x.reparto && x.reparto.length) || (x.recursos && x.recursos.length)).slice(0, 25);
  if (!cand.length) return null;
  return (
    <div style={{ margin: '4px 0 10px' }}>
      <span style={mut}>¿Misma selección que otro vídeo? </span>
      <select className="ap-field-input" style={{ width: 'auto', maxWidth: '100%' }} value="" onChange={e => { const x = cand.find(c => c.id === e.target.value); if (x) onCopiar(x); }}>
        <option value="">Copiar la selección de…</option>
        {cand.map(x => <option key={x.id} value={x.id}>{(x.nombre_archivo || x.id) + ' · v' + (x.version || 1) + ' · ' + (x.reparto?.length ? x.reparto.length + ' partes con clips' : (x.recursos || []).length + ' recursos')}</option>)}
      </select>
    </div>
  );
}
// Desglose del guion: el usuario indica qué vídeos van en cada parte y el montaje lo respeta
function partesDeGuion(g) {
  const bloques = String(g || '').split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
  if (bloques.length > 1) return bloques.slice(0, 40);
  return String(g || '').split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(Boolean).slice(0, 40);
}
// Duración REAL de cada parte del guion medida en el audio ya preparado (solo las palabras que se quedan, con pausas cortas)
function medirPartes(partes, trans) {
  if (!Array.isArray(trans) || !trans.length) return null;
  const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  const VACIAS = new Set(['para', 'pero', 'porque', 'como', 'esta', 'este', 'esto', 'estos', 'tiene', 'tenemos', 'desde', 'entre', 'sobre', 'cuando', 'donde', 'todo', 'toda', 'todos', 'muy', 'mas', 'nada', 'esta']);
  const kept = []; trans.forEach((w) => { if (!w[3]) kept.push({ n: norm(w[0]), de: w[1], a: w[2] }); });
  const N = kept.map(w => w.n); let desde = 0; const ini = [];
  // cada parte se localiza por las palabras con contenido que comparte con el audio (aunque la frase esté dicha con otras palabras)
  partes.forEach((p) => {
    const pw = [...new Set(p.split(/\s+/).map(norm).filter(x => x.length >= 4 && !VACIAS.has(x)).map(x => x.slice(0, 5)))]; const total = p.split(/\s+/).filter(Boolean).length;
    if (!pw.length) { ini.push(null); return; }
    const W = Math.max(8, Math.ceil(total * 1.6)); let mejor = -1, ms = 0;
    for (let i = desde; i < N.length; i++) { const ven = new Set(); for (let j = i; j < Math.min(N.length, i + W); j++) if (pw.includes(N[j].slice(0, 5))) ven.add(N[j].slice(0, 5)); if (ven.size > ms) { ms = ven.size; mejor = i; } }
    if (mejor < 0 || ms < (pw.length <= 3 ? 1 : Math.max(2, Math.ceil(pw.length * 0.4)))) { ini.push(null); return; }
    let s = mejor; while (s < N.length && !pw.includes(N[s].slice(0, 5))) s++; // primer token que coincide
    // si la ventana empieza justo antes (palabras de enlace como "y" o "ahora"), no importa: se toma desde la primera coincidencia
    ini.push(s); desde = s + 1;
  });
  return partes.map((_, k) => { if (ini[k] === null) return null; let fin = kept.length; for (let j = k + 1; j < partes.length; j++) if (ini[j] !== null) { fin = ini[j]; break; } let s = 0; for (let i = ini[k]; i < fin; i++) { s += kept[i].a - kept[i].de + (i > ini[k] ? Math.min(0.45, Math.max(0, kept[i].de - kept[i - 1].a)) : 0); } return s; });
}
function Desglose({ guion, asig, setAsig, trans }) {
  const [abierto, setAbierto] = useState(false), [forzar, setForzar] = useState({});
  const partes = partesDeGuion(guion); if (!partes.length) return null;
  const medidas = medirPartes(partes, trans);
  const n = partes.filter((_, i) => (asig[i] || []).length).length;
  return (
    <div style={{ ...card, marginBottom: 10 }}>
      <button type="button" className="ap-btn ap-btn-sm" onClick={() => setAbierto(!abierto)}><Scissors size={13} /> {abierto ? 'Ocultar el desglose' : 'Asignar vídeos a cada parte del guion'}{n ? ' (' + n + ' de ' + partes.length + ' con vídeos)' : ''}</button>
      {abierto && (
        <div style={{ marginTop: 10 }}>
          <div style={{ ...mut, marginBottom: 8 }}>Tu guion está dividido en partes (una por párrafo). En cada una elige los vídeos de Drive que quieres que se vean mientras se dice esa parte. Las que dejes sin vídeos las monta la IA como siempre.</div>
          {partes.map((p, i) => medidas && medidas[i] == null && !forzar[i] && !(asig[i] || []).length ? (
            <div key={i} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.08)', opacity: 0.6 }}>
              <div style={{ fontSize: '0.85rem' }}><strong>Parte {i + 1}:</strong> {p}</div>
              <div style={mut}>No aparece en tu audio: no hace falta elegir clips. <button type="button" className="ap-btn ap-btn-sm" onClick={() => setForzar({ ...forzar, [i]: true })}>Sí aparece, mostrar</button></div>
            </div>
          ) : (
            <div key={i} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize: '0.85rem', marginBottom: 6 }}><strong>Parte {i + 1}:</strong> {p}</div>
              {medidas && medidas[i] != null ? (() => { const seg = Math.max(1, Math.round(medidas[i])), clips = Math.max(1, Math.round(seg / 2.5)); return <div style={{ ...mut, marginBottom: 6 }}>En tu audio dura <strong>{seg} s</strong>: necesita unos <strong>{clips} clip{clips > 1 ? 's' : ''}</strong> de ~2,5 s (o menos clips, más largos).{(asig[i] || []).length ? ' Has elegido ' + (asig[i] || []).length + '.' : ''}{(() => { const el = asig[i] || []; const conDur = el.filter(x => x.duracion); if (!el.length || !conDur.length) return null; const suma = conDur.reduce((s, x) => s + x.duracion, 0), carp = el.some(x => x.tipo === 'carpeta'); return suma >= seg || carp ? <span style={{ color: '#9fd3a0' }}> Lo elegido suma {suma} s: alcanza para los {seg} s.</span> : <span style={{ color: '#f2c46d' }}> Lo elegido suma solo {suma} s y la parte dura {seg} s: faltan unos {seg - suma} s (se repetirían tomas o entraría otro clip).</span>; })()}</div>; })() : <div style={{ ...mut, marginBottom: 6 }}>La duración se mide en tu audio cuando está preparado (paso 1), no con el guion.{(asig[i] || []).length ? ' Has elegido ' + (asig[i] || []).length + '.' : ''}</div>}
              <Explorador seleccion={asig[i] || []} onCambio={(s) => setAsig({ ...asig, [i]: s })} max={8} titulo="Vídeos para esta parte" vacio="Elegir vídeos de Drive" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Método manual para entrevistas largas: se lee la transcripción entera y se eligen los tramos de cada clip
const COLORES_CLIP = ['#E3D2B8', '#7fb3d5', '#a9cf9a', '#e6a57a', '#c3a1d9', '#e0c35f'];
const mmss = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
function ConstructorClips({ t, onCambio }) {
  const [pal, setPal] = useState(null), [err, setErr] = useState(''), [sel, setSel] = useState(null), [clips, setClips] = useState([{ titulo: '', pregunta: '', tramos: [] }]), [actual, setActual] = useState(0), [env, setEnv] = useState(false);
  useEffect(() => { let vivo = true; api.get('/estudio-video/trabajos/' + t.id + '/palabras').then(r => fetch(r.data.url)).then(r => r.json()).then(j => { if (vivo) setPal(j.p || []); }).catch(() => { if (vivo) setErr('No se pudo leer la transcripción'); }); return () => { vivo = false; }; }, [t.id]);
  const parrafos = useMemo(() => { if (!pal) return []; const out = []; let cur = null; pal.forEach((w, i) => { const gap = cur ? w[1] - pal[i - 1][2] : 0; if (!cur || (w[3] && w[3] !== cur.spk) || gap > 1.5 || cur.idx.length >= 70) { cur = { spk: w[3] || '', ini: w[1], idx: [] }; out.push(cur); } cur.idx.push(i); }); return out; }, [pal]);
  const dueno = useMemo(() => { const m = new Map(); clips.forEach((c, k) => c.tramos.forEach(({ a, b }) => { for (let i = a; i <= b; i++) m.set(i, k); })); return m; }, [clips]);
  const tiempos = (x) => ({ ini: Math.max(0, pal[x.a][1] - 0.05), fin: pal[x.b][2] + 0.1 });
  const durClip = (c) => c.tramos.reduce((s, x) => { const q = tiempos(x); return s + q.fin - q.ini; }, 0);
  const alSoltar = () => { const s = window.getSelection(); if (!s || s.isCollapsed || !s.rangeCount) return; const r = s.getRangeAt(0); const f = (n) => { const el = (n.nodeType === 3 ? n.parentElement : n)?.closest?.('[data-i]'); return el ? Number(el.dataset.i) : null; }; let a = f(r.startContainer), b = f(r.endContainer); if (a === null || b === null) return; if (a > b) [a, b] = [b, a]; setSel({ a, b }); };
  const alClic = (e, i) => { if (e.shiftKey && sel) setSel({ a: Math.min(sel.a, i), b: Math.max(sel.b, i) }); else if (window.getSelection().isCollapsed) setSel({ a: i, b: i }); };
  const anadir = () => { if (!sel) return; setClips(l => l.map((c, k) => (k === actual ? { ...c, tramos: [...c.tramos, sel].sort((x, y) => x.a - y.a) } : c))); setSel(null); try { window.getSelection().removeAllRanges(); } catch { /* sin selección */ } };
  const montar = async () => { setEnv(true); setErr(''); try { await api.post('/estudio-video/trabajos/' + t.id + '/montar-clips', { clips: clips.filter(c => c.tramos.length).map(c => ({ titulo: c.titulo, pregunta: c.pregunta, tramos: c.tramos.map(x => { const q = tiempos(x); return [Math.round(q.ini * 100) / 100, Math.round(q.fin * 100) / 100]; }) })) }); onCambio(); } catch (e) { setErr(e?.response?.data?.error || 'No se pudo lanzar'); setEnv(false); } };
  if (err && !pal) return <div style={{ color: '#ff8a80' }}>{err}</div>;
  if (!pal) return <div style={mut}><Loader2 size={14} /> Cargando la transcripción…</div>;
  const nListos = clips.filter(c => c.tramos.length).length;
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 520px', minWidth: 300 }}>
        <div style={{ ...mut, marginBottom: 8 }}>Lee la transcripción y <strong>selecciona con el ratón</strong> un fragmento (o haz clic en una palabra y Mayús+clic en otra). Luego pulsa «Añadir al clip». Puedes juntar varios fragmentos en un mismo clip.</div>
        <div onMouseUp={alSoltar} style={{ lineHeight: 1.75, fontSize: '0.95rem' }}>
          {parrafos.map((p, k) => (
            <div key={k} style={{ marginBottom: 12 }}>
              <div style={{ ...mut, fontSize: '0.75rem' }}>{mmss(p.ini)}{p.spk ? ' · ' + (p.spk === 'P' ? 'pregunta' : 'respuesta') : ''}</div>
              <div>{p.idx.map(i => { const k2 = dueno.get(i), en = sel && i >= sel.a && i <= sel.b; return <span key={i} data-i={i} onClick={(e) => alClic(e, i)} style={{ cursor: 'pointer', padding: '1px 0', background: en ? 'rgba(255,255,255,0.28)' : k2 !== undefined ? COLORES_CLIP[k2 % COLORES_CLIP.length] + '44' : 'transparent', borderBottom: k2 !== undefined ? '2px solid ' + COLORES_CLIP[k2 % COLORES_CLIP.length] : 'none' }}>{pal[i][0]} </span>; })}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ flex: '0 0 340px', maxWidth: '100%', position: 'sticky', top: 56 }}>
        <div style={{ ...card, marginBottom: 10 }}>
          {sel ? <div><div style={{ marginBottom: 6 }}>Seleccionado: <strong>{mmss(pal[sel.a][1])}–{mmss(pal[sel.b][2])}</strong> ({Math.round(pal[sel.b][2] - pal[sel.a][1])} s)</div><button className="ap-btn ap-btn-primary ap-btn-sm" onClick={anadir}><Plus size={13} /> Añadir al clip {actual + 1}</button> <button className="ap-btn ap-btn-sm" onClick={() => setSel(null)}>Quitar selección</button></div> : <div style={mut}>Selecciona un fragmento del texto.</div>}
        </div>
        {clips.map((c, k) => (
          <div key={k} onClick={() => setActual(k)} style={{ ...card, marginBottom: 8, borderColor: k === actual ? COLORES_CLIP[k % COLORES_CLIP.length] : undefined, cursor: 'pointer' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginBottom: 6 }}><strong style={{ color: COLORES_CLIP[k % COLORES_CLIP.length] }}>Clip {k + 1}</strong><span style={mut}>{c.tramos.length ? Math.round(durClip(c)) + ' s en ' + c.tramos.length + ' tramo' + (c.tramos.length > 1 ? 's' : '') : 'vacío'}</span></div>
            <input className="ap-field-input" style={{ width: '100%', marginBottom: 6 }} placeholder="Título del clip" value={c.titulo} onChange={e => setClips(l => l.map((x, j) => (j === k ? { ...x, titulo: e.target.value } : x)))} />
            <input className="ap-field-input" style={{ width: '100%', marginBottom: 6 }} placeholder="Pregunta en pantalla (opcional)" value={c.pregunta} onChange={e => setClips(l => l.map((x, j) => (j === k ? { ...x, pregunta: e.target.value } : x)))} />
            {c.tramos.map((x, j) => <div key={j} style={{ fontSize: '0.8rem', display: 'flex', justifyContent: 'space-between', gap: 6, marginBottom: 2 }}><span>{mmss(pal[x.a][1])}–{mmss(pal[x.b][2])} · «{pal.slice(x.a, Math.min(x.b + 1, x.a + 6)).map(w => w[0]).join(' ')}…»</span><button className="ap-btn ap-btn-sm" onClick={(e) => { e.stopPropagation(); setClips(l => l.map((y, i2) => (i2 === k ? { ...y, tramos: y.tramos.filter((_, j2) => j2 !== j) } : y))); }}><X size={11} /></button></div>)}
          </div>
        ))}
        <button className="ap-btn ap-btn-sm" onClick={() => { setClips(l => [...l, { titulo: '', pregunta: '', tramos: [] }]); setActual(clips.length); }}><Plus size={13} /> Nuevo clip</button>
        <div style={{ marginTop: 12 }}><button className="ap-btn ap-btn-primary" disabled={!nListos || env} onClick={montar}>{env ? <Loader2 size={14} /> : <Wand2 size={14} />} Montar {nListos || ''} clip{nListos === 1 ? '' : 's'}</button></div>
        {err && <div style={{ color: '#ff8a80', marginTop: 8 }}>{err}</div>}
      </div>
    </div>
  );
}

// Catálogo de efectos de HyperFrames: cada uno con su vídeo de muestra
function PestanaEfectos() {
  const [lista, setLista] = useState(null), [pidiendo, setPidiendo] = useState({}), [msg, setMsg] = useState('');
  const cargar = useCallback(() => api.get('/estudio-video/efectos').then(r => setLista(r.data.efectos || [])).catch(() => setLista([])), []);
  useEffect(() => { cargar(); }, [cargar]);
  const faltan = (lista || []).filter(e => !e.url);
  useEffect(() => { if (!Object.keys(pidiendo).length) return; const i = setInterval(cargar, 6000); return () => clearInterval(i); }, [pidiendo, cargar]);
  useEffect(() => { if (!lista) return; setPidiendo(p => { const n = { ...p }; let cambio = false; Object.keys(n).forEach(id => { if (lista.find(e => e.id === id)?.url) { delete n[id]; cambio = true; } }); return cambio ? n : p; }); }, [lista]);
  const pedir = async (ids) => { setMsg(''); try { await api.post('/estudio-video/efectos/muestra', { ids }); setPidiendo(p => { const n = { ...p }; ids.forEach(id => { n[id] = true; }); return n; }); } catch (e) { setMsg(e?.response?.data?.error || 'No se pudo crear'); } };
  if (lista === null) return <div className="ap-loading">Cargando…</div>;
  return (
    <div>
      <div style={{ ...mut, marginBottom: 10 }}>Efectos y animaciones profesionales hechos con HyperFrames, con los colores de Ranuse. Mira cómo quedan; los que te gusten los vamos conectando a los montajes.</div>
      {faltan.length > 0 && <button className="ap-btn ap-btn-sm" style={{ marginBottom: 12 }} disabled={faltan.every(e => pidiendo[e.id])} onClick={() => pedir(faltan.filter(e => !pidiendo[e.id]).map(e => e.id))}><Play size={13} /> Crear las {faltan.length} muestras que faltan (unos 2-3 min)</button>}
      {msg && <div style={{ color: '#ff8a80', marginBottom: 8 }}>{msg}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12 }}>
        {lista.map(e => (
          <div key={e.id} style={card}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{e.nombre}</div>
            <div style={{ ...mut, marginBottom: 8, minHeight: 54 }}>{e.descripcion}</div>
            {e.url ? <video src={e.url} controls loop muted playsInline preload="metadata" style={{ width: '100%', borderRadius: 10, background: '#000', display: 'block' }} /> : pidiendo[e.id] ? <div style={mut}><Loader2 size={13} /> Creando la muestra…</div> : <button className="ap-btn ap-btn-sm" onClick={() => pedir([e.id])}><Play size={13} /> Crear muestra</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

// Vídeo de muestra del estilo de subtítulos y la tipografía elegidos
function MuestraEstilo({ estilo, fuente, acento }) {
  const [url, setUrl] = useState(undefined), [creando, setCreando] = useState(false), [msg, setMsg] = useState('');
  const mira = useCallback(() => api.get('/estudio-video/estilos/muestra', { params: { estilo, fuente } }).then(r => { setUrl(r.data.url || null); return r.data.url; }).catch(() => { setUrl(null); return null; }), [estilo, fuente]);
  useEffect(() => { setUrl(undefined); setMsg(''); setCreando(false); mira(); }, [mira]);
  const crear = async () => { setCreando(true); setMsg(''); try { await api.post('/estudio-video/estilos/muestra', { estilo, fuente, acento }); for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 5000)); const u = await mira(); if (u) { setCreando(false); return; } } setMsg('Tarda más de lo normal; vuelve a mirar en un minuto.'); } catch (e) { setMsg(e?.response?.data?.error || 'No se pudo crear la muestra'); } setCreando(false); };
  return (
    <div style={{ margin: '8px 0 12px' }}>
      <div style={{ ...mut, marginBottom: 4 }}>Muestra: «{estilo}» con {fuente}</div>
      {url ? <video key={url} src={url} controls loop muted playsInline style={{ width: '100%', maxWidth: 220, borderRadius: 10, background: '#000', display: 'block' }} /> : url === undefined ? <div style={mut}><Loader2 size={13} /> Mirando…</div> : (
        <button className="ap-btn ap-btn-sm" disabled={creando} onClick={crear}>{creando ? <><Loader2 size={13} /> Creando la muestra (1-2 min)…</> : <><Play size={13} /> Ver cómo queda (crear muestra)</>}</button>
      )}
      {msg && <div style={{ ...mut, marginTop: 4 }}>{msg}</div>}
    </div>
  );
}

// Subir clips o fotos desde el dispositivo para usarlos como escenas
function SubirRecursos({ onSubidos }) {
  const [prog, setProg] = useState(null), [err, setErr] = useState(''), inp = useRef(null);
  const subir = async (lista) => { if (!lista.length) return; setErr(''); try { const nuevos = []; for (let i = 0; i < lista.length; i++) { const f = lista[i]; const ruta = await subirArchivo(f, (p) => setProg(Math.round(((i + p / 100) / lista.length) * 100))); nuevos.push({ id: ruta, nombre: f.name, tipo: 'subido', ruta }); } onSubidos(nuevos); } catch (e) { setErr(e?.response?.data?.error || e.message || 'No se pudo subir'); } setProg(null); if (inp.current) inp.current.value = ''; };
  return (
    <div style={{ margin: '8px 0 12px' }}>
      <div style={{ ...mut, marginBottom: 4 }}>O sube clips y fotos desde tu dispositivo para usarlos como escenas:</div>
      <input ref={inp} type="file" multiple accept="video/*,image/*" disabled={prog !== null} onChange={e => subir(Array.from(e.target.files || []))} />
      {prog !== null && <span style={{ ...mut, marginLeft: 8 }}><Loader2 size={13} /> Subiendo {prog}%</span>}
      {err && <div style={{ color: '#ff8a80', marginTop: 4 }}>{err}</div>}
    </div>
  );
}

// Vídeo de ejemplo real del formato elegido (el último que se hizo con él); si no hay, permite crearlo con uno de tus vídeos
function EjemploFormato({ fmt, onCambio }) {
  const [d, setD] = useState(null), [msg, setMsg] = useState(''), [ocupado, setOcupado] = useState(false);
  useEffect(() => { let vivo = true; api.get('/estudio-video/formatos/ejemplos').then(r => { if (vivo) setD(r.data); }).catch(() => { if (vivo) setD({ ejemplos: {}, candidato: null }); }); return () => { vivo = false; }; }, []);
  if (!d || !fmt) return null;
  const ej = d.ejemplos[fmt];
  const crear = async () => { setOcupado(true); setMsg(''); try { await api.post('/estudio-video/trabajos/' + d.candidato.id + '/rehacer', { formato: fmt }); setMsg('Montando el ejemplo con «' + (d.candidato.nombre || 'tu último vídeo') + '»: aparecerá abajo en Vídeos en unos minutos.'); if (onCambio) onCambio(); } catch (e) { setMsg(e?.response?.data?.error || 'No se pudo crear el ejemplo'); } setOcupado(false); };
  return (
    <div style={{ marginBottom: 12 }}>
      {ej ? (
        <div>
          <div style={{ ...mut, marginBottom: 4 }}>Así queda este formato (ejemplo real: {ej.nombre || 'un vídeo tuyo'})</div>
          <video key={ej.url} src={ej.url} controls playsInline preload="metadata" style={{ width: '100%', maxWidth: 240, borderRadius: 10, background: '#000', display: 'block' }} />
        </div>
      ) : (
        <div style={mut}>
          Todavía no hay ningún vídeo hecho con este formato.{' '}
          {d.candidato ? <button className="ap-btn ap-btn-sm" disabled={ocupado} onClick={crear}>{ocupado ? <Loader2 size={13} /> : <Play size={13} />} Crear un ejemplo con «{d.candidato.nombre || 'mi último vídeo'}»</button> : 'Haz uno y aparecerá aquí.'}
        </div>
      )}
      {msg && <div style={{ ...mut, marginTop: 6 }}>{msg}</div>}
    </div>
  );
}

// Tarjeta de un vídeo viral analizado: muestra cómo está editado, crea el formato con la marca de Ranuse y enseña una muestra real
function TarjetaReferencia({ t, onCambio }) {
  const [nuevo, setNuevo] = useState(null), [listos, setListos] = useState(null), [elegido, setElegido] = useState(''), [msg, setMsg] = useState(''), [ocupado, setOcupado] = useState(false);
  const a = t.analisis;
  const crear = async () => { setOcupado(true); setMsg(''); try { const { data } = await api.post('/estudio-video/formatos/desde-referencia', { id: t.id }); setNuevo(data.formato); const l = await api.get('/estudio-video/trabajos'); setListos((l.data.trabajos || []).filter(x => x.estado === 'listo' && x.resultado && ['voz', 'bruto'].includes(x.tipo))); onCambio(); } catch (e) { setMsg(e?.response?.data?.error || 'No se pudo crear el formato'); } setOcupado(false); };
  const muestra = async () => { if (!elegido) return; setOcupado(true); setMsg(''); try { await api.post('/estudio-video/trabajos/' + elegido + '/rehacer', { formato: nuevo.id }); setMsg('Montando la muestra: aparecerá arriba en Vídeos con este formato (unos minutos).'); onCambio(); } catch (e) { setMsg(e?.response?.data?.error || 'No se pudo lanzar la muestra'); } setOcupado(false); };
  const borrar = async () => { if (!window.confirm('¿Borrar este análisis?')) return; try { await api.delete('/estudio-video/trabajos/' + t.id); onCambio(); } catch { /* sin borrar */ } };
  return (
    <div style={{ ...card, marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontWeight: 600 }}>Vídeo viral analizado: {t.nombre_archivo}</div>
        <button className="ap-btn ap-btn-sm" onClick={borrar}><Trash2 size={13} /></button>
      </div>
      {t.estado === 'error' && <div style={{ color: '#ff8a80', marginTop: 6 }}>{t.error}</div>}
      {(t.estado === 'pendiente' || t.estado === 'procesando') && <div style={{ ...mut, marginTop: 6 }}><Loader2 size={13} /> {t.progreso || 'En cola'}</div>}
      {t.estado === 'listo' && a && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontWeight: 600 }}>{a.nombre}</div>
          <div style={{ ...mut, margin: '4px 0' }}>{a.descripcion}</div>
          <div style={{ fontSize: '0.85rem', marginBottom: 6 }}>{a.planos} planos en {Math.round(a.dur)} s · plano medio {a.plano_medio} s{a.palabras_por_min ? ' · ' + a.palabras_por_min + ' palabras/min' : ''}</div>
          {(a.estructura || []).map((x, i) => <div key={i} style={{ fontSize: '0.85rem' }}>• {x}</div>)}
          {a.parecido_a_nuestros_formatos && <div style={{ ...mut, marginTop: 6 }}>Se parece a: {a.parecido_a_nuestros_formatos}</div>}
          {!nuevo ? <button className="ap-btn ap-btn-primary ap-btn-sm" style={{ marginTop: 10 }} disabled={ocupado} onClick={crear}>{ocupado ? <Loader2 size={13} /> : <Wand2 size={13} />} Crear formato con este estilo (adaptado a mi marca)</button> : (
            <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: 'rgba(255,255,255,0.05)' }}>
              <div style={{ marginBottom: 6 }}><Check size={13} /> Formato «{nuevo.nombre}» creado (ritmo y estructura de la referencia; colores, fuente y minúsculas de Ranuse). Lo tienes en la lista de formatos para ajustarlo.</div>
              <div style={{ ...mut, marginBottom: 4 }}>Para ver cómo queda de verdad, aplícalo a uno de tus vídeos ya hechos:</div>
              <select className="ap-field-input" value={elegido} onChange={e => setElegido(e.target.value)} style={{ maxWidth: '100%' }}>
                <option value="">Elige un vídeo…</option>
                {(listos || []).map(x => <option key={x.id} value={x.id}>{(x.nombre_archivo || x.id) + ' · ' + (x.formato_nombre || '')}</option>)}
              </select>
              <button className="ap-btn ap-btn-sm" style={{ marginLeft: 8 }} disabled={!elegido || ocupado} onClick={muestra}><Play size={13} /> Ver muestra real</button>
            </div>
          )}
          {msg && <div style={{ ...mut, marginTop: 6 }}>{msg}</div>}
        </div>
      )}
    </div>
  );
}

// Subir un vídeo viral para que la IA aprenda cómo está editado
function AprenderReferencia({ formatos, onCambio }) {
  const [prog, setProg] = useState(null), [err, setErr] = useState(''), inp = useRef(null);
  const subir = async (file) => { if (!file) return; setErr(''); try { const ruta = await subirArchivo(file, setProg); await api.post('/estudio-video/trabajos', { tipo: 'referencia', formato: formatos[0]?.id, archivo: ruta, nombre_archivo: file.name }); setProg(null); if (inp.current) inp.current.value = ''; onCambio(); } catch (e) { setProg(null); setErr(e?.response?.data?.error || e.message || 'No se pudo subir'); } };
  return (
    <div style={{ ...card, marginBottom: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Aprender de un vídeo viral</div>
      <div style={{ ...mut, marginBottom: 8 }}>Sube un vídeo que te guste de otra cuenta (el archivo; los enlaces de TikTok o Instagram no siempre se pueden descargar). La IA mide su ritmo de cortes, zooms, texto y estructura, crea un formato igual y lo adapta a tu marca. Después puedes ver una muestra real con tus propios vídeos.</div>
      <input ref={inp} type="file" accept="video/*" disabled={prog !== null} onChange={e => subir(e.target.files?.[0])} />
      {prog !== null && <div style={{ ...mut, marginTop: 6 }}><Loader2 size={13} /> Subiendo {prog}%</div>}
      {err && <div style={{ color: '#ff8a80', marginTop: 6 }}>{err}</div>}
    </div>
  );
}

const Trabajo = memo(function Trabajo(props) { return props.t.tipo === 'referencia' ? <TarjetaReferencia t={props.t} onCambio={props.onCambio} /> : <TrabajoNormal {...props} />; });
function TrabajoNormal({ t, formatos, onCambio, musica = [], trabajosTodos = [] }) {
  const [estilosR] = useEstilos(); const [estiloR, setEstiloR] = useState('');
  const [cambios, setCambios] = useState(''), [abierto, setAbierto] = useState(false), [fmt, setFmt] = useState(t.formato), [err, setErr] = useState(''), [panelReg, setPanelReg] = useState(false), [guionReg, setGuionReg] = useState(t.guion || ''), [asigR, setAsigR] = useState(() => asigDesdeReparto(t)), [musR, setMusR] = useState(t.musica || 'auto'), [ritmoA, setRitmoA] = useState(t.audio_ritmo || 0), [dinR, setDinR] = useState(0), [rehaciendoA, setRehaciendoA] = useState(false), [constructor, setConstructor] = useState(false), [panelAudio, setPanelAudio] = useState(() => !!(t.reparto && t.reparto.length && t.fase === 'audio')), [asigA, setAsigA] = useState(() => asigDesdeReparto(t)), [guionA, setGuionA] = useState(t.guion || ''), [editando, setEditando] = useState(false), [editTexto, setEditTexto] = useState(false), [recs, setRecs] = useState(selInicial(t)), [baseSel, setBaseSel] = useState(t.base?.id ? [{ id: t.base.id, nombre: t.base.nombre, tipo: 'video', ruta: t.base.ruta || '' }] : []);
  const [txt, color] = ESTADOS[t.estado] || ESTADOS.pendiente;
  const vref = useRef(null);
  const regenerar = async () => { try { await api.post('/estudio-video/trabajos/' + t.id + '/rehacer', { formato: t.formato, musica: musR, dinamismo: dinR, recursos: (() => { const ya = new Set(recs.map(r => r.id)); const extra = []; Object.values(asigR).forEach(l => (l || []).forEach(c => { if (!ya.has(c.id)) { ya.add(c.id); extra.push(c); } })); return [...recs, ...extra]; })(), guion: guionReg, reparto: partesDeGuion(guionReg).map((texto, i) => ({ texto, clips: (asigR[i] || []).map(x => ({ id: x.id, nombre: x.nombre, tipo: x.tipo, duracion: x.duracion || null, ruta: x.ruta })) })).filter(p => p.clips.length), ...(baseSel[0] ? { base: baseSel[0] } : {}) }); setPanelReg(false); onCambio(); } catch (e) { setErr(e?.response?.data?.error || 'No se pudo'); } };
  const rehacer = async () => { if (!cambios.trim()) return; try { await api.post('/estudio-video/trabajos/' + t.id + '/rehacer', { indicaciones: cambios, formato: fmt, estilo: estiloR || undefined }); setCambios(''); setAbierto(false); onCambio(); } catch (e) { setErr(e?.response?.data?.error || 'No se pudo'); } };
  const borrar = async () => { if (!window.confirm('¿Borrar este vídeo?')) return; try { await api.delete('/estudio-video/trabajos/' + t.id); onCambio(); } catch (e) { setErr(e?.response?.data?.error || 'No se pudo borrar'); } };
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
      {t.estado === 'listo' && t.fase === 'audio' && (
        <div style={{ marginTop: 10 }}>
          <div style={{ ...mut, marginBottom: 6 }}>Paso 1 · Audio preparado{t.dur_audio ? ' (' + Math.round(t.dur_audio) + ' s)' : ''}. Escúchalo; si no está exacto, quita palabras o frases leyendo el texto. Cuando esté como quieres, pasa al paso 2.</div>
          {t.url_audio && <audio src={t.url_audio} controls style={{ width: '100%', maxWidth: 420, display: 'block', marginBottom: 8 }} />}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(t.transcripcion || []).length > 0 && <button className="ap-btn ap-btn-sm" onClick={() => setEditTexto(!editTexto)}><Scissors size={13} /> Ajustar el texto del audio</button>}
            <button className="ap-btn ap-btn-primary ap-btn-sm" onClick={() => setPanelAudio(!panelAudio)}><Film size={13} /> Paso 2: elegir los clips</button>
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={mut}>Ritmo del audio:</span>
            <select className="ap-field-input" style={{ width: 'auto' }} value={ritmoA} onChange={e => setRitmoA(Number(e.target.value))}><option value={0}>Normal</option><option value={1}>Más ágil (cortar pausas medianas)</option><option value={2}>Muy ágil (cortar casi todas las pausas)</option></select>
            <button className="ap-btn ap-btn-sm" disabled={rehaciendoA || ritmoA === (t.audio_ritmo || 0)} title="Prepara otra versión del audio con ese ritmo; lo que ya quitaste del texto se mantiene" onClick={async () => { setRehaciendoA(true); try { await api.post('/estudio-video/trabajos/' + t.id + '/editar-texto', { ritmo: ritmoA }); onCambio(); } catch (e) { setErr(e?.response?.data?.error || 'No se pudo rehacer el audio'); } setRehaciendoA(false); }}>{rehaciendoA ? <Loader2 size={13} /> : <RefreshCw size={13} />} Rehacer el audio con este ritmo</button>
          </div>
          {panelAudio && (
            <div style={{ marginTop: 10, padding: 10, borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)' }}>
              <div style={{ ...mut, marginBottom: 4 }}>Guion (se divide en partes; en cada una eliges los vídeos que se ven mientras se dice).</div>
              <textarea className="ap-field-input" style={{ width: '100%', minHeight: 80, marginBottom: 8 }} value={guionA} onChange={e => setGuionA(e.target.value)} />
              <CopiarSeleccion trabajos={trabajosTodos} onCopiar={(x) => { const a = asigDesdeReparto(x, guionA); setAsigA(a); try { const partes = partesDeGuion(guionA); const reparto = partes.map((texto, i) => ({ texto, extra: Number(a['x' + i]) || 0, clips: (a[i] || []).map(y => ({ id: y.id, nombre: y.nombre, tipo: y.tipo, duracion: y.duracion || null, ruta: y.ruta })) })).filter(p => p.clips.length); api.post('/estudio-video/trabajos/' + t.id + '/reparto', { reparto, guion: guionA }).catch(() => {}); } catch { /* sin guardar */ } }} />
              <Desglose guion={guionA} asig={asigA} setAsig={(a) => { setAsigA(a); try { const partes = partesDeGuion(guionA); const reparto = partes.map((texto, i) => ({ texto, clips: (a[i] || []).map(x => ({ id: x.id, nombre: x.nombre, tipo: x.tipo, duracion: x.duracion || null, ruta: x.ruta })) })).filter(p => p.clips.length); clearTimeout(window.__guardaReparto); window.__guardaReparto = setTimeout(() => { api.post('/estudio-video/trabajos/' + t.id + '/reparto', { reparto, guion: guionA }).catch(() => {}); }, 700); } catch { /* sin guardar */ } }} trans={t.transcripcion} />
              <button className="ap-btn ap-btn-primary ap-btn-sm" onClick={async () => { try { const partes = partesDeGuion(guionA); const reparto = partes.map((texto, i) => ({ texto, clips: (asigA[i] || []).map(x => ({ id: x.id, nombre: x.nombre, tipo: x.tipo, ruta: x.ruta })) })).filter(p => p.clips.length); const vistos = new Map(); for (const p of reparto) for (const c of p.clips) vistos.set(c.id, c); await api.post('/estudio-video/trabajos/' + t.id + '/montar-con-audio', { reparto, guion: guionA, recursos: [...vistos.values()].length ? [...vistos.values()] : undefined }); setPanelAudio(false); onCambio(); } catch (e) { setErr(e?.response?.data?.error || 'No se pudo montar'); } }}><Wand2 size={13} /> Montar el vídeo con este audio</button>
            </div>
          )}
        </div>
      )}
      {t.estado === 'listo' && t.fase === 'transcribir' && (
        <div style={{ marginTop: 10 }}>
          <div style={{ marginBottom: 8 }}>Transcripción lista: {t.palabras_n} palabras ({Math.round((t.dur_total || 0) / 60)} min). Ahora eliges tú en el texto qué tramos forman cada clip.</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="ap-btn ap-btn-primary ap-btn-sm" onClick={() => setConstructor(true)}><Scissors size={13} /> Elegir los clips en la transcripción</button></div>
          <ProponeClips t={t} onCambio={onCambio} />
        </div>
      )}
      {constructor && <PantallaCompleta titulo={'Elegir clips · ' + (t.nombre_archivo || 'entrevista')} onCerrar={() => setConstructor(false)}><ConstructorClips t={t} onCambio={() => { setConstructor(false); onCambio(); }} /></PantallaCompleta>}
      {t.estado === 'listo' && t.url && (
        <div style={{ marginTop: 10 }}>
          <video ref={vref} src={t.url_movil || t.url} controls playsInline style={{ width: '100%', maxWidth: 300, borderRadius: 10, background: '#000', display: 'block' }} />
          <PaqueteRedes t={t} />
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <a className="ap-btn ap-btn-sm" href={t.url_descarga || t.url} download rel="noreferrer"><Download size={13} /> Descargar</a>
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
      {t.estado === 'listo' && ['voz', 'bruto'].includes(t.tipo) && t.resultado && !(t.autorevision && t.autorevision.puntuacion != null) && (
        <div style={{ marginTop: 10 }}>
          {t.pedir_puntuacion ? <div style={mut}><Loader2 size={13} /> La IA está revisando este vídeo (1-2 minutos)…</div> : <button className="ap-btn ap-btn-sm" title="La IA ve el vídeo y le pone nota, con lo que falla" onClick={async () => { try { await api.post('/estudio-video/trabajos/' + t.id + '/puntuar'); onCambio(); } catch (e) { setErr(e?.response?.data?.error || 'No se pudo pedir la puntuación'); } }}><Wand2 size={13} /> Puntuar este vídeo con la IA</button>}
        </div>
      )}
      {t.estado === 'listo' && t.autorevision && typeof t.autorevision === 'object' && t.autorevision.puntuacion != null && (
        <div style={{ marginTop: 10, padding: 10, borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: '1.2rem' }}>{t.autorevision.puntuacion}<span style={mut}>/100</span></span>
            <span style={mut}>Revisión de la IA{t.autorevision.corregidoPorIA ? ' · versión corregida automáticamente (antes ' + t.autorevision.antes + ')' : ''}</span>
          </div>
          {t.autorevision.resumen && <div style={{ ...mut, marginTop: 4 }}>{t.autorevision.resumen}</div>}
          {(t.autorevision.problemas || []).map((p, i) => <div key={i} style={{ fontSize: '0.82rem', marginTop: 3 }}>• <strong>{p.tipo}:</strong> {p.detalle}</div>)}
          {t.autorevision.intento && <div style={{ ...mut, marginTop: 6 }}>{t.autorevision.intento}</div>}
        </div>
      )}
      {t.estado === 'listo' && t.analisis_edicion?.analisis && (() => {
        const an = t.analisis_edicion.analisis, ef = t.analisis_edicion.efectos || [], il = t.analisis_edicion.ilustraciones || [];
        return (
          <details style={{ marginTop: 10, padding: 10, borderRadius: 10, border: '1px solid rgba(205,187,167,0.35)', background: 'rgba(205,187,167,0.05)' }}>
            <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: '1.2rem' }}>{an.potencial ?? '—'}<span style={mut}>/100 potencial viral</span></span>
              <span style={mut}>🎬 Lo que piensa el editor</span>
            </summary>
            <div style={{ marginTop: 8, fontSize: '0.85rem', lineHeight: 1.5 }}>
              {an.tema && <div><strong>De qué va:</strong> {an.tema}</div>}
              {an.gancho && <div style={{ marginTop: 3 }}><strong>Gancho:</strong> {an.gancho}</div>}
              {an.por_que && <div style={{ marginTop: 3 }}><strong>Por qué esa nota:</strong> {an.por_que}</div>}
              {(an.puntos_fuertes || []).length > 0 && <div style={{ marginTop: 6 }}><strong style={{ color: '#7ccf8f' }}>Puntos fuertes</strong>{an.puntos_fuertes.map((p, i) => <div key={i}>+ {p}</div>)}</div>}
              {(an.puntos_flojos || []).length > 0 && <div style={{ marginTop: 6 }}><strong style={{ color: '#f2c46d' }}>Puntos flojos</strong>{an.puntos_flojos.map((p, i) => <div key={i}>– {p}</div>)}</div>}
              {(an.mejoras || []).length > 0 && <div style={{ marginTop: 6 }}><strong>Qué mejoraría</strong>{an.mejoras.map((p, i) => <div key={i}>→ {p}</div>)}</div>}
              {(an.arco || []).length > 0 && <div style={{ marginTop: 6 }}><strong>Historia:</strong> {an.arco.map(a => a.momento).join(' → ')}</div>}
              {ef.length > 0 && <div style={{ marginTop: 6 }}><strong>Efectos elegidos ({t.analisis_edicion.intensidad || 'media'}):</strong>{ef.map((e, i) => <div key={i} style={mut}>{e.t}s · {e.tipo}{e.texto ? ' «' + e.texto + '»' : ''} — {e.motivo}</div>)}</div>}
              {il.length > 0 && <div style={{ marginTop: 6 }}><strong>Ilustraciones:</strong>{il.map((e, i) => <div key={i} style={mut}>{e.t}s · {e.motivo}</div>)}</div>}
            </div>
          </details>
        );
      })()}
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
          <SubirRecursos onSubidos={(n) => setRecs(r => [...r, ...n])} />
          <div style={{ ...mut, marginBottom: 4 }}>Guion (opcional): pégalo o cámbialo aquí.</div>
          <textarea className="ap-field-input" style={{ width: '100%', minHeight: 80, marginBottom: 8 }} value={guionReg} onChange={e => setGuionReg(e.target.value)} placeholder="Guion del vídeo o preguntas de la entrevista" />
          {t.tipo !== 'clips' && <CopiarSeleccion trabajos={trabajosTodos} onCopiar={(x) => { setAsigR(asigDesdeReparto(x, guionReg)); if (x.recursos && x.recursos.length) setRecs(x.recursos); }} />}
          {t.tipo !== 'clips' && <Desglose guion={guionReg} asig={asigR} setAsig={setAsigR} trans={t.transcripcion} />}
          <div style={{ ...mut, marginBottom: 4 }}>Dinamismo (cortes más rápidos, zooms y efectos de sonido)</div>
          <select className="ap-field-input" style={{ width: '100%', marginBottom: 10 }} value={dinR} onChange={e => setDinR(Number(e.target.value))}><option value={0}>Como el formato</option><option value={1}>Dinámico</option><option value={2}>Muy dinámico (generar dopamina)</option></select>
          <div style={{ ...mut, marginBottom: 4 }}>Canción de fondo</div>
          <select className="ap-field-input" style={{ width: '100%', marginBottom: 10 }} value={musR} onChange={e => setMusR(e.target.value)}><option value="auto">Automática (la IA elige la que mejor encaje)</option><option value="animada">La más animada (más pulsos por minuto)</option><option value="ninguna">Sin música</option>{musica.map(p => <option key={p.nombre} value={p.nombre}>{p.nombre}{p.bpm ? ' · ' + Math.round(p.bpm) + ' bpm' : ''}</option>)}</select>
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
          <SelectorEstilo estilos={estilosR} formato={formatos.find(f => f.id === fmt)} valor={estiloR} onCambio={setEstiloR} />
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
  const cambia2 = (A, B) => { guarda(); setBloques(bs => bs.map((b, i) => { const o = i === A ? bs[B] : i === B ? bs[A] : null; return o ? { ...b, videoInt: o.videoInt, driveId: o.driveId, nombre: o.nombre, esImagen: o.esImagen, durClip: o.durClip, desde: o.desde, nuevo: o.nuevo } : b; })); };
  const lienzo = useRef(null), dragB = useRef(null), acabaArrastrar = useRef(false); const [destino, setDestino] = useState(null);
  const bloqueEn = (x) => { const r = lienzo.current?.getBoundingClientRect(); if (!r) return null; const s = (x - r.left) / pps; let k = 0; bloques.forEach((b2, i) => { if (s >= b2.t0) k = i; }); return k; };
  const iniciaArrastre = (k, e) => { if (e.button > 0) return; dragB.current = { k, x0: e.clientX, mov: false }; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* sin captura */ } };
  const muevenArrastre = (e) => { const a = dragB.current; if (!a) return; if (!a.mov && Math.abs(e.clientX - a.x0) > 8) a.mov = true; if (a.mov) setDestino(bloqueEn(e.clientX)); };
  const sueltaArrastre = (e) => { const a = dragB.current; dragB.current = null; if (!a || !a.mov) { setDestino(null); return; } const B = bloqueEn(e.clientX); setDestino(null); acabaArrastrar.current = true; setTimeout(() => { acabaArrastrar.current = false; }, 0); if (B !== null && B !== a.k) { cambia2(a.k, B); setSel(B); } };
  const clicBloque = (k) => {
    if (acabaArrastrar.current) return;
    if (intercambio !== null && intercambio !== k) { cambia2(intercambio, k); setIntercambio(null); setSel(k); return; }
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
      <div style={{ ...mut, marginBottom: 8 }}>Pulsa un bloque para elegirlo; arrástralo encima de otro para intercambiarlos. Arrastra el borde derecho de un bloque para alargarlo o acortarlo. La línea roja es el vídeo: pulsa en la regla o reproduce para moverla, y "Dividir" corta el bloque en ese punto.</div>
      <div style={{ overflowX: 'auto', paddingBottom: 6 }}>
        <div ref={lienzo} style={{ position: 'relative', width: W, height: grande ? 190 : 130, userSelect: 'none' }}>
          <div onClick={e => { const r = e.currentTarget.getBoundingClientRect(); ir(Math.max(0, Math.min(total, (e.clientX - r.left) / pps))); }} style={{ position: 'absolute', left: 0, top: 0, width: W, height: 22, cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.15)' }}>
            {marcas.map(m => <div key={m} style={{ position: 'absolute', left: m * pps, top: 0, height: 22, borderLeft: '1px solid rgba(255,255,255,0.25)', paddingLeft: 3, fontSize: 10, color: 'rgba(255,255,255,0.55)' }}>{fmtDur(Math.round(m))}</div>)}
          </div>
          {bloques.map((x, k) => {
            const w = Math.max(10, (fin(k) - x.t0) * pps - 2), activo = k === sel, id = x.nuevo?.id || x.driveId;
            return (
              <div key={x.id} onClick={() => clicBloque(k)} onPointerDown={e => iniciaArrastre(k, e)} onPointerMove={muevenArrastre} onPointerUp={sueltaArrastre} onPointerCancel={() => { dragB.current = null; setDestino(null); }} title="Arrastra el bloque sobre otro para intercambiarlos" style={{ position: 'absolute', left: x.t0 * pps, top: 28, width: w, height: grande ? 150 : 92, borderRadius: 8, overflow: 'hidden', cursor: 'grab', touchAction: 'pan-y', background: '#1d1b19', border: '2px solid ' + (destino === k && dragB.current && dragB.current.k !== k ? '#7ccf8f' : activo ? '#f2c46d' : intercambio === k ? '#7ccf8f' : 'rgba(255,255,255,0.18)'), boxSizing: 'border-box' }}>
                {id && <img src={urlMiniatura(id)} alt="" loading="lazy" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.55 }} onError={e => { e.currentTarget.style.visibility = 'hidden'; }} />}
                <div style={{ position: 'relative', padding: '3px 5px', fontSize: 10, lineHeight: 1.25, textShadow: '0 1px 2px #000' }}><strong>{k + 1}</strong>{w > 70 ? ' · ' + (x.nuevo ? x.nuevo.nombre : x.nombre || 'clip') : ''}{w > 110 && <div style={{ opacity: 0.85 }}>{(fin(k) - x.t0).toFixed(1)} s</div>}</div>
                {k < n - 1 && <div onPointerDown={e => { e.stopPropagation(); iniciaBorde(k, e); }} onPointerMove={muevelBorde} onPointerUp={sueltaBorde} onClick={e => e.stopPropagation()} title="Arrastra para alargar o acortar" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 9, cursor: 'col-resize', background: 'rgba(242,196,109,0.7)' }} />}
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

// ---------- Ideas de contenido y calendario (departamento de redes) ----------
const ESTADOS_IDEA = { idea: 'Idea', grabar: 'A grabar', editando: 'Editando', publicado: 'Publicado', descartada: 'Descartada' };
function Guionizador() {
  const [tema, setTema] = useState(''), [tipo, setTipo] = useState('reel'), [modo, setModo] = useState('camara'), [dur, setDur] = useState(30), [cargando, setCargando] = useState(false), [res, setRes] = useState(null), [err, setErr] = useState(''), [copiado, setCopiado] = useState(false);
  const generar = async () => { setErr(''); setCargando(true); setRes(null); try { const r = await api.post('/estudio-video/guionizador', { tema, tipo, modo, duracion: dur }); setRes(r.data); } catch (e) { setErr(e?.response?.data?.error || 'No se pudo escribir el guion'); } setCargando(false); };
  const copia = (txt) => { try { navigator.clipboard.writeText(txt); setCopiado(true); setTimeout(() => setCopiado(false), 1800); } catch { /* sin portapapeles */ } };
  return (
    <div>
      <div style={card}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Guionizador de reels e historias</div>
        <div style={{ ...mut, marginBottom: 8 }}>Dile de qué va y escribe el guion completo con el manual de redes y tus reglas de marca. El texto «hablado» lo copias y lo pegas en la caja Guion del Estudio de vídeo.</div>
        <textarea className="ap-field-input" style={{ width: '100%', minHeight: 60, marginBottom: 8 }} value={tema} onChange={e => setTema(e.target.value)} placeholder="Ej.: error común al elegir máquinas para un gimnasio pequeño, o: la obra de Rivas de principio a fin" />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <select className="ap-field-input" value={tipo} onChange={e => setTipo(e.target.value)}><option value="reel">Reel</option><option value="historia">Historia (con arco)</option></select>
          <select className="ap-field-input" value={modo} onChange={e => setModo(e.target.value)}><option value="camara">Víctor a cámara</option><option value="entrevista">Entrevista Dani y Víctor</option><option value="voz">Voz en off sobre obra</option><option value="midia">Acompáñame / mi día</option></select>
          <select className="ap-field-input" value={dur} onChange={e => setDur(Number(e.target.value))}>{[15, 30, 45, 60, 90].map(n => <option key={n} value={n}>{n} s</option>)}</select>
        </div>
        <button className="ap-btn ap-btn-primary" disabled={!tema.trim() || cargando} onClick={generar}>{cargando ? <><Loader2 size={14} /> Escribiendo…</> : <><Wand2 size={14} /> Escribir guion</>}</button>
        {err && <div style={{ color: '#ff8a80', marginTop: 8 }}>{err}</div>}
      </div>
      {res && (
        <div style={{ ...card, marginTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{res.titulo}</div>
          {res.gancho && <div style={{ marginBottom: 8 }}><span style={mut}>Gancho en pantalla: </span><strong>{res.gancho}</strong></div>}
          <div style={{ ...mut, marginBottom: 4 }}>Texto hablado (para pegar como guion)</div>
          <div style={{ whiteSpace: 'pre-wrap', padding: 10, borderRadius: 8, background: 'rgba(255,255,255,0.05)', marginBottom: 8 }}>{res.hablado}</div>
          <button className="ap-btn ap-btn-sm" onClick={() => copia(res.hablado)}>{copiado ? <><Check size={13} /> Copiado</> : 'Copiar guion hablado'}</button>
          {(res.escenas || []).length > 0 && <div style={{ marginTop: 12 }}><div style={{ ...mut, marginBottom: 4 }}>Escena por escena</div>{res.escenas.map((e, i) => <div key={i} style={{ fontSize: '0.85rem', marginBottom: 6 }}><strong>{e.seg} s</strong> · {e.que_se_ve}{e.texto_pantalla ? <> · <em>pantalla: {e.texto_pantalla}</em></> : null}{e.dice ? <div style={mut}>“{e.dice}”</div> : null}</div>)}</div>}
          {res.que_grabar && <div style={{ marginTop: 8 }}><span style={mut}>Qué grabar: </span>{res.que_grabar}</div>}
          {res.cierre && <div style={{ marginTop: 6 }}><span style={mut}>Cierre: </span>{res.cierre}</div>}
        </div>
      )}
    </div>
  );
}

function PestanaIdeas() {
  const [ideas, setIdeas] = useState(null), [tema, setTema] = useState(''), [cant, setCant] = useState(6), [gen, setGen] = useState(false), [err, setErr] = useState(''), [abierta, setAbierta] = useState(null), [filtro, setFiltro] = useState('activas');
  const cargar = useCallback(() => api.get('/estudio-video/ideas').then(r => setIdeas(r.data.ideas || [])).catch(() => setIdeas([])), []);
  useEffect(() => { cargar(); }, [cargar]);
  const generar = async () => { setErr(''); setGen(true); try { const r = await api.post('/estudio-video/ideas/generar', { tema, cantidad: cant }, { timeout: 240000 }); setIdeas(r.data.ideas || []); } catch (e) { setErr(e?.response?.data?.error || (e?.code === 'ECONNABORTED' ? 'Ha tardado demasiado, prueba con menos ideas.' : 'No se pudieron generar (' + (e?.message || 'sin conexión con el servidor') + ')')); } setGen(false); };
  const cambia = async (x, parche) => { setIdeas(l => l.map(i => (i.id === x.id ? { ...i, ...parche } : i))); try { await api.put('/estudio-video/ideas/' + x.id, parche); } catch { cargar(); } };
  const borra = async (x) => { if (!window.confirm('¿Borrar esta idea?')) return; setIdeas(l => l.filter(i => i.id !== x.id)); try { await api.delete('/estudio-video/ideas/' + x.id); } catch { cargar(); } };
  const copia = (txt) => { try { navigator.clipboard.writeText(txt); } catch { /* sin portapapeles */ } };
  if (ideas === null) return <div style={mut}>Cargando…</div>;
  const hoy = new Date().toISOString().slice(0, 10);
  const agenda = ideas.filter(i => i.fecha && i.estado !== 'descartada' && i.estado !== 'publicado');
  const lista = ideas.filter(i => (filtro === 'activas' ? !['descartada', 'publicado'].includes(i.estado) : filtro === 'todas' ? true : i.estado === filtro)).slice().reverse();
  const dias = Array.from({ length: 14 }, (_, k) => { const d = new Date(Date.now() + k * 86400000); const iso = d.toISOString().slice(0, 10); return { iso, n: d.getDate(), nombre: d.toLocaleDateString('es-ES', { weekday: 'short' }), items: agenda.filter(x => x.fecha === iso) }; });
  const atrasadas = agenda.filter(x => x.fecha < hoy);
  const colorEstado = { grabar: 'ambar', editando: 'arena', publicado: 'verde', descartada: 'rojo' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="rd-card" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: '1 1 320px' }}><h3>✨ Ideas con gancho</h3><div className="rd-sub" style={{ marginTop: 2 }}>Dime un tema o déjalo en blanco.</div></div>
        <input className="ap-field-input" style={{ flex: '2 1 280px' }} placeholder="Tema o proyecto: home gym en Rivas, suelos…" value={tema} onChange={e => setTema(e.target.value)} />
        <select className="ap-field-input" value={cant} onChange={e => setCant(Number(e.target.value))}>{[3, 6, 10].map(n => <option key={n} value={n}>{n} ideas</option>)}</select>
        <button className="rd-btn pri" disabled={gen} onClick={generar}><Wand2 size={15} /> {gen ? 'Pensando…' : 'Generar ideas'}</button>
        {err && <div className="ap-error" style={{ flexBasis: '100%' }}>{err}</div>}
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}><h3 style={{ margin: 0 }}>📅 Próximos 14 días</h3>{atrasadas.length > 0 && <span className="rd-chip rojo">{atrasadas.length} atrasada{atrasadas.length > 1 ? 's' : ''}</span>}</div>
        <div className="rd-days">
          {dias.map(d => <div key={d.iso} className={'rd-day' + (d.iso === hoy ? ' hoy' : '') + (!d.items.length ? ' vacio' : '')}><div className="d">{d.nombre}{d.iso === hoy ? ' · hoy' : ''}</div><div className="n">{d.n}</div>{d.items.slice(0, 2).map(x => <div key={x.id} className="t">{x.titulo}</div>)}{d.items.length > 2 && <div className="t" style={{ opacity: 0.6 }}>+{d.items.length - 2} más</div>}</div>)}
        </div>
      </div>
      <div className="rd-tabs" style={{ alignSelf: 'flex-start' }}>
        {['activas', 'grabar', 'editando', 'publicado', 'descartada', 'todas'].map(fl => <button key={fl} className={'rd-tab' + (filtro === fl ? ' on' : '')} style={{ padding: '7px 14px' }} onClick={() => setFiltro(fl)}>{fl === 'activas' ? 'Activas' : fl === 'todas' ? 'Todas' : ESTADOS_IDEA[fl]}</button>)}
      </div>
      {lista.length === 0 && <div className="rd-card" style={{ alignItems: 'center', textAlign: 'center', padding: 36 }}><div style={{ fontSize: '2rem' }}>💡</div><div style={mut}>Aún no hay ideas aquí. Pulsa «Generar ideas».</div></div>}
      <div className="rd-grid">
        {lista.map(i => (
          <div key={i.id} className="rd-card">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className={'rd-chip ' + (colorEstado[i.estado] || '')}>{ESTADOS_IDEA[i.estado]}</span>
              {i.formato && <span className="rd-chip">{i.formato}</span>}
              {i.plataforma && <span className="rd-chip">{i.plataforma}</span>}
            </div>
            <div className="rd-gancho">“{i.gancho || i.titulo}”</div>
            {i.gancho && <div style={{ ...mut, fontSize: '0.84rem' }}>{i.titulo}</div>}
            {abierta === i.id && (
              <div>
                <div style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap', padding: 10, borderRadius: 10, background: 'rgba(255,255,255,0.05)', lineHeight: 1.5 }}>{i.guion}</div>
                {i.que_grabar && <div style={{ ...mut, marginTop: 6 }}><strong>Qué grabar:</strong> {i.que_grabar}</div>}
                {i.razon && <div style={{ ...mut, marginTop: 6 }}>{i.razon}</div>}
                <textarea className="ap-field-input" style={{ width: '100%', minHeight: 50, marginTop: 8 }} placeholder="Notas" defaultValue={i.notas || ''} onBlur={e => { if (e.target.value !== (i.notas || '')) cambia(i, { notas: e.target.value }); }} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'auto' }}>
              <select className="ap-field-input" style={{ flex: '1 1 110px' }} value={i.estado} onChange={e => cambia(i, { estado: e.target.value })}>{Object.entries(ESTADOS_IDEA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <input className="ap-field-input" style={{ flex: '1 1 130px' }} type="date" value={i.fecha || ''} onChange={e => cambia(i, { fecha: e.target.value || null })} />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="rd-btn" onClick={() => setAbierta(abierta === i.id ? null : i.id)}>{abierta === i.id ? 'Ocultar guion' : 'Ver guion'}</button>
              <button className="rd-btn" onClick={() => copia(i.titulo + '\n\n' + i.gancho + '\n\n' + i.guion)}>Copiar</button>
              <button className="rd-btn" onClick={() => borra(i)} title="Borrar"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

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
      <div style={{ ...mut, marginTop: 4 }}>Es un texto base que escribimos al montar la herramienta (tono, qué evitar), más lo que tú añadas aquí. Todavía NO se ha sacado de tus vídeos. La IA lo tiene en cuenta al elegir y titular.</div>
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

// Chat directo con el editor: aprende de lo que Víctor le dice y lo aplica solo en los vídeos siguientes
function PestanaEditor({ trabajos }) {
  const [mensajes, setMensajes] = useState([]), [hechos, setHechos] = useState([]), [texto, setTexto] = useState(''), [trabajo, setTrabajo] = useState(''), [trabaja, setTrabaja] = useState(false), [error, setError] = useState('');
  const fin = useRef(null);
  useEffect(() => { api.get('/estudio-video/editor').then(r => { setHechos(r.data.hechos || []); setMensajes((r.data.charla || []).map(m => ({ rol: m.rol, texto: m.texto, cambios: m.cambios || [] }))); }).catch(() => {}); }, []);
  useEffect(() => { fin.current?.scrollIntoView({ block: 'end' }); }, [mensajes, trabaja]);
  const enviar = async () => {
    const m = texto.trim(); if (!m || trabaja) return; setTexto(''); setError(''); setTrabaja(true); setMensajes(l => [...l, { rol: 'yo', texto: m }]);
    try { const r = await api.post('/estudio-video/editor/chat', { mensaje: m, trabajo: trabajo || undefined }, { timeout: 120000 }); setMensajes(l => [...l, { rol: 'ia', texto: r.data.respuesta, cambios: r.data.cambios || [] }]); setHechos(r.data.hechos || []); }
    catch (e) { setError(e.response?.data?.error || 'No se pudo hablar con el editor'); } finally { setTrabaja(false); }
  };
  const olvida = async (id) => { try { const r = await api.delete('/estudio-video/editor/hechos/' + id); setHechos(r.data.hechos || []); } catch { setError('No se pudo borrar'); } };
  const recientes = (trabajos || []).filter(t => t.estado === 'listo').slice(0, 25);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 12 }}>
      <div style={card}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>💬 Habla con el editor</div>
        <div style={{ ...mut, marginBottom: 8 }}>Dile lo que te gusta y lo que no, pídele que cambie un estilo o pregúntale por un vídeo. Lo que le cuentes lo aprende y lo aplica solo en los vídeos siguientes, sin tocar nada más.</div>
        <select className="ap-field-input" style={{ width: '100%', marginBottom: 8 }} value={trabajo} onChange={e => setTrabajo(e.target.value)}><option value="">Hablar en general</option>{recientes.map(t => <option key={t.id} value={t.id}>Sobre: {(t.nombre_archivo || t.id).slice(0, 60)}</option>)}</select>
        <div style={{ maxHeight: 360, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
          {!mensajes.length && <div style={mut}>Prueba: «los flashes solo en el remate», «me encanta cuando pone la cifra en grande», «los reels de Dani tienen que empezar con la pregunta» o «¿qué le falta a este vídeo?».</div>}
          {mensajes.map((m, i) => (
            <div key={i} style={{ alignSelf: m.rol === 'yo' ? 'flex-end' : 'flex-start', maxWidth: '92%', background: m.rol === 'yo' ? 'rgba(205,187,167,0.18)' : 'rgba(255,255,255,0.06)', borderRadius: 10, padding: '6px 10px', fontSize: '0.88rem', whiteSpace: 'pre-wrap' }}>
              {m.texto}
              {(m.cambios || []).map((c, k) => <div key={k} style={{ ...mut, marginTop: 4, color: '#7ccf8f' }}>✓ {c}</div>)}
            </div>
          ))}
          {trabaja && <div style={mut}>El editor está pensando…</div>}
          <div ref={fin} />
        </div>
        {error && <div className="ap-error" style={{ marginBottom: 6 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 6 }}>
          <textarea className="ap-field-input" rows={2} style={{ flex: 1 }} value={texto} placeholder="Escríbele al editor… (Intro envía)" onChange={e => setTexto(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }} />
          <button className="ap-btn ap-btn-primary ap-btn-sm" disabled={trabaja || !texto.trim()} onClick={enviar}>Enviar</button>
        </div>
      </div>
      <div style={card}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>🧠 Lo que el editor ha aprendido de ti</div>
        <div style={{ ...mut, marginBottom: 8 }}>Son tus preferencias; las usa en cada vídeo nuevo. Borra las que ya no valgan.</div>
        {!hechos.length && <div style={mut}>Todavía nada. Cuéntale cómo quieres tus vídeos.</div>}
        {hechos.map(h => <div key={h.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '5px 0', borderTop: '1px solid rgba(255,255,255,0.07)', fontSize: '0.86rem' }}><span style={{ flex: 1 }}>{h.texto}<span style={{ ...mut, marginLeft: 6 }}>{h.fecha}</span></span><button className="ap-btn ap-btn-sm" title="Olvidar" onClick={() => olvida(h.id)}><Trash2 size={12} /></button></div>)}
      </div>
    </div>
  );
}
function EstilosPestana() { const [estilos, recarga] = useEstilos(); return estilos.length ? <div style={{ marginTop: 12 }}><Estilos estilos={estilos} onCambio={recarga} /></div> : null; }
function Formatos({ formatos, onCambio }) {
  const [estilos] = useEstilos();
  const [sel, setSel] = useState(null), [f, setF] = useState(null), [msg, setMsg] = useState('');
  useEffect(() => { const x = formatos.find(y => y.id === (sel || formatos[0]?.id)); if (x) { setF(JSON.parse(JSON.stringify(x))); setSel(x.id); } }, [formatos, sel]);
  if (!f) return null;
  const r = f.receta || {}; const setR = (k, v) => setF({ ...f, receta: { ...r, [k]: v } });
  const guardar = async () => { try { await api.put('/estudio-video/formatos/' + f.id, f); setMsg('Guardado'); onCambio(); setTimeout(() => setMsg(''), 1500); } catch (e) { setMsg(e?.response?.data?.error || 'No se pudo guardar'); } };
  const duplicar = async () => { const n = window.prompt('Nombre del nuevo formato'); if (!n) return; try { const { data } = await api.post('/estudio-video/formatos', { nombre: n, copiar_de: f.id }); setSel(data.formato.id); onCambio(); } catch { setMsg('No se pudo crear'); } };
  const borrar = async () => { if (!window.confirm('¿Borrar el formato "' + f.nombre + '"?')) return; try { await api.delete('/estudio-video/formatos/' + f.id); setSel(null); onCambio(); } catch (e) { setMsg(e?.response?.data?.error || 'No se pudo borrar'); } };
  return (
    <div style={card}>
      <CajaReglas />
      <div style={{ fontWeight: 700, marginBottom: 2 }}>Formatos</div>
      <div style={{ ...mut, marginBottom: 10 }}>El formato es EL TIPO de vídeo: qué se hace con el material (entrevista larga → varios reels, voz en off con tus clips, una toma limpia…). Cómo se ve y se mueve lo decide el estilo de edición, que eliges aquí o al crear cada vídeo.</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <select className="ap-field-input" style={{ flex: 1, minWidth: 160 }} value={f.id} onChange={e => setSel(e.target.value)}>{formatos.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select>
        <button className="ap-btn ap-btn-sm" onClick={duplicar}><Plus size={13} /> Duplicar como nuevo</button><button className="ap-btn ap-btn-sm" onClick={borrar}><Trash2 size={13} /></button>
      </div>
      <Campo etiqueta="Nombre"><input className="ap-field-input" style={{ width: '100%' }} value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} /></Campo>
      <Campo etiqueta="Descripción"><textarea className="ap-field-input" style={{ width: '100%', minHeight: 50 }} value={f.descripcion || ''} onChange={e => setF({ ...f, descripcion: e.target.value })} /></Campo>
      <Campo etiqueta="Estilo de edición por defecto"><select className="ap-field-input" style={{ width: '100%' }} value={f.estilo || f.id} onChange={e => setF({ ...f, estilo: e.target.value })}>{estilos.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}</select></Campo>
      <Campo etiqueta="Criterio de montaje para la IA (cómo debe pensar este formato)"><textarea className="ap-field-input" style={{ width: '100%', minHeight: 70 }} value={f.notas || ''} onChange={e => setF({ ...f, notas: e.target.value })} placeholder="Ej.: serio, sin humor; empieza siempre con un plano potente; enseña producto en detalle cuando se hable de máquinas…" /></Campo>
      <div style={{ display: 'flex', gap: 16, margin: '4px 0 12px', flexWrap: 'wrap', fontSize: '0.85rem' }}>
        <label><input type="checkbox" checked={!!r.preguntaSoloEscrita} onChange={e => setR('preguntaSoloEscrita', e.target.checked)} /> Entrevistas: la pregunta solo sale escrita (no se oye al entrevistador)</label>
        <label><input type="checkbox" checked={!!r.collage} onChange={e => setR('collage', e.target.checked)} /> Collage: en cortes alternos, dos clips a la vez (uno arriba y otro abajo)</label>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><button className="ap-btn ap-btn-primary ap-btn-sm" onClick={guardar}><Check size={13} /> Guardar formato</button><span style={mut}>{msg}</span></div>
    </div>
  );
}

function Estilos({ estilos: formatos, onCambio }) {
  const [sel, setSel] = useState(null), [f, setF] = useState(null), [msg, setMsg] = useState('');
  useEffect(() => { const x = formatos.find(y => y.id === (sel || formatos[0]?.id)); if (x) { setF(JSON.parse(JSON.stringify(x))); setSel(x.id); } }, [formatos, sel]);
  if (!f) return null;
  const r = f.receta || {}; const setR = (k, v) => setF({ ...f, receta: { ...r, [k]: v } }); const setS = (k, v) => setF({ ...f, receta: { ...r, subs: { ...(r.subs || {}), [k]: v } } });
  const guardar = async () => { try { await api.put('/estudio-video/estilos/' + f.id, f); setMsg('Guardado'); onCambio(); setTimeout(() => setMsg(''), 1500); } catch (e) { setMsg(e?.response?.data?.error || 'No se pudo guardar'); } };
  const duplicar = async () => { const n = window.prompt('Nombre del nuevo estilo'); if (!n) return; try { const { data } = await api.post('/estudio-video/estilos', { nombre: n, copiar_de: f.id }); setSel(data.estilo.id); onCambio(); } catch { setMsg('No se pudo crear'); } };
  const borrar = async () => { if (!window.confirm('¿Borrar el estilo "' + f.nombre + '"?')) return; try { await api.delete('/estudio-video/estilos/' + f.id); setSel(null); onCambio(); } catch (e) { setMsg(e?.response?.data?.error || 'No se pudo borrar'); } };
  const num = (v, fn) => <input className="ap-field-input" type="number" step="any" style={{ width: '100%' }} value={v ?? ''} onChange={e => fn(e.target.value === '' ? '' : Number(e.target.value))} />;
  return (
    <div style={card}>
      <div style={{ fontWeight: 700, marginBottom: 2 }}>Estilos de edición</div>
      <div style={{ ...mut, marginBottom: 10 }}>Cómo se ve y se mueve un vídeo: ritmo de cortes, zooms, subtítulos, música… Cualquier formato puede usar cualquier estilo. Pon el nombre que quieras y duplícalo para probar variantes.</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <select className="ap-field-input" style={{ flex: 1, minWidth: 160 }} value={f.id} onChange={e => setSel(e.target.value)}>{formatos.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select>
        <button className="ap-btn ap-btn-sm" onClick={duplicar}><Plus size={13} /> Duplicar como nuevo</button><button className="ap-btn ap-btn-sm" onClick={borrar}><Trash2 size={13} /></button>
      </div>
      <Campo etiqueta="Nombre"><input className="ap-field-input" style={{ width: '100%' }} value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} /></Campo>
      <Campo etiqueta="Descripción"><textarea className="ap-field-input" style={{ width: '100%', minHeight: 50 }} value={f.descripcion || ''} onChange={e => setF({ ...f, descripcion: e.target.value })} /></Campo>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10 }}>
        <Campo etiqueta="Corte mínimo (s)">{num(r.corte?.min, v => setR('corte', { ...r.corte, min: v }))}</Campo>
        <Campo etiqueta="Corte máximo (s)">{num(r.corte?.max, v => setR('corte', { ...r.corte, max: v }))}</Campo>
        <Campo etiqueta="Zoom lento (1 = sin)">{num(r.zoomFinal, v => setR('zoomFinal', v))}</Campo>
        <Campo etiqueta="Volumen whoosh (0-0.5)">{num(r.whoosh, v => setR('whoosh', v))}</Campo>
        <Campo etiqueta="Palabras por subtítulo">{num(r.subs?.palabrasPorBloque, v => setS('palabrasPorBloque', v))}</Campo>
        <Campo etiqueta="Tamaño subtítulo">{num(r.subs?.tam, v => setS('tam', v))}</Campo>
        <Campo etiqueta="Altura subtítulo">{num(r.subs?.margenV, v => setS('margenV', v))}</Campo>
        <Campo etiqueta="Estilo de subtítulos"><select className="ap-field-input" style={{ width: '100%' }} value={r.estiloSubs || 'normal'} onChange={e => setR('estiloSubs', e.target.value)}><option value="normal">Normal (aparecen por frases)</option><option value="karaoke">Karaoke (se resalta la palabra que suena)</option><option value="caja">Caja (texto sobre una tarjeta oscura)</option><option value="palabra">Palabra a palabra (una cada vez, con rebote)</option></select></Campo>
        <MuestraEstilo estilo={r.estiloSubs || 'normal'} fuente={r.fuente || 'Montserrat'} acento={r.acento || '#E3D2B8'} />
        <Campo etiqueta="Tipografía de subtítulos"><select className="ap-field-input" style={{ width: '100%' }} value={r.fuente || 'Montserrat'} onChange={e => setR('fuente', e.target.value)}>{['Montserrat', 'Rubik', 'Anton', 'Bebas Neue', 'Archivo Black', 'Oswald', 'Staatliches', 'Russo One', 'Righteous', 'Playfair Display', 'Abril Fatface', 'Cinzel'].map(n => <option key={n}>{n}</option>)}</select></Campo>
        <Campo etiqueta="Volumen música (dB, -19 típico)">{num(r.musica?.volumen ?? -19, v => setR('musica', { volumen: v }))}</Campo>
        <Campo etiqueta="Zoom de encuadre (1 = sin)">{num(r.encuadreZoom, v => setR('encuadreZoom', v))}</Campo>
        <Campo etiqueta="Pausa que se corta (s)">{num(r.pausa, v => setR('pausa', v))}</Campo>
        <Campo etiqueta="Color de acento"><input type="color" value={r.acento || '#F2C46D'} onChange={e => setR('acento', e.target.value)} style={{ width: '100%', height: 34, background: 'none', border: 'none' }} /></Campo>
      </div>
      <div style={{ display: 'flex', gap: 16, margin: '4px 0 12px', flexWrap: 'wrap', fontSize: '0.85rem' }}>
        <label><input type="checkbox" checked={!!r.flash} onChange={e => setR('flash', e.target.checked)} /> Destello blanco en cada corte (no recomendado)</label>
        <label><input type="checkbox" checked={r.titulo !== false} onChange={e => setR('titulo', e.target.checked)} /> Título arriba</label>
        <label><input type="checkbox" checked={r.barra !== false} onChange={e => setR('barra', e.target.checked)} /> Barra de progreso</label>
        <label><input type="checkbox" checked={r.mayusculas !== false} onChange={e => setR('mayusculas', e.target.checked)} /> Subtítulos en mayúsculas</label>
        <label><input type="checkbox" checked={r.resaltar !== false} onChange={e => setR('resaltar', e.target.checked)} /> Resaltar palabras clave</label>
        <label><input type="checkbox" checked={!!r.encuadre} onChange={e => setR('encuadre', e.target.checked)} /> Centrar en la cara</label>
        <label><input type="checkbox" checked={!!r.subsBajoCara} onChange={e => setR('subsBajoCara', e.target.checked)} /> Subtítulos bajo la cara</label>
        <label><input type="checkbox" checked={!!r.graficos} onChange={e => setR('graficos', e.target.checked)} /> Gráficos animados (cifras)</label>
        <label><input type="checkbox" checked={!!r.horas} onChange={e => setR('horas', e.target.checked)} /> Etiquetas de hora (9:00…)</label>
        <label><input type="checkbox" checked={!!r.motion} onChange={e => setR('motion', e.target.checked)} /> Movimiento variado en los planos (acercar, alejar y barridos)</label>
        <label><input type="checkbox" checked={!!r.etiquetas} onChange={e => setR('etiquetas', e.target.checked)} /> Etiquetas animadas con palabras clave (desactivado por defecto)</label>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><button className="ap-btn ap-btn-primary ap-btn-sm" onClick={guardar}><Check size={13} /> Guardar estilo</button><span style={mut}>{msg}</span></div>
    </div>
  );
}


// Analizador de redes: Instagram conectado (sin copiar claves), aprende de tus publicaciones y busca ideas ganadoras en el nicho (Instagram y YouTube)
function Lista({ items, color, max = 3, ejemplo = false }) {
  const [todo, setTodo] = useState(false), [ej, setEj] = useState(null);
  if (!items || !items.length) return null;
  const ver = todo ? items : items.slice(0, max);
  return <>
    <ul className="rd-lista" style={color ? { '--pt': color } : undefined}>{ver.map((x, i) => <li key={i} style={ejemplo ? { cursor: 'pointer' } : undefined} onClick={ejemplo ? () => setEj({ idea: String(x), formato: '', gancho: '', origen: '' }) : undefined} title={ejemplo ? 'Pulsa para ver un ejemplo' : undefined}>{x}{ejemplo && <span style={{ display: 'block', fontSize: '0.74rem', color: '#8fdba0' }}>🎬 Ver ejemplo →</span>}</li>)}</ul>
    {ej && <TallerIdeas idea={ej} onCerrar={() => setEj(null)} />}
    {items.length > max && <button className="rd-btn" style={{ alignSelf: 'flex-start', padding: '3px 10px', fontSize: '0.76rem' }} onClick={() => setTodo(v => !v)}>{todo ? 'Ver menos' : 'Ver ' + (items.length - max) + ' más'}</button>}
  </>;
}
function Tarjeta({ titulo, color, children }) { return <div className="rd-card"><h3 style={color ? { color } : undefined}>{titulo}</h3>{children}</div>; }
const ORIGEN_IDEA = { 'tus datos': ['📊 Tus datos', '#8fdba0'], nicho: ['🌍 Nicho', '#f2c46d'], exploracion: ['🧭 Exploración', '#9db8ff'] };
const TIPO_ESCENA = { a_camara: ['🎤 A cámara', 'Hablas con micro'], voz_en_off: ['🎙 Voz en off', 'Grabas la voz con micro'], broll: ['🎞 Imagen / b-roll', 'Solo imagen, sin micro'], render: ['🖥 Render 3D', 'Se renderiza'], pantalla: ['📱 Pantalla / texto', 'Gráfico o captura'] };
function TallerIdeas({ idea, onCerrar }) {
  const [g, setG] = useState(null), [error, setError] = useState(''), [extra, setExtra] = useState(''), [msg, setMsg] = useState(''), [hist, setHist] = useState([]), [trab, setTrab] = useState(false);
  const generar = async () => { setTrab(true); setError(''); try { const r = await api.post('/redes/guion/generar', { ...idea, extra }); setG(r.data.guion); } catch (e) { setError(e.response?.data?.error || 'No se pudo crear el guion.'); } setTrab(false); };
  const enviar = async () => { if (!msg.trim() || !g) return; const m = msg; setMsg(''); setTrab(true); setHist(h => [...h, { yo: true, t: m }]); try { const r = await api.post('/redes/guion/chat', { guion: g, mensaje: m }); setG(r.data.guion); setHist(h => [...h, { t: r.data.respuesta || 'Hecho.' }]); } catch (e) { setHist(h => [...h, { t: e.response?.data?.error || 'No pude aplicarlo.' }]); } setTrab(false); };
  const alEstudio = () => { try { const texto = g.escenas.filter(s => s.hablado).map(s => s.hablado).join('\n'); const ind = ['Guion: ' + g.titulo, ...g.escenas.map(s => 'Escena ' + s.n + ' (' + s.tipo + ', ' + s.segundos + ' s): ' + s.que_hacer + (s.texto_pantalla ? ' · Texto: ' + s.texto_pantalla : '') + (s.edicion ? ' · Edición: ' + s.edicion : '')), 'Música: ' + [g.musica.estilo, g.musica.bpm && g.musica.bpm + ' bpm', g.musica.ambiente].filter(Boolean).join(', '), g.para_el_editor].filter(Boolean).join('\n'); localStorage.setItem('estudioPendiente', JSON.stringify({ guion: texto, notas: ind })); alert('Listo. Ve a la pestaña «Nuevo» del Estudio: el guion y las indicaciones ya están puestos. Sube ahí tu vídeo.'); } catch { /* sin almacenamiento */ } };
  const o = ORIGEN_IDEA[idea.origen];
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', overflowY: 'auto', padding: '4vh 12px' }} onClick={onCerrar}>
      <div className="rd-card" style={{ maxWidth: 820, width: '100%', background: '#15171c', gap: 14 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><h3 style={{ margin: 0, flex: 1 }}>🎬 Taller de ideas</h3>{o && <span className="rd-chip" style={{ color: o[1] }}>{o[0]}</span>}<span className="rd-chip arena">{idea.formato || 'idea'}</span><button className="rd-btn" onClick={onCerrar}>Cerrar</button></div>
        <div className="rd-gancho">{idea.gancho ? '“' + idea.gancho + '”' : idea.idea}</div>
        <div style={{ fontSize: '0.9rem' }}>{idea.idea}</div>
        {!g && <>
          <textarea className="ap-field-input" style={{ width: '100%', minHeight: 56 }} value={extra} onChange={e => setExtra(e.target.value)} placeholder="Opcional: algo que ya sepas (qué proyecto, qué tienes grabado, cuánto quieres que dure…)" />
          <button className="rd-btn pri" disabled={trab} onClick={generar}>{trab ? 'Escribiendo el guion…' : '✍️ Crear guion por escenas'}</button>
        </>}
        {error && <div style={{ color: '#ff9b9b' }}>{error}</div>}
        {g && <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span className="rd-chip">{g.formato}</span><span className="rd-chip">⏱ {g.duracion_seg || g.escenas.reduce((s, x) => s + x.segundos, 0)} s</span>
            <span className="rd-chip" style={{ color: g.necesita_micro ? '#f2c46d' : '#8fdba0' }}>{g.necesita_micro ? '🎤 Necesitas micro' : 'Sin micro'}</span>
            {(g.equipo || []).map((x, i) => <span key={i} className="rd-chip">{x}</span>)}
          </div>
          {g.escenas.map(s => { const tp = TIPO_ESCENA[s.tipo] || TIPO_ESCENA.broll; return (
            <div key={s.n} style={{ borderLeft: '3px solid ' + (s.micro ? '#f2c46d' : s.tipo === 'render' ? '#9db8ff' : '#444'), paddingLeft: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: '0.78rem', ...mut }}><b>Escena {s.n}</b> · {tp[0]} · {s.segundos} s{s.micro ? ' · 🎤 micro' : ''}</div>
              <div style={{ fontSize: '0.9rem' }}>{s.que_hacer}</div>
              {s.hablado && <div style={{ fontSize: '0.92rem', fontStyle: 'italic' }}>🗣 «{s.hablado}»</div>}
              {s.texto_pantalla && <div style={{ fontSize: '0.82rem' }}>🔤 En pantalla: <b>{s.texto_pantalla}</b></div>}
              {s.edicion && <div style={{ ...mut, fontSize: '0.8rem' }}>✂️ {s.edicion}</div>}
            </div>); })}
          {g.cta && <div><b>📣 CTA:</b> {g.cta}</div>}
          {(g.ganchos_alternativos || []).length > 0 && <div><b>🪝 Otros ganchos para probar</b><Lista items={g.ganchos_alternativos} /></div>}
          <div><b>🎵 Música:</b> {[g.musica.estilo, g.musica.bpm && g.musica.bpm + ' bpm', g.musica.ambiente].filter(Boolean).join(' · ') || '—'}<div style={{ ...mut, fontSize: '0.78rem' }}>{g.musica.nota}</div></div>
          {(g.preguntas || []).length > 0 && <div style={{ background: 'rgba(242,196,109,.08)', padding: 10, borderRadius: 8 }}><b>❓ Para afinarlo necesito saber</b><Lista items={g.preguntas} color="#f2c46d" /></div>}
          {hist.map((h, i) => <div key={i} style={{ alignSelf: h.yo ? 'flex-end' : 'flex-start', background: h.yo ? 'rgba(143,219,160,.12)' : 'rgba(255,255,255,.06)', padding: '6px 10px', borderRadius: 8, fontSize: '0.86rem', maxWidth: '88%' }}>{h.t}</div>)}
          <div style={{ display: 'flex', gap: 8 }}><input className="ap-field-input" style={{ flex: 1 }} value={msg} onChange={e => setMsg(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') enviar(); }} placeholder="Pide cambios o contesta a las preguntas: «hazlo más corto», «quita la escena 3»…" /><button className="rd-btn pri" disabled={trab} onClick={enviar}>{trab ? '…' : 'Enviar'}</button></div>
          <button className="rd-btn" onClick={alEstudio}>➡️ Mandar al Estudio de vídeo</button>
        </>}
      </div>
    </div>
  );
}
function IdeasTarjetas({ ideas }) {
  const [abierta, setAbierta] = useState(null);
  if (!ideas || !ideas.length) return null;
  return <>
    <div className="rd-grid">{ideas.map((x, i) => { const o = ORIGEN_IDEA[x.origen]; return <div key={i} className="rd-card" style={{ cursor: 'pointer' }} onClick={() => setAbierta(x)} title="Pulsa para abrir el guion"><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><span className="rd-chip arena">{x.formato || 'idea'}</span>{o && <span className="rd-chip" style={{ color: o[1] }}>{o[0]}</span>}</div><div className="rd-gancho">{x.idea}</div>{x.gancho && <div style={{ fontSize: '0.86rem', ...mut }}>“{x.gancho}”</div>}{x.por_que && <div style={{ ...mut, fontSize: '0.8rem' }}>{x.por_que}</div>}<div style={{ fontSize: '0.78rem', color: '#8fdba0' }}>🎬 Abrir taller y crear guion →</div></div>; })}</div>
    {abierta && <TallerIdeas idea={abierta} onCerrar={() => setAbierta(null)} />}
  </>;
}
function ResultadoNicho({ n }) {
  if (!n) return null;
  const yt = n.plataforma === 'youtube';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 6 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><span className="rd-chip arena">{yt ? '▶ YouTube · ' + n.consulta : '📸 ' + (n.cuentas || []).map(c => '@' + c.usuario).join(', ')}</span><span style={mut}>{String(n.fecha).slice(0, 10)}</span>{n.fiabilidad && <span className="rd-chip" title={n.fiabilidad}>Fiabilidad: {String(n.fiabilidad).split(/[.,:]/)[0].slice(0, 30)}</span>}</div>
      {(n.fallos || []).length > 0 && <div style={{ ...mut, color: '#f2c46d' }}>No he podido leer: {n.fallos.join(' · ')}</div>}
      {(n.top || []).length > 0 && <div className="rd-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(190px,1fr))' }}>{n.top.slice(0, 8).map((p, i) => <a key={i} href={p.enlace} target="_blank" rel="noreferrer" className="rd-post" style={{ textDecoration: 'none', color: 'inherit', aspectRatio: yt ? '16/11' : '4/5' }}>{p.miniatura && <img src={p.miniatura} alt="" loading="lazy" />}<span className="pt">{yt ? (p.vistas >= 1e6 ? (p.vistas / 1e6).toFixed(1).replace('.', ',') + ' M' : p.vistas >= 1e3 ? Math.round(p.vistas / 1e3) + ' k' : p.vistas) : p.puntuacion}</span><div className="vel"><b>{p.titulo || p.gancho || p.pie || 'ver'}</b><div style={{ opacity: 0.7 }}>{p.canal || (p.cuenta ? '@' + p.cuenta : '')}{p.vistas ? ' · ' + p.vistas.toLocaleString('es-ES') + ' vistas' : p.me_gusta != null ? ' · ' + p.me_gusta + ' me gusta' : ''}</div></div></a>)}</div>}
      <div className="rd-grid2">
        {(n.patrones || []).length > 0 && <Tarjeta titulo="Lo que funciona"><Lista ejemplo items={n.patrones} color="#8fdba0" /></Tarjeta>}
        {(n.ganchos || []).length > 0 && <Tarjeta titulo="Ganchos que enganchan"><Lista ejemplo items={n.ganchos} /></Tarjeta>}
        {(n.formatos || []).length > 0 && <Tarjeta titulo="Formatos ganadores"><Lista ejemplo items={n.formatos} color="#f2c46d" /></Tarjeta>}
      </div>
      {(n.ideas || []).length > 0 && <div><h3 style={{ margin: '4px 0 10px' }}>💡 Ideas para ti</h3><IdeasTarjetas ideas={n.ideas} /></div>}
    </div>
  );
}
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('es-ES'));
const delta = (a, b) => (a == null || b == null || b === 0 ? null : Math.round((a - b) / b * 100));
function SaludCuenta() {
  const [d, setD] = useState(null), [err, setErr] = useState(''), [trab, setTrab] = useState(false);
  useEffect(() => { api.get('/redes/cuenta/salud').then(r => setD(r.data)).catch(() => {}); }, []);
  const analiza = async () => { setTrab(true); setErr(''); try { const r = await api.post('/redes/cuenta/salud', {}, { timeout: 200000 }); setD(r.data); } catch (e) { setErr(e.response?.data?.error || 'No se pudo analizar'); } setTrab(false); };
  const col = { sube: '#8fdba0', estable: '#f2c46d', baja: '#ff9b9b' };
  const filas = d?.metricas ? [['Alcance', d.metricas.reach], ['Visualizaciones', d.metricas.views], ['Cuentas que interactuaron', d.metricas.accounts_engaged], ['Interacciones', d.metricas.total_interactions], ['Visitas al perfil', d.metricas.profile_views]].filter(x => x[1] && x[1].ahora != null) : [];
  const max = d?.serie?.length ? Math.max(1, ...d.serie.map(Math.abs)) : 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="rd-card"><h3>📊 Salud de tu cuenta</h3>
        <div style={{ ...mut, fontSize: '0.84rem' }}>Compara los últimos 30 días con los 30 anteriores y te dice claro si creces o pierdes, por qué es lo más probable y qué hacer.</div>
        <div><button className="rd-btn pri" disabled={trab} onClick={analiza}>{trab ? 'Analizando…' : d?.fecha ? '🔄 Analizar de nuevo' : '🔍 Analizar mi cuenta'}</button></div>
        {err && <div style={{ color: '#ff9b9b' }}>{err}</div>}
      </div>
      {d?.titular && <>
        <div className="rd-card" style={{ borderLeft: '4px solid ' + col[d.tendencia] }}>
          <div style={{ fontSize: '1.05rem', fontWeight: 600 }}>{d.tendencia === 'sube' ? '📈' : d.tendencia === 'baja' ? '📉' : '➖'} {d.titular}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><span className="rd-chip">{fmt(d.seguidores)} seguidores</span>{d.neto_30d != null && <span className="rd-chip" style={{ color: d.neto_30d >= 0 ? '#8fdba0' : '#ff9b9b' }}>{d.neto_30d >= 0 ? '+' : ''}{d.neto_30d} en 30 días</span>}{d.neto_semana != null && <span className="rd-chip">Esta semana {d.neto_semana >= 0 ? '+' : ''}{d.neto_semana} (antes {d.neto_semana_anterior >= 0 ? '+' : ''}{d.neto_semana_anterior})</span>}</div>
          {d.serie?.length > 0 && <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 56 }}>{d.serie.map((v, i) => <div key={i} title={v + ' seguidores netos'} style={{ flex: 1, height: Math.max(3, Math.abs(v) / max * 52), background: v >= 0 ? '#8fdba0' : '#ff9b9b', borderRadius: 2, alignSelf: v >= 0 ? 'flex-end' : 'flex-start' }} />)}</div>}
        </div>
        {filas.length > 0 && <div className="rd-card"><h3>Ahora frente a los 28 días anteriores</h3><div className="rd-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))' }}>{filas.map(([n, m]) => { const p = delta(m.ahora, m.antes); return <div key={n} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={mut}>{n}</span><b style={{ fontSize: '1.3rem' }}>{fmt(m.ahora)}</b>{p != null && <span style={{ color: p >= 0 ? '#8fdba0' : '#ff9b9b', fontSize: '0.82rem' }}>{p >= 0 ? '▲' : '▼'} {Math.abs(p)}% (antes {fmt(m.antes)})</span>}</div>; })}</div></div>}
        <div className="rd-card"><h3>Tu actividad: últimos 30 días frente a los anteriores</h3><div className="rd-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))' }}>{[['Publicaciones', 'publicaciones'], ['Reels', 'reels'], ['Vistas medias', 'vistas_medias'], ['Comentarios', 'comentarios'], ['Compartidos', 'compartidos'], ['Guardados', 'guardados']].map(([n, k]) => { const p = delta(d.ahora[k], d.antes[k]); return <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={mut}>{n}</span><b style={{ fontSize: '1.3rem' }}>{fmt(d.ahora[k])}</b><span style={{ ...mut, fontSize: '0.8rem' }}>antes {fmt(d.antes[k])}{p != null && <span style={{ color: p >= 0 ? '#8fdba0' : '#ff9b9b' }}> · {p >= 0 ? '▲' : '▼'}{Math.abs(p)}%</span>}</span></div>; })}</div></div>
        <div className="rd-grid2">
          {d.mejoras.length > 0 && <Tarjeta titulo="✅ Has mejorado" color="#8fdba0"><Lista items={d.mejoras} color="#8fdba0" /></Tarjeta>}
          {d.alertas.length > 0 && <Tarjeta titulo="⚠️ Si sigues así…" color="#ff9b9b"><Lista items={d.alertas} color="#ff9b9b" /></Tarjeta>}
        </div>
        {d.acciones.length > 0 && <Tarjeta titulo="🎯 Qué hacer"><Lista ejemplo items={d.acciones} /></Tarjeta>}
        {d.fiabilidad && <div style={{ ...mut, fontSize: '0.78rem' }}>Fiabilidad: {d.fiabilidad}</div>}
      </>}
      <PreferenciasRedes />
    </div>
  );
}
function InicioRedes({ ir }) {
  const [s, setS] = useState(null), [pubs, setPubs] = useState(null), [est, setEst] = useState(null), [objs, setObjs] = useState(null), [trab, setTrab] = useState(false), [abierta, setAbierta] = useState(null);
  useEffect(() => {
    api.get('/redes/cuenta/salud').then(r => setS(r.data)).catch(() => setS({}));
    api.get('/redes/instagram/publicaciones').then(r => setPubs(r.data.publicaciones || [])).catch(() => setPubs([]));
    api.get('/redes/estado').then(r => setEst(r.data)).catch(() => setEst({}));
    api.get('/redes/objetivos').then(r => setObjs(r.data)).catch(() => {});
  }, []);
  const cambia = async (id) => { try { await api.post('/redes/objetivo', { id }); setObjs(o => ({ ...o, actual: id })); const r = await api.get('/redes/instagram/publicaciones'); setPubs(r.data.publicaciones || []); } catch { /* se queda */ } };
  const analiza = async () => { setTrab(true); try { const r = await api.post('/redes/cuenta/salud', {}, { timeout: 200000 }); setS(r.data); } catch { /* se queda como estaba */ } setTrab(false); };
  const top = (pubs || []).filter(p => !p.prueba && p.rumbo !== 'fuera').slice(0, 3), ideas = (est?.aprendizaje?.ideas_ganadoras || []).slice(0, 3), obj = objs ? objs.objetivos.find(o => o.id === objs.actual) : null;
  const flecha = { sube: ['📈', '#8fdba0', 'Subes'], estable: ['➖', '#f2c46d', 'Estable'], baja: ['📉', '#ff9b9b', 'Bajas'] }[s?.tendencia] || null;
  const conectado = !!est?.instagram;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {est && !conectado && <div className="rd-card"><b>Aún no has conectado Instagram.</b><div><button className="rd-btn pri" onClick={() => ir('ig')}>Conectar Instagram</button></div></div>}
      <div className="rd-card" style={{ borderLeft: '4px solid ' + (flecha ? flecha[1] : '#555'), gap: 10 }}>
        <div style={{ ...mut, fontSize: '0.8rem', letterSpacing: '.06em' }}>1 · CÓMO VA LA CUENTA</div>
        {flecha ? <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}><span style={{ fontSize: '2.2rem' }}>{flecha[0]}</span><b style={{ fontSize: '1.8rem', color: flecha[1] }}>{flecha[2]}</b>{s.neto_30d != null && <span style={{ fontSize: '1.3rem' }}>{s.neto_30d >= 0 ? '+' : ''}{s.neto_30d} seguidores en 30 días</span>}</div>
          <div style={{ fontSize: '0.95rem' }}>{s.titular}</div>
        </> : <div style={mut}>Todavía no he analizado tu cuenta.</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="rd-btn pri" disabled={trab || !conectado} onClick={analiza}>{trab ? 'Analizando…' : flecha ? '🔄 Actualizar' : '🔍 Analizar mi cuenta'}</button>{flecha && <button className="rd-btn" onClick={() => ir('salud')}>Ver el detalle</button>}</div>
      </div>
      <div className="rd-card" style={{ gap: 10 }}>
        <div style={{ ...mut, fontSize: '0.8rem', letterSpacing: '.06em' }}>2 · LO QUE MEJOR FUNCIONA{obj ? ' · ' + obj.icono + ' ' + obj.nombre.toUpperCase() : ''}</div>
        {objs && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{objs.objetivos.map(o => <button key={o.id} className={'rd-btn' + (objs.actual === o.id ? ' pri' : '')} style={{ padding: '4px 10px', fontSize: '0.76rem' }} title={o.que + ' — ' + o.formula} onClick={() => cambia(o.id)}>{o.icono} {o.nombre}</button>)}</div>}
        {obj && <div style={{ ...mut, fontSize: '0.8rem' }}>El número de cada reel = {obj.formula}</div>}
        {top.length > 0 ? <div className="rd-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))' }}>{top.map((p, i) => <a key={p.id} href={p.enlace} target="_blank" rel="noreferrer" className="rd-post" style={{ textDecoration: 'none', color: 'inherit', aspectRatio: '4/5' }}>{p.miniatura && <img src={p.miniatura} alt="" loading="lazy" />}<span className="pt">{p.puntuacion}</span><div className="vel"><b>#{i + 1}</b> {fmt(p.views ?? p.reach ?? 0)} vistas</div></a>)}</div> : <div style={mut}>{conectado ? 'Pulsa «Leer publicaciones» en Instagram.' : '—'}</div>}
        <div><button className="rd-btn" onClick={() => ir('ig')}>Ver todo el ranking y analizar</button></div>
      </div>
      <div className="rd-card" style={{ gap: 10 }}>
        <div style={{ ...mut, fontSize: '0.8rem', letterSpacing: '.06em' }}>3 · QUÉ HACER AHORA</div>
        {s?.acciones?.[0] && <div style={{ fontSize: '1rem', lineHeight: 1.5 }}>🎯 {s.acciones[0]}</div>}
        {ideas.length > 0 ? <div className="rd-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))' }}>{ideas.map((x, i) => <div key={i} className="rd-card" style={{ cursor: 'pointer' }} onClick={() => setAbierta(x)}><span className="rd-chip arena" style={{ alignSelf: 'flex-start' }}>{x.formato || 'idea'}</span><div className="rd-gancho">{x.idea}</div><div style={{ fontSize: '0.78rem', color: '#8fdba0' }}>🎬 Crear guion →</div></div>)}</div> : <div style={mut}>Cuando analices tus reels, aquí saldrán ideas listas para grabar.</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="rd-btn" onClick={() => ir('plan')}>Plan de publicación</button><button className="rd-btn" onClick={() => ir('musica')}>🎵 Música</button></div>
      </div>
      <HistoriasHoy />
      <YoutubeAInstagram />
      <RumboRedes />
      <PreferenciasRedes />
      {abierta && <TallerIdeas idea={abierta} onCerrar={() => setAbierta(null)} />}
    </div>
  );
}
function VozMarca() {
  const [v, setV] = useState(null), [err, setErr] = useState(''), [trab, setTrab] = useState(false);
  useEffect(() => { api.get('/redes/voz').then(r => setV(r.data)).catch(() => {}); }, []);
  const saca = async () => { setTrab(true); setErr(''); try { const r = await api.post('/redes/voz/sacar', {}, { timeout: 120000 }); setV(r.data); } catch (e) { setErr(e.response?.data?.error || 'No se pudo sacar la voz'); } setTrab(false); };
  return (
    <div className="rd-card" style={{ gap: 12 }}>
      <h3>🗣 Tu voz real</h3>
      <div style={{ ...mut, fontSize: '0.84rem' }}>La IA lee lo que dices y escribes de verdad y saca cómo hablas. Los guiones, el asistente de WhatsApp y el editor la usan.</div>
      <div><button className="rd-btn pri" disabled={trab} onClick={saca}>{trab ? 'Escuchándote…' : v?.fecha ? '🔄 Volver a sacarla' : '🗣 Sacar mi voz de mis reels'}</button></div>
      {err && <div style={{ color: '#ff9b9b' }}>{err}</div>}
      {v?.resumen && <>
        <div style={{ fontSize: '1rem', lineHeight: 1.5 }}>{v.resumen}</div>
        <span className="rd-chip" style={{ alignSelf: 'flex-start' }}>Sacada de {v.fuente}</span>
        {(v.muletillas || []).length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{v.muletillas.map((x, i) => <span key={i} className="rd-chip arena">«{x}»</span>)}</div>}
        <div className="rd-grid2">
          {(v.rasgos || []).length > 0 && <Tarjeta titulo="Cómo hablas"><Lista items={v.rasgos} /></Tarjeta>}
          {(v.como_abre || []).length > 0 && <Tarjeta titulo="Cómo abres"><Lista items={v.como_abre} /></Tarjeta>}
          {(v.como_cierra || []).length > 0 && <Tarjeta titulo="Cómo cierras"><Lista items={v.como_cierra} /></Tarjeta>}
          {(v.evitar || []).length > 0 && <Tarjeta titulo="No suena a ti" color="#f29a9a"><Lista items={v.evitar} color="#f29a9a" /></Tarjeta>}
        </div>
      </>}
    </div>
  );
}
const SECC_DET = [['gancho', '🪝 Cómo arranca'], ['grabacion', '🎥 Cómo está grabado'], ['presencia', '🙋 Tu presencia y gestos'], ['edicion', '✂️ Edición'], ['audio', '🔊 Audio'], ['narrativa', '📖 Historia']];
const verVal = (v) => Array.isArray(v) ? v.map(x => typeof x === 'object' ? Object.values(x).join(' · ') : String(x)).join(' | ') : (v && typeof v === 'object') ? Object.entries(v).map(([k, x]) => k.replace(/_/g, ' ') + ': ' + verVal(x)).join(' — ') : String(v ?? '');
function DetalleReels({ lista }) {
  if (!lista || !lista.length) return null;
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><b>🔬 Análisis a fondo de cada reel</b>
    {lista.map(r => <details key={r.id} className="rd-more"><summary>{(r.pie || '(sin texto)').slice(0, 70)} · {r.puntuacion}</summary>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0', fontSize: '0.86rem', lineHeight: 1.5 }}>
        {SECC_DET.filter(([k]) => r.detalle[k]).map(([k, n]) => <div key={k}><b>{n}</b><div style={mut}>{verVal(r.detalle[k])}</div></div>)}
        {(r.detalle.momentos_clave || []).length > 0 && <div><b>⏱ Momentos clave</b><div style={mut}>{r.detalle.momentos_clave.map(m => 's' + m.segundo + ': ' + m.que_pasa + ' → ' + m.por_que_funciona).join(' | ')}</div></div>}
        {(r.detalle.replicar || []).length > 0 && <div><b>✅ Para copiar</b><Lista items={r.detalle.replicar} color="#8fdba0" /></div>}
        {(r.detalle.mejorar || []).length > 0 && <div><b>🔧 Para mejorar</b><Lista items={r.detalle.mejorar} color="#f2c46d" /></div>}
        {r.enlace && <a href={r.enlace} target="_blank" rel="noreferrer" style={{ color: '#8fdba0' }}>Ver el reel →</a>}
      </div></details>)}
  </div>;
}
function PreferenciasRedes() {
  const [p, setP] = useState(null), [texto, setTexto] = useState(''), [tipo, setTipo] = useState('no');
  useEffect(() => { api.get('/redes/preferencias').then(r => setP(r.data)).catch(() => setP({ reglas: [] })); }, []);
  const anade = async () => { if (texto.trim().length < 3) return; try { const r = await api.post('/redes/preferencias', { texto, tipo }); setP(r.data); setTexto(''); } catch { /* se queda */ } };
  const quita = async (id) => { try { const r = await api.post('/redes/preferencias', { borrar: id }); setP(r.data); } catch { /* se queda */ } };
  const l = p?.reglas || [], ico = { no: '🚫', si: '✅', transmitir: '💬', saber: '🧠' }, col = { no: '#ff9b9b', si: '#8fdba0', transmitir: '#9db8ff', saber: '#f2c46d' };
  return (
    <div className="rd-card" style={{ gap: 10 }}>
      <div style={{ ...mut, fontSize: '0.8rem', letterSpacing: '.06em' }}>✋ TUS PREFERENCIAS · la IA las respeta siempre</div>
      <div style={{ ...mut, fontSize: '0.84rem' }}>Dile lo que no quieres, lo que sí, qué quieres transmitir y lo que debe saber de tu negocio (clientes, proyectos…). Vale para consejos, ideas, planes, guiones y el asistente. Vuelve a analizar para que lo aplique.</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select className="ap-field-input" value={tipo} onChange={e => setTipo(e.target.value)}><option value="no">🚫 No quiero</option><option value="si">✅ Quiero</option><option value="transmitir">💬 Quiero transmitir</option><option value="saber">🧠 Debes saber</option></select>
        <input className="ap-field-input" style={{ flex: 1, minWidth: 220 }} value={texto} onChange={e => setTexto(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') anade(); }} placeholder="Ej.: no mencionar futbolistas · Juan Lebron es cliente mío y su reel debería rendir más" />
        <button className="rd-btn pri" onClick={anade}>Añadir</button>
      </div>
      {l.length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{l.map(r => <span key={r.id} className="rd-chip" style={{ color: col[r.tipo] }}>{ico[r.tipo]} {r.texto} <button onClick={() => quita(r.id)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>✕</button></span>)}</div>}
    </div>
  );
}
function BuscaReel({ ig, onAnadido, onLeer, leyendo }) {
  const [enlace, setEnlace] = useState(''), [r, setR] = useState(null), [trab, setTrab] = useState(false);
  const busca = async () => { setTrab(true); setR(null); try { const x = await api.post('/redes/instagram/buscar', { enlace }, { timeout: 120000 }); setR(x.data); if (x.data.encontrado) onAnadido(); } catch (e) { setR({ aviso: e.response?.data?.error || 'No se pudo buscar' }); } setTrab(false); };
  return (
    <div className="rd-card" style={{ gap: 8 }}>
      <div style={{ ...mut, fontSize: '0.8rem', letterSpacing: '.06em' }}>¿FALTA ALGÚN REEL?</div>
      <div style={{ fontSize: '0.88rem' }}>He leído <b>{fmt(ig?.n_media)}</b> de las <b>{fmt(ig?.publicaciones)}</b> publicaciones de tu perfil{ig?.ultima_sync ? ' (última lectura: ' + String(ig.ultima_sync).slice(0, 10) + ')' : ''}. {Number(ig?.n_media) < Number(ig?.publicaciones) ? 'Faltan por leer ' + (Number(ig.publicaciones) - Number(ig.n_media)) + '.' : 'Están todas.'}</div>
      {Number(ig?.n_media) < Number(ig?.publicaciones) && <div><button className="rd-btn pri" disabled={leyendo} onClick={onLeer}>{leyendo ? 'Leyendo tus publicaciones… (1-3 min)' : '📥 Leer las ' + fmt(ig?.publicaciones) + ' publicaciones'}</button></div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><input className="ap-field-input" style={{ flex: 1, minWidth: 220 }} value={enlace} onChange={e => setEnlace(e.target.value)} placeholder="Pega aquí el enlace del reel que no sale" /><button className="rd-btn pri" disabled={trab || enlace.length < 10} onClick={busca}>{trab ? 'Buscando…' : 'Buscarlo'}</button></div>
      {r && <div style={{ fontSize: '0.86rem', color: r.encontrado ? '#8fdba0' : '#f2c46d' }}>{r.encontrado ? 'Encontrado y añadido' + (r.vistas != null ? ' (' + fmt(r.vistas) + ' vistas)' : '') + '. Ya cuenta en el ranking.' : r.aviso}</div>}
    </div>
  );
}
// Plan de publicación en PDF muy visual: se abre una hoja preparada para imprimir y se elige «Guardar como PDF»
const escH = (s) => String(s == null ? '' : typeof s === 'object' ? Object.values(s).join(' — ') : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function exportaPlanPDF(pl, usuario) {
  const v = pl.volumen || {}, dias = pl.semana_tipo || [], col = ['#E3D2B8', '#9db8ff', '#8fdba0', '#f2c46d', '#ff9b9b', '#c9a7ff', '#7fd6d6'];
  const kpi = [[v.reels_semana, 'reels por semana', '🎬'], [v.carruseles_semana, 'carruseles por semana', '🖼'], [v.historias_dia, 'historias al día', '📱'], [v.youtube_mes, 'YouTube al mes', '▶']].filter(k => k[0] != null);
  const html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Plan de publicación</title><link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;800&display=swap" rel="stylesheet"><style>' +
    '@page{size:A4;margin:0}*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}body{margin:0;font-family:Montserrat,Arial,sans-serif;color:#1b1b1f;background:#fff}' +
    '.pag{width:210mm;min-height:297mm;padding:14mm 13mm;page-break-after:always;position:relative}.pag:last-child{page-break-after:auto}' +
    '.hero{background:#111216;color:#fff;border-radius:18px;padding:22px 26px;margin-bottom:18px}.hero small{color:#E3D2B8;letter-spacing:.18em;font-size:10px;font-weight:600}.hero h1{margin:6px 0 4px;font-size:30px;font-weight:800;line-height:1.1}.hero p{margin:0;color:#b9b9c0;font-size:11.5px}' +
    '.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}.kpi{border-radius:14px;padding:14px 10px;text-align:center;background:#f4efe7}.kpi b{display:block;font-size:34px;font-weight:800;line-height:1}.kpi span{font-size:10px;color:#555;display:block;margin-top:6px}.kpi i{font-style:normal;font-size:16px;display:block;margin-bottom:4px}' +
    'h2{font-size:15px;margin:18px 0 8px;font-weight:800}.nota{font-size:11px;line-height:1.55;color:#333;background:#f7f7f9;border-left:4px solid #E3D2B8;padding:10px 12px;border-radius:8px}' +
    '.sem{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}.dia{border-radius:12px;padding:9px 7px;min-height:150px;color:#111;font-size:8.6px;line-height:1.4}.dia b{display:block;font-size:10px;letter-spacing:.06em;margin-bottom:6px;text-transform:uppercase}' +
    '.tend{display:grid;grid-template-columns:1fr 1fr;gap:8px}.card{border:1px solid #e6e6ea;border-radius:12px;padding:10px 12px;font-size:10.5px;line-height:1.45;break-inside:avoid}.card b{display:block;font-size:11.5px;margin-bottom:3px}.chip{display:inline-block;background:#111216;color:#E3D2B8;border-radius:20px;padding:1px 8px;font-size:8.5px;margin-left:4px}' +
    'ul{margin:4px 0 0;padding-left:16px;font-size:10.5px;line-height:1.5}li{margin-bottom:3px}.pie{position:absolute;bottom:8mm;left:13mm;right:13mm;font-size:8.5px;color:#999;display:flex;justify-content:space-between}' +
    '.aviso{position:fixed;top:8px;right:8px;background:#111;color:#fff;padding:8px 12px;border-radius:8px;font:12px Arial}@media print{.aviso{display:none}}</style></head><body>' +
    '<div class="aviso">Pulsa Ctrl+P y elige «Guardar como PDF»</div>' +
    '<div class="pag"><div class="hero"><small>RANUSE DESIGN · REDES</small><h1>Plan de publicación</h1><p>' + escH(usuario ? '@' + usuario + ' · ' : '') + 'Generado el ' + new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) + '</p></div>' +
    '<div class="kpis">' + kpi.map(k => '<div class="kpi"><i>' + k[2] + '</i><b>' + escH(k[0]) + '</b><span>' + k[1] + '</span></div>').join('') + '</div>' +
    (v.por_que ? '<div class="nota">' + escH(v.por_que) + '</div>' : '') +
    (pl.dias_horas ? '<h2>🕒 Mejores días y horas</h2><div class="nota">' + escH(pl.dias_horas) + '</div>' : '') +
    (dias.length ? '<h2>🗓 Tu semana tipo</h2><div class="sem">' + dias.map((d, i) => '<div class="dia" style="background:' + col[i % col.length] + '"><b>' + escH(String(d.dia).slice(0, 3)) + '</b>' + escH(d.que) + '</div>').join('') + '</div>' : '') +
    '<div class="pie"><span>Ranuse Design</span><span>Plan de publicación</span></div></div>' +
    '<div class="pag">' +
    ((pl.tendencias || []).length ? '<h2>🔥 Tendencias y cómo aprovecharlas</h2><div class="tend">' + pl.tendencias.map(x => '<div class="card"><b>' + escH(x.tendencia) + (x.fuente ? '<span class="chip">' + escH(x.fuente) + '</span>' : '') + '</b>' + escH(x.como_aprovecharla) + '</div>').join('') + '</div>' : '') +
    ((pl.experimentos || []).length ? '<h2>🧪 Pruebas para las próximas 2 semanas</h2><div class="tend">' + pl.experimentos.map((x, i) => '<div class="card"><b>Prueba ' + (i + 1) + '</b>' + escH(x) + '</div>').join('') + '</div>' : '') +
    ((pl.riesgos || []).length ? '<h2>⚠ Ojo con</h2><div class="card"><ul>' + pl.riesgos.map(x => '<li>' + escH(x) + '</li>').join('') + '</ul></div>' : '') +
    ((pl.faltan_datos || []).length ? '<h2>Lo que aún no sé</h2><div class="card"><ul>' + pl.faltan_datos.map(x => '<li>' + escH(x) + '</li>').join('') + '</ul></div>' : '') +
    '<div class="pie"><span>Ranuse Design</span><span>Plan de publicación</span></div></div>' +
    '<script>window.onload=function(){setTimeout(function(){window.print()},700)}</script></body></html>';
  const w = window.open('', '_blank'); if (!w) { alert('El navegador ha bloqueado la ventana. Permite las ventanas emergentes para esta web y vuelve a pulsar.'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}
function TendenciasPlan({ items }) {
  const [ej, setEj] = useState(null);
  return <>
    <ul className="rd-lista">{items.map((x, i) => <li key={i} style={{ cursor: 'pointer' }} title="Pulsa para ver un ejemplo" onClick={() => setEj({ idea: x.tendencia + (x.como_aprovecharla ? ': ' + x.como_aprovecharla : ''), formato: '', gancho: '', origen: '' })}><b>{x.tendencia}</b> <span className="rd-chip">{x.fuente}</span><div style={mut}>{x.como_aprovecharla}</div><div style={{ fontSize: '0.74rem', color: '#8fdba0' }}>🎬 Ver ejemplo →</div></li>)}</ul>
    {ej && <TallerIdeas idea={ej} onCerrar={() => setEj(null)} />}
  </>;
}
const eleccionCuentas = (cs) => ['nicho', 'adyacente', 'estilo'].flatMap(tp => cs.filter(x => (x.tipo || 'nicho') === tp).slice(0, 3)).map(x => x.usuario).join(', ');
function CuentasNicho({ ig, onUsar }) {
  const [d, setD] = useState(null), [trab, setTrab] = useState(false), [msg, setMsg] = useState('');
  useEffect(() => { api.get('/redes/nicho/cuentas').then(r => { setD(r.data); if ((r.data.cuentas || []).length) onUsar(eleccionCuentas(r.data.cuentas)); }).catch(() => {}); /* eslint-disable-next-line */ }, []);
  const busca = async () => { setTrab(true); setMsg(''); try { const r = await api.post('/redes/nicho/descubrir', {}, { timeout: 200000 }); setD(r.data); onUsar(eleccionCuentas(r.data.cuentas || [])); setMsg(r.data.nuevas + ' cuentas nuevas comprobadas (de ' + r.data.propuestas + ' propuestas).'); } catch (e) { setMsg(e.response?.data?.error || 'No se pudo'); } setTrab(false); };
  const quita = async (u) => { try { const r = await api.post('/redes/nicho/cuentas/quitar', { usuario: u }); setD(r.data); onUsar(eleccionCuentas(r.data.cuentas || [])); } catch { /* se queda */ } };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ ...mut, fontSize: '0.84rem' }}>Tu nicho: diseño y montaje de gimnasios y espacios deportivos. La IA busca tres tipos de cuentas y comprueba que existan y sean públicas: 🏋️ de tu nicho, 🏠 de nichos cercanos (interiorismo, reformas, fitness, negocios) y 🎬 de estilo (cualquier tema, pero con una forma de ser, comunicar o grabar que te podría funcionar). Pasa el ratón por una para ver qué se puede aprender.</div>
      <div><button className="rd-btn pri" disabled={!ig || trab} onClick={busca}>{trab ? 'Buscando y comprobando…' : (d?.cuentas || []).length ? '🔎 Buscar más cuentas' : '🔎 Encontrar cuentas de mi nicho'}</button></div>
      {msg && <div style={{ ...mut, fontSize: '0.82rem' }}>{msg}</div>}
      {(d?.cuentas || []).length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{d.cuentas.map(x => <span key={x.usuario} className="rd-chip" title={x.aprender || ''} style={{ color: { nicho: '#8fdba0', adyacente: '#f2c46d', estilo: '#9db8ff' }[x.tipo] || undefined }}>{{ nicho: '🏋️', adyacente: '🏠', estilo: '🎬' }[x.tipo] || ''} @{x.usuario} · {fmt(x.seguidores)} <button onClick={() => quita(x.usuario)} title="Quitar esta cuenta" style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>✕</button></span>)}</div>}
    </div>
  );
}
function PaqueteRedes({ t }) {
  const [p, setP] = useState(null), [trab, setTrab] = useState(false), [err, setErr] = useState(''), [copiado, setCopiado] = useState('');
  const pide = async () => { setTrab(true); setErr(''); try { const r = await api.post('/estudio-video/trabajos/' + t.id + '/paquete-redes', {}, { timeout: 150000 }); setP(r.data); } catch (e) { setErr(e.response?.data?.error || 'No se pudo'); } setTrab(false); };
  const copia = (k, txt) => { try { navigator.clipboard.writeText(txt); setCopiado(k); setTimeout(() => setCopiado(''), 1500); } catch { /* sin portapapeles */ } };
  const bloque = (k, titulo, txt) => txt ? <div style={{ padding: 10, border: '1px solid rgba(255,255,255,.12)', borderRadius: 10 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b style={{ fontSize: '0.8rem' }}>{titulo}</b><button className="ap-btn ap-btn-sm" onClick={() => copia(k, txt)}>{copiado === k ? '✔ Copiado' : 'Copiar'}</button></div><div style={{ whiteSpace: 'pre-wrap', fontSize: '0.88rem', marginTop: 4 }}>{txt}</div></div> : null;
  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button className="ap-btn ap-btn-sm" disabled={trab} onClick={pide}>{trab ? '📝 Escribiendo…' : '📝 Texto para publicar (IA de redes)'}</button>
      {err && <div style={{ color: '#ff9b9b', fontSize: '0.84rem' }}>{err}</div>}
      {p && <>
        {bloque('g', '🪝 Gancho en pantalla', p.gancho_pantalla)}
        {bloque('c', '✍️ Texto del post', p.caption)}
        {bloque('h', '# Hashtags', (p.hashtags || []).map(x => '#' + String(x).replace(/^#/, '')).join(' '))}
        {bloque('t', '▶ Título para Shorts', p.titulo_shorts)}
        {p.mejor_momento && <div style={{ ...mut, fontSize: '0.82rem' }}>🕒 {p.mejor_momento}</div>}
        {(p.ganchos_alternativos || []).length > 0 && <div style={{ ...mut, fontSize: '0.82rem' }}>Otros ganchos: {p.ganchos_alternativos.join(' · ')}</div>}
        {(p.si_lo_rehaces || []).length > 0 && <div style={{ fontSize: '0.82rem' }}><b>Si lo rehaces:</b><Lista items={p.si_lo_rehaces} /></div>}
      </>}
    </div>
  );
}
function ProponeClips({ t, onCambio }) {
  const [p, setP] = useState(null), [trab, setTrab] = useState(false), [err, setErr] = useState(''), [sel, setSel] = useState({}), [env, setEnv] = useState(false);
  const pide = async () => { setTrab(true); setErr(''); try { const r = await api.post('/estudio-video/trabajos/' + t.id + '/proponer-clips', {}, { timeout: 200000 }); setP(r.data.clips); setSel(Object.fromEntries(r.data.clips.map((_, i) => [i, true]))); } catch (e) { setErr(e.response?.data?.error || 'No se pudo'); } setTrab(false); };
  const crea = async () => { setEnv(true); try { await api.post('/estudio-video/trabajos/' + t.id + '/montar-clips', { clips: p.filter((_, i) => sel[i]).map(c => ({ titulo: c.titulo, pregunta: c.gancho, tramos: c.tramos })) }); setP(null); onCambio(); } catch (e) { setErr(e.response?.data?.error || 'No se pudieron crear'); } setEnv(false); };
  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button className="ap-btn ap-btn-sm" disabled={trab} onClick={pide}>{trab ? '🧠 Pensando los clips…' : '🧠 Que la IA de redes proponga los clips'}</button>
      <div style={{ ...mut, fontSize: '0.78rem' }}>Usa lo aprendido de tu cuenta y del nicho, tu voz y la duración que mejor te funciona.</div>
      {err && <div style={{ color: '#ff9b9b' }}>{err}</div>}
      {p && <>{p.map((c, i) => <label key={i} style={{ display: 'flex', gap: 10, padding: 10, border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, cursor: 'pointer' }}><input type="checkbox" checked={!!sel[i]} onChange={e => setSel(s => ({ ...s, [i]: e.target.checked }))} /><div><b>{c.titulo}</b><div style={{ fontStyle: 'italic' }}>“{c.gancho}”</div><div style={{ ...mut, fontSize: '0.8rem' }}>{c.por_que} · {Math.round(c.tramos.reduce((s, x) => s + x[1] - x[0], 0))} s</div></div></label>)}
        <button className="ap-btn ap-btn-primary ap-btn-sm" disabled={env || !Object.values(sel).some(Boolean)} onClick={crea}>{env ? 'Creando…' : 'Crear los clips marcados'}</button></>}
    </div>
  );
}
function EstudiaReferente() {
  const [f, setF] = useState(null), [nombre, setNombre] = useState(''), [est, setEst] = useState(''), [r, setR] = useState(null), [lista, setLista] = useState([]), [ok, setOk] = useState(false);
  useEffect(() => { api.get('/redes/referencias').then(x => setLista(x.data.lista || [])).catch(() => {}); }, []);
  const estudia = async () => { setR(null); setOk(false); try { setEst('Subiendo el vídeo…'); const ruta = await subirArchivo(f, () => {}); const { data: j } = await api.post('/redes/video/analizar', { ruta, nombre: nombre || f.name }); for (let i = 0; i < 100; i++) { await new Promise(z => setTimeout(z, 6000)); const { data: s } = await api.get('/redes/video/' + j.id); if (s.estado === 'listo') { setR(s); setEst(''); return; } if (s.estado === 'error') throw new Error(s.error || 'No se pudo analizar'); setEst((s.progreso || 'Analizando…') + ' ' + (s.pct || 0) + '%'); } throw new Error('Tarda demasiado, vuelve a mirarlo luego'); } catch (e) { setEst(e.response?.data?.error || e.message || 'No se pudo'); } };
  const guarda = async () => { try { const x = await api.post('/redes/referencias', { nombre: nombre || f?.name, descripcion: r.descripcion, detalle: r.detalle }); setLista(x.data.lista || []); setOk(true); } catch { setEst('No se pudo guardar'); } };
  return (
    <div className="rd-card" style={{ gap: 10 }}>
      <h3>🎞 Estudiar el vídeo de otro creador</h3>
      <div style={{ ...mut, fontSize: '0.84rem' }}>Sube un vídeo que te guste (de otro creador). La IA lo analiza a fondo (cómo está grabado, gestos, edición, audio) y lo que aprende pasa al editor.</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input className="ap-field-input" style={{ flex: '1 1 160px' }} value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre o cuenta (opcional)" />
        <label className="rd-btn" style={{ cursor: 'pointer' }}>{f ? '🎞 ' + f.name.slice(0, 22) : 'Elegir el vídeo'}<input type="file" accept="video/*" style={{ display: 'none' }} onChange={e => setF(e.target.files?.[0] || null)} /></label>
        <button className="rd-btn pri" disabled={!f || (est && !r && !/No se|Tarda|error/i.test(est))} onClick={estudia}>Estudiarlo</button>
      </div>
      {est && <div style={mut}>{est}</div>}
      {r && <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: '0.9rem' }}>{r.descripcion}</div>
        {r.detalle?.grabacion && <div style={{ fontSize: '0.84rem' }}><b>🎥 Grabación:</b> <span style={mut}>{verVal(r.detalle.grabacion)}</span></div>}
        {r.detalle?.presencia && <div style={{ fontSize: '0.84rem' }}><b>🙋 Presencia:</b> <span style={mut}>{verVal(r.detalle.presencia)}</span></div>}
        {(r.detalle?.replicar || []).length > 0 && <div><b>✅ Para copiar</b><Lista items={r.detalle.replicar} color="#8fdba0" /></div>}
        <div><button className="rd-btn pri" disabled={ok} onClick={guarda}>{ok ? '✔ Guardado: el editor ya lo usa' : '💾 Guardar como referente para el editor'}</button></div>
      </div>}
      {lista.length > 0 && <div style={{ ...mut, fontSize: '0.8rem' }}>Referentes guardados: {lista.map(x => x.nombre).join(' · ')}</div>}
    </div>
  );
}
function YoutubeAInstagram() {
  const [d, setD] = useState(null), [trab, setTrab] = useState(false), [err, setErr] = useState(''), [ej, setEj] = useState(null);
  useEffect(() => { api.get('/redes/youtube/a-instagram').then(r => setD(r.data)).catch(() => {}); }, []);
  const genera = async () => { setTrab(true); setErr(''); try { const r = await api.post('/redes/youtube/a-instagram', {}, { timeout: 150000 }); setD(r.data); } catch (e) { setErr(e.response?.data?.error || 'No se pudo'); } setTrab(false); };
  return (
    <div className="rd-card" style={{ gap: 10 }}>
      <div style={{ ...mut, fontSize: '0.8rem', letterSpacing: '.06em' }}>🔁 DE YOUTUBE A INSTAGRAM · tus Shorts que funcionaron</div>
      <div style={{ ...mut, fontSize: '0.84rem' }}>Mira tus vídeos que mejor han funcionado en YouTube y te dice cuáles probar en Instagram y cómo adaptarlos. Lo que aprende también llega al editor.</div>
      <div><button className="rd-btn pri" disabled={trab} onClick={genera}>{trab ? 'Pensando…' : d?.fecha ? '🔄 Volver a mirar' : '🔁 Ver qué probar en Instagram'}</button></div>
      {err && <div style={{ color: '#ff9b9b' }}>{err}</div>}
      {d?.resumen && <div style={{ fontSize: '0.9rem' }}>{d.resumen}</div>}
      {(d?.ideas || []).length > 0 && <div className="rd-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))' }}>{d.ideas.map((x, i) => <div key={i} className="rd-card" style={{ cursor: 'pointer' }} onClick={() => setEj({ idea: 'Adaptar a Instagram mi Short de YouTube «' + x.video + '»: ' + x.adaptar, formato: x.formato || 'reel', gancho: x.gancho, origen: 'tus datos' })}><span className="rd-chip" style={{ alignSelf: 'flex-start' }}>▶ {x.video.slice(0, 40)}</span><div className="rd-gancho">“{x.gancho}”</div><div style={{ fontSize: '0.84rem' }}>{x.adaptar}</div>{x.riesgo && <div style={{ ...mut, fontSize: '0.78rem' }}>⚠ {x.riesgo}</div>}<div style={{ fontSize: '0.78rem', color: '#8fdba0' }}>🎬 Crear guion →</div></div>)}</div>}
      {(d?.aprendizaje || []).length > 0 && <div><b>Lo que se ve que funciona</b><Lista items={d.aprendizaje} /></div>}
      {ej && <TallerIdeas idea={ej} onCerrar={() => setEj(null)} />}
    </div>
  );
}
function HistoriasHoy() {
  const [d, setD] = useState(null), [dia, setDia] = useState('hoy'), [ctx, setCtx] = useState(''), [trab, setTrab] = useState(false), [err, setErr] = useState(''), [cop, setCop] = useState('');
  const genera = async () => { setTrab(true); setErr(''); try { const r = await api.post('/redes/historias/hoy', { dia, contexto: ctx }, { timeout: 150000 }); setD(r.data); } catch (e) { setErr(e.response?.data?.error || 'No se pudo preparar'); } setTrab(false); };
  const copia = (k, txt) => { try { navigator.clipboard.writeText(txt); setCop(k); setTimeout(() => setCop(''), 1500); } catch { /* sin portapapeles */ } };
  return (
    <div className="rd-card" style={{ gap: 12 }}>
      <div style={{ ...mut, fontSize: '0.8rem', letterSpacing: '.06em' }}>📲 QUÉ SUBIR A HISTORIAS · guion exacto con tu voz</div>
      <div style={{ ...mut, fontSize: '0.84rem' }}>Mira lo que ya has subido, tu agenda y tus tareas del día, tu plan, tu rumbo y tu voz, y te dice qué subir, cómo grabarlo y qué decir, palabra por palabra.</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select className="ap-field-input" value={dia} onChange={e => setDia(e.target.value)}><option value="hoy">Hoy</option><option value="manana">Mañana</option></select>
        <input className="ap-field-input" style={{ flex: 1, minWidth: 200 }} value={ctx} onChange={e => setCtx(e.target.value)} placeholder="Cuéntame algo de tu día (opcional): visita a obra, llamada, algo personal…" />
        <button className="rd-btn pri" disabled={trab} onClick={genera}>{trab ? 'Pensando… (30-60 s)' : d ? '🔄 Otra propuesta' : '📲 Dime qué subir'}</button>
      </div>
      {err && <div style={{ color: '#ff9b9b' }}>{err}</div>}
      {d && <>
        <div style={{ fontSize: '0.92rem' }}><b>{d.tipo_del_dia ? d.tipo_del_dia.toUpperCase() + ' · ' : ''}</b>{d.por_que}</div>
        {d.historias.map(h => (
          <div key={h.n} style={{ border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span className="rd-chip arena">Historia {h.n}</span><span className="rd-chip">{h.formato}</span></div>
            <div style={{ fontSize: '0.9rem' }}><b>🎥 Cómo grabarla:</b> {h.grabar}</div>
            {h.texto && <div style={{ fontSize: '0.88rem' }}><b>🔤 Texto en pantalla:</b> {h.texto}</div>}
            {h.hablado && <div style={{ background: 'rgba(143,219,160,.08)', padding: 10, borderRadius: 8 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b style={{ fontSize: '0.8rem' }}>🗣 Lo que dices</b><button className="rd-btn" style={{ padding: '2px 10px', fontSize: '0.72rem' }} onClick={() => copia(h.n, h.hablado)}>{cop === h.n ? '✔ Copiado' : 'Copiar'}</button></div><div style={{ fontStyle: 'italic', marginTop: 4 }}>«{h.hablado}»</div></div>}
            {h.sticker && <div style={{ fontSize: '0.84rem' }}><b>📌 Pegatina:</b> {h.sticker}</div>}
          </div>
        ))}
      </>}
    </div>
  );
}
function RumboRedes({ onCambio }) {
  const [r, setR] = useState(null), [enfoque, setEnfoque] = useState(''), [yaNo, setYaNo] = useState(''), [trab, setTrab] = useState(false), [msg, setMsg] = useState('');
  useEffect(() => { api.get('/redes/rumbo').then(x => { setR(x.data); setEnfoque(x.data.enfoque || ''); setYaNo(x.data.ya_no || ''); }).catch(() => {}); }, []);
  const guarda = async () => { setTrab(true); setMsg(''); try { const x = await api.post('/redes/rumbo', { enfoque, ya_no: yaNo }, { timeout: 150000 }); setR(v => ({ ...(v || {}), ...x.data, enfoque, ya_no: yaNo })); setMsg(x.data.clasificados ? 'Guardado. He clasificado ' + x.data.clasificados + ' reels: ' + x.data.encaja + ' encajan, ' + x.data.formato + ' solo de formato, ' + x.data.fuera + ' fuera de tu rumbo.' : 'Guardado.'); if (onCambio) onCambio(); } catch (e) { setMsg(e.response?.data?.error || 'No se pudo guardar'); } setTrab(false); };
  return (
    <div className="rd-card" style={{ gap: 10 }}>
      <div style={{ ...mut, fontSize: '0.8rem', letterSpacing: '.06em' }}>🧭 HACIA DÓNDE VOY AHORA · manda sobre tu historial</div>
      <div style={{ ...mut, fontSize: '0.84rem' }}>Que lo que funcionó hace tiempo no te arrastre a lo antiguo. La IA clasifica tus reels según tu rumbo: los que ya no encajan dejan de ser modelo de tema; de los que sirven solo de forma, aprende el formato solo si es útil.</div>
      <textarea className="ap-field-input" rows={2} value={enfoque} onChange={e => setEnfoque(e.target.value)} placeholder="Ahora me dirijo a… (ej.: diseño de gimnasios boutique y home gyms premium para…)" />
      <textarea className="ap-field-input" rows={2} value={yaNo} onChange={e => setYaNo(e.target.value)} placeholder="Ya NO me dirijo a… (ej.: campos de fútbol, decoración de casas)" />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><button className="rd-btn pri" disabled={trab || enfoque.trim().length < 5} onClick={guarda}>{trab ? 'Clasificando tus reels… (1-2 min)' : '💾 Guardar y clasificar mis reels'}</button>{r?.clasificados > 0 && !msg && <span style={{ ...mut, fontSize: '0.8rem' }}>{r.encaja} encajan · {r.formato} de formato · {r.fuera} fuera de rumbo</span>}</div>
      {msg && <div style={{ ...mut, fontSize: '0.84rem' }}>{msg}</div>}
    </div>
  );
}
function SemanaTipo({ dias }) {
  const [ab, setAb] = useState(null), [taller, setTaller] = useState(null);
  return <>
    <div className="rd-days">{dias.map((d, i) => <div key={i} className="rd-day" style={{ flexBasis: 170, cursor: 'pointer' }} onClick={() => setAb(d)} title="Pulsa para ver el detalle"><div className="d">{d.dia}</div><div className="t" style={{ WebkitLineClamp: 5, marginTop: 8 }}>{d.que}</div></div>)}</div>
    {ab && <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', zIndex: 9998, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 12 }} onClick={() => setAb(null)}>
      <div className="rd-card" style={{ maxWidth: 560, width: '100%', background: '#15171c', gap: 12 }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: 0 }}>🗓 {ab.dia}</h3>
        <div style={{ fontSize: '0.95rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{ab.que}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="rd-btn pri" onClick={() => { setTaller({ idea: ab.dia + ': ' + ab.que, formato: '', gancho: '', origen: '' }); setAb(null); }}>🎬 Crear el guion de esto</button><button className="rd-btn" onClick={() => setAb(null)}>Cerrar</button></div>
      </div>
    </div>}
    {taller && <TallerIdeas idea={taller} onCerrar={() => setTaller(null)} />}
  </>;
}
function MusicaTendencia() {
  const [d, setD] = useState(null), [err, setErr] = useState(''), [cargando, setCargando] = useState(false);
  const carga = useCallback((refrescar) => { setCargando(true); setErr(''); api.get('/redes/musica/tendencias', { params: refrescar ? { refrescar: 1 } : {} }).then(r => setD(r.data)).catch(e => setErr(e.response?.data?.error || 'No se pudo leer')).finally(() => setCargando(false)); }, []);
  useEffect(() => { carga(false); }, [carga]);
  return (
    <div className="rd-card"><h3>🎵 Música en tendencia (España)</h3>
      <div style={{ ...mut, fontSize: '0.84rem', lineHeight: 1.5 }}>Lo más escuchado ahora en España. <b>Cómo usarlo:</b> al publicar el reel en Instagram, busca esa canción en «Audio» (y mira la flecha ↗ de «En tendencia» que sale ahí). Instagram no deja descargar sus audios ni usarlos en un montaje externo, así que el editor deja el vídeo con tu voz (y música tuya suave si quieres) y el audio de moda lo añades tú al subirlo.</div>
      {err && <div style={{ color: '#ff9b9b' }}>{err}</div>}
      <div><button className="rd-btn" disabled={cargando} onClick={() => carga(true)}>{cargando ? 'Leyendo…' : '🔄 Actualizar'}</button>{d && <span style={{ ...mut, marginLeft: 10 }}>{String(d.fecha).slice(0, 16).replace('T', ' ')}</span>}</div>
      {d && <div className="rd-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))' }}>{d.lista.map(c => <a key={c.puesto} href={c.enlace} target="_blank" rel="noreferrer" className="rd-card" style={{ textDecoration: 'none', color: 'inherit', gap: 6 }}>{c.miniatura && <img src={c.miniatura} alt="" loading="lazy" style={{ width: '100%', borderRadius: 8, aspectRatio: '16/9', objectFit: 'cover' }} />}<div style={{ fontSize: '0.88rem' }}><b>#{c.puesto}</b> {c.titulo}</div><div style={{ ...mut, fontSize: '0.76rem' }}>{c.artista} · {fmt(c.vistas)} vistas</div></a>)}</div>}
    </div>
  );
}
function PestanaAnalizador() {
  const [e, setE] = useState(null), [msg, setMsg] = useState(''), [error, setError] = useState(''), [trabaja, setTrabaja] = useState(''), [pubs, setPubs] = useState(null), [cuentas, setCuentas] = useState(''), [consulta, setConsulta] = useState('diseño de gimnasios'), [nicho, setNicho] = useState(null), [ayuda, setAyuda] = useState(null);
  const [plat, setPlat] = useState('inicio'), [canal, setCanal] = useState(''), [cfgId, setCfgId] = useState(''), [prop, setProp] = useState(''), [propFmt, setPropFmt] = useState('reel'), [pred, setPred] = useState(null), [autopsias, setAutopsias] = useState({});
  const cargar = useCallback(() => api.get('/redes/estado').then(r => setE(r.data)).catch(() => setE({ instagram: null })), []);
  const cargaPubs = useCallback(() => api.get('/redes/instagram/publicaciones').then(r => setPubs(r.data.publicaciones)).catch(() => {}), []);
  useEffect(() => {
    cargar(); api.get('/redes/nicho').then(r => setNicho(r.data)).catch(() => {});
    try { const p = new URLSearchParams(window.location.search); if (p.get('redes') === 'conectado') setMsg('Instagram conectado. Ahora pulsa «Leer publicaciones».'); else if (p.get('redes') === 'error') setError(p.get('msg') || 'No se pudo conectar.'); } catch { /* sin parámetros */ }
  }, [cargar]);
  useEffect(() => { if (e?.instagram?.n_media) cargaPubs(); }, [e?.instagram?.n_media, cargaPubs]);
  useEffect(() => { if (e?.canal_url && !canal) setCanal(e.canal_url); }, [e?.canal_url]); // eslint-disable-line react-hooks/exhaustive-deps
  const hace = async (clave, fn) => { setTrabaja(clave); setError(''); setMsg(''); try { await fn(); await cargar(); } catch (x) { setError(x.response?.data?.error || x.message || 'No se pudo'); } finally { setTrabaja(''); } };
  const guardaCfg = async () => { setError(''); try { await api.post('/redes/config', { config_id: cfgId.trim() }); setMsg('ID guardado. Ahora pulsa «Conectar Instagram».'); setCfgId(''); await cargar(); } catch (x) { setError(x.response?.data?.error || 'No se pudo guardar'); } };
  const conecta = async () => { setError(''); try { const r = await api.get('/redes/instagram/conectar', { params: { origen: window.location.origin } }); setAyuda(r.data.redirect_uri); window.location.href = r.data.url; } catch (x) { setError(x.response?.data?.error || 'No se pudo iniciar la conexión'); } };
  const sync = () => hace('sync', async () => {
    await api.post('/redes/instagram/sincronizar', {}, { timeout: 30000 });
    for (let i = 0; i < 120; i++) { await new Promise(z => setTimeout(z, 4000)); let s = null; try { s = (await api.get('/redes/instagram/sincronizar', { timeout: 20000 })).data; } catch { continue; } /* si el servidor se reinicia, se sigue preguntando */ if (s.error) throw new Error(s.error); if (!s.en_curso) { setMsg('Leídas ' + s.n + ' publicaciones'); await cargaPubs(); return; } }
    throw new Error('Tarda más de lo normal; vuelve a mirar en unos minutos');
  });
  const analiza = () => hace('analiza', async () => { await api.post('/redes/instagram/analizar', {}, { timeout: 280000 }); setMsg('Hecho: lo aprendido ya llega al editor y al asistente.'); });
  const nichoIg = () => hace('nig', async () => { const r = await api.post('/redes/nicho/instagram', { cuentas }, { timeout: 280000 }); setNicho(n => ({ ...(n || {}), instagram: r.data.nicho })); });
  const nichoYt = () => hace('nyt', async () => { const r = await api.post('/redes/nicho/youtube', { consulta }, { timeout: 280000 }); setNicho(n => ({ ...(n || {}), youtube: r.data.nicho })); });
  const miCanal = () => hace('canal', async () => { await api.post('/redes/youtube/mi-canal', { canal }, { timeout: 280000 }); setMsg('Canal leído y analizado.'); });
  const plan = () => hace('plan', async () => { await api.post('/redes/plan', {}, { timeout: 280000 }); setMsg('Plan de publicación preparado.'); });
  const [vPred, setVPred] = useState(null), [vEstado, setVEstado] = useState('');
  const predice = () => hace('pred', async () => {
    let extra = '';
    if (vPred) {
      setVEstado('Subiendo el vídeo…'); const ruta = await subirArchivo(vPred, () => {});
      setVEstado('La IA está mirando cómo está editado…'); const { data: j } = await api.post('/redes/video/analizar', { ruta, nombre: vPred.name, predecir: true, propuesta: prop, formato: propFmt });
      for (let i = 0; i < 90; i++) { await new Promise(r => setTimeout(r, 6000)); const { data: s } = await api.get('/redes/video/' + j.id, { timeout: 150000 }); if (s.estado === 'listo' && s.prediccion) { setPred(s.prediccion); setVEstado(''); return; } if (s.estado === 'listo') { extra = '\n\n' + s.texto; break; } if (s.estado === 'error') { setVEstado(''); throw new Error(s.error || 'No se pudo analizar el vídeo'); } setVEstado((s.progreso || 'Analizando…') + ' ' + (s.pct || 0) + '%'); }
      setVEstado('');
    }
    const r = await api.post('/redes/instagram/predecir', { propuesta: (prop.trim().length >= 15 ? prop : 'Vídeo ya editado, sin más descripción.') + extra, formato: propFmt }, { timeout: 200000 }); setPred(r.data.prediccion);
  });
  const autopsia = (id) => hace('aut' + id, async () => { const r = await api.post('/redes/instagram/autopsia', { id }, { timeout: 200000 }); setAutopsias(a => ({ ...a, [id]: r.data.autopsia })); });
  const desconecta = async () => { if (!window.confirm('¿Desconectar Instagram?')) return; await hace('des', () => api.delete('/redes/instagram')); setPubs(null); };
  const [orden, setOrden] = useState('puntuacion'), [objs, setObjs] = useState(null);
  useEffect(() => { api.get('/redes/objetivos').then(r => setObjs(r.data)).catch(() => {}); }, []);
  const cambiaObjetivo = async (id) => { try { await api.post('/redes/objetivo', { id }); setObjs(o => ({ ...o, actual: id })); await cargaPubs(); await cargar(); } catch { /* se queda */ } };
  const objAct = objs ? objs.objetivos.find(o => o.id === objs.actual) : null;
  const [vid, setVid] = useState(null), [vis2, setVis2] = useState({}), [periodo, setPeriodo] = useState(0), [verFuera, setVerFuera] = useState(false);
  useEffect(() => { api.get('/redes/periodo').then(r => setPeriodo(r.data.dias || 0)).catch(() => {}); }, []);
  const cambiaPeriodo = async (dias) => { try { await api.post('/redes/periodo', { dias }); setPeriodo(dias); await cargaPubs(); } catch { /* se queda */ } };
  useEffect(() => { setVis2(v => (v[plat] ? v : { ...v, [plat]: true })); }, [plat]);
  const mont2 = (k, el) => ((vis2[k] || plat === k) ? <div style={{ display: plat === k ? 'block' : 'none' }}>{el}</div> : null);
  const cargaVid = useCallback(() => api.get('/redes/instagram/videos').then(r => setVid(r.data)).catch(() => {}), []);
  useEffect(() => { cargaVid(); }, [cargaVid]);
  useEffect(() => { if (vid?.estado !== 'procesando') return undefined; const x = setInterval(cargaVid, 8000); return () => clearInterval(x); }, [vid?.estado, cargaVid]);
  const lanzaVid = async () => { try { await api.post('/redes/instagram/videos/analizar', {}, { timeout: 150000 }); setVid({ estado: 'procesando', progreso: 'En cola…', pct: 0 }); } catch (er) { setVid(v => ({ ...(v || {}), estado: 'error', error: er.response?.data?.error || ('No se pudo lanzar (' + (er.response ? 'error ' + er.response.status : er.message || 'sin respuesta del servidor') + ')') })); } };
  if (!e) return <div className="ap-loading">Cargando…</div>;
  const reales = (pubs || []).filter(p => !p.prueba), pruebas = (pubs || []).filter(p => p.prueba && p.motivo !== 'periodo'), fueraPeriodo = (pubs || []).filter(p => p.motivo === 'periodo').length;
  const marca = async (id, v, motivo) => { try { await api.post('/redes/instagram/prueba', { id, prueba: v, motivo }); await cargaPubs(); } catch { /* se queda */ } };
  const ig = e.instagram, ap = e.aprendizaje, mc = e.mi_canal, pl = e.plan, top = reales.filter(p => verFuera || p.rumbo !== 'fuera').sort((a, b) => orden === 'vistas' ? (b.views || b.reach || 0) - (a.views || a.reach || 0) : (b.puntuacion || 0) - (a.puntuacion || 0)).slice(0, 12), maxP = Math.max(1, ...(top.map(p => p.puntuacion || 0)));
  const k = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' M' : n >= 1e3 ? Math.round(n / 1e3) + ' k' : String(n));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="rd-tabs" style={{ alignSelf: 'flex-start' }}>
        <button className={'rd-tab' + (plat === 'inicio' ? ' on' : '')} onClick={() => setPlat('inicio')}>🏠 Hoy</button>
        <button className={'rd-tab' + (plat === 'ig' ? ' on' : '')} onClick={() => setPlat('ig')}>📸 Instagram</button>
        <button className={'rd-tab' + (plat === 'yt' ? ' on' : '')} onClick={() => setPlat('yt')}>▶ YouTube</button>
        <button className={'rd-tab' + (plat === 'salud' ? ' on' : '')} onClick={() => setPlat('salud')}>📊 Salud de la cuenta</button>
        <button className={'rd-tab' + (plat === 'musica' ? ' on' : '')} onClick={() => setPlat('musica')}>🎵 Música en tendencia</button>
        <button className={'rd-tab' + (plat === 'plan' ? ' on' : '')} onClick={() => setPlat('plan')}>📈 Plan de publicación</button>
      </div>
      {error && <div className="ap-error">{error}</div>}
      {msg && <div className="rd-card" style={{ borderColor: 'rgba(124,207,143,0.5)', padding: 14 }}>✓ {msg}</div>}

      {plat === 'ig' && (<>
        {objs && ig && (
          <div className="rd-card">
            <h3>🎯 ¿Qué quieres conseguir?</h3>
            <div style={{ ...mut, fontSize: '0.84rem' }}>«Lo que mejor funciona» depende de tu objetivo. Elígelo y la puntuación, el análisis y las ideas se calculan para eso.</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{objs.objetivos.map(o => <button key={o.id} className={'rd-btn' + (objs.actual === o.id ? ' pri' : '')} title={o.que} onClick={() => cambiaObjetivo(o.id)}>{o.icono} {o.nombre}</button>)}</div>
            {objAct && <div style={{ fontSize: '0.88rem', lineHeight: 1.5 }}><b>{objAct.nombre}:</b> {objAct.que}<div style={mut}>Puntuación = {objAct.formula}</div></div>}
          </div>
        )}
        {!ig ? (
          <div className="rd-card" style={{ alignItems: 'center', textAlign: 'center', padding: 40, gap: 14 }}>
            <div style={{ fontSize: '2.6rem' }}>📸</div>
            <h3 style={{ fontSize: '1.3rem' }}>Conecta tu Instagram</h3>
            <div style={{ ...mut, maxWidth: 460 }}>Un clic: eliges tu cuenta en Facebook y aceptas solo permisos de lectura. No se publica nada.</div>
            <button className="rd-btn pri" onClick={conecta}>Conectar Instagram</button>
            {!e.config && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 560 }}><input className="ap-field-input" style={{ flex: '1 1 240px' }} value={cfgId} onChange={ev => setCfgId(ev.target.value)} placeholder="ID de configuración de Meta (solo números)" /><button className="rd-btn" disabled={!cfgId.trim()} onClick={guardaCfg}>Guardar ID</button></div>}
            {e.config && <span className="rd-chip verde">ID de configuración guardado</span>}
            <details style={{ textAlign: 'left', maxWidth: 560 }}>
              <summary style={{ cursor: 'pointer', ...mut }}>Si Meta da error (solo la primera vez)</summary>
              <ol style={{ fontSize: '0.86rem', lineHeight: 1.6, paddingLeft: 18 }}>
                <li>developers.facebook.com → Mis apps → <b>Ranuse Asistente</b>.</li>
                <li>Dominios de la app y URI de redireccionamiento: <code style={{ wordBreak: 'break-all' }}>{ayuda || 'https://ranusecrm-main-production.up.railway.app/api/redes/instagram/callback'}</code></li>
              </ol>
            </details>
          </div>
        ) : (<>
          <div className="rd-card" style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
            {ig.foto ? <img src={ig.foto} alt="" style={{ width: 64, height: 64, borderRadius: 32, objectFit: 'cover' }} /> : <div style={{ width: 64, height: 64, borderRadius: 32, background: 'rgba(255,255,255,.1)' }} />}
            <div style={{ flex: '1 1 200px' }}><div style={{ fontSize: '1.3rem', fontWeight: 800 }}>@{ig.usuario}</div><div style={mut}>{ig.ultima_sync ? 'Leído el ' + String(ig.ultima_sync).slice(0, 10) : 'Aún sin leer'} · conexión: {ig.expira_dias} días</div></div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="rd-btn" disabled={!!trabaja} onClick={sync}>{trabaja === 'sync' ? 'Leyendo…' : '↻ Leer publicaciones'}</button>
              <button className="rd-btn pri" disabled={!!trabaja || !ig.n_media} onClick={analiza}>{trabaja === 'analiza' ? 'Analizando…' : '🧠 Aprender de lo que funciona'}</button>
              <button className="rd-btn" disabled={!!trabaja} onClick={desconecta} title="Desconectar">✕</button>
            </div>
          </div>
          <div className="rd-kpis">
            <div className="rd-kpi"><b>{fmt(ig.seguidores)}</b><span>seguidores</span></div>
            <div className="rd-kpi"><b>{fmt(ig.publicaciones)}</b><span>publicaciones en total</span></div>
            <div className="rd-kpi"><b>{fmt(ig.n_media)}</b><span>publicaciones leídas</span></div>
            <div className="rd-kpi"><b>{top[0] ? top[0].puntuacion : '—'}</b><span>mejor puntuación</span></div>
          </div>
          {top.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '0 0 10px' }}><h3 style={{ margin: 0 }}>🏆 Lo que mejor te ha funcionado{objAct ? ' · ' + objAct.icono + ' ' + objAct.nombre : ''}</h3><div className="rd-tabs" title="Qué publicaciones cuentan para el ranking, el análisis y las predicciones">{[[0, 'Desde siempre'], [365, '12 meses'], [180, '6 meses'], [90, '3 meses'], [30, '30 días']].map(([d, n]) => <button key={d} className={'rd-tab' + (periodo === d ? ' on' : '')} style={{ padding: '5px 12px' }} onClick={() => cambiaPeriodo(d)}>{n}</button>)}</div>{(pubs || []).some(p => p.rumbo === 'fuera') && <button className={'rd-btn' + (verFuera ? ' pri' : '')} style={{ padding: '5px 12px', fontSize: '0.76rem' }} onClick={() => setVerFuera(v => !v)} title='Mostrar también lo que está fuera de tu rumbo actual'>{verFuera ? 'Ocultar fuera de rumbo' : 'Ver también fuera de rumbo'}</button>}<div className="rd-tabs"><button className={'rd-tab' + (orden === 'puntuacion' ? ' on' : '')} style={{ padding: '5px 12px' }} onClick={() => setOrden('puntuacion')} title={objAct ? 'Puntuación = ' + objAct.formula : ''}>Por puntuación</button><button className={'rd-tab' + (orden === 'vistas' ? ' on' : '')} style={{ padding: '5px 12px' }} onClick={() => setOrden('vistas')}>Por vistas</button></div></div>
              <div className="rd-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(190px,1fr))' }}>
                {top.slice(0, 8).map(p => <a key={p.id} href={p.enlace} target="_blank" rel="noreferrer" className="rd-post" style={{ textDecoration: 'none', color: 'inherit' }}>{p.miniatura && <img src={p.miniatura} alt="" loading="lazy" />}<span className="pt" title={objAct ? objAct.unidad : ''}>{p.puntuacion}</span>{p.rumbo && p.rumbo !== 'encaja' && <span style={{ position: 'absolute', left: 8, top: 40, zIndex: 3, fontSize: '0.66rem', padding: '2px 8px', borderRadius: 12, background: 'rgba(0,0,0,.65)', color: p.rumbo === 'fuera' ? '#ff9b9b' : '#f2c46d' }}>{p.rumbo === 'fuera' ? '↩ fuera de rumbo' : '◐ solo el formato'}</span>}<div style={{ position: 'absolute', top: 8, right: 8, zIndex: 3, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>{[['marca', '🏷 Ya no es mi marca', 'Es un vídeo antiguo o que ya no representa tu marca: que no cuente ni se imite'], ['repetido', '🔁 Repetido', 'Es el mismo vídeo que otro: que no cuente dos veces'], ['prueba', '🧪 Prueba', 'Fue una prueba: que no cuente']].map(([m, n, tt]) => <button key={m} title={tt} onClick={ev => { ev.preventDefault(); ev.stopPropagation(); marca(p.id, true, m); }} style={{ padding: '2px 8px', fontSize: '0.68rem', borderRadius: 14, border: '1px solid rgba(255,255,255,.25)', background: 'rgba(0,0,0,.6)', color: '#fff', cursor: 'pointer' }}>{n}</button>)}</div><div className="vel"><b>{(p.pie || '(sin texto)').slice(0, 70)}</b><div style={{ opacity: 0.75 }}>{p.views != null ? k(p.views) + ' vistas' : p.reach != null ? 'alcance ' + fmt(p.reach) : p.tipo}{p.saved != null ? ' · ' + p.saved + ' guardados' : ''}</div></div></a>)}
              </div>
            </div>
          )}
          <div className="rd-card"><h3>🎞 Cómo están editados tus reels</h3>
            <div style={{ ...mut, fontSize: '0.84rem' }}>La IA mira tus mejores y peores reels (ritmo de planos, duración, gancho, voz), sin guardarlos, y deduce qué de la edición marca la diferencia. Lo que aprende pasa solo al editor de vídeo.</div>
            {vid?.estado === 'procesando' && <div><div style={{ height: 6, background: 'rgba(255,255,255,.1)', borderRadius: 4 }}><div style={{ width: (vid.pct || 3) + '%', height: 6, background: '#8fdba0', borderRadius: 4 }} /></div><div style={mut}>{vid.progreso || 'Analizando…'} (tarda unos minutos)</div></div>}
            {vid?.estado === 'error' && <div style={{ color: '#ff9b9b' }}>{vid.error}</div>}
            {vid?.estado !== 'procesando' && <div><button className="rd-btn pri" onClick={lanzaVid}>{vid?.analisis ? '🔄 Analizar otra vez' : '🔍 Analizar mis reels'}</button></div>}
            {vid?.analisis && <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: '0.9rem' }}>{vid.analisis.resumen}</div>
              <div className="rd-grid2">
                {(vid.analisis.gana || []).length > 0 && <Tarjeta titulo="En los que funcionan" color="#8fdba0"><Lista items={vid.analisis.gana} color="#8fdba0" /></Tarjeta>}
                {(vid.analisis.pierde || []).length > 0 && <Tarjeta titulo="En los que no" color="#ff9b9b"><Lista items={vid.analisis.pierde} color="#ff9b9b" /></Tarjeta>}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{vid.analisis.duracion_ideal_s && <span className="rd-chip">⏱ Duración ideal: {vid.analisis.duracion_ideal_s}</span>}{vid.analisis.ritmo_ideal && <span className="rd-chip">✂️ Plano medio: {vid.analisis.ritmo_ideal}</span>}<span className="rd-chip">{vid.analisis.n} reels analizados</span></div>
              {(vid.analisis.reglas_edicion || []).length > 0 && <div><b>🤖 Reglas que ya usa el editor</b><Lista items={vid.analisis.reglas_edicion} /></div>}
              <DetalleReels lista={vid.analisis.detalle_reels} />
              {vid.analisis.fiabilidad && <div style={{ ...mut, fontSize: '0.78rem' }}>Fiabilidad: {vid.analisis.fiabilidad}</div>}
            </div>}
          </div>
          {pruebas.length > 0 && <div className="rd-card"><h3>🚫 Reels que no cuentan <span className="rd-chip">{pruebas.length}</span></h3><div style={{ ...mut, fontSize: '0.82rem' }}>No cuentan para el análisis ni se toman como modelo: pruebas, repetidos, vídeos antiguos que ya no son tu marca, o los que casi no se mostraron. Si alguno sí debe contar, devuélvelo.</div>{pruebas.map(p => <div key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', borderTop: '1px solid rgba(255,255,255,.07)', fontSize: '0.84rem' }}><a href={p.enlace} target="_blank" rel="noreferrer" style={{ flex: 1, color: 'inherit' }}>{(p.pie || '(sin texto)').slice(0, 80)}<div style={mut}>{String(p.fecha).slice(0, 10)} · {fmt(p.views ?? p.reach ?? 0)} vistas · {({ marca: '🏷 ya no es tu marca', repetido: '🔁 repetido', prueba: '🧪 prueba', pocas_vistas: '👁 casi no se mostró' })[p.motivo] || 'excluido'}</div></a><button className="rd-btn" style={{ padding: '4px 10px', fontSize: '0.74rem' }} onClick={() => marca(p.id, false)}>Que vuelva a contar</button></div>)}</div>}
          <BuscaReel ig={ig} leyendo={trabaja === 'sync'} onLeer={sync} onAnadido={() => { cargaPubs(); cargar(); }} />
          {top.length > 0 && <div className="rd-card"><h3>Ranking y autopsia</h3>{top.slice(0, 10).map(p => <div key={p.id}><div className="rd-bar"><span style={{ width: 150, flex: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(p.pie || p.tipo).slice(0, 26)}</span><i style={{ width: Math.max(4, (p.puntuacion || 0) / maxP * 100) + '%' }} /><b>{p.puntuacion}</b><button className="rd-btn" style={{ padding: '4px 10px', fontSize: '0.74rem' }} disabled={!!trabaja} onClick={() => autopsia(p.id)}>{trabaja === 'aut' + p.id ? '…' : '¿Por qué?'}</button><button className="rd-btn" style={{ padding: '4px 10px', fontSize: '0.74rem' }} title="Márcalo si fue una prueba y no debe contar" onClick={() => marca(p.id, true)}>🧪</button></div>{autopsias[p.id] && <div style={{ margin: '4px 0 10px 0', padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,.05)', fontSize: '0.85rem', lineHeight: 1.5 }}><span className={'rd-chip ' + (autopsias[p.id].veredicto === 'repetir' ? 'verde' : autopsias[p.id].veredicto === 'dejar' ? 'rojo' : 'ambar')}>{autopsias[p.id].veredicto}</span> {autopsias[p.id].resumen}<Lista items={autopsias[p.id].por_que} />{(autopsias[p.id].que_haria_distinto || []).length > 0 && <div style={{ marginTop: 6 }}><b>Yo haría distinto:</b><Lista items={autopsias[p.id].que_haria_distinto} color="#f2c46d" /></div>}{autopsias[p.id].como_repetirlo && <div style={{ marginTop: 6, ...mut }}>Cómo repetirlo: {autopsias[p.id].como_repetirlo}</div>}</div>}</div>)}</div>}
          <div className="rd-card">
            <h3>🔮 Predice un vídeo antes de hacerlo</h3>
            <div style={{ ...mut, fontSize: '0.84rem' }}>Cuéntame la idea y te digo cuántas visualizaciones podría tener, según TUS números, y cómo mejorarla.</div>
            <textarea className="ap-field-input" rows={3} value={prop} onChange={ev => setProp(ev.target.value)} placeholder="Ej.: Reel de 30 s en obra: «El error que te cuesta 5.000 € al montar un gimnasio», con un antes y después del suelo…" />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select className="ap-field-input" value={propFmt} onChange={ev => setPropFmt(ev.target.value)}><option value="reel">Reel</option><option value="carrusel">Carrusel</option><option value="foto">Foto</option><option value="historia">Historia</option></select>
              <label className="rd-btn" style={{ cursor: 'pointer' }}>{vPred ? '🎞 ' + vPred.name.slice(0, 24) : '🎞 Subir el vídeo ya editado'}<input type="file" accept="video/*" style={{ display: 'none' }} onChange={ev => setVPred(ev.target.files?.[0] || null)} /></label>
              {vPred && <button className="rd-btn" onClick={() => setVPred(null)}>✕</button>}
              <button className="rd-btn pri" disabled={trabaja === 'pred' || (prop.trim().length < 15 && !vPred)} onClick={predice} title={trabaja && trabaja !== 'pred' ? 'Hay otra tarea en marcha, pero puedes estimar igualmente' : ''}>{trabaja === 'pred' ? (vEstado || 'Calculando…') : 'Estimar'}</button>
            </div>
            {pred && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 6 }}>
                <div className="rd-kpis" style={{ marginBottom: 0 }}>
                  <div className="rd-kpi"><b>{fmt(pred.estimacion.bajo)}</b><span>pesimista</span></div>
                  <div className="rd-kpi" style={{ borderColor: '#e3d2b8' }}><b>{fmt(pred.estimacion.medio)}</b><span>lo más probable · {pred.estimacion.metrica}</span></div>
                  <div className="rd-kpi"><b>{fmt(pred.estimacion.alto)}</b><span>optimista</span></div>
                  <div className="rd-kpi"><b style={{ fontSize: '1.3rem' }}>{pred.confianza}</b><span>confianza</span></div>
                </div>
                <div style={{ fontSize: '0.92rem', lineHeight: 1.5 }}>{pred.por_que}</div>
                <div className="rd-grid2">
                  <Tarjeta titulo="A favor" color="#8fdba0"><Lista items={pred.a_favor} color="#8fdba0" /></Tarjeta>
                  <Tarjeta titulo="En contra" color="#f2c46d"><Lista items={pred.en_contra} color="#f2c46d" /></Tarjeta>
                </div>
                {(pred.mejoras || []).length > 0 && <Tarjeta titulo="Cómo mejorarlo"><Lista ejemplo items={pred.mejoras.map(x => x.cambio + (x.efecto ? ' → ' + x.efecto : ''))} /></Tarjeta>}
                {pred.version_mejorada?.gancho && <Tarjeta titulo="Versión mejorada"><div className="rd-gancho">“{pred.version_mejorada.gancho}”</div>{pred.version_mejorada.estructura && <div style={{ fontSize: '0.88rem' }}>{pred.version_mejorada.estructura}</div>}{pred.version_mejorada.cta && <div style={mut}>CTA: {pred.version_mejorada.cta}</div>}</Tarjeta>}
                {(pred.dejar_de_hacer || []).length > 0 && <Tarjeta titulo="Quítalo" color="#f29a9a"><Lista items={pred.dejar_de_hacer} color="#f29a9a" /></Tarjeta>}
                <div style={mut}>Es una estimación sobre tus publicaciones, no una promesa.</div>
              </div>
            )}
          </div>
        </>)}
        {ap && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}><h3 style={{ margin: 0, fontSize: '1.2rem' }}>🧠 Lo que funciona en tu Instagram</h3><span style={mut}>{String(ap.fecha).slice(0, 10)} · {ap.n} publicaciones</span></div>
            {ap.resumen && <div style={{ fontSize: '1rem', lineHeight: 1.5 }}>{ap.resumen}</div>}
            <div className="rd-grid2">
              <Tarjeta titulo="✓ Funciona" color="#8fdba0"><Lista ejemplo items={ap.lo_que_funciona} color="#8fdba0" /></Tarjeta>
              <Tarjeta titulo="✕ No funciona" color="#f2c46d"><Lista items={ap.lo_que_no} color="#f2c46d" /></Tarjeta>
              {(ap.ganchos_ganadores || []).length > 0 && <Tarjeta titulo="Ganchos ganadores"><Lista ejemplo items={ap.ganchos_ganadores} /></Tarjeta>}
              {(ap.para_el_editor || []).length > 0 && <Tarjeta titulo="🎬 Para el editor"><Lista items={ap.para_el_editor} /></Tarjeta>}
              {(ap.para_historias || []).length > 0 && <Tarjeta titulo="📲 Para las historias"><Lista items={ap.para_historias} /></Tarjeta>}
              {ap.horarios && <Tarjeta titulo="🕒 Mejores horas"><div style={{ fontSize: '0.9rem', lineHeight: 1.5 }}>{ap.horarios}</div></Tarjeta>}
            </div>
            {(ap.ideas_ganadoras || []).length > 0 && <div><h3 style={{ margin: '4px 0 10px' }}>💡 Ideas ganadoras para ti</h3><IdeasTarjetas ideas={ap.ideas_ganadoras} /></div>}
            {ap.fiabilidad && <div style={mut}>Fiabilidad: {ap.fiabilidad}</div>}
          </div>
        )}
        <div className="rd-card">
          <h3>🔎 Ideas ganadoras en tu nicho · Instagram</h3>
          <CuentasNicho ig={ig} onUsar={(u) => setCuentas(u)} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input className="ap-field-input" style={{ flex: '1 1 260px' }} value={cuentas} onChange={ev => setCuentas(ev.target.value)} placeholder="Cuentas del nicho separadas por comas (ej.: gymcompany_es)" disabled={!ig} />
            <button className="rd-btn pri" disabled={!ig || !cuentas.trim() || !!trabaja} onClick={nichoIg}>{trabaja === 'nig' ? 'Analizando…' : 'Analizar cuentas'}</button>
          </div>
          <div style={{ ...mut, fontSize: '0.8rem' }}>De otras cuentas solo se ve lo público (texto, me gusta y comentarios), y solo de cuentas profesionales.</div>
          <ResultadoNicho n={nicho?.instagram} />
          <EstudiaReferente />
        </div>
      </>)}

      {plat === 'yt' && (<>
        <div className="rd-card">
          <h3>▶ Tu canal de YouTube</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input className="ap-field-input" style={{ flex: '1 1 300px' }} value={canal} onChange={ev => setCanal(ev.target.value)} placeholder="youtube.com/@tuCanal" disabled={!e.youtube} />
            <button className="rd-btn pri" disabled={!e.youtube || !canal.trim() || !!trabaja} onClick={miCanal}>{trabaja === 'canal' ? 'Leyendo…' : mc ? '↻ Actualizar y analizar' : 'Leer y analizar mi canal'}</button>
          </div>
          {mc && (<>
            <div className="rd-kpis" style={{ marginBottom: 0 }}>
              <div className="rd-kpi"><b>{fmt(mc.suscriptores)}</b><span>suscriptores</span></div>
              <div className="rd-kpi"><b>{fmt(mc.videos_total)}</b><span>vídeos</span></div>
              <div className="rd-kpi"><b>{k(mc.vistas_total || 0)}</b><span>vistas totales</span></div>
              <div className="rd-kpi"><b>{k(Math.max(0, ...(mc.videos || []).map(v => v.vistas)))}</b><span>vídeo más visto</span></div>
            </div>
            {(mc.videos || []).length > 0 && <div className="rd-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))' }}>{mc.videos.slice().sort((a, b) => b.vistas - a.vistas).slice(0, 8).map(v => <a key={v.id} href={v.enlace} target="_blank" rel="noreferrer" className="rd-post" style={{ textDecoration: 'none', color: 'inherit', aspectRatio: '16/11' }}>{v.miniatura && <img src={v.miniatura} alt="" loading="lazy" />}<span className="pt">{k(v.vistas)}</span><div className="vel"><b>{v.titulo}</b><div style={{ opacity: 0.75 }}>{v.tipo} · {v.fecha}</div></div></a>)}</div>}
            {mc.analisis && (<div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {mc.analisis.resumen && <div style={{ lineHeight: 1.5 }}>{mc.analisis.resumen}</div>}
              <div className="rd-grid2">
                <Tarjeta titulo="✓ Funciona" color="#8fdba0"><Lista items={mc.analisis.funciona} color="#8fdba0" /></Tarjeta>
                <Tarjeta titulo="✕ No funciona" color="#f2c46d"><Lista items={mc.analisis.no_funciona} color="#f2c46d" /></Tarjeta>
                {mc.analisis.formato && <Tarjeta titulo="Shorts o largos"><div style={{ fontSize: '0.9rem', lineHeight: 1.5 }}>{mc.analisis.formato}</div></Tarjeta>}
                {(mc.analisis.titulos || []).length > 0 && <Tarjeta titulo="Títulos que te funcionan"><Lista items={mc.analisis.titulos} /></Tarjeta>}
                {mc.analisis.cadencia && <Tarjeta titulo="🗓 Cadencia"><div style={{ fontSize: '0.9rem', lineHeight: 1.5 }}>{mc.analisis.cadencia}</div></Tarjeta>}
              </div>
              {(mc.analisis.ideas || []).length > 0 && <div><h3 style={{ margin: '4px 0 10px' }}>💡 Ideas para tu canal</h3><IdeasTarjetas ideas={mc.analisis.ideas} /></div>}
              {mc.analisis.fiabilidad && <div style={mut}>Fiabilidad: {mc.analisis.fiabilidad} (sin retención ni tráfico: eso solo lo da YouTube Studio)</div>}
            </div>)}
          </>)}
        </div>
        <div className="rd-card">
          <h3>🔎 Ideas ganadoras en tu nicho · YouTube</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input className="ap-field-input" style={{ flex: '1 1 260px' }} value={consulta} onChange={ev => setConsulta(ev.target.value)} placeholder="Qué buscar en YouTube" disabled={!e.youtube} />
            <button className="rd-btn pri" disabled={!e.youtube || !consulta.trim() || !!trabaja} onClick={nichoYt}>{trabaja === 'nyt' ? 'Analizando…' : 'Buscar y analizar'}</button>
          </div>
          <ResultadoNicho n={nicho?.youtube} />
        </div>
      </>)}

      {mont2('inicio', <InicioRedes ir={setPlat} />)}
      {mont2('musica', <MusicaTendencia />)}
      {mont2('salud', <SaludCuenta />)}
      {plat === 'plan' && (<>
        <div className="rd-card" style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
          <div style={{ flex: '1 1 300px' }}><h3>📈 Plan de publicación</h3><div style={{ ...mut, fontSize: '0.84rem', marginTop: 4 }}>Cuántas veces publicar y qué, según tus datos de Instagram y YouTube y lo que se ve en el nicho.</div></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{pl && <button className="rd-btn" onClick={() => exportaPlanPDF(pl, ig?.usuario)}>📄 Descargar PDF</button>}<button className="rd-btn pri" disabled={!!trabaja || (!ig && !mc)} onClick={plan}>{trabaja === 'plan' ? 'Preparando…' : pl ? '↻ Rehacer el plan' : 'Preparar mi plan'}</button></div>
        </div>
        {!ig && !mc && <div style={mut}>Conecta Instagram o añade tu canal de YouTube primero.</div>}
        {pl && (<>
          <div className="rd-kpis">
            <div className="rd-kpi"><b>{pl.volumen.reels_semana}</b><span>reels por semana</span></div>
            <div className="rd-kpi"><b>{pl.volumen.carruseles_semana}</b><span>carruseles por semana</span></div>
            <div className="rd-kpi"><b>{pl.volumen.historias_dia}</b><span>historias al día</span></div>
            <div className="rd-kpi"><b>{pl.volumen.youtube_mes}</b><span>vídeos de YouTube al mes</span></div>
          </div>
          {pl.volumen.por_que && <div style={{ lineHeight: 1.5 }}>{pl.volumen.por_que}</div>}
          {pl.dias_horas && <Tarjeta titulo="🕒 Mejores días y horas"><div style={{ fontSize: '0.92rem', lineHeight: 1.5 }}>{pl.dias_horas}</div></Tarjeta>}
          {(pl.semana_tipo || []).length > 0 && <div><h3 style={{ margin: '4px 0 10px' }}>🗓 Tu semana tipo</h3><SemanaTipo dias={pl.semana_tipo} /></div>}
          <div className="rd-grid2">
            {(pl.tendencias || []).length > 0 && <Tarjeta titulo="🔥 Tendencias y cómo aprovecharlas"><TendenciasPlan items={pl.tendencias} /></Tarjeta>}
            {(pl.experimentos || []).length > 0 && <Tarjeta titulo="🧪 Pruebas para las próximas 2 semanas"><Lista ejemplo items={pl.experimentos} /></Tarjeta>}
            {(pl.riesgos || []).length > 0 && <Tarjeta titulo="⚠ Ojo con" color="#f2c46d"><Lista items={pl.riesgos} color="#f2c46d" /></Tarjeta>}
            {(pl.faltan_datos || []).length > 0 && <Tarjeta titulo="Lo que aún no sé"><Lista items={pl.faltan_datos} /></Tarjeta>}
          </div>
          <div style={mut}>De las tendencias de la plataforma (audios, formatos del momento) Instagram no da datos oficiales: se deducen de tus números, del nicho y de lo que sé en general.</div>
        </>)}
      </>)}
    </div>
  );
}

// Departamento de redes: ideas, calendario y las reglas de marca (se irá ampliando con publicar y medir)
export function SectionRedes() {
  const [vistas, setVistas] = useState({});
  const [seccion, setSeccion] = useState(() => { try { return new URLSearchParams(window.location.search).get('redes') ? 'medir' : 'medir'; } catch { return 'medir'; } });
  useEffect(() => { setVistas(v => (v[seccion] ? v : { ...v, [seccion]: true })); }, [seccion]);
  const mont = (k, el) => ((vistas[k] || seccion === k) ? <div style={{ display: seccion === k ? 'block' : 'none' }}>{el}</div> : null);
  const TABS = [['medir', Film, 'Analizador'], ['ideas', Wand2, 'Ideas y calendario'], ['guion', Music, 'Guionizador'], ['marca', Settings2, 'Voz de marca']];
  return (
    <div className="ev-root rd-wrap">
      <style>{ESTILO_SELECT + ESTILO_REDES}</style>
      <div className="rd-head">
        <div><h1 className="rd-title">Departamento de redes</h1><div className="rd-sub">Ideas, guiones y lo que de verdad te funciona.</div></div>
        <div className="rd-tabs">{TABS.map(([k, Icono, n]) => <button key={k} className={'rd-tab' + (seccion === k ? ' on' : '')} onClick={() => setSeccion(k)}><Icono size={15} /> {n}</button>)}</div>
      </div>
      {mont('ideas', <PestanaIdeas />)}
      {mont('guion', <Guionizador />)}
      {mont('marca', <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}><VozMarca /><div className="rd-card"><CajaReglas /></div></div>)}
      {mont('medir', <PestanaAnalizador />)}
    </div>
  );
}

export function SectionEstudioVideo() {
  const [tab, setTab] = useState('videos'), [carpetas, setCarpetas] = useState([]), [pistas, setPistas] = useState([]), [formatos, setFormatos] = useState([]), [trabajos, setTrabajos] = useState(null), [error, setError] = useState('');
  const cargarF = useCallback(() => api.get('/estudio-video/formatos').then(r => setFormatos(r.data.formatos || [])).catch(() => setError('No se han podido cargar los formatos')), []);
  // Al refrescar la lista NO se cambian los enlaces de los vídeos ni los trabajos que no han cambiado: así los reproductores y los paneles abiertos no se reinician
  const cargarT = useCallback(() => api.get('/estudio-video/trabajos').then(r => {
    const nuevos = r.data.trabajos || [];
    setTrabajos(prev => {
      if (!prev) return nuevos;
      const viejos = new Map(prev.map(x => [x.id, x])); const sinUrl = (x) => JSON.stringify({ ...x, url: null, url_movil: null });
      const out = nuevos.map(n => { const v = viejos.get(n.id); if (!v) return n; if (v.resultado && v.resultado === n.resultado) { n.url = v.url; n.url_movil = v.url_movil; } return sinUrl(v) === sinUrl(n) ? v : n; });
      return out.length === prev.length && out.every((x, i) => x === prev[i]) ? prev : out;
    });
  }).catch(() => setTrabajos(t => t || [])), []);
  const cargarM = useCallback(() => api.get('/estudio-video/musica').then(r => setPistas(r.data.pistas || [])).catch(() => {}), []);
  useEffect(() => { cargarF(); cargarT(); cargarM(); api.get('/estudio-video/carpetas').then(r => setCarpetas(r.data.carpetas || [])).catch(() => {}); }, [cargarF, cargarT, cargarM]);
  const hayActivos = (trabajos || []).some(t => t.estado === 'pendiente' || t.estado === 'procesando');
  useEffect(() => { if (!hayActivos) return; const i = setInterval(cargarT, 5000); return () => clearInterval(i); }, [hayActivos, cargarT]);
  return (
    <div className="ev-root rd-wrap">
      <style>{ESTILO_SELECT + ESTILO_REDES}</style>
      <div className="rd-head">
        <div><h1 className="rd-title">Estudio de vídeo</h1><div className="rd-sub">Sube el material, elige formato y estilo, y el editor lo monta.</div></div>
        <div className="rd-tabs">
          {[['videos', Film, 'Vídeos'], ['formatos', Settings2, 'Formatos y estilos'], ['musica', Music, 'Música'], ['efectos', Wand2, 'Efectos'], ['editor', Mic, 'Habla con el editor']].map(([k, Icono, n]) => <button key={k} className={'rd-tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}><Icono size={15} /> {n}</button>)}
        </div>
      </div>
      {error && <div className="ap-error" style={{ marginBottom: 10 }}>{error}</div>}
      {tab === 'editor' ? <PestanaEditor trabajos={trabajos || []} /> : tab === 'efectos' ? <PestanaEfectos /> : tab === 'formatos' ? <><AprenderReferencia formatos={formatos} onCambio={cargarT} /><Formatos formatos={formatos} onCambio={cargarF} /><EstilosPestana /></> : tab === 'ideas' ? <PestanaIdeas /> : tab === 'musica' ? <PestanaMusica pistas={pistas} onCambio={cargarM} /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Nuevo formatos={formatos} musica={pistas} carpetas={carpetas} trabajos={trabajos} onCreado={cargarT} />
          {trabajos === null ? <div className="ap-loading">Cargando…</div> : trabajos.length === 0 ? <div style={mut}>Todavía no hay vídeos. Sube el primero arriba.</div> : trabajos.map(t => <Trabajo key={t.id} t={t} formatos={formatos} musica={pistas} trabajosTodos={trabajos} onCambio={cargarT} />)}
        </div>
      )}
    </div>
  );
}
