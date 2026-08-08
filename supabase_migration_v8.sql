-- ============================================================
-- MIGRACIÓN V8 — Orden manual de las líneas dentro de cada
-- proveedor en Pedidos (independiente del orden del presupuesto)
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

ALTER TABLE public.budget_items ADD COLUMN IF NOT EXISTS pedido_order int;
