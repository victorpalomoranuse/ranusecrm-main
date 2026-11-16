import { useState, useRef, useEffect } from 'react';
import api from '../services/api';
import './EstudioIdeas.css';

// Estudio de ideas: chat con un agente creativo (ChatGPT) que ve imágenes y genera imágenes.
// Se usa en la sección propia del CRM y dentro del visor 3D (capturarVista = imagen de la vista actual).

const ATAJOS = [
  'Dame una idea para este espacio',
  'Dame una idea de mural para esta pared',
  { texto: 'Ahora dame solo el mural, sin la pared ni nada más, para imprimir', solo: true },
  'Haz una variante con otros colores',
  'Más sencillo y minimalista',
];

// Reduce la imagen antes de mandarla (la API y la red agradecen no subir fotos de 10 MB)
function comprimir(fichero, maxLado = 1600, tipo = 'image/jpeg') {
  return new Promise((ok, mal) => {
    const url = URL.createObjectURL(fichero), img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxLado / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); ok(tipo === 'image/png' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('No se pudo leer la imagen')); };
    img.src = url;
  });
}

function descargar(url, nombre) {
  const a = document.createElement('a'); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
}

// Cuestionario por pasos: cuando el agente hace preguntas numeradas con opciones (A, B, C…), se enseñan de una en una con botones
function leerCuestionario(texto) {
  const lineas = String(texto || '').split('\n'), qs = []; const intro = [];
  for (const l of lineas) {
    const q = l.match(/^\s*(\d+)[).]\s+(.+?)\s*$/), o = l.match(/^\s*([A-Ea-e])[).]\s+(.+?)\s*$/);
    if (q && !o) { qs.push({ n: q[1], t: q[2].replace(/:\s*$/, ''), ops: [] }); }
    else if (o && qs.length) qs[qs.length - 1].ops.push({ l: o[1].toUpperCase(), t: o[2] });
    else if (!qs.length && l.trim()) intro.push(l.trim());
  }
  const buenas = qs.filter(q => q.ops.length >= 2);
  return buenas.length >= 2 ? { intro: intro.join(' '), qs: buenas } : null;
}
function Cuestionario({ cu, onEnviar }) {
  const [paso, setPaso] = useState(0), [resp, setResp] = useState([]), [otro, setOtro] = useState('');
  const fin = paso >= cu.qs.length, q = cu.qs[Math.min(paso, cu.qs.length - 1)];
  const elige = (op, extra) => { const nr = resp.slice(0, paso); nr[paso] = { op, extra }; setResp(nr); setOtro(''); setPaso(paso + 1); };
  const esOtra = op => /^otra cosa/i.test(op.t);
  const texto = () => 'Mis respuestas:\n' + cu.qs.map((qq, i) => { const x = resp[i]; return qq.n + ') ' + qq.t + ' → ' + (x ? (esOtra(x.op) ? (x.extra || 'otra cosa') : x.op.l + ') ' + x.op.t) : 'lo decides tú'); }).join('\n') + '\nCon esto, dibuja la idea.';
  const caja = { background: 'rgba(0,0,0,0.05)', borderRadius: 10, padding: 12, marginTop: 6 };
  const btnOp = { display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', margin: '6px 0', borderRadius: 8, border: '1px solid rgba(120,110,100,0.4)', background: 'rgba(255,255,255,0.7)', color: '#2b2723', cursor: 'pointer', font: 'inherit' };
  return (
    <div style={caja}>
      {cu.intro && <p style={{ margin: '0 0 8px', opacity: 0.85 }}>{cu.intro}</p>}
      <div style={{ height: 4, borderRadius: 2, background: 'rgba(0,0,0,0.12)', marginBottom: 8 }}><div style={{ width: (Math.min(paso, cu.qs.length) / cu.qs.length) * 100 + '%', height: '100%', borderRadius: 2, background: '#8a6d4d', transition: 'width .25s' }} /></div>
      {!fin ? (
        <>
          <div style={{ fontSize: 11, opacity: 0.6 }}>Pregunta {paso + 1} de {cu.qs.length}</div>
          <div style={{ fontWeight: 700, margin: '2px 0 4px' }}>{q.t}</div>
          {q.ops.filter(op => !esOtra(op)).map(op => <button key={op.l} type="button" style={btnOp} onClick={() => elige(op)}><b>{op.l}</b> · {op.t}</button>)}
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <input value={otro} onChange={e => setOtro(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && otro.trim()) elige(q.ops.find(esOtra) || { l: 'D', t: 'Otra cosa' }, otro.trim()); }} placeholder="Otra cosa… (escríbelo y Enter)" style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(120,110,100,0.4)', font: 'inherit' }} />
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 12 }}>
            {paso > 0 && <button type="button" className="ei-btn" onClick={() => setPaso(paso - 1)}>← Atrás</button>}
            <button type="button" className="ei-btn" onClick={() => { const nr = resp.slice(0, paso); setResp(nr); setPaso(paso + 1); }} title="Esta la decide el agente">Que decida el agente</button>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Listo. Esto es lo que has elegido:</div>
          {cu.qs.map((qq, i) => { const x = resp[i]; return <div key={i} style={{ fontSize: 13, margin: '3px 0', cursor: 'pointer' }} onClick={() => setPaso(i)} title="Clic para cambiarla"><b>{qq.t}:</b> {x ? (esOtra(x.op) ? x.extra : x.op.t) : <i>lo decide el agente</i>}</div>; })}
          <button type="button" className="ei-btn" style={{ marginTop: 10, fontWeight: 700 }} onClick={() => onEnviar(texto())}>✨ Dibujar con estas respuestas</button>
        </>
      )}
    </div>
  );
}

export default function EstudioIdeas({ oscuro = false, capturarVista = null, onCerrar = null, obtenerContexto = null }) {
  const [mensajes, setMensajes] = useState([]);       // { rol: 'yo'|'ia', texto, imagenes, modelo }
  const [texto, setTexto] = useState('');
  const [adjuntas, setAdjuntas] = useState([]);       // data URLs que irán en el próximo mensaje
  const [previo, setPrevio] = useState(null);         // id de la respuesta anterior: así el agente recuerda la conversación
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState('');
  const [grande, setGrande] = useState(null);
  const [soloDiseno, setSoloDiseno] = useState(false);
  const [formato, setFormato] = useState('auto');
  const [transparente, setTransparente] = useState(true);
  const [usarContexto, setUsarContexto] = useState(true);   // con el visor 3D: el agente conoce el modelo en cada mensaje
  const [verContexto, setVerContexto] = useState('');
  const [marcas, setMarcas] = useState([]);
  const [marcaId, setMarcaId] = useState(() => { try { return localStorage.getItem('ideasMarca') || ''; } catch { return ''; } });
  const [modo, setModo] = useState(() => { try { return localStorage.getItem('ideasModo') || 'sorprende'; } catch { return 'sorprende'; } });
  const [preguntarAntes, setPreguntarAntes] = useState(() => { try { return localStorage.getItem('ideasPreguntar') !== '0'; } catch { return true; } });
  const [subiendoMarca, setSubiendoMarca] = useState(false);
  const ficheroLogo = useRef(null);
  const [ficha, setFicha] = useState(null);
  const fin = useRef(null), fichero = useRef(null), ficheroMarca = useRef(null);

  useEffect(() => { api.get('/estudio-ideas/marcas').then(r => setMarcas(r.data?.marcas || [])).catch(() => {}); }, []);
  useEffect(() => { try { localStorage.setItem('ideasMarca', marcaId); localStorage.setItem('ideasModo', modo); localStorage.setItem('ideasPreguntar', preguntarAntes ? '1' : '0'); } catch { /* sin almacenamiento */ } }, [marcaId, modo, preguntarAntes]);
  const subirMarca = async (fl) => {
    if (!fl) return;
    setSubiendoMarca(true); setError('');
    try {
      const fd = new FormData(); fd.append('file', fl);
      const r = await api.post('/estudio-ideas/marcas', fd, { timeout: 280000 });
      setMarcas(m => [...m, { id: r.data.id, nombre: r.data.nombre }]); setMarcaId(r.data.id); setFicha({ nombre: r.data.nombre, texto: r.data.ficha });
    } catch (e) { setError(e.response?.data?.error || 'No se pudo leer el brandbook'); } finally { setSubiendoMarca(false); }
  };
  const subirLogo = async (fl) => {
    if (!fl || !marcaId) return;
    try { const u = await comprimir(fl, 1600, 'image/png'); await api.put('/estudio-ideas/marcas/' + marcaId + '/logo', { imagen: u }); setMarcas(l => l.map(m => (m.id === marcaId ? { ...m, logo: true } : m))); setError(''); }
    catch (e) { setError(e.response?.data?.error || e.message || 'No se pudo guardar el logo'); }
  };
  const verFicha = async () => {
    if (ficha) { setFicha(null); return; }
    try { const r = await api.get('/estudio-ideas/marcas/' + marcaId); setFicha({ nombre: r.data.nombre, texto: r.data.ficha }); } catch { setError('No se pudo leer la ficha'); }
  };
  const borrarMarca = async () => {
    const m = marcas.find(x => x.id === marcaId); if (!m || !window.confirm('¿Borrar la marca «' + m.nombre + '»? (Se puede volver a subir el brandbook)')) return;
    try { await api.delete('/estudio-ideas/marcas/' + marcaId); setMarcas(l => l.filter(x => x.id !== marcaId)); setMarcaId(''); setFicha(null); } catch { setError('No se pudo borrar la marca'); }
  };

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

  const enviar = async (t, forzarSolo = false) => {
    const msg = (t ?? texto).trim();
    if ((!msg && !adjuntas.length) || trabajando) return;
    const imgs = adjuntas;
    setMensajes(m => [...m, { rol: 'yo', texto: msg, imagenes: imgs }]);
    setTexto(''); setAdjuntas([]); setError(''); setTrabajando(true);
    try {
      let contexto; if (obtenerContexto && usarContexto) { try { contexto = (await obtenerContexto())?.texto; } catch { contexto = undefined; } }
      const r = await api.post('/estudio-ideas/chat', { texto: msg, imagenes: imgs, previousResponseId: previo, soloDiseno: forzarSolo || soloDiseno, formato, transparente, contexto, marcaId: marcaId || undefined, modo, fase: (preguntarAntes && !forzarSolo && !soloDiseno && !previo && imgs.length > 0) ? 'preguntar' : undefined }, { timeout: 290000 });
      if (r.data.propuestas?.length) {
        setPrevio(r.data.propuestas[0].id);
        setMensajes(m => [...m, ...r.data.propuestas.map((p, i) => ({ rol: 'ia', texto: p.texto, imagenes: p.imagenes || [], modelo: p.modelo, idResp: p.id, propuesta: i + 1, de: r.data.propuestas.length }))]);
      } else {
        setPrevio(r.data.id);
        setMensajes(m => [...m, { rol: 'ia', texto: r.data.texto, imagenes: r.data.imagenes || [], modelo: r.data.modelo, idResp: r.data.id }]);
      }
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

      {obtenerContexto && (
        <div className="ei-opciones" style={{ paddingTop: 6 }}>
          <label title="El agente recibe en cada mensaje una descripción de tu modelo (espacio, medidas, acabados y equipamiento) y solo añade lo que le pidas"><input type="checkbox" checked={usarContexto} onChange={e => setUsarContexto(e.target.checked)} /> 🧠 Conoce el modelo (no inventa nada que no le pidas)</label>
          {usarContexto && <button type="button" className="ei-btn" onClick={async () => { try { setVerContexto(verContexto ? '' : ((await obtenerContexto())?.texto || '')); } catch { setVerContexto('No se pudo leer el modelo'); } }}>{verContexto ? 'Ocultar lo que sabe' : 'Ver lo que sabe'}</button>}
        </div>
      )}
      {verContexto && <pre style={{ margin: '0 14px 6px', padding: 8, maxHeight: 160, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 11, background: 'rgba(0,0,0,0.08)', borderRadius: 6 }}>{verContexto}</pre>}
      <div className="ei-opciones" style={{ paddingTop: 6, flexWrap: 'wrap' }}>
        <label title="El agente aplica la ficha de la marca (colores, tono, materiales y lo que hay que evitar) a todas sus ideas">🏷 Marca
          <select value={marcaId} onChange={e => { setMarcaId(e.target.value); setFicha(null); }} style={{ marginLeft: 4 }}>
            <option value="">Sin marca</option>
            {marcas.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </select>
        </label>
        <input ref={ficheroMarca} type="file" accept="application/pdf" hidden onChange={e => { subirMarca(e.target.files?.[0]); e.target.value = ''; }} />
        <button type="button" className="ei-btn" disabled={subiendoMarca} onClick={() => ficheroMarca.current?.click()} title="Sube el brandbook en PDF: se lee una vez y se guarda como ficha de la marca">{subiendoMarca ? 'Leyendo el brandbook…' : '＋ Añadir brandbook (PDF)'}</button>
        {marcaId && <input ref={ficheroLogo} type="file" accept="image/*" hidden onChange={e => { subirLogo(e.target.files?.[0]); e.target.value = ''; }} />}
        {marcaId && <button type="button" className="ei-btn" onClick={() => ficheroLogo.current?.click()} title="Sube el logo oficial (mejor PNG con fondo transparente): el agente lo usará tal cual, sin redibujarlo">{marcas.find(m => m.id === marcaId)?.logo ? '✓ Logo (cambiar)' : '＋ Logo oficial'}</button>}
        {marcaId && <button type="button" className="ei-btn" onClick={verFicha}>{ficha ? 'Ocultar ficha' : 'Ver ficha'}</button>}
        {marcaId && <button type="button" className="ei-btn" onClick={borrarMarca} title="Quita esta marca de la lista">🗑</button>}
        <label title="Antes de dibujar, el agente te hace 3-5 preguntas rápidas (dónde, qué, qué sensación…) para acertar a la primera"><input type="checkbox" checked={preguntarAntes} onChange={e => setPreguntarAntes(e.target.checked)} /> Preguntarme antes de dibujar</label>
        <label title="Sorpréndeme: 3 propuestas muy distintas, siempre dentro de la marca y sin tocar lo que ya está. Una sola: hace exactamente lo que pides">Modo
          <select value={modo} onChange={e => setModo(e.target.value)} style={{ marginLeft: 4 }}>
            <option value="sorprende">✨ Sorpréndeme (3 propuestas)</option>
            <option value="respetar">🎯 Una sola, exacta a lo que pido</option>
          </select>
        </label>
      </div>
      {ficha && <pre style={{ margin: '0 14px 6px', padding: 8, maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 11, background: 'rgba(0,0,0,0.08)', borderRadius: 6 }}><b>{ficha.nombre}</b>{'\n'}{ficha.texto}</pre>}
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
            {m.propuesta && <small className="ei-modelo" style={{ fontWeight: 700 }}>Propuesta {m.propuesta} de {m.de}</small>}
            {m.texto && (() => { const cu = m.rol === 'ia' && i === mensajes.length - 1 && !trabajando ? leerCuestionario(m.texto) : null; return cu ? <Cuestionario key={m.texto.length + '-' + i} cu={cu} onEnviar={enviar} /> : <p>{m.texto}</p>; })()}
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
            {m.propuesta && m.idResp && <button type="button" className="ei-btn" disabled={previo === m.idResp} onClick={() => setPrevio(m.idResp)} title="Sigue la conversación desde esta propuesta: lo que escribas ahora la retocará a ella">{previo === m.idResp ? '✓ Siguiendo con esta' : 'Seguir con esta idea'}</button>}
            {m.rol === 'ia' && m.modelo && <small className="ei-modelo">Hecho con {m.modelo}</small>}
          </div>
        ))}
        {trabajando && <div className="ei-msg ei-ia ei-pensando">ChatGPT está trabajando… {modo === 'sorprende' ? 'son 3 propuestas, pueden tardar dos o tres minutos.' : 'las imágenes pueden tardar un minuto o dos.'}</div>}
        {error && <div className="ei-error">{error}</div>}
        <div ref={fin} />
      </div>

      <div className="ei-atajos">
        {ATAJOS.map(a => { const t = typeof a === 'string' ? a : a.texto, so = typeof a !== 'string' && a.solo; return <button key={t} type="button" className="ei-chip" disabled={trabajando} onClick={() => enviar(t, so)}>{t}</button>; })}
      </div>

      {adjuntas.length > 0 && (
        <div className="ei-adj">
          {adjuntas.map((u, i) => (
            <span key={i} className="ei-mini"><img src={u} alt="" /><button type="button" onClick={() => setAdjuntas(a => a.filter((_, j) => j !== i))} title="Quitar">✕</button></span>
          ))}
        </div>
      )}

      <div className="ei-opciones">
        <label title="Genera solo el diseño, plano y a toda la imagen, sin pared ni habitación"><input type="checkbox" checked={soloDiseno} onChange={e => setSoloDiseno(e.target.checked)} /> Solo el diseño (sin pared ni entorno)</label>
        {soloDiseno && <label title="El diseño sale recortado, sin fondo (PNG transparente)"><input type="checkbox" checked={transparente} onChange={e => setTransparente(e.target.checked)} /> Sin fondo</label>}
        {soloDiseno && <label>Formato <select value={formato} onChange={e => setFormato(e.target.value)}><option value="auto">Automático</option><option value="vertical">Vertical</option><option value="horizontal">Horizontal</option><option value="cuadrado">Cuadrado</option></select></label>}
      </div>
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
