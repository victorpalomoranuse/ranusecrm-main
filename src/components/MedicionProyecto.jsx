import { useEffect, useRef, useState, useCallback } from 'react';
import api from '../services/api';

// Herramienta de medición en obra (public/medicion/index.html) dentro de un
// proyecto. La herramienta vive en un iframe y habla con el CRM por mensajes:
// aquí se cargan/guardan sus mediciones y se le pasa el catálogo (máquinas e
// iluminación) para que todos los diseñadores usen lo mismo.

export function MedicionProyecto({ project }) {
  const frameRef = useRef(null);
  const datos = useRef({ visitas: null, catalogos: null, lista: false });
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);

  const enviarInit = useCallback(() => {
    const d = datos.current;
    if (!d.lista || !d.visitas || !d.catalogos || !frameRef.current?.contentWindow) return;
    frameRef.current.contentWindow.postMessage({
      src: 'ranuse-crm', type: 'init', tema: 'dark',
      proyecto: { nombre: project.project_name || '', cliente: project.client_name || '' },
      visitas: d.visitas, maquinas: d.catalogos.maquinas || [], luminarias: d.catalogos.luminarias || [],
    }, window.location.origin);
    setCargando(false);
  }, [project.project_name, project.client_name]);

  useEffect(() => {
    let vivo = true;
    datos.current = { visitas: null, catalogos: null, lista: false };
    Promise.all([
      api.get('/medicion', { params: { project_id: project.id } }),
      api.get('/medicion/catalogos'),
    ]).then(([m, c]) => {
      if (!vivo) return;
      datos.current.visitas = m.data.mediciones || [];
      datos.current.catalogos = c.data || {};
      enviarInit();
    }).catch(e => { if (vivo) { setError(e.response?.data?.error || 'No se pudo cargar la herramienta de medición'); setCargando(false); } });
    return () => { vivo = false; };
  }, [project.id, enviarInit]);

  useEffect(() => {
    const responder = (m) => frameRef.current?.contentWindow?.postMessage({ src: 'ranuse-crm', ...m }, window.location.origin);
    const onMsg = async (e) => {
      if (e.origin !== window.location.origin || e.source !== frameRef.current?.contentWindow) return;
      const m = e.data;
      if (!m || m.src !== 'ranuse-medicion') return;
      if (m.type === 'ready') { datos.current.lista = true; enviarInit(); }
      else if (m.type === 'save' && m.visita?.id) {
        try {
          const { data } = await api.put(`/medicion/${m.visita.id}`, { project_id: project.id, data: m.visita });
          responder({ type: 'saved', id: m.visita.id, updated: data.updated });
        } catch (err) { responder({ type: 'error', message: err.response?.data?.error || 'No se pudo guardar en el CRM' }); }
      } else if (m.type === 'delete' && m.id) {
        try { await api.delete(`/medicion/${m.id}`); responder({ type: 'deleted', id: m.id }); }
        catch (err) { responder({ type: 'error', message: err.response?.data?.error || 'No se pudo borrar' }); }
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [project.id, enviarInit]);

  return (
    <div>
      <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.5)', margin: '0 0 0.6rem' }}>
        Dibuja el plano, mide la sala, marca demoliciones, distribución, suelos, techos, iluminación y electricidad, y descarga las láminas en PDF.
        Se guarda solo en este proyecto y usa el catálogo del CRM (equipamiento e iluminación).
      </p>
      {error && <p className="ap-error">{error}</p>}
      {cargando && !error && <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.45)' }}>Cargando herramienta…</p>}
      <iframe
        ref={frameRef}
        title="Planos del proyecto"
        src="/medicion/index.html"
        style={{ width: '100%', height: 'calc(100vh - 250px)', minHeight: 620, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, background: '#151311' }}
      />
    </div>
  );
}
