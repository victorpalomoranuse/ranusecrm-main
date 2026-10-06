import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes.js';
import productsRoutes from './routes/products.routes.js';
import projectsRoutes from './routes/projects.routes.js';
import usersRoutes from './routes/users.routes.js';
import portfolioRoutes from './routes/portfolio.routes.js';
import clientProjectsRoutes from './routes/client-projects.routes.js';
import historiaRoutes from './routes/historia.routes.js';
import miDashboardRoutes from './routes/mi-dashboard.routes.js';
import agenteProyectoRoutes from './routes/agente-proyecto.routes.js';
import historiaPublicaRoutes from './routes/historia-publica.routes.js';
import employeesRoutes from './routes/employees.routes.js';
import catalogRoutes from './routes/catalog.routes.js';
import referencesRoutes from './routes/references.routes.js';
import contactsRoutes from './routes/contacts.routes.js';
import budgetsRoutes from './routes/budgets.routes.js';
import tasksRoutes from './routes/tasks.routes.js';
import phaseTaskTemplatesRoutes from './routes/phase-task-templates.routes.js';
import eventsRoutes from './routes/events.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import leadsRoutes from './routes/leads.routes.js';
import resourcesRoutes from './routes/resources.routes.js';
import rolesRoutes from './routes/roles.routes.js';
import ventasRoutes from './routes/ventas.routes.js';
import finanzasRoutes from './routes/finanzas.routes.js';
import objetivosRoutes from './routes/objetivos.routes.js';
import comisionesRoutes from './routes/comisiones.routes.js';
import categoriesRoutes from './routes/categories.routes.js';
import needsFormRoutes from './routes/needs-form.routes.js';
import obraRoutes from './routes/obra.routes.js';
import aiBudgetRoutes from './routes/ai-budget.routes.js';
import aiSetterRoutes from './routes/ai-setter.routes.js';
import aiFinanzasRoutes from './routes/ai-finanzas.routes.js';
import settingRoutes from './routes/setting.routes.js';
import memoriaRoutes from './routes/memoria.routes.js';
import calendarFeedRoutes from './routes/calendar-feed.routes.js';
import whatsappRoutes from './routes/whatsapp.routes.js';
import { enviarResumenDiario } from './utils/resumen-diario.js';
import callSlotsRoutes, { enviarRecordatoriosLlamadas, generarSlotsDesdeReglas } from './routes/call-slots.routes.js';
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
app.set('trust proxy', 1);

const allowedOrigins = [
  'http://localhost:5173',
  'https://www.ranusedesign.com',
  'https://ranusedesign.com',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) callback(null, true);
    else callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// verify: guarda el cuerpo crudo de cada petición en req.rawBody — lo
// necesita el webhook de WhatsApp (server/routes/whatsapp.routes.js) para
// comprobar la firma HMAC que manda Meta, que se calcula sobre los bytes
// exactos recibidos (JSON.stringify del body ya parseado podría no coincidir
// byte a byte). Para el resto de rutas no cambia nada.
app.use(express.json({ limit: '25mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

app.use((req, res, next) => {
  console.log(new Date().toISOString() + ' - ' + req.method + ' ' + req.path);
  next();
});

app.get('/', (req, res) => {
  res.json({ message: 'Ranuse Design API', status: 'running', version: '1.0.0' });
});

app.use('/api/auth', authRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/client-projects', clientProjectsRoutes);
app.use('/api/historia', historiaRoutes);
app.use('/api/mi-dashboard', miDashboardRoutes);
app.use('/api/agente-proyecto', agenteProyectoRoutes);
app.use('/api/historia-publica', historiaPublicaRoutes);
app.use('/api/employees', employeesRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/api/references', referencesRoutes);
app.use('/api/contacts', contactsRoutes);
app.use('/api/budgets', budgetsRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/phase-task-templates', phaseTaskTemplatesRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/resources', resourcesRoutes);
app.use('/api/roles', rolesRoutes);
app.use('/api/ventas', ventasRoutes);
app.use('/api/finanzas', finanzasRoutes);
app.use('/api/objetivos', objetivosRoutes);
app.use('/api/comisiones', comisionesRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/needs-form', needsFormRoutes);
app.use('/api/obra', obraRoutes);
app.use('/api/ai-budget', aiBudgetRoutes);
app.use('/api/ai-setter', aiSetterRoutes);
app.use('/api/ai-finanzas', aiFinanzasRoutes);
app.use('/api/setting', settingRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/memoria', memoriaRoutes);
app.use('/api/calendar', calendarFeedRoutes);
app.use('/api/call-slots', callSlotsRoutes);
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada', path: req.path });
});

app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Error interno del servidor'
  });
});

app.listen(PORT, () => {
  console.log('Ranuse Design API Server - Puerto: ' + PORT);
});

// Recordatorios de llamadas agendadas: revisa cada 15 minutos si hay alguna
// dentro de las próximas 24h a la que aún no se le haya mandado el email.
// Resumen diario por email (tareas y eventos del día) a partir de las 8:00 Madrid.
setInterval(enviarResumenDiario, 10 * 60 * 1000);
setTimeout(enviarResumenDiario, 20 * 1000);

setInterval(enviarRecordatoriosLlamadas, 15 * 60 * 1000);
enviarRecordatoriosLlamadas(); // primera pasada al arrancar, no hace falta esperar 15 min

// Genera los huecos reales de las próximas semanas a partir de las reglas
// de disponibilidad recurrente — una vez al día basta (los huecos ya
// generados no se tocan), más una pasada al arrancar.
setInterval(generarSlotsDesdeReglas, 24 * 60 * 60 * 1000);
generarSlotsDesdeReglas();

export default app;
