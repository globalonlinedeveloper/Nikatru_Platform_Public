#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-case-count-honest.mjs — the ratchet floor must never claim MORE
// coverage than the suite actually ran.
//
// Pipeline requirement: Private/requirements/ → F-10.
//
// ── THE DEFECT THIS EXISTS FOR ───────────────────────────────────────────────
// 🔴 `tooling/ci/test/coverage-manifest.json` recorded 431 for guards.test.mjs,
// a file that runs 398 tests. It stood for as long as it stood because THE
// NUMBER HAD NO INDEPENDENT ARBITER: the floor is produced by `countCases` in
// assert-guard-coverage.mjs, and the only thing that ever checked the floor was
// `countCases` again. The counter graded its own homework.
//
// That asymmetry is the whole point. A HOLLOW file — a manifest saying 40 for a
// file that declares 12 — was always caught, loudly, because the ratchet fails
// on a DROP. An INFLATED one was not caught at all, and inflation is the
// dangerous direction: a floor is a promise that this much coverage exists, and
// 57 of the cases the manifest promised were `test('…', () => {})` spelled
// inside fixture STRING LITERALS that nothing runs. The counter was repaired on
// 2026-08-27 (guards.test.mjs 431 → 383). This file is what makes the class
// non-recurring, because a repaired counter is still a counter grading itself.
//
// ── THE INVARIANT ────────────────────────────────────────────────────────────
//     for every test file:   floor <= executed
//
//   · 431 <= 398  is FALSE — the historical bug, caught.
//   · 383 <= 398  is TRUE  — today's tree, passes.
//
// ⚠️ `<=`, NEVER `==`, AND THAT IS NOT A WEAKENING. `countCases` deliberately
// counts LINE-ANCHORED declarations (`/^\s*(test|it)\s*\(/m`), so a case
// generated inside a loop is RUN without being DECLARED. guards.test.mjs is
// exactly that shape: 383 declared, 398 run. An equality would be a permanent
// red on correct code, which is a check people delete rather than obey. The
// gap is documented in assert-guard-coverage.mjs beside the counter itself.
//
// ── WHERE `executed` COMES FROM ──────────────────────────────────────────────
// node's test runner emits, in its junit reporter, one `<testcase>` per case
// with `file="<absolute path>"` on every single one. Reporters can be DOUBLED,
// so the human-readable spec output survives on stdout while the machine-
// readable xml goes to a file:
//
//     node --test --test-reporter=spec  --test-reporter-destination=stdout \
//                 --test-reporter=junit --test-reporter-destination=junit.xml \
//                 "tooling/ci/test/*.test.mjs"
//
// This guard reads only that xml. It never re-counts declarations — a second
// reader of the same bytes is a second thing to go wrong in the same direction,
// which is the mistake being removed, not repeated.
//
// ── WHY THE KEY IS THE BASENAME, AND WHY THERE IS NO `realpath` HERE ─────────
// The `file=` attribute is an ABSOLUTE path belonging to the machine that RAN
// the tests. CI is Linux (`/home/runner/work/…/guards.test.mjs`); this host is
// Windows (`C:\Users\…\guards.test.mjs`). Two separators, two roots, and on
// Windows two spellings of the same path can differ in CASE.
//
// `path.resolve` would fix NEITHER: it does not canonicalise case, and it would
// happily resolve a Linux path against a Windows cwd into nonsense. Only
// `realpathSync.native` canonicalises case — and it needs the file to EXIST on
// the machine doing the reading, which is exactly what is not true when a Linux
// runner's xml is read anywhere else.
//
// So no canonicalisation is done, because none is needed: the manifest is keyed
// by BASENAME already (`"guards.test.mjs": 383`), and a basename needs no
// filesystem, no cwd and no platform agreement. The path is split on BOTH
// separators — `/[\\/]/` — so a Windows path read on Linux still yields
// `guards.test.mjs` rather than the whole string.
//
// The one thing a basename can do that a full path cannot is COLLIDE, and that
// is not waved away: if two DIFFERENT directories in the same xml contribute
// the same basename, their counts would silently ADD and inflate `executed` —
// which weakens the very comparison this file exists to make. That is refused
// as COVERAGE LOST below, not summed.
//
// ── THE COVERAGE RAIL ────────────────────────────────────────────────────────
// 🔴 "Compared nothing, found nothing wrong" is the shape this repository
// refuses, and it is the shape a guard fed an xml file decays into the instant
// the reporter flag is dropped from a workflow. Every one of these is COVERAGE
// LOST and exits non-zero — never a pass:
//
//   · the --junit path is missing, unreadable, or empty
//   · the xml is not a junit document, or carries no <testcase> at all
//   · a <testcase> carries no file= attribute (unattributable, so uncountable)
//   · NOT ONE file in the xml matches a manifest key
//   · a manifest key appears in NO file in the xml — its floor was arbitrated
//     by nothing, which is indistinguishable from it being honest
//   · two directories contribute the same basename (see above)
//   · the manifest is missing, unparseable, empty, or not an object
//
// The last one in that list is the reason there is no `--partial` escape hatch.
// A flag that lets the guard compare a subset is a flag that someone drops into
// a workflow, and then the run that compares one file out of a hundred and
// forty-eight prints `ok`. Point `--manifest` at a smaller manifest instead:
// that is a visible, committed artefact, not an invisible argument.
//
// ── WHERE IT SITS IN ci.yml, AND WHY THAT ORDER ─────────────────────────────
// AFTER assert-guard-coverage.mjs, not before. That guard REWRITES the manifest
// in-runner whenever a count rises, so running the arbiter afterwards checks the
// floor AS RAISED BY THAT VERY RUN. Placed before it, an inflated rise computed
// in the same job would read green and be caught only the next time somebody
// committed the rewritten manifest — one run late, which for a ratchet is
// permanently, because the inflated value is what the next drop-check compares to.
//
// ── THE SECOND LIMB: THE EXECUTED FLOOR (O-COVERAGE-MANIFEST-LOOP-CASES, option 1)
// The first limb compares the DECLARED floor to what ran. It cannot see a case
// generated inside a loop: delete one row of a `for (const x of TABLE) test(…)`
// table and the declared count does not move, while `executed` drops by one and
// is still >= the declared floor. Nothing read that drop — the executed counts
// were compared only against the static floor, never against their own past.
//
// `--executed-floor <path>` (tooling/ci/test/executed-floor.json) adds:
//
//     for every suite in the floor:   executed >= executedFloor
//
//   · executed below its floor         → a finding, exit 1 (a case was deleted)
//   · a floored suite absent from junit → COVERAGE LOST, exit 2
//   · executed ABOVE its floor          → never a failure (no churn per new test);
//                                         the floor rises only by the refresh script
//
// The floor is a LINUX (ubuntu-24.04, guard-meta) measurement and is written
// ONLY by tooling/scripts/refresh-executed-floor.mjs from a green main run's
// junit artifact. So: only ci.yml's guard-meta step passes the flag; locally
// the limb prints `executed floor: not measured here (Linux CI only)` — a
// named skip, never a silent pass — and a junit whose file= paths are Windows-
// shaped is REFUSED against the floor (COVERAGE LOST), because 36 suites ran
// fewer cases on Windows than on the runner and the comparison would lie.
//
// First fill: the file ships with `"filledFrom": null` and `"suites": {}`, which
// reads as `not yet filled` (exit 0, reason printed). Any OTHER half-state —
// suites with no provenance, provenance with no suites, a missing file — is
// COVERAGE LOST: deleting or emptying the floor must never read as a pass.
//
// Usage:  node tooling/ci/assert-case-count-honest.mjs --junit <path> [--manifest <path>]
//                                                      [--executed-floor <path>]
// Exit 0 = every recorded floor is <= the cases that file actually ran (and, with
//          --executed-floor, every floored suite ran at least its floor).
//      1 = a floor exceeds what ran, or a suite ran fewer cases than its executed floor.
//      2 = COVERAGE LOST — the question could not be asked.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANIFEST_REL = 'tooling/ci/test/coverage-manifest.json';

/** The last segment of a path spelled with EITHER separator. No filesystem, no
 *  cwd, no case-folding — see the header for why each of those is refused. */
export function basenameOf(p) {
  if (typeof p !== 'string') return '';
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] ?? '';
}

/** The directory part, kept only so a basename COLLISION can be named in the
 *  error rather than silently summed. */
export function dirOf(p) {
  if (typeof p !== 'string') return '';
  const parts = p.split(/[\\/]/);
  parts.pop();
  return parts.join('/');
}

const ENTITIES = new Map([
  ['&amp;', '&'],
  ['&lt;', '<'],
  ['&gt;', '>'],
  ['&quot;', '"'],
  ['&apos;', "'"],
]);

/** XML attribute values arrive escaped. A path is unlikely to carry `&`, but a
 *  decoder that silently leaves `&amp;` in place turns one real file into a key
 *  that matches nothing, and "matches nothing" is the failure mode this whole
 *  file is about. */
export function unescapeXml(s) {
  return String(s).replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (m) => {
    if (ENTITIES.has(m)) return ENTITIES.get(m);
    const code = m[2] === 'x' || m[2] === 'X' ? parseInt(m.slice(3, -1), 16) : parseInt(m.slice(2, -1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  });
}

const ATTR = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;

/**
 * Every `<testcase>` in a junit document, as `{ file }`.
 *
 * 🔴 NOT `/<testcase[^>]*>/`. A test NAME is an attribute value and this suite's
 * names carry `>` and `<` in them; node escapes those, but a matcher whose
 * termination depends on that escaping is a matcher that reads half a document
 * the day it stops. The opening tag is walked CHARACTER BY CHARACTER with quote
 * state instead, so `>` inside a value cannot end the tag.
 *
 * Returns `unattributed` separately rather than dropping those cases: a
 * `<testcase>` with no `file=` cannot be credited to any floor, and quietly
 * ignoring it is how a comparison shrinks without anybody noticing.
 */
export function parseJunitCases(xml) {
  const text = String(xml ?? '');
  const cases = [];
  let unattributed = 0;
  let i = 0;
  for (;;) {
    const at = text.indexOf('<testcase', i);
    if (at < 0) break;
    // `<testcases…` is not `<testcase`. Require a separator after the name.
    const after = text[at + '<testcase'.length];
    if (after !== undefined && !/[\s/>]/.test(after)) {
      i = at + 1;
      continue;
    }
    let k = at + '<testcase'.length;
    let quote = null;
    while (k < text.length) {
      const c = text[k];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '>') {
        break;
      }
      k++;
    }
    const tag = text.slice(at, k);
    ATTR.lastIndex = 0;
    let file = null;
    for (const m of tag.matchAll(ATTR)) {
      if (m[1] === 'file') file = unescapeXml(m[3] ?? m[4] ?? '');
    }
    if (file) cases.push({ file });
    else unattributed++;
    i = k + 1;
  }
  return { cases, unattributed };
}

/**
 * The executed count per basename, plus the distinct directories each basename
 * was seen in. Arrays, never Sets — `JSON.stringify` on a Set prints `{}`, and
 * this shape is printed in error messages.
 */
export function tallyByBasename(cases) {
  const counts = new Map();
  const dirs = new Map();
  for (const { file } of cases) {
    const base = basenameOf(file);
    if (!base) continue;
    counts.set(base, (counts.get(base) ?? 0) + 1);
    const seen = dirs.get(base) ?? [];
    const d = dirOf(file);
    if (!seen.includes(d)) seen.push(d);
    dirs.set(base, seen);
  }
  return { counts, dirs };
}

/**
 * The verdict. Pure, so both directions are exercised without spawning anything.
 *
 *   violations  — floor > executed. THE BUG. 431 vs 398 lands here.
 *   unarbitrated— a manifest key the xml never mentions. Its floor was checked
 *                 by nothing, which reads identically to it being correct.
 *   collisions  — one basename, two directories. Summing them would inflate
 *                 `executed` and weaken the comparison.
 */
export function compareFloors(manifest, counts, dirs = new Map()) {
  const violations = [];
  const unarbitrated = [];
  const arbitrated = [];
  const collisions = [];
  for (const [file, floor] of Object.entries(manifest)) {
    const executed = counts.get(file);
    if (executed === undefined) {
      unarbitrated.push(file);
      continue;
    }
    const where = dirs.get(file) ?? [];
    if (where.length > 1) collisions.push({ file, dirs: where });
    arbitrated.push(file);
    if (typeof floor !== 'number' || !Number.isFinite(floor)) {
      violations.push({ file, floor, executed, unreadable: true });
      continue;
    }
    if (floor > executed) violations.push({ file, floor, executed, unreadable: false });
  }
  return { violations, unarbitrated, arbitrated, collisions };
}

export const EXECUTED_FLOOR_REL = 'tooling/ci/test/executed-floor.json';
export const EXECUTED_FLOOR_HEADER =
  'Per-suite EXECUTED case counts, measured on the Linux ubuntu-24.04 guard-meta runner. Read by ' +
  'tooling/ci/assert-case-count-honest.mjs --executed-floor (executed >= floor; a floored suite absent ' +
  'from junit is COVERAGE LOST; rises never fail). Written ONLY by tooling/scripts/refresh-executed-floor.mjs ' +
  'from the guard-tests-junit artifact of a GREEN ci.yml run on main; never written from a local run. ' +
  'filledFrom null + suites {} = not yet filled.';

/** A junit file= path spelled by a Windows host: a drive letter or a UNC root. */
export function isWindowsPath(p) {
  return typeof p === 'string' && (/^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\'));
}

/**
 * Validates a parsed executed-floor document. Pure. Returns
 *   { state: 'unfilled' } | { state: 'filled', suites } | { state: 'invalid', reason }.
 * Every half-state is `invalid`, so an emptied or hand-written floor never reads as a pass.
 */
export function readExecutedFloor(doc) {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return { state: 'invalid', reason: 'it is not a JSON object' };
  }
  const { suites, filledFrom } = doc;
  if (typeof suites !== 'object' || suites === null || Array.isArray(suites)) {
    return { state: 'invalid', reason: 'it has no "suites" object of "<suite>.test.mjs": <count>' };
  }
  for (const [k, v] of Object.entries(suites)) {
    if (!Number.isInteger(v) || v < 0) {
      return { state: 'invalid', reason: `suite ${JSON.stringify(k)} has floor ${JSON.stringify(v)}, not a non-negative integer` };
    }
  }
  const n = Object.keys(suites).length;
  const hasSource = typeof filledFrom === 'object' && filledFrom !== null && Number.isInteger(filledFrom.run);
  if (filledFrom === null && n === 0) return { state: 'unfilled' };
  if (!hasSource) {
    return {
      state: 'invalid',
      reason: `it has ${n} suite floor(s) but no "filledFrom" run — only refresh-executed-floor.mjs writes it, and it always records the run`,
    };
  }
  if (n === 0) {
    return { state: 'invalid', reason: `it records a fill from run ${filledFrom.run} but carries NO suite floors — an emptied floor is the floor removed` };
  }
  return { state: 'filled', suites };
}

/**
 * The executed-floor verdict. Pure.
 *   drops    — executed < floor. A case that used to run no longer does.
 *   lost     — a floored suite the junit never mentions.
 *   rises    — executed > floor. Reported, never a failure.
 *   unfloored— suites in the junit with no floor yet; they join at the next refresh.
 */
export function compareExecutedFloor(suites, counts) {
  const drops = [];
  const lost = [];
  const rises = [];
  let held = 0;
  for (const [suite, floor] of Object.entries(suites)) {
    const executed = counts.get(suite);
    if (executed === undefined) lost.push(suite);
    else if (executed < floor) drops.push({ suite, floor, executed });
    else {
      held++;
      if (executed > floor) rises.push({ suite, floor, executed });
    }
  }
  const unfloored = [...counts.keys()].filter((s) => !Object.hasOwn(suites, s)).sort();
  return { drops, lost, rises, unfloored, held };
}

/** The floor file, byte-deterministic: fixed key order, suites sorted, 2-space, LF, trailing newline. */
export function serializeExecutedFloor({ filledFrom = null, lowered = [], suites = {} }) {
  const sorted = {};
  for (const k of Object.keys(suites).sort()) sorted[k] = suites[k];
  const doc = { _header: EXECUTED_FLOOR_HEADER, platform: 'ubuntu-24.04', filledFrom, lowered, suites: sorted };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

function coverageLost(first, ...more) {
  console.error(`✗ COVERAGE LOST — ${first}`);
  for (const m of more) console.error(`    ${m}`);
  console.error('  "Compared nothing, found nothing wrong" must never share an exit code with "every floor holds".');
  console.error('assert-case-count-honest: FAILED');
  // ⏱ 2026-09-15 — exit 2, not 1: COVERAGE LOST is "did not check enough to be evidence", never a
  // finding (AGENTS.md exit-code convention; O-EXIT2-CONVENTION-GAP). This helper exited 1 until today.
  process.exit(2);
}

/** `--junit <path>` / `--manifest <path>` / `--executed-floor <path>`, both `--k v` and `--k=v`. */
export function parseArgs(argv) {
  const out = { junit: null, manifest: null, executedFloor: null, unknown: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf('=');
    const key = eq > 0 ? a.slice(0, eq) : a;
    const inline = eq > 0 ? a.slice(eq + 1) : null;
    if (key === '--junit') out.junit = inline ?? argv[++i] ?? null;
    else if (key === '--manifest') out.manifest = inline ?? argv[++i] ?? null;
    else if (key === '--executed-floor') out.executedFloor = inline ?? argv[++i] ?? '';
    else out.unknown.push(a);
  }
  return out;
}

function main() {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const args = parseArgs(process.argv.slice(2));

  if (args.unknown.length) {
    coverageLost(
      `unrecognised argument(s): ${args.unknown.join(' ')}.`,
      'A typo in a workflow flag must not be read as "no work to do". This guard takes --junit, --manifest and --executed-floor.',
    );
  }
  if (args.executedFloor === '') {
    coverageLost('--executed-floor was given with no path, so the executed floor it names cannot be read.');
  }
  if (!args.junit) {
    coverageLost(
      'no --junit <path> was given, so there is no record of what the suite actually ran.',
      'This guard compares the recorded per-file floor against the cases node REPORTED running. Without the',
      'junit reporter destination it has nothing to compare the floor to, and the floor goes back to being',
      'graded by the counter that produced it. Add the reporter to the test step:',
      '  node --test --test-reporter=spec --test-reporter-destination=stdout \\',
      '              --test-reporter=junit --test-reporter-destination=junit.xml "tooling/ci/test/*.test.mjs"',
    );
  }

  const junitAbs = resolve(args.junit);
  if (!existsSync(junitAbs)) {
    coverageLost(
      `${args.junit} does not exist.`,
      'The test step either did not run or did not write its junit destination. Either way nothing was measured.',
    );
  }
  let xml;
  try {
    xml = readFileSync(junitAbs, 'utf8');
  } catch (e) {
    coverageLost(`${args.junit} could not be read (${e.message}).`);
  }
  if (!xml.trim()) {
    coverageLost(
      `${args.junit} is EMPTY.`,
      'An empty report is the exact input under which a comparison silently ranges over nothing and prints ok.',
    );
  }
  if (!xml.includes('<testsuites') && !xml.includes('<testsuite')) {
    coverageLost(
      `${args.junit} is not a junit document — it carries no <testsuites> or <testsuite> element.`,
      `First bytes: ${JSON.stringify(xml.trim().slice(0, 160))}`,
      'A reporter that changed format, or a file that is something else entirely, must be loud rather than empty.',
    );
  }

  const { cases, unattributed } = parseJunitCases(xml);
  if (cases.length === 0 && unattributed === 0) {
    coverageLost(
      `${args.junit} reports NO test case at all.`,
      'A suite that ran nothing cannot arbitrate a floor, and "no case exceeded its floor" is trivially true',
      'of a run that had no cases.',
    );
  }
  if (unattributed > 0) {
    coverageLost(
      `${unattributed} of ${cases.length + unattributed} <testcase> element(s) carry no file= attribute.`,
      'node emits one on every case; without it a case cannot be credited to the floor it is meant to arbitrate,',
      'so the comparison below would range over less than the run did and still print ok.',
    );
  }

  const manifestAbs = resolve(args.manifest ?? join(HERE, 'test', 'coverage-manifest.json'));
  const manifestLabel = args.manifest ?? MANIFEST_REL;
  if (!existsSync(manifestAbs)) {
    coverageLost(
      `${manifestLabel} does not exist, so there is no floor to arbitrate.`,
      'It is the ratchet state. Its absence is the floor being removed, which is precisely what must not pass.',
    );
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestAbs, 'utf8'));
  } catch (e) {
    coverageLost(`${manifestLabel} could not be parsed (${e.message}), so every per-file floor is unreadable at once.`);
  }
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    coverageLost(`${manifestLabel} is not a JSON object of "<test file>": <count>.`);
  }
  if (Object.keys(manifest).length === 0) {
    coverageLost(
      `${manifestLabel} is EMPTY.`,
      'An empty ratchet has no floor to exceed, so this comparison would pass over any suite at all.',
    );
  }

  const { counts, dirs } = tallyByBasename(cases);
  const { violations, unarbitrated, arbitrated, collisions } = compareFloors(manifest, counts, dirs);

  if (arbitrated.length === 0) {
    coverageLost(
      `not one of the ${Object.keys(manifest).length} file(s) in ${manifestLabel} appears in ${args.junit}.`,
      `The report names ${counts.size} distinct file(s), e.g. ${[...counts.keys()].slice(0, 3).map((f) => JSON.stringify(f)).join(', ') || '(none)'}.`,
      'The manifest is keyed by BASENAME and so is this comparison, so a zero overlap means the xml describes a',
      'different suite entirely — not that every floor is honest.',
    );
  }
  if (collisions.length) {
    coverageLost(
      `${collisions.length} manifest key(s) were contributed by MORE THAN ONE directory in ${args.junit}:`,
      ...collisions.map((c) => `${c.file} — seen under ${c.dirs.map((d) => JSON.stringify(d)).join(' and ')}`),
      'Their case counts would ADD, inflating the executed side of `floor <= executed` and weakening the one',
      'comparison this guard makes. Summing them silently is the failure; refusing is not.',
    );
  }
  if (unarbitrated.length) {
    coverageLost(
      `${unarbitrated.length} recorded floor(s) were arbitrated by NOTHING — the file never appears in ${args.junit}:`,
      ...unarbitrated.slice(0, 12).map((f) => `${f} — recorded ${JSON.stringify(manifest[f])}, ran 0 case(s) in this report`),
      ...(unarbitrated.length > 12 ? [`… and ${unarbitrated.length - 12} more`] : []),
      'A floor nothing measured reads exactly like a floor that holds. Run the junit reporter over the WHOLE',
      'suite — `node --test "tooling/ci/test/*.test.mjs"` — or point --manifest at a manifest describing the',
      'subset that actually ran.',
    );
  }

  if (violations.length) {
    console.error(
      `✗ ${violations.length} recorded floor(s) claim MORE coverage than the suite ran — a floor is a promise, and`,
    );
    console.error('  these promise cases that nothing executed:');
    for (const v of violations) {
      if (v.unreadable) {
        console.error(`    ${v.file} — recorded ${JSON.stringify(v.floor)}, which is not a number. ${v.executed} case(s) ran.`);
      } else {
        console.error(`    ${v.file} — floor ${v.floor}, executed ${v.executed}. ${v.floor - v.executed} promised case(s) do not exist.`);
      }
    }
    console.error('');
    console.error(`  ${MANIFEST_REL} is written by countCases in tooling/ci/assert-guard-coverage.mjs, which counts`);
    console.error('  LINE-ANCHORED declarations. `floor <= executed` is the honest relation: cases generated inside a');
    console.error('  loop run without being declared, so executed may legitimately EXCEED the floor (guards.test.mjs');
    console.error('  declares 383 and runs 398). The reverse cannot happen honestly — it means the counter credited');
    console.error('  something that is not a running test, which is how 431 came to be recorded for a file that runs 398.');
    console.error('assert-case-count-honest: FAILED');
    // The executed-floor limb still runs below, so one red names every finding; the exit stays 1 (or 2).
  } else {
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const slack = arbitrated.reduce((a, f) => a + (counts.get(f) - manifest[f]), 0);
    console.log(
      `ok  case-count honesty — ${arbitrated.length} recorded floor(s) in ${manifestLabel} were each compared against ` +
        `the cases node REPORTED running in ${args.junit} (${total} case(s) across ${counts.size} file(s)), and every ` +
        `one satisfies floor <= executed. Total slack ${slack} case(s) — cases that RUN without being DECLARED, which ` +
        'is the loop-generated shape countCases cannot see and is the reason this is a floor and not an equality. ' +
        'The floor is no longer graded by the counter that produced it [pipeline F-10]',
    );
  }

  const executedCode = executedFloorLimb(args, cases, counts, dirs);
  process.exit(violations.length ? 1 : executedCode);
}

/** The second limb. Returns 0 or 1; COVERAGE LOST exits 2 directly. */
function executedFloorLimb(args, cases, counts, dirs) {
  if (args.executedFloor === null) {
    console.log(
      'executed floor: not measured here (Linux CI only) — the per-suite executed floor in ' +
        `${EXECUTED_FLOOR_REL} is a Linux ubuntu-24.04 measurement and only ci.yml's guard-meta step passes ` +
        '--executed-floor. This run checked the declared floor ONLY; a deleted loop-generated case is NOT caught here.',
    );
    return 0;
  }
  const label = args.executedFloor;
  const abs = resolve(label);
  if (!existsSync(abs)) {
    coverageLost(
      `${label} does not exist, so the executed floor it names cannot be read.`,
      'Its absence is the floor being removed. The unfilled state is a COMMITTED file with "filledFrom": null and',
      '"suites": {} — not a missing one.',
    );
  }
  let doc;
  try {
    doc = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    coverageLost(`${label} could not be parsed (${e.message}), so every executed floor is unreadable at once.`);
  }
  const floor = readExecutedFloor(doc);
  if (floor.state === 'invalid') {
    coverageLost(`${label} is not a valid executed floor: ${floor.reason}.`);
  }
  if (floor.state === 'unfilled') {
    console.log(
      `executed floor: not yet filled — ${label} carries "filledFrom": null and no suite floors. The first fill is ` +
        'written by `node tooling/scripts/refresh-executed-floor.mjs <run-id>` from the guard-tests-junit artifact ' +
        'of the first GREEN ci.yml run on main after the upload step landed. Until then a deleted loop-generated ' +
        'case is NOT caught by this limb.',
    );
    return 0;
  }
  const windows = cases.filter((c) => isWindowsPath(c.file));
  if (windows.length) {
    coverageLost(
      `${windows.length} case(s) in ${args.junit} were run on a WINDOWS host (e.g. ${JSON.stringify(windows[0].file)}).`,
      `The floor in ${label} is a Linux ubuntu-24.04 measurement, and suites run fewer cases on Windows (platform`,
      'skips), so the comparison would red on correct code or, worse, teach someone to lower the floor. Drop',
      '--executed-floor locally; only guard-meta passes it.',
    );
  }
  const collided = Object.keys(floor.suites).filter((s) => (dirs.get(s) ?? []).length > 1);
  if (collided.length) {
    coverageLost(
      `${collided.length} floored suite(s) were contributed by MORE THAN ONE directory in ${args.junit}:`,
      ...collided.map((s) => `${s} — seen under ${dirs.get(s).map((d) => JSON.stringify(d)).join(' and ')}`),
      'Their counts would ADD and hide a drop below the executed floor.',
    );
  }
  const { drops, lost, rises, unfloored, held } = compareExecutedFloor(floor.suites, counts);
  if (lost.length) {
    coverageLost(
      `${lost.length} suite(s) with an executed floor in ${label} ran NOTHING in ${args.junit}:`,
      ...lost.slice(0, 12).map((s) => `${s} — floor ${floor.suites[s]}, absent from the report`),
      ...(lost.length > 12 ? [`… and ${lost.length - 12} more`] : []),
      'A suite that vanished lost every case it ran. If it was deliberately retired or renamed, lower it with',
      '`refresh-executed-floor.mjs <run-id> --lower <suite> --reason "…"` in its own commit.',
    );
  }
  if (drops.length) {
    console.error(`✗ ${drops.length} suite(s) ran FEWER cases than their executed floor — a case that ran before no longer runs:`);
    for (const d of drops) {
      console.error(`    ${d.suite} — executed floor ${d.floor}, executed ${d.executed}. ${d.floor - d.executed} case(s) gone.`);
    }
    console.error('');
    console.error('  This is the loop-generated case the declared floor cannot see: a row deleted from a table that a');
    console.error('  `for` loop turns into test(...) calls. Restore it, or — if the removal is deliberate — lower the floor');
    console.error('  ALONE, in its own commit: refresh-executed-floor.mjs <run-id> --lower <suite> --reason "…".');
    console.error('assert-case-count-honest: FAILED (executed floor)');
    return 1;
  }
  console.log(
    `ok  executed floor — ${held} suite(s) in ${label} (filled from run ${doc.filledFrom.run}) each ran at least ` +
      `their Linux executed floor; ${rises.length} rose (never a failure; the floor rises only by the refresh ` +
      `script), ${unfloored.length} suite(s) in the report are not floored yet and join at the next refresh ` +
      '[O-COVERAGE-MANIFEST-LOOP-CASES]',
  );
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) main();
