-- ============================================================
-- MIGRACIÓN V14 — Notas internas y resumen para el cliente en el
-- Programa de Necesidades.
--
-- admin_notes:    tus notas privadas, el cliente nunca las ve.
-- client_summary: el texto que tú escribes y que el cliente verá
--                 en su página en vez de todas las respuestas del
--                 formulario.
--
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

ALTER TABLE public.project_needs_forms ADD COLUMN IF NOT EXISTS admin_notes text;
ALTER TABLE public.project_needs_forms ADD COLUMN IF NOT EXISTS client_summary text;
