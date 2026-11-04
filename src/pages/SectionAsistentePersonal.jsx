import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { Trash2, Plus, Pencil, Check, X, FileText, Brain, Bell, MessageSquare, BookOpen } from 'lucide-react';

const card = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '0.85rem 1rem' };
const mut = { color: 'rgba(255,255,255,0.45)', fontSize: '0.78rem' };
const fmtCuando = (c) => { const [f, h] = String(c || '').split('T'); return (f || '').split('-').reverse().join('/') + (h ? ' · ' + h : ''); };

function Memoria() {
  const [hechos, setHechos] = useState(null), [nuevo, setNuevo] = useState(''), [edit, setEdit] = useState(null), [txt, setTxt] = useState(''), [error, setError] = useState('');
  const cargar = useCallback(() => api.get('/asistente-personal/memoria').then(r => setHechos(r.data.hechos || [])).catch(() => setError('No se ha podido cargar la memoria')), []);
  useEffect(() => { cargar(); }, [cargar]);
  const añadir = async (e) => { e.preventDefault(); if (!nuevo.trim()) return; try { await api.post('/asistente-personal/memoria', { texto: nuevo }); setNuevo(''); cargar(); } catch { setError('No se ha podido guardar'); } };
  const borrar = async (id) => { if (!window.confirm('¿Que el asistente se olvide de esto?')) return; try { await api.delete('/asistente-personal/memoria/' + id); cargar(); } catch { setError('No se ha podido borrar'); } };
  const guardar = async (id) => { try { await api.put('/asistente-personal/memoria/' + id, { texto: txt }); setEdit(null); cargar(); } catch { setError('No se ha podido guardar'); } };
  return (
    <div>
      <p style={{ ...mut, marginBottom: 12 }}>Lo que el asistente recuerda de ti, de tus clientes y de cómo trabajas. Lo va apuntando él solo cuando se lo cuentas por WhatsApp; aquí lo puedes corregir o borrar.</p>
      <form onSubmit={añadir} style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input className="ap-field-input" style={{ flex: 1 }} value={nuevo} onChange={e => setNuevo(e.target.value)} placeholder="Algo que quieres que recuerde…" />
        <button className="ap-btn ap-btn-primary ap-btn-sm" disabled={!nuevo.trim()}><Plus size={13} /> Añadir</button>
      </form>
      {error && <div className="ap-error" style={{ marginBottom: 10 }}>{error}</div>}
      {hechos === null ? <div className="ap-loading">Cargando…</div> : hechos.length === 0 ? <div style={mut}>Todavía no recuerda nada. Prueba a decirle por WhatsApp: "recuerda que…".</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {hechos.map(h => (
            <div key={h.id} style={{ ...card, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {edit === h.id ? <textarea className="ap-field-input" style={{ width: '100%', minHeight: 60 }} value={txt} onChange={e => setTxt(e.target.value)} /> : <div style={{ fontSize: '0.9rem', lineHeight: 1.4 }}>{h.texto}</div>}
                <div style={{ ...mut, marginTop: 4 }}>{h.etiqueta ? h.etiqueta + ' · ' : ''}{(h.fecha || '').split('-').reverse().join('/')}</div>
              </div>
              {edit === h.id
                ? <><button className="ap-btn ap-btn-primary ap-btn-sm" onClick={() => guardar(h.id)}><Check size={13} /></button><button className="ap-btn ap-btn-sm" onClick={() => setEdit(null)}><X size={13} /></button></>
                : <><button className="ap-btn ap-btn-sm" title="Editar" onClick={() => { setEdit(h.id); setTxt(h.texto); }}><Pencil size={13} /></button><button className="ap-btn ap-btn-sm" title="Borrar" onClick={() => borrar(h.id)}><Trash2 size={13} /></button></>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Recordatorios() {
  const [lista, setLista] = useState(null), [texto, setTexto] = useState(''), [fecha, setFecha] = useState(''), [hora, setHora] = useState('09:00'), [error, setError] = useState('');
  const cargar = useCallback(() => api.get('/asistente-personal/recordatorios').then(r => setLista(r.data.recordatorios || [])).catch(() => setError('No se han podido cargar')), []);
  useEffect(() => { cargar(); }, [cargar]);
  const añadir = async (e) => { e.preventDefault(); if (!texto.trim() || !fecha) return; try { await api.post('/asistente-personal/recordatorios', { texto, fecha, hora }); setTexto(''); cargar(); } catch (err) { setError(err.response?.data?.error || 'No se ha podido guardar'); } };
  const borrar = async (id) => { try { await api.delete('/asistente-personal/recordatorios/' + id); cargar(); } catch { setError('No se ha podido borrar'); } };
  return (
    <div>
      <p style={{ ...mut, marginBottom: 12 }}>Avisos que el asistente te manda por WhatsApp a la hora indicada. También los puedes crear hablándole: "recuérdame el viernes a las 10 llamar a Pablo".</p>
      <form onSubmit={añadir} style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <input className="ap-field-input" style={{ flex: 1, minWidth: 180 }} value={texto} onChange={e => setTexto(e.target.value)} placeholder="Qué quieres que te recuerde" />
        <input className="ap-field-input" type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
        <input className="ap-field-input" type="time" value={hora} onChange={e => setHora(e.target.value)} />
        <button className="ap-btn ap-btn-primary ap-btn-sm" disabled={!texto.trim() || !fecha}><Plus size={13} /> Programar</button>
      </form>
      {error && <div className="ap-error" style={{ marginBottom: 10 }}>{error}</div>}
      {lista === null ? <div className="ap-loading">Cargando…</div> : lista.length === 0 ? <div style={mut}>No hay recordatorios.</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {lista.map(r => (
            <div key={r.id} style={{ ...card, display: 'flex', gap: 10, alignItems: 'center', opacity: r.enviado ? 0.5 : 1 }}>
              <div style={{ flex: 1 }}><div style={{ fontSize: '0.9rem' }}>{r.texto}</div><div style={mut}>{fmtCuando(r.cuando)} · {r.enviado === true ? 'enviado' : r.enviado === 'caducado' ? 'caducado' : 'pendiente'}</div></div>
              <button className="ap-btn ap-btn-sm" title="Borrar" onClick={() => borrar(r.id)}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Diario() {
  const [lista, setLista] = useState(null);
  const cargar = useCallback(() => api.get('/asistente-personal/diario').then(r => setLista(r.data.entradas || [])).catch(() => setLista([])), []);
  useEffect(() => { cargar(); }, [cargar]);
  const borrar = async (id) => { if (!window.confirm('¿Borrar esta entrada del diario?')) return; try { await api.delete('/asistente-personal/diario/' + id); cargar(); } catch { /* sin cambios */ } };
  return (
    <div>
      <p style={{ ...mut, marginBottom: 12 }}>Lo que le cuentas al asistente que has hecho (por la noche te lo pregunta él). Con esto aprende cómo trabajas.</p>
      {lista === null ? <div className="ap-loading">Cargando…</div> : lista.length === 0 ? <div style={mut}>Todavía no hay entradas. Cuéntale por WhatsApp qué has hecho hoy.</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {lista.map(e => (
            <div key={e.id} style={{ ...card, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...mut, marginBottom: 4 }}>{(e.fecha || '').split('-').reverse().join('/')}{e.proyectos?.length ? ' · ' + e.proyectos.join(', ') : ''}</div>
                <div style={{ fontSize: '0.9rem', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>{e.resumen}</div>
                {e.logros?.length > 0 && <ul style={{ margin: '6px 0 0 16px', padding: 0, fontSize: '0.85rem' }}>{e.logros.map((l, i) => <li key={i}>{l}</li>)}</ul>}
              </div>
              <button className="ap-btn ap-btn-sm" title="Borrar" onClick={() => borrar(e.id)}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Informes() {
  const [lista, setLista] = useState(null);
  useEffect(() => { api.get('/asistente-personal/informes').then(r => setLista(r.data.informes || [])).catch(() => setLista([])); }, []);
  return (
    <div>
      <p style={{ ...mut, marginBottom: 12 }}>PDFs que el asistente te ha preparado sin ligarlos a un proyecto. Los que son de un proyecto están en los Documentos de ese proyecto.</p>
      {lista === null ? <div className="ap-loading">Cargando…</div> : lista.length === 0 ? <div style={mut}>Todavía no hay informes. Pídele uno por WhatsApp: "hazme un informe del estado de los proyectos".</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {lista.map(i => <a key={i.url} href={i.url} target="_blank" rel="noreferrer" style={{ ...card, display: 'flex', gap: 10, alignItems: 'center', color: 'inherit', textDecoration: 'none' }}><FileText size={16} /><span style={{ flex: 1 }}>{i.nombre}</span><span style={mut}>{(i.fecha || '').slice(0, 10).split('-').reverse().join('/')}</span></a>)}
        </div>
      )}
    </div>
  );
}

function Conversacion() {
  const [m, setM] = useState(null);
  useEffect(() => { api.get('/asistente-personal/conversacion').then(r => setM(r.data.mensajes || [])).catch(() => setM([])); }, []);
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <p style={{ ...mut, flex: 1, minWidth: 200, margin: 0 }}>Lo último que habéis hablado. Los temas personales no salen aquí. Borrar la conversación no borra su memoria (eso se hace en la pestaña Memoria).</p>
        <button className="ap-btn ap-btn-sm" disabled={!m?.length} onClick={async () => { if (!window.confirm('¿Borrar la conversación? La memoria se mantiene.')) return; try { await api.delete('/asistente-personal/conversacion'); setM([]); } catch { /* sin cambios */ } }}><Trash2 size={13} /> Borrar conversación</button>
      </div>
      {m === null ? <div className="ap-loading">Cargando…</div> : m.length === 0 ? <div style={mut}>Todavía no habéis hablado.</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {m.map((x, i) => <div key={i} style={{ ...card, alignSelf: x.rol === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%', background: x.rol === 'user' ? 'rgba(190,176,162,0.12)' : card.background }}><div style={{ ...mut, marginBottom: 3 }}>{x.rol === 'user' ? 'Tú' : 'Asistente'} · {x.canal}</div><div style={{ fontSize: '0.88rem', whiteSpace: 'pre-wrap' }}>{x.texto}</div></div>)}
        </div>
      )}
    </div>
  );
}

const PESTANAS = [['memoria', 'Memoria', Brain], ['recordatorios', 'Recordatorios', Bell], ['diario', 'Diario', BookOpen], ['informes', 'Informes', FileText], ['conversacion', 'Conversación', MessageSquare]];
export function SectionAsistentePersonal() {
  const [tab, setTab] = useState('memoria');
  return (
    <div style={{ maxWidth: 820 }}>
      <h1 className="ap-page-title" style={{ marginBottom: 6 }}>Asistente personal</h1>
      <p style={{ ...mut, marginBottom: 16 }}>Tu asistente de WhatsApp. Aquí ves y corriges lo que sabe de ti, sus avisos y lo que te ha preparado. Las fotos, notas y documentos que le mandas van directos al proyecto que toque (Documentos, Programa de necesidades, Renders) y a Referencias.</p>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {PESTANAS.map(([id, nombre, Icono]) => <button key={id} className={'ap-btn ap-btn-sm' + (tab === id ? ' ap-btn-primary' : '')} onClick={() => setTab(id)}><Icono size={13} /> {nombre}</button>)}
      </div>
      {tab === 'memoria' && <Memoria />}{tab === 'recordatorios' && <Recordatorios />}{tab === 'diario' && <Diario />}{tab === 'informes' && <Informes />}{tab === 'conversacion' && <Conversacion />}
    </div>
  );
}
