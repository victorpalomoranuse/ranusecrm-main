-- v47: Permite marcar un evento del calendario como finalizado.
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS done boolean NOT NULL DEFAULT false;
