[🇰🇷 한국어](game-mechanics.md) · 🇬🇧 English

# Game Mechanics

Every number and trigger condition in Tokenova. The code constants are always the source of truth — this doc is a *current* snapshot.

## Stars

<p><img src="assets/atoms-star-anatomy.png" width="420" alt="Star size distribution — small 70% / medium 25% / large 5%" /></p>

A star is then rolled into one of 12 shapes. Larger stars are more likely to land on the exotic shapes (Diamond, Binary, Comet, …).

<p><img src="assets/atoms-star-zoo.png" width="640" alt="12 star shapes" /></p>

```
TOKENS_PER_STAR = 200_000       (src-tauri/src/engine/types.rs)
```

- Every 200,000 cumulative tokens adds one star.
- Leftover tokens (between thresholds) accumulate within the day. They reset at midnight rollover.
- The first star ever triggers the `first_star` achievement.
- Each star's coordinate is computed from `(universe_seed, star_index)` so the same index produces a different position each day (jittered to look natural).

## Planets

The 31-species catalogue. Per-tier rates are in the roulette table further down.

<p><img src="assets/atoms-planet-zoo.png" width="640" alt="31-planet catalogue — common / rare / epic / legendary / mythic" /></p>

A Mythic discovery takes over the popover with a full-screen overlay:

<p><img src="assets/moment-discovery.png" width="320" alt="Mythic discovery overlay — Dyson Sphere" /></p>

```
PLANET_SESSION_THRESHOLD = 1_000_000      (engine/types.rs)
FORCED_PLANET_TOKEN_THRESHOLD = 20_000_000 (session.rs)
IDLE_TIMEOUT_SECS = 5 * 60                (session.rs)
DAILY_PLANET_CAP = 10                     (engine/types.rs, Mythic excluded)
```

### Two trigger paths

1. **Idle close with ≥1M tokens** — a session auto-closes after 5 minutes without new events. If its total tokens are ≥1M, a planet roll fires.
2. **Active session crosses every 20M tokens** — within a still-active session, each 20M-token boundary fires a forced roll. A 50M session yields (20M + 40M chunk triggers = 2) + (idle close residual of 10M ≥1M = 1) = 3 total rolls.

`residual = total_tokens − triggered_chunks × 20M`. Idle close only fires an extra roll if residual ≥1M.

### Rarity roulette

```
Common     70.0 %
Rare       20.0 %
Epic        8.0 %
Legendary   1.9 %
Mythic      0.1 %
```

(See `*_WEIGHT` constants in `src-tauri/src/engine/catalog.rs`.)

The roulette uses PCG32 RNG seeded by `mix(universe_seed, session_id, total_tokens)`. The same trigger reproduces the same result.

### Species distribution

| Rarity | Species count | Examples |
|---|---|---|
| Common | 12 | Earth-like · Gas Giant · Martian · Ice Giant · Dead World · Lava World · Crystal · Ocean World · Desert · Mist · Volcanic · Jungle |
| Rare | 10 | Storm · Pearl · Amethyst · Emerald · Mirror · Botanical · Mystic · Twilight · Nocturnal · Multi-ocean |
| Epic | 5 | Diamond · Rainbow · Mask · Golden · Grid |
| Legendary | 2 | Eye World · Ancient Civilisation |
| Mythic | 2 | Dyson Sphere · Black Hole |

Once a planet is rolled, species is uniform within the rarity bucket. **30 species total = 12 + 10 + 5 + 2 + 2 (exact).**

### Daily cap

- Up to 10 planets per day. The 11th attempt returns `CapReached`.
- **Mythic ignores the cap.** You can hit 10 and still see a Mythic that day.

### Placement rules

- `find_empty_position` — up to 200 attempts.
- ≥90 world units away from any other planet (sprite is ~76 units; 14 of buffer).
- ≥18 world units away from any star.
- Stays 120 units inside the world edges.
- Skips the bottom 260 units (where the Today HUD overlays).
- If no candidate clears every bar: best with planet gap → roomiest → final random fallback.

## Galaxy tiers

The seed picks one of six layouts each day — `spiral · elliptical · irregular · dual_cluster · scattered · core_heavy`.

<p><img src="assets/atoms-galaxy-types.png" width="640" alt="6 galaxy layout types" /></p>

A canvas at the daily cap, sitting in Mega Galaxy tier:

<p><img src="assets/moment-megagalaxy.png" width="320" alt="Mega galaxy at the daily cap" /></p>

Classified at midnight close-out based on that day's total stars.

```
Stars             Tier
0                Black Hole       (잠든 우주 / sleeping universe)
1 – 30           Nebula
31 – 100         Cluster
101 – 300        Galaxy
301 – 999        Mega Galaxy
1000+            Supercluster
```

(See `engine/types.rs::GalaxyType::classify`.)

The moment you cross 100 stars in a day, a tray notification "galaxy formed" fires.

## Constellations

While drawing, an action bar drops down. Constellation colours cycle through a 5-tone palette as you register them.

<p>
  <img src="assets/moment-drawing-mode.png" width="320" alt="Constellation drawing mode" />
  <img src="assets/atoms-constellation-colors.png" width="320" alt="5-color constellation palette" />
</p>

- User-drawn by clicking stars on Today. Minimum of 2 stars to save.
- Name: blank input falls back to a deterministic auto-name (`adjective + subject + 자리 / Constellation`).
  - Korean pool: `사슴 / 곰 / 용 / 학 / …` × `빛나는 / 잠든 / 날아가는 / …`
  - English pool: `Stag / Bear / Dragon / Crane / …` × `Radiant / Sleeping / Soaring / …`
- Saved as a mini canvas in the Codex's Constellations subtab. Can be toggled as an overlay above its parent galaxy.

## Achievements

18 total. Keys and triggers:

| Key | Category | Trigger |
|---|---|---|
| `first_star` | starter | First-ever star added |
| `first_planet` | starter | First-ever planet discovered |
| `first_universe` | starter | First time hitting 100 stars (= Galaxy tier) |
| `first_constellation` | starter | First constellation saved |
| `codex_quarter` | collection | 8 species discovered |
| `codex_half` | collection | 15 species discovered |
| `codex_complete` | collection | All 30 species discovered |
| `first_rare_planet` | collection | First Rare-or-higher discovery |
| `first_legendary_planet` | collection | First Legendary |
| `first_mythic_planet` | collection | First Mythic |
| `first_black_hole` | time | First sleeping-universe day (zero tokens for a full day) |
| `first_mega_galaxy` | time | First Mega Galaxy / Supercluster close-out |
| `night_owl` | rhythm | 10 cumulative hours between midnight and 4 AM (engine work-in-progress) |
| `early_bird` | rhythm | 10 cumulative hours between 5–8 AM (engine work-in-progress) |
| `streak_7` | anniversary | 7 consecutive days of forming a universe |
| `streak_30` | anniversary | 30 consecutive days |
| `streak_100` | anniversary | 100 consecutive days |
| `streak_365` | anniversary | 365 consecutive days |

(See `src-tauri/src/engine/achievements.rs`.)

Each achievement records once (idempotent insert). Earning one fires an OS tray notification plus an in-app emit.

## Rest day (sleeping universe)

A day that closes at zero tokens swaps the star canvas for a quiet moon-and-mist scene. The `first_black_hole` achievement fires.

<p><img src="assets/moment-restday.png" width="320" alt="Rest day — sleeping universe" /></p>

## Midnight rollover

- Runs at the user's local-time midnight.
- Stamps the previous universe with its `galaxy_type` + `finalized_at`.
- Auto-creates a fresh row for the new day.
- Resets token counters + leftover + that-day star count to 0.
- Stars, planets, and constellations stay permanently attached to their date's universe row → replayable in the Gallery.

## Notification policy

```
Off       no notifications
Standard  Rare+ planets, achievements, 100-star galaxy, midnight close-out only
Verbose   includes Common-tier planets
DAILY_CAP = 5
```

(See `src-tauri/src/notifier.rs`.)

The current build pins to Standard. Once the day's 5-notification cap is hit, the rest go silent until midnight reset.
