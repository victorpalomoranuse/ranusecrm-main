import { useState, useEffect, useRef } from 'react';
import { BookOpen, Upload, Trash2 } from 'lucide-react';
import api from '../services/api';

// Biblioteca de conocimiento de las IA (Ajustes): PDFs que las IA consultan
// cuando una pregunta lo necesita. No "memorizan" los PDFs: buscan los
// fragmentos relevantes en cada pregunta, como con unos apuntes.

const ASISTENTES = [
  { id: 'presupuestos', label: 'Asistente IA (presupuestos)' },
  { id: 'proyecto', label: 'Asistente de diseño (proyectos)' },
];
const box = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '1.5rem' };
const muted = { fontSize: '0.78rem', color: 'rgba(255,255,255,0.45)' };

export function BibliotecaConocimiento() {
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState('');
  const [subiendo, setSubiendo] = useState('');
  const [asist, setAsist] = useState(['presupuestos', 'proyecto']);
  const fileRef = useRef(null);

  const cargar = () => api.get('/conocimiento/docs').then(r => { setDocs(r.data.docs || []); setError(''); }).catch(e => setError(e.response?.data?.error || 'No se pudo cargar la biblioteca'));
  useEffect(() => { cargar(); }, []);

  const subir = async (e) => {
    const files = [...(e.target.files || [])];
    if (!files.length) return;
    setError('');
    for (let i = 0; i < files.length; i++) {
      setSubiendo(`Añadiendo ${i + 1} de ${files.length}: ${files[i].name}…`);
      try {
        const form = new FormData(); form.append('file', files[i]); form.append('asistentes', asist.join(','));
        await api.post('/conocimiento/docs', form);
      } catch (err) { setError(`${files[i].name}: ${err.response?.data?.error || 'no se ha podido añadir'}`); }
    }
    setSubiendo(''); if (fileRef.current) fileRef.current.value = '';
    cargar();
  };

  const cambiarAsistente = async (doc, id) => {
    const nuevos = doc.asistentes.includes(id) ? doc.asistentes.filter(a => a !== id) : [...doc.asistentes, id];
    try { await api.put(`/conocimiento/docs/${doc.id}`, { asistentes: nuevos }); setDocs(d => d.map(x => (x.id === doc.id ? { ...x, asistentes: nuevos } : x))); }
    catch { setError('No se pudo cambiar'); }
  };
  const borrar = async (doc) => {
    if (!window.confirm(`¿Quitar "${doc.titulo}" de la biblioteca?`)) return;
    try { await api.delete(`/conocimiento/docs/${doc.id}`); setDocs(d => d.filter(x => x.id !== doc.id)); } catch { setError('No se pudo borrar'); }
  };

  const total = (docs || []).reduce((s, d) => s + (d.num_fragmentos || 0), 0);

  return (
    <div style={box}>
      <p style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.3)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: 6 }}><BookOpen size={13} /> Biblioteca de conocimiento de las IA</p>
      <p style={{ ...muted, marginBottom: '1rem' }}>
        Sube PDFs (apuntes del curso, normativa, guías…) y las IA los consultan cuando una pregunta lo necesita, citando de qué documento sale. No hace falta "entrenarlas": buscan en estos apuntes igual que lo harías tú.
        Solo se lee el texto del PDF (los escaneos que son imágenes no sirven).
      </p>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <span style={muted}>Para que los usen:</span>
        {ASISTENTES.map(a => (
          <label key={a.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.82rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={asist.includes(a.id)} onChange={() => setAsist(s => (s.includes(a.id) ? s.filter(x => x !== a.id) : [...s, a.id]))} /> {a.label}
          </label>
        ))}
      </div>
      <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple style={{ display: 'none' }} onChange={subir} />
      <button type="button" className="ap-btn ap-btn-primary ap-btn-sm" disabled={!!subiendo || !asist.length} onClick={() => fileRef.current?.click()}>
        <Upload size={13} /> {subiendo || 'Añadir PDFs'}
      </button>
      {error && <p className="ap-error" style={{ marginTop: 8 }}>{error}</p>}

      <div style={{ marginTop: 16 }}>
        {docs === null && !error && <p style={muted}>Cargando…</p>}
        {docs && docs.length === 0 && <p style={muted}>Todavía no hay documentos.</p>}
        {docs && docs.length > 0 && <p style={{ ...muted, marginBottom: 6 }}>{docs.length} documentos · {total} fragmentos de texto</p>}
        {(docs || []).map(d => (
          <div key={d.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '10px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.88rem' }}>{d.titulo}</div>
                <div style={muted}>{d.num_paginas} págs · {d.num_fragmentos} fragmentos</div>
              </div>
              <button type="button" className="ap-btn-icon" title="Quitar de la biblioteca" onClick={() => borrar(d)}><Trash2 size={13} /></button>
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 6 }}>
              {ASISTENTES.map(a => (
                <label key={a.id} style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: '0.74rem', cursor: 'pointer', color: 'rgba(255,255,255,0.6)' }}>
                  <input type="checkbox" checked={d.asistentes.includes(a.id)} onChange={() => cambiarAsistente(d, a.id)} /> {a.label}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
