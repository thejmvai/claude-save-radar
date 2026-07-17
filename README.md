# save-radar

**Stop losing your Instagram saves. Every post you save gets logged, analyzed, and turned into a swipe file. Automatically, at 12 AM, every night.**

The Save button is where good content goes to die. You save a reel, you never look at it again. save-radar fixes that:

- **A CSV log** of every post you save: date, collection, creator, likes, comments, plus the analysis columns below. Open it in Excel, Numbers, or Google Sheets.
- **A breakdown of every reel**: the hook, the format, the full script (transcribed locally), and why it works.
- **A swipe-file report**: one dark HTML page that groups your saves by hook archetype and leads with the patterns across everything you saved, plus 5 replicable plays.
- **A nightly automation**: new saves get captured at 12:00 AM while you sleep.

Everything runs on your own machine through your own logged-in browser. Nothing is uploaded anywhere. It is read-only against Instagram.

## Quick install (if you already use Claude Code)

```bash
git clone https://github.com/thejmvai/claude-save-radar.git ~/claude-save-radar
bash ~/claude-save-radar/install.sh
```

Then open Claude Code and say: **run save-radar**. It walks you through the one manual step (logging into Instagram in a separate Chrome window) and does the rest.

You also need these free tools: `node` (v22+), `yt-dlp`, `ffmpeg`, and `whisper`. One line with [Homebrew](https://brew.sh):

```bash
brew install node ffmpeg yt-dlp openai-whisper
```

## New to Claude Code? Start here

Read **[GUIDE.md](GUIDE.md)**. It takes you from a blank Mac to a running nightly automation, step by step, assuming nothing.

## What you get

```
~/.save-radar/out/
├── saved-posts.csv     ← the log: one row per saved post
├── swipe-file.html     ← the report: synthesis, plays, per-reel breakdowns
├── frames/             ← storyboard + hook frames per reel
└── logs/               ← nightly run logs
```

## How it works

1. **Scrape**: reads your private Saved collections through a Chrome window you are logged into (raw DevTools protocol, no extension, no password ever typed anywhere but instagram.com).
2. **Log**: appends new posts to `saved-posts.csv`. Already-logged posts are skipped, so the CSV is a clean, growing record.
3. **Enrich**: downloads each new reel, extracts storyboard and hook frames, transcribes the audio locally with Whisper.
4. **Analyze**: Claude reads the frames and transcripts and writes the hook, format, breakdown, and why-it-works for each reel, then refreshes the cross-reel synthesis.
5. **Render**: one self-contained HTML report, grouped by hook archetype.

The nightly automation (macOS launchd, 12:00 AM) runs the same pipeline headless and only processes posts it has not seen before.

## Credits

Built by [@jamesonc_ai](https://instagram.com/jamesonc_ai). Extracted from the viral-radar toolkit. MIT licensed, free forever.
