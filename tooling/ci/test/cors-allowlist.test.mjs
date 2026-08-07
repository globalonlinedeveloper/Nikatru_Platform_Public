// ─────────────────────────────────────────────────────────────────────────────
// cors-allowlist.test.mjs — assert-cors-allowlist.mjs must be able to FAIL.
//
// [4]B-2 (CORS half) + [3]S-11. The Worker allowlists are DERIVED from
// sites/_shared/_data/apps.json; nothing about a new app's origin may depend on
// a human remembering to edit a comma-separated string in two wrangler configs.
//
// ⚠️ REAL-TREE NEGATIVE TESTS FIRST (2026-08-07, three, against the live repo —
// a fixture you wrote encodes the same misunderstanding as the guard you wrote):
//   N1 a second live app added to the REAL apps.json (drift.nikatru.com), nothing
//      else changed
//        · against the PREVIOUS guard -> BYTE-IDENTICAL output, exit 0. That is
//          the defect: the origins were a hardcoded POLICY literal inside the
//          guard, i.e. still a hand-edited list, merely relocated.
//        · against THIS guard -> exit 1, naming https://drift.nikatru.com.
//   N2 `https://evil.example.com` appended to the REAL services/subly-api
//      ALLOWED_ORIGINS -> exit 1, "NOTHING justifies it".
//   N3 the REAL apps.json emptied to `[]` -> COVERAGE LOST, exit 1.
//   Each mutation was reverted with `git checkout --` and proven byte-identical
//   by `git hash-object` (4c5f555b… for apps.json, b3d38665… for subly-api).
//   `node --check` passes on the guard, so every catch above is an assertion
//   firing and not a parse error.
//
// Run:  node --test "tooling/ci/test/cors-allowlist.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-cors-allowlist.mjs');

let TMP;
let seq = 0;

before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-cors-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const SUBLY = { slug: 'subly', name: 'Subly', url: 'https://subly.nikatru.com', status: 'live' };
const PAGES = 'https://subly-9cp.pages.dev';
const LOCAL = 'http://localhost:3000';

/** The allowlists the real repo carries today, so the baseline fixture is the
 *  live config rather than a convenient invention. */
const REAL = {
  platform: `${SUBLY.url},${PAGES},${LOCAL}`,
  'subly-api': `${SUBLY.url},${PAGES}`,
};

/**
 * Build a throwaway repo. `workers` maps a service directory to its
 * ALLOWED_ORIGINS string, or to `null` to omit the var entirely.
 *
 * 🔴 EVERY fixture config is written as REAL JSONC — line comments, a block
 * comment and a trailing comma — because "parse the config, never grep it" is
 * the property under test, not a detail of the fixture.
 */
function tree({ apps = [SUBLY], workers = REAL, extraComment = '' } = {}) {
  const root = join(TMP, `r${seq++}`);
  const dataDir = join(root, 'sites', '_shared', '_data');
  mkdirSync(dataDir, { recursive: true });
  if (apps !== null) writeFileSync(join(dataDir, 'apps.json'), JSON.stringify(apps, null, 2));

  for (const [name, allowed] of Object.entries(workers)) {
    const dir = join(root, 'services', name);
    mkdirSync(dir, { recursive: true });
    const varsLine = allowed === null ? '' : `    "ALLOWED_ORIGINS": ${JSON.stringify(allowed)},\n`;
    writeFileSync(
      join(dir, 'wrangler.jsonc'),
      `{\n` +
        `  /* Cloudflare Worker — ${name}. Block comment, on purpose. */\n` +
        `  "name": ${JSON.stringify(name)},\n` +
        `  "main": "src/index.ts",\n` +
        `  // This app's web origins only (comma-separated).\n` +
        `${extraComment}` +
        `  "vars": {\n` +
        `    "APP_ID": ${JSON.stringify(name)},\n` +
        varsLine +
        `  },\n` + // ← trailing comma before } — jsonc, not json
        `}\n`,
    );
  }
  return root;
}

function run(cwd) {
  try {
    const stdout = execFileSync(process.execPath, [GUARD], { cwd, encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, out: stdout };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('assert-cors-allowlist', () => {
  test('passes on the live shape: every derived origin present, nothing unjustified', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /2 Worker config\(s\) checked against 1 catalogue origin\(s\) from 1 app\(s\)/);
    // Derived and EXTRAS are counted SEPARATELY and both printed: a single
    // blended tally is how a hand-maintained list creeps back unnoticed.
    assert.match(out, /2 derived requirement\(s\) \+ 3 declared EXTRAS all present/);
  });

  // 🔴 N1 — THE defect [4]B-2 exists for, and the one the previous guard passed.
  // A new app is stamped into the catalogue; nobody edits the shared Worker.
  test('FAILS when a new catalogue app is missing from the shared Worker', () => {
    const drift = { slug: 'drift', name: 'Drift', url: 'https://drift.nikatru.com', status: 'live' };
    const { code, out } = run(tree({ apps: [SUBLY, drift] }));
    assert.equal(code, 1);
    assert.match(out, /services\/platform\/wrangler\.jsonc — missing "https:\/\/drift\.nikatru\.com"/);
    assert.match(out, /apps\.json declares "drift"/);
    assert.match(out, /refused at runtime with nothing logged server side/);
  });

  // The per-app limb: services/<slug>-api must carry its own app's origin.
  test('FAILS when a per-app Worker drops its own app origin', () => {
    const { code, out } = run(tree({ workers: { ...REAL, 'subly-api': PAGES } }));
    assert.equal(code, 1);
    assert.match(out, /services\/subly-api\/wrangler\.jsonc — missing "https:\/\/subly\.nikatru\.com"/);
    assert.match(out, /that app's own Worker/);
  });

  // The other direction: the catalogue is also a CEILING, not just a floor.
  test('FAILS on a hand-added origin the catalogue does not justify', () => {
    const workers = { ...REAL, 'subly-api': `${REAL['subly-api']},https://evil.example.com` };
    const { code, out } = run(tree({ workers }));
    assert.equal(code, 1);
    assert.match(out, /"https:\/\/evil\.example\.com" is listed but NOTHING justifies it/);
    assert.match(out, /standing CORS grant nobody reviewed/);
  });

  test('accepts the declared EXTRAS (preview domain, local dev server)', () => {
    // These are NOT in apps.json and must still be allowed, because EXTRAS
    // gives each a reason.
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /pages\.dev/);
    assert.doesNotMatch(out, /localhost:3000/);
  });

  // 🔴 AN EXTRA IS REQUIRED, NOT MERELY PERMITTED — and the first draft of this
  // guard got that wrong. Treating EXTRAS as a permit-list alone meant dropping
  // http://localhost:3000 from services/platform became a PASS, silently
  // regressing a case the pre-derivation guard already caught (guards.test.mjs
  // "FAILS when a required PLATFORM origin is dropped"). Removing an origin has
  // to be a reviewable diff, not a quiet edit to a comma-separated string.
  test('FAILS when a declared EXTRA is dropped from the config', () => {
    const workers = { ...REAL, platform: `${SUBLY.url},${PAGES}` }; // localhost gone
    const { code, out } = run(tree({ workers }));
    assert.equal(code, 1);
    assert.match(out, /missing "http:\/\/localhost:3000" — EXTRAS:/);
    assert.match(out, /delete the EXTRAS entry in the same change/);
  });

  test('FAILS when ALLOWED_ORIGINS is absent', () => {
    const { code, out } = run(tree({ workers: { ...REAL, platform: null } }));
    assert.equal(code, 1);
    assert.match(out, /vars\.ALLOWED_ORIGINS is missing/);
  });

  test('FAILS when ALLOWED_ORIGINS is an empty string', () => {
    const { code, out } = run(tree({ workers: { ...REAL, platform: '' } }));
    assert.equal(code, 1);
    assert.match(out, /ALLOWED_ORIGINS is EMPTY/);
  });

  // 🔴 THE ANTI-GREP CASE. A comment that mentions an origin must not satisfy
  // the requirement, and must not trip the unjustified check either. This repo
  // shipped a `grep '"r2_buckets"'` that matched the comment explaining why
  // there is no r2_buckets; the same mistake was reproduced again on 2026-08-07.
  test('ignores origins that appear only in comments (parsed, not grepped)', () => {
    const ghost = '  // was once "ALLOWED_ORIGINS": "https://ghost.example.com" — removed\n';
    const { code, out } = run(tree({ extraComment: ghost }));
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /ghost\.example\.com/);
  });

  test('FAILS a comment-only origin that the config no longer really lists', () => {
    // The mirror of the above: the origin is REQUIRED by the catalogue and
    // present only in prose. A grep would call this covered.
    const ghosted = { slug: 'ghost', name: 'Ghost', url: 'https://ghost.nikatru.com', status: 'live' };
    const extraComment = '  // "https://ghost.nikatru.com" used to be listed here\n';
    const { code, out } = run(tree({ apps: [SUBLY, ghosted], extraComment }));
    assert.equal(code, 1);
    assert.match(out, /missing "https:\/\/ghost\.nikatru\.com"/);
  });

  // ── untaught scope ────────────────────────────────────────────────────────
  test('FAILS on a Worker it has never been taught about', () => {
    const { code, out } = run(tree({ workers: { ...REAL, 'mystery-worker': REAL['subly-api'] } }));
    assert.equal(code, 1);
    assert.match(out, /never been taught about services\/mystery-worker/);
    assert.match(out, /Name it services\/<slug>-api/);
  });

  // ── anti-vacuity [pipeline F-10] ──────────────────────────────────────────
  test('COVERAGE LOST on an empty catalogue', () => {
    const { code, out } = run(tree({ apps: [] }));
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — the catalogue yielded 0 origin\(s\)/);
    assert.match(out, /passes forever/);
  });

  test('COVERAGE LOST when the catalogue file is absent', () => {
    const { code, out } = run(tree({ apps: null }));
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — no catalogue at sites\/_shared\/_data\/apps\.json/);
  });

  test('COVERAGE LOST when fewer than two Worker configs are found', () => {
    const { code, out } = run(tree({ workers: { platform: REAL.platform } }));
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — found 1 Worker config\(s\)/);
  });

  // If the <slug>-api limb matches nothing, only the shared Worker is really
  // being checked and the tally still looks healthy. That must be loud.
  test('COVERAGE LOST when the <slug>-api derivation matches no Worker', () => {
    const other = { slug: 'other', name: 'Other', url: 'https://other.nikatru.com', status: 'live' };
    const { code, out } = run(tree({ apps: [other] }));
    assert.equal(code, 1);
    assert.match(out, /the <slug>-api derivation matched 0 Worker\(s\)/);
  });

  test('COVERAGE LOST when a catalogue row has no url', () => {
    const { code, out } = run(tree({ apps: [{ slug: 'urlless', status: 'live' }] }));
    assert.equal(code, 1);
    assert.match(out, /row "urlless" has no `url`/);
  });
});
