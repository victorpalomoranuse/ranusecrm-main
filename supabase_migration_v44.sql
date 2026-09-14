-- v44: Nivel de uso del producto (doméstico / semi profesional / profesional)
-- Permite que el catálogo indique para qué tipo de uso está pensado cada
-- producto, para que la IA de presupuestos pueda asesorar mejor según el
-- perfil del cliente (particular, entrenador/boutique, centro profesional).

ALTER TABLE catalog_products
  ADD COLUMN IF NOT EXISTS nivel_uso text
  CHECK (nivel_uso IN ('domestico', 'semi_profesional', 'profesional'));

COMMENT ON COLUMN catalog_products.nivel_uso IS 'Nivel de uso recomendado: domestico, semi_profesional o profesional. Puede ser NULL si no se ha clasificado.';
