#!/bin/bash
# Installs the save-radar nightly automation: a macOS launchd job that runs nightly.sh
# at 12:00 AM every day. Re-running this script updates and reloads the job.
#   bash install-automation.sh [--hour=0] [--minute=0]
# Remove it later with:  launchctl unload ~/Library/LaunchAgents/com.save-radar.nightly.plist
set -eu

HOUR=0; MINUTE=0
for a in "$@"; do
  case "$a" in
    --hour=*)   HOUR="${a#*=}" ;;
    --minute=*) MINUTE="${a#*=}" ;;
  esac
done

if [ "$(uname)" != "Darwin" ]; then
  echo "This installer targets macOS (launchd). On Linux, add a cron entry instead:"
  echo "  0 0 * * * /bin/bash $(cd "$(dirname "$0")" && pwd)/nightly.sh"
  exit 1
fi

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.save-radar.nightly.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.save-radar"

cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.save-radar.nightly</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${SCRIPTS_DIR}/nightly.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>${HOUR}</integer>
    <key>Minute</key><integer>${MINUTE}</integer>
  </dict>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>${HOME}/.save-radar/launchd.log</string>
  <key>StandardErrorPath</key><string>${HOME}/.save-radar/launchd.log</string>
</dict>
</plist>
EOF

plutil -lint "$PLIST" >/dev/null
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

printf -- "✓ installed: save-radar will run daily at %02d:%02d\n" "$HOUR" "$MINUTE"
echo "  job:  com.save-radar.nightly"
echo "  logs: ~/.save-radar/out/logs/  (per-day) and ~/.save-radar/launchd.log"
echo "  note: your Mac must be awake at that time — if it was asleep, launchd runs the job on next wake."
echo "  test it now with:  bash ${SCRIPTS_DIR}/nightly.sh"
