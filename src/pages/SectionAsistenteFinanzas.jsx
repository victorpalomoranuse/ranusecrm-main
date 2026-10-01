import { useState, useRef, useEffect } from 'react';
import api from '../services/api';
import { Send as SendIcon, Paperclip, X, Wallet, CheckCircle2, FileText } from 'lucide-react';
import { MicButton } from '../components/MicButton';
import './SectionAsistenteIA.css';

const EJEMPLOS = [
  'Te paso varias facturas de material de obra, dalas de alta',
  'Esta es la captura de una transferencia que me han hecho, es un anticipo',
  'Aquí tienes el ticket de la gasolina de esta semana',
];

function fmt(n) {
  return Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Tarjetas de confirmación de lo que se ha creado en Finanzas en este turno.
function CreadosList({ creados }) {
  if (!creados?.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '0.75rem 0' }}>
      {creados.map(m => (
        <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(190,176,162,0.1)', border: '1px solid rgba(190,176,162,0.25)', borderRadius: 8, padding: '0.55rem 0.75rem' }}>
          <CheckCircle2 size={14} color="#8bae8f" style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: '0.8rem', color: '#fff' }}>{m.concepto}</p>
            <p style={{ margin: 0, fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)' }}>{m.categoria} · {m.fecha}</p>
          </div>
          <strong style={{ fontSize: '0.85rem', color: m.tipo === 'ingreso' ? '#22c55e' : '#ef4444', flexShrink: 0 }}>
            {m.tipo === 'ingreso' ? '+' : '-'}{fmt(m.monto)}
          </strong>
        </div>
      ))}
    </div>
  );
}

function MessageContent({ content, creados }) {
  const isArray = Array.isArray(content);
  const images = isArray ? content.filter(b => b.type === 'image') : [];
  const documentos = isArray ? content.filter(b => b.type === 'document') : [];
  const text = isArray ? (content.find(b => b.type === 'text')?.text || '') : content;
  return (
    <>
      {(images.length > 0 || documentos.length > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: text ? '0.5rem' : 0 }}>
          {images.map((img, i) => (
            <img key={`img-${i}`} src={`data:${img.source.media_type};base64,${img.source.data}`} alt="Captura adjunta"
              style={{ maxWidth: images.length > 1 ? 140 : '100%', borderRadius: 8, display: 'block' }} />
          ))}
          {documentos.map((doc, i) => (
            <div key={`doc-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 8, padding: '0.5rem 0.65rem', fontSize: '0.78rem' }}>
              <FileText size={14} style={{ flexShrink: 0 }} />
              <span>{doc.title || 'Documento PDF'}</span>
            </div>
          ))}
        </div>
      )}
      {text && <span style={{ whiteSpace: 'pre-wrap' }}>{text}</span>}
      <CreadosList creados={creados} />
    </>
  );
}

export function SectionAsistenteFinanzas() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingFiles, setPendingFiles] = useState([]);
  const bottomRef = useRef(null);
  const fileRef = useRef();

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  const addFile = async (file) => {
    if (!file || !(file.type.startsWith('image/') || file.type === 'application/pdf')) return;
    const base64 = await fileToBase64(file);
    const isPdf = file.type === 'application/pdf';
    setPendingFiles(prev => [...prev, { previewUrl: isPdf ? null : URL.createObjectURL(file), base64, mediaType: file.type, name: file.name, isPdf }]);
  };

  const handlePickFiles = async (e) => {
    const files = [...(e.target.files || [])];
    for (const file of files) await addFile(file);
    e.target.value = '';
  };

  const removeFile = (idx) => setPendingFiles(prev => prev.filter((_, i) => i !== idx));

  useEffect(() => {
    const onPaste = (e) => {
      const items = [...(e.clipboardData?.items || [])].filter(i => i.type.startsWith('image/') || i.type === 'application/pdf');
      if (items.length === 0) return;
      e.preventDefault();
      items.forEach(item => addFile(item.getAsFile()));
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const send = async (text) => {
    const textContent = (text ?? input).trim();
    if ((!textContent && pendingFiles.length === 0) || loading) return;
    setError('');

    let content;
    if (pendingFiles.length > 0) {
      content = [
        ...pendingFiles.map(f => f.isPdf
          ? { type: 'document', source: { type: 'base64', media_type: f.mediaType, data: f.base64 }, title: f.name }
          : { type: 'image', source: { type: 'base64', media_type: f.mediaType, data: f.base64 } }),
        { type: 'text', text: textContent || (pendingFiles.length > 1 ? 'Aquí tienes varias facturas/recibos — dalos de alta en Finanzas.' : 'Aquí tienes una factura/recibo — dalo de alta en Finanzas.') },
      ];
    } else {
      content = textContent;
    }

    const nextMessages = [...messages, { role: 'user', content }];
    setMessages(nextMessages);
    setInput('');
    setPendingFiles([]);
    setLoading(true);
    try {
      const { data } = await api.post('/ai-finanzas/chat', { messages: nextMessages });
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply, creados: data.creados }]);
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
          <h1><Wallet size={20} style={{ verticalAlign: -3, marginRight: 6 }} />Asistente de Finanzas</h1>
          <p>Pégale fotos, capturas o PDFs de facturas, recibos, tickets o movimientos bancarios (puedes mandar varios a la vez) y los da de alta solo en Finanzas — vienen con IVA, él los guarda sin IVA. Revísalos y ajústalos después en Finanzas.</p>
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
                  <MessageContent content={m.content} creados={m.creados} />
                </div>
              </div>
            ))
          )}
          {loading && (
            <div className="ai-msg ai-msg--assistant">
              <div className="ai-msg-bubble ai-msg-bubble--loading">Leyendo los documentos…</div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {error && <p className="ap-error" style={{ margin: '0 1rem' }}>{error}</p>}

        {pendingFiles.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 1rem 0.5rem' }}>
            {pendingFiles.map((f, i) => (
              <div key={i} className="ai-chat-pending-image">
                {f.isPdf ? (
                  <div style={{ width: 60, height: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, background: 'rgba(255,255,255,0.08)', borderRadius: 8 }} title={f.name}>
                    <FileText size={20} />
                    <span style={{ fontSize: '0.55rem', maxWidth: 54, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                  </div>
                ) : (
                  <img src={f.previewUrl} alt="Captura" />
                )}
                <button type="button" onClick={() => removeFile(i)} className="ai-chat-pending-image-remove"><X size={12} /></button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="ai-chat-input-row">
          <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple onChange={handlePickFiles} style={{ display: 'none' }} />
          <button type="button" className="ap-btn-icon" onClick={() => fileRef.current.click()} disabled={loading} title="Adjuntar facturas/recibos en foto o PDF (o pega con Ctrl+V)">
            <Paperclip size={15} />
          </button>
          <MicButton disabled={loading} onResult={text => setInput(prev => (prev ? prev + ' ' : '') + text)} />
          <input
            className="ap-field-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={pendingFiles.length > 0 ? 'Añade contexto (opcional)…' : 'Adjunta facturas/recibos (foto o PDF) con el clip o pega con Ctrl+V…'}
            disabled={loading}
          />
          <button type="submit" className="ap-btn ap-btn-primary ap-btn-sm" disabled={loading || (!input.trim() && pendingFiles.length === 0)}>
            <SendIcon size={13} />
          </button>
        </form>
      </div>
    </div>
  );
}
