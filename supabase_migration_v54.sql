-- Enlace de la grabación de Fathom de cada llamada, para poder consultarla
-- desde la agenda de Hernán.
ALTER TABLE call_slots ADD COLUMN IF NOT EXISTS fathom_url text;
