-- v57: resumen diario por email (tareas y eventos del dia) para el admin
ALTER TABLE settings ADD COLUMN IF NOT EXISTS resumen_diario_enviado date;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS resumen_diario_email text;
