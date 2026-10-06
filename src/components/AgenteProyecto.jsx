import { useState, useEffect, useRef } from 'react';
import { Sparkles, Send, Trash2 } from 'lucide-react';
import api from '../services/api';
import { MicButton } from './MicButton';

// Asistente de diseño del proyecto: conoce su moodboard (imágenes y paleta),
// sus necesidades, medidas e historia, y los condicionantes que se anoten
// aquí (techo bajo, pilares, poca luz...). Solo aconseja; no cambia nada.

const box = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '0.9rem 1rem' };
const muted = { fontSize: '0.72rem', color: 'rgba(255,255,255,0.45)' };

const SUGERENCIAS = [
  'Analiza el moodboard y la paleta teniendo en cuenta los condicionantes y dime los inconvenientes',
  'Qué colores y acabados funcionan mejor con mi condicionante?',
  'Qué equipamiento me limita y cuál puedo usar?',
  'Cómo coloco la iluminación para este espacio?',
  'Qué me falta por definir en este proyecto?',
];

// **negrita** y listas sencillas, sin librerías
function Texto({ t }) {
  return (
    <div style={{ fontSize: '0.86rem', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
      {t.split(/(\*\*[^*]+\*\*)/g).map((trozo, i) => (/^\*\*[^*]+\*\*$/.test(trozo) ? <strong key={i}>{trozo.slice(2, -2)}</strong> : <span key={i}>{trozo}</span>))}
    </div>
  );
}

export function AgenteProyecto({ project }) {
  const projectId = project.id;
  const [cond, setCond] = useState('');
  const [condGuardada, setCondGuardada] = useState('');
  const [mensajes, setMensajes] = useState([]);
  const [input, setInput] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [cargado, setCargado] = useState(false);
  const finRef = useRef(null);

  useEffect(() => {
    api.get(`/agente-proyecto/${projectId}`).then(r => {
      setCond(r.data.condicionantes || ''); setCondGuardada(r.data.condicionantes || '');
      setMensajes(r.data.mensajes || []); setCargado(true);
    }).catch(e => setError(e.response?.data?.error || 'No se pudo cargar el asistente'));
  }, [projectId]);

  useEffect(() => { finRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [mensajes, enviando]);

  const guardarCond = async () => {
    if (cond.trim() === condGuardada.trim()) return;
    try { await api.put(`/agente-proyecto/${projectId}/condicionantes`, { condicionantes: cond }); setCondGuardada(cond); }
    catch { setError('No se pudieron guardar los condicionantes'); }
  };

  const enviar = async (texto) => {
    const mensaje = (texto ?? input).trim();
    if (!mensaje || enviando) return;
    setError(''); setInput(''); setEnviando(true);
    await guardarCond();
    setMensajes(m => [...m, { id: `tmp-${Date.now()}`, role: 'user', content: mensaje }]);
    try {
      const { data } = await api.post(`/agente-proyecto/${projectId}/chat`, { mensaje });
      setMensajes(m => [...m, { id: `r-${Date.now()}`, role: 'assistant', content: data.respuesta }]);
    } catch (e) {
      setError(e.response?.data?.error || 'El asistente no ha podido responder');
    } finally { setEnviando(false); }
  };

  const borrar = async () => {
    if (!window.confirm('¿Borrar toda la conversación con el asistente de este proyecto?')) return;
    try { await api.delete(`/agente-proyecto/${projectId}/mensajes`); setMensajes([]); } catch { setError('No se pudo borrar la conversación'); }
  };

  if (!cargado) return <p style={muted}>{error || 'Cargando…'}</p>;

  return (
    <div>
      <div style={{ ...box, marginBottom: 12, borderColor: 'rgba(190,176,162,0.35)' }}>
        <strong style={{ fontSize: '0.9rem' }}>Condicionantes del proyecto</strong>
        <p style={{ ...muted, margin: '4px 0 8px' }}>Lo que limita este proyecto y el asistente debe tener siempre presente: techo bajo (¿cuántos metros?), pilares, poca luz natural, suelo irregular, ruido a vecinos, presupuesto ajustado…</p>
        <textarea value={cond} onChange={e => setCond(e.target.value)} onBlur={guardarCond} rows={3} placeholder="Ej. Techo bajo: 2,30 m libres. Pilar central de 40 cm. Sin luz natural." style={{ width: '100%' }} />
        <p style={{ ...muted, marginTop: 4 }}>{cond.trim() === condGuardada.trim() ? 'Guardado' : 'Se guarda al salir del campo'}</p>
      </div>

      <div style={{ ...box, minHeight: 260 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <strong style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 6 }}><Sparkles size={14} /> Asistente de diseño</strong>
          {mensajes.length > 0 && <button type="button" className="ap-btn ap-btn-ghost ap-btn-xs" onClick={borrar}><Trash2 size={11} /> Borrar conversación</button>}
        </div>

        {mensajes.length === 0 && !enviando && (
          <div>
            <p style={{ ...muted, marginBottom: 8 }}>Conoce el moodboard (mira las imágenes y la paleta), las necesidades, las medidas, el estilo y la historia de este proyecto. Pregúntale o empieza por aquí:</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {SUGERENCIAS.map(s => (
                <button key={s} type="button" className="ap-btn ap-btn-ghost ap-btn-sm" style={{ textAlign: 'left', justifyContent: 'flex-start' }} onClick={() => enviar(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {mensajes.map(m => (
            <div key={m.id} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '92%', background: m.role === 'user' ? 'rgba(190,176,162,0.16)' : 'rgba(255,255,255,0.04)', borderRadius: 10, padding: '8px 12px' }}>
              <Texto t={m.content} />
            </div>
          ))}
          {enviando && <div style={{ ...muted, padding: '4px 2px' }}>Analizando el proyecto…</div>}
          <div ref={finRef} />
        </div>
        {error && <p className="ap-error" style={{ marginTop: 8 }}>{error}</p>}
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center' }}>
        <MicButton disabled={enviando} onResult={t => setInput(prev => (prev ? prev + ' ' : '') + t)} />
        <input className="ap-field-input" style={{ flex: 1 }} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && enviar()} placeholder="Pregunta algo sobre este proyecto…" disabled={enviando} />
        <button type="button" className="ap-btn ap-btn-primary" onClick={() => enviar()} disabled={enviando || !input.trim()}><Send size={14} /></button>
      </div>
    </div>
  );
}
