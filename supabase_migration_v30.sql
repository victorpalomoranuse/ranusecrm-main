-- v30: Preferencias de selección de producto del Asistente IA de presupuestos.
-- Un solo campo de texto libre en "settings" (fila única, id=1) donde Víctor
-- puede describir sus criterios propios (marcas de confianza, qué evitar,
-- qué prioriza además del precio...). Se usa para orientar al asistente
-- cuando elige productos, además de la lógica de niveles por precio.

ALTER TABLE settings ADD COLUMN IF NOT EXISTS ai_budget_preferences text;
