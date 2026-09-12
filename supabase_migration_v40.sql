-- v40: Poder ordenar y renombrar las categorías del catálogo (hasta ahora
-- solo se ordenaban alfabéticamente, de ahí el truco de ponerles números
-- delante al nombre), y que un producto pueda estar en más de una categoría
-- además de la principal.

ALTER TABLE public.catalog_categories ADD COLUMN IF NOT EXISTS display_order integer;

CREATE TABLE IF NOT EXISTS public.catalog_product_categories (
  product_id uuid NOT NULL REFERENCES public.catalog_products(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.catalog_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, category_id)
);
