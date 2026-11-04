import { useState, useRef, useEffect, useMemo } from 'react';
import api from '../services/api';
import { Send as SendIcon, Ruler, Printer, Download, RotateCcw, AlertTriangle, Copy, History } from 'lucide-react';
import { MicButton } from '../components/MicButton';
import { alzadoSVG, imprimirAlzado, descargarSVG, descargarPNG } from '../utils/alzado';
import './SectionAsistenteIA.css';

const EJEMPLOS = [
  'Alzado de una pared de 4 m de ancho por 3 m de alto, con un mueble a medida de 90 cm de altura y 4 módulos pegados a la derecha. Quito 30 cm a la izquierda; proponme tú las medidas de los módulos.',
  'Alzado de 3,20 × 2,60 con una ventana de 120 × 100 a 90 del suelo y un mueble bajo de 4 cajones',
];
const KEY = 'asistente-diseno-v2';
const leer = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const selStyle = { background: '#1b1b1f', color: '#fff', colorScheme: 'dark', border: '1px solid rgba(255,255,255,0.22)', borderRadius: 8, padding: '0.4rem 0.5rem', fontSize: '0.8rem', maxWidth: 280 };

export function SectionAsistenteDiseno() {
  const ini = useMemo(leer, []);
  const [messages, setMessages] = useState(ini.messages || []);
  const [spec, setSpec] = useState(ini.spec || null);
  const [avisos, setAvisos] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [proyectos, setProyectos] = useState([]);
  const [pid, setPid] = useState(ini.pid || '');
  const [laminas, setLaminas] = useState([]);
  const [lid, setLid] = useState(ini.lid || '');
  const [versiones, setVersiones] = useState([]);
  const [verV, setVerV] = useState(null); // versión que se está mirando (null = la actual)
  const [aviso, setAviso] = useState('');
  const [todos, setTodos] = useState(false); // false = solo los proyectos en marcha
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);
  // Con proyecto elegido, lo guarda el servidor; sin proyecto, solo se recuerda aquí en el navegador
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify({ pid, lid, messages: pid ? [] : messages, spec: pid ? null : spec })); } catch { /* sin almacenamiento */ } }, [messages, spec, pid, lid]);
  useEffect(() => { api.get('/client-projects').then(r => setProyectos(r.data.projects || [])).catch(() => {}); }, []);

  const aplicaLamina = (l) => {
    setLid(l?.id || ''); setMessages(l?.mensajes || []); setVersiones(l?.versiones || []); setVerV(null); setAvisos([]);
    setSpec(l?.versiones?.length ? l.versiones[l.versiones.length - 1].spec : null);
  };
  const cargaLaminas = async (p, elegir) => {
    if (!p) { setLaminas([]); return; }
    try {
      const { data } = await api.get('/asistente-diseno/proyecto/' + p); setLaminas(data.laminas || []);
      const id = elegir || data.laminas?.[0]?.id;
      if (id) { const { data: d } = await api.get('/asistente-diseno/proyecto/' + p + '/lamina/' + id); aplicaLamina(d.lamina); } else aplicaLamina(null);
    } catch (e) { setError(e.response?.data?.error || 'No he podido cargar lo guardado de este proyecto.'); }
  };
  const refresca = async (p, id) => {
    try {
      const [a, b] = await Promise.all([api.get('/asistente-diseno/proyecto/' + p), api.get('/asistente-diseno/proyecto/' + p + '/lamina/' + id)]);
      setLaminas(a.data.laminas || []); setVersiones(b.data.lamina.versiones || []);
    } catch { /* no pasa nada */ }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (pid) cargaLaminas(pid, ini.lid || null); }, []);
  const cambiaProyecto = (p) => { setPid(p); setError(''); setAviso(''); setMessages([]); setSpec(null); setVersiones([]); setLid(''); setVerV(null); setLaminas([]); if (p) cargaLaminas(p); };

  const hoy = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const vista = verV ? versiones.find(v => v.v === verV)?.spec : spec;
  const svg = useMemo(() => (vista ? alzadoSVG(vista, { fecha: hoy }) : ''), [vista, hoy]);
  const nombre = vista?.titulo || 'alzado';

  const send = async (text) => {
    const t = (text ?? input).trim();
    if (!t || loading) return;
    setError(''); setAviso('');
    const next = [...messages, { role: 'user', content: t }];
    setMessages(next); setInput(''); setLoading(true);
    try {
      const { data } = await api.post('/asistente-diseno/chat', { messages: next.map(m => ({ role: m.role, content: m.content })), spec, proyectoId: pid || null, laminaId: lid || null });
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
      if (data.spec) setSpec(data.spec);
      setAvisos(data.avisos || []); setVerV(null);
      if (data.guardadoError) setError('No se ha podido guardar en el proyecto: ' + data.guardadoError + ' (la lámina sigue aquí en pantalla).');
      if (data.guardado) { setLid(data.guardado.laminaId); setAviso('Guardado en el proyecto · versión ' + data.guardado.versiones); refresca(pid, data.guardado.laminaId); }
    } catch (e) {
      setError(e.response?.data?.error || 'No he podido consultar al asistente.');
    } finally { setLoading(false); }
  };

  const nueva = () => {
    if (!pid && messages.length && !window.confirm('Sin proyecto elegido esto no se guarda. ¿Empezar una lámina nueva y perder la actual?')) return;
    setMessages([]); setSpec(null); setAvisos([]); setError(''); setLid(''); setVersiones([]); setVerV(null); setAviso('');
  };
  const duplicar = async () => {
    if (!pid || !lid) return; setError('');
    try { const { data } = await api.post('/asistente-diseno/proyecto/' + pid + '/lamina/' + lid + '/duplicar'); await cargaLaminas(pid, data.lamina.id); setAviso('Copia creada: prueba cambios sin tocar la original.'); }
    catch (e) { setError(e.response?.data?.error || 'No se ha podido duplicar.'); }
  };
  const recuperar = async () => {
    if (!verV) return; setError('');
    try { const { data } = await api.post('/asistente-diseno/proyecto/' + pid + '/lamina/' + lid + '/restaurar', { v: verV }); const v = verV; aplicaLamina(data.lamina); refresca(pid, lid); setAviso('Versión ' + v + ' recuperada como versión nueva.'); }
    catch (e) { setError(e.response?.data?.error || 'No se ha podido recuperar.'); }
  };
  const abreLamina = async (id) => {
    setVerV(null); setError('');
    try { const { data } = await api.get('/asistente-diseno/proyecto/' + pid + '/lamina/' + id); aplicaLamina(data.lamina); } catch { setError('No he podido abrir esa lámina.'); }
  };

  return (
    <div className="ap-section">
      <div className="ap-section-head">
        <div>
          <h1><Ruler size={20} style={{ verticalAlign: -3, marginRight: 6 }} />Asistente de diseño</h1>
          <p>Cuéntale la pared y el mueble y te va dibujando el alzado con sus cotas. Pídele cambios hasta que te guste y descárgalo en PDF.</p>
        </div>
        <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={nueva}><RotateCcw size={13} /> Nueva lámina</button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '0 0 12px' }}>
        <select style={selStyle} value={pid} onChange={e => cambiaProyecto(e.target.value)}>
          <option value="" style={{ background: '#1b1b1f', color: '#fff' }}>Sin proyecto (no se guarda)</option>
          {proyectos.filter(p => todos || p.id === pid || (p.status === 'en_marcha' && p.active !== false)).map(p => <option key={p.id} value={p.id} style={{ background: '#1b1b1f', color: '#fff' }}>{[p.client_name, p.project_name].filter(Boolean).join(' · ') || p.id}</option>)}
        </select>
        <label style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.6)', display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}><input type="checkbox" checked={todos} onChange={e => setTodos(e.target.checked)} /> Ver también terminados</label>
        {pid && laminas.length > 0 && (
          <select style={selStyle} value={lid} onChange={e => abreLamina(e.target.value)}>
            {!lid && <option value="">Lámina nueva (sin guardar aún)</option>}
            {laminas.map(l => <option key={l.id} value={l.id}>{l.titulo || 'Alzado'} · {l.versiones} versión(es)</option>)}
          </select>
        )}
        {pid && lid && <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={duplicar} title="Crea una copia para probar cambios sin tocar la original"><Copy size={13} /> Duplicar</button>}
        {pid && versiones.length > 1 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <History size={14} style={{ opacity: 0.6 }} />
            <select style={selStyle} value={verV || ''} onChange={e => setVerV(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Versión actual (V{versiones[versiones.length - 1].v})</option>
              {[...versiones].reverse().slice(1).map(v => <option key={v.v} value={v.v}>V{v.v} · {new Date(v.ts).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {v.resumen}</option>)}
            </select>
          </span>
        )}
        <span style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.45)' }}>
          {pid ? (aviso || 'Lo que hables se guarda en este proyecto y cada cambio es una versión nueva: nunca se pisa nada.') : 'Elige un proyecto para que se guarde la conversación y las láminas.'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 400px) minmax(0, 1fr)', gap: 14, alignItems: 'stretch' }} className="dis-grid">
        <div className="ai-chat" style={{ minHeight: 480, maxHeight: 'calc(100vh - 230px)' }}>
          <div className="ai-chat-body">
            {messages.length === 0 ? (
              <div className="ai-chat-empty">
                <p>Prueba con algo como:</p>
                <div className="ai-chat-examples">
                  {EJEMPLOS.map(ej => <button key={ej} type="button" className="ap-btn ap-btn-ghost ap-btn-sm" style={{ textAlign: 'left', whiteSpace: 'normal' }} onClick={() => send(ej)}>{ej}</button>)}
                </div>
              </div>
            ) : messages.map((m, i) => (
              <div key={i} className={`ai-msg ai-msg--${m.role}`}><div className="ai-msg-bubble"><span style={{ whiteSpace: 'pre-wrap' }}>{m.content}</span></div></div>
            ))}
            {loading && <div className="ai-msg ai-msg--assistant"><div className="ai-msg-bubble ai-msg-bubble--loading">Calculando medidas…</div></div>}
            <div ref={bottomRef} />
          </div>
          {error && <p className="ap-error" style={{ margin: '0 1rem' }}>{error}</p>}
          <form onSubmit={e => { e.preventDefault(); send(); }} className="ai-chat-input-row">
            <MicButton disabled={loading} onResult={t => setInput(prev => (prev ? prev + ' ' : '') + t)} />
            <input className="ap-field-input" value={input} onChange={e => setInput(e.target.value)} placeholder={spec ? 'Pide un cambio: "módulo 2 de cajones", "10 cm más ancho"…' : 'Describe la pared y el mueble…'} disabled={loading || !!verV} />
            <button type="submit" className="ap-btn ap-btn-primary ap-btn-sm" disabled={loading || !input.trim() || !!verV}><SendIcon size={13} /></button>
          </form>
        </div>

        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 480 }}>
          {vista ? (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <strong style={{ fontSize: '0.9rem', flex: 1, minWidth: 140 }}>{vista.titulo}</strong>
                <button type="button" className="ap-btn ap-btn-primary ap-btn-sm" onClick={() => { if (!imprimirAlzado(svg)) setError('El navegador ha bloqueado la ventana. Permite ventanas emergentes para esta web.'); }}><Printer size={13} /> PDF (A3)</button>
                <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => descargarPNG(svg, nombre)}><Download size={13} /> PNG</button>
                <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => descargarSVG(svg, nombre)}><Download size={13} /> SVG</button>
              </div>
              {verV && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', background: 'rgba(61,133,198,0.14)', border: '1px solid rgba(61,133,198,0.4)', borderRadius: 8, padding: '0.5rem 0.7rem', fontSize: '0.78rem' }}>
                  <span style={{ flex: 1 }}>Estás viendo la versión {verV} (solo lectura). La actual no se ha tocado.</span>
                  <button type="button" className="ap-btn ap-btn-primary ap-btn-sm" onClick={recuperar}>Recuperar como versión nueva</button>
                  <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => setVerV(null)}>Volver a la actual</button>
                </div>
              )}
              {!verV && avisos.length > 0 && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: 'rgba(224,162,74,0.12)', border: '1px solid rgba(224,162,74,0.35)', borderRadius: 8, padding: '0.5rem 0.7rem', fontSize: '0.78rem' }}>
                  <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2, color: '#e0a24a' }} />
                  <div>{avisos.map((a, i) => <div key={i}>{a}</div>)}</div>
                </div>
              )}
              <div style={{ background: '#fff', borderRadius: 8, padding: 6, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto' }} dangerouslySetInnerHTML={{ __html: svg }} />
              <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.45)' }}>Para guardar en PDF: pulsa "PDF (A3)" y en la ventana de impresión elige "Guardar como PDF". Sale a escala real.</div>
            </>
          ) : (
            <div style={{ margin: 'auto', textAlign: 'center', color: 'rgba(255,255,255,0.45)', fontSize: '0.85rem', maxWidth: 320 }}>
              <Ruler size={34} style={{ opacity: 0.5, marginBottom: 8 }} />
              <div>Aquí aparecerá la lámina en cuanto me digas el ancho y el alto de la pared.</div>
            </div>
          )}
        </div>
      </div>
      <style>{'@media (max-width: 900px){.dis-grid{grid-template-columns:1fr !important}}'}</style>
    </div>
  );
}
