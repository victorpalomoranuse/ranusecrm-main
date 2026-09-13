import { useState, useRef, useEffect } from 'react';
import api from '../services/api';
import { Send as SendIcon, Paperclip, X, MessageCircle } from 'lucide-react';
import './SectionAsistenteIA.css';

const EJEMPLOS = [
  'Pégame la captura de esta conversación y dime qué le respondo',
  'Me dijo que tiene un garaje de 30m² y quiere meter rack, mancuernas y cardio, ¿qué le digo?',
  'Solo reaccionó a una historia con un emoji, ¿cómo abro conversación?',
];

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function MessageContent({ content }) {
  const isArray = Array.isArray(content);
  const images = isArray ? content.filter(b => b.type === 'image') : [];
  const text = isArray ? (content.find(b => b.type === 'text')?.text || '') : content;
  return (
    <>
      {images.map((img, i) => (
        <img
          key={i}
          src={`data:${img.source.media_type};base64,${img.source.data}`}
          alt="Captura adjunta"
          style={{ maxWidth: '100%', borderRadius: 8, marginBottom: text ? '0.5rem' : 0, display: 'block' }}
        />
      ))}
      {text && <span>{text}</span>}
    </>
  );
}

export function SectionAsistenteSetter() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingImage, setPendingImage] = useState(null);
  const bottomRef = useRef(null);
  const fileRef = useRef();

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  const handlePickImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const base64 = await fileToBase64(file);
    setPendingImage({ previewUrl: URL.createObjectURL(file), base64, mediaType: file.type });
    e.target.value = '';
  };

  const send = async (text) => {
    const textContent = (text ?? input).trim();
    if ((!textContent && !pendingImage) || loading) return;
    setError('');

    let content;
    if (pendingImage) {
      content = [
        { type: 'image', source: { type: 'base64', media_type: pendingImage.mediaType, data: pendingImage.base64 } },
        { type: 'text', text: textContent || 'Aquí tienes la captura de la conversación — dime qué le respondo.' },
      ];
    } else {
      content = textContent;
    }

    const nextMessages = [...messages, { role: 'user', content }];
    setMessages(nextMessages);
    setInput('');
    setPendingImage(null);
    setLoading(true);
    try {
      const { data } = await api.post('/ai-setter/chat', { messages: nextMessages });
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
          <h1><MessageCircle size={20} style={{ verticalAlign: -3, marginRight: 6 }} />Asistente Setter</h1>
          <p>Pégale la captura de una conversación de Instagram (o cuéntale el contexto) y te dice en qué etapa está, qué falta por descubrir, y el mensaje exacto para responder — siguiendo el playbook de calificación de Ranuse Design.</p>
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
                <div className="ai-msg-bubble">
                  <MessageContent content={m.content} />
                </div>
              </div>
            ))
          )}
          {loading && (
            <div className="ai-msg ai-msg--assistant">
              <div className="ai-msg-bubble ai-msg-bubble--loading">Analizando la conversación…</div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {error && <p className="ap-error" style={{ margin: '0 1rem' }}>{error}</p>}

        {pendingImage && (
          <div className="ai-chat-pending-image">
            <img src={pendingImage.previewUrl} alt="Captura" />
            <button type="button" onClick={() => setPendingImage(null)} className="ai-chat-pending-image-remove"><X size={12} /></button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="ai-chat-input-row">
          <input ref={fileRef} type="file" accept="image/*" onChange={handlePickImage} style={{ display: 'none' }} />
          <button type="button" className="ap-btn-icon" onClick={() => fileRef.current.click()} disabled={loading} title="Adjuntar captura de la conversación">
            <Paperclip size={15} />
          </button>
          <input
            className="ap-field-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={pendingImage ? 'Añade contexto (opcional)…' : 'Ej. me escribió preguntando el precio, ¿qué le digo?'}
            disabled={loading}
          />
          <button type="submit" className="ap-btn ap-btn-primary ap-btn-sm" disabled={loading || (!input.trim() && !pendingImage)}>
            <SendIcon size={13} />
          </button>
        </form>
      </div>
    </div>
  );
}
