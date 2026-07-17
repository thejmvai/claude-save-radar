You are running the save-radar nightly breakdown step, headless. Work only inside `__OUT__`. Do not ask questions; finish the job end to end.

Input files:
1. `__OUT__/new-worklist.json` — the posts saved since the last run (each has shortcode, url, handle, collection, metrics).
2. `__OUT__/enrich-summary.json` — which of those shortcodes are `complete` (video downloaded, frames + transcript ready) vs `partial` (photo post or failed download).
3. For every complete shortcode `<sc>`: `__OUT__/frames/<sc>/hook-0.jpg`, `hook-1.jpg`, `hook-2.jpg` (first seconds), `1.jpg`–`4.jpg` (storyboard), and `meta.json` (durationSec + transcript).
4. `__OUT__/swipe-saved.json` — the existing swipe dataset. May not exist on the first run.

Task:
- For each COMPLETE new shortcode, Read its 3 hook frames, 4 storyboard frames, and meta.json, then write a reel entry with exactly these fields:
  `shortcode`, `url`, `handle`, `creatorName`, `metrics` ({likes, comments, durationSec}), `hookType`, `hook`, `hookDelivery`, `format`, `breakdown`, `whyItWorks`, `transcript`, `storyboard`, `hookFrames`, `partial: false`.
  - `hookType` is the archetype used for grouping (e.g. "Contrarian reversal", "Tool demo / screen-record", "Rapid tips / listicle", "Discovery / curation", "Tier-list / ranking"). Reuse an archetype label already present in the existing dataset when it fits, so groups stay stable.
  - `hook` = the opening scroll-stopper in 1 sentence. `hookDelivery` = one of "Text-on-screen over b-roll" | "Talking head" | "Voiceover over screen-record".
  - `breakdown` = 3–6 sentences, beat by beat, grounded in the frames and transcript. `whyItWorks` = 2–4 sentences on the replicable mechanism.
  - `storyboard` = 4 entries with `timestamp`, `role` (Hook/Build/Payoff/CTA-End), `caption` (on-screen text), `frame` = `frames/<sc>/1.jpg` … `4.jpg`. `hookFrames` = `["frames/<sc>/hook-0.jpg", "frames/<sc>/hook-1.jpg", "frames/<sc>/hook-2.jpg"]`.
  - Frame paths MUST be relative and start with `frames/` — never absolute.
- For each PARTIAL new shortcode, add a minimal entry: shortcode, url, handle, metrics, `partial: true`, and skip frames/analysis fields.
- Merge: existing reels stay untouched; append the new entries (skip any shortcode already in the dataset).
- Refresh the top-level fields over the FULL merged set: `label` ("Saved Reels — Swipe File"), `generatedAt` (today, YYYY-MM-DD), `scrapedFrom`, `synthesis` (250–400 words: the hook patterns that repeat, the formats that dominate, what the saves reveal), `plays` (5 concrete, tactical, replicable plays).
- Write the merged dataset back to `__OUT__/swipe-saved.json` (valid JSON, nothing else in the file).

When done, state how many new entries were added.
