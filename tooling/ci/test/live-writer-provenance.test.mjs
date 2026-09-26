// ─────────────────────────────────────────────────────────────────────────────
// live-writer-provenance.test.mjs — [pipeline B-17] the stamp module
// (tooling/e2e/app-version-stamp.mjs) and the guard that holds every live
// drive to it (tooling/ci/assert-live-writer-provenance.mjs).
//
// ⏱ ADDED 2026-09-23. store-screenshots.yml's Linux capture wrote two consent
// rows to production stamped `dev` (run 35818960378) and its purge was handed
// nothing that could find them. Every RED case below is one way that shape comes
// back: a drive with no stamp, a stamp no resolver accepts, a stamp traced to a
// step that may not run, a purge missing a setting, a purge pointed at a file
// the writer never wrote.
//
// Fixture trees are built per case from one green tree by exact string edits;
// `swap` fails the case when its anchor is absent, so an edit that stops
// applying is a red case, never a silent green.
//
// Run:  node --test tooling/ci/test/live-writer-provenance.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseWorkflow } from '../workflow-scan.mjs';
import {
  E2E_RUN_SHAPE,
  STAMP_LANES,
  STORE_CAPTURE_SHAPE,
  StampRefused,
  appVersionDefine,
  stampShape,
} from '../../e2e/app-version-stamp.mjs';
import { CAPTURE_WORKERS, sandboxBackend } from '../../store/capture-backend.mjs';
import { parseJsonc } from '../d1-sql-inventory.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-live-writer-provenance.mjs');

const E2E = '.github/workflows/e2e.yml';
const SHOTS = '.github/workflows/store-screenshots.yml';
const REG = 'tooling/prod-provenance.json';
const RUNNER = 'tooling/store/capture-play-screenshots.mjs';
const SHA40 = 'abcdef0123456789abcdef0123456789abcdef01';
// ⏱ 2026-09-25 — L6 reads both capture Workers' configs (sandboxBackend()), so
// every fixture tree carries the REAL two, and the store-capture fixtures purge
// the env.sandbox databases they name. The e2e fixtures keep production's.
const PLATFORM_CFG = CAPTURE_WORKERS.platform;
const API_CFG = CAPTURE_WORKERS['subscriptiontracker-api'];
const SBX_PLATFORM_DB = 'ead92001-03e1-4f71-9b92-c64963a24925';
const SBX_APP_DB = '4e7c7730-3dc7-4004-9895-403b17702b91';
const PROD_PLATFORM_DB = '9d1c5c63-97fe-4f82-bc7d-f3fd22e9b351';
const PROD_APP_DB = '0a36d6a0-c909-40aa-853e-970de3482321';
const CAPTURE_ENV = (over = {}) => ({
  GITHUB_ACTIONS: 'true',
  GITHUB_WORKFLOW_REF: 'nikatru/platform/.github/workflows/store-screenshots.yml@refs/heads/main',
  GITHUB_RUN_NUMBER: '42',
  GITHUB_SHA: SHA40,
  ...over,
});

// ── the green tree ───────────────────────────────────────────────────────────
const E2E_GREEN = `name: E2E
on:
  workflow_dispatch:
jobs:
  e2e:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      - name: Stamp this run
        run: |
          echo "E2E_APP_VERSION=e2e-\${{ github.run_number }}-\${GITHUB_SHA::7}" >> "$GITHUB_ENV"
      - name: Provision a throwaway user
        id: user
        run: node tooling/e2e/provision_user.mjs
      - name: Drive the app
        run: |
          flutter drive \\
            --driver=test_driver/integration_test.dart \\
            --target=integration_test/app_test.dart \\
            --dart-define=APP_VERSION="$E2E_APP_VERSION" 2>&1 | tee "\${RUNNER_TEMP}/drive.log"
      - name: Purge test data
        if: always() && steps.user.outcome != 'skipped'
        env:
          E2E_APP_ID: subscriptiontracker
          E2E_RESPONSE_DATA: apps/subscriptiontracker/build/integration_response_data.json
          E2E_DRIVE_LOG: \${{ runner.temp }}/drive.log
          PLATFORM_D1_DATABASE_ID: 9d1c5c63-97fe-4f82-bc7d-f3fd22e9b351
        run: node tooling/e2e/purge.mjs
`;

const SHOTS_GREEN = `name: Store screenshots
on:
  workflow_dispatch:
jobs:
  capture-linux:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      - name: Provision a throwaway user
        id: user
        run: node tooling/e2e/provision_user.mjs
      - name: Capture
        env:
          E2E_CONSENT_LEDGER: \${{ runner.temp }}/store-capture-consent.json
        run: |
          xvfb-run -a -s "-screen 0 2560x1600x24" \\
            node tooling/store/capture-play-screenshots.mjs --app subscriptiontracker --channel linux-snap
      - name: Purge test data
        if: always() && steps.user.outcome != 'skipped'
        env:
          E2E_APP_ID: subscriptiontracker
          E2E_CONSENT_LEDGER: \${{ runner.temp }}/store-capture-consent.json
          PLATFORM_D1_DATABASE_ID: ead92001-03e1-4f71-9b92-c64963a24925
          SUBSCRIPTIONTRACKER_D1_DATABASE_ID: 4e7c7730-3dc7-4004-9895-403b17702b91
        run: node tooling/e2e/purge.mjs
`;

const RUNNER_GREEN = `import { spawnSync } from 'node:child_process';
import { appVersionDefine, StampRefused } from '../e2e/app-version-stamp.mjs';

const PROOF = process.argv.includes('--proof');
let STAMP_DEFINE = [];
STAMP_DEFINE = appVersionDefine({ lane: 'store-capture', live: !PROOF });
const defines = [];
defines.push(...STAMP_DEFINE);
const args = ['drive', '--driver=test_driver/integration_test.dart', '--target=integration_test/store_screenshots_test.dart', ...defines];
const r = spawnSync('flutter', args, { stdio: 'inherit' });
process.exit(r.status ?? 1);
`;

const REG_OBJ = () => ({
  resolvers: {
    'released-build': { why: 'a release' },
    'e2e-run': { why: 'an e2e run' },
    'store-capture': { why: 'a store capture' },
    'erasure-step': { why: 'an erasure' },
    'operator-minted': { why: 'an operator' },
  },
  // ⏱ 2026-09-26 — the rules sit under `databases.<name>.tables` (O-PROVENANCE-WALKS-ONE-DATABASE).
  databases: {
    platform_db: {
      tables: {
        consent_artifacts: { marker: 'app_version', resolver: 'released-build', alsoResolves: ['e2e-run', 'store-capture'] },
        events: { marker: 'app_version', resolver: 'released-build' },
        pending_erasures: { marker: 'app_id', resolver: 'operator-minted', alsoResolves: ['erasure-step'] },
      },
    },
  },
});
const REG_GREEN = JSON.stringify(REG_OBJ(), null, 2);

const GREEN = {
  [E2E]: E2E_GREEN,
  [SHOTS]: SHOTS_GREEN,
  [RUNNER]: RUNNER_GREEN,
  [REG]: REG_GREEN,
  [PLATFORM_CFG]: readFileSync(join(REPO, PLATFORM_CFG), 'utf8'),
  [API_CFG]: readFileSync(join(REPO, API_CFG), 'utf8'),
};

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-livewriter-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;
/** The green tree with `edit` applied: a string replaces a file, a function
 *  rewrites it, null removes it. `.github/workflows` always exists. */
function tree(edit = {}) {
  const files = { ...GREEN };
  for (const [rel, v] of Object.entries(edit)) files[rel] = typeof v === 'function' ? v(files[rel]) : v;
  const root = join(TMP, `t${seq++}`);
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    if (body === null) continue;
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}
/** An exact edit that FAILS the case when its anchor is absent. */
const swap = (from, to) => (text) => {
  assert.ok(text.includes(from), `fixture anchor not found: ${from}`);
  return text.replace(from, to);
};
const chain = (...fns) => (text) => fns.reduce((t, f) => f(t), text);
const regWith = (fn) => { const r = REG_OBJ(); fn(r); return JSON.stringify(r, null, 2); };
/** 1-based line of the first line of `text` holding `needle`. */
const lineOf = (text, needle) => text.split('\n').findIndex((l) => l.includes(needle)) + 1;

const run = (root) => spawnSync(process.execPath, [GUARD, root], { cwd: REPO, encoding: 'utf8' });
const expectExit = (r, code) => assert.equal(r.status, code, `exit ${r.status}, wanted ${code}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}`);
const says = (r, needle) => assert.ok(`${r.stdout}\n${r.stderr}`.includes(needle), `output lacks: ${needle}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}`);

const DRIVE_AT = `${E2E}:${lineOf(E2E_GREEN, 'name: Drive the app') + 1} (job "e2e")`;
// Where a finding points, measured in the EDITED text (an edit that drops a line
// moves every later one).
const captureAt = (t = SHOTS_GREEN) => `${SHOTS}:${lineOf(t, 'xvfb-run -a') - 1} (job "capture-linux")`;
const e2ePurgeAt = (t = E2E_GREEN) => `${E2E}:${lineOf(t, 'run: node tooling/e2e/purge.mjs')} (job "e2e")`;
const shotsPurgeAt = (t = SHOTS_GREEN) => `${SHOTS}:${lineOf(t, 'run: node tooling/e2e/purge.mjs')} (job "capture-linux")`;
const CAPTURE_AT = captureAt();
const SHOTS_PURGE_AT = shotsPurgeAt();
const STAMP_STEP = `      - name: Stamp this run
        run: |
          echo "E2E_APP_VERSION=e2e-\${{ github.run_number }}-\${GITHUB_SHA::7}" >> "$GITHUB_ENV"
`;

// ── the stamp module ─────────────────────────────────────────────────────────
describe('app-version-stamp: the one definition of a non-release stamp', () => {
  test('the shapes accept <prefix>-<1..9 digits>-<7 hex> and refuse everything else', () => {
    assert.ok(E2E_RUN_SHAPE.test('e2e-1-abcdef0'));
    assert.ok(E2E_RUN_SHAPE.test('e2e-123456789-abcdef0'));
    assert.ok(STORE_CAPTURE_SHAPE.test('cap-42-0123abc'));
    assert.ok(!E2E_RUN_SHAPE.test('dev'));
    assert.ok(!E2E_RUN_SHAPE.test('e2e'));
    assert.ok(!E2E_RUN_SHAPE.test('E2E-1-ABCDEF0'));
    assert.ok(!E2E_RUN_SHAPE.test(`e2e-1-${SHA40}`));
    assert.ok(!E2E_RUN_SHAPE.test('e2e-1234567890-abcdef0'));
    assert.ok(!E2E_RUN_SHAPE.test('1.0.123+abcdef0'));
    assert.ok(!STORE_CAPTURE_SHAPE.test('e2e-1-abcdef0'));
  });

  test('the lanes are pairwise disjoint: prefixes, workflows, resolvers and env names, and no stamp fits two shapes', () => {
    const distinct = (xs) => new Set(xs).size === xs.length;
    assert.ok(STAMP_LANES.length >= 2, 'both live lanes are declared');
    assert.ok(distinct(STAMP_LANES.map((l) => l.prefix)));
    assert.ok(distinct(STAMP_LANES.map((l) => l.workflow)));
    assert.ok(distinct(STAMP_LANES.map((l) => l.resolver)));
    assert.ok(distinct(STAMP_LANES.filter((l) => l.env).map((l) => l.env)));
    const crossFits = STAMP_LANES.flatMap((a) => STAMP_LANES.filter((b) => b !== a && stampShape(b.prefix).test(`${a.prefix}-1-abcdef0`)));
    assert.deepEqual(crossFits, []);
    assert.deepEqual(STAMP_LANES.map((l) => l.source).sort(), ['actions-default', 'env']);
  });

  test('appVersionDefine, live, derives cap-<run>-<sha7> for the store capture from the Actions default env', () => {
    assert.deepEqual(appVersionDefine({ lane: 'store-capture', live: true, env: CAPTURE_ENV() }), ['--dart-define', 'APP_VERSION=cap-42-abcdef0']);
    assert.deepEqual(appVersionDefine({ lane: 'e2e-run', live: true, env: { E2E_APP_VERSION: 'e2e-7-abcdef0' } }), ['--dart-define', 'APP_VERSION=e2e-7-abcdef0']);
  });

  test('RED CONTROL: live, inside Actions with GITHUB_RUN_NUMBER unset, it throws StampRefused naming GITHUB_RUN_NUMBER', () => {
    assert.throws(
      () => appVersionDefine({ lane: 'store-capture', live: true, env: CAPTURE_ENV({ GITHUB_RUN_NUMBER: undefined }) }),
      (e) => e instanceof StampRefused && /GITHUB_RUN_NUMBER/.test(e.message),
    );
  });

  test('RED CONTROL: live, an e2e lane given `dev` or nothing throws', () => {
    assert.throws(() => appVersionDefine({ lane: 'e2e-run', live: true, env: { E2E_APP_VERSION: 'dev' } }), StampRefused);
    assert.throws(
      () => appVersionDefine({ lane: 'e2e-run', live: true, env: {} }),
      (e) => e instanceof StampRefused && /E2E_APP_VERSION is unset/.test(e.message),
    );
  });

  test('RED CONTROL: live, a stamp from another lane throws (cross-lane), and so does another workflow\'s run', () => {
    assert.throws(() => appVersionDefine({ lane: 'e2e-run', live: true, env: { E2E_APP_VERSION: 'cap-1-abcdef0' } }), StampRefused);
    assert.throws(() => appVersionDefine({ lane: 'store-capture', live: true, env: { STORE_CAPTURE_APP_VERSION: 'e2e-1-abcdef0' } }), StampRefused);
    assert.throws(
      () => appVersionDefine({ lane: 'store-capture', live: true, env: CAPTURE_ENV({ GITHUB_WORKFLOW_REF: 'nikatru/platform/.github/workflows/e2e.yml@refs/heads/main' }) }),
      (e) => e instanceof StampRefused && /GITHUB_WORKFLOW_REF/.test(e.message),
    );
    assert.throws(() => appVersionDefine({ lane: 'no-such-lane', live: true, env: {} }), StampRefused);
  });

  test('not live (a proof build) returns [] and never reads env', () => {
    const untouchable = new Proxy({}, { get() { throw new Error('env was read'); }, has() { throw new Error('env was read'); } });
    assert.deepEqual(appVersionDefine({ lane: 'store-capture', live: false, env: untouchable }), []);
    assert.deepEqual(appVersionDefine({ lane: 'e2e-run', live: false, env: untouchable }), []);
  });
});

// ── L2: YAML drives ──────────────────────────────────────────────────────────
describe('assert-live-writer-provenance: a YAML drive stamps a resolvable APP_VERSION', () => {
  test('the green tree passes and prints its census', () => {
    const r = run(tree());
    expectExit(r, 0);
    says(r, 'drives=1 spawners=1 spawnerSteps=1 provisioningJobs=2 purges=2 lanes=2');
    says(r, `drive   ${DRIVE_AT} APP_VERSION=$E2E_APP_VERSION`);
    says(r, `spawner ${CAPTURE_AT} ${RUNNER}`);
  });

  test('RED: a drive with no --dart-define=APP_VERSION', () => {
    const r = run(tree({ [E2E]: swap('--dart-define=APP_VERSION="$E2E_APP_VERSION"', '--dart-define=E2E_DELETE_PASSWORD="$E2E_DELETE_PASSWORD"') }));
    expectExit(r, 1);
    says(r, `${DRIVE_AT} — the drive passes no --dart-define=APP_VERSION`);
  });

  test('RED: a drive stamped APP_VERSION=dev', () => {
    const r = run(tree({ [E2E]: swap('APP_VERSION="$E2E_APP_VERSION"', 'APP_VERSION=dev') }));
    expectExit(r, 1);
    says(r, 'passes APP_VERSION=dev');
  });

  test('RED: $E2E_APP_VERSION written by nothing is untraceable', () => {
    const r = run(tree({ [E2E]: swap(STAMP_STEP, '') }));
    expectExit(r, 1);
    says(r, '$E2E_APP_VERSION is untraceable');
  });

  test('RED: the $GITHUB_ENV write sits in a step AFTER the drive', () => {
    const r = run(tree({ [E2E]: chain(swap(STAMP_STEP, ''), swap('      - name: Purge test data\n', `${STAMP_STEP}      - name: Purge test data\n`)) }));
    expectExit(r, 1);
    says(r, 'only AFTER the step that reads it');
  });

  test('RED: the stamp step has an `if:`, so the write is conditional', () => {
    const r = run(tree({ [E2E]: swap('      - name: Stamp this run\n', "      - name: Stamp this run\n        if: github.event_name == 'schedule'\n") }));
    expectExit(r, 1);
    says(r, 'by a conditional step');
  });

  test('RED: a cap- stamp in e2e.yml is the other lane\'s shape', () => {
    const r = run(tree({ [E2E]: swap('E2E_APP_VERSION=e2e-', 'E2E_APP_VERSION=cap-') }));
    expectExit(r, 1);
    says(r, "the `store-capture` lane's shape, in a workflow bound to `e2e-run`");
  });

  test('RED: the full ${{ github.sha }} renders a 40-hex stamp no resolver accepts', () => {
    const r = run(tree({ [E2E]: swap('-${GITHUB_SHA::7}"', '-${{ github.sha }}"') }));
    expectExit(r, 1);
    says(r, `stamps APP_VERSION=e2e-1-${SHA40}, which is not e2e-<run>-<sha7>`);
  });

  test('RED: a $(date +%s) token cannot be rendered from the tree', () => {
    const r = run(tree({ [E2E]: swap('e2e-${{ github.run_number }}-', 'e2e-$(date +%s)-') }));
    expectExit(r, 1);
    says(r, 'cannot render');
  });

  test('GREEN: a stamp routed through the writer step\'s env (RUN_NUMBER: ${{ github.run_number }})', () => {
    const routed = `      - name: Stamp this run
        env:
          RUN_NUMBER: \${{ github.run_number }}
        run: |
          echo "E2E_APP_VERSION=e2e-\${RUN_NUMBER}-\${GITHUB_SHA::7}" >> "$GITHUB_ENV"
`;
    const r = run(tree({ [E2E]: swap(STAMP_STEP, routed) }));
    expectExit(r, 0);
  });

  test('RED: the lane resolver is not a key of prod-provenance.json resolvers', () => {
    const r = run(tree({ [REG]: regWith((g) => { delete g.resolvers['e2e-run']; }) }));
    expectExit(r, 1);
    says(r, "resolver `e2e-run` is not a key of tooling/prod-provenance.json `resolvers`");
  });

  test('RED: the lane resolver is not in consent_artifacts.alsoResolves', () => {
    const r = run(tree({ [REG]: regWith((g) => { g.databases.platform_db.tables.consent_artifacts.alsoResolves = ['e2e-run']; }) }));
    expectExit(r, 1);
    says(r, "resolver `store-capture` is not in tooling/prod-provenance.json databases.platform_db.tables.consent_artifacts.alsoResolves");
  });
});

// ── L4: the purge is handed what the drive wrote ─────────────────────────────
describe('assert-live-writer-provenance: a drive job hands its purge the consent settings', () => {
  test('RED: the purge lacks PLATFORM_D1_DATABASE_ID', () => {
    const edit = swap('          PLATFORM_D1_DATABASE_ID: 9d1c5c63-97fe-4f82-bc7d-f3fd22e9b351\n', '');
    const r = run(tree({ [E2E]: edit }));
    expectExit(r, 1);
    says(r, `${e2ePurgeAt(edit(E2E_GREEN))} lacks PLATFORM_D1_DATABASE_ID`);
  });

  test('RED: the purge lacks E2E_APP_ID', () => {
    const edit = swap('          E2E_APP_ID: subscriptiontracker\n', '');
    const r = run(tree({ [E2E]: edit }));
    expectExit(r, 1);
    says(r, `${e2ePurgeAt(edit(E2E_GREEN))} lacks E2E_APP_ID`);
  });

  test('RED: the purge lacks both E2E_DRIVE_LOG and E2E_RESPONSE_DATA', () => {
    const edit = chain(
      swap('          E2E_RESPONSE_DATA: apps/subscriptiontracker/build/integration_response_data.json\n', ''),
      swap('          E2E_DRIVE_LOG: ${{ runner.temp }}/drive.log\n', ''),
    );
    const r = run(tree({ [E2E]: edit }));
    expectExit(r, 1);
    says(r, `${e2ePurgeAt(edit(E2E_GREEN))} lacks E2E_DRIVE_LOG or E2E_RESPONSE_DATA`);
  });

  test('RED: the consenting purge is not `if: always()`', () => {
    const r = run(tree({ [E2E]: swap("if: always() && steps.user.outcome != 'skipped'", "if: success() && steps.user.outcome != 'skipped'") }));
    expectExit(r, 1);
    says(r, `${e2ePurgeAt()} lacks \`if: always()\``);
  });

  test('RED: a job that provisions a throwaway user has no always() purge', () => {
    const leg = `  delete-leg:
    runs-on: ubuntu-24.04
    steps:
      - name: Provision
        run: node tooling/e2e/provision_user.mjs
      - name: Purge
        if: success()
        run: node tooling/e2e/purge.mjs
`;
    const r = run(tree({ [E2E]: (t) => `${t}${leg}` }));
    expectExit(r, 1);
    says(r, '(job "delete-leg") — provisions a throwaway production user and no `if: always()` step');
  });

  test('GREEN, no false red: a delete-leg purge without consent env beside the consenting one', () => {
    const extra = `      - name: Purge the deleted user
        if: always() && steps.delete_user.outcome != 'skipped'
        env:
          E2E_APP_ID: subscriptiontracker
        run: node tooling/e2e/purge.mjs
`;
    const r = run(tree({ [E2E]: (t) => `${t}${extra}` }));
    expectExit(r, 0);
    says(r, 'purges=3');
  });

  test('RED: E2E_DRIVE_LOG names a file the drive never tees into', () => {
    const r = run(tree({ [E2E]: swap('E2E_DRIVE_LOG: ${{ runner.temp }}/drive.log', 'E2E_DRIVE_LOG: ${{ runner.temp }}/other.log') }));
    expectExit(r, 1);
    says(r, 'E2E_DRIVE_LOG=${{ runner.temp }}/other.log, but the drive at line');
  });

  test('GREEN: a tee into "${RUNNER_TEMP}/drive.log", $RUNNER_TEMP/drive.log or ${{ runner.temp }}/drive.log is the purge\'s ${{ runner.temp }}/drive.log', () => {
    const plain = run(tree({ [E2E]: swap('tee "${RUNNER_TEMP}/drive.log"', 'tee $RUNNER_TEMP/drive.log') }));
    expectExit(plain, 0);
    const expr = run(tree({ [E2E]: swap('tee "${RUNNER_TEMP}/drive.log"', 'tee "${{ runner.temp }}/drive.log"') }));
    expectExit(expr, 0);
  });

  test('RED: an env: value of $RUNNER_TEMP/drive.log is a literal to Actions, never the tee target', () => {
    const r = run(tree({ [E2E]: swap('E2E_DRIVE_LOG: ${{ runner.temp }}/drive.log', 'E2E_DRIVE_LOG: $RUNNER_TEMP/drive.log') }));
    expectExit(r, 1);
    says(r, 'E2E_DRIVE_LOG=$RUNNER_TEMP/drive.log, but the drive at line');
  });

  test('RED: a drive job\'s purge carrying E2E_CONSENT_LEDGER beside E2E_DRIVE_LOG is a mix purge.mjs refuses', () => {
    const edit = swap('          E2E_DRIVE_LOG: ${{ runner.temp }}/drive.log\n', '          E2E_DRIVE_LOG: ${{ runner.temp }}/drive.log\n          E2E_CONSENT_LEDGER: ${{ runner.temp }}/ledger.json\n');
    const r = run(tree({ [E2E]: edit }));
    expectExit(r, 1);
    const at = e2ePurgeAt(edit(E2E_GREEN));
    says(r, `${at} — the purge carries both E2E_DRIVE_LOG + E2E_RESPONSE_DATA and E2E_CONSENT_LEDGER`);
    says(r, `${at} carries E2E_CONSENT_LEDGER, which a drive's purge must not`);
  });
});

// ── L3: spawners ─────────────────────────────────────────────────────────────
describe('assert-live-writer-provenance: a script that launches the drive stamps it through the module', () => {
  test('RED: a spawner with no appVersionDefine import', () => {
    const edit = chain(
      swap("import { appVersionDefine, StampRefused } from '../e2e/app-version-stamp.mjs';\n", ''),
      swap("STAMP_DEFINE = appVersionDefine({ lane: 'store-capture', live: !PROOF });\n", ''),
    );
    const r = run(tree({ [RUNNER]: edit }));
    expectExit(r, 1);
    says(r, `${RUNNER}:${lineOf(edit(RUNNER_GREEN), "spawnSync('flutter'")} — launches a live \`flutter drive\` and does not import appVersionDefine`);
  });

  test('RED: the spawner imports appVersionDefine but its result never reaches the drive argv', () => {
    const r = run(tree({ [RUNNER]: swap('defines.push(...STAMP_DEFINE);\n', '') }));
    expectExit(r, 1);
    says(r, 'its result never reaches the argv of this drive');
  });

  test('GREEN: appVersionDefine spread straight into the argv literal', () => {
    const direct = `import { spawnSync } from 'node:child_process';
import { appVersionDefine } from '../e2e/app-version-stamp.mjs';
spawnSync('flutter', ['drive', '--target=integration_test/store_screenshots_test.dart', ...appVersionDefine({ lane: 'store-capture', live: true })]);
`;
    const r = run(tree({ [RUNNER]: direct }));
    expectExit(r, 0);
  });

  test('RED: an env-lane spawner step with the lane env set nowhere it can reach', () => {
    const runner = `import { spawnSync } from 'node:child_process';
import { appVersionDefine } from './app-version-stamp.mjs';
spawnSync('flutter', ['drive', '--target=integration_test/app_test.dart', ...appVersionDefine({ lane: 'e2e-run', live: true })]);
`;
    const job = `  scripted:
    runs-on: ubuntu-24.04
    steps:
      - name: Drive through the runner
        env:
          E2E_CONSENT_LEDGER: \${{ runner.temp }}/ledger.json
        run: node tooling/e2e/drive-runner.mjs
`;
    const r = run(tree({ 'tooling/e2e/drive-runner.mjs': runner, [E2E]: (t) => `${t}${job}` }));
    expectExit(r, 1);
    says(r, '$E2E_APP_VERSION is untraceable');
  });

  test('GREEN: an env-lane spawner step whose lane env an earlier step wrote, with a ledger purge', () => {
    const runner = `import { spawnSync } from 'node:child_process';
import { appVersionDefine } from './app-version-stamp.mjs';
spawnSync('flutter', ['drive', '--target=integration_test/app_test.dart', ...appVersionDefine({ lane: 'e2e-run', live: true })]);
`;
    const job = `  scripted:
    runs-on: ubuntu-24.04
    steps:
      - name: Stamp this run
        run: echo "E2E_APP_VERSION=e2e-$GITHUB_RUN_NUMBER-\${GITHUB_SHA::7}" >> "$GITHUB_ENV"
      - name: Drive through the runner
        env:
          E2E_CONSENT_LEDGER: \${{ runner.temp }}/ledger.json
        run: node tooling/e2e/drive-runner.mjs
      - name: Purge
        if: always()
        env:
          E2E_APP_ID: subscriptiontracker
          E2E_CONSENT_LEDGER: \${{ runner.temp }}/ledger.json
          PLATFORM_D1_DATABASE_ID: 9d1c5c63-97fe-4f82-bc7d-f3fd22e9b351
        run: node tooling/e2e/purge.mjs
`;
    const r = run(tree({ 'tooling/e2e/drive-runner.mjs': runner, [E2E]: (t) => `${t}${job}` }));
    expectExit(r, 0);
    says(r, 'spawners=2 spawnerSteps=2');
  });

  test('RED: a spawner step in a workflow bound to no stamp lane', () => {
    const other = `name: Other
on:
  workflow_dispatch:
jobs:
  shots:
    runs-on: ubuntu-24.04
    steps:
      - run: node tooling/store/capture-play-screenshots.mjs --app subscriptiontracker
`;
    const r = run(tree({ '.github/workflows/other.yml': other }));
    expectExit(r, 1);
    says(r, '.github/workflows/other.yml:8 (job "shots") — a spawner step (tooling/store/capture-play-screenshots.mjs) in a workflow bound to no stamp lane');
  });

  test('RED: a spawner that stamps the e2e-run lane, run from the store-capture workflow', () => {
    const r = run(tree({ [RUNNER]: swap("lane: 'store-capture'", "lane: 'e2e-run'") }));
    expectExit(r, 1);
    says(r, `${CAPTURE_AT} — runs ${RUNNER}, which stamps the \`e2e-run\` lane`);
  });

  test('RED: the spawner job has no consenting purge (store-screenshots.yml before 2026-09-23)', () => {
    const edit = swap(`        env:
          E2E_APP_ID: subscriptiontracker
          E2E_CONSENT_LEDGER: \${{ runner.temp }}/store-capture-consent.json
          PLATFORM_D1_DATABASE_ID: ead92001-03e1-4f71-9b92-c64963a24925
          SUBSCRIPTIONTRACKER_D1_DATABASE_ID: 4e7c7730-3dc7-4004-9895-403b17702b91
`, '');
    const r = run(tree({ [SHOTS]: edit }));
    expectExit(r, 1);
    says(r, `${CAPTURE_AT} — no purge in this job is a consenting one`);
    says(r, `${shotsPurgeAt(edit(SHOTS_GREEN))} lacks PLATFORM_D1_DATABASE_ID, E2E_APP_ID, E2E_CONSENT_LEDGER`);
  });

  test('RED: a spawner job\'s purge handed E2E_DRIVE_LOG instead of the ledger', () => {
    const r = run(tree({ [SHOTS]: swap('          E2E_CONSENT_LEDGER: ${{ runner.temp }}/store-capture-consent.json\n          PLATFORM_D1', '          E2E_DRIVE_LOG: ${{ runner.temp }}/drive.log\n          PLATFORM_D1') }));
    expectExit(r, 1);
    says(r, `${SHOTS_PURGE_AT} lacks E2E_CONSENT_LEDGER and carries E2E_DRIVE_LOG, which a spawner's purge must not`);
  });

  test('RED: a spawner job\'s purge carrying the ledger AND E2E_DRIVE_LOG', () => {
    const edit = swap('          PLATFORM_D1', '          E2E_DRIVE_LOG: ${{ runner.temp }}/drive.log\n          PLATFORM_D1');
    const r = run(tree({ [SHOTS]: edit }));
    expectExit(r, 1);
    says(r, `${shotsPurgeAt(edit(SHOTS_GREEN))} — the purge carries both E2E_DRIVE_LOG and E2E_CONSENT_LEDGER`);
  });

  test('RED: the purge\'s E2E_CONSENT_LEDGER is not the file the spawner step writes', () => {
    const r = run(tree({ [SHOTS]: swap('          E2E_CONSENT_LEDGER: ${{ runner.temp }}/store-capture-consent.json\n          PLATFORM_D1', '          E2E_CONSENT_LEDGER: ${{ runner.temp }}/other.json\n          PLATFORM_D1') }));
    expectExit(r, 1);
    says(r, `${SHOTS_PURGE_AT} — E2E_CONSENT_LEDGER=\${{ runner.temp }}/other.json, but the spawner step at line`);
  });

  test('RED: the spawner step carries no E2E_CONSENT_LEDGER', () => {
    const edit = swap(`        env:
          E2E_CONSENT_LEDGER: \${{ runner.temp }}/store-capture-consent.json
        run: |`, '        run: |');
    const r = run(tree({ [SHOTS]: edit }));
    expectExit(r, 1);
    says(r, `${captureAt(edit(SHOTS_GREEN))} — runs ${RUNNER} with no E2E_CONSENT_LEDGER`);
  });

  test('RED: a script-launched flutter build is not yet supported', () => {
    const build = `import { spawnSync } from 'node:child_process';
const argv = ['build', 'web', '--release'];
spawnSync('flutter', argv, { stdio: 'inherit' });
`;
    const r = run(tree({ 'tooling/web/build-web.mjs': build }));
    expectExit(r, 1);
    says(r, 'tooling/web/build-web.mjs:3 — a script-launched flutter build is not yet supported');
  });

  // ⏱ 2026-09-26 (O-FLUTTER-BUILD-TYPED-PER-LINE, part 1 of 3): the release lanes call (part 3)
  // the composer instead of typing `flutter build`. It launches a build, never a drive,
  // so neither it nor a step calling it is a live writer; any other build script is.
  const COMPOSER = `import { spawnSync } from 'node:child_process';
const argv = ['build', 'linux', '--release'];
spawnSync('flutter', argv, { stdio: 'inherit' });
`;
  const BUILD_LANE = `name: Build
on: workflow_dispatch
jobs:
  linux:
    runs-on: ubuntu-24.04
    steps:
      - name: Build linux
        run: node tooling/ci/flutter-release-build.mjs fixture linux linux-snap
`;

  test('GREEN: the release composer launches a build, and a step calling it is no writer step', () => {
    const r = run(tree({ 'tooling/ci/flutter-release-build.mjs': COMPOSER, '.github/workflows/build.yml': BUILD_LANE }));
    expectExit(r, 0);
    says(r, 'spawners=1 spawnerSteps=1');
  });

  test('RED CONTROL: the same build script under any other name is still refused', () => {
    const r = run(tree({ 'tooling/ci/flutter-release-build-copy.mjs': COMPOSER, '.github/workflows/build.yml': BUILD_LANE }));
    expectExit(r, 1);
    says(r, 'tooling/ci/flutter-release-build-copy.mjs:3 — a script-launched flutter build is not yet supported');
  });

  test('GREEN: a printed-only flutter argv is not a spawner', () => {
    const printed = `const argv = ['flutter', 'drive', '--target=integration_test/app_test.dart'];
console.log(argv.join(' '));
`;
    const r = run(tree({ 'tooling/release/print-argv.mjs': printed }));
    expectExit(r, 0);
    says(r, 'spawners=1 spawnerSteps=1');
  });

  test('GREEN: `flutter drive` inside an echo string and a # comment is not a drive', () => {
    const r = run(tree({
      [E2E]: swap('      - name: Drive the app\n', `      - name: Say what runs next
        run: |
          # flutter drive --target=integration_test/app_test.dart
          echo "next: flutter drive against production"
      - name: Drive the app
`),
    }));
    expectExit(r, 0);
    says(r, 'drives=1 ');
  });
});

// ── L5 and COVERAGE LOST ─────────────────────────────────────────────────────
describe('assert-live-writer-provenance: the register, and a census too thin to be evidence', () => {
  test('RED: the register widens app_version acceptance through a resolver no stamp lane defines', () => {
    const r = run(tree({ [REG]: regWith((g) => { g.databases.platform_db.tables.consent_artifacts.alsoResolves.push('erasure-step'); }) }));
    expectExit(r, 1);
    says(r, 'databases.platform_db.tables.consent_artifacts — the register widens app_version acceptance through `erasure-step`');
  });

  test('COVERAGE LOST: an empty .github/workflows', () => {
    const r = run(tree({ [E2E]: null, [SHOTS]: null }));
    expectExit(r, 2);
    says(r, 'COVERAGE LOST — read ZERO workflows');
  });

  test('COVERAGE LOST: workflows with zero drives and zero spawner steps', () => {
    const r = run(tree({
      [E2E]: swap(`          flutter drive \\
            --driver=test_driver/integration_test.dart \\
            --target=integration_test/app_test.dart \\
            --dart-define=APP_VERSION="$E2E_APP_VERSION" 2>&1 | tee "\${RUNNER_TEMP}/drive.log"`, '          echo skipped'),
      [SHOTS]: swap('            node tooling/store/capture-play-screenshots.mjs --app subscriptiontracker --channel linux-snap', '            echo skipped'),
    }));
    expectExit(r, 2);
    says(r, 'COVERAGE LOST — found ZERO live drives');
  });

  test('COVERAGE LOST: a malformed prod-provenance.json', () => {
    const notJson = run(tree({ [REG]: '{ "resolvers": ' }));
    expectExit(notJson, 2);
    says(notJson, 'is unreadable or not JSON');
    const wrongShape = run(tree({ [REG]: JSON.stringify({ resolvers: [], databases: { platform_db: { tables: { consent_artifacts: {} } } } }) }));
    expectExit(wrongShape, 2);
    says(wrongShape, 'has no `resolvers` object');
  });

  test('COVERAGE LOST: a stamp lane\'s workflow file is missing', () => {
    const r = run(tree({ [SHOTS]: null }));
    expectExit(r, 2);
    says(r, 'the `store-capture` stamp lane names store-screenshots.yml, which is not under .github/workflows');
  });
});

// ── the real tree, and mutations of it ───────────────────────────────────────
/** A copy of the files the guard reads from the real repo: every workflow, the
 *  register and the one real spawner; `edit` as in tree(). */
function realCopy(edit = {}) {
  const files = {};
  for (const name of readdirSync(join(REPO, '.github', 'workflows'))) files[`.github/workflows/${name}`] = readFileSync(join(REPO, '.github', 'workflows', name), 'utf8');
  files[REG] = readFileSync(join(REPO, REG), 'utf8');
  files[RUNNER] = readFileSync(join(REPO, RUNNER), 'utf8');
  files[PLATFORM_CFG] = readFileSync(join(REPO, PLATFORM_CFG), 'utf8');
  files[API_CFG] = readFileSync(join(REPO, API_CFG), 'utf8');
  for (const [rel, v] of Object.entries(edit)) files[rel] = typeof v === 'function' ? v(files[rel]) : v;
  const root = join(TMP, `real${seq++}`);
  for (const [rel, body] of Object.entries(files)) {
    if (body === null) continue;
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}
const dropLine = (re) => (text) => {
  assert.match(text, re, `mutation anchor not found: ${re}`);
  return text.replace(re, '');
};

describe('assert-live-writer-provenance: the real tree', () => {
  test('the real repo passes, and the census counts ONE drive and FOUR spawner steps (capture-linux\'s on the line after xvfb-run)', () => {
    const r = spawnSync(process.execPath, [GUARD], { cwd: REPO, encoding: 'utf8' });
    expectExit(r, 0);
    says(r, 'drives=1 spawners=1 spawnerSteps=4 ');
    says(r, '(job "capture") tooling/store/capture-play-screenshots.mjs');
    says(r, '(job "capture-linux") tooling/store/capture-play-screenshots.mjs');
    says(r, '(job "capture-desktop-native") tooling/store/capture-play-screenshots.mjs');
    says(r, '(job "capture-ios") tooling/store/capture-play-screenshots.mjs');
  });

  test('MUTATION: the real e2e.yml without its --dart-define=APP_VERSION line', () => {
    const r = run(realCopy({ [E2E]: dropLine(/^[ \t]*--dart-define=APP_VERSION="\$E2E_APP_VERSION" \\\r?\n/m) }));
    expectExit(r, 1);
    says(r, '.github/workflows/e2e.yml:');
    says(r, 'the drive passes no --dart-define=APP_VERSION');
  });

  test('MUTATION: the real store-screenshots.yml without PLATFORM_D1_DATABASE_ID on the capture job\'s purge', () => {
    const r = run(realCopy({ [SHOTS]: dropLine(/^[ \t]*PLATFORM_D1_DATABASE_ID:.*\r?\n/m) }));
    expectExit(r, 1);
    says(r, '(job "capture") — no purge in this job is a consenting one');
    says(r, 'lacks PLATFORM_D1_DATABASE_ID');
  });

  test('MUTATION: the real capture runner without its appVersionDefine push', () => {
    const r = run(realCopy({ [RUNNER]: dropLine(/^[ \t]*defines\.push\(\.\.\.STAMP_DEFINE\);\r?\n/m) }));
    expectExit(r, 1);
    says(r, `${RUNNER}:`);
    says(r, 'its result never reaches the argv of this drive');
  });

  test('wiring: ci.yml\'s guards-platform job runs the guard', () => {
    const wf = parseWorkflow(REPO, '.github/workflows/ci.yml');
    const job = wf?.jobs.get('guards-platform');
    assert.ok(job, 'ci.yml has a guards-platform job');
    const text = job.logical.map((l) => l.text).join('\n');
    assert.ok(text.includes('node --single-threaded tooling/ci/assert-live-writer-provenance.mjs'), 'guards-platform runs the guard');
  });
});

// ── L6: a sandbox lane reaches the sandbox, and purges the sandbox ───────────
// ⏱ 2026-09-25 (capsand-b). Each case is written out by hand.
const capturePurgeId = (key, id) => (text) => {
  const re = new RegExp(`^([ \\t]*${key}: )\\S+$`, 'm');
  assert.match(text, re, `mutation anchor not found: ${key}`);
  return text.replace(re, `$1${id}`);
};

describe('assert-live-writer-provenance L6: a sandbox lane reaches only the sandbox', () => {
  test('L6a: the real tree is green, and L6 holds its four capture jobs', () => {
    const r = spawnSync(process.execPath, [GUARD], { cwd: REPO, encoding: 'utf8' });
    expectExit(r, 0);
    says(r, 'sandboxJobs=4');
  });

  test('the fixture sandbox ids are the ones sandboxBackend() reads from the real configs', () => {
    const b = sandboxBackend();
    assert.equal(b.platform.sandboxIds['d1:PLATFORM_DB'], SBX_PLATFORM_DB);
    assert.equal(b['subscriptiontracker-api'].sandboxIds['d1:APP_DB'], SBX_APP_DB);
    assert.equal(b.platform.productionIds['d1:PLATFORM_DB'], PROD_PLATFORM_DB);
    assert.equal(b['subscriptiontracker-api'].productionIds['d1:APP_DB'], PROD_APP_DB);
    const r = run(tree());
    expectExit(r, 0);
    says(r, 'sandboxJobs=1');
  });

  test('🔴 L6b: a capture step that names API_BASE_URL from secrets is a finding', () => {
    const edit = swap(`          E2E_CONSENT_LEDGER: \${{ runner.temp }}/store-capture-consent.json
        run: |`, `          E2E_CONSENT_LEDGER: \${{ runner.temp }}/store-capture-consent.json
          API_BASE_URL: \${{ secrets.API_BASE_URL }}
        run: |`);
    const t = edit(SHOTS_GREEN);
    const r = run(tree({ [SHOTS]: t }));
    expectExit(r, 1);
    says(r, `${SHOTS}:${lineOf(t, 'API_BASE_URL: ')} (job "capture-linux") — a step env names API_BASE_URL in the sandbox lane \`store-capture\``);
    says(r, `${SHOTS}:${lineOf(t, 'API_BASE_URL: ')} (job "capture-linux") — reads secrets.API_BASE_URL in the sandbox lane`);
  });

  test('🔴 L6c: a preflight that re-adds secrets.API_BASE_URL under another name is a finding', () => {
    const edit = swap(`      - name: Provision a throwaway user
`, `      - name: Preflight — secrets present
        env:
          HOST: \${{ secrets.API_BASE_URL }}
        run: test -n "$HOST"
      - name: Provision a throwaway user
`);
    const t = edit(SHOTS_GREEN);
    const r = run(tree({ [SHOTS]: t }));
    expectExit(r, 1);
    says(r, `${SHOTS}:${lineOf(t, 'HOST: ')} (job "capture-linux") — reads secrets.API_BASE_URL in the sandbox lane \`store-capture\``);
  });

  test('🔴 L6d: a capture purge on the PRODUCTION platform database is a finding', () => {
    const r = run(tree({ [SHOTS]: capturePurgeId('PLATFORM_D1_DATABASE_ID', PROD_PLATFORM_DB) }));
    expectExit(r, 1);
    says(r, `${SHOTS_PURGE_AT} — PLATFORM_D1_DATABASE_ID=${PROD_PLATFORM_DB} is a PRODUCTION database id`);
    says(r, `must name ${PLATFORM_CFG} env.sandbox PLATFORM_DB (${SBX_PLATFORM_DB})`);
  });

  test('🔴 L6e: a capture purge on the PRODUCTION app database is a finding', () => {
    const r = run(tree({ [SHOTS]: capturePurgeId('SUBSCRIPTIONTRACKER_D1_DATABASE_ID', PROD_APP_DB) }));
    expectExit(r, 1);
    says(r, `${SHOTS_PURGE_AT} — SUBSCRIPTIONTRACKER_D1_DATABASE_ID=${PROD_APP_DB} is a PRODUCTION database id`);
    says(r, `must name ${API_CFG} env.sandbox APP_DB (${SBX_APP_DB})`);
  });

  test('🔴 a capture purge with no SUBSCRIPTIONTRACKER_D1_DATABASE_ID is a finding', () => {
    const edit = swap(`          SUBSCRIPTIONTRACKER_D1_DATABASE_ID: ${SBX_APP_DB}
`, '');
    const r = run(tree({ [SHOTS]: edit }));
    expectExit(r, 1);
    says(r, `${shotsPurgeAt(edit(SHOTS_GREEN))} — the purge in the sandbox lane \`store-capture\` carries no SUBSCRIPTIONTRACKER_D1_DATABASE_ID`);
  });

  test('🔴 L6f: the API config without env.sandbox is COVERAGE LOST, exit 2', () => {
    const cfg = parseJsonc(readFileSync(join(REPO, API_CFG), 'utf8'));
    assert.ok(cfg.env?.sandbox, 'the real API config has an env.sandbox to delete');
    delete cfg.env.sandbox;
    const r = run(tree({ [API_CFG]: JSON.stringify(cfg, null, 2) }));
    expectExit(r, 2);
    says(r, 'COVERAGE LOST — L6: tooling/store/capture-backend.mjs sandboxBackend() refuses');
    says(r, 'has no `env.sandbox` block');
  });

  test('L6g: store-capture is the only stamp lane marked backend sandbox, and e2e-run is a production lane', () => {
    assert.deepEqual(STAMP_LANES.filter((l) => l.backend === 'sandbox').map((l) => l.resolver), ['store-capture']);
    assert.equal(STAMP_LANES.find((l) => l.resolver === 'e2e-run').backend, undefined);
  });
});
