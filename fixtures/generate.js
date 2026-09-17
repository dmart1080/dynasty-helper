/**
 * Synthetic league + value fixtures, shaped exactly like the real Sleeper and
 * FantasyCalc payloads.
 *
 * These exist because (a) the unit tests need deterministic data and (b) the
 * sandbox this was built in cannot reach either API, so the whole pipeline is
 * exercised through the same normalizers the live path uses.
 *
 * Deterministic: seeded PRNG, so the same fixture every run.
 */

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Jalen', 'Marcus', 'Trey', 'Devon', 'Caleb', 'Amari', 'Braxton', 'Tyreek', 'Jordan', 'Isaiah', 'Xavier', 'Cam', 'Deshaun', 'Kyren', 'Rashid', 'Malik', 'Elijah', 'Dalton', 'Quentin', 'Zay', 'Brock', 'Nico', 'Garrett', 'Roman', 'Tank', 'Hollywood', 'Kenneth', 'Bijan', 'Puka', 'Drake', 'Rome', 'Jaxon', 'Bo', 'Trevor', 'Anthony', 'Sam', 'Will', 'Michael', 'Chris', 'David'];
const LAST = ['Henderson', 'Wallace', 'Brooks', 'Coleman', 'Rivers', 'Dawkins', 'Mitchell', 'Sutton', 'Pryor', 'Ellington', 'Warren', 'Baldwin', 'Combs', 'Nabers', 'Odunze', 'Bowers', 'Thomas', 'Ferguson', 'Vaughn', 'Mays', 'Hutchins', 'Callaway', 'Sanders', 'Reeves', 'Kincaid', 'Downs', 'Flowers', 'Hall', 'Gibbs', 'Achane', 'Worthy', 'Legette', 'Corum', 'Wright', 'Jennings', 'Boyd', 'Frazier', 'Kelce', 'Lamb', 'Adams'];
const TEAMS = ['ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC', 'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS'];
const MANAGERS = ['dynastydylan', 'GridironGus', 'TheCommish', 'RebuildRick', 'WinNowWade', 'PickHoarder', 'TradeBaitTom', 'ZeroRBZane', 'SuperflexSam', 'TaxiSquadTy', 'ChaseTheRing', 'PatientPaul'];
const TEAM_NAMES = ['Dylan\'s Dynasty', 'Gus Bus', 'Order of the Commish', 'Full Teardown', 'All In 2026', 'Draft Capital LLC', 'Open For Business', 'Hero RB Truthers', 'Two QB Problem', 'Taxi Squad Heroes', 'Ring Chasers', 'The Long Game'];

/** Per-position value curve: value of the nth-best player at a position. */
function valueCurve(position, rank, superflex) {
  const cfg = {
    QB: { top: superflex ? 10200 : 6200, decay: 0.052 },
    RB: { top: 7600, decay: 0.075 },
    WR: { top: 9800, decay: 0.040 },
    TE: { top: 6400, decay: 0.105 },
  }[position] ?? { top: 900, decay: 0.15 };
  return Math.max(12, Math.round(cfg.top * Math.exp(-cfg.decay * (rank - 1))));
}

const POSITION_POOL = [
  { position: 'QB', count: 42 },
  { position: 'RB', count: 78 },
  { position: 'WR', count: 110 },
  { position: 'TE', count: 46 },
];

export function generateFixtures({ seed = 20260917, leagueId = '1312193587416436736', numTeams = 12 } = {}) {
  const rand = mulberry32(seed);
  const season = '2026';
  const superflex = true;

  // ---- Player universe (Sleeper /players/nfl shape) ----
  const players = {};
  const universe = [];
  let nextId = 1000;
  let nameIdx = 0;

  for (const { position, count } of POSITION_POOL) {
    for (let rank = 1; rank <= count; rank++) {
      const id = String(nextId++);
      const first = FIRST[nameIdx % FIRST.length];
      const last = LAST[Math.floor(nameIdx / FIRST.length + nameIdx * 7) % LAST.length];
      nameIdx++;
      const fullName = `${first} ${last}${nameIdx > FIRST.length ? ` ${['II', 'Jr.', 'Sr.', 'III'][nameIdx % 4]}` : ''}`.trim();

      // Better players skew slightly younger in dynasty; add spread.
      const yearsExp = Math.floor(rand() * 11);
      const age = Math.round((22 + yearsExp + rand() * 2) * 10) / 10;
      const birthYear = 2026 - Math.floor(age);
      const birthMonth = String(1 + Math.floor(rand() * 12)).padStart(2, '0');
      const birthDay = String(1 + Math.floor(rand() * 28)).padStart(2, '0');

      players[id] = {
        player_id: id,
        first_name: first,
        last_name: last,
        full_name: fullName,
        search_full_name: fullName.toLowerCase().replace(/[^a-z]/g, ''),
        position,
        fantasy_positions: [position],
        team: TEAMS[Math.floor(rand() * TEAMS.length)],
        birth_date: `${birthYear}-${birthMonth}-${birthDay}`,
        age: Math.floor(age),
        years_exp: yearsExp,
        status: 'Active',
        injury_status: rand() < 0.06 ? 'Questionable' : null,
        number: 1 + Math.floor(rand() * 98),
        college: 'State',
      };

      // Value has noise so positional rank != overall rank ordering exactly.
      const base = valueCurve(position, rank, superflex);
      const value = Math.max(10, Math.round(base * (0.88 + rand() * 0.24)));
      universe.push({ id, position, positionRank: rank, value, age, fullName });
    }
  }

  universe.sort((a, b) => b.value - a.value);
  universe.forEach((p, i) => { p.overallRank = i + 1; });

  // ---- FantasyCalc values feed ----
  const fcValues = universe.map((p) => ({
    player: {
      id: Number(p.id),
      name: p.fullName,
      mflId: String(9000 + Number(p.id)),
      sleeperId: p.id,
      position: p.position,
      maybeBirthday: players[p.id].birth_date,
      maybeAge: p.age,
      maybeYoe: players[p.id].years_exp,
      espnId: String(40000 + Number(p.id)),
    },
    value: p.value,
    overallRank: p.overallRank,
    positionRank: p.positionRank,
    trend30Day: Math.round((rand() - 0.45) * p.value * 0.12),
    redraftDynastyValueDifference: 0,
    redraftValue: Math.round(p.value * (0.7 + rand() * 0.5)),
    combinedValue: p.value,
    maybeMovingStandardDeviation: null,
    displayTrend: true,
    maybeOwner: null,
    starter: p.overallRank <= numTeams * 9,
    maybeTier: 1 + Math.floor(p.overallRank / 12),
    maybeAdp: p.overallRank,
    maybeTradeFrequency: Math.round(rand() * 100) / 100,
  }));

  // FantasyCalc ships picks in the same feed with position "PI".
  const pickRows = [];
  for (const yr of ['2026', '2027', '2028']) {
    const yearsOut = Number(yr) - 2026;
    const yearMult = 0.86 ** yearsOut;
    for (const [round, base] of [[1, 3400], [2, 1450], [3, 640], [4, 280]]) {
      for (const [bucket, mult] of [['Early', 1.58], ['Mid', 1.0], ['Late', 0.62]]) {
        pickRows.push({
          player: { id: 90000 + pickRows.length, name: `${yr} ${bucket} ${round}${['st', 'nd', 'rd', 'th'][round - 1]}`, sleeperId: null, position: 'PI', maybeAge: null },
          value: Math.round(base * mult * yearMult),
          overallRank: 0, positionRank: 0, trend30Day: 0, redraftValue: 0,
        });
      }
    }
  }
  const valuesFeed = [...fcValues, ...pickRows].sort((a, b) => b.value - a.value);
  valuesFeed.forEach((v, i) => { if (v.player.position !== 'PI') v.overallRank = i + 1; });

  // ---- League ----
  const league = {
    league_id: leagueId,
    name: 'Dynasty Warfare',
    season,
    season_type: 'regular',
    sport: 'nfl',
    status: 'in_season',
    total_rosters: numTeams,
    roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'IR', 'TAXI', 'TAXI'],
    scoring_settings: { rec: 1, pass_td: 4, rush_td: 6, rec_td: 6, pass_yd: 0.04, rush_yd: 0.1, rec_yd: 0.1, fum_lost: -2, pass_int: -1, bonus_rec_te: 0.5 },
    settings: { num_teams: numTeams, playoff_teams: 6, taxi_slots: 2, reserve_slots: 1, draft_rounds: 4, type: 2 },
    previous_league_id: '1112193587416436700',
    draft_id: '1312193587416436737',
    avatar: null,
  };

  const users = Array.from({ length: numTeams }, (_, i) => ({
    user_id: String(700000 + i),
    username: MANAGERS[i],
    display_name: MANAGERS[i],
    avatar: null,
    metadata: { team_name: TEAM_NAMES[i] },
    is_owner: i === 0,
  }));

  // ---- Distribute players so teams have distinct, recognisable identities ----
  // tier: 0 = contender (older studs), 1 = middle, 2 = rebuilder (young + picks)
  const archetype = [0, 1, 2, 2, 0, 2, 1, 1, 0, 2, 0, 1];
  const byPos = {};
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    byPos[pos] = universe.filter((p) => p.position === pos).sort((a, b) => b.value - a.value);
  }

  const rosterPlayers = Array.from({ length: numTeams }, () => []);

  // Real dynasty rosters are lumpy: managers hoard one position and run thin at
  // another. A uniform snake draft would produce twelve interchangeable teams
  // and leave the needs/surplus and trade-finder logic with nothing to find, so
  // each team gets a positional bias on top of the base allocation.
  const BASE_TAKE = { QB: 3, RB: 5, WR: 7, TE: 3 };
  const POSITIONS = ['QB', 'RB', 'WR', 'TE'];
  const targets = Array.from({ length: numTeams }, (_, team) => {
    const t = { ...BASE_TAKE };
    const heavy = POSITIONS[(team * 3 + 1) % POSITIONS.length];
    const light = POSITIONS[(team * 5 + 2) % POSITIONS.length];
    t[heavy] += 2;
    if (light !== heavy) t[light] = Math.max(1, t[light] - 2);
    return t;
  });

  const maxRounds = Math.max(...targets.flatMap((t) => Object.values(t)));
  for (const pos of POSITIONS) {
    const pool = [...byPos[pos]];
    for (let round = 0; round < maxRounds; round++) {
      const order = Array.from({ length: numTeams }, (_, i) => i);
      if (round % 2 === 1) order.reverse();
      for (const team of order) {
        if (!pool.length) break;
        if (round >= targets[team][pos]) continue;   // this team is done at this position
        // Contenders reach for the oldest available near the top; rebuilders for youngest.
        const window = pool.slice(0, Math.min(4, pool.length));
        const arch = archetype[team];
        window.sort((a, b) => (arch === 0 ? b.age - a.age : arch === 2 ? a.age - b.age : b.value - a.value));
        const chosen = window[0];
        pool.splice(pool.indexOf(chosen), 1);
        rosterPlayers[team].push(chosen.id);
      }
    }
  }

  const rosters = rosterPlayers.map((ids, i) => {
    // Records correlate with archetype so classification has a real signal.
    const wins = [10, 7, 3, 4, 9, 2, 6, 7, 11, 3, 8, 5][i];
    return {
      roster_id: i + 1,
      owner_id: users[i].user_id,
      league_id: leagueId,
      players: ids,
      starters: ids.slice(0, 9),
      reserve: [],
      taxi: [],
      co_owners: null,
      settings: {
        wins, losses: 13 - wins, ties: 0,
        fpts: 1400 + wins * 55 + Math.floor(rand() * 60),
        fpts_against: 1500 + Math.floor(rand() * 200),
        total_moves: Math.floor(rand() * 30),
        waiver_budget_used: Math.floor(rand() * 90),
      },
    };
  });

  // ---- Traded picks: rebuilders accumulate, contenders spend ----
  const tradedPicks = [];
  const trades = [];
  const contenders = archetype.map((a, i) => (a === 0 ? i + 1 : null)).filter(Boolean);
  const rebuilders = archetype.map((a, i) => (a === 2 ? i + 1 : null)).filter(Boolean);

  let txId = 500000;
  for (const [season2, round] of [['2027', 1], ['2027', 2], ['2028', 1], ['2027', 1], ['2028', 2], ['2027', 1], ['2028', 1]]) {
    const from = contenders[Math.floor(rand() * contenders.length)];
    const to = rebuilders[Math.floor(rand() * rebuilders.length)];
    if (tradedPicks.some((p) => p.season === season2 && p.round === round && p.roster_id === from)) continue;
    tradedPicks.push({ season: season2, round, roster_id: from, previous_owner_id: from, owner_id: to });
  }

  // ---- Transaction history (trades) so League Intelligence has something real ----
  const now = Math.floor(Date.now() / 1000);
  for (let i = 0; i < 26; i++) {
    const a = 1 + Math.floor(rand() * numTeams);
    let b = 1 + Math.floor(rand() * numTeams);
    if (b === a) b = (b % numTeams) + 1;
    const aPlayers = rosterPlayers[a - 1], bPlayers = rosterPlayers[b - 1];
    const adds = {}, drops = {};
    const nA = 1 + Math.floor(rand() * 2), nB = 1 + Math.floor(rand() * 2);
    for (let k = 0; k < nA; k++) {
      const pid = aPlayers[Math.floor(rand() * aPlayers.length)];
      if (pid) { adds[pid] = b; drops[pid] = a; }
    }
    for (let k = 0; k < nB; k++) {
      const pid = bPlayers[Math.floor(rand() * bPlayers.length)];
      if (pid) { adds[pid] = a; drops[pid] = b; }
    }
    const includePick = rand() < 0.45;
    trades.push({
      transaction_id: String(txId++),
      type: 'trade',
      status: 'complete',
      week: 1 + Math.floor(rand() * 14),
      leg: 1,
      created: (now - Math.floor(rand() * 300) * 86400) * 1000,
      roster_ids: [a, b],
      consenter_ids: [a, b],
      creator: users[a - 1].user_id,
      adds, drops,
      draft_picks: includePick
        ? [{ season: ['2027', '2028'][Math.floor(rand() * 2)], round: 1 + Math.floor(rand() * 3), roster_id: a, previous_owner_id: a, owner_id: b }]
        : [],
      waiver_budget: [],
      settings: null,
      metadata: null,
    });
  }

  const drafts = [{
    draft_id: league.draft_id,
    league_id: leagueId,
    season,
    type: 'linear',
    status: 'complete',
    settings: { rounds: 4, teams: numTeams },
    slot_to_roster_id: Object.fromEntries(Array.from({ length: numTeams }, (_, i) => [String(i + 1), i + 1])),
    draft_order: Object.fromEntries(users.map((u, i) => [u.user_id, i + 1])),
    start_time: now * 1000,
  }];

  return {
    league, users, rosters, players, tradedPicks, drafts,
    transactions: trades,
    nflState: { week: 8, display_week: 8, season, season_type: 'regular', leg: 8 },
    valuesFeed,
    archetype,
  };
}

export default generateFixtures;
