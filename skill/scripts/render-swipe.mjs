// Swipe-file renderer for save-radar. Consumes a swipe dataset (saved reels enriched with breakdowns)
// and emits a dark, self-contained HTML report tuned for a HAND-CURATED library — not competitor intel:
//   - leads with the cross-reel synthesis + replicable plays (the actual payoff)
//   - groups reels by hook ARCHETYPE (hookType), not by a virality rank
//   - shows engagement as context, drops signalScore/breakout/quarantine (meaningless on your own saves)
// Same design system as /viral-radar's render-report.mjs (Geist type, dark card UI, storyboard carousel,
// print/PDF filmstrip export) so the two report families read as one product — just re-themed for a
// grouped swipe file instead of a ranked digest.
// Frame paths are relative ("frames/<sc>/..") and resolve against the report's own directory.
// Verifies every local image ref after writing; exits 2 if any is missing (never ship dead photos).
//
// CLI: node render-swipe.mjs <dataset.json> <out.html>

import fs from "node:fs";
import path from "node:path";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => Number(n).toLocaleString("en-US");
const compactNum = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(v >= 1e5 ? 0 : 1).replace(/\.0$/, "") + "K";
  return String(v);
};
const dur = (s) => { s = Number(s) || 0; const m = Math.floor(s / 60), ss = String(s % 60).padStart(2, "0"); return `${m}:${ss}`; };

function chip(svg, text, cls = "") {
  return `<span class="chip ${cls}">${svg}${esc(text)}</span>`;
}
const HEART = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7-4.35-9.5-8.5C.5 9 2 5.5 5.5 5.5c2 0 3.5 1.5 6.5 4 3-2.5 4.5-4 6.5-4 3.5 0 5 3.5 3 7C19 16.65 12 21 12 21z"/></svg>';
const CMT = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-5 4V5a1 1 0 0 1 1-1z"/></svg>';
const CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

function reelCard(r) {
  const mt = r.metrics || {};
  const sb = (r.storyboard || []).filter((f) => f && f.frame);
  const frameUrl = (f) => esc(f);
  const frames = sb
    .map((f, n) => `<img class="frm${n === 0 ? " on" : ""}" src="${frameUrl(f.frame)}" data-role="${esc(f.role || "")}" data-ts="${esc(f.timestamp || "")}" data-cap="${esc(f.caption || "")}" alt="storyboard frame">`)
    .join("");
  const navBtns = sb.length > 1 ? `<button class="nav prev" aria-label="previous frame"><span class="chev">&#10094;</span></button><button class="nav next" aria-label="next frame"><span class="chev">&#10095;</span></button>` : "";
  const dots = sb.length > 1 ? `<div class="dots">${sb.map((f, n) => `<i class="${n === 0 ? "on" : ""}" title="${esc(f.role || "")}"></i>`).join("")}</div>` : "";
  const stepHint = sb.length > 1 ? `<div class="stephint">${sb.map((f) => esc(f.role || "")).filter(Boolean).join(" &rarr; ")}</div>` : "";
  const hf = (r.hookFrames || []).filter(Boolean);
  const hookStrip = hf.length
    ? `<div class="hookframes">${hf.slice(0, 3).map((f, i) => `<figure><img src="${frameUrl(f)}" alt="first ${i}s"><figcaption>${i}s</figcaption></figure>`).join("")}</div>`
    : "";
  const tx = (r.transcript || "").trim();
  return `
  <div class="reel${r.partial ? " partial" : ""}">
    <div class="left">
      <div class="stage">${frames}<span class="role"></span><span class="ts"></span><span class="fcount">1 / ${sb.length || 1}</span>${navBtns}${dots}</div>
      ${stepHint}
      <div class="cap"><b class="cr"></b> <span class="cc"></span></div>
      <a class="igbtn" href="${esc(r.url)}" target="_blank" rel="noopener">Open on Instagram <span class="ic">&#8599;</span></a>
    </div>
    <div class="right">
      <div class="who"><h2>${esc(r.handle)}</h2><span class="pill-reel">SAVED</span>${r.partial ? '<span class="pill-warn">PARTIAL &middot; NO VIDEO</span>' : ""}</div>
      <div class="chips">
        ${mt.durationSec ? chip(CLOCK, dur(mt.durationSec), "date") : ""}
        ${mt.likes ? chip(HEART, compactNum(mt.likes), "heart") : ""}
        ${mt.comments ? chip(CMT, compactNum(mt.comments), "cmt") : ""}
      </div>
      <div class="sec"><div class="seclabel">Hook &middot; ${esc(r.hookDelivery || "")}</div>${hookStrip}<div class="hook">&ldquo;${esc(r.hook)}&rdquo;</div></div>
      <div class="sec"><div class="seclabel">Format</div><span class="ftag">${esc(r.format)}</span></div>
      <div class="sec"><div class="seclabel">Breakdown</div><div class="breakdown">${esc(r.breakdown)}</div></div>
      ${tx ? `<details class="tx"><summary><span class="lft"><span class="tri">&#9656;</span> Transcript</span><button class="copybtn">Copy</button></summary><div class="tx-body">${esc(tx).replace(/\n/g, "<br>")}</div></details>` : ""}
      ${r.whyItWorks ? `<div class="why"><div class="seclabel">Why it works</div><p>${esc(r.whyItWorks)}</p></div>` : ""}
    </div>
  </div>`;
}

// At-a-glance stat row above the groups: reels, creators, archetypes, transcribed.
function statBar(ds) {
  const reels = ds.reels || [];
  const channels = new Set(reels.map((r) => r.handle)).size;
  const groups = new Set(reels.map((r) => r.hookType || "Other")).size;
  const transcribed = reels.filter((r) => r.transcript && String(r.transcript).trim()).length;
  const cell = (n, l) => `<div class="stat"><div class="statn">${n}</div><div class="statl">${l}</div></div>`;
  return `<div class="statbar">${[
    cell(fmt(reels.length), "reels"),
    cell(fmt(channels), "creators"),
    cell(fmt(groups), "archetypes"),
    cell(fmt(transcribed), "transcribed"),
  ].join("")}</div>`;
}

export function renderSwipe(ds) {
  const reels = (ds.reels || []).filter(Boolean);
  // group by hookType (archetype); largest groups first, ungrouped last
  const groups = {};
  for (const r of reels) { const k = r.hookType || "Other"; (groups[k] ||= []).push(r); }
  const ordered = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  const plays = (ds.plays || []).map((p, i) => `<div class="play"><b>0${i + 1}</b><span>${esc(p)}</span></div>`).join("");
  const sections = ordered.map(([name, rs]) => `
    <div class="grp">
      <div class="grphead"><h2>${esc(name)}</h2><span class="gct">${rs.length} reel${rs.length === 1 ? "" : "s"}</span></div>
      ${rs.map(reelCard).join("\n")}
    </div>`).join("\n");
  const channels = new Set(reels.map((r) => r.handle)).size;
  const sub = `${reels.length} saved reels &middot; ${channels} creators &middot; ${esc(ds.generatedAt || "")}${ds.scrapedFrom ? " &middot; " + esc(ds.scrapedFrom) : ""}`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(ds.label || "Saved Reels — Swipe File")}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${SWIPE_CSS}</style></head>
<body><div class="wrap"><div class="pglabel">Swipe File &middot; ${esc(ds.label || "Saved Reels")}</div><div class="pgsub">${sub}</div>
${statBar(ds)}
<div class="synth"><h2>Top replicable plays</h2><div class="plays">${plays}</div>${ds.synthesis ? `<div class="gatenote">${esc(ds.synthesis)}</div>` : ""}</div>
${sections}
</div>
<script>
document.querySelectorAll(".copybtn").forEach(function(b){b.addEventListener("click",function(e){e.preventDefault();var d=b.closest("details");var body=d?d.querySelector(".tx-body"):null;navigator.clipboard.writeText(body?body.innerText:"");var t=b.textContent;b.textContent="Copied";setTimeout(function(){b.textContent=t;},1500);});});
document.querySelectorAll(".reel").forEach(function(reel){
  var stage=reel.querySelector(".stage"); if(!stage) return;
  var imgs=stage.querySelectorAll(".frm"); if(!imgs.length) return;
  var roleEl=stage.querySelector(".role"), tsEl=stage.querySelector(".ts"), cntEl=stage.querySelector(".fcount");
  var dotsEl=stage.querySelectorAll(".dots i");
  var crEl=reel.querySelector(".cap .cr"), ccEl=reel.querySelector(".cap .cc"), i=0;
  function show(n){ i=(n+imgs.length)%imgs.length;
    imgs.forEach(function(im,k){im.classList.toggle("on",k===i);});
    dotsEl.forEach(function(d,k){d.classList.toggle("on",k===i);});
    var a=imgs[i];
    if(roleEl) roleEl.textContent=a.dataset.role||"";
    if(tsEl) tsEl.textContent=a.dataset.ts||"";
    if(cntEl) cntEl.textContent=(i+1)+" / "+imgs.length;
    if(crEl) crEl.textContent=a.dataset.role||"";
    if(ccEl) ccEl.textContent=a.dataset.cap||"";
  }
  var p=stage.querySelector(".nav.prev"), nx=stage.querySelector(".nav.next");
  if(p) p.addEventListener("click",function(){show(i-1);});
  if(nx) nx.addEventListener("click",function(){show(i+1);});
  show(0);
});
</script>
</body></html>`;
}

// Same design tokens/components as /viral-radar's REPORT_CSS (render-report.mjs) — card shell, storyboard
// carousel, chips, transcript/why blocks, print filmstrip export — minus the ranked-digest-only pieces
// (rank badge, view/breakout/score chips, like/comment-rate row, tabs, analytics, trends, quarantine).
const SWIPE_CSS = `
:root{--bg:#0C0C10;--card:#141419;--card-2:#1C1C23;--border:#2A2A33;--text:#F3F3F6;--muted:#9A9AA4;--faint:#6C6C77;--red:#FF4D6A;--red-bg:rgba(255,77,106,.12);--red-bd:rgba(255,77,106,.38);--heart:#FF5A7A;--amber:#F0B73E;--sans:'Geist',system-ui,sans-serif;--mono:'Geist Mono',ui-monospace,monospace}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:var(--sans);font-size:15px;line-height:1.6}
.wrap{max-width:1120px;margin:0 auto;padding:46px 40px 90px}.pglabel{font-size:12px;font-weight:600;letter-spacing:.05em;color:var(--red);text-transform:uppercase;margin-bottom:6px}.pgsub{font-family:var(--mono);font-size:12px;color:var(--faint);margin-bottom:24px}
.statbar{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:0 0 30px;background:var(--card);border:1px solid var(--border);border-radius:16px;padding:18px 22px}
.stat{text-align:center}.statn{font-family:var(--mono);font-size:23px;font-weight:700;color:var(--text);line-height:1.1}.statl{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--faint);margin-top:5px}
.hookframes{display:flex;gap:8px;margin:0 0 14px}.hookframes figure{margin:0;flex:1}.hookframes img{width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:9px;border:1px solid var(--border);display:block}.hookframes figcaption{font-family:var(--mono);font-size:10px;color:var(--faint);text-align:center;margin-top:4px}
.synth{margin-bottom:30px}.synth h2{font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--faint);margin:0 0 14px}
.plays{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}.play b{display:block;font-family:var(--mono);color:var(--red);font-size:14px;margin-bottom:6px}.play span{font-size:14.5px}.gatenote{margin-top:18px;color:var(--muted);font-size:13.5px;line-height:1.7}
.grp{margin:44px 0 0}.grp:first-child{margin-top:0}
.grphead{display:flex;align-items:baseline;gap:14px;margin-bottom:18px;padding-bottom:12px;border-bottom:1px solid var(--border)}.grphead h2{font-size:20px;font-weight:600;margin:0}.grphead .gct{font-family:var(--mono);font-size:12px;color:var(--faint)}
.reel{background:var(--card);border:1px solid var(--border);border-radius:22px;padding:30px 34px;display:grid;grid-template-columns:300px 1fr;gap:42px;align-items:start;margin-bottom:22px}
.reel.partial{opacity:.65}
.stage{position:relative;border-radius:16px;overflow:hidden;aspect-ratio:9/16;background:#000;user-select:none}.stage .frm{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:none}.stage .frm.on{display:block}
.role{position:absolute;left:10px;top:10px;font-size:11px;font-weight:600;color:#fff;background:rgba(255,77,106,.92);padding:2px 9px;border-radius:7px;z-index:2}.ts{position:absolute;left:10px;bottom:10px;font-family:var(--mono);font-size:11px;color:#fff;background:rgba(0,0,0,.6);padding:2px 8px;border-radius:7px;z-index:2}
.nav{position:absolute;top:0;height:100%;width:50%;border:0;background:transparent;cursor:pointer;z-index:3;display:flex;align-items:center;opacity:.92;transition:opacity .15s}.nav.prev{left:0;justify-content:flex-start;padding-left:8px}.nav.next{right:0;justify-content:flex-end;padding-right:8px}.nav:hover{opacity:1}
.nav .chev{display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:rgba(0,0,0,.5);color:#fff;font-size:14px;line-height:1;box-shadow:0 1px 5px rgba(0,0,0,.45)}.nav:hover .chev{background:rgba(255,77,106,.95);transform:scale(1.08)}.nav.next .chev{animation:nudge 1.8s ease-in-out infinite}
@keyframes nudge{0%,100%{transform:translateX(0)}50%{transform:translateX(3px)}}
.dots{position:absolute;left:0;right:0;bottom:10px;display:flex;gap:5px;justify-content:center;z-index:4;pointer-events:none}.dots i{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.5);transition:all .15s}.dots i.on{background:#fff;width:16px;border-radius:3px}
.stephint{margin:8px 2px 0;font-family:var(--mono);font-size:10.5px;letter-spacing:.02em;color:var(--faint);text-align:center;text-transform:uppercase}
.fcount{position:absolute;right:10px;top:10px;font-family:var(--mono);font-size:11px;color:#fff;background:rgba(0,0,0,.6);padding:3px 9px;border-radius:8px;z-index:2}
.cap{font-size:12px;color:var(--muted);text-align:center;margin-top:11px}.cap b{color:var(--red)}
.igbtn{display:flex;align-items:center;justify-content:center;gap:10px;margin:14px auto 0;width:100%;background:var(--card-2);color:var(--text);border:1px solid var(--border);border-radius:999px;padding:9px 18px;font-size:13px;text-decoration:none}.igbtn .ic{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;color:#fff;background:radial-gradient(circle at 30% 107%,#fce6a4,#f06748 44%,#cc3d92 60%,#4a64d8 92%)}
.who{display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap}.who h2{font-size:24px;font-weight:600;margin:0}.pill-reel{font-size:11px;font-weight:600;letter-spacing:.08em;color:var(--red);border:1px solid var(--red-bd);background:var(--red-bg);border-radius:7px;padding:3px 9px}
.pill-warn{font-size:11px;font-weight:600;letter-spacing:.08em;color:var(--amber);border:1px solid rgba(240,183,62,.42);background:rgba(240,183,62,.08);border-radius:7px;padding:3px 9px}
.chips{display:flex;flex-wrap:wrap;gap:9px;margin-bottom:8px}.chip{display:inline-flex;align-items:center;gap:7px;font-family:var(--mono);font-size:13px;background:var(--card-2);border:1px solid var(--border);border-radius:9px;padding:6px 12px}.chip svg{width:14px;height:14px}.chip.heart svg{color:var(--heart)}.chip.cmt svg{color:var(--muted)}.chip.date{color:var(--muted)}.chip.date svg{color:var(--faint)}
.sec{margin-top:22px}.seclabel{font-size:11px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--faint);margin-bottom:9px}.hook{font-size:23px;font-weight:600;line-height:1.3}.ftag{display:inline-block;font-size:13.5px;font-weight:600;color:var(--amber);background:rgba(240,183,62,.08);border:1px solid rgba(240,183,62,.42);border-radius:10px;padding:7px 16px}.breakdown{font-size:15px;color:var(--muted);line-height:1.7}
details.tx{margin-top:22px;border:1px solid var(--border);border-radius:12px;background:var(--card-2)}details.tx summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding:13px 16px}details.tx summary::-webkit-details-marker{display:none}.lft{display:flex;align-items:center;gap:9px;font-size:12px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}.copybtn{font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text);background:#27272F;border:1px solid var(--border);border-radius:7px;padding:5px 12px;cursor:pointer}.tx-body{font-size:14.5px;line-height:1.85;color:var(--muted);padding:0 16px 16px}
.why{margin-top:22px;background:var(--red-bg);border:1px solid var(--red-bd);border-radius:14px;padding:16px 20px}.why .seclabel{color:var(--red)}.why p{margin:0;font-size:15px;line-height:1.7;color:#E7C9D0}
@media(max-width:780px){.reel{grid-template-columns:1fr}.plays{grid-template-columns:1fr}.statbar{grid-template-columns:repeat(2,1fr);gap:16px}}
/* Print / PDF export: show ALL storyboard frames as a filmstrip and expand transcripts */
@media print{
  .stage{aspect-ratio:auto;height:auto;background:transparent;display:flex;gap:4px}
  .stage .frm{position:static;display:block;width:24%;height:auto;aspect-ratio:9/16;border-radius:7px}
  .role,.ts,.nav,.fcount,.dots{display:none!important}
  details.tx>*:not(summary){display:block!important}
  details.tx summary .copybtn,details.tx summary .tri{display:none}
  .reel{break-inside:avoid;page-break-inside:avoid}
  .grp{break-inside:avoid}
}`;

// --- broken-ref self-check ---------------------------------------------------
function verifyRefs(html, baseDir) {
  const srcs = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]).filter((s) => !/^https?:|^data:/.test(s));
  const missing = srcs.filter((s) => !fs.existsSync(path.join(baseDir, decodeURIComponent(s))));
  return { total: srcs.length, missing };
}

// CLI
if (import.meta.url === new URL(`file://${fs.realpathSync(process.argv[1])}`).href) {
  const [dsPath, outPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!dsPath || !outPath) { console.error("usage: node render-swipe.mjs <dataset.json> <out.html>"); process.exit(1); }
  const ds = JSON.parse(fs.readFileSync(dsPath, "utf8"));
  const html = renderSwipe(ds);
  fs.writeFileSync(outPath, html);
  const { total, missing } = verifyRefs(html, path.dirname(path.resolve(outPath)));
  console.log(`wrote ${outPath} — ${total - missing.length}/${total} local image refs resolve`);
  if (missing.length) { console.error(`✗ ${missing.length} MISSING refs:\n  ${missing.slice(0, 10).join("\n  ")}`); process.exit(2); }
  console.log("✓ all image refs resolve");
}
