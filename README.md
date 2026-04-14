# LILA Player Journey Visualizer

A browser-based telemetry visualization tool for LILA BLACK level designers. Explore player paths, kill zones, loot hotspots, and bot behaviour on live minimap imagery.

**Live demo:** `<your-vercel-url>`

---

## Features

- Player paths rendered on correct minimap with world → pixel coordinate mapping
- Visual distinction between human players (blue) and bots (green)
- Event markers: kills (✕), deaths (◆), loot (■), storm deaths (◆ purple)
- Filter by date, map, and individual match
- Timeline scrubber with playback speed control and event density sparkline
- Heatmap overlays: kill zones, death zones, traffic density, storm deaths
- Pan and zoom (scroll wheel + drag)
- Click any marker to highlight that player's full path

---

## Tech Stack

- **React 18** + **Vite 5** — frontend
- **HTML5 Canvas** (4-layer compositing) — rendering
- **Python 3 + PyArrow + Pandas** — data preprocessing
- **Vercel** — hosting

---

## Setup

### 1. Prerequisites

```bash
node >= 18
python >= 3.9
pip install pyarrow pandas
```

### 2. Preprocess the data

Place your day folders (`February_10/`, `February_11/`, etc.) and names CSVs inside a `./data/` directory at the repo root.

```
lila-viz/
  data/
    February_10/      ← parquet shards
    February_11/
    names_first_half.csv
    names_second_half.csv
```

Then run:

```bash
python scripts/preprocess.py \
  --data-dir ./data \
  --out-dir ./public/data \
  --names-dir ./data
```

This writes `public/data/index.json` and one `public/data/<date>.json` per day.

### 3. Copy minimap images

```bash
cp /path/to/AmbroseValley.png public/minimaps/
cp /path/to/Lockdown.png      public/minimaps/
cp /path/to/GrandRift.png     public/minimaps/
```

### 4. Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

### 5. Deploy

```bash
npm run build
npx vercel --prod
```

Or connect the repo to Vercel — it auto-detects Vite and builds on push.

---

## Environment Variables

None required for the static build. The app fetches JSON from `/data/` and images from `/minimaps/` — both served as static assets.

If you move to a separate API server in future, set `VITE_API_BASE` in `.env.local`:

```
VITE_API_BASE=https://your-api.example.com
```

---

## Coordinate Mapping

World bounds per map are configured in `scripts/preprocess.py` under `MAP_CONFIG`. Update `world_min_x/z` and `world_max_x/z` if your README specifies different values.

```
px = (x - world_min_x) / (world_max_x - world_min_x) * img_w
py = (z - world_min_z) / (world_max_z - world_min_z) * img_h
```

---

## Repo Structure

```
lila-viz/
  scripts/
    preprocess.py       ← Parquet → JSON pipeline
  src/
    components/
      MapCanvas.jsx     ← minimap + rendering
      FilterPanel.jsx   ← all filter controls
      Timeline.jsx      ← playback scrubber
      TopBar.jsx        ← legend + breadcrumb
    hooks/
      useData.js        ← data fetching + cache
    utils/
      heatmap.js        ← KDE heatmap renderer
      eventStyles.js    ← colour/icon constants
    App.jsx             ← root state + layout
  public/
    data/               ← preprocessed JSON (gitignored if large)
    minimaps/           ← minimap PNGs
  ARCHITECTURE.md
  INSIGHTS.md
```

---

## Data Notes

- `event` column in raw Parquet is bytes-encoded — decoded to UTF-8 in preprocessor
- `match_id` has a `.nakama-N` shard suffix — stripped to get logical match UUID
- `ts` is formatted as `MM:SS.s` where MM can exceed 59 (matches run ~52 minutes)
- Bot detection: `BotPosition`/`BotKilled` event types, plus user_ids absent from the names CSVs
