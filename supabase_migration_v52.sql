-- v52: Disponibilidad recurrente semanal para llamadas (en vez de crear
-- huecos uno a uno) + duración de llamada configurable por regla.
CREATE TABLE IF NOT EXISTS call_availability_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  dia_semana smallint NOT NULL CHECK (dia_semana BETWEEN 0 AND 6), -- 0=domingo … 6=sábado
  hora_inicio time NOT NULL,
  hora_fin time NOT NULL,
  duracion_llamada_min smallint NOT NULL DEFAULT 30,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_availability_rules_employee ON call_availability_rules(employee_id);

COMMENT ON TABLE call_availability_rules IS 'Reglas de disponibilidad recurrente semanal (ej. "Lunes a Viernes 10-14h, llamadas de 30 min") — se usan para generar automáticamente los huecos reales en call_slots para las próximas semanas.';

-- Enlaza cada hueco generado con la regla que lo creó, para poder borrar
-- solo los huecos libres de una regla si se desactiva/elimina, sin tocar
-- los que ya están reservados ni los que se crearon sueltos a mano.
ALTER TABLE call_slots
  ADD COLUMN IF NOT EXISTS generado_por_regla uuid REFERENCES call_availability_rules(id) ON DELETE SET NULL;
