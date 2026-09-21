// measure-frame-ink.test.mjs — BOTH halves of an `inkFloor` row can be re-taken
// from a fresh capture, by a tool that is in the tree.
//
// WHY THIS SUITE EXISTS. `tooling/channel-register.json`'s `inkFloor` block
// records, per named frame, a `measured` ink fraction and a `textlessControl` —
// "the same frame with its glyphs removed by a 9x9 mode filter". The control is
// the whole justification for the floor: `assert-listing-assets.mjs` REFUSES a
// floor at or below it, on the stated grounds that such a floor could not have
// caught the textless set this listing carried from #567 to #854.
//
// The register also states the maintenance rule: "A RECAPTURE THAT MOVES A
// FRAME'S INK BY MORE THAN 30% UPDATES THE ROW IN THE SAME CHANGE". Until
// `frame-ink.mjs` grew `textlessFrame`, nothing in this repository could
// produce the second half of such an update — the eight recorded numbers came
// from a script that was never committed. So a lane that changed what is ON a
// frame (which the store-capture seed fix does, for the tablet set) had a
// `measured` anybody could reproduce and a `textlessControl` nobody could.
//
// 📏 MEASURED AND RECORDED RATHER THAN ASSUMED: re-derived against the eight
// committed frames at 9f548515, `measured` reproduces to the last digit on all
// eight and `textlessControl` does NOT — every reading is 3% to 36% HIGHER than
// the recorded one. The table is in `frame-ink.mjs`'s header, the recorded
// column is deliberately left alone, and the cases below are about what the
// committed tool DOES rather than about agreeing with a number nobody can
// reproduce.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  inkFraction,
  inkFixtureFrame,
  textlessFrame,
  measureFrameInk,
  TEXTLESS_WINDOW,
  METRIC_ID,
} from '../../store/frame-ink.mjs';
import { encodeRgba } from '../../store/png-codec.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const CLI = join(ROOT, 'tooling', 'store', 'measure-frame-ink.mjs');

const run = (args, opts = {}) =>
  spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', ...opts });

describe('removing the glyphs from a frame', () => {
  // 🟢 GREEN CONTROL: the two fixture halves are separated by the metric to
  // begin with, so a red below is about the FILTER and not about the metric.
  test('the fixture pair is separated before the filter is involved', () => {
    const withText = inkFraction(inkFixtureFrame({ width: 360, height: 640, glyphs: true }));
    const without = inkFraction(inkFixtureFrame({ width: 360, height: 640, glyphs: false }));
    assert.ok(withText > without, `${withText} should exceed ${without}`);
  });

  test('a glyph-bearing frame loses most of its ink, below the 0.7 floor', () => {
    const frame = inkFixtureFrame({ width: 360, height: 640, glyphs: true });
    const before = inkFraction(frame);
    const after = inkFraction(textlessFrame(frame));
    assert.ok(before > 0, 'the fixture must carry ink to start with');
    assert.ok(
      after < before * 0.7,
      `the filter left ${after} of ${before}; a control at or above 0.7 of the reading cannot ` +
        `justify any floor the guard will accept`,
    );
  });

  // ⚠️ THE FALSE-POSITIVE DIRECTION, and it is what separates a mode filter
  // from a blur. The cards, the icon blocks and the background edges must
  // SURVIVE: a filter that flattened those would drive every control to zero
  // and every floor would then be justified by an instrument that destroys
  // whatever it is pointed at.
  test('a frame that never had glyphs keeps its cards and icons', () => {
    const flat = inkFixtureFrame({ width: 360, height: 640, glyphs: false });
    const before = inkFraction(flat);
    const after = inkFraction(textlessFrame(flat));
    assert.ok(before > 0, 'the textless fixture still has card and icon edges');
    assert.ok(
      after > before * 0.5,
      `a frame with no glyphs lost ${(100 - (after / before) * 100).toFixed(0)}% of its ink to the ` +
        `filter; it should lose little, because there is nothing there to remove`,
    );
  });

  test('the filter is deterministic — two runs over the same bytes agree', () => {
    const frame = inkFixtureFrame({ width: 120, height: 200, glyphs: true });
    assert.equal(inkFraction(textlessFrame(frame)), inkFraction(textlessFrame(frame)));
  });

  test('the window is the register\'s 9', () => {
    assert.equal(TEXTLESS_WINDOW, 9);
  });

  test('measureFrameInk returns both halves, control below reading', () => {
    const m = measureFrameInk(inkFixtureFrame({ width: 240, height: 400, glyphs: true }));
    assert.equal(typeof m.measured, 'number');
    assert.equal(typeof m.textlessControl, 'number');
    assert.ok(m.textlessControl < m.measured, JSON.stringify(m));
  });
});

describe('the row this tool prints', () => {
  let dir;
  test('setup: a directory of frames named the way the register names them', () => {
    dir = mkdtempSync(join(tmpdir(), 'nk-ink-'));
    const set = join(dir, 'screenshots-tablet');
    mkdirSync(set);
    const frame = inkFixtureFrame({ width: 120, height: 200, glyphs: true });
    writeFileSync(
      join(set, '01-home.png'),
      encodeRgba({ width: frame.width, height: frame.height, rgba: frame.rgba }, { opaque: true }),
    );
    writeFileSync(join(set, 'CAPTURE.json'), '{}\n');
  });

  test('keys each frame as <set-directory>/<file>, the register\'s own shape', () => {
    const r = run([join(dir, 'screenshots-tablet')]);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.metric, METRIC_ID);
    assert.deepEqual(Object.keys(out.frames), ['screenshots-tablet/01-home.png']);
    const row = out.frames['screenshots-tablet/01-home.png'];
    assert.ok(row.measured > 0);
    assert.ok(row.textlessControl < row.measured);
  });

  test('non-PNG files in the set directory are not measured', () => {
    const r = run([join(dir, 'screenshots-tablet')]);
    assert.equal(Object.keys(JSON.parse(r.stdout).frames).length, 1);
  });

  // 🔴 THE EMPTY SUBJECT. `{}` on stdout would look exactly like a measured
  // block and would enforce nothing — the shape this repository has paid for
  // more than any other.
  test('REFUSES a directory with no frames instead of printing an empty block', () => {
    const empty = mkdtempSync(join(tmpdir(), 'nk-ink-empty-'));
    const r = run([empty]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /REFUSING/);
    assert.match(r.stderr, /enforces nothing/);
    assert.equal(r.stdout.trim(), '');
    rmSync(empty, { recursive: true, force: true });
  });

  test('REFUSES no argument at all, with the usage line', () => {
    const r = run([]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /REFUSING — no directory given/);
  });

  test('REFUSES a path that is not a directory', () => {
    const r = run([join(dir, 'screenshots-tablet', '01-home.png')]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /is not a directory/);
  });

  test('teardown', () => {
    rmSync(dir, { recursive: true, force: true });
  });
});
