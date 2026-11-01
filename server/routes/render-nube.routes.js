import express from 'express';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';

// Render final en la nube (Blender Cycles): SOLO la interfaz. Todavía no hay ningún proveedor conectado.
// Contrato previsto para cuando se implemente:
//   POST /api/render-nube   { glbUrl, camara: { px, py, pz, tx, ty, tz, fov }, resolucion: { ancho, alto }, muestras, motor: 'cycles', hdri?, hora? }
//     → 202 { trabajoId }
//   GET  /api/render-nube/:trabajoId → { estado: 'en-cola' | 'renderizando' | 'listo' | 'error', progreso, imagenUrl?, error? }
// El proveedor (RunPod, Replicate, un servidor propio con GPU…) se elegirá más adelante; hará falta una clave en Railway.
const router = express.Router();
router.use(authenticateToken, requirePermission('proyectos'));

router.get('/estado', (req, res) => res.json({ disponible: false, motores: [], motivo: 'Todavía no hay ningún servicio de render en la nube conectado.' }));
router.post('/', (req, res) => res.status(501).json({ error: 'El render en la nube todavía no está disponible.' }));
router.get('/:id', (req, res) => res.status(501).json({ error: 'El render en la nube todavía no está disponible.' }));

export default router;
