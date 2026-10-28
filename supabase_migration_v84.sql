-- v84: oferta "si contratas todo junto" por presupuesto (% de descuento que se enseña aparte en el PDF del cliente)
ALTER TABLE public.budgets ADD COLUMN IF NOT EXISTS pack_discount_pct numeric;
