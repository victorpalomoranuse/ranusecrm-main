import { useState, useEffect, useMemo } from 'react';
import { Ruler, Plus, ArrowLeft, Trash2, Search, FolderOpen, Link2 } from 'lucide-react';
import api from '../services/api';
import { MedicionEditor } from '../components/MedicionProyecto';
import { SearchableSelect } from '../components/SearchableSelect';

// Planos: sección propia (fuera de los proyectos, aunque estén enlazados) con
// su dashboard. Se ven TODOS los proyectos con sus planos y desde aquí se abre,
// crea, vincula o borra cada plano.

const card = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '1rem 1.1rem' };
const muted = { fontSize: '0.74rem', color: 'rgba(255,255,255,0.45)' };
const m1 = (n) => (Math.round((Number(n) || 0) * 10) / 10).toLocaleString('es-ES');
const fmtFecha = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const dias = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (dias < 1) return 'hoy';
  if (dias === 1) return 'ayer';
  if (dias < 7) return `hace ${dias} días`;
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
};

function Tile({ valor, titulo, sub }) {
  return (
    <div style={card}>
      <div style={{ fontSize: '1.7rem', fontWeight: 600, lineHeight: 1.1 }}>{valor}</div>
      <div style={{ fontSize: '0.8rem', marginTop: 4 }}>{titulo}</div>
      {sub && <div style={muted}>{sub}</div>}
    </div>
  );
}

function FilaPlano({ p, proyectos, onAbrir, onBorrar, onVincular }) {
  const [vinculando, setVinculando] = useState(false);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ flex: '1 1 220px', minWidth: 0, cursor: 'pointer' }} onClick={() => onAbrir(p)}>
        <div style={{ fontSize: '0.88rem' }}>{p.nombre}</div>
        <div style={muted}>
          {p.m2 > 0 ? `${m1(p.m2)} m² · ` : ''}{p.salas ? `${p.salas} sala${p.salas === 1 ? '' : 's'} · ` : ''}{p.equipos} máquina{p.equipos === 1 ? '' : 's'} · {p.luminarias} luminaria{p.luminarias === 1 ? '' : 's'}
          {' · '}{p.editado_por ? `${p.editado_por}, ` : ''}{fmtFecha(p.updated_at)}
        </div>
      </div>
      {vinculando && (
        <div style={{ minWidth: 240 }}>
          <SearchableSelect
            value={p.project_id || ''} placeholder="Buscar proyecto…" emptyLabel="Sin proyecto"
            options={proyectos.map(x => ({ value: x.id, label: `${x.client_name} — ${x.project_name}` }))}
            onChange={(v) => { setVinculando(false); onVincular(p, v || null); }}
          />
        </div>
      )}
      <button className="ap-btn ap-btn-primary ap-btn-sm" onClick={() => onAbrir(p)}>Abrir</button>
      <button className="ap-btn ap-btn-ghost ap-btn-sm" title="Vincular a otro proyecto" onClick={() => setVinculando(v => !v)}><Link2 size={13} /></button>
      <button className="ap-btn-icon" title="Borrar plano" onClick={() => onBorrar(p)}><Trash2 size={13} /></button>
    </div>
  );
}

export function SectionPlanos() {
  const [planos, setPlanos] = useState(null);
  const [proyectos, setProyectos] = useState([]);
  const [error, setError] = useState('');
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState('todos');
  const [editor, setEditor] = useState(null); // { projectId, abrir, nuevo, titulo, proyecto }
  const [nuevoModal, setNuevoModal] = useState(false);
  const [nuevoProyecto, setNuevoProyecto] = useState('');

  const cargar = () => Promise.all([api.get('/medicion/dashboard'), api.get('/client-projects')])
    .then(([a, b]) => { setPlanos(a.data.planos || []); setProyectos(b.data.projects || []); setError(''); })
    .catch(e => setError(e.response?.data?.error || 'No se pudieron cargar los planos'));
  useEffect(() => { cargar(); }, []);

  const proyectoPorId = useMemo(() => Object.fromEntries(proyectos.map(p => [p.id, p])), [proyectos]);

  const abrirEditor = (cfg) => setEditor(cfg);
  const cerrarEditor = () => { setEditor(null); cargar(); };

  const abrirPlano = (p) => {
    const pr = p.project_id ? proyectoPorId[p.project_id] || p.proyecto : null;
    abrirEditor({
      projectId: p.project_id || null, abrir: p.id, nuevo: false,
      titulo: p.nombre, proyecto: { nombre: pr?.project_name || '', cliente: pr?.client_name || '' },
    });
  };
  const crearEnProyecto = (pr) => abrirEditor({
    projectId: pr ? pr.id : null, abrir: null, nuevo: true,
    titulo: pr ? `Plano nuevo · ${pr.project_name}` : 'Plano nuevo',
    proyecto: { nombre: pr?.project_name || '', cliente: pr?.client_name || '' },
  });

  const borrar = async (p) => {
    if (!window.confirm(`¿Borrar el plano "${p.nombre}"? No se puede deshacer.`)) return;
    try { await api.delete(`/medicion/${p.id}`); setPlanos(l => l.filter(x => x.id !== p.id)); }
    catch { setError('No se pudo borrar el plano'); }
  };
  const vincular = async (p, projectId) => {
    try { await api.patch(`/medicion/${p.id}/proyecto`, { project_id: projectId }); cargar(); }
    catch { setError('No se pudo cambiar el proyecto del plano'); }
  };

  // ── Editor a pantalla completa ──
  if (editor) {
    return (
      <div className="ap-section">
        <div className="ap-section-head" style={{ alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={cerrarEditor}><ArrowLeft size={14} /> Volver a Planos</button>
            <h1 style={{ fontSize: '1.15rem' }}>{editor.titulo}</h1>
          </div>
          {editor.projectId
            ? <span style={muted}>Proyecto: {editor.proyecto.cliente} — {editor.proyecto.nombre}</span>
            : <span style={muted}>Plano sin proyecto vinculado</span>}
        </div>
        <MedicionEditor key={`${editor.projectId}-${editor.abrir}-${editor.nuevo}`} projectId={editor.projectId} proyecto={editor.proyecto} abrir={editor.abrir} nuevo={editor.nuevo} altura="calc(100vh - 150px)" />
      </div>
    );
  }

  if (error && !planos) return <div className="ap-section"><p className="ap-error">{error}</p></div>;
  if (!planos) return <div className="ap-section"><div className="ap-loading">Cargando…</div></div>;

  // ── Dashboard ──
  const porProyecto = {};
  planos.forEach(p => { if (p.project_id) (porProyecto[p.project_id] ||= []).push(p); });
  const sueltos = planos.filter(p => !p.project_id);
  const semana = Date.now() - 7 * 86400000;
  const m2Total = planos.reduce((s, p) => s + (p.m2 || 0), 0);
  const equiposTotal = planos.reduce((s, p) => s + (p.equipos || 0), 0);
  const q = busca.trim().toLowerCase();
  const coincide = (txt) => !q || txt.toLowerCase().includes(q);

  let filas = proyectos
    .map(pr => ({ pr, lista: porProyecto[pr.id] || [] }))
    .filter(({ pr, lista }) => coincide(`${pr.client_name} ${pr.project_name} ${lista.map(l => l.nombre).join(' ')}`))
    .filter(({ lista }) => filtro === 'con' ? lista.length > 0 : filtro === 'sin' ? lista.length === 0 : filtro === 'sueltos' ? false : true);
  filas = filas.sort((a, b) => {
    const ua = a.lista[0]?.updated_at || '', ub = b.lista[0]?.updated_at || '';
    if (ua && ub) return ub.localeCompare(ua);
    if (ua || ub) return ua ? -1 : 1;
    return a.pr.client_name.localeCompare(b.pr.client_name);
  });
  const sueltosVis = filtro === 'todos' || filtro === 'sueltos' ? sueltos.filter(p => coincide(`${p.nombre} ${p.cliente}`)) : [];

  return (
    <div className="ap-section">
      <div className="ap-section-head">
        <h1>Planos</h1>
        <button className="ap-btn ap-btn-primary ap-btn-sm" onClick={() => { setNuevoProyecto(''); setNuevoModal(true); }}><Plus size={14} /> Plano nuevo</button>
      </div>
      {error && <p className="ap-error">{error}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 18 }}>
        <Tile valor={planos.length} titulo="Planos" sub={`${planos.filter(p => new Date(p.updated_at).getTime() > semana).length} tocados esta semana`} />
        <Tile valor={Object.keys(porProyecto).length} titulo="Proyectos con plano" sub={`de ${proyectos.length} proyectos`} />
        <Tile valor={m1(m2Total)} titulo="m² medidos" sub="suma de las salas dibujadas" />
        <Tile valor={equiposTotal} titulo="Máquinas colocadas" sub={`${sueltos.length} plano${sueltos.length === 1 ? '' : 's'} sin proyecto`} />
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 360 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 11, opacity: 0.4 }} />
          <input className="ap-field-input" style={{ paddingLeft: 30, width: '100%' }} placeholder="Buscar cliente, proyecto o plano…" value={busca} onChange={e => setBusca(e.target.value)} />
        </div>
        <select className="ap-select ap-select-sm" value={filtro} onChange={e => setFiltro(e.target.value)}>
          <option value="todos">Todos los proyectos</option>
          <option value="con">Con planos</option>
          <option value="sin">Sin planos todavía</option>
          <option value="sueltos">Planos sin proyecto</option>
        </select>
      </div>

      {sueltosVis.length > 0 && (
        <div style={{ ...card, marginBottom: 14 }}>
          <p style={{ fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.4)', margin: '0 0 4px' }}>Sin proyecto</p>
          {sueltosVis.map(p => <FilaPlano key={p.id} p={p} proyectos={proyectos} onAbrir={abrirPlano} onBorrar={borrar} onVincular={vincular} />)}
        </div>
      )}

      {filas.map(({ pr, lista }) => (
        <div key={pr.id} style={{ ...card, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.95rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}><FolderOpen size={14} style={{ opacity: 0.5 }} />{pr.client_name}</div>
              <div style={muted}>{pr.project_name}{lista.length ? ` · ${lista.length} plano${lista.length === 1 ? '' : 's'}` : ' · sin planos todavía'}</div>
            </div>
            <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => crearEnProyecto(pr)}><Plus size={13} /> {lista.length ? 'Otro plano' : 'Crear plano'}</button>
          </div>
          {lista.map(p => <FilaPlano key={p.id} p={p} proyectos={proyectos} onAbrir={abrirPlano} onBorrar={borrar} onVincular={vincular} />)}
        </div>
      ))}

      {!filas.length && !sueltosVis.length && <p style={muted}><Ruler size={13} style={{ verticalAlign: -2 }} /> No hay nada que coincida con ese filtro.</p>}

      {nuevoModal && (
        <div className="ap-modal-overlay" onClick={() => setNuevoModal(false)}>
          <div className="ap-mgr-modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div className="ap-mgr-head"><h2 className="ap-mgr-title">Plano nuevo</h2></div>
            <div className="ap-mgr-body">
              <p style={{ ...muted, marginBottom: 8 }}>¿De qué proyecto es? Puedes dejarlo sin proyecto y vincularlo después.</p>
              <SearchableSelect
                value={nuevoProyecto} onChange={setNuevoProyecto} placeholder="Buscar proyecto…" emptyLabel="Sin proyecto (plano suelto)"
                options={proyectos.map(x => ({ value: x.id, label: `${x.client_name} — ${x.project_name}` }))}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => setNuevoModal(false)}>Cancelar</button>
                <button className="ap-btn ap-btn-primary ap-btn-sm" onClick={() => { setNuevoModal(false); crearEnProyecto(proyectoPorId[nuevoProyecto] || null); }}>Crear y dibujar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
