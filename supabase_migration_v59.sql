-- ============================================================
-- MIGRACIÓN V59 — Historia: bloques de tipo "detalle"
--
-- Detalles de personalización y acabados (tapizado de máquinas en otro
-- color, lacados, rotulación...). Aditiva: solo amplía los tipos de bloque
-- permitidos y añade ideas nuevas a las plantillas. No toca datos existentes.
--
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

ALTER TABLE public.capitulo_bloques DROP CONSTRAINT IF EXISTS capitulo_bloques_tipo_check;
ALTER TABLE public.capitulo_bloques ADD CONSTRAINT capitulo_bloques_tipo_check
  CHECK (tipo IN ('imagen_texto', 'render', 'zona', 'detalle'));

ALTER TABLE public.plantillas_bloque DROP CONSTRAINT IF EXISTS plantillas_bloque_tipo_check;
ALTER TABLE public.plantillas_bloque ADD CONSTRAINT plantillas_bloque_tipo_check
  CHECK (tipo IN ('imagen_texto', 'render', 'zona', 'detalle'));

INSERT INTO public.plantillas_bloque (tipo_proyecto, capitulo_orden, orden, tipo, titulo, guia) VALUES
('comercial', 1, 10, 'detalle', 'Rotulación y marca', 'Logo, señalética y color de marca en el acceso: cómo se reconoce el gimnasio desde fuera y desde dentro.'),
('comercial', 2, 10, 'detalle', 'Lacado de taquillas', 'Color y acabado de las taquillas y por qué encaja con la paleta del proyecto.'),
('comercial', 2, 11, 'detalle', 'Griferías y accesorios', 'Acabado de la grifería, espejos y accesorios del vestuario.'),
('comercial', 3, 10, 'detalle', 'Tapizado de las máquinas', 'Color y material del tapizado a medida (a juego con la paleta). Qué máquinas lo llevan.'),
('comercial', 3, 11, 'detalle', 'Lacado de estructuras y racks', 'Color de las estructuras metálicas y acabado (mate, texturizado...).'),
('comercial', 3, 12, 'detalle', 'Suelo y señalización de zonas', 'Material del suelo y cómo se marca cada zona con color o textura.'),
('comercial', 4, 10, 'detalle', 'Acabados de la zona de recuperación', 'Maderas, piedra, cristal y otros materiales de sauna o spa.'),
('home_gym', 2, 10, 'detalle', 'Acabados de la entrada', 'Puerta, paredes y detalles que se ven y se tocan al entrar.'),
('home_gym', 3, 10, 'detalle', 'Tapizado y acabados del equipamiento', 'Color del tapizado y lacado del equipo, a juego con el espacio.');
