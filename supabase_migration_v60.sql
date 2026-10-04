-- ============================================================
-- MIGRACIÓN V60 — Historia: renders predefinidos en TODOS los capítulos
--
-- Cada capítulo ya tiene su "render principal". Esto añade un hueco de
-- render predefinido a los capítulos que no lo tenían, más un segundo
-- ángulo en los capítulos clave, para que al crear un proyecto nuevo ya
-- estén listos donde subirlos. Solo inserta ideas en las plantillas; no
-- toca ningún proyecto existente.
--
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

INSERT INTO public.plantillas_bloque (tipo_proyecto, capitulo_orden, orden, tipo, titulo, guia) VALUES
-- COMERCIAL
('comercial', 1, 0, 'render', 'Recepción', 'Segundo ángulo de la llegada: mostrador, iluminación y zona de espera.'),
('comercial', 2, 0, 'render', 'El vestuario', 'Render del vestuario: taquillas, bancos y zona de duchas.'),
('comercial', 3, 0, 'render', 'Otro ángulo de la sala', 'Segundo ángulo de la sala o de una zona destacada (p. ej. Hyrox).'),
('comercial', 5, 0, 'render', 'La despedida', 'Render de la salida: recepción vista desde dentro o el acceso por la tarde.'),
-- HOME GYM
('home_gym', 1, 0, 'render', 'La idea del espacio', 'Imagen de ambiente que capte lo que el cliente imagina.'),
('home_gym', 3, 0, 'render', 'Otro ángulo del entreno', 'Segundo ángulo del espacio de entrenamiento.'),
('home_gym', 4, 0, 'render', 'La recuperación', 'Render del rincón de estiramientos, descanso o spa.'),
('home_gym', 5, 0, 'render', 'Un espacio para quedarse', 'Render que muestre cómo convive el gimnasio con el resto de la casa.');
