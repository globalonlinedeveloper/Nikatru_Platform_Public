// ─────────────────────────────────────────────────────────────────────────────
// stamp-channel.test.mjs — the build's channel stamp, written beside the file it
// speaks for (O-RELEASE-RECORD-GUESSES-CHANNEL-FROM-EXTENSION).
//
// GREEN CONTROL FIRST: a stamp written over a real file, read back, and its hash
// compared to the bytes by this test and not only by the script. Every red after
// it breaks one input and requires exit 1 with the reason named. Each case is
// written out by hand (assert-no-loop-cases.mjs).
//
// Run:  node --test tooling/ci/test/stamp-channel.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { makeChannelStamp } from '../stamp-channel.mjs';
import { stampProblems, channelStampName } from '../release-manifest.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(REPO, 'tooling', 'ci', 'stamp-channel.mjs');
const REGISTER = JSON.parse(readFileSync(join(REPO, 'tooling', 'channel-register.json'), 'utf8'));

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'stamp-channel-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });
let seq = 0;

/** A fresh directory holding one file, `name`, with `body`. */
function oneFile(name, body) {
  const dir = join(TMP, `d${seq++}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), body);
  return join(dir, name);
}

/** The script, with GITHUB_RUN_ID taken out of the environment unless the case sets it. */
function stamp(args, env = {}) {
  const base = { ...process.env };
  delete base.GITHUB_RUN_ID;
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...base, ...env } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const sha = (text) => createHash('sha256').update(text).digest('hex');

describe('stamp-channel.mjs', () => {
  test('GREEN CONTROL — a stamp is written beside the file, read back, and its hash is the bytes\'', () => {
    const file = oneFile('app-release.aab', 'aab bytes');
    const r = stamp(['--channel', 'android-play', '--build-step', 'build_aab', '--run-id', '123', file]);
    assert.equal(r.code, 0, r.out);
    const written = JSON.parse(readFileSync(`${file}.channel.json`, 'utf8'));
    assert.deepEqual(written, { channel: 'android-play', file: 'app-release.aab', sha256: sha('aab bytes'), runId: '123' });
    assert.match(r.out, /^stamped {2}app-release\.aab {2}android-play {2}[0-9a-f]{64} {2}run 123$/m);
    // What the stamp says about the file is what the release lane's judgement accepts.
    assert.deepEqual(stampProblems(written, { name: 'app-release.aab', sha256: sha('aab bytes'), format: '.aab', register: REGISTER, surface: 'app' }), []);
  });

  test('the run id defaults to $GITHUB_RUN_ID, which every GitHub runner sets', () => {
    const file = oneFile('x.msix', 'msix bytes');
    const r = stamp(['--channel', 'windows-store', '--build-step', 'build_windows', file], { GITHUB_RUN_ID: '4242' });
    assert.equal(r.code, 0, r.out);
    assert.equal(JSON.parse(readFileSync(`${file}.channel.json`, 'utf8')).runId, '4242');
  });

  test('RED — a channel the register does not declare is refused, and nothing is written', () => {
    const file = oneFile('app-release.aab', 'aab bytes');
    const r = stamp(['--channel', 'android-plya', '--build-step', 'build_aab', '--run-id', '1', file]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /--channel "android-plya" names no row of tooling\/channel-register\.json/);
    assert.equal(existsSync(`${file}.channel.json`), false);
  });

  test('RED — a stamp step that names no build step is refused', () => {
    const file = oneFile('app-release.aab', 'aab bytes');
    const r = stamp(['--channel', 'android-play', '--run-id', '1', file]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /--build-step <step id> is required/);
  });

  test('RED — no --run-id and no $GITHUB_RUN_ID is refused', () => {
    const file = oneFile('app-release.aab', 'aab bytes');
    const r = stamp(['--channel', 'android-play', '--build-step', 'build_aab', file]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no --run-id and no \$GITHUB_RUN_ID/);
  });

  test('COVERAGE LOST — an unmatched glob arrives as its own text: nothing was stamped, exit 2', () => {
    const r = stamp(['--channel', 'android-play', '--build-step', 'build_aab', '--run-id', '1', join(TMP, 'nowhere', '*.aab')]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — .*\*\.aab is not a file/);
  });

  test('COVERAGE LOST — a register it cannot read leaves the channel unchecked, exit 2', () => {
    const file = oneFile('app-release.aab', 'aab bytes');
    const r = stamp(['--channel', 'android-play', '--build-step', 'build_aab', '--run-id', '1', '--repo-root', join(TMP, 'no-tree-here'), file]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — tooling\/channel-register\.json could not be read/);
    assert.equal(existsSync(`${file}.channel.json`), false);
  });

  test('RED — a second stamp for one file is refused, never overwritten', () => {
    const file = oneFile('app-release.aab', 'aab bytes');
    assert.equal(stamp(['--channel', 'android-play', '--build-step', 'build_aab', '--run-id', '1', file]).code, 0);
    const r = stamp(['--channel', 'apps-gov-in', '--build-step', 'build_apk_agi', '--run-id', '2', file]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /already exists/);
    assert.equal(JSON.parse(readFileSync(`${file}.channel.json`, 'utf8')).channel, 'android-play', 'the first stamp stands');
  });

  test('RED — a stamp is never itself stamped', () => {
    const file = oneFile('app-release.aab.channel.json', '{}');
    const r = stamp(['--channel', 'android-play', '--build-step', 'build_aab', '--run-id', '1', file]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /is a stamp; a stamp is never stamped/);
  });

  test('RED — a run id that is not a number is refused', () => {
    const file = oneFile('app-release.aab', 'aab bytes');
    const r = stamp(['--channel', 'android-play', '--build-step', 'build_aab', '--run-id', 'latest', file]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /"latest" is not a workflow run id/);
  });

  test('makeChannelStamp is the four keys, and channelStampName is the file plus .channel.json', () => {
    assert.deepEqual(makeChannelStamp({ channel: 'apps-gov-in', file: '/x/y/a.apk', bytes: Buffer.from('apk'), runId: 9 }), {
      channel: 'apps-gov-in', file: 'a.apk', sha256: sha('apk'), runId: '9',
    });
    assert.equal(channelStampName('dist/a.apk'), 'dist/a.apk.channel.json');
  });
});

// ── stampProblems: the one judgement `--stage` and `--emit-release-json` share ──
describe('stampProblems', () => {
  const good = { channel: 'apps-gov-in', file: 'subscriptiontracker-apps-gov-in-1.0.7.apk', sha256: sha('apk'), runId: '7' };
  const judge = (stampObj, over = {}) => stampProblems(stampObj, {
    name: 'subscriptiontracker-apps-gov-in-1.0.7.apk', sha256: sha('apk'), format: '.apk', register: REGISTER, surface: 'app', ...over,
  });

  test('GREEN — the apps.gov.in .apk stamped apps-gov-in fits', () => {
    assert.deepEqual(judge(good), []);
  });

  test('GREEN — the staged `<tag>-<file>` name still fits the build name its stamp carries', () => {
    assert.deepEqual(judge(good, { name: 'subscriptiontracker-v1.0.0-subscriptiontracker-apps-gov-in-1.0.7.apk' }), []);
  });

  test('RED — an .apk stamped android-play is refused as an apps-gov-in file (the closes\' case)', () => {
    const got = judge({ ...good, channel: 'android-play' });
    assert.equal(got.length, 1, got.join('\n'));
    assert.match(got[0], /it is stamped "android-play", and that row does not accept \.apk \(it accepts \.aab\)/);
  });

  test('RED — a sha256 that belongs to another file', () => {
    const got = judge({ ...good, sha256: sha('another file') });
    assert.equal(got.length, 1, got.join('\n'));
    assert.match(got[0], /the stamp was written for other bytes/);
  });

  test('RED — a stamp naming another file', () => {
    const got = judge({ ...good, file: 'app-release.apk' });
    assert.equal(got.length, 1, got.join('\n'));
    assert.match(got[0], /names the file "app-release\.apk"/);
  });

  test('RED — a channel from the other surface', () => {
    const got = judge({ ...good, channel: 'chrome-webstore' });
    assert.equal(got.length, 1, got.join('\n'));
    assert.match(got[0], /is not on the "app" surface/);
  });

  test('RED — a key nobody declared', () => {
    const got = judge({ ...good, signedBy: 'someone' });
    assert.equal(got.length, 1, got.join('\n'));
    assert.match(got[0], /a stamp is exactly \{channel, file, sha256, runId\}/);
  });

  test('RED — a stamp that is not an object', () => {
    assert.deepEqual(judge(['apps-gov-in']), ['its stamp is not a JSON object.']);
  });
});
