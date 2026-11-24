import { useState } from 'react';
import api from '../services/api';

const tipoNombre = { bruto: 'Vídeo a cámara · vertical', clips: 'Entrevista → clips', youtube: 'YouTube · horizontal' };
const fallo = e => e.response?.data?.error || e.message || 'No se pudo completar';

export function AprobarFormato({ trabajo, formatos, onGuardado }) {
  const [abierto, setAbierto] = useState(false), [nombre, setNombre] = useState(''), [reglas, setReglas] = useState(''), [ocupado, setOcupado] = useState(false), [error, setError] = useState('');
  if (trabajo.estado !== 'listo' || !(trabajo.resultado || trabajo.resultado_gcs) || !tipoNombre[trabajo.tipo]) return null;
  const guardados = formatos.filter(p => p.trabajo_id === trabajo.id && p.trabajo_version === (trabajo.version || 1));
  const manual = trabajo.receta?.ilustracionesFijas?.length || trabajo.superposiciones_manuales;
  async function guardar(e) {
    e.preventDefault(); setOcupado(true); setError('');
    try { const { data } = await api.post('/estudio-video/aprobados', { trabajo_id: trabajo.id, nombre, reglas }); onGuardado(data.formato); setAbierto(false); }
    catch (e) { setError(fallo(e)); } finally { setOcupado(false); }
  }
  return <div className="rd-card" style={{ marginTop: 8 }}>
    {guardados.length ? <span className="rd-chip verde">Formato guardado: {guardados.map(p => p.nombre).join(', ')}</span> : <>
      <strong>¿Este vídeo ya tiene tu OK?</strong>
      <p style={{ margin: 0 }}>Revísalo y pide los cambios que falten. Solo al aprobarlo guardaremos su configuración para los siguientes vídeos.</p>
      {manual ? <p role="status">Esta versión incluye superposiciones preparadas para este vídeo. Falta validar su generación automática antes de guardar un formato reutilizable.</p> : <button className="rd-btn pri" onClick={() => setAbierto(!abierto)}>Aprobar y guardar formato</button>}
    </>}
    {abierto && <form onSubmit={guardar} style={{ display: 'grid', gap: 12 }}>
      <label>Nombre del formato<input className="ap-input" value={nombre} maxLength={100} onChange={e => setNombre(e.target.value)} placeholder="Ej. A cámara · música suave y ritmo" required style={{ display: 'block', width: '100%' }} /></label>
      <label>Reglas para todos los vídeos de este formato (opcional)<textarea className="ap-input" value={reglas} maxLength={2000} onChange={e => setReglas(e.target.value)} placeholder="Ej. Mantener las ideas completas, tono profesional y sin flashes. Evita instrucciones que solo sirvan para este vídeo." style={{ display: 'block', width: '100%' }} /></label>
      <p style={{ margin: 0 }}>Guardamos ritmo, subtítulos, encuadre, música y efectos. Los cortes, textos e imágenes se decidirán de nuevo según el contenido. Cada nueva aprobación crea un formato independiente.</p>
      <button className="rd-btn pri" disabled={ocupado || !nombre.trim()}>{ocupado ? 'Guardando…' : 'Confirmo mi OK y guardo el formato'}</button>
    </form>}
    {error && <p role="alert">{error}</p>}
  </div>;
}

export function CrearConFormato({ formatos, subirArchivo, onCreado, onPrueba, seleccionado, onSeleccionar }) {
  const [files, setFiles] = useState([]), [ocupado, setOcupado] = useState(false), [progreso, setProgreso] = useState(''), [error, setError] = useState('');
  const p = formatos.find(f => f.id === seleccionado) || formatos[0];
  async function crear(e) {
    e.preventDefault(); if (!p || !files.length) return;
    setOcupado(true); setError('');
    try {
      const fuentes = [];
      for (const f of files) fuentes.push({ nombre: f.name, archivo: await subirArchivo(f, n => setProgreso(f.name + ' · ' + n + '%')) });
      setProgreso('Creando edición…');
      await api.post('/estudio-video/trabajos', { plantilla_id: p.id, ...(p.tipo === 'youtube' ? { fuentes } : { archivo: fuentes[0].archivo }), nombre_archivo: fuentes.map(f => f.nombre).join(', ') });
      setFiles([]); onCreado();
    } catch (e) { setError(fallo(e)); } finally { setOcupado(false); setProgreso(''); }
  }
  return <div className="rd-card">
    <h2 style={{ margin: 0 }}>Subir y editar con mi formato</h2>
    {!p ? <><p>Aún no hay formatos aprobados. Primero hacemos una prueba, revisamos el resultado y guardamos el formato cuando tenga tu OK.</p><button className="rd-btn pri" onClick={onPrueba}>Crear la primera prueba</button></> : <form onSubmit={crear} style={{ display: 'grid', gap: 16 }}>
      <label>1. Formato aprobado<select className="ap-input" disabled={ocupado} value={p.id} onChange={e => { onSeleccionar(e.target.value); setFiles([]); }} style={{ display: 'block', width: '100%' }}>{formatos.map(f => <option key={f.id} value={f.id}>{f.nombre} · {tipoNombre[f.tipo]}</option>)}</select></label>
      <p style={{ margin: 0 }}>{tipoNombre[p.tipo]} · {p.tipo === 'youtube' ? 'Sube entre 1 y 8 vídeos para construir una historia.' : 'Sube un vídeo. Usaremos la configuración aprobada.'}</p>
      <label>2. Material nuevo<input key={p.id} type="file" accept="video/*" multiple={p.tipo === 'youtube'} disabled={ocupado} onChange={e => { const elegidos = Array.from(e.target.files || []); if (elegidos.length > (p.tipo === 'youtube' ? 8 : 1)) { setError('Elige como máximo 8 vídeos.'); setFiles([]); } else { setError(''); setFiles(elegidos); } }} style={{ display: 'block', marginTop: 8 }} /></label>
      <button className="rd-btn pri" disabled={ocupado || !files.length}>{ocupado ? progreso || 'Preparando…' : 'Crear vídeo con este formato'}</button>
      <button type="button" className="rd-btn" disabled={ocupado} onClick={onPrueba}>Quiero probar otro estilo</button>
    </form>}
    {error && <p role="alert">{error}</p>}
  </div>;
}

export function BibliotecaAprobados({ formatos, onUsar, onRevisar }) {
  return <div className="rd-grid">{formatos.length ? formatos.map(p => <div key={p.id} className="rd-card">
    <span className="rd-chip verde">Aprobado · {new Date(p.creado).toLocaleDateString('es-ES')}</span><h3>{p.nombre}</h3><p>{tipoNombre[p.tipo]}</p>
    <p style={{ margin: 0 }}>{p.tipo === 'youtube' ? 'Montaje narrativo horizontal' : `Fuente: ${p.receta?.fuente || 'predeterminada'} · ${p.receta?.flash ? 'Con flashes' : 'Sin flashes'} · ${p.musica === 'ninguna' ? 'Sin música' : 'Con música'}`}</p>
    {p.reglas && <p>{p.reglas}</p>}<button className="rd-btn pri" onClick={() => onUsar(p.id)}>Usar este formato</button><button className="rd-btn" onClick={() => onRevisar(p.trabajo_id)}>Ver vídeo aprobado</button>
  </div>) : <div className="rd-card"><h3>Los formatos aparecerán aquí cuando los apruebes</h3><p>En Pruebas y revisión, abre un vídeo terminado y pulsa «Aprobar y guardar formato».</p></div>}</div>;
}
