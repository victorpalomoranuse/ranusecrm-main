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
      {images.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: text ? '0.5rem' : 0 }}>
          {images.map((img, i) => (
            <img
              key={i}
              src={`data:${img.source.media_type};base64,${img.source.data}`}
              alt="Captura adjunta"
              style={{ maxWidth: images.length > 1 ? 140 : '100%', borderRadius: 8, display: 'block' }}
            />
          ))}
        </div>
      )}
      {text && <span>{text}</span>}
    </>
  );
}

export function SectionAsistenteSetter() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingImages, setPendingImages] = useState([]);
  const bottomRef = useRef(null);
  const fileRef = useRef();

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  const addImageFile = async (file) => {
    if (!file) return;
    const base64 = await fileToBase64(file);
    setPendingImages(prev => [...prev, { previewUrl: URL.createObjectURL(file), base64, mediaType: file.type }]);
  };

  const handlePickImages = async (e) => {
    const files = [...(e.target.files || [])];
    for (const file of files) await addImageFile(file);
    e.target.value = '';
  };

  const removeImage = (idx) => setPendingImages(prev => prev.filter((_, i) => i !== idx));

  useEffect(() => {
    const onPaste = (e) => {
      const items = [...(e.clipboardData?.items || [])].filter(i => i.type.startsWith('image/'));
      if (items.length === 0) return;
      e.preventDefault();
      items.forEach(item => addImageFile(item.getAsFile()));
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const send = async (text) => {
    const textContent = (text ?? input).trim();
    if ((!textContent && pendingImages.length === 0) || loading) return;
    setError('');

    let content;
    if (pendingImages.length > 0) {
      content = [
        ...pendingImages.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } })),
        { type: 'text', text: textContent || (pendingImages.length > 1 ? 'Aquí tienes varias capturas de la misma conversación — dime qué le respondo.' : 'Aquí tienes la captura de la conversación — dime qué le respondo.') },
      ];
    } else {
      content = textContent;
    }

    const nextMessages = [...messages, { role: 'user', content }];
    setMessages(nextMessages);
    setInput('');
    setPendingImages([]);
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
          <p>Pégale la captura de una conversación de Instagram (o cuéntale el contexto) y te dice en qué etapa está, qué falta por descubrir, y el mensaje exacto para responder — siguiendo el playbook de calificación de Ranuse Design. Puedes adjuntar varias capturas a la vez si la conversación no cabe en una sola.</p>
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

        {pendingImages.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 1rem 0.5rem' }}>
            {pendingImages.map((img, i) => (
              <div key={i} className="ai-chat-pending-image">
                <img src={img.previewUrl} alt="Captura" />
                <button type="button" onClick={() => removeImage(i)} className="ai-chat-pending-image-remove"><X size={12} /></button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="ai-chat-input-row">
          <input ref={fileRef} type="file" accept="image/*" multiple onChange={handlePickImages} style={{ display: 'none' }} />
          <button type="button" className="ap-btn-icon" onClick={() => fileRef.current.click()} disabled={loading} title="Adjuntar una o varias capturas de la conversación (o pega con Ctrl+V)">
            <Paperclip size={15} />
          </button>
          <input
            className="ap-field-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={pendingImages.length > 0 ? 'Añade contexto (opcional)…' : 'Ej. me escribió preguntando el precio, ¿qué le digo? (o pega una o varias capturas con Ctrl+V)'}
            disabled={loading}
          />
          <button type="submit" className="ap-btn ap-btn-primary ap-btn-sm" disabled={loading || (!input.trim() && pendingImages.length === 0)}>
            <SendIcon size={13} />
          </button>
        </form>
      </div>
    </div>
  );
}
