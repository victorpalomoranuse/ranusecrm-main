-- Combinador de colores: colores, suelos y estilos propios del estudio (se suman a los del sistema Ranuse).
-- Se guardan como JSON en la fila única de ajustes (id = 1).
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS combinador_custom text;
