# Actualizar el dashboard de la Polla NFL

Carpeta: `C:\Claude local\Polla NFL` (repo git `eskenazi2009/polla-nfl`, rama `main`)
Página publicada (GitHub Pages): https://eskenazi2009.github.io/polla-nfl/

Todo es de solo lectura sobre Splash Sports: no hacer clic en nada de la página,
no cambiar piques, no escribir usuarios ni contraseñas, no cerrar sesión.

CUENTA POR DEFECTO: **Kvetchers** (tonye@lafayettezl.com). Las tareas corren con la
sesión que esté activa en el navegador integrado; el dueño la deja en Kvetchers.
- Con Kvetchers se leen: la Polla (pick'em), Super Survivor y Homicida — incluido el
  "más escogidos" de ambos survivor.
- KIBBEH solo está en la Polla y en Homicida (no en Super Survivor). Sus entradas de
  Homicida ya están guardadas; build.py NO las borra al correr con Kvetchers (mezcla
  por cuenta). Solo hay que volver a correr con KIBBEH si cambian sus piques.

## Pasos

1. Cargar las herramientas del navegador integrado con ToolSearch
   (`query: "mcp__Claude_Browser__", max_results: 64`).
2. Correr `git pull --ff-only` y luego `python build.py --skip` en la carpeta. Este
   último imprime un arreglo JSON con las semanas ya guardadas, por ejemplo
   `["Week 1", "Week 2"]`.
3. Abrir la polla en el navegador integrado con `preview_start` y esta url:
   `https://contests.app.splashsports.com/team-pickem/contests/contest_01KZPQ5VY6JW7J8MD54KDN44M1`
   Esperar 5 segundos (la página renueva la sesión al cargar).
4. Leer `extract.js` y ejecutarlo con `javascript_tool` en esa pestaña, con este texto:
   `window.POLLA_SKIP = <arreglo del paso 2>; await <contenido completo de extract.js>`
   El resultado es un texto JSON.
5. Si el JSON trae `"error"` (por ejemplo `NOT_LOGGED_IN` o `AUTH 401`), no tocar
   ningún archivo. Terminar diciendo: "La sesión de Splash en el navegador integrado
   expiró. Abre el navegador (Ctrl+Shift+B), inicia sesión en Splash con cualquiera
   de tus dos cuentas y vuelve a correr la tarea."
6. Si no hay error, escribir el JSON tal cual en `data/snapshot.json`.
7. Correr `python build.py`. Debe imprimir una línea que empieza con `OK`.
8. Subir a GitHub:
   `git add index.html data/store.json data/snapshot.json`
   `git commit -m "Actualizar datos <fecha y hora de Panamá>"` (si no hay cambios, seguir)
   `git push origin main`
   GitHub Pages publica la página sola en uno o dos minutos.
9. Terminar con un resumen de una o dos líneas: puesto y récord de Kvetchers y
   KIBBEH, y cómo van en la semana en curso.
