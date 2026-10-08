-- ============================================================
-- MIGRACIÓN V69 — Biblioteca de conocimiento para las IA
--
-- Guarda el texto de PDFs (apuntes del curso de reformas, normativa, guías...)
-- troceado en fragmentos con búsqueda de texto completo en español. Las IA
-- consultan solo los fragmentos relevantes a cada pregunta (no cargan todos
-- los PDFs cada vez). "Aprender" = tener esta biblioteca a mano.
--
--  ia_conocimiento_docs       = un documento (PDF) y qué asistentes lo usan
--  ia_conocimiento_fragmentos = su texto troceado + índice de búsqueda
--  buscar_conocimiento()      = función de búsqueda que usan las IA
--
-- Aditiva: tablas y función nuevas. No toca nada existente.
--
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ia_conocimiento_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL,
  fuente text,
  num_paginas integer,
  num_fragmentos integer,
  asistentes text[] NOT NULL DEFAULT '{presupuestos,proyecto}',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ia_conocimiento_fragmentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id uuid NOT NULL REFERENCES public.ia_conocimiento_docs(id) ON DELETE CASCADE,
  orden integer NOT NULL DEFAULT 0,
  pagina integer,
  texto text NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('spanish', texto)) STORED
);
CREATE INDEX IF NOT EXISTS idx_ia_conocimiento_tsv ON public.ia_conocimiento_fragmentos USING GIN (tsv);
CREATE INDEX IF NOT EXISTS idx_ia_conocimiento_doc ON public.ia_conocimiento_fragmentos(doc_id, orden);

-- consulta = palabras separadas por " | " (cualquiera de ellas), p. ej. 'humedad | capilaridad | muro'
CREATE OR REPLACE FUNCTION public.buscar_conocimiento(consulta text, asistente text, limite integer DEFAULT 6)
RETURNS TABLE (id uuid, documento text, pagina integer, texto text, rango real)
LANGUAGE sql STABLE AS $$
  SELECT f.id, d.titulo, f.pagina, f.texto, ts_rank(f.tsv, to_tsquery('spanish', consulta))
    FROM public.ia_conocimiento_fragmentos f
    JOIN public.ia_conocimiento_docs d ON d.id = f.doc_id
   WHERE d.asistentes @> ARRAY[asistente]
     AND f.tsv @@ to_tsquery('spanish', consulta)
   ORDER BY 5 DESC
   LIMIT limite
$$;
