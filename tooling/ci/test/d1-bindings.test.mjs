// ─────────────────────────────────────────────────────────────────────────────
// d1-bindings.test.mjs — assert-d1-bindings.mjs must be able to FAIL.
//
// [pipeline S-12] A deployable Worker points at a real database, and two Workers
// naming one database mean the same one.
//
// ⚠️ REAL-TREE MUTATIONS FIRST (2026-07-29, three, predictions written first):
//   M1 the placeholder put back into services/subly-api  -> caught
//   M2 subly_db given a different id in ONE of its two    -> caught, naming both
//      configs                                               configs and both ids
//   M3 the brick template left untouched                  -> still PASSES, which
//      is the point: it contains the placeholder CORRECTLY and must never be in
//      scope. A rule that fires on correct input gets switched off.
//
// Live half, verified by hand against the Cloudflare account the same day and
// deliberately NOT automated (CI has no token, and forks would fail):
// platform_db = 9d1c5c63-…-f3fd22e9b351 and subly_db = 88da9026-…-431148fa8112
// both exist, with those names.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-d1-bindings.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-d1-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

const PLATFORM = '9d1c5c63-97fe-4f82-bc7d-f3fd22e9b351';
const SUBLY = '88da9026-f72a-4cda-823d-431148fa8112';

/** Deliberately JSONC with a comment naming the placeholder, so the
 *  comment-stripping is exercised by the PASSING case rather than assumed. */
const svcCfg = (bindings) => `{
  // NOTE: the brick stamps 00000000-0000-0000-0000-000000000000 here and the
  // owner pastes the real id. This comment names the placeholder ON PURPOSE —
  // if the guard scanned raw text it would fire on this line.
  "name": "svc",
  "d1_databases": [
${bindings.map((b) => `    { "binding": "${b.binding}", "database_name": "${b.name}", "database_id": "${b.id}" }`).join(',\n')}
  ],
}`;

function tree(services) {
  const root = join(TMP, `r${seq++}`);
  for (const [name, bindings] of Object.entries(services)) {
    const dir = join(root, 'services', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'wrangler.jsonc'), svcCfg(bindings));
  }
  return root;
}

const run = (cwd) => {
  const r = spawnSync(process.execPath, [GUARD], { cwd, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

const good = {
  platform: [
    { binding: 'PLATFORM_DB', name: 'platform_db', id: PLATFORM },
    { binding: 'SUBLY_DB', name: 'subly_db', id: SUBLY },
  ],
  'subly-api': [
    { binding: 'APP_DB', name: 'subly_db', id: SUBLY },
    { binding: 'PLATFORM_DB', name: 'platform_db', id: PLATFORM },
  ],
};

describe('assert-d1-bindings', () => {
  test('passes when every id is real and the names agree', () => {
    const { code, out } = run(tree(good));
    assert.equal(code, 0, out);
    assert.match(out, /4 binding\(s\) across 2 deployable config\(s\)/);
    assert.match(out, /2 distinct database\(s\)/);
  });

  // 🔴 M1 — S-12's limb 1, scoped to deployable config.
  test('FAILS on the all-zeros placeholder in a deployable config', () => {
    const { code, out } = run(tree({
      ...good,
      'subly-api': [{ binding: 'APP_DB', name: 'subly_db', id: '00000000-0000-0000-0000-000000000000' }],
    }));
    assert.equal(code, 1);
    assert.match(out, /still carries the all-zeros placeholder/);
    assert.match(out, /a dry run never contacts D1/);
  });

  // 🔴 M2 — the check the spec did not ask for and the tree needed.
  test('FAILS when one database name maps to two different ids', () => {
    const { code, out } = run(tree({
      ...good,
      'subly-api': [{ binding: 'APP_DB', name: 'subly_db', id: '11111111-2222-3333-4444-555555555555' }],
    }));
    assert.equal(code, 1);
    assert.match(out, /database "subly_db" is declared with 2 DIFFERENT ids/);
    assert.match(out, /talking to the wrong database/);
  });

  // The other direction: a half-landed rename.
  test('FAILS when one id answers to two different names', () => {
    const { code, out } = run(tree({
      platform: [{ binding: 'A', name: 'old_name', id: PLATFORM }],
      'subly-api': [{ binding: 'B', name: 'new_name', id: PLATFORM }],
    }));
    assert.equal(code, 1);
    assert.match(out, /is declared under 2 DIFFERENT names/);
  });

  test('FAILS on a database_id that is not a uuid', () => {
    const { code, out } = run(tree({ platform: [{ binding: 'A', name: 'x_db', id: 'TODO' }] }));
    assert.equal(code, 1);
    assert.match(out, /is not a uuid/);
  });

  // ── anti-vacuity: a scan that stopped scanning ────────────────────────────
  test('COVERAGE LOST when services/ is absent', () => {
    const root = join(TMP, `r${seq++}`);
    mkdirSync(root, { recursive: true });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — no services\//);
  });

  test('COVERAGE LOST when no service declares a d1 binding', () => {
    const root = join(TMP, `r${seq++}`);
    mkdirSync(join(root, 'services', 'empty'), { recursive: true });
    writeFileSync(join(root, 'services', 'empty', 'wrangler.jsonc'), '{ "name": "empty" }');
    const { code, out } = run(root);
    assert.equal(code, 1, 'zero bindings must not read as "all bindings are fine"');
    assert.match(out, /COVERAGE LOST/);
  });
});
