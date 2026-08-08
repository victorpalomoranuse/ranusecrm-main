-- ============================================================
-- MIGRACIÓN V7 — Estado de proyecto (en marcha / finalizado / archivado)
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS status text DEFAULT 'en_marcha';
UPDATE public.client_projects SET status = 'en_marcha' WHERE status IS NULL;

CREATE INDEX IF NOT EXISTS idx_client_projects_status ON public.client_projects(status);
