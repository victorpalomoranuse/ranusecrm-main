-- ============================================================
-- MIGRACIÓN V17 — Previsión negociada por proveedor en Relación de obra
--
-- Añade un "previsto" editable por proveedor y por obra: el coste
-- presupuestado al cliente no cambia (es el compromiso original),
-- pero una vez aceptado el presupuesto muchas veces renegocias con
-- el proveedor. Esta tabla guarda esa cifra revisada, para poder
-- comparar Presupuestado / Previsto (tras negociar) / Pagado real.
--
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.obra_previsiones (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  venta_id    uuid NOT NULL REFERENCES public.ventas(id) ON DELETE CASCADE,
  proveedor   text NOT NULL,
  monto       numeric NOT NULL DEFAULT 0,
  notas       text,
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (venta_id, proveedor)
);

CREATE INDEX IF NOT EXISTS idx_obra_previsiones_venta ON public.obra_previsiones(venta_id);
