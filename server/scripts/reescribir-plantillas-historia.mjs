// Reescribe las plantillas de capítulo de la historia para que describan cada ZONA (en vez de contar un recorrido),
// y añade «Entendemos el espacio» como primer capítulo. Las plantillas solo se copian al crear una historia nueva,
// así que los proyectos que ya existen no cambian, salvo el que se pase con --proyecto=<id> (se le aplica el estilo nuevo).
//   node scripts/reescribir-plantillas-historia.mjs            → solo plantillas
//   node scripts/reescribir-plantillas-historia.mjs --proyecto=<id> --backup=<ruta.json>
import 'dotenv/config';
import fs from 'fs';
import { supabase } from '../config/supabase.js';

const arg = n => (process.argv.find(a => a.startsWith('--' + n + '=')) || '').split('=').slice(1).join('=');

const ENTENDEMOS = {
  comercial: 'Antes de dibujar nada, medimos y entendemos el local: sus dimensiones reales, la altura libre, la estructura, las instalaciones que ya hay y todo lo que condiciona el proyecto. Con ese levantamiento decidimos qué se aprovecha, qué hay que demoler y cómo repartir las zonas con criterio.',
  home_gym: 'Antes de diseñar, entendemos el espacio: medimos la estancia, revisamos alturas, accesos, ventanas e instalaciones y todo lo que lo condiciona. Así sabemos qué metros reales tenemos para entrenar, dónde pueden ir las máquinas y qué hay que resolver (ruido, humedad, suelo, luz).',
};
const TEXTOS = {
  comercial: {
    1: ['Recepción', 'La primera zona que se ve y la que marca el tono: un mostrador cálido de madera y piedra, iluminación indirecta y un espacio despejado para recibir sin colas ni agobios. Aquí se resuelven el acceso, el control de entrada y la primera impresión de la marca.'],
    2: ['Sala de entrenamiento', 'El corazón del centro: zonas de fuerza, cardio y funcional bien separadas, con suelo técnico que amortigua y aguanta, espejos y una iluminación que cambia según la actividad. Pasillos amplios, circulaciones claras y la maquinaria repartida para que cada zona tenga su espacio.'],
    3: ['Vestuarios', 'Vestuarios pensados para el uso real: taquillas cómodas, duchas bien ventiladas, materiales cálidos y fáciles de limpiar y una luz suave. Un espacio funcional que transmite cuidado y queda listo para el siguiente turno.'],
    4: ['Zona de recuperación', 'Un espacio aparte para bajar el ritmo: sauna, estiramiento o relax, con luz tenue, materiales cálidos y buena acústica. Pensado para que el cliente se quede un rato más después de entrenar.'],
    5: ['Fachada y exterior', 'La imagen del centro desde la calle: una fachada con carácter, rotulación visible, buena iluminación nocturna y un acceso claro. Es lo que invita a entrar y lo que la gente reconoce y recuerda.'],
  },
  home_gym: {
    1: ['Acceso al gimnasio', 'La entrada al espacio desde el resto de la casa: una puerta que aísla el ruido, una transición cuidada y una primera luz que invita a cambiar el chip. Aquí se resuelven el acceso, el aislamiento acústico y el almacenaje de lo que se usa al entrar.'],
    2: ['Zona de entreno', 'El espacio principal: suelo técnico que amortigua y protege el forjado, espejos, maquinaria y pesos a mano y una distribución que deja sitio para moverse. Todo pensado para entrenar cómodo, sin esperas y sin que nada sobre.'],
    3: ['Zona de estiramiento y descanso', 'Un rincón con suelo cálido y espacio libre para estirar y volver a la calma, con una luz más tenue que la del entreno. Se completa con una zona de recuperación o de TV si el proyecto la incluye.'],
    4: ['Ambiente y detalles', 'Luz regulable, climatización, música y orden: los detalles que hacen que el gimnasio se sienta parte de la casa. Iluminación por escenas, almacenaje integrado y materiales que envejecen bien.'],
  },
};
const EXTRAS = {
  'Zona de grabación de contenido': 'Un rincón preparado para grabar: fondo cuidado, iluminación que favorece, aislamiento acústico y sonido limpio, con tomas de corriente y soporte para la cámara a mano.',
  'Zona de recuperación': 'Un espacio para bajar el ritmo tras entrenar: sauna, inmersión o masaje, con luz tenue, materiales cálidos y una ventilación pensada para la humedad.',
  'Zona de boxeo y combate': 'Suelo que agarra y amortigua, saco y accesorios colgados sobre refuerzo estructural, espacio libre alrededor y protección en las paredes.',
  'Zona de yoga y movilidad': 'Suelo cálido, luz que baja de tono y espacio libre; paredes limpias, espejo opcional y almacenaje para esterillas y accesorios.',
  'Zona funcional': 'Un espacio abierto con suelo resistente, el material al alcance y estructura para colgar anillas, cuerdas o rig.',
  'Zona de nutrición': 'Un punto para parar un momento: barra o mesa, nevera y sitio para batidos y café.',
  'Zona de fisioterapia y valoración': 'Una sala tranquila para valorar y tratar: camilla, luz cálida, privacidad y almacenaje.',
  'Zona de descanso y espera': 'Un sitio para esperar sin que se note: butacas cómodas, luz tenue y buena acústica.',
};

// ── plantillas
for (const tipo of ['comercial', 'home_gym']) {
  for (const [orden, [titulo, texto]] of Object.entries(TEXTOS[tipo])) {
    const { error } = await supabase.from('plantillas_capitulo').update({ titulo, texto_base: texto }).eq('tipo', tipo).eq('orden', Number(orden));
    if (error) throw error;
  }
  const { data: ya } = await supabase.from('plantillas_capitulo').select('orden').eq('tipo', tipo).eq('orden', 0);
  if (ya?.length) await supabase.from('plantillas_capitulo').update({ titulo: 'Entendemos el espacio', texto_base: ENTENDEMOS[tipo] }).eq('tipo', tipo).eq('orden', 0);
  else {
    const { error } = await supabase.from('plantillas_capitulo').insert({ tipo, orden: 0, titulo: 'Entendemos el espacio', texto_base: ENTENDEMOS[tipo], sensorial: null });
    if (error) throw error;
  }
}
for (const [titulo, texto] of Object.entries(EXTRAS)) {
  const { error } = await supabase.from('plantillas_capitulo_extra').update({ texto_base: texto }).eq('titulo', titulo);
  if (error) throw error;
}
console.log('Plantillas actualizadas (comercial, home gym y extras). Los proyectos existentes no cambian.');

// ── un proyecto concreto
const pid = arg('proyecto');
if (pid) {
  const { data: proy } = await supabase.from('client_projects').select('id, project_name, tipo_proyecto').eq('id', pid).single();
  const tipo = proy?.tipo_proyecto === 'home_gym' ? 'home_gym' : 'comercial';
  const { data: caps } = await supabase.from('capitulos').select('*').eq('proyecto_id', pid).order('orden');
  const ruta = arg('backup');
  if (ruta) fs.writeFileSync(ruta, JSON.stringify(caps, null, 2));
  if ((caps || []).some(c => c.titulo === 'Entendemos el espacio')) { console.log('El proyecto ya tiene «Entendemos el espacio».'); process.exit(0); }
  // 1) los capítulos que son texto narrativo de plantilla se reescriben como zona (según su posición en la plantilla)
  const { data: plant } = await supabase.from('plantillas_capitulo').select('orden, titulo, texto_base').eq('tipo', tipo).gt('orden', 0).order('orden');
  const narrativos = ['Cruzas', 'Bajas las escaleras', 'La sala se abre', 'El suelo amortigua', 'Terminas', 'El ritmo baja', 'Sales distinto', 'Apagas la luz'];
  for (const c of caps || []) {
    if (c.origen !== 'plantilla' || !c.texto) continue;
    if (!narrativos.some(n => String(c.texto).startsWith(n))) continue; // texto ya personalizado: no se toca
    const t = tipo === 'home_gym' ? (c.titulo === 'Recovery' ? EXTRAS['Zona de recuperación'] : (/entren/i.test(c.titulo) ? TEXTOS.home_gym[2][1] : TEXTOS.home_gym[1][1])) : null;
    if (t) await supabase.from('capitulos').update({ texto: t }).eq('id', c.id);
  }
  // 2) «Entendemos el espacio» pasa a ser el capítulo 1 y el resto se renumera
  for (const c of [...(caps || [])].sort((a, b) => b.orden - a.orden)) await supabase.from('capitulos').update({ orden: c.orden + 1 }).eq('id', c.id);
  const { error } = await supabase.from('capitulos').insert({ proyecto_id: pid, orden: 1, titulo: 'Entendemos el espacio', texto: ENTENDEMOS[tipo], sensorial: null, origen: 'plantilla' });
  if (error) throw error;
  console.log('Proyecto «' + proy.project_name + '»: capítulo «Entendemos el espacio» añadido al principio y textos narrativos pasados a zona.');
}
