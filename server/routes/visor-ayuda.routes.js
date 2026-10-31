import express from 'express';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';
import { callClaude } from '../utils/anthropic.js';
import { supabase } from '../config/supabase.js';

// Agente de ayuda del visor 3D: responde dudas de «cómo hago X» con pasos concretos, según el manual de abajo.
// Si cambias algo del visor, actualiza el manual para que el agente no explique botones que ya no existen.
const router = express.Router();
router.use(authenticateToken, requirePermission('proyectos'));

// Peticiones: lo que se pide y hoy no se puede hacer queda apuntado en un archivo del almacenamiento (sin tablas nuevas)
const BUCKET = 'project-documents', RUTA = 'visor/_peticiones.json';
async function leerPeticiones() {
  try { const { data, error } = await supabase.storage.from(BUCKET).download(RUTA); if (error || !data) return []; const j = JSON.parse(await data.text()); return Array.isArray(j) ? j : []; } catch { return []; }
}
async function guardarPeticiones(lista) {
  return supabase.storage.from(BUCKET).upload(RUTA, Buffer.from(JSON.stringify(lista.slice(-500))), { contentType: 'application/json', upsert: true, cacheControl: '0' });
}
const COMANDOS = ['Seleccionar', 'Rectángulo', 'Círculo', 'Polígono', 'Empujar / Tirar', 'Muro', 'Zona en el suelo', 'Tira LED', 'Luminaria', 'Pintura', 'Cuentagotas', 'Cinta métrica (guía)', 'Ocultar selección', 'Mostrar todo lo oculto', 'Deshacer', 'Rehacer', 'Perspectiva', 'Planta', 'Axonométrica', 'Planta 2D', 'Recorrer (persona)', 'Capas', 'Catálogo', 'Biblioteca', 'Materiales', 'Ambiente (sol y luces)', 'Render', 'Modo realista (reflejos y sombras)', 'Render HD (descargar)', 'Render con IA', 'Exportar a D5 (.glb)', 'Despiece y cantidades'];

const MANUAL = `
MANUAL DEL VISOR 3D DE RANUSE (lo que existe de verdad)

PANTALLA
- Arriba: ← Volver, título, deshacer/rehacer, menú «Vista ▾» (Perspectiva, Planta, Axonométrica, Planta 2D, Recorrer, Altura de los ojos, Cámara…, Escenas), control de óptica (barra deslizante con grados + desplegable «Óptica…»), «Ambiente», «Render», y a la derecha «Realista», calidad, menú «Salida ▾» (Captura, Render HD, Render con IA, Panorama 360°, Galería, Despiece y cantidades, Exportar a D5 .glb) y el botón «Ayuda».
- Barra de herramientas a la izquierda, por grupos: Selección (Seleccionar, Ocultar, Mostrar), Dibujar (Rectángulo, Círculo, Polígono, Empujar), Construir (Muro, Zonas, Sígueme), Pintar (Pintura, Cuentagotas), Insertar (Catálogo, Biblioteca, A medida, Logo), Luz (Iluminación), Medir y ver (Cinta, Capas).
- Mover la vista: arrastrar con el botón izquierdo gira; botón derecho desplaza; rueda hace zoom; W A S D para andar, Q/E bajar y subir, Mayús más rápido.
- Atajos de una letra: V seleccionar, R rectángulo (con algo seleccionado gira 90°), C círculo, G polígono, P empujar/tirar, M muro, Z zona en suelo, L tira LED, F luminaria, B pintura, I cuentagotas, T cinta métrica, H ocultar, 0 perspectiva, 9 planta, 8 axonométrica. Ctrl+K o «/» abre un buscador de comandos. Ctrl+Z / Ctrl+Y deshacer / rehacer. Supr borra.

DIBUJAR Y DAR ALTURA (como SketchUp)
- Rectángulo / Círculo / Polígono: se dibuja sobre el suelo; la forma nace plana (2 cm) y la herramienta cambia sola a Empujar. Arrastra la cara de arriba hacia arriba para darle altura. Polígono: clic en cada punto y Enter para cerrar.
- Mientras dibujas punto a punto: la longitud del tramo sale arriba; Mayús = recto; escribir un número (cm) y Enter pone el siguiente punto a esa distancia; Retroceso borra el último punto; Esc cancela.

MUROS, PUERTAS Y VENTANAS
- Muro: clic en cada punto, Mayús = recto, Enter o Esc termina; grosor en la barra superior de la herramienta. Los muros se crean también en Planos.
- Clic en un muro: ficha con grosor y alto, y se mueven sus extremos con las bolas azules. Clic en puerta o ventana: ficha con tipo (abatible, corredera…), medidas, altura desde el suelo, apertura, y el material de la hoja; vidrios: transparente, satinado, ahumado, azulado, espejo.

MÁQUINAS DEL PLANO
- Clic en una máquina: ficha con posición X/Y, largo, fondo, alto, elevación (z) y giro. Los cambios se aplican solos al plano. Botones: Pegar a la pared, Girar 180°, Eliminar (también Supr).
- Modelo 3D de la máquina: «Subir mi modelo 3D…» (.glb, .gltf, .obj, .dae o .zip) y se guarda en el producto. «Giro del modelo (solo esta)» la gira. «🧭 Alinear con el plano» gira el modelo para que coincida con el dibujo de la planta de Planos; el alineado también se hace solo al cargar si el producto tiene dibujo de planta.
- Si el 3D no coincide con el 2D: probar 🧭 Alinear con el plano; si la planta es casi simétrica, usar «Giro del modelo» 180°.

BIBLIOTECAS
- Catálogo: tus productos de Ranuse; por defecto solo los que tienen 3D (hay casilla para ver todos). Cada uno con miniatura del modelo.
- Biblioteca → pestaña «Mis modelos»: botón «Subir modelo (planta, mueble…)» para subir plantas y objetos sueltos (.glb, .gltf, .obj, .dae o .zip). Se mide solo. Pestañas Muebles (gratuitos) y Texturas.
- A medida: muebles por módulos. Logo: sube un SVG o DXF y se convierte en 3D.

MATERIALES Y TEXTURAS
- Pintura (bote): abre el panel de materiales; elige color o textura y haz clic en lo que quieras pintar (modo cara, pieza o entero; Mayús = todo el elemento). Cuentagotas copia el material de lo que toques.
- Subir textura: botón «Subir textura…» con el tamaño real en cm de la foto. Al elegir una textura salen: tamaño, giro, mover (x, y), Material (rugosidad, metal, relieve), Despiece (a cuadro, trabado ½, trabado ⅓; tamaño de pieza; la foto es una pieza o material continuo; variación de tono) y junta (color y mm). Los cambios se aplican solos.
- Acabados fijos: Espejo, Espejo bronce, Espejo ahumado y Cromo (al principio de las texturas).
- Zonas (▨): dibujar una forma en suelo, techo o pared con su propio material. Mientras dibujas sale la barra «Material de la zona» para elegir textura; después, clic en la zona y se cambia en su ficha.
- Cambiar el suelo de una sala entera: «Vista ▾ → Planta 2D», luego «Pintar sala entera» y clic en la sala; o Pintura con una textura y clic en el suelo.

LUZ
- Iluminación: luminarias (foco, spot, plafón, colgante, aplique, lámpara de pie, empotrado de suelo), tira LED, carriles (magnético o trifásico) con focos. Tira LED: se traza punto a punto; en su ficha se ajusta altura desde el suelo, temperatura, lúmenes/m, hacia dónde alumbra y cerrar en lazo.
- Ambiente: hora del sol, exposición, intensidad de luces y temperatura de color.

VER Y HABLAR CON EL CLIENTE
- Ocultar (tecla H): oculta lo seleccionado sin borrarlo; «Mostrar» lo devuelve. Capas: ocultar por tipos.
- Recorrer: entras en el espacio a 1,60 m, W A S D para andar despacio. Óptica: menos grados = más zoom; 30° es lo parecido a una persona, 50° interior natural.
- Axonométrica: vista isométrica con giro de 90° y sin techos. Planta 2D: vista cenital para dibujar zonas.
- Escenas: vistas guardadas (cámara, hora, luces, capas) a las que volver y desde las que renderizar.

RENDER
- Botón «Render» abre el panel: modo Rápido/Realista, preajustes (Día claro, Interior cálido, Noche), entorno (mapa de reflejos), sol y luz, color (contraste, saturación, calidez), efectos (resplandor, viñeta), cámara, resolución (Full HD, 3200, 4K, 5K) y formato. Renderizar y descargar; guardar en la galería.
- Render con IA: mejora la vista; manda tus materiales y el inventario para que no invente. Nivel «fiel» respeta más; «creativo» añade decoración.
- Exportar a D5 (.glb): descarga el espacio para abrirlo en D5 o Blender; ahí se hace el render final de más calidad. No vuelve a Ranuse.
- Limitaciones honestas: no es un motor de trazado de rayos; la luz rebotada de D5 no se consigue en el visor. Si va lento: calidad media/baja y Realista apagado.

LISTADOS Y PRESUPUESTOS (fuera del visor, en el panel del proyecto)
- Proyecto → pestaña de Listados/Asignaciones: fichas de producto; «Editar ficha» (nombre, marca, color/acabado, especificaciones, foto, enlace). «Producto suelto (sin catálogo)» para pegar foto (Ctrl+V), enlace y nombre. Botón «PDF para pedir presupuestos» genera un PDF con fotos, cantidades y huecos para precio y plazo.
`;

router.post('/', async (req, res) => {
  try {
    const mensajes = (Array.isArray(req.body?.mensajes) ? req.body.mensajes : [])
      .filter(m => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string' && m.content.trim())
      .slice(-12).map(m => ({ role: m.role, content: m.content.slice(0, 1500) }));
    if (!mensajes.length || mensajes[mensajes.length - 1].role !== 'user') return res.status(400).json({ error: 'Falta la pregunta' });
    const system = `Eres el asistente del visor 3D de Ranuse Design. Quien te pregunta no es técnico: explícale cómo hacer algo con pasos cortos y numerados, con los nombres EXACTOS de los botones y menús del manual. Responde en español, directo y breve (máximo unas 8 líneas).
Reglas:
- Usa solo lo que está en el manual. Si algo no existe o no estás seguro, dilo claro y propón la alternativa más cercana; no inventes botones.
- Si hay un comando del visor que sirva, añade al final como máximo 2 marcas con este formato exacto: [[cmd:Nombre]] usando uno de estos nombres: ${COMANDOS.join(' | ')}. La interfaz las convertirá en botones «Hacerlo».
- Si lo que piden NO se puede hacer hoy (no existe en el manual), dilo claro, ofrece la alternativa más cercana si la hay y añade al final UNA marca [[peticion:resumen corto y claro de lo que piden]] para que quede apuntado como petición. No la pongas si sí se puede hacer.
- Si la pregunta es de otra cosa (no del visor 3D), responde brevemente que solo ayudas con el visor.
${MANUAL}`;
    const r = await callClaude({ system, messages: mensajes, maxTokens: 700 });
    let texto = (r.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim(), peticion = null;
    const mp = /\[\[peticion:([^\]]{3,300})\]\]/i.exec(texto);
    if (mp) {
      texto = texto.replace(/\[\[peticion:[^\]]*\]\]/gi, '').trim(); peticion = mp[1].trim();
      try {
        const lista = await leerPeticiones();
        lista.push({ id: 'p' + Date.now().toString(36), texto: peticion, pregunta: mensajes[mensajes.length - 1].content.slice(0, 300), usuario: req.user?.email || req.user?.id || '', fecha: new Date().toISOString(), estado: 'nueva' });
        await guardarPeticiones(lista);
      } catch (e2) { console.error('visor-ayuda peticion:', e2.message); }
    }
    res.json({ respuesta: texto || 'No he podido responder, prueba a preguntarlo de otra forma.', peticion });
  } catch (e) {
    console.error('visor-ayuda:', e.message);
    res.status(500).json({ error: /ANTHROPIC_API_KEY/.test(e.message) ? 'El asistente no está configurado en el servidor' : 'No he podido contestar ahora mismo' });
  }
});

router.get('/peticiones', async (req, res) => { res.json({ peticiones: (await leerPeticiones()).reverse() }); });
router.patch('/peticiones/:id', async (req, res) => {
  const lista = await leerPeticiones(), p = lista.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'No encontrada' });
  if (['nueva', 'hecha', 'descartada'].includes(req.body?.estado)) p.estado = req.body.estado;
  const { error } = await guardarPeticiones(lista); if (error) return res.status(500).json({ error: 'No se pudo guardar' });
  res.json({ peticion: p });
});

export default router;
