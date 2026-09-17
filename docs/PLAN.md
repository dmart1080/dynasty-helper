# Dynasty Helper — Architecture & Data Model Plan

## 0. Environment finding that shapes everything

This build ran in a sandbox whose egress policy **blocks `api.sleeper.app` and
`api.fantasycalc.com`** (403 at the proxy, for both `curl` and the fetch tool).
So I could not execute a live call against either API, and I could not
personally verify the FantasyCalc endpoint the way you asked.

Rather than guess quietly, the design responds to this directly:

1. Every external response passes through a **validating adapter** with an
   explicit, documented expected shape. Field access is centralised in one
   mapping function per source, so a key that differs from expectation is a
   one-line fix, not a refactor.
2. `npm run verify:sources` is a **source doctor** you run on your own machine.
   It calls every endpoint this app depends on, prints the real status, the
   real response shape, and a PASS/FAIL per contract. That is the verification
   step, moved to the machine that can actually reach the internet.
3. The value provider is pluggable and the FantasyCalc base URL/params are
   config, so if the endpoint has moved, you change a config value.
4. Nothing is hardcoded about your league. Format is always derived from
   `roster_positions` + `scoring_settings`.

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| Storage | **`node:sqlite`** (built into Node ≥22.5) | Zero native deps — no node-gyp, no prebuild download. Synchronous API suits a single-user local app. |
| Backend | Node 22 + Express 5 | As specified. |
| Frontend | React 19 + Vite + React Router | As specified. Vite dev proxy → Express. |
| Tests | `node:test` + `node:assert` | Built in, no Jest/Vitest toolchain. |
| HTTP | native `fetch` | Node 22 has it. |

No ORM. Hand-written SQL in one `schema.sql`, applied by a tiny idempotent
migration runner.

## 2. Repo layout

```
server/src/
  db/         schema.sql, connection, migrate
  sources/    sleeper.js, fantasycalc.js, http.js (retry/timeout/ETag), verify.js
  ingest/     players.js, league.js, values.js, orchestrator
  valuation/  ← ALL value math lives here, pure functions, no I/O
                format.js  league format derivation
                lineup.js  optimal lineup solver
                picks.js   pick valuation
                team.js    team totals, classification, needs/surplus
                trade.js   consolidation, fairness, balance suggestions
                finder.js  partner matching + package generation
  routes/     thin HTTP layer, no math
server/test/  unit tests for every valuation module
client/src/   pages: Dashboard, Team, Trade, Finder, Intel, Watchlist, Settings
fixtures/     synthetic league + value fixtures used by tests
```

**Hard rule:** `valuation/` imports nothing from `db/`, `sources/`, or
`routes/`. It takes plain objects and returns plain objects. That is what makes
it testable, and it is enforced by a test that greps the imports.

## 3. Data model (SQLite)

```
leagues(league_id PK, name, season, total_rosters, roster_positions JSON,
        scoring_settings JSON, previous_league_id, status, format_key, fetched_at)
users(league_id, user_id PK*, display_name, team_name, avatar)
rosters(league_id, roster_id PK*, owner_id, players JSON, starters JSON,
        reserve JSON, taxi JSON, wins, losses, ties, fpts, fpts_against)
players(player_id PK, full_name, search_name, position, fantasy_positions JSON,
        team, birth_date, age, years_exp, status, injury_status, updated_at)
traded_picks(league_id, season, round, original_roster_id PK*, current_owner_id,
             previous_owner_id)
drafts(draft_id PK, league_id, season, rounds, type, status, slot_to_roster_id JSON)
transactions(transaction_id PK, league_id, type, status, week, season, created,
             roster_ids JSON, adds JSON, drops JSON, draft_picks JSON, ...)
value_snapshots(captured_on, source, format_key, player_key PK*, sleeper_id,
                name, position, value, overall_rank, position_rank,
                trend_30d, redraft_value, age)          ← one row per player per day
pick_values(captured_on, source, format_key, label PK*, round, slot_bucket, value)
value_overrides(player_key PK, sleeper_id, pct, note, updated_at)
watchlist(league_id, sleeper_id PK*, note, target_value, created_at)
fetch_log(id PK, source, url, ok, status, error, duration_ms, fetched_at)
kv(key PK, value)     -- players-file refresh stamp, sync state, settings
```

`format_key` (e.g. `dyn-sf-12t-1ppr`) partitions value snapshots so multiple
leagues with different formats never share a value row.

`player_key` is `sleeper:<id>` when FantasyCalc supplies a Sleeper ID,
else `fc:<id>`. Overrides and the watchlist key off the same string.

### Caching rules
- `/players/nfl` (~5 MB): fetched at most **once per 24 h**, gated on the `kv`
  stamp. Stored decomposed into the `players` table, not as a blob.
- Values: fetched at most once per day per format; a new `captured_on` row per
  day gives the value-history charts for free.
- League/rosters/picks: TTL of a few minutes, refreshable on demand.
- Every fetch — success or failure — writes a `fetch_log` row. Every API
  response carries `meta.stale`, `meta.fetchedAt` and `meta.warnings`, so the
  UI can show "cached from 6:12 PM — Sleeper unreachable" instead of an error.

## 4. The value math (every formula)

### 4.1 Format derivation — never hardcoded
From `roster_positions`, count only starting slots (drop `BN`/`IR`/`TAXI`).
- `superflex = count(SUPER_FLEX) > 0`
- `numQbs = count(QB) + (superflex ? 1 : 0)`, clamped to [1,2] → FantasyCalc param
- `ppr = scoring_settings.rec` (0 / 0.5 / 1)
- `numTeams = total_rosters`
- Flex eligibility: `FLEX`→RB/WR/TE, `WRRB_FLEX`→RB/WR, `REC_FLEX`→WR/TE,
  `SUPER_FLEX`→QB/RB/WR/TE

### 4.2 Optimal starting lineup
Slots are sorted by **restrictiveness** (fewest eligible positions first) and
filled greedily with the best available eligible player. Because the
eligibility sets are nested (`{QB} ⊂ SUPER_FLEX`, `{RB} ⊂ FLEX ⊂ SUPER_FLEX`),
greedy-by-restrictiveness is provably optimal here — no search needed.

### 4.3 Value-weighted average age
`Σ(value_i × age_i) / Σ(value_i)` over players with a known age. Age comes from
Sleeper `birth_date` (exact, to the day), falling back to Sleeper `age`, then
FantasyCalc `maybeAge`. Weighting by value is the point: a 34-year-old WR5
should not drag the number the way a 34-year-old WR1 does.

### 4.4 Replacement level (used by surplus, depth, and spot cost)
For position P, `maxStartable(P)` = dedicated P slots + flex slots P is eligible
for. Replacement level = the value of the player ranked
`numTeams × maxStartable(P)` among all P in the value feed — i.e. the best
player at P who would be on nobody's starting lineup if talent were evenly
spread.

### 4.5 Team classification — Contender / Middle / Rebuilder
Per the brief: starter value vs. total value, plus roster age. Four z-scores
across the league, combined:

```
contendScore = 0.40·z(starterValue)     win-now firepower
             + 0.25·z(starterShare)     starterValue / totalValue — concentration
             + 0.20·z(vwAge)            older skews win-now
             + 0.15·z(winPct)           actual record, when games have been played
```
Weights renormalise if a term is unavailable (e.g. week 0, no record yet).
`contendScore ≥ +0.5` → **Contender**, `≤ −0.5` → **Rebuilder**, else
**Middle**. On a normal distribution that is roughly a 30/40/30 split. All
weights and thresholds are config, exposed in Settings.

### 4.6 Needs and surpluses
- **Need** at P: team's starting value at P is below the league median.
  `severity = (median − teamValue) / median`, flagged when severity > 0.25.
- **Surplus** at P: players at P ranked beyond `maxStartable(P)` on the team.
  `surplus = Σ max(0, value − replacementLevel(P))`. This is the right measure
  because it counts only value your lineup *cannot use* and that another team
  would actually pay for.

### 4.7 Pick valuation
**Generic value per round** — from the value feed's own pick entries when the
feed supplies them; otherwise from rank anchors that scale with any value
system and league size: round 1 ≈ the player at overall rank `2.8 × numTeams`,
round 2 ≈ `5.5 ×`, round 3 ≈ `9 ×`, round 4 ≈ `13 ×`.

**Projected slot** (the "a rebuilder's 1st is worth more" part). The original
owner's `contendScore` ranks the teams; reversed, that is the projected draft
slot. Within a round, value is scaled by a normalised exponential:

```
pos  = (slot − 0.5) / numTeams                         ∈ (0,1)
mult = exp(−k·(pos − 0.5)) · k / (2·sinh(k/2))         mean over the round = 1
```
`k` = 1.25 (rd 1), 0.9 (rd 2), 0.7 (rd 3+) — later rounds are flatter. With
k=1.25 in a 12-team league, the 1.01 ≈ 1.72× a generic 1st and the 1.12 ≈ 0.52×.

**Uncertainty** — you cannot project a slot two years out, so the projection
regresses toward generic as the horizon grows:
```
confidence = 0.6 ^ yearsOut
value = generic × (confidence·mult + (1 − confidence)) × 0.85 ^ yearsOut
```
The trailing term is the ordinary future-pick discount. A toggle switches the
whole thing to flat generic values.

### 4.8 Trade calculator
Raw total is the plain sum. Two named, separately-reported adjustments:

**Consolidation premium** — to the side receiving the best single asset,
scaled by how much it outclasses the best asset coming back, so a
star-for-star swap earns nothing:
```
gap     = (bestIncoming − bestOutgoing) / bestIncoming        ∈ [0,1)
premium = 0.15 × gap × bestIncoming
```

**Roster-spot cost** — not a fudge factor; the actual opportunity cost. Taking
more bodies than you send means cutting someone:
```
spotsNeeded = max(0, playersIn − playersOut − openRosterSpots)
discount    = Σ values of the spotsNeeded lowest-valued players you'd have to cut
```
Picks are excluded — they take no roster spot.

`adjusted = raw + premium − discount`.

**Fairness**: `pct = (adjA − adjB) / ((adjA + adjB)/2)`, bucketed into
Dead even / Fair / X wins it / Clear win / Lopsided.

**Balance suggestion**: the winning side needs to send ≈ the adjusted gap.
Candidates in a band around that gap are pulled from their roster and picks,
each one re-run through the full calculator, and the three that land closest to
even are shown — not just "add a player worth 800".

### 4.9 Trade finder
Partner fit is complementarity in both directions:
```
fit = Σ_P [ mySurplus(P)·theirNeed(P) + myNeed(P)·theirSurplus(P) ]
      × (1 + oppositeModeBonus)
```
Package generation covers 1-for-1, 2-for-1, 1-for-2 and player+pick, filtered by
your constraints (untouchables, required targets, max pieces, value tolerance),
then ranked by fairness closeness plus *your* objective — starter-value gain if
contending, youth and pick capital if rebuilding. Each result carries a
generated plain-English rationale built from the actual fit components, so you
can see why the other manager might say yes.

## 5. Build phases

1. **Ingestion + schema + caching** — Sleeper & FantasyCalc adapters, source
   doctor, SQLite schema, daily caches, fetch logging.
2. **Team Value Dashboard + pick tracking** — format derivation, lineup solver,
   team totals, age profile, classification, needs/surplus, owned picks.
3. **Trade Calculator** — consolidation, roster-spot cost, fairness, balance
   suggestions, before/after lineups.
4. **Trade Finder** — partner scoring, package generation, constraints.
5. **League Intelligence** — trade history per manager, value-history charts,
   watchlist, manual overrides.

Mobile-first UI throughout: single column, bottom tab bar, 44px touch targets,
no horizontal scrolling, tables that collapse to cards under 640px.
