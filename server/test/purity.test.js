import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VALUATION_DIR = path.resolve(__dirname, '..', 'src', 'valuation');

/**
 * The architectural rule from docs/PLAN.md: all value math lives in one module
 * that takes plain objects and returns plain objects. If valuation/ ever reaches
 * for the database, an HTTP client or Express, it stops being unit-testable and
 * the numbers stop being reproducible. This test is the enforcement.
 */
const FORBIDDEN = [
  { pattern: /from\s+['"].*\/db\//, label: 'the database layer' },
  { pattern: /from\s+['"].*\/sources\//, label: 'an HTTP source' },
  { pattern: /from\s+['"].*\/routes\//, label: 'an Express route' },
  { pattern: /from\s+['"].*\/services\//, label: 'a service (which touches the DB)' },
  { pattern: /from\s+['"]express['"]/, label: 'express' },
  { pattern: /from\s+['"]node:sqlite['"]/, label: 'node:sqlite' },
  { pattern: /from\s+['"]node:fs['"]/, label: 'the filesystem' },
  { pattern: /\bfetch\s*\(/, label: 'a network call' },
];

const files = fs.readdirSync(VALUATION_DIR).filter((f) => f.endsWith('.js'));

test('the valuation modules exist', () => {
  assert.ok(files.length >= 6, `expected the full valuation module set, found ${files.join(', ')}`);
  for (const expected of ['format.js', 'lineup.js', 'picks.js', 'team.js', 'trade.js', 'finder.js', 'overrides.js']) {
    assert.ok(files.includes(expected), `missing valuation/${expected}`);
  }
});

for (const file of files) {
  test(`valuation/${file} stays pure — no I/O, no framework`, () => {
    const source = fs.readFileSync(path.join(VALUATION_DIR, file), 'utf8');
    for (const { pattern, label } of FORBIDDEN) {
      assert.ok(!pattern.test(source), `valuation/${file} must not depend on ${label}`);
    }
  });
}

test('valuation modules only import from each other', () => {
  for (const file of files) {
    const source = fs.readFileSync(path.join(VALUATION_DIR, file), 'utf8');
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const spec of imports) {
      assert.ok(spec.startsWith('./'),
        `valuation/${file} imports "${spec}" — valuation may only import its own siblings`);
    }
  }
});
