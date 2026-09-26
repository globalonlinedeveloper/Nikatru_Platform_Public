// capture-row-edge.test.mjs — a card cut by the frame's bottom edge fails the
// store capture; a gap or a faded edge does not.
//
// ⏱ 2026-09-22 (store-frame-followup). `tooling/store/capture-row-edge.mjs` is
// the no-human-eye half of O-STORE-FRAME-FAB-COVERS-A-PRICE-ROW: it reads the device rows just
// above the fold of each captured frame and refuses ink there. These cases pin
// the three verdicts the capture's startup self-test also demands, the row
// range (one row off in either direction is the silent failure), the skip
// spans, and the mapping from the suite's logical record to PNG rows.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

// A dynamic import of an ABSOLUTE path throws ERR_UNSUPPORTED_ESM_URL_SCHEME on
// Windows; it must be a file:// URL, as capture-fallback-fonts.test.mjs does it.
const SCRIPT = join(ROOT, 'tooling', 'store', 'capture-row-edge.mjs');
const { scanFoldLine, foldsOf, foldFor, deviceGeometry, foldLineProblems, selfTestFoldLineDetector, FOLD_ROWS } =
  await import(new URL(`file:///${SCRIPT.replace(/\\/g, '/')}`).href);

const GROUND = [247, 248, 250];

/** A W x H opaque frame of ground, with `paint(x, y)` overriding pixels. */
function frame(W, H, paint = () => null) {
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = paint(x, y) ?? GROUND;
      const i = (y * W + x) * 4;
      rgba.set([c[0], c[1], c[2], 255], i);
    }
  }
  return { width: W, height: H, rgba };
}

describe('scanFoldLine', () => {
  test('reads exactly the FOLD_ROWS rows above the fold, not the fold row', () => {
    // Ink ON the fold row (the shell) and above the band: neither is read.
    const img = frame(20, 20, (x, y) => (y === 10 || y < 10 - FOLD_ROWS ? [0, 0, 0] : null));
    const r = scanFoldLine(img.rgba, img.width, 10, GROUND);
    assert.deepEqual(r.rows, [10 - FOLD_ROWS, 10]);
    assert.equal(r.examined, 20 * FOLD_ROWS);
    assert.equal(r.edge, false, `read ink outside the band: ${JSON.stringify(r.first)}`);
  });

  test('one inked pixel in the band is an edge, and it is named', () => {
    const img = frame(20, 20, (x, y) => (x === 5 && y === 9 ? [255, 255, 255] : null));
    const r = scanFoldLine(img.rgba, img.width, 10, GROUND);
    assert.equal(r.edge, true);
    assert.equal(r.off, 1);
    assert.deepEqual(r.first, { x: 5, y: 9, rgb: [255, 255, 255] });
  });

  test('a difference within the tolerance is ground (dither)', () => {
    const img = frame(20, 20, (x, y) => (y === 9 ? [249, 246, 252] : null));
    assert.equal(scanFoldLine(img.rgba, img.width, 10, GROUND, 2).edge, false);
    assert.equal(scanFoldLine(img.rgba, img.width, 10, GROUND, 1).edge, true);
  });

  test('columns outside the span and inside a skip are not read', () => {
    const img = frame(20, 20, (x, y) => (y === 9 && (x < 2 || x >= 18 || (x >= 8 && x < 12)) ? [0, 0, 0] : null));
    const r = scanFoldLine(img.rgba, img.width, 10, GROUND, 2, { xFrom: 2, xTo: 18, skip: [[8, 12]] });
    assert.equal(r.edge, false, `read a skipped column: ${JSON.stringify(r.first)}`);
    assert.equal(r.examined, (16 - 4) * FOLD_ROWS);
  });
});

describe('the self-test the capture runs before the browser starts', () => {
  test('straddling card RED, gap GREEN, faded GREEN', () => {
    const t = selfTestFoldLineDetector();
    assert.equal(t.straddle.edge, true, 'a card the fold cuts was not seen');
    assert.equal(t.gap.edge, false, `a gap read as a cut card: ${JSON.stringify(t.gap.first)}`);
    assert.equal(t.faded.edge, false, `a faded edge read as a cut card: ${JSON.stringify(t.faded.first)}`);
    assert.equal(t.ok, true);
  });
});

describe('the suite record, mapped to PNG rows', () => {
  const fold = {
    frame: '01-home',
    dpr: 3,
    viewWidthLogical: 360,
    foldTopLogical: 567.5,
    pageGroundArgb: 0xfff7f8fa,
    contentLeftLogical: 0.2,
    contentRightLogical: 359.9,
    skipLogical: [[280.4, 344.6]],
  };

  test('floors the fold, takes the content inward and the skips outward', () => {
    const g = deviceGeometry(fold);
    assert.equal(g.foldY, 1702);
    assert.equal(g.xFrom, 1);
    assert.equal(g.xTo, 1079);
    assert.deepEqual(g.skip, [[841, 1034]]);
    assert.equal(g.width, 1080);
    assert.deepEqual(g.ground, GROUND);
  });

  test('finds the entry by PNG name, and says null when there is no record', () => {
    const record = { folds: [fold, { ...fold, frame: '04-budget' }] };
    assert.equal(foldFor(foldsOf(record), '04-budget.png').frame, '04-budget');
    assert.equal(foldFor(foldsOf(record), '02-calendar.png'), null);
    assert.equal(foldsOf({ board: {} }), null);
    assert.equal(foldsOf(null), null);
    assert.equal(foldsOf({ folds: [] }), null);
  });

  test('a PNG at another scale is a problem, not a pass', () => {
    const img = frame(720, 1280);
    const { scan, problems } = foldLineProblems(img, { ...fold, foldTopLogical: 400 }, 'phone/01-home.png');
    assert.equal(scan, null);
    assert.match(problems[0], /not at the scale/);
  });

  test('a card through the fold is a problem that names the rows', () => {
    const f = { ...fold, dpr: 1, viewWidthLogical: 40, foldTopLogical: 30, contentLeftLogical: 0, contentRightLogical: 40, skipLogical: [] };
    const img = frame(40, 40, (x, y) => (x >= 4 && x < 36 && y >= 20 ? [255, 255, 255] : null));
    const { problems } = foldLineProblems(img, f, 'phone/01-home.png');
    assert.equal(problems.length, 1);
    assert.match(problems[0], /CARD CUT BY THE FOLD/);
    assert.match(problems[0], /rows 27\.\.29/);
  });

  test('the same card with ground in the band passes', () => {
    const f = { ...fold, dpr: 1, viewWidthLogical: 40, foldTopLogical: 30, contentLeftLogical: 0, contentRightLogical: 40, skipLogical: [] };
    const img = frame(40, 40, (x, y) => (x >= 4 && x < 36 && y >= 20 && (y < 27 || y >= 30) ? [255, 255, 255] : null));
    assert.deepEqual(foldLineProblems(img, f, 'phone/01-home.png').problems, []);
  });
});
