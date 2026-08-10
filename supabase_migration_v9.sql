-- ============================================================
-- MIGRACIÓN V9 — Inserta la fase "Renders" entre Interiorismo (3)
-- y Maquinaria (antes 4). Maquinaria pasa a ser la fase 5 y
-- Documentación de apoyo pasa a ser la fase 6 (7 fases: 0-6).
--
-- El orden de los UPDATE importa: se desplaza primero el valor
-- más alto (5→6) y luego el más bajo (4→5) para no pisarlos entre sí.
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

UPDATE public.client_projects SET phase = 6 WHERE phase = 5;
UPDATE public.client_projects SET phase = 5 WHERE phase = 4;

UPDATE public.project_phase_documents SET phase_number = 6 WHERE phase_number = 5;
UPDATE public.project_phase_documents SET phase_number = 5 WHERE phase_number = 4;

UPDATE public.project_phase_content SET phase_number = 6 WHERE phase_number = 5;
UPDATE public.project_phase_content SET phase_number = 5 WHERE phase_number = 4;

UPDATE public.project_material_selections SET phase_number = 6 WHERE phase_number = 5;
UPDATE public.project_material_selections SET phase_number = 5 WHERE phase_number = 4;

UPDATE public.project_equipment_selections SET phase_number = 6 WHERE phase_number = 5;
UPDATE public.project_equipment_selections SET phase_number = 5 WHERE phase_number = 4;

UPDATE public.project_renders SET phase_number = 6 WHERE phase_number = 5;
UPDATE public.project_renders SET phase_number = 5 WHERE phase_number = 4;

UPDATE public.project_tours SET phase_number = 6 WHERE phase_number = 5;
UPDATE public.project_tours SET phase_number = 5 WHERE phase_number = 4;

UPDATE public.tasks SET phase_number = 6 WHERE phase_number = 5;
UPDATE public.tasks SET phase_number = 5 WHERE phase_number = 4;

UPDATE public.phase_task_templates SET phase_number = 6 WHERE phase_number = 5;
UPDATE public.phase_task_templates SET phase_number = 5 WHERE phase_number = 4;

-- Si client_projects.phase tiene un CHECK que limite el rango a 0-5,
-- suéltalo y créalo de nuevo para admitir hasta 6:
-- ALTER TABLE public.client_projects DROP CONSTRAINT IF EXISTS client_projects_phase_check;
-- ALTER TABLE public.client_projects ADD CONSTRAINT client_projects_phase_check CHECK (phase BETWEEN 0 AND 6);
