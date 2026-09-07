-- v31: Guardar el TIPO de catálogo (Materiales, Mobiliario, Iluminación...) en
-- cada material/equipo asignado a un proyecto, para poder agrupar los
-- "Listados" del cliente en un desplegable por tipo (Equipamiento, Iluminación...)
-- y no solo por categoría dentro de una única lista.
--
-- Hasta ahora cada fila solo guardaba el NOMBRE de la categoría (snapshot de
-- texto, ej. "1. Racks y Jaulas"), no su tipo. Añadimos "category_type" con el
-- mismo criterio: se copia en el momento de asignar el producto, así si luego
-- cambias o borras la categoría del catálogo, el listado ya asignado no se ve
-- afectado.

ALTER TABLE public.project_material_selections ADD COLUMN IF NOT EXISTS category_type text;
ALTER TABLE public.project_equipment_selections ADD COLUMN IF NOT EXISTS category_type text;

-- Relleno de las filas ya existentes: hasta ahora todo lo de la tabla de
-- materiales era del tipo "material", y todo lo de la tabla de equipamiento
-- era del tipo "mobiliario" (los únicos dos tipos que existían al construir
-- esas asignaciones).
UPDATE public.project_material_selections SET category_type = 'material' WHERE category_type IS NULL;
UPDATE public.project_equipment_selections SET category_type = 'mobiliario' WHERE category_type IS NULL;
