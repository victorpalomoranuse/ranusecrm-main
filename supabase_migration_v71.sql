-- v71: Bloques de producto (planta, alzado y lateral dibujados a escala) en el
-- catálogo. Se dibujan en el editor de bloques y se usan en la herramienta de planos.
-- Estructura: { largo, fondo, alto, shapes: {planta,alzado,lateral}, svg: {planta,alzado,lateral} }

ALTER TABLE public.catalog_products ADD COLUMN IF NOT EXISTS bloques jsonb;
