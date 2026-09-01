-- ============================================================
-- MIGRACIÓN V16 — Relación de obra: pagos reales por proveedor
--
-- Añade un campo "proveedor" a los movimientos de Finanzas, para
-- poder etiquetar cada pago real con a qué proveedor fue y así
-- compararlo con lo presupuestado a ese mismo proveedor en el
-- presupuesto aprobado del proyecto.
--
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

ALTER TABLE public.finanzas_movimientos ADD COLUMN IF NOT EXISTS proveedor text;
CREATE INDEX IF NOT EXISTS idx_finanzas_movimientos_proveedor ON public.finanzas_movimientos(proveedor);
