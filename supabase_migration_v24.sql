-- ============================================================
-- MIGRACIÓN V24 — Congelar los meses ya pasados del desglose de
-- comisiones, y cuadrar los cambios (p.ej. cerrar una venta) como una
-- línea de ajuste en el mes actual
--
-- Antes, si cerrabas una venta (o cambiaba su coste real) después de que
-- ya hubiera pasado un mes, ese mes recalculaba su "Generado" con el
-- nuevo número — descuadrando lo que ya habías visto/pagado ese mes.
--
-- Ahora, la primera vez que se consulta el desglose de un mes/trimestre/año
-- ya terminado, se "congela" el importe de cada proyecto en ese periodo.
-- A partir de ahí ese periodo ya no cambia. Si más adelante algo hace que
-- el cálculo real sea distinto (por ejemplo cerrar esa venta), la
-- diferencia total no se aplica a los meses pasados — aparece como una
-- única línea "Ajuste por cambios en ventas de meses anteriores" dentro
-- del mes/trimestre/año ACTUAL, para que todo siga cuadrando en conjunto
-- sin mover lo que ya se pagó o vio en meses anteriores.
--
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.comisiones_devengado_congelado (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  venta_id uuid NOT NULL,
  periodo_tipo text NOT NULL CHECK (periodo_tipo IN ('mes', 'trimestre', 'año')),
  periodo text NOT NULL,
  devengado numeric NOT NULL,
  frozen_at timestamptz DEFAULT now(),
  UNIQUE (nombre, venta_id, periodo_tipo, periodo)
);

CREATE INDEX IF NOT EXISTS idx_comisiones_devengado_congelado_nombre ON public.comisiones_devengado_congelado(nombre, periodo_tipo);
