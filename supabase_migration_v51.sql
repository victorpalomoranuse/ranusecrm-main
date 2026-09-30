-- v51: Calendario de disponibilidad para llamadas (Hernán marca huecos,
-- Franco los reserva desde Setting) + resumen de cada llamada.
CREATE TABLE IF NOT EXISTS call_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  fecha date NOT NULL,
  hora_inicio time NOT NULL,
  hora_fin time NOT NULL,
  ocupado boolean NOT NULL DEFAULT false,
  setting_lead_id uuid REFERENCES setting_leads(id) ON DELETE SET NULL,
  resumen_llamada text,
  recordatorio_enviado boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_slots_employee_fecha ON call_slots(employee_id, fecha);

COMMENT ON TABLE call_slots IS 'Huecos de disponibilidad para llamadas (calendario tipo Calendly interno). Un empleado (ej. Hernán) crea huecos libres; otro (ej. Franco) los reserva vinculándolos a un lead de Setting.';
COMMENT ON COLUMN call_slots.resumen_llamada IS 'Resumen que rellena el empleado dueño del hueco (ej. Hernán) después de hacer la llamada.';
COMMENT ON COLUMN call_slots.recordatorio_enviado IS 'Evita mandar el email de recordatorio más de una vez por hueco reservado.';
