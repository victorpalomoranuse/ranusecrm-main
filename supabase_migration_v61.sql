-- ============================================================
-- MIGRACIÓN V61 — Estilo del proyecto (definido a partir del moodboard)
--
-- El texto actual del moodboard (moodboard_description) explica CÓMO
-- combinar los colores. Estos campos nuevos guardan el ESTILO en sí
-- (nombre + descripción), que la IA propone analizando la paleta y las
-- imágenes del moodboard. Aditiva y nullable: no toca nada existente.
--
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS moodboard_estilo_nombre text;
ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS moodboard_estilo text;
