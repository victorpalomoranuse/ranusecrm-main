-- Google Calendar de cada empleado (dirección secreta en formato iCal, solo lectura):
-- los huecos de llamada que caen en un evento de Google salen como ocupados.
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS google_ical_url text;
