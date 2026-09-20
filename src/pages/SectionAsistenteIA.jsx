import { useState, useRef, useEffect } from 'react';
import api from '../services/api';
import { MessageSquare, Send, Paperclip, X, FileText } from 'lucide-react';
import './SectionAsistenteIA.css';

const EJEMPLOS = [
  'Gimnasio en casa con rack, banco y mancuernas, tres niveles de precio',
  'Presupuesto para sala de cardio: cinta, bici y remo',
  'Crea el presupuesto de nivel medio para el proyecto de [nombre del cliente]',
];

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Extrae un bloque de código ```lang ... ``` (si existe) y devuelve el resto
// del texto sin él, junto con el contenido del bloque.
function extractFencedBlock(text, lang) {
  if (typeof text !== 'string') return { rest: text, block: null };
  const re = new RegExp('```' + lang + '\\s*([\\s\\S]*?)```', 'i');
  const match = text.match(re);
  if (!match) return { rest: text, block: null };
  const rest = (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim();
  return { rest, block: match[1].trim() };
}

function ProductCards({ productos }) {
  if (!productos?.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', margin: '0.75rem 0' }}>
      {productos.map((p, i) => (
        <div key={i} style={{ width: 150, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ width: '100%', height: 100, background: 'rgba(255,255,255,0.03)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {p.foto ? (
              <img src={p.foto} alt={p.nombre || 'Producto'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.25)' }}>Sin foto</span>
            )}
          </div>
          <div style={{ padding: '0.5rem 0.6rem' }}>
            <p style={{ margin: 0, fontSize: '0.72rem', color: '#fff', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.nombre}</p>
            {p.precio && <p style={{ margin: '2px 0 0', fontSize: '0.74rem', color: '#beb0a2', fontWeight: 600 }}>{p.precio}</p>}
            {p.enlace && (
              <a href={p.enlace} target="_blank" rel="noopener noreferrer" style={{ display: 'block', marginTop: 4, fontSize: '0.68rem', color: 'rgba(255,255,255,0.5)' }}>
                Ver producto ↗
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function QuickReplies({ opciones, onPick, onOther, disabled }) {
  if (!opciones?.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.6rem' }}>
      {opciones.map((op, i) => (
        <button
          key={i}
          type="button"
          className="ap-btn ap-btn-ghost ap-btn-sm"
          disabled={disabled}
          onClick={() => onPick(op)}
        >
          {op}
        </button>
      ))}
      {onOther && (
        <button
          type="button"
          className="ap-btn ap-btn-ghost ap-btn-sm"
          style={{ opacity: 0.65, borderStyle: 'dashed' }}
          disabled={disabled}
          onClick={onOther}
        >
          Otro… (escribir)
        </button>
      )}
    </div>
  );
}

function MessageContent({ content, onOption, onOther, loading }) {
  const isArray = Array.isArray(content);
  const images = isArray ? content.filter(b => b.type === 'image') : [];
  const docs = isArray ? content.filter(b => b.type === 'document') : [];
  const rawText = isArray ? (content.find(b => b.type === 'text')?.text || '') : content;

  const { rest: afterSvg, block: svgBlock } = extractFencedBlock(rawText, 'svg');
  const svg = svgBlock ? svgBlock.replace(/<script[\s\S]*?<\/script>/gi, '') : null;
  const { rest: afterProductos, block: productosBlock } = extractFencedBlock(afterSvg, 'productos');
  let productos = null;
  if (productosBlock) {
    try { const parsed = JSON.parse(productosBlock); if (Array.isArray(parsed)) productos = parsed; } catch { /* ignora bloque mal formado */ }
  }
  const { rest: text, block: opcionesBlock } = extractFencedBlock(afterProductos, 'opciones');
  let opciones = null;
  if (opcionesBlock) {
    try { const parsed = JSON.parse(opcionesBlock); if (Array.isArray(parsed)) opciones = parsed.filter(o => typeof o === 'string'); } catch { /* ignora bloque mal formado */ }
  }

  return (
    <>
      {(images.length > 0 || docs.length > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: text ? '0.5rem' : 0 }}>
          {images.map((img, i) => (
            <img
              key={i}
              src={`data:${img.source.media_type};base64,${img.source.data}`}
              alt="Adjunto"
              style={{ maxWidth: (images.length + docs.length) > 1 ? 140 : '100%', borderRadius: 8, display: 'block' }}
            />
          ))}
          {docs.map((doc, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 8, padding: '0.5rem 0.75rem', fontSize: '0.78rem' }}>
              <FileText size={14} /> {doc.title || 'Plano PDF'}
            </div>
          ))}
        </div>
      )}
      {text && <span>{text}</span>}
      {svg && (
        <div
          style={{ margin: '0.75rem 0', background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: '0.75rem' }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
      <ProductCards productos={productos} />
      {onOption && <QuickReplies opciones={opciones} onPick={onOption} onOther={onOther} disabled={loading} />}
    </>
  );
}

export function SectionAsistenteIA() {
  const [messages, setMessages] = useState([]); // [{role, content}]
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingFiles, setPendingFiles] = useState([]); // [{ kind: 'image'|'pdf', previewUrl?, base64, mediaType, name }]
  const bottomRef = useRef(null);
  const fileRef = useRef();
  const textInputRef = useRef();

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  const focusInput = () => textInputRef.current?.focus();

  const addFile = async (file) => {
    if (!file) return;
    const base64 = await fileToBase64(file);
    if (file.type === 'application/pdf') {
      setPendingFiles(prev => [...prev, { kind: 'pdf', base64, mediaType: file.type, name: file.name }]);
    } else if (file.type.startsWith('image/')) {
      setPendingFiles(prev => [...prev, { kind: 'image', previewUrl: URL.createObjectURL(file), base64, mediaType: file.type, name: file.name }]);
    }
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
        ...pendingFiles.map(f => f.kind === 'pdf'
          ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.base64 }, title: f.name }
          : { type: 'image', source: { type: 'base64', media_type: f.mediaType, data: f.base64 } }),
        { type: 'text', text: textContent || '¿Qué te parece esta distribución? Sugiéreme una si crees que se puede mejorar.' },
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
      const { data } = await api.post('/ai-budget/chat', { messages: nextMessages });
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply, budgetCreated: data.budget_created || null }]);
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
          <p>Pídele un desglose por tipos de máquina y niveles de precio (económico/medio/premium) usando tu catálogo real. Puedes adjuntarle fotos, dibujos del espacio o planos en PDF (varios a la vez). Cuando tengas claro qué nivel quieres, pídele que lo cree y quedará guardado como presupuesto real del proyecto.</p>
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
                  <MessageContent content={m.content} onOption={m.role === 'assistant' ? send : undefined} onOther={m.role === 'assistant' ? focusInput : undefined} loading={loading} />
                  {m.budgetCreated?.pdf_url && (
                    <a
                      href={m.budgetCreated.pdf_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ai-msg-pdf-link"
                    >
                      📄 Descargar PDF — {m.budgetCreated.budget_number}
                    </a>
                  )}
                </div>
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

        {pendingFiles.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 1rem 0.5rem' }}>
            {pendingFiles.map((f, i) => (
              f.kind === 'pdf' ? (
                <div key={i} className="ai-chat-pending-image" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.4rem 0.6rem', width: 'auto', height: 'auto' }}>
                  <FileText size={16} />
                  <span style={{ fontSize: '0.72rem', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                  <button type="button" onClick={() => removeFile(i)} className="ai-chat-pending-image-remove" style={{ position: 'static' }}><X size={12} /></button>
                </div>
              ) : (
                <div key={i} className="ai-chat-pending-image">
                  <img src={f.previewUrl} alt="Adjunto" />
                  <button type="button" onClick={() => removeFile(i)} className="ai-chat-pending-image-remove"><X size={12} /></button>
                </div>
              )
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="ai-chat-input-row">
          <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple onChange={handlePickFiles} style={{ display: 'none' }} />
          <button type="button" className="ap-btn-icon" onClick={() => fileRef.current.click()} disabled={loading} title="Adjuntar imagen o plano en PDF (o pega con Ctrl+V)">
            <Paperclip size={15} />
          </button>
          <input
            ref={textInputRef}
            className="ap-field-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={pendingFiles.length > 0 ? 'Añade un comentario (opcional)…' : 'Ej. gimnasio en casa con rack, banco y mancuernas, tres niveles de precio'}
            disabled={loading}
          />
          <button type="submit" className="ap-btn ap-btn-primary ap-btn-sm" disabled={loading || (!input.trim() && pendingFiles.length === 0)}>
            <Send size={13} />
          </button>
        </form>
      </div>
    </div>
  );
}
