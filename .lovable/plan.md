## Plan

1. Cambiar la descarga de playlists a modo asíncrono
   - `POST /download` seguirá funcionando para vídeos únicos.
   - Para playlists, el backend devolverá rápido un `202 Accepted` con un `jobId` en vez de dejar el navegador esperando hasta que termine todo.

2. Añadir endpoints de estado y descarga final
   - `GET /jobs/:jobId` devolverá estado: `queued`, `processing`, `completed` o `failed`, además de progreso básico y error si falla.
   - `GET /jobs/:jobId/download` entregará el `.zip` cuando esté listo.
   - El backend guardará temporalmente los MP3/ZIP en `/tmp` y limpiará trabajos antiguos.

3. Ejecutar `yt-dlp` en segundo plano para playlists
   - Mantener cookies y argumentos actuales.
   - Capturar salida/errores de `yt-dlp` para actualizar el estado.
   - Evitar que una playlist se quede “infinita” añadiendo timeout razonable y error claro si YouTube/hosting corta el proceso.

4. Actualizar la app para hacer polling
   - Si el backend responde `202`, la interfaz cambiará de “Procesando playlist...” a mensajes de estado actualizados.
   - Cuando el ZIP esté listo, la app descargará automáticamente desde `/jobs/:jobId/download`.
   - Si falla, mostrará el error real en vez de quedarse esperando.

5. Mantener compatibilidad
   - Vídeos individuales seguirán descargándose como ahora.
   - Las URLs de backend guardadas por el usuario no cambiarán.

## Detalles técnicos

- Archivos principales: `backend/server.js` y `src/pages/Index.tsx`.
- No hace falta base de datos para esta corrección: para Render/Railway basta una cola en memoria porque el trabajo vive dentro del mismo proceso Node.
- Esto ataca el síntoma actual: el navegador está esperando una respuesta larga de `/download` sin recibir progreso ni error útil.

<lov-actions>
<lov-link url="https://docs.lovable.dev/tips-tricks/troubleshooting">Troubleshooting docs</lov-link>
</lov-actions>