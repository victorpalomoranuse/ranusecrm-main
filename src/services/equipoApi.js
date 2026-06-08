import axios from 'axios';

const equipoApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001/api',
});

equipoApi.interceptors.request.use(config => {
  const token = localStorage.getItem('equipo_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

equipoApi.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('equipo_token');
      localStorage.removeItem('equipo_user');
      window.location.href = '/equipo';
    }
    return Promise.reject(err);
  }
);

export default equipoApi;
