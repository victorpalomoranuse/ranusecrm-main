-- v35: Nueva sección "Setting" — independiente de Leads, no toca nada de
-- lo que ya existe ahí (embudo de ventas, comisiones, conversión a Venta).
-- Es el embudo previo de cualificación/agenda de un "setter": ADS →
-- Interesado → No califica / Contacto Nuevo → Pitcheo Agenda → Recolectando
-- Información → Prioridad → Venta / No responde.

CREATE TABLE IF NOT EXISTS public.setting_leads (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre        text NOT NULL,
  telefono      text,
  instagram     text,
  email         text,
  canal         text,
  estado        text NOT NULL DEFAULT 'ads',
  objetivo      text,
  medidas       text,
  maquinarias   text,
  notas         text,
  assigned_to   uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_by    uuid,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_setting_leads_estado ON public.setting_leads(estado);
