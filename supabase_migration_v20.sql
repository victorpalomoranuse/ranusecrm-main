-- ============================================================
-- MIGRACIÓN V20 — Comisiones por proyecto ligadas a Empleados
--
-- Hasta ahora, al asignar una comisión a una venta se escribía el
-- nombre a mano (texto libre), lo que podía no coincidir exactamente
-- con el nombre configurado en Finanzas → Comisiones y romper el
-- autoservicio de "Mis Comisiones". Ahora se elige directamente de
-- la lista de Empleados.
--
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

ALTER TABLE public.venta_comisiones ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES public.employees(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_venta_comisiones_employee ON public.venta_comisiones(employee_id);
