-- Foto propia en las partidas de un presupuesto (para productos que no se guardan en el catálogo)
ALTER TABLE budget_items ADD COLUMN IF NOT EXISTS image_url text;
