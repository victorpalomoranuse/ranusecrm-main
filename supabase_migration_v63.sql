-- ============================================================
-- MIGRACIÓN V63 — Plantilla home gym: "un día de entrenamiento en tu nuevo home gym"
--
-- Rehace SOLO las plantillas de home_gym (capítulos, ideas de bloque,
-- servicios sugeridos y entregables). Los proyectos que ya existen no
-- cambian: tienen su propia copia de los capítulos.
--
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

-- Se borran solo las plantillas de home gym y se vuelven a crear
DELETE FROM public.plantillas_bloque WHERE tipo_proyecto = 'home_gym';
DELETE FROM public.plantillas_servicio WHERE tipo_proyecto = 'home_gym';
DELETE FROM public.plantillas_entregable WHERE tipo = 'home_gym';
DELETE FROM public.plantillas_capitulo WHERE tipo = 'home_gym';

INSERT INTO public.plantillas_capitulo (tipo, orden, titulo, texto_base, sensorial) VALUES
('home_gym', 1, 'Antes de entrar',
 'Cruzas el pasillo y abres la puerta: la casa se queda al otro lado. La luz baja de tono, el ruido desaparece y el aire huele a goma y a hierro limpio. En tres pasos has cambiado de mundo.',
 'sonido: el silencio al cerrar la puerta'),
('home_gym', 2, 'Todo a mano',
 'Dejas el móvil y el entreno empieza solo: las mancuernas están en su sitio, la luz ámbar se enciende suave y suena tu lista. Nada que buscar, nada que montar. En un minuto estás listo.',
 'luz: ámbar y cálida; sonido: tu música'),
('home_gym', 3, 'El entreno',
 'El suelo amortigua cada paso, el espejo te devuelve tu mejor versión y el hierro suena como debe. Tienes todo a mano y nada sobra. Entrenas a tu ritmo, sin esperas ni miradas, en tu casa.',
 'tacto: suelo que amortigua; sonido: el metal de las pesas'),
('home_gym', 4, 'Soltar',
 'Terminas y no hace falta ir a ninguna parte. Estiras sobre una superficie cálida, la luz baja a su punto más tenue y todo se queda en silencio. Tu cuerpo lo agradece y tu casa también.',
 'luz: tenue; sonido: silencio'),
('home_gym', 5, 'Hasta mañana',
 'Apagas la luz y el gimnasio se queda en calma, ordenado y sin imponerse. Mañana te estará esperando igual; hoy, la casa vuelve a ser solo casa. Se ha convertido en tu rincón favorito del hogar.',
 'luz: la última, apagándose despacio');

INSERT INTO public.plantillas_bloque (tipo_proyecto, capitulo_orden, orden, tipo, titulo, guia) VALUES
('home_gym', 1, 0, 'render', 'La puerta', 'Render de la puerta y del acceso desde la casa: el momento de cruzar.'),
('home_gym', 1, 1, 'imagen_texto', 'Del salón al gimnasio', 'Cómo se llega, cómo se separa del resto de la casa y cómo se queda el ruido dentro.'),
('home_gym', 1, 10, 'detalle', 'Acabados de la entrada', 'Puerta, paredes y detalles que se ven y se tocan al entrar.'),
('home_gym', 2, 0, 'render', 'Todo en su sitio', 'Render del almacenaje: el material ordenado y a la vista justa.'),
('home_gym', 2, 1, 'imagen_texto', 'Luz y música a tu gusto', 'Las escenas de luz y de sonido para entrenar y cómo se activan.'),
('home_gym', 3, 0, 'render', 'Otro ángulo del entreno', 'Segundo ángulo del espacio de entrenamiento.'),
('home_gym', 3, 1, 'render', 'La zona de entreno', 'Render grande del espacio de entrenamiento.'),
('home_gym', 3, 2, 'zona', 'Las zonas del espacio', 'Cada zona y su equipamiento: fuerza, cardio, movilidad, boxeo...'),
('home_gym', 3, 10, 'detalle', 'Tapizado y acabados del equipamiento', 'Color del tapizado y lacado del equipo, a juego con el espacio.'),
('home_gym', 4, 0, 'render', 'La recuperación', 'Render del rincón de estiramientos, descanso o spa.'),
('home_gym', 4, 1, 'imagen_texto', 'Estirar y respirar', 'Dónde se estira, se descansa o se relaja después de entrenar.'),
('home_gym', 5, 0, 'render', 'Un espacio para quedarse', 'Render que muestre cómo convive el gimnasio con el resto de la casa.'),
('home_gym', 5, 1, 'imagen_texto', 'Orden y silencio', 'Cómo queda el gimnasio cuando no se usa.');

INSERT INTO public.plantillas_servicio (tipo_proyecto, nombre, guia, etiqueta, capitulos_orden) VALUES
('home_gym', 'Aislamiento acústico', 'Cómo se queda el ruido dentro y el resto de la casa sigue en silencio.', 'incluido', '{1}'),
('home_gym', 'Almacenaje oculto', 'Cómo desaparece el material cuando no se usa y cómo queda a mano cuando sí.', 'incluido', '{2,5}'),
('home_gym', 'Ambiente de sonido y luz', 'Escenas de luz y sonido para entrenar y para recuperar.', 'wow', '{2,3}'),
('home_gym', 'Ventilación y climatización', 'Cómo se renueva el aire y se mantiene la temperatura mientras entrenas.', 'incluido', '{3}');

INSERT INTO public.plantillas_entregable (tipo, capitulo_orden, orden, nombre, descripcion, formato, visible_cliente, opcional) VALUES
('home_gym', 0, 1, 'Plano de distribución con recorrido', 'Planta cuidada a nivel estético con el recorrido del cliente trazado y numerado según los capítulos de la historia.', 'PDF', true, false),
('home_gym', 0, 2, 'Plano de demoliciones', 'Qué se tira o se retira del estado actual. Solo cuando haya obra previa.', 'PDF', true, true),
('home_gym', 0, 3, 'Plano de implantación', 'Cómo se ubican las zonas y el equipamiento sobre el espacio existente. Solo cuando haga falta.', 'PDF', true, true),
('home_gym', 0, 4, 'Propuesta de ejecución (Servicio 2)', 'Alcance, plazos y presupuesto de la fase de ejecución.', 'PDF', true, false),
('home_gym', 1, 1, 'Render de la puerta y el acceso', 'Cómo se ve y se siente al abrir la puerta del gimnasio.', 'Imagen JPG/PNG', true, false),
('home_gym', 1, 2, 'Resumen de necesidades y medidas', 'Medidas del espacio, uso previsto y limitaciones.', 'PDF', false, false),
('home_gym', 2, 1, 'Render del almacenaje', 'El material ordenado y a mano.', 'Imagen JPG/PNG', true, false),
('home_gym', 2, 2, 'Esquema de almacenaje y puntos de luz', 'Dónde va cada cosa y qué escenas de luz se prevén.', 'PDF', false, false),
('home_gym', 3, 1, 'Render principal de la zona de entreno', 'Vista general con suelo, espejo, equipamiento y luz.', 'Imagen JPG/PNG', true, false),
('home_gym', 3, 2, 'Plano de equipamiento y alturas', 'Colocación de máquinas, racks y comprobación de alturas libres.', 'PDF', false, false),
('home_gym', 3, 3, 'Plano de proyección de iluminación', 'Planta con luminarias, temperatura de color y puntos de luz.', 'PDF', false, false),
('home_gym', 3, 4, 'Esquema de instalaciones eléctricas y ventilación', 'Tomas, climatización y ventilación necesarias.', 'PDF', false, false),
('home_gym', 4, 1, 'Render de la zona de recuperación', 'Vista de estiramientos, descanso o spa.', 'Imagen JPG/PNG', true, false);
