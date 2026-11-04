-- Quién creó cada presupuesto. Los que ya existen quedan sin dato (null) y se consideran de Víctor.
-- Sirve para que una trabajadora con el permiso "Presupuestos" (p. ej. Alejandra) solo vea los suyos.
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS created_by uuid;
CREATE INDEX IF NOT EXISTS idx_budgets_created_by ON budgets (created_by);
