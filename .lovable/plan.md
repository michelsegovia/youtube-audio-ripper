## Plan

1. **Cambiar la estrategia de descarga para este vídeo y casos similares**
   - Dejar de forzar un selector manual propenso a fallar.
   - Usar la selección nativa de `yt-dlp` para extraer audio (`-x`) y convertir a MP3, que suele escoger automáticamente el mejor stream disponible.
   - Mantener un selector de fallback solo si hace falta, pero no como primera opción.

2. **Separar la detección del error de formatos**
   - Si `yt-dlp` devuelve `Requested format is not available`, hacer un segundo intento automático con una configuración más abierta.
   - En ese segundo intento, permitir formatos HLS/DASH/muxed si son lo único disponible.
   - Evitar que el usuario reciba el fallo en el primer intento cuando aún hay alternativas.

3. **Revisar los clientes de YouTube usados por `yt-dlp`**
   - Simplificar `--extractor-args` para no combinar clientes que pueden ocultar formatos en algunos vídeos.
   - Priorizar clientes más estables para servidores como Render.
   - Mantener cookies si están configuradas, pero no hacer que la descarga dependa de ellas.

4. **Mejorar el diagnóstico devuelto por el backend**
   - Cuando falle, devolver si hay cookies cargadas y un mensaje más útil.
   - Indicar claramente si el backend desplegado probablemente no está actualizado o si YouTube no está entregando formatos desde Render.

5. **Aplicar el mismo patrón a vídeo único y playlists**
   - Reutilizar la misma función de descarga/fallback en `/download` y en los jobs de playlist para evitar que una ruta quede arreglada y la otra no.

## Detalles técnicos

- El cambio principal será en `backend/server.js`.
- Sustituiré `buildYtArgs` por una función que pueda generar argumentos por estrategia: intento principal y fallback.
- En `/download`, si el primer proceso de `yt-dlp` falla con error de formato, se limpiarán los archivos parciales y se lanzará un segundo proceso.
- En `runPlaylistJob`, se aplicará la misma lógica para no dejar el job atascado por el primer selector.
- No tocaré la interfaz salvo que sea imprescindible para mostrar el nuevo mensaje de error.

Después de implementarlo, tendrás que hacer redeploy del backend en Render para que el servicio público use el cambio.