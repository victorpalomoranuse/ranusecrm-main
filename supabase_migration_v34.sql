-- v34: Cómo se calcula el precio de cada producto del catálogo, y sus
-- accesorios incluidos — para que tanto el Asistente IA como el propio
-- Víctor (al insertar un producto del catálogo en un presupuesto) apliquen
-- automáticamente el mismo criterio que él ya usa a mano:
--
-- - Si el producto tiene un dto. de compra (purchase_dto), el precio de
--   catálogo es el PVP y ese dto. es lo que Víctor se ahorra sobre ese PVP
--   (modo "pvp" de budget_items, igual que ya existe).
-- - Si no tiene dto., el precio de catálogo es su coste, y hay que sumarle
--   un margen (default_margin_pct; si no se indica, 20%).
-- - pricing_unit indica si el precio es por unidad ("ud", por defecto) o
--   por m² ("m2") — para productos como suelos, donde hay que multiplicar
--   por la superficie en vez de por el número de piezas.
-- - included_accessories es un texto libre con los accesorios que ya
--   vienen incluidos con el producto (ej. "Incluye J-cups y barra de
--   seguridad"), para que se pueda describir en el presupuesto.

ALTER TABLE public.catalog_products ADD COLUMN IF NOT EXISTS purchase_dto numeric;
ALTER TABLE public.catalog_products ADD COLUMN IF NOT EXISTS default_margin_pct numeric;
ALTER TABLE public.catalog_products ADD COLUMN IF NOT EXISTS pricing_unit text DEFAULT 'ud';
ALTER TABLE public.catalog_products ADD COLUMN IF NOT EXISTS included_accessories text;

-- Copia (snapshot) de los accesorios incluidos en la partida del presupuesto,
-- igual que ya se hace con marca/dimensiones/colores.
ALTER TABLE public.budget_items ADD COLUMN IF NOT EXISTS accessories_note text;
