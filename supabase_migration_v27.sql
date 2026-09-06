-- ============================================================
-- MIGRACIÓN V27 — Listados: materiales con unidades y link de compra
--
-- Para que "Listados" (antes Catálogo) pueda mostrar materiales y
-- equipamiento en una sola tabla con las mismas columnas (imagen, código,
-- descripción, uds, link de compra), los materiales necesitan los mismos
-- campos que ya tenía el equipamiento.
--
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

ALTER TABLE public.project_material_selections
  ADD COLUMN IF NOT EXISTS quantity numeric DEFAULT 1,
  ADD COLUMN IF NOT EXISTS purchase_link text,
  ADD COLUMN IF NOT EXISTS show_purchase_link boolean DEFAULT false;
