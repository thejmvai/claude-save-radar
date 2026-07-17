#!/bin/bash
# save-radar installer — links the skill into Claude Code and seeds the config.
#   bash install.sh
set -eu

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILLS_DIR="$HOME/.claude/skills"
CONFIG_DIR="$HOME/.save-radar"

mkdir -p "$SKILLS_DIR" "$CONFIG_DIR"
ln -sfn "$REPO_DIR/skill" "$SKILLS_DIR/save-radar"
echo "✓ skill linked: $SKILLS_DIR/save-radar → $REPO_DIR/skill"

if [ ! -f "$CONFIG_DIR/config.json" ]; then
  cat >"$CONFIG_DIR/config.json" <<'EOF'
{
  "handle": "YOUR_HANDLE",
  "collections": ["all-posts"],
  "max": 30,
  "out": "~/.save-radar/out",
  "chromeProfile": "~/.save-radar-chrome",
  "model": ""
}
EOF
  echo "✓ config created: $CONFIG_DIR/config.json (Claude fills in your handle on first run)"
else
  echo "✓ config already exists: $CONFIG_DIR/config.json (left untouched)"
fi

echo ""
echo "Next: open Claude Code anywhere and say:  run save-radar"
echo "Full walkthrough: $REPO_DIR/GUIDE.md"
