import { createContext, useContext, useState, useEffect } from 'react';
import equipoApi from '../services/equipoApi';

const EquipoAuthContext = createContext(null);

export function EquipoAuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('equipo_user')); } catch { return null; }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('equipo_token');
    if (!token) { setLoading(false); return; }

    equipoApi.post('/auth/verify')
      .then(({ data }) => setUser(data.user))
      .catch(() => {
        localStorage.removeItem('equipo_token');
        localStorage.removeItem('equipo_user');
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const { data } = await equipoApi.post('/auth/login', { email, password });
    localStorage.setItem('equipo_token', data.token);
    localStorage.setItem('equipo_user', JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  };

  const logout = () => {
    localStorage.removeItem('equipo_token');
    localStorage.removeItem('equipo_user');
    setUser(null);
  };

  return (
    <EquipoAuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </EquipoAuthContext.Provider>
  );
}

export const useEquipoAuth = () => useContext(EquipoAuthContext);
