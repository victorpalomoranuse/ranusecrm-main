import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { AdminAuthProvider, useAdminAuth } from './auth/AdminAuthContext';
import { EquipoAuthProvider, useEquipoAuth } from './auth/EquipoAuthContext';
import { ClienteAuthProvider, useClienteAuth } from './auth/ClienteAuthContext';
import { Home } from './pages/Home';
import { Proyectos } from './pages/Proyectos';
import { ProjectGallery } from './pages/ProjectGallery';
import { AdminLogin } from './pages/AdminLogin';
import { AdminPanel } from './pages/AdminPanel';
import { EquipoLogin } from './pages/EquipoLogin';
import { EquipoPanel } from './pages/EquipoPanel';
import { MiProyecto } from './pages/MiProyecto';
import { ClienteLogin } from './pages/ClienteLogin';
import { ClientePanel } from './pages/ClientePanel';
import { RestablecerContrasena } from './pages/RestablecerContrasena';
import { PlanosEditor } from './pages/PlanosEditor';
import { SubirFotos } from './pages/SubirFotos';
import { Rapido } from './pages/Rapido';
import './App.css';

function AdminGuard({ children }) {
  const { user, loading } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // si hay que entrar, después del acceso se vuelve a la página que se pedía (p. ej. /rapido en el móvil)
    if (!loading && !user) navigate('/admin', { replace: true, state: { volver: location.pathname } });
  }, [user, loading, navigate, location.pathname]);

  if (loading) return null;
  return user ? children : null;
}

function EquipoGuard({ children }) {
  const { user, loading } = useEquipoAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate('/equipo', { replace: true });
  }, [user, loading, navigate]);

  if (loading) return null;
  return user ? children : null;
}

function ClienteGuard({ children }) {
  const { user, loading } = useClienteAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate('/cliente', { replace: true });
  }, [user, loading, navigate]);

  if (loading) return null;
  return user ? children : null;
}

function App() {
  return (
    <BrowserRouter>
      <AdminAuthProvider>
        <EquipoAuthProvider>
          <ClienteAuthProvider>
            <Routes>
              {/* Web pública */}
              <Route path="/" element={<Home />} />
              <Route path="/proyectos" element={<Proyectos />} />
              <Route path="/proyecto/:projectId" element={<ProjectGallery />} />

              {/* Subir fotos del estado actual desde el móvil (sin entrar al CRM) */}
              <Route path="/subir/:code" element={<SubirFotos />} />

              {/* Portal cliente */}
              <Route path="/mi-proyecto" element={<MiProyecto />} />

              {/* Clientes */}
              <Route path="/cliente" element={<ClienteLogin />} />
              <Route path="/cliente/restablecer" element={<RestablecerContrasena />} />
              <Route path="/cliente/panel" element={
                <ClienteGuard><ClientePanel /></ClienteGuard>
              } />

              {/* Admin */}
              <Route path="/admin" element={<AdminLogin />} />
              <Route path="/admin/panel" element={
                <AdminGuard><AdminPanel /></AdminGuard>
              } />

              {/* Anotar tareas y eventos desde el móvil */}
              <Route path="/rapido" element={
                <AdminGuard><Rapido /></AdminGuard>
              } />

              {/* Herramienta de planos en su propia pestaña */}
              <Route path="/planos/editor" element={
                <AdminGuard><PlanosEditor /></AdminGuard>
              } />

              {/* Equipo */}
              <Route path="/equipo" element={<EquipoLogin />} />
              <Route path="/equipo/panel" element={
                <EquipoGuard><EquipoPanel /></EquipoGuard>
              } />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ClienteAuthProvider>
        </EquipoAuthProvider>
      </AdminAuthProvider>
    </BrowserRouter>
  );
}

export default App;
