import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes.js';
import productsRoutes from './routes/products.routes.js';
import projectsRoutes from './routes/projects.routes.js';
import usersRoutes from './routes/users.routes.js';
import portfolioRoutes from './routes/portfolio.routes.js';
import clientProjectsRoutes from './routes/client-projects.routes.js';
import employeesRoutes from './routes/employees.routes.js';
import catalogRoutes from './routes/catalog.routes.js';
import referencesRoutes from './routes/references.routes.js';
import contactsRoutes from './routes/contacts.routes.js';
import budgetsRoutes from './routes/budgets.routes.js';
import tasksRoutes from './routes/tasks.routes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
app.use('/api/employees', employeesRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/api/references', referencesRoutes);
app.use('/api/contacts', contactsRoutes);
app.use('/api/budgets', budgetsRoutes);
app.use('/api/tasks', tasksRoutes);

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

export default app;
