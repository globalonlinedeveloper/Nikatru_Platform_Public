// ─────────────────────────────────────────────────────────────────────────────
// deploy-units.test.mjs — tooling/ci/lane-map.json `deployUnits` holds the
// SAME globs as the two deploy workflows' own path filters, both ways.
//
// ⏱ ADDED 2026-09-24 (row O-DEPLOY-IS-NOT-ONE-GATED-LANE, limb 3). plan-deploy.mjs
// decides whether a unit publishes from `deployUnits`, while GitHub still decides
// whether the workflow RUNS at all from deploy-web.yml's `on.push.paths` and
// deploy-workers.yml's dorny filters. Two readings of one question. Until D2b makes
// the workflows read `deployUnits`, this test is what holds them equal:
//   · a glob in a workflow and not in its unit → the lane runs, the plan finds no
//     match, and a real change is never published;
//   · a glob in the unit and not in its workflow → the plan would publish on a path
//     that never starts the lane, so the unit carries a claim nothing acts on.
// Temporary by design: D2b deletes it with the workflow filters it compares.
//
// Run:  timeout 600 node --single-threaded --test tooling/ci/test/deploy-units.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTriggerPaths, parseFilters, globClaims } from '../assert-deploy-triggers-deploy.mjs';
import { resolveEnvironment } from '../deployment-record.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const UNITS = JSON.parse(read('tooling/ci/lane-map.json')).deployUnits;
const WEB = read('.github/workflows/deploy-web.yml');
const WORKERS = read('.github/workflows/deploy-workers.yml');

/** Both directions at once, so a failure names the glob and the side it is missing from. */
function assertSameGlobs(unitKey, fromWorkflow, where) {
  assert.ok(Array.isArray(UNITS[unitKey]), `deployUnits has no "${unitKey}" list`);
  assert.ok(Array.isArray(fromWorkflow) && fromWorkflow.length > 0, `${where} yielded no globs — the parse has lost its subject`);
  const unit = new Set(UNITS[unitKey]);
  const wf = new Set(fromWorkflow);
  assert.deepEqual(
    [...wf].filter((g) => !unit.has(g)),
    [],
    `${where} names glob(s) that deployUnits["${unitKey}"] lacks: that change starts the lane and the plan skips it`,
  );
  assert.deepEqual(
    [...unit].filter((g) => !wf.has(g)),
    [],
    `deployUnits["${unitKey}"] names glob(s) that ${where} lacks: the plan would publish on a path that never starts the lane`,
  );
  assert.equal(UNITS[unitKey].length, unit.size, `deployUnits["${unitKey}"] repeats a glob`);
}

describe('deployUnits holds the deploy workflows\' globs (until D2b makes it their source)', () => {
  test('the units are exactly the three ledger environments', () => {
    assert.deepEqual(Object.keys(UNITS).sort(), ['<app>-web', 'platform', 'subscriptiontracker-api']);
  });

  test('"<app>-web" equals deploy-web.yml on.push.paths, both ways', () => {
    assertSameGlobs('<app>-web', parseTriggerPaths(WEB), 'deploy-web.yml on.push.paths');
  });

  test('"subscriptiontracker-api" equals the dorny filter `subscriptiontracker_api`, both ways', () => {
    assertSameGlobs('subscriptiontracker-api', parseFilters(WORKERS)?.subscriptiontracker_api, 'deploy-workers.yml filter subscriptiontracker_api');
  });

  test('"platform" equals the dorny filter `platform`, both ways', () => {
    assertSameGlobs('platform', parseFilters(WORKERS)?.platform, 'deploy-workers.yml filter platform');
  });

  test('the dorny filters are exactly the two Worker units — a third filter needs a unit', () => {
    assert.deepEqual(Object.keys(parseFilters(WORKERS) ?? {}).sort(), ['platform', 'subscriptiontracker_api']);
  });

  test('every deploy-workers.yml push path is in some Worker unit', () => {
    const paths = parseTriggerPaths(WORKERS);
    assert.ok(Array.isArray(paths) && paths.length > 0, 'deploy-workers.yml on.push.paths yielded nothing');
    const workerGlobs = new Set([...UNITS['subscriptiontracker-api'], ...UNITS.platform]);
    assert.deepEqual(paths.filter((p) => !workerGlobs.has(p)), [], 'a push path starts deploy-workers and no Worker unit would ever publish on it');
  });

  test('every glob has a shape the plan can decide (globClaims never answers null)', () => {
    const undecidable = Object.entries(UNITS).flatMap(([k, globs]) => globs.filter((g) => globClaims(g, 'x/y.z') === null).map((g) => `${k}: ${g}`));
    assert.deepEqual(undecidable, []);
  });

  test('every key is an environment the channel register resolves, as record-deployment.mjs will', () => {
    const register = JSON.parse(read('tooling/channel-register.json'));
    const slug = JSON.parse(read('catalog/apps.json'))[0]?.slug;
    assert.ok(slug, 'catalog/apps.json has no first slug');
    assert.equal(resolveEnvironment(register, `${slug}-web`)?.channel?.id, 'web');
    assert.equal(resolveEnvironment(register, 'subscriptiontracker-api')?.channel?.kind, 'service');
    assert.equal(resolveEnvironment(register, 'platform')?.channel?.kind, 'service');
  });

  test('the comparison bites: one glob dropped from a copy is named', () => {
    const saved = UNITS.platform;
    UNITS.platform = saved.filter((g) => g !== 'catalog/bundles.json');
    try {
      assert.throws(
        () => assertSameGlobs('platform', parseFilters(WORKERS)?.platform, 'deploy-workers.yml filter platform'),
        /catalog\/bundles\.json/,
      );
    } finally {
      UNITS.platform = saved;
    }
  });
});
