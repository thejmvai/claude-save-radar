#!/bin/bash
# save-radar nightly runner — captures your newest Instagram saves, logs them to the CSV,
# analyzes the new ones with Claude Code (headless), and regenerates the swipe-file report.
# Installed to run at 12:00 AM daily by install-automation.sh (launchd on macOS).
# Safe to run by hand any time:  bash nightly.sh
set -u

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$HOME/.save-radar/config.json"

# launchd starts with a bare PATH — add the usual tool homes (Homebrew, npm, native installer,
# python.org framework installs where pip puts yt-dlp/whisper)
export PATH="$HOME/.local/bin:$HOME/.claude/local:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
for d in "$HOME/.npm-global/bin" /Library/Frameworks/Python.framework/Versions/*/bin; do
  [ -d "$d" ] && PATH="$PATH:$d"
done

fail() { echo "✗ $1"; exit 1; }
command -v node >/dev/null || fail "node not found on PATH"
[ -f "$CONFIG" ] || fail "no config at $CONFIG — run the skill once interactively first (see GUIDE.md)"

# --- read config ------------------------------------------------------------
eval "$(node -e '
const c = JSON.parse(require("fs").readFileSync(process.env.HOME + "/.save-radar/config.json", "utf8"));
const q = (s) => "\x27" + String(s).replace(/\x27/g, "") + "\x27";
console.log("HANDLE=" + q(c.handle || ""));
console.log("COLLECTIONS=" + q((c.collections || ["all-posts"]).join(" ")));
console.log("MAX=" + q(c.max || 30));
console.log("OUT=" + q((c.out || "~/.save-radar/out").replace(/^~/, process.env.HOME)));
console.log("CHROME_PROFILE=" + q((c.chromeProfile || "~/.save-radar-chrome").replace(/^~/, process.env.HOME)));
console.log("MODEL=" + q(c.model || ""));
')"
[ -n "$HANDLE" ] && [ "$HANDLE" != "YOUR_HANDLE" ] || fail "set your Instagram handle in $CONFIG first"

mkdir -p "$OUT/logs" "$OUT/worklists"
LOG="$OUT/logs/nightly-$(date +%Y-%m-%d).log"
exec >>"$LOG" 2>&1
echo ""
echo "===== save-radar nightly — $(date '+%Y-%m-%d %H:%M:%S') ====="

# --- 1. make sure the logged-in debug Chrome is up --------------------------
if ! curl -s --max-time 3 "http://localhost:9222/json/version" >/dev/null; then
  echo "→ debug Chrome not running, launching it"
  CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  [ -x "$CHROME_BIN" ] || fail "Google Chrome not found at $CHROME_BIN"
  nohup "$CHROME_BIN" --remote-debugging-port=9222 "--remote-allow-origins=*" \
    --user-data-dir="$CHROME_PROFILE" --no-first-run >/dev/null 2>&1 &
  sleep 12
  curl -s --max-time 3 "http://localhost:9222/json/version" >/dev/null || fail "Chrome did not come up on :9222"
fi

# --- 2. scrape each configured collection -----------------------------------
WORKLISTS=""
for c in $COLLECTIONS; do
  echo "→ scraping collection: $c"
  if node "$SCRIPTS_DIR/scrape-saved.mjs" --user="$HANDLE" --collection="$c" --max="$MAX" \
       --out="$OUT/worklists/worklist-$c.json"; then
    WORKLISTS="$WORKLISTS,$OUT/worklists/worklist-$c.json"
  else
    echo "  ⚠ scrape failed for $c (soft-block or logged-out browser?) — continuing"
  fi
done
WORKLISTS="${WORKLISTS#,}"
[ -n "$WORKLISTS" ] || fail "no collection scraped successfully tonight"

# --- 3. log new saves into the CSV ------------------------------------------
APPEND_OUT="$(node "$SCRIPTS_DIR/log-csv.mjs" append --csv="$OUT/saved-posts.csv" \
  --worklist="$WORKLISTS" --new-out="$OUT/new-worklist.json")"
echo "$APPEND_OUT"
NEW="$(echo "$APPEND_OUT" | grep -o 'NEW=[0-9]*' | cut -d= -f2)"
if [ -z "$NEW" ] || [ "$NEW" = "0" ]; then
  echo "✓ no new saves since last run — done"
  exit 0
fi

# --- 4. download frames + audio + transcripts for the new posts -------------
echo "→ enriching $NEW new post(s)"
node "$SCRIPTS_DIR/enrich-saved.mjs" --worklist="$OUT/new-worklist.json" \
  --frames="$OUT/frames" --cookies-profile="chrome:$CHROME_PROFILE" || echo "  ⚠ enrich had failures — partials are handled downstream"

# --- 5. Claude breaks down the new reels + refreshes the synthesis ----------
CLAUDE_BIN="$(command -v claude || true)"
[ -n "$CLAUDE_BIN" ] || fail "claude CLI not found on PATH — is Claude Code installed?"
echo "→ running Claude breakdown (headless)"
PROMPT="$(sed "s|__OUT__|$OUT|g" "$SCRIPTS_DIR/nightly-breakdown-prompt.md")"
"$CLAUDE_BIN" -p "$PROMPT" --allowedTools "Read,Write" --max-turns 60 ${MODEL:+--model "$MODEL"} \
  || fail "Claude breakdown step failed — see above"
[ -f "$OUT/swipe-saved.json" ] || fail "breakdown did not produce $OUT/swipe-saved.json"

# --- 6. fill the CSV analysis columns + re-render the report ----------------
node "$SCRIPTS_DIR/log-csv.mjs" update --csv="$OUT/saved-posts.csv" --swipe="$OUT/swipe-saved.json"
node "$SCRIPTS_DIR/render-swipe.mjs" "$OUT/swipe-saved.json" "$OUT/swipe-file.html" || fail "report render failed (broken image ref)"
echo "✓ nightly complete — $NEW new post(s) logged, report at $OUT/swipe-file.html"
