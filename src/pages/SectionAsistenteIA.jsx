import { useState, useRef, useEffect } from 'react';
import api from '../services/api';
import { MessageSquare, Send } from 'lucide-react';
import './SectionAsistenteIA.css';

const EJEMPLOS = [
  'Gimnasio en casa con rack, banco y mancuernas, tres niveles de precio',
  'Presupuesto para sala de cardio: cinta, bici y remo',
  'Qué categorías de mobiliario tengo cargadas en el catálogo',
];

export function SectionAsistenteIA() {
  const [messages, setMessages] = useState([]); // [{role, content}]
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  const send = async (text) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    setError('');
    const nextMessages = [...messages, { role: 'user', content }];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);
    try {
      const { data } = await api.post('/ai-budget/chat', { messages: nextMessages });
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      setError(err.response?.data?.error || 'Error al consultar al asistente. Revisa que la clave de Claude esté configurada.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e) => { e.preventDefault(); send(); };

  return (
    <div className="ap-section">
      <div className="ap-section-head">
        <div>
          <h1><MessageSquare size={20} style={{ verticalAlign: -3, marginRight: 6 }} />Asistente de presupuestos</h1>
          <p>Pídele un desglose por tipos de máquina y niveles de precio (económico/medio/premium) usando tu catálogo real.</p>
        </div>
      </div>

      <div className="ai-chat">
        <div className="ai-chat-body">
          {messages.length === 0 ? (
            <div className="ai-chat-empty">
              <p>Prueba con algo como:</p>
              <div className="ai-chat-examples">
                {EJEMPLOS.map(ej => (
                  <button key={ej} type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => send(ej)}>{ej}</button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={`ai-msg ai-msg--${m.role}`}>
                <div className="ai-msg-bubble">{m.content}</div>
              </div>
            ))
          )}
          {loading && (
            <div className="ai-msg ai-msg--assistant">
              <div className="ai-msg-bubble ai-msg-bubble--loading">Buscando en el catálogo…</div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {error && <p className="ap-error" style={{ margin: '0 1rem' }}>{error}</p>}

        <form onSubmit={handleSubmit} className="ai-chat-input-row">
          <input
            className="ap-field-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ej. gimnasio en casa con rack, banco y mancuernas, tres niveles de precio"
            disabled={loading}
          />
          <button type="submit" className="ap-btn ap-btn-primary ap-btn-sm" disabled={loading || !input.trim()}>
            <Send size={13} />
          </button>
        </form>
      </div>
    </div>
  );
}
