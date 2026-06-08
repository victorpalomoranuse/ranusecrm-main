import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEquipoAuth } from '../auth/EquipoAuthContext';
import './EquipoLogin.css';

export function EquipoLogin() {
  const { login } = useEquipoAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(email, password);
      if (user.role !== 'trabajador' && user.role !== 'admin_superior') {
        setError('No tienes acceso al área de equipo.');
        localStorage.removeItem('equipo_token');
        localStorage.removeItem('equipo_user');
        return;
      }
      navigate('/equipo/panel');
    } catch {
      setError('Email o contraseña incorrectos.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="el">
      <div className="el-box">
        <div className="el-logo">
          <img src="/iconoRanuse.ico" alt="Ranuse" />
        </div>
        <h1>Área de equipo</h1>
        <p className="el-sub">Ranuse Design</p>

        <form onSubmit={handleSubmit} className="el-form">
          <div className="el-field">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Email"
              required
              autoFocus
            />
          </div>
          <div className="el-field">
            <label>Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          {error && <p className="el-error">{error}</p>}
          <button type="submit" className="el-btn" disabled={loading}>
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
