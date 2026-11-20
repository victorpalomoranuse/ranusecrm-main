-- Home Gym Studio: herramienta de pago para clientes de home gym (diseño de su espacio + solicitud de equipamiento).
-- 1) Qué máquinas del catálogo salen en la herramienta, de qué tipo son y qué comisión deja cada una.
-- 2) Solicitudes de equipamiento que llegan desde la web pública (además de caer en Métricas / Setting como lead nuevo).

ALTER TABLE public.catalog_products ADD COLUMN IF NOT EXISTS homegym_tipo text;        -- rack, banco, discos, mancu, polea, cinta, bici, remo, kettle, cajon (vacío = no sale en Home Gym)
ALTER TABLE public.catalog_products ADD COLUMN IF NOT EXISTS homegym_orden integer DEFAULT 0; -- 0 = versión normal, 1 y 2 = alternativas compactas o de techo bajo
ALTER TABLE public.catalog_products ADD COLUMN IF NOT EXISTS homegym_comision numeric;  -- % de comisión de la marca (solo lo ve el equipo)

CREATE TABLE IF NOT EXISTS public.homegym_solicitudes (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  ref            text NOT NULL,
  nombre         text NOT NULL,
  email          text,
  telefono       text,
  espacio        jsonb NOT NULL DEFAULT '{}'::jsonb,   -- medidas, puerta, objetivo, personas, presupuesto
  items          jsonb NOT NULL DEFAULT '[]'::jsonb,   -- máquinas elegidas (con precio, marca y comisión del momento)
  total          numeric,
  comision_est   numeric,
  estado         text NOT NULL DEFAULT 'nueva',        -- nueva, en_revision, enviada_marca, cerrada, descartada
  nota_equipo    text,
  setting_lead_id uuid,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_homegym_solicitudes_estado ON public.homegym_solicitudes (estado, created_at DESC);
