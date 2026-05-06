# YouTube → MP3 Backend

Pequeño servidor Node + Express que usa `yt-dlp` y `ffmpeg` para extraer audio MP3 (192 kbps) de un vídeo o de una playlist completa de YouTube (devuelta como ZIP).

Pensado para desplegar en **Render** o **Railway** con Docker.

## Endpoints

- `GET /` → health check.
- `GET /info?url=…` → devuelve `{ type: "video"|"playlist", title, count }`.
- `POST /download` body `{ "url": "https://youtube.com/..." }`
  - Vídeo único → responde con el MP3 (`audio/mpeg`).
  - Playlist (URL con `list=`) → responde con un ZIP de todos los MP3.

Calidad fija: **192 kbps**. Streaming, sin almacenamiento persistente.
Rate limit: 10 peticiones / minuto / IP.

## Probar en local

Necesitas Docker:

```bash
cd backend
docker build -t yt-mp3 .
docker run --rm -p 8080:8080 yt-mp3
# en otra terminal
curl -X POST http://localhost:8080/download \
  -H 'content-type: application/json' \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}' \
  -o test.mp3
```

## Desplegar en Render (recomendado, plan gratuito disponible)

1. Sube esta carpeta `backend/` a un repo nuevo de GitHub:
   ```bash
   cd backend
   git init && git add . && git commit -m "init"
   git branch -M main
   git remote add origin git@github.com:TU_USUARIO/yt-mp3-backend.git
   git push -u origin main
   ```
2. Entra en https://render.com → **New +** → **Web Service**.
3. Conecta el repo. En la configuración:
   - **Runtime**: Docker
   - **Region**: la que prefieras
   - **Instance Type**: Free (o Starter para más RAM/CPU)
4. Pulsa **Create Web Service** y espera al primer build (5–10 min).
5. Copia la URL pública (algo como `https://yt-mp3-backend.onrender.com`).
6. Pégala en la app de Lovable: icono ⚙️ → "URL del backend".

> El plan gratuito de Render duerme el servicio tras inactividad: la primera descarga tras un rato puede tardar ~30 s en arrancar.

## Desplegar en Railway

1. Sube el repo igual que arriba.
2. https://railway.app → **New Project** → **Deploy from GitHub Repo**.
3. Railway detecta el `Dockerfile` automáticamente. Pulsa **Deploy**.
4. En **Settings → Networking** genera un **Public Domain** y copia la URL.
5. Pégala en la app de Lovable.

## ⚠️ Bloqueo "Sign in to confirm you're not a bot"

YouTube bloquea peticiones desde IPs de datacenter (Render, Railway…) pidiendo login. El backend ya intenta esquivarlo usando los clientes `android`/`ios` y reintentos, pero **si el bloqueo persiste, la única solución fiable es pasar tus cookies de YouTube**:

1. En tu navegador (logueado en YouTube), instala la extensión **"Get cookies.txt LOCALLY"** (Chrome/Firefox).
2. Abre `youtube.com`, pulsa la extensión y exporta como **Netscape format**. Te baja un `cookies.txt`.
3. Abre el archivo, copia **todo** su contenido.
4. En Render: tu servicio → **Environment** → **Add Environment Variable**:
   - Key: `YT_COOKIES`
   - Value: pega el contenido completo del `cookies.txt`
5. **Save Changes** (redeploya solo).

Recomendación: usa una **cuenta de Google secundaria** (no la principal) para generar las cookies, porque YouTube podría marcarla.

Las cookies caducan cada cierto tiempo (semanas/meses); si vuelves a ver el error, regenéralas.

## Notas legales

Úsalo solo con contenido para el que tengas derechos. Respeta los Términos de Servicio de YouTube.
