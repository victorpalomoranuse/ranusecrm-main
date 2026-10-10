-- v70: Herramienta de medición en obra (planos, cotas, distribución, iluminación…)
-- Cada medición pertenece a un proyecto y guarda el plano completo (data) y un
-- resumen de cantidades (resumen) que se usa en presupuestos y en la IA.

CREATE TABLE IF NOT EXISTS public.mediciones (
  id text PRIMARY KEY,
  project_id uuid REFERENCES public.client_projects(id) ON DELETE CASCADE,
  nombre text,
  cliente text,
  data jsonb NOT NULL,
  resumen jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mediciones_project ON public.mediciones(project_id, updated_at DESC);
