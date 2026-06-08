import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useClienteAuth } from '../auth/ClienteAuthContext';
import './ClienteLogin.css';

export function ClienteLogin() {
  const { login } = useClienteAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(email, password);
      if (user.role !== 'cliente') {
        setError('Esta cuenta no es de cliente.');
        localStorage.removeItem('cliente_token');
        localStorage.removeItem('cliente_user');
        return;
      }
      navigate('/cliente/panel');
    } catch {
      setError('Email o contraseña incorrectos.');
    } finally {
      setLoading(false);
    }
  };

  const handleCode = (e) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (trimmed.length < 4) return;
    navigate(`/mi-proyecto?code=${encodeURIComponent(trimmed)}`);
  };

  const switchTab = (t) => { setTab(t); setError(''); };

  return (
    <div className="cl">
      <div className="cl-box">
        <div className="cl-logo">
          <img src="/iconoRanuse.ico" alt="Ranuse" />
        </div>
        <h1>Área de clientes</h1>
        <p className="cl-sub">Ranuse Design</p>

        <div className="cl-tabs">
          <button
            className={`cl-tab${tab === 'login' ? ' active' : ''}`}
            onClick={() => switchTab('login')}
          >
            Iniciar sesión
          </button>
          <button
            className={`cl-tab${tab === 'codigo' ? ' active' : ''}`}
            onClick={() => switchTab('codigo')}
          >
            Código de acceso
          </button>
        </div>

        {tab === 'login' && (
          <form onSubmit={handleLogin} className="cl-form">
            <div className="cl-field">
              <label>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="tu@email.com"
                required
                autoFocus
              />
            </div>
            <div className="cl-field">
              <label>Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            {error && <p className="cl-error">{error}</p>}
            <button type="submit" className="cl-btn" disabled={loading}>
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
        )}

        {tab === 'codigo' && (
          <form onSubmit={handleCode} className="cl-form">
            <div className="cl-field">
              <label>Código de acceso</label>
              <input
                type="text"
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase())}
                placeholder="XXXXXXXX"
                maxLength={16}
                autoFocus
                autoComplete="off"
                spellCheck={false}
              />
              <span className="cl-hint">Tu diseñador te ha proporcionado este código.</span>
            </div>
            {error && <p className="cl-error">{error}</p>}
            <button type="submit" className="cl-btn" disabled={code.trim().length < 4}>
              Entrar
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
