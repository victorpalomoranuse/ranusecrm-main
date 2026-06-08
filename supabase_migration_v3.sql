-- ============================================================
-- MIGRACIÓN V3 — Materiales y Equipamiento por proyecto
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

-- Crear también los Storage buckets desde el dashboard de Supabase:
--   project-renders   (public)
--   project-documents (public)
--   project-diagnosis (public)

-- ── Selecciones de materiales ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_material_selections (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id  uuid NOT NULL REFERENCES public.client_projects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  brand       text,
  category    text,
  location    text,
  notes       text,
  image_url   text,
  created_at  timestamptz DEFAULT now()
);

-- ── Selecciones de mobiliario / equipamiento ──────────────────────────
CREATE TABLE IF NOT EXISTS public.project_equipment_selections (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id  uuid NOT NULL REFERENCES public.client_projects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  brand       text,
  category    text,
  quantity    int NOT NULL DEFAULT 1,
  color       text,
  notes       text,
  created_at  timestamptz DEFAULT now()
);

-- ── Índices ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_material_selections_project ON public.project_material_selections(project_id);
CREATE INDEX IF NOT EXISTS idx_equipment_selections_project ON public.project_equipment_selections(project_id);
