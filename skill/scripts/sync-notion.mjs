// save-radar → Notion sync (OPTIONAL). Mirrors saved-posts.csv into a Notion database and keeps
// it updated: first run creates an "Instagram Saved Posts" database under your chosen page, every
// later run upserts rows by shortcode. Runs automatically at the end of the nightly pipeline and
// exits quietly if Notion isn't configured — the feature is opt-in.
//
// Enable it in ~/.save-radar/config.json:
//   "notionToken": "ntn_..." (or secret_...),   ← from notion.so/my-integrations (Internal integration)
//   "notionParentPage": "<page URL or id>"      ← a page you connected to that integration
//
// CLI: node sync-notion.mjs --csv=<saved-posts.csv>
// Dependency-free (Node fetch). State (the created database id) lives in ~/.save-radar/notion-state.json.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const BASE = process.env.NOTION_BASE_URL || "https://api.notion.com";
const CONFIG_PATH = process.env.SAVE_RADAR_CONFIG || path.join(os.homedir(), ".save-radar", "config.json");
const STATE_PATH = path.join(path.dirname(CONFIG_PATH), "notion-state.json");

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
}));
if (!args.csv || !fs.existsSync(args.csv)) { console.error("usage: node sync-notion.mjs --csv=<saved-posts.csv>"); process.exit(1); }

let config = {};
try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); } catch {}
const TOKEN = config.notionToken || process.env.SAVE_RADAR_NOTION_TOKEN || "";
const PARENT_RAW = config.notionParentPage || "";
if (!TOKEN || !PARENT_RAW) { console.log("notion sync: not configured (set notionToken + notionParentPage in config) — skipped"); process.exit(0); }

// The page id sits at the END of a Notion URL — anchor there so slug letters that happen to
// be hex (e.g. "...Swipe-File-<id>") can never shift the match.
const pageIdMatch = String(PARENT_RAW).trim().split("?")[0].replace(/\/+$/, "").replace(/-/g, "").match(/([0-9a-f]{32})$/i);
if (!pageIdMatch) { console.error("notion sync: could not find a page id in notionParentPage — paste the full page URL"); process.exit(1); }
const PARENT_ID = pageIdMatch[1];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function notion(method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(`Notion ${method} ${url} → ${res.status}: ${json.message || "error"}`); e.status = res.status; throw e; }
  return json;
}

// --- CSV parsing (same dialect log-csv.mjs writes) ---------------------------
function parseCsv(text) {
  const rows = []; let cur = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += c; }
    else if (c === '"') inQ = true;
    else if (c === ",") { cur.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; cur.push(cell); if (cur.some((x) => x !== "")) rows.push(cur); cur = []; cell = ""; }
    else cell += c;
  }
  cur.push(cell); if (cur.some((x) => x !== "")) rows.push(cur);
  const head = rows[0] || [];
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

// --- property builders -------------------------------------------------------
const trunc = (s, n = 1900) => String(s ?? "").slice(0, n);
const rt = (s) => ({ rich_text: s ? [{ text: { content: trunc(s) } }] : [] });
const sel = (s) => ({ select: s ? { name: trunc(String(s).replace(/,/g, " "), 90) } : null });
const num = (s) => ({ number: s === "" || s == null ? null : Number(s) || 0 });

const SCHEMA = {
  "Post": { title: {} },
  "Logged": { date: {} },
  "Collection": { select: {} },
  "Type": { select: {} },
  "Creator": { rich_text: {} },
  "URL": { url: {} },
  "Likes": { number: {} },
  "Comments": { number: {} },
  "Duration (s)": { number: {} },
  "Hook Type": { select: {} },
  "Hook": { rich_text: {} },
  "Format": { rich_text: {} },
  "Why It Works": { rich_text: {} },
  "Status": { select: {} },
  "Shortcode": { rich_text: {} },
};

function rowProps(r) {
  const title = r.hook || `${r.creator_handle || "@?"} ${r.shortcode}`;
  return {
    "Post": { title: [{ text: { content: trunc(title) } }] },
    "Logged": { date: r.logged_at ? { start: r.logged_at } : null },
    "Collection": sel(r.collection),
    "Type": sel(r.post_type),
    "Creator": rt(r.creator_handle),
    "URL": { url: r.url || null },
    "Likes": num(r.likes),
    "Comments": num(r.comments),
    "Duration (s)": num(r.duration_sec),
    "Hook Type": sel(r.hook_type),
    "Hook": rt(r.hook),
    "Format": rt(r.format),
    "Why It Works": rt(r.why_it_works),
    "Status": sel(r.status),
    "Shortcode": rt(r.shortcode),
  };
}

// --- main --------------------------------------------------------------------
let state = {};
try { state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); } catch {}

async function ensureDatabase() {
  if (state.databaseId) {
    try { await notion("POST", `/v1/databases/${state.databaseId}/query`, { page_size: 1 }); return state.databaseId; }
    catch (e) { if (e.status === 404) { console.log("notion sync: saved database is gone, creating a new one"); state = {}; } else throw e; }
  }
  const db = await notion("POST", "/v1/databases", {
    parent: { type: "page_id", page_id: PARENT_ID },
    title: [{ type: "text", text: { content: "Instagram Saved Posts" } }],
    properties: SCHEMA,
  });
  state.databaseId = db.id;
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  console.log(`notion sync: created database "Instagram Saved Posts" (${db.id})`);
  return db.id;
}

const rows = parseCsv(fs.readFileSync(args.csv, "utf8"));
if (!rows.length) { console.log("notion sync: CSV empty — nothing to do"); process.exit(0); }

const dbId = await ensureDatabase();
let created = 0, updated = 0, failed = 0;
for (const r of rows) {
  if (!r.shortcode) continue;
  try {
    const q = await notion("POST", `/v1/databases/${dbId}/query`, {
      filter: { property: "Shortcode", rich_text: { equals: r.shortcode } }, page_size: 1,
    });
    if (q.results && q.results.length) {
      await notion("PATCH", `/v1/pages/${q.results[0].id}`, { properties: rowProps(r) });
      updated++;
    } else {
      await notion("POST", "/v1/pages", { parent: { database_id: dbId }, properties: rowProps(r) });
      created++;
    }
  } catch (e) {
    failed++;
    console.warn(`  ⚠ ${r.shortcode}: ${e.message}`);
  }
  await wait(350); // Notion rate limit ~3 req/s
}
console.log(`✓ notion sync: ${created} created, ${updated} updated${failed ? `, ${failed} FAILED` : ""} → database ${dbId}`);
if (failed) process.exit(1);
