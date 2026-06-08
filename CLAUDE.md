# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Ranuse Design** — web corporativa de una empresa de diseño de espacios deportivos. El proyecto tiene dos partes: frontend (React) y backend (Express), con directorios y `package.json` independientes.

## Commands

### Frontend (raíz del proyecto)
```bash
npm run dev        # Inicia Vite en http://localhost:5173
npm run build      # TypeScript check + build de producción
npm run lint       # ESLint
npm run preview    # Preview del build
```

### Backend (`/server`)
```bash
cd server
npm run dev        # Node con --watch en http://localhost:3001
npm start          # Producción
```

Ambos procesos deben correr simultáneamente en desarrollo.

## Architecture

### Frontend (`src/`)
- **`App.jsx`** — Router principal con todas las rutas y `AuthProvider` envolviendo la app
- **`pages/`** — Vistas completas: `Home`, `Login`, `AdminDashboard`, `ClientDashboard`, `ProjectGallery`
- **`components/`** — Cada componente tiene su propio `.jsx` + `.css` al mismo nivel
- **`contexts/AuthContext.jsx`** — Estado global de autenticación (`useAuth` hook)
- **`services/`** — `api.js` (instancia axios con interceptores JWT), `auth.service.js`, `projects.service.js`, `products.service.js`, `users.service.js`

La página `Home` es la web pública y ensambla en orden: `Navbar → Hero → Carousel → SportsSections → Person → Projects → Services → Maps → CTA → Footer`.

Los proyectos en `Projects.jsx` están **hardcodeados** con slug, título e imagen. El slug se usa para navegar a `/proyecto/:slug` donde `ProjectGallery` muestra la galería de imágenes del proyecto.

### Backend (`server/`)
- **`index.js`** — Express con CORS (permite `localhost:5173` en dev), monta rutas en `/api/*`
- **`routes/`** — `auth.routes.js`, `products.routes.js`, `projects.routes.js`, `users.routes.js`
- **`middleware/`** — `auth.middleware.js` (verifica JWT), `upload.middleware.js` (multer)
- Base de datos: **Supabase** (`@supabase/supabase-js`)

### Auth Flow
JWT guardado en `localStorage` (`token` + `user`). El interceptor de axios lo añade automáticamente a cada petición. Si el backend devuelve 401, el interceptor borra el storage y redirige a `/login`.

Roles disponibles: `admin_superior`, `trabajador`, `cliente`.

### Variables de entorno
- Frontend: `VITE_API_URL` (default: `http://localhost:3001/api`)
- Backend: `.env` con `PORT`, `SUPABASE_URL`, `SUPABASE_KEY`, `JWT_SECRET`, `GOOGLE_API_KEY`

## Key Conventions
- El frontend usa `.jsx` (no `.tsx`) a pesar de tener TypeScript configurado
- CSS por componente: cada `.jsx` tiene su `.css` colocado junto a él, sin CSS modules ni Tailwind
- Las imágenes de proyectos están en `public/img/<slug>/`
