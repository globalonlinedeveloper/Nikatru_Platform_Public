// ─────────────────────────────────────────────────────────────────────────────
// d1-location-hint.test.mjs — assert-d1-location-hint.mjs must be able to FAIL on
// each of its four limbs, and must refuse when its scan reaches nothing.
//
// Register row O-DATA-RESIDENCY-HINT: a D1 location hint is latency, never
// residency. Live placement measured 2026-09-14 (read-only): platform_db primary
// SIN, subscriptiontracker_db primary KIX, both running_in_region APAC,
// jurisdiction null.
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
const GUARD = join(CI_DIR, 'assert-d1-location-hint.mjs');

let TMP;
let seq = 0;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-d1loc-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

const GOOD_PROVISION = [
  '// run `wrangler d1 create <id>_db --location apac` and paste the id',
  "const VALID_HINTS = ['wnam', 'enam', 'weur', 'eeur', 'apac', 'oc'];",
  "const created = wrangler(['d1', 'create', dbName, '--location', location]);",
  '',
].join('\n');
const GOOD_WRANGLER = [
  '{',
  '  // It creates the D1 with `--location apac`: the hint is create-time only,',
  '  // and it keeps the primary near the users for latency.',
  '  "d1_databases": [{ "binding": "APP_DB", "database_name": "x_db", "database_id": "00000000-0000-0000-0000-000000000000" }]',
  '}',
  '',
].join('\n');

function fixture({ provision = GOOD_PROVISION, wrangler = GOOD_WRANGLER, readme = '', docs = null } = {}) {
  const dir = join(TMP, `r${seq++}`);
  for (const d of ['services/x-api', 'tooling/scripts', 'tooling/bricks/app', 'docs']) mkdirSync(join(dir, d), { recursive: true });
  if (provision !== null) writeFileSync(join(dir, 'tooling/scripts/provision-backend.mjs'), provision);
  writeFileSync(join(dir, 'services/x-api/wrangler.jsonc'), wrangler);
  writeFileSync(join(dir, 'services/x-api/README.md'), readme);
  writeFileSync(join(dir, 'tooling/bricks/app/README.md'), 'curl --fail --location --retry 3 "$url"\n');
  if (docs !== null) writeFileSync(join(dir, 'docs/notes.md'), docs);
  return dir;
}

const run = (dir) => {
  const r = spawnSync(process.execPath, [GUARD, dir], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('assert-d1-location-hint', () => {
  test('passes a tree whose hints are apac and whose prose says latency; curl --location is not a hint', () => {
    const { code, out } = run(fixture());
    assert.equal(code, 0, out);
    assert.match(out, /ok {2}d1 location hint — 2 location value\(s\)/);
  });

  test('H1: a location that reads as India is refused AS a residency claim', () => {
    const { code, out } = run(fixture({ readme: 'Create it with `wrangler d1 create x_db --location in`.\n' }));
    assert.equal(code, 1, out);
    assert.match(out, /H1 services\/x-api\/README\.md:1 uses D1 location "in", which reads as INDIA/);
  });

  test('H1: a location_hint key with a non-D1 value is refused', () => {
    const w = GOOD_WRANGLER.replace('"binding": "APP_DB",', '"binding": "APP_DB", "location_hint": "ap-south-1",');
    const { code, out } = run(fixture({ wrangler: w }));
    assert.equal(code, 1, out);
    assert.match(out, /H1 services\/x-api\/wrangler\.jsonc:4 uses D1 location "ap-south-1", which reads as INDIA/);
  });

  test('H1: any value that is not one of the six hints is refused', () => {
    const { code, out } = run(fixture({ docs: 'wrangler d1 create y --location asia\n' }));
    assert.equal(code, 1, out);
    assert.match(out, /H1 docs\/notes\.md:1 uses D1 location "asia", which is not a D1 location hint/);
  });

  test('H2: VALID_HINTS gaining a value D1 does not have is refused', () => {
    const p = GOOD_PROVISION.replace("'oc']", "'oc', 'in']");
    const { code, out } = run(fixture({ provision: p }));
    assert.equal(code, 1, out);
    assert.match(out, /H2 tooling\/scripts\/provision-backend\.mjs VALID_HINTS is \[.*\]; not D1 hints: in/);
  });

  test('H3: a D1 jurisdiction, as a flag or as a wrangler key, is refused', () => {
    const flag = run(fixture({ readme: 'wrangler d1 create x_db --jurisdiction eu\n' }));
    assert.equal(flag.code, 1, flag.out);
    assert.match(flag.out, /H3 services\/x-api\/README\.md:1 passes `--jurisdiction eu`/);
    const key = run(fixture({ wrangler: GOOD_WRANGLER.replace('"binding": "APP_DB",', '"binding": "APP_DB", "jurisdiction": "eu",') }));
    assert.equal(key.code, 1, key.out);
    assert.match(key.out, /H3 services\/x-api\/wrangler\.jsonc:4 sets a D1 "jurisdiction"/);
  });

  test('H4: residency wording beside a hint is refused, naming both lines', () => {
    const w = GOOD_WRANGLER.replace('for latency.', 'for India data residency.');
    const { code, out } = run(fixture({ wrangler: w }));
    assert.equal(code, 1, out);
    assert.match(out, /H4 services\/x-api\/wrangler\.jsonc:3 says "residency" within 6 lines of the D1 location hint at :2/);
  });

  test('H4: "stored in India" beside a hint is refused', () => {
    const { code, out } = run(fixture({ readme: 'Run with `--location apac`.\nThe data is stored in India.\n' }));
    assert.equal(code, 1, out);
    assert.match(out, /H4 services\/x-api\/README\.md:2 says "stored in India"/);
  });

  test('H4 is bounded: residency wording far from any hint is not this guard\'s subject', () => {
    const far = `Run with \`--location apac\`.\n${'\n'.repeat(10)}Resident registration numbers are redacted.\n`;
    const { code, out } = run(fixture({ readme: far }));
    assert.equal(code, 0, out);
  });

  test('COVERAGE LOST: no provision-backend.mjs', () => {
    const { code, out } = run(fixture({ provision: null }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — tooling\/scripts\/provision-backend\.mjs does not exist/);
  });

  test('COVERAGE LOST: provision-backend.mjs without a VALID_HINTS list', () => {
    const { code, out } = run(fixture({ provision: '// nothing here\n' }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — .*no longer declares `const VALID_HINTS/);
  });

  test('COVERAGE LOST: a scan that reads no apac hint at all', () => {
    const p = GOOD_PROVISION.replace('--location apac', 'the location flag');
    const w = GOOD_WRANGLER.replace('`--location apac`', 'a location');
    const { code, out } = run(fixture({ provision: p, wrangler: w }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — scanned \d+ file\(s\) .* read 0 location value\(s\)/);
  });
});
