/**
 * Trade Finder. Pure module.
 *
 * Finds partners whose surplus matches your needs and whose needs match your
 * surplus, then generates concrete packages you could actually send.
 *
 * Partner fit is complementarity in both directions:
 *   fit = Σ_P [ mySurplus(P)·theirNeed(P) + myNeed(P)·theirSurplus(P) ]
 * scaled by a bonus when they are in the opposite mode to you — a rebuilder is
 * the natural counterparty for a contender and vice versa.
 */
import { CORE_POSITIONS } from './format.js';
import { evaluateTrade } from './trade.js';
import { round, clamp } from './stats.js';

export const FINDER_DEFAULTS = {
  oppositeModeBonus: 0.35,
  sameModeePenalty: 0.15,
  valueTolerance: 0.05,      // packages must land within ±5% by default
  maxPiecesPerSide: 2,
  maxPartners: 6,
  maxResults: 12,
  // Candidate pruning: only consider assets above this fraction of the best
  // asset in the pool, to keep the search space sane on deep rosters.
  minAssetFraction: 0.04,
};

const isPick = (a) => a.position === 'PICK' || String(a.id ?? '').startsWith('pick:');

/** Normalised need/surplus vectors for a team, for the fit dot-product. */
function profile(team) {
  const needs = {}, surplus = {};
  for (const pos of CORE_POSITIONS) {
    const p = team.byPosition?.[pos] ?? {};
    needs[pos] = Math.max(0, p.needSeverity ?? 0);
    surplus[pos] = Math.max(0, p.surplusValue ?? 0);
  }
  // Scale surplus into 0..1 so it is commensurate with need severity.
  const maxSurplus = Math.max(1, ...Object.values(surplus));
  for (const pos of CORE_POSITIONS) surplus[pos] /= maxSurplus;
  return { needs, surplus };
}

/** Score how well one partner complements my team. */
export function scorePartner(me, them, opts = {}) {
  const cfg = { ...FINDER_DEFAULTS, ...opts };
  const mine = profile(me);
  const theirs = profile(them);

  let iGive = 0, iGet = 0;
  const reasons = [];
  for (const pos of CORE_POSITIONS) {
    const give = mine.surplus[pos] * theirs.needs[pos];
    const get = mine.needs[pos] * theirs.surplus[pos];
    iGive += give;
    iGet += get;
    if (give > 0.1) reasons.push({ kind: 'give', position: pos, strength: round(give, 3) });
    if (get > 0.1) reasons.push({ kind: 'get', position: pos, strength: round(get, 3) });
  }

  const base = iGive + iGet;
  const opposite = (me.mode === 'contender' && them.mode === 'rebuilder')
    || (me.mode === 'rebuilder' && them.mode === 'contender');
  const same = me.mode === them.mode && me.mode !== 'middle';

  const multiplier = 1 + (opposite ? cfg.oppositeModeBonus : 0) - (same ? cfg.sameModeePenalty : 0);

  return {
    rosterId: them.rosterId,
    teamName: them.teamName,
    mode: them.mode,
    fit: round(base * multiplier, 4),
    baseFit: round(base, 4),
    opposite,
    same,
    iGive: round(iGive, 3),
    iGet: round(iGet, 3),
    reasons: reasons.sort((a, b) => b.strength - a.strength),
    theirNeeds: (them.needs ?? []).map((n) => n.position),
    theirSurpluses: (them.surpluses ?? []).map((s) => s.position),
  };
}

/** Rank every other team by fit. */
export function rankPartners(me, teams, opts = {}) {
  const cfg = { ...FINDER_DEFAULTS, ...opts };
  return teams
    .filter((t) => t.rosterId !== me.rosterId)
    .map((t) => scorePartner(me, t, cfg))
    .sort((a, b) => b.fit - a.fit)
    .slice(0, cfg.maxPartners);
}

/**
 * Assets a team would realistically move, filtered by the caller's constraints.
 * `myMode` shapes what I am willing to part with and what I want back.
 */
function tradeableAssets(team, { untouchable = [], minValue = 0 } = {}) {
  const block = new Set(untouchable.map(String));
  const all = [...(team.players ?? []), ...(team.picks ?? [])];
  return all.filter((a) => !block.has(String(a.id)) && Number.isFinite(a.value) && a.value >= minValue);
}

/** Does this asset help my stated objective? */
function objectiveGain(asset, mode) {
  if (mode === 'rebuild') {
    // Rebuilders want picks and youth.
    if (isPick(asset)) return 1.0;
    if (!Number.isFinite(asset.age)) return 0.5;
    return clamp((28 - asset.age) / 8, 0, 1);
  }
  // Contenders want proven, startable players now; picks are currency to spend.
  if (isPick(asset)) return 0.1;
  if (!Number.isFinite(asset.age)) return 0.6;
  return clamp((asset.age - 20) / 8, 0.2, 1);
}

/**
 * Generate and rank trade packages.
 *
 * @param {object} args
 *   me, partners (ranked), teamsById, format
 *   mode           'contend' | 'rebuild'
 *   untouchable    asset ids I will not trade
 *   targets        asset ids I specifically want back (if set, a package must include one)
 *   maxPieces      per side
 *   tolerance      max |fairness| for a package to be offered
 */
export function findTrades({ me, partners, teamsById, format, options = {} }) {
  const cfg = { ...FINDER_DEFAULTS, ...options };
  const mode = options.mode === 'rebuild' ? 'rebuild' : 'contend';
  const maxPieces = clamp(Number(cfg.maxPiecesPerSide) || 2, 1, 3);
  const tolerance = Number(cfg.valueTolerance) || FINDER_DEFAULTS.valueTolerance;
  const targets = new Set((options.targets ?? []).map(String));

  const myAssets = tradeableAssets(me, { untouchable: options.untouchable ?? [] });
  const myFloor = Math.max(...myAssets.map((a) => a.value), 1) * cfg.minAssetFraction;
  const myPool = myAssets.filter((a) => a.value >= myFloor).sort((a, b) => b.value - a.value);

  const results = [];

  for (const partner of partners) {
    const them = teamsById.get(partner.rosterId);
    if (!them) continue;

    const theirAssets = tradeableAssets(them, {});
    const theirFloor = Math.max(...theirAssets.map((a) => a.value), 1) * cfg.minAssetFraction;
    let theirPool = theirAssets.filter((a) => a.value >= theirFloor).sort((a, b) => b.value - a.value);

    // If I named targets, only packages that bring one back are interesting.
    if (targets.size > 0) {
      const hasTarget = theirPool.some((a) => targets.has(String(a.id)));
      if (!hasTarget) continue;
    }

    const myCombos = combinations(myPool, maxPieces);
    const theirCombos = combinations(theirPool, maxPieces)
      .filter((combo) => targets.size === 0 || combo.some((a) => targets.has(String(a.id))));

    for (const give of myCombos) {
      const giveValue = give.reduce((s, a) => s + a.value, 0);
      for (const get of theirCombos) {
        const getValue = get.reduce((s, a) => s + a.value, 0);

        // Cheap pre-filter on raw value before the expensive full evaluation.
        const denom = (giveValue + getValue) / 2;
        if (denom <= 0) continue;
        if (Math.abs(getValue - giveValue) / denom > tolerance * 3) continue;

        const evaluation = evaluateTrade({
          sideA: { team: me, assets: give },
          sideB: { team: them, assets: get },
          format,
        });
        if (evaluation.fairnessAbsPct > tolerance) continue;

        const objective = get.reduce((s, a) => s + objectiveGain(a, mode) * a.value, 0)
          - give.reduce((s, a) => s + objectiveGain(a, mode) * a.value, 0);

        results.push({
          partner: { rosterId: partner.rosterId, teamName: partner.teamName, mode: partner.mode, fit: partner.fit },
          shape: `${give.length}-for-${get.length}`,
          give: give.map(shape),
          get: get.map(shape),
          giveValue: round(giveValue),
          getValue: round(getValue),
          fairnessPct: evaluation.fairnessPct,
          fairnessAbsPct: evaluation.fairnessAbsPct,
          verdictLabel: evaluation.verdictLabel,
          myStarterDelta: evaluation.sideA.lineup.delta,
          theirStarterDelta: evaluation.sideB.lineup.delta,
          objectiveGain: round(objective),
          rationale: rationale({ me, them, partner, give, get, evaluation, mode }),
          // Ranked on four things:
          //   1. how well the incoming assets fit my stated objective
          //   2. how close to fair it lands
          //   3. how well the partner complements me
          //   4. what it does to my STARTING lineup — heavily weighted when
          //      contending, since a contender that does not start the players
          //      it acquires has not improved anything; lightly weighted when
          //      rebuilding, where the payoff is deliberately deferred
          score: round(
            objective / 1000
            + (1 - evaluation.fairnessAbsPct / Math.max(tolerance, 1e-6)) * 2
            + partner.fit * 1.5
            + (evaluation.sideA.lineup.delta / 1000) * (mode === 'contend' ? 1.5 : 0.25), 4),
        });
      }
    }
  }

  // Keep the field varied. Without this the list fills with near-identical
  // packages from whichever partner happens to fit best, while the brief asks
  // for a spread of 1-for-1, 2-for-1 and player+pick shapes.
  //
  // Round-robin across shapes: repeatedly take the best remaining package of
  // each shape, skipping partners that already have two ideas in the list. That
  // guarantees every shape that produced a viable package is represented before
  // any one shape fills the board.
  const limit = Number(cfg.maxResults) || FINDER_DEFAULTS.maxResults;
  const sorted = results.sort((a, b) => b.score - a.score);

  const byShape = new Map();
  for (const r of sorted) {
    if (!byShape.has(r.shape)) byShape.set(r.shape, []);
    byShape.get(r.shape).push(r);
  }

  const cursors = new Map([...byShape.keys()].map((k) => [k, 0]));
  const perPartner = new Map();
  const picked = [];
  const deferred = [];

  let progressed = true;
  while (picked.length < limit && progressed) {
    progressed = false;
    for (const [shapeKey, list] of byShape) {
      if (picked.length >= limit) break;
      let i = cursors.get(shapeKey);
      while (i < list.length) {
        const candidate = list[i];
        i++;
        const count = perPartner.get(candidate.partner.rosterId) ?? 0;
        if (count >= 2) { deferred.push(candidate); continue; }
        perPartner.set(candidate.partner.rosterId, count + 1);
        picked.push(candidate);
        progressed = true;
        break;
      }
      cursors.set(shapeKey, i);
    }
  }

  // If the per-partner cap left the list short, backfill with the best of the rest.
  for (const r of deferred) {
    if (picked.length >= limit) break;
    if (!picked.includes(r)) picked.push(r);
  }

  // Diversity decides what makes the list; score still decides the order.
  return picked.sort((a, b) => b.score - a.score).slice(0, limit);
}

const shape = (a) => ({
  id: a.id, name: a.name, position: a.position, team: a.team ?? null,
  age: a.age ?? null, value: round(a.value), isPick: isPick(a),
  season: a.season ?? null, round: a.round ?? null,
});

/** All combinations of size 1..max, largest assets first. */
function combinations(pool, max) {
  const out = pool.map((a) => [a]);
  if (max >= 2) {
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) out.push([pool[i], pool[j]]);
    }
  }
  if (max >= 3) {
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        for (let k = j + 1; k < pool.length; k++) out.push([pool[i], pool[j], pool[k]]);
      }
    }
  }
  return out;
}

/**
 * Why the other manager might say yes — assembled from the actual fit
 * components, not a generic template.
 */
function rationale({ me, them, partner, give, get, evaluation, mode }) {
  const parts = [];

  const givePositions = [...new Set(give.filter((a) => !isPick(a)).map((a) => a.position))];
  const theirNeeds = new Set(partner.theirNeeds);
  const filled = givePositions.filter((p) => theirNeeds.has(p));
  if (filled.length) {
    parts.push(`${them.teamName} is below the league median at ${filled.join(' and ')}, and this sends them ${filled.join('/')} help.`);
  }

  const getPositions = [...new Set(get.filter((a) => !isPick(a)).map((a) => a.position))];
  const myNeeds = new Set((me.needs ?? []).map((n) => n.position));
  const fixes = getPositions.filter((p) => myNeeds.has(p));
  if (fixes.length) parts.push(`It fills your weakest spot at ${fixes.join(' and ')}.`);

  const picksIn = get.filter(isPick);
  const picksOut = give.filter(isPick);
  if (picksIn.length && them.mode === 'contender') {
    parts.push(`They are a contender, so the ${picksIn.map((p) => `${p.season} ${p.round}${ord(p.round)}`).join(' and ')} costs them little of what they care about.`);
  } else if (picksOut.length && mode === 'contend') {
    parts.push(`You are spending ${picksOut.length === 1 ? 'a pick' : 'picks'} you would not use while contending.`);
  } else if (picksIn.length && mode === 'rebuild') {
    parts.push(`The pick capital is exactly what a rebuild needs.`);
  }

  if (partner.opposite) {
    parts.push(`They are in ${them.mode} mode while you are ${mode === 'contend' ? 'contending' : 'rebuilding'} — opposite timelines make a deal easier.`);
  }

  if (evaluation.sideB.lineup.delta > 0 && evaluation.sideA.lineup.delta > 0) {
    parts.push('Both starting lineups improve, which is the easiest kind of trade to get accepted.');
  } else if (evaluation.sideB.lineup.delta > 0) {
    parts.push(`Their starting lineup gains ${Math.round(evaluation.sideB.lineup.delta).toLocaleString()} immediately.`);
  }

  if (evaluation.sideB.consolidationPremium > 0) {
    parts.push(`They get the best single player in the deal, which managers consistently overpay for.`);
  }

  if (mode === 'contend' && evaluation.sideA.lineup.delta <= 0) {
    parts.push('Note: this does not improve your starting lineup, so it is depth or future value rather than a win-now move.');
  }

  if (!parts.length) parts.push('Values line up almost exactly, so it is an easy yes-or-no rather than a negotiation.');
  return parts.join(' ');
}

const ord = (n) => (['st', 'nd', 'rd'][n - 1] ?? 'th');
