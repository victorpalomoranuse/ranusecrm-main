import { useState, useEffect } from 'react';
import api from '../services/api';
import { CheckCircle, AlertCircle } from 'lucide-react';

export function SectionAjustes() {
  const [iban, setIban] = useState('');
  const [bankName, setBankName] = useState('');
  const [paymentMethods, setPaymentMethods] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    api.get('/settings').then(r => {
      const s = r.data.settings || {};
      setIban(s.bank_iban || '');
      setBankName(s.bank_name || '');
      setPaymentMethods(s.payment_methods || '');
      setPaymentNotes(s.payment_notes || '');
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put('/settings', { bank_iban: iban, bank_name: bankName, payment_methods: paymentMethods, payment_notes: paymentNotes });
      setMsg({ type: 'success', text: 'Ajustes guardados' });
    } catch {
      setMsg({ type: 'error', text: 'Error al guardar' });
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(null), 2500);
    }
  };

  return (
    <div className="ap-section">
      <div className="ap-section-head">
        <div><h1>Ajustes</h1><p>Configura los datos que aparecen en tus presupuestos.</p></div>
      </div>

      {loading ? <div className="ap-loading">Cargando…</div> : (
        <form onSubmit={handleSave} style={{ maxWidth: 560 }}>
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '1.5rem', marginBottom: '1.5rem' }}>
            <p style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.3)', marginBottom: '1.25rem' }}>Datos bancarios</p>
            <div className="ap-field">
              <label>Banco / Entidad</label>
              <input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="Ej: CaixaBank" />
            </div>
            <div className="ap-field">
              <label>IBAN</label>
              <input value={iban} onChange={e => setIban(e.target.value)} placeholder="ES00 0000 0000 0000 0000 0000" style={{ fontFamily: 'monospace', letterSpacing: '0.05em' }} />
            </div>
          </div>

          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '1.5rem', marginBottom: '1.5rem' }}>
            <p style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.3)', marginBottom: '1.25rem' }}>Métodos de pago</p>
            <div className="ap-field">
              <label>Métodos aceptados</label>
              <input value={paymentMethods} onChange={e => setPaymentMethods(e.target.value)} placeholder="Ej: Transferencia bancaria, Bizum" />
            </div>
            <div className="ap-field">
              <label>Notas adicionales <span className="ap-optional">(opcional)</span></label>
              <textarea value={paymentNotes} onChange={e => setPaymentNotes(e.target.value)} rows={3} placeholder="Ej: El pago se realizará en dos plazos: 50% al inicio y 50% a la entrega." />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button type="submit" className="ap-btn ap-btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar ajustes'}</button>
            {msg && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: msg.type === 'success' ? '#8bae8f' : '#ae8b8b' }}>
                {msg.type === 'success' ? <CheckCircle size={14}/> : <AlertCircle size={14}/>}
                {msg.text}
              </span>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
