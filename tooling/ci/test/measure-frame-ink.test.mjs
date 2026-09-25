// measure-frame-ink.test.mjs — the glyph filter, the normalisation a store
// device class is judged at, and the reading `measure-frame-ink.mjs` prints.
//
// WHY THIS SUITE EXISTS. Removed ink — a frame's ink minus the ink of the same
// frame with its glyphs voted away by the 9x9 mode filter — is the quantity
// both `assert-listing-assets.mjs` (per store device class) and
// `tooling/e2e/assert-frames-carry-text.mjs` (per e2e run) judge. The filter's
// behaviour is pinned first; then `areaDownscale` and `removedInkRunMedian`,
// which put a frame at its CSS width before it is measured; then the tool.
//
// ⏱ 2026-09-24, row O-STORE-INK-FLOOR-HAND-PASTED: the tool used to print a
// paste-ready `inkFloor.frames` block of `{measured, textlessControl}` rows.
// The register carries no per-frame number any more — the guard computes each
// class's floor from committed calibration frames — so the tool prints a
// READING: per-frame native numbers and, for a declared class, the run median,
// both calibration medians, the floor and the headroom. The cases below are
// about what the committed tool prints, not about agreeing with a number
// somebody pasted.
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
  areaDownscale,
  removedInkRunMedian,
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

  test('a glyph-bearing frame loses most of its ink to the filter', () => {
    const frame = inkFixtureFrame({ width: 360, height: 640, glyphs: true });
    const before = inkFraction(frame);
    const after = inkFraction(textlessFrame(frame));
    assert.ok(before > 0, 'the fixture must carry ink to start with');
    assert.ok(
      after < before * 0.7,
      `the filter left ${after} of ${before}; a filter that leaves most of the glyphs removes too little ` +
        `for a served and a glyphless run to separate`,
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

  // 🔴 MUTATION (d) OF THE 2026-09-21 PLAN: the tie-break `count > bestCount`
  // changed to `>=`. The determinism case above cannot see it — `>=` is just as
  // deterministic, it picks the value that reached the tie LAST instead of
  // FIRST — so the recorded controls would silently change meaning under a
  // one-character edit. This pins the rule with an exact tie: a 9x9 frame whose
  // centre pixel's window is the whole frame, 40 pixels of one value, then 40 of
  // another, then one odd pixel, in row-major scan order. The centre must take
  // the value that reached 40 FIRST, whichever of the two values that is.
  test('an exact tie in the 9x9 window goes to the value that reached it first in scan order', () => {
    const tieFrame = (firstValue, secondValue) => {
      const rgba = Buffer.alloc(9 * 9 * 4);
      for (let i = 0; i < 81; i++) {
        const v = i < 40 ? firstValue : i < 80 ? secondValue : 90;
        rgba[i * 4] = v;
        rgba[i * 4 + 1] = v;
        rgba[i * 4 + 2] = v;
        rgba[i * 4 + 3] = 255;
      }
      return { width: 9, height: 9, rgba };
    };
    const centre = (img) => {
      const at = (4 * 9 + 4) * 4;
      return [...img.rgba.subarray(at, at + 4)];
    };
    // Both orders, so a rule of "the smaller value" or "the larger value"
    // cannot pass by coincidence with one of them.
    assert.deepEqual(centre(textlessFrame(tieFrame(10, 200))), [10, 10, 10, 255]);
    assert.deepEqual(centre(textlessFrame(tieFrame(200, 10))), [200, 200, 200, 255]);
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

// ── the normalisation a store class is judged at ────────────────────────────
// `assert-listing-assets.mjs` compares a class's run median of removed ink with
// a floor computed from that class's calibration frames, both after
// `areaDownscale` to the class's CSS width. These pin the two helpers by hand:
// a helper that averaged the wrong way, accepted a width nobody declared, or
// took the wrong middle of an even run would move every floor with nothing red.
describe('area-averaging a frame to its CSS width, and the run median', () => {
  /** A frame from a flat list of grey levels, row-major, opaque. */
  const greys = (width, height, levels) => {
    const rgba = Buffer.alloc(width * height * 4);
    levels.forEach((v, i) => {
      rgba[i * 4] = v;
      rgba[i * 4 + 1] = v;
      rgba[i * 4 + 2] = v;
      rgba[i * 4 + 3] = 255;
    });
    return { width, height, rgba };
  };

  test('a 2x2 frame averaged to 1x1 is the mean of its four pixels', () => {
    // 0 + 255 + 100 + 1 = 356, / 4 = 89. A nearest-neighbour "downscale" would
    // return one of the four inputs, and none of them is 89.
    const out = areaDownscale(greys(2, 2, [0, 255, 100, 1]), 1);
    assert.equal(out.width, 1);
    assert.equal(out.height, 1);
    assert.deepEqual([...out.rgba], [89, 89, 89, 255]);
  });

  test('a target equal to the width returns the frame pixel for pixel', () => {
    // The DPR-1 case: the e2e calibration frames are 430 wide and judged at 430.
    const frame = inkFixtureFrame({ width: 60, height: 100, glyphs: true });
    const out = areaDownscale(frame, 60);
    assert.equal(out.height, 100);
    assert.ok(Buffer.from(out.rgba).equals(Buffer.from(frame.rgba)), 'a 1:1 area average changed pixels');
  });

  test('a non-integer target width is refused, never rounded', () => {
    const frame = greys(4, 4, new Array(16).fill(10));
    assert.throws(() => areaDownscale(frame, 1.5), /must be a positive integer, got 1\.5/);
  });

  test('a target wider than the frame is refused — this averages down, never up', () => {
    const frame = greys(4, 4, new Array(16).fill(10));
    assert.throws(() => areaDownscale(frame, 8), /cannot be area-averaged UP to 8px/);
  });

  test('the median of an EVEN run is the mean of the middle two, not either one of them', () => {
    const withText = inkFixtureFrame({ width: 120, height: 200, glyphs: true });
    const without = inkFixtureFrame({ width: 120, height: 200, glyphs: false });
    const removed = (img) => {
      const m = measureFrameInk(img);
      return Number((m.measured - m.textlessControl).toFixed(6));
    };
    const a = removed(withText);
    const b = removed(without);
    assert.notEqual(a, b, 'the two frames must differ for this case to tell the middles apart');
    const median = removedInkRunMedian([withText, without], 120);
    assert.equal(median, Number(((a + b) / 2).toFixed(6)));
    assert.notEqual(median, a);
    assert.notEqual(median, b);
  });

  test('an EMPTY run is refused rather than read as a median of 0', () => {
    assert.throws(() => removedInkRunMedian([], 360), /needs at least one frame, and got none/);
  });
});

describe('the reading this tool prints', () => {
  let dir;
  /** A frame PNG from the fixture pair, opaque, the shape a capture writes. */
  const shot = (width, height, glyphs) => {
    const frame = inkFixtureFrame({ width, height, glyphs });
    return encodeRgba({ width: frame.width, height: frame.height, rgba: frame.rgba }, { opaque: true });
  };
  /** A repository root whose register declares ONE class, `android-play/phone`,
   *  captured 60x100 at DPR 2 (120x200 frames), calibrated from `cal/`. The
   *  real register's classes point at calibration sets this suite does not
   *  own, so the class branch is exercised on a root the suite builds. */
  const classRoot = () => {
    const root = join(dir, 'class-root');
    mkdirSync(join(root, 'tooling'), { recursive: true });
    const register = {
      storeMetadataContract: {
        inkRule: { metric: METRIC_ID, minSeparation: 3, classes: { 'android-play/phone': { calibration: 'cal' } } },
        perChannel: {
          'android-play': {
            graphicAssets: {
              screenshots: {
                dir: 'screenshots',
                deviceTypeCoverage: { sets: { phone: { dir: 'screenshots', capture: { logicalWidth: 60, logicalHeight: 100, dpr: 2 } } } },
              },
            },
          },
        },
      },
    };
    writeFileSync(join(root, 'tooling', 'channel-register.json'), JSON.stringify(register));
    const frames = join(root, 'apps', 'demo', 'store', 'android-play', 'screenshots');
    mkdirSync(frames, { recursive: true });
    writeFileSync(join(frames, '01-home.png'), shot(120, 200, true));
    writeFileSync(join(frames, '02-list.png'), shot(120, 200, true));
    return { root, frames };
  };

  test('setup: a directory of frames named the way the register names them', () => {
    dir = mkdtempSync(join(tmpdir(), 'nk-ink-'));
    const set = join(dir, 'screenshots-tablet');
    mkdirSync(set);
    writeFileSync(join(set, '01-home.png'), shot(120, 200, true));
    writeFileSync(join(set, 'CAPTURE.json'), '{}\n');
  });

  test('prints each frame\'s native reading, keyed <set-directory>/<file>', () => {
    const r = run([join(dir, 'screenshots-tablet')]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`^metric ${METRIC_ID}, per-channel delta 24`, 'm'));
    const m = /screenshots-tablet\/01-home\.png 120x200: measured ([\d.]+), textless ([\d.]+), removed ([\d.]+) \(native\)/.exec(r.stdout);
    assert.ok(m, r.stdout);
    assert.ok(Number(m[1]) > 0);
    assert.ok(Number(m[2]) < Number(m[1]));
    assert.equal(Number(m[3]), Number((Number(m[1]) - Number(m[2])).toFixed(6)));
  });

  test('non-PNG files in the set directory are not measured', () => {
    const r = run([join(dir, 'screenshots-tablet')]);
    assert.equal(r.stdout.split('\n').filter((l) => l.endsWith('(native)')).length, 1);
    assert.doesNotMatch(r.stdout, /CAPTURE\.json/);
  });

  // 🔴 THE EMPTY SUBJECT. Headers over no frames would look exactly like a
  // measured run — the shape this repository has paid for more than any other.
  test('REFUSES a directory with no frames, with nothing on stdout', () => {
    const empty = mkdtempSync(join(tmpdir(), 'nk-ink-empty-'));
    const r = run([empty]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /REFUSING/);
    assert.match(r.stderr, /measures nothing/);
    assert.equal(r.stdout.trim(), '');
    rmSync(empty, { recursive: true, force: true });
  });

  test('REFUSES no argument at all, with the usage line', () => {
    const r = run([]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /REFUSING — no directory given/);
  });

  // why: store-screenshots.yml prints this reading from a FAILED capture of
  // every channel. A directory must be named as a class only when the register
  // declares it as one; a guess would print a floor for frames it never judged.
  test('names the class only for a directory the register declares as a classed set', () => {
    const { root, frames } = classRoot();
    const named = run(['--root', root, frames]);
    assert.equal(named.status, 0, named.stderr);
    assert.match(named.stdout, /^screenshots — class android-play\/phone, captured 60x100@2 = 120x200$/m);
    assert.match(named.stdout, /run median of removed ink at 60 CSS px: [\d.]+ \(n 2\)/);
    // No calibration directory in this root yet: said, and no floor invented.
    assert.match(named.stdout, /calibration: cal\/served\/ does not exist — no floor can be computed/);
    assert.doesNotMatch(named.stdout, /headroom/);

    // The red control: a parent that is not a register channel (the mkdtemp
    // name) is read natively and named as no class.
    const unknown = run(['--root', root, join(dir, 'screenshots-tablet')]);
    assert.equal(unknown.status, 0, unknown.stderr);
    assert.match(unknown.stdout, /^screenshots-tablet — no ink class \("nk-ink-[^"]+" is not a register channel/m);
    assert.doesNotMatch(unknown.stdout, /run median/);
  });

  test('prints both calibration medians, the separation, the floor and the headroom', () => {
    const { root, frames } = classRoot();
    for (const mode of ['served', 'glyphless']) {
      mkdirSync(join(root, 'cal', mode), { recursive: true });
      for (const n of ['01', '02', '03', '04']) writeFileSync(join(root, 'cal', mode, `${n}.png`), shot(120, 200, mode === 'served'));
    }
    const r = run(['--root', root, frames]);
    assert.equal(r.status, 0, r.stderr);
    const cal = /served median ([\d.]+), glyphless median ([\d.]+), separation ([\d.]+)x \(needs >= 3\), floor ([\d.]+)/.exec(r.stdout);
    assert.ok(cal, r.stdout);
    const [served, glyphless, , floor] = cal.slice(1).map(Number);
    assert.ok(served > glyphless, `served ${served} must read over glyphless ${glyphless}`);
    assert.equal(floor, Number(Math.sqrt(served * glyphless).toFixed(6)), 'the floor is the geometric mean of the two medians');
    const head = /headroom: ([\d.]+)x/.exec(r.stdout);
    assert.ok(head && Number(head[1]) > 1, `two text-bearing frames must read over the floor:\n${r.stdout}`);
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
