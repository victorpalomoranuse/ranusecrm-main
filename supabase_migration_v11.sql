-- ============================================================
-- MIGRACIÓN V11 — Materiales y mobiliario conectados a categorías
--
-- Hasta ahora los materiales/equipamiento seleccionados en un
-- proyecto se enlazaban a la fase antigua (0-6) y, si borrabas o
-- renombrabas esa categoría, dejaban de verse en la página del
-- cliente. Esta migración los conecta directamente a la categoría
-- real (project_categories), y añade un título editable para cada
-- listado ("Materiales" / "Mobiliario y equipamiento" por defecto,
-- pero tú puedes ponerle el nombre que quieras, ej. "Listado de
-- equipamiento").
--
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

ALTER TABLE public.project_material_selections ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.project_categories(id) ON DELETE SET NULL;
ALTER TABLE public.project_equipment_selections ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.project_categories(id) ON DELETE SET NULL;

ALTER TABLE public.project_categories ADD COLUMN IF NOT EXISTS materials_label text;
ALTER TABLE public.project_categories ADD COLUMN IF NOT EXISTS equipment_label text;

CREATE INDEX IF NOT EXISTS idx_material_selections_category ON public.project_material_selections(category_id);
CREATE INDEX IF NOT EXISTS idx_equipment_selections_category ON public.project_equipment_selections(category_id);

-- ── Backfill: conectar selecciones existentes a su categoría equivalente ─
UPDATE public.project_material_selections m
SET category_id = pc.id
FROM public.project_categories pc
WHERE pc.project_id = m.project_id
  AND pc.legacy_phase_number = m.phase_number
  AND m.category_id IS NULL;

UPDATE public.project_equipment_selections e
SET category_id = pc.id
FROM public.project_categories pc
WHERE pc.project_id = e.project_id
  AND pc.legacy_phase_number = e.phase_number
  AND e.category_id IS NULL;

-- ── Selecciones sin fase asignada (phase_number null): a la primera
--    categoría del proyecto, para que sigan siendo visibles ──────────────
UPDATE public.project_material_selections m
SET category_id = (
  SELECT pc.id FROM public.project_categories pc
  WHERE pc.project_id = m.project_id
  ORDER BY pc.display_order ASC LIMIT 1
)
WHERE m.category_id IS NULL;

UPDATE public.project_equipment_selections e
SET category_id = (
  SELECT pc.id FROM public.project_categories pc
  WHERE pc.project_id = e.project_id
  ORDER BY pc.display_order ASC LIMIT 1
)
WHERE e.category_id IS NULL;
