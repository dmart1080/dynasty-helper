#!/usr/bin/env node
/**
 * Data sync CLI.
 *
 *   npm run sync                      refresh the default league
 *   npm run sync -- <leagueId>        refresh a specific league
 *   npm run sync -- --force           ignore TTLs
 *   npm run sync -- --history         also walk previous_league_id for past trades
 *   npm run sync -- --fixtures        load the offline demo league (no network)
 */
import config from '../config.js';
import { migrate } from '../db/migrate.js';
import { syncAll } from './index.js';
import { loadFixtures } from './fixtures.js';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const leagueId = args.find((a) => !a.startsWith('--')) ?? config.defaultLeagueId;

migrate();

if (flags.has('--fixtures')) {
  const res = loadFixtures({ leagueId });
  console.log('Loaded offline fixture league:');
  console.log(JSON.stringify(res, null, 2));
  console.log('\nThis is synthetic demo data, not your real league.');
  console.log('Run "npm run sync" with network access to replace it with live data.');
  process.exit(0);
}

const report = await syncAll(leagueId, { force: flags.has('--force'), includeHistory: flags.has('--history') });
console.log(JSON.stringify(report, null, 2));

if (!report.ok) {
  console.error(`\n${report.errors.length} stage(s) failed. Cached data is still being served.`);
  console.error('Run "npm run verify:sources" to see which endpoints are reachable.');
  process.exit(1);
}
