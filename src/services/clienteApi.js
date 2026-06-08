import axios from 'axios';

const clienteApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001/api',
});

clienteApi.interceptors.request.use(config => {
  const token = localStorage.getItem('cliente_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

clienteApi.interceptors.response.use(
  res => res,
  err => {
    const isLoginCall = err.config?.url?.includes('/auth/login');
    if (err.response?.status === 401 && !isLoginCall) {
      localStorage.removeItem('cliente_token');
      localStorage.removeItem('cliente_user');
      window.location.href = '/cliente';
    }
    return Promise.reject(err);
  }
);

export default clienteApi;
