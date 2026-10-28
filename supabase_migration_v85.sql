-- v85: la oferta "si contratas todo junto" también se puede poner como importe en euros (el cliente ve "Ahorras X €" en vez de un %)
ALTER TABLE public.budgets ADD COLUMN IF NOT EXISTS pack_discount_eur numeric;
