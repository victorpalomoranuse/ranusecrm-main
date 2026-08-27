import { useState, useEffect } from 'react';
import api from '../services/api';
import { CheckCircle, AlertCircle, Plus, X } from 'lucide-react';

const PHASE_LABELS = { 0: 'Diseño previo', 1: 'Planos generales', 2: 'Instalaciones', 3: 'Interiorismo y materialidad', 4: 'Renders', 5: 'Maquinaria y equipamiento', 6: 'Documentación de apoyo' };

function ChecklistTemplates() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState(0);
  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api.get('/phase-task-templates').then(r => setTemplates(r.data.templates || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setAdding(true);
    try {
      const { data } = await api.post('/phase-task-templates', { phase_number: phase, title });
      setTemplates(prev => [...prev, data.template]);
      setTitle('');
    } catch {} finally { setAdding(false); }
  };

  const handleDelete = async (id) => {
    try { await api.delete(`/phase-task-templates/${id}`); setTemplates(prev => prev.filter(t => t.id !== id)); } catch {}
  };

  if (loading) return <div className="ap-loading">Cargando…</div>;

  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '1.5rem', maxWidth: 560 }}>
      <p style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.3)', marginBottom: '0.5rem' }}>Checklist automática por fase</p>
      <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)', marginBottom: '1rem' }}>Estas tareas se crean solas en cada proyecto en cuanto entra en la fase correspondiente.</p>

      <form onSubmit={handleAdd} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <select className="ap-select" value={phase} onChange={e => setPhase(parseInt(e.target.value))} style={{ maxWidth: 220 }}>
          {[0,1,2,3,4,5,6].map(n => <option key={n} value={n}>{n} · {PHASE_LABELS[n]}</option>)}
        </select>
        <input className="ap-field-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Título de la tarea" style={{ flex: 1, minWidth: 160 }} />
        <button type="submit" className="ap-btn ap-btn-primary ap-btn-sm" disabled={adding || !title.trim()}><Plus size={13}/> Añadir</button>
      </form>

      {[0,1,2,3,4,5,6].map(n => {
        const items = templates.filter(t => t.phase_number === n);
        if (items.length === 0) return null;
        return (
          <div key={n} style={{ marginBottom: '1rem' }}>
            <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#beb0a2', marginBottom: '0.4rem' }}>{n} · {PHASE_LABELS[n]}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              {items.map(t => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '0.5rem 0.75rem' }}>
                  <span style={{ flex: 1, fontSize: '0.82rem', color: '#fff' }}>{t.title}</span>
                  <button onClick={() => handleDelete(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.25)' }}><X size={13}/></button>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {templates.length === 0 && <p className="ap-empty-sm">Sin plantillas todavía.</p>}
    </div>
  );
}

const QUESTION_TYPES = [
  { value: 'texto', label: 'Texto corto' },
  { value: 'texto_largo', label: 'Texto largo' },
  { value: 'numero', label: 'Número' },
  { value: 'si_no', label: 'Sí / No' },
  { value: 'opcion_unica', label: 'Opción única' },
  { value: 'opcion_multiple', label: 'Opción múltiple' },
  { value: 'estilo_imagenes', label: 'Elegir entre imágenes de Referencias' },
  { value: 'catalogo_productos', label: 'Elegir productos del catálogo' },
];

function NeedsFormQuestions() {
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [type, setType] = useState('texto');
  const [optionsText, setOptionsText] = useState('');
  const [section, setSection] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api.get('/needs-form/questions').then(r => setQuestions(r.data.questions || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const needsOptions = type === 'opcion_unica' || type === 'opcion_multiple';

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setAdding(true);
    try {
      const options = needsOptions ? optionsText.split(',').map(o => o.trim()).filter(Boolean) : [];
      const { data } = await api.post('/needs-form/questions', { question_text: text, question_type: type, options, section: section || null });
      setQuestions(prev => [...prev, data.question]);
      setText(''); setOptionsText(''); setSection('');
    } catch {} finally { setAdding(false); }
  };

  const handleDelete = async (id) => {
    try { await api.delete(`/needs-form/questions/${id}`); setQuestions(prev => prev.filter(q => q.id !== id)); } catch {}
  };

  if (loading) return <div className="ap-loading">Cargando…</div>;

  const sections = [];
  questions.forEach(q => {
    let sec = sections.find(s => s.name === (q.section || 'General'));
    if (!sec) { sec = { name: q.section || 'General', qs: [] }; sections.push(sec); }
    sec.qs.push(q);
  });

  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '1.5rem', maxWidth: 640 }}>
      <p style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.3)', marginBottom: '0.5rem' }}>Preguntas del Programa de Necesidades</p>
      <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)', marginBottom: '1rem' }}>Estas son las preguntas que verán tú (comercial) o el cliente al rellenar el programa de necesidades de un proyecto.</p>

      <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem', background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: 8 }}>
        <input className="ap-field-input" value={text} onChange={e => setText(e.target.value)} placeholder="Texto de la pregunta" />
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <select className="ap-select" value={type} onChange={e => setType(e.target.value)} style={{ maxWidth: 260 }}>
            {QUESTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <input className="ap-field-input" value={section} onChange={e => setSection(e.target.value)} placeholder="Sección (ej. Estilo y decoración)" style={{ flex: 1, minWidth: 160 }} />
        </div>
        {needsOptions && <input className="ap-field-input" value={optionsText} onChange={e => setOptionsText(e.target.value)} placeholder="Opciones separadas por coma" />}
        <button type="submit" className="ap-btn ap-btn-primary ap-btn-sm" style={{ alignSelf: 'flex-start' }} disabled={adding || !text.trim()}><Plus size={13}/> Añadir pregunta</button>
      </form>

      {sections.map(sec => (
        <div key={sec.name} style={{ marginBottom: '1rem' }}>
          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#beb0a2', marginBottom: '0.4rem' }}>{sec.name}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            {sec.qs.map(q => (
              <div key={q.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '0.5rem 0.75rem' }}>
                <span style={{ flex: 1, fontSize: '0.82rem', color: '#fff' }}>{q.question_text}</span>
                <span style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.35)' }}>{QUESTION_TYPES.find(t => t.value === q.question_type)?.label}</span>
                <button onClick={() => handleDelete(q.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.25)' }}><X size={13}/></button>
              </div>
            ))}
          </div>
        </div>
      ))}
      {questions.length === 0 && <p className="ap-empty-sm">Sin preguntas todavía.</p>}
    </div>
  );
}

export function SectionAjustes() {
  const [iban, setIban] = useState('');
  const [bankName, setBankName] = useState('');
  const [paymentMethods, setPaymentMethods] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    api.get('/settings').then(r => {
      const s = r.data.settings || {};
      setIban(s.bank_iban || '');
      setBankName(s.bank_name || '');
      setPaymentMethods(s.payment_methods || '');
      setPaymentNotes(s.payment_notes || '');
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put('/settings', { bank_iban: iban, bank_name: bankName, payment_methods: paymentMethods, payment_notes: paymentNotes });
      setMsg({ type: 'success', text: 'Ajustes guardados' });
    } catch {
      setMsg({ type: 'error', text: 'Error al guardar' });
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(null), 2500);
    }
  };

  return (
    <div className="ap-section">
      <div className="ap-section-head">
        <div><h1>Ajustes</h1><p>Configura los datos que aparecen en tus presupuestos.</p></div>
      </div>

      {loading ? <div className="ap-loading">Cargando…</div> : (
        <>
          <form onSubmit={handleSave} style={{ maxWidth: 560 }}>
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '1.5rem', marginBottom: '1.5rem' }}>
              <p style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.3)', marginBottom: '1.25rem' }}>Datos bancarios</p>
              <div className="ap-field">
                <label>Banco / Entidad</label>
                <input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="Ej: CaixaBank" />
              </div>
              <div className="ap-field">
                <label>IBAN</label>
                <input value={iban} onChange={e => setIban(e.target.value)} placeholder="ES00 0000 0000 0000 0000 0000" style={{ fontFamily: 'monospace', letterSpacing: '0.05em' }} />
              </div>
            </div>

            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '1.5rem', marginBottom: '1.5rem' }}>
              <p style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.3)', marginBottom: '1.25rem' }}>Métodos de pago</p>
              <div className="ap-field">
                <label>Métodos aceptados</label>
                <input value={paymentMethods} onChange={e => setPaymentMethods(e.target.value)} placeholder="Ej: Transferencia bancaria, Bizum" />
              </div>
              <div className="ap-field">
                <label>Notas adicionales <span className="ap-optional">(opcional)</span></label>
                <textarea value={paymentNotes} onChange={e => setPaymentNotes(e.target.value)} rows={3} placeholder="Ej: El pago se realizará en dos plazos: 50% al inicio y 50% a la entrega." />
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <button type="submit" className="ap-btn ap-btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar ajustes'}</button>
              {msg && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: msg.type === 'success' ? '#8bae8f' : '#ae8b8b' }}>
                  {msg.type === 'success' ? <CheckCircle size={14}/> : <AlertCircle size={14}/>}
                  {msg.text}
                </span>
              )}
            </div>
          </form>

          <div style={{ maxWidth: 560, marginTop: '1.5rem' }}>
            <ChecklistTemplates />
          </div>

          <div style={{ marginTop: '1.5rem' }}>
            <NeedsFormQuestions />
          </div>
        </>
      )}
    </div>
  );
}
