-- v38: Conectar "Trabajos" (la web pública) con los proyectos reales, en
-- vez de la tabla portfolio_projects suelta y desconectada que había hasta
-- ahora. Cada proyecto de cliente puede publicarse (o no) en la web, con su
-- propio texto de concepto (generado con IA, editable), y un vídeo de
-- testimonio por URL.

ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS portfolio_published boolean DEFAULT false;
ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS portfolio_slug text UNIQUE;
ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS portfolio_concept text;
ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS testimonial_video_url text;

-- Cada render puede marcarse como "render" (visualización 3D) o "resultado"
-- (foto real una vez ejecutado) — en Trabajos se enseña "resultado" si lo
-- hay, y si no, los renders.
ALTER TABLE public.project_renders ADD COLUMN IF NOT EXISTS kind text DEFAULT 'render';

-- Paleta de colores del moodboard (círculos con su código hex) — la IA la
-- tiene en cuenta, junto con la descripción y tus indicaciones, al escribir
-- el texto de concepto de Trabajos.
ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS moodboard_palette jsonb DEFAULT '[]';
