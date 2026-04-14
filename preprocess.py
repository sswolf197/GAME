#!/usr/bin/env python3
"""
preprocess.py — LILA telemetry preprocessor
Reads all Parquet day folders, decodes events, normalises coordinates,
tags bots, and writes one JSON file per day into public/data/.

Usage:
  python scripts/preprocess.py \
    --data-dir ./data \
    --out-dir ./public/data \
    --names-dir ./data

Coordinate mapping:
  World coords (x, z) → minimap pixel (px, py).
  Formula read from README — update MAP_CONFIG if your values differ.
  x axis = left/right on minimap
  z axis = top/bottom on minimap (z increases downward in image space)

  px = (x - world_min_x) / (world_max_x - world_min_x) * img_w
  py = (z - world_min_z) / (world_max_z - world_min_z) * img_h

  If your README gives explicit pixel offsets, set pixel_origin_* and pixel_scale_*
  directly in MAP_CONFIG instead.

Bot detection:
  A user_id is tagged as a bot if it never appears in the player names files
  (names_first_half.csv / names_second_half.csv). All events from that user_id
  get is_bot=True. The event type 'BotPosition' / 'BotKill' etc. also confirms bots.
"""

import argparse
import json
import os
import sys

import pandas as pd
import pyarrow.parquet as pq

# ---------------------------------------------------------------------------
# Map coordinate configuration
# Update world_min/max to match your README if they differ from these values
# which were derived empirically from the February_10 data sample.
# If README gives explicit pixel-to-world scale factors, replace the formula
# in world_to_pixel() accordingly.
# ---------------------------------------------------------------------------
MAP_CONFIG = {
    "AmbroseValley": {
        "world_min_x": -340, "world_max_x": 290,
        "world_min_z": -390, "world_max_z": 350,
        "img_w": 1024, "img_h": 1024,
        "minimap": "AmbroseValley.png",
    },
    "GrandRift": {
        "world_min_x": -240, "world_max_x": 260,
        "world_min_z": -200, "world_max_z": 180,
        "img_w": 1024, "img_h": 1024,
        "minimap": "GrandRift.png",
    },
    "Lockdown": {
        "world_min_x": -420, "world_max_x": 340,
        "world_min_z": -270, "world_max_z": 340,
        "img_w": 1024, "img_h": 1024,
        "minimap": "Lockdown.png",
    },
}

EVENT_TYPES = {
    "Position":       {"category": "movement", "is_bot": False},
    "BotPosition":    {"category": "movement", "is_bot": True},
    "Loot":           {"category": "loot",     "is_bot": False},
    "Kill":           {"category": "kill",     "is_bot": False},
    "Killed":         {"category": "death",    "is_bot": False},
    "BotKill":        {"category": "kill",     "is_bot": False},  # human killed bot
    "BotKilled":      {"category": "death",    "is_bot": True},   # bot was killed
    "KilledByStorm":  {"category": "storm",    "is_bot": False},
}


def world_to_pixel(x: float, z: float, cfg: dict) -> tuple[float, float]:
    """Map world (x, z) to minimap pixel (px, py). Clamps to [0, img_w/h]."""
    px = (x - cfg["world_min_x"]) / (cfg["world_max_x"] - cfg["world_min_x"]) * cfg["img_w"]
    py = (z - cfg["world_min_z"]) / (cfg["world_max_z"] - cfg["world_min_z"]) * cfg["img_h"]
    px = max(0.0, min(cfg["img_w"], px))
    py = max(0.0, min(cfg["img_h"], py))
    return round(px, 2), round(py, 2)


def load_day(folder: str) -> pd.DataFrame:
    frames = []
    for fname in os.listdir(folder):
        fpath = os.path.join(folder, fname)
        try:
            t = pq.read_table(fpath)
            frames.append(t.to_pandas())
        except Exception:
            continue
    if not frames:
        return pd.DataFrame()
    df = pd.concat(frames, ignore_index=True)
    return df


def decode_bytes_col(series: pd.Series) -> pd.Series:
    return series.apply(lambda x: x.decode("utf-8") if isinstance(x, bytes) else x)


def load_human_ids(names_dir: str) -> set:
    ids = set()
    for fname in ["names_first_half.csv", "names_second_half.csv"]:
        fpath = os.path.join(names_dir, fname)
        if os.path.exists(fpath):
            df = pd.read_csv(fpath)
            col = df.columns[0]
            ids.update(df[col].dropna().astype(str).tolist())
    return ids


def parse_ts(ts_str: str) -> float:
    """Convert 'MM:SS.s' timestamp to total seconds."""
    try:
        parts = str(ts_str).split(":")
        if len(parts) == 2:
            return float(parts[0]) * 60 + float(parts[1])
        return float(ts_str)
    except Exception:
        return 0.0


def strip_shard_suffix(match_id: str) -> str:
    """Remove '.nakama-N' suffix to get logical match UUID."""
    import re
    return re.sub(r"\.nakama-\d+$", "", str(match_id))


def process_day(df: pd.DataFrame, date_str: str, human_ids: set) -> dict:
    """Convert a day's DataFrame to the JSON structure consumed by the frontend."""
    for col in df.columns:
        if df[col].dtype == object:
            df[col] = decode_bytes_col(df[col])

    df["match_id_clean"] = df["match_id"].apply(strip_shard_suffix)
    df["ts_sec"] = df["ts"].apply(parse_ts)

    # Determine bot status: event type hint OR not in human names list
    def is_bot_row(row):
        ev = row.get("event", "")
        info = EVENT_TYPES.get(ev, {})
        if info.get("is_bot"):
            return True
        return str(row.get("user_id", "")) not in human_ids

    df["is_bot"] = df.apply(is_bot_row, axis=1)

    # Map coordinates
    df["px"] = 0.0
    df["py"] = 0.0
    for map_name, cfg in MAP_CONFIG.items():
        mask = df["map_id"] == map_name
        if mask.any():
            coords = df.loc[mask].apply(
                lambda r: world_to_pixel(r["x"], r["z"], cfg), axis=1
            )
            df.loc[mask, "px"] = coords.apply(lambda c: c[0])
            df.loc[mask, "py"] = coords.apply(lambda c: c[1])

    # Categorise events
    df["category"] = df["event"].apply(
        lambda e: EVENT_TYPES.get(e, {}).get("category", "other")
    )

    # Build output structure
    maps_out = {}
    for map_name in df["map_id"].unique():
        mdf = df[df["map_id"] == map_name].copy()
        cfg = MAP_CONFIG.get(str(map_name), {})
        matches_out = {}
        for match_id in mdf["match_id_clean"].unique():
            sub = mdf[mdf["match_id_clean"] == match_id].sort_values("ts_sec")
            events = []
            for _, row in sub.iterrows():
                events.append({
                    "uid":  str(row["user_id"])[:8],  # truncate for space
                    "px":   row["px"],
                    "py":   row["py"],
                    "x":    round(float(row["x"]), 2),
                    "z":    round(float(row["z"]), 2),
                    "ts":   round(float(row["ts_sec"]), 2),
                    "ev":   str(row["event"]),
                    "cat":  str(row["category"]),
                    "bot":  bool(row["is_bot"]),
                })
            matches_out[match_id] = {
                "events": events,
                "duration": round(float(sub["ts_sec"].max()), 2) if len(sub) else 0,
                "player_count": int(sub[~sub["is_bot"]]["user_id"].nunique()),
                "bot_count": int(sub[sub["is_bot"]]["user_id"].nunique()),
            }
        maps_out[str(map_name)] = {
            "minimap": cfg.get("minimap", f"{map_name}.png"),
            "img_w": cfg.get("img_w", 1024),
            "img_h": cfg.get("img_h", 1024),
            "matches": matches_out,
        }

    return {
        "date": date_str,
        "maps": maps_out,
        "event_counts": df["category"].value_counts().to_dict(),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir",  default="./data",        help="Root folder containing day subfolders")
    parser.add_argument("--out-dir",   default="./public/data", help="Where to write JSON output")
    parser.add_argument("--names-dir", default="./data",        help="Folder containing names_*.csv files")
    args = parser.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    human_ids = load_human_ids(args.names_dir)
    print(f"Loaded {len(human_ids)} human player IDs")

    # Auto-discover day folders (February_*, or any subfolder with parquet files)
    day_folders = []
    for entry in sorted(os.listdir(args.data_dir)):
        full = os.path.join(args.data_dir, entry)
        if os.path.isdir(full):
            day_folders.append((entry, full))

    if not day_folders:
        print(f"No day folders found in {args.data_dir}", file=sys.stderr)
        sys.exit(1)

    index = []
    for date_str, folder in day_folders:
        print(f"Processing {date_str}...")
        df = load_day(folder)
        if df.empty:
            print(f"  Skipping {date_str} — no readable parquet files")
            continue
        print(f"  {len(df):,} rows, {df['map_id'].nunique() if 'map_id' in df.columns else '?'} maps")
        out = process_day(df, date_str, human_ids)
        out_path = os.path.join(args.out_dir, f"{date_str}.json")
        with open(out_path, "w") as f:
            json.dump(out, f, separators=(",", ":"))
        size_kb = os.path.getsize(out_path) / 1024
        print(f"  → {out_path} ({size_kb:.0f} KB)")
        index.append({"date": date_str, "file": f"{date_str}.json"})

    # Write index.json so the frontend knows which dates are available
    index_path = os.path.join(args.out_dir, "index.json")
    with open(index_path, "w") as f:
        json.dump({"days": index}, f, indent=2)
    print(f"\nWrote index: {index_path}")
    print("Done.")


if __name__ == "__main__":
    main()
