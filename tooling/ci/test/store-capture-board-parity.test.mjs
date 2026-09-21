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
  boardFileFor,
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

  // ⚠️ THE MESSAGE NAMES A CAUSE ONLY WHEN THE NUMBERS ARE THAT CAUSE. Until
  // 2026-09-22 it said "N === M * 2 is that, exactly" for ANY mismatch, so a
  // 6-against-7 board would have sent the reader to the seeding loop — the one
  // place already fixed — with an equation printed beside it that was false.
  test('names the seeding loop for an exact doubling in either order, and for nothing else', () => {
    const seven = {
      board: {
        ...phoneRecord.board,
        activeCount: 7,
        names: [...phoneRecord.board.names, 'Parking permit'].sort(),
      },
    };
    const drift = boardParityProblems([
      { type: 'phone', record: phoneRecord },
      { type: 'tablet', record: seven },
    ]).join('\n');
    assert.match(drift, /"tablet" viewport photographed 7/);
    assert.match(drift, /7 is not 6 doubled, so this is not the known cause/);
    assert.doesNotMatch(drift, /seeding loop running a second time/);

    const tabletFirst = boardParityProblems([
      { type: 'tablet', record: tabletRecordDoubled },
      { type: 'phone', record: phoneRecord },
    ]).join('\n');
    assert.match(tabletFirst, /12 is 6 doubled exactly, which is the known cause/);
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
    const push = src.indexOf(
      'problems.push(...boardParityProblems(measured.map((m) => ({ type: m.cap.type, record: m.record }))));',
    );
    assert.notEqual(push, -1, 'the runner no longer pushes the parity verdict for every measured viewport');
    // The same `problems` array the rest of the verification pushes into, and
    // the one whose non-emptiness exits 1 before any CAPTURE.json is written.
    // EXACT STATEMENTS, NOT `[\s\S]*`: until 2026-09-22 this was one regex that
    // let any amount of code — another exit, a `return`, a reset of `problems`
    // — sit between the test and the exit, and it did not check that the push
    // happens BEFORE the test at all. A push after the exit decision is a push
    // nobody reads.
    const gate = src.indexOf('\nif (problems.length) {\n');
    assert.notEqual(gate, -1, 'the top-level `if (problems.length) {` gate is gone');
    assert.ok(push < gate, 'the parity verdict is pushed AFTER the gate that exits on it, so it is never read');
    const block = src.slice(gate, src.indexOf('\n}\n', gate) + 3);
    assert.match(block, /\n {2}process\.exit\(1\);\n\}\n$/, 'the gate block no longer ends in process.exit(1)');
    assert.doesNotMatch(block, /\breturn\b|problems\.length = 0|problems = \[\]/);
    // And each drive is told where to leave its record, per viewport, through
    // the ONE function the suite below proves is distinct per viewport — not a
    // local copy of it.
    assert.match(src, /\n {8}STORE_BOARD_FILE: boardFileFor\(boardDir, cap\)\.replace\(\/\\\\\/g, '\/'\),\n/);
    assert.match(src, /\n {2}const boardFile = boardFileFor\(boardDir, cap\);\n/);
    assert.match(src, /^import \{ boardFileFor, [^}]*\} from '\.\/capture-board-parity\.mjs';$/m);
    assert.doesNotMatch(src, /(const|let|var|function)\s+boardFileFor\b/);
  });
});

// 🔴 MUTATION (c) OF THE 2026-09-21 PLAN: `boardFileFor` returning ONE path for
// both viewports. The second drive then overwrites the first drive's record, the
// runner reads the same file twice, and `boardParityProblems` compares a board
// with ITSELF — green by construction, on exactly the run it exists to refuse.
// Until 2026-09-22 the function was an arrow inside the runner, which cannot be
// run here, and the only test was a regex over its CALL site.
describe('where each viewport leaves its board record', () => {
  test('phone and tablet get DISTINCT files, both inside the run directory', () => {
    const dir = join('run-dir', 'nk-shot-board-0000');
    const phone = boardFileFor(dir, { type: 'phone' });
    const tablet = boardFileFor(dir, { type: 'tablet' });
    assert.notEqual(phone, tablet);
    assert.equal(dirname(phone), dir);
    assert.equal(dirname(tablet), dir);
    assert.equal(phone, join(dir, 'phone.json'));
    assert.equal(tablet, join(dir, 'tablet.json'));
  });

  test('two runs never share a file: the directory is part of the path', () => {
    const a = boardFileFor(join('run-dir', 'a'), { type: 'phone' });
    const b = boardFileFor(join('run-dir', 'b'), { type: 'phone' });
    assert.notEqual(a, b);
  });
});

/** A Dart source with its whole-line comments removed. A comment that MENTIONS
 *  a forbidden loop must not red the suite, and a commented-out call must not
 *  green it. */
const dartCode = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');

// 🔴 MUTATION (a) OF THE 2026-09-21 PLAN: the suite's seeding block reverted to
// `for (final List<String> row in kIllustrative)`. `test/store_seed_idempotence_test.dart`
// drives `seedMissingRows` and `waitForLoadedBoard` in both directions, and
// proves nothing about a suite that stops calling them — the suite itself runs
// only in a live `flutter drive`, which needs CI-only secrets. So this reads the
// suite's SOURCE and refuses every way of seeding that bypasses them. A static
// check, labelled as one: the behavioural half is the widget test plus the live
// dispatch.
describe('the capture suite seeds through the tested functions and nothing else', () => {
  const suite = dartCode(
    readFileSync(
      join(ROOT, 'apps', 'subscriptiontracker', 'integration_test', 'store_screenshots_test.dart'),
      'utf8',
    ),
  );

  test('the seeding pass is `seedMissingRows`, over the real sheet, for the illustrative set', () => {
    assert.match(suite, /^import 'store_board_census\.dart';$/m);
    const calls = suite.match(/\bseedMissingRows\(/g) ?? [];
    assert.equal(calls.length, 1, `the suite calls seedMissingRows ${calls.length} time(s); it must call it once`);
    assert.match(
      suite,
      /final SeedPass pass = await seedMissingRows\(\n\s*loadBoard: loadedBoard,\n\s*addRow: addThroughSheet,\n\s*wanted: kIllustrative,\n/,
    );
  });

  test('the board is read through `waitForLoadedBoard`, never snatched', () => {
    assert.match(suite, /Future<List<Subscription>> loadedBoard\(\) => waitForLoadedBoard\(\n/);
    assert.doesNotMatch(suite, /valueOrNull/);
  });

  test('no loop over kIllustrative, and the sheet is driven from nowhere else', () => {
    assert.doesNotMatch(suite, /\bfor\s*\([^)]*\bin\s+kIllustrative\b/);
    assert.doesNotMatch(suite, /\bkIllustrative\s*\.\s*(forEach|map|expand)\s*\(/);
    // `addThroughSheet(` appears ONCE — its declaration. Every other mention is
    // the bare reference handed to `seedMissingRows`, so any second call site,
    // in any loop shape, is a seed that did not ask what the board holds.
    const sheetCalls = suite.match(/\baddThroughSheet\(/g) ?? [];
    assert.equal(sheetCalls.length, 1, `addThroughSheet( appears ${sheetCalls.length} times; only its declaration may`);
    assert.match(suite, /Future<void> addThroughSheet\(List<String> row\) async \{/);
  });

  // A local function of the same name would take the call away from the
  // tested one without changing the call site. Each name appears ONCE in the
  // suite's code — the call above — so a declaration beside it is a second
  // occurrence; and the decision functions the pass is built from are not
  // called here at all, so the suite cannot assemble its own order out of them.
  test('the suite does not shadow the tested functions or rebuild the order from their parts', () => {
    for (const name of ['seedMissingRows', 'waitForLoadedBoard']) {
      const n = (suite.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length;
      assert.equal(n, 1, `${name} appears ${n} times in the suite's code; only the one call may`);
    }
    for (const name of ['rowsMissingFrom', 'censusOf', 'boardComplaints']) {
      assert.doesNotMatch(suite, new RegExp(`\\b${name}\\b`), `the suite calls ${name} itself`);
    }
  });
});

// MUTATION (e) OF THE 2026-09-21 PLAN: the driver's `responseDataCallback` or
// `writeResponseOnFailure` removed. Without the callback no record reaches the
// host and the runner reports "absent record" for every viewport — caught, but
// only at runtime, after a full live capture. Without `writeResponseOnFailure`
// a FAILED drive leaves no record, and the reader of that failure loses the one
// line that says what the board held when it failed. The driver needs a device
// and a browser, so this is a static check, labelled as one.
describe('the driver hands each drive record to the host', () => {
  const driver = dartCode(
    readFileSync(join(ROOT, 'apps', 'subscriptiontracker', 'test_driver', 'store_screenshots.dart'), 'utf8'),
  );

  test('responseDataCallback writes the record to STORE_BOARD_FILE', () => {
    assert.match(driver, /\n {4}responseDataCallback: \(Map<String, dynamic>\? data\) async \{\n/);
    assert.match(driver, /final String\? boardPath = Platform\.environment\['STORE_BOARD_FILE'\];/);
    assert.match(driver, /final File file = File\(boardPath\);/);
    assert.match(driver, /await file\.writeAsString\('\$\{jsonEncode\(data \?\? <String, dynamic>\{\}\)\}\\n'\);/);
  });

  test('a failed drive still writes its record', () => {
    assert.match(driver, /\n {4}writeResponseOnFailure: true,\n/);
  });
});
