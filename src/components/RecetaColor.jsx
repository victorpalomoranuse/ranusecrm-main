import { useState, useEffect } from 'react';
import { Plus, X } from 'lucide-react';

// Editor por piezas de la "receta de color" que genera el Combinador:
//   Título
//   60% Gris Grafito (NCS S 8500-N): las paredes y el techo
//   ...
//   Suelo: Carbon Black, loseta de caucho 100 x 100
//   - Consejo: texto
// Cambia un color, un porcentaje, el código NCS, dónde se usa, el suelo o un
// consejo sin rehacer nada. Al guardar, regenera el texto de la descripción y
// la paleta (los colores van en el mismo orden que las filas, y el último es
// el del suelo). Si el texto no tiene este formato, no se muestra.

const HEX = /^#[0-9a-fA-F]{6}$/;
const RE_COLOR = /^(\d+(?:[.,]\d+)?)\s*%\s*(.+?)\s*(?:\(\s*NCS\s*([^)]*)\))?\s*:\s*(.*)$/i;
const RE_SUELO = /^Suelo\s*:\s*(.*)$/i;
const RE_CONSEJO = /^[-–•]\s*(.+?)\s*:\s*(.*)$/;

export function parseReceta(texto) {
  const lineas = String(texto || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const r = { titulo: '', filas: [], suelo: null, consejos: [], extras: [] };
  lineas.forEach((l, i) => {
    let m;
    if ((m = RE_COLOR.exec(l))) r.filas.push({ pct: m[1].replace(',', '.'), nombre: m[2].trim(), ncs: (m[3] || '').trim(), donde: m[4].trim() });
    else if ((m = RE_SUELO.exec(l))) r.suelo = m[1].trim();
    else if ((m = RE_CONSEJO.exec(l))) r.consejos.push({ titulo: m[1].trim(), texto: m[2].trim() });
    else if (i === 0) r.titulo = l;
    else r.extras.push(l);
  });
  return r;
}

export function serializarReceta({ titulo, filas, suelo, consejos, extras }) {
  const out = [];
  if (titulo?.trim()) out.push(titulo.trim());
  filas.forEach(f => out.push(`${String(f.pct).trim()}% ${f.nombre.trim()}${f.ncs?.trim() ? ` (NCS ${f.ncs.trim()})` : ''}: ${f.donde.trim()}`));
  if (suelo !== null && suelo !== undefined && suelo.trim()) out.push(`Suelo: ${suelo.trim()}`);
  consejos.forEach(c => { if (c.titulo.trim()) out.push(`- ${c.titulo.trim()}: ${c.texto.trim()}`); });
  (extras || []).forEach(e => out.push(e));
  return out.join('\n');
}

const box = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '0.9rem 1rem', marginBottom: '1.25rem' };
const muted = { fontSize: '0.72rem', color: 'rgba(255,255,255,0.45)' };
const row = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' };

function Color({ valor, onChange }) {
  return (
    <label style={{ width: 34, height: 34, borderRadius: '50%', background: HEX.test(valor) ? valor : '#beb0a2', border: '1px solid rgba(255,255,255,0.3)', cursor: 'pointer', flex: 'none', display: 'inline-block', overflow: 'hidden' }} title="Cambiar este color">
      <input type="color" value={HEX.test(valor) ? valor : '#beb0a2'} onChange={e => onChange(e.target.value)} style={{ opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
    </label>
  );
}

export function RecetaColor({ description, palette, onGuardar }) {
  const [datos, setDatos] = useState(null);
  const [colores, setColores] = useState([]);
  const [sueloHex, setSueloHex] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const p = parseReceta(description);
    if (!p.filas.length) { setDatos(null); return; }
    setDatos(p);
    const pal = Array.isArray(palette) ? palette : [];
    setColores(p.filas.map((_, i) => pal[i] || '#beb0a2'));
    setSueloHex(p.suelo !== null ? (pal[p.filas.length] || '') : '');
  }, [description, palette]);

  if (!datos) return null;

  const setFila = (i, campo, valor) => setDatos(d => ({ ...d, filas: d.filas.map((f, k) => (k === i ? { ...f, [campo]: valor } : f)) }));
  const quitarFila = (i) => { setDatos(d => ({ ...d, filas: d.filas.filter((_, k) => k !== i) })); setColores(c => c.filter((_, k) => k !== i)); };
  const anadirFila = () => { setDatos(d => ({ ...d, filas: [...d.filas, { pct: '', nombre: '', ncs: '', donde: '' }] })); setColores(c => [...c, '#beb0a2']); };
  const setConsejo = (i, campo, valor) => setDatos(d => ({ ...d, consejos: d.consejos.map((c, k) => (k === i ? { ...c, [campo]: valor } : c)) }));
  const suma = datos.filas.reduce((s, f) => s + (parseFloat(f.pct) || 0), 0);

  const guardar = async () => {
    setGuardando(true); setMsg('');
    try {
      const nuevaDescripcion = serializarReceta(datos);
      const nuevaPaleta = [...colores, ...(datos.suelo !== null && sueloHex ? [sueloHex] : [])].filter(h => HEX.test(h));
      await onGuardar(nuevaDescripcion, nuevaPaleta);
      setMsg('Receta guardada: texto y paleta actualizados');
      setTimeout(() => setMsg(''), 3500);
    } catch { setMsg('No se pudo guardar la receta'); }
    finally { setGuardando(false); }
  };

  return (
    <div style={box}>
      <strong style={{ fontSize: '0.9rem' }}>Receta de color (edición por piezas)</strong>
      <p style={{ ...muted, margin: '4px 0 10px' }}>Cambia un color, su porcentaje, el código NCS, dónde se usa, el suelo o un consejo sin rehacer la combinación. Al guardar se actualizan el texto y la paleta de abajo, y el portal y el PDF del cliente.</p>

      <div className="ap-field" style={{ marginBottom: 10 }}>
        <label>Título</label>
        <input className="ap-field-input" value={datos.titulo} onChange={e => setDatos(d => ({ ...d, titulo: e.target.value }))} placeholder="Sobrio · Gris Grafito" />
      </div>

      {datos.filas.map((f, i) => (
        <div key={i} style={{ ...row, alignItems: 'flex-start', padding: '8px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <Color valor={colores[i]} onChange={h => setColores(c => c.map((x, k) => (k === i ? h : x)))} />
          <input className="ap-field-input" type="number" min="0" max="100" value={f.pct} onChange={e => setFila(i, 'pct', e.target.value)} style={{ width: 64 }} title="Porcentaje" />
          <span style={muted}>%</span>
          <input className="ap-field-input" value={f.nombre} onChange={e => setFila(i, 'nombre', e.target.value)} placeholder="Nombre del color" style={{ flex: '1 1 150px' }} />
          <input className="ap-field-input" value={f.ncs} onChange={e => setFila(i, 'ncs', e.target.value)} placeholder="NCS S 8500-N" style={{ width: 130 }} title="Código NCS" />
          <input className="ap-field-input" value={f.donde} onChange={e => setFila(i, 'donde', e.target.value)} placeholder="Dónde va: las paredes y el techo" style={{ flex: '1 1 100%' }} />
          <button type="button" className="ap-btn ap-btn-ghost ap-btn-xs" onClick={() => quitarFila(i)}><X size={11} /> Quitar</button>
        </div>
      ))}
      <div style={{ ...row, marginTop: 6 }}>
        <button type="button" className="ap-btn ap-btn-ghost ap-btn-xs" onClick={anadirFila}><Plus size={11} /> Añadir color</button>
        <span style={{ ...muted, color: Math.abs(suma - 100) > 0.5 ? '#f5b748' : 'rgba(255,255,255,0.45)' }}>Los porcentajes suman {suma}%{Math.abs(suma - 100) > 0.5 ? ' (lo normal es 100)' : ''}</span>
      </div>

      {datos.suelo !== null && (
        <div style={{ ...row, marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <Color valor={sueloHex} onChange={setSueloHex} />
          <strong style={{ fontSize: '0.82rem' }}>Suelo</strong>
          <input className="ap-field-input" value={datos.suelo} onChange={e => setDatos(d => ({ ...d, suelo: e.target.value }))} style={{ flex: 1, minWidth: 200 }} placeholder="Carbon Black, loseta de caucho 100 x 100" />
        </div>
      )}

      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <strong style={{ fontSize: '0.82rem' }}>Consejos</strong>
        {datos.consejos.map((c, i) => (
          <div key={i} style={{ ...row, alignItems: 'flex-start', marginTop: 8 }}>
            <input className="ap-field-input" value={c.titulo} onChange={e => setConsejo(i, 'titulo', e.target.value)} placeholder="Título del consejo" style={{ width: 220 }} />
            <textarea className="ap-field-input" value={c.texto} onChange={e => setConsejo(i, 'texto', e.target.value)} rows={2} placeholder="Texto del consejo" style={{ flex: '1 1 260px' }} />
            <button type="button" className="ap-btn ap-btn-ghost ap-btn-xs" onClick={() => setDatos(d => ({ ...d, consejos: d.consejos.filter((_, k) => k !== i) }))}><X size={11} /> Quitar</button>
          </div>
        ))}
        <button type="button" className="ap-btn ap-btn-ghost ap-btn-xs" style={{ marginTop: 8 }} onClick={() => setDatos(d => ({ ...d, consejos: [...d.consejos, { titulo: '', texto: '' }] }))}><Plus size={11} /> Añadir consejo</button>
      </div>

      <div style={{ ...row, marginTop: 14 }}>
        <button type="button" className="ap-btn ap-btn-primary ap-btn-sm" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar receta'}</button>
        {msg && <span style={{ fontSize: '0.78rem', color: '#8bae8f' }}>{msg}</span>}
      </div>
    </div>
  );
}
