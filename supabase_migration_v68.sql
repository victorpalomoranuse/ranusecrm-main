-- ============================================================
-- MIGRACIÓN V68 — Conversaciones guardadas de las IA (Setter y Asistente IA)
--
-- Cada persona guarda las suyas y puede retomarlas. Las capturas y planos
-- se suben al almacenamiento y aquí solo queda su enlace.
--
-- Aditiva: tabla nueva. No toca nada existente.
--
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ia_conversaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  asistente text NOT NULL CHECK (asistente IN ('setter', 'presupuestos')),
  titulo text,
  mensajes jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ia_conversaciones_user ON public.ia_conversaciones(user_id, asistente, updated_at DESC);
