import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { MedicionEditor } from '../components/MedicionProyecto';

// Herramienta de planos a pantalla completa, en su propia pestaña del navegador:
// así se puede tener el CRM abierto en una pestaña y los planos en otra.
// Parámetros: ?proyecto=<id>&abrir=<id del plano>  o  ?proyecto=<id>&nuevo=1  o  ?nuevo=1
export function PlanosEditor() {
  const [q] = useSearchParams();
  const navigate = useNavigate();
  const projectId = q.get('proyecto') || null;
  const abrir = q.get('abrir') || null;
  const nuevo = q.get('nuevo') === '1';
  const [proyecto, setProyecto] = useState(projectId ? null : {});

  useEffect(() => {
    document.title = 'Planos · Ranuse';
    if (!projectId) return;
    let vivo = true;
    api.get('/client-projects').then(r => {
      if (!vivo) return;
      const lista = Array.isArray(r.data) ? r.data : (r.data?.projects || []);
      const pr = lista.find(p => p.id === projectId);
      setProyecto({ nombre: pr?.project_name || '', cliente: pr?.client_name || '', direccion: pr?.client_address || '' });
    }).catch(() => { if (vivo) setProyecto({}); });
    return () => { vivo = false; };
  }, [projectId]);

  const cerrar = () => {
    window.close(); // funciona en pestañas abiertas desde el CRM
    setTimeout(() => navigate('/admin/panel', { replace: true }), 150); // si el navegador no deja cerrarla
  };

  if (!proyecto) return <p style={{ color: 'rgba(255,255,255,0.5)', padding: 16 }}>Cargando…</p>;
  return (
    <MedicionEditor
      key={`${projectId}-${abrir}-${nuevo}`}
      projectId={projectId}
      proyecto={proyecto}
      abrir={abrir}
      nuevo={nuevo}
      fullscreen
      onCerrar={cerrar}
    />
  );
}

// Abre la herramienta en una pestaña nueva. Devuelve false si el navegador bloquea la ventana.
export function abrirPlanosEnPestana({ projectId = null, abrir = null, nuevo = false } = {}) {
  const p = new URLSearchParams();
  if (projectId) p.set('proyecto', projectId);
  if (abrir) p.set('abrir', abrir);
  if (nuevo) p.set('nuevo', '1');
  const w = window.open('/planos/editor' + (p.toString() ? '?' + p.toString() : ''), '_blank');
  return !!w;
}
