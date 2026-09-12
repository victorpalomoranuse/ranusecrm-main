-- v39: Poder ordenar los Trabajos de la web también para los proyectos de
-- clientes conectados (los antiguos ya se podían ordenar con las flechas
-- ↑↓ en el panel; ahora todos —antiguos y nuevos— comparten un único orden
-- desde la misma pantalla "Trabajos").

ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS portfolio_order integer;
