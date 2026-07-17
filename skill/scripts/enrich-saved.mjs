// save-radar: deterministic enrichment for a saved-posts worklist: download each reel, extract storyboard + hook
// frames + audio, transcribe locally. Self-contained (inlines yt-dlp/ffmpeg calls no external repo
// dependencies). Bakes in the fixes learned the hard way:
//   - IG gates media behind login  -> reads cookies from the debug Chrome profile
//   - whisper can't fetch its model (Python SSL cert chain) -> point SSL_CERT_FILE at certifi AND prefer
//     an already-cached model in ~/.cache/whisper so no download is needed
//   - photo posts have no video    -> detected and marked partial (skipped), not fatal
//   - failed downloads             -> one retry, then marked partial
// Writes per-reel <frames>/<sc>/meta.json {shortcode,durationSec,transcript,partial} and prints a summary.
//
// CLI: node enrich-saved.mjs --worklist=<path> [--frames=<dir>] [--cookies-profile=<name|path>] [--model=<whisper model>]
//   Defaults: frames = <worklist dir>/frames ; cookies = chrome:$HOME/.save-radar-chrome ; model = auto

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, execSync } from "node:child_process";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
}));
const WORKLIST = args.worklist;
if (!WORKLIST || !fs.existsSync(WORKLIST)) { console.error("ERROR: --worklist=<path> required and must exist"); process.exit(1); }
const FRAMES = args.frames || path.join(path.dirname(WORKLIST), "frames");
const COOKIES = args["cookies-profile"] || process.env.SAVE_RADAR_COOKIES_FROM_BROWSER || `chrome:${os.homedir()}/.save-radar-chrome`;

// --- pick a whisper model that is already cached (no network needed) ---------
function pickModel() {
  if (args.model && args.model !== "auto") return String(args.model);
  const cacheDir = path.join(os.homedir(), ".cache", "whisper");
  const prefer = ["base.en", "small.en", "tiny.en", "base", "small", "tiny"];
  try {
    const have = new Set(fs.readdirSync(cacheDir).filter((f) => f.endsWith(".pt")).map((f) => f.replace(/\.pt$/, "")));
    for (const m of prefer) if (have.has(m)) return m;
  } catch {}
  return "base.en"; // will attempt download (SSL_CERT_FILE set below)
}
const MODEL = pickModel();

// certifi cert bundle fixes urllib's "self-signed certificate in chain" on Python 3.12+ if a download is needed
let SSL_CERT_FILE = process.env.SSL_CERT_FILE || "";
if (!SSL_CERT_FILE) {
  for (const py of ["python3", "python"]) {
    try { SSL_CERT_FILE = execFileSync(py, ["-c", "import certifi;print(certifi.where())"]).toString().trim(); break; } catch {}
  }
}
const WHISPER_ENV = { ...process.env, ...(SSL_CERT_FILE ? { SSL_CERT_FILE } : {}) };

// --- frame timecodes (mirror claude-viral-radar's extract-media) --------------
const storyboardTimes = (dur) => [0.05, 0.35, 0.65, 0.92].map((p) => Math.max(1, +(p * dur).toFixed(2)));
const hookTimes = (dur) => [0, 1, 2].filter((t) => t === 0 || t < dur);

function sh(cmd, cmdArgs, opts = {}) { return execFileSync(cmd, cmdArgs, { stdio: ["ignore", "pipe", "pipe"], ...opts }); }

function downloadAndFrames(url, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const video = path.join(dir, "reel.mp4");
  const cookieArgs = COOKIES.includes(":") || COOKIES.includes("/") ? ["--cookies-from-browser", COOKIES] : ["--cookies-from-browser", COOKIES];
  sh("yt-dlp", ["--no-warnings", ...cookieArgs, "-o", video, url], { stdio: "inherit" });
  if (!fs.existsSync(video)) throw new Error("no video produced (likely a photo post)");
  const dur = parseFloat(sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video]).toString().trim());
  if (!Number.isFinite(dur) || dur <= 0) throw new Error("no video duration (not a video post)");
  const grab = (t, f) => sh("ffmpeg", ["-v", "error", "-ss", String(t), "-i", video, "-frames:v", "1", "-vf", "scale=600:-1", "-q:v", "3", f, "-y"]);
  storyboardTimes(dur).forEach((t, i) => grab(t, path.join(dir, `${i + 1}.jpg`)));
  hookTimes(dur).forEach((t, i) => grab(t, path.join(dir, `hook-${i}.jpg`)));
  // audio for transcription
  sh("ffmpeg", ["-v", "error", "-i", video, "-vn", "-acodec", "copy", path.join(dir, "audio.m4a"), "-y"]);
  return Math.round(dur);
}

function transcribe(dir) {
  const audio = path.join(dir, "audio.m4a");
  if (!fs.existsSync(audio)) return "";
  try {
    execFileSync("whisper", [audio, "--model", MODEL, "--language", "en", "--fp16", "False", "--output_format", "txt", "--output_dir", dir],
      { env: WHISPER_ENV, stdio: ["ignore", "ignore", "pipe"] });
  } catch (e) { console.warn(`  whisper failed (${MODEL}): ${String(e.message).slice(0, 120)}`); }
  const txt = path.join(dir, "audio.txt");
  return fs.existsSync(txt) ? fs.readFileSync(txt, "utf8").trim() : "";
}

// --- main --------------------------------------------------------------------
const wl = JSON.parse(fs.readFileSync(WORKLIST, "utf8"));
console.log(`enrich-saved: ${wl.reels.length} reels | model=${MODEL} | cookies=${COOKIES}${SSL_CERT_FILE ? " | ssl=certifi" : ""}`);
const summary = { complete: [], partial: [] };
for (const r of wl.reels) {
  const sc = r.shortcode, dir = path.join(FRAMES, sc);
  const haveFrames = fs.existsSync(path.join(dir, "4.jpg"));
  let dur = 0, partial = false;
  try {
    if (!haveFrames) dur = downloadAndFrames(r.url, dir);
    else dur = Math.round(parseFloat(sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(dir, "reel.mp4")]).toString().trim())) || 0;
  } catch (e1) {
    try { dur = downloadAndFrames(r.url, dir); } // one retry
    catch (e2) { partial = true; console.warn(`  ⚠ ${sc} (${r.handle}) partial: ${e2.message}`); }
  }
  const transcript = partial ? "" : transcribe(dir);
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ shortcode: sc, durationSec: dur, transcript, partial }, null, 2));
  (partial ? summary.partial : summary.complete).push(sc);
  if (!partial) console.log(`  ✓ ${sc} ${r.handle} — ${dur}s, ${transcript.length} transcript chars`);
}
console.log(`\nDONE — ${summary.complete.length} complete, ${summary.partial.length} partial (photo posts / failed): ${summary.partial.join(", ") || "none"}`);
fs.writeFileSync(path.join(path.dirname(WORKLIST), "enrich-summary.json"), JSON.stringify(summary, null, 2));
