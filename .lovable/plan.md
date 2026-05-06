## YouTube → MP3 Downloader

App web para extraer el audio en MP3 de un vídeo de YouTube o de todos los vídeos de una playlist (entregados en un único ZIP), con calidad fija de **192 kbps**.

### Arquitectura

Las Edge Functions de Lovable Cloud (Deno) no pueden ejecutar `yt-dlp` ni `ffmpeg`, así que la conversión se hace en un pequeño servidor self-host que tú desplegarás en Render o Railway. La app de Lovable es el frontend que llama a ese servicio.

```text
[Frontend Lovable]  --HTTPS-->  [Backend self-host (Render/Railway)]
                                      yt-dlp + ffmpeg + Express
                                      └─ devuelve mp3 o zip
```

### 1. Backend self-host (te lo entrego listo para desplegar)

Genero una carpeta `backend/` dentro del proyecto con:

- `server.js` (Node + Express)
  - `POST /download` → recibe `{ url }`. Detecta si es vídeo o playlist.
    - Vídeo único: ejecuta `yt-dlp -x --audio-format mp3 --audio-quality 192K` y hace stream del MP3 como respuesta (`Content-Disposition: attachment`).
    - Playlist: descarga todos los items a un directorio temporal, los empaqueta con `archiver` en un ZIP y lo envía como stream. Limpieza del temporal al terminar.
  - `GET /info` → opcional, devuelve título y nº de vídeos para mostrar antes de descargar.
  - CORS abierto al dominio del frontend.
  - Validación con `zod` de la URL (debe ser youtube.com / youtu.be).
  - Rate limit básico en memoria por IP.
- `Dockerfile` basado en `node:20-slim` que instala `ffmpeg` y `yt-dlp` (vía pip).
- `package.json` con `express`, `archiver`, `zod`, `cors`, `express-rate-limit`.
- `README.md` con instrucciones paso a paso para desplegar en Render (botón "New Web Service" → conectar repo → usar Dockerfile → copiar la URL pública).

Tras desplegar, pegas la URL pública del backend en la app y queda guardada como variable.

### 2. Frontend (Lovable)

Una sola página limpia y enfocada:

- **Header** con título "YouTube to MP3" y subtítulo breve.
- **Input grande** para pegar la URL de YouTube + botón "Descargar MP3".
- Detección automática vídeo vs playlist mirando el parámetro `list=` en la URL.
- Cuando es playlist: aviso "Se ha detectado una playlist con N vídeos. Se descargará un archivo ZIP."
- **Estado de progreso**: spinner + mensajes ("Obteniendo info...", "Convirtiendo audio...", "Preparando ZIP..."). Como el backend hace stream, mostramos un indeterminado más el tamaño descargado en MB cuando esté disponible.
- **Manejo de errores** claros (URL inválida, vídeo privado, backend caído) vía toasts.
- **Configuración**: pequeño icono de ajustes que abre un diálogo donde pegar/editar la URL del backend (guardada en `localStorage`). Mensaje claro si aún no está configurada apuntando al README de despliegue.
- Validación con `zod` de la URL de YouTube antes de enviar.
- Diseño claro, centrado, responsive, usando los componentes shadcn ya disponibles (Card, Input, Button, Dialog, Sonner para toasts).

### 3. Detalles técnicos

- Calidad fija 192 kbps (parámetro `--audio-quality 192K` de yt-dlp).
- Nombre del archivo: `<título>.mp3` o `<título-playlist>.zip`, saneando caracteres no válidos.
- El backend hace streaming (no almacena nada de forma persistente) para que funcione con archivos grandes y planes gratuitos con poco disco.
- El frontend usa `fetch` + `response.blob()` y dispara la descarga creando un `<a download>` temporal.

### 4. Aviso legal

Pequeño texto al pie: "Úsalo solo con contenido para el que tengas derechos. Respeta los Términos de Servicio de YouTube."

### Lo que harás tú una sola vez

1. Crear cuenta gratuita en Render (o Railway).
2. Subir la carpeta `backend/` a un repo de GitHub (te doy los comandos).
3. Desplegar como Docker Web Service.
4. Copiar la URL pública y pegarla en el diálogo de configuración de la app.

A partir de ahí, pegas URLs de YouTube y descargas MP3.