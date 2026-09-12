-- v42: Asistente IA de presupuestos más completo — puede leer la página web
-- de un producto para comparar materiales/características entre ellos,
-- tiene en cuenta medidas y dimensiones para avisar si algo puede no
-- encajar, y conoce tus propias reglas de reformas además de su
-- conocimiento general. Los presupuestos además ahora pueden llevar un
-- texto de garantía y una forma de pago elegida de una lista (en vez de
-- un único texto fijo para todos).

CREATE TABLE IF NOT EXISTS public.budget_payment_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text text NOT NULL,
  display_order integer,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.budgets ADD COLUMN IF NOT EXISTS payment_option_id uuid REFERENCES public.budget_payment_options(id) ON DELETE SET NULL;
ALTER TABLE public.budgets ADD COLUMN IF NOT EXISTS payment_option_text text;

ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS warranty_text text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS ai_reform_rules text;

-- Productos que son complementos habituales de otro (con su propio precio
-- desglosado aparte) — ej. un rack y su kit de poleas opcional.
CREATE TABLE IF NOT EXISTS public.catalog_product_complements (
  product_id uuid NOT NULL REFERENCES public.catalog_products(id) ON DELETE CASCADE,
  complement_id uuid NOT NULL REFERENCES public.catalog_products(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, complement_id)
);
