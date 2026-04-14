# Insights — LILA BLACK Telemetry Analysis

> Data source: February 10 session data — 101,061 events, 160 players, 285 matches across 3 maps.
> All coordinate references are world units (x, z). Minimap positions can be verified visually in the tool.

---

## Insight 1: The entire first 50 minutes of every match has zero kills

### What caught my eye

When building the timeline scrubber, I noticed the event sparkline was completely flat for kills during the early and mid portions of matches. Querying the data confirmed it: **all 3,006 kill events (PvP + bot kills) occur between the 51- and 53-minute marks** across every match in the dataset.

- Bot kills: mean timestamp = **52:05**, std = 21 seconds
- PvP kills: all 6 events occur at exactly **51:56 or 52:07**
- Kill events before the 50-minute mark: **zero**

The first ~50 minutes of a match record only `Position`, `BotPosition`, and `Loot` events — pure movement and item collection, with no combat at all.

### What this likely means

The storm circle is large enough in the early game that players never come into contact. All engagements are forced by the final storm ring, which appears to converge around the 51-minute mark and compress players into a small enough area that fights become inevitable. This is structurally similar to a very slow-closing battle royale circle.

### Why a level designer should care

The current map geometry means ~96% of a match is a **completely uncontested loot and traverse phase**. If the design intent is earlier player agency and organic PvP, the current layout is not delivering it — players have 50 minutes of zero risk. Specific questions this raises:

- Are there any POIs or chokepoints in the mid-map that incentivise early aggressive positioning, or is the optimal strategy always to loot safely and wait for the storm?
- Does the loot distribution (see Insight 2) encourage players to spread out and avoid conflict during this phase, or are they already converging but just choosing not to fight?

**Actionable metrics to move:** Time-to-first-engagement per match, kill event distribution over match time.

**Actionable items:**
1. Add mid-game trigger events (high-value loot spawns, supply drops, bounty contracts) that reward players for entering contested space before the final circle.
2. Evaluate whether the storm's first two or three rings are closing fast enough to create meaningful positioning decisions.
3. Consider whether specific zones (identified in Insight 2) could be redesigned as natural early-game conflict points.

---

## Insight 2: AmbroseValley is carrying the game — the other maps are underutilised

### What caught my eye

The loot event breakdown across maps was immediately striking:

| Map | Loot events | Position events | Matches |
|---|---|---|---|
| AmbroseValley | **10,959** | 57,426 | 200 |
| Lockdown | 2,646 | 20,010 | 61 |
| GrandRift | 1,098 | 5,115 | 24 |

AmbroseValley has **4.1× more loot interactions** than Lockdown despite both maps covering roughly the same world-coordinate area (~43,000 sq. units each). It also accounts for 70% of all player activity on the day.

When I overlaid the loot heatmap on AmbroseValley specifically, activity clusters strongly in two zones:
- **Northeast quadrant** (x ≈ 145–200, z ≈ 42–110): 714 loot events — the single densest zone
- **Central-east corridor** (x ≈ 90–145, z ≈ -94 to -26): 654 events back-to-back with a third dense strip at (x ≈ 145–200, z ≈ -94 to -26)

The southwest and far-north regions of AmbroseValley are comparatively empty — consistent with 79% grid utilisation meaning roughly one-fifth of the map sees no player presence at all.

### Why a level designer should care

Two problems worth flagging:

**1. Map rotation imbalance.** If AmbroseValley is being played 3× as often as Lockdown and 8× as often as GrandRift, that's either a matchmaking weighting issue or players have discovered AmbroseValley delivers a better experience. Either way, the other maps are not pulling their weight in the rotation.

**2. Loot hotspot concentration.** On AmbroseValley, three adjacent grid cells account for a disproportionate share of all loot. This means most players are routing through the same 200×170 world-unit corridor in the northeast. If that corridor feeds directly into the final storm circle (consistent with Insight 1), it's both the optimal loot route and the final kill zone — making the map somewhat predictable and limiting emergent play.

**Actionable metrics to move:** Match count per map, loot event spread (Gini coefficient across grid cells), player density variance across the map.

**Actionable items:**
1. Audit GrandRift — with only 24 matches and 1,098 loot events it may have a spawn rate, spawn density, or minimap readability problem that's suppressing player selection.
2. Add high-value loot to the currently empty southwest/far-north sections of AmbroseValley to encourage off-route play.
3. Deliberately place a mid-tier POI in one of the dead zones identified in the traffic heatmap to see if it changes routing behaviour.

---

## Insight 3: Storm deaths cluster at exactly 8 fixed world positions — across every session

### What caught my eye

There are 39 storm death events (`KilledByStorm`) in the dataset. When I looked at the coordinates, the same positions repeat exactly — down to the floating-point value — across different match IDs and different sessions:

| Map | World position (x, z) | Occurrences |
|---|---|---|
| AmbroseValley | (-188.06, -227.68) | 3 |
| AmbroseValley | (-106.31, 297.82) | 3 |
| AmbroseValley | (-31.02, -205.09) | 3 |
| AmbroseValley | (18.11, -171.11) | 3 |
| AmbroseValley | (186.41, -330.64) | 3 |
| GrandRift | (-114.48, 89.31) | 3 |
| Lockdown | (-307.88, 130.99) | 3 |
| Lockdown | (-52.35, -105.90) | 3 |

Every single storm death occurs at one of these 8 positions. The 3× repetition rate matches the fact that February 10 is a single day with ~3 rotation cycles represented in the sample — so these positions are **perfectly reproduced every time the storm runs the same pattern**.

### What this means

The storm path is either fully deterministic (identical trajectory every match) or pseudo-random with a very small number of possible paths (at most 8 distinct terminal positions across 3 maps). Players who die to the storm do so at the same map locations regardless of session.

This is a significant level design signal: **the storm creates fixed "danger zones" that repeat predictably**. Players who learn these positions can route to avoid them. Players who don't get eliminated at the same chokepoints every run. The storm's design intent — dynamic, unpredictable zone pressure — is not being achieved if the exit vectors always resolve to the same 8 coordinates.

### Why a level designer should care

Storm deaths are supposed to punish poor positioning decisions organically. If those deaths always occur at the same places, it suggests the storm path is too deterministic — experienced players can memorise the safe routing and reliably survive while newer players repeatedly die at the same walls. This reduces the storm's role as a strategic pressure system.

**Actionable metrics to move:** Entropy of storm death coordinates (higher = more random, more pressure), storm death rate by player session count (new vs returning players).

**Actionable items:**
1. Increase the number of possible storm paths — even 3–4 paths would double the number of safe exits players need to consider.
2. Add terrain features (cover, elevation changes) at the 8 known death positions so players caught there have a fighting chance rather than an instant elimination.
3. Track whether experienced players (high session count) have a significantly lower storm death rate than new players — that delta will confirm whether the pattern is being exploited.
