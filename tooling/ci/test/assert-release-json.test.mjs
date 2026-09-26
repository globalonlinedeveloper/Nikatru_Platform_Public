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
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { servedFloor, productSurfaces, channelStampName } from '../release-manifest.mjs';
import { parseAllWorkflows, stepShell, workflowSteps, emitInvocations, EMIT_RELEASE_JSON_MODE } from '../workflow-scan.mjs';
import { uploadableArtifactName } from '../assert-apps-gov-in-apk.mjs';
import { gradeRelease } from '../assert-release-json.mjs';
import { listDir } from '../tree-walk.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-release-json.mjs');
const EMITTER = join(REPO, 'tooling', 'ci', 'release-manifest.mjs');
const SCHEMA = join(REPO, 'contracts', 'release.schema.json');
const SERVED_CONFIG = join(REPO, 'services', 'platform', 'src', 'app-config-data.json');

const run = (script, args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** Directories outside the release directory (stamps, download trees), removed at the end. */
const scratch = [];
const scratchDir = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });

/** The stamp a build writes beside a file (tooling/ci/stamp-channel.mjs), written
 *  as `<at>.channel.json` for a file whose BUILD name is `file`. */
function writeStamp(at, { channel, file, body, sha = sha256(body), runId = '1' }) {
  writeFileSync(channelStampName(at), `${JSON.stringify({ channel, file, sha256: sha, runId }, null, 2)}\n`);
}

/** The release's .apk: the apps.gov.in build, the only .apk a release carries. */
const AGI_APK = 'subscriptiontracker-v1.0.0-subscriptiontracker-apps-gov-in-1.0.7.apk';

/** One staged release directory, built the way the lane builds it: assets, then
 *  `--emit-release-json`, then `--write` (which is what puts release.json into
 *  SHA256SUMS). Nothing is hand-written — a fixture whose manifest was typed
 *  cannot catch the emitter writing a manifest the lane would not.
 *  ⏱ 2026-09-24 — each asset is `[name, body, channel]`: an installer carries the
 *  stamp `--stage` would have carried out (channel null = no stamp), and the app
 *  surface is given `--stamps` as the lane gives it (O-RELEASE-RECORD-GUESSES-CHANNEL-FROM-EXTENSION). */
function stage({ app = 'subscriptiontracker', tag = 'subscriptiontracker-v1.0.0', version = '1.0.0', assets = null, emitArgs = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'release-json-test-'));
  const files = assets ?? [
    ['subscriptiontracker-v1.0.0-app-release.aab', 'aab bytes', 'android-play'],
    [AGI_APK, 'apk bytes', 'apps-gov-in'],
    ['subscriptiontracker-v1.0.0-linux-x64.tar.gz', 'archive bytes', null],
  ];
  const onApp = existsSync(join(REPO, 'apps', app));
  const stamps = scratchDir('release-json-stamps-');
  for (const [name, body, channel = null] of files) {
    writeFileSync(join(dir, name), body);
    if (channel !== null) writeStamp(join(stamps, name), { channel, file: name.startsWith(`${tag}-`) ? name.slice(tag.length + 1) : name, body });
  }
  const emit = run(EMITTER, [
    '--emit-release-json', dir,
    '--app', app,
    '--tag', tag,
    '--sha', 'a'.repeat(40),
    '--run-url', 'https://github.com/nikatru/platform/actions/runs/1',
    '--notes-url', 'https://github.com/nikatru/platform/releases/tag/x',
    '--released-at', '2026-09-22T10:00:00Z',
    '--version', version,
    // The app surface READS its floor (app-config-data.json); the extension surface
    // states the release line of --version (EXT-3). Both refuse --min-supported.
    // Which one is decided by the tree, as the emitter decides it — never by a
    // list of ids typed here.
    ...(onApp ? ['--stamps', stamps] : []),
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
    // `maximum` or a `$ref` the grader would silently ignore.
    assert.ok(existsSync(SCHEMA));
    const s = stage();
    const g = grade(s.dir);
    assert.equal(g.status, 0, `${g.stdout}${g.stderr}`);
    rmSync(s.dir, { recursive: true, force: true });
  });

  test('M2 channels are STAMPED, never read off the extension — each installer lists the one channel its build compiled in', () => {
    const s = stage();
    assert.equal(s.emit.status, 0, s.emit.stderr);
    const byName = new Map(s.record().artefacts.map((a) => [a.name, a]));
    assert.deepEqual(byName.get('subscriptiontracker-v1.0.0-app-release.aab').channels, ['android-play']);
    // ⚠️ MEASURED, NOT ASSUMED: `.apk` is no longer channel-less. The apps.gov.in
    // row accepts it, so the derivation returns it — and EXTRA_INSTALLABLE's
    // comment in release-manifest.mjs, which still says no channel accepts an
    // .apk, is stale rather than this assertion being wrong.
    // ⏱ CORRECTED 2026-09-24 (O-RELEASE-RECORD-GUESSES-CHANNEL-FROM-EXTENSION). The
    // measurement above was right, and the assertion it justified was the defect:
    // it held that EVERY .apk is an apps.gov.in file because a row accepts the
    // extension, so the Play build's .apk (compiled with RELEASE_CHANNEL=
    // android-play) was offered to apps.gov.in. INVERTED: an .apk lists
    // apps-gov-in only because its build stamped it so, and the same bytes
    // stamped android-play are REFUSED below, not listed.
    assert.deepEqual(byName.get(AGI_APK).channels, ['apps-gov-in']);
    // An archive is no installer: no stamp, and no channel.
    assert.deepEqual(byName.get('subscriptiontracker-v1.0.0-linux-x64.tar.gz').channels, []);
    rmSync(s.dir, { recursive: true, force: true });
    const play = stage({ assets: [[AGI_APK, 'apk bytes', 'android-play']] });
    assert.equal(play.emit.status, 1, `${play.emit.stdout}${play.emit.stderr}`);
    assert.match(play.emit.stderr, /it is stamped "android-play", and that row does not accept \.apk/);
    assert.equal(existsSync(join(play.dir, 'release.json')), false, 'a refused record is never written');
    rmSync(play.dir, { recursive: true, force: true });
  });

  test('M2b COVERAGE LOST — an installer with no stamp is exit 2 at the emit, never a channel read off its extension', () => {
    const s = stage({ assets: [['subscriptiontracker-v1.0.0-app-release.aab', 'aab bytes', null]] });
    assert.equal(s.emit.status, 2, `${s.emit.stdout}${s.emit.stderr}`);
    assert.match(s.emit.stderr, /COVERAGE LOST — subscriptiontracker-v1\.0\.0-app-release\.aab is a \.aab installer and carries no build stamp/);
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
  // ⏱ 2026-09-25: the emitter validates the record against --repo-root's schema
  // before it writes it (O-RELEASE-EMITTER-WRITES-UNCHECKED).
  mkdirSync(join(root, 'contracts'), { recursive: true });
  copyFileSync(SCHEMA, join(root, 'contracts', 'release.schema.json'));
  if (config !== null) {
    mkdirSync(join(root, 'services', 'platform', 'src'), { recursive: true });
    writeFileSync(join(root, 'services', 'platform', 'src', 'app-config-data.json'), `${JSON.stringify(config, null, 2)}\n`);
  }
  return root;
}

/** One app-surface emit against `root`, with one asset and its stamp, and no
 *  --min-supported unless the case passes it. */
function emitApp(root, extra = []) {
  const dir = mkdtempSync(join(tmpdir(), 'release-floor-dir-'));
  writeFileSync(join(dir, 'subscriptiontracker-v1.0.0-app-release.aab'), 'aab bytes');
  const stamps = scratchDir('release-floor-stamps-');
  writeStamp(join(stamps, 'subscriptiontracker-v1.0.0-app-release.aab'), { channel: 'android-play', file: 'app-release.aab', body: 'aab bytes' });
  const r = run(EMITTER, [
    '--emit-release-json', dir, '--app', 'subscriptiontracker', '--tag', 'subscriptiontracker-v1.0.0',
    '--sha', 'a'.repeat(40), '--run-url', 'https://x/1', '--notes-url', 'https://x/2',
    '--released-at', '2026-09-22T10:00:00Z', '--version', '1.0.7', '--stamps', stamps, '--repo-root', root, ...extra,
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

  // ⏱ 2026-09-24 (EXT-3, O-EXTENSION-MINSUPPORTED-FOUR-PART-TAG): F11 was a RED
  // for "no --min-supported on the extension surface is refused". The extension
  // surface now STATES its floor from --version and refuses the flag, so F11 is
  // the green control and F11b/F11c hold the two halves of the closes.
  test('F11 GREEN — the extension surface states the release line of --version as its floor, with no flag', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-floor-dir-'));
    writeFileSync(join(dir, 'fullshot-chromium.zip'), 'chromium bytes');
    const r = run(EMITTER, [
      '--emit-release-json', dir, '--app', 'fullshot', '--tag', 'fullshot-v1.0.0',
      '--sha', 'a'.repeat(40), '--run-url', 'https://x/1', '--notes-url', 'https://x/2',
      '--released-at', '2026-09-22T10:00:00Z', '--version', '1.0.0', '--repo-root', REPO,
    ]);
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.equal(JSON.parse(readFileSync(join(dir, 'release.json'), 'utf8')).minSupported, '1.0.0');
    assert.match(r.stdout, /minSupported {2}1\.0\.0 {2}the release line of --version 1\.0\.0/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('F11b a FOUR-part store tag records a THREE-part floor, and the record grades clean', () => {
    const s = stage({
      app: 'fullshot',
      tag: 'fullshot-v1.10.1.2',
      version: '1.10.1.2',
      assets: [['fullshot-chromium.zip', 'chromium bytes'], ['fullshot-firefox.zip', 'firefox bytes']],
    });
    assert.equal(s.emit.status, 0, `${s.emit.stdout}${s.emit.stderr}`);
    const record = s.record();
    assert.equal(record.minSupported, '1.10.1');
    assert.equal(record.artefacts[0].version, '1.10.1.2');
    const g = grade(s.dir);
    assert.equal(g.status, 0, `${g.stdout}${g.stderr}`);
    rmSync(s.dir, { recursive: true, force: true });
  });

  test('F11c RED — --min-supported on the extension surface is REFUSED, naming where the floor comes from', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-floor-dir-'));
    writeFileSync(join(dir, 'fullshot-chromium.zip'), 'chromium bytes');
    const r = run(EMITTER, [
      '--emit-release-json', dir, '--app', 'fullshot', '--tag', 'fullshot-v1.10.1.2',
      '--sha', 'a'.repeat(40), '--run-url', 'https://x/1', '--notes-url', 'https://x/2',
      '--released-at', '2026-09-22T10:00:00Z', '--version', '1.10.1.2', '--min-supported', '1.10.1.2', '--repo-root', REPO,
    ]);
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /--min-supported is refused on the "extension" surface: --app "fullshot" states its floor as the first three components of --version/);
    assert.equal(existsSync(join(dir, 'release.json')), false);
    rmSync(dir, { recursive: true, force: true });
  });

  // ── O-RELEASE-EMITTER-WRITES-UNCHECKED — the emitter grades BEFORE it writes ──
  // --min-supported is refused on every surface before the record is built (EXT-3), so the
  // schema's refusal is reached through `commit`: --sha passes into the record unchecked.
  test('E1 RED — an extension record the schema refuses (a --sha that is not 40 hex) exits non-zero and leaves NO file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-emit-schema-'));
    writeFileSync(join(dir, 'fullshot-chromium.zip'), 'chromium bytes');
    const r = run(EMITTER, [
      '--emit-release-json', dir, '--app', 'fullshot', '--tag', 'fullshot-v1.0.0',
      '--sha', 'g'.repeat(40), '--run-url', 'https://x/1', '--notes-url', 'https://x/2',
      '--released-at', '2026-09-22T10:00:00Z', '--version', '1.0.0', '--repo-root', REPO,
    ]);
    assert.notEqual(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /release\.json was NOT written: the record fails contracts\/release\.schema\.json/);
    assert.match(r.stderr, /schema: #\/commit: "g{40}" does not match/);
    assert.equal(existsSync(join(dir, 'release.json')), false, 'a record the schema refuses must never be written');
    rmSync(dir, { recursive: true, force: true });
  });

  test('E2 GREEN CONTROL — --min-supported 1.0.0 exits 0, and the record it writes passes gradeRelease', () => {
    const s = stage({ app: 'fullshot', tag: 'fullshot-v1.0.0', assets: [['fullshot-chromium.zip', 'chromium bytes']] });
    assert.equal(s.emit.status, 0, s.emit.stderr);
    assert.equal(s.record().minSupported, '1.0.0');
    const { findings } = gradeRelease({
      dir: s.dir,
      schema: JSON.parse(readFileSync(SCHEMA, 'utf8')),
      register: JSON.parse(readFileSync(join(REPO, 'tooling', 'channel-register.json'), 'utf8')),
    });
    assert.deepEqual(findings, []);
    rmSync(s.dir, { recursive: true, force: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// O-UPDATE-FLOOR-HAS-NO-CHANNEL — THE FLOOR IS KEYED BY CHANNEL, AND THE RECORD
// STATES THE HIGHEST ONE ITS STAGED CHANNELS ARE SERVED.
//
// app-config-data.json's `min_supported_version` is a map by channel id with a
// `default`; `servedFloor` resolves one channel the way the Worker serves
// `?channel=`, and the emitter takes the MAX over the channels the stamps name.
// ─────────────────────────────────────────────────────────────────────────────

/** An app-surface emit against `root` with the two stamped installers a real
 *  release carries: the Play .aab and the apps.gov.in .apk. */
function emitPlayAndAgi(root) {
  const dir = mkdtempSync(join(tmpdir(), 'release-floor-dir-'));
  const stamps = scratchDir('release-floor-stamps-');
  const aab = 'subscriptiontracker-v1.0.0-app-release.aab';
  writeFileSync(join(dir, aab), 'aab bytes');
  writeStamp(join(stamps, aab), { channel: 'android-play', file: 'app-release.aab', body: 'aab bytes' });
  writeFileSync(join(dir, AGI_APK), 'apk bytes');
  writeStamp(join(stamps, AGI_APK), { channel: 'apps-gov-in', file: AGI_APK.slice('subscriptiontracker-v1.0.0-'.length), body: 'apk bytes' });
  const r = run(EMITTER, [
    '--emit-release-json', dir, '--app', 'subscriptiontracker', '--tag', 'subscriptiontracker-v1.0.0',
    '--sha', 'a'.repeat(40), '--run-url', 'https://x/1', '--notes-url', 'https://x/2',
    '--released-at', '2026-09-22T10:00:00Z', '--version', '1.0.7', '--stamps', stamps, '--repo-root', root,
  ]);
  const record = existsSync(join(dir, 'release.json')) ? JSON.parse(readFileSync(join(dir, 'release.json'), 'utf8')) : null;
  rmSync(dir, { recursive: true, force: true });
  return { r, record };
}

describe('the served floor is per channel, and the record states the highest staged', () => {
  test('P1 a channel the map names is served its own floor; any other is served `default`', () => {
    const data = { defaults: { min_supported_version: { default: '1.0.0', web: '9.0.0' } }, apps: {} };
    assert.deepEqual(servedFloor(data, 'x', 'web'), { value: '9.0.0', from: 'defaults.min_supported_version.web' });
    assert.deepEqual(servedFloor(data, 'x', 'android-play'), { value: '1.0.0', from: 'defaults.min_supported_version.default' });
    assert.deepEqual(servedFloor(data, 'x'), { value: '1.0.0', from: 'defaults.min_supported_version.default' });
  });

  test("P2 an app's own map merges KEY-WISE over the defaults' map (the Worker's deep merge)", () => {
    const data = {
      defaults: { min_supported_version: { default: '1.0.0', web: '9.0.0' } },
      apps: { x: { min_supported_version: { 'android-play': '1.2.0' } } },
    };
    assert.deepEqual(servedFloor(data, 'x', 'android-play'), { value: '1.2.0', from: 'apps.x.min_supported_version.android-play' });
    assert.deepEqual(servedFloor(data, 'x', 'web'), { value: '9.0.0', from: 'defaults.min_supported_version.web' });
    assert.deepEqual(servedFloor(data, 'x', 'ios-appstore'), { value: '1.0.0', from: 'defaults.min_supported_version.default' });
  });

  test("P3 an app's own SCALAR replaces the defaults' map for every channel", () => {
    const data = { defaults: { min_supported_version: { default: '1.0.0', web: '9.0.0' } }, apps: { x: { min_supported_version: '1.5.0' } } };
    assert.deepEqual(servedFloor(data, 'x', 'web'), { value: '1.5.0', from: 'apps.x.min_supported_version' });
  });

  test('P4 RED — a map with neither the channel nor `default` is REFUSED, never guessed', () => {
    const f = servedFloor({ defaults: { min_supported_version: { web: '9.0.0' } }, apps: {} }, 'x', 'android-play');
    assert.equal(f.value, undefined);
    assert.match(f.refused, /defaults\.min_supported_version is a map with no "android-play" key and no "default" key/);
  });

  test('P5 RED — a map entry that is not a version is refused, naming the key', () => {
    const f = servedFloor({ defaults: { min_supported_version: { default: '1.0.0', web: '' } }, apps: {} }, 'x', 'web');
    assert.match(f.refused, /defaults\.min_supported_version\.web is "", which is not a version/);
  });

  test('P6 END TO END — web raised to 9.0.0 does not raise a record that stages no web build', () => {
    // The release half of the row's closes condition: the record describes a
    // Play .aab, so its floor is the one android-play is served.
    const root = floorTree({ defaults: { min_supported_version: { default: '1.0.0', web: '9.0.0' } }, apps: {} });
    const { r, record } = emitApp(root);
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.equal(record.minSupported, '1.0.0');
    assert.match(r.stdout, /defaults\.min_supported_version\.default \(channel android-play\)/);
    rmSync(root, { recursive: true, force: true });
  });

  test('P7 END TO END — two staged channels, the record carries the HIGHER floor', () => {
    const root = floorTree({ defaults: { min_supported_version: { default: '1.0.0', 'apps-gov-in': '1.10.0' } }, apps: {} });
    const { r, record } = emitPlayAndAgi(root);
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    // 1.10.0 over 1.0.0 — ordered as numbers, not as strings.
    assert.equal(record.minSupported, '1.10.0');
    assert.match(r.stdout, /the highest of android-play 1\.0\.0, apps-gov-in 1\.10\.0/);
    rmSync(root, { recursive: true, force: true });
  });

  test('P8 RED — a staged channel with no floor refuses the record, naming the channel', () => {
    const root = floorTree({ defaults: { min_supported_version: { web: '1.0.0' } }, apps: {} });
    const { r, record } = emitApp(root);
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /declares no served floor for --app "subscriptiontracker" on channel "android-play"/);
    assert.equal(record, null);
    rmSync(root, { recursive: true, force: true });
  });

  test('P9 RED — two staged floors that differ and cannot be ordered are refused', () => {
    const root = floorTree({ defaults: { min_supported_version: { default: '1.0.0', 'apps-gov-in': 'latest' } }, apps: {} });
    const { r, record } = emitPlayAndAgi(root);
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /floors that cannot be ordered/);
    assert.equal(record, null);
    rmSync(root, { recursive: true, force: true });
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
// tooling/ci/workflow-scan.mjs — its parsed jobs and logical lines, the same
// reduction every workflow guard here reads. For each one, the step that holds
// it is EXECUTED: its `env:` with every `${{ … }}` replaced from laneContext()
// below, and its `run:` script under bash exactly as GitHub starts it, so every
// flag value is computed by the lane's own shell and the emitters it calls
// (`assert-app-versioning.mjs --emit`, `git show`). A `node` shell function
// stands in front of ONE command only — the emit — and records the arguments it
// was given instead of writing into the lane's directory. The real emitter is
// then run with exactly those arguments, the output directory swapped for a
// temporary one holding one fixture asset, `--write` seals it, and
// assert-release-json.mjs grades it.
//
// 🔴 THE FINDER'S PREDICATE IS THE EMITTER'S, AND NOTHING NARROWER. The first
// version of this finder took a segment as an emit only when
// `--emit-release-json` was the token RIGHT AFTER `…release-manifest.mjs`, and
// its shim recorded only when the flag was `$2`. release-manifest.mjs selects
// the mode with `has('emit-release-json')` — the flag at ANY position of its
// argv — so three ordinary ways of writing a second lane ran the emitter and
// were graded by nobody (review of #897, 2026-09-23, measured with probes):
//   · the flags in another order (`--app "$APP" --emit-release-json dist …`);
//   · the script path alone on a line ending `\`, the flag on the next — a
//     `run: |` block is joined with ` ; `, so the path's next token is `\`;
//   · the script path held in a variable (`node "$RM" --emit-release-json …`).
// C1 stayed green over each, because the two real lanes already reach both
// surfaces, and the lane then failed at the tag build — the class this test
// exists to close. So a STEP is in the domain when the mode's name appears
// anywhere in it, the shim records on the same predicate, and a step that
// mentions the mode and does not emit exactly once is RED, never skipped.
//
// 🔴 AND EVERY MENTION IS ACCOUNTED FOR, FLAT. A parse that narrows makes a real
// call invisible and reads clean — a mode passed through a workflow-level
// `env:`, a composite action, a job key the parser does not see. So every
// `.github/` workflow and composite action is ALSO re-read flat, whole-line
// comments dropped and nothing else reduced, and every line that names the
// mode must sit inside a step this test executed. That is the
// assert-no-secret-defines.mjs precedent (parsed set vs flat re-scan), and C9
// is its failing input.
//
// ⚠️ WHAT IT DOES NOT PROVE: the asset set. One fixture asset per invocation is
// what makes a record at all; the lane's real set is the build's, and
// release-durable/assert-release-durable own the step order around it. Nor a
// mode name the step never writes down (`"--emit-$KIND"`): no reading of the
// text can see that, and the emitter's own refusals are what stand behind it.
//
// ⚠️ AN EXPRESSION laneContext() DOES NOT KNOW FAILS CLOSED, and so does a step
// that runs under anything but bash, and a step that emits zero or two times —
// including one that reaches the emitter past the shim (`command node …`),
// which records nothing. A value this file had to guess would be the second
// copy this class exists to remove.
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

/** The emitter's own name for the mode (`EMIT_RELEASE_JSON_MODE`), the step
 *  model (`workflowSteps`) and the finder (`emitInvocations`) come out of
 *  workflow-scan.mjs, which assert-release-durable.mjs reads through too
 *  (O-RELEASE-EMITTER-WRITES-UNCHECKED). The finder takes a step when the mode's
 *  name appears anywhere in it — see THE FINDER'S PREDICATE above. */
const EMIT_MODE = EMIT_RELEASE_JSON_MODE;

/** Every line under `wfRoot/.github` — each workflow and each composite action —
 *  that names the emit mode, as `{ rel, n }`. FLAT: whole-line comments dropped,
 *  nothing else reduced, no parse. See EVERY MENTION IS ACCOUNTED FOR above. */
function flatMentions(wfRoot) {
  const files = [];
  const wfDir = join(wfRoot, '.github', 'workflows');
  if (existsSync(wfDir)) for (const f of listDir(wfDir)) if (/\.ya?ml$/.test(f)) files.push(`.github/workflows/${f}`);
  const actionsDir = join(wfRoot, '.github', 'actions');
  if (existsSync(actionsDir)) {
    for (const d of listDir(actionsDir)) {
      for (const f of ['action.yml', 'action.yaml']) if (existsSync(join(actionsDir, d, f))) files.push(`.github/actions/${d}/${f}`);
    }
  }
  const out = [];
  for (const rel of files) {
    readFileSync(join(wfRoot, rel), 'utf8').split('\n').forEach((t, i) => {
      if (!/^\s*#/.test(t) && t.includes(EMIT_MODE)) out.push({ rel, n: i + 1 });
    });
  }
  return out;
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

/** The step at raw lines `start..end` (1-based, a workflowSteps `first..last`): its `env:`, its
 *  `run:` script as the shell receives it, and its `working-directory:`. Read
 *  from the RAW file, not workflow-scan's comment-blanked lines — a `#` inside a
 *  script is the script's, and the script is what is executed here. A PLAIN
 *  `run:` scalar continued on deeper lines is folded with spaces, as YAML folds
 *  it: reading its first line alone would execute half a command. */
function readStep(raw, { start, end }) {
  const body = raw.slice(start - 1, end);
  const stepIndent = indentOf(body[0]);
  body[0] = body[0].replace(/^(\s*)-\s/, '$1  ');
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
      step.run = unquote([m[2], ...block.filter((l) => l.trim() !== '' && !/^\s*#/.test(l)).map((l) => l.trim())].join(' '));
    } else if (m[1] === 'working-directory') {
      step.workingDirectory = unquote(m[2]);
    }
  }
  return step;
}

/** The shell function the step's script runs behind: a call naming
 *  `…release-manifest.mjs` AND the mode — each ANYWHERE among node's arguments,
 *  node's own options included — is RECORDED, one file per call; every other
 *  `node` runs for real. The next free file number is probed rather than
 *  counted in a variable, so an emit inside a subshell cannot overwrite one
 *  outside it, and the function is exported so a child `bash -c` sees it too. */
const EMIT_SHIM = [
  'node() {',
  '  local a script=0 emit=0 n=1',
  '  for a in "$@"; do',
  '    case "$a" in',
  '      *release-manifest.mjs) script=1 ;;',
  `      --${EMIT_MODE}) emit=1 ;;`,
  '    esac',
  '  done',
  '  if [ "$script" = 1 ] && [ "$emit" = 1 ]; then',
  '    while [ -e "${EMIT_ARGS_FILE}.${n}" ]; do n=$((n + 1)); done',
  '    printf \'%s\\0\' "$@" > "${EMIT_ARGS_FILE}.${n}"; return 0',
  '  fi',
  '  command node "$@"',
  '}',
  'export -f node',
].join('\n');

/** Executes the step holding one invocation and grades what it would emit.
 *  `{ where, app, surface, ok, output }`. */
function gradeInvocation(wfRoot, inv, ctx) {
  const where = `${inv.wf.rel}:${inv.n} (job "${inv.job.name}")`;
  const fail = (output, extra = {}) => ({ where, ok: false, output, app: null, surface: null, ...extra });
  const raw = readFileSync(join(wfRoot, inv.wf.rel), 'utf8').split('\n');
  const step = readStep(raw, { start: inv.step.first, end: inv.step.last });
  if (step.run === null) return fail(`the step names --${EMIT_MODE} and has no \`run:\` this can read`);
  const sh = stepShell(inv.wf, inv.step.first);
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
    const calls = readdirSync(tmp).filter((f) => f.startsWith('emit-args.'));
    if (calls.length !== 1) return fail(`the step names --${EMIT_MODE} and emitted ${calls.length} times through \`node\`; exactly one record per step is what this grades`);
    // `args` is node's argv as the lane passed it: node's own options, the script,
    // then the script's arguments, the mode wherever the lane put it.
    const args = readFileSync(join(tmp, calls[0]), 'utf8').split('\0').slice(0, -1);
    const scriptAt = args.findIndex((a) => a.endsWith('release-manifest.mjs'));
    const at = args.indexOf(`--${EMIT_MODE}`);
    if (at < scriptAt) return fail(`--${EMIT_MODE} was given to node itself, before the script`);
    const value = (name) => { const i = args.indexOf(name, scriptAt + 1); return i === -1 ? null : args[i + 1]; };
    const app = value('--app');
    const surfaces = productSurfaces(REPO, app).map((f) => f.surface);
    if (surfaces.length !== 1) return fail(`--app "${app}" resolves to ${surfaces.length} surfaces in the tree`, { app });
    const surface = surfaces[0];
    const dir = join(tmp, 'release');
    mkdirSync(dir);
    writeFileSync(join(dir, surface === 'app' ? `${app}-v1.0.0-app-release.aab` : `${app}-chromium.zip`), 'fixture bytes');
    const emitter = resolve(cwd, args[scriptAt]);
    // The lane's own arguments, in the lane's own order; only the directory the
    // mode writes into is swapped. A mode given no directory is passed as it
    // came, and the emitter's own refusal is what gets graded.
    const lanes = args[at + 1];
    const emitArgs = args.map((a, i) => (i === at + 1 && lanes !== undefined && !lanes.startsWith('--') ? dir : a));
    // ⏱ 2026-09-24 — `--stamps <dir>` is where `--stage` put each installer's
    // build stamp (O-RELEASE-RECORD-GUESSES-CHANNEL-FROM-EXTENSION). It is swapped
    // the same way, for a directory holding the fixture's stamp: the channel is the
    // register's own row on this surface that takes the fixture's format. A lane
    // that passes no `--stamps` on the app surface is graded as it is, and refused.
    const stampsAt = args.indexOf('--stamps', scriptAt + 1);
    if (stampsAt !== -1 && args[stampsAt + 1] !== undefined && !args[stampsAt + 1].startsWith('--')) {
      const stamps = join(tmp, 'stamps');
      mkdirSync(stamps);
      const register = JSON.parse(readFileSync(join(REPO, 'tooling', 'channel-register.json'), 'utf8'));
      const row = (register.channels ?? []).find((c) => c.surface === surface && (c.artifactFormats ?? []).includes('.aab'));
      writeStamp(join(stamps, `${app}-v1.0.0-app-release.aab`), { channel: row?.id ?? null, file: 'app-release.aab', body: 'fixture bytes' });
      emitArgs[stampsAt + 1] = stamps;
    }
    const emit = spawnSync(process.execPath, emitArgs, { cwd, encoding: 'utf8' });
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
 *  no invocation at all, a mention of the mode outside every step this executed,
 *  or a surface the register declares that no graded invocation reached. An
 *  empty list is the only green. */
function gradeEveryEmitter(wfRoot) {
  const ctx = laneContext();
  const found = emitInvocations(wfRoot);
  const graded = found.map((inv) => gradeInvocation(wfRoot, inv, ctx));
  const problems = graded.filter((g) => !g.ok).map((g) => `${g.where}\n${g.output}`);
  if (graded.length === 0) problems.push('no workflow runs `release-manifest.mjs --emit-release-json` — nothing was graded');
  for (const m of flatMentions(wfRoot)) {
    if (found.some((f) => f.wf.rel === m.rel && f.step.first <= m.n && m.n <= f.step.last)) continue;
    problems.push(`${m.rel}:${m.n} names --${EMIT_MODE} outside every step this test executed (a workflow- or job-level \`env:\`, a composite action, a key the parse does not read). Refusing to guess which step runs it: write the mode into the step that emits.`);
  }
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

/** Every real workflow, unchanged, plus `probe.yml` holding `text`: the two real
 *  lanes still reach both surfaces, so the probe is what C1 alone would never
 *  notice — a SECOND lane, written another way. */
function withProbe(text) {
  const root = mkdtempSync(join(tmpdir(), 'release-json-wf-'));
  const to = join(root, '.github', 'workflows');
  mkdirSync(to, { recursive: true });
  const from = join(REPO, '.github', 'workflows');
  for (const f of listDir(from)) if (/\.ya?ml$/.test(f)) copyFileSync(join(from, f), join(to, f));
  writeFileSync(join(to, 'probe.yml'), text);
  return root;
}

/** The problems that name the probe, joined — the assertion's subject and its
 *  message both. */
const probeProblems = (problems) => problems.filter((p) => p.startsWith('.github/workflows/probe.yml:')).join('\n\n');

/** The extension lane's `env:`, as extensions.yml gives it, for the probes. */
const PROBE_EXT_ENV = [
  '        env:',
  '          RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}',
  '          NOTES_URL: ${{ github.server_url }}/${{ github.repository }}/releases/tag/${{ github.ref_name }}',
  '          TOOL: ${{ steps.tag.outputs.id }}',
  '          VERSION: ${{ steps.tag.outputs.version }}',
].join('\n');

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

  test('C3 RED — an extension lane that types a MAJOR.MINOR floor is refused at the emit, naming where the floor comes from', () => {
    // Re-anchored 2026-09-24 (EXT-3): the extension lane no longer passes the flag,
    // so the mutation ADDS one to the emit step's --version line.
    const root = mutatedWorkflows('extensions.yml', '            --version "$VERSION"\n', '            --version "$VERSION" --min-supported "1.0"\n');
    const { problems } = gradeEveryEmitter(root);
    const joined = problems.join('\n');
    assert.match(joined, /--min-supported is refused on the "extension" surface/, joined);
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

  // C6–C10: a SECOND lane beside the two real ones, written in a way the first
  // finder could not see (review of #897). Each is wrong on purpose, so the only
  // way it reads clean is by not being found — and each must be found, run and
  // named. C11: node's own options ahead of the script, on the shim's side.

  test('C6 RED — a lane that gives the flags in another order is found, and its old floor is refused', () => {
    const root = withProbe([
      'on: workflow_dispatch',
      'jobs:',
      '  probe:',
      '    runs-on: ubuntu-24.04',
      '    steps:',
      '      - name: A second app lane, the mode after --app',
      '        env:',
      '          APP: ${{ matrix.app }}',
      '          RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}',
      '          RUN_NUMBER: ${{ github.run_number }}',
      '        run: |',
      '          set -euo pipefail',
      '          RELEASE_LINE="$(node tooling/ci/assert-app-versioning.mjs --emit "apps/${APP}" | sed -n \'s/^release_line=//p\')"',
      '          node tooling/ci/release-manifest.mjs --app "$APP" --emit-release-json dist \\',
      '            --tag "$RELEASE_TAG" --sha "$GITHUB_SHA" --run-url "$RUN_URL" --notes-url "$RUN_URL" \\',
      '            --released-at 2026-09-22T10:00:00Z \\',
      '            --version "${RELEASE_LINE}.${RUN_NUMBER}" --min-supported "$RELEASE_LINE"',
      '',
    ].join('\n'));
    const probe = probeProblems(gradeEveryEmitter(root).problems);
    assert.match(probe, /--min-supported is refused on the app surface/, probe || 'the probe lane was never found');
    rmSync(root, { recursive: true, force: true });
  });

  test('C7 RED — a lane whose script path sits alone on a `\\`-continued line is found and graded', () => {
    const root = withProbe([
      'on: workflow_dispatch',
      'jobs:',
      '  probe:',
      '    runs-on: ubuntu-24.04',
      '    steps:',
      '      - name: A second extension lane, the path on its own line',
      '        working-directory: .',
      PROBE_EXT_ENV,
      '        run: |',
      '          set -euo pipefail',
      '          node tooling/ci/release-manifest.mjs \\',
      '            --emit-release-json extensions/dist \\',
      '            --app "$TOOL" --tag "${TOOL}-v${VERSION}" --sha "$GITHUB_SHA" \\',
      '            --run-url "$RUN_URL" --notes-url "$NOTES_URL" --released-at 2026-09-22T10:00:00Z \\',
      '            --version "$VERSION" --min-supported "1.0"',
      '',
    ].join('\n'));
    const probe = probeProblems(gradeEveryEmitter(root).problems);
    assert.match(probe, /--min-supported is refused on the "extension" surface/, probe || 'the probe lane was never found');
    rmSync(root, { recursive: true, force: true });
  });

  test('C8 RED — a lane that holds the script path in a variable is found and graded', () => {
    const root = withProbe([
      'on: workflow_dispatch',
      'jobs:',
      '  probe:',
      '    runs-on: ubuntu-24.04',
      '    steps:',
      '      - name: A second extension lane, the path in a variable',
      '        working-directory: .',
      PROBE_EXT_ENV,
      '        run: |',
      '          set -euo pipefail',
      '          RM=tooling/ci/release-manifest.mjs',
      '          node "$RM" --emit-release-json extensions/dist \\',
      '            --app "$TOOL" --tag "${TOOL}-v${VERSION}" --sha "$GITHUB_SHA" \\',
      '            --run-url "$RUN_URL" --notes-url "$NOTES_URL" --released-at 2026-09-22T10:00:00Z \\',
      '            --version "$VERSION" --min-supported "1.0"',
      '',
    ].join('\n'));
    const probe = probeProblems(gradeEveryEmitter(root).problems);
    assert.match(probe, /--min-supported is refused on the "extension" surface/, probe || 'the probe lane was never found');
    rmSync(root, { recursive: true, force: true });
  });

  test('C9 RED — the mode passed through a workflow-level `env:` is a finding at its own line, not an unread lane', () => {
    const root = withProbe([
      'on: workflow_dispatch',
      'env:',
      '  EMIT: --emit-release-json',
      'jobs:',
      '  probe:',
      '    runs-on: ubuntu-24.04',
      '    steps:',
      '      - name: A second extension lane, the mode from the workflow env',
      '        run: node tooling/ci/release-manifest.mjs "$EMIT" extensions/dist --app fullshot',
      '',
    ].join('\n'));
    const probe = probeProblems(gradeEveryEmitter(root).problems);
    assert.match(probe, /^\.github\/workflows\/probe\.yml:3 names --emit-release-json outside every step this test executed/, probe || 'the flat re-read never saw the mention');
    rmSync(root, { recursive: true, force: true });
  });

  test('C10 RED — a lane written as a plain `run:` scalar folded over lines is found and executed WHOLE', () => {
    const root = withProbe([
      'on: workflow_dispatch',
      'jobs:',
      '  probe:',
      '    runs-on: ubuntu-24.04',
      '    steps:',
      '      - name: A second extension lane, a plain scalar',
      '        working-directory: .',
      PROBE_EXT_ENV,
      '        run: node tooling/ci/release-manifest.mjs',
      '          --emit-release-json extensions/dist --app "$TOOL" --tag "${TOOL}-v${VERSION}"',
      '          --sha "$GITHUB_SHA" --run-url "$RUN_URL" --notes-url "$NOTES_URL"',
      '          --released-at 2026-09-22T10:00:00Z --version "$VERSION" --min-supported "1.0"',
      '',
    ].join('\n'));
    const probe = probeProblems(gradeEveryEmitter(root).problems);
    assert.match(probe, /--min-supported is refused on the "extension" surface/, probe || 'the probe lane was never found');
    rmSync(root, { recursive: true, force: true });
  });

  test('C11 GREEN — node\'s own options ahead of the script are recorded by the shim, never run for real', () => {
    const root = mutatedWorkflows(
      'extensions.yml',
      'node tooling/ci/release-manifest.mjs --emit-release-json extensions/dist',
      'node --no-warnings tooling/ci/release-manifest.mjs --emit-release-json extensions/dist',
    );
    const inv = emitInvocations(root);
    assert.equal(inv.length, 1);
    const g = gradeInvocation(root, inv[0], laneContext());
    assert.equal(g.ok, true, g.output);
    assert.equal(g.surface, 'extension');
    rmSync(root, { recursive: true, force: true });
  });

  test('C13 RED — the extension lane with `--min-supported "$VERSION"` re-added is refused on a four-part store tag', () => {
    // The closes of O-EXTENSION-MINSUPPORTED-FOUR-PART-TAG, as the lane runs it.
    const root = mutatedWorkflows('extensions.yml', '            --version "$VERSION"\n', '            --version "$VERSION" --min-supported "$VERSION"\n');
    const inv = emitInvocations(root);
    assert.equal(inv.length, 1);
    const ctx = laneContext();
    const fourPart = { ...ctx, expressions: { ...ctx.expressions, 'github.ref_name': 'fullshot-v1.10.1.2', 'steps.tag.outputs.version': '1.10.1.2' } };
    const g = gradeInvocation(root, inv[0], fourPart);
    assert.equal(g.ok, false, g.output);
    assert.match(g.output, /--min-supported is refused on the "extension" surface/);
    rmSync(root, { recursive: true, force: true });
  });

  test('C14 GREEN — the extension lane as written grades clean on a four-part store tag', () => {
    const inv = emitInvocations(REPO).filter((i) => i.wf.rel === '.github/workflows/extensions.yml');
    assert.equal(inv.length, 1);
    const ctx = laneContext();
    const fourPart = { ...ctx, expressions: { ...ctx.expressions, 'github.ref_name': 'fullshot-v1.10.1.2', 'steps.tag.outputs.version': '1.10.1.2' } };
    const g = gradeInvocation(REPO, inv[0], fourPart);
    assert.equal(g.ok, true, g.output);
    assert.equal(g.surface, 'extension');
  });

  test('C12 RED — the app lane with its `--stamps` dropped is refused, not described from the extensions', () => {
    const root = mutatedWorkflows('build-platforms.yml', '            --build "$RUN_NUMBER" \\\n            --stamps stamps\n', '            --build "$RUN_NUMBER"\n');
    const inv = emitInvocations(root);
    assert.equal(inv.length, 1);
    const g = gradeInvocation(root, inv[0], laneContext());
    assert.equal(g.ok, false, g.output);
    assert.match(g.output, /--emit-release-json needs --stamps <dir> on the "app" surface/);
    rmSync(root, { recursive: true, force: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// `--stage` READS EACH INSTALLER'S BUILD STAMP (O-RELEASE-RECORD-GUESSES-CHANNEL-FROM-EXTENSION).
//
// The release job downloads `<app>-*` into `downloads/`, and `--stage` lifts
// every installer out of it. Each build job now writes `<file>.channel.json`
// beside every file it ships (tooling/ci/stamp-channel.mjs) and uploads the two
// together. These cases build that download tree and run the real `--stage` on
// it. Every one runs on the UNTAGGED ref, where the native-auth refusal
// (O-BOXA-CAPTCHA-REFUSES-NATIVE-SIGN-IN) only warns, so an exit here is the
// stamp's and nothing else's. S1 is the green control the reds are read against.
// ─────────────────────────────────────────────────────────────────────────────

const UNTAGGED_TAG = 'subscriptiontracker-untagged-abc1234';

/** A download tree: `<root>/<artifact>/<file>` with `body`, and, unless `stamp`
 *  is null, the stamp its build wrote beside it (`stamp` overrides its fields). */
function downloadTree(entries) {
  const root = scratchDir('release-json-downloads-');
  for (const { artifact, file, body, stamp = {} } of entries) {
    mkdirSync(join(root, artifact), { recursive: true });
    writeFileSync(join(root, artifact, file), body);
    if (stamp !== null) writeStamp(join(root, artifact, file), { channel: 'android-play', file, body, ...stamp });
  }
  return root;
}

/** The release job's own `--stage` line, over `from`, into fresh `dist` and `stamps` directories. */
function stageDownloads(from) {
  const at = scratchDir('release-json-stage-');
  const out = join(at, 'dist');
  const stamps = join(at, 'stamps');
  const r = run(EMITTER, ['--stage', from, '--out', out, '--stamps', stamps, '--app', 'subscriptiontracker', '--tag', UNTAGGED_TAG, '--ref-type', 'branch', '--repo-root', REPO]);
  return { r, out, stamps };
}

const listed = (dir) => (existsSync(dir) ? readdirSync(dir).sort() : []);

// ⏱ 2026-09-24 — NO CASE BELOW STAGES THE PLAY .aab ANY MORE. It is store-only
// (O-WINDOWS-RELEASE-SHIPS-LOOSE-RUNNER): android-play is a submittable store, so
// build-platforms.yml uploads it as `store-<app>-android-aab-<posture>`, outside
// the `<app>-*` download, and `--stage` refuses one that arrives. S1, S3, S4 and S5
// stand on the apps.gov.in .apk, the one real-register installer a Release carries;
// S6 is the tree a pin-null run downloads now, which holds no installer at all.
describe('--stage reads each installer\'s channel from its build stamp', () => {
  const AGI = 'subscriptiontracker-apps-gov-in-1.0.7.apk';

  test('S1 GREEN CONTROL — stamped installers are staged, and each stamp follows its file under the staged name', () => {
    const from = downloadTree([
      { artifact: 'subscriptiontracker-apps-gov-in', file: AGI, body: 'apk bytes', stamp: { channel: 'apps-gov-in' } },
    ]);
    const { r, out, stamps } = stageDownloads(from);
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.deepEqual(listed(out), [`${UNTAGGED_TAG}-${AGI}`]);
    assert.deepEqual(listed(stamps), [`${UNTAGGED_TAG}-${AGI}.channel.json`]);
    assert.equal(JSON.parse(readFileSync(join(stamps, `${UNTAGGED_TAG}-${AGI}.channel.json`), 'utf8')).channel, 'apps-gov-in');
    assert.deepEqual(listed(join(from, 'subscriptiontracker-apps-gov-in')), [], 'neither the file nor its stamp is left to be archived');
  });

  test('S2 RED — an apk stamped android-play is refused as an apps-gov-in file (the closes\' red control)', () => {
    // The apps.gov.in file's NAME, and the Play build's stamp: the bytes were
    // compiled with RELEASE_CHANNEL=android-play, and android-play takes no .apk.
    // Before the stamp existed this staged, and the record listed apps-gov-in.
    const from = downloadTree([
      { artifact: 'subscriptiontracker-apps-gov-in', file: AGI, body: 'play apk bytes', stamp: { channel: 'android-play' } },
    ]);
    const { r, out } = stageDownloads(from);
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, new RegExp(`✗ ${AGI.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} — it is stamped "android-play", and that row does not accept \\.apk \\(it accepts \\.aab\\)`));
    assert.match(r.stderr, /--stage refuses 1 stamp finding\(s\)/);
    assert.deepEqual(listed(out), [], 'a refused stage moves nothing');
    assert.deepEqual(listed(join(from, 'subscriptiontracker-apps-gov-in')), [AGI, `${AGI}.channel.json`]);
  });

  test('S3 COVERAGE LOST — a shippable file whose stamp is missing is exit 2, never a default channel', () => {
    const from = downloadTree([
      { artifact: 'subscriptiontracker-apps-gov-in', file: AGI, body: 'apk bytes', stamp: null },
    ]);
    const { r, out } = stageDownloads(from);
    assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, new RegExp(`COVERAGE LOST — 1 installer\\(s\\) carry no build stamp: ${AGI.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`));
    assert.deepEqual(listed(out), []);
  });

  test('S4 RED — a stamp whose sha256 belongs to another file is refused', () => {
    const from = downloadTree([
      { artifact: 'subscriptiontracker-apps-gov-in', file: AGI, body: 'apk bytes', stamp: { channel: 'apps-gov-in', sha: sha256('the bytes of another file') } },
    ]);
    const { r, out } = stageDownloads(from);
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, new RegExp(`✗ ${AGI.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} — its stamp records sha256 "[0-9a-f]{64}", and the bytes hash to [0-9a-f]{64}: the stamp was written for other bytes\\.`));
    assert.deepEqual(listed(out), []);
  });

  // ⏱ 2026-09-24 — THE UPLOADABLE apps.gov.in .apk IS THE RELEASE'S .apk
  // (O-APPS-GOV-IN-CHANNEL-APK). The release job's second download takes the
  // artifact named by assert-apps-gov-in-apk.mjs `uploadableArtifactName` into
  // `downloads/<that name>/`, and the step after it says, in one line, whether it
  // came. Until the owner's pin is set no run uploads that name: one line naming
  // the null pin, no .apk staged, exit 0. S5 is the green control for S6 and S7.
  const AGI_ARTIFACT = uploadableArtifactName('subscriptiontracker');

  test('S5 GREEN CONTROL — the UPLOADABLE download is staged with its apps-gov-in stamp, and the record names it apps-gov-in', () => {
    const from = downloadTree([
      { artifact: AGI_ARTIFACT, file: AGI, body: 'apk bytes', stamp: { channel: 'apps-gov-in' } },
    ]);
    const step = runAgiStep(REPO, join(from, AGI_ARTIFACT));
    assert.equal(step.status, 0, `${step.stdout}${step.stderr}`);
    assert.match(step.stdout, /^uploadable apps\.gov\.in apk downloaded into \S+apps-gov-in-subscriptiontracker-apk; --stage takes it with its stamp\n$/);
    const { r, out, stamps } = stageDownloads(from);
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.deepEqual(listed(out), [`${UNTAGGED_TAG}-${AGI}`]);
    assert.deepEqual(listed(join(from, AGI_ARTIFACT)), [], 'the .apk and its stamp left the download tree');
    const emit = run(EMITTER, [
      '--emit-release-json', out,
      '--app', 'subscriptiontracker',
      '--tag', UNTAGGED_TAG,
      '--sha', 'a'.repeat(40),
      '--run-url', 'https://github.com/nikatru/platform/actions/runs/1',
      '--notes-url', 'https://github.com/nikatru/platform/releases/tag/x',
      '--released-at', '2026-09-22T10:00:00Z',
      '--version', '1.0.7',
      '--build', '7',
      '--stamps', stamps,
      '--repo-root', REPO,
    ]);
    assert.equal(emit.status, 0, `${emit.stdout}${emit.stderr}`);
    const byName = new Map(JSON.parse(readFileSync(join(out, 'release.json'), 'utf8')).artefacts.map((a) => [a.name, a]));
    assert.deepEqual(byName.get(`${UNTAGGED_TAG}-${AGI}`).channels, ['apps-gov-in']);
  });

  test('S6 the pin null — no UPLOADABLE download: one line naming the null pin, exit 0, and no .apk staged', () => {
    const root = registerTree(null);
    // ⏱ 2026-09-24 — the Linux bundle is all a pin-null run's `<app>-*` download
    // holds now (O-WINDOWS-RELEASE-SHIPS-LOOSE-RUNNER): no installer, and `--stage`
    // says none is owed, exit 0, rather than COVERAGE LOST.
    const from = downloadTree([
      { artifact: 'subscriptiontracker-linux-web-android-release-signed', file: 'subscriptiontracker', body: 'elf bytes', stamp: null },
    ]);
    const step = runAgiStep(root, join(from, AGI_ARTIFACT));
    assert.equal(step.status, 0, `${step.stdout}${step.stderr}`);
    assert.equal(step.stdout, 'no uploadable apps.gov.in apk: signingCertificate.sha256 is null\n');
    const { r, out } = stageDownloads(from);
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /nothing staged: no installer under \S+, and none is owed\./);
    assert.deepEqual(listed(out), []);
  });

  test('S7 RED — a pin set and no UPLOADABLE download is exit 1, never the null-pin line', () => {
    const root = registerTree(Array(32).fill('AB').join(':'));
    const step = runAgiStep(root, join(scratchDir('release-json-downloads-'), AGI_ARTIFACT));
    assert.equal(step.status, 1, `${step.stdout}${step.stderr}`);
    assert.match(step.stdout, /^::error title=apps\.gov\.in apk::signingCertificate\.sha256 is AB:AB:\S+ and this run uploaded no apps-gov-in-subscriptiontracker-apk artifact$/m);
    assert.doesNotMatch(step.stdout, /no uploadable apps\.gov\.in apk/);
  });
});

/** A repo root holding only the register, with its apps.gov.in pin set to `pin`.
 *  The step reads nothing else, and the real pin is the owner's to set. */
function registerTree(pin) {
  const root = scratchDir('release-json-register-');
  const register = JSON.parse(readFileSync(join(REPO, 'tooling', 'channel-register.json'), 'utf8'));
  register.channels.find((c) => c.id === 'apps-gov-in').signing.signingCertificate.sha256 = pin;
  mkdirSync(join(root, 'tooling'));
  writeFileSync(join(root, 'tooling', 'channel-register.json'), `${JSON.stringify(register, null, 2)}\n`);
  return root;
}

/** The release job's step that answers for the apps.gov.in download (the one
 *  whose `env:` names AGI_DIR), its `run:` executed under bash as GitHub starts
 *  it, from `cwd` (a repo root: the step reads the register there), AGI_DIR = `dir`
 *  with `/` separators, as the runner's relative path has them. */
function runAgiStep(cwd, dir) {
  const wf = parseAllWorkflows(REPO).find((w) => w.rel === '.github/workflows/build-platforms.yml');
  const step = workflowSteps(wf.jobs.get('release')).find((s) => s.env.has('AGI_DIR'));
  assert.ok(step, 'build-platforms.yml job "release" holds no step whose env names AGI_DIR');
  const { run: script } = readStep(readFileSync(join(REPO, wf.rel), 'utf8').split('\n'), { start: step.first, end: step.last });
  return spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], { cwd, encoding: 'utf8', env: { ...process.env, AGI_DIR: dir.replace(/\\/g, '/') } });
}

// ─────────────────────────────────────────────────────────────────────────────
// O-NON-TAG-RELEASE-RECORD-DISCARDED — a run that is not a tag push keeps its
// record. The publish is tag-gated, so without an upload the cron's release.json
// and SHA256SUMS left with the runner. Read through workflow-scan only.
// ─────────────────────────────────────────────────────────────────────────────
/** The `with:` value `key` of one step, from the parse's comment-blanked lines. */
function withValue(job, step, key) {
  const lines = job.lines.filter((l) => l.n >= step.first && l.n <= step.last);
  const at = lines.findIndex((l) => /^\s+with:\s*$/.test(l.text));
  if (at === -1) return null;
  const withIndent = indentOf(lines[at].text);
  for (const l of lines.slice(at + 1)) {
    if (l.text.trim() === '') continue;
    if (indentOf(l.text) <= withIndent) break;
    const m = l.text.match(new RegExp(`^\\s+${key}:\\s*(.*?)\\s*$`));
    if (m) return unquote(m[1]);
  }
  return null;
}
/** A download-artifact `pattern:` as a RegExp over an artifact name (`*` = any run of non-`/`). */
const patternRe = (p) => new RegExp(`^${p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);

describe('O-NON-TAG-RELEASE-RECORD-DISCARDED — the release job keeps its record on a non-tag run', () => {
  test('NT1 the step after the grade uploads the record, never on a tag, under a name no download pattern takes', () => {
    const wf = parseAllWorkflows(REPO).find((w) => w.rel === '.github/workflows/build-platforms.yml');
    const job = wf.jobs.get('release');
    const steps = workflowSteps(job);
    const gradeAt = steps.findIndex((s) => s.run?.text.includes('assert-release-json.mjs --dir dist'));
    assert.notEqual(gradeAt, -1, 'build-platforms.yml job "release" holds no grade step');
    const keep = steps[gradeAt + 1];
    assert.equal(keep?.name, 'Keep the release record (non-tag runs)', 'the step right after the grade is not the record upload');
    assert.match(keep.cond ?? '', /github\.ref_type != 'tag'/);
    assert.match(keep.cond, /!cancelled\(\)/);
    const at = (s) => s.replace(/\$\{\{\s*matrix\.app\s*\}\}/g, 'subscriptiontracker');
    const name = withValue(job, keep, 'name');
    assert.equal(at(name ?? ''), 'release-record-subscriptiontracker');
    const patterns = steps.slice(0, gradeAt).map((s) => withValue(job, s, 'pattern')).filter(Boolean);
    assert.ok(patterns.length >= 1, 'the release job downloads by no `pattern:` — this case read nothing');
    for (const p of patterns) assert.doesNotMatch(at(name), patternRe(at(p)), `the download pattern ${p} would take ${name} back into downloads/`);
  });
});
