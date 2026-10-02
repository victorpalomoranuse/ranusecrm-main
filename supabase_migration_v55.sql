-- Recordatorios de llamada 30 min y 5 min antes (además del de 24h).
ALTER TABLE call_slots ADD COLUMN IF NOT EXISTS recordatorio_30_enviado boolean NOT NULL DEFAULT false;
ALTER TABLE call_slots ADD COLUMN IF NOT EXISTS recordatorio_5_enviado boolean NOT NULL DEFAULT false;
