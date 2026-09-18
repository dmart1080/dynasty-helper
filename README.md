# Dynasty Helper

A personal dynasty fantasy football assistant for Sleeper leagues. Team value
dashboard, draft pick valuation, trade calculator, trade finder, and league
intelligence — mobile-first, because it is mostly used on a phone.

Scoring and roster settings are always read from the Sleeper API. Nothing about
superflex or PPR is hardcoded anywhere; point it at any league ID and it derives
the format from that league's `roster_positions` and `scoring_settings`.

---

## Read this first: verify your data sources

This project was built in a sandbox whose network policy **blocked
`api.sleeper.app` and `api.fantasycalc.com`** (HTTP 403 at the egress proxy, for
every client tried). Every live endpoint was therefore written against its
documented contract but could not be executed during development.

So before trusting a single number, run:

```bash
npm run verify:sources
```

It calls every endpoint the app depends on and reports, per endpoint, whether it
is reachable and whether the response satisfies the contract the code expects —
including printing FantasyCalc's actual element keys so you can see the real
shape. It exits non-zero if any contract fails.

If FantasyCalc has moved or changed:

- The base URL and path are config (`FANTASYCALC_BASE_URL`,
  `FANTASYCALC_VALUES_PATH`).
- All field mapping happens in **one function**, `normalizeEntry()` in
  `server/src/sources/fantasycalc.js`, which already accepts several spellings
  per field and degrades to `null` rather than throwing.

Until you have run the verifier successfully, treat the numbers as unverified.

---

## Setup

Requires **Node 22.5 or newer** (the app uses the built-in `node:sqlite`, so
there is no native module to compile and no build toolchain to install).

```bash
git clone <this repo>
cd dynasty-helper
npm install

npm run verify:sources          # confirm the APIs are reachable and unchanged
npm run migrate                 # create the SQLite schema
npm run sync                    # pull your league + player values

npm run dev                     # API on :5175, Vite dev server on :5173
```

Then open <http://localhost:5173> on your phone (same wifi — use your machine's
LAN IP) or your desktop.

For a single-process deployment:

```bash
npm run build
npm start                       # Express serves the built client on :5175
```

### On Windows

Everything works in PowerShell, with two things to know:

- **Do not run from `C:\Windows\system32`** — that is where PowerShell opens when
  launched as Administrator, and it is not writable. `cd $HOME` first.
- **Windows PowerShell 5.1 does not support `&&`.** Run chained commands on
  separate lines, or use PowerShell 7+ / `cmd`. Every command in this README is
  written one per line for that reason.

`npm run dev` starts both processes through `scripts/dev.js` rather than a shell
`&`, so it behaves identically on Windows, macOS and Linux.

### No network? Try it offline first

```bash
npm run sync -- --fixtures
```

This loads a deterministic synthetic 12-team superflex PPR league — 276 players,
30 days of value history, traded picks and a trade log — through the exact same
persistence code the live path uses. Every screen is fully functional. The UI
labels it as demo data so it can never be mistaken for your real league.

### Configuration

All optional; defaults are in `server/src/config.js`. Put overrides in `.env` or
the environment.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `5175` | API port |
| `DB_PATH` | `./data/dynasty.db` | SQLite file |
| `DEFAULT_LEAGUE_ID` | `1312193587416436736` | League loaded on first run |
| `DEFAULT_ROSTER_ID` | `1` | Which roster is yours |
| `FANTASYCALC_BASE_URL` | `https://api.fantasycalc.com` | Value source host |
| `FANTASYCALC_VALUES_PATH` | `/values/current` | Value source path |
| `PLAYERS_TTL_MS` | 24h | Sleeper asks that `/players/nfl` be pulled at most daily |
| `VALUES_TTL_MS` | 24h | One value snapshot per format per day |

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | API + client with hot reload |
| `npm start` | Production server (serves the built client) |
| `npm test` | 95 unit tests over the valuation modules |
| `npm run migrate` | Apply the schema (idempotent) |
| `npm run verify:sources` | Probe every endpoint and check its contract |
| `npm run sync` | Refresh the default league |
| `npm run sync -- <leagueId>` | Refresh a specific league |
| `npm run sync -- --force` | Ignore TTLs |
| `npm run sync -- --history` | Also walk `previous_league_id` for past-season trades |
| `npm run sync -- --fixtures` | Load the offline demo league |

---

## How it is put together

```
server/src/
  db/         schema.sql, connection, idempotent migration
  sources/    sleeper.js, fantasycalc.js, http.js (retry/timeout/logging), verify.js
  ingest/     players / league / values / transactions, plus the fixture loader
  valuation/  ← ALL value math. Pure functions. No I/O.
  services/   joins cached rows to values and calls the valuation modules
  routes/     thin HTTP layer, no math
client/src/   React pages: Dashboard, Team, Trade, Finder, Intel, Watchlist, Picks, Settings
```

**`valuation/` imports nothing but its own siblings** — no database, no HTTP, no
Express. That is what makes the numbers reproducible and unit-testable, and
`server/test/purity.test.js` fails the build if anyone breaks the rule.

### Caching and graceful degradation

- `/players/nfl` (~5 MB) is fetched at most **once per 24 hours**, gated on a
  stored timestamp, and decomposed into rows rather than stored as a blob.
- Player values are snapshotted **once per day per league format**, which is what
  gives you value history for free.
- League, roster and pick data refresh on demand.
- **Every fetch — success or failure — is logged** to `fetch_log`.
- A sync **never throws because a source is down**. Each stage fails
  independently and the report says which ones failed.
- Every API response carries a `meta` block with `stale`, the relevant
  timestamps and any warnings. The UI shows a banner — *"Showing cached data —
  league 6h ago, values 2026-09-15"* — instead of an error page.

### Data model

`leagues`, `users`, `rosters`, `players`, `traded_picks`, `drafts`,
`transactions`, `value_snapshots`, `pick_values`, `value_overrides`,
`watchlist`, `fetch_log`, `kv`.

Two keys matter:

- **`format_key`** (e.g. `dyn-sf-12t-1ppr`) partitions value snapshots by league
  format, so a 12-team superflex league and a 10-team 1QB league never share a
  value row.
- **`player_key`** is `sleeper:<id>` when FantasyCalc supplies a Sleeper ID, else
  `fc:<id>`. Overrides, the watchlist and history all key off the same string.

---

## Every formula

### League format derivation

From `roster_positions`, counting only starting slots (`BN`, `IR`, `TAXI`
dropped):

- `superflex` = at least one `SUPER_FLEX` slot
- `numQbs` = `count(QB) + (superflex ? 1 : 0)`, clamped to 1–2 — FantasyCalc
  models a superflex league as a 2QB league
- `ppr` = `scoring_settings.rec`
- `numTeams` = `total_rosters`

Flex eligibility: `FLEX` → RB/WR/TE · `WRRB_FLEX` → RB/WR · `REC_FLEX` → WR/TE ·
`SUPER_FLEX` → QB/RB/WR/TE.

### Optimal starting lineup

Slots are sorted by **restrictiveness** (fewest eligible positions first) and
filled greedily with the best available eligible player.

This is provably optimal here, not merely a heuristic: fantasy eligibility sets
are nested — `{QB} ⊂ SUPER_FLEX`, `{RB} ⊂ FLEX ⊂ SUPER_FLEX` — so a player taken
by a tighter slot could only ever have been used by a looser one, and the looser
slot always retains at least as many candidates. No search or backtracking is
needed.

The dashboard shows the *best legal* lineup, not the one currently set in Sleeper.

### Value-weighted average age

```
age = Σ(value_i × age_i) / Σ(value_i)
```

Weighting by value is the whole point: a 34-year-old WR5 should barely move the
number, while a 34-year-old WR1 should move it a lot. Players with no known age
are excluded from both sums. Age comes from Sleeper's `birth_date` (exact),
falling back to Sleeper's `age`, then FantasyCalc's `maybeAge`.

### Replacement level

For position P, `maxStartable(P)` = dedicated P slots + every flex slot P
qualifies for. Replacement level is the value of the player ranked
`numTeams × maxStartable(P)` among all players at P — the best player at that
position who would start for nobody if talent were spread evenly.

### Team classification — Contender / Middle / Rebuilder

Four signals, z-scored across the league and combined:

```
contendScore = 0.40·z(starterValue)    win-now firepower
             + 0.25·z(starterShare)    starterValue / totalValue — concentration
             + 0.20·z(vwAge)           older skews win-now
             + 0.15·z(winPct)          actual record
```

If a signal is unavailable (no games played yet, no ages), it is dropped and the
remaining weights renormalise by their own sum.

`contendScore ≥ +0.5` → **Contender** · `≤ −0.5` → **Rebuilder** · else
**Middle**. On a normal distribution that is roughly a 30/40/30 split.

The team page shows each z-score, so a classification is always explainable.

### Needs and surpluses

- **Need** at P: the team's starting value at P is below the league median.
  `severity = (median − teamValue) / median`, flagged above 0.25.
- **Surplus** at P: players at P **not in the team's optimal lineup**, counted
  only for their value above replacement level:
  `Σ max(0, value − replacementLevel(P))`.

Surplus is measured against the actual lineup rather than a per-position slot
count on purpose. Summing "TE can fill TE + FLEX + SUPER_FLEX" for every position
at once implies far more starting spots than the lineup really has, which hides
genuine depth in superflex leagues. Asking the solver who actually starts
resolves flex contention correctly.

### Draft pick valuation

**Generic value per round** comes from the value source's own pick entries when
it publishes them (FantasyCalc ships picks in the same feed with position `PI`).
Otherwise it falls back to rank anchors that scale with any value system and any
league size: round 1 ≈ the player ranked `2.8 × numTeams` overall, round 2 ≈
`5.5 ×`, round 3 ≈ `9 ×`, round 4 ≈ `13 ×`.

**Projected slot** — the "a rebuilder's 1st is worth more than a contender's 1st"
part. The original owner's `contendScore` ranks the teams; reversed, that is the
projected draft slot (rookie drafts run in reverse standings order). Within a
round:

```
pos  = (slot − 0.5) / numTeams                        ∈ (0,1)
mult = exp(−k·(pos − 0.5)) · k / (2·sinh(k/2))
```

`k` = 1.25 (round 1), 0.9 (round 2), 0.7 (round 3+) — later rounds are flatter.

That normaliser is deliberate: it makes the **mean multiplier across a round
exactly 1**. Projecting slots therefore *redistributes* pick value between teams
without inventing or destroying any, so total league pick value is identical in
both modes. There is a unit test asserting this.

In a 12-team league with k = 1.25, the 1.01 is worth 1.66× a generic 1st and the
1.12 is worth 0.53×.

**Uncertainty** — you cannot project a slot two years out, so the projection
regresses toward generic as the horizon grows, then takes an ordinary time
discount:

```
confidence = 0.6 ^ yearsOut          (100% → 60% → 36%)
value = generic × (confidence·mult + (1 − confidence)) × 0.85 ^ yearsOut
```

A toggle in the UI switches everything to flat generic values.

**Pick ownership**: Sleeper's `traded_picks` lists only picks that have moved, so
the app builds the full grid of (season × round × original roster) and applies
the traded rows over the top. Provenance is preserved — the *original* owner
drives the slot projection, the *current* owner holds the asset.

### Trade calculator

Raw value is the plain sum of what each side receives. Two named adjustments sit
on top, each reported separately so the number is never a black box.

**1. Consolidation premium** — to the side receiving the best single asset,
scaled by how far it outclasses the best asset coming back:

```
gap     = (bestIncoming − bestOutgoing) / bestIncoming     ∈ [0,1)
premium = 0.15 × gap × bestIncoming
```

A star-for-star swap earns nothing, which is the point: consolidation only
matters when one side genuinely lands the best player in the deal. Only one side
can ever collect it.

**2. Roster-spot cost** — not a fudge factor, the actual opportunity cost. Taking
in more bodies than you send means someone gets cut:

```
spotsNeeded = max(0, playersOnRoster − playersOut + playersIn − rosterLimit)
discount    = Σ values of the spotsNeeded lowest-valued players you would cut
```

The cut pool includes anything you just acquired, if it is worse than what you
already had. **Picks are excluded — they occupy no roster spot.**

```
adjusted = raw + consolidationPremium − rosterSpotCost
```

**Fairness** is the symmetric percentage difference:

```
pct = (adjustedA − adjustedB) / ((adjustedA + adjustedB) / 2)
```

| \|pct\| | Verdict |
|---|---|
| < 3% | Dead even |
| < 8% | Fair |
| < 15% | Clear edge |
| < 30% | Lopsided |
| ≥ 30% | Rejected instantly |

**"What to add to balance it"** does not just quote a number. The winning side
needs to send roughly the adjusted gap, so each candidate from their roster and
picks is **re-run through the full calculator** — adding a piece changes
consolidation and roster-spot cost too — and the three that land closest to even
are shown with their resulting fairness.

Both sides also get a **before/after optimal starting lineup**, with changed
slots highlighted, so the headline number stays grounded in whether the trade
actually improves what you start.

### Trade finder

**Partner fit** is complementarity in both directions:

```
fit = Σ_P [ mySurplus(P)·theirNeed(P) + myNeed(P)·theirSurplus(P) ]
      × (1 + 0.35 if opposite modes − 0.15 if same mode)
```

Surplus is normalised to 0–1 so it is commensurate with need severity.

**Package generation** covers 1-for-1, 2-for-1, 1-for-2 and 2-for-2 including
player+pick combinations. Every candidate is run through the full trade
calculator, not compared on raw value, and anything outside your value tolerance
is discarded.

**Ranking:**

```
score = objectiveGain / 1000
      + (1 − fairnessAbs / tolerance) × 2
      + partnerFit × 1.5
      + (myStarterDelta / 1000) × (contending ? 1.5 : 0.25)
```

`objectiveGain` weights incoming assets by your stated mode — rebuilders value
picks and youth (`(28 − age) / 8`), contenders value proven players and treat
picks as currency to spend. The starting-lineup term is weighted heavily when
contending, because a contender that does not start the players it acquires has
not improved anything, and lightly when rebuilding, where the payoff is
deliberately deferred.

**Diversity**: results are selected round-robin across package shapes, capped at
two ideas per partner, then re-sorted by score. Without this the list fills with
near-identical packages from whichever partner happens to fit best.

**Constraints**: untouchable players (never offered), target players (a package
must bring one back), max pieces per side, and value tolerance.

**Rationales** are assembled from the actual fit components — which of their
needs you are filling, which of yours they are filling, whether the timelines are
opposite, what happens to each lineup — and say plainly when a package does *not*
improve a contender's starting lineup.

### League intelligence

Trades are parsed from `transactions`, walking `previous_league_id` back through
prior seasons. Per manager: trade count and frequency, most frequent partners,
players and picks acquired versus sent, positions bought versus sold, and average
pieces per trade.

> **Caveat, surfaced in the UI:** trade values are computed at *today's* player
> values, not the values on the trade date. Historical values only exist from the
> day this app first ran.

### Manual overrides

Overrides are stored as a **percentage delta**, not an absolute value, so they
keep applying as the source values move. An absolute override would be silently
wiped by the next daily refresh — or worse, quietly go stale while still looking
authoritative. They feed every calculation: dashboard, calculator and finder.

---

## Tuning

Every constant above is a default exported from its module, and every function
takes an `opts` override:

- `TEAM_DEFAULTS` — classification weights and thresholds, need severity cutoff
- `PICK_DEFAULTS` — round decay `k`, slot confidence base, future discount, rank anchors
- `TRADE_DEFAULTS` — consolidation rate, roster-spot rate, verdict buckets
- `FINDER_DEFAULTS` — mode bonus/penalty, tolerance, partner and result caps

---

## Tests

```bash
npm test
```

95 tests over the valuation modules:

| File | Covers |
|---|---|
| `format.test.js` | superflex/2QB/1QB detection, PPR, flex eligibility, `maxStartable`, format keys |
| `lineup.test.js` | superflex QB preference, restrictiveness ordering, no double-assignment, value-weighted age |
| `picks.test.js` | multipliers averaging to 1, monotonicity, rebuilder-vs-contender 1sts, future decay, ownership expansion |
| `team.test.js` | replacement level, starter share, surplus, classification, weight renormalisation, need flagging |
| `trade.test.js` | consolidation symmetry, the 2-for-1 case, cut accounting, picks costing no spot, balancer ranking |
| `finder.test.js` | partner ranking, tolerance, untouchables, targets, piece limits, rationale quality |
| `overrides.test.js` | percentage application, clamping, invalid input |
| `purity.test.js` | enforces that `valuation/` never imports I/O |

---

## Known limitations

- **The live endpoints were never executed during development** (see the top of
  this file). Run `npm run verify:sources` before relying on any number.
- Trade-history values are computed at today's values, not the trade date's.
- TE-premium scoring (`bonus_rec_te`) is detected and displayed, but FantasyCalc's
  public endpoint takes no TEP parameter, so TE values are not TEP-adjusted.
  If your league is TE-premium, consider a manual override on your TEs.
- Pick valuation assumes rookie drafts run in reverse standings order. Leagues
  with a draft lottery will skew, most at the top of round 1.
- Projected slots use current-season strength for all future years; there is no
  attempt to age-curve a roster forward.
- IDP and kicker/defense positions are carried through the format derivation but
  are not valued — FantasyCalc's dynasty feed does not cover them.
