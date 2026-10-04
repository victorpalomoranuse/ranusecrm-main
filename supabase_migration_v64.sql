-- ============================================================
-- MIGRACIÓN V64 — Historia: bloques "plano", "galería" y "equipo"
--
--  plano   = el plano de distribución con el recorrido numerado (imagen)
--            y una leyenda que lleva a cada capítulo. Va dentro del 1.er capítulo.
--  galeria = varios renders juntos en una rejilla (los renders del mismo
--            espacio, p. ej. un home gym, en un solo sitio).
--  equipo  = tarjetas con foto, nombre y marca del equipamiento de Listados.
--
-- Solo amplía los tipos de bloque permitidos y ajusta las PLANTILLAS de
-- bloques (comercial y home gym). No toca ningún proyecto existente.
--
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

ALTER TABLE public.capitulo_bloques DROP CONSTRAINT IF EXISTS capitulo_bloques_tipo_check;
ALTER TABLE public.capitulo_bloques ADD CONSTRAINT capitulo_bloques_tipo_check
  CHECK (tipo IN ('imagen_texto', 'render', 'zona', 'detalle', 'plano', 'galeria', 'equipo'));

ALTER TABLE public.plantillas_bloque DROP CONSTRAINT IF EXISTS plantillas_bloque_tipo_check;
ALTER TABLE public.plantillas_bloque ADD CONSTRAINT plantillas_bloque_tipo_check
  CHECK (tipo IN ('imagen_texto', 'render', 'zona', 'detalle', 'plano', 'galeria', 'equipo'));

-- Gimnasio comercial: el recorrido en la Llegada
INSERT INTO public.plantillas_bloque (tipo_proyecto, capitulo_orden, orden, tipo, titulo, guia) VALUES
('comercial', 1, 5, 'plano', 'El recorrido', 'Plano de distribución con el recorrido del cliente numerado (sube la imagen). La leyenda con los capítulos se genera sola.');

-- Home gym: renders concentrados en El entreno; el resto de capítulos aportan otra cosa
DELETE FROM public.plantillas_bloque
 WHERE tipo_proyecto = 'home_gym'
   AND ((capitulo_orden = 2 AND titulo = 'Todo en su sitio')
     OR (capitulo_orden = 3 AND titulo IN ('Otro ángulo del entreno', 'La zona de entreno')));

INSERT INTO public.plantillas_bloque (tipo_proyecto, capitulo_orden, orden, tipo, titulo, guia) VALUES
('home_gym', 1, 5, 'plano', 'El recorrido de tu día', 'Plano de distribución con el recorrido numerado (sube la imagen). La leyenda con los capítulos se genera sola.'),
('home_gym', 2, 0, 'equipo', 'Lo que tendrás a mano', 'Se rellena solo con el equipamiento de Listados (cada equipo necesita foto).'),
('home_gym', 2, 2, 'imagen_texto', 'Un sitio para cada cosa', 'Alzado o esquema del almacenaje: dónde va cada cosa.'),
('home_gym', 3, 0, 'galeria', 'El espacio, desde todos los ángulos', 'Todos los renders del espacio juntos (sube varios a la vez).');
