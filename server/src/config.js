import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

export const config = {
  port: num(process.env.PORT, 5175),
  dbPath: process.env.DB_PATH || path.join(root, 'data', 'dynasty.db'),
  defaultLeagueId: process.env.DEFAULT_LEAGUE_ID || '1312193587416436736',
  defaultRosterId: num(process.env.DEFAULT_ROSTER_ID, 1),

  sleeper: {
    baseUrl: process.env.SLEEPER_BASE_URL || 'https://api.sleeper.app/v1',
    timeoutMs: num(process.env.SLEEPER_TIMEOUT_MS, 20000),
    // Sleeper asks that /players/nfl be pulled at most once per day.
    playersTtlMs: num(process.env.PLAYERS_TTL_MS, 24 * 60 * 60 * 1000),
    leagueTtlMs: num(process.env.LEAGUE_TTL_MS, 5 * 60 * 1000),
  },

  values: {
    provider: process.env.VALUE_PROVIDER || 'fantasycalc',
    baseUrl: process.env.FANTASYCALC_BASE_URL || 'https://api.fantasycalc.com',
    // Path is config so a moved endpoint is a config change, not a code change.
    valuesPath: process.env.FANTASYCALC_VALUES_PATH || '/values/current',
    timeoutMs: num(process.env.FANTASYCALC_TIMEOUT_MS, 20000),
    ttlMs: num(process.env.VALUES_TTL_MS, 24 * 60 * 60 * 1000),
  },

  http: {
    retries: num(process.env.HTTP_RETRIES, 3),
    backoffMs: num(process.env.HTTP_BACKOFF_MS, 500),
  },
};

export default config;
