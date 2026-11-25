import { useState } from 'react';
import api from '../services/api';

const fallo = e => e.response?.data?.error || e.message || 'No se pudo completar';
const POR_DEFECTO = { intro: '¿y si sale mal?', reveal: '¿y si sale bien?', cta: 'sígueme para más proyectos de gym', handle: '' };

// Reel "Antes y después": 1 clip de antes + clips del resultado + canción. El trabajador corta al ritmo, elige los tramos
// donde la cámara va más fluida, pone los textos y cierra con la pastilla de "Seguir".
export function AntesDespues({ subirArchivo, onCreado }) {
  const [antes, setAntes] = useState(null), [despues, setDespues] = useState([]), [cancion, setCancion] = useState(null);
  const [textos, setTextos] = useState(POR_DEFECTO), [inicio, setInicio] = useState(0), [posX, setPosX] = useState(50);
  const [ocupado, setOcupado] = useState(false), [progreso, setProgreso] = useState(''), [error, setError] = useState('');
  const campo = (k, v) => setTextos(t => ({ ...t, [k]: v }));
  const mover = (i, d) => setDespues(l => { const n = [...l], j = i + d; if (j < 0 || j >= n.length) return l; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const quitar = i => setDespues(l => l.filter((_, k) => k !== i));
  const listo = antes && despues.length && cancion && !ocupado;

  async function crear(e) {
    e.preventDefault(); if (!listo) return;
    setOcupado(true); setError('');
    try {
      const sube = async (f, etiqueta) => ({ nombre: f.name, archivo: await subirArchivo(f, n => setProgreso(etiqueta + ' · ' + n + '%')) });
      const a = await sube(antes, 'Clip de antes');
      const d = []; for (const [i, f] of despues.entries()) d.push(await sube(f, 'Resultado ' + (i + 1) + ' de ' + despues.length));
      setProgreso('Subiendo la canción…'); const c = await subirArchivo(cancion, n => setProgreso('Canción · ' + n + '%'));
      setProgreso('Creando el reel…');
      await api.post('/estudio-video/reveal', { nombre: antes.name, antes: a, despues: d, cancion: c, textos, ajustes: { antes_inicio: Number(inicio) || 0, antes_x: Number(posX) } });
      setAntes(null); setDespues([]); setCancion(null); onCreado && onCreado();
    } catch (er) { setError(fallo(er)); } finally { setOcupado(false); setProgreso(''); }
  }

  return <form className="rd-card" onSubmit={crear} style={{ display: 'grid', gap: 16, marginTop: 16 }}>
    <h2 style={{ margin: 0 }}>Reel antes y después</h2>
    <p style={{ margin: 0 }}>Un clip del antes, los clips del resultado y una canción. Se corta al ritmo, se eligen los tramos donde la cámara va más fluida y se añaden los textos y el cierre.</p>
    <label>1. Clip del antes<input type="file" accept="video/*" disabled={ocupado} onChange={e => setAntes(e.target.files?.[0] || null)} style={{ display: 'block', marginTop: 8 }} /></label>
    <label>2. Clips del resultado (puedes elegir varios)<input type="file" accept="video/*" multiple disabled={ocupado} onChange={e => setDespues(Array.from(e.target.files || []))} style={{ display: 'block', marginTop: 8 }} /></label>
    {despues.length > 0 && <ol style={{ margin: 0, paddingLeft: 20 }}>{despues.map((f, i) => <li key={f.name + i}>{f.name}
      <button type="button" className="rd-btn" disabled={ocupado || i === 0} onClick={() => mover(i, -1)} aria-label={'Subir ' + f.name}>↑</button>
      <button type="button" className="rd-btn" disabled={ocupado || i === despues.length - 1} onClick={() => mover(i, 1)} aria-label={'Bajar ' + f.name}>↓</button>
      <button type="button" className="rd-btn" disabled={ocupado} onClick={() => quitar(i)} aria-label={'Quitar ' + f.name}>✕</button></li>)}</ol>}
    <label>3. Canción<input type="file" accept="audio/*,video/mp4" disabled={ocupado} onChange={e => setCancion(e.target.files?.[0] || null)} style={{ display: 'block', marginTop: 8 }} /></label>
    <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 10 }} disabled={ocupado}>
      <legend>4. Textos (déjalos vacíos para no poner)</legend>
      <label>Texto del antes<input className="ap-input" value={textos.intro} maxLength={60} onChange={e => campo('intro', e.target.value)} style={{ display: 'block', width: '100%' }} /></label>
      <label>Texto del resultado<input className="ap-input" value={textos.reveal} maxLength={60} onChange={e => campo('reveal', e.target.value)} style={{ display: 'block', width: '100%' }} /></label>
      <label>Frase final<input className="ap-input" value={textos.cta} maxLength={80} onChange={e => campo('cta', e.target.value)} style={{ display: 'block', width: '100%' }} /></label>
      <label>Usuario de Instagram (sin @) para la pastilla de «Seguir»<input className="ap-input" value={textos.handle} maxLength={30} placeholder="victoreldisenador" onChange={e => campo('handle', e.target.value)} style={{ display: 'block', width: '100%' }} /></label>
    </fieldset>
    <details>
      <summary>Ajustes del clip del antes</summary>
      <label style={{ display: 'block', marginTop: 8 }}>Empezar en el segundo<input type="number" min="0" step="0.5" className="ap-input" value={inicio} disabled={ocupado} onChange={e => setInicio(e.target.value)} /></label>
      <label style={{ display: 'block', marginTop: 8 }}>Dónde centrar el encuadre vertical (0 = izquierda, 100 = derecha)<input type="range" min="0" max="100" value={posX} disabled={ocupado} onChange={e => setPosX(e.target.value)} style={{ display: 'block', width: '100%' }} /></label>
    </details>
    <button className="rd-btn pri" disabled={!listo}>{ocupado ? progreso || 'Preparando…' : 'Crear el reel'}</button>
    {error && <p role="alert">{error}</p>}
  </form>;
}
