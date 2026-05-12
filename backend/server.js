import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { spawn } from "node:child_process";
import { mkdtemp, rm, readdir, stat, writeFile } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import archiver from "archiver";

// If YT_COOKIES env var is set (Netscape cookies.txt content), write it to disk
// once at startup so yt-dlp can use it.
const COOKIES_PATH = "/tmp/yt-cookies.txt";
let cookiesReady = false;
let cookiesLineCount = 0;
if (process.env.YT_COOKIES && process.env.YT_COOKIES.trim()) {
  try {
    const cookiesText = process.env.YT_COOKIES
      .trim()
      .replace(/^['"]|['"]$/g, "")
      .replace(/\\n/g, "\n");
    cookiesLineCount = cookiesText.split("\n").filter(Boolean).length;
    await writeFile(COOKIES_PATH, cookiesText, "utf8");
    cookiesReady = true;
    console.log("YT_COOKIES loaded into", COOKIES_PATH);
  } catch (e) {
    console.error("Failed to write cookies file:", e);
  }
}

const app = express();
app.use(express.json({ limit: "16kb" }));
app.use(cors({ origin: true, exposedHeaders: ["Content-Disposition"] }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
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
    const list = u.searchParams.get("list");
    return !!list && !list.startsWith("RD");
  } catch {
    return false;
  }
}

function sanitize(name) {
  return name.replace(/[\\/:*?"<>|\r\n]+/g, "_").slice(0, 180);
}

// Strategy presets for yt-dlp. We try them in order; if one fails with
// "Requested format is not available" or similar, we move to the next.
const STRATEGIES = [
  {
    name: "default-audio",
    // No -f: let yt-dlp pick the best audio for -x automatically.
    format: null,
    clients: "tv,ios,web_safari,web",
  },
  {
    name: "bestaudio-or-best",
    format: "bestaudio/best",
    clients: "ios,tv,web_safari,android,web",
  },
  {
    name: "any-format",
    // Allow HLS/DASH/muxed; ffmpeg will extract audio.
    format: "bestaudio*/best",
    clients: "android,ios,tv,web,web_safari,mweb",
  },
];

function buildYtArgs(workDir, url, playlist, strategy = STRATEGIES[0]) {
  const args = [
    "-x",
    "--audio-format", "mp3",
    "--audio-quality", "192K",
    "--no-playlist-reverse",
    "--restrict-filenames",
    "--no-warnings",
    "--retries", "10",
    "--extractor-retries", "10",
    "--fragment-retries", "10",
    "--force-ipv4",
    "--newline",
    "--user-agent",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "--extractor-args",
    `youtube:player_client=${strategy.clients};youtubetab:skip=authcheck`,
    "-o", path.join(workDir, "%(title)s [%(id)s].%(ext)s"),
  ];
  if (strategy.format) {
    args.unshift("-f", strategy.format);
  }
  if (playlist) {
    // For playlists ignore individual video errors so one bad item doesn't
    // kill the whole job.
    args.push("--ignore-errors");
  }
  if (cookiesReady) args.push("--cookies", COOKIES_PATH);
  if (!playlist) args.push("--no-playlist");
  args.push(url);
  return args;
}

function isFormatError(stderr) {
  return /Requested format is not available|No video formats found|Unable to extract|Sign in to confirm/i.test(stderr || "");
}

function runYtDlp(workDir, url, playlist, strategy, onStdout) {
  return new Promise((resolve) => {
    const args = buildYtArgs(workDir, url, playlist, strategy);
    console.log(`yt-dlp [${strategy.name}]`, args.join(" "));
    const child = spawn("yt-dlp", args);
    let stderr = "";
    child.stdout.on("data", (d) => {
      const text = d.toString();
      process.stdout.write(text);
      onStdout?.(text, child);
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
      process.stderr.write(d);
    });
    child.on("error", (e) => resolve({ code: -1, stderr: String(e), child }));
    child.on("close", (code) => resolve({ code, stderr, child }));
  });
}

async function runYtDlpWithFallback(workDir, url, playlist, onStdout) {
  let last = null;
  for (const strategy of STRATEGIES) {
    // Clean previous partial files from earlier strategy attempts.
    try {
      const files = await readdir(workDir);
      await Promise.all(
        files
          .filter((f) => !f.endsWith(".mp3") || last)
          .map((f) => rm(path.join(workDir, f), { force: true }))
      );
    } catch {}
    const result = await runYtDlp(workDir, url, playlist, strategy, onStdout);
    last = { ...result, strategy: strategy.name };
    if (result.code === 0) return last;
    if (!isFormatError(result.stderr)) return last; // non-format error: stop
    console.warn(`Strategy ${strategy.name} failed with format error, trying next...`);
  }
  return last;
}

app.get("/", (_req, res) =>
  res.json({
    ok: true,
    service: "yt-mp3",
    cookiesLoaded: cookiesReady,
    cookiesBytes: process.env.YT_COOKIES ? process.env.YT_COOKIES.length : 0,
    cookiesLines: cookiesLineCount,
  })
);

app.get("/info", async (req, res) => {
  const parsed = BodySchema.safeParse({ url: req.query.url });
  if (!parsed.success) return res.status(400).json({ error: "Invalid URL" });
  const { url } = parsed.data;
  const args = ["-J", "--flat-playlist", "--no-warnings"];
  if (cookiesReady) args.push("--cookies", COOKIES_PATH);
  args.push(url);
  const child = spawn("yt-dlp", args);
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d.toString()));
  child.stderr.on("data", (d) => (err += d.toString()));
  child.on("close", (code) => {
    if (code !== 0) return res.status(500).json({ error: err || "yt-dlp failed" });
    try {
      const json = JSON.parse(out);
      const isPl = json._type === "playlist";
      res.json({
        type: isPl ? "playlist" : "video",
        title: json.title,
        count: isPl ? (json.entries?.length ?? 0) : 1,
      });
    } catch {
      res.status(500).json({ error: "Failed to parse yt-dlp output" });
    }
  });
});

// ============== Async job queue (in-memory) ==============
// jobs: id -> { status, url, workDir, zipPath, title, total, done, error, createdAt, finishedAt }
const jobs = new Map();
const JOB_TTL_MS = 60 * 60 * 1000; // 1h

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    const age = now - (job.finishedAt || job.createdAt);
    if (age > JOB_TTL_MS) {
      rm(job.workDir, { recursive: true, force: true }).catch(() => {});
      jobs.delete(id);
    }
  }
}, 5 * 60 * 1000).unref?.();

async function runPlaylistJob(job) {
  job.status = "processing";

  let timedOut = false;
  let activeChild = null;
  const timeout = setTimeout(() => {
    timedOut = true;
    try { activeChild?.kill("SIGKILL"); } catch {}
    job.error = "Timeout: la playlist tardó demasiado (>25 min).";
  }, 25 * 60 * 1000);

  const onStdout = (text, child) => {
    activeChild = child;
    const lines = text.split("\n");
    for (const line of lines) {
      if (/\[ExtractAudio\] Destination:/.test(line)) {
        job.done = (job.done || 0) + 1;
      }
      const m = /\[download\] Downloading item (\d+) of (\d+)/.exec(line);
      if (m) {
        job.current = parseInt(m[1], 10);
        job.total = parseInt(m[2], 10);
      }
    }
  };

  const result = await runYtDlpWithFallback(job.workDir, job.url, true, onStdout);
  clearTimeout(timeout);

  try {
    const files = (await readdir(job.workDir)).filter((f) => f.endsWith(".mp3"));
    if (files.length === 0) {
      job.status = "failed";
      job.error = job.error || (result?.stderr || "").slice(-2000) || `yt-dlp exit ${result?.code}`;
      job.finishedAt = Date.now();
      return;
    }
    const zipPath = path.join(job.workDir, "playlist.zip");
    await new Promise((resolve, reject) => {
      const output = createWriteStream(zipPath);
      const archive = archiver("zip", { zlib: { level: 6 } });
      output.on("close", resolve);
      archive.on("error", reject);
      archive.pipe(output);
      for (const f of files) {
        archive.file(path.join(job.workDir, f), { name: sanitize(f) });
      }
      archive.finalize();
    });
    job.zipPath = zipPath;
    job.total = job.total || files.length;
    job.done = files.length;
    job.status = "completed";
    job.finishedAt = Date.now();
  } catch (e) {
    job.status = "failed";
    job.error = String(e);
    job.finishedAt = Date.now();
  }
}

app.post("/jobs", async (req, res) => {
  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { url } = parsed.data;
  if (!isPlaylist(url)) return res.status(400).json({ error: "Not a playlist URL" });

  const id = crypto.randomBytes(8).toString("hex");
  const workDir = await mkdtemp(path.join(tmpdir(), `ytmp3-job-${id}-`));
  const job = {
    id,
    url,
    workDir,
    status: "queued",
    total: 0,
    done: 0,
    current: 0,
    createdAt: Date.now(),
  };
  jobs.set(id, job);
  // Fire and forget
  runPlaylistJob(job).catch((e) => {
    job.status = "failed";
    job.error = String(e);
    job.finishedAt = Date.now();
  });
  res.status(202).json({ jobId: id });
});

app.get("/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json({
    id: job.id,
    status: job.status,
    total: job.total,
    done: job.done,
    current: job.current,
    error: job.error,
  });
});

app.get("/jobs/:id/download", async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.status !== "completed" || !job.zipPath) {
    return res.status(409).json({ error: "Job not ready", status: job.status });
  }
  try {
    const s = await stat(job.zipPath);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Length", s.size);
    res.setHeader("Content-Disposition", `attachment; filename="playlist.zip"`);
    createReadStream(job.zipPath).pipe(res);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ============== Single video (sync) ==============
app.post("/download", async (req, res) => {
  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { url } = parsed.data;

  // For playlists, redirect client to async flow
  if (isPlaylist(url)) {
    return res.status(400).json({
      error: "Use /jobs for playlists",
      useAsync: true,
    });
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "ytmp3-"));
  const cleanup = () => rm(workDir, { recursive: true, force: true }).catch(() => {});
  res.on("close", cleanup);

  const ytArgs = buildYtArgs(workDir, url, false);
  console.log("yt-dlp", ytArgs.join(" "));
  const child = spawn("yt-dlp", ytArgs);
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += d.toString(); process.stderr.write(d); });
  child.stdout.on("data", (d) => process.stdout.write(d));

  child.on("close", async (code) => {
    if (code !== 0) {
      if (!res.headersSent) res.status(500).json({ error: stderr.slice(-2000) || "yt-dlp failed" });
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
      const file = files[0];
      const full = path.join(workDir, file);
      const s = await stat(full);
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Length", s.size);
      res.setHeader("Content-Disposition", `attachment; filename="${sanitize(file)}"`);
      const stream = createReadStream(full);
      stream.on("close", cleanup);
      stream.pipe(res);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.status(500).json({ error: String(e) });
      cleanup();
    }
  });
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`yt-mp3 backend on :${port}`));
