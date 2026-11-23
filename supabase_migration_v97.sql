-- Pedidos agrupados: varias piezas de un proveedor que se piden de una vez comparten número, fecha y estado.
-- No cambia ni borra ningún dato: solo añade dos columnas vacías a budget_items.
ALTER TABLE public.budget_items ADD COLUMN IF NOT EXISTS pedido_ref text;
ALTER TABLE public.budget_items ADD COLUMN IF NOT EXISTS pedido_fecha date;
CREATE INDEX IF NOT EXISTS idx_budget_items_pedido_ref ON public.budget_items(pedido_ref);
