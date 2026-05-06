import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { spawn } from "node:child_process";
import { mkdtemp, rm, readdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import archiver from "archiver";
import { writeFile } from "node:fs/promises";

// If YT_COOKIES env var is set (Netscape cookies.txt content), write it to disk
// once at startup so yt-dlp can use it. This is the reliable way to bypass
// YouTube's "Sign in to confirm you're not a bot" block on datacenter IPs.
const COOKIES_PATH = "/tmp/yt-cookies.txt";
let cookiesReady = false;
if (process.env.YT_COOKIES && process.env.YT_COOKIES.trim()) {
  try {
    await writeFile(COOKIES_PATH, process.env.YT_COOKIES, "utf8");
    cookiesReady = true;
    console.log("YT_COOKIES loaded into", COOKIES_PATH);
  } catch (e) {
    console.error("Failed to write cookies file:", e);
  }
}

const app = express();
app.use(express.json({ limit: "16kb" }));
app.use(cors({ origin: true }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

const YT_RE =
  /^https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\/.+/i;

const BodySchema = z.object({
  url: z.string().url().regex(YT_RE, "Must be a YouTube URL"),
});

function isPlaylist(url) {
  try {
    const u = new URL(url);
    // Treat as playlist when list= is present (and not just a watch with radio mix RD…)
    const list = u.searchParams.get("list");
    return !!list && !list.startsWith("RD");
  } catch {
    return false;
  }
}

function sanitize(name) {
  return name.replace(/[\\/:*?"<>|\r\n]+/g, "_").slice(0, 180);
}

app.get("/", (_req, res) =>
  res.json({
    ok: true,
    service: "yt-mp3",
    cookiesLoaded: cookiesReady,
    cookiesBytes: process.env.YT_COOKIES ? process.env.YT_COOKIES.length : 0,
  })
);

app.get("/info", async (req, res) => {
  const parsed = BodySchema.safeParse({ url: req.query.url });
  if (!parsed.success) return res.status(400).json({ error: "Invalid URL" });
  const { url } = parsed.data;
  const args = [
    "-J",
    "--flat-playlist",
    "--no-warnings",
    url,
  ];
  const child = spawn("yt-dlp", args);
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d.toString()));
  child.stderr.on("data", (d) => (err += d.toString()));
  child.on("close", (code) => {
    if (code !== 0) {
      return res.status(500).json({ error: err || "yt-dlp failed" });
    }
    try {
      const json = JSON.parse(out);
      const isPl = json._type === "playlist";
      res.json({
        type: isPl ? "playlist" : "video",
        title: json.title,
        count: isPl ? (json.entries?.length ?? 0) : 1,
      });
    } catch (e) {
      res.status(500).json({ error: "Failed to parse yt-dlp output" });
    }
  });
});

app.post("/download", async (req, res) => {
  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { url } = parsed.data;
  const playlist = isPlaylist(url);

  const workDir = await mkdtemp(path.join(tmpdir(), "ytmp3-"));
  const cleanup = () => rm(workDir, { recursive: true, force: true }).catch(() => {});
  res.on("close", cleanup);

  const commonArgs = [
    "-x",
    "--audio-format", "mp3",
    "--audio-quality", "192K",
    "--no-playlist-reverse",
    "--restrict-filenames",
    "--no-warnings",
    "--ignore-errors",
    "--retries", "5",
    "--extractor-retries", "5",
    "--user-agent",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    // Try multiple YouTube clients to bypass bot checks
    "--extractor-args", "youtube:player_client=android,ios,web",
    "--extractor-args", "youtubetab:skip=authcheck",
    "-o", path.join(workDir, "%(title)s [%(id)s].%(ext)s"),
  ];

  if (cookiesReady) {
    commonArgs.push("--cookies", COOKIES_PATH);
  }

  if (!playlist) {
    commonArgs.push("--no-playlist");
  }

  const ytArgs = [...commonArgs, url];

  console.log("yt-dlp", ytArgs.join(" "));
  const child = spawn("yt-dlp", ytArgs);
  let stderr = "";
  child.stderr.on("data", (d) => {
    stderr += d.toString();
    process.stderr.write(d);
  });
  child.stdout.on("data", (d) => process.stdout.write(d));

  child.on("close", async (code) => {
    if (code !== 0) {
      if (!res.headersSent) {
        res.status(500).json({ error: stderr.slice(-2000) || "yt-dlp failed" });
      }
      cleanup();
      return;
    }
    try {
      const files = (await readdir(workDir)).filter((f) => f.endsWith(".mp3"));
      if (files.length === 0) {
        res.status(500).json({ error: "No MP3 produced" });
        cleanup();
        return;
      }

      if (!playlist && files.length === 1) {
        const file = files[0];
        const full = path.join(workDir, file);
        const s = await stat(full);
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Content-Length", s.size);
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${sanitize(file)}"`
        );
        const stream = createReadStream(full);
        stream.on("close", cleanup);
        stream.pipe(res);
      } else {
        res.setHeader("Content-Type", "application/zip");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="playlist.zip"`
        );
        const archive = archiver("zip", { zlib: { level: 6 } });
        archive.on("error", (err) => {
          console.error(err);
          try { res.status(500).end(); } catch {}
          cleanup();
        });
        archive.on("end", cleanup);
        archive.pipe(res);
        for (const f of files) {
          archive.file(path.join(workDir, f), { name: sanitize(f) });
        }
        archive.finalize();
      }
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.status(500).json({ error: String(e) });
      cleanup();
    }
  });
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`yt-mp3 backend on :${port}`));
