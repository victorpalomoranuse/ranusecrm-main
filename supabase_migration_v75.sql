-- Varios diseñadores por proyecto: además del «responsable», un proyecto puede tener
-- más personas asignadas. Los diseñadores ven los proyectos (y planos) donde son
-- responsables o están en esta lista.
CREATE TABLE IF NOT EXISTS public.project_assignees (
  project_id  uuid NOT NULL REFERENCES public.client_projects(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  created_at  timestamptz DEFAULT now(),
  PRIMARY KEY (project_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_project_assignees_employee ON public.project_assignees(employee_id);
