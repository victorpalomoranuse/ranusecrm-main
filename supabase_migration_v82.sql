-- v82: nombre sencillo + descripción para el cliente
-- El "name" de un producto/partida pasa a ser el nombre corto (para ti);
-- "descripcion_cliente" guarda el texto largo y bien escrito que sale en el presupuesto del cliente (PDF).
ALTER TABLE public.catalog_products ADD COLUMN IF NOT EXISTS descripcion_cliente text;
ALTER TABLE public.budget_items     ADD COLUMN IF NOT EXISTS descripcion_cliente text;
