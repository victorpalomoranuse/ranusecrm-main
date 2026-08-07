-- ============================================================
-- MIGRACIÓN V5 — Tareas vinculadas a proyecto/fase + checklists
-- automáticas por fase + campos de pedido en líneas de presupuesto
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

-- ── Plantillas de checklist por fase ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.phase_task_templates (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  phase_number  int NOT NULL,
  title         text NOT NULL,
  description   text,
  display_order int,
  created_at    timestamptz DEFAULT now()
);

-- ── Tareas: vincular a proyecto, fase, empleado y plantilla de origen ──
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.client_projects(id) ON DELETE CASCADE;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS phase_number int;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.employees(id) ON DELETE SET NULL;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.phase_task_templates(id) ON DELETE SET NULL;

-- ── Pedidos: campos de compra sobre las líneas de presupuesto ──────────
ALTER TABLE public.budget_items ADD COLUMN IF NOT EXISTS order_status text DEFAULT 'pendiente';
ALTER TABLE public.budget_items ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'pendiente';
ALTER TABLE public.budget_items ADD COLUMN IF NOT EXISTS delivery_date date;
ALTER TABLE public.budget_items ADD COLUMN IF NOT EXISTS provider text;

-- ── Índices ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_phase_task_templates_phase ON public.phase_task_templates(phase_number);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON public.tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON public.tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_budget_items_order_status ON public.budget_items(order_status);
