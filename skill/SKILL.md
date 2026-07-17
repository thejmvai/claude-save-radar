---
name: save-radar
description: Turn your Instagram "Saved" posts into a living swipe file. Scrapes your private saved collections (only your logged-in browser can see them), logs every saved post into a CSV, breaks down each reel's hook / format / script / why-it-works, and renders a dark HTML swipe-file report. Supports a nightly 12 AM automation that captures new saves while you sleep. Trigger on /save-radar, "run save-radar", "log my saved posts", "analyze my saved reels".
---

# save-radar — your Instagram saves → a CSV log + a swipe-file report

Instagram's Save button is a graveyard: posts go in and are never seen again. This skill turns it
into a system. Every post you save gets logged into `saved-posts.csv`, every reel gets broken down
(hook, format, script, why it works), and everything is rendered into one dark swipe-file report.
A nightly automation captures new saves at 12 AM.

Your saved posts are **private** — no API can see them. This works only through a Chrome window
that YOU are logged into. That login is the single manual step; everything after is automated.

**Requires:** `node` (v22+), `yt-dlp`, `ffmpeg`, `whisper` (OpenAI Whisper CLI). Install guide for
all of them: `GUIDE.md` in this repo.

**Paths:** config at `~/.save-radar/config.json`; all output in the configured `out` dir
(default `~/.save-radar/out/`). Let `OUT` = that dir and `<skill>` = this skill's folder.

---

## Step 0 — config + the logged-in debug browser

1. Read `~/.save-radar/config.json`. If it is missing or `handle` is `"YOUR_HANDLE"`, ask the user
   for their Instagram handle and which saved collections to pull (default: `["all-posts"]`, i.e.
   everything). Collection slugs come from the collection's URL:
   `instagram.com/<handle>/saved/<slug>/`. Write the config:

```json
{
  "handle": "their_handle",
  "collections": ["all-posts"],
  "max": 30,
  "out": "~/.save-radar/out",
  "chromeProfile": "~/.save-radar-chrome",
  "model": ""
}
```

2. Check the debug browser: `curl -s --max-time 3 http://localhost:9222/json/version`. If that
   fails, give the user this command and STOP until they say it's running and they're logged in:

```
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 "--remote-allow-origins=*" \
  --user-data-dir="$HOME/.save-radar-chrome"
```

   They log into Instagram in that window (it's a separate profile — their main Chrome is untouched).

## Step 1 — scrape each configured collection

For each collection `<c>` in the config:

```
node <skill>/scripts/scrape-saved.mjs --user=<handle> --collection=<c> --max=<max> --out="$OUT/worklists/worklist-<c>.json"
```

If a scrape returns 0 tiles it's usually a soft-block or a logged-out browser — re-check the login,
wait a few minutes, retry once. Photo posts are kept as tiles; they drop out at enrichment.

## Step 2 — log into the CSV (this is the permanent record)

```
node <skill>/scripts/log-csv.mjs append --csv="$OUT/saved-posts.csv" --worklist="<comma-separated worklist paths>" --new-out="$OUT/new-worklist.json"
```

Appends only posts not already logged and writes `new-worklist.json` with just those. The last line
prints `NEW=<n>`. If `NEW=0`, tell the user nothing new was saved and stop here (the report is
already current).

## Step 3 — enrich the new posts (frames + audio + transcript, deterministic)

```
node <skill>/scripts/enrich-saved.mjs --worklist="$OUT/new-worklist.json" --frames="$OUT/frames" --cookies-profile="chrome:<chromeProfile>"
```

Writes `frames/<sc>/{1-4.jpg, hook-0..2.jpg, audio.m4a, audio.txt, meta.json}` and
`$OUT/enrich-summary.json` (complete vs partial). Only **complete** shortcodes get a full breakdown.

## Step 4 — break down each new reel (DELEGATE to a subagent; keep frames off the main thread)

Spawn one general-purpose subagent. Give it: the complete shortcodes, `$OUT/new-worklist.json`,
`$OUT/frames/`, and the existing `$OUT/swipe-saved.json` (if any). It follows the schema and merge
rules in `<skill>/scripts/nightly-breakdown-prompt.md` (mentally replace `__OUT__` with `$OUT`) and
writes the merged dataset back to `$OUT/swipe-saved.json`: per reel — hookType (archetype), hook,
hookDelivery, format, breakdown, whyItWorks, transcript, 4-frame storyboard, 3 hook frames; plus a
refreshed cross-reel `synthesis` and 5 replicable `plays`. Frame paths MUST be relative
(`frames/<sc>/...`).

## Step 5 — fill the CSV analysis columns + render + open

```
node <skill>/scripts/log-csv.mjs update --csv="$OUT/saved-posts.csv" --swipe="$OUT/swipe-saved.json"
node <skill>/scripts/render-swipe.mjs "$OUT/swipe-saved.json" "$OUT/swipe-file.html"
```

The renderer self-verifies every image ref and exits 2 on any broken one — that's a STOP: fix the
frame path and re-render. Then `open "$OUT/swipe-file.html"` and report: how many new posts were
logged, the synthesis, the plays, and any partials.

## Step 6 — offer the 12 AM automation (once)

If `~/Library/LaunchAgents/com.save-radar.nightly.plist` doesn't exist, offer to set it up:

```
bash <skill>/scripts/install-automation.sh
```

From then on `nightly.sh` runs at 12:00 AM daily: scrape → CSV → enrich → headless Claude breakdown
→ re-render. Logs land in `$OUT/logs/`. The Mac must be awake (if asleep, launchd fires on next wake).

## Notes
- Re-running is safe: the CSV dedupes by shortcode and enrich skips already-downloaded frames.
- Read-only against Instagram. Keep `max` reasonable (30) and don't hammer re-runs; IG soft-blocks bursts.
- Everything stays on the user's machine — nothing is uploaded anywhere.
