import { useEffect, useRef, useState, useCallback } from 'react';
import api from '../services/api';

// Herramienta de planos (public/medicion/index.html) dentro del CRM. Vive en un
// iframe y habla con el CRM por mensajes: aquí se cargan/guardan sus planos y se
// le pasa el catálogo (máquinas e iluminación) para que todos los diseñadores
// usen lo mismo.
//
// - Como pestaña de un proyecto: MedicionProyecto (planos de ese proyecto).
// - Desde la sección Planos: MedicionEditor con un plano concreto, uno nuevo,
//   y con o sin proyecto vinculado.

export function MedicionEditor({ projectId = null, proyecto = {}, abrir = null, nuevo = false, altura = 'calc(100vh - 250px)' }) {
  const frameRef = useRef(null);
  const datos = useRef({ visitas: null, catalogos: null, lista: false });
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);
  const nombreProyecto = proyecto.nombre || '';
  const nombreCliente = proyecto.cliente || '';

  const enviarInit = useCallback(() => {
    const d = datos.current;
    if (!d.lista || !d.visitas || !d.catalogos || !frameRef.current?.contentWindow) return;
    frameRef.current.contentWindow.postMessage({
      src: 'ranuse-crm', type: 'init', tema: 'dark', abrir, nuevo,
      proyecto: { nombre: nombreProyecto, cliente: nombreCliente },
      visitas: d.visitas, maquinas: d.catalogos.maquinas || [], luminarias: d.catalogos.luminarias || [],
    }, window.location.origin);
    setCargando(false);
  }, [abrir, nuevo, nombreProyecto, nombreCliente]);

  useEffect(() => {
    let vivo = true;
    datos.current = { visitas: null, catalogos: null, lista: false };
    const planos = projectId
      ? api.get('/medicion', { params: { project_id: projectId } }).then(r => r.data.mediciones || [])
      : (abrir ? api.get(`/medicion/${abrir}`).then(r => [r.data.plano]) : Promise.resolve([]));
    Promise.all([planos, api.get('/medicion/catalogos')]).then(([p, c]) => {
      if (!vivo) return;
      datos.current.visitas = p;
      datos.current.catalogos = c.data || {};
      enviarInit();
    }).catch(e => { if (vivo) { setError(e.response?.data?.error || 'No se pudo cargar la herramienta de planos'); setCargando(false); } });
    return () => { vivo = false; };
  }, [projectId, abrir, enviarInit]);

  useEffect(() => {
    const responder = (m) => frameRef.current?.contentWindow?.postMessage({ src: 'ranuse-crm', ...m }, window.location.origin);
    const onMsg = async (e) => {
      if (e.origin !== window.location.origin || e.source !== frameRef.current?.contentWindow) return;
      const m = e.data;
      if (!m || m.src !== 'ranuse-medicion') return;
      if (m.type === 'ready') { datos.current.lista = true; enviarInit(); }
      else if (m.type === 'save' && m.visita?.id) {
        try {
          const { data } = await api.put(`/medicion/${m.visita.id}`, { project_id: projectId, data: m.visita });
          responder({ type: 'saved', id: m.visita.id, updated: data.updated });
        } catch (err) { responder({ type: 'error', message: err.response?.data?.error || 'No se pudo guardar en el CRM' }); }
      } else if (m.type === 'subir-pdf' && m.bytes) {
        if (!projectId) { responder({ type: 'error', message: 'Vincula este plano a un proyecto para subir el PDF a sus Documentos' }); return; }
        try {
          const form = new FormData();
          form.append('file', new Blob([m.bytes], { type: 'application/pdf' }), m.filename || 'planos.pdf');
          form.append('name', m.nombre || m.filename || 'Planos');
          form.append('doc_type', 'plano');
          await api.post(`/client-projects/${projectId}/documents`, form);
          responder({ type: 'info', message: 'PDF guardado en Documentos del proyecto' });
        } catch (err) { responder({ type: 'error', message: err.response?.data?.error || 'No se pudo subir el PDF' }); }
      } else if (m.type === 'delete' && m.id) {
        try { await api.delete(`/medicion/${m.id}`); responder({ type: 'deleted', id: m.id }); }
        catch (err) { responder({ type: 'error', message: err.response?.data?.error || 'No se pudo borrar' }); }
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [projectId, enviarInit]);

  return (
    <div>
      {error && <p className="ap-error">{error}</p>}
      {cargando && !error && <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.45)' }}>Cargando herramienta…</p>}
      <iframe
        ref={frameRef}
        title="Planos"
        src="/medicion/index.html"
        style={{ width: '100%', height: altura, minHeight: 620, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, background: '#151311' }}
      />
    </div>
  );
}

// Pestaña "Planos" dentro de un proyecto
export function MedicionProyecto({ project }) {
  return (
    <div>
      <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.5)', margin: '0 0 0.6rem' }}>
        Dibuja el plano, mide la sala, marca demoliciones, distribución, suelos, techos, iluminación y electricidad, y descarga las láminas en PDF.
        Se guarda solo en este proyecto y usa el catálogo del CRM (equipamiento e iluminación). También lo ves junto al resto en la sección Planos.
      </p>
      <MedicionEditor projectId={project.id} proyecto={{ nombre: project.project_name, cliente: project.client_name }} />
    </div>
  );
}
