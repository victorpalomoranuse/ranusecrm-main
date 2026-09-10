-- v37: Dos campos de texto libre.
--
-- 1) client_projects.memoria_intro — "planteamiento y justificación" del
--    proyecto, para la Memoria del proyecto en PDF (por qué se plantea cada
--    solución). Si está vacío, ese apartado no sale.
--
-- 2) project_needs_forms.brief — descripción libre del proyecto en el
--    Programa de Necesidades, para cuando Víctor no rellena el formulario
--    de preguntas y escribe directamente. El botón "Generar resumen con IA"
--    también lo tiene en cuenta.

ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS memoria_intro text;
ALTER TABLE public.project_needs_forms ADD COLUMN IF NOT EXISTS brief text;
