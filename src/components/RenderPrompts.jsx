import { useState, useEffect, useRef } from 'react';
import { Sparkles, Copy, Check, Trash2, Upload, Wand2 } from 'lucide-react';
import api from '../services/api';
import { MicButton } from './MicButton';

// Prompts de render con IA: Claude actúa de director de arte. Conoce el moodboard
// del proyecto (imágenes, paleta y estilo), los materiales y equipos elegidos,
// las medidas y los condicionantes; tú le dices qué quieres ver y entrega el
// prompt listo para pegar en la herramienta que uses (o para mejorar una imagen).

const box = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '0.9rem 1rem' };
const muted = { fontSize: '0.72rem', color: 'rgba(255,255,255,0.45)' };
const lab = { fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.45)', margin: '10px 0 4px', display: 'block' };

const HERRAMIENTAS = [
  ['midjourney', 'Midjourney'],
  ['chatgpt', 'ChatGPT (imágenes)'],
  ['gemini', 'Gemini / Nano Banana'],
  ['flux', 'Flux / Krea / Freepik'],
  ['universal', 'Cualquiera (universal)'],
];
const FORMATOS = ['16:9', '3:2', '4:3', '1:1', '9:16'];
const ZONAS = ['Zona de peso libre', 'Recepción', 'Zona cardio', 'Sala funcional', 'Vestuarios', 'Fachada / entrada', 'Home gym completo', 'Zona de recuperación'];

function Copiar({ texto, etiqueta = 'Copiar' }) {
  const [ok, setOk] = useState(false);
  const copiar = async () => {
    try { await navigator.clipboard.writeText(texto); } catch {
      const t = document.createElement('textarea'); t.value = texto; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch { /* sin portapapeles */ } t.remove();
    }
    setOk(true); setTimeout(() => setOk(false), 1600);
  };
  return <button type="button" className="ap-btn ap-btn-ghost ap-btn-xs" onClick={copiar}>{ok ? <Check size={11} /> : <Copy size={11} />} {ok ? 'Copiado' : etiqueta}</button>;
}

function Bloque({ titulo, texto, mono }) {
  if (!texto) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ ...lab, margin: 0 }}>{titulo}</span>
        <Copiar texto={texto} />
      </div>
      <div style={{ marginTop: 4, padding: '8px 10px', background: 'rgba(0,0,0,0.25)', borderRadius: 8, fontSize: '0.84rem', lineHeight: 1.5, whiteSpace: 'pre-wrap', fontFamily: mono ? 'ui-monospace, Menlo, Consolas, monospace' : undefined }}>{texto}</div>
    </div>
  );
}

function Resultado({ r, onAjustar, ajustando }) {
  const [ajuste, setAjuste] = useState('');
  return (
    <div style={{ ...box, borderColor: 'rgba(186,175,165,0.35)' }}>
      <strong style={{ fontSize: '0.95rem' }}>{r.titulo}</strong>
      <Bloque titulo="Prompt (para pegar)" texto={r.prompt} mono />
      <Bloque titulo="En español (para que lo entiendas y lo retoques)" texto={r.prompt_es} />
      <Bloque titulo="Negativo / evitar" texto={r.negativo} />
      <Bloque titulo="Ajustes recomendados" texto={r.parametros} />
      {r.consejos?.length > 0 && (
        <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: '0.8rem', color: 'rgba(255,255,255,0.7)' }}>
          {r.consejos.map((c, i) => <li key={i}>{c}</li>)}
        </ul>
      )}
      {r.variantes?.map((v, i) => <Bloque key={i} titulo={`Variante · ${v.nombre}`} texto={v.prompt} mono />)}
      {onAjustar && (
        <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
          <input className="ap-field-input" style={{ flex: 1 }} value={ajuste} onChange={e => setAjuste(e.target.value)} onKeyDown={e => e.key === 'Enter' && ajuste.trim() && !ajustando && (onAjustar(ajuste), setAjuste(''))} placeholder="Ajustar: «más luz natural», «suelo más oscuro», «cámara más baja»…" disabled={ajustando} />
          <button type="button" className="ap-btn ap-btn-primary" disabled={ajustando || !ajuste.trim()} onClick={() => { onAjustar(ajuste); setAjuste(''); }}><Wand2 size={14} /> Ajustar</button>
        </div>
      )}
    </div>
  );
}

// Reduce la imagen subida (SketchUp, render previo...) para no enviar megas
function leerImagen(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1400 / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('No se pudo leer la imagen'));
      img.src = fr.result;
    };
    fr.onerror = () => reject(new Error('No se pudo leer la imagen'));
    fr.readAsDataURL(file);
  });
}

export function RenderPrompts({ project }) {
  const projectId = project.id;
  const [base, setBase] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [sinTabla, setSinTabla] = useState(false);
  const [zona, setZona] = useState('');
  const [detalles, setDetalles] = useState('');
  const [herramienta, setHerramienta] = useState('midjourney');
  const [formato, setFormato] = useState('16:9');
  const [modo, setModo] = useState('crear');
  const [variantes, setVariantes] = useState(0);
  const [imagen, setImagen] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    try { const h = localStorage.getItem('ranuse-render-herramienta'); if (h && HERRAMIENTAS.some(x => x[0] === h)) setHerramienta(h); } catch { /* sin almacenamiento */ }
    api.get(`/agente-proyecto/${projectId}/render-prompts`).then(r => {
      setBase(r.data.base); setHistorial(r.data.historial || []); setSinTabla(!!r.data.sinTabla);
    }).catch(e => setError(e.response?.data?.error || 'No se pudo cargar'));
  }, [projectId]);

  const generar = async (ajuste) => {
    if (generando) return;
    if (!zona.trim() && !detalles.trim()) { setError('Cuéntame qué zona quieres y qué detalles'); return; }
    if (modo === 'mejorar' && !imagen) { setError('Sube la imagen que quieres mejorar'); return; }
    setError(''); setGenerando(true);
    try { localStorage.setItem('ranuse-render-herramienta', herramienta); } catch { /* sin almacenamiento */ }
    try {
      const { data } = await api.post(`/agente-proyecto/${projectId}/render-prompt`, {
        zona, detalles, herramienta, formato, modo, variantes,
        imagen_base: modo === 'mejorar' ? imagen : undefined,
        ...(ajuste && resultado ? { ajuste, anterior: resultado } : {}),
      });
      setResultado(data.resultado);
      if (data.sinTabla) setSinTabla(true);
      else setHistorial(h => [{ id: data.id, zona, detalles, herramienta, modo, resultado: data.resultado, created_at: data.created_at }, ...h]);
    } catch (e) {
      setError(e.response?.data?.error || 'No se ha podido generar el prompt');
    } finally { setGenerando(false); }
  };

  const borrar = async (id) => {
    try { await api.delete(`/agente-proyecto/${projectId}/render-prompts/${id}`); setHistorial(h => h.filter(x => x.id !== id)); } catch { setError('No se pudo borrar'); }
  };

  const subir = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try { setImagen(await leerImagen(f)); setError(''); } catch (er) { setError(er.message); }
    e.target.value = '';
  };

  return (
    <div>
      <div style={{ ...box, marginBottom: 12 }}>
        <strong style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 6 }}><Sparkles size={14} /> Prompts de render con IA</strong>
        <p style={{ ...muted, margin: '4px 0 8px' }}>
          La IA parte del estilo de este proyecto: {base ? <>
            <b>{base.imagenes}</b> {base.imagenes === 1 ? 'imagen' : 'imágenes'} del moodboard
            {base.estilo ? <>, estilo «{base.estilo}»</> : <>, sin estilo definido todavía</>}
            {base.paleta?.length > 0 ? ', paleta ' : ''}</> : 'cargando…'}
          {base?.paleta?.slice(0, 8).map(c => <span key={c} title={c} style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: c, margin: '0 2px -2px', border: '1px solid rgba(255,255,255,0.25)' }} />)}
          {' '}además de los materiales, equipos, medidas y condicionantes. {base && base.imagenes === 0 && <b>Sube imágenes al Moodboard para que aprenda el estilo.</b>}
        </p>
        {sinTabla && <p className="ap-error">Para guardar el historial falta ejecutar el SQL v76 en Supabase. Los prompts se generan igualmente.</p>}

        <span style={lab}>¿Qué hacemos?</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className={`ap-btn ap-btn-sm ${modo === 'crear' ? 'ap-btn-primary' : 'ap-btn-ghost'}`} onClick={() => setModo('crear')}>Crear un render nuevo</button>
          <button type="button" className={`ap-btn ap-btn-sm ${modo === 'mejorar' ? 'ap-btn-primary' : 'ap-btn-ghost'}`} onClick={() => setModo('mejorar')}>Mejorar una imagen (SketchUp o render previo)</button>
        </div>

        {modo === 'mejorar' && (
          <div style={{ marginTop: 8 }}>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={subir} style={{ display: 'none' }} />
            {imagen ? (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <img src={imagen} alt="Imagen base" style={{ height: 80, borderRadius: 6 }} />
                <button type="button" className="ap-btn ap-btn-ghost ap-btn-xs" onClick={() => setImagen(null)}>Quitar</button>
              </div>
            ) : (
              <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => fileRef.current?.click()}><Upload size={13} /> Subir la imagen a mejorar</button>
            )}
            <p style={{ ...muted, marginTop: 4 }}>La IA la mira y escribe un prompt que conserva la distribución y la perspectiva y solo cambia lo que pidas. Después pegas el prompt y esta misma imagen en la herramienta que uses.</p>
          </div>
        )}

        <span style={lab}>Zona o espacio</span>
        <input className="ap-field-input" style={{ width: '100%' }} value={zona} onChange={e => setZona(e.target.value)} placeholder="Ej. Zona de peso libre" />
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
          {ZONAS.map(z => <button key={z} type="button" className="ap-btn ap-btn-ghost ap-btn-xs" onClick={() => setZona(z)}>{z}</button>)}
        </div>

        <span style={lab}>Lo que quieres ver (detalles)</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <textarea value={detalles} onChange={e => setDetalles(e.target.value)} rows={4} style={{ flex: 1 }} placeholder="Ej. Pared de fondo en microcemento cálido, espejo grande, racks negros con detalles en madera, luz cálida indirecta en el techo, suelo de caucho oscuro…" />
          <MicButton disabled={generando} onResult={t => setDetalles(prev => (prev ? prev + ' ' : '') + t)} />
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
          <label style={{ flex: '1 1 180px' }}><span style={lab}>Para qué herramienta</span>
            <select className="ap-field-input" style={{ width: '100%' }} value={herramienta} onChange={e => setHerramienta(e.target.value)}>{HERRAMIENTAS.map(h => <option key={h[0]} value={h[0]}>{h[1]}</option>)}</select>
          </label>
          <label style={{ flex: '0 1 110px' }}><span style={lab}>Formato</span>
            <select className="ap-field-input" style={{ width: '100%' }} value={formato} onChange={e => setFormato(e.target.value)}>{FORMATOS.map(f => <option key={f} value={f}>{f}</option>)}</select>
          </label>
          <label style={{ flex: '0 1 140px' }}><span style={lab}>Variantes</span>
            <select className="ap-field-input" style={{ width: '100%' }} value={variantes} onChange={e => setVariantes(+e.target.value)}>{[0, 1, 2, 3].map(n => <option key={n} value={n}>{n === 0 ? 'Solo el principal' : `+ ${n} variante${n > 1 ? 's' : ''}`}</option>)}</select>
          </label>
        </div>

        <button type="button" className="ap-btn ap-btn-primary" style={{ marginTop: 12 }} onClick={() => generar()} disabled={generando}>
          <Sparkles size={14} /> {generando ? 'Pensando el prompt…' : 'Generar prompt'}
        </button>
        {error && <p className="ap-error" style={{ marginTop: 8 }}>{error}</p>}
      </div>

      {resultado && <Resultado r={resultado} onAjustar={generar} ajustando={generando} />}

      {historial.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <span style={lab}>Prompts guardados de este proyecto</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {historial.map(h => (
              <div key={h.id} style={{ ...box, padding: '8px 12px', display: 'flex', gap: 8, alignItems: 'center' }}>
                <button type="button" style={{ flex: 1, textAlign: 'left', background: 'none', border: 0, color: 'inherit', cursor: 'pointer' }} onClick={() => setResultado(h.resultado)}>
                  <div style={{ fontSize: '0.84rem', fontWeight: 600 }}>{h.resultado?.titulo || h.zona || 'Render'}</div>
                  <div style={muted}>{HERRAMIENTAS.find(x => x[0] === h.herramienta)?.[1] || h.herramienta} · {h.modo === 'mejorar' ? 'mejora' : 'nuevo'} · {new Date(h.created_at).toLocaleDateString('es-ES')}</div>
                </button>
                <Copiar texto={h.resultado?.prompt || ''} />
                <button type="button" className="ap-btn-icon" title="Borrar" onClick={() => borrar(h.id)}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
