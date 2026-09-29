-- v50: Venta 1 / Venta 2 independientes (dos servicios distintos que se
-- pueden comprar por separado o los dos), más los estados "rechazo" y
-- "seguimiento futuro" en Setting.
ALTER TABLE setting_leads
  ADD COLUMN IF NOT EXISTS fecha_venta_1 timestamptz,
  ADD COLUMN IF NOT EXISTS fecha_venta_2 timestamptz;

COMMENT ON COLUMN setting_leads.fecha_venta_1 IS 'Fecha en la que se compró el servicio 1 (independiente del estado actual del embudo), para poder medir cuántos compran solo el 1, solo el 2, o los dos.';
COMMENT ON COLUMN setting_leads.fecha_venta_2 IS 'Fecha en la que se compró el servicio 2 (independiente del estado actual del embudo).';
