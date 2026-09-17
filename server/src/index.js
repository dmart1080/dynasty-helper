import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import config from './config.js';
import { migrate } from './db/migrate.js';
import { all } from './db/index.js';
import leagues from './routes/leagues.js';
import players from './routes/players.js';
import trades from './routes/trades.js';
import finder from './routes/finder.js';
import intel from './routes/intel.js';
import { ok, fail } from './util/respond.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

migrate();

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  const failures = all(
    `SELECT source, status, error, fetched_at FROM fetch_log
      WHERE ok = 0 AND fetched_at > datetime('now','-1 day') ORDER BY fetched_at DESC LIMIT 10`);
  const leagueCount = all('SELECT league_id FROM leagues').length;
  ok(res, {
    status: 'up',
    leaguesCached: leagueCount,
    defaultLeagueId: config.defaultLeagueId,
    defaultRosterId: config.defaultRosterId,
    recentFailures: failures,
  });
});

app.use('/api/leagues', leagues);
app.use('/api/players', players);
app.use('/api/trades', trades);
app.use('/api/finder', finder);
app.use('/api/intel', intel);

// Serve the built client when it exists, so `npm start` runs the whole app.
const clientDist = path.resolve(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.use((req, res) => fail(res, 404, `No route for ${req.method} ${req.path}`));

// Errors become JSON, never an HTML stack trace in the phone UI.
app.use((err, req, res, next) => {
  console.error(`[error] ${req.method} ${req.path}:`, err.message);
  fail(res, err.status ?? 500, err.message ?? 'Unexpected server error');
});

app.listen(config.port, () => {
  console.log(`Dynasty Helper API on http://localhost:${config.port}`);
  console.log(`Default league ${config.defaultLeagueId} (roster ${config.defaultRosterId})`);
});
