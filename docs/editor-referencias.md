# Editor de vídeo: coherencia y referencias visuales

## Cambios
- Tres formatos/estilos nuevos: entrevista limpia, explicación visual y recorrido de proyecto.
- Migración única que desactiva flashes en formatos y estilos existentes, conservando las demás personalizaciones.
- Un estilo elegido explícitamente prevalece sobre la receta automática de redes.
- Efectos sobrios restringidos por código; destellos opcionales separados al menos diez segundos.
- Clips: conserva preguntas de seguimiento, no trunca conclusiones para cumplir una duración, rechaza clips incompletos/no verificados y vuelve a revisar una corrección.
- Los clips seleccionados no pasan por una segunda reordenación del gancho o limpieza semántica automática.
- Recursos subidos incorporados al catálogo del montador de entrevistas. PNG conserva transparencia.
- Superposición a pantalla completa o ventana inferior manteniendo al presentador. No incluye recorte automático de fondos; usar PNG ya transparente para objetos recortados.
- La crítica visual no infiere cortes, problemas de audio o incoherencia hablada a partir de doce fotogramas.

## Validación
- `npm run build`: correcto; advertencia de tamaño de bundles.
- `node --test tests/editor-video.test.mjs`: cinco pruebas sin servicios externos, más una integración FFmpeg cuando se define EDITOR_TEST_FFMPEG.
- Prueba sintética real: FFmpeg genera ambas composiciones y verifica colocación y tiempos. PNG transparente inspeccionado visualmente.
- Sintaxis de módulos y `git diff --check`: correctos.

## Activación y límites
Actualizar frontend, backend y el trabajador de vídeo (Cloud Run Job o PC) con la misma revisión. La migración se aplica al cargar formatos/estilos; los vídeos ya exportados no cambian. Seleccionar uno de los nuevos estilos y generar una nueva versión con material real para validar calidad editorial, subtítulos y encuadre.

No se han ejecutado llamadas de IA de pago ni trabajos de producción. No se ha implementado todavía el montaje largo de YouTube con varios vídeos: este cambio corrige y amplía la edición de clips y los estilos aprobados.

Referencias aportadas: DeHzDyrtDA7, DezotWJtzJf, DfpxOuVKJJP, DefGp9TKpAO, DeupvwrqmRD, DQwjlMeCL3V, Dc6dMZnvxDE. Se observaron fragmentos visuales; no se afirma haber medido su montaje o audio completos.
