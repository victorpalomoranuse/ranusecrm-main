-- Permite ocultar al equipo el mes de comisiones en curso hasta que el
-- admin lo "cierre"/publique a propósito. Se parte con septiembre ya
-- publicado (lo que ya veían), así octubre queda oculto para el equipo
-- hasta que se publique a mano.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS comisiones_mes_publicado text DEFAULT '2026-09';
UPDATE settings SET comisiones_mes_publicado = '2026-09' WHERE id = 1 AND comisiones_mes_publicado IS NULL;
