-- ============================================================
-- MIGRACIÓN V6 — Tipos de catálogo gestionables (más allá de
-- Materiales/Mobiliario) y limpieza del CHECK que los fijaba
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.catalog_types (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  slug          text NOT NULL UNIQUE,
  name          text NOT NULL,
  display_order int,
  created_at    timestamptz DEFAULT now()
);

INSERT INTO public.catalog_types (slug, name, display_order)
VALUES ('material', 'Materiales', 0), ('mobiliario', 'Mobiliario y equipamiento', 1)
ON CONFLICT (slug) DO NOTHING;

-- Si catalog_categories.type tiene un CHECK que lo limite a
-- ('material','mobiliario'), suéltalo para admitir nuevos tipos:
-- ALTER TABLE public.catalog_categories DROP CONSTRAINT IF EXISTS catalog_categories_type_check;

CREATE INDEX IF NOT EXISTS idx_catalog_types_slug ON public.catalog_types(slug);
