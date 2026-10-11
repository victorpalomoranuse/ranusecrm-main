-- v73: Los bloques de la biblioteca pueden traer varias vistas (planta, frente y lateral)
-- o solo alguna (por ejemplo, solo alzado). La planta pasa a ser opcional.

ALTER TABLE public.biblioteca_bloques ALTER COLUMN planta DROP NOT NULL;
ALTER TABLE public.biblioteca_bloques ADD COLUMN IF NOT EXISTS alzado text;
ALTER TABLE public.biblioteca_bloques ADD COLUMN IF NOT EXISTS lateral text;
