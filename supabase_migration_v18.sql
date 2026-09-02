-- ============================================================
-- MIGRACIÓN V18 — Comisiones por proyecto (varias personas por venta)
--
-- Permite asignar a una venta una o varias personas con su propio %
-- (o importe fijo), en vez de un único % global para todo. La
-- comisión se calcula sobre lo que se ha ido cobrando de esa venta
-- en concreto.
--
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.venta_comisiones (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  venta_id    uuid NOT NULL REFERENCES public.ventas(id) ON DELETE CASCADE,
  nombre      text NOT NULL,
  tipo        text NOT NULL DEFAULT 'porcentaje', -- porcentaje | fijo
  valor       numeric NOT NULL,
  notas       text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_venta_comisiones_venta ON public.venta_comisiones(venta_id);
CREATE INDEX IF NOT EXISTS idx_venta_comisiones_nombre ON public.venta_comisiones(nombre);
