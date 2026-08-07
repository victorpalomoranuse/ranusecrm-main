-- ============================================================
-- MIGRACIÓN V4 — Fases del proyecto (0–5) en MiProyecto
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

-- No hace falta bucket nuevo: los documentos de fase reutilizan
-- el bucket "project-documents" ya existente.

-- ── Documentos vinculados a una fase (A.01, IE.01, IE.02, C.01...) ─────
CREATE TABLE IF NOT EXISTS public.project_phase_documents (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id    uuid NOT NULL REFERENCES public.client_projects(id) ON DELETE CASCADE,
  phase_number  int NOT NULL,
  code          text NOT NULL,
  name          text NOT NULL,
  file_url      text NOT NULL,
  display_order int,
  created_at    timestamptz DEFAULT now()
);

-- ── Texto de introducción editable por fase (con fallback en frontend) ─
CREATE TABLE IF NOT EXISTS public.project_phase_content (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id    uuid NOT NULL REFERENCES public.client_projects(id) ON DELETE CASCADE,
  phase_number  int NOT NULL,
  intro_text    text,
  updated_at    timestamptz DEFAULT now(),
  UNIQUE (project_id, phase_number)
);

-- ── Vincular catálogo, renders y tours a una fase concreta ─────────────
-- (nullable: lo existente sin fase sigue funcionando igual que hoy)
ALTER TABLE public.project_material_selections ADD COLUMN IF NOT EXISTS phase_number int;
ALTER TABLE public.project_equipment_selections ADD COLUMN IF NOT EXISTS phase_number int;
ALTER TABLE public.project_renders ADD COLUMN IF NOT EXISTS phase_number int;
ALTER TABLE public.project_tours ADD COLUMN IF NOT EXISTS phase_number int;

-- ── client_projects.phase debe admitir 0 (Diseño previo) ───────────────
-- Si tienes un CHECK que limite el rango a 1-5, suéltalo y créalo de nuevo:
-- ALTER TABLE public.client_projects DROP CONSTRAINT IF EXISTS client_projects_phase_check;
-- ALTER TABLE public.client_projects ADD CONSTRAINT client_projects_phase_check CHECK (phase BETWEEN 0 AND 5);

-- ── Índices ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_phase_documents_project_phase ON public.project_phase_documents(project_id, phase_number);
CREATE INDEX IF NOT EXISTS idx_phase_content_project_phase ON public.project_phase_content(project_id, phase_number);
CREATE INDEX IF NOT EXISTS idx_material_selections_phase ON public.project_material_selections(project_id, phase_number);
CREATE INDEX IF NOT EXISTS idx_equipment_selections_phase ON public.project_equipment_selections(project_id, phase_number);
CREATE INDEX IF NOT EXISTS idx_renders_phase ON public.project_renders(project_id, phase_number);
CREATE INDEX IF NOT EXISTS idx_tours_phase ON public.project_tours(project_id, phase_number);
