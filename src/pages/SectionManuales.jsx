import { useState, useEffect, useRef } from 'react';
import api from '../services/api';
import { BookOpen, Plus, Trash2, ArrowLeft, ArrowUp, ArrowDown, FileDown, Image as Img, LayoutGrid, Type, History, Loader2 } from 'lucide-react';

const card = { background: 'linear-gradient(160deg,rgba(255,255,255,.055),rgba(255,255,255,.02))', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, padding: '.9rem 1rem' };
const mut = { color: 'rgba(255,255,255,0.5)', fontSize: '0.78rem' };
const inp = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: '#fff', padding: '6px 9px', fontSize: '0.82rem', width: '100%', boxSizing: 'border-box' };
const btn = (x) => ({ ...inp, width: 'auto', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, ...x });
const err = (e, d) => e?.response?.data?.error || d;
const TIPOS = [['maquina', 'Máquinas (sin tipo)'], ['cardio', 'Cardio'], ['pin', 'Máquinas de pin'], ['discos', 'Discos / palanca'], ['poleas', 'Poleas'], ['libre', 'Peso libre'], ['funcional', 'Funcional']];
const ESPEC0 = { ancho: 9, fondo: 10, orient: 'x', anchoMaq: 1.1, fondoMaq: 1.9, pasillo: 1.1, hueco: 0.1, cortes: [], filasTipos: [] };

function Esquema({ spec, onChange }) {
  const [vista, setVista] = useState(null), t = useRef(null);
  useEffect(() => { clearTimeout(t.current); t.current = setTimeout(() => { api.post('/manuales/esquema/svg', { spec }).then(r => setVista(r.data)).catch(() => setVista(null)); }, 350); return () => clearTimeout(t.current); }, [JSON.stringify(spec)]);
  const set = (k, v) => onChange({ ...spec, [k]: v });
  const campo = (k, et, paso = 0.1) => (<label style={{ ...mut, display: 'grid', gap: 3 }}>{et}<input style={inp} type="number" step={paso} value={spec[k]} onChange={e => set(k, e.target.value === '' ? '' : Number(e.target.value))} /></label>);
  const corte = spec.cortes[0];
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(110px,1fr))', gap: 8 }}>
        {campo('ancho', 'Ancho local (m)')}{campo('fondo', 'Fondo local (m)')}{campo('anchoMaq', 'Ancho máquina (m)')}{campo('fondoMaq', 'Fondo máquina (m)')}{campo('pasillo', 'Pasillo (m)')}
        <label style={{ ...mut, display: 'grid', gap: 3 }}>Filas a lo largo de
          <select style={inp} value={spec.orient} onChange={e => set('orient', e.target.value)}><option value="x">El ancho</option><option value="y">El fondo</option></select></label>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <label style={{ ...mut, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={!!corte} onChange={e => set('cortes', e.target.checked ? [{ x: Math.round(spec.ancho / 2 - 1), ancho: 2, etiqueta: 'Paso' }] : [])} /> Paso central libre</label>
        {corte && <><label style={{ ...mut, display: 'grid', gap: 3 }}>Empieza en (m)<input style={{ ...inp, width: 90 }} type="number" step="0.1" value={corte.x} onChange={e => set('cortes', [{ ...corte, x: Number(e.target.value) }])} /></label>
          <label style={{ ...mut, display: 'grid', gap: 3 }}>Ancho (m)<input style={{ ...inp, width: 90 }} type="number" step="0.1" value={corte.ancho} onChange={e => set('cortes', [{ ...corte, ancho: Number(e.target.value) }])} /></label></>}
      </div>
      <div style={mut}>Tipo de cada fila (de la pared de arriba hacia abajo): <input style={{ ...inp, width: 'auto', minWidth: 260 }} placeholder="cardio, pin, pin, discos" value={(spec.filasTipos || []).join(', ')} onChange={e => set('filasTipos', e.target.value.split(',').map(x => x.trim().toLowerCase()).filter(Boolean))} title={TIPOS.map(x => x[0]).join(', ')} /> <span>({TIPOS.map(x => x[0]).join(' · ')})</span></div>
      {vista ? <div style={{ background: '#fff', borderRadius: 10, padding: 6 }} dangerouslySetInnerHTML={{ __html: vista.svg }} /> : <div style={mut}>Calculando…</div>}
      {vista && <div style={mut}>{vista.resumen.total} máquinas en {vista.resumen.filas} filas. Fondo usado {vista.resumen.fondoUsado} m{vista.resumen.sobra > 0.05 ? ` (sobran ${vista.resumen.sobra} m)` : ''}.</div>}
    </div>
  );
}

function Editor({ id, volver }) {
  const [m, setM] = useState(null), [cap, setCap] = useState(0), [aviso, setAviso] = useState(''), [ocupado, setOcupado] = useState(''), [hist, setHist] = useState(null), t = useRef(null), ultimo = useRef(null), fileRef = useRef(null), dest = useRef(null);
  const flash = (x) => { setAviso(x); setTimeout(() => setAviso(''), 4000); };
  useEffect(() => { api.get('/manuales/' + id).then(r => setM(r.data.manual)).catch(() => flash('No se pudo abrir')); }, [id]);
  const cambia = (n) => { setM(n); ultimo.current = n; clearTimeout(t.current); t.current = setTimeout(() => api.put('/manuales/' + id, n).then(r => { if (ultimo.current === n) setM(x => ({ ...x, actualizado: r.data.manual.actualizado })); }).catch(() => flash('No se pudo guardar')), 1000); };
  useEffect(() => () => { if (ultimo.current && t.current) { clearTimeout(t.current); api.put('/manuales/' + id, ultimo.current).catch(() => {}); } }, [id]);
  if (!m) return <div className="ap-loading">Cargando…</div>;
  const c = m.capitulos[Math.min(cap, m.capitulos.length - 1)];
  const setCapitulo = (n) => cambia({ ...m, capitulos: m.capitulos.map(x => x.id === c.id ? n : x) });
  const setBloque = (b) => setCapitulo({ ...c, bloques: c.bloques.map(x => x.id === b.id ? b : x) });
  const nuevoId = () => Math.random().toString(16).slice(2, 12);
  const añade = (b) => setCapitulo({ ...c, bloques: [...c.bloques, { id: nuevoId(), ...b }] });
  const mueve = (i, d) => { const l = [...c.bloques], j = i + d; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; setCapitulo({ ...c, bloques: l }); };
  const accion = async (nombre, fn) => { setOcupado(nombre); try { await fn(); } catch (e) { flash(err(e, 'Algo falló')); } setOcupado(''); };
  const subeImagen = (file) => accion('img', async () => { const fd = new FormData(); fd.append('file', file); const r = await api.post('/manuales/' + id + '/imagen', fd, { headers: { 'Content-Type': 'multipart/form-data' } }); añade({ tipo: 'imagen', url: r.data.url, pie: '' }); });
  const pdf = (soloCap) => accion('pdf', async () => { await api.put('/manuales/' + id, m); const r = await api.post('/manuales/' + id + '/pdf', { capitulos: soloCap ? [c.id] : [] }, { responseType: 'blob', timeout: 120000 }); const a = document.createElement('a'); a.href = URL.createObjectURL(r.data); a.download = (soloCap ? c.titulo : m.titulo) + '.pdf'; a.click(); });
  const verHist = () => accion('hist', async () => { const r = await api.get('/manuales/' + id + '/versiones'); setHist(r.data.versiones); });
  const restaura = (v) => { if (!window.confirm('¿Volver a la versión del ' + new Date(v.fecha).toLocaleString('es-ES') + '? Lo actual se guarda antes en el historial.')) return; accion('rest', async () => { const r = await api.post('/manuales/' + id + '/versiones/' + v.id + '/restaurar'); setM(r.data.manual); setHist(null); setCap(0); flash('Versión restaurada'); }); };

  return (
    <div style={{ padding: '22px 28px 70px', maxWidth: 1250, margin: '0 auto', color: '#fff' }}>
      <button style={btn({ marginBottom: 10 })} onClick={volver}><ArrowLeft size={14} /> Manuales</button>
      {aviso && <div style={{ ...card, marginBottom: 10, borderColor: '#b79a6b' }}>{aviso}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
        <input style={{ ...inp, maxWidth: 380, fontSize: '1.05rem', fontWeight: 700 }} value={m.titulo} onChange={e => cambia({ ...m, titulo: e.target.value })} />
        <input style={{ ...inp, maxWidth: 320 }} placeholder="Subtítulo (opcional)" value={m.subtitulo || ''} onChange={e => cambia({ ...m, subtitulo: e.target.value })} />
        <span style={{ flex: 1 }} />
        <button style={btn()} onClick={verHist} disabled={!!ocupado}><History size={14} /> Historial</button>
        <button style={btn()} onClick={() => pdf(true)} disabled={!!ocupado}><FileDown size={14} /> PDF del capítulo</button>
        <button style={btn({ background: '#b79a6b', color: '#1e1b18', fontWeight: 700 })} onClick={() => pdf(false)} disabled={!!ocupado}>{ocupado === 'pdf' ? <Loader2 size={14} /> : <FileDown size={14} />} PDF del manual</button>
      </div>
      {hist && (
        <div style={{ ...card, marginBottom: 12 }}>
          <b>Versiones guardadas</b> <button style={btn({ float: 'right', padding: '2px 8px' })} onClick={() => setHist(null)}>Cerrar</button>
          {!hist.length ? <div style={mut}>Todavía no hay versiones: se guardan solas al ir editando.</div> : hist.map(v => <div key={v.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' }}><span style={mut}>{new Date(v.fecha).toLocaleString('es-ES')}</span><button style={btn({ padding: '2px 8px' })} onClick={() => restaura(v)}>Volver a esta</button></div>)}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '230px 1fr', gap: 16, alignItems: 'start' }}>
        <div style={{ ...card, display: 'grid', gap: 6 }}>
          <b style={{ fontSize: '.85rem' }}>Capítulos</b>
          {m.capitulos.map((x, i) => (
            <div key={x.id} onClick={() => setCap(i)} style={{ padding: '6px 8px', borderRadius: 8, cursor: 'pointer', background: i === cap ? 'rgba(183,154,107,.22)' : 'transparent', fontSize: '.82rem' }}>{i + 1}. {x.titulo}</div>
          ))}
          <button style={btn()} onClick={() => { cambia({ ...m, capitulos: [...m.capitulos, { id: nuevoId(), titulo: 'Capítulo nuevo', bloques: [] }] }); setCap(m.capitulos.length); }}><Plus size={13} /> Capítulo</button>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input style={{ ...inp, fontSize: '1rem', fontWeight: 700 }} value={c.titulo} onChange={e => setCapitulo({ ...c, titulo: e.target.value })} />
            <button style={btn()} title="Subir capítulo" onClick={() => { if (cap > 0) { const l = [...m.capitulos]; [l[cap - 1], l[cap]] = [l[cap], l[cap - 1]]; cambia({ ...m, capitulos: l }); setCap(cap - 1); } }}><ArrowUp size={13} /></button>
            <button style={btn()} title="Bajar capítulo" onClick={() => { if (cap < m.capitulos.length - 1) { const l = [...m.capitulos]; [l[cap + 1], l[cap]] = [l[cap], l[cap + 1]]; cambia({ ...m, capitulos: l }); setCap(cap + 1); } }}><ArrowDown size={13} /></button>
            <button style={btn()} title="Borrar capítulo" onClick={() => { if (m.capitulos.length > 1 && window.confirm('¿Borrar el capítulo «' + c.titulo + '» y todo lo que contiene?')) { cambia({ ...m, capitulos: m.capitulos.filter(x => x.id !== c.id) }); setCap(0); } }}><Trash2 size={13} /></button>
          </div>
          {c.bloques.map((b, i) => (
            <div key={b.id} style={card}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                <span style={{ ...mut, flex: 1 }}>{b.tipo === 'texto' ? 'Texto' : b.tipo === 'imagen' ? 'Imagen' : 'Esquema de distribución'}</span>
                <button style={btn({ padding: '2px 7px' })} onClick={() => mueve(i, -1)}><ArrowUp size={12} /></button><button style={btn({ padding: '2px 7px' })} onClick={() => mueve(i, 1)}><ArrowDown size={12} /></button>
                <button style={btn({ padding: '2px 7px' })} onClick={() => { if (window.confirm('¿Quitar este bloque?')) setCapitulo({ ...c, bloques: c.bloques.filter(x => x.id !== b.id) }); }}><Trash2 size={12} /></button>
              </div>
              {b.tipo === 'texto' && <><textarea style={{ ...inp, minHeight: 130, lineHeight: 1.5, fontFamily: 'inherit' }} value={b.texto} onChange={e => setBloque({ ...b, texto: e.target.value })} placeholder="Escribe aquí. Una línea que empiece por «# » es un título, «## » un subtítulo y «- » una viñeta." /></>}
              {b.tipo === 'imagen' && <><img src={b.url} alt="" style={{ maxWidth: '100%', maxHeight: 340, borderRadius: 8, background: '#fff' }} /><input style={{ ...inp, marginTop: 6 }} placeholder="Pie de foto" value={b.pie} onChange={e => setBloque({ ...b, pie: e.target.value })} /></>}
              {b.tipo === 'esquema' && <><Esquema spec={b.spec} onChange={(spec) => setBloque({ ...b, spec })} /><input style={{ ...inp, marginTop: 6 }} placeholder="Pie del esquema (opcional)" value={b.pie} onChange={e => setBloque({ ...b, pie: e.target.value })} /></>}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files[0]; e.target.value = ''; if (f) subeImagen(f); }} />
            <button style={btn()} onClick={() => añade({ tipo: 'texto', texto: '' })}><Type size={14} /> Añadir texto</button>
            <button style={btn()} onClick={() => fileRef.current.click()} disabled={!!ocupado}>{ocupado === 'img' ? <Loader2 size={14} /> : <Img size={14} />} Añadir imagen</button>
            <button style={btn()} onClick={() => añade({ tipo: 'esquema', spec: ESPEC0, pie: '' })}><LayoutGrid size={14} /> Añadir esquema de distribución</button>
          </div>
          <div style={mut}>Se guarda solo. Última edición: {m.actualizado ? new Date(m.actualizado).toLocaleString('es-ES') : '—'}{m.editor ? ' · ' + m.editor : ''}</div>
        </div>
      </div>
    </div>
  );
}

export default function SectionManuales() {
  const [lista, setLista] = useState(null), [abierto, setAbierto] = useState(null), [nombre, setNombre] = useState('');
  const cargar = () => api.get('/manuales').then(r => setLista(r.data.manuales)).catch(() => setLista([]));
  useEffect(() => { cargar(); }, []);
  const crear = async () => { try { const r = await api.post('/manuales', { titulo: nombre || 'Manual nuevo' }); setNombre(''); setAbierto(r.data.manual.id); } catch { alert('No se pudo crear'); } };
  const borrar = async (x) => { if (!window.confirm('¿Borrar el manual «' + x.titulo + '»? No se puede deshacer.')) return; await api.delete('/manuales/' + x.id).catch(() => {}); cargar(); };
  if (abierto) return <Editor id={abierto} volver={() => { setAbierto(null); cargar(); }} />;
  return (
    <div style={{ padding: '28px 40px 70px', maxWidth: 1000, margin: '0 auto', color: '#fff' }}>
      <h2 style={{ margin: 0, display: 'flex', gap: 10, alignItems: 'center' }}><BookOpen size={24} /> Manuales</h2>
      <p style={mut}>Documentos internos del equipo (por ejemplo, el manual de diseño de home gyms): capítulos con texto, imágenes y esquemas de distribución exactos. Se guardan solos, con historial, y se exportan a PDF con la marca.</p>
      <div style={{ display: 'flex', gap: 8, margin: '14px 0 20px' }}>
        <input style={{ ...inp, maxWidth: 320 }} placeholder="Título del manual" value={nombre} onChange={e => setNombre(e.target.value)} onKeyDown={e => e.key === 'Enter' && crear()} />
        <button style={btn({ background: '#b79a6b', color: '#1e1b18', fontWeight: 700 })} onClick={crear}><Plus size={14} /> Nuevo manual</button>
      </div>
      {lista === null ? <div className="ap-loading">Cargando…</div> : !lista.length ? <div style={mut}>Todavía no hay manuales.</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 12 }}>
          {lista.map(x => (
            <div key={x.id} style={{ ...card, cursor: 'pointer' }} onClick={() => setAbierto(x.id)}>
              <b>{x.titulo}</b><div style={mut}>{x.capitulos} capítulos · {x.bloques} bloques</div><div style={mut}>Editado {x.actualizado ? new Date(x.actualizado).toLocaleDateString('es-ES') : ''}</div>
              <button style={btn({ marginTop: 8 })} onClick={e => { e.stopPropagation(); borrar(x); }}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
