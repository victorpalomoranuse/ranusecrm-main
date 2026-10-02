-- v56: venta extra en Setting (maquina, servicio adicional fuera de la escalera de valor)
ALTER TABLE setting_leads ADD COLUMN IF NOT EXISTS fecha_venta_extra timestamptz;
ALTER TABLE setting_leads ADD COLUMN IF NOT EXISTS extra_descripcion text;
ALTER TABLE setting_leads ADD COLUMN IF NOT EXISTS extra_importe numeric;
