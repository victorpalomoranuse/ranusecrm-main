import { useState, useEffect } from 'react';
import { X, Ruler } from 'lucide-react';
import api from '../services/api';

// Vuelca lo medido en Planos (equipos, luminarias y materiales de suelos, techos y paredes)
// a los Listados del proyecto, que es lo que ve el cliente en su historia. Después cada
// elemento se edita como siempre. Volver a traer no pisa lo editado: solo añade lo que falta
// (y, si lo marcas, actualiza la cantidad cuando el plano ha cambiado).

const muted = { fontSize: '0.74rem', color: 'rgba(255,255,255,0.5)' };
const fila = { display: 'flex', gap: 10, alignItems: 'center', padding: '7px 4px', borderTop: '1px solid rgba(255,255,255,0.06)' };

const ETIQUETA = {
  nuevo: { t: 'nuevo', c: '#8bae8f' },
  ya: { t: 'ya está', c: 'rgba(255,255,255,0.4)' },
  distinta: { t: 'cantidad distinta', c: '#f5b748' },
};

export function ImportarDePlanos({ projectId, onClose, onHecho }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [elegidas, setElegidas] = useState({});
  const [enviando, setEnviando] = useState(false);
  const [plano, setPlano] = useState('');

  const cargar = (id) => {
    setDatos(null); setError('');
    api.get(`/importar-planos/${projectId}`, { params: id ? { plano: id } : {} }).then(r => {
      setDatos(r.data);
      setPlano(r.data.plano?.id || '');
      const e = {};
      (r.data.filas || []).forEach(f => { e[f.clave] = f.estado === 'nuevo'; });
      setElegidas(e);
    }).catch(err => setError(err.response?.data?.error || 'No se pudo leer lo medido en los planos'));
  };
  useEffect(() => { cargar(); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const filas = datos?.filas || [];
  const n = filas.filter(f => elegidas[f.clave]).length;
  const grupos = [...new Set(filas.map(f => f.grupo))];

  const volcar = async () => {
    setEnviando(true); setError('');
    try {
      const { data } = await api.post(`/importar-planos/${projectId}`, { plano_id: plano || undefined, claves: filas.filter(f => elegidas[f.clave]).map(f => f.clave) });
      onHecho?.(data);
    } catch (err) { setError(err.response?.data?.error || 'No se pudo volcar al listado'); }
    finally { setEnviando(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10001, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div style={{ background: '#1b1917', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, width: 'min(720px, 100%)', maxHeight: '88vh', overflow: 'auto', padding: '1.1rem 1.2rem' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Ruler size={16} /> Traer desde los planos</strong>
          <button type="button" className="ap-btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <p style={{ ...muted, margin: '6px 0 10px' }}>Lo medido en el plano pasa al listado, que es lo que ve el cliente en su historia. Luego puedes editar cada elemento (foto, marca, notas, orden…). Traer otra vez no pisa lo que hayas editado: solo añade lo que falta.</p>

        {error && <p className="ap-error">{error}</p>}
        {!datos && !error && <p style={muted}>Leyendo el plano…</p>}
        {datos && !datos.plano && <p style={muted}>Este proyecto todavía no tiene un plano guardado con equipamiento o superficies. Dibújalo en la pestaña Planos y guarda.</p>}

        {datos?.planos?.length > 1 && (
          <label style={{ display: 'block', marginBottom: 10 }}>
            <span style={muted}>Plano</span>
            <select className="ap-field-input" style={{ width: '100%' }} value={plano} onChange={e => cargar(e.target.value)}>
              {datos.planos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </label>
        )}

        {datos?.plano && !filas.length && <p style={muted}>En «{datos.plano.nombre}» no hay equipamiento, luminarias ni materiales asignados a suelos, techos o paredes.</p>}

        {grupos.map(g => (
          <div key={g} style={{ marginTop: 12 }}>
            <span style={{ ...muted, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{g}</span>
            {filas.filter(f => f.grupo === g).map(f => {
              const et = ETIQUETA[f.estado];
              return (
                <label key={f.clave} style={{ ...fila, cursor: f.estado === 'ya' ? 'default' : 'pointer', opacity: f.estado === 'ya' ? 0.6 : 1 }}>
                  <input type="checkbox" disabled={f.estado === 'ya'} checked={!!elegidas[f.clave]} onChange={e => setElegidas(x => ({ ...x, [f.clave]: e.target.checked }))} />
                  {f.imagen ? <img src={f.imagen} alt="" style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 6 }} /> : <span style={{ width: 34, height: 34, borderRadius: 6, background: 'rgba(255,255,255,0.06)', flex: 'none' }} />}
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: '0.86rem' }}>{f.nombre}</span>
                    <span style={muted}>{[f.marca, f.catalogo ? '' : 'sin producto en el catálogo'].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span style={{ fontSize: '0.84rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{String(f.cantidad).replace('.', ',')} {f.unidad}</span>
                  <span style={{ fontSize: '0.68rem', color: et.c, minWidth: 92, textAlign: 'right' }}>{et.t}{f.estado === 'distinta' ? ` (listado: ${f.cantidad_listado})` : ''}</span>
                </label>
              );
            })}
          </div>
        ))}

        {filas.some(f => f.estado === 'distinta') && <p style={{ ...muted, marginTop: 10 }}>Si marcas una «cantidad distinta», solo se cambia la cantidad; el resto de lo que hayas editado se queda como está.</p>}

        <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
          <button type="button" className="ap-btn ap-btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="ap-btn ap-btn-primary" disabled={!n || enviando} onClick={volcar}>{enviando ? 'Añadiendo…' : n ? `Añadir ${n} al listado` : 'Nada que añadir'}</button>
        </div>
      </div>
    </div>
  );
}
