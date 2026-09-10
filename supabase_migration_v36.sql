-- v36: Plano de medición (PDF o imagen) del Programa de Necesidades.
-- Las fotos del estado actual y las mediciones ya existían; esto añade
-- un archivo aparte con el plano acotado del espacio, que se enseña
-- tanto en la pestaña Necesidades (admin) como en la página del cliente.
-- El resumen que genera la IA sigue guardándose en el campo que ya
-- existe (client_summary), solo que ahora se puede rellenar con un
-- botón que lee las respuestas + las notas internas.

ALTER TABLE public.project_needs_forms ADD COLUMN IF NOT EXISTS measurement_plan_url text;
