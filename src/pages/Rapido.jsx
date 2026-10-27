import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import './Rapido.css';

// Mi agenda, pensada para el móvil: ver el día con mis horarios, mis reuniones, mis llamadas y lo ocupado en Google Calendar,
// y apuntar tareas o eventos viendo si se pisan con algo. Todo se guarda en «Tareas» y en el calendario del panel.

const PRIORIDADES = [
  { v: 'baja', n: 'Baja', c: '#8bae8f' },
  { v: 'normal', n: 'Normal', c: '#baafa5' },
  { v: 'alta', n: 'Alta', c: '#ae9e8b' },
  { v: 'urgente', n: 'Urgente', c: '#ae8b8b' },
];
const COLORES = ['#baafa5', '#8b9eae', '#8bae8f', '#ae9e8b', '#ae8b8b', '#9e8bae'];
const DURACIONES = [[30, '30 min'], [60, '1 h'], [90, '1,5 h'], [120, '2 h']];
const COLA = 'rapido_pendientes_v1';
const PX_HORA = 54; // alto de una hora en la agenda

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const deIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const suma = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const DIAS_LARGO = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const hhmm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const aMin = (h) => { const [a, b] = String(h || '0:0').split(':'); return (+a || 0) * 60 + (+b || 0); };
const durTxt = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `${m} min`);
const etiquetaFecha = (s) => {
  if (!s) return 'sin fecha';
  const hoy = iso(new Date());
  if (s === hoy) return 'hoy';
  if (s === iso(suma(new Date(), 1))) return 'mañana';
  const f = deIso(s);
  return `${DIAS[f.getDay()]} ${f.getDate()}/${f.getMonth() + 1}`;
};
const leeCola = () => { try { return JSON.parse(localStorage.getItem(COLA) || '[]'); } catch { return []; } };
const guardaCola = (l) => { try { localStorage.setItem(COLA, JSON.stringify(l)); } catch { /* sin almacenamiento */ } };

export function Rapido() {
  const hoy = useMemo(() => iso(new Date()), []);
  const [vista, setVista] = useState('dia'); // 'dia' | 'anotar'
  // agenda
  const [dia, setDia] = useState(hoy);
  const [datos, setDatos] = useState(null);
  const [semana, setSemana] = useState([]);
  const [cargandoDia, setCargandoDia] = useState(true);
  const [verHorarios, setVerHorarios] = useState(false);
  // formulario
  const [modo, setModo] = useState('tarea');
  const [titulo, setTitulo] = useState('');
  const [fecha, setFecha] = useState('');
  const [hora, setHora] = useState('');
  const [duracion, setDuracion] = useState(60);
  const [prioridad, setPrioridad] = useState('normal');
  const [color, setColor] = useState(COLORES[0]);
  const [nota, setNota] = useState('');
  const [verNota, setVerNota] = useState(false);
  const [proyectoId, setProyectoId] = useState('');
  const [proyectos, setProyectos] = useState([]);
  const [tareas, setTareas] = useState([]);
  const [eventos, setEventos] = useState([]);
  const [choque, setChoque] = useState(null);
  const [aviso, setAviso] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [pendientes, setPendientes] = useState(() => leeCola().length);
  const campo = useRef(null);
  const avisoT = useRef(null);
  const tira = useRef(null);

  const mostrar = useCallback((t, ms = 2600) => { setAviso(t); clearTimeout(avisoT.current); avisoT.current = setTimeout(() => setAviso(''), ms); }, []);

  const cargarListas = useCallback(async () => {
    try {
      const [t, e] = await Promise.all([api.get('/tasks'), api.get('/events')]);
      setTareas((t.data.tasks || []).filter(x => !x.done).slice(0, 8));
      setEventos((e.data.events || []).filter(x => !x.done && x.date >= iso(new Date())).slice(0, 8));
    } catch { /* sin conexión: se ven las listas anteriores */ }
  }, []);
  const cargarDia = useCallback(async (f) => {
    setCargandoDia(true);
    try { const r = await api.get('/agenda/dia', { params: { fecha: f } }); setDatos(r.data); }
    catch { setDatos(null); }
    setCargandoDia(false);
  }, []);
  const cargarSemana = useCallback(async (desde) => {
    try { const r = await api.get('/agenda/semana', { params: { desde } }); setSemana(r.data.dias || []); } catch { /* sin tira */ }
  }, []);
  const recarga = useCallback(() => { cargarListas(); cargarDia(dia); cargarSemana(iso(suma(new Date(), 0))); }, [cargarListas, cargarDia, cargarSemana, dia]);

  const enviar = useCallback(async (it) => {
    if (it.modo === 'evento') await api.post('/events', { title: it.titulo, description: it.nota || null, date: it.fecha, time: it.hora || null, color: it.color, duration_min: it.hora ? it.duracion : null });
    else await api.post('/tasks', { title: it.titulo, description: it.nota || null, priority: it.prioridad, due_date: it.fecha || null, project_id: it.proyectoId || null });
  }, []);

  const vaciaCola = useCallback(async () => {
    const cola = leeCola();
    if (!cola.length) return;
    const quedan = [];
    for (const it of cola) { try { await enviar(it); } catch (err) { if (!err.response || err.response.status >= 500) quedan.push(it); } }
    guardaCola(quedan); setPendientes(quedan.length);
    if (quedan.length < cola.length) { mostrar(`✓ Enviado${cola.length - quedan.length > 1 ? 's' : ''} ${cola.length - quedan.length} que estaban sin enviar`); cargarListas(); }
  }, [enviar, mostrar, cargarListas]);

  useEffect(() => {
    document.title = 'Mi agenda';
    cargarListas(); vaciaCola(); cargarSemana(hoy);
    api.get('/client-projects').then(r => setProyectos((r.data.projects || r.data || []).map(p => ({ id: p.id, nombre: p.project_name || p.name })).filter(p => p.nombre))).catch(() => {});
    const alVolver = () => { vaciaCola(); cargarListas(); };
    const vis = () => { if (!document.hidden) alVolver(); };
    window.addEventListener('online', alVolver);
    document.addEventListener('visibilitychange', vis);
    return () => { window.removeEventListener('online', alVolver); document.removeEventListener('visibilitychange', vis); };
  }, [cargarListas, vaciaCola, cargarSemana, hoy]);
  useEffect(() => { cargarDia(dia); }, [dia, cargarDia]);
  useEffect(() => { if (modo === 'evento' && !fecha) setFecha(hoy); }, [modo, fecha, hoy]);

  // ¿se pisa con algo? (solo eventos con hora)
  useEffect(() => {
    if (vista !== 'anotar' || modo !== 'evento' || !fecha || !hora) { setChoque(null); return undefined; }
    const t = setTimeout(async () => {
      try { const r = await api.post('/agenda/conflictos', { fecha, hora, duracion_min: duracion }); setChoque(r.data); } catch { setChoque(null); }
    }, 350);
    return () => clearTimeout(t);
  }, [vista, modo, fecha, hora, duracion]);

  const cambiaModo = (m) => { setModo(m); if (m === 'tarea' && fecha === hoy) setFecha(''); setTimeout(() => campo.current && campo.current.focus(), 0); };
  const irAnotar = (m, f, h) => { setVista('anotar'); setModo(m); setFecha(f || ''); setHora(h || ''); setTimeout(() => campo.current && campo.current.focus(), 50); };

  const guardar = async (ev) => {
    if (ev) ev.preventDefault();
    const t = titulo.trim();
    if (!t) { campo.current && campo.current.focus(); return; }
    const it = { modo, titulo: t, fecha: modo === 'evento' ? (fecha || hoy) : fecha, hora, duracion, prioridad, color, nota: nota.trim(), proyectoId };
    setGuardando(true);
    try {
      await enviar(it);
      mostrar(modo === 'evento' ? `✓ Evento guardado · ${etiquetaFecha(it.fecha)}${it.hora ? ' ' + it.hora : ''}` : `✓ Tarea guardada${it.fecha ? ' · ' + etiquetaFecha(it.fecha) : ''}`);
      recarga();
    } catch (err) {
      if (!err.response) {
        const cola = [...leeCola(), it]; guardaCola(cola); setPendientes(cola.length);
        mostrar('Sin conexión: guardado en el móvil, se envía solo al volver a tener internet', 4200);
      } else { mostrar(err.response.data?.error || 'No se ha podido guardar', 4200); setGuardando(false); return; }
    }
    setTitulo(''); setNota(''); setVerNota(false); setChoque(null);
    setGuardando(false);
    setTimeout(() => campo.current && campo.current.focus(), 0);
  };

  const marcar = async (tipo, item) => {
    try { await api.put(`/${tipo}/${item.id}`, { done: true }); (tipo === 'tasks' ? setTareas : setEventos)(l => l.filter(x => x.id !== item.id)); mostrar('✓ Hecho'); recarga(); }
    catch { mostrar('No se ha podido marcar'); }
  };
  const marcarTareaDia = async (t) => {
    try { await api.put(`/tasks/${t.id}`, { done: true }); setDatos(d => d && ({ ...d, tareas: d.tareas.filter(x => x.id !== t.id) })); mostrar('✓ Hecha'); cargarListas(); } catch { mostrar('No se ha podido marcar'); }
  };
  const aHoy = async (t) => {
    try { await api.put(`/tasks/${t.id}`, { due_date: dia }); mostrar('Pasada a ' + etiquetaFecha(dia)); cargarDia(dia); cargarListas(); } catch { mostrar('No se ha podido mover'); }
  };

  const chipsFecha = modo === 'evento'
    ? [['Hoy', hoy], ['Mañana', iso(suma(new Date(), 1))], ['Pasado', iso(suma(new Date(), 2))], ['En 1 semana', iso(suma(new Date(), 7))]]
    : [['Sin fecha', ''], ['Hoy', hoy], ['Mañana', iso(suma(new Date(), 1))], ['En 1 semana', iso(suma(new Date(), 7))]];

  // ── agenda del día ──
  const rango = useMemo(() => {
    let ini = 8 * 60, fin = 21 * 60;
    if (datos) {
      datos.horario.forEach(h => { ini = Math.min(ini, Math.floor(h.ini / 60) * 60); fin = Math.max(fin, Math.ceil(h.fin / 60) * 60); });
      datos.bloques.forEach(b => { if (b.ini != null) { ini = Math.min(ini, Math.floor(b.ini / 60) * 60); fin = Math.max(fin, Math.ceil(b.fin / 60) * 60); } });
    }
    return { ini, fin };
  }, [datos]);
  const y = (m) => ((m - rango.ini) / 60) * PX_HORA;
  const dias14 = useMemo(() => Array.from({ length: 14 }, (_, i) => iso(suma(new Date(), i))), []);
  const cuenta = (f) => semana.find(s => s.fecha === f);
  const dd = deIso(dia);
  const totalLibre = datos ? datos.libres.reduce((a, l) => a + (l.fin - l.ini), 0) : 0;

  return (
    <div className="rp">
      <header className="rp-top">
        <strong>Mi agenda</strong>
        <Link to="/admin/panel" className="rp-panel">Panel</Link>
      </header>

      <div className="rp-modos" role="tablist">
        <button type="button" role="tab" aria-selected={vista === 'dia'} className={vista === 'dia' ? 'on' : ''} onClick={() => setVista('dia')}>Mi día</button>
        <button type="button" role="tab" aria-selected={vista === 'anotar'} className={vista === 'anotar' ? 'on' : ''} onClick={() => irAnotar(modo, fecha, hora)}>Anotar</button>
      </div>

      {vista === 'dia' && (
        <>
          <div className="rp-tira" ref={tira}>
            {dias14.map(f => {
              const c = cuenta(f); const d = deIso(f);
              return (
                <button type="button" key={f} className={'rp-d' + (f === dia ? ' on' : '')} onClick={() => setDia(f)}>
                  <small>{f === hoy ? 'hoy' : DIAS[d.getDay()]}</small>
                  <b>{d.getDate()}</b>
                  <i>{c && (c.eventos + c.llamadas) > 0 ? <span className="pt ev" /> : null}{c && c.tareas > 0 ? <span className="pt ta" /> : null}</i>
                </button>
              );
            })}
          </div>

          <div className="rp-cab">
            <h2>{DIAS_LARGO[dd.getDay()]} {dd.getDate()} de {MESES[dd.getMonth()]}</h2>
            {datos && datos.horario.length > 0 && <p>{totalLibre > 0 ? `${durTxt(totalLibre)} libres dentro de tu horario` : 'Sin huecos libres dentro de tu horario'}</p>}
            {datos && datos.horario.length === 0 && <p>Día sin horario de trabajo</p>}
          </div>

          {cargandoDia && !datos && <p className="rp-vacio">Cargando…</p>}
          {datos && datos.bloques.filter(b => b.todoDia).map(b => (
            <div className="rp-todo" key={b.id} style={{ borderLeftColor: b.color || COLORES[0] }}><small>Todo el día</small> {b.titulo}</div>
          ))}

          {datos && (
            <div className="rp-agenda" style={{ height: ((rango.fin - rango.ini) / 60) * PX_HORA }}>
              {Array.from({ length: (rango.fin - rango.ini) / 60 + 1 }, (_, i) => (
                <div className="rp-h" key={i} style={{ top: i * PX_HORA }}><span>{pad(rango.ini / 60 + i)}:00</span></div>
              ))}
              {datos.horario.map((h, i) => <div className="rp-trab" key={'h' + i} style={{ top: y(h.ini), height: y(h.fin) - y(h.ini) }} />)}
              {datos.libres.map((l, i) => (
                <button type="button" className="rp-libre" key={'l' + i} style={{ top: y(l.ini), height: Math.max(26, y(l.fin) - y(l.ini) - 2) }} onClick={() => irAnotar('evento', dia, hhmm(l.ini))}>
                  <span>Libre {hhmm(l.ini)}–{hhmm(l.fin)}</span><em>+ apuntar</em>
                </button>
              ))}
              {datos.bloques.filter(b => b.ini != null).map((b, i) => (
                <div className={'rp-b ' + b.tipo} key={(b.id || 'g') + i} style={{ top: y(b.ini), height: Math.max(24, y(b.fin) - y(b.ini) - 2), borderLeftColor: b.color || undefined }}>
                  <b>{b.titulo}</b><small>{hhmm(b.ini)}–{hhmm(b.fin)}</small>
                  {b.tipo === 'evento' && <button type="button" className="rp-hecho" aria-label="Marcar como hecho" onClick={() => marcar('events', { id: b.id })}>✓</button>}
                </div>
              ))}
              {dia === hoy && (() => { const n = new Date(); const m = n.getHours() * 60 + n.getMinutes(); return m >= rango.ini && m <= rango.fin ? <div className="rp-ahora" style={{ top: y(m) }} /> : null; })()}
            </div>
          )}
          {datos && !datos.google && <p className="rp-sug">Google Calendar sin conectar: no se ve lo que tengas allí. Se conecta en el panel, en Mi Agenda.</p>}

          {datos && datos.tareas.length > 0 && (
            <section className="rp-lista">
              <h2>Tareas de este día</h2>
              {datos.tareas.filter(t => dia === hoy || !t.atrasada).map(t => (
                <div className="rp-item" key={t.id}>
                  <button type="button" className="rp-ok" aria-label="Marcar como hecha" onClick={() => marcarTareaDia(t)} />
                  <span className="rp-punto" style={{ background: (PRIORIDADES.find(p => p.v === t.prioridad) || PRIORIDADES[1]).c }} />
                  <span className="rp-tx"><b>{t.titulo}</b><small className={t.atrasada ? 'atr' : ''}>{t.atrasada ? 'atrasada · ' + etiquetaFecha(String(t.fecha).slice(0, 10)) : 'para este día'}{t.proyecto ? ' · ' + t.proyecto : ''}</small></span>
                  {t.atrasada && <button type="button" className="rp-mov" onClick={() => aHoy(t)}>Pasar a hoy</button>}
                </div>
              ))}
            </section>
          )}

          <div className="rp-acc">
            <button type="button" onClick={() => irAnotar('evento', dia, '')}>+ Evento este día</button>
            <button type="button" onClick={() => irAnotar('tarea', dia, '')}>+ Tarea para este día</button>
          </div>

          <button type="button" className="rp-mas" onClick={() => setVerHorarios(v => !v)}>{verHorarios ? '▾' : '▸'} Mis horarios de trabajo</button>
          {verHorarios && <Horarios onGuardado={() => cargarDia(dia)} mostrar={mostrar} />}
        </>
      )}

      {vista === 'anotar' && (
        <>
          <div className="rp-modos rp-sub" role="tablist">
            <button type="button" className={modo === 'tarea' ? 'on' : ''} onClick={() => cambiaModo('tarea')}>Tarea</button>
            <button type="button" className={modo === 'evento' ? 'on' : ''} onClick={() => cambiaModo('evento')}>Evento</button>
          </div>

          <form className="rp-form" onSubmit={guardar}>
            <input ref={campo} className="rp-titulo" value={titulo} onChange={e => setTitulo(e.target.value)} placeholder={modo === 'evento' ? 'Qué es (p. ej. Llamada con Josema)' : 'Qué hay que hacer'} autoComplete="off" enterKeyHint="done" maxLength={160} />

            <div className="rp-etq">{modo === 'evento' ? 'Cuándo' : 'Para cuándo'}</div>
            <div className="rp-chips">
              {chipsFecha.map(([n, v]) => <button type="button" key={n} className={fecha === v ? 'on' : ''} onClick={() => setFecha(v)}>{n}</button>)}
              <label className={'rp-otra' + (fecha && !chipsFecha.some(c => c[1] === fecha) ? ' on' : '')}>
                {fecha && !chipsFecha.some(c => c[1] === fecha) ? etiquetaFecha(fecha) : 'Otra fecha'}
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
                {hora && (
                  <>
                    <div className="rp-etq">Duración</div>
                    <div className="rp-chips">{DURACIONES.map(([m, n]) => <button type="button" key={m} className={duracion === m ? 'on' : ''} onClick={() => setDuracion(m)}>{n}</button>)}</div>
                  </>
                )}
                {choque && hora && (
                  choque.choques.length > 0 || choque.fuera_de_horario ? (
                    <div className="rp-choque">
                      {choque.choques.length > 0 && <p><b>⚠ Se pisa con:</b> {choque.choques.map(c => `${c.titulo} (${c.ini}–${c.fin})`).join(' · ')}</p>}
                      {choque.fuera_de_horario && choque.choques.length === 0 && <p><b>Fuera de tu horario de trabajo.</b></p>}
                      {choque.sugerencias.length > 0 && <div className="rp-chips"><span>Libre a las:</span>{choque.sugerencias.map(s => <button type="button" key={s.ini} onClick={() => setHora(s.ini)}>{s.ini}</button>)}</div>}
                    </div>
                  ) : <p className="rp-libreok">✓ Libre: no se pisa con nada</p>
                )}
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

            <button type="submit" className="rp-guardar" disabled={guardando || !titulo.trim()}>{guardando ? 'Guardando…' : modo === 'evento' ? (choque && choque.choques.length ? 'Guardar igualmente' : 'Guardar evento') : 'Guardar tarea'}</button>
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
        </>
      )}

      {aviso && <div className="rp-aviso" role="status">{aviso}</div>}
    </div>
  );
}

// Mis horarios: franjas por día de la semana, escritas como «09:00-14:00, 16:00-19:00» (vacío = no trabajo ese día)
function Horarios({ onGuardado, mostrar }) {
  const ORDEN = [1, 2, 3, 4, 5, 6, 0];
  const [txt, setTxt] = useState(null);
  const [defin, setDefin] = useState(true);
  useEffect(() => {
    api.get('/agenda/horarios').then(r => {
      const por = {}; (r.data.franjas || []).forEach(f => { (por[f.dia] = por[f.dia] || []).push(`${f.ini}-${f.fin}`); });
      Object.keys(por).forEach(k => por[k].sort());
      setTxt(Object.fromEntries(ORDEN.map(d => [d, (por[d] || []).join(', ')]))); setDefin(r.data.definido);
    }).catch(() => setTxt(Object.fromEntries(ORDEN.map(d => [d, '']))));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!txt) return <p className="rp-vacio">Cargando…</p>;
  const guardar = async () => {
    const franjas = [];
    for (const d of ORDEN) {
      for (const parte of String(txt[d] || '').split(/[,;]/).map(s => s.trim()).filter(Boolean)) {
        const m = /^(\d{1,2})(?::(\d{2}))?\s*[-–a]\s*(\d{1,2})(?::(\d{2}))?$/.exec(parte);
        if (!m) { mostrar(`No entiendo «${parte}» (${DIAS_LARGO[d]}). Usa el formato 09:00-14:00`, 4200); return; }
        const ini = `${pad(+m[1])}:${m[2] || '00'}`, fin = `${pad(+m[3])}:${m[4] || '00'}`;
        if (aMin(fin) <= aMin(ini)) { mostrar(`En ${DIAS_LARGO[d]}, «${parte}»: la hora de fin tiene que ser después de la de inicio`, 4200); return; }
        franjas.push({ dia: d, ini, fin });
      }
    }
    try { await api.put('/agenda/horarios', { franjas }); setDefin(true); mostrar('✓ Horarios guardados'); onGuardado(); }
    catch (err) { mostrar(err.response?.data?.error || 'No se han podido guardar', 4200); }
  };
  return (
    <div className="rp-hor">
      {!defin && <p className="rp-sug">Ahora se usa un horario por defecto (lunes a viernes, 9-14 y 16-19). Cámbialo aquí.</p>}
      {ORDEN.map(d => (
        <label key={d} className="rp-hrow"><span>{DIAS_LARGO[d]}</span>
          <input value={txt[d]} onChange={e => setTxt(t => ({ ...t, [d]: e.target.value }))} placeholder="libre" inputMode="text" autoComplete="off" />
        </label>
      ))}
      <button type="button" className="rp-guardar" onClick={guardar}>Guardar horarios</button>
    </div>
  );
}
