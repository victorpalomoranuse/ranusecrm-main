-- Varios presupuestos por proyecto (alternativas, ampliaciones, fases…).
-- Quita la restricción «un proyecto = un presupuesto» de la tabla budgets. No borra ni cambia ningún dato.
DO $$
DECLARE c text;
BEGIN
  -- restricción UNIQUE sobre project_id (la que da el error «Este proyecto ya tiene presupuesto»)
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.budgets'::regclass AND contype = 'u' AND pg_get_constraintdef(oid) ILIKE '%(project_id)%'
  LOOP
    EXECUTE 'ALTER TABLE public.budgets DROP CONSTRAINT ' || quote_ident(c);
  END LOOP;
  -- por si en vez de una restricción es un índice único suelto
  FOR c IN
    SELECT i.indexname FROM pg_indexes i
    WHERE i.schemaname = 'public' AND i.tablename = 'budgets' AND i.indexdef ILIKE 'CREATE UNIQUE INDEX%(project_id)%'
      AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = (quote_ident(i.indexname))::regclass)
  LOOP
    EXECUTE 'DROP INDEX public.' || quote_ident(c);
  END LOOP;
END $$;
