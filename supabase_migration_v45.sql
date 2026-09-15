-- v45: Facturas de proyecto (archivo interno, NO visible para el cliente)
-- Guarda tanto las facturas de compra (lo que Ranuse paga a proveedores)
-- como las de venta (lo que se le cobra al cliente), asociadas a la obra,
-- para tener todo archivado si hay que reclamar una garantía.
-- Es una tabla y un bucket de Storage totalmente separados de
-- project_documents / project-documents (que sí ve el cliente en su portal).

CREATE TABLE IF NOT EXISTS project_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES client_projects(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('compra', 'venta')),
  numero_factura text,
  fecha date,
  importe numeric(10,2),
  contraparte text, -- nombre del proveedor (si es de compra) o del cliente/entidad que paga (si es de venta)
  notas text,
  url text NOT NULL,
  file_name text,
  uploaded_by uuid REFERENCES employees(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_invoices_project_id ON project_invoices(project_id);

-- Bucket de Storage para los archivos de factura (PDF/foto), público por URL
-- (igual que el resto de buckets de la app) pero solo referenciado desde
-- rutas internas protegidas — nunca se expone en el portal del cliente.
INSERT INTO storage.buckets (id, name, public)
VALUES ('project-invoices', 'project-invoices', true)
ON CONFLICT (id) DO NOTHING;
