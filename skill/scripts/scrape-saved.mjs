// Saved-posts scraper for save-radar — reads YOUR Instagram "Saved" collection (private, only your
// logged-in session sees it) via the raw Chrome DevTools Protocol, and writes a work-list in the exact
// shape claude-viral-radar's Step 3 enrichment consumes. This is the ONE new piece: the saved page uses
// the same `a[href*="/reel/"]` tiles as a profile grid, so the existing enrich→render pipeline is reused
// unchanged. Dependency-free (Node global WebSocket + fetch), self-contained (no sibling-repo import).
//
// Prereq: Chrome running with --remote-debugging-port=9222 and logged into Instagram (see runbook).
//
// CLI:
//   node scrape-saved.mjs \
//     --user=<your_ig_handle> [--collection=all-posts | --url=<full saved URL>] \
//     [--port=9222] [--max=60] [--out=<worklist.json path>] [--scrolls=40]
//
// Writes a worklist JSON: { source:"saved", scrapedFrom, count, reels:[ {shortcode,url,handle,...} ] }

import fs from "node:fs";
import path from "node:path";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- args -------------------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
  })
);
const PORT = Number(args.port || 9222);
const USER = String(args.user || "").replace(/^@/, "").trim();
const MAX = Number(args.max || 60);
const MAX_SCROLLS = Number(args.scrolls || 40);
const SAVED_URL =
  args.url ||
  (USER
    ? `https://www.instagram.com/${USER}/saved/${args.collection || "all-posts"}/`
    : null);
const OUT = args.out || path.resolve("save-radar-out/worklist-saved.json");

if (!SAVED_URL) {
  console.error("ERROR: pass --user=<handle> (or a full --url=). Nothing to scrape.");
  process.exit(1);
}

// ---- raw CDP client (same protocol path as scrape-cdp.mjs, inlined) ----------
async function listTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  return res.json();
}
function pickPageTarget(targets, urlIncludes = "instagram.com") {
  const pages = (targets || []).filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
  return pages.find((t) => (t.url || "").includes(urlIncludes)) || pages[0] || null;
}
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this._id = 0;
    this._pending = new Map();
    ws.addEventListener("message", (ev) => {
      let msg;
      try { msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data)); } catch { return; }
      if (msg.id && this._pending.has(msg.id)) {
        const { resolve, reject } = this._pending.get(msg.id);
        this._pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message || JSON.stringify(msg.error))) : resolve(msg.result);
      }
    });
  }
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.addEventListener("open", () => res(), { once: true });
      ws.addEventListener("error", () => rej(new Error("CDP WebSocket error — is Chrome up with --remote-debugging-port and --remote-allow-origins=*?")), { once: true });
    });
    return new Cdp(ws);
  }
  send(method, params = {}, { timeoutMs = 30000 } = {}) {
    const id = ++this._id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this._pending.has(id)) { this._pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }
      }, timeoutMs);
      timer.unref?.();
      this._pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression, { awaitPromise = false } = {}) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
    if (r && r.exceptionDetails) throw new Error("evaluate failed: " + (r.exceptionDetails.text || "exception"));
    return r && r.result ? r.result.value : undefined;
  }
  navigate(url) { return this.send("Page.navigate", { url }); }
  close() { try { this.ws.close(); } catch {} }
}

// ---- DOM reads (LIVE-GATED — same selectors as the profile-grid scraper) ------
// Saved grid mixes posts + reels; keep both /reel/ and /p/ tiles (saved reels appear as either).
const GRID_EXPR = `(() => {
  const out = [], seen = new Set();
  for (const a of document.querySelectorAll('a[href*="/reel/"], a[href*="/p/"]')) {
    const m = (a.getAttribute('href') || '').match(/\\/(reel|p)\\/([\\w-]+)/);
    if (!m || seen.has(m[2])) continue;
    seen.add(m[2]);
    out.push({ shortcode: m[2], kind: m[1] });
  }
  return out;
})()`;
const SCROLLH_EXPR = `document.scrollingElement ? document.scrollingElement.scrollHeight : document.body.scrollHeight`;
const SCROLL_EXPR = `window.scrollTo(0, (document.scrollingElement||document.body).scrollHeight); true`;
const OG_EXPR = `(() => { const m = document.querySelector('meta[property="og:description"]'); return m ? m.getAttribute('content') : ''; })()`;
const TITLE_EXPR = `document.title || ''`;

// ---- minimal og:description parser (likes / comments / creator) --------------
function parseCount(s) {
  if (!s) return 0;
  const m = String(s).replace(/,/g, "").match(/([\d.]+)\s*([KMB])?/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || "").toUpperCase()] || 1;
  return Math.round(n * mult);
}
function parseOg(text) {
  const t = String(text || "");
  const likes = (t.match(/([\d.,KMB]+)\s+likes?/i) || [])[1];
  const comments = (t.match(/([\d.,KMB]+)\s+comments?/i) || [])[1];
  const handle = (t.match(/-\s*@?([A-Za-z0-9._]+)\s+on/i) || t.match(/@([A-Za-z0-9._]+)/) || [])[1];
  return { likes: parseCount(likes), comments: parseCount(comments), creatorHandle: handle || "" };
}

// ---- main -------------------------------------------------------------------
(async () => {
  console.log(`→ saved-radar: connecting to Chrome :${PORT}`);
  let targets;
  try { targets = await listTargets(PORT); }
  catch { console.error(`ERROR: cannot reach Chrome on :${PORT}. Launch the debug browser first (see GUIDE.md, Part 2).`); process.exit(1); }
  const target = pickPageTarget(targets);
  if (!target) { console.error("ERROR: no usable Chrome page target found."); process.exit(1); }
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);

  console.log(`→ navigating to ${SAVED_URL}`);
  await cdp.navigate(SAVED_URL);
  await wait(4000);

  // login / access guard
  const title = await cdp.evaluate(TITLE_EXPR);
  const probe = await cdp.evaluate(GRID_EXPR);
  if ((!probe || !probe.length)) {
    const looksLoggedOut = /log in|login/i.test(String(title));
    console.error(
      `⚠ No saved tiles found on first read. ${looksLoggedOut ? "Page looks logged-out — " : ""}` +
      `Make sure the debug Chrome is logged into Instagram AS @${USER || "you"} and that this collection has saved reels. ` +
      `URL tried: ${SAVED_URL}`
    );
    // don't exit yet — try scrolling once in case it's a slow first paint
  }

  // scroll to lazy-load the whole saved grid
  let tiles = [];
  let lastH = 0, stable = 0;
  for (let i = 0; i < MAX_SCROLLS; i++) {
    tiles = await cdp.evaluate(GRID_EXPR);
    if (tiles.length >= MAX) break;
    await cdp.evaluate(SCROLL_EXPR);
    await wait(1500);
    const h = await cdp.evaluate(SCROLLH_EXPR);
    if (h === lastH) { if (++stable >= 3) break; } else { stable = 0; lastH = h; }
    process.stdout.write(`\r  scroll ${i + 1}/${MAX_SCROLLS} — ${tiles.length} tiles so far   `);
  }
  tiles = await cdp.evaluate(GRID_EXPR);
  console.log(`\n→ collected ${tiles.length} saved tiles (cap ${MAX})`);
  tiles = tiles.slice(0, MAX);

  // per-reel og:description for engagement + creator (paced to avoid throttle)
  const reels = [];
  for (let i = 0; i < tiles.length; i++) {
    const { shortcode, kind } = tiles[i];
    const url = `https://www.instagram.com/${kind}/${shortcode}/`;
    let og = { likes: 0, comments: 0, creatorHandle: "" };
    try {
      await cdp.navigate(url);
      await wait(2200);
      const ogText = await cdp.evaluate(OG_EXPR);
      og = parseOg(ogText);
    } catch (e) {
      console.warn(`  og fetch failed for ${shortcode}: ${e.message}`);
    }
    reels.push({
      shortcode,
      url,
      handle: og.creatorHandle ? `@${og.creatorHandle}` : "@saved",
      creatorName: og.creatorHandle || "",
      discoveredVia: "saved",
      trackingCategory: "saved",
      metrics: { views: 0, likes: og.likes, comments: og.comments },
      likeRate: 0, commentRate: 0, breakout: 0,
      signalScore: 0, qualityFlag: "saved",
    });
    process.stdout.write(`\r  enriched og ${i + 1}/${tiles.length}   `);
    await wait(1200); // pace
  }
  cdp.close();

  const payload = {
    source: "saved",
    scrapedFrom: SAVED_URL,
    scrapedUser: USER || null,
    collection: args.url
      ? ((String(args.url).match(/\/saved\/([^/]+)/) || [])[1] || "custom")
      : String(args.collection || "all-posts").split("/")[0],
    count: reels.length,
    reels,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(`\n✓ wrote ${reels.length} saved reels → ${OUT}`);
  if (!reels.length) process.exit(2);
})();
