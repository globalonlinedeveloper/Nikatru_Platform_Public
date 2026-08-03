// ─────────────────────────────────────────────────────────────────────────────
// launch-smoke.test.mjs — assert-launch-smoke.mjs must be able to FAIL.
//
// ⚠️ THE REAL TREE IS THE FIRST NEGATIVE TEST. Mutation-proven 2026-08-03
// against a scratch COPY of the working tree (never `git checkout --`; each
// mutation was restored by rebuilding the copy and the guard returned to ok):
//   · deleting the smoke step from deploy-web.yml            → exit 1 "never runs …"
//   · moving it BELOW the Cloudflare deploy                   → exit 1 "AFTER … before publication"
//   · commenting it out inside the `run:` body (`# node …`)   → exit 1 "never runs …"
//   · emptying READY_SIGNAL.expression in the smoke script    → exit 1 "no longer declares …"
//   · adding an unknown platform to a register row            → COVERAGE LOST
// The one shrink this guard does NOT re-check — unserving every channel — is
// owned by assert-channel-register.mjs and was proven to fail there in the same
// session (`8 channel(s) and NONE is served`).
//
// The fixtures below cover what the real tree cannot show without breaking it:
// a served row with no lane, a lane job that does not exist, a build that never
// happens, and the printed half staying printed.
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
const GUARD = join(CI_DIR, 'assert-launch-smoke.mjs');
const SMOKE = 'tooling/smoke/smoke-web-artifact.mjs';

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-smoke-guard-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

/** A stand-in for the real smoke script: only the shape the guard reads. */
const SMOKE_STUB = `export const READY_SIGNAL = {
  id: 'flutter-first-frame',
  expression: 'window.__nikatruFirstFrame === true',
};
`;

const LANE = (steps) => `name: Deploy Web
on:
  push:
    branches: [main]
jobs:
  deploy-web:
    runs-on: ubuntu-24.04
    steps:
${steps}
`;

const BUILD_STEP = `      - name: Build web
        run: flutter build web --release
`;
const SMOKE_STEP = `      - name: Launch the built bundle once, before it is published
        run: node ${SMOKE} apps/subly/build/web
`;
const DEPLOY_STEP = `      - name: Deploy to Cloudflare Pages
        uses: cloudflare/wrangler-action@9acf94ace14e7dc412b076f2c5c20b8ce93c79cd # v3
        with:
          command: pages deploy build/web --project-name=subly
`;

const webRow = (over = {}) => ({
  id: 'web',
  platforms: ['web'],
  kind: 'web',
  served: true,
  artifactFormats: ['static-bundle'],
  lane: { workflow: '.github/workflows/deploy-web.yml', job: 'deploy-web' },
  ownerQueue: null,
  ...over,
});

const deferredRow = (id, platform, ownerQueue) => ({
  id,
  platforms: [platform],
  kind: 'store',
  served: false,
  artifactFormats: ['.ipa'],
  lane: null,
  ownerQueue,
});

function fixture({ channels, workflow = LANE(BUILD_STEP + SMOKE_STEP + DEPLOY_STEP), smoke = SMOKE_STUB } = {}) {
  const root = join(TMP, `f${seq++}`);
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  mkdirSync(join(root, 'tooling', 'smoke'), { recursive: true });
  writeFileSync(join(root, 'tooling', 'channel-register.json'), JSON.stringify({ channels }, null, 2));
  if (workflow !== null) writeFileSync(join(root, '.github', 'workflows', 'deploy-web.yml'), workflow);
  if (smoke !== null) writeFileSync(join(root, SMOKE), smoke);
  return root;
}

const run = (root) => {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('assert-launch-smoke.mjs — (a) the build-failing half', () => {
  test('build → launch → publish, in that order: ok', () => {
    const r = run(fixture({ channels: [webRow()] }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /the launch is BEFORE publication/);
  });

  test('no smoke step at all fails', () => {
    const r = run(fixture({ channels: [webRow()], workflow: LANE(BUILD_STEP + DEPLOY_STEP) }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /never runs tooling\/smoke\/smoke-web-artifact\.mjs/);
  });

  test('a smoke AFTER the publish is [14]O-7\'s question, not R-13\'s', () => {
    const r = run(fixture({ channels: [webRow()], workflow: LANE(BUILD_STEP + DEPLOY_STEP + SMOKE_STEP) }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /AFTER the Cloudflare deploy action/);
    assert.match(r.out, /BEFORE publication/);
  });

  test('a smoke BEFORE the build launches the previous artifact', () => {
    const r = run(fixture({ channels: [webRow()], workflow: LANE(SMOKE_STEP + BUILD_STEP + DEPLOY_STEP) }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /BEFORE its last build/);
  });

  test('a lane that never builds has nothing of this run to launch', () => {
    const r = run(fixture({ channels: [webRow()], workflow: LANE(SMOKE_STEP + DEPLOY_STEP) }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /found no `flutter build` in it/);
  });

  test('a smoke commented out inside the run body is prose, not a step', () => {
    const commented = `      - name: Launch
        run: echo nope # node ${SMOKE} apps/subly/build/web
`;
    const r = run(fixture({ channels: [webRow()], workflow: LANE(BUILD_STEP + commented + DEPLOY_STEP) }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /never runs tooling\/smoke/);
  });

  test('…but a `#` on an EARLIER shell command does not hide a later live one', () => {
    // workflow-scan joins a `run: |` block with ` ; `, because each of those
    // lines is its own command. Applying "no # before the match" to the joined
    // line would report this perfectly live smoke as commented out.
    const multi = `      - name: Launch
        run: |
          echo starting # a note about the launch
          node ${SMOKE} apps/subly/build/web
`;
    const r = run(fixture({ channels: [webRow()], workflow: LANE(BUILD_STEP + multi + DEPLOY_STEP) }));
    assert.equal(r.code, 0, r.out);
  });

  test('a ready signal that no longer says anything fails', () => {
    const gutted = "export const READY_SIGNAL = {\n  id: 'flutter-first-frame',\n  expression: '',\n};\n";
    const r = run(fixture({ channels: [webRow()], smoke: gutted }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no longer declares an `export const READY_SIGNAL`/);
  });

  test('a served, launchable channel with no lane cannot be smoked and fails', () => {
    const r = run(fixture({ channels: [webRow({ lane: null })] }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /declares no `lane.workflow` \+ `lane.job`/);
  });

  test('a lane naming a job that does not exist fails', () => {
    const r = run(fixture({ channels: [webRow({ lane: { workflow: '.github/workflows/deploy-web.yml', job: 'nope' } })] }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /could not find it/);
  });

  test('a build-and-smoke lane with no publish says the ordering claim is vacuous', () => {
    const r = run(fixture({ channels: [webRow()], workflow: LANE(BUILD_STEP + SMOKE_STEP) }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /performs no publish in this job, so "before publication" is vacuous here/);
  });
});

describe('assert-launch-smoke.mjs — (b) the printed half, and the coverage floors', () => {
  test('an owner-gated channel PRINTS a dated who/what/why and never fails', () => {
    const r = run(fixture({ channels: [webRow(), deferredRow('ios-appstore', 'ios', 'A-4')] }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ios-appstore — NOT LAUNCH-SMOKED/);
    assert.match(r.out, /who: OWNER_QUEUE A-4/);
    assert.match(r.out, /recorded 20\d\d-\d\d-\d\d/);
    assert.match(r.out, /NO headless path exists without an Apple device/);
  });

  test('COVERAGE LOST on a platform no mechanism classifies', () => {
    const r = run(fixture({ channels: [webRow({ platforms: ['web', 'fuchsia'] })] }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST.*absent from LAUNCH_MECHANISM: fuchsia/s);
  });

  test('COVERAGE LOST when something is served and NOTHING resolved into the failing half', () => {
    // The shrink the plan named: mark the one launchable channel unserved and
    // serve an un-launchable one instead, and (a) empties while publishing continues.
    const r = run(fixture({ channels: [webRow({ served: false }), deferredRow('ios-appstore', 'ios', 'A-4')].map((c, i) => (i === 1 ? { ...c, served: true } : c)) }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST.*NONE of them resolved into the build-failing half/s);
  });

  test('COVERAGE LOST when the register declares no channels', () => {
    const r = run(fixture({ channels: [] }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST.*declares no channels/s);
  });

  test('COVERAGE LOST when the register is missing entirely', () => {
    const root = join(TMP, `f${seq++}`);
    mkdirSync(root, { recursive: true });
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST.*is missing/s);
  });
});
