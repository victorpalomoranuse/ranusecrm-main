import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';

const SpeechRecognitionCtor = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;

// Botón de dictado por voz reutilizado en todos los chats de IA del panel
// (Asistente IA, Asistente Setter, Asistente Finanzas). Usa el reconocimiento
// de voz nativo del navegador (Chrome/Edge) — nada de backend ni de costes
// de transcripción. Lo que se dice se añade al texto ya escrito, no lo pisa,
// para poder combinar dictado y teclado.
export function MicButton({ onResult, disabled, lang = 'es-ES' }) {
  const supported = Boolean(SpeechRecognitionCtor);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);

  useEffect(() => () => { recognitionRef.current?.stop(); }, []);

  if (!supported) return null;

  const toggle = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = lang;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (e) => {
      const text = Array.from(e.results).map(r => r[0].transcript).join(' ').trim();
      if (text) onResult(text);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  return (
    <button
      type="button"
      className={`ap-btn-icon ai-mic-btn${listening ? ' ai-mic-btn--active' : ''}`}
      onClick={toggle}
      disabled={disabled}
      title={listening ? 'Detener dictado' : 'Hablar con el micrófono'}
    >
      {listening ? <Square size={13} /> : <Mic size={15} />}
    </button>
  );
}
