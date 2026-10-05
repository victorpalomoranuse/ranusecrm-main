-- ============================================================
-- MIGRACIÓN V65 — El plano de distribución pasa a ser una sección propia
--
-- Antes era un bloque dentro del primer capítulo. Ahora es un elemento del
-- proyecto, con lugar fijo y visible en el admin (encima de los capítulos)
-- y en el portal (entre "La atmósfera" y el capítulo 1).
--
--  plano_imagen_url = imagen del plano con el recorrido numerado
--  plano_texto      = frase corta opcional
--
-- Aditiva y nullable. Quita de las plantillas el bloque "plano" que se
-- había añadido al capítulo 1 (solo plantillas; no toca proyectos).
--
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS plano_imagen_url text;
ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS plano_texto text;

DELETE FROM public.plantillas_bloque WHERE tipo = 'plano';
