// ─────────────────────────────────────────────────────────────────────────────
// app-dod.test.mjs — assert-app-dod.mjs must be able to FAIL.
//
// [pipeline N-2 · N-3 · N-5 · N-8 · N-9] The done-record is what makes "is app X
// done?" a query against a record instead of a memory.
//
// 🔴 THE REAL-TREE RUN CAME FIRST, AND THE FIXTURES ENCODE WHAT IT SHOWED. A
// fixture I wrote first would encode the same misunderstanding as the guard I
// wrote — that is exactly how assert-seams-wired.mjs shipped with six green
// fixture tests and a caller check that matched the function's own declaration.
// So before any of this existed, a short-path clone of the real repository was
// stamped with mason (`mason make app -c tooling/bricks/app/_probe_vars.json`),
// producing a genuine `apps/probe` with a rendered `dod.json`, and 22 mutations
// were run against THAT tree — all 22 caught, all restored byte-identically:
//
//   the brick's seed record deleted · a run: line commented out in ci.yml · a
//   lane dropped from ci-gate's needs · a register row naming a guard file that
//   is not there · a DoD item missing from the app record · a mechanical item
//   marked pending · a human item claimed held while the app is only stamped ·
//   features: [] · an anchored test emptied of its body · the anchored
//   implementation symbol renamed away · a mutation record older than the code
//   it probed · humanReview: [] · one of the four required rows missing ·
//   selection.gates.g1a dropped · a decision dated in the future · the public
//   catalogue calling a `stamped` app "live" · a feature row naming a test that
//   is declared nowhere · the register emptied of items · the register emptied
//   of humanReviewRows · --require-stamped with no stamped app · the workspace
//   block gone · and a genuinely shallow clone (`git clone --depth 1`).
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
const GUARD = join(CI_DIR, 'assert-app-dod.mjs');
const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-dod-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

/** A fixture root that is a REAL git repository with one commit, because the
 *  staleness clause reads `git log` and the shallow check reads
 *  `rev-parse --is-shallow-repository`. A directory with no history would make
 *  both clauses answer "could not establish" and quietly stop checking. */
function fixture(files) {
  const dir = join(TMP, `f${seq++}`);
  for (const [rel, body] of Object.entries(files)) {
    if (body === null) continue;
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  mkdirSync(dir, { recursive: true });
  const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'fixture');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture', '--no-gpg-sign');
  return dir;
}

function run(cwd, args = []) {
  const r = spawnSync(process.execPath, [GUARD, cwd, ...args], { encoding: 'utf8', cwd });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// ── the shapes a passing tree has ───────────────────────────────────────────
const REGISTER = {
  humanReviewRows: ['four-states', 'depth-beyond-viewing', 'first-value-and-paywall', 'polish'],
  items: [
    { id: 'A', title: 'Screens', enforcedBy: 'guard', check: 'assert-screen-set.mjs' },
    { id: 'B', title: 'Four states', enforcedBy: 'human', check: 'four-states' },
    { id: 'H', title: 'Proven', enforcedBy: 'lane', check: 'app_brick' },
  ],
};

const CI_YML = `name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  platform:
    runs-on: ubuntu-24.04
    steps:
      # a MENTION of tooling/ci/assert-screen-set.mjs in a comment is not an invocation
      - name: screens
        run: node tooling/ci/assert-screen-set.mjs
  app_brick:
    runs-on: ubuntu-24.04
    steps:
      - name: stamp
        run: echo stamp
  ci-gate:
    runs-on: ubuntu-24.04
    needs: [platform, app_brick]
    if: always()
    steps:
      - run: echo gate
`;

/** A test file whose named test really is a declaration with a body. */
const TEST_DART = `
void main() {
  group('property: account-deletion-works', () {
    test(
      'deleting really goes through the seam, and signs the user out',
      () async {
        expect(1, 1);
      },
    );
  });
}
`;
const SETTINGS_DART = `
class SettingsScreen {
  void build() {
    onConfirm: () => _deleteAccount(context);
  }
  Future<void> _deleteAccount(BuildContext c) async {}
}
`;

/** Today as git will render it for a commit made right now: local calendar
 *  date, zero-padded. See the note on `mutation.date` below for why UTC is the
 *  wrong answer here. */
const LOCAL_TODAY = (() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();

const record = (app, over = {}) => JSON.stringify({
  app,
  status: 'stamped',
  items: {
    A: { claim: 'held', note: 'guarded' },
    B: { claim: 'pending', note: 'human' },
    H: { claim: 'held', note: 'lane' },
  },
  features: [
    {
      name: 'delete account',
      primaryAction: 'the confirm button really requests deletion',
      test: 'deleting really goes through the seam, and signs the user out',
      effect: 'lib/features/settings/settings_screen.dart:_deleteAccount',
      mutation: {
        symbol: 'lib/features/settings/settings_screen.dart:_deleteAccount',
        observedRed: 'deleting really goes through the seam, and signs the user out',
        // A fixture commits today, so a record dated today is exactly current.
        //
        // 🔴 LOCAL DATE, NOT `toISOString()`. The guard compares this against
        // `git log -1 --format=%cs`, which git renders in the COMMIT'S OWN
        // TIMEZONE, while `toISOString()` renders UTC. In any zone ahead of UTC
        // the two disagree for the first hours of every local day — this suite
        // went red at 05:00 IST on 2026-08-03 with the fixture claiming
        // 2026-08-02 and git reporting 2026-08-03, i.e. a staleness failure
        // manufactured entirely by the clock. A test that is red for part of
        // every day is a test somebody learns to ignore.
        date: LOCAL_TODAY,
      },
    },
  ],
  humanReview: REGISTER.humanReviewRows.map((id) => ({ id, verdict: '', reviewer: '', date: '', artifact: '' })),
  selection: { record: '', sha256: '', decided: '', decidedBy: '', gates: { g1a: '', g1b: '', g1c: '', g2: '', g3: '' } },
  ...over,
}, null, 2);

const build = ({ register = REGISTER, ci = CI_YML, workspace = ['packages/core', 'apps/subly'], brickRecord = record('{{app_id}}'), apps = {}, catalogue = null, guards = ['assert-screen-set.mjs'] } = {}) => {
  const files = {
    'pubspec.yaml': `name: fixture\nworkspace:\n${workspace.map((m) => `  - ${m}\n`).join('')}`,
    'tooling/dod-register.json': JSON.stringify(register, null, 2),
    '.github/workflows/ci.yml': ci,
    [`${BRICK}/dod.json`]: brickRecord,
    [`${BRICK}/test/chassis_properties_test.dart`]: TEST_DART,
    [`${BRICK}/lib/features/settings/settings_screen.dart`]: SETTINGS_DART,
  };
  for (const g of guards) files[`tooling/ci/${g}`] = '// a guard\n';
  if (catalogue !== null) files['catalog/apps.json'] = JSON.stringify(catalogue, null, 2);
  for (const [dir, over] of Object.entries(apps)) {
    files[`${dir}/dod.json`] = over.record ?? record(dir.split('/').pop());
    files[`${dir}/test/chassis_properties_test.dart`] = over.testDart ?? TEST_DART;
    files[`${dir}/lib/features/settings/settings_screen.dart`] = over.settings ?? SETTINGS_DART;
  }
  return fixture(files);
};

describe('assert-app-dod', () => {
  test('passes on a tree where the brick carries a seeded done-record', () => {
    const { code, out } = run(build());
    assert.equal(code, 0, out);
    assert.match(out, /ok {2}app DoD/);
  });

  // ── N-2: the DOMAIN, which is the stage's root cause ──────────────────────
  test('COVERAGE LOST when the brick has no seed record — on a clean checkout it is the only subject', () => {
    const { code, out } = run(build({ brickRecord: null }));
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /dod\.json does not exist/);
  });

  test('COVERAGE LOST when --require-stamped runs where the stamp registered nothing', () => {
    const { code, out } = run(build(), ['--require-stamped']);
    assert.equal(code, 1, 'the app_brick lane must not pass over the template alone');
    assert.match(out, /invoked with --require-stamped and the workspace lists no non-exempt app member/);
  });

  test('audits a stamped app the workspace lists, and apps/subly is exempt by name', () => {
    const { code, out } = run(
      build({ workspace: ['apps/subly', 'apps/probe'], apps: { 'apps/probe': {} } }),
      ['--require-stamped'],
    );
    assert.equal(code, 0, out);
    assert.match(out, /plus 1 stamped app\(s\)/);
    assert.match(out, /1 exempt by name/);
  });

  test('FAILS naming the app when a stamped app has no done-record', () => {
    const dir = build({ workspace: ['apps/subly', 'apps/probe'], apps: { 'apps/probe': {} } });
    rmSync(join(dir, 'apps/probe/dod.json'));
    const { code, out } = run(dir);
    assert.equal(code, 1);
    assert.match(out, /probe: no done-record at apps\/probe\/dod\.json/);
  });

  test('COVERAGE LOST when the workspace block is gone', () => {
    const dir = build();
    writeFileSync(join(dir, 'pubspec.yaml'), 'name: fixture\n');
    const { code, out } = run(dir);
    assert.equal(code, 1);
    assert.match(out, /has no `workspace:` block/);
  });

  // ── N-3: presence is not enforcement ──────────────────────────────────────
  test('FAILS when a register row names a guard no workflow run: step invokes', () => {
    const ci = CI_YML.replace('        run: node tooling/ci/assert-screen-set.mjs', '        run: echo nothing');
    const { code, out } = run(build({ ci }));
    assert.equal(code, 1, 'a guard nothing runs cannot fail a build');
    assert.match(out, /NO workflow `run:` step invokes it/);
  });

  // The comment case specifically: ci.yml is full of long explanatory blocks,
  // and this repo has already shipped a grep that matched the comment explaining
  // why a thing did not exist.
  test('a guard named ONLY in a ci.yml comment does not count as invoked', () => {
    const ci = CI_YML.replace(
      '        run: node tooling/ci/assert-screen-set.mjs',
      '        run: echo nothing # node tooling/ci/assert-screen-set.mjs',
    );
    const { code, out } = run(build({ ci }));
    assert.equal(code, 1);
    assert.match(out, /NO workflow `run:` step invokes it/);
  });

  test('FAILS when the lane a row names is outside ci-gate\'s needs', () => {
    const ci = CI_YML.replace('needs: [platform, app_brick]', 'needs: [platform]');
    const { code, out } = run(build({ ci }));
    assert.equal(code, 1, 'a lane outside the required check can go red while the merge goes through');
    assert.match(out, /is not in ci-gate's `needs:`/);
  });

  test('FAILS when a register row names a guard file that is not in tooling/ci/', () => {
    const register = structuredClone(REGISTER);
    register.items[0].check = 'assert-screens.mjs';
    const { code, out } = run(build({ register }));
    assert.equal(code, 1);
    assert.match(out, /which is not a file in tooling\/ci\//);
  });

  test('COVERAGE LOST when the register declares no items', () => {
    const { code, out } = run(build({ register: { ...REGISTER, items: [] } }));
    assert.equal(code, 1);
    assert.match(out, /declares no items/);
  });

  test('COVERAGE LOST when every register row is human — nothing mechanical is left to resolve', () => {
    const register = { ...REGISTER, items: [{ id: 'B', title: 'Four states', enforcedBy: 'human', check: 'four-states' }] };
    const brickRecord = record('{{app_id}}', { items: { B: { claim: 'pending', note: 'human' } } });
    const { code, out } = run(build({ register, brickRecord }));
    assert.equal(code, 1);
    assert.match(out, /not one register item is enforced by a guard or a lane/);
  });

  // ── the per-app record ────────────────────────────────────────────────────
  test('FAILS when the record drops one of the register\'s DoD items', () => {
    const brickRecord = record('{{app_id}}', { items: { A: { claim: 'held' }, B: { claim: 'pending' } } });
    const { code, out } = run(build({ brickRecord }));
    assert.equal(code, 1);
    assert.match(out, /has no row for DoD item H/);
  });

  test('FAILS when a MECHANICAL item is marked pending — apps do not opt out of standing guards', () => {
    const brickRecord = record('{{app_id}}', {
      items: { A: { claim: 'pending' }, B: { claim: 'pending' }, H: { claim: 'held' } },
    });
    const { code, out } = run(build({ brickRecord }));
    assert.equal(code, 1);
    assert.match(out, /is marked "pending", but it is enforced by guard/);
  });

  test('FAILS when a HUMAN item is claimed held while the app is only stamped', () => {
    const brickRecord = record('{{app_id}}', {
      items: { A: { claim: 'held' }, B: { claim: 'held' }, H: { claim: 'held' } },
    });
    const { code, out } = run(build({ brickRecord }));
    assert.equal(code, 1, 'a verdict nobody recorded is the folklore N-8 exists to end');
    assert.match(out, /it is a HUMAN judgment and the app's status is "stamped"/);
  });

  test('FAILS when an app invents a DoD item the register does not declare', () => {
    const brickRecord = record('{{app_id}}', {
      items: { A: { claim: 'held' }, B: { claim: 'pending' }, H: { claim: 'held' }, Z: { claim: 'held' } },
    });
    const { code, out } = run(build({ brickRecord }));
    assert.equal(code, 1);
    assert.match(out, /claims DoD item "Z", which has no row/);
  });

  // 🔴 THE FALSIFIABLE ANCHOR that stops `stamped` becoming a permanent excuse.
  // Without it the lifecycle field is a new name for the vacuity it replaced.
  test('FAILS when the public catalogue calls a `stamped` app live', () => {
    const { code, out } = run(build({
      workspace: ['apps/probe'],
      apps: { 'apps/probe': {} },
      catalogue: [{ slug: 'probe', status: 'live' }],
    }));
    assert.equal(code, 1);
    assert.match(out, /advertises it as "live" to the public/);
  });

  test('a `claiming-done` app is NOT flagged by the catalogue anchor', () => {
    const done = JSON.parse(record('probe'));
    done.status = 'claiming-done';
    done.items.B.claim = 'held';
    for (const r of done.humanReview) {
      r.verdict = 'pass'; r.reviewer = 'owner'; r.date = '2026-07-30'; r.artifact = 'abc1234';
    }
    done.selection = { record: 'company/app-selection/probe.md', sha256: 'deadbeef', decided: '2026-07-30', decidedBy: 'owner', gates: { g1a: 'y', g1b: 'y', g1c: 'y', g2: 'y', g3: 'y' } };
    const { code, out } = run(build({
      workspace: ['apps/probe'],
      apps: { 'apps/probe': { record: JSON.stringify(done, null, 2) } },
      catalogue: [{ slug: 'probe', status: 'live' }],
    }));
    assert.equal(code, 0, out);
    assert.match(out, /1 app\(s\) claiming done/);
    // …and it says out loud which half it could not check from the public repo.
    assert.match(out, /NOT verifiable from the public repo/);
  });

  // ── N-5: resolve, do not match ────────────────────────────────────────────
  test('FAILS on features: [] — the vacuous domain N-5 exists to replace', () => {
    const { code, out } = run(build({ brickRecord: record('{{app_id}}', { features: [] }) }));
    assert.equal(code, 1);
    assert.match(out, /`features: \[\]`/);
  });

  test('FAILS when the named test exists only as a string, not a declaration', () => {
    const testDart = `void main() {\n  // deleting really goes through the seam, and signs the user out\n  final s = 'deleting really goes through the seam, and signs the user out';\n}\n`;
    const dir = build();
    writeFileSync(join(dir, BRICK, 'test/chassis_properties_test.dart'), testDart);
    const { code, out } = run(dir);
    assert.equal(code, 1, 'a bare-string match is not even a usage');
    assert.match(out, /DECLARATION/);
  });

  test('FAILS when the named test is declared with an EMPTY body', () => {
    const testDart = `void main() {\n  test(\n    'deleting really goes through the seam, and signs the user out',\n    () async {},\n  );\n}\n`;
    const dir = build();
    writeFileSync(join(dir, BRICK, 'test/chassis_properties_test.dart'), testDart);
    const { code, out } = run(dir);
    assert.equal(code, 1, 'a test that asserts nothing passes forever');
    assert.match(out, /EMPTY BODY/);
  });

  test('FAILS when the implementation anchor is gone but the test remains', () => {
    const dir = build();
    writeFileSync(join(dir, BRICK, 'lib/features/settings/settings_screen.dart'), 'class SettingsScreen {}\n');
    const { code, out } = run(dir);
    assert.equal(code, 1, 'a hollow test left behind after the implementation is deleted must go red');
    assert.match(out, /no longer appears in/);
  });

  test('an anchor that survives only inside a COMMENT does not count', () => {
    const dir = build();
    writeFileSync(join(dir, BRICK, 'lib/features/settings/settings_screen.dart'), '// _deleteAccount used to live here\nclass SettingsScreen {}\n');
    const { code, out } = run(dir);
    assert.equal(code, 1);
    assert.match(out, /no longer appears in/);
  });

  test('FAILS when the mutation record is older than the code it probed', () => {
    const rec = JSON.parse(record('{{app_id}}'));
    rec.features[0].mutation.date = '2020-01-01';
    const { code, out } = run(build({ brickRecord: JSON.stringify(rec, null, 2) }));
    assert.equal(code, 1, '"proven once" must become "proven against what is there now"');
    assert.match(out, /The record now describes code that is no longer there/);
  });

  test('FAILS when a mutation record has no date at all', () => {
    const rec = JSON.parse(record('{{app_id}}'));
    delete rec.features[0].mutation.date;
    const { code, out } = run(build({ brickRecord: JSON.stringify(rec, null, 2) }));
    assert.equal(code, 1);
    assert.match(out, /`mutation\.date` is missing or blank/);
  });

  // ── N-8: the human half ───────────────────────────────────────────────────
  test('FAILS on humanReview: [] — no malformed rows means every row is well-formed', () => {
    const { code, out } = run(build({ brickRecord: record('{{app_id}}', { humanReview: [] }) }));
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — `humanReview: \[\]`/);
  });

  test('FAILS naming the missing row when three of the four are present', () => {
    const rows = REGISTER.humanReviewRows.slice(1).map((id) => ({ id, verdict: '', reviewer: '', date: '', artifact: '' }));
    const { code, out } = run(build({ brickRecord: record('{{app_id}}', { humanReview: rows }) }));
    assert.equal(code, 1);
    assert.match(out, /is MISSING the required row "four-states"/);
  });

  test('FAILS when a human-review row has no artifact field — a verdict with no artifact is a memory', () => {
    const rows = REGISTER.humanReviewRows.map((id) => ({ id, verdict: '', reviewer: '', date: '' }));
    const { code, out } = run(build({ brickRecord: record('{{app_id}}', { humanReview: rows }) }));
    assert.equal(code, 1);
    assert.match(out, /has no `artifact` field/);
  });

  test('COVERAGE LOST when the register names no humanReviewRows', () => {
    const { code, out } = run(build({ register: { ...REGISTER, humanReviewRows: [] } }));
    assert.equal(code, 1);
    assert.match(out, /declares no `humanReviewRows`/);
  });

  // ── N-9: only what CI can see ─────────────────────────────────────────────
  test('FAILS when the portfolio-level gate g1a is absent from the record', () => {
    const rec = JSON.parse(record('{{app_id}}'));
    delete rec.selection.gates.g1a;
    const { code, out } = run(build({ brickRecord: JSON.stringify(rec, null, 2) }));
    assert.equal(code, 1);
    assert.match(out, /`selection\.gates\.g1a` is absent/);
  });

  test('FAILS on a selection decision dated in the future', () => {
    const rec = JSON.parse(record('{{app_id}}'));
    rec.selection.decided = '2099-01-01';
    const { code, out } = run(build({ brickRecord: JSON.stringify(rec, null, 2) }));
    assert.equal(code, 1);
    assert.match(out, /in the future/);
  });

  // ⚠️ The honest limit, asserted rather than described: CI cannot resolve a link
  // into Private/, and this guard says so on every run instead of reporting a
  // check it did not perform.
  test('PRINTS the unverifiable half rather than claiming to have checked it', () => {
    const rec = JSON.parse(record('{{app_id}}'));
    rec.selection.record = 'company/app-selection/x.md';
    rec.selection.sha256 = 'abc123';
    const { code, out } = run(build({ brickRecord: JSON.stringify(rec, null, 2) }));
    assert.equal(code, 0, out);
    assert.match(out, /NOT verifiable from the public repo/);
  });
});
