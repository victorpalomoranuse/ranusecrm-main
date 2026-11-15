import { useEffect, useState } from 'react';
import api from '../services/api';
import { Loader2, FileDown, X, Save } from 'lucide-react';

const card = { background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '10px 12px' };
const sel = { background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 7, color: '#fff', padding: '4px 6px', fontSize: '0.78rem' };
const mut = { color: 'rgba(255,255,255,0.55)', fontSize: '0.78rem' };

// Lámina de zonas para el cliente: vista previa, corrección de la clasificación de las máquinas y descarga en PDF
export function LaminaZonasModal({ planoId, onClose }) {
  const [d, setD] = useState(null), [err, setErr] = useState(''), [ocupado, setOcupado] = useState(''), [sucio, setSucio] = useState(false);
  useEffect(() => { let vivo = true; api.get('/lamina-zonas/' + planoId, { timeout: 180000 }).then(r => { if (vivo) setD(r.data); }).catch(e => { if (vivo) setErr(e?.response?.data?.error || 'No se pudo preparar la lámina'); }); return () => { vivo = false; }; }, [planoId]);
  const cambia = (clave, k, v) => { setD(x => ({ ...x, maquinas: x.maquinas.map(m => m.clave === clave ? { ...m, [k]: v } : m) })); setSucio(true); };
  const guarda = async () => { setOcupado('g'); try { const r = await api.put('/lamina-zonas/' + planoId, { maquinas: d.maquinas, titulo: d.titulo, subtitulo: d.subtitulo }); setD(x => ({ ...x, svg: r.data.svg, total: r.data.total, zonas: r.data.zonas })); setSucio(false); } catch (e) { setErr(e?.response?.data?.error || 'No se pudo guardar'); } setOcupado(''); };
  const pdf = async () => { setOcupado('p'); try { if (sucio) await guarda(); const r = await api.post('/lamina-zonas/' + planoId + '/pdf', {}, { responseType: 'blob', timeout: 120000 }); const a = document.createElement('a'); a.href = URL.createObjectURL(r.data); a.download = 'zonas.pdf'; a.click(); } catch (e) { setErr('No se pudo crear el PDF'); } setOcupado(''); };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10050, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#14171c', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, width: 'min(1200px,100%)', maxHeight: '94vh', overflow: 'auto', padding: 18, color: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <b style={{ fontSize: '1.05rem', flex: 1 }}>Lámina de zonas para el cliente</b>
          {d && <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={guarda} disabled={!sucio || !!ocupado}>{ocupado === 'g' ? <Loader2 size={13} /> : <Save size={13} />} Actualizar vista</button>}
          {d && <button className="ap-btn ap-btn-primary ap-btn-sm" onClick={pdf} disabled={!!ocupado}>{ocupado === 'p' ? <Loader2 size={13} /> : <FileDown size={13} />} Descargar PDF</button>}
          <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={onClose}><X size={13} /></button>
        </div>
        {err && <div style={{ ...card, borderColor: '#d9774f', marginBottom: 10 }}>{err}</div>}
        {!d && !err && <div style={mut}>Leyendo las máquinas del plano y clasificándolas (la primera vez tarda unos segundos)…</div>}
        {d && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.7fr) minmax(300px,1fr)', gap: 14, alignItems: 'start' }}>
            <div style={{ background: '#f6f3ee', borderRadius: 12, overflow: 'hidden' }} dangerouslySetInnerHTML={{ __html: d.svg }} />
            <div style={{ display: 'grid', gap: 8 }}>
              <input style={{ ...sel, width: '100%', boxSizing: 'border-box', fontSize: '0.9rem' }} value={d.titulo} onChange={e => { setD({ ...d, titulo: e.target.value }); setSucio(true); }} />
              <input style={{ ...sel, width: '100%', boxSizing: 'border-box' }} placeholder="Subtítulo (p. ej. Planta baja · 200 m²)" value={d.subtitulo} onChange={e => { setD({ ...d, subtitulo: e.target.value }); setSucio(true); }} />
              <div style={mut}>{d.total} máquinas · {d.zonas} zonas. Si alguna está mal clasificada, corrígela aquí y pulsa «Actualizar vista».</div>
              <div style={{ ...card, display: 'grid', gap: 6, maxHeight: 460, overflow: 'auto' }}>
                {d.maquinas.map(m => (
                  <div key={m.clave} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 100px', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: '0.78rem' }}>{m.nombre} <span style={mut}>×{m.cantidad}</span></span>
                    <select style={sel} value={m.tipo} onChange={e => cambia(m.clave, 'tipo', e.target.value)}>{d.tipos.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select>
                    <select style={sel} value={m.grupo} onChange={e => cambia(m.clave, 'grupo', e.target.value)}>{d.grupos.map(g => <option key={g} value={g}>{g}</option>)}</select>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
