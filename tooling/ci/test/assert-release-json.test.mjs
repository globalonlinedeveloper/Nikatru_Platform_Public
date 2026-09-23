// ─────────────────────────────────────────────────────────────────────────────
// assert-release-json.test.mjs — the mutation matrix for
// `tooling/ci/assert-release-json.mjs` and the emitter it grades,
// `release-manifest.mjs --emit-release-json`.
//
// 🔴 A GUARD THAT CANNOT FAIL IS NOT A GUARD, and this one runs on a tree where
// no release has ever been cut — so on the real repository it is never even
// called. Read alone, that says nothing about whether it works. Every case here
// therefore builds a REAL release directory from the REAL register and the REAL
// tool.json, and breaks exactly one thing.
//
// GREEN CONTROL FIRST (the first case): without a run over an unmutated release
// that exits 0, every red below is equally consistent with a guard that refuses
// everything.
//
// 🔴 THE SELF-TEST IS NOT A SECOND COPY OF THESE CASES — IT IS THE SAME ONE.
// `--self-test` lives inside the guard because ci.yml and spec-guards.mjs both
// call the guard and neither runs `node --test`; this file spawns it so that a
// break in the matrix is also a `node --test` failure, and so the two can never
// disagree about what the guard does. What this file adds on top is the part a
// self-test cannot honestly assert about itself: that the EMITTER's output is
// what the guard accepts, end to end, and that deleting a limb makes it pass.
//
// Run:  node --test tooling/ci/test/assert-release-json.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-release-json.mjs');
const EMITTER = join(REPO, 'tooling', 'ci', 'release-manifest.mjs');
const SCHEMA = join(REPO, 'contracts', 'release.schema.json');

const run = (script, args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

/** One staged release directory, built the way the lane builds it: assets, then
 *  `--emit-release-json`, then `--write` (which is what puts release.json into
 *  SHA256SUMS). Nothing is hand-written — a fixture whose manifest was typed
 *  cannot catch the emitter writing a manifest the lane would not. */
function stage({ app = 'subscriptiontracker', tag = 'subscriptiontracker-v1.0.0', version = '1.0.0', assets = null, emitArgs = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'release-json-test-'));
  const files = assets ?? [
    ['subscriptiontracker-v1.0.0-app-release.aab', 'aab bytes'],
    ['subscriptiontracker-v1.0.0-app-release.apk', 'apk bytes'],
    ['subscriptiontracker-v1.0.0-linux-x64.tar.gz', 'archive bytes'],
  ];
  for (const [name, body] of files) writeFileSync(join(dir, name), body);
  const emit = run(EMITTER, [
    '--emit-release-json', dir,
    '--app', app,
    '--tag', tag,
    '--sha', 'a'.repeat(40),
    '--run-url', 'https://github.com/nikatru/platform/actions/runs/1',
    '--notes-url', 'https://github.com/nikatru/platform/releases/tag/x',
    '--released-at', '2026-09-22T10:00:00Z',
    '--version', version,
    '--min-supported', '1.0.0',
    '--build', '7',
    '--repo-root', REPO,
    ...emitArgs,
  ]);
  const write = run(EMITTER, ['--write', dir, '--app', app, '--tag', tag, '--sha', 'a'.repeat(40), '--run-url', 'https://github.com/nikatru/platform/actions/runs/1', '--repo-root', REPO]);
  return { dir, emit, write, record: () => JSON.parse(readFileSync(join(dir, 'release.json'), 'utf8')) };
}

const grade = (dir) => run(GUARD, ['--dir', dir, '--repo-root', REPO]);
const reseal = (dir, record) => writeFileSync(join(dir, 'release.json'), `${JSON.stringify(record, null, 2)}\n`);

describe('assert-release-json', () => {
  test('M0 GREEN CONTROL — a release the lane itself staged passes', () => {
    const s = stage();
    assert.equal(s.emit.status, 0, s.emit.stderr);
    assert.equal(s.write.status, 0, s.write.stderr);
    const g = grade(s.dir);
    assert.equal(g.status, 0, `${g.stdout}${g.stderr}`);
    assert.match(g.stdout, /^ok {2}release\.json/m);
    rmSync(s.dir, { recursive: true, force: true });
  });

  test('the emitter runs BEFORE --write, so SHA256SUMS names release.json', () => {
    const s = stage();
    const manifest = readFileSync(join(s.dir, 'SHA256SUMS'), 'utf8');
    assert.match(manifest, /^[0-9a-f]{64} {2}release\.json$/m);
    rmSync(s.dir, { recursive: true, force: true });
  });

  test('M1 the record is schema-valid, and the schema is one the validator understands', () => {
    // A keyword schema-validate.mjs does not implement is REFUSED, not skipped,
    // so this also asserts that contracts/release.schema.json never grows a
    // `minimum` or a `$ref` the grader would silently ignore.
    assert.ok(existsSync(SCHEMA));
    const s = stage();
    const g = grade(s.dir);
    assert.equal(g.status, 0, `${g.stdout}${g.stderr}`);
    rmSync(s.dir, { recursive: true, force: true });
  });

  test('M2 channels are DERIVED — the .aab carries android-play and the .apk does not', () => {
    const s = stage();
    const byName = new Map(s.record().artefacts.map((a) => [a.name, a]));
    assert.deepEqual(byName.get('subscriptiontracker-v1.0.0-app-release.aab').channels, ['android-play']);
    // ⚠️ MEASURED, NOT ASSUMED: `.apk` is no longer channel-less. The apps.gov.in
    // row accepts it, so the derivation returns it — and EXTRA_INSTALLABLE's
    // comment in release-manifest.mjs, which still says no channel accepts an
    // .apk, is stale rather than this assertion being wrong.
    assert.ok(byName.get('subscriptiontracker-v1.0.0-app-release.apk').channels.includes('apps-gov-in'));
    rmSync(s.dir, { recursive: true, force: true });
  });

  test('M3 one chromium zip reaches TWO stores and the firefox zip reaches one', () => {
    const s = stage({
      app: 'fullshot',
      tag: 'fullshot-v1.0.0',
      assets: [['fullshot-chromium.zip', 'chromium bytes'], ['fullshot-firefox.zip', 'firefox bytes']],
    });
    assert.equal(s.emit.status, 0, s.emit.stderr);
    const byName = new Map(s.record().artefacts.map((a) => [a.name, a]));
    assert.deepEqual(byName.get('fullshot-chromium.zip').channels, ['chrome-webstore', 'edge-addons']);
    assert.deepEqual(byName.get('fullshot-firefox.zip').channels, ['amo']);
    // The extension surface has no build number, and the field is present anyway.
    assert.equal(byName.get('fullshot-firefox.zip').build, null);
    assert.equal(grade(s.dir).status, 0);
    rmSync(s.dir, { recursive: true, force: true });
  });

  test('M4 RED — bytes that drift after the record is written', () => {
    const s = stage();
    writeFileSync(join(s.dir, 'subscriptiontracker-v1.0.0-app-release.aab'), 'someone else s bytes');
    const g = grade(s.dir);
    assert.equal(g.status, 1);
    assert.match(g.stderr, /\[limb 4\].*the bytes hash to/s);
    rmSync(s.dir, { recursive: true, force: true });
  });

  test('M5 RED — a published file the record is silent about', () => {
    const s = stage();
    writeFileSync(join(s.dir, 'subscriptiontracker-v1.0.0-unsigned.apk'), 'x');
    const g = grade(s.dir);
    assert.equal(g.status, 1);
    assert.match(g.stderr, /\[limb 2\].*does not describe it/s);
    rmSync(s.dir, { recursive: true, force: true });
  });

  test('M6 RED — a channel from the other surface', () => {
    const s = stage();
    const record = s.record();
    record.artefacts[0].channels = ['chrome-webstore'];
    reseal(s.dir, record);
    const g = grade(s.dir);
    assert.equal(g.status, 1);
    assert.match(g.stderr, /\[limb 6\].*is not on the "app" surface/s);
    rmSync(s.dir, { recursive: true, force: true });
  });

  test('M7 the untagged sentinel is graded, and the skipped comparison is PRINTED', () => {
    // Every scheduled and dispatched build-platforms run produces this tag. The
    // emit and validate steps are not tag-gated on purpose, so a schema or a
    // guard that refused the sentinel would turn every such run red.
    const s = stage({ tag: 'subscriptiontracker-untagged-abc1234' });
    assert.equal(s.emit.status, 0, s.emit.stderr);
    const g = grade(s.dir);
    assert.equal(g.status, 0, `${g.stdout}${g.stderr}`);
    assert.match(g.stdout, /limb 7 SKIPPED/);
    rmSync(s.dir, { recursive: true, force: true });
  });

  test('M8 RED — a second emit into the same directory is refused, not overwritten', () => {
    const s = stage();
    const again = run(EMITTER, [
      '--emit-release-json', s.dir, '--app', 'subscriptiontracker', '--tag', 'subscriptiontracker-v1.0.0',
      '--sha', 'b'.repeat(40), '--run-url', 'https://github.com/nikatru/platform/actions/runs/2',
      '--notes-url', 'https://github.com/nikatru/platform/releases/tag/x', '--released-at', '2026-09-22T11:00:00Z',
      '--version', '1.0.0', '--min-supported', '1.0.0', '--repo-root', REPO,
    ]);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /already exists/);
    rmSync(s.dir, { recursive: true, force: true });
  });

  test('M9 COVERAGE LOST is exit 2, never exit 1 — a directory with no record', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-json-test-'));
    writeFileSync(join(dir, 'subscriptiontracker-v1.0.0-app-release.aab'), 'aab');
    const g = grade(dir);
    assert.equal(g.status, 2, `${g.stdout}${g.stderr}`);
    assert.match(g.stderr, /COVERAGE LOST/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('M10 --surface never overrides the tree, it only restates it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-json-test-'));
    writeFileSync(join(dir, 'subscriptiontracker-v1.0.0-app-release.aab'), 'aab');
    const r = run(EMITTER, [
      '--emit-release-json', dir, '--app', 'subscriptiontracker', '--tag', 'subscriptiontracker-v1.0.0',
      '--sha', 'a'.repeat(40), '--run-url', 'https://x/1', '--notes-url', 'https://x/2',
      '--released-at', '2026-09-22T10:00:00Z', '--version', '1.0.0', '--min-supported', '1.0.0',
      '--surface', 'extension', '--repo-root', REPO,
    ]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /disagrees with the tree/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('M11 the guard\'s own mutation matrix is green (--self-test)', () => {
    const r = run(GUARD, ['--self-test', '--repo-root', REPO]);
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /^\d+ pass, 0 fail$/m);
    // Every case in it is a RED control: each breaks one thing and requires the
    // guard to name it. A matrix that shrank to nothing would still print
    // "0 pass, 0 fail", so the count is asserted to be a real one.
    const [, passed] = /^(\d+) pass, 0 fail$/m.exec(r.stdout);
    assert.ok(Number(passed) >= 20, `the self-test matrix has shrunk to ${passed} cases`);
  });
});
