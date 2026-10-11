import { useEffect, useRef, useState } from 'react';
import api from '../services/api';

// Editor de bloques de un producto del catálogo (public/bloques/index.html):
// se dibuja su planta, alzado y lateral a escala (con la foto de fondo si hay,
// y trazado automático de la silueta). Se guarda en el producto y la
// herramienta de planos usa la planta al colocar la máquina.

function fotoComoDataUri(url) {
  return fetch(url).then(r => { if (!r.ok) throw new Error('foto'); return r.blob(); }).then(blob => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  }));
}

export function BloqueEditor({ product, onClose, onSaved }) {
  const frameRef = useRef(null);
  const foto = useRef(null);
  const [fotoLista, setFotoLista] = useState(!product.photo_url);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    let vivo = true;
    if (product.photo_url) {
      fotoComoDataUri(product.photo_url).then(u => { if (vivo) { foto.current = u; setFotoLista(true); } })
        .catch(() => { if (vivo) setFotoLista(true); }); // sin foto: se puede subir desde el editor
    }
    return () => { vivo = false; };
  }, [product.photo_url]);

  useEffect(() => {
    if (!listo || !fotoLista) return;
    frameRef.current?.contentWindow?.postMessage({
      src: 'ranuse-crm', type: 'init', id: product.id, nombre: product.name,
      largo: product.longitud, fondo: product.ancho, alto: product.altura,
      bloques: product.bloques || null, foto: foto.current,
    }, window.location.origin);
  }, [listo, fotoLista, product]);

  useEffect(() => {
    const responder = (m) => frameRef.current?.contentWindow?.postMessage({ src: 'ranuse-crm', ...m }, window.location.origin);
    const onMsg = async (e) => {
      if (e.origin !== window.location.origin || e.source !== frameRef.current?.contentWindow) return;
      const m = e.data;
      if (!m || m.src !== 'ranuse-bloques') return;
      if (m.type === 'ready') setListo(true);
      else if (m.type === 'cerrar') onClose();
      else if (m.type === 'guardar' && m.datos) {
        try {
          const { data } = await api.put(`/catalog/products/${product.id}/bloques`, m.datos);
          responder({ type: 'guardado' });
          onSaved?.(data.product);
        } catch (err) { responder({ type: 'error', message: err.response?.data?.error || 'No se pudo guardar el bloque' }); }
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [product.id, onClose, onSaved]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10001, background: '#07090c' }} onClick={e => e.stopPropagation()}>
      <iframe ref={frameRef} title={`Bloques de ${product.name}`} src="/bloques/index.html" style={{ width: '100%', height: '100%', border: 0, display: 'block' }} />
    </div>
  );
}
