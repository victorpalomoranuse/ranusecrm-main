-- Hojas de cálculo del CRM: pequeñas hojas tipo Excel para listados y cuentas rápidas.
-- Cada persona del equipo ve solo las suyas.
CREATE TABLE IF NOT EXISTS public.hojas_calculo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL DEFAULT 'Hoja sin título',
  datos jsonb NOT NULL DEFAULT '{}'::jsonb,
  owner_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hojas_calculo_owner_idx ON public.hojas_calculo (owner_id, updated_at DESC);
