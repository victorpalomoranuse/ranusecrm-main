-- ============================================================
-- MIGRACIÓN V28 — Texto de introducción para "Listados"
--
-- Igual que las categorías de fase ya tienen su intro_text (con un texto
-- por defecto si no se rellena), la sección "Listados" del cliente
-- necesita un sitio donde guardar tu propia explicación — si no la
-- rellenas, se usa un texto genérico por defecto.
--
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS listados_intro_text text;
