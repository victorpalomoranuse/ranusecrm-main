-- v98: hitos de pago (cobros del cliente) + tipo proyecto/pedido + avance de obra
CREATE TABLE IF NOT EXISTS public.payment_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.client_projects(id) ON DELETE CASCADE,
  budget_id uuid REFERENCES public.budgets(id) ON DELETE CASCADE,
  orden int NOT NULL DEFAULT 0,
  concepto text NOT NULL,
  porcentaje numeric(5,2) NOT NULL DEFAULT 0,
  importe numeric(12,2) NOT NULL DEFAULT 0,
  fecha_prevista date,
  fecha_cobro date,
  metodo text,
  num_factura text,
  estado text NOT NULL DEFAULT 'pendiente',   -- pendiente | facturado | cobrado (vencido se calcula)
  disparador text NOT NULL DEFAULT 'manual',  -- manual | aprobacion | avance_obra
  avance_minimo int,
  movimiento_id uuid,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pm_project ON public.payment_milestones(project_id);
CREATE INDEX IF NOT EXISTS idx_pm_budget ON public.payment_milestones(budget_id);
ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS tipo text DEFAULT 'proyecto';
ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS avance_obra int DEFAULT 0;
