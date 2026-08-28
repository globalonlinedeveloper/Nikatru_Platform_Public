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
// Usage:  node tooling/ci/assert-case-count-honest.mjs --junit <path> [--manifest <path>]
// Exit 0 = every recorded floor is <= the cases that file actually ran.
//      1 = a floor exceeds what ran, or the question could not be asked.
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

function coverageLost(first, ...more) {
  console.error(`✗ COVERAGE LOST — ${first}`);
  for (const m of more) console.error(`    ${m}`);
  console.error('  "Compared nothing, found nothing wrong" must never share an exit code with "every floor holds".');
  console.error('assert-case-count-honest: FAILED');
  process.exit(1);
}

/** `--junit <path>` / `--manifest <path>`, both `--k v` and `--k=v`. */
export function parseArgs(argv) {
  const out = { junit: null, manifest: null, unknown: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf('=');
    const key = eq > 0 ? a.slice(0, eq) : a;
    const inline = eq > 0 ? a.slice(eq + 1) : null;
    if (key === '--junit') out.junit = inline ?? argv[++i] ?? null;
    else if (key === '--manifest') out.manifest = inline ?? argv[++i] ?? null;
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
      'A typo in a workflow flag must not be read as "no work to do". This guard takes --junit and --manifest.',
    );
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
    process.exit(1);
  }

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

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) main();
