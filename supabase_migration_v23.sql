-- ============================================================
-- MIGRACIÓN V23 — Marcar una venta como "cerrada"
--
-- Hasta ahora, mientras una venta con costes previstos seguía abierta, el
-- beneficio se calculaba siempre con el MAYOR entre lo previsto a mano y lo
-- realmente gastado — para no repartir como beneficio dinero que en
-- realidad estaba reservado para costes pendientes.
--
-- Con esta migración, cada venta puede marcarse como "cerrada" (desde su
-- formulario de edición en Ventas). Una vez cerrada, deja de usarse la
-- previsión y el beneficio se calcula solo con el gasto real definitivo —
-- útil cuando ya no va a haber más gastos y quieres que el número final
-- refleje lo que pasó de verdad, no la estimación.
--
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

ALTER TABLE public.ventas ADD COLUMN IF NOT EXISTS cerrada boolean NOT NULL DEFAULT false;
