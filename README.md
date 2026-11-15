# EXAMEN TEST — versión 1.01

Aplicación estática de exámenes tipo test para GitHub Pages.

## Publicación

1. Descomprime el ZIP y sube **el contenido** de la carpeta a la raíz de un repositorio de GitHub.
2. En Settings → Pages, selecciona Deploy from a branch, `main`, carpeta `/ (root)`.
3. Abre la URL de GitHub Pages. No hace falta servidor ni base de datos.
4. Puedes probar `index.html` directamente en el navegador, sin servidor, o publicar la carpeta en GitHub Pages. También se incluye `EXAMEN_TEST_v1.01_HTML_INDEPENDIENTE.html` para abrir un único archivo.

## Uso

El alumno introduce nombre, apellidos y grupo; lee las instrucciones; empieza el examen de 30 minutos; responde a las 50 preguntas aleatorizadas. Puede recuperar un intento activo en el mismo navegador. Al finalizar, descarga el JSON para el profesor y usa «Guardar como PDF / Imprimir» para seleccionar «Guardar como PDF» en el diálogo del navegador. El profesor importa los JSON desde «Panel del profesor» y exporta un CSV compatible con Excel.

## Banco de preguntas

`data/questions.json` contiene las 50 preguntas originales. `js/questions-embedded.js` es una copia de respaldo para apertura local: si modificas el JSON, actualiza también esta copia para mantener el funcionamiento sin servidor. Cada pregunta tiene `id`, `question`, cuatro `options` con identificadores estables `A` a `D`, y `correctOptionId`. Mantén exactamente 50 entradas y los identificadores únicos. Al actualizar el banco para un examen nuevo, cambia también la versión del proyecto y evita alterar bancos de exámenes activos.

## Privacidad y límites

No se envían respuestas a un servidor. Los datos se guardan en `localStorage` del navegador y pueden perderse al borrar los datos de navegación. El panel docente no tiene autenticación; no es seguro para equipos compartidos. Los archivos JSON son modificables por quien tenga acceso a ellos y no constituyen pruebas inviolables de autoría o calificación. La aplicación puede registrar salidas de pestaña y pantalla completa, pero no puede impedir trampas ni garantizar la vigilancia. El banco y las respuestas correctas son accesibles desde el navegador porque no existe servidor de evaluación.

## PDF

La versión 1.01 utiliza la impresión nativa del navegador: botón «Guardar como PDF / Imprimir», destino «Guardar como PDF». No descarga un PDF directamente sin intervención del navegador.

## Pruebas

Abre `test.html` desde la web para verificar el banco, el algoritmo de mezcla y los ejemplos de puntuación.
