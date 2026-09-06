-- ============================================================
-- MIGRACIÓN V29 — Título editable de la sección "Listados"
--
-- Para poder llamarla "Selección orientativa" en un concepto/anteproyecto
-- y "Listados" (o lo que sea) en el proyecto de ejecución grande, cada
-- proyecto necesita su propio título — si se deja vacío, se usa "Listados"
-- por defecto.
--
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS listados_title text;
