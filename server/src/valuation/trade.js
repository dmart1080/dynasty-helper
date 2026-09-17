/**
 * Trade calculator. Pure module.
 *
 * Raw value is the plain sum of what each side receives. On top of that sit two
 * named adjustments, reported separately so you can see where the number came
 * from rather than trusting a black box:
 *
 * 1. CONSOLIDATION PREMIUM — the side receiving the best single asset gets a
 *    bonus, scaled by how far that asset outclasses the best one going back.
 *    A star-for-star swap earns nothing, which is the point: consolidation only
 *    matters when one side is genuinely getting the best player in the deal.
 *
 *       gap     = (bestIncoming − bestOutgoing) / bestIncoming    ∈ [0,1)
 *       premium = rate × gap × bestIncoming
 *
 * 2. ROSTER-SPOT COST — not a fudge factor. Taking in more bodies than you send
 *    means someone gets cut, so the cost is exactly the value of the players
 *    you would have to drop, after accounting for empty roster spots. Picks are
 *    excluded because they occupy no roster spot.
 */
import { optimalLineup } from './lineup.js';
import { sum, round } from './stats.js';

export const TRADE_DEFAULTS = {
  consolidationRate: 0.15,
  rosterSpotRate: 1.0,
  // Fairness buckets, as a symmetric percentage difference.
  verdicts: [
    { max: 0.03, label: 'Dead even' },
    { max: 0.08, label: 'Fair' },
    { max: 0.15, label: 'Clear edge' },
    { max: 0.30, label: 'Lopsided' },
    { max: Infinity, label: 'Rejected instantly' },
  ],
};

const isPick = (asset) => asset.position === 'PICK' || String(asset.id ?? '').startsWith('pick:');
const best = (assets) => assets.reduce((m, a) => (a.value > (m?.value ?? -Infinity) ? a : m), null);

/**
 * Consolidation premium for one side.
 * Symmetric and self-limiting: only the side with the best asset can earn it.
 */
export function consolidationPremium(incoming, outgoing, opts = {}) {
  const rate = opts.consolidationRate ?? TRADE_DEFAULTS.consolidationRate;
  const bestIn = best(incoming)?.value ?? 0;
  const bestOut = best(outgoing)?.value ?? 0;
  if (bestIn <= 0 || bestIn <= bestOut) return { premium: 0, gap: 0, bestIn, bestOut, asset: null };

  const gap = (bestIn - bestOut) / bestIn;
  return {
    premium: rate * gap * bestIn,
    gap,
    bestIn,
    bestOut,
    asset: best(incoming),
  };
}

/**
 * Roster-spot cost for one side: the value actually lost to cuts.
 *
 * @param {object} args
 *   incoming/outgoing  assets moving each way
 *   roster             the side's current players (post-trade survivors are derived)
 *   rosterLimit        active roster size from roster_positions
 */
export function rosterSpotCost({ incoming, outgoing, roster, rosterLimit }, opts = {}) {
  const rate = opts.rosterSpotRate ?? TRADE_DEFAULTS.rosterSpotRate;
  const playersIn = incoming.filter((a) => !isPick(a));
  const playersOut = outgoing.filter((a) => !isPick(a));

  const outgoingIds = new Set(playersOut.map((a) => String(a.id)));
  const kept = (roster ?? []).filter((p) => !outgoingIds.has(String(p.id)));
  const afterTrade = kept.length + playersIn.length;
  const overflow = Math.max(0, afterTrade - (rosterLimit ?? Infinity));

  if (overflow === 0) {
    return { cost: 0, spotsNeeded: 0, cuts: [], openSpots: Math.max(0, (rosterLimit ?? 0) - afterTrade) };
  }

  // You cut your least valuable players — including anything you just acquired
  // if it is worse than what you already had.
  const cutPool = [...kept, ...playersIn].sort((a, b) => a.value - b.value).slice(0, overflow);
  return {
    cost: sum(cutPool, (p) => p.value) * rate,
    spotsNeeded: overflow,
    cuts: cutPool.map((p) => ({ id: p.id, name: p.name, position: p.position, value: round(p.value) })),
    openSpots: 0,
  };
}

/** Evaluate one side of the trade. */
function evaluateSide(side, opts) {
  const { incoming, outgoing, team, rosterLimit, startingSlots } = side;

  const raw = sum(incoming, (a) => a.value);
  const given = sum(outgoing, (a) => a.value);
  const consolidation = consolidationPremium(incoming, outgoing, opts);
  const spots = rosterSpotCost({ incoming, outgoing, roster: team.players, rosterLimit }, opts);

  // Before/after starting lineup, so the headline number is grounded in
  // something concrete: does this trade actually improve what you start?
  const outgoingIds = new Set(outgoing.map((a) => String(a.id)));
  const before = optimalLineup(team.players ?? [], startingSlots);
  const afterRoster = [
    ...(team.players ?? []).filter((p) => !outgoingIds.has(String(p.id))),
    ...incoming.filter((a) => !isPick(a)),
  ];
  const after = optimalLineup(afterRoster, startingSlots);

  return {
    rosterId: team.rosterId,
    teamName: team.teamName,
    mode: team.mode,
    incoming: incoming.map(shapeAsset),
    outgoing: outgoing.map(shapeAsset),
    rawIncoming: round(raw),
    rawOutgoing: round(given),
    netRaw: round(raw - given),
    consolidationPremium: round(consolidation.premium),
    consolidationGap: round(consolidation.gap, 3),
    consolidationAsset: consolidation.asset ? shapeAsset(consolidation.asset) : null,
    rosterSpotCost: round(spots.cost),
    spotsNeeded: spots.spotsNeeded,
    cuts: spots.cuts,
    openSpots: spots.openSpots,
    adjustedIncoming: round(raw + consolidation.premium - spots.cost),
    lineup: {
      beforeValue: round(before.starterValue),
      afterValue: round(after.starterValue),
      delta: round(after.starterValue - before.starterValue),
      after: after.assignments.map((a) => ({
        slot: a.slot,
        player: a.player ? shapeAsset(a.player) : null,
        changed: a.player ? !before.starters.some((b) => String(b.id) === String(a.player.id)) : false,
      })),
    },
    afterRoster,
  };
}

const shapeAsset = (a) => ({
  id: a.id, name: a.name, position: a.position, team: a.team ?? null,
  age: a.age ?? null, value: round(a.value), isPick: isPick(a),
});

/**
 * Evaluate a two-sided trade.
 *
 * @param {object} args
 *   sideA / sideB   { team, assets }  assets are what THAT side gives up
 *   format          league format (starting slots, roster size)
 */
export function evaluateTrade({ sideA, sideB, format }, opts = {}) {
  const cfg = { ...TRADE_DEFAULTS, ...opts };
  const startingSlots = format.startingSlots;
  const rosterLimit = format.rosterSize;

  const a = evaluateSide({
    incoming: sideB.assets, outgoing: sideA.assets,
    team: sideA.team, rosterLimit, startingSlots,
  }, cfg);
  const b = evaluateSide({
    incoming: sideA.assets, outgoing: sideB.assets,
    team: sideB.team, rosterLimit, startingSlots,
  }, cfg);

  const rawDiff = a.rawIncoming - b.rawIncoming;
  const adjDiff = a.adjustedIncoming - b.adjustedIncoming;
  const denom = (a.adjustedIncoming + b.adjustedIncoming) / 2;
  const pct = denom > 0 ? adjDiff / denom : 0;

  const winner = Math.abs(pct) < 0.03 ? null : (adjDiff > 0 ? 'A' : 'B');
  const winnerName = winner === 'A' ? a.teamName : winner === 'B' ? b.teamName : null;
  const label = cfg.verdicts.find((v) => Math.abs(pct) <= v.max)?.label ?? 'Lopsided';

  return {
    sideA: a,
    sideB: b,
    rawDiff: round(rawDiff),
    adjustedDiff: round(adjDiff),
    fairnessPct: round(pct, 4),
    fairnessAbsPct: round(Math.abs(pct), 4),
    winner,
    winnerName,
    verdictLabel: label,
    verdict: verdictText(label, winnerName, Math.abs(pct), a, b),
    gapToBalance: round(Math.abs(adjDiff)),
    settings: { consolidationRate: cfg.consolidationRate, rosterSpotRate: cfg.rosterSpotRate },
  };
}

/** Plain-English verdict. */
function verdictText(label, winnerName, absPct, a, b) {
  const p = `${Math.round(absPct * 100)}%`;
  if (!winnerName) return 'Dead even. Either side can take this without regret.';

  const loser = winnerName === a.teamName ? b : a;
  const winnerSide = winnerName === a.teamName ? a : b;
  const lineupNote = winnerSide.lineup.delta > 0 && loser.lineup.delta < 0
    ? ` ${winnerName} also gains ${Math.round(winnerSide.lineup.delta).toLocaleString()} of starting lineup value while ${loser.teamName} loses ${Math.abs(Math.round(loser.lineup.delta)).toLocaleString()}.`
    : '';

  switch (label) {
    case 'Fair':
      return `Close to fair — ${winnerName} comes out ${p} ahead, which is inside the noise of any value system.${lineupNote}`;
    case 'Clear edge':
      return `${winnerName} wins this by ${p}. Worth sending, but ${loser.teamName} has a reason to push back.${lineupNote}`;
    case 'Lopsided':
      return `Lopsided — ${winnerName} is up ${p}. ${loser.teamName} is unlikely to accept without more coming back.${lineupNote}`;
    default:
      return `${winnerName} is up ${p}. This reads as a rejected-instantly offer; rebalance it before sending.${lineupNote}`;
  }
}

/**
 * "What to add to balance it."
 *
 * The winning side needs to send roughly the adjusted gap. Rather than printing
 * a number, each candidate is run back through the full calculator — adding a
 * piece changes consolidation and roster-spot cost too — and the ones that land
 * closest to even are returned.
 */
export function suggestBalancers({ sideA, sideB, format, evaluation, candidatePool }, opts = {}) {
  const evalResult = evaluation ?? evaluateTrade({ sideA, sideB, format }, opts);
  if (!evalResult.winner) return [];

  const gap = Math.abs(evalResult.adjustedDiff);
  if (gap <= 0) return [];

  const winningIsA = evalResult.winner === 'A';
  const winnerSide = winningIsA ? sideA : sideB;
  const alreadyIn = new Set([...sideA.assets, ...sideB.assets].map((x) => String(x.id)));

  // Candidates come from the winning side's roster and picks.
  const pool = (candidatePool ?? [...(winnerSide.team.players ?? []), ...(winnerSide.team.picks ?? [])])
    .filter((x) => !alreadyIn.has(String(x.id)) && Number.isFinite(x.value) && x.value > 0);

  // A piece worth far more than the gap over-corrects; keep a sensible band.
  const banded = pool
    .filter((x) => x.value <= gap * 2.2)
    .sort((a, b) => Math.abs(a.value - gap) - Math.abs(b.value - gap))
    .slice(0, 12);

  const scored = banded.map((asset) => {
    const nextA = winningIsA
      ? { ...sideA, assets: [...sideA.assets, asset] }
      : sideA;
    const nextB = winningIsA
      ? sideB
      : { ...sideB, assets: [...sideB.assets, asset] };
    const result = evaluateTrade({ sideA: nextA, sideB: nextB, format }, opts);
    return {
      asset: shapeAsset(asset),
      from: winnerSide.team.teamName,
      resultingFairnessPct: result.fairnessPct,
      resultingAbsPct: result.fairnessAbsPct,
      resultingVerdict: result.verdictLabel,
      improved: result.fairnessAbsPct < evalResult.fairnessAbsPct,
    };
  });

  return scored
    .filter((s) => s.improved)
    .sort((a, b) => a.resultingAbsPct - b.resultingAbsPct)
    .slice(0, 3);
}
