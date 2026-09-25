// ─────────────────────────────────────────────────────────────────────────────
// deploy-units.test.mjs — tooling/ci/lane-map.json `deployUnits` is the one list
// that decides what a deploy publishes, and the deploy workflows start on nothing
// of their own.
//
// ⏱ ADDED 2026-09-24 (row O-DEPLOY-IS-NOT-ONE-GATED-LANE, limb 3). plan-deploy.mjs
// decides whether a unit publishes from `deployUnits`, while GitHub still decided
// whether the workflow RAN at all from deploy-web.yml's `on.push.paths` and
// deploy-workers.yml's dorny filters, so this test held those copies equal to the
// units, both ways.
//
// ⏱ 2026-09-25 [ADR 095 §4]: the deploy workflows lost their triggers — they run
// only as ci.yml's deploy-web and deploy-workers call jobs, after ci-gate — and
// the equality tests went with the copies they compared. What stays is what the
// units must be on their own, and that neither workflow grows a trigger back: a
// push path or a dorny filter would be a second reading of "what deploys", which
// is the #155 shape (a run that deploys nothing, reported green).
//
// Run:  timeout 600 node --single-threaded --test tooling/ci/test/deploy-units.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTriggerPaths, usesPathsFilter, globClaims } from '../assert-deploy-triggers-deploy.mjs';
import { resolveEnvironment } from '../deployment-record.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const UNITS = JSON.parse(read('tooling/ci/lane-map.json')).deployUnits;
const DEPLOYS = ['.github/workflows/deploy-web.yml', '.github/workflows/deploy-workers.yml'];

/** The triggers a deploy workflow would start on by itself: its `on.push.paths`
 *  and whether it gates jobs behind dorny/paths-filter. Empty is the only pass. */
const ownTriggers = (text) => [
  ...(parseTriggerPaths(text) === null ? [] : ['on.push.paths']),
  ...(usesPathsFilter(text) ? ['dorny/paths-filter'] : []),
];

describe('deployUnits is the one reading of what a deploy publishes', () => {
  test('the units are exactly the three ledger environments', () => {
    assert.deepEqual(Object.keys(UNITS).sort(), ['<app>-web', 'platform', 'subscriptiontracker-api']);
  });

  test('neither deploy workflow carries a push path list or a dorny filter of its own', () => {
    for (const rel of DEPLOYS) {
      assert.deepEqual(ownTriggers(read(rel)), [], `${rel} starts on a list of its own beside deployUnits`);
    }
  });

  test('that check bites: a push path list or a dorny filter written back is named', () => {
    const web = read(DEPLOYS[0]).replace(/^on:\n/m, "on:\n  push:\n    paths:\n      - 'apps/**'\n");
    assert.deepEqual(ownTriggers(web), ['on.push.paths']);
    const filter = "      - uses: dorny/paths-filter@0000000000000000000000000000000000000000\n        with:\n          filters: |\n            platform:\n              - 'services/platform/**'\n";
    assert.deepEqual(ownTriggers(`${read(DEPLOYS[1])}${filter}`), ['dorny/paths-filter']);
  });

  test('every glob has a shape the plan can decide (globClaims never answers null)', () => {
    const undecidable = Object.entries(UNITS).flatMap(([k, globs]) => globs.filter((g) => globClaims(g, 'x/y.z') === null).map((g) => `${k}: ${g}`));
    assert.deepEqual(undecidable, []);
  });

  test('no unit repeats a glob', () => {
    for (const [k, globs] of Object.entries(UNITS)) assert.equal(new Set(globs).size, globs.length, `deployUnits["${k}"] repeats a glob`);
  });

  test('every key is an environment the channel register resolves, as record-deployment.mjs will', () => {
    const register = JSON.parse(read('tooling/channel-register.json'));
    const slug = JSON.parse(read('catalog/apps.json'))[0]?.slug;
    assert.ok(slug, 'catalog/apps.json has no first slug');
    assert.equal(resolveEnvironment(register, `${slug}-web`)?.channel?.id, 'web');
    assert.equal(resolveEnvironment(register, 'subscriptiontracker-api')?.channel?.kind, 'service');
    assert.equal(resolveEnvironment(register, 'platform')?.channel?.kind, 'service');
  });
});
