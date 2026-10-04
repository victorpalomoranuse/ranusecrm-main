-- ============================================================
-- MIGRACIÓN V62 — Plantilla gimnasio comercial: Entrenamiento antes que Vestuario
--
-- Intercambia el orden de los capítulos 2 y 3 SOLO en la plantilla de
-- "comercial" (y todo lo que cuelga de ellos: bloques, servicios y
-- entregables) y adapta el texto del Vestuario a que va después del
-- entreno. Los proyectos que ya existen no cambian: tienen su propia copia
-- de los capítulos (y se pueden reordenar con las flechas).
--
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

-- Capítulos (hay UNIQUE (tipo, orden): se pasa por valores temporales)
UPDATE public.plantillas_capitulo
   SET orden = CASE orden WHEN 2 THEN 103 WHEN 3 THEN 102 END
 WHERE tipo = 'comercial' AND orden IN (2, 3);
UPDATE public.plantillas_capitulo
   SET orden = orden - 100
 WHERE tipo = 'comercial' AND orden IN (102, 103);

-- Entregables y bloques sugeridos
UPDATE public.plantillas_entregable
   SET capitulo_orden = CASE capitulo_orden WHEN 2 THEN 3 WHEN 3 THEN 2 END
 WHERE tipo = 'comercial' AND capitulo_orden IN (2, 3);
UPDATE public.plantillas_bloque
   SET capitulo_orden = CASE capitulo_orden WHEN 2 THEN 3 WHEN 3 THEN 2 END
 WHERE tipo_proyecto = 'comercial' AND capitulo_orden IN (2, 3);

-- Servicios sugeridos (lista de capítulos donde suelen salir)
UPDATE public.plantillas_servicio
   SET capitulos_orden = (
     SELECT array_agg(CASE x WHEN 2 THEN 3 WHEN 3 THEN 2 ELSE x END ORDER BY ord)
       FROM unnest(capitulos_orden) WITH ORDINALITY AS t(x, ord)
   )
 WHERE tipo_proyecto = 'comercial' AND capitulos_orden && ARRAY[2, 3];

-- El Vestuario ahora llega después del entreno
UPDATE public.plantillas_capitulo
   SET texto_base = 'Terminas el entreno y el vestuario te recibe: el agua caliente, la piedra tibia bajo tus pies y una luz suave te quitan el cansancio de encima. Todo está pensado para ti y en cinco minutos estás listo para volver a tu día.'
 WHERE tipo = 'comercial' AND titulo = 'Vestuario';
