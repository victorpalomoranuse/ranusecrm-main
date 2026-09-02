-- ============================================================
-- MIGRACIÓN V25 — Clientes se registran solos + recuperar contraseña
--
-- Añade el nombre a la cuenta (antes solo tenía email+contraseña) y una
-- tabla para los enlaces de "restablecer contraseña" (token de un solo
-- uso, caduca en 1 hora).
--
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS name text;

CREATE TABLE IF NOT EXISTS public.password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_resets_token_hash ON public.password_resets(token_hash);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON public.password_resets(user_id);
