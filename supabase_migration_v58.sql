-- ============================================================
-- MIGRACIÓN V58 — Escalera de valor: Proyecto creativo en capítulos
--
-- 100% ADITIVA: una columna nullable nueva y tablas nuevas. No modifica
-- ni borra ningún dato de proyectos existentes (los antiguos tendrán
-- tipo_proyecto NULL y no tendrán capítulos).
--
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

-- 1) Tipo de proyecto (NULL en todos los proyectos que ya existen)
ALTER TABLE public.client_projects ADD COLUMN IF NOT EXISTS tipo_proyecto text;
ALTER TABLE public.client_projects DROP CONSTRAINT IF EXISTS client_projects_tipo_proyecto_check;
ALTER TABLE public.client_projects ADD CONSTRAINT client_projects_tipo_proyecto_check
  CHECK (tipo_proyecto IS NULL OR tipo_proyecto IN ('comercial', 'home_gym'));

-- 2) Plantillas de capítulo (la "historia" base de cada tipo)
CREATE TABLE IF NOT EXISTS public.plantillas_capitulo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('comercial', 'home_gym')),
  orden integer NOT NULL,
  titulo text NOT NULL,
  texto_base text NOT NULL,
  sensorial text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (tipo, orden)
);

-- 3) Qué hay que entregar en cada capítulo (checklist para el equipo)
CREATE TABLE IF NOT EXISTS public.plantillas_entregable (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('comercial', 'home_gym')),
  capitulo_orden integer NOT NULL,
  orden integer NOT NULL DEFAULT 0,
  nombre text NOT NULL,
  descripcion text,
  formato text,
  visible_cliente boolean NOT NULL DEFAULT false,
  opcional boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);
-- capitulo_orden = 0 significa entregable GENERAL del proyecto (no de un capítulo)

-- 4) Capítulos de cada proyecto (copia editable de la plantilla; también
--    se pueden añadir capítulos manuales)
CREATE TABLE IF NOT EXISTS public.capitulos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto_id uuid NOT NULL REFERENCES public.client_projects(id) ON DELETE CASCADE,
  orden integer NOT NULL DEFAULT 0,
  titulo text NOT NULL,
  texto text,
  sensorial text,
  render_url text,
  tour_url text, -- opcional: solo en algunos proyectos
  origen text NOT NULL DEFAULT 'plantilla' CHECK (origen IN ('plantilla', 'manual')),
  visible boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_capitulos_proyecto ON public.capitulos(proyecto_id, orden);

-- 5) Bloques de un capítulo: los "momentos" y detalles que se cuentan dentro
--    del recorrido. Cada espacio es distinto, así que son libres:
--      imagen_texto = imagen + texto al lado (lado izquierda/derecha)
--      render       = imagen grande a todo el ancho con un pie
--      zona         = UNA zona (Hyrox, fuerza, cardio...) con su imagen, su texto
--                     y la lista de lo que tiene (elementos). Un capítulo puede
--                     tener todas las zonas que haga falta
--    "guia" es una pista INTERNA para el equipo (qué contar aquí); nunca se
--    muestra al cliente. Un bloque sin texto ni imagen no se muestra.
CREATE TABLE IF NOT EXISTS public.capitulo_bloques (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto_id uuid NOT NULL REFERENCES public.client_projects(id) ON DELETE CASCADE,
  capitulo_id uuid NOT NULL REFERENCES public.capitulos(id) ON DELETE CASCADE,
  orden integer NOT NULL DEFAULT 0,
  tipo text NOT NULL DEFAULT 'imagen_texto' CHECK (tipo IN ('imagen_texto', 'render', 'zona')),
  titulo text,
  texto text,
  imagen_url text,
  elementos text[],
  lado text NOT NULL DEFAULT 'derecha' CHECK (lado IN ('izquierda', 'derecha')),
  guia text,
  visible boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_capitulo_bloques_capitulo ON public.capitulo_bloques(capitulo_id, orden);

-- 6) Ideas de bloque por capítulo (se copian vacías a cada proyecto nuevo
--    como recordatorio de qué detalles conviene contar)
CREATE TABLE IF NOT EXISTS public.plantillas_bloque (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_proyecto text NOT NULL CHECK (tipo_proyecto IN ('comercial', 'home_gym')),
  capitulo_orden integer NOT NULL,
  orden integer NOT NULL DEFAULT 0,
  tipo text NOT NULL DEFAULT 'imagen_texto' CHECK (tipo IN ('imagen_texto', 'render', 'zona')),
  titulo text NOT NULL,
  guia text,
  created_at timestamptz DEFAULT now()
);

-- 6b) Servicios del espacio (toallas, café, taquilla...). Son del PROYECTO y
--     se enlazan a TODOS los capítulos donde aparecen: las toallas pueden
--     salir en Llegada y en Vestuario con la misma tarjeta.
CREATE TABLE IF NOT EXISTS public.servicios_espacio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto_id uuid NOT NULL REFERENCES public.client_projects(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  descripcion text,
  imagen_url text,
  etiqueta text NOT NULL DEFAULT 'incluido' CHECK (etiqueta IN ('incluido', 'extra', 'wow')),
  guia text,
  orden integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_servicios_espacio_proyecto ON public.servicios_espacio(proyecto_id);

CREATE TABLE IF NOT EXISTS public.servicio_capitulo (
  servicio_id uuid NOT NULL REFERENCES public.servicios_espacio(id) ON DELETE CASCADE,
  capitulo_id uuid NOT NULL REFERENCES public.capitulos(id) ON DELETE CASCADE,
  orden integer NOT NULL DEFAULT 0,
  PRIMARY KEY (servicio_id, capitulo_id)
);

-- 6c) Ideas de servicio por tipo, con los capítulos donde suelen aparecer
CREATE TABLE IF NOT EXISTS public.plantillas_servicio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_proyecto text NOT NULL CHECK (tipo_proyecto IN ('comercial', 'home_gym')),
  nombre text NOT NULL,
  guia text,
  etiqueta text NOT NULL DEFAULT 'incluido' CHECK (etiqueta IN ('incluido', 'extra', 'wow')),
  capitulos_orden integer[] NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);


-- 7) Entregables de cada capítulo (checklist interno; solo se enseñan al
--    cliente los marcados como visibles y con archivo subido)
CREATE TABLE IF NOT EXISTS public.entregables_capitulo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto_id uuid NOT NULL REFERENCES public.client_projects(id) ON DELETE CASCADE,
  capitulo_id uuid REFERENCES public.capitulos(id) ON DELETE CASCADE, -- NULL = entregable general del proyecto
  orden integer NOT NULL DEFAULT 0,
  nombre text NOT NULL,
  descripcion text,
  formato text,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'en_curso', 'entregado')),
  archivo_url text,
  visible_cliente boolean NOT NULL DEFAULT false,
  opcional boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_entregables_capitulo ON public.entregables_capitulo(capitulo_id, orden);

-- ============================================================
-- SEMILLA: plantillas de capítulo
-- ============================================================
INSERT INTO public.plantillas_capitulo (tipo, orden, titulo, texto_base, sensorial) VALUES
('comercial', 1, 'Llegada',
 'Cruzas la puerta y el espacio te recibe antes de que nadie diga nada. Una luz cálida te guía hasta recepción mientras huele a madera limpia y a café recién hecho. Desde el primer segundo sabes que aquí vas a sentirte bien.',
 'olor: madera limpia y café recién hecho'),
('comercial', 2, 'Vestuario',
 'Entras al vestuario y no tienes que buscar nada: todo está pensado para ti. El agua caliente, la piedra tibia bajo tus pies y una luz suave te quitan el ruido del día. En cinco minutos estás listo y con ganas de empezar.',
 'tacto: piedra tibia bajo los pies'),
('comercial', 3, 'Entrenamiento',
 'La sala se abre ante ti con una luz que cambia según la zona: más intensa donde empujas, más cálida donde respiras. La música marca el ritmo y el suelo responde a cada paso. Cada rincón te invita a dar un poco más.',
 'sonido: música que marca el ritmo; luz que cambia por zonas'),
('comercial', 4, 'Recuperación',
 'El ritmo baja de golpe. Oyes el agua, sientes el calor de la sauna en la piel y la luz se vuelve casi de atardecer. Aquí el entreno termina de hacerte bien.',
 'tacto: calor de la sauna; luz de atardecer'),
('comercial', 5, 'Salida',
 'Sales distinto a como entraste: más ligero, con la cabeza despejada. Una última luz cálida te acompaña hasta la puerta y algo en el espacio te dice que volverás. Ya estás deseando que sea mañana.',
 'luz: cálida y suave en la despedida'),
('home_gym', 1, 'La decisión',
 'Hay un día en que dejas de decir "algún día" y decides entrenar en casa. Imaginas el espacio con luz natural, sin colas y sin horarios. Solo necesita que alguien lo piense bien para ti.',
 'luz: natural, de primera hora de la mañana'),
('home_gym', 2, 'La entrada',
 'Abres la puerta y ya estás dentro de tu gimnasio. Huele a madera y a hierro limpio, y la luz es justo la que necesitas a esa hora. No hay trayecto, no hay excusas.',
 'olor: madera y hierro limpio'),
('home_gym', 3, 'El entreno',
 'El suelo amortigua cada paso, el espejo te devuelve tu mejor versión y las pesas suenan como deben. Tienes todo a mano y nada sobra. Entrenas a tu ritmo, en tu casa.',
 'sonido: el metal de las pesas; tacto: suelo que amortigua'),
('home_gym', 4, 'La recuperación',
 'Terminas y no hace falta ir a ninguna parte. Estiras sobre una superficie cálida, con luz tenue y silencio alrededor. Tu cuerpo lo agradece y tu casa también.',
 'luz: tenue; sonido: silencio'),
('home_gym', 5, 'El día después',
 'Te despiertas con esa agradable pesadez de haber entrenado. Pasas por delante de tu gimnasio y te apetece volver a entrar. Se ha convertido en la parte favorita de tu casa.',
 'tacto: la pesadez agradable del día después')
ON CONFLICT (tipo, orden) DO NOTHING;

-- ============================================================
-- SEMILLA: entregables por capítulo (editables luego en cada proyecto)
-- visible_cliente = true solo para lo que el cliente debe ver
-- ============================================================
INSERT INTO public.plantillas_entregable (tipo, capitulo_orden, orden, nombre, descripcion, formato, visible_cliente, opcional) VALUES
-- GENERALES (capitulo_orden = 0): lo que ve el cliente en su dossier
('comercial', 0, 1, 'Plano de distribución con recorrido', 'Planta cuidada a nivel estético con el recorrido del cliente trazado y numerado según los capítulos de la historia.', 'PDF', true, false),
('comercial', 0, 2, 'Plano de demoliciones', 'Qué se tira o se retira del estado actual. Solo cuando haya obra previa.', 'PDF', true, true),
('comercial', 0, 3, 'Plano de implantación', 'Cómo se ubican las zonas y el equipamiento sobre el espacio existente. Solo cuando haga falta.', 'PDF', true, true),
('home_gym', 0, 1, 'Plano de distribución con recorrido', 'Planta cuidada a nivel estético con el recorrido del cliente trazado y numerado según los capítulos de la historia.', 'PDF', true, false),
('home_gym', 0, 2, 'Plano de demoliciones', 'Qué se tira o se retira del estado actual. Solo cuando haya obra previa.', 'PDF', true, true),
('home_gym', 0, 3, 'Plano de implantación', 'Cómo se ubican las zonas y el equipamiento sobre el espacio existente. Solo cuando haga falta.', 'PDF', true, true),
-- POR CAPÍTULO
-- COMERCIAL
('comercial', 1, 1, 'Render de la fachada y el acceso', 'Vista exterior y primer plano de la entrada, con la luz y los materiales definitivos.', 'Imagen JPG/PNG', true, false),
('comercial', 1, 2, 'Render de recepción', 'La primera impresión desde la puerta: mostrador, iluminación y zona de espera.', 'Imagen JPG/PNG', true, false),
('comercial', 1, 3, 'Plano de distribución de acceso y recepción', 'Planta acotada con recorrido de entrada, control de accesos y mostrador.', 'PDF', false, false),
('comercial', 2, 1, 'Render de vestuarios', 'Vista principal del vestuario con taquillas, bancos y zona de duchas.', 'Imagen JPG/PNG', true, false),
('comercial', 2, 2, 'Plano de distribución de vestuarios', 'Planta con taquillas, duchas, aseos y circulaciones accesibles.', 'PDF', false, false),
('comercial', 2, 3, 'Especificación de acabados húmedos', 'Pavimentos, alicatados y griferías previstos para zonas de agua.', 'PDF', false, false),
('comercial', 3, 1, 'Render principal de sala de entrenamiento', 'Vista general de la sala con equipamiento, suelos y luz por zonas.', 'Imagen JPG/PNG', true, false),
('comercial', 3, 2, 'Plano de distribución de equipamiento', 'Planta de sala con máquinas, zonas funcionales y distancias de seguridad.', 'PDF', false, false),
('comercial', 3, 3, 'Plano de proyección de iluminación', 'Planta con luminarias, tipo, temperatura de color y escenas por zona.', 'PDF', false, false),
('comercial', 3, 4, 'Esquema de ambiente sonoro', 'Zonas de sonido y niveles de música previstos.', 'PDF', false, false),
('comercial', 4, 1, 'Render de zona de recuperación', 'Vista de sauna, spa o estiramientos con su atmósfera de luz.', 'Imagen JPG/PNG', true, false),
('comercial', 4, 2, 'Plano de distribución de recuperación', 'Planta con zonas húmedas, saunas, duchas y descanso.', 'PDF', false, false),
('comercial', 0, 4, 'Propuesta de ejecución (Servicio 2)', 'Alcance, plazos y presupuesto de la fase de ejecución.', 'PDF', true, false),
-- HOME GYM
('home_gym', 1, 1, 'Imagen de ambiente inicial', 'Una imagen que capte la idea del espacio que el cliente imagina.', 'Imagen JPG/PNG', true, false),
('home_gym', 1, 2, 'Resumen de necesidades y medidas', 'Medidas del espacio, uso previsto y limitaciones.', 'PDF', false, false),
('home_gym', 2, 1, 'Render de la entrada al gimnasio', 'Cómo se ve y se siente al abrir la puerta.', 'Imagen JPG/PNG', true, false),
('home_gym', 2, 2, 'Plano de distribución general', 'Planta acotada del espacio con zonas y circulaciones.', 'PDF', false, false),
('home_gym', 3, 1, 'Render principal de la zona de entreno', 'Vista general con suelo, espejo, equipamiento y luz.', 'Imagen JPG/PNG', true, false),
('home_gym', 3, 2, 'Plano de equipamiento y alturas', 'Colocación de máquinas, racks y comprobación de alturas libres.', 'PDF', false, false),
('home_gym', 3, 3, 'Plano de proyección de iluminación', 'Planta con luminarias, temperatura de color y puntos de luz.', 'PDF', false, false),
('home_gym', 3, 4, 'Esquema de instalaciones eléctricas y ventilación', 'Tomas, climatización y ventilación necesarias.', 'PDF', false, false),
('home_gym', 4, 1, 'Render de la zona de recuperación', 'Vista de estiramientos, descanso o spa.', 'Imagen JPG/PNG', true, false),
('home_gym', 0, 4, 'Propuesta de ejecución (Servicio 2)', 'Alcance, plazos y presupuesto de la fase de ejecución.', 'PDF', true, false);

-- ============================================================
-- SEMILLA: ideas de bloque por capítulo (guías internas, no se muestran)
-- ============================================================
INSERT INTO public.plantillas_bloque (tipo_proyecto, capitulo_orden, orden, tipo, titulo, guia) VALUES
-- COMERCIAL
('comercial', 1, 1, 'render', 'La primera impresión', 'Render grande de la entrada: qué ve y siente el cliente al cruzar la puerta.'),
('comercial', 1, 2, 'imagen_texto', 'Recepción y bienvenida', 'Cómo te reciben: mostrador, trato, control de acceso sin colas.'),
('comercial', 2, 1, 'imagen_texto', 'El vestuario', 'Cómo es usarlo: taquillas, bancos, luz, privacidad.'),
('comercial', 2, 3, 'zona', 'Zona de duchas y cuidado personal', 'Qué hay en esta zona: duchas, secadores, productos, espejos.'),
('comercial', 3, 1, 'render', 'La sala de entrenamiento', 'Render grande de la sala principal con su ambiente de luz.'),
('comercial', 3, 2, 'zona', 'Las zonas de entrenamiento', 'Cada zona y qué tiene: peso libre, cardio, funcional, estiramientos.'),
('comercial', 3, 3, 'imagen_texto', 'Luz y sonido por zonas', 'Cómo cambia el ambiente según lo que haces en cada punto.'),
('comercial', 4, 1, 'render', 'La zona de recuperación', 'Render de sauna, spa o relax con su atmósfera.'),
('comercial', 5, 1, 'imagen_texto', 'El último detalle', 'Cómo es la despedida y qué hace que el cliente quiera volver.'),
-- HOME GYM
('home_gym', 1, 1, 'imagen_texto', 'La idea', 'Qué necesita esta persona y por qué decide entrenar en casa.'),
('home_gym', 2, 1, 'render', 'Al abrir la puerta', 'Render grande de la entrada al gimnasio.'),
('home_gym', 2, 2, 'imagen_texto', 'Los materiales y la luz', 'Qué se ve, se toca y se huele nada más entrar.'),
('home_gym', 3, 1, 'render', 'La zona de entreno', 'Render grande del espacio de entrenamiento.'),
('home_gym', 3, 2, 'zona', 'Las zonas del espacio', 'Cada zona y su equipamiento: fuerza, cardio, movilidad.'),
('home_gym', 4, 1, 'imagen_texto', 'El rincón de recuperación', 'Dónde se estira, descansa o se relaja.'),
('home_gym', 5, 1, 'imagen_texto', 'Un espacio para quedarse', 'Cómo convive el gimnasio con el resto de la casa.');

-- ============================================================
-- SEMILLA: ideas de servicio (guías internas) y capítulos donde suelen salir
-- ============================================================
INSERT INTO public.plantillas_servicio (tipo_proyecto, nombre, guia, etiqueta, capitulos_orden) VALUES
('comercial', 'Servicio de toallas', 'Cómo funciona, dónde se recogen y se dejan, qué experiencia crea. Puede empezar en recepción y continuar en el vestuario.', 'incluido', '{1,2}'),
('comercial', 'Detalle de bienvenida', 'Ej. café, agua, aroma de marca, música de entrada.', 'wow', '{1}'),
('comercial', 'Taquillas y acceso inteligente', 'Cómo se abre y se guarda todo sin llevar nada encima.', 'incluido', '{2}'),
('comercial', 'Servicio de recuperación', 'Ej. sauna, baño de contraste, hidratación, masaje.', 'extra', '{4}'),
('comercial', 'Gesto de despedida', 'Ej. snack saludable, reserva de la siguiente sesión, mensaje al salir.', 'wow', '{5}'),
('home_gym', 'Almacenaje oculto', 'Cómo desaparece el material cuando no se usa.', 'incluido', '{3,5}'),
('home_gym', 'Ambiente de sonido y luz', 'Escenas de luz y sonido para entrenar y para recuperar.', 'wow', '{3,4}');
