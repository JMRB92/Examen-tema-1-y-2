# Aplicación Web de Exámenes Tipo Test (50 Preguntas)

Aplicación web educativa estática, sin backend ni dependencias externas, diseñada para realizar exámenes tipo test de 50 preguntas con aleatorización independiente de preguntas y opciones, temporizador real de 30 minutos, recuperación ante cierres accidentales, generación local de informes PDF y Panel del Profesor con importación múltiple y exportación a Excel (CSV).

---

## Características principales

- **100 % estática y sin dependencias externas**: desarrollada con HTML5, CSS3 y JavaScript modular (ES Modules) sin CDNs ni servidores externos.
- **Funcionamiento sin conexión (Offline / PWA)**: incluye `manifest.json` y un Service Worker (`sw.js`) que almacena en caché todos los recursos tras la primera visita.
- **Aleatorización con trazabilidad de identificadores**:
  - Mezcla imparcial (Fisher-Yates con Web Crypto) de las 50 preguntas en cada intento.
  - Mezcla independiente de las 4 opciones (`A`, `B`, `C`, `D`) vinculada al identificador único original de cada opción (`correctOptionId`).
  - Reconstrucción automática del orden original (`1` a `50` y opciones `A` a `D`) en la pantalla de resultados y en el documento PDF.
- **Temporizador basado en reloj real y recuperación de sesión**:
  - Duración de 30 minutos que empieza a contar al iniciar la primera pregunta.
  - No se reinicia al actualizar o cerrar el navegador; al volver a abrir la página permite continuar exactamente donde se dejó o finaliza automáticamente si el tiempo expiró.
- **Evaluación reglamentaria**:
  - Acierto: `+0,20` puntos | Error: `−0,05` puntos | Sin contestar: `0` puntos | Nota acotada entre `0` y `10` con 2 decimales.
- **Generación local de PDF multipágina (`js/pdf.js`)**:
  - Crea directamente un archivo `.pdf` formal (`Examen_Nombre_Apellidos_Grupo_Fecha.pdf`) sin enviar datos fuera del navegador y evitando que ninguna pregunta quede dividida entre dos páginas.
- **Panel del Profesor (`js/teacher.js`)**:
  - Importación simultánea de múltiples archivos `.json` descargados por el alumnado.
  - Detección automática de intentos duplicados mediante `attemptId`.
  - Ordenación por nombre, grupo, fecha o nota, búsqueda rápida, revisión detallada de cada alumno y exportación a CSV compatible con Excel.

---

## Estructura del proyecto

```text
EXAMEN-TEST/
│
├── index.html          # Interfaz principal (alumno y panel del profesor)
├── test.html           # Suite de pruebas funcionales automatizadas
├── manifest.json       # Manifiesto de aplicación web progresiva (PWA)
├── sw.js               # Service Worker para funcionamiento sin conexión
├── README.md           # Documentación del proyecto
│
├── css/
│   └── styles.css      # Estilos responsivos y accesibles
│
├── js/
│   ├── app.js          # Controlador principal de vistas y eventos
│   ├── exam.js         # Lógica del examen, temporizador real y navegación
│   ├── questions.js    # Carga, validación y aleatorización de preguntas/opciones
│   ├── results.js      # Cálculo de notas, ordenación original y descarga JSON
│   ├── storage.js      # Gestión de localStorage y recuperación de intentos
│   ├── pdf.js          # Generador autónomo de documentos PDF 1.4 multipágina
│   └── teacher.js      # Importación JSON, deduplicación, tabla y exportación CSV
│
├── data/
│   └── questions.json  # Banco de 50 preguntas separado del código
│
└── assets/
    ├── logo.png
    └── icons/
        ├── icon-192.png
        └── icon-512.png
```

---

## Instalación local y publicación en GitHub Pages

### 1. Prueba en entorno local
Al utilizar módulos ES (`type="module"`) y `fetch('./data/questions.json')`, los navegadores modernos requieren servir la carpeta mediante HTTP (no mediante doble clic `file://`). Puedes iniciarla localmente en segundos con cualquiera de estas opciones:

```bash
# Con Python 3
cd EXAMEN-TEST
python3 -m http.server 8080
```
Abre `http://localhost:8080` en tu navegador (y `http://localhost:8080/test.html` para ejecutar las pruebas funcionales).

### 2. Subida a GitHub y publicación en GitHub Pages

1. Crea un repositorio nuevo en GitHub (por ejemplo, `examen-test`).
2. Inicializa Git dentro de la carpeta `EXAMEN-TEST` y sube los archivos:

```bash
cd EXAMEN-TEST
git init
git add .
git commit -m "Versión inicial de la aplicación de exámenes tipo test"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/examen-test.git
git push -u origin main
```

3. En GitHub, entra en **Settings → Pages**.
4. En **Build and deployment → Source**, selecciona **Deploy from a branch**.
5. Elige la rama `main` y la carpeta `/ (root)`, y pulsa **Save**.
6. En unos instantes tu aplicación estará disponible en `https://TU-USUARIO.github.io/examen-test/`.

---

## Mantenimiento del banco de preguntas (`data/questions.json`)

El banco de preguntas es completamente independiente del código JavaScript. Cada objeto dentro de `data/questions.json` sigue esta estructura:

```json
{
  "id": 1,
  "question": "Enunciado de la pregunta",
  "options": [
    { "id": "A", "text": "Texto de la opción A" },
    { "id": "B", "text": "Texto de la opción B" },
    { "id": "C", "text": "Texto de la opción C" },
    { "id": "D", "text": "Texto de la opción D" }
  ],
  "correctOptionId": "B"
}
```

- **Modificar una pregunta o sus opciones**: edita directamente el campo `"question"`, el `"text"` de las opciones o `"correctOptionId"` en `data/questions.json` manteniendo intactos los identificadores `"id"`.
- **Añadir o eliminar preguntas**: la aplicación valida al arrancar que existan **exactamente 50 preguntas** con identificadores únicos y 4 opciones válidas cada una. Si sustituyes preguntas, asegúrate de mantener el total en 50 (o actualiza la constante `EXPECTED_QUESTION_COUNT` en `js/questions.js` si deseas cambiar el número total de preguntas del examen).

---

## Flujo de trabajo del profesor

1. Al terminar el examen, cada alumno pulsa **«Descargar resultados en PDF»** y **«Descargar archivo JSON (para el profesor)»**.
2. El profesor abre la aplicación, pulsa **«Panel del profesor»** en la barra superior y selecciona o arrastra todos los archivos `.json` entregados por el grupo.
3. El panel importa los resultados válidos, descarta automáticamente cualquier intento duplicado (`attemptId`), permite ordenar por nombre, grupo, fecha o nota, revisar las 50 preguntas de cada alumno y pulsar **«Exportar a CSV (Excel)»** para obtener la hoja de calificaciones.

---

## Privacidad y limitaciones del almacenamiento local

- La aplicación **no envía datos a ningún servidor**, no usa analítica, cookies de seguimiento ni servicios de IA externos.
- Toda la información (examen en curso del alumno y resultados importados por el profesor) se guarda exclusivamente en `localStorage` del navegador. Si se borra la caché o los datos del sitio, se perderán los registros locales, por lo que se recomienda descargar siempre los archivos **PDF**, **JSON** y **CSV**.
- **Nota técnica de transparencia**: al tratarse de una aplicación web estática ejecutada íntegramente en el navegador sin servidor backend, el archivo `data/questions.json` debe descargarse en el dispositivo del usuario para corregir el examen. Por ello, este sistema está concebido para entornos educativos supervisados y autoevaluación, y no puede impedir que un usuario con conocimientos técnicos inspeccione los archivos estáticos descargados por el navegador.

---

## Historial de versiones

- **Versión 1.01**:
  - Añadida autenticación por usuario y contraseña (`jmramirezb03` / `123456789`) y cierre de sesión para acceder al **Panel del profesor**.
  - Compatibilidad dual garantizada tanto en servidores web / GitHub Pages (`https://`) como mediante apertura directa desde archivo local (`file://`) gracias al respaldo sincronizado `data/questions-fallback.js` y `js/app-standalone.js`.
  - Indicador de **Versión 1.01** visible en el pie de página de la aplicación.
- **Versión 1.00**:
  - Lanzamiento inicial de la aplicación de exámenes tipo test de 50 preguntas con temporizador real de 30 minutos, recuperación tras recarga, generación local de PDF y panel docente con exportación a CSV.
