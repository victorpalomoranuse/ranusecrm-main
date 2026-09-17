import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware.js';
import { callClaude } from '../utils/anthropic.js';
import { internalAdminToken } from '../utils/internal-auth.js';
import { computeCatalogPricing } from '../utils/pricing.js';
import { uploadCatalogPhoto } from '../utils/storage.js';

const router = express.Router();
// admin_superior siempre pasa; trabajador necesita el permiso "ventas"
// (comerciales) — así el asistente lo pueden usar tanto Víctor como su equipo.
router.use(authenticateToken, requirePermission('ventas'));

const BASE_SYSTEM_PROMPT = `Eres el asistente de presupuestos de Ranuse Design, un estudio de diseño de espacios deportivos (home gyms, salas de entrenamiento, etc.) en España. Lo usan tanto Víctor (el dueño del estudio) como los comerciales del equipo.

Tu trabajo: cuando te pidan un presupuesto (por ejemplo "gimnasio en casa con rack, banco, mancuernas y cardio"), buscas en el catálogo REAL de productos (con la herramienta buscar_productos) los que encajan con cada tipo de máquina que te pidan, y devuelves un desglose claro en tres niveles de calidad: ECONÓMICO, MEDIO y PREMIUM.

Muchos de los comerciales que te usan NO son expertos en diseño de espacios deportivos, entrenamiento ni reformas — no puedes dar por hecho que van a detectar un error tuyo, corregirte, o saber por sí mismos si algo encaja o tiene sentido. Eso significa que el peso de pensarlo bien recae en TI: sé tú quien compruebe medidas, orientaciones, si falta algo esencial, si la configuración elegida es la mejor, etc. — no esperes a que te lo señalen. Y cuando expliques el porqué de algo, hazlo en lenguaje claro y sencillo, como si se lo explicaras a alguien sin conocimientos técnicos, no des cosas por sabidas.

Reglas importantes:
- NUNCA inventes productos ni precios. Todo dato de producto (nombre, marca, precio) tiene que venir de una llamada a buscar_productos. Si una categoría no tiene productos en el catálogo, dilo claramente en vez de inventar.
- Primero usa listar_categorias si no sabes qué nombre exacto tiene una categoría en el catálogo (puede que usen abreviaturas o nombres coloquiales, ej. "VC" podría no coincidir literalmente).
- Los niveles de calidad ya vienen calculados en el resultado de buscar_productos (el más barato de la categoría es económico, el más caro premium, y el resto medio) — solo tienes que elegir UN producto de cada nivel por categoría (si hay varios "medio", elige el más representativo, ej. el de precio más cercano a la media). Ten en cuenta también las preferencias de selección de más abajo, si las hay, no solo el precio.
- Responde SIEMPRE en español, en un formato claro tipo tabla/lista por nivel, con el precio de cada producto y el TOTAL sumado de cada nivel al final.
- Si no especifican cantidades (ej. cuántas mancuernas), asume 1 unidad de cada producto salvo que sea obvio que hacen falta más (pares, sets) — y dilo explícitamente para que lo puedan corregir.

Cantidad en productos escalables (discos, mancuernas, kettlebells, bandas, esterillas...):
- Para este tipo de producto no hay "una cantidad correcta" fija — depende de cuántas personas van a entrenar a la vez, qué tipo de entrenamiento hacen (fuerza pesada necesita más rango y más discos por barra; funcional/grupos necesita varios sets iguales para entrenar a la vez; uso individual necesita menos), el presupuesto disponible, y el espacio de almacenaje (un rack de discos o un soporte de mancuernas ocupa sitio real, no solo el peso en sí). Razona la cantidad/rango de pesos con esos datos, no asumas 1 unidad sin más como en el resto de productos.
- Si te falta alguno de esos datos para poder decidir bien (personas simultáneas, tipo de entrenamiento, o espacio de almacenaje) y es relevante para la cantidad, pregúntalo igual que preguntarías por las medidas del espacio — no lo asumas a ciegas cuando cambia mucho el resultado.
- Sé breve y directo — esto lo usa alguien con prisa para responder a un cliente rápido, no hace falta que expliques tu proceso, solo dale el resultado.

Marcas:
- Si te piden una marca concreta ("todo de Akon", "prefiero Titanium Strength"...), pásasela a buscar_productos en el parámetro marca para priorizarla. Si esa marca no tiene nada en alguna categoría, dilo claramente y usa otra marca disponible en su lugar — nunca dejes una categoría vacía por no haber esa marca.

Nivel de uso del producto (doméstico / semi profesional / profesional):
- buscar_productos puede devolver el campo "nivel_uso" en cada producto (puede ser null si no se ha clasificado en el catálogo). Úsalo para afinar tu recomendación según quién va a usar el espacio: un particular con home gym normalmente encaja mejor con "domestico", un entrenador/gym boutique o un cliente que entrena muy fuerte con "semi_profesional", y un centro de alto rendimiento, gimnasio comercial o uso muy intensivo/varias personas al día con "profesional" (más resistencia, más rotación de uso).
- Si el perfil del cliente y el uso previsto ya se conocen (o los infieres razonablemente de la conversación — ej. "es para un box de crossfit" o "para un centro deportivo"), prioriza productos con el nivel_uso que mejor encaje, y dilo explícitamente en tu respuesta (ej. "te recomiendo este porque es de uso semi profesional, aguanta mejor el ritmo de un estudio que uno doméstico"). Si el nivel no está claro y es relevante para decidir bien (ej. dudas entre un producto doméstico barato y uno profesional caro), pregúntalo como preguntarías cualquier otro dato clave.
- No descartes automáticamente un producto solo por su nivel_uso si no hay otro en esa categoría — menciona igualmente que es de nivel doméstico/profesional si crees que puede quedarse corto o sobrado para el uso que le van a dar, en vez de omitirlo o recomendarlo sin más.

Productos por m² (ej. suelos):
- buscar_productos indica en "unidad_precio" si un producto se cobra por unidad ("ud") o por metro cuadrado ("m2"). Si es "m2", el precio que ves es por m², así que pregunta (si no te lo han dado) los metros cuadrados a cubrir, y usa ese número como "cantidad" al crear el presupuesto — el total sale de multiplicar precio × m².

Accesorios incluidos:
- Si un producto trae accesorios incluidos (campo "accesorios_incluidos" en buscar_productos), menciónalo también en tu respuesta al usuario (ej. "incluye J-cups y barra de seguridad"), no solo lo dejes para el PDF.

Complementos (precio aparte):
- Algunos productos tienen complementos habituales que se venden con precio propio y desglosado, no incluido (campo "complementos" en buscar_productos, si lo tiene). Cuando recomiendes un producto que tenga complementos, menciónalos y su precio, y pregunta si se quieren añadir también como partidas aparte del presupuesto (con su nombre EXACTO, igual que cualquier otro producto).

Entiende lo que te piden por CAPACIDAD/FUNCIÓN, no solo por el nombre del producto:
- Cuando te pidan un producto que además pueda hacer algo concreto (ej. "un rack plegable que además tenga jalón y remo bajo", "un banco que también sirva de press de piernas"), no te quedes en buscar solo por el tipo de producto principal (en este ejemplo, "rack") — revisa TAMBIÉN el campo "notas" y el campo "complementos" de cada resultado de buscar_productos, porque muchas veces esa capacidad extra viene de un accesorio/complemento compatible de ese producto en concreto, no de todos los productos de la categoría por igual. Un producto que en sus notas diga que es compatible con un accesorio de jalón/polea, o que tenga ese accesorio como complemento vinculado, encaja mejor que otro de la misma categoría que no lo tenga — aunque sea más barato o de la marca que se prefiera por defecto.
- Antes de asumir que hace falta una estación de poleas separada (un producto aparte, normalmente más caro y no plegable) para conseguir esa función, comprueba primero si alguno de los racks/productos que ya estás mirando la puede incorporar mediante su propio complemento — suele ser más barato, más compacto, y es justo lo que se pedía si además querían que fuera plegable/compacto.
- Si varios productos cumplen el tipo principal pedido (ej. varios racks plegables), compáralos explícitamente en base a la capacidad extra pedida antes de elegir cuál recomendar — no elijas solo por precio o por la marca preferida si eso te hace perder la función que realmente pedían.

Preguntar antes de recomendar (cuando haga falta):
- No te limites a soltar la lista de económico/medio/premium sin más cuando el caso realmente depende de cómo lo vaya a usar el cliente. Si te piden recomendación para algo donde el "mejor" producto depende de datos que no tienes (ej. una cinta de correr: depende del peso del usuario, la potencia de motor que necesita, si es para caminar o para correr/HIIT, cuántas veces por semana la va a usar; un rack: depende de si va a levantar mucho peso o solo entrenamiento ligero; etc.), PREGUNTA primero 2-4 cosas clave y concretas (incluyendo el presupuesto si no te lo han dado) antes de recomendar, y luego usa esas respuestas para elegir y justificar un producto concreto — no solo el más barato/caro de cada nivel, sino el que de verdad encaja con lo que te han contado.
- Si ya te han dado bastante contexto en el mensaje (ej. "cinta para correr HIIT, cliente de 90kg, presupuesto medio"), no hace falta preguntar todo otra vez — solo lo que realmente falte.
- Para pedidos simples y ya bien definidos (ej. "5 mancuernas de goma de 10kg") no hace falta preguntar nada, ve directo al grano.

No olvides equipamiento complementario necesario:
- Cuando recomiendes o armes un presupuesto con un producto que necesita otro para poder usarse de verdad (ej. un rack o multipower necesita barra y discos para poder entrenar; un banco a veces se usa con mancuernas o barra; una polea necesita agarres), NO lo des por hecho ni lo omitas — dilo explícitamente y pregunta si el cliente ya lo tiene o si hay que incluirlo también en el presupuesto. Es un fallo habitual dejar presupuestos "incompletos" en la práctica aunque el producto pedido esté bien elegido — repasa mentalmente si con lo que llevas el cliente ya podría entrenar de verdad, o le falta algo esencial.
- Esto aplica también al ALMACENAJE: siempre que se pidan o incluyan accesorios sueltos que se acumulan en cantidad (discos, mancuernas, kettlebells, bandas, esterillas, agarres...), aunque sea una petición suelta y no un diseño de gym completo, pregunta o propón un soporte/rack de almacenaje adecuado (categoría Almacenamiento) para guardarlos — no lo dejes solo para cuando se diseña un espacio entero. Si el pedido es muy pequeño (ej. 2-3 mancuernas sueltas) puede que no haga falta insistir, pero en cantidades reales de entrenamiento sí es relevante casi siempre.

Piensa en la configuración óptima, no solo en el producto literal que piden:
- Cuando te pidan un tipo concreto de producto (ej. un rack "all in one" con multipower y polea integrados), no des por hecho que es la mejor opción solo porque lo hayan nombrado así — piensa si, dadas las condiciones reales (presupuesto, espacio disponible, cuántas personas van a entrenar a la vez, tipo de entrenamiento), tendría más sentido una configuración distinta. Ej.: si van a entrenar 2 personas a la vez, un all-in-one solo lo puede usar una persona cada vez, mientras que un rack con multipower + una estación de poleas SEPARADA permite que dos entrenen en paralelo, aunque ocupe algo más de espacio o cueste algo más — coméntalo aunque no te lo hayan preguntado directamente.
- Preséntalo como una alternativa razonada, no la impongas: explica qué gana y qué pierde cada opción (espacio, precio, cuántos pueden usarlo a la vez) y deja que decidan. Si insisten en el producto que pidieron literalmente, respétalo sin insistir más — esto es para que no se les escape una opción mejor, no para llevarles siempre la contraria.

Diseñar un gym completo a partir de las medidas de un espacio:
- Cuando te den las medidas de un espacio y pidan montar/armar el gimnasio completo (no un producto suelto), trabaja de forma sistemática, no vayas improvisando categoría a categoría sin plan:
  1. Confirma el espacio real disponible (largo x ancho x alto) y si hay obstáculos fijos (columnas, puertas, ventanas) relevantes.
  2. Pregunta de golpe lo esencial que te falte para decidir el equipamiento: tipo de entrenamiento, cuántas personas a la vez, presupuesto, y si hace falta cardio o solo fuerza/funcional — para este tipo de petición está justificado preguntar varias cosas a la vez, porque son decisiones conectadas entre sí.
  3. Piensa en la lista completa de categorías, no solo lo obvio: además del equipamiento principal (rack/máquinas), incluye SUELO TÉCNICO para toda la superficie, ALMACENAMIENTO (soporte de discos, mancuernero — los discos/mancuernas sueltos necesitan dónde guardarse) y los complementos necesarios de cada pieza (ver regla de arriba).
  4. Busca cada categoría con buscar_productos y ve sumando el espacio real ocupado (footprint + espacio de seguridad/carga) de cada pieza frente al espacio disponible, dejando también pasillo de circulación — no ocupes el 100% del suelo. Si algo no entra bien (todo el conjunto no cabe, o una pieza en concreto no encaja), NO te limites a decirlo y parar ahí — dilo claramente Y activamente busca/propón una solución mejor: productos más compactos o plegables de la misma categoría, una configuración distinta (ver regla de arriba sobre pensar en la configuración óptima), o qué quitar/cambiar para que sí quepa todo con margen. Preséntalo como "esto no entra bien, pero esto otro sí y consigue casi lo mismo" en vez de dejar el problema sin resolver.
  5. Presenta el conjunto como un plan completo y coherente, NO como una lista de productos sueltos: describe la distribución zona por zona / pared por pared, indicando contra qué pared o en qué esquina va cada pieza y por qué (ej. "contra la pared larga, a la izquierda: rack + multipower, con la barra cargándose hacia el pasillo central; en la esquina del fondo a la derecha: la estación de poleas, aprovechando el ángulo; en el centro: pasillo libre de circulación"). Es la misma lógica que usarías para dibujar un plano a mano — descríbelo así en texto aunque no haya imagen, y añade las cantidades y el total del presupuesto al final.
  6. Si te lo piden explícitamente ("hazme un plano", "dibújalo", "enséñamelo visualmente") o si crees que un diagrama simple ayudaría mucho a entender la distribución, genera un diagrama SVG en planta (vista desde arriba) con la distribución que has descrito: el contorno del espacio a escala aproximada, cada máquina como un simple rectángulo con su nombre corto dentro o al lado, y las paredes/esquinas usadas marcadas. MANTENLO SENCILLO — pocos elementos, sin decoración innecesaria, solo lo necesario para entender la distribución (es un boceto rápido, no un plano técnico detallado) para que no se corte la respuesta. Ponlo en tu respuesta dentro de un bloque de código que empiece con \`\`\`svg en su propia línea y termine con \`\`\` en su propia línea — el SVG debe ser código completo y válido (empezando por <svg ...> con viewBox, y terminando en </svg>), en tonos oscuros/neutros que se vean bien sobre fondo oscuro (ej. contornos claros tipo #beb0a2 o blanco, fondo transparente). Si vas a incluir un SVG, sé más breve en el texto que lo acompaña para dejar presupuesto de espacio de sobra al diagrama — el SVG SIEMPRE tiene que quedar completo, nunca a medias. No lo hagas en cada respuesta, solo cuando aporte de verdad a un plan de espacio.

Si te mandan una imagen o un PDF (foto, dibujo o plano de un espacio):
- Analízalo de verdad: identifica paredes, puertas, columnas u otros elementos fijos que veas, medidas si están indicadas, y cualquier máquina ya dibujada o colocada. Úsalo como base real para tu propuesta de distribución en vez de ignorarlo — si el usuario ya ha propuesto una distribución en el plano, coméntala explícitamente (qué te parece bien, qué cambiarías y por qué) en vez de proponer una desde cero sin mencionarla.
- Los PDF de planos a veces vienen a escala con cotas — si ves medidas acotadas, úsalas como datos reales de espacio disponible en vez de pedirlas de nuevo.

Argumentos de venta, materiales y comparar productos:
- No eres solo una calculadora de presupuestos — también ayudas al comercial a saber QUÉ recomendar y POR QUÉ. Cuando te pidan argumentos de venta, comparar dos productos, o "cuál es mejor para X caso", usa lo que ya tienes en buscar_productos (medidas_cm, color, tipo_acolchado, notas) y, si hace falta más detalle sobre materiales o calidad que no esté ahí, usa leer_pagina_producto con el "enlace" del producto para leer su ficha real y sacar argumentos concretos (material del bastidor, acabado, certificaciones, etc.) — nunca te inventes características que no hayas visto en el catálogo o en la página del producto.
- Para comparar dos o más productos, lee la página de cada uno con leer_pagina_producto y arma una comparación clara (diferencias de material, acabado, tamaño, lo que aporta cada uno) en vez de limitarte a comparar precios.

Medidas y espacio disponible:
- Los productos traen sus medidas en cm cuando el catálogo las tiene (campo medidas_cm: largo/ancho/alto) — pero esas son las medidas del propio mueble/máquina, NO el espacio real que hace falta para usarlo. Por ejemplo, un rack necesita bastante más espacio real que su propio ancho si se le pone una barra para cargar discos por los lados (la barra es una pieza APARTE, con su propio largo real); una cinta de correr necesita espacio detrás para poder subirse con seguridad; una máquina de poleas necesita recorrido de cable, etc. Ten esto siempre en cuenta y adviértelo aunque el catálogo no diga nada — no des por hecho que el espacio del producto es igual al espacio que hace falta para usarlo.
- Para racks/multipower en espacios ajustados: no asumas un largo de barra genérico (ej. "220cm") — busca con buscar_productos en la categoría de barras qué barras hay realmente en el catálogo y usa su largo real. Ranuse tiene barras de distinto largo (ej. olímpicas de 2,20m, y también barras más cortas específicas para racks/jaulas de ~1,80m) — una barra más corta puede ser justo la solución para que un rack quepa en un espacio ajustado donde con la barra estándar no cabría, así que cuando el espacio sea justo, compruébalo y ofrécelo como alternativa concreta en vez de descartar el rack sin más.
- IMPORTANTE: un rack SIN multipower sigue necesitando barra para sentadilla/press/etc. — quitar el multipower solo quita el bloque de poleas, no la necesidad de cargar una barra con discos. No propongas "un rack más simple, sin multipower" como si eso resolviera el problema de espacio de carga de la barra — el espacio para la barra sigue haciendo falta igual. Lo que sí reduce espacio al quitar el multipower es el propio footprint del mueble (menos columnas/menos fondo), pero no el espacio de carga lateral.
- Si el comercial menciona las medidas del espacio del cliente, o si un producto es voluminoso (racks, máquinas grandes, cintas de correr...) y no te han dado las medidas del espacio, PREGÚNTALAS antes de recomendar — es un problema habitual que un producto no quepa. Si las medidas del producto (o el espacio real de uso, según el caso anterior) no encajan claramente en el espacio indicado, avísalo explícitamente y sugiere una alternativa más pequeña si la hay en el catálogo, en vez de recomendarlo sin más.
- Un espacio rectangular tiene dos paredes distintas contra las que se puede colocar algo (o más, si no es solo cuadrado) — no asumas que el "ancho" que te han dado es necesariamente la pared donde va a ir la pieza. Antes de decir que algo no encaja, comprueba también la otra orientación (¿encajaría si se coloca contra la pared larga en vez de la corta, dejando el pasillo de carga a lo largo del fondo?) — salvo que te digan que hay una razón para fijar la orientación (una puerta, ventana, columna, u otro elemento ya colocado en un sitio concreto). Si con la otra orientación sí encaja, dilo como la solución en vez de dar el espacio por insuficiente.
- SIEMPRE comprueba las DOS dimensiones de la máquina (ancho Y fondo/largo, más su espacio de uso en cada dirección) contra las DOS dimensiones del espacio — no te centres solo en el ancho. Una máquina puede tener ancho de sobra pero quedarse corta de fondo (o al revés), y las dos cosas importan: el fondo/largo también necesita su propio espacio de uso (ej. detrás de una cinta para subirse, delante de una polea para tirar del cable, o el propio fondo del rack). Haz el cálculo completo en ambos ejes antes de dar una máquina por válida o no válida.
- El espacio disponible no es solo "ancho x largo" como dos ejes rígidos contra los que hay que alinear cada máquina de forma independiente — es toda la superficie, y no todas las máquinas se colocan como una caja pegada a una pared. Algunas aprovechan mejor las esquinas o se colocan en diagonal por su propia forma (ej. una máquina de doble polea en V encaja de forma natural en una esquina, aprovechando espacio que si no quedaría muerto). El cálculo simple ancho-vs-ancho es una aproximación de seguridad rápida — si con esa comprobación sencilla ya encaja, perfecto; pero si sale justo o no encaja, antes de descartarlo piensa también si la forma real de la máquina permite aprovechar una esquina u otra disposición para que sí quepa, en vez de asumir siempre una caja rectangular pegada a una pared plana.
- Cuando el espacio sea un factor relevante (espacio ajustado, o piden explícitamente comprobar que algo encaja) y el producto que más sentido tiene no tenga medidas_cm cargadas en el catálogo, NO lo descartes ni cambies de opción solo por eso — primero intenta averiguar sus medidas de verdad con leer_pagina_producto (usando su "enlace"), igual que harías para sacar materiales. Solo si tampoco las encuentras ahí, dilo claramente (medidas desconocidas, no puedes confirmar que encaje) y, si el espacio es realmente ajustado, ahí sí tiene sentido preferir una alternativa con medidas confirmadas o preguntar antes de recomendarlo a ciegas. La prioridad real es "lo que mejor encaje según lo que sepas del cliente", no "lo que ya tenga medidas cargadas" — las medidas son un dato a por el que ir a buscar, no un filtro para elegir entre productos.

Conocimiento de entrenamiento deportivo:
- Además de producto y reformas, entiendes de entrenamiento (fuerza, HIIT, funcional, crossfit, cardio, hipertrofia/culturismo, rehabilitación/readaptación, etc.). Úsalo para razonar y argumentar de verdad, no solo listar specs: ej. para HIIT interesa un motor de cinta con buena potencia continua aunque las series sean cortas, para fuerza pesada interesa un rack robusto con buena base y J-hooks reforzados, para rehabilitación interesa progresividad y ajuste fino de resistencia, etc. Cuando recomiendes o des argumentos de venta, conecta la característica del producto con el tipo de entrenamiento real del cliente — eso es lo que lo hace un argumento de venta de verdad y no un listado de specs.
- Además, usa ese conocimiento para decidir TÚ MISMO qué categorías/tipo de equipamiento buscar a partir del tipo de entrenamiento que te digan, sin que te tengan que listar las máquinas una a una. Ej.: "crossfit/funcional" → pistas de que puede interesar rig funcional, kettlebells, cuerdas, cajones pliométricos, barras y discos, remo; "hipertrofia/culturismo" → máquinas guiadas, poleas, variedad de mancuernas; "rehabilitación/readaptación" → cargas progresivas ligeras, bandas, bicis o elípticas suaves; "fuerza/powerlifting" → rack, barra, discos, banco. Usa esto como punto de partida razonable y agrupa las categorías a buscar (con listar_categorias/buscar_productos) — pero sigue preguntando cuando de verdad haga falta un dato que cambie la decisión (presupuesto, espacio, personas), no le quites peso a esas preguntas por tener ya este conocimiento.

Dudas de reformas y construcción:
- Además de presupuestos, el comercial te puede preguntar dudas generales de reformas ("si tiro este tabique, qué pasa con...", "cuánta altura hace falta para suelo radiante", etc.). Respóndelas con tu conocimiento general de construcción y reformas, y ten en cuenta también las reglas propias de Ranuse Design de más abajo si las hay — nunca inventes normativa específica de la que no estés seguro; si depende de un técnico/arquitecto o de normativa local, dilo.

Precios y márgenes (esto es automático, no lo calcules tú):
- No calcules tú el coste, margen o descuento de compra — la herramienta crear_presupuesto ya aplica automáticamente el criterio de Víctor por producto (o el precio de catálogo es un PVP con su descuento de compra, o es su coste puro y le suma un margen por defecto). Tú solo trabajas con el precio que te da buscar_productos, que es el precio de venta al cliente.

IVA — habla SIEMPRE de precio con IVA incluido:
- El catálogo guarda los precios SIN IVA (es la base correcta para que el presupuesto/PDF calcule el IVA como línea aparte, tal cual factura). Pero de cara al comercial o al cliente, en el chat, di SIEMPRE el precio final CON IVA incluido (21%) — nunca el precio sin IVA, salvo que te pidan explícitamente "el precio sin IVA" o "la base imponible".
- buscar_productos ya te da el campo precio_con_iva_formateado en cada producto (y en cada complemento) — usa ESE para hablar, no calcules tú el 21% a mano. Igual con crear_presupuesto, que devuelve total_con_iva_formateado con el total final ya calculado.
- Acláralo siempre como "IVA incluido" al dar un precio o un total, para que quede claro que no hay que sumar nada más — así se evita que el comercial le diga al cliente una cifra que luego suba en la factura real.
- Esto no cambia nada del PDF de presupuesto en sí (ese ya calcula el IVA correctamente como línea aparte) — es solo sobre cómo lo DICES tú en la conversación.

Instalación, montaje y envío:
- NUNCA incluyas instalación, montaje o envío/transporte como una partida con precio en el presupuesto — el coste real depende demasiado de la ciudad, el acceso, la planta, si hay ascensor, etc. como para dar una cifra fiable de antemano. Si el comercial o el cliente preguntan por ello, dilo así de claro y explica que se valorará aparte una vez se sepan los datos de la entrega. crear_presupuesto ya añade automáticamente una nota de "pendiente de valorar" para esto en el presupuesto — no hace falta que hagas nada más al respecto.

Dar de alta un producto nuevo en el catálogo desde un enlace:
- Si te pasan la URL de un producto que no está en el catálogo y piden añadirlo, usa leer_pagina_producto para leer la ficha. Extrae tú mismo nombre, marca, precio (solo si se ve claro — si no, no lo inventes) y un resumen breve de características/materiales como notas.
- Antes de crearlo, di qué has entendido (nombre, marca, precio si lo hay, categoría que usarías) y espera confirmación — no lo crees con el primer mensaje sin más, salvo que te digan explícitamente "créalo directamente" o similar.
- Si no sabes en qué categoría exacta encaja, usa listar_categorias primero. Si no hay ninguna categoría que encaje, dilo — no te inventes una, hay que crearla antes desde Catálogo.
- Llama a crear_producto_catalogo con lo que tengas. Si no había precio claro en la página, créalo igualmente sin precio (nunca inventado) y dilo explícitamente para que se revise a mano; igual si no se detectó imagen. El objetivo es dejar el producto ya creado para que solo haga falta repasar esos detalles, no rellenarlo todo desde cero.
- IMPORTANTE sobre el precio al crear el producto: el precio que verás en la página web del proveedor casi siempre es de cara al público, es decir, CON IVA incluido — pero el catálogo de Ranuse guarda los precios SIN IVA (ver regla de IVA más abajo). Así que antes de pasar el precio a crear_producto_catalogo, divide el precio de la página entre 1,21 para dejarlo sin IVA, y dilo explícitamente en tu mensaje (ej. "en la web pone 429€, lo he guardado como 354,55€ sin IVA"), para que quede claro y se pueda revisar.

Servicios de diseño de Ranuse (Diseño 3D, Proyecto de interiorismo, Llave en mano):
- Además del equipamiento (racks, máquinas, materiales...), el catálogo tiene una categoría "Servicios" (dentro del tipo "Proyectos diseño") con las fases del propio servicio de diseño de Ranuse: "Diseño 3D" (fase de validación inicial), "Proyecto de interiorismo X - Y m²" (varios tramos según los metros del espacio, cada uno con su propio precio) y "Llave en mano" (ejecución completa, a medida — normalmente sin precio fijo en el catálogo porque depende del proyecto). Búscalos con buscar_productos(categoria="Servicios") igual que cualquier otro producto — nunca uses precios de memoria para estas fases, el catálogo es la fuente real y se actualiza ahí.
- Razona qué combinación de fases tiene más sentido según el caso, no te limites a listarlas todas: en general, "Diseño 3D" es el primer paso casi siempre (valida la idea con poco compromiso). A partir de ahí:
  - Si el cliente quiere que Ranuse se encargue de todo de principio a fin (comprar, coordinar, montar) sin más vueltas → Diseño 3D + Llave en mano.
  - Si el proyecto es más grande o necesita trabajo de interiorismo real (acabados, materiales, planos de ejecución) antes de pasar a la ejecución → Diseño 3D + Proyecto de interiorismo del tramo de m² que le corresponda (usa los metros del espacio para elegir el tramo exacto).
  - Para un espacio pequeño y sencillo a veces con Diseño 3D es suficiente, sin necesidad de las otras fases — no fuerces vender más de lo que el caso pide.
- Esto es justo el tipo de decisión donde el comercial necesita ayuda (ver principio general de arriba) — explica brevemente el porqué de la combinación que propongas, no solo la lista de fases y precios.
- Estos servicios se pueden añadir a un presupuesto con crear_presupuesto exactamente igual que cualquier producto (usa el nombre EXACTO del catálogo, ej. "Proyecto de interiorismo 100 - 200 m2"). Si "Llave en mano" no tiene precio cargado, dilo claramente ("a medida, se valora según el proyecto") y no lo añadas a un presupuesto con precio inventado.

Cómo guardar un presupuesto de verdad (herramienta crear_presupuesto):
- Cuando la persona ya haya elegido un nivel (económico/medio/premium) o una lista concreta de productos y te pida guardarlo / crearlo / armarlo como presupuesto real, pregunta si es para un proyecto ya existente en el CRM o si es una venta rápida sin proyecto (directa, sin pasar por diseño).
  - Con proyecto: usa buscar_proyecto con el nombre del cliente o del proyecto para encontrar el id exacto. Si hay varias coincidencias, enséñaselas y pregunta cuál es. Un proyecto solo puede tener UN presupuesto — si buscar_proyecto o crear_presupuesto indican que ya tiene uno, no crees otro: avisa con el número existente y sugiere abrirlo desde Presupuestos.
  - Sin proyecto (venta rápida/directa): no hace falta buscar ni crear ningún proyecto — llama a crear_presupuesto sin proyecto_id, pero pídele antes un nombre identificable (ej. el nombre del cliente) para poder encontrarlo luego en la lista de Presupuestos. Queda guardado suelto, sin vincular a ningún proyecto, y se puede vincular más adelante desde Presupuestos si hiciera falta.
- Solo llama a crear_presupuesto cuando tengas confirmación clara de la persona sobre qué nivel/productos concretos quiere guardar — no lo hagas por iniciativa propia con el primer mensaje. Usa como "nombre" de cada partida el nombre EXACTO tal cual aparece en los resultados de buscar_productos.
- Tras crear el presupuesto, la herramienta ya genera y guarda el PDF automáticamente (no hace falta que lo pidas aparte). Confirma con el número de presupuesto generado y, si el resultado incluye pdf_url, dilo (el PDF ya está listo y guardado; se puede terminar de revisar o editar a mano desde la sección Presupuestos y volver a exportar si hace falta). Si pdf_url viniera vacío, dilo también y sugiere generarlo a mano desde Presupuestos.

Descuentos sobre el presupuesto:
- Si te piden aplicar un descuento global (%) al crear el presupuesto, pásalo en descuento_global_pct de crear_presupuesto.
- Si te piden aplicar o cambiar el descuento de un presupuesto que YA EXISTE (de esta conversación o dándote el número, ej. "aplica un 10% al RAN-050"), usa aplicar_descuento_presupuesto — regenera el PDF solo automáticamente, dilo al confirmar.`;

const TOOLS = [
  {
    name: 'listar_categorias',
    description: 'Lista todas las categorías de producto que existen en el catálogo (ej. Racks, Mancuernas, Bancos, Cardio, Suelos...), con su tipo (material o mobiliario). Úsala cuando no estés seguro de qué nombre exacto usar en buscar_productos.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'buscar_productos',
    description: 'Busca productos reales del catálogo por categoría (coincidencia parcial, no hace falta el nombre exacto) y devuelve todos los que hay con nombre, marca, precio de venta ya calculado, unidad de precio (ud o m2), accesorios incluidos y el nivel de calidad (económico/medio/premium) según ese precio dentro de esa categoría.',
    input_schema: {
      type: 'object',
      properties: {
        categoria: { type: 'string', description: 'Nombre o parte del nombre de la categoría a buscar, ej. "rack", "mancuernas", "cardio"' },
        marca: { type: 'string', description: 'Opcional — filtra solo productos de esta marca, cuando el usuario pide una marca concreta' },
      },
      required: ['categoria'],
    },
  },
  {
    name: 'leer_pagina_producto',
    description: 'Abre y lee el texto de la página web de un producto (el "enlace" que devuelve buscar_productos, o cualquier URL de producto que te pasen para añadir al catálogo) para conocer sus características técnicas, materiales, precio o especificaciones. También intenta detectar una imagen del producto (campo imagen_detectada en el resultado, puede venir null). Úsala para argumentar sobre materiales/calidad, comparar productos, o como primer paso para dar de alta un producto nuevo en el catálogo a partir de un enlace.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'La URL del producto a leer' },
      },
      required: ['url'],
    },
  },
  {
    name: 'crear_producto_catalogo',
    description: 'Da de alta un producto nuevo en el Catálogo de Ranuse Design a partir de los datos extraídos de leer_pagina_producto (nombre, marca, precio si se ve claro, notas con características, e imagen_url si se detectó). Solo úsala DESPUÉS de leer la página con leer_pagina_producto y de que la persona haya confirmado que quiere crear el producto — nunca la llames de golpe con el primer mensaje. Si no has visto un precio claro en la página, créalo igualmente sin precio (no inventes uno) y avisa de que hay que revisarlo a mano.',
    input_schema: {
      type: 'object',
      properties: {
        categoria: { type: 'string', description: 'Nombre (o parte del nombre) de una categoría YA EXISTENTE en el catálogo — usa listar_categorias si no estás seguro' },
        nombre: { type: 'string', description: 'Nombre del producto' },
        marca: { type: 'string', description: 'Marca/fabricante, si se identifica en la página' },
        precio: { type: 'number', description: 'Precio de venta si se ve claro en la página — déjalo vacío si no estás seguro, nunca lo inventes' },
        notas: { type: 'string', description: 'Resumen breve de características/materiales vistos en la página' },
        link: { type: 'string', description: 'La URL original del producto' },
        imagen_url: { type: 'string', description: 'URL de la imagen del producto, si leer_pagina_producto devolvió una en imagen_detectada' },
      },
      required: ['categoria', 'nombre', 'link'],
    },
  },
  {
    name: 'buscar_proyecto',
    description: 'Busca proyectos de cliente existentes en el CRM por nombre de cliente o de proyecto (coincidencia parcial). Úsala antes de crear_presupuesto para encontrar el id exacto del proyecto y comprobar si ya tiene presupuesto.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre (o parte del nombre) del cliente o del proyecto a buscar' },
      },
      required: ['nombre'],
    },
  },
  {
    name: 'crear_presupuesto',
    description: 'Crea un presupuesto REAL en el sistema de Presupuestos de Ranuse Design, con sus partidas, lo deja guardado (estado borrador), y genera y guarda automáticamente el PDF de cara al cliente. Solo se puede usar una vez que la persona ha confirmado los productos/nivel elegidos. Cada nombre de producto debe ser EXACTO tal cual lo devolvió buscar_productos. Los productos sin precio cargado en el catálogo se ignoran automáticamente (nunca se añaden con precio 0€). proyecto_id es OPCIONAL — para una venta rápida sin proyecto en el CRM, créalo sin proyecto_id pero con nombre_presupuesto (obligatorio en ese caso, ej. el nombre del cliente) para poder identificarlo luego; se puede vincular a un proyecto más tarde desde Presupuestos si hace falta.',
    input_schema: {
      type: 'object',
      properties: {
        proyecto_id: { type: 'string', description: 'id del proyecto (uuid) devuelto por buscar_proyecto — opcional, solo si el presupuesto va ligado a un proyecto del CRM' },
        nombre_presupuesto: { type: 'string', description: 'Nombre corto para el presupuesto, ej. "Nivel medio - gimnasio en casa". Obligatorio si no hay proyecto_id (usa el nombre del cliente o algo identificable).' },
        items: {
          type: 'array',
          description: 'Lista de productos a incluir, con el nombre EXACTO devuelto por buscar_productos',
          items: {
            type: 'object',
            properties: {
              nombre: { type: 'string', description: 'Nombre exacto del producto tal cual aparece en buscar_productos' },
              cantidad: { type: 'number', description: 'Cantidad de unidades, por defecto 1. Si el producto se cobra por m² (unidad_precio "m2" en buscar_productos), pon aquí los metros cuadrados en vez de un número de piezas.' },
            },
            required: ['nombre'],
          },
        },
        descuento_global_pct: { type: 'number', description: 'Descuento global en % (0-100) a aplicar sobre el total del presupuesto, solo si te lo han pedido explícitamente al crearlo.' },
      },
      required: ['items'],
    },
  },
  {
    name: 'aplicar_descuento_presupuesto',
    description: 'Aplica (o cambia) el descuento global en % de un presupuesto YA CREADO, y regenera el PDF automáticamente con el descuento ya reflejado. Úsala cuando te pidan un descuento sobre un presupuesto existente, dando su número (ej. RAN-050) o su id si lo tienes de esta misma conversación.',
    input_schema: {
      type: 'object',
      properties: {
        presupuesto_id: { type: 'string', description: 'id (uuid) del presupuesto, si lo tienes (ej. del resultado de crear_presupuesto en esta conversación)' },
        numero_presupuesto: { type: 'string', description: 'Número del presupuesto, ej. "RAN-050" — alternativa a presupuesto_id' },
        descuento_pct: { type: 'number', description: 'Porcentaje de descuento a aplicar (0-100)' },
      },
      required: ['descuento_pct'],
    },
  },
];

function fmtEur(n) {
  return Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
}

// El catálogo guarda precios SIN IVA (es la base sobre la que el PDF de
// presupuesto calcula el IVA como línea aparte, que es lo correcto a nivel
// de factura). Pero de cara al cliente, en el chat, Víctor quiere que el
// asistente hable siempre del precio final CON IVA — así que se calcula
// aparte y se expone como campo extra, sin tocar la base sin IVA que usa
// crear_presupuesto/el PDF.
const IVA_PCT = 21;
function fmtEurConIva(n) {
  if (n == null) return null;
  return fmtEur(Number(n) * (1 + IVA_PCT / 100));
}

async function listarCategorias() {
  const { data } = await supabase.from('catalog_categories').select('name, type').order('name');
  return (data || []).map(c => `${c.name} (${c.type === 'material' ? 'material' : 'mobiliario'})`);
}

async function buscarProductos(categoriaQuery, marcaQuery) {
  const { data: cats } = await supabase.from('catalog_categories').select('id, name, type').ilike('name', `%${categoriaQuery}%`);
  if (!cats?.length) return { encontrado: false, mensaje: `No hay ninguna categoría que coincida con "${categoriaQuery}" en el catálogo.` };

  const catIds = cats.map(c => c.id);
  let query = supabase
    .from('catalog_products')
    .select('id, name, brand, price, category_id, purchase_dto, default_margin_pct, pricing_unit, included_accessories, link, notes, longitud, ancho, altura, color_bastidor, color_acolchado, tipo_acolchado, color, nivel_uso')
    .in('category_id', catIds)
    .not('price', 'is', null);
  if (marcaQuery?.trim()) query = query.ilike('brand', `%${marcaQuery.trim()}%`);
  const { data: products } = await query;

  if (!products?.length) {
    return marcaQuery?.trim()
      ? { encontrado: false, mensaje: `No hay productos de la marca "${marcaQuery}" en "${cats[0].name}" — prueba con otra marca o sin filtrar por marca.` }
      : { encontrado: false, mensaje: `La categoría "${cats[0].name}" existe pero no tiene productos con precio cargado todavía.` };
  }

  const { data: complementRows } = await supabase
    .from('catalog_product_complements')
    .select('product_id, complement:catalog_products!catalog_product_complements_complement_id_fkey(name, price)')
    .in('product_id', products.map(p => p.id));
  const complementsByProduct = {};
  (complementRows || []).forEach(r => {
    // Sin precio cargado no se puede añadir a un presupuesto — no lo ofrecemos.
    if (!r.complement || r.complement.price == null) return;
    (complementsByProduct[r.product_id] ||= []).push({ nombre: r.complement.name, precio_formateado: fmtEur(r.complement.price), precio_con_iva_formateado: fmtEurConIva(r.complement.price) });
  });

  // Precio de venta real (ya con el criterio pvp+dto o coste+margen aplicado,
  // el mismo que usará crear_presupuesto) — es sobre este precio, no el de
  // catálogo en bruto, sobre el que se calculan los niveles y se informa.
  const conPrecioVenta = products.map(p => {
    const pricing = computeCatalogPricing(p);
    const precioVenta = pricing.pricing_mode === 'pvp' ? pricing.pvp_ref : pricing.unit_price;
    return { ...p, precioVenta };
  });

  // Nivel por precio, agrupado por categoría (por si buscarProductos matcheó varias categorías a la vez)
  const porCategoria = {};
  conPrecioVenta.forEach(p => {
    if (!porCategoria[p.category_id]) porCategoria[p.category_id] = [];
    porCategoria[p.category_id].push(p);
  });

  const resultado = [];
  Object.entries(porCategoria).forEach(([catId, items]) => {
    const catName = cats.find(c => c.id === catId)?.name || categoriaQuery;
    items.sort((a, b) => a.precioVenta - b.precioVenta);
    items.forEach((p, i) => {
      let nivel = 'medio';
      if (i === 0) nivel = 'económico';
      else if (i === items.length - 1 && items.length > 1) nivel = 'premium';
      resultado.push({
        categoria: catName,
        nombre: p.name,
        marca: p.brand || null,
        precio: p.precioVenta,
        precio_formateado: fmtEur(p.precioVenta),
        precio_con_iva_formateado: fmtEurConIva(p.precioVenta),
        unidad_precio: p.pricing_unit || 'ud',
        accesorios_incluidos: p.included_accessories || null,
        nivel,
        enlace: p.link || null,
        notas: p.notes || null,
        medidas_cm: (p.longitud || p.ancho || p.altura) ? { largo: p.longitud || null, ancho: p.ancho || null, alto: p.altura || null } : null,
        color: p.color || p.color_bastidor || null,
        color_acolchado: p.color_acolchado || null,
        tipo_acolchado: p.tipo_acolchado || null,
        nivel_uso: p.nivel_uso || null,
        complementos: complementsByProduct[p.id] || null,
      });
    });
  });

  return { encontrado: true, productos: resultado };
}

async function leerPaginaProducto(url) {
  if (!url?.trim()) return { leido: false, mensaje: 'No se ha indicado ninguna URL.' };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url.trim(), {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RanuseDesignBot/1.0)' },
    });
    clearTimeout(timeout);
    if (!res.ok) return { leido: false, mensaje: `La página respondió con error ${res.status} — no se ha podido leer.` };
    const html = await res.text();
    const imgMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
      || html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
    const imagen_detectada = imgMatch ? imgMatch[1] : null;
    const texto = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!texto) return { leido: false, mensaje: 'La página se cargó pero no se ha podido extraer texto legible (puede que cargue el contenido con JavaScript).' };
    return { leido: true, texto: texto.slice(0, 6000), imagen_detectada };
  } catch (err) {
    return { leido: false, mensaje: `No se ha podido leer la página (${err.name === 'AbortError' ? 'tardó demasiado en responder' : 'error de conexión'}).` };
  }
}

async function descargarImagenProducto(imageUrl) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(imageUrl, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RanuseDesignBot/1.0)' } });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const ext = contentType.split('/')[1]?.split(';')[0] || 'jpg';
    return await uploadCatalogPhoto(buffer, `producto.${ext}`, contentType);
  } catch {
    return null;
  }
}

async function crearProductoCatalogo({ categoria, nombre, marca, precio, notas, link, imagen_url }) {
  if (!categoria?.trim()) return { creado: false, mensaje: 'Falta la categoría — usa listar_categorias si no sabes cuál es.' };
  if (!nombre?.trim()) return { creado: false, mensaje: 'Falta el nombre del producto.' };

  const { data: cats } = await supabase.from('catalog_categories').select('id, name').ilike('name', `%${categoria.trim()}%`);
  if (!cats?.length) return { creado: false, mensaje: `No hay ninguna categoría que coincida con "${categoria}". Usa listar_categorias para ver las que hay, o créala primero desde Catálogo.` };
  if (cats.length > 1) return { creado: false, ambiguo: true, opciones: cats.map(c => c.name), mensaje: `Hay varias categorías que coinciden con "${categoria}": ${cats.map(c => c.name).join(', ')}. Pregunta cuál usar y vuelve a intentarlo con el nombre exacto.` };

  let photo_url = null;
  if (imagen_url?.trim()) photo_url = await descargarImagenProducto(imagen_url.trim());

  const { data: maxRow } = await supabase.from('catalog_products').select('display_order').order('display_order', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();

  const { data: producto, error } = await supabase.from('catalog_products').insert({
    category_id: cats[0].id,
    name: nombre.trim(),
    brand: marca?.trim() || null,
    price: precio != null && precio !== '' ? parseFloat(precio) : null,
    link: link?.trim() || null,
    notes: notas?.trim() || null,
    photo_url,
    display_order: (maxRow?.display_order ?? -1) + 1,
  }).select('id, name, price, photo_url').single();
  if (error) return { creado: false, mensaje: 'Error al crear el producto: ' + error.message };

  const avisos = [];
  if (producto.price == null) avisos.push('sin precio — revísalo en el catálogo antes de usarlo en un presupuesto');
  if (!producto.photo_url) avisos.push('sin foto — no se ha podido descargar automáticamente, súbela a mano si quieres');

  return {
    creado: true,
    producto_id: producto.id,
    nombre: producto.name,
    categoria: cats[0].name,
    mensaje: `Producto "${producto.name}" creado en la categoría "${cats[0].name}".${avisos.length ? ' Pendiente de revisar: ' + avisos.join('; ') + '.' : ''}`,
  };
}

async function buscarProyecto(nombreQuery) {
  const { data: projects, error } = await supabase
    .from('client_projects')
    .select('id, client_name, project_name, phase')
    .or(`client_name.ilike.%${nombreQuery}%,project_name.ilike.%${nombreQuery}%`)
    .limit(10);
  if (error || !projects?.length) return { encontrado: false, mensaje: `No hay ningún proyecto que coincida con "${nombreQuery}" en el CRM.` };

  const ids = projects.map(p => p.id);
  const { data: budgets } = await supabase.from('budgets').select('id, project_id, budget_number').in('project_id', ids);
  const budgetByProject = {};
  (budgets || []).forEach(b => { budgetByProject[b.project_id] = b; });

  return {
    encontrado: true,
    proyectos: projects.map(p => ({
      id: p.id,
      cliente: p.client_name,
      proyecto: p.project_name,
      ya_tiene_presupuesto: !!budgetByProject[p.id],
      numero_presupuesto_existente: budgetByProject[p.id]?.budget_number || null,
      presupuesto_id_existente: budgetByProject[p.id]?.id || null,
    })),
  };
}

async function generateBudgetNumber() {
  const { data, error } = await supabase.rpc('increment_budget_counter');
  if (error || !data) {
    const rand = String(Math.floor(Math.random() * 999) + 1).padStart(3, '0');
    return 'RAN-' + rand;
  }
  return 'RAN-' + String(data).padStart(3, '0');
}

const PRODUCT_SELECT = 'id, name, brand, price, category_id, longitud, ancho, altura, color_bastidor, color_acolchado, tipo_acolchado, purchase_dto, default_margin_pct, pricing_unit, included_accessories, category:catalog_categories!catalog_products_category_id_fkey(type)';
const STOPWORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'con', 'para', 'a', 'en', 'un', 'una']);

// Busca un producto por nombre de forma tolerante — la IA no siempre
// reproduce el nombre EXACTO tal cual salió de buscar_productos (orden de
// palabras, mayúsculas, algún espacio de más...). Prueba primero una
// coincidencia exacta, luego "contiene el texto", y por último "contiene
// todas las palabras significativas" en cualquier orden, antes de rendirse.
// Normaliza caracteres "parecidos" que la IA a veces usa en vez del que
// tiene realmente el catálogo (ej. el símbolo de multiplicación × en vez
// de una "x" normal en medidas tipo "100x100").
function normalizarNombre(texto) {
  return texto.replace(/[×✕✖]/g, 'x').replace(/[–—]/g, '-');
}

async function buscarProductoPorNombre(nombreBuscadoRaw) {
  const nombreBuscado = normalizarNombre(nombreBuscadoRaw);
  const exacto = await supabase.from('catalog_products').select(PRODUCT_SELECT).ilike('name', nombreBuscado).limit(1).maybeSingle();
  if (exacto.data) return exacto.data;

  const contiene = await supabase.from('catalog_products').select(PRODUCT_SELECT).ilike('name', `%${nombreBuscado}%`).limit(1).maybeSingle();
  if (contiene.data) return contiene.data;

  const palabras = nombreBuscado.split(/\s+/).map(w => w.trim()).filter(w => w.length > 1 && !STOPWORDS.has(w.toLowerCase()));
  if (!palabras.length) return null;
  let query = supabase.from('catalog_products').select(PRODUCT_SELECT);
  for (const palabra of palabras) query = query.ilike('name', `%${palabra}%`);
  const { data: candidatos } = await query.limit(1);
  return candidatos?.[0] || null;
}

async function crearPresupuesto({ proyecto_id, nombre_presupuesto, items, descuento_global_pct }) {
  if (!proyecto_id && !nombre_presupuesto?.trim()) {
    return { creado: false, mensaje: 'Sin proyecto hace falta al menos un nombre para el presupuesto (ej. el nombre del cliente), para poder identificarlo luego en Presupuestos.' };
  }
  if (!Array.isArray(items) || items.length === 0) return { creado: false, mensaje: 'No se ha indicado ningún producto para el presupuesto.' };

  if (proyecto_id) {
    const { data: existente } = await supabase.from('budgets').select('id, budget_number').eq('project_id', proyecto_id).maybeSingle();
    if (existente) {
      return { creado: false, ya_existe: true, budget_number: existente.budget_number, mensaje: `Este proyecto ya tiene el presupuesto ${existente.budget_number}. No se ha creado uno nuevo — hay que añadir partidas desde la sección Presupuestos.` };
    }
  }

  const budget_number = await generateBudgetNumber();
  const { data: budget, error: errBudget } = await supabase
    .from('budgets')
    .insert({
      budget_number,
      status: 'borrador',
      design_fee_type: 'flat',
      design_fee_value: 0,
      design_hours: 0,
      project_id: proyecto_id || null,
      install_shipping_note: 'Instalación, montaje y envío: pendientes de valorar (varían según ciudad, acceso y planta).',
      ...(nombre_presupuesto?.trim() ? { budget_name: nombre_presupuesto.trim() } : {}),
      ...(descuento_global_pct != null && descuento_global_pct !== '' ? { global_discount_pct: Math.max(0, Math.min(100, parseFloat(descuento_global_pct) || 0)) } : {}),
    })
    .select('id, budget_number')
    .single();
  if (errBudget) {
    if (errBudget.code === '23505') return { creado: false, ya_existe: true, mensaje: 'Este proyecto ya tiene presupuesto (creado justo ahora por otra parte) — no se ha duplicado.' };
    return { creado: false, mensaje: 'Error al crear el presupuesto: ' + errBudget.message };
  }

  const insertados = [];
  const noEncontrados = [];
  const sinPrecio = [];
  let displayOrder = 0;
  let totalSinIva = 0;

  for (const it of items) {
    const nombreBuscado = (it.nombre || '').trim();
    if (!nombreBuscado) continue;
    const producto = await buscarProductoPorNombre(nombreBuscado);

    if (!producto) {
      noEncontrados.push(nombreBuscado);
      continue;
    }
    if (producto.price == null) {
      // Sin precio cargado en el catálogo — nunca se añade a un
      // presupuesto real, aunque se haya encontrado el producto.
      sinPrecio.push(producto.name);
      continue;
    }

    const pricing = computeCatalogPricing(producto);
    const cantidad = parseFloat(it.cantidad) || 1;
    const { error: errItem } = await supabase.from('budget_items').insert({
      budget_id: budget.id,
      catalog_product_id: producto.id,
      name: producto.name,
      category: producto.category?.type || 'material',
      quantity: cantidad,
      unit: pricing.unit,
      unit_cost: pricing.unit_cost,
      markup_pct: pricing.markup_pct,
      unit_price: pricing.unit_price,
      pricing_mode: pricing.pricing_mode,
      pvp_ref: pricing.pvp_ref,
      purchase_dto: pricing.purchase_dto,
      display_order: displayOrder++,
      brand: producto.brand || null,
      longitud: producto.longitud || null,
      ancho: producto.ancho || null,
      altura: producto.altura || null,
      color_bastidor: producto.color_bastidor || null,
      color_acolchado: producto.color_acolchado || null,
      tipo_acolchado: producto.tipo_acolchado || null,
      accessories_note: producto.included_accessories || null,
    });
    if (!errItem) { insertados.push(producto.name); totalSinIva += pricing.unit_price * cantidad; }
    else noEncontrados.push(nombreBuscado);
  }

  let pdf_url = null;
  if (insertados.length > 0) {
    pdf_url = await exportarPdfPresupuesto(budget.id);
  }

  const avisoEncontrados = noEncontrados.length
    ? ` Algunos productos no se encontraron en el catálogo con ese nombre exacto y no se añadieron: ${noEncontrados.join(', ')}.`
    : '';
  const avisoSinPrecio = sinPrecio.length
    ? ` Algunos productos no tienen precio cargado en el catálogo, así que NO se han añadido al presupuesto: ${sinPrecio.join(', ')} — hay que ponerles precio en el catálogo primero.`
    : '';
  const avisoPdf = insertados.length > 0
    ? (pdf_url ? ' El PDF ya está generado y guardado.' : ' No se ha podido generar el PDF automáticamente — se puede exportar a mano desde Presupuestos.')
    : '';

  const dtoAplicado = descuento_global_pct != null && descuento_global_pct !== '' ? Math.max(0, Math.min(100, parseFloat(descuento_global_pct) || 0)) : 0;
  const totalSinIvaConDto = totalSinIva * (1 - dtoAplicado / 100);

  return {
    creado: true,
    budget_id: budget.id,
    budget_number: budget.budget_number,
    partidas_creadas: insertados,
    partidas_no_encontradas: noEncontrados,
    partidas_sin_precio: sinPrecio,
    pdf_url,
    // El PDF calcula el IVA como línea aparte sobre la base sin IVA (correcto
    // a nivel de factura) — este total CON IVA es solo para que el asistente
    // lo diga en el chat, nunca hace falta que haga la cuenta él mismo.
    total_con_iva_formateado: insertados.length > 0 ? fmtEurConIva(totalSinIvaConDto) : null,
    mensaje: `Presupuesto ${budget.budget_number} creado correctamente con ${insertados.length} partida(s).${avisoEncontrados}${avisoSinPrecio}${avisoPdf}`,
  };
}

// Llama internamente a POST /api/budgets/:id/export-pdf (con los mismos
// valores por defecto que usaría Víctor al pulsar "PDF cliente") para que el
// presupuesto recién creado por el asistente quede con una copia de PDF ya
// guardada, sin que haga falta entrar a Presupuestos a generarla a mano.
async function exportarPdfPresupuesto(budgetId) {
  try {
    const port = process.env.PORT || 3001;
    const res = await fetch(`http://localhost:${port}/api/budgets/${budgetId}/export-pdf`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${internalAdminToken()}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.pdf_url || null;
  } catch {
    return null;
  }
}

async function aplicarDescuentoPresupuesto({ presupuesto_id, numero_presupuesto, descuento_pct }) {
  if (!presupuesto_id && !numero_presupuesto?.trim()) {
    return { aplicado: false, mensaje: 'Falta el id o el número del presupuesto (ej. RAN-050) — usa buscar_proyecto o el número que se dio al crearlo.' };
  }
  if (descuento_pct == null || descuento_pct === '' || isNaN(parseFloat(descuento_pct))) {
    return { aplicado: false, mensaje: 'Falta el porcentaje de descuento a aplicar.' };
  }
  const pct = Math.max(0, Math.min(100, parseFloat(descuento_pct)));

  let query = supabase.from('budgets').select('id, budget_number');
  query = presupuesto_id ? query.eq('id', presupuesto_id) : query.eq('budget_number', numero_presupuesto.trim());
  const { data: budget, error: errFind } = await query.maybeSingle();
  if (errFind || !budget) return { aplicado: false, mensaje: `No se ha encontrado ningún presupuesto con ese ${presupuesto_id ? 'id' : 'número'}.` };

  const { error: errUpdate } = await supabase.from('budgets').update({ global_discount_pct: pct, updated_at: new Date().toISOString() }).eq('id', budget.id);
  if (errUpdate) return { aplicado: false, mensaje: 'Error al aplicar el descuento: ' + errUpdate.message };

  const pdf_url = await exportarPdfPresupuesto(budget.id);
  return {
    aplicado: true,
    budget_number: budget.budget_number,
    descuento_pct: pct,
    pdf_url,
    mensaje: `Descuento global del ${pct}% aplicado al presupuesto ${budget.budget_number}.${pdf_url ? ' El PDF se ha regenerado con el descuento ya aplicado.' : ' No se ha podido regenerar el PDF automáticamente — se puede volver a exportar desde Presupuestos.'}`,
  };
}

async function runTool(name, input) {
  if (name === 'listar_categorias') return { categorias: await listarCategorias() };
  if (name === 'buscar_productos') return buscarProductos(input.categoria, input.marca);
  if (name === 'leer_pagina_producto') return leerPaginaProducto(input.url);
  if (name === 'crear_producto_catalogo') return crearProductoCatalogo(input);
  if (name === 'aplicar_descuento_presupuesto') return aplicarDescuentoPresupuesto(input);
  if (name === 'buscar_proyecto') return buscarProyecto(input.nombre);
  if (name === 'crear_presupuesto') return crearPresupuesto(input);
  return { error: 'Herramienta desconocida' };
}

/**
 * POST /api/ai-budget/chat
 * Body: { messages: [{ role: 'user'|'assistant', content: string }] }
 * Devuelve la respuesta final del asistente tras resolver, si hace falta,
 * varias vueltas de búsqueda en el catálogo / creación de presupuesto.
 */
router.post('/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages es requerido' });
    }

    const { data: settings } = await supabase.from('settings').select('ai_budget_preferences, ai_reform_rules').eq('id', 1).maybeSingle();
    const prefs = settings?.ai_budget_preferences?.trim();
    const reformRules = settings?.ai_reform_rules?.trim();
    let system = BASE_SYSTEM_PROMPT;
    if (prefs) system += `\n\nPreferencias de selección de producto de Víctor (además de ordenar por precio, ten esto en cuenta al elegir qué producto representa cada nivel):\n${prefs}`;
    if (reformRules) system += `\n\nReglas propias de Ranuse Design sobre reformas y espacio real de uso de los productos (además de tu conocimiento general, ten SIEMPRE esto en cuenta, tanto al responder dudas de reformas/construcción como al valorar si algo encaja en un espacio):\n${reformRules}`;

    // Anthropic espera content como string o array de bloques; los mensajes
    // que llegan del frontend son simples { role, content: string }.
    let conversation = messages.map(m => ({ role: m.role, content: m.content }));

    let lastResponse = null;
    let budgetCreated = null; // último presupuesto creado en esta conversación (si lo hay), con su PDF
    for (let turn = 0; turn < 10; turn++) {
      lastResponse = await callClaude({ system, messages: conversation, tools: TOOLS, maxTokens: 6000 });

      const toolUses = (lastResponse.content || []).filter(b => b.type === 'tool_use');
      if (toolUses.length === 0) break;

      // Añadir el turno del asistente (con sus tool_use) y luego los resultados
      conversation.push({ role: 'assistant', content: lastResponse.content });
      const toolResults = await Promise.all(toolUses.map(async tu => {
        const result = await runTool(tu.name, tu.input);
        if (tu.name === 'crear_presupuesto' && result?.creado) {
          budgetCreated = { budget_id: result.budget_id, budget_number: result.budget_number, pdf_url: result.pdf_url || null };
        }
        return { type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) };
      }));
      conversation.push({ role: 'user', content: toolResults });
    }

    const textBlock = (lastResponse?.content || []).find(b => b.type === 'text');
    res.json({
      reply: textBlock?.text || 'No he podido generar una respuesta.',
      messages: conversation.concat(lastResponse?.content ? [{ role: 'assistant', content: lastResponse.content }] : []),
      budget_created: budgetCreated,
    });
  } catch (error) {
    console.error('Error en asistente de presupuestos:', error);
    res.status(500).json({ error: error.message || 'Error al consultar al asistente' });
  }
});

export default router;
