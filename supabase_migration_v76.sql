-- Prompts de render con IA: cada proyecto guarda los prompts que se han generado
-- (para volver a copiarlos o ajustarlos) con la zona, los detalles pedidos y la herramienta de destino.
CREATE TABLE IF NOT EXISTS public.render_prompts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.client_projects(id) ON DELETE CASCADE,
  zona        text,
  detalles    text,
  herramienta text,
  modo        text DEFAULT 'crear',
  resultado   jsonb NOT NULL,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_render_prompts_project ON public.render_prompts(project_id, created_at DESC);
