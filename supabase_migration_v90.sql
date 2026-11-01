-- Textura (imagen que se repite) de un material del catálogo, para pintar con ella en el 3D. Distinta de la foto del producto
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS textura_url text;
