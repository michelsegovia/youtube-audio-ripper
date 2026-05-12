## Plan

1. Ajustar los argumentos de `yt-dlp` en el backend para evitar pedir combinaciones que algunos clientes de YouTube no exponen.
2. Separar correctamente los `--extractor-args` de YouTube y `youtubetab`, porque ahora el segundo `--extractor-args` puede estar pisando o anulando parte de la configuración anterior.
3. Cambiar la estrategia de clientes/formato para priorizar audio descargable compatible, sin excluir HLS/DASH cuando sean la única opción disponible.
4. Mejorar el mensaje de error devuelto si YouTube no ofrece formatos, para que indique si conviene renovar cookies o actualizar el despliegue.

## Detalles técnicos

- Editaré `backend/server.js` en `buildYtArgs`.
- El error actual apunta a que `yt-dlp` llega al vídeo pero no encuentra formatos para el cliente/configuración usada.
- La corrección será backend-only; después tendrás que redeplegar el servicio de Render para que el cambio se aplique.