-- v49: Fecha/hora de la llamada agendada (Franco -> Hernán) en Setting.
ALTER TABLE setting_leads
  ADD COLUMN IF NOT EXISTS fecha_llamada timestamptz;

COMMENT ON COLUMN setting_leads.fecha_llamada IS 'Fecha y hora de la llamada agendada con el prospecto (Calendly u otro), para que Hernán vea su agenda directamente en el CRM.';
