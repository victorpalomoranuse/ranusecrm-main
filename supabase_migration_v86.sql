-- v86: partidas "ya abonado" (p. ej. un diseño que el cliente ya pagó): se descuentan del total pero NO cuentan como ahorro en el PDF del cliente
ALTER TABLE public.budget_items ADD COLUMN IF NOT EXISTS ya_abonado boolean DEFAULT false;
