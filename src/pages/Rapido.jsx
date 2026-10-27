import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import './Rapido.css';

// Página pensada para el móvil: apuntar una tarea o un evento del calendario en pocos toques.
// Se guarda en las mismas tablas que «Tareas» del panel, así que sale allí y en el calendario al momento.

const PRIORIDADES = [
  { v: 'baja', n: 'Baja', c: '#8bae8f' },
  { v: 'normal', n: 'Normal', c: '#baafa5' },
  { v: 'alta', n: 'Alta', c: '#ae9e8b' },
  { v: 'urgente', n: 'Urgente', c: '#ae8b8b' },
];
const COLORES = ['#baafa5', '#8b9eae', '#8bae8f', '#ae9e8b', '#ae8b8b', '#9e8bae'];
const COLA = 'rapido_pendientes_v1';

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const suma = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const etiquetaFecha = (s) => {
  if (!s) return 'sin fecha';
  const hoy = iso(new Date());
  if (s === hoy) return 'hoy';
  if (s === iso(suma(new Date(), 1))) return 'mañana';
  const [y, m, d] = s.split('-').map(Number);
  const f = new Date(y, m - 1, d);
  return `${DIAS[f.getDay()]} ${d}/${m}`;
};
const leeCola = () => { try { return JSON.parse(localStorage.getItem(COLA) || '[]'); } catch { return []; } };
const guardaCola = (l) => { try { localStorage.setItem(COLA, JSON.stringify(l)); } catch { /* sin almacenamiento */ } };

export function Rapido() {
  const [modo, setModo] = useState('tarea'); // 'tarea' | 'evento'
  const [titulo, setTitulo] = useState('');
  const [fecha, setFecha] = useState(''); // tarea: vacío = sin fecha · evento: por defecto hoy
  const [hora, setHora] = useState('');
  const [prioridad, setPrioridad] = useState('normal');
  const [color, setColor] = useState(COLORES[0]);
  const [nota, setNota] = useState('');
  const [verNota, setVerNota] = useState(false);
  const [proyectoId, setProyectoId] = useState('');
  const [proyectos, setProyectos] = useState([]);
  const [tareas, setTareas] = useState([]);
  const [eventos, setEventos] = useState([]);
  const [aviso, setAviso] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [pendientes, setPendientes] = useState(() => leeCola().length);
  const campo = useRef(null);
  const avisoT = useRef(null);

  const hoy = useMemo(() => iso(new Date()), []);
  const mostrar = useCallback((t, ms = 2600) => { setAviso(t); clearTimeout(avisoT.current); avisoT.current = setTimeout(() => setAviso(''), ms); }, []);

  const cargar = useCallback(async () => {
    try {
      const [t, e] = await Promise.all([api.get('/tasks'), api.get('/events')]);
      setTareas((t.data.tasks || []).filter(x => !x.done).slice(0, 8));
      setEventos((e.data.events || []).filter(x => !x.done && x.date >= iso(new Date())).slice(0, 8));
    } catch { /* sin conexión: se ven las listas anteriores */ }
  }, []);

  const enviar = useCallback(async (it) => {
    if (it.modo === 'evento') await api.post('/events', { title: it.titulo, description: it.nota || null, date: it.fecha, time: it.hora || null, color: it.color });
    else await api.post('/tasks', { title: it.titulo, description: it.nota || null, priority: it.prioridad, due_date: it.fecha || null, project_id: it.proyectoId || null });
  }, []);

  const vaciaCola = useCallback(async () => {
    const cola = leeCola();
    if (!cola.length) return;
    const quedan = [];
    for (const it of cola) { try { await enviar(it); } catch (err) { if (!err.response || err.response.status >= 500) quedan.push(it); } }
    guardaCola(quedan); setPendientes(quedan.length);
    if (quedan.length < cola.length) { mostrar(`✓ Enviado${cola.length - quedan.length > 1 ? 's' : ''} ${cola.length - quedan.length} que estaban sin enviar`); cargar(); }
  }, [enviar, mostrar, cargar]);

  useEffect(() => {
    document.title = 'Anotar rápido';
    cargar(); vaciaCola();
    api.get('/client-projects').then(r => setProyectos((r.data.projects || r.data || []).map(p => ({ id: p.id, nombre: p.project_name || p.name })).filter(p => p.nombre))).catch(() => {});
    const alVolver = () => { vaciaCola(); cargar(); };
    window.addEventListener('online', alVolver);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) alVolver(); });
    return () => window.removeEventListener('online', alVolver);
  }, [cargar, vaciaCola]);

  useEffect(() => { if (modo === 'evento' && !fecha) setFecha(hoy); }, [modo, fecha, hoy]);

  const cambiaModo = (m) => { setModo(m); if (m === 'tarea' && fecha === hoy) setFecha(''); setTimeout(() => campo.current && campo.current.focus(), 0); };

  const guardar = async (ev) => {
    if (ev) ev.preventDefault();
    const t = titulo.trim();
    if (!t) { campo.current && campo.current.focus(); return; }
    const it = { modo, titulo: t, fecha: modo === 'evento' ? (fecha || hoy) : fecha, hora, prioridad, color, nota: nota.trim(), proyectoId };
    setGuardando(true);
    try {
      await enviar(it);
      mostrar(modo === 'evento' ? `✓ Evento guardado · ${etiquetaFecha(it.fecha)}${it.hora ? ' ' + it.hora : ''}` : `✓ Tarea guardada${it.fecha ? ' · ' + etiquetaFecha(it.fecha) : ''}`);
      cargar();
    } catch (err) {
      if (!err.response) { // sin conexión: se queda en el móvil y se envía al volver
        const cola = [...leeCola(), it]; guardaCola(cola); setPendientes(cola.length);
        mostrar('Sin conexión: guardado en el móvil, se envía solo al volver a tener internet', 4200);
      } else { mostrar(err.response.data?.error || 'No se ha podido guardar', 4200); setGuardando(false); return; }
    }
    setTitulo(''); setNota(''); setVerNota(false); setHora(modo === 'evento' ? hora : '');
    setGuardando(false);
    setTimeout(() => campo.current && campo.current.focus(), 0);
  };

  const marcar = async (tipo, item) => {
    try { await api.put(`/${tipo}/${item.id}`, { done: true }); (tipo === 'tasks' ? setTareas : setEventos)(l => l.filter(x => x.id !== item.id)); mostrar('✓ Hecho'); }
    catch { mostrar('No se ha podido marcar'); }
  };

  const chips = modo === 'evento'
    ? [['Hoy', hoy], ['Mañana', iso(suma(new Date(), 1))], ['Pasado', iso(suma(new Date(), 2))], ['En 1 semana', iso(suma(new Date(), 7))]]
    : [['Sin fecha', ''], ['Hoy', hoy], ['Mañana', iso(suma(new Date(), 1))], ['En 1 semana', iso(suma(new Date(), 7))]];

  return (
    <div className="rp">
      <header className="rp-top">
        <strong>Anotar rápido</strong>
        <Link to="/admin/panel" className="rp-panel">Panel</Link>
      </header>

      <div className="rp-modos" role="tablist">
        <button type="button" role="tab" aria-selected={modo === 'tarea'} className={modo === 'tarea' ? 'on' : ''} onClick={() => cambiaModo('tarea')}>Tarea</button>
        <button type="button" role="tab" aria-selected={modo === 'evento'} className={modo === 'evento' ? 'on' : ''} onClick={() => cambiaModo('evento')}>Evento</button>
      </div>

      <form className="rp-form" onSubmit={guardar}>
        <input ref={campo} className="rp-titulo" value={titulo} onChange={e => setTitulo(e.target.value)} placeholder={modo === 'evento' ? 'Qué es (p. ej. Llamada con Josema)' : 'Qué hay que hacer'} autoFocus autoComplete="off" enterKeyHint="done" maxLength={160} />

        <div className="rp-etq">{modo === 'evento' ? 'Cuándo' : 'Para cuándo'}</div>
        <div className="rp-chips">
          {chips.map(([n, v]) => <button type="button" key={n} className={fecha === v ? 'on' : ''} onClick={() => setFecha(v)}>{n}</button>)}
          <label className={'rp-otra' + (fecha && !chips.some(c => c[1] === fecha) ? ' on' : '')}>
            {fecha && !chips.some(c => c[1] === fecha) ? etiquetaFecha(fecha) : 'Otra fecha'}
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
          </label>
        </div>

        {modo === 'evento' ? (
          <>
            <div className="rp-etq">Hora (opcional)</div>
            <div className="rp-fila">
              <input type="time" className="rp-hora" value={hora} onChange={e => setHora(e.target.value)} />
              {hora && <button type="button" className="rp-lim" onClick={() => setHora('')}>Todo el día</button>}
            </div>
            <div className="rp-colores">{COLORES.map(c => <button type="button" key={c} aria-label="Color" className={color === c ? 'on' : ''} style={{ background: c }} onClick={() => setColor(c)} />)}</div>
          </>
        ) : (
          <>
            <div className="rp-etq">Prioridad</div>
            <div className="rp-chips">
              {PRIORIDADES.map(p => <button type="button" key={p.v} className={prioridad === p.v ? 'on' : ''} style={prioridad === p.v ? { background: p.c, borderColor: p.c, color: '#111' } : { borderColor: p.c }} onClick={() => setPrioridad(p.v)}>{p.n}</button>)}
            </div>
            {proyectos.length > 0 && (
              <>
                <div className="rp-etq">Proyecto (opcional)</div>
                <select className="rp-sel" value={proyectoId} onChange={e => setProyectoId(e.target.value)}>
                  <option value="">Sin proyecto</option>
                  {proyectos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </>
            )}
          </>
        )}

        {verNota
          ? <textarea className="rp-nota" rows={3} value={nota} onChange={e => setNota(e.target.value)} placeholder="Nota (opcional)" maxLength={600} />
          : <button type="button" className="rp-mas" onClick={() => setVerNota(true)}>+ Añadir una nota</button>}

        <button type="submit" className="rp-guardar" disabled={guardando || !titulo.trim()}>{guardando ? 'Guardando…' : modo === 'evento' ? 'Guardar evento' : 'Guardar tarea'}</button>
      </form>

      {pendientes > 0 && <p className="rp-cola">{pendientes} sin enviar (sin conexión). Se mandan solas al volver a tener internet.</p>}

      <section className="rp-lista">
        <h2>Próximos eventos</h2>
        {eventos.length === 0 ? <p className="rp-vacio">Nada en el calendario.</p> : eventos.map(e => (
          <div className="rp-item" key={e.id}>
            <button type="button" className="rp-ok" aria-label="Marcar como hecho" onClick={() => marcar('events', e)} />
            <span className="rp-punto" style={{ background: e.color || COLORES[0] }} />
            <span className="rp-tx"><b>{e.title}</b><small>{etiquetaFecha(e.date)}{e.time ? ' · ' + String(e.time).slice(0, 5) : ''}</small></span>
          </div>
        ))}
      </section>

      <section className="rp-lista">
        <h2>Tareas pendientes</h2>
        {tareas.length === 0 ? <p className="rp-vacio">Todo al día.</p> : tareas.map(t => (
          <div className="rp-item" key={t.id}>
            <button type="button" className="rp-ok" aria-label="Marcar como hecha" onClick={() => marcar('tasks', t)} />
            <span className="rp-punto" style={{ background: (PRIORIDADES.find(p => p.v === t.priority) || PRIORIDADES[1]).c }} />
            <span className="rp-tx"><b>{t.title}</b><small>{t.due_date ? etiquetaFecha(String(t.due_date).slice(0, 10)) : 'sin fecha'}{t.project?.project_name ? ' · ' + t.project.project_name : ''}</small></span>
          </div>
        ))}
      </section>

      {aviso && <div className="rp-aviso" role="status">{aviso}</div>}
    </div>
  );
}
