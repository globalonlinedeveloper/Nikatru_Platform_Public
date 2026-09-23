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
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { servedFloor, productSurfaces } from '../release-manifest.mjs';
import { parseAllWorkflows, shellSegments, stepShell } from '../workflow-scan.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-release-json.mjs');
const EMITTER = join(REPO, 'tooling', 'ci', 'release-manifest.mjs');
const SCHEMA = join(REPO, 'contracts', 'release.schema.json');
const SERVED_CONFIG = join(REPO, 'services', 'platform', 'src', 'app-config-data.json');

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
    // The app surface READS its floor (app-config-data.json) and refuses the flag;
    // every other surface states it. Which one is decided by the tree, as the
    // emitter decides it — never by a list of ids typed here.
    ...(existsSync(join(REPO, 'apps', app)) ? [] : ['--min-supported', '1.0.0']),
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
      '--version', '1.0.0', '--repo-root', REPO,
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
      '--released-at', '2026-09-22T10:00:00Z', '--version', '1.0.0',
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

// ─────────────────────────────────────────────────────────────────────────────
// THE RECORD'S minSupported IS THE SERVED FLOOR (O-RELEASE-RECORD-MINSUPPORTED-NOT-XYZ).
//
// build-platforms run 35829208001 passed `--min-supported "$RELEASE_LINE"` — the
// pubspec MAJOR.MINOR — and its grade step printed
//   [limb 1] schema: #/minSupported: "1.0" does not match ^[0-9]+\.[0-9]+\.[0-9]+$
// The emitter now READS the app surface's floor from the file the platform Worker
// enforces force-update from, and refuses the flag there. Each red below breaks
// one thing about that read; F1 is the green control they are all read against.
// ─────────────────────────────────────────────────────────────────────────────

/** A throwaway tree the emitter accepts as a repo root: the app directory the
 *  surface is read from, the real register, and an app-config-data.json this
 *  case writes (or none, when `config` is null). */
function floorTree(config) {
  const root = mkdtempSync(join(tmpdir(), 'release-floor-tree-'));
  mkdirSync(join(root, 'apps', 'subscriptiontracker'), { recursive: true });
  mkdirSync(join(root, 'tooling'), { recursive: true });
  copyFileSync(join(REPO, 'tooling', 'channel-register.json'), join(root, 'tooling', 'channel-register.json'));
  if (config !== null) {
    mkdirSync(join(root, 'services', 'platform', 'src'), { recursive: true });
    writeFileSync(join(root, 'services', 'platform', 'src', 'app-config-data.json'), `${JSON.stringify(config, null, 2)}\n`);
  }
  return root;
}

/** One app-surface emit against `root`, with one asset, and no --min-supported
 *  unless the case passes it. */
function emitApp(root, extra = []) {
  const dir = mkdtempSync(join(tmpdir(), 'release-floor-dir-'));
  writeFileSync(join(dir, 'subscriptiontracker-v1.0.0-app-release.aab'), 'aab bytes');
  const r = run(EMITTER, [
    '--emit-release-json', dir, '--app', 'subscriptiontracker', '--tag', 'subscriptiontracker-v1.0.0',
    '--sha', 'a'.repeat(40), '--run-url', 'https://x/1', '--notes-url', 'https://x/2',
    '--released-at', '2026-09-22T10:00:00Z', '--version', '1.0.7', '--repo-root', root, ...extra,
  ]);
  const record = existsSync(join(dir, 'release.json')) ? JSON.parse(readFileSync(join(dir, 'release.json'), 'utf8')) : null;
  rmSync(dir, { recursive: true, force: true });
  return { r, record };
}

describe('the release record\'s minSupported is the served floor', () => {
  test('F1 GREEN CONTROL — on the real tree the record states the served floor, and says where it read it', () => {
    const served = servedFloor(JSON.parse(readFileSync(SERVED_CONFIG, 'utf8')), 'subscriptiontracker');
    assert.equal(typeof served.value, 'string', JSON.stringify(served));
    const s = stage();
    assert.equal(s.emit.status, 0, s.emit.stderr);
    assert.equal(s.record().minSupported, served.value);
    assert.match(s.emit.stdout, /minSupported {2}\S+ {2}read from services\/platform\/src\/app-config-data\.json /);
    const g = grade(s.dir);
    assert.equal(g.status, 0, `${g.stdout}${g.stderr}`);
    rmSync(s.dir, { recursive: true, force: true });
  });

  test('F2 RED — --min-supported on the app surface is REFUSED, naming the file that owns the value', () => {
    // "1.0" is the value run 35829208001 passed. It is refused for being PASSED
    // on this surface, before its shape is ever looked at: a well-formed "1.0.0"
    // would be the same second copy.
    const s = stage({ emitArgs: ['--min-supported', '1.0'] });
    assert.equal(s.emit.status, 1, `${s.emit.stdout}${s.emit.stderr}`);
    assert.match(s.emit.stderr, /--min-supported is refused on the app surface/);
    assert.match(s.emit.stderr, /services\/platform\/src\/app-config-data\.json/);
    assert.equal(existsSync(join(s.dir, 'release.json')), false);
    rmSync(s.dir, { recursive: true, force: true });
  });

  test('F3 RED — a well-formed --min-supported is refused on the app surface too', () => {
    const s = stage({ emitArgs: ['--min-supported', '1.0.0'] });
    assert.equal(s.emit.status, 1, `${s.emit.stdout}${s.emit.stderr}`);
    assert.match(s.emit.stderr, /refused on the app surface/);
    rmSync(s.dir, { recursive: true, force: true });
  });

  test('F4 a per-app min_supported_version WINS over defaults (the Worker\'s deep merge)', () => {
    const data = { defaults: { min_supported_version: '1.0.0' }, apps: { x: { min_supported_version: '2.1.0' } } };
    assert.deepEqual(servedFloor(data, 'x'), { value: '2.1.0', from: 'apps.x.min_supported_version' });
  });

  test('F5 an app with no key of its own answers from defaults', () => {
    const data = { defaults: { min_supported_version: '1.0.0' }, apps: { x: { features: {} } } };
    assert.deepEqual(servedFloor(data, 'x'), { value: '1.0.0', from: 'defaults.min_supported_version' });
  });

  test('F6 the per-app override wins END TO END — the record carries the app\'s own floor', () => {
    const root = floorTree({ defaults: { min_supported_version: '1.0.0' }, apps: { subscriptiontracker: { min_supported_version: '1.0.5' } } });
    const { r, record } = emitApp(root);
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.equal(record.minSupported, '1.0.5');
    assert.match(r.stdout, /apps\.subscriptiontracker\.min_supported_version/);
    rmSync(root, { recursive: true, force: true });
  });

  test('F7 RED — no floor declared anywhere is REFUSED, never defaulted (pure)', () => {
    const f = servedFloor({ defaults: {}, apps: { x: {} } }, 'x');
    assert.equal(f.value, undefined);
    assert.match(f.refused, /defaults\.min_supported_version is absent/);
  });

  test('F8 RED — no floor declared anywhere is REFUSED by the emitter, and nothing is written', () => {
    const root = floorTree({ defaults: { update_url: 'https://example.invalid/' }, apps: {} });
    const { r, record } = emitApp(root);
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /declares no served floor for --app "subscriptiontracker"/);
    assert.equal(record, null);
    rmSync(root, { recursive: true, force: true });
  });

  test('F9 RED — an EMPTY per-app floor is refused, not skipped past to the defaults', () => {
    // The Worker's merge would serve the app's "" — the app reads that as no
    // floor and fails open — so answering with the default would describe a
    // floor nobody is served.
    const f = servedFloor({ defaults: { min_supported_version: '1.0.0' }, apps: { x: { min_supported_version: '' } } }, 'x');
    assert.equal(f.value, undefined);
    assert.match(f.refused, /apps\.x\.min_supported_version is "", which is not a version/);
  });

  test('F10 COVERAGE LOST — a tree with no app-config-data.json is exit 2, not a typed fallback', () => {
    const root = floorTree(null);
    const { r, record } = emitApp(root);
    assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /COVERAGE LOST — services\/platform\/src\/app-config-data\.json does not exist/);
    assert.equal(record, null);
    rmSync(root, { recursive: true, force: true });
  });

  test('F11 RED — the extension surface still STATES its floor: no --min-supported there is refused', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-floor-dir-'));
    writeFileSync(join(dir, 'fullshot-chromium.zip'), 'chromium bytes');
    const r = run(EMITTER, [
      '--emit-release-json', dir, '--app', 'fullshot', '--tag', 'fullshot-v1.0.0',
      '--sha', 'a'.repeat(40), '--run-url', 'https://x/1', '--notes-url', 'https://x/2',
      '--released-at', '2026-09-22T10:00:00Z', '--version', '1.0.0', '--repo-root', REPO,
    ]);
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /needs --min-supported <X\.Y\.Z> for --app "fullshot" on the "extension" surface/);
    rmSync(dir, { recursive: true, force: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE CLASS: EVERY `--emit-release-json` A WORKFLOW RUNS EMITS A RECORD THE SCHEMA
// ACCEPTS — graded on every PR, not first on a branch build.
//
// 🔴 WHY THE CASES ABOVE WERE NOT ENOUGH. Every one of them builds its OWN
// argument list, so each is a test of the emitter given the arguments this file
// chose. None is a test of the arguments THE LANE passes, and that is where the
// defect was: build-platforms.yml passed `--min-supported "$RELEASE_LINE"`, the
// grade step ran only inside a dispatched branch build, and run 35829208001 was
// the first place anything read the value the lane really computed:
//   [limb 1] schema: #/minSupported: "1.0" does not match ^[0-9]+\.[0-9]+\.[0-9]+$
//
// WHAT THIS DOES, per invocation. The invocations are FOUND by
// tooling/ci/workflow-scan.mjs — its logical lines and its `shellSegments`, the
// same reduction every workflow guard here reads — never by a pattern of this
// file's own over the YAML. For each one, the step that holds it is EXECUTED:
// its `env:` with every `${{ … }}` replaced from laneContext() below, and its
// `run:` script under bash exactly as GitHub starts it, so every flag value is
// computed by the lane's own shell and the emitters it calls
// (`assert-app-versioning.mjs --emit`, `git show`). A `node` shell function
// stands in front of ONE command only — the emit — and records the arguments it
// was given instead of writing into the lane's directory. The real emitter is
// then run with exactly those arguments into a temporary directory holding one
// fixture asset, `--write` seals it, and assert-release-json.mjs grades it.
//
// ⚠️ WHAT IT DOES NOT PROVE: the asset set. One fixture asset per invocation is
// what makes a record at all; the lane's real set is the build's, and
// release-durable/assert-release-durable own the step order around it.
//
// ⚠️ AN EXPRESSION laneContext() DOES NOT KNOW FAILS CLOSED, and so does a step
// that runs under anything but bash, and a step that emits zero or two times.
// A value this file had to guess would be the second copy this class exists to
// remove.
// ─────────────────────────────────────────────────────────────────────────────

/** The `${{ … }}` values a release lane is given by GitHub, one fixed answer
 *  each. `matrix.app` is an app-surface product and the `steps.tag` outputs an
 *  extension-surface one, so both surfaces are exercised by the real lanes. */
function laneContext() {
  const git = (...a) => spawnSync('git', a, { cwd: REPO, encoding: 'utf8' }).stdout.trim();
  const sha = git('rev-parse', 'HEAD');
  return {
    sha,
    short: git('rev-parse', '--short', 'HEAD'),
    expressions: {
      'matrix.app': 'subscriptiontracker',
      'github.server_url': 'https://github.com',
      'github.repository': 'nikatru/platform',
      'github.run_id': '1',
      'github.run_number': '7',
      'github.sha': sha,
      'github.ref_name': 'fullshot-v1.0.0',
      'steps.tag.outputs.id': 'fullshot',
      'steps.tag.outputs.version': '1.0.0',
    },
  };
}

const indentOf = (t) => t.match(/^ */)[0].length;
const unquote = (v) => v.replace(/^(['"])(.*)\1$/, '$2');

/** Every `release-manifest.mjs --emit-release-json` segment in the workflows
 *  under `wfRoot`, as `{ wf, job, n }` — `n` the logical line's number, which is
 *  the `run:` key's line for a block scalar. */
function emitInvocations(wfRoot) {
  const found = [];
  for (const wf of parseAllWorkflows(wfRoot)) {
    for (const job of wf.jobs.values()) {
      for (const l of job.logical) {
        for (const seg of shellSegments(l.text)) {
          const t = seg.trim().split(/\s+/);
          const at = t.findIndex((x) => x.endsWith('release-manifest.mjs'));
          if (at !== -1 && t[at + 1] === '--emit-release-json') found.push({ wf, job, n: l.n });
        }
      }
    }
  }
  return found;
}

/** `defaults: run: working-directory:` among raw `lines`, the `defaults:` key at
 *  `base` spaces — or null. */
function defaultsWorkingDirectory(lines, base) {
  for (let i = 0; i < lines.length; i++) {
    const d = lines[i].match(/^( *)defaults:\s*$/);
    if (!d || d[1].length !== base) continue;
    for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || indentOf(lines[j]) > base); j++) {
      const w = lines[j].match(/^\s*working-directory:\s*(\S.*?)\s*$/);
      if (w) return unquote(w[1]);
    }
  }
  return null;
}

/** The step holding raw line `n` (1-based): its `env:`, its `run:` script as the
 *  shell receives it, and its `working-directory:`. Read from the RAW file, not
 *  workflow-scan's comment-blanked lines — a `#` inside a script is the script's,
 *  and the script is what is executed here. */
function readStep(raw, n) {
  const isItem = (t) => /^\s*-\s/.test(t);
  let start = n - 1;
  const selfIndent = indentOf(raw[start]);
  if (!isItem(raw[start])) while (start > 0 && !(isItem(raw[start]) && indentOf(raw[start]) < selfIndent)) start -= 1;
  const stepIndent = indentOf(raw[start]);
  const body = [raw[start].replace(/^(\s*)-\s/, '$1  ')];
  for (let j = start + 1; j < raw.length && (raw[j].trim() === '' || indentOf(raw[j]) > stepIndent); j++) body.push(raw[j]);
  const step = { env: {}, run: null, workingDirectory: null };
  for (let i = 0; i < body.length; i++) {
    const m = indentOf(body[i]) === stepIndent + 2 && body[i].match(/^\s*([A-Za-z-]+):\s*(.*?)\s*$/);
    if (!m) continue;
    const block = [];
    for (let k = i + 1; k < body.length && (body[k].trim() === '' || indentOf(body[k]) > stepIndent + 2); k++) block.push(body[k]);
    if (m[1] === 'env') {
      for (const e of block) {
        const em = !/^\s*#/.test(e) && e.match(/^\s*([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/);
        if (em) step.env[em[1]] = unquote(em[2].replace(/\s+#.*$/, ''));
      }
    } else if (m[1] === 'run' && /^[|>]/.test(m[2])) {
      while (block.length && block.at(-1).trim() === '') block.pop();
      const cut = Math.min(...block.filter((l) => l.trim() !== '').map(indentOf));
      const lines = block.map((l) => l.slice(Math.min(cut, indentOf(l))));
      step.run = m[2].startsWith('|') ? lines.join('\n') : lines.join('\n').split(/\n\s*\n/).map((p) => p.split('\n').join(' ')).join('\n');
    } else if (m[1] === 'run') {
      step.run = unquote(m[2]);
    } else if (m[1] === 'working-directory') {
      step.workingDirectory = unquote(m[2]);
    }
  }
  return step;
}

/** The shell function the step's script runs behind: the emit is RECORDED, one
 *  file per call; every other `node` runs for real. */
const EMIT_SHIM = [
  'EMIT_N=0',
  'node() {',
  '  case "${1:-}" in',
  '    *release-manifest.mjs) if [ "${2:-}" = --emit-release-json ]; then',
  '      EMIT_N=$((EMIT_N + 1)); printf \'%s\\0\' "$@" > "${EMIT_ARGS_FILE}.${EMIT_N}"; return 0; fi ;;',
  '  esac',
  '  command node "$@"',
  '}',
].join('\n');

/** Executes the step holding one invocation and grades what it would emit.
 *  `{ where, app, surface, ok, output }`. */
function gradeInvocation(wfRoot, inv, ctx) {
  const where = `${inv.wf.rel}:${inv.n} (job "${inv.job.name}")`;
  const fail = (output, extra = {}) => ({ where, ok: false, output, app: null, surface: null, ...extra });
  const raw = readFileSync(join(wfRoot, inv.wf.rel), 'utf8').split('\n');
  const step = readStep(raw, inv.n);
  if (step.run === null) return fail('the step holding it has no `run:` this can read');
  const sh = stepShell(inv.wf, inv.n);
  if (sh.family !== 'bash') return fail(`the step runs under ${sh.shell ?? `an unknown shell (${sh.why})`}; only bash steps are executed here`);
  const unknown = [];
  const expand = (s) => s.replace(/\$\{\{\s*(.+?)\s*\}\}/g, (all, e) => ctx.expressions[e] ?? (unknown.push(e), all));
  const env = Object.fromEntries(Object.entries(step.env).map(([k, v]) => [k, expand(v)]));
  const script = expand(step.run);
  if (unknown.length) return fail(`\${{ ${unknown.join(' }}, ${{ ')} }} has no value in laneContext() — refusing to guess one`);
  const jobRaw = raw.slice(inv.job.lines[0].n - 1, inv.job.lines.at(-1).n);
  const wd = step.workingDirectory ?? defaultsWorkingDirectory(jobRaw, 4) ?? defaultsWorkingDirectory(raw.slice(0, inv.wf.jobsAt ?? raw.length), 0) ?? '.';
  const cwd = resolve(REPO, wd);
  const tmp = mkdtempSync(join(tmpdir(), 'release-json-lane-'));
  try {
    const argsFile = join(tmp, 'emit-args');
    const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', `${EMIT_SHIM}\n${script}`], {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_SHA: ctx.sha,
        // Written to $GITHUB_ENV by the "Stage" step two steps up; the sentinel is
        // the tag every dispatched branch build carries, run 35829208001 included.
        RELEASE_TAG: `subscriptiontracker-untagged-${ctx.short}`,
        GITHUB_ENV: join(tmp, 'github-env'),
        GITHUB_OUTPUT: join(tmp, 'github-output'),
        GITHUB_STEP_SUMMARY: join(tmp, 'step-summary'),
        ...env,
        EMIT_ARGS_FILE: argsFile,
      },
    });
    if (r.status !== 0) return fail(`the step's script exited ${r.status}:\n${r.stdout}${r.stderr}`);
    const calls = [1, 2, 3].filter((i) => existsSync(`${argsFile}.${i}`));
    if (calls.length !== 1) return fail(`the step emitted ${calls.length} times; exactly one record per step is what this grades`);
    const args = readFileSync(`${argsFile}.1`, 'utf8').split('\0').slice(0, -1);
    const value = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
    const app = value('--app');
    const surfaces = productSurfaces(REPO, app).map((f) => f.surface);
    if (surfaces.length !== 1) return fail(`--app "${app}" resolves to ${surfaces.length} surfaces in the tree`, { app });
    const surface = surfaces[0];
    const dir = join(tmp, 'release');
    mkdirSync(dir);
    writeFileSync(join(dir, surface === 'app' ? `${app}-v1.0.0-app-release.aab` : `${app}-chromium.zip`), 'fixture bytes');
    const emitter = resolve(cwd, args[0]);
    const emit = spawnSync(process.execPath, [emitter, '--emit-release-json', dir, ...args.slice(3)], { cwd, encoding: 'utf8' });
    if (emit.status !== 0) return fail(`the emitter, given the lane's arguments, exited ${emit.status}:\n${emit.stdout}${emit.stderr}`, { app, surface });
    const seal = spawnSync(process.execPath, [emitter, '--write', dir, '--app', app, '--tag', value('--tag'), '--sha', value('--sha'), '--run-url', value('--run-url')], { cwd, encoding: 'utf8' });
    if (seal.status !== 0) return fail(`--write exited ${seal.status}:\n${seal.stdout}${seal.stderr}`, { app, surface });
    const g = spawnSync(process.execPath, [GUARD, '--dir', dir, '--repo-root', REPO], { encoding: 'utf8' });
    return { where, app, surface, ok: g.status === 0, output: `${g.stdout}${g.stderr}` };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** The whole class under `wfRoot`, and what is wrong with it: a red invocation,
 *  no invocation at all, or a surface the register declares that no graded
 *  invocation reached. An empty list is the only green. */
function gradeEveryEmitter(wfRoot) {
  const ctx = laneContext();
  const graded = emitInvocations(wfRoot).map((inv) => gradeInvocation(wfRoot, inv, ctx));
  const problems = graded.filter((g) => !g.ok).map((g) => `${g.where}\n${g.output}`);
  if (graded.length === 0) problems.push('no workflow runs `release-manifest.mjs --emit-release-json` — nothing was graded');
  const register = JSON.parse(readFileSync(join(REPO, 'tooling', 'channel-register.json'), 'utf8'));
  const declared = [...new Set((register.channels ?? []).map((c) => c.surface).filter(Boolean))];
  for (const s of declared) {
    if (!graded.some((g) => g.ok && g.surface === s)) problems.push(`no graded --emit-release-json reaches the "${s}" surface`);
  }
  return { graded, problems };
}

/** A copy of the workflows with ONE file changed, as a tree the scan can read. */
function mutatedWorkflows(file, from, to) {
  const root = mkdtempSync(join(tmpdir(), 'release-json-wf-'));
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  const text = readFileSync(join(REPO, '.github', 'workflows', file), 'utf8');
  assert.equal(text.split(from).length, 2, `the mutation anchor is not unique in ${file}: ${from}`);
  writeFileSync(join(root, '.github', 'workflows', file), text.replace(from, () => to));
  return root;
}

describe('every --emit-release-json a workflow runs emits a record the schema accepts', () => {
  test('C1 GREEN — each invocation, executed as its lane executes it, grades clean, and every surface is reached', () => {
    const { graded, problems } = gradeEveryEmitter(REPO);
    assert.deepEqual(problems, [], problems.join('\n\n'));
    assert.ok(graded.length >= 2, `only ${graded.length} invocation(s) found`);
  });

  test('C2 RED — build-platforms\' OLD step text (--min-supported "$RELEASE_LINE") is refused, naming the file that owns the floor', () => {
    const root = mutatedWorkflows(
      'build-platforms.yml',
      '            --version "${RELEASE_LINE}.${RUN_NUMBER}" \\\n',
      '            --version "${RELEASE_LINE}.${RUN_NUMBER}" --min-supported "$RELEASE_LINE" \\\n',
    );
    const inv = emitInvocations(root);
    assert.equal(inv.length, 1);
    const g = gradeInvocation(root, inv[0], laneContext());
    assert.equal(g.ok, false, g.output);
    assert.match(g.output, /--min-supported is refused on the app surface/);
    assert.match(g.output, /services\/platform\/src\/app-config-data\.json/);
    rmSync(root, { recursive: true, force: true });
  });

  test('C3 RED — a lane that passes a MAJOR.MINOR floor is caught by the schema line run 35829208001 printed', () => {
    // The extension surface still takes the flag, so this is the one place a
    // typed floor can still be malformed — and the guard names it verbatim.
    const root = mutatedWorkflows('extensions.yml', '--min-supported "$VERSION"', '--min-supported "1.0"');
    const { problems } = gradeEveryEmitter(root);
    const joined = problems.join('\n');
    assert.ok(joined.includes('[limb 1] schema: #/minSupported: "1.0" does not match ^[0-9]+\\.[0-9]+\\.[0-9]+$'), joined);
    rmSync(root, { recursive: true, force: true });
  });

  test('C4 RED — an expression the lane context cannot answer FAILS CLOSED, never a guessed value', () => {
    const root = mutatedWorkflows(
      'extensions.yml',
      '--app "$TOOL" --tag "${TOOL}-v${VERSION}" --sha',
      '--app "${{ steps.tag.outputs.slug }}" --tag "${TOOL}-v${VERSION}" --sha',
    );
    const inv = emitInvocations(root);
    assert.equal(inv.length, 1);
    const g = gradeInvocation(root, inv[0], laneContext());
    assert.equal(g.ok, false);
    assert.match(g.output, /steps\.tag\.outputs\.slug \}\} has no value in laneContext\(\)/);
    rmSync(root, { recursive: true, force: true });
  });

  test('C5 RED — a tree where no workflow emits a record is a finding, not a vacuous pass', () => {
    const root = mkdtempSync(join(tmpdir(), 'release-json-wf-'));
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(root, '.github', 'workflows', 'noop.yml'), 'on: push\njobs:\n  a:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo hi\n');
    const { problems } = gradeEveryEmitter(root);
    assert.ok(problems.some((p) => /nothing was graded/.test(p)), problems.join('\n'));
    assert.ok(problems.some((p) => /reaches the "app" surface/.test(p)), problems.join('\n'));
    assert.ok(problems.some((p) => /reaches the "extension" surface/.test(p)), problems.join('\n'));
    rmSync(root, { recursive: true, force: true });
  });
});
