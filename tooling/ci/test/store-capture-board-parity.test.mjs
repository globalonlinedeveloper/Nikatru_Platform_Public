// store-capture-board-parity.test.mjs — the two Play viewports photograph the
// SAME board, or the capture stops.
//
// WHY THIS SUITE EXISTS, IN THE NUMBERS THAT PAID FOR IT. Eight frames were
// merged as Public 9f548515 (#854). The phone set reads `6 active` and `$93.47`
// a month; the tablet set OF THE SAME RUN reads `12 active` and `$186.94`, and
// its Home list names five of the six illustrative rows TWICE under "All
// subscriptions 12". `kIllustrative` holds exactly six rows —
// 15.99 + 10.99 + 2.99 + 20.00 + 39.00 + 4.50 = 93.47 — so 186.94 is that set
// seeded twice and can be nothing else.
//
// Every existing check passed on those eight frames: four per set, right size,
// right aspect, 24-bit, no demo band, enough ink. It was found by a human
// opening the PNGs and counting rows, because no guard in this tree reads TEXT
// out of an image and `CAPTURE.json` recorded nothing about what was on screen.
//
// So the cases below are about the CLASS rather than the instance: a
// re-capture fixes the eight frames, and only a comparison between the two
// viewports' recorded boards fails the NEXT divergence. They are also about the
// two ways such a comparison goes quiet — a missing record read as agreement,
// and a single viewport compared against nothing.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  boardOf,
  boardParityProblems,
  boardProvenance,
  summariseBoard,
} from '../../store/capture-board-parity.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

/** The board the PHONE set of 9f548515 really photographed. 9347 minor units is
 *  $93.47, the sum of `kIllustrative`, in cents — an integer, so no locale and
 *  no rounding stands between this fixture and the app's own arithmetic. */
const phoneRecord = {
  board: {
    activeCount: 6,
    monthlyTotalMinorUnits: { USD: 9347 },
    names: [
      'AI assistant',
      'Cloud storage',
      'Fitness club',
      'Music streaming',
      'News digest',
      'Video streaming',
    ],
    seededThisDrive: 6,
    alreadyPresent: 0,
  },
};

/** The board the TABLET set of 9f548515 really photographed: the same six rows
 *  a second time. Every name appears twice and the total is exactly doubled. */
const tabletRecordDoubled = {
  board: {
    activeCount: 12,
    monthlyTotalMinorUnits: { USD: 18694 },
    names: [...phoneRecord.board.names, ...phoneRecord.board.names].sort(),
    seededThisDrive: 6,
    alreadyPresent: 0,
  },
};

/** What the tablet drive records once the seeding loop only creates the rows the
 *  board does not already hold. */
const tabletRecordFixed = {
  board: { ...phoneRecord.board, seededThisDrive: 0, alreadyPresent: 6 },
};

describe('the two-viewport board comparison', () => {
  // 🟢 GREEN CONTROL FIRST. A check whose red arm has never been seen beside a
  // green one is a check that might be failing on everything.
  test('passes two viewports that photographed the same board', () => {
    const problems = boardParityProblems([
      { type: 'phone', record: phoneRecord },
      { type: 'tablet', record: tabletRecordFixed },
    ]);
    assert.deepEqual(problems, []);
  });

  test('FAILS the exact divergence 9f548515 shipped, naming both numbers', () => {
    const problems = boardParityProblems([
      { type: 'phone', record: phoneRecord },
      { type: 'tablet', record: tabletRecordDoubled },
    ]);
    // Three independent limbs disagree, and each is reported: the count, the
    // money and the names. One message would have been enough to fail; three
    // is what tells the next reader it is a DOUBLING rather than a drift.
    assert.equal(problems.length, 3);
    const joined = problems.join('\n');
    assert.match(joined, /photographed a board of 6 subscription\(s\)/);
    assert.match(joined, /"tablet" viewport photographed 12/);
    assert.match(joined, /USD 9347/);
    assert.match(joined, /USD 18694/);
    assert.match(joined, /seeding loop running a second time/);
  });

  test('FAILS same-count boards that hold different rows', () => {
    const swapped = {
      board: {
        ...phoneRecord.board,
        names: [...phoneRecord.board.names.slice(1), 'Parking permit'],
      },
    };
    const problems = boardParityProblems([
      { type: 'phone', record: phoneRecord },
      { type: 'tablet', record: swapped },
    ]);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /Same count is not the same board/);
  });

  // 🔴 ABSENCE IS NOT AGREEMENT. This is the limb that decides whether the
  // check can go quiet: a viewport whose drive wrote no record must red, not
  // reduce to "both boards were empty and therefore equal".
  test('REFUSES a viewport that recorded no board, rather than reading it as agreement', () => {
    const problems = boardParityProblems([
      { type: 'phone', record: phoneRecord },
      { type: 'tablet', record: {} },
    ]);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /the "tablet" viewport: the drive recorded no board at all/);
  });

  test('REFUSES a single viewport — one board has nothing to be compared against', () => {
    const problems = boardParityProblems([{ type: 'phone', record: phoneRecord }]);
    assert.ok(problems.length >= 1);
    assert.match(problems[0], /at least two viewports and received 1/);
    assert.match(problems[0], /ranges over nothing reports ok/);
  });

  test('REFUSES an empty run outright', () => {
    assert.equal(boardParityProblems([]).length, 1);
    assert.equal(boardParityProblems(null).length, 1);
  });

  // 🔴 A MISSING FIELD IS NOT A ZERO. `activeCount: undefined` against
  // `activeCount: 6` must read "cannot be compared", never "this board is
  // empty" — the second is a claim about the app that nothing measured.
  test('a board with no activeCount is unreadable, not empty', () => {
    const broken = { board: { ...phoneRecord.board, activeCount: undefined } };
    const problems = boardParityProblems([
      { type: 'phone', record: phoneRecord },
      { type: 'tablet', record: broken },
    ]);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /activeCount is undefined, which is not a row count/);
    // And the message must NOT be the count-divergence one: reporting "6 vs 0"
    // would be inventing a measurement.
    assert.doesNotMatch(problems[0], /photographed a board of/);
  });

  test('a monthly total that is not integer minor units is refused', () => {
    const floaty = { board: { ...phoneRecord.board, monthlyTotalMinorUnits: { USD: 93.47 } } };
    const problems = boardParityProblems([
      { type: 'phone', record: phoneRecord },
      { type: 'tablet', record: floaty },
    ]);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /monthlyTotalMinorUnits\.USD is 93\.47, not an integer/);
  });

  // The comparison must be about the BOARDS, not about the order two maps or
  // two lists happened to be written in.
  test('currency order and row order do not make two identical boards disagree', () => {
    const a = {
      board: {
        activeCount: 2,
        monthlyTotalMinorUnits: { USD: 1599, INR: 49900 },
        names: ['Video streaming', 'AI assistant'],
      },
    };
    const b = {
      board: {
        activeCount: 2,
        monthlyTotalMinorUnits: { INR: 49900, USD: 1599 },
        names: ['AI assistant', 'Video streaming'],
      },
    };
    assert.deepEqual(boardParityProblems([{ type: 'phone', record: a }, { type: 'tablet', record: b }]), []);
  });

  test('a mixed-currency board still compares, per currency', () => {
    const a = {
      board: { activeCount: 2, monthlyTotalMinorUnits: { USD: 1599, INR: 49900 }, names: ['a', 'b'] },
    };
    const b = {
      board: { activeCount: 2, monthlyTotalMinorUnits: { USD: 1599, INR: 99800 }, names: ['a', 'b'] },
    };
    const problems = boardParityProblems([{ type: 'phone', record: a }, { type: 'tablet', record: b }]);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /INR 49900, USD 1599/);
    assert.match(problems[0], /INR 99800, USD 1599/);
  });
});

describe('reading one drive record', () => {
  test('boardOf returns null for every shape that carries no board', () => {
    assert.equal(boardOf(null), null);
    assert.equal(boardOf(undefined), null);
    assert.equal(boardOf({}), null);
    assert.equal(boardOf({ board: null }), null);
    assert.equal(boardOf({ verdict: 'frames written: 4/4' }), null);
  });

  test('boardOf returns the board a real reportData carries beside the verdict', () => {
    const record = { verdict: 'frames written: 4/4', timeline: [], ...phoneRecord };
    assert.equal(boardOf(record).activeCount, 6);
  });

  test('summariseBoard names the viewport it could not read', () => {
    const s = summariseBoard(null, { label: 'the "tablet" viewport' });
    assert.equal(s.ok, false);
    assert.match(s.problems[0], /the "tablet" viewport/);
  });
});

describe('what a committed set records about what was on screen', () => {
  test('boardProvenance carries the five fields, and null stays null', () => {
    assert.equal(boardProvenance(null), null);
    assert.deepEqual(boardProvenance(phoneRecord.board), {
      activeCount: 6,
      monthlyTotalMinorUnits: { USD: 9347 },
      names: phoneRecord.board.names,
      seededThisDrive: 6,
      alreadyPresent: 0,
    });
  });

  // ⚠️ A WIRING CHECK, AND LABELLED AS ONE. The cases above prove the
  // comparison DOES the right thing; this one only proves the runner asks it.
  // It is here because a correct comparison nobody calls is the same listing as
  // no comparison at all — and `capture-play-screenshots.mjs` cannot be run
  // here: it needs chromedriver, a browser, a provisioned Supabase user and
  // CI-only secrets. The BEHAVIOURAL half of this claim is the live lane's
  // dispatch, and this suite does not pretend otherwise.
  test('the runner feeds the parity verdict into the array that exits 1', () => {
    const src = readFileSync(join(ROOT, 'tooling', 'store', 'capture-play-screenshots.mjs'), 'utf8');
    assert.match(src, /problems\.push\(\.\.\.boardParityProblems\(/);
    // The same `problems` array the rest of the verification pushes into, and
    // the one whose non-emptiness exits 1 before any CAPTURE.json is written.
    assert.match(src, /if \(problems\.length\) \{[\s\S]*process\.exit\(1\)/);
    // And each drive is told where to leave its record, per viewport.
    assert.match(src, /STORE_BOARD_FILE: boardFileFor\(cap\)/);
  });
});
