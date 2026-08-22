-- ============================================================
-- MIGRACIÓN V12 — Permitir tipos de catálogo personalizados
--
-- La tabla catalog_categories tenía una restricción antigua que
-- solo dejaba crear categorías con type = 'material' o 'mobiliario'
-- (de cuando esos eran los únicos dos tipos fijos). Desde que se
-- pueden añadir tipos propios (ej. "Iluminación") en Catálogo,
-- crear una categoría bajo cualquier tipo nuevo fallaba porque
-- chocaba con esa restricción.
--
-- Esta migración quita esa restricción: los tipos válidos ahora
-- los define la tabla catalog_types, no un CHECK fijo.
--
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

ALTER TABLE public.catalog_categories DROP CONSTRAINT IF EXISTS catalog_categories_type_check;
