-- ============================================================
-- MIGRACIÓN V19 — Enlazar ventas a una cuenta de cliente
--
-- Añade un enlace opcional de cada venta a una cuenta de cliente
-- real (las que se crean en Clientes → email + contraseña), para
-- poder elegirla desde el desplegable al crear/editar una venta en
-- vez de solo escribir el nombre a mano.
--
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

ALTER TABLE public.ventas ADD COLUMN IF NOT EXISTS cliente_id uuid REFERENCES public.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ventas_cliente_id ON public.ventas(cliente_id);
