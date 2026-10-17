import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import api from '../services/api';

// Subir fotos del estado actual desde el móvil sin entrar al CRM: el enlace lleva el
// código del proyecto (/subir/CODIGO). Hacer foto o elegir de la galería, se reducen
// y se suben solas a «Necesidades → fotos del estado actual».

const ZONAS = ['Entrada', 'Garaje', 'Sótano', 'Zona de entreno', 'Techo', 'Suelo', 'Paredes', 'Instalaciones', 'Ventanas', 'Medidas / croquis'];

async function reducir(file) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    if (blob && blob.size < file.size) return new File([blob], (file.name || 'foto').replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch { /* se sube el original */ }
  return file;
}

const css = {
  page: { minHeight: '100vh', background: '#0b0b0d', color: '#f3efe9', fontFamily: 'Montserrat, system-ui, sans-serif', padding: '18px 16px 40px', maxWidth: 520, margin: '0 auto' },
  btn: { display: 'block', width: '100%', padding: '18px 14px', borderRadius: 14, border: 'none', fontSize: '1.05rem', fontWeight: 700, cursor: 'pointer', marginBottom: 12 },
};

export function SubirFotos() {
  const { code } = useParams();
  const [proyecto, setProyecto] = useState(null);
  const [error, setError] = useState('');
  const [zona, setZona] = useState('');
  const [items, setItems] = useState([]); // { id, uri, estado: 'subiendo' | 'ok' | 'error', file }
  const cam = useRef(null), gal = useRef(null);

  useEffect(() => {
    api.get(`/needs-form/public/${code}/resumen`).then(r => setProyecto(r.data)).catch(() => setError('Este enlace no es válido. Pide uno nuevo en el CRM.'));
  }, [code]);

  const subir = async (it) => {
    setItems(l => l.map(x => x.id === it.id ? { ...x, estado: 'subiendo' } : x));
    try {
      const f = await reducir(it.file);
      const fd = new FormData();
      fd.append('file', f);
      if (it.zona) fd.append('caption', it.zona);
      await api.post(`/needs-form/public/${code}/photos`, fd, { timeout: 120000 });
      setItems(l => l.map(x => x.id === it.id ? { ...x, estado: 'ok' } : x));
    } catch {
      setItems(l => l.map(x => x.id === it.id ? { ...x, estado: 'error' } : x));
    }
  };

  const elegir = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    const nuevos = files.map((file, i) => ({ id: Date.now() + '-' + i, file, uri: URL.createObjectURL(file), estado: 'subiendo', zona: zona.trim() }));
    setItems(l => [...nuevos, ...l]);
    for (const it of nuevos) await subir(it); // de una en una: con poca cobertura es más fiable
  };

  const ok = items.filter(i => i.estado === 'ok').length, fallos = items.filter(i => i.estado === 'error');

  if (error) return <div style={css.page}><p style={{ color: '#f87171' }}>{error}</p></div>;
  return (
    <div style={css.page}>
      <p style={{ fontSize: '0.7rem', letterSpacing: '0.2em', color: '#baafa5', margin: 0 }}>RANUSE DESIGN · FOTOS DEL ESPACIO</p>
      <h1 style={{ fontSize: '1.35rem', margin: '6px 0 4px' }}>{proyecto ? proyecto.nombre : 'Cargando…'}</h1>
      <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.55)', margin: '0 0 18px' }}>Las fotos se guardan solas en el proyecto (Necesidades → estado actual).</p>

      <label style={{ fontSize: '0.72rem', color: '#baafa5' }}>¿Qué zona es? (opcional, se pone a las siguientes fotos)</label>
      <input list="zonas" value={zona} onChange={e => setZona(e.target.value)} placeholder="Garaje, techo, entrada…" style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: '#17171a', color: '#fff', fontSize: '1rem', margin: '6px 0 16px' }} />
      <datalist id="zonas">{ZONAS.map(z => <option key={z} value={z} />)}</datalist>

      <button type="button" style={{ ...css.btn, background: '#baafa5', color: '#111' }} onClick={() => cam.current?.click()}>📷 Hacer una foto</button>
      <button type="button" style={{ ...css.btn, background: '#26262b', color: '#fff' }} onClick={() => gal.current?.click()}>🖼️ Elegir de la galería</button>
      <input ref={cam} type="file" accept="image/*" capture="environment" onChange={elegir} style={{ display: 'none' }} />
      <input ref={gal} type="file" accept="image/*" multiple onChange={elegir} style={{ display: 'none' }} />

      {items.length > 0 && (
        <p style={{ fontSize: '0.85rem', margin: '4px 0 10px' }}>
          <b>{ok}</b> de {items.length} fotos subidas{items.some(i => i.estado === 'subiendo') ? ' · subiendo…' : ''}
          {fallos.length > 0 && <button type="button" onClick={() => fallos.forEach(subir)} style={{ marginLeft: 10, padding: '4px 10px', borderRadius: 8, border: '1px solid #f87171', background: 'none', color: '#f87171', cursor: 'pointer' }}>Reintentar {fallos.length}</button>}
        </p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {items.map(i => (
          <div key={i.id} style={{ position: 'relative', aspectRatio: '1', borderRadius: 10, overflow: 'hidden', background: '#17171a' }}>
            <img src={i.uri} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: i.estado === 'ok' ? 1 : 0.5 }} />
            <span style={{ position: 'absolute', right: 6, bottom: 6, fontSize: '0.7rem', padding: '2px 7px', borderRadius: 20, background: i.estado === 'ok' ? '#16a34a' : i.estado === 'error' ? '#dc2626' : '#444', color: '#fff' }}>
              {i.estado === 'ok' ? '✓' : i.estado === 'error' ? 'Error' : '…'}
            </span>
          </div>
        ))}
      </div>
      <p style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', marginTop: 24, lineHeight: 1.5 }}>
        Consejo: en el iPhone, pulsa Compartir → «Añadir a pantalla de inicio» y tendrás un icono para abrir esto directamente.
      </p>
    </div>
  );
}
