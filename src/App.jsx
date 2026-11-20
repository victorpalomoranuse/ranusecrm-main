import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, lazy, Suspense } from 'react';
import { AdminAuthProvider, useAdminAuth } from './auth/AdminAuthContext';
import { EquipoAuthProvider, useEquipoAuth } from './auth/EquipoAuthContext';
import { ClienteAuthProvider, useClienteAuth } from './auth/ClienteAuthContext';
import { Home } from './pages/Home';
import { Privacidad } from './pages/Privacidad';
const Proyectos = lazy(() => import('./pages/Proyectos').then(m => ({ default: m.Proyectos })));
const ProjectGallery = lazy(() => import('./pages/ProjectGallery').then(m => ({ default: m.ProjectGallery })));
import { AdminLogin } from './pages/AdminLogin';
const AdminPanel = lazy(() => import('./pages/AdminPanel').then(m => ({ default: m.AdminPanel })));
import { EquipoLogin } from './pages/EquipoLogin';
const EquipoPanel = lazy(() => import('./pages/EquipoPanel').then(m => ({ default: m.EquipoPanel })));
const MiProyecto = lazy(() => import('./pages/MiProyecto').then(m => ({ default: m.MiProyecto })));
import { ClienteLogin } from './pages/ClienteLogin';
const ClientePanel = lazy(() => import('./pages/ClientePanel').then(m => ({ default: m.ClientePanel })));
import { RestablecerContrasena } from './pages/RestablecerContrasena';
const PlanosEditor = lazy(() => import('./pages/PlanosEditor').then(m => ({ default: m.PlanosEditor })));
const Visor3D = lazy(() => import('./pages/Visor3D')); // el visor 3D es lo más pesado: solo se descarga al abrirlo
const SubirFotos = lazy(() => import('./pages/SubirFotos').then(m => ({ default: m.SubirFotos })));
const Rapido = lazy(() => import('./pages/Rapido').then(m => ({ default: m.Rapido })));
const TourPublico = lazy(() => import('./pages/TourPublico').then(m => ({ default: m.TourPublico })));
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
            <Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: '#141210', color: '#c9a46c', display: 'grid', placeItems: 'center', fontFamily: 'system-ui, sans-serif', fontSize: 14 }}>Cargando…</div>}>
            <Routes>
              {/* Web pública */}
              <Route path="/" element={<Home />} />
              <Route path="/proyectos" element={<Proyectos />} />
              <Route path="/privacidad" element={<Privacidad />} />
              <Route path="/proyecto/:projectId" element={<ProjectGallery />} />

              {/* Subir fotos del estado actual desde el móvil (sin entrar al CRM) */}
              <Route path="/tour/:id/:firma" element={<TourPublico />} />
              <Route path="/recorrido/:id/:firma" element={<Visor3D cliente />} />
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
              <Route path="/planos/3d/:id" element={
                <AdminGuard><Visor3D /></AdminGuard>
              } />

              {/* Equipo */}
              <Route path="/equipo" element={<EquipoLogin />} />
              <Route path="/equipo/panel" element={
                <EquipoGuard><EquipoPanel /></EquipoGuard>
              } />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </Suspense>
          </ClienteAuthProvider>
        </EquipoAuthProvider>
      </AdminAuthProvider>
    </BrowserRouter>
  );
}

export default App;
