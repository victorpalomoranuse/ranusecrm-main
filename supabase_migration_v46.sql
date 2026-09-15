-- v46: Fix de la v45 — uploaded_by no puede tener FK a employees, porque el
-- id de sesión (req.user.id) no siempre corresponde a un registro de esa
-- tabla (p. ej. la cuenta de administración). Se deja como uuid simple.

ALTER TABLE project_invoices DROP CONSTRAINT IF EXISTS project_invoices_uploaded_by_fkey;
