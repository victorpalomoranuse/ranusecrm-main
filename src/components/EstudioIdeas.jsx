import { useState, useRef, useEffect } from 'react';
import api from '../services/api';
import './EstudioIdeas.css';

// Estudio de ideas: chat con un agente creativo (ChatGPT) que ve imágenes y genera imágenes.
// Se usa en la sección propia del CRM y dentro del visor 3D (capturarVista = imagen de la vista actual).

const ATAJOS = [
  'Dame una idea de mural para esta pared',
  'Ahora dame solo la imagen, sin la pared, para imprimir',
  'Haz una variante con otros colores',
  'Más sencillo y minimalista',
];

// Reduce la imagen antes de mandarla (la API y la red agradecen no subir fotos de 10 MB)
function comprimir(fichero, maxLado = 1600) {
  return new Promise((ok, mal) => {
    const url = URL.createObjectURL(fichero), img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxLado / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('No se pudo leer la imagen')); };
    img.src = url;
  });
}

function descargar(url, nombre) {
  const a = document.createElement('a'); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
}

export default function EstudioIdeas({ oscuro = false, capturarVista = null, onCerrar = null }) {
  const [mensajes, setMensajes] = useState([]);       // { rol: 'yo'|'ia', texto, imagenes, modelo }
  const [texto, setTexto] = useState('');
  const [adjuntas, setAdjuntas] = useState([]);       // data URLs que irán en el próximo mensaje
  const [previo, setPrevio] = useState(null);         // id de la respuesta anterior: así el agente recuerda la conversación
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState('');
  const [grande, setGrande] = useState(null);
  const fin = useRef(null), fichero = useRef(null);

  useEffect(() => { fin.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [mensajes, trabajando]);
  useEffect(() => {
    if (!grande) return;
    const h = e => { if (e.key === 'Escape') { e.stopPropagation(); setGrande(null); } };
    window.addEventListener('keydown', h, true); return () => window.removeEventListener('keydown', h, true);
  }, [grande]);

  const adjuntar = async (lista) => {
    try {
      const nuevas = [];
      for (const f of Array.from(lista || []).slice(0, 4)) if (/^image\//.test(f.type)) nuevas.push(await comprimir(f));
      if (nuevas.length) setAdjuntas(a => [...a, ...nuevas].slice(0, 4));
    } catch (e) { setError(e.message); }
  };
  const alPegar = (e) => {
    const fs = Array.from(e.clipboardData?.files || []).filter(f => /^image\//.test(f.type));
    if (fs.length) { e.preventDefault(); adjuntar(fs); }
  };
  const usarVista = async () => {
    try { const u = await capturarVista(); if (u) setAdjuntas(a => [...a, u].slice(0, 4)); } catch { setError('No se pudo coger la vista del 3D'); }
  };

  const enviar = async (t) => {
    const msg = (t ?? texto).trim();
    if ((!msg && !adjuntas.length) || trabajando) return;
    const imgs = adjuntas;
    setMensajes(m => [...m, { rol: 'yo', texto: msg, imagenes: imgs }]);
    setTexto(''); setAdjuntas([]); setError(''); setTrabajando(true);
    try {
      const r = await api.post('/estudio-ideas/chat', { texto: msg, imagenes: imgs, previousResponseId: previo }, { timeout: 280000 });
      setPrevio(r.data.id);
      setMensajes(m => [...m, { rol: 'ia', texto: r.data.texto, imagenes: r.data.imagenes || [], modelo: r.data.modelo }]);
    } catch (e) {
      setError(e.response?.data?.error || 'No se pudo contestar. Prueba otra vez.');
    } finally { setTrabajando(false); }
  };
  const nueva = () => { setMensajes([]); setPrevio(null); setAdjuntas([]); setError(''); };

  return (
    <div className={'ei' + (oscuro ? ' ei-oscuro' : '')}>
      <div className="ei-cab">
        <b>✨ Estudio de ideas</b>
        <span className="ei-sub">Comparte una imagen, pide una idea y retócala hablando. Al final pídele «solo la imagen».</span>
        <span className="ei-esp" />
        {mensajes.length > 0 && <button type="button" className="ei-btn" onClick={nueva}>Nueva conversación</button>}
        {onCerrar && <button type="button" className="ei-btn" onClick={onCerrar}>✕</button>}
      </div>

      <div className="ei-chat">
        {!mensajes.length && !trabajando && (
          <div className="ei-vacio">
            <p>Prueba, por ejemplo:</p>
            <ol>
              <li>Sube una foto de una pared (o usa la vista actual del 3D) y escribe «dame una idea de mural para esta pared».</li>
              <li>Cuando te guste, escribe «ahora dame solo la imagen, sin la pared» y descárgala.</li>
            </ol>
          </div>
        )}
        {mensajes.map((m, i) => (
          <div key={i} className={'ei-msg ei-' + m.rol}>
            {m.texto && <p>{m.texto}</p>}
            {m.imagenes?.length > 0 && (
              <div className="ei-imgs">
                {m.imagenes.map((u, k) => (
                  <figure key={k}>
                    <img src={u} alt="" title="Clic para verla en grande" onClick={() => setGrande(u)} />
                    {m.rol === 'ia' && (
                      <figcaption>
                        <button type="button" className="ei-btn" onClick={() => descargar(u, 'idea-' + (i + 1) + (m.imagenes.length > 1 ? '-' + (k + 1) : '') + '.png')}>Descargar</button>
                        <button type="button" className="ei-btn" title="La añade al siguiente mensaje para seguir trabajando con ella" onClick={() => setAdjuntas(a => [...a, u].slice(0, 4))}>Usar de referencia</button>
                      </figcaption>
                    )}
                  </figure>
                ))}
              </div>
            )}
            {m.rol === 'ia' && m.modelo && <small className="ei-modelo">Hecho con {m.modelo}</small>}
          </div>
        ))}
        {trabajando && <div className="ei-msg ei-ia ei-pensando">ChatGPT está trabajando… las imágenes pueden tardar un minuto o dos.</div>}
        {error && <div className="ei-error">{error}</div>}
        <div ref={fin} />
      </div>

      <div className="ei-atajos">
        {ATAJOS.map(a => <button key={a} type="button" className="ei-chip" disabled={trabajando} onClick={() => enviar(a)}>{a}</button>)}
      </div>

      {adjuntas.length > 0 && (
        <div className="ei-adj">
          {adjuntas.map((u, i) => (
            <span key={i} className="ei-mini"><img src={u} alt="" /><button type="button" onClick={() => setAdjuntas(a => a.filter((_, j) => j !== i))} title="Quitar">✕</button></span>
          ))}
        </div>
      )}

      <div className="ei-caja">
        <input ref={fichero} type="file" accept="image/*" multiple hidden onChange={e => { adjuntar(e.target.files); e.target.value = ''; }} />
        <button type="button" className="ei-btn" onClick={() => fichero.current?.click()} title="Adjuntar una o varias imágenes (también puedes pegarlas con Ctrl+V)">📎 Imagen</button>
        {capturarVista && <button type="button" className="ei-btn" onClick={usarVista} title="Adjunta lo que se ve ahora en el 3D">🖼 Vista actual</button>}
        <textarea value={texto} rows={2} placeholder="Escribe qué quieres… (Intro envía, Mayús+Intro salto de línea)" disabled={trabajando}
          onChange={e => setTexto(e.target.value)} onPaste={alPegar}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }} />
        <button type="button" className="ei-btn ei-enviar" disabled={trabajando || (!texto.trim() && !adjuntas.length)} onClick={() => enviar()}>Enviar</button>
      </div>

      {grande && (
        <>
          <div className="ei-grande-barra">
            <button type="button" className="ei-btn" onClick={() => descargar(grande, 'idea.png')}>Descargar</button>
            <button type="button" className="ei-btn" onClick={() => setGrande(null)}>✕ Cerrar (Esc)</button>
          </div>
          <div className="ei-grande" onClick={() => setGrande(null)}><img src={grande} alt="" /></div>
        </>
      )}
    </div>
  );
}
