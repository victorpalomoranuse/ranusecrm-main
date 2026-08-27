-- ============================================================
-- MIGRACIÓN V13 — Portada de proyecto, campos de selección de
-- catálogo (código/ficha técnica/ubicación) y Programa de
-- Necesidades (formulario guiado por opciones + mediciones/fotos
-- aparte).
--
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

-- ── Portada del proyecto ────────────────────────────────────────────────
ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS cover_image_url text;

-- ── Campos que faltaban en la selección de materiales/equipamiento ─────
ALTER TABLE public.project_material_selections ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE public.project_material_selections ADD COLUMN IF NOT EXISTS datasheet_url text;

ALTER TABLE public.project_equipment_selections ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE public.project_equipment_selections ADD COLUMN IF NOT EXISTS datasheet_url text;
ALTER TABLE public.project_equipment_selections ADD COLUMN IF NOT EXISTS location text;

-- ── Programa de Necesidades ──────────────────────────────────────────────

-- Catálogo global de preguntas (tú las editas/añades/reordenas desde Ajustes).
-- question_type:
--   texto | texto_largo | numero | si_no
--   opcion_unica | opcion_multiple   → usan "options" (array de strings)
--   estilo_imagenes                  → el cliente elige entre tus Referencias
--   catalogo_productos               → el cliente/comercial elige productos reales del catálogo
CREATE TABLE IF NOT EXISTS public.needs_form_questions (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  question_text text NOT NULL,
  question_type text NOT NULL DEFAULT 'texto',
  options       jsonb DEFAULT '[]'::jsonb,
  section       text,
  display_order int NOT NULL DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);

-- Un formulario por proyecto
CREATE TABLE IF NOT EXISTS public.project_needs_forms (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id       uuid NOT NULL REFERENCES public.client_projects(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'borrador', -- borrador | enviado
  filled_by_role   text, -- cliente | comercial
  filled_by_name   text,
  submitted_at     timestamptz,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  UNIQUE (project_id)
);

-- Respuestas: answer_value admite texto, número, booleano o listas
-- (opciones elegidas, ids de producto de catálogo, ids de referencia de estilo)
CREATE TABLE IF NOT EXISTS public.project_needs_form_answers (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  form_id     uuid NOT NULL REFERENCES public.project_needs_forms(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.needs_form_questions(id) ON DELETE CASCADE,
  answer_value jsonb,
  UNIQUE (form_id, question_id)
);

-- Mediciones — se suben aparte del formulario (por ti o por el cliente),
-- dentro del mismo apartado de Programa de Necesidades.
CREATE TABLE IF NOT EXISTS public.project_needs_form_measurements (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  form_id       uuid NOT NULL REFERENCES public.project_needs_forms(id) ON DELETE CASCADE,
  space_name    text NOT NULL,
  largo         numeric,
  ancho         numeric,
  alto          numeric,
  notes         text,
  display_order int NOT NULL DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);

-- Fotos del estado actual (sin reformar) — también aparte del formulario
CREATE TABLE IF NOT EXISTS public.project_needs_form_photos (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  form_id       uuid NOT NULL REFERENCES public.project_needs_forms(id) ON DELETE CASCADE,
  url           text NOT NULL,
  caption       text,
  display_order int NOT NULL DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_needs_form_answers_form ON public.project_needs_form_answers(form_id);
CREATE INDEX IF NOT EXISTS idx_needs_form_measurements_form ON public.project_needs_form_measurements(form_id);
CREATE INDEX IF NOT EXISTS idx_needs_form_photos_form ON public.project_needs_form_photos(form_id);

-- ── Plantilla de preguntas de partida (editable después desde Ajustes) ──
INSERT INTO public.needs_form_questions (question_text, question_type, options, section, display_order)
SELECT v.q, v.t, v.o::jsonb, v.s, v.ord FROM (VALUES
  ('¿Para cuántas personas será el espacio a la vez?', 'opcion_unica', '["1 persona","2 personas","3-4 personas","5 o más"]', 'Uso del espacio', 0),
  ('¿Qué tipo de entrenamiento se hará principalmente?', 'opcion_multiple', '["Fuerza / Pesas","Cardio","Funcional / Crossfit","Boxeo","Yoga / Movilidad","Recuperación (sauna, hielo...)"]', 'Uso del espacio', 1),
  ('¿Con qué frecuencia se usará el espacio?', 'opcion_unica', '["A diario","Varias veces por semana","Ocasionalmente"]', 'Uso del espacio', 2),
  ('¿Qué máquinas o equipamiento te gustaría incluir?', 'catalogo_productos', '[]', 'Máquinas y equipamiento', 3),
  ('¿Qué pesos máximos se levantarán habitualmente (barra + discos)?', 'opcion_unica', '["Hasta 60 kg","60-100 kg","100-150 kg","Más de 150 kg","No estoy seguro"]', 'Máquinas y equipamiento', 4),
  ('¿Qué estilo te gusta más?', 'estilo_imagenes', '[]', 'Estilo y decoración', 5),
  ('¿Hay colores o materiales que prefieras o quieras evitar?', 'texto', '[]', 'Estilo y decoración', 6),
  ('¿Hay algo personal que quieras reflejar en el espacio (una historia, un logro, un equipo, un color de marca...)?', 'texto_largo', '[]', 'Estilo y decoración', 7),
  ('¿Qué grado de transformación buscas?', 'opcion_unica', '["Solo redecoración (sin tocar obra)","Redecoración + redistribución (mover elementos, sin tirar tabiques)","Obra completa (tabiques, instalaciones nuevas...)"]', 'Alcance del proyecto', 8),
  ('¿Cuál es tu presupuesto estimado?', 'opcion_unica', '["Menos de 5.000€","5.000€ - 15.000€","15.000€ - 30.000€","Más de 30.000€","Prefiero que me asesoréis"]', 'Alcance del proyecto', 9),
  ('¿Hay algún plazo o fecha límite importante?', 'texto', '[]', 'Alcance del proyecto', 10)
) AS v(q, t, o, s, ord)
WHERE NOT EXISTS (SELECT 1 FROM public.needs_form_questions);
