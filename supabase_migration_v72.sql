-- v72: Biblioteca propia de bloques para la herramienta de planos.
-- Guarda dibujos en planta (trazos SVG a escala, en cm) importados desde DXF u otras
-- fuentes con licencia. Aparecen en el catálogo de bloques de Planos junto a los productos.

CREATE TABLE IF NOT EXISTS public.biblioteca_bloques (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  categoria text NOT NULL DEFAULT 'Mi biblioteca',
  largo numeric NOT NULL,
  fondo numeric NOT NULL,
  alto numeric NOT NULL DEFAULT 100,
  planta text NOT NULL,
  origen text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_biblioteca_bloques_cat ON public.biblioteca_bloques(categoria, nombre);
