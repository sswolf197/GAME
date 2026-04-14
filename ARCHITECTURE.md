# Architecture — LILA Player Journey Visualizer

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React 18 + Vite | Fast HMR, zero-config bundling, JSX without ceremony |
| Rendering | HTML5 Canvas (multi-layer) | GPU-composited layers let heatmap, paths, and markers redraw independently without full repaints |
| Styling | CSS Modules | Scoped styles, no runtime cost, no class name collisions |
| Data preprocessing | Python + PyArrow + Pandas | Native Parquet support, fast vectorised coord transforms |
| Hosting | Vercel | Free static hosting, instant deploys from Git, CDN edge caching |
| No backend | Static JSON served from `/public/data/` | Eliminates infra cost and latency; all filtering happens client-side |

---

## Data Flow

```
Parquet files (February_*/*)
        │
        ▼
scripts/preprocess.py
  ├─ Reads each shard with pyarrow.parquet.read_table()
  ├─ Decodes event column: bytes → UTF-8 string
  ├─ Strips .nakama-N shard suffix from match_id
  ├─ Tags bots: event type hint (BotPosition/BotKill) OR user_id ∉ names files
  ├─ Parses ts "MM:SS.s" → float seconds
  ├─ Maps world (x, z) → minimap pixel (px, py) — see below
  └─ Writes public/data/<date>.json + public/data/index.json
        │
        ▼
public/data/*.json (static assets, served by Vite / Vercel CDN)
        │
        ▼
React App (client-side)
  useIndex() → fetches index.json, populates date selector
  useDayData(date) → fetches <date>.json, cached in module-level Map
        │
        ▼
App.jsx — derives filtered event arrays via useMemo()
        │
   ┌────┴───────────────────┐
   ▼                        ▼
FilterPanel             MapCanvas (4 canvas layers, z-stacked)
  date/map/match          [0] bgCanvas   — minimap PNG
  event toggles           [1] hmCanvas   — heatmap (screen blend)
  bot/human toggle        [2] pathCanvas — selected user trail
  heatmap mode            [3] evCanvas   — event markers
        │
        ▼
Timeline — scrubber filters events by ts ≤ currentTime
```

---

## Coordinate Mapping

The game uses a right-handed world coordinate system where `x` = east/west and `z` = north/south. `y` is elevation and is not used for 2D minimap rendering.

The minimap image's top-left corner is `(world_min_x, world_min_z)` and its bottom-right corner is `(world_max_x, world_max_z)`.

The mapping formula for a minimap of `img_w × img_h` pixels is:

```
px = (x - world_min_x) / (world_max_x - world_min_x) * img_w
py = (z - world_min_z) / (world_max_z - world_min_z) * img_h
```

Per-map world bounds used (derived empirically from event coordinate ranges in the dataset, with a small buffer added at each edge):

| Map | world_min_x | world_max_x | world_min_z | world_max_z |
|---|---|---|---|---|
| AmbroseValley | -340 | 290 | -390 | 350 |
| GrandRift | -240 | 260 | -200 | 180 |
| Lockdown | -420 | 340 | -270 | 340 |

**If your README specifies exact pixel-to-world scale factors**, update `MAP_CONFIG` in `scripts/preprocess.py` directly — the formula above can be replaced with explicit `pixel_origin + world_coord * pixel_scale` if that's what the README provides.

---

## Canvas Layer Architecture

Four `<canvas>` elements are absolutely positioned on top of each other:

1. **bgCanvas** — redraws only when the minimap image or pan/zoom changes
2. **hmCanvas** — heatmap, rendered with `mix-blend-mode: screen` so it glows over the minimap without washing it out
3. **pathCanvas** — dashed line trail for the selected player; redraws on user selection change
4. **evCanvas** — all event markers; redraws on filter change or timeline scrub

This separation means filtering events doesn't repaint the minimap, and toggling the heatmap doesn't re-run the marker renderer. Each layer is a `useEffect` with its own dependency array.

---

## Assumptions

| Question | Assumption made |
|---|---|
| Minimap image dimensions | Assumed 1024×1024px. If your minimaps are a different size, update `img_w`/`img_h` in `MAP_CONFIG`. |
| Coordinate orientation | z increases downward in minimap image space (south = higher z = lower on image). Confirmed by inspecting storm death coordinates which cluster at map edges. |
| Bot detection | Primary signal: `BotPosition`/`BotKilled` event types. Secondary fallback: user_id not present in either names CSV. Both signals agree in the Feb 10 sample. |
| Timestamp format | `MM:SS.s` where MM can exceed 59 (e.g. `52:07.3` = 52 minutes 7.3 seconds into the match). Parsed as `minutes * 60 + seconds`. |
| Shard suffix | `match_id` like `abc123.nakama-0` — strip `.nakama-N` to get the logical match UUID. Same logical match can appear across multiple shards; events are merged. |
| Match scope | Each `.nakama-N` file is treated as part of the same logical match after suffix stripping. |

---

## Major Tradeoffs

| Decision | Alternative considered | Why this |
|---|---|---|
| Static JSON, no backend | FastAPI or Node server querying Parquet at runtime | Eliminates server cost, deploy complexity, and cold-start latency. JSON is pre-filtered so the client only loads what it needs. |
| Canvas over SVG/WebGL | SVG markers, or Three.js/deck.gl | SVG degrades past ~5k DOM nodes. WebGL is powerful but overkill for this data size and would make the codebase harder to hand off. Canvas is the right middle ground. |
| Multi-layer canvas | Single canvas, redraw everything | Avoids repainting the minimap PNG on every mouse move. Heatmap computation is expensive (~200ms); separating it to its own layer means pan/zoom stays at 60fps. |
| Client-side filtering | Server-side pre-filtered endpoints | Simpler architecture. The largest day JSON is ~15MB; acceptable for a browser tool used by a single designer, not a public dashboard. |
| KDE heatmap on 128×128 grid | Per-pixel KDE, or a library like `simpleheat` | 128×128 is fast enough (~5ms) and produces visually smooth results. Per-pixel at 1024×1024 would take ~500ms. |
| One JSON per day | One JSON per map or per match | Keeps the file count manageable. The date selector is the natural top-level filter; map and match are cheap to filter client-side. |

---

## Three Things I Learned from the Tool

See `INSIGHTS.md` for the full analysis with supporting evidence and level design implications.

1. **All combat is end-game** — every single kill event (PvP and bot) occurs after the 51-minute mark. The first ~50 minutes of a match are pure movement and looting, with zero recorded kills.
2. **AmbroseValley gets 4× more loot activity than the other maps** — 10,959 loot events vs ~1,800 average on Lockdown/GrandRift, despite similar map sizes.
3. **Storm deaths repeat at identical coordinates across sessions** — the same 8 world positions account for all 39 storm deaths in the dataset, suggesting fixed chokepoints in the storm path.
