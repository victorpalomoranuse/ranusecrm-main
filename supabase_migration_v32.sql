-- v32: Especificaciones de iluminación (lúmenes, vatios, temperatura de color,
-- color/acabado) en catalog_products, y su copia (snapshot) en las tablas de
-- materiales/equipamiento asignados a un proyecto, para que el cliente las
-- vea fácilmente en su listado de compra.

ALTER TABLE public.catalog_products ADD COLUMN IF NOT EXISTS lumens integer;
ALTER TABLE public.catalog_products ADD COLUMN IF NOT EXISTS watts numeric;
ALTER TABLE public.catalog_products ADD COLUMN IF NOT EXISTS color_temperature text;
ALTER TABLE public.catalog_products ADD COLUMN IF NOT EXISTS color text;

ALTER TABLE public.project_material_selections ADD COLUMN IF NOT EXISTS lumens integer;
ALTER TABLE public.project_material_selections ADD COLUMN IF NOT EXISTS watts numeric;
ALTER TABLE public.project_material_selections ADD COLUMN IF NOT EXISTS color_temperature text;
ALTER TABLE public.project_material_selections ADD COLUMN IF NOT EXISTS color text;

ALTER TABLE public.project_equipment_selections ADD COLUMN IF NOT EXISTS lumens integer;
ALTER TABLE public.project_equipment_selections ADD COLUMN IF NOT EXISTS watts numeric;
ALTER TABLE public.project_equipment_selections ADD COLUMN IF NOT EXISTS color_temperature text;
ALTER TABLE public.project_equipment_selections ADD COLUMN IF NOT EXISTS color text;
