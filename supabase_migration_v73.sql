-- v73: Los bloques de la biblioteca pueden traer varias vistas (planta, frente y lateral)
-- o solo alguna (por ejemplo, solo alzado). La planta pasa a ser opcional.
-- (La vista lateral se guarda en la columna "lado" porque "lateral" es palabra reservada.)

ALTER TABLE public.biblioteca_bloques ALTER COLUMN planta DROP NOT NULL;
ALTER TABLE public.biblioteca_bloques ADD COLUMN IF NOT EXISTS alzado text;
ALTER TABLE public.biblioteca_bloques ADD COLUMN IF NOT EXISTS lado text;
