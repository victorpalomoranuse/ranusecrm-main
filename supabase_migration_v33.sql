-- v33: Guardar una copia del PDF del presupuesto en el propio presupuesto.
-- Se usa cuando el Asistente IA crea un presupuesto y genera el PDF él
-- mismo — así queda una copia accesible desde Presupuestos aunque luego
-- se edite el presupuesto a mano (el PDF "en vivo" siempre se puede volver
-- a generar con los datos actuales; este es solo la copia guardada).

ALTER TABLE public.budgets ADD COLUMN IF NOT EXISTS pdf_url text;
ALTER TABLE public.budgets ADD COLUMN IF NOT EXISTS pdf_generated_at timestamptz;
