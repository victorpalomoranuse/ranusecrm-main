-- v41: La página de Trabajos pasa a contar una historia — "El antes"
-- (qué problema/objetivo había), "Moodboard" (la solución propuesta) y "El
-- resultado" (qué se consiguió) — cada una con su propio texto, generable
-- con IA. El texto de moodboard/concepto ya existía (portfolio_concept);
-- aquí se añaden el del antes y el del resultado, más un campo privado
-- para que escribas tus indicaciones y la IA redacte el texto del
-- resultado a partir de ellas.

ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS portfolio_before_text text;
ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS portfolio_result_text text;
ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS portfolio_result_notes text;
