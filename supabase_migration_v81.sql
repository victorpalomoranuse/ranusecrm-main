-- v81: agenda personal (página /rapido)
-- 1) Los eventos del calendario pasan a tener duración, para poder detectar cuándo se pisan.
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS duration_min integer;

-- 2) Mis horarios de trabajo: franjas por día de la semana (0 = domingo … 6 = sábado), por persona.
CREATE TABLE IF NOT EXISTS public.agenda_horarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  dia_semana smallint NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  hora_inicio time NOT NULL,
  hora_fin time NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agenda_horarios_user ON public.agenda_horarios(user_id);
