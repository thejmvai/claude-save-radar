// save-radar CSV logger — the running log of every Instagram post you save.
// Two modes:
//
//   append — read one or more scrape worklists, compare against the CSV, append ONLY the
//            posts not logged yet, and write a merged "new-worklist.json" containing just
//            those new posts (the incremental input for enrich + breakdown).
//     node log-csv.mjs append --csv=<saved-posts.csv> --worklist=<p1,p2,...> --new-out=<new-worklist.json>
//     Prints "NEW=<n>" on the last line (the nightly runner reads this).
//
//   update — after the breakdown step, copy each reel's analysis (hook type, hook, format,
//            why it works, duration) from the swipe dataset into the matching CSV rows.
//     node log-csv.mjs update --csv=<saved-posts.csv> --swipe=<swipe-saved.json>
//
// The CSV is append-only in `append` mode (safe to open in Excel/Numbers/Sheets between runs)
// and fully rewritten in `update` mode (same rows, richer columns).

import fs from "node:fs";
import path from "node:path";

const HEADER = [
  "logged_at", "collection", "shortcode", "post_type", "url", "creator_handle",
  "likes", "comments", "duration_sec", "hook_type", "hook", "format", "why_it_works", "status",
];

const args = Object.fromEntries(process.argv.slice(3).map((a) => {
  const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
}));
const MODE = process.argv[2];
const CSV = args.csv;
if (!MODE || !["append", "update"].includes(MODE) || !CSV) {
  console.error("usage: node log-csv.mjs append --csv=<path> --worklist=<p1,p2,...> --new-out=<path>\n" +
                "       node log-csv.mjs update --csv=<path> --swipe=<swipe-saved.json>");
  process.exit(1);
}

// --- minimal CSV read/write (handles quoted fields with commas/quotes/newlines) ---
const escCell = (v) => {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toLine = (row) => HEADER.map((h) => escCell(row[h])).join(",");

function parseCsv(text) {
  const rows = []; let cur = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { cur.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      cur.push(cell); if (cur.some((x) => x !== "")) rows.push(cur); cur = []; cell = "";
    } else cell += c;
  }
  cur.push(cell); if (cur.some((x) => x !== "")) rows.push(cur);
  return rows;
}

function readCsvRows() {
  if (!fs.existsSync(CSV)) return [];
  const rows = parseCsv(fs.readFileSync(CSV, "utf8"));
  if (!rows.length) return [];
  const head = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

// --- append mode -------------------------------------------------------------
if (MODE === "append") {
  const lists = String(args.worklist || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!lists.length) { console.error("ERROR: --worklist=<p1,p2,...> required"); process.exit(1); }
  const existing = new Set(readCsvRows().map((r) => r.shortcode));
  const today = new Date().toISOString().slice(0, 10);

  const fresh = []; const seen = new Set();
  for (const p of lists) {
    if (!fs.existsSync(p)) { console.warn(`  ⚠ worklist missing, skipped: ${p}`); continue; }
    const wl = JSON.parse(fs.readFileSync(p, "utf8"));
    const collection = wl.collection || "all-posts";
    for (const r of wl.reels || []) {
      if (existing.has(r.shortcode) || seen.has(r.shortcode)) continue;
      seen.add(r.shortcode);
      fresh.push({ ...r, collection });
    }
  }

  if (!fs.existsSync(CSV)) {
    fs.mkdirSync(path.dirname(path.resolve(CSV)), { recursive: true });
    fs.writeFileSync(CSV, HEADER.join(",") + "\n");
  }
  const lines = fresh.map((r) => toLine({
    logged_at: today,
    collection: r.collection,
    shortcode: r.shortcode,
    post_type: /\/p\//.test(r.url || "") ? "post" : "reel",
    url: r.url,
    creator_handle: r.handle || "",
    likes: r.metrics?.likes ?? 0,
    comments: r.metrics?.comments ?? 0,
    duration_sec: "", hook_type: "", hook: "", format: "", why_it_works: "",
    status: "logged",
  }));
  if (lines.length) fs.appendFileSync(CSV, lines.join("\n") + "\n");

  if (args["new-out"]) {
    fs.mkdirSync(path.dirname(path.resolve(args["new-out"])), { recursive: true });
    fs.writeFileSync(args["new-out"], JSON.stringify({ source: "saved", count: fresh.length, reels: fresh }, null, 2));
  }
  console.log(`✓ CSV: ${lines.length} new post(s) appended → ${CSV}`);
  console.log(`NEW=${fresh.length}`);
}

// --- update mode -------------------------------------------------------------
if (MODE === "update") {
  if (!args.swipe || !fs.existsSync(args.swipe)) { console.error("ERROR: --swipe=<swipe-saved.json> required and must exist"); process.exit(1); }
  const ds = JSON.parse(fs.readFileSync(args.swipe, "utf8"));
  const bySc = new Map((ds.reels || []).map((r) => [r.shortcode, r]));
  const rows = readCsvRows();
  let touched = 0;
  for (const row of rows) {
    const a = bySc.get(row.shortcode);
    if (!a) continue;
    row.duration_sec = a.metrics?.durationSec ?? row.duration_sec;
    row.hook_type = a.hookType || row.hook_type;
    row.hook = a.hook || row.hook;
    row.format = a.format || row.format;
    row.why_it_works = a.whyItWorks || row.why_it_works;
    row.status = a.partial ? "partial" : "analyzed";
    touched++;
  }
  fs.writeFileSync(CSV, HEADER.join(",") + "\n" + rows.map(toLine).join("\n") + (rows.length ? "\n" : ""));
  console.log(`✓ CSV: analysis columns filled for ${touched} row(s) → ${CSV}`);
}
