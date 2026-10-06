-- ============================================================
-- MIGRACIÓN V67 — Asistente de diseño por proyecto
--
-- Un asistente de IA dentro de cada proyecto que conoce su moodboard, paleta,
-- necesidades, medidas e historia, y te ayuda mientras lo montas.
--
--  client_projects.condicionantes = limitaciones del proyecto que el
--      asistente tiene siempre en cuenta (techo bajo, pilar central, poca luz...)
--  agente_mensajes = la conversación con el asistente, por proyecto
--
-- Aditiva: columna nullable + tabla nueva. No toca nada existente.
--
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS condicionantes text;

CREATE TABLE IF NOT EXISTS public.agente_mensajes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto_id uuid NOT NULL REFERENCES public.client_projects(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agente_mensajes_proyecto ON public.agente_mensajes(proyecto_id, created_at);
