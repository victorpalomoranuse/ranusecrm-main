import { useState, useEffect, useCallback } from 'react';
import { History, Plus, Trash2 } from 'lucide-react';
import api from '../services/api';

// Conversaciones guardadas de un asistente de IA. Cada persona ve solo las
// suyas. Se guardan solas tras cada respuesta; aquí se pueden retomar,
// empezar una nueva o borrar.

export function useConversaciones(asistente) {
  const [lista, setLista] = useState([]);
  const [convId, setConvId] = useState(null);
  const [errorConv, setErrorConv] = useState('');

  const cargar = useCallback(() => {
    api.get('/ia-conversaciones', { params: { asistente } })
      .then(r => { setLista(r.data.conversaciones || []); setErrorConv(''); })
      .catch(() => setErrorConv('No se pudieron cargar las conversaciones guardadas'));
  }, [asistente]);
  useEffect(() => { cargar(); }, [cargar]);

  // Guarda la conversación (crea o actualiza) y devuelve los mensajes con los adjuntos ya como enlaces
  const guardar = async (mensajes) => {
    try {
      const { data } = await api.put('/ia-conversaciones', { id: convId, asistente, mensajes });
      setConvId(data.id);
      cargar();
      return data.mensajes;
    } catch { setErrorConv('La respuesta se ha dado, pero no se ha podido guardar la conversación'); return null; }
  };
  const abrir = async (id) => {
    const { data } = await api.get(`/ia-conversaciones/${id}`);
    setConvId(id);
    return data.conversacion.mensajes || [];
  };
  const nueva = () => setConvId(null);
  const borrar = async (id) => {
    await api.delete(`/ia-conversaciones/${id}`);
    if (id === convId) setConvId(null);
    cargar();
  };
  return { lista, convId, guardar, abrir, nueva, borrar, errorConv };
}

const fmt = (iso) => new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export function PanelConversaciones({ conv, onAbrir, onNueva, disabled }) {
  const [abierto, setAbierto] = useState(false);
  const { lista, convId, borrar, errorConv } = conv;

  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => setAbierto(a => !a)}>
          <History size={13} /> Mis conversaciones{lista.length ? ` (${lista.length})` : ''}
        </button>
        <button type="button" className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => { setAbierto(false); onNueva(); }} disabled={disabled}>
          <Plus size={13} /> Nueva conversación
        </button>
        {convId && <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)' }}>Se guarda sola</span>}
      </div>
      {errorConv && <p className="ap-error" style={{ marginTop: 6 }}>{errorConv}</p>}
      {abierto && (
        <div style={{ marginTop: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, maxHeight: 280, overflowY: 'auto' }}>
          {lista.length === 0 && <p style={{ margin: 0, padding: '0.8rem 1rem', fontSize: '0.8rem', color: 'rgba(255,255,255,0.45)' }}>Todavía no hay conversaciones guardadas. Se guardan solas en cuanto el asistente responde.</p>}
          {lista.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.55rem 0.9rem', borderTop: '1px solid rgba(255,255,255,0.05)', background: c.id === convId ? 'rgba(190,176,162,0.14)' : 'transparent' }}>
              <button type="button" onClick={() => { setAbierto(false); onAbrir(c.id); }} disabled={disabled} style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, minWidth: 0 }}>
                <div style={{ fontSize: '0.84rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.titulo || 'Conversación'}</div>
                <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)' }}>{fmt(c.updated_at)}</div>
              </button>
              <button type="button" className="ap-btn-icon" title="Borrar conversación" onClick={() => window.confirm('¿Borrar esta conversación?') && borrar(c.id)}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
