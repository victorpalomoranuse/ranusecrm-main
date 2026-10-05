-- ============================================================
-- MIGRACIÓN V66 — Home gym sin "Todo a mano" + catálogo de capítulos extra
--
-- 1) La plantilla de home gym pasa a 4 capítulos: Antes de entrar → El entreno
--    → Soltar → Hasta mañana. Lo que tenía "Todo a mano" se reparte:
--    equipo y luz/música a El entreno; "un sitio para cada cosa" a Hasta mañana.
-- 2) Nuevo catálogo de capítulos extra (zona de grabación de contenido,
--    boxeo, yoga, nutrición...) que se pueden añadir a cualquier proyecto,
--    al crearlo o después.
--
-- Solo toca PLANTILLAS y crea una tabla nueva: los proyectos existentes no cambian.
--
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

-- ── 1) Plantilla home gym: quitar "Todo a mano" (capítulo 2) ──────────
DELETE FROM public.plantillas_capitulo WHERE tipo = 'home_gym' AND orden = 2;
UPDATE public.plantillas_capitulo SET orden = orden + 100 WHERE tipo = 'home_gym' AND orden > 2;
UPDATE public.plantillas_capitulo SET orden = orden - 101 WHERE tipo = 'home_gym' AND orden > 100;

-- Bloques: se reparten los de "Todo a mano" y se renumeran los siguientes
DELETE FROM public.plantillas_bloque WHERE tipo_proyecto = 'home_gym' AND capitulo_orden = 2;
UPDATE public.plantillas_bloque SET capitulo_orden = capitulo_orden - 1 WHERE tipo_proyecto = 'home_gym' AND capitulo_orden > 2;
INSERT INTO public.plantillas_bloque (tipo_proyecto, capitulo_orden, orden, tipo, titulo, guia) VALUES
('home_gym', 2, 3, 'equipo', 'Lo que tendrás a mano', 'Se rellena solo con el equipamiento de Listados (cada equipo necesita foto).'),
('home_gym', 2, 4, 'imagen_texto', 'Luz y música a tu gusto', 'Las escenas de luz y de sonido para entrenar y cómo se activan.'),
('home_gym', 4, 2, 'imagen_texto', 'Un sitio para cada cosa', 'Alzado o esquema del almacenaje: dónde va cada cosa.');

-- Servicios sugeridos (se rehacen con los nuevos números de capítulo)
DELETE FROM public.plantillas_servicio WHERE tipo_proyecto = 'home_gym';
INSERT INTO public.plantillas_servicio (tipo_proyecto, nombre, guia, etiqueta, capitulos_orden) VALUES
('home_gym', 'Aislamiento acústico', 'Cómo se queda el ruido dentro y el resto de la casa sigue en silencio.', 'incluido', '{1}'),
('home_gym', 'Almacenaje oculto', 'Cómo desaparece el material cuando no se usa y cómo queda a mano cuando sí.', 'incluido', '{2,4}'),
('home_gym', 'Ambiente de sonido y luz', 'Escenas de luz y sonido para entrenar y para recuperar.', 'wow', '{2}'),
('home_gym', 'Ventilación y climatización', 'Cómo se renueva el aire y se mantiene la temperatura mientras entrenas.', 'incluido', '{2}');

-- Entregables: el render del almacenaje ya no aplica; el resto se renumera
DELETE FROM public.plantillas_entregable WHERE tipo = 'home_gym' AND nombre = 'Render del almacenaje';
UPDATE public.plantillas_entregable SET capitulo_orden = capitulo_orden - 1 WHERE tipo = 'home_gym' AND capitulo_orden > 2;

-- ── 2) Catálogo de capítulos extra ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.plantillas_capitulo_extra (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL,
  descripcion text,
  texto_base text NOT NULL,
  sensorial text,
  bloques jsonb NOT NULL DEFAULT '[]',
  orden integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

INSERT INTO public.plantillas_capitulo_extra (titulo, descripcion, texto_base, sensorial, bloques, orden) VALUES
('Zona de grabación de contenido', 'Un rincón preparado para grabar vídeo y fotos', 'Un rincón pensado para grabar: un fondo cuidado, una luz que favorece desde el primer segundo y un sonido limpio. Todo está preparado para que solo tengas que pulsar el botón.', 'luz: suave y frontal; sonido: sin eco',
 '[{"tipo":"render","titulo":"La zona de grabación","guia":"Render del rincón de grabación: fondo, luz y encuadre."},{"tipo":"imagen_texto","titulo":"Fondo, luz y sonido","guia":"Cómo se prepara el fondo, la iluminación y el tratamiento acústico."},{"tipo":"detalle","titulo":"Iluminación de grabación","guia":"Luces, temperatura de color y cómo se controlan."}]', 1),
('Zona de recuperación', 'Sauna, frío, estiramientos o masaje', 'El ritmo baja de golpe. Oyes el agua, sientes el calor en la piel y la luz se vuelve casi de atardecer. Aquí el entreno termina de hacerte bien.', 'tacto: calor; luz: de atardecer',
 '[{"tipo":"render","titulo":"La zona de recuperación","guia":"Render de sauna, baño frío o zona de estiramientos."},{"tipo":"imagen_texto","titulo":"Cómo se recupera aquí","guia":"Qué se hace en esta zona y en qué orden."},{"tipo":"detalle","titulo":"Acabados","guia":"Maderas, piedra, cristal y otros materiales."}]', 2),
('Zona de boxeo y combate', 'Saco, ring o zona de artes marciales', 'Aquí el espacio cambia de ritmo: el suelo agarra, el saco responde y cada golpe suena como debe. Un rincón para soltar energía sin pedir permiso.', 'sonido: el golpe seco del saco',
 '[{"tipo":"render","titulo":"La zona de combate","guia":"Render del saco, el ring o el tatami."},{"tipo":"zona","titulo":"Zona de boxeo","guia":"Qué hay en la zona: sacos, guantes, protecciones, suelo."}]', 3),
('Zona de yoga y movilidad', 'Suelo cálido para estirar, yoga o pilates', 'Un suelo cálido, una luz que baja de tono y espacio de sobra para respirar. Aquí el cuerpo se desacelera y la cabeza se despeja.', 'tacto: suelo cálido; luz: suave',
 '[{"tipo":"render","titulo":"La zona de movilidad","guia":"Render del espacio de yoga, pilates o estiramientos."},{"tipo":"imagen_texto","titulo":"Un espacio para respirar","guia":"Cómo se usa y qué lo hace tranquilo: luz, suelo, espejos."}]', 4),
('Zona funcional', 'Hyrox, crossfit o entrenamiento funcional', 'Un espacio abierto, un suelo que aguanta todo y todo el material al alcance. Aquí se empuja, se arrastra y se salta sin tener que pensar dónde.', 'sonido: el metal y el caucho; tacto: suelo firme',
 '[{"tipo":"render","titulo":"La zona funcional","guia":"Render de la zona abierta con el material."},{"tipo":"zona","titulo":"Pista y estaciones","guia":"Qué estaciones hay: sled, wall balls, remos, cuerdas..."}]', 5),
('Zona de nutrición', 'Bar de batidos, office o zona de café', 'Después del esfuerzo, un sitio donde parar un momento: un batido, un café y una conversación sin prisa. Aquí el entreno también se comenta.', 'olor: café recién hecho',
 '[{"tipo":"render","titulo":"La zona de nutrición","guia":"Render del bar o del rincón de batidos."},{"tipo":"imagen_texto","titulo":"Un momento para parar","guia":"Qué se ofrece y cómo se disfruta."}]', 6),
('Zona de fisioterapia y valoración', 'Consulta, valoración y tratamiento', 'Una sala tranquila donde alguien te escucha, te mide y te explica. Luz cálida, camilla cómoda y cero prisas: aquí se empieza a cuidar tu cuerpo.', 'luz: cálida; sonido: calma',
 '[{"tipo":"render","titulo":"La sala de valoración","guia":"Render de la consulta o la sala de valoración."},{"tipo":"imagen_texto","titulo":"La valoración inicial","guia":"Cómo es la primera valoración y qué se mide."}]', 7),
('Zona de descanso y espera', 'Lounge, sala de espera o rincón de descanso', 'Un sitio para esperar sin que se note: butacas cómodas, luz tenue y un silencio agradable. Llegas antes de tiempo y no te importa.', 'luz: tenue; tacto: tapizados suaves',
 '[{"tipo":"render","titulo":"La zona de descanso","guia":"Render del lounge o la sala de espera."},{"tipo":"imagen_texto","titulo":"Un rincón para parar","guia":"Cómo se usa y qué lo hace cómodo."}]', 8);
