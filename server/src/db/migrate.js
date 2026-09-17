import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Applies schema.sql. Every statement is CREATE ... IF NOT EXISTS, so this is idempotent. */
export function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  getDb().exec(sql);
  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate();
  console.log('Migrations applied.');
}
