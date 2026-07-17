# save-radar: the full setup guide

This guide takes you from nothing to a system where every Instagram post you save gets logged into a spreadsheet and analyzed in a report, automatically, at 12 AM every night.

It assumes zero setup. No Claude Code, no developer tools, nothing. If you already have some of this, skip that part.

**What you need before starting:** a Mac, an Instagram account, and a Claude subscription (Pro or Max, from [claude.ai](https://claude.ai)). Claude Code is included in those plans. Total setup time is about 20 minutes, and most of that is waiting for installs.

---

## Part 1: install the tools (one time, ~10 minutes)

Everything happens in **Terminal**, the Mac app where you type commands instead of clicking. Open it: press `Cmd + Space`, type `terminal`, press Enter.

**Step 1. Install Homebrew.** Homebrew is the standard installer for tools like the ones below. Paste this into Terminal and press Enter:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

It asks for your Mac password (the screen stays blank while you type it, that is normal). At the end it may print two "Next steps" commands. Copy and run those too.

**Step 2. Install the four tools save-radar uses.** Paste this:

```bash
brew install node ffmpeg yt-dlp openai-whisper
```

What these are: `node` runs the scripts, `yt-dlp` downloads reels, `ffmpeg` extracts frames, `whisper` turns speech into text. All free, all running only on your machine.

**Step 3. Install Claude Code.** Claude Code is Claude living in your Terminal, able to run tools for you. Paste this:

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

Then start it once to log in:

```bash
claude
```

Pick "log in with your Claude account" and finish in the browser. Type `exit` to leave.

---

## Part 2: the logged-in browser (one time, ~3 minutes)

Your saved posts are private. No app, no API, no website can see them. The only thing that can is a browser where you are logged in. So save-radar reads them through a separate Chrome window that you log into once.

This window uses its own profile. Your normal Chrome, your history, and your other logins are not touched.

**Step 1. Launch the debug Chrome.** Paste this into Terminal:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 "--remote-allow-origins=*" \
  --user-data-dir="$HOME/.save-radar-chrome"
```

A fresh Chrome window opens. It looks brand new because it is a separate profile.

**Step 2. Log into Instagram in that window.** Go to instagram.com and log in as yourself. That is the whole step. The login is saved in this profile, so you will not need to do it again.

Keep this window open while save-radar runs. If you ever close it, run the same launch command again.

---

## Part 3: install save-radar (one time, ~1 minute)

Paste these two lines into Terminal:

```bash
git clone https://github.com/thejmvai/claude-save-radar.git ~/claude-save-radar
bash ~/claude-save-radar/install.sh
```

If your Mac asks to install "command line developer tools" first, click Install, wait, then run the two lines again.

This links the skill into Claude Code and creates your config file at `~/.save-radar/config.json`.

---

## Part 4: first run (~5 minutes depending on how many saves you have)

In Terminal:

```bash
claude
```

Then type:

```
run save-radar
```

Claude asks for your Instagram handle and which saved collections to pull. "All posts" is the default. If you keep saves in named collections (the folders you see on your Saved page), give it those instead. The collection name in the config is the slug from the collection URL: `instagram.com/yourhandle/saved/THIS-PART/`.

Then it runs the whole pipeline: scrape, log to CSV, download, transcribe, analyze, render. When it finishes it opens your report.

**What you now have, in `~/.save-radar/out/`:**

- `saved-posts.csv`: one row per saved post. Date, collection, creator, likes, comments, hook type, hook, format, why it works. Open it in Excel, Numbers, or Google Sheets.
- `swipe-file.html`: the report. It leads with the patterns across everything you saved and 5 replicable plays, then breaks down every reel: hook frames, storyboard, full transcript, why it works.

---

## Part 5: the 12 AM automation (one time, ~1 minute)

This is the part that makes the Save button useful forever. Paste:

```bash
bash ~/claude-save-radar/skill/scripts/install-automation.sh
```

Done. Every night at 12:00 AM your Mac scrapes your collections, logs anything new into the CSV, analyzes the new reels, and refreshes the report. Posts it has already seen are skipped, so nightly runs are fast and light.

Two things to know:

- Your Mac has to be awake at midnight. If it was asleep, the run fires when it next wakes up.
- The nightly analysis step uses your Claude subscription, the same as asking Claude in a session. A handful of new saves per night is a small ask.

Want a different time? `bash install-automation.sh --hour=7 --minute=30` runs it at 7:30 AM instead.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "cannot reach Chrome on :9222" | The debug Chrome is not running. Run the launch command from Part 2 again. |
| Scrape finds 0 tiles | Usually logged out or rate-limited. Check you are logged in inside the debug Chrome, wait a few minutes, try again. |
| `brew: command not found` | Homebrew's "Next steps" commands were skipped. Rerun the installer from Part 1 and run the two commands it prints at the end. |
| `whisper: command not found` | Run `brew install openai-whisper` again. Alternative: `pipx install openai-whisper`. |
| First run is slow | Whisper downloads its speech model (~150 MB) on first use. One time only. |
| Nightly run did nothing | Check the log: `~/.save-radar/out/logs/`. Most common cause: the debug Chrome was closed and the login expired. |

## Privacy and safety

- Everything runs and stays on your machine. No servers, no uploads, no analytics.
- save-radar is read-only against Instagram. It scrolls your own Saved page the way you would, at a slow pace, capped per run.
- Your Instagram password is only ever typed into instagram.com, inside your own Chrome.

## Questions?

Find me on Instagram: [@jamesonc_ai](https://instagram.com/jamesonc_ai). This tool is free and MIT licensed. If it saves your saves, tell someone.
