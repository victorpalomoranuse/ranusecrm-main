-- ============================================================
-- MIGRACIÓN V21 — Un proyecto puede tener varias ventas enlazadas
--
-- Antes cada proyecto solo podía apuntar a UNA venta (client_projects.
-- venta_id). Ahora se invierte: cada venta apunta a su proyecto
-- (ventas.client_project_id), así que un mismo proyecto puede tener
-- todas las ventas que hagan falta (ej. una venta de diseño y luego
-- otra de ejecución, o varias fases vendidas por separado).
--
-- No se borra la columna antigua (client_projects.venta_id) por si
-- acaso, pero deja de usarse — el enlace ahora se gestiona siempre
-- desde la venta.
--
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

ALTER TABLE public.ventas ADD COLUMN IF NOT EXISTS client_project_id uuid REFERENCES public.client_projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ventas_client_project_id ON public.ventas(client_project_id);

-- Backfill: copiar los enlaces que ya existían
UPDATE public.ventas v
SET client_project_id = cp.id
FROM public.client_projects cp
WHERE cp.venta_id = v.id AND v.client_project_id IS NULL;
