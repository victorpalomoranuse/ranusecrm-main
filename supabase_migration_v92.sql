-- Nivel de un capítulo: 1 = zona (Sala de máquinas, Vestuarios…), 2 = oficio dentro de una zona (Electricidad, Pavimentos…)
ALTER TABLE budget_items ADD COLUMN IF NOT EXISTS nivel_capitulo smallint DEFAULT 1;
