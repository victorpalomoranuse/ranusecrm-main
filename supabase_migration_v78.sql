-- Renders interactivos de la historia del cliente: a un render se le asocia un mapa de profundidad,
-- el movimiento de cámara elegido (adelante, atrás, izquierda, derecha) y puntos tocables.
-- Se identifica por la URL del render dentro de cada proyecto (sirve para el principal de un capítulo, un bloque o una galería).
CREATE TABLE IF NOT EXISTS public.render_interactivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto_id uuid NOT NULL REFERENCES public.client_projects(id) ON DELETE CASCADE,
  imagen_url text NOT NULL,
  profundidad_url text NOT NULL,
  movimiento text NOT NULL DEFAULT 'adelante',
  puntos jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (proyecto_id, imagen_url)
);
CREATE INDEX IF NOT EXISTS render_interactivos_proyecto_idx ON public.render_interactivos (proyecto_id);
