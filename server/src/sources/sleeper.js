import config from '../config.js';
import { getJson, buildUrl, SourceError } from './http.js';

const opts = () => ({ source: 'sleeper', timeoutMs: config.sleeper.timeoutMs });
const url = (p, params) => buildUrl(config.sleeper.baseUrl, p, params);

/**
 * Sleeper's public read API. No auth, no key.
 * Expected shapes are documented next to each call so a contract change is
 * easy to spot with `npm run verify:sources`.
 */

/** GET /league/{id} -> { name, season, total_rosters, roster_positions[], scoring_settings{}, ... } */
export async function getLeague(leagueId) {
  const data = await getJson(url(`league/${leagueId}`), opts());
  if (!data || typeof data !== 'object' || !data.league_id) {
    throw new SourceError(`Sleeper returned no league for id ${leagueId} (is the league ID correct?)`);
  }
  return data;
}

/** GET /league/{id}/rosters -> [{ roster_id, owner_id, players[], starters[], settings{} }] */
export async function getRosters(leagueId) {
  const data = await getJson(url(`league/${leagueId}/rosters`), opts());
  if (!Array.isArray(data)) throw new SourceError('Sleeper rosters response was not an array');
  return data;
}

/** GET /league/{id}/users -> [{ user_id, display_name, metadata: { team_name } }] */
export async function getUsers(leagueId) {
  const data = await getJson(url(`league/${leagueId}/users`), opts());
  if (!Array.isArray(data)) throw new SourceError('Sleeper users response was not an array');
  return data;
}

/**
 * GET /league/{id}/traded_picks -> [{ season, round, roster_id, previous_owner_id, owner_id }]
 * `roster_id` is the roster the pick ORIGINALLY belongs to; `owner_id` is who holds it now.
 * Only traded picks appear here — untraded picks are implied.
 */
export async function getTradedPicks(leagueId) {
  const data = await getJson(url(`league/${leagueId}/traded_picks`), opts());
  if (!Array.isArray(data)) throw new SourceError('Sleeper traded_picks response was not an array');
  return data;
}

/** GET /league/{id}/transactions/{week} -> [{ type, roster_ids[], adds{}, drops{}, draft_picks[] }] */
export async function getTransactions(leagueId, week) {
  const data = await getJson(url(`league/${leagueId}/transactions/${week}`), opts());
  return Array.isArray(data) ? data : [];
}

/** GET /league/{id}/drafts -> [{ draft_id, season, settings: { rounds }, type, status }] */
export async function getDrafts(leagueId) {
  const data = await getJson(url(`league/${leagueId}/drafts`), opts());
  return Array.isArray(data) ? data : [];
}

/** GET /draft/{id} -> { draft_order{}, slot_to_roster_id{}, settings{} } */
export async function getDraft(draftId) {
  return getJson(url(`draft/${draftId}`), opts());
}

/** GET /state/nfl -> { week, season, season_type, display_week, leg } */
export async function getNflState() {
  return getJson(url('state/nfl'), opts());
}

/** GET /players/nfl -> { "<player_id>": { full_name, position, team, birth_date, ... } } — ~5MB. */
export async function getAllPlayers() {
  const data = await getJson(url('players/nfl'), { ...opts(), timeoutMs: Math.max(config.sleeper.timeoutMs, 90000) });
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new SourceError('Sleeper players response was not an object map');
  }
  return data;
}

export const avatarUrl = (id, thumb = true) =>
  (id ? `https://sleepercdn.com/avatars/${thumb ? 'thumbs/' : ''}${id}` : null);
