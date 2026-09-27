-- v48: Palabras clave cortas para buscar productos/partidas de catálogo
-- que tienen un nombre largo y bien redactado (típico en partidas de
-- reformas), pero que se quieren encontrar rápido con una abreviatura.
ALTER TABLE catalog_products
  ADD COLUMN IF NOT EXISTS search_keywords text;

COMMENT ON COLUMN catalog_products.search_keywords IS 'Palabras clave cortas, separadas por comas, para buscar el producto por abreviatura (ej. "pladur, tabique, durlock").';
