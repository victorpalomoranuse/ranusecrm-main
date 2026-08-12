-- ============================================================
-- MIGRACIÓN V10 — Categorías libres por proyecto
--
-- Sustituye el concepto de "fase numérica fija" (0-6 igual para
-- todos los proyectos) por categorías propias de cada proyecto:
-- tú decides cuántas tiene cada uno, cómo se llaman y en qué
-- orden van. Dentro de cada categoría hay "apartados", que pueden
-- ser un documento (como ahora) o un bloque libre con texto,
-- imágenes y enlaces.
--
-- No se borra nada de lo que ya existe: las tablas antiguas
-- (project_phase_documents, project_phase_content, project_renders,
-- project_tours...) se quedan intactas como respaldo. Esta
-- migración solo AÑADE las tablas nuevas y copia el contenido
-- actual de cada proyecto a su categoría correspondiente.
--
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

-- ── Catálogo de categorías sugeridas (plantillas rápidas) ──────────────
CREATE TABLE IF NOT EXISTS public.category_templates (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name          text NOT NULL,
  display_order int,
  checklist     jsonb DEFAULT '[]'::jsonb,
  created_at    timestamptz DEFAULT now()
);

-- ── Categorías reales de cada proyecto ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_categories (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id          uuid NOT NULL REFERENCES public.client_projects(id) ON DELETE CASCADE,
  name                text NOT NULL,
  display_order       int NOT NULL DEFAULT 0,
  intro_text          text,
  status              text DEFAULT 'en_curso', -- proximamente | en_curso | completado
  template_id         uuid REFERENCES public.category_templates(id) ON DELETE SET NULL,
  legacy_phase_number int, -- solo para el backfill, referencia a la fase antigua de la que viene
  created_at          timestamptz DEFAULT now()
);

-- ── Apartados dentro de una categoría: documento o bloque libre ────────
CREATE TABLE IF NOT EXISTS public.category_items (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  category_id   uuid NOT NULL REFERENCES public.project_categories(id) ON DELETE CASCADE,
  type          text NOT NULL DEFAULT 'documento', -- documento | bloque
  title         text NOT NULL,
  display_order int NOT NULL DEFAULT 0,
  file_url      text,                       -- solo tipo documento
  code          text,                       -- solo tipo documento (ej. IE.01), opcional
  body_text     text,                       -- solo tipo bloque
  images        jsonb DEFAULT '[]'::jsonb,  -- [{url, name}]
  links         jsonb DEFAULT '[]'::jsonb,  -- [{url, label}]
  created_at    timestamptz DEFAULT now()
);

-- ── Tareas: vincular a categoría en vez de a fase numérica ─────────────
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.project_categories(id) ON DELETE SET NULL;

-- ── Índices ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_project_categories_project ON public.project_categories(project_id, display_order);
CREATE INDEX IF NOT EXISTS idx_category_items_category ON public.category_items(category_id, display_order);
CREATE INDEX IF NOT EXISTS idx_tasks_category ON public.tasks(category_id);

-- ── Plantillas por defecto ("paquete estándar" de siempre) ─────────────
INSERT INTO public.category_templates (name, display_order)
SELECT v.name, v.ord FROM (VALUES
  ('Presentaciones', 0),
  ('Diseño previo', 1),
  ('Planos generales', 2),
  ('Instalaciones', 3),
  ('Interiorismo y materialidad', 4),
  ('Renders', 5),
  ('Maquinaria y equipamiento', 6),
  ('Documentación de apoyo', 7)
) AS v(name, ord)
WHERE NOT EXISTS (SELECT 1 FROM public.category_templates ct WHERE ct.name = v.name);

-- ── Backfill: una categoría por cada fase 0-6 de cada proyecto existente ─
INSERT INTO public.project_categories (project_id, name, display_order, template_id, legacy_phase_number, intro_text)
SELECT
  p.id,
  CASE gs.phase
    WHEN 0 THEN 'Diseño previo' WHEN 1 THEN 'Planos generales' WHEN 2 THEN 'Instalaciones'
    WHEN 3 THEN 'Interiorismo y materialidad' WHEN 4 THEN 'Renders'
    WHEN 5 THEN 'Maquinaria y equipamiento' WHEN 6 THEN 'Documentación de apoyo'
  END,
  gs.phase + 1,
  ct.id,
  gs.phase,
  pcont.intro_text
FROM public.client_projects p
CROSS JOIN generate_series(0, 6) AS gs(phase)
JOIN public.category_templates ct ON ct.name = CASE gs.phase
    WHEN 0 THEN 'Diseño previo' WHEN 1 THEN 'Planos generales' WHEN 2 THEN 'Instalaciones'
    WHEN 3 THEN 'Interiorismo y materialidad' WHEN 4 THEN 'Renders'
    WHEN 5 THEN 'Maquinaria y equipamiento' WHEN 6 THEN 'Documentación de apoyo'
  END
LEFT JOIN public.project_phase_content pcont ON pcont.project_id = p.id AND pcont.phase_number = gs.phase;

-- ── Backfill: documentos de fase → apartados tipo "documento" ──────────
INSERT INTO public.category_items (category_id, type, title, display_order, file_url, code)
SELECT pc.id, 'documento', d.name, COALESCE(d.display_order, 0), d.file_url, d.code
FROM public.project_phase_documents d
JOIN public.project_categories pc ON pc.project_id = d.project_id AND pc.legacy_phase_number = d.phase_number;

-- ── Backfill: renders de fase → un apartado tipo "bloque" con galería ──
INSERT INTO public.category_items (category_id, type, title, display_order, images)
SELECT pc.id, 'bloque', 'Renders', 900,
  jsonb_agg(jsonb_build_object('url', r.url, 'name', r.name) ORDER BY r.display_order NULLS LAST, r.created_at)
FROM public.project_renders r
JOIN public.project_categories pc ON pc.project_id = r.project_id AND pc.legacy_phase_number = COALESCE(r.phase_number, 0)
GROUP BY pc.id;

-- ── Backfill: tours de fase → un apartado tipo "bloque" con enlaces ─────
INSERT INTO public.category_items (category_id, type, title, display_order, links)
SELECT pc.id, 'bloque', 'Tour virtual 3D', 950,
  jsonb_agg(jsonb_build_object('url', t.url, 'label', t.name) ORDER BY t.created_at)
FROM public.project_tours t
JOIN public.project_categories pc ON pc.project_id = t.project_id AND pc.legacy_phase_number = COALESCE(t.phase_number, 0)
GROUP BY pc.id;
