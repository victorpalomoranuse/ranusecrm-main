import { useState, useRef, useEffect } from 'react';
import { X, Sparkles, Trash2, MapPin } from 'lucide-react';
import api from '../services/api';
import RenderRecorrido, { MOVIMIENTOS } from './RenderRecorrido';

// Convierte un render normal en un render con recorrido: se genera el mapa de profundidad en el propio
// navegador (no usa el servidor), se elige hacia dónde se mueve la cámara y se colocan puntos tocables.

const TRANSFORMERS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';
let promesaModelo = null;
function cargarModelo(avisar) {
  if (!promesaModelo) {
    promesaModelo = import(/* @vite-ignore */ TRANSFORMERS).then(T => T.pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', {
      dtype: 'q8', device: 'wasm',
      progress_callback: (p) => { if (p.status === 'progress' && p.file?.endsWith('.onnx')) avisar?.(`Descargando la IA de profundidad… ${Math.round(p.progress)} %`); },
    })).catch(e => { promesaModelo = null; throw e; });
  }
  return promesaModelo;
}

// Devuelve un Blob JPEG con el mapa de profundidad (más claro = más cerca)
async function generarProfundidad(urlImagen, avisar) {
  avisar('Preparando la IA de profundidad…');
  const est = await cargarModelo(avisar);
  avisar('Calculando la profundidad del render… (10-30 segundos)');
  const out = await est(urlImagen);
  const d = out.depth, c = document.createElement('canvas');
  c.width = d.width; c.height = d.height;
  const x = c.getContext('2d'), im = x.createImageData(d.width, d.height);
  for (let i = 0; i < d.data.length; i++) { im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = d.data[i]; im.data[i * 4 + 3] = 255; }
  x.putImageData(im, 0, 0);
  // se reduce y se suaviza: así los bordes de los objetos se estiran menos al moverse la cámara
  const k = Math.min(1, 1100 / d.width), f = document.createElement('canvas');
  f.width = Math.round(d.width * k); f.height = Math.round(d.height * k);
  const fx = f.getContext('2d'); fx.filter = 'blur(3px)'; fx.drawImage(c, 0, 0, f.width, f.height);
  return new Promise((ok, ko) => f.toBlob(b => (b ? ok(b) : ko(new Error('No se pudo crear la imagen de profundidad'))), 'image/jpeg', 0.85));
}

const caja = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '0.9rem 1rem' };
const muted = { fontSize: '0.74rem', color: 'rgba(255,255,255,0.5)' };
const fila = { display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' };

export default function RenderInteractivoEditor({ projectId, url, existente, onGuardado, onCerrar }) {
  const [prof, setProf] = useState(existente?.profundidad_url || '');
  const [mov, setMov] = useState(existente?.movimiento || 'adelante');
  const [puntos, setPuntos] = useState(existente?.puntos || []);
  const [progreso, setProgreso] = useState(0.5);
  const [colocar, setColocar] = useState(false);
  const [estado, setEstado] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const animando = useRef(0);

  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onCerrar(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onCerrar]);
  useEffect(() => () => cancelAnimationFrame(animando.current), []);

  const crear = async () => {
    setError('');
    try {
      const blob = await generarProfundidad(url, setEstado);
      setEstado('Subiendo el mapa de profundidad…');
      const form = new FormData(); form.append('file', new File([blob], 'profundidad.jpg', { type: 'image/jpeg' }));
      const { data } = await api.post(`/historia/${projectId}/subir`, form);
      setProf(data.url);
    } catch (e) {
      setError(e.response?.data?.error || (e.message?.includes('fetch') || e.name === 'TypeError'
        ? 'No se pudo leer el render desde el navegador. Prueba de nuevo o con otro render.'
        : `No se pudo crear la profundidad: ${e.message || 'error desconocido'}`));
    } finally { setEstado(''); }
  };

  // vista previa animada: recorre el movimiento de principio a fin
  const reproducir = () => {
    cancelAnimationFrame(animando.current); setColocar(false);
    const t0 = performance.now(), dur = 3200;
    const paso = (t) => {
      const q = Math.min(1, (t - t0) / dur); setProgreso(q);
      if (q < 1) animando.current = requestAnimationFrame(paso);
    };
    animando.current = requestAnimationFrame(paso);
  };

  const guardar = async () => {
    setGuardando(true); setError('');
    try {
      const { data } = await api.put(`/historia/${projectId}/interactivos`, { imagen_url: url, profundidad_url: prof, movimiento: mov, puntos });
      onGuardado(data.interactivo);
    } catch (e) { setError(e.response?.data?.error || 'No se pudo guardar'); }
    finally { setGuardando(false); }
  };
  const quitar = async () => {
    if (!window.confirm('¿Quitar el recorrido de este render? Volverá a verse como imagen normal.')) return;
    try { await api.delete(`/historia/${projectId}/interactivos`, { params: { imagen_url: url } }); onGuardado(null); }
    catch (e) { setError(e.response?.data?.error || 'No se pudo quitar'); }
  };
  const cambiarPunto = (i, campos) => setPuntos(p => p.map((q, k) => (k === i ? { ...q, ...campos } : q)));

  return (
    <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.8)', overflow: 'auto', padding: '2vh 2vw' }} onClick={onCerrar}>
      <div onClick={e => e.stopPropagation()} style={{ ...caja, background: '#16161a', maxWidth: 880, margin: '0 auto' }}>
        <div style={{ ...fila, justifyContent: 'space-between', marginBottom: 8 }}>
          <strong>Render con recorrido</strong>
          <button type="button" className="ap-btn-icon" aria-label="Cerrar" onClick={onCerrar}><X size={16} /></button>
        </div>
        <p style={{ ...muted, marginBottom: 10 }}>El cliente verá este render moverse al deslizar, como si la cámara caminara por el espacio: lo cercano se mueve más que lo lejano. Si no lo activas, el render se ve como siempre.</p>

        {!prof ? (
          <div style={{ ...caja, textAlign: 'center' }}>
            <img src={url} alt="" style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 8, marginBottom: 10 }} />
            <p style={{ ...muted, marginBottom: 10 }}>Primero la IA calcula qué hay cerca y qué hay lejos en la imagen. Se hace aquí, en tu navegador (la primera vez descarga unos 30 MB y tarda un poco más).</p>
            <button type="button" className="ap-btn ap-btn-primary" disabled={!!estado} onClick={crear}><Sparkles size={13} /> {estado || 'Crear el recorrido de este render'}</button>
          </div>
        ) : (
          <>
            <RenderRecorrido src={url} prof={prof} mov={mov} puntos={puntos} modo="editor" progreso={progreso} colocar={colocar}
              onColocar={(p) => { setPuntos(l => (l.length >= 12 ? l : [...l, { ...p, titulo: '', texto: '' }])); setColocar(false); }} altura={Math.min(460, Math.round(window.innerHeight * 0.5))} />
            <div style={{ ...fila, margin: '10px 0' }}>
              <input type="range" min="0" max="1" step="0.005" value={progreso} onChange={e => { cancelAnimationFrame(animando.current); setProgreso(+e.target.value); }} style={{ flex: 1, minWidth: 160 }} aria-label="Avance del recorrido" />
              <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={reproducir}>▶ Ver el recorrido</button>
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ ...muted, marginBottom: 4 }}>Hacia dónde se mueve la cámara</div>
              <div style={fila}>
                {MOVIMIENTOS.map(m => (
                  <button key={m.id} type="button" className={`ap-btn ap-btn-sm ${mov === m.id ? 'ap-btn-primary' : 'ap-btn-ghost'}`} onClick={() => { setMov(m.id); setProgreso(0); }}>{m.icono} {m.label}</button>
                ))}
              </div>
              <p style={{ ...muted, marginTop: 4 }}>«Avanzar» y «Retroceder» funcionan mejor en vistas con fondo (pasillos, salas profundas); los laterales, con equipos en primer plano.</p>
            </div>
            <div style={{ ...caja, marginBottom: 10 }}>
              <div style={{ ...fila, justifyContent: 'space-between', marginBottom: 6 }}>
                <strong style={{ fontSize: '0.85rem' }}>Puntos tocables (opcional)</strong>
                <button type="button" className={`ap-btn ap-btn-xs ${colocar ? 'ap-btn-primary' : 'ap-btn-ghost'}`} disabled={puntos.length >= 12} onClick={() => setColocar(c => !c)}><MapPin size={11} /> {colocar ? 'Toca la imagen…' : 'Colocar un punto'}</button>
              </div>
              <p style={{ ...muted, marginBottom: 6 }}>Pulsa «Colocar un punto» y toca el objeto en la imagen. El cliente lo verá como un círculo que abre una ficha con el título y el texto que escribas.</p>
              {puntos.map((p, i) => (
                <div key={i} style={{ ...fila, marginBottom: 6, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                  <span style={{ ...muted, width: 16, paddingTop: 8 }}>{i + 1}</span>
                  <div style={{ flex: 1, display: 'grid', gap: 4 }}>
                    <input className="ap-field-input" placeholder="Título (por ejemplo, Rótulo de neón)" value={p.titulo} maxLength={80} onChange={e => cambiarPunto(i, { titulo: e.target.value })} />
                    <input className="ap-field-input" placeholder="Texto corto (opcional)" value={p.texto} maxLength={300} onChange={e => cambiarPunto(i, { texto: e.target.value })} />
                  </div>
                  <button type="button" className="ap-btn-icon" aria-label="Quitar punto" onClick={() => setPuntos(l => l.filter((_, k) => k !== i))}><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
            <div style={{ ...fila, justifyContent: 'space-between' }}>
              <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={crear} disabled={!!estado}>{estado || 'Recalcular la profundidad'}</button>
              <div style={fila}>
                {existente && <button type="button" className="ap-btn ap-btn-danger ap-btn-sm" onClick={quitar}>Quitar recorrido</button>}
                <button type="button" className="ap-btn ap-btn-primary" disabled={guardando} onClick={guardar}>{guardando ? 'Guardando…' : 'Guardar'}</button>
              </div>
            </div>
          </>
        )}
        {error && <p className="ap-error" style={{ marginTop: 8 }}>{error}</p>}
      </div>
    </div>
  );
}
