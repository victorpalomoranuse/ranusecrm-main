import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import clienteApi from '../services/clienteApi';
import './ClienteLogin.css';

export function RestablecerContrasena() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) { setError('La contraseña debe tener al menos 6 caracteres.'); return; }
    if (password !== password2) { setError('Las dos contraseñas no coinciden.'); return; }
    setLoading(true);
    try {
      await clienteApi.post('/auth/reset-password', { token, password });
      setOk(true);
    } catch (err) {
      setError(err.response?.data?.error || 'El enlace no es válido o ha caducado.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="cl">
      <div className="cl-box">
        <div className="cl-logo">
          <img src="/iconoRanuse.ico" alt="Ranuse" />
        </div>
        <h1>Restablecer contraseña</h1>
        <p className="cl-sub">Ranuse Design</p>

        {!token ? (
          <p className="cl-error">Este enlace no es válido. Pide uno nuevo desde "¿Olvidaste tu contraseña?".</p>
        ) : ok ? (
          <div className="cl-form">
            <p className="cl-hint">Tu contraseña se ha actualizado. Ya puedes iniciar sesión con ella.</p>
            <button type="button" className="cl-btn" onClick={() => navigate('/cliente')}>
              Ir a iniciar sesión
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="cl-form">
            <div className="cl-field">
              <label>Nueva contraseña</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Al menos 6 caracteres"
                required
                minLength={6}
                autoFocus
              />
            </div>
            <div className="cl-field">
              <label>Repite la contraseña</label>
              <input
                type="password"
                value={password2}
                onChange={e => setPassword2(e.target.value)}
                placeholder="Repite la contraseña"
                required
                minLength={6}
              />
            </div>
            {error && <p className="cl-error">{error}</p>}
            <button type="submit" className="cl-btn" disabled={loading}>
              {loading ? 'Guardando...' : 'Guardar nueva contraseña'}
            </button>
          </form>
        )}

        <p className="cl-hint" style={{ marginTop: 16 }}>
          <Link to="/cliente" style={{ color: 'inherit' }}>Volver a iniciar sesión</Link>
        </p>
      </div>
    </div>
  );
}
