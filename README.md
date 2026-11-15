# EXAMEN TEST — Inteligencia Artificial, versión 1.03

Aplicación web de examen local para exámenes locales de 50 preguntas. El alumno se identifica, realiza el test y **descarga un PDF para entregarlo manualmente**. No existe panel del profesor ni envío automático de resultados.


## Cambios de la versión 1.03 (ajuste al temario)

Se han modificado **únicamente** las preguntas originales 15, 29, 31 y 49 para ajustarlas a las presentaciones proporcionadas:

- **15:** el enunciado especifica que se trata de un sistema que aprende de los resultados de sus acciones (en el temario el aprendizaje no está presente en todos los sistemas).
- **29:** se ha eliminado la afirmación no explícita sobre la facilidad de recordar las frases largas.
- **31:** «almacenarlas cifradas» se sustituye por «guardarlas de forma segura», tal como explica el material.
- **49:** se elimina la valoración no cuantificada sobre la cantidad de energía consumida y se mantiene la relación entre actividad digital y sostenibilidad.

Las otras 46 preguntas, las 50 claves correctas y el funcionamiento del examen siguen intactos. Como cambió la versión del almacenamiento local, los intentos iniciados en la v1.02 no se transfieren automáticamente a la v1.03: termina los exámenes en curso antes de actualizar.

## Publicar en GitHub Pages

1. Descomprime el ZIP.
2. En tu repositorio de GitHub, sube **todo su contenido** a la raíz (no subas la carpeta contenedora):
   - `index.html`
   - `test.html`
   - `sw.js`
   - `data/questions.json`
   - `README.md`
3. En **Settings > Pages**, configura la publicación desde la rama `main` y la carpeta `/ (root)` si todavía no está configurada.
4. Abre la URL de Pages del repositorio. Si ya publicaste versiones anteriores, usa **Ctrl + Mayús + R** para forzar la recarga. Si una versión antigua permanece en caché, borra los datos de ese sitio desde el navegador.

### Antes de subirla

El archivo `test.html` es otra copia **completamente funcional** del mismo examen y puede abrirse directamente en Chrome o Edge. También se entrega fuera del ZIP un HTML independiente con el mismo funcionamiento. **Descarga el archivo HTML y ábrelo con Chrome o Edge**: la vista previa de HTML dentro de ChatGPT puede bloquear JavaScript.

## Flujo del alumno

1. Escribe nombre, apellidos y grupo; pulsa **Aceptar**.
2. Lee las instrucciones y pulsa **Comenzar examen**.
3. Resuelve las 50 preguntas en 30 minutos. Cada examen mezcla tanto las preguntas como las cuatro opciones.
4. Elige entre las opciones, navega con Anterior/Siguiente o con la cuadrícula, y usa Borrar respuesta si lo necesitas.
5. Pulsa Finalizar examen en la última pregunta o espera a que el tiempo se agote.
6. Ve la nota y la revisión ordenada 1–50, y pulsa **Descargar PDF**.
7. Envía el PDF al profesor por el canal que este indique; la app nunca envía el archivo.

La nota se calcula: `máximo(0, mínimo(10, aciertos×0,20 − errores×0,05))`, con dos decimales.

## Recuperación

El navegador guarda en almacenamiento local el intento, el orden de las preguntas y opciones, el tiempo de inicio, las respuestas y la última posición. Al volver a abrir el examen en el **mismo navegador, dispositivo y URL**, ofrece continuar. El tiempo no se detiene al cerrar el navegador. Un examen finalizado no se puede volver a editar. Si se borra el almacenamiento del sitio o se usa otro navegador/URL, la recuperación puede perderse.

## PDF

El PDF se genera en el propio navegador, sin librerías externas. Incluye nombre, apellidos, grupo, inicio, finalización, duración, nota, aciertos, fallos, respuestas en blanco, **50 preguntas originales con las cuatro opciones**, respuesta elegida y correcta, y las incidencias de navegación detectadas si existen.

Si el navegador impide la descarga de archivos, usa el botón secundario **Imprimir / guardar PDF** y selecciona la opción *Guardar como PDF* del sistema.

## Editar preguntas

El banco está en `data/questions.json`: 50 preguntas con `id`, `question`, `options` y `correctOptionId`. No cambies los identificadores si necesitas mantener las correspondencias entre preguntas y resultados.

- **En GitHub Pages:** puedes modificar y volver a subir únicamente `data/questions.json`. La aplicación leerá esa versión al abrirse, **sin bloquear nunca la interfaz**; si la lectura no es posible, utiliza su copia incorporada de las 50 preguntas. Los intentos ya empezados guardan una copia del banco correspondiente y no cambian aunque se actualicen las preguntas.
- **HTML descargado / sin conexión:** usa la copia de preguntas integrada. Para distribuir un HTML independiente con preguntas modificadas, también debes regenerar su copia integrada en `index.html`/`test.html` o utilizar GitHub Pages con el JSON editado.

## Privacidad y limitaciones

- No hay Firebase, backend, base de datos de resultados, Google Analytics, registros, correo ni contacto con APIs externas.
- La única comunicación de red necesaria para la versión alojada es **la descarga de archivos estáticos desde GitHub Pages** (HTML, preguntas JSON y Service Worker), como ocurre con cualquier web. **No se envían nombres, respuestas, notas ni PDFs a GitHub mediante la aplicación**.
- La versión HTML descargada puede funcionar sin conexión. En GitHub Pages, el Service Worker guarda recursos públicos para facilitar la apertura sin conexión tras la primera visita.
- La hora del dispositivo y el almacenamiento local pueden ser modificados por un usuario avanzado. Sin un servidor, un examen web no es un sistema antifraude infalible, y las respuestas correctas pueden inspeccionarse en el navegador.

## Archivo de pruebas

`test.html` ejecuta el examen completo y es una copia independiente para probarlo. Se ha verificado en Chromium con carga controlada del HTML: identificación, botón Aceptar, comienzo, 50 preguntas/4 opciones, navegación, recuperación, nota 7,50 para 40 aciertos y 10 errores, fin automático por tiempo, descarga de PDF, revisión ordenada, restauración de resultados y vista móvil. La publicación real en un repositorio de GitHub no se ha verificado desde este entorno.
