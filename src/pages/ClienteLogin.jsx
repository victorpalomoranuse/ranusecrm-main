import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useClienteAuth } from '../auth/ClienteAuthContext';
import clienteApi from '../services/clienteApi';
import './ClienteLogin.css';

export function ClienteLogin() {
  const { login, register } = useClienteAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('login');
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
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

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    if (!nombre.trim()) { setError('Indica tu nombre.'); return; }
    if (password.length < 6) { setError('La contraseña debe tener al menos 6 caracteres.'); return; }
    setLoading(true);
    try {
      await register(nombre, email, password);
      navigate('/cliente/panel');
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo crear la cuenta.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e) => {
    e.preventDefault();
    setError('');
    setAviso('');
    setLoading(true);
    try {
      const { data } = await clienteApi.post('/auth/forgot-password', { email });
      setAviso(data.message);
    } catch {
      setAviso('Si ese email tiene una cuenta, te hemos enviado un enlace para restablecer la contraseña.');
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

  const switchTab = (t) => { setTab(t); setError(''); setAviso(''); };

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
            className={`cl-tab${tab === 'registro' ? ' active' : ''}`}
            onClick={() => switchTab('registro')}
          >
            Crear cuenta
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
            <button type="button" className="cl-link" onClick={() => switchTab('olvide')}>
              ¿Olvidaste tu contraseña?
            </button>
          </form>
        )}

        {tab === 'registro' && (
          <form onSubmit={handleRegister} className="cl-form">
            <div className="cl-field">
              <label>Nombre</label>
              <input
                type="text"
                value={nombre}
                onChange={e => setNombre(e.target.value)}
                placeholder="Tu nombre"
                required
                autoFocus
              />
            </div>
            <div className="cl-field">
              <label>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="tu@email.com"
                required
              />
            </div>
            <div className="cl-field">
              <label>Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Al menos 6 caracteres"
                required
                minLength={6}
              />
            </div>
            {error && <p className="cl-error">{error}</p>}
            <button type="submit" className="cl-btn" disabled={loading}>
              {loading ? 'Creando cuenta...' : 'Crear cuenta'}
            </button>
          </form>
        )}

        {tab === 'olvide' && (
          aviso ? (
            <div className="cl-form">
              <p className="cl-hint">{aviso}</p>
              <button type="button" className="cl-btn" onClick={() => switchTab('login')}>
                Volver a iniciar sesión
              </button>
            </div>
          ) : (
            <form onSubmit={handleForgot} className="cl-form">
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
                <span className="cl-hint">Te mandaremos un enlace para elegir una contraseña nueva.</span>
              </div>
              {error && <p className="cl-error">{error}</p>}
              <button type="submit" className="cl-btn" disabled={loading}>
                {loading ? 'Enviando...' : 'Enviar enlace'}
              </button>
              <button type="button" className="cl-link" onClick={() => switchTab('login')}>
                Volver a iniciar sesión
              </button>
            </form>
          )
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
