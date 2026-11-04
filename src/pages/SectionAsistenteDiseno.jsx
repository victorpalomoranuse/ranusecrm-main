import { useState, useRef, useEffect, useMemo } from 'react';
import api from '../services/api';
import { Send as SendIcon, Ruler, Printer, Download, RotateCcw, AlertTriangle } from 'lucide-react';
import { MicButton } from '../components/MicButton';
import { alzadoSVG, imprimirAlzado, descargarSVG, descargarPNG } from '../utils/alzado';
import './SectionAsistenteIA.css';

const EJEMPLOS = [
  'Alzado de una pared de 4 m de ancho por 3 m de alto, con un mueble a medida de 90 cm de altura y 4 módulos pegados a la derecha. Quito 30 cm a la izquierda; proponme tú las medidas de los módulos.',
  'Alzado de 3,20 × 2,60 con una ventana de 120 × 100 a 90 del suelo y un mueble bajo de 4 cajones',
];
const KEY = 'asistente-diseno-v1';
const leer = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };

export function SectionAsistenteDiseno() {
  const ini = useMemo(leer, []);
  const [messages, setMessages] = useState(ini.messages || []);
  const [spec, setSpec] = useState(ini.spec || null);
  const [avisos, setAvisos] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify({ messages, spec })); } catch { /* sin almacenamiento */ } }, [messages, spec]);

  const hoy = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const svg = useMemo(() => (spec ? alzadoSVG(spec, { fecha: hoy }) : ''), [spec, hoy]);
  const nombre = (spec?.titulo || 'alzado');

  const send = async (text) => {
    const t = (text ?? input).trim();
    if (!t || loading) return;
    setError('');
    const next = [...messages, { role: 'user', content: t }];
    setMessages(next); setInput(''); setLoading(true);
    try {
      const { data } = await api.post('/asistente-diseno/chat', { messages: next.map(m => ({ role: m.role, content: m.content })), spec });
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
      if (data.spec) setSpec(data.spec);
      setAvisos(data.avisos || []);
    } catch (e) {
      setError(e.response?.data?.error || 'No he podido consultar al asistente.');
    } finally { setLoading(false); }
  };

  const nueva = () => { if (messages.length && !window.confirm('¿Empezar una lámina nueva? Se borra la conversación y el dibujo actual.')) return; setMessages([]); setSpec(null); setAvisos([]); setError(''); };

  return (
    <div className="ap-section">
      <div className="ap-section-head">
        <div>
          <h1><Ruler size={20} style={{ verticalAlign: -3, marginRight: 6 }} />Asistente de diseño</h1>
          <p>Cuéntale la pared y el mueble y te va dibujando el alzado con sus cotas. Pídele cambios hasta que te guste y descárgalo en PDF.</p>
        </div>
        {messages.length > 0 && <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={nueva}><RotateCcw size={13} /> Nueva lámina</button>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 400px) minmax(0, 1fr)', gap: 14, alignItems: 'stretch' }} className="dis-grid">
        <div className="ai-chat" style={{ minHeight: 480, maxHeight: 'calc(100vh - 200px)' }}>
          <div className="ai-chat-body">
            {messages.length === 0 ? (
              <div className="ai-chat-empty">
                <p>Prueba con algo como:</p>
                <div className="ai-chat-examples">
                  {EJEMPLOS.map(ej => <button key={ej} type="button" className="ap-btn ap-btn-ghost ap-btn-sm" style={{ textAlign: 'left', whiteSpace: 'normal' }} onClick={() => send(ej)}>{ej}</button>)}
                </div>
              </div>
            ) : messages.map((m, i) => (
              <div key={i} className={`ai-msg ai-msg--${m.role}`}><div className="ai-msg-bubble"><span style={{ whiteSpace: 'pre-wrap' }}>{m.content}</span></div></div>
            ))}
            {loading && <div className="ai-msg ai-msg--assistant"><div className="ai-msg-bubble ai-msg-bubble--loading">Calculando medidas…</div></div>}
            <div ref={bottomRef} />
          </div>
          {error && <p className="ap-error" style={{ margin: '0 1rem' }}>{error}</p>}
          <form onSubmit={e => { e.preventDefault(); send(); }} className="ai-chat-input-row">
            <MicButton disabled={loading} onResult={t => setInput(prev => (prev ? prev + ' ' : '') + t)} />
            <input className="ap-field-input" value={input} onChange={e => setInput(e.target.value)} placeholder={spec ? 'Pide un cambio: "módulo 2 de cajones", "10 cm más ancho"…' : 'Describe la pared y el mueble…'} disabled={loading} />
            <button type="submit" className="ap-btn ap-btn-primary ap-btn-sm" disabled={loading || !input.trim()}><SendIcon size={13} /></button>
          </form>
        </div>

        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 480 }}>
          {spec ? (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <strong style={{ fontSize: '0.9rem', flex: 1, minWidth: 140 }}>{spec.titulo}</strong>
                <button type="button" className="ap-btn ap-btn-primary ap-btn-sm" onClick={() => { if (!imprimirAlzado(svg)) setError('El navegador ha bloqueado la ventana. Permite ventanas emergentes para esta web.'); }}><Printer size={13} /> PDF (A3)</button>
                <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => descargarPNG(svg, nombre)}><Download size={13} /> PNG</button>
                <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => descargarSVG(svg, nombre)}><Download size={13} /> SVG</button>
              </div>
              {avisos.length > 0 && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: 'rgba(224,162,74,0.12)', border: '1px solid rgba(224,162,74,0.35)', borderRadius: 8, padding: '0.5rem 0.7rem', fontSize: '0.78rem' }}>
                  <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2, color: '#e0a24a' }} />
                  <div>{avisos.map((a, i) => <div key={i}>{a}</div>)}</div>
                </div>
              )}
              <div style={{ background: '#fff', borderRadius: 8, padding: 6, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto' }} dangerouslySetInnerHTML={{ __html: svg }} />
              <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.45)' }}>Para guardar en PDF: pulsa "PDF (A3)" y en la ventana de impresión elige "Guardar como PDF". Sale a escala real.</div>
            </>
          ) : (
            <div style={{ margin: 'auto', textAlign: 'center', color: 'rgba(255,255,255,0.45)', fontSize: '0.85rem', maxWidth: 320 }}>
              <Ruler size={34} style={{ opacity: 0.5, marginBottom: 8 }} />
              <div>Aquí aparecerá la lámina en cuanto me digas el ancho y el alto de la pared.</div>
            </div>
          )}
        </div>
      </div>
      <style>{'@media (max-width: 900px){.dis-grid{grid-template-columns:1fr !important}}'}</style>
    </div>
  );
}
