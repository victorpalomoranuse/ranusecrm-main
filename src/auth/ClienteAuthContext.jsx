import { createContext, useContext, useState, useEffect } from 'react';
import clienteApi from '../services/clienteApi';

const ClienteAuthContext = createContext(null);

export function ClienteAuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('cliente_user')); } catch { return null; }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('cliente_token');
    if (!token) { setLoading(false); return; }

    clienteApi.post('/auth/verify')
      .then(({ data }) => setUser(data.user))
      .catch(() => {
        localStorage.removeItem('cliente_token');
        localStorage.removeItem('cliente_user');
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const { data } = await clienteApi.post('/auth/login', { email, password });
    localStorage.setItem('cliente_token', data.token);
    localStorage.setItem('cliente_user', JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  };

  const logout = () => {
    localStorage.removeItem('cliente_token');
    localStorage.removeItem('cliente_user');
    setUser(null);
  };

  return (
    <ClienteAuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </ClienteAuthContext.Provider>
  );
}

export const useClienteAuth = () => useContext(ClienteAuthContext);
