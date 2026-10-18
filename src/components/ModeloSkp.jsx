import { useState, useRef } from 'react';
import api from '../services/api';

// Modelo 3D de SketchUp (.skp) enlazado a un producto del catálogo. El plugin de SketchUp
// lo descarga y lo coloca (centrado, girado y a su altura) donde esté la máquina en el plano.

const mb = (b) => (b / 1048576).toFixed(1).replace('.', ',') + ' MB';

export function ModeloSkp({ product }) {
  const [skp, setSkp] = useState(product?.bloques?.skp || null);
  const [subiendo, setSubiendo] = useState(null); // % de subida
  const [error, setError] = useState('');
  const ref = useRef(null);

  const subir = async (file) => {
    if (!file) return;
    setError(''); setSubiendo(0);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post(`/catalog/products/${product.id}/skp`, fd, {
        timeout: 600000,
        onUploadProgress: (e) => e.total && setSubiendo(Math.round(e.loaded / e.total * 100)),
      });
      setSkp(data.skp);
      if (product.bloques) product.bloques.skp = data.skp; else product.bloques = { skp: data.skp };
    } catch (e) { setError(e.response?.data?.error || 'No se pudo subir el modelo'); }
    finally { setSubiendo(null); if (ref.current) ref.current.value = ''; }
  };
  const girar = async (rot) => {
    try { const { data } = await api.put(`/catalog/products/${product.id}/skp`, { rot }); setSkp(data.skp); if (product.bloques) product.bloques.skp = data.skp; }
    catch { setError('No se pudo cambiar el giro'); }
  };
  const quitar = async () => {
    if (!window.confirm('¿Quitar el modelo 3D de este producto?')) return;
    try { await api.delete(`/catalog/products/${product.id}/skp`); setSkp(null); if (product.bloques) delete product.bloques.skp; }
    catch { setError('No se pudo quitar el modelo'); }
  };

  const nota = { fontSize: '0.72rem', color: 'rgba(255,255,255,0.45)', margin: '4px 0 0', lineHeight: 1.5 };
  return (
    <div className="ap-field">
      <label>Modelo 3D de SketchUp <span className="ap-optional">(opcional)</span></label>
      {skp ? (
        <div style={{ padding: '0.6rem 0.8rem', borderRadius: 10, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)' }}>
          <div style={{ fontSize: '0.82rem' }}>✓ <b>{skp.nombre || 'modelo.skp'}</b>{skp.bytes ? ` · ${mb(skp.bytes)}` : ''}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
            <span style={{ fontSize: '0.74rem' }}>Giro del modelo:</span>
            <select className="ap-select" style={{ width: 'auto' }} value={skp.rot || 0} onChange={e => girar(Number(e.target.value))}>
              {[0, 90, 180, 270].map(g => <option key={g} value={g}>{g}°</option>)}
            </select>
            <button type="button" className="ap-btn ap-btn-ghost ap-btn-xs" onClick={() => ref.current?.click()}>Cambiar archivo</button>
            <button type="button" className="ap-btn ap-btn-ghost ap-btn-xs" onClick={quitar}>Quitar</button>
          </div>
        </div>
      ) : (
        <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => ref.current?.click()} disabled={subiendo != null}>
          {subiendo != null ? `Subiendo… ${subiendo}%` : 'Subir modelo (.skp)'}
        </button>
      )}
      <input ref={ref} type="file" accept=".skp" style={{ display: 'none' }} onChange={e => subir(e.target.files?.[0])} />
      {subiendo != null && skp && <p style={nota}>Subiendo… {subiendo}%</p>}
      {error && <p className="ap-error" style={{ marginTop: 6 }}>{error}</p>}
      <p style={nota}>Al actualizar el plano en SketchUp, cada vez que haya este producto aparecerá este modelo en su sitio (con su giro y su espejo). Si el modelo sale girado, cambia el «giro del modelo». Hasta 60 MB; mejor un modelo ligero.</p>
    </div>
  );
}
