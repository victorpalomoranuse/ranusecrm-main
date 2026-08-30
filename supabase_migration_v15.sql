-- ============================================================
-- MIGRACIÓN V15 — Separar "mostrar cantidad" de "mostrar enlace
-- de compra" en la selección de mobiliario/equipamiento.
--
-- Antes había un único checkbox que controlaba las dos cosas a
-- la vez (aunque en realidad la cantidad siempre se mostraba).
-- Ahora son dos controles independientes.
--
-- show_quantity por defecto true para que el comportamiento
-- actual (cantidad siempre visible) no cambie en lo ya existente.
--
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

ALTER TABLE public.project_equipment_selections ADD COLUMN IF NOT EXISTS show_quantity boolean DEFAULT true;
