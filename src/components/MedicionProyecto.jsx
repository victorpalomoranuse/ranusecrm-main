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

export function MedicionEditor({ projectId = null, proyecto = {}, abrir = null, nuevo = false, altura = 'calc(100vh - 250px)', fullscreen = false, onAmpliar, onCerrar }) {
  const frameRef = useRef(null);
  const datos = useRef({ visitas: null, catalogos: null, lista: false });
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);
  const fullRef = useRef(fullscreen);
  useEffect(() => {
    fullRef.current = fullscreen;
    frameRef.current?.contentWindow?.postMessage({ src: 'ranuse-crm', type: 'modo', fullscreen }, window.location.origin);
  }, [fullscreen]);
  const nombreProyecto = proyecto.nombre || '';
  const nombreCliente = proyecto.cliente || '';
  const direccionProyecto = proyecto.direccion || '';

  const enviarInit = useCallback(() => {
    const d = datos.current;
    if (!d.lista || !d.visitas || !d.catalogos || !frameRef.current?.contentWindow) return;
    frameRef.current.contentWindow.postMessage({
      src: 'ranuse-crm', type: 'init', tema: 'dark', abrir, nuevo, fullscreen: fullRef.current,
      proyecto: { nombre: nombreProyecto, cliente: nombreCliente, direccion: direccionProyecto },
      admin: !!d.catalogos.admin,
      visitas: d.visitas, maquinas: d.catalogos.maquinas || [], luminarias: d.catalogos.luminarias || [], materiales: d.catalogos.materiales || [],
    }, window.location.origin);
    setCargando(false);
  }, [abrir, nuevo, nombreProyecto, nombreCliente, direccionProyecto]);

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
      else if (m.type === 'pedirEnlaceSketchup' && m.id) {
        try { const { data } = await api.post(`/medicion/${m.id}/sketchup`); responder({ type: 'enlaceSketchup', url: data.url }); }
        catch (err) { responder({ type: 'enlaceSketchup', message: err.response?.data?.error || 'No se pudo crear el enlace' }); }
      }
      else if (m.type === 'pedirBloque' && m.id) {
        try { const { data } = await api.get(`/medicion/bloque/${m.id}`); responder({ type: 'bloque', id: m.id, bloque: data.bloque }); }
        catch { responder({ type: 'error', message: 'No se pudo cargar el bloque de ese producto' }); }
      }
      else if (m.type === 'guardarBiblioteca' && Array.isArray(m.items)) {
        try { const { data } = await api.post('/medicion/biblioteca', { items: m.items }); responder({ type: 'biblioteca', items: data.items || [] }); }
        catch (err) { responder({ type: 'error', message: err.response?.data?.error || 'No se pudieron guardar los bloques' }); }
      }
      else if (m.type === 'generarBloque' && typeof m.imagen === 'string') {
        try {
          const { data } = await api.post('/medicion/bloque-ia', { imagen: m.imagen, largo: m.largo, fondo: m.fondo, alto: m.alto, nombre: m.nombre }, { timeout: 600000 });
          responder({ type: 'bloqueGenerado', bloque: data.bloque });
        } catch (err) { responder({ type: 'bloqueError', message: err.response?.data?.error || 'No se pudo generar el bloque' }); }
      }
      else if (m.type === 'generarBloqueProducto' && m.id) {
        try {
          const { data } = await api.post(`/catalog/products/${m.id}/bloques/generar`, { largo: m.largo, fondo: m.fondo, alto: m.alto }, { timeout: 600000 });
          const b = data.bloque;
          await api.put(`/catalog/products/${m.id}/bloques`, { largo: b.largo, fondo: b.fondo, alto: b.alto, shapes: b.shapes, svg: b.svg });
          responder({ type: 'bloqueProducto', id: m.id, bloque: { largo: b.largo, fondo: b.fondo, alto: b.alto, svg: b.svg } });
        } catch (err) { responder({ type: 'bloqueProductoError', id: m.id, message: err.response?.data?.error || 'No se pudo generar el bloque' }); }
      }
      else if (m.type === 'guardarBloqueProducto' && m.id && m.planta) {
        try {
          const svg = { planta: m.planta, alzado: m.alzado || '', lateral: m.lateral || '' };
          await api.put(`/catalog/products/${m.id}/bloques`, { largo: m.largo, fondo: m.fondo, alto: m.alto, shapes: null, svg });
          responder({ type: 'bloqueProducto', id: m.id, bloque: { largo: m.largo, fondo: m.fondo, alto: m.alto, svg } });
        } catch (err) { responder({ type: 'bloqueProductoError', id: m.id, message: err.response?.data?.error || 'No se pudo guardar el bloque en el producto' }); }
      }
      else if (m.type === 'pedirMiniaturas' && Array.isArray(m.ids)) {
        try { const { data } = await api.post('/medicion/miniaturas', { ids: m.ids }); responder({ type: 'miniaturas', items: data.items || {} }); }
        catch { /* sin fotos: la memoria sale igualmente */ }
      }
      else if (m.type === 'actualizarBiblioteca' && m.id) {
        try {
          const { data } = await api.patch(`/medicion/biblioteca/${String(m.id).replace(/^bib-/, '')}`, { categoria: m.categoria, nombre: m.nombre });
          responder({ type: 'bibliotecaActualizada', id: data.id, categoria: data.categoria, nombre: data.nombre });
        } catch (err) { responder({ type: 'error', message: err.response?.data?.error || 'No se pudo guardar el cambio' }); }
      }
      else if (m.type === 'borrarBiblioteca' && m.id) {
        try { await api.delete(`/medicion/biblioteca/${String(m.id).replace(/^bib-/, '')}`); responder({ type: 'bibliotecaBorrada', id: m.id }); }
        catch (err) { responder({ type: 'error', message: err.response?.data?.error || 'No se pudo quitar de la biblioteca' }); }
      }
      else if (m.type === 'ampliar') onAmpliar?.();
      else if (m.type === 'cerrar') onCerrar?.();
      else if (m.type === 'save' && m.visita?.id) {
        try {
          const { data } = await api.put(`/medicion/${m.visita.id}`, { project_id: projectId, data: m.visita });
          responder({ type: 'saved', id: m.visita.id, updated: data.updated });
        } catch (err) { responder({ type: 'error', message: err.response?.data?.error || 'No se pudo guardar en el CRM' }); }
      } else if (m.type === 'publicar-historia' && m.imagen && m.titulo) {
        if (!projectId) { responder({ type: 'error', message: 'Vincula este plano a un proyecto para publicarlo en su historia' }); return; }
        try {
          const blob = await (await fetch(m.imagen)).blob();
          const form = new FormData();
          form.append('file', blob, `plano-${String(m.titulo).toLowerCase().replace(/[^a-z0-9]+/g, '-')}.jpg`);
          const { data: up } = await api.post(`/historia/${projectId}/subir`, form);
          const { data: h } = await api.get(`/historia/${projectId}`);
          if (!(h.capitulos || []).length) { responder({ type: 'error', message: 'Este proyecto aún no tiene historia: créala primero en la pestaña de Historia' }); return; }
          let cap = (h.capitulos || []).find(c => /entendemos el espacio/i.test(c.titulo));
          if (!cap) {
            const r = await api.post(`/historia/${projectId}/capitulos`, { titulo: 'Entendemos el espacio' });
            cap = r.data.capitulo;
            await api.put(`/historia/${projectId}/capitulos/orden`, { ids: [cap.id, ...(h.capitulos || []).map(c => c.id)] });
          }
          const existente = (h.bloques || []).find(b => b.capitulo_id === cap.id && b.tipo === 'plano' && b.titulo === m.titulo);
          if (existente) await api.put(`/historia/bloques/${existente.id}`, { imagen_url: up.url });
          else await api.post(`/historia/capitulos/${cap.id}/bloques`, { tipo: 'plano', titulo: m.titulo, imagen_url: up.url });
          responder({ type: 'info', message: `«${m.titulo}» publicado en la historia, en «Entendemos el espacio»` });
        } catch (err) { responder({ type: 'error', message: err.response?.data?.error || 'No se pudo publicar en la historia' }); }
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
  }, [projectId, enviarInit, onAmpliar, onCerrar]);

  return (
    <div style={fullscreen ? { position: 'fixed', inset: 0, zIndex: 10000, background: '#07090c' } : undefined}>
      {error && <p className="ap-error" style={fullscreen ? { position: 'absolute', top: 8, left: 8, zIndex: 2 } : undefined}>{error}</p>}
      {cargando && !error && <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.45)' }}>Cargando herramienta…</p>}
      <iframe
        ref={frameRef}
        title="Planos"
        src="/medicion/index.html"
        style={fullscreen ? { width: '100%', height: '100%', border: 0, display: 'block', background: '#07090c' } : { width: '100%', height: altura, minHeight: 620, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, background: '#151311' }}
      />
    </div>
  );
}

// Pestaña "Planos" dentro de un proyecto
export function MedicionProyecto({ project }) {
  const [ampliado, setAmpliado] = useState(false);
  // «Ampliar» abre la herramienta en una pestaña nueva (si el navegador la bloquea, se amplía aquí)
  const ampliar = useCallback(() => {
    const p = new URLSearchParams({ proyecto: project.id });
    if (!window.open('/planos/editor?' + p.toString(), '_blank')) setAmpliado(true);
  }, [project.id]);
  const cerrar = useCallback(() => setAmpliado(false), []);
  return (
    <div>
      <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.5)', margin: '0 0 0.6rem' }}>
        Dibuja el plano, mide la sala, marca demoliciones, distribución, suelos, techos, iluminación y electricidad, y descarga las láminas en PDF.
        Se guarda solo en este proyecto y usa el catálogo del CRM (equipamiento e iluminación). También lo ves junto al resto en la sección Planos.
      </p>
      <div style={{ margin: '0 0 0.6rem' }}>
        <button type="button" className="ap-btn ap-btn-ghost" onClick={ampliar}>Abrir los planos en una pestaña nueva ↗</button>
      </div>
      <MedicionEditor projectId={project.id} proyecto={{ nombre: project.project_name, cliente: project.client_name, direccion: project.client_address || '' }} fullscreen={ampliado} onAmpliar={ampliar} onCerrar={cerrar} />
    </div>
  );
}
