-- ============================================================
-- MIGRACIÓN V26 — Moodboard por proyecto
--
-- Un moodboard (imágenes + descripción del estilo/soluciones que guían el
-- proyecto) que se muestra al cliente justo después del Programa de
-- Necesidades. Es a nivel de proyecto entero, no por fase.
--
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS moodboard_description text;

CREATE TABLE IF NOT EXISTS public.project_moodboard_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.client_projects(id) ON DELETE CASCADE,
  url text NOT NULL,
  display_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_moodboard_images_project ON public.project_moodboard_images(project_id);
