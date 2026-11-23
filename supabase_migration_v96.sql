-- Ubicación de cada obra, para verla en el mapa de Oficinas.
-- No cambia ni borra ningún dato: solo añade cuatro columnas vacías a client_projects.
ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS obra_ciudad text;
ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS obra_pais text;
ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS obra_lat double precision;
ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS obra_lng double precision;
