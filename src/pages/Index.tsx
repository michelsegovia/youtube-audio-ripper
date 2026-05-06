import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  Download,
  Loader2,
  Music2,
  Settings2,
  ListMusic,
  Youtube,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

const YT_RE =
  /^https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\/.+/i;

const urlSchema = z
  .string()
  .trim()
  .url("Introduce una URL válida")
  .regex(YT_RE, "Tiene que ser una URL de YouTube");

function detectPlaylist(raw: string): boolean {
  try {
    const u = new URL(raw);
    const list = u.searchParams.get("list");
    return !!list && !list.startsWith("RD");
  } catch {
    return false;
  }
}

function filenameFromHeader(header: string | null, fallback: string) {
  if (!header) return fallback;
  const m =
    /filename\*=UTF-8''([^;]+)/i.exec(header) ||
    /filename="?([^";]+)"?/i.exec(header);
  if (!m) return fallback;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

const STORAGE_KEY = "ytmp3.backendUrl";

const Index = () => {
  const [backendUrl, setBackendUrl] = useState<string>("");
  const [draftBackendUrl, setDraftBackendUrl] = useState<string>("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [downloadedMb, setDownloadedMb] = useState<number>(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) ?? "";
    setBackendUrl(saved);
    setDraftBackendUrl(saved);
    if (!saved) setSettingsOpen(true);
  }, []);

  const isPlaylist = useMemo(() => detectPlaylist(url), [url]);

  const saveBackend = () => {
    const trimmed = draftBackendUrl.trim().replace(/\/$/, "");
    if (trimmed && !/^https?:\/\//i.test(trimmed)) {
      toast.error("La URL del backend debe empezar por http(s)://");
      return;
    }
    localStorage.setItem(STORAGE_KEY, trimmed);
    setBackendUrl(trimmed);
    setSettingsOpen(false);
    toast.success("Backend guardado");
  };

  const handleDownload = async () => {
    const parsed = urlSchema.safeParse(url);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    if (!backendUrl) {
      toast.error("Configura primero la URL del backend");
      setSettingsOpen(true);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setDownloadedMb(0);
    setStatus(
      isPlaylist
        ? "Procesando playlist (esto puede tardar varios minutos)..."
        : "Convirtiendo a MP3..."
    );

    try {
      const res = await fetch(`${backendUrl}/download`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: parsed.data }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Error del backend (${res.status})`);
      }

      const fallback = isPlaylist ? "playlist.zip" : "audio.mp3";
      const filename = filenameFromHeader(
        res.headers.get("content-disposition"),
        fallback
      );

      // Stream to track downloaded size
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.length;
          setDownloadedMb(received / (1024 * 1024));
        }
      }

      const blob = new Blob(chunks as BlobPart[], {
        type: res.headers.get("content-type") ?? "application/octet-stream",
      });
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);

      toast.success(`Descargado: ${filename}`);
      setStatus("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (controller.signal.aborted) {
        toast.info("Descarga cancelada");
      } else {
        toast.error(msg.slice(0, 300));
      }
      setStatus("");
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const cancel = () => abortRef.current?.abort();

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="w-full px-6 py-5 flex items-center justify-between border-b border-border/40">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center text-primary-foreground">
            <Music2 className="w-5 h-5" strokeWidth={2.5} />
          </div>
          <span className="font-semibold tracking-tight text-lg">
            Tubo<span className="text-primary">.mp3</span>
          </span>
        </div>
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Ajustes">
              <Settings2 className="w-5 h-5" />
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader>
              <DialogTitle>URL del backend</DialogTitle>
              <DialogDescription>
                Pega aquí la URL pública de tu servicio de conversión
                (Render / Railway). Se guarda solo en este navegador.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <Label htmlFor="backend">URL</Label>
              <Input
                id="backend"
                placeholder="https://tu-servicio.onrender.com"
                value={draftBackendUrl}
                onChange={(e) => setDraftBackendUrl(e.target.value)}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground pt-1">
                ¿Sin backend? Sigue las instrucciones del{" "}
                <span className="font-mono text-primary">backend/README.md</span>{" "}
                para desplegarlo en pocos minutos.
              </p>
            </div>
            <DialogFooter>
              <Button onClick={saveBackend}>Guardar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </header>

      {/* Main */}
      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-2xl">
          <div className="mb-10 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary border border-border text-xs font-mono text-muted-foreground mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              MP3 · 192 kbps
            </div>
            <h1 className="text-5xl md:text-6xl font-bold tracking-tight leading-[1.05]">
              Convierte YouTube
              <br />
              en{" "}
              <span className="text-primary [text-shadow:0_0_40px_hsl(var(--primary)/0.5)]">
                audio puro.
              </span>
            </h1>
            <p className="text-muted-foreground mt-5 text-lg max-w-md mx-auto">
              Pega un vídeo o una playlist. Te devolvemos el MP3 (o un ZIP con
              todos).
            </p>
          </div>

          <div className="bg-card border border-border rounded-2xl p-2 shadow-2xl">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1 flex items-center gap-2 px-4 bg-secondary rounded-xl">
                <Youtube className="w-5 h-5 text-muted-foreground shrink-0" />
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !loading && handleDownload()}
                  placeholder="https://www.youtube.com/watch?v=..."
                  disabled={loading}
                  className="border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 px-0 font-mono text-sm h-12"
                />
              </div>
              {loading ? (
                <Button
                  variant="destructive"
                  className="h-12 px-6 rounded-xl"
                  onClick={cancel}
                >
                  Cancelar
                </Button>
              ) : (
                <Button
                  onClick={handleDownload}
                  className="h-12 px-6 rounded-xl font-semibold shadow-[var(--shadow-glow)] hover:opacity-90"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Descargar
                </Button>
              )}
            </div>
          </div>

          {/* Hints / status */}
          <div className="mt-5 min-h-[3rem]">
            {url && !loading && (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                {isPlaylist ? (
                  <>
                    <ListMusic className="w-4 h-4 text-accent" />
                    <span>
                      Playlist detectada — recibirás un{" "}
                      <span className="font-mono text-foreground">.zip</span>
                    </span>
                  </>
                ) : (
                  <>
                    <Music2 className="w-4 h-4 text-primary" />
                    <span>
                      Vídeo único — recibirás un{" "}
                      <span className="font-mono text-foreground">.mp3</span>
                    </span>
                  </>
                )}
              </div>
            )}
            {loading && (
              <div className="flex flex-col items-center gap-2 text-sm">
                <div className="flex items-center gap-2 text-foreground">
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  <span>{status}</span>
                </div>
                {downloadedMb > 0 && (
                  <span className="font-mono text-xs text-muted-foreground">
                    Descargado: {downloadedMb.toFixed(1)} MB
                  </span>
                )}
              </div>
            )}
          </div>

          {!backendUrl && (
            <div className="mt-8 p-4 rounded-xl border border-accent/40 bg-accent/5 text-sm">
              <p className="font-medium mb-1">⚠️ Backend no configurado</p>
              <p className="text-muted-foreground">
                Esta app necesita un pequeño servicio que ejecute la conversión
                (yt-dlp + ffmpeg). Mira las instrucciones en{" "}
                <span className="font-mono text-foreground">
                  backend/README.md
                </span>{" "}
                y luego pega su URL en{" "}
                <button
                  className="underline underline-offset-2 text-primary"
                  onClick={() => setSettingsOpen(true)}
                >
                  Ajustes
                </button>
                .
              </p>
            </div>
          )}
        </div>
      </main>

      <footer className="px-6 py-6 text-center text-xs text-muted-foreground border-t border-border/40">
        <p>
          Úsalo solo con contenido para el que tengas derechos. Respeta los{" "}
          <a
            className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
            href="https://www.youtube.com/t/terms"
            target="_blank"
            rel="noreferrer"
          >
            Términos de YouTube
            <ExternalLink className="w-3 h-3" />
          </a>
          .
        </p>
      </footer>
    </div>
  );
};

export default Index;
