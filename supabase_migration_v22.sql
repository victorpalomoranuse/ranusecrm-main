-- ============================================================
-- MIGRACIÓN V22 — Registro manual de "cobrado" por periodo en el
-- desglose de comisiones (independiente de Finanzas)
--
-- El desglose "por persona y mes/trimestre/año" de Comisiones necesita
-- guardar cuánto se le ha pagado a cada uno EN CADA PERIODO, pero sin
-- tocar los movimientos reales de Finanzas (categoría "Comisiones") — ahí
-- hay registros antiguos donde el importe mezclaba la comisión con otro
-- pago, así que no sirven como fuente fiable para este desglose.
--
-- Esta tabla es solo eso: un importe que tú introduces a mano por persona
-- y periodo, para ver "generado / cobrado / pendiente" mes a mes. El
-- histórico de "Ya pagado" que ya existía (basado en Finanzas) sigue
-- funcionando exactamente igual que antes, sin cambios.
--
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.comisiones_pagos_periodo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  periodo_tipo text NOT NULL CHECK (periodo_tipo IN ('mes', 'trimestre', 'año')),
  periodo text NOT NULL,
  monto numeric NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (nombre, periodo_tipo, periodo)
);

CREATE INDEX IF NOT EXISTS idx_comisiones_pagos_periodo_nombre ON public.comisiones_pagos_periodo(nombre, periodo_tipo);
