import { useState, useEffect, useCallback, useRef } from 'react';
import { CalendarDays, ArrowRight, Maximize2, Minimize2, ListChecks, FolderKanban, X, AlertCircle } from 'lucide-react';
import api from '../services/api';
import { PlanificarProyecto } from '../components/PlanificarProyecto';
import { OficinaVirtual3D } from '../components/OficinaVirtual3D';

// Oficinas: el gemelo digital de Ranuse a pantalla completa. Todo lo que hacía falta del panel está dentro: las tareas de hoy,
// la lista de proyectos con su semáforo (al pulsar uno la cámara vuela a su gym), la ficha de lo que se toca y el planificador.

const LUZ = { rojo: '#ff6b57', ambar: '#ffb347', gris: '#8f8a85', verde: '#4be3a0' };
const TEXTO_LUZ = { rojo: 'Atención', ambar: 'Ojo', gris: 'Sin planificar', verde: 'Al día' };
const vidrio = { background: 'rgba(12,12,16,0.78)', border: '1px solid rgba(186,175,165,0.28)', borderRadius: 14, backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', color: '#fff' };
const mut = { fontSize: '0.72rem', color: 'rgba(255,255,255,0.55)' };
const fmt = (iso, hoy) => {
  if (!iso) return 'Sin fecha';
  const d = Math.round((new Date(`${iso}T12:00:00`) - new Date(`${hoy}T12:00:00`)) / 86400000);
  const base = new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  return d === 0 ? 'Hoy' : d === 1 ? 'Mañana' : d < 0 ? `${base} (pasada)` : `${base} (${d} d)`;
};
const Luz = ({ c, t }) => <span title={t} style={{ width: 9, height: 9, borderRadius: '50%', background: LUZ[c], boxShadow: `0 0 8px ${LUZ[c]}`, flexShrink: 0, display: 'inline-block' }} />;
const Boton = ({ children, on, ...r }) => <button {...r} style={{ background: on ? '#fff' : 'rgba(255,255,255,0.08)', color: on ? '#000' : '#fff', border: '1px solid rgba(186,175,165,0.3)', borderRadius: 999, padding: '5px 12px', fontSize: '0.76rem', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>{children}</button>;

// Editor del muñeco de una persona: peinado, color de pelo, barba, gafas, piel y ropa (para que se parezca a su dueño)
const PIELES = ['#f3d2b3', '#e8b98f', '#c98f63', '#a86d45', '#7a4b2f'];
const PELOS = ['#1c1c20', '#3b2a20', '#6b4a2f', '#b5651d', '#e1b866', '#8d8d92', '#7a3b2e'];
const ROPAS = ['#1d1d22', '#3a3f4b', '#baafa5', '#f1eee8', '#33425b', '#46695e', '#8c3b36', '#6b6259'];
function EditorMuneco({ info, onGuardar }) {
  const [av, setAv] = useState({ pelo: 'corto', barba: 'no', gafas: false, piel: PIELES[0], peloColor: PELOS[0], ropa: ROPAS[0], ...(info.avatar || {}) });
  const fila = (t, c) => <div style={{ margin: '8px 0' }}><div style={mut}>{t}</div><div style={{ marginTop: 4 }}>{c}</div></div>;
  const muestras = (lista, clave) => <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{lista.map(c => <button key={c} type="button" aria-label={c} onClick={() => setAv(a => ({ ...a, [clave]: c }))} style={{ width: 24, height: 24, borderRadius: '50%', background: c, cursor: 'pointer', border: av[clave] === c ? '2px solid #fff' : '1px solid rgba(255,255,255,0.3)' }} />)}</div>;
  const opciones = (lista, clave) => <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>{lista.map(([v, t]) => <button key={v} type="button" onClick={() => setAv(a => ({ ...a, [clave]: v }))} style={{ background: av[clave] === v ? '#fff' : 'rgba(255,255,255,0.08)', color: av[clave] === v ? '#000' : '#fff', border: '1px solid rgba(186,175,165,0.3)', borderRadius: 999, padding: '3px 10px', fontSize: '0.74rem', cursor: 'pointer' }}>{t}</button>)}</div>;
  return (
    <div style={{ marginTop: 8, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 6 }}>
      {fila('Peinado', opciones([['corto', 'Corto'], ['largo', 'Largo'], ['rizado', 'Rizado'], ['calvo', 'Sin pelo']], 'pelo'))}
      {av.pelo !== 'calvo' && fila('Color de pelo', muestras(PELOS, 'peloColor'))}
      {fila('Barba', opciones([['no', 'Sin barba'], ['corta', 'Corta'], ['larga', 'Larga']], 'barba'))}
      {fila('Gafas', opciones([[false, 'No'], [true, 'Sí']], 'gafas'))}
      {fila('Piel', muestras(PIELES, 'piel'))}
      {fila('Ropa', muestras(ROPAS, 'ropa'))}
      <button className="ap-btn ap-btn-primary ap-btn-sm" style={{ marginTop: 6 }} onClick={() => onGuardar(info.id, av)}>Guardar muñeco</button>
    </div>
  );
}

// Ficha de lo que se toca en la oficina: una persona, un agente de IA, un proyecto, una sala, un anexo o un proveedor
function Ficha({ info, hoy, ir, onPlanificar, onCerrar, onAvatar }) {
  const [editando, setEditando] = useState(false);
  const cab = (t, sub) => <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}><div style={{ flex: 1, minWidth: 0 }}><b style={{ fontSize: '0.98rem' }}>{t}</b>{sub && <div style={mut}>{sub}</div>}</div><button className="ap-btn-icon" onClick={onCerrar} aria-label="Cerrar"><X size={14} /></button></div>;
  const btn = (txt, fn, primario = true) => <button className={`ap-btn ${primario ? 'ap-btn-primary' : 'ap-btn-ghost'} ap-btn-sm`} onClick={fn}>{txt}</button>;
  const lista = (titulo, filas) => (filas && filas.length ? <div style={{ marginTop: 10, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 8 }}><div style={{ ...mut, marginBottom: 4 }}>{titulo}</div>{filas.map((f, i) => <div key={i} style={{ display: 'flex', gap: 8, padding: '3px 0', fontSize: '0.8rem', alignItems: 'baseline' }}><span style={{ flex: 1, minWidth: 0 }}>{f[0]}</span><span style={{ ...mut, color: f[2] || mut.color, flexShrink: 0 }}>{f[1]}</span></div>)}</div> : null);
  let cuerpo = null;
  if (info.tipo === 'persona') cuerpo = (<>{cab(info.nombre, info.rol)}<div style={{ fontSize: '0.84rem', lineHeight: 1.5 }}>{info.pendientes ? <><b>{info.pendientes}</b> tarea{info.pendientes === 1 ? '' : 's'} pendiente{info.pendientes === 1 ? '' : 's'}{info.atrasadas ? <span style={{ color: LUZ.rojo }}> · {info.atrasadas} atrasada{info.atrasadas === 1 ? '' : 's'}</span> : ''}{info.hoy ? <span style={{ color: LUZ.ambar }}> · {info.hoy} para hoy</span> : ''}</> : 'Sin tareas pendientes.'}</div>{lista('En qué está trabajando', (info.lista || []).map(t => [t.titulo + (t.proyecto ? ` · ${t.proyecto}` : ''), t.fecha ? fmt(t.fecha, hoy) : 'sin fecha', t.atrasada ? LUZ.rojo : undefined]))}<div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>{btn('Ver tareas', () => ir('tareas'))}{btn(editando ? 'Cerrar editor' : 'Personalizar muñeco', () => setEditando(v => !v), false)}</div>{editando && <EditorMuneco key={info.id} info={info} onGuardar={onAvatar} />}</>);
  else if (info.tipo === 'agente') cuerpo = (<>{cab(info.nombre, 'Agente de IA')}<div style={{ fontSize: '0.84rem' }}>{info.hace}</div>{lista('Últimas láminas', (info.recientes || []).map(l => [`${l.titulo} · ${l.proyecto}`, `${l.versiones} versión${l.versiones === 1 ? '' : 'es'}`]))}<div style={{ marginTop: 8 }}>{btn('Hablar con él', () => ir(info.ir))}</div></>);
  else if (info.tipo === 'proyecto') cuerpo = (<>{cab(info.nombre, `${info.cliente} · Fase ${info.fase}`)}<div style={{ fontSize: '0.82rem', color: LUZ[info.semaforo] }}>{info.motivo}</div><div style={{ ...mut, marginTop: 3 }}>Entrega: {fmt(info.entrega, hoy)}{info.tareas.total ? ` · ${info.tareas.hechas}/${info.tareas.total} tareas` : ''}</div>{lista('Tareas pendientes', (info.lista || []).map(t => [t.titulo, t.fecha ? fmt(t.fecha, hoy) : 'sin fecha', t.atrasada ? LUZ.rojo : undefined]))}{lista('Láminas de diseño', (info.laminas || []).map(l => [l.titulo, `${l.versiones} versión${l.versiones === 1 ? '' : 'es'}`]))}<div style={{ ...mut, marginTop: 8 }}>Conectado con:{(info.deps || []).map(d => ({ diseno: 'Diseño', ventas: 'Ventas', presupuestos: 'Presupuestos', finanzas: 'Finanzas' }[d] || d)).join(', ')}</div><div style={{ display: 'flex', gap: 6, marginTop: 8 }}><button className="ap-btn ap-btn-primary ap-btn-sm" onClick={() => onPlanificar(info)}><CalendarDays size={12} /> {info.planificado ? 'Re-planificar' : 'Planificar'}</button>{btn('Abrir proyecto', () => ir('proyectos'), false)}{btn('Asistente de diseño', () => ir('asistente-diseno'), false)}</div></>);
  else if (info.tipo === 'sala') cuerpo = (<>{cab(info.nombre, TEXTO_LUZ[info.alerta])}<div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>{(info.datos || []).map(([k, v]) => <div key={k}><b style={{ fontSize: '1.05rem' }}>{v}</b><div style={mut}>{k}</div></div>)}</div>{lista('Ahora mismo', info.detalle)}{info.ir && <div style={{ marginTop: 10 }}>{btn(<>Entrar <ArrowRight size={12} /></>, () => ir(info.ir))}</div>}</>);
  else if (info.tipo === 'almacen') cuerpo = (<>{cab('Almacén del catálogo', `${info.n} productos en ${info.categorias} categorías`)}<div style={{ fontSize: '0.82rem' }}>Cada estantería es una categoría; las cajas indican cuántos productos hay. Acércate o pulsa una estantería para ver qué contiene.</div><div style={{ marginTop: 8 }}>{btn('Abrir catálogo', () => ir(info.ir))}</div></>);
  else if (info.tipo === 'categoria') cuerpo = (<>{cab(info.nombre, `${info.familia} · ${info.n} producto${info.n === 1 ? '' : 's'}`)}{info.n ? lista('Productos', info.productos.map(p => [p.nombre, p.marca || ''])) : <div style={{ fontSize: '0.82rem' }}>Todavía no hay productos en esta categoría.</div>}{info.n > info.productos.length && <div style={{ ...mut, marginTop: 4 }}>y {info.n - info.productos.length} más…</div>}<div style={{ marginTop: 10 }}>{btn('Abrir catálogo', () => ir(info.ir))}</div></>);
  else if (info.tipo === 'anexo') cuerpo = (<>{cab(`Anexo · ${info.sector}`, `${info.n} proveedor${info.n === 1 ? '' : 'es'} que colaboran`)}<div style={{ fontSize: '0.82rem', lineHeight: 1.5 }}>{info.proveedores.map(p => p.nombre).join(' · ')}</div><div style={{ marginTop: 8 }}>{btn('Abrir proveedores', () => ir('contactos'))}</div></>);
  else if (info.tipo === 'proveedor') cuerpo = (<>{cab(info.nombre, `Proveedor · ${info.sector}`)}<div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>{info.url && <a className="ap-btn ap-btn-primary ap-btn-sm" href={info.url} target="_blank" rel="noreferrer">Ver su web</a>}{btn('Abrir proveedores', () => ir('contactos'), false)}</div></>);
  return cuerpo ? <div style={{ ...vidrio, padding: '0.85rem 1rem', boxShadow: '0 10px 40px rgba(0,0,0,0.6)', maxHeight: '58vh', overflowY: 'auto' }}>{cuerpo}</div> : null;
}

export function SectionOficinas({ ir }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [sel, setSel] = useState(null);
  const [plan, setPlan] = useState(null);
  const [aviso, setAviso] = useState('');
  const [sinWebgl, setSinWebgl] = useState(false);
  const [pantalla, setPantalla] = useState(false);
  const [verHoy, setVerHoy] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth > 900));
  const [verProy, setVerProy] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth > 900));
  const [zona, setZona] = useState('todo');
  const apiRef = useRef(null), raiz = useRef(null);

  const cargar = useCallback(() => { api.get('/oficinas').then(r => { setData(r.data); setError(''); }).catch(e => setError(e.response?.data?.error || 'No se pudieron cargar las oficinas')); }, []);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { const f = () => setPantalla(!!document.fullscreenElement); document.addEventListener('fullscreenchange', f); return () => document.removeEventListener('fullscreenchange', f); }, []);

  const completa = () => { try { if (document.fullscreenElement) document.exitFullscreen(); else raiz.current?.requestFullscreen?.(); } catch { /* el navegador no lo permite */ } };
  const hecha = async (t) => { try { await api.put(`/tasks/${t.id}`, { done: true }); setData(d => ({ ...d, tareasHoy: d.tareasHoy.filter(x => x.id !== t.id) })); } catch { setAviso('No se pudo marcar la tarea'); } };
  const ver = (z) => { setZona(z); apiRef.current?.zona(z); };
  const guardarAvatar = async (id, av) => { try { await api.put(`/oficinas/avatar/${id}`, av); setSel(null); cargar(); } catch { setAviso('No se pudo guardar el muñeco'); } };

  if (error) return <div className="ap-section"><div className="ap-empty"><p>{error}</p></div></div>;
  if (!data) return <div className="ap-loading">Cargando…</div>;

  const cuenta = (...xs) => data.proyectos.filter(p => xs.includes(p.semaforo)).length;
  const atrasadas = (data.tareasHoy || []).filter(t => t.atrasada).length;
  return (
    <div ref={raiz} className="of-root" style={{ position: 'relative', height: '100vh', background: '#08080a', overflow: 'hidden' }}>
      <style>{'@media (max-width: 900px) { .of-root { height: calc(100dvh - 56px) !important; } }'}</style>
      {!sinWebgl && <OficinaVirtual3D data={data} apiRef={apiRef}
        cargarLogo={(url) => api.get('/oficinas/logo', { params: { url }, responseType: 'blob' }).then(r => r.data)}
        onSeleccion={(i) => { if (i?.tipo === 'error') setSinWebgl(true); else setSel(i); }} />}
      {sinWebgl && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem', padding: 20, textAlign: 'center' }}>Tu navegador no puede mostrar la oficina en 3D. Aquí tienes igualmente tus tareas y tus proyectos.</div>}

      {/* barra superior */}
      <div style={{ position: 'absolute', top: 12, left: 12, right: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', pointerEvents: 'none', zIndex: 5 }}>
        <div style={{ ...vidrio, padding: '7px 14px', display: 'flex', alignItems: 'center', gap: 12, pointerEvents: 'auto', flexWrap: 'wrap' }}>
          <b style={{ fontSize: '0.95rem' }}>Oficinas</b>
          <span style={mut}>{data.proyectos.length} proyectos · <span style={{ color: LUZ.rojo }}>{cuenta('rojo')} atención</span> · {cuenta('gris')} sin planificar</span>
        </div>
        <div style={{ display: 'flex', gap: 6, pointerEvents: 'auto', flexWrap: 'wrap' }}>
          {[['todo', 'Todo'], ['sede', 'Sede'], ['proyectos', 'Proyectos'], ['proveedores', 'Proveedores'], ['catalogo', 'Catálogo']].map(([id, t]) => <Boton key={id} on={zona === id} onClick={() => ver(id)}>{t}</Boton>)}
        </div>
        <span style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 6, pointerEvents: 'auto' }}>
          <Boton on={verHoy} onClick={() => setVerHoy(v => !v)}><ListChecks size={13} /> Hoy{(data.tareasHoy || []).length ? ` (${data.tareasHoy.length})` : ''}</Boton>
          <Boton on={verProy} onClick={() => setVerProy(v => !v)}><FolderKanban size={13} /> Proyectos</Boton>
          <Boton onClick={completa} aria-label="Pantalla completa">{pantalla ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</Boton>
        </div>
      </div>

      {/* tareas de hoy */}
      {verHoy && (
        <div style={{ ...vidrio, position: 'absolute', top: 62, left: 12, width: 'min(320px, calc(100% - 24px))', maxHeight: '46vh', display: 'flex', flexDirection: 'column', zIndex: 4 }}>
          <div style={{ padding: '0.7rem 0.9rem 0.4rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <b style={{ fontSize: '0.88rem' }}>Hoy y esta semana</b><span style={{ flex: 1 }} />{atrasadas > 0 && <span style={{ color: LUZ.rojo, fontSize: '0.72rem' }}>{atrasadas} atrasada{atrasadas === 1 ? '' : 's'}</span>}
          </div>
          {data.tareasSinFecha > 0 && <div onClick={() => ir('tareas')} style={{ margin: '0 0.7rem 6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,179,71,0.12)', border: '1px solid rgba(255,179,71,0.35)', borderRadius: 8, padding: '5px 8px', fontSize: '0.72rem' }}><AlertCircle size={13} style={{ color: LUZ.ambar }} /> {data.tareasSinFecha} tareas sin fecha <ArrowRight size={12} style={{ marginLeft: 'auto' }} /></div>}
          <div style={{ overflowY: 'auto', padding: '0 0.5rem 0.6rem' }}>
            {(data.tareasHoy || []).length === 0 && <p style={{ ...mut, padding: '4px 0.4rem 8px', margin: 0 }}>Nada para esta semana. Planifica un proyecto para repartir sus tareas.</p>}
            {(data.tareasHoy || []).map(t => (
              <label key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 0.4rem', borderTop: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer' }}>
                <input type="checkbox" onChange={() => hecha(t)} style={{ marginTop: 3 }} aria-label={`Hecha: ${t.titulo}`} />
                <span style={{ flex: 1, minWidth: 0 }}><span style={{ fontSize: '0.82rem', display: 'block' }}>{t.titulo}</span><span style={{ ...mut, color: t.atrasada ? LUZ.rojo : t.fecha === data.hoy ? LUZ.ambar : mut.color }}>{fmt(t.fecha, data.hoy)}{t.proyecto ? ` · ${t.proyecto}` : ''}</span></span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* proyectos */}
      {verProy && (
        <div style={{ ...vidrio, position: 'absolute', top: 62, right: 12, width: 'min(300px, calc(100% - 24px))', maxHeight: '46vh', display: 'flex', flexDirection: 'column', zIndex: 4 }}>
          <div style={{ padding: '0.7rem 0.9rem 0.4rem' }}><b style={{ fontSize: '0.88rem' }}>Proyectos en marcha</b></div>
          <div style={{ overflowY: 'auto', padding: '0 0.5rem 0.6rem' }}>
            {data.proyectos.map(p => (
              <div key={p.id} onClick={() => { setZona('proyectos'); apiRef.current?.proyecto(p.id); if (window.innerWidth <= 900) setVerProy(false); }} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0.4rem', borderTop: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer' }}>
                <Luz c={p.semaforo} t={TEXTO_LUZ[p.semaforo]} />
                <span style={{ flex: 1, minWidth: 0 }}><span style={{ fontSize: '0.8rem', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nombre}</span><span style={{ ...mut, color: LUZ[p.semaforo] }}>{p.motivo}</span></span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ficha de lo seleccionado */}
      {sel && sel.tipo !== 'error' && (
        <div style={{ position: 'absolute', left: 12, bottom: 38, width: 'min(380px, calc(100% - 24px))', zIndex: 6 }}>
          <Ficha info={sel} hoy={data.hoy} ir={ir} onPlanificar={setPlan} onAvatar={guardarAvatar} onCerrar={() => { setSel(null); apiRef.current?.limpiar(); }} />
        </div>
      )}

      <div style={{ position: 'absolute', left: 14, bottom: 10, right: 14, fontSize: '0.68rem', color: 'rgba(255,255,255,0.38)', pointerEvents: 'none', zIndex: 3, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <span>Arrastra para girar · rueda o pellizco para acercar · toca un gym para ver cómo se conecta</span>
        {Object.keys(LUZ).map(k => <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Luz c={k} /> {TEXTO_LUZ[k]}</span>)}
        {aviso && <span style={{ color: LUZ.rojo }}>{aviso}</span>}
      </div>

      {plan && <PlanificarProyecto proyecto={plan} onClose={() => setPlan(null)} onHecho={() => { setAviso(''); cargar(); }} />}
    </div>
  );
}
