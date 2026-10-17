import { useState, useEffect } from 'react';
import { MapPin, ClipboardList, Route, BookOpen, Ruler, Camera, CheckCircle2, Circle, CircleDot, ChevronDown, ChevronUp, CalendarClock } from 'lucide-react';
import api from '../services/api';

// Resumen visual del proyecto para el diseñador: cómo está el espacio ahora,
// qué le piden (cliente y equipo) y cómo va cada parte, con un mini manual
// de para qué sirve cada pestaña. Todo sale de /client-projects/:id/panel.

const card = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '1rem 1.1rem', marginBottom: '1rem' };
const h3 = { display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 0.7rem', fontSize: '0.95rem', fontWeight: 700, color: '#fff' };
const muted = { fontSize: '0.78rem', color: 'rgba(255,255,255,0.5)', lineHeight: 1.55 };
const chip = (c = '#baafa5') => ({ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.7rem', padding: '3px 10px', borderRadius: 20, background: `${c}22`, color: c, fontWeight: 600 });
const fechaCorta = (iso) => iso ? new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) : '';
const cm = (n) => (n == null || n === '' ? '—' : Math.round(Number(n)));

const ESTADO = {
  hecho: { t: 'Hecho', c: '#22c55e', Icon: CheckCircle2 },
  curso: { t: 'En curso', c: '#f59e0b', Icon: CircleDot },
  falta: { t: 'Pendiente', c: '#9ca3af', Icon: Circle },
};

function pasos(p) {
  const g = p.progreso || {}, nec = g.necesidades || {};
  const st = (hecho, curso) => (hecho ? 'hecho' : curso ? 'curso' : 'falta');
  return [
    { tab: 'necesidades', n: 1, t: 'Necesidades', e: st(nec.formulario === 'enviado' || (nec.fotos > 0 && nec.medidas > 0), nec.fotos > 0 || nec.medidas > 0 || nec.formulario),
      que: 'Lo que pide el cliente y cómo es el espacio: respuestas, fotos y medidas.', dato: `${nec.fotos || 0} fotos · ${nec.medidas || 0} medidas` },
    { tab: 'medicion', n: 2, t: 'Planos', e: st(g.planos > 0 && p.espacio?.plano?.m2 > 0, g.planos > 0),
      que: 'Dibujas el espacio (muros, huecos), colocas el equipamiento y la iluminación y sacas las láminas.', dato: g.planos ? `${g.planos} plano${g.planos === 1 ? '' : 's'}` : 'Sin plano todavía' },
    { tab: 'moodboard', n: 3, t: 'Moodboard', e: st(g.moodboard >= 4, g.moodboard > 0),
      que: 'Imágenes, colores y estilo: la atmósfera que busca el cliente.', dato: `${g.moodboard || 0} imágenes` },
    { tab: 'historia', n: 4, t: 'Historia', e: st(g.historia?.capitulos >= 3, g.historia?.capitulos > 0),
      que: 'Lo que ve el cliente en su portal: capítulos con textos, renders, planos y equipamiento.', dato: `${g.historia?.capitulos || 0} capítulos` },
    { tab: 'catalogo', n: 5, t: 'Listados', e: st(g.equipos + g.materiales >= 3, g.equipos + g.materiales > 0),
      que: 'Equipamiento y materiales elegidos, con foto, cantidad y enlace de compra.', dato: `${g.equipos || 0} equipos · ${g.materiales || 0} materiales` },
    { tab: 'documentos', n: 6, t: 'Documentos', e: st(g.documentos > 0, false),
      que: 'Planos en PDF, contratos y el dossier de ejecución que se sube al portal.', dato: `${g.documentos || 0} archivos` },
  ];
}

const MANUAL = [
  ['1 · Necesidades', 'Aquí entra todo lo que sabemos del cliente: el formulario que rellena (o rellena un comercial), fotos del estado actual y medidas. Es lo primero que hay que leer.'],
  ['2 · Planos', 'La herramienta de planos. Dibuja el espacio como está (Estado actual), define demoliciones y reforma, coloca equipamiento y luz, y exporta láminas en PDF. Desde aquí también se publica el plano en la historia del cliente y se saca el listado de equipamiento.'],
  ['3 · Moodboard', 'Referencias visuales y paleta. Sirve para acordar el estilo con el cliente antes de diseñar.'],
  ['4 · Historia', 'Es lo que el cliente ve en su portal. Cada capítulo es una zona (entrada, zona de entreno…) con textos, renders y el equipamiento de esa zona (se elige y ordena ahí mismo).'],
  ['Asistente', 'Una IA que conoce el proyecto: te ayuda a redactar, resumir lo que pide el cliente o proponer ideas.'],
  ['Listados', 'Equipamiento y materiales del proyecto con foto, cantidad, marca y enlaces. Lo que crees en la historia también aparece aquí.'],
  ['Documentos', 'Archivos del proyecto (planos en PDF, contratos). Los planos que subes desde Planos llegan aquí y el cliente los ve en «De la historia a la obra».'],
  ['Notas', 'Notas internas del equipo sobre el proyecto: no las ve el cliente.'],
];

export function ResumenProyecto({ project, onIr }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let vivo = true;
    api.get(`/client-projects/${project.id}/panel`).then(r => { if (vivo) setD(r.data); }).catch(e => { if (vivo) setError(e.response?.data?.error || 'No se pudo cargar el resumen'); });
    return () => { vivo = false; };
  }, [project.id]);

  if (error) return <p className="ap-error">{error}</p>;
  if (!d) return <p style={muted}>Cargando resumen…</p>;
  return <ResumenVista d={d} onIr={onIr} />;
}

export function ResumenVista({ d, onIr }) {
  const [manual, setManual] = useState(false);
  const { proyecto: p, espacio: esp, pedido: ped } = d;
  const pl = esp.plano;
  const tareasAbiertas = (ped.tareas || []).filter(t => !t.done);
  const pasosL = pasos(d);
  const hecho = pasosL.filter(x => x.e === 'hecho').length;
  const hayPedido = ped.resumen_cliente || ped.brief || ped.notas_equipo || ped.notas?.length || ped.tareas?.length;

  return (
    <div>
      {/* ficha */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'center' }}>
        <span style={chip('#baafa5')}>Responsable: {p.responsable || 'sin asignar'}</span>
        {p.asignados?.length > 0 && <span style={chip('#06b6d4')}>Con acceso: {p.asignados.join(', ')}</span>}
        <span style={chip('#8b5cf6')}>Fase {p.fase}</span>
        {p.urgencia && p.urgencia !== 'normal' && <span style={chip('#ef4444')}>Urgencia: {p.urgencia}</span>}
        <span style={chip(hecho === pasosL.length ? '#22c55e' : '#f59e0b')}>{hecho} de {pasosL.length} partes listas</span>
      </div>

      {/* 1 · el espacio ahora */}
      <div style={card}>
        <h3 style={h3}><MapPin size={16} /> Cómo está el espacio ahora</h3>
        {esp.fotos.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8, marginBottom: '0.9rem' }}>
            {esp.fotos.map((f, i) => (
              <a key={i} href={f.url} target="_blank" rel="noopener noreferrer" title={f.caption || 'Abrir foto'} style={{ display: 'block', aspectRatio: '4/3', borderRadius: 8, overflow: 'hidden', background: '#111' }}>
                <img src={f.url} alt={f.caption || ''} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </a>
            ))}
          </div>
        ) : (
          <div style={{ ...muted, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: '0.9rem' }}>
            <Camera size={15} /> Todavía no hay fotos del estado actual.
            <button type="button" className="ap-btn ap-btn-ghost ap-btn-xs" onClick={() => onIr('necesidades')}>Añadir fotos y medidas</button>
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {pl ? [
            [pl.m2 != null ? `${pl.m2} m²` : '—', 'superficie'], [pl.salas ?? '—', 'salas'], [pl.altura ? `${cm(pl.altura)} cm` : '—', 'altura'],
            [(pl.puertas ?? 0) + (pl.ventanas ?? 0), `puertas y ventanas`], [pl.equipos ?? 0, 'máquinas'], [pl.luminarias ?? 0, 'puntos de luz'],
          ].map(([v, l]) => (
            <div key={l} style={{ minWidth: 92, padding: '0.55rem 0.8rem', borderRadius: 10, background: 'rgba(255,255,255,0.04)' }}>
              <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#fff' }}>{v}</div>
              <div style={{ ...muted, fontSize: '0.7rem' }}>{l}</div>
            </div>
          )) : (
            <div style={{ ...muted, display: 'flex', alignItems: 'center', gap: 10 }}>
              <Ruler size={15} /> Aún no hay plano de este proyecto.
              <button type="button" className="ap-btn ap-btn-ghost ap-btn-xs" onClick={() => onIr('medicion')}>Dibujar el plano</button>
            </div>
          )}
        </div>
        {pl && <p style={{ ...muted, margin: '0.6rem 0 0' }}>Del plano «{pl.nombre}»{pl.actualizado ? ` · actualizado el ${fechaCorta(pl.actualizado)}` : ''}. <button type="button" className="ap-btn ap-btn-ghost ap-btn-xs" onClick={() => onIr('medicion')}>Abrir planos</button></p>}
        {esp.medidas.length > 0 && (
          <div style={{ marginTop: '0.8rem' }}>
            <div style={{ ...muted, marginBottom: 4 }}>Medidas que nos dieron:</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {esp.medidas.map((m, i) => <span key={i} style={chip('#06b6d4')}>{m.space_name}: {cm(m.largo)} × {cm(m.ancho)}{m.alto ? ` × ${cm(m.alto)}` : ''} cm</span>)}
            </div>
          </div>
        )}
      </div>

      {/* 2 · lo que piden */}
      <div style={card}>
        <h3 style={h3}><ClipboardList size={16} /> Qué hay que hacer</h3>
        {!hayPedido && <p style={muted}>Todavía no hay nada anotado. Cuando el cliente rellene el formulario o se te asigne una tarea, aparecerá aquí.</p>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
          {(ped.resumen_cliente || ped.brief) && (
            <div>
              <div style={{ ...chip('#3b82f6'), marginBottom: 6 }}>Lo que pide el cliente</div>
              {ped.resumen_cliente && <p style={{ margin: '0 0 6px', fontSize: '0.84rem', color: '#e8e4df', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{ped.resumen_cliente}</p>}
              {ped.brief && <p style={{ margin: 0, ...muted, whiteSpace: 'pre-wrap' }}>{ped.brief}</p>}
              <button type="button" className="ap-btn ap-btn-ghost ap-btn-xs" style={{ marginTop: 6 }} onClick={() => onIr('necesidades')}>Ver todas las respuestas</button>
            </div>
          )}
          {(ped.notas_equipo || ped.notas?.length > 0) && (
            <div>
              <div style={{ ...chip('#f59e0b'), marginBottom: 6 }}>Notas del equipo</div>
              {ped.notas_equipo && <p style={{ margin: '0 0 6px', fontSize: '0.84rem', color: '#e8e4df', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{ped.notas_equipo}</p>}
              {ped.notas.map(n => <p key={n.id} style={{ margin: '0 0 5px', ...muted, whiteSpace: 'pre-wrap' }}><b style={{ color: 'rgba(255,255,255,0.7)' }}>{fechaCorta(n.created_at)}</b> · {n.content}</p>)}
            </div>
          )}
          {ped.tareas?.length > 0 && (
            <div>
              <div style={{ ...chip('#22c55e'), marginBottom: 6 }}>Tareas ({tareasAbiertas.length} abiertas)</div>
              {ped.tareas.slice(0, 8).map(t => (
                <div key={t.id} style={{ display: 'flex', gap: 7, alignItems: 'flex-start', marginBottom: 5, opacity: t.done ? 0.5 : 1 }}>
                  {t.done ? <CheckCircle2 size={14} color="#22c55e" style={{ marginTop: 2, flex: 'none' }} /> : <Circle size={14} style={{ marginTop: 2, flex: 'none', opacity: 0.6 }} />}
                  <span style={{ fontSize: '0.83rem', textDecoration: t.done ? 'line-through' : 'none' }}>
                    {t.title}
                    {t.due_date && !t.done && <span style={{ ...chip('#ef4444'), marginLeft: 6 }}><CalendarClock size={10} /> {fechaCorta(t.due_date)}</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 3 · recorrido */}
      <div style={card}>
        <h3 style={h3}><Route size={16} /> El proyecto, paso a paso</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10 }}>
          {pasosL.map(x => {
            const E = ESTADO[x.e];
            return (
              <button key={x.tab} type="button" onClick={() => onIr(x.tab)} style={{ textAlign: 'left', cursor: 'pointer', background: 'rgba(255,255,255,0.03)', border: `1px solid ${E.c}44`, borderRadius: 12, padding: '0.8rem 0.9rem', color: 'inherit', display: 'block' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <strong style={{ fontSize: '0.9rem' }}>{x.n} · {x.t}</strong>
                  <span style={chip(E.c)}><E.Icon size={11} /> {E.t}</span>
                </div>
                <div style={{ ...muted, minHeight: 52 }}>{x.que}</div>
                <div style={{ fontSize: '0.74rem', color: E.c, marginTop: 6, fontWeight: 600 }}>{x.dato} →</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 4 · manual */}
      <div style={card}>
        <button type="button" onClick={() => setManual(m => !m)} style={{ ...h3, margin: 0, width: '100%', background: 'none', border: 'none', cursor: 'pointer', justifyContent: 'space-between' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><BookOpen size={16} /> Cómo funciona cada pestaña</span>
          {manual ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {manual && (
          <div style={{ marginTop: '0.8rem', display: 'grid', gap: 10 }}>
            {MANUAL.map(([t, x]) => <div key={t}><b style={{ fontSize: '0.84rem' }}>{t}</b><p style={{ ...muted, margin: '2px 0 0' }}>{x}</p></div>)}
            <p style={{ ...muted, margin: 0 }}>Consejo: empieza siempre por <b>Necesidades</b> y por el <b>plano del estado actual</b>. Con eso claro, el resto (moodboard, historia, listados) se construye encima.</p>
          </div>
        )}
      </div>
    </div>
  );
}
