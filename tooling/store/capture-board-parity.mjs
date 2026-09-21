// ─────────────────────────────────────────────────────────────────────────────
// capture-board-parity.mjs — TWO VIEWPORTS, ONE BOARD.
//
// 🔴 THE DEFECT THIS EXISTS FOR, AND WHY A RE-CAPTURE WOULD NOT HAVE CLOSED IT.
// Eight frames were merged as Public 9f548515 (#854). The phone set reads
// `6 active` and `$93.47` a month. The tablet set OF THE SAME RUN reads
// `12 active` and `$186.94`, and its Home list names five of the six rows TWICE
// under "All subscriptions 12". `kIllustrative` in
// `apps/subscriptiontracker/integration_test/store_screenshots_test.dart` holds
// exactly six rows summing to 93.47, so 186.94 is that set seeded twice and can
// be nothing else.
//
// It was found by a human opening two PNGs and counting rows. Nothing in this
// repository could have found it:
//
//   · NO GUARD HERE READS TEXT OUT OF A PNG. `assert-listing-assets.mjs`
//     decodes pixels — size, colour type, aspect, flat bands, and since #856 the
//     fraction of pixels in local contrast to their neighbours. All of those
//     passed on the doubled set. A number rendered as glyphs is not a number to
//     any of them.
//   · `CAPTURE.json` RECORDED NOTHING ABOUT THE BOARD. Until today its fields
//     were `capturedBy`, `posture`, `deviceType`, `viewport`, `pixels`, `count`
//     and the requirements source — size and provenance, and not one field about
//     what was ON the screen. Two records could describe two completely
//     different boards and agree in every field.
//
// So a re-capture alone catches THIS instance; this file catches the CLASS. The
// board is now read out of the running app by the suite, carried to the host by
// `test_driver/store_screenshots.dart`, and compared HERE between viewports
// before a single byte of provenance is written.
//
// ⚠️ WHAT IT COMPARES, AND WHY THOSE FIELDS. `home_screen.dart` passes
// `data.length` to the hero card as the `N active` pill and
// `SubMath.totalMonthly(data)` as the monthly figure — so these two numbers ARE
// the two numbers the frames disagreed about. The names are compared too,
// because two boards can hold six rows each and not be the same six.
//
// ⚠️ MINOR UNITS, NEVER A FORMATTED STRING. `$93.47` is a `MoneyFormatter`
// output over a locale; comparing formatted strings would compare the locales
// as well as the boards and would go quiet the day one viewport rounded
// differently. An integer count of cents is the same number in both frames or
// it is not.
// ─────────────────────────────────────────────────────────────────────────────

import { join } from 'node:path';

/** WHERE ONE VIEWPORT'S DRIVE LEAVES ITS BOARD RECORD: one file per device
 *  type, inside [dir].
 *
 *  🔴 DISTINCT PER VIEWPORT, OR THE PARITY CHECK BELOW IS VACUOUS. If every
 *  viewport were handed the same path, the second drive would overwrite the
 *  first drive's record and `boardParityProblems` would compare one board with
 *  ITSELF — agreement by construction, on exactly the run it exists to refuse.
 *  That is why this is a named, exported function rather than an arrow inside
 *  the runner: `store-capture-board-parity.test.mjs` asserts the phone and
 *  tablet paths differ, and a runner that cannot be executed outside CI could
 *  never have shown it. */
export function boardFileFor(dir, cap) {
  return join(dir, `${cap.type}.json`);
}

/** Pull the `board` object out of one drive's `reportData` record.
 *
 *  Returns `null` for a record that carries no board — which is a REAL state,
 *  not a malformed one: a `--proof` run is a demo build, skips the seeding
 *  block entirely, and publishes no `board` key. The caller decides what
 *  absence means; this does not guess. */
export function boardOf(record) {
  if (!record || typeof record !== 'object') return null;
  const b = record.board;
  if (!b || typeof b !== 'object') return null;
  return b;
}

/** A single viewport's board, reduced to the tuple two viewports must agree on.
 *
 *  🔴 A MISSING FIELD IS NOT A ZERO. `activeCount: undefined` compared against
 *  `activeCount: 6` must read as "this record cannot be compared", not as
 *  "this board is empty" — the second is a sentence about the app and this
 *  would be inventing it. Every field is required and its absence is named. */
export function summariseBoard(board, { label }) {
  const problems = [];
  if (board === null) {
    return { ok: false, problems: [`${label}: the drive recorded no board at all`] };
  }
  const count = board.activeCount;
  if (!Number.isInteger(count) || count < 0) {
    problems.push(`${label}: activeCount is ${JSON.stringify(count)}, which is not a row count`);
  }
  const minor = board.monthlyTotalMinorUnits;
  if (!minor || typeof minor !== 'object' || Array.isArray(minor)) {
    problems.push(
      `${label}: monthlyTotalMinorUnits is ${JSON.stringify(minor)}, and the comparison needs a ` +
        `{currencyCode: integerMinorUnits} map`,
    );
  } else {
    for (const [code, units] of Object.entries(minor)) {
      if (!Number.isInteger(units)) {
        problems.push(`${label}: monthlyTotalMinorUnits.${code} is ${JSON.stringify(units)}, not an integer`);
      }
    }
  }
  const names = board.names;
  if (!Array.isArray(names) || names.some((n) => typeof n !== 'string')) {
    problems.push(`${label}: names is ${JSON.stringify(names)}, and the comparison needs a list of row names`);
  }
  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    problems: [],
    count,
    // Sorted so two records written in different orders compare equal, and
    // joined so the comparison below is one string equality rather than a
    // hand-rolled deep compare that has to be right about nesting.
    money: Object.entries(minor)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([code, units]) => `${code} ${units}`)
      .join(', '),
    names: [...names].sort().join(' | '),
  };
}

/** THE CLASS CHECK. Given one `{type, record}` per viewport, return the list of
 *  problems that stop this capture from being a listing.
 *
 *  Empty list ⇒ every viewport photographed the same board.
 *
 *  🔴 IT REFUSES ON ABSENCE. A run whose second viewport recorded no board is
 *  a run whose second viewport cannot be compared to the first, and "cannot be
 *  compared" must not share an exit code with "agreed". That is the exact shape
 *  that let the doubled set through: a check that ranges over nothing prints ok.
 *
 *  ⚠️ FEWER THAN TWO VIEWPORTS IS ALSO A PROBLEM, and it is named separately.
 *  A comparison between one board and nothing is vacuous by construction, and a
 *  capture that produced one device type is already unpublishable for the Play
 *  reason the runner states elsewhere — this limb says why it is also unchecked. */
export function boardParityProblems(entries) {
  const problems = [];
  if (!Array.isArray(entries) || entries.length < 2) {
    problems.push(
      `the board-parity check needs a record from at least two viewports and received ` +
        `${Array.isArray(entries) ? entries.length : 0}. With one board there is nothing to compare it ` +
        `against, and a check that ranges over nothing reports ok — which is how the doubled tablet set ` +
        `of 9f548515 reached a store listing.`,
    );
    if (!Array.isArray(entries) || entries.length === 0) return problems;
  }

  const summaries = entries.map((e) => ({
    type: e.type,
    ...summariseBoard(boardOf(e.record), { label: `the "${e.type}" viewport` }),
  }));
  for (const s of summaries) problems.push(...s.problems);
  if (summaries.some((s) => !s.ok)) return problems;

  const [first, ...rest] = summaries;
  for (const other of rest) {
    if (other.count !== first.count) {
      // ⚠️ THE CAUSE IS NAMED ONLY WHEN THE NUMBERS SAY IT. One board exactly
      // twice the other is the #854 signature, in either order. Any other
      // mismatch is a different defect, and a message that blamed the seeding
      // loop for 6 against 7 would send the reader to the one place already
      // fixed.
      const lo = Math.min(first.count, other.count);
      const hi = Math.max(first.count, other.count);
      const doubled = lo > 0 && hi === lo * 2;
      problems.push(
        `the "${first.type}" viewport photographed a board of ${first.count} subscription(s) and the ` +
          `"${other.type}" viewport photographed ${other.count}. Both sets go on the SAME listing, so a ` +
          `reader sees "${first.count} active" on one frame and "${other.count} active" on another. ` +
          (doubled
            ? `${hi} is ${lo} doubled exactly, which is the known cause: the seeding loop running a second ` +
              `time against the same account.`
            : `${hi} is not ${lo} doubled, so this is not the known cause; open both sets and read what ` +
              `differs.`),
      );
    }
    if (other.money !== first.money) {
      problems.push(
        `the "${first.type}" viewport's monthly total is ${first.money} (minor units) and the ` +
          `"${other.type}" viewport's is ${other.money}. These are the numbers the hero card renders, so ` +
          `the two sets advertise two different monthly costs for the same product.`,
      );
    }
    if (other.names !== first.names) {
      problems.push(
        `the "${first.type}" viewport's board is [${first.names}] and the "${other.type}" viewport's is ` +
          `[${other.names}]. Same count is not the same board, and the listing shows both.`,
      );
    }
  }
  return problems;
}

/** The part of a board record worth KEEPING beside the frames, for the next
 *  reader who asks "what was on screen?" of a set that is already committed.
 *
 *  Folded into each set's CAPTURE.json. It is provenance, not a check — the
 *  check ran before this was written. */
export function boardProvenance(board) {
  if (board === null) return null;
  return {
    activeCount: board.activeCount,
    monthlyTotalMinorUnits: board.monthlyTotalMinorUnits,
    names: board.names,
    seededThisDrive: board.seededThisDrive,
    alreadyPresent: board.alreadyPresent,
  };
}
