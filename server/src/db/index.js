import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import config from '../config.js';

let db = null;

export function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

/** Run fn inside a transaction, rolling back on throw. */
export function tx(fn) {
  const d = getDb();
  d.exec('BEGIN');
  try {
    const out = fn(d);
    d.exec('COMMIT');
    return out;
  } catch (err) {
    try { d.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw err;
  }
}

export const all = (sql, ...params) => getDb().prepare(sql).all(...params);
export const get = (sql, ...params) => getDb().prepare(sql).get(...params);
export const run = (sql, ...params) => getDb().prepare(sql).run(...params);

export function kvGet(key) {
  const row = get('SELECT value FROM kv WHERE key = ?', key);
  return row ? row.value : null;
}
export function kvSet(key, value) {
  run('INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key, String(value));
}
export const kvGetJson = (key) => { const v = kvGet(key); try { return v ? JSON.parse(v) : null; } catch { return null; } };
export const kvSetJson = (key, value) => kvSet(key, JSON.stringify(value));

/** JSON helpers: node:sqlite only binds null/number/string/bigint/Uint8Array. */
export const j = (value) => (value === undefined || value === null ? null : JSON.stringify(value));
export const unj = (text, fallback = null) => {
  if (text === null || text === undefined) return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
};
/** Coerce a JS value into something node:sqlite can bind. */
export const bind = (v) => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' || typeof v === 'bigint') return v;
  return JSON.stringify(v);
};

export function closeDb() { if (db) { db.close(); db = null; } }
