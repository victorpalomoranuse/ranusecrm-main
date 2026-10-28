-- v83: calendario de pagos por presupuesto (hitos con % y concepto), p.ej. 50% al firmar + 50% al terminar
ALTER TABLE public.budgets ADD COLUMN IF NOT EXISTS payment_schedule jsonb;
