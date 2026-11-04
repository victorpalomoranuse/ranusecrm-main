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
  const quiereRef = useRef(false); // true mientras el usuario no haya pulsado parar

  useEffect(() => () => { quiereRef.current = false; recognitionRef.current?.stop(); }, []);

  if (!supported) return null;

  // Escucha continua: no se corta en las pausas al pensar; solo para cuando pulsas el cuadrado.
  // Si el navegador cierra la sesión por silencio, se reabre sola mientras sigas "grabando".
  const arranca = () => {
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!e.results[i].isFinal) continue;
        const text = e.results[i][0].transcript.trim();
        if (text) onResult(text);
      }
    };
    recognition.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') quiereRef.current = false; // sin permiso o sin micro: no reintentar
    };
    recognition.onend = () => {
      if (quiereRef.current) { setTimeout(() => { if (!quiereRef.current) return; try { arranca(); } catch { quiereRef.current = false; setListening(false); } }, 250); return; }
      setListening(false);
    };
    recognitionRef.current = recognition;
    recognition.start();
  };
  const toggle = () => {
    if (listening) { quiereRef.current = false; recognitionRef.current?.stop(); setListening(false); return; }
    quiereRef.current = true;
    try { arranca(); setListening(true); } catch { quiereRef.current = false; setListening(false); }
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
