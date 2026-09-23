// ─────────────────────────────────────────────────────────────────────────────
// apps-gov-in-media.test.mjs — assert-apps-gov-in-media.mjs must derive the
// 155x290 portal screenshots exactly, and must FAIL whenever the committed
// files stop being that derivation: a re-captured Play original, a hand-edited
// output, an unrecorded extra image, an icon that is not the Play icon.
//
// Register row O-APPS-GOV-IN-CHANNEL-APK, item 3. The fixtures are synthetic
// gradients at 180x320 (the Play 9:16 shape, a sixth of the size), written to a
// temp tree shaped like apps/<app>/store/{android-play,apps-gov-in}.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { encodeRgba, decodeRgba } from '../../store/png-codec.mjs';
import { padToAspect, areaAverage, deriveScreenshot, checkApp, writeApp, METHOD } from '../assert-apps-gov-in-media.mjs';

const GUARD = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'assert-apps-gov-in-media.mjs');
const SHOTS = ['01-home.png', '02-calendar.png', '03-insights.png', '04-budget.png'];

function image(width, height, fn) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = fn(x, y);
      rgba.set([r, g, b, a], (y * width + x) * 4);
    }
  }
  return { width, height, rgba };
}
const gradient = (seed) => image(180, 320, (x, y) => [(x + seed * 40) % 256, (y * 3) % 256, (x * y + seed) % 256]);

function makeTree(root, { posture = 'live' } = {}) {
  const play = join(root, 'apps', 'demo', 'store', 'android-play');
  const agi = join(root, 'apps', 'demo', 'store', 'apps-gov-in');
  mkdirSync(join(play, 'screenshots'), { recursive: true });
  mkdirSync(join(agi, 'screenshots'), { recursive: true });
  SHOTS.forEach((n, i) => writeFileSync(join(play, 'screenshots', n), encodeRgba(gradient(i), { opaque: true })));
  writeFileSync(join(play, 'screenshots', 'CAPTURE.json'), JSON.stringify({ posture }));
  writeFileSync(join(play, 'store-icon-512.png'), encodeRgba(image(8, 8, (x, y) => [x * 30, y * 30, 99, 255])));
  writeFileSync(join(agi, 'screenshots', 'README.md'), 'derived\n');
  return { play, agi };
}

describe('the derivation', () => {
  test('padToAspect turns 1080x1920 into 1080x2021: 50 repeated rows above, 51 below', () => {
    const src = image(1080, 1920, (x, y) => [y === 0 ? 7 : y === 1919 ? 9 : 100, 0, 0]);
    const p = padToAspect(src, 155, 290);
    assert.equal(p.height, 2021);
    assert.deepEqual(p.pad, { axis: 'rows', before: 50, after: 51 });
    assert.equal(p.rgba[0], 7, 'the first padded row repeats the top edge');
    assert.equal(p.rgba[(2020 * 1080) * 4], 9, 'the last padded row repeats the bottom edge');
    assert.equal(p.rgba[(50 * 1080) * 4], 7, 'row 50 is the original top row');
  });
  test('padToAspect pads COLUMNS when the source is too narrow, and leaves an exact ratio alone', () => {
    const narrow = padToAspect(image(100, 290, () => [1, 2, 3]), 155, 290);
    assert.equal(narrow.width, 155);
    assert.equal(narrow.pad.axis, 'columns');
    assert.equal(padToAspect(image(310, 580, () => [1, 2, 3]), 155, 290).pad.axis, 'none');
  });
  test('areaAverage weights a pixel by the area it covers: [0, 90, 180] over two outputs is [30, 150]', () => {
    const src = image(3, 1, (x) => [x * 90, x * 90, x * 90]);
    const out = areaAverage(src, 2, 1);
    assert.deepEqual([out.rgba[0], out.rgba[4]], [30, 150]);
  });
  test('areaAverage refuses to enlarge', () => {
    assert.throws(() => areaAverage(image(2, 2, () => [0, 0, 0]), 3, 3), /only shrinks/);
  });
  test('deriveScreenshot writes exactly 155x290, as a 24-bit PNG with no alpha channel', () => {
    const d = deriveScreenshot(encodeRgba(gradient(1), { opaque: true }), { width: 155, height: 290 });
    const back = decodeRgba(d.png);
    assert.deepEqual([back.width, back.height], [155, 290]);
    assert.equal(d.png[25], 2, 'IHDR colour type 2 = truecolour, no alpha');
  });
  test('NEGATIVE: a translucent source is refused, not averaged', () => {
    const buf = encodeRgba(image(180, 320, (x) => [0, 0, 0, x === 5 ? 128 : 255]));
    assert.throws(() => deriveScreenshot(buf, { width: 155, height: 290 }), /translucent/);
  });
});

describe('checkApp — the committed files must still be the derivation', () => {
  let root;
  let t;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agi-media-'));
    t = makeTree(root);
    writeApp(root, 'demo');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('a fresh derivation passes: four screenshots and the icon', () => {
    const r = checkApp(root, 'demo');
    assert.deepEqual(r.problems, []);
    assert.equal(r.checked, 5);
    const cap = JSON.parse(readFileSync(join(t.agi, 'screenshots', 'CAPTURE.json'), 'utf8'));
    assert.equal(cap.derivation.method, METHOD);
    assert.equal(cap.posture, 'live');
    assert.equal(cap.files.length, 4);
  });
  test('NEGATIVE: a re-captured Play original makes the derived file STALE, naming the command', () => {
    writeFileSync(join(t.play, 'screenshots', '02-calendar.png'), encodeRgba(gradient(9), { opaque: true }));
    const r = checkApp(root, 'demo');
    assert.match(r.problems.join('\n'), /02-calendar\.png is STALE.*--write --app demo/);
  });
  test('NEGATIVE: a hand-edited output FAILS', () => {
    writeFileSync(join(t.agi, 'screenshots', '01-home.png'), encodeRgba(image(155, 290, () => [1, 1, 1]), { opaque: true }));
    assert.match(checkApp(root, 'demo').problems.join('\n'), /01-home\.png is not the file CAPTURE\.json recorded/);
  });
  test('NEGATIVE: a record rewritten to bless a tampered file still FAILS on the pixels', () => {
    const bad = encodeRgba(image(155, 290, () => [1, 1, 1]), { opaque: true });
    writeFileSync(join(t.agi, 'screenshots', '01-home.png'), bad);
    const capPath = join(t.agi, 'screenshots', 'CAPTURE.json');
    const cap = JSON.parse(readFileSync(capPath, 'utf8'));
    cap.files[0].sha256 = createHash('sha256').update(bad).digest('hex');
    cap.files[0].bytes = bad.length;
    writeFileSync(capPath, JSON.stringify(cap));
    assert.match(checkApp(root, 'demo').problems.join('\n'), /pixels are not the pad-to-aspect-then-area-average/);
  });
  test('NEGATIVE: an image CAPTURE.json does not name FAILS', () => {
    writeFileSync(join(t.agi, 'screenshots', '05-extra.png'), encodeRgba(image(155, 290, () => [1, 1, 1]), { opaque: true }));
    assert.match(checkApp(root, 'demo').problems.join('\n'), /05-extra\.png.*Every image must be a recorded derivation/);
  });
  test('NEGATIVE: an icon that is not a byte copy of the Play icon FAILS', () => {
    writeFileSync(join(t.agi, 'store-icon-512.png'), encodeRgba(image(8, 8, () => [0, 0, 0, 255])));
    assert.match(checkApp(root, 'demo').problems.join('\n'), /is not a byte copy of/);
  });
  test('NEGATIVE: a missing icon FAILS', () => {
    rmSync(join(t.agi, 'store-icon-512.png'));
    assert.match(checkApp(root, 'demo').problems.join('\n'), /store-icon-512\.png is missing/);
  });
  test('NEGATIVE: images with no CAPTURE.json FAIL — nothing says where they came from', () => {
    rmSync(join(t.agi, 'screenshots', 'CAPTURE.json'));
    assert.match(checkApp(root, 'demo').problems.join('\n'), /no CAPTURE\.json/);
  });
  test('NEGATIVE: a record with another method FAILS', () => {
    const capPath = join(t.agi, 'screenshots', 'CAPTURE.json');
    writeFileSync(capPath, JSON.stringify({ ...JSON.parse(readFileSync(capPath, 'utf8')), derivation: { method: 'copy' } }));
    assert.match(checkApp(root, 'demo').problems.join('\n'), /derivation\.method "copy"/);
  });
});

describe('writeApp refuses what it must not derive from', () => {
  test('NEGATIVE: a Play set whose CAPTURE.json is not "live" is refused', () => {
    const root = mkdtempSync(join(tmpdir(), 'agi-media-'));
    try {
      makeTree(root, { posture: 'demo' });
      assert.throws(() => writeApp(root, 'demo'), /only a LIVE capture/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test('NEGATIVE: fewer than four Play screenshots is refused (the portal takes 4 to 8)', () => {
    const root = mkdtempSync(join(tmpdir(), 'agi-media-'));
    try {
      const t = makeTree(root);
      rmSync(join(t.play, 'screenshots', '04-budget.png'));
      assert.throws(() => writeApp(root, 'demo'), /has 3 phone screenshot\(s\); the portal takes 4 to 8/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the CLI', () => {
  const run = (...args) => spawnSync(process.execPath, [GUARD, ...args], { encoding: 'utf8', timeout: 60_000 });
  test('a root with no apps/ is COVERAGE LOST (exit 2), never a pass', () => {
    const root = mkdtempSync(join(tmpdir(), 'agi-media-'));
    try {
      const r = run(root);
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /COVERAGE LOST/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test('trees that exist but were never derived are COVERAGE LOST: nothing was checked', () => {
    const root = mkdtempSync(join(tmpdir(), 'agi-media-'));
    try {
      const t = makeTree(root);
      rmSync(join(t.agi, 'screenshots'), { recursive: true });
      const r = run(root);
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /not one derived file checked/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test('--write then check exits 0; a stale source then exits 1', () => {
    const root = mkdtempSync(join(tmpdir(), 'agi-media-'));
    try {
      const t = makeTree(root);
      const w = run(root, '--write', '--app', 'demo');
      assert.equal(w.status, 0, w.stderr);
      assert.equal(run(root).status, 0);
      writeFileSync(join(t.play, 'screenshots', '03-insights.png'), encodeRgba(gradient(7), { opaque: true }));
      const r = run(root);
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /03-insights\.png is STALE/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test('--write with no --app is COVERAGE LOST', () => {
    const r = run('--write');
    assert.equal(r.status, 2);
  });
  // 🔴 THE EXIT HANG, PINNED (2026-09-22). Spawned with plain `node <guard>` and
  // no flags, the process that does the work must have started with
  // --single-threaded, so no V8 worker thread runs a background compile or GC
  // that Node's shutdown can deadlock on (nodejs/node#54918). Every check decodes
  // each derived file and its 1080x1920 original and re-derives it pixel by pixel,
  // the same hot loop as the four heavy image guards. Deterministic, unlike the
  // hang: delete the relaunch and this line says ON.
  test('the working guard runs with V8 background tasks OFF, so its exit cannot deadlock', () => {
    const root = mkdtempSync(join(tmpdir(), 'agi-media-'));
    try {
      makeTree(root);
      const w = run(root, '--write', '--app', 'demo');
      assert.equal(w.status, 0, w.stderr);
      const r = run(root);
      assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
      assert.match(r.stdout, /V8 background tasks: OFF \(--single-threaded\)/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
