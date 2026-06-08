-- Proyectos iniciales del portfolio (ejecutar después de supabase_migration.sql)
-- Las imágenes apuntan a los archivos en /public/img/ del frontend

INSERT INTO public.portfolio_projects (slug, title, description, cover_url, images, display_order) VALUES
(
  'f11-futbol',
  'F11 · Centro de Fútbol',
  'Proyecto viral que marcó un antes y un después en nuestro estilo.',
  '/img/f11/contf112.png',
  ARRAY['/img/f11/campoF11.jpg','/img/f11/contF111.png','/img/f11/contf112.png','/img/f11/gymf11.png','/img/f11/proyectoF11.jpg','/img/f11/f1.png','/img/f11/f2.png','/img/f11/f3.png','/img/f11/f4.png'],
  1
),
(
  'next-era-oficinas',
  'Oficinas Next Era',
  'Entorno profesional con identidad deportiva actual.',
  '/img/nextera/contOfi1.png',
  ARRAY['/img/nextera/next3.png','/img/nextera/contOfi1.png','/img/nextera/Aula.png','/img/nextera/next1.png','/img/nextera/next2.png'],
  2
),
(
  'golf-park',
  'Tienda Golf Park',
  'Retail deportivo con estética clara, fluida y coherente.',
  '/img/golfpark/golfPark.jpg',
  ARRAY['/img/golfpark/golfPark.jpg','/img/golfpark/contGolf2.jpg','/img/golfpark/contGolf3.jpg','/img/golfpark/contGolf1.jpg','/img/golfpark/contGolf4.jpg'],
  3
),
(
  'gym-xthor',
  'Gym XTHOR',
  'Diseño de interiores para gimnasio de alto rendimiento.',
  '/img/xthor/xthorPrincipal.png',
  ARRAY['/img/xthor/xthorPrincipal.png','/img/xthor/thor1.png','/img/xthor/thor2.png','/img/xthor/thor3.png','/img/xthor/thor4.png','/img/xthor/thor5.png'],
  4
),
(
  'cultiral-actex',
  'Cultural Actex',
  'Espacio cultural con identidad deportiva y moderna.',
  '/img/actex/actex1.png',
  ARRAY['/img/actex/actex1.png','/img/actex/actex2.png','/img/actex/actex3.png','/img/actex/actex4.png','/img/actex/actex5.png','/img/actex/actex6.png','/img/actex/actex7.png','/img/actex/actex8.png','/img/actex/actex9.png','/img/actex/actex10.png','/img/actex/actex11.png','/img/actex/actex12.png','/img/actex/actex13.png'],
  5
),
(
  'home-gyms',
  'Home Gyms',
  'Diseño de gimnasios en el hogar.',
  '/img/homegyms/contGym3.png',
  ARRAY['/img/homegyms/contGym1.png','/img/homegyms/contGym2.png','/img/homegyms/contGym3.png','/img/homegyms/contGym4.png'],
  6
);
