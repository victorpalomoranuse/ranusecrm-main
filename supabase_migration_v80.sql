-- v80: cada imagen del moodboard puede explicar qué se quiere de ella (estilo general, detalle, material, color, luz, distribución o algo a evitar)
-- y llevar un comentario. La IA lo usa para entender por qué está esa imagen.
ALTER TABLE public.project_moodboard_images ADD COLUMN IF NOT EXISTS tipo text;
ALTER TABLE public.project_moodboard_images ADD COLUMN IF NOT EXISTS nota text;
