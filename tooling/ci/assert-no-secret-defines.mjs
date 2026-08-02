#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-no-secret-defines.mjs — nothing is compiled into a shipped artifact
// that has not been written down as safe to ship.
//
// [pipeline 9]R-12 "No secret is compiled into a shipped artifact."
//
// 💰 THIS MUST HOLD BEFORE THE MONEY RAIL SHIPS. Stage 5 adds payment
// configuration to the client, and a payment credential compiled into a web
// bundle is not a bug that gets patched — it is a credential that has been
// published, to everyone, permanently, and the only remedy is rotation at the
// provider.
//
// ── WHY AN ALLOWLIST AND NOT A SCANNER ───────────────────────────────────────
// A `--dart-define` writes its value INTO the artifact. On web it is in the JS
// bundle; everywhere else it is in the AOT snapshot. `secrets.X` in a workflow
// says where the value was KEPT. It says nothing about where it ENDS UP, and
// every define in this repository comes from `secrets.` — including the ones
// that are entirely safe and including a real account password.
//
// So "does this look like a secret" cannot be answered by shape:
//   · SUPABASE_ANON_KEY is a JWT and is designed to ship.
//   · GLITCHTIP_DSN contains what reads like a password and is designed to ship.
//   · E2E_PASSWORD is a real password that must never reach a published build.
// A regex cannot separate those. A human writing down, once, why each one is
// there can — and this guard checks that the written-down set and the shipped
// set are THE SAME SET.
//
// ── SET EQUALITY, AND THE SECOND DIRECTION IS THE ONE GUARDS FORGET ──────────
//   · a define no entry covers      ⇒ FAIL. Nobody ships a value unexamined.
//   · an entry no workflow passes   ⇒ FAIL. Without this a name can be
//     PRE-APPROVED: approved today, added months later by somebody who reads
//     the entry as permission and never re-asks the question. It is also how a
//     dead entry outlives the thing it justified, so the register slowly stops
//     describing the tree while still reading complete.
//
// ── THE MULTILINE FOLD IS NOT OPTIONAL ───────────────────────────────────────
// 🔴 THE FOLD IS THE SHARED PARSER'S JOB, NOT THIS GUARD'S. Every release
// build in this repo is a folded `run: >` block, so a line-anchored matcher
// sees `--dart-define=SUPABASE_URL=${{` and, on the `run: |` shape in e2e.yml,
// a trailing `\` continuation. ci.yml's own comment beside
// assert-vendor-portability records measuring this: a line-based dart-define
// scan found 2 of the 11 that existed. Both fold shapes are handled by
// tooling/ci/workflow-scan.mjs, which is where that lesson lives.
//
// Comments are BLANKED before anything is read: `deploy-workers.yml:136` is a
// comment about a `--dart-define`, and counting it would demand an allowlist
// entry for a define nobody passes — a failure caused by prose.
//
// ── SCOPE ────────────────────────────────────────────────────────────────────
// `--dart-define` and `--dart-define-from-file`, in every workflow. The
// from-file form is included because it is the same act with the file one level
// of indirection away: whatever is in that file is compiled in exactly as hard.
//
// Usage:  node tooling/ci/assert-no-secret-defines.mjs [repoRoot]
// Exit 0 = every compiled-in input is declared, and every declaration is live.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAllWorkflows } from './workflow-scan.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER_REL = 'tooling/publishable-inputs.json';

/** Both spellings. `=NAME=` for the flag form, and the file form which names a
 *  path rather than a key — recorded separately because its CONTENT is the
 *  compiled-in set and this guard can only see the filename. */
const DEFINE = /--dart-define(?:=|\s+)([A-Za-z_][A-Za-z0-9_]*)=/g;
const DEFINE_FROM_FILE = /--dart-define-from-file(?:=|\s+)(\S+)/g;

const problems = [];
const notes = [];

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-no-secret-defines: FAILED');
  process.exit(1);
}

// ── the register ─────────────────────────────────────────────────────────────
const regAbs = join(ROOT, REGISTER_REL);
if (!existsSync(regAbs)) {
  coverageLost([
    `${REGISTER_REL} does not exist.`,
    'It is the right-hand side of the equality below. Without it, "every compiled-in input is declared"',
    'ranges over an empty declaration set and is satisfied by declaring nothing — which is exactly the',
    'state R-12 exists to end.',
  ]);
}
let register;
try {
  register = JSON.parse(readFileSync(regAbs, 'utf8'));
} catch (e) {
  coverageLost([`${REGISTER_REL} could not be parsed (${e.message}).`]);
}
const declared = register?.inputs;
if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) {
  coverageLost([`${REGISTER_REL} has no \`inputs\` object of "<DEFINE NAME>": { reason, residual }.`]);
}
const declaredNames = Object.keys(declared);
if (declaredNames.length === 0) {
  coverageLost([
    `${REGISTER_REL} declares ZERO inputs.`,
    'An empty allowlist makes the first direction of the equality fail loudly on every real define —',
    'which looks like the guard working — while the second direction is vacuously satisfied. Emptying',
    'this file is removing the record, not resetting it.',
  ]);
}

// ── the tree ─────────────────────────────────────────────────────────────────
const workflows = parseAllWorkflows(ROOT);
if (workflows.length === 0) {
  coverageLost([`no workflow files were parsed under ${ROOT}/.github/workflows.`]);
}
for (const wf of workflows) {
  if (wf.rawStepCount > 0 && wf.strippedStepCount === 0) {
    coverageLost([
      `${wf.rel} has ${wf.rawStepCount} step(s) and NONE survived comment stripping.`,
      'Its defines would be invisible and the equality below would be computed over a smaller set.',
    ]);
  }
}

/** name -> [ "wf:line", … ] */
const passed = new Map();
const fromFiles = [];
let scannedLines = 0;
for (const wf of workflows) {
  for (const job of wf.jobs.values()) {
    for (const l of job.logical) {
      scannedLines++;
      for (const m of l.text.matchAll(DEFINE)) {
        if (!passed.has(m[1])) passed.set(m[1], []);
        passed.get(m[1]).push(`${wf.rel}:${l.n}`);
      }
      for (const m of l.text.matchAll(DEFINE_FROM_FILE)) {
        fromFiles.push(`${wf.rel}:${l.n} → ${m[1]}`);
      }
    }
  }
}

if (scannedLines === 0) {
  coverageLost([
    `parsed ${workflows.length} workflow file(s) and read ZERO job lines.`,
    'The job parser has stopped reaching the files, so no define could be found and the guard would',
    'report a clean equality over nothing.',
  ]);
}

// 🔴 THE REACH SELF-CHECK — PARSED vs RAW, and it is the assertion that keeps
// the FIRST direction of the equality alive.
//
// The scan above reads only lines INSIDE `jobs:`, through the shared parser.
// Every way that parse can narrow — the `jobs:` anchor stopping matching, a job
// key at an unexpected indent, a define moved to a workflow-level `env:` or into
// a reusable-workflow `with:` block — makes a real define INVISIBLE. And an
// invisible define is a value nobody had to justify, while the SECOND direction
// still fires and reads as "the register is stale" rather than "the scan is broken".
//
// So the same comment-stripped text is re-scanned FLAT, and the parsed name set
// must contain everything the flat scan found.
//
// ⚠️ A COUNT COMPARISON WAS TRIED HERE FIRST AND WAS DELETED, because it could
// not fail. Every define in this tree sits alone on its own continuation line,
// so a per-line matcher and a folded matcher return the SAME number and a
// count-vs-count check is an assertion with no failing input — which this repo
// treats as worse than none, because it inflates apparent coverage. The NAME
// SET comparison has a real failing input, recorded: breaking the `jobs:`
// anchor in workflow-scan.mjs empties the parsed set while the flat set still
// holds all eight names.
const flatNames = new Set();
for (const wf of workflows) {
  const raw = readFileSync(join(ROOT, wf.rel), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .map((l) => l.replace(/\s#.*$/, ''))
    .join('\n');
  for (const m of raw.matchAll(/--dart-define(?:=|\s+)([A-Za-z_][A-Za-z0-9_]*)=/g)) flatNames.add(m[1]);
}
const unreached = [...flatNames].filter((n) => !passed.has(n)).sort();
if (unreached.length) {
  coverageLost([
    `${unreached.length} \`--dart-define\` name(s) appear in the workflow text and NOT in the parsed job scan: ${unreached.join(', ')}.`,
    'Every question below is asked of the parsed set, so a define outside it is a value compiled into an',
    'artifact that nobody had to justify — and the register would still read complete. Either the job',
    'parser has narrowed, or a define has moved somewhere this scan does not look.',
  ]);
}
const foldedCount = [...passed.values()].reduce((n, v) => n + v.length, 0);

// ── the equality ─────────────────────────────────────────────────────────────
for (const [name, sites] of [...passed.entries()].sort()) {
  if (!Object.prototype.hasOwnProperty.call(declared, name)) {
    problems.push(
      `--dart-define=${name} is compiled into a build at ${sites.join(', ')} and ${REGISTER_REL} does not ` +
        'declare it. A dart-define is written INTO the artifact — on web it is one view-source away — so ' +
        `"it came from secrets.${name}" describes where the value was KEPT, not where it ends up. Add an ` +
        'entry with a `reason` (why anyone may read it) and a `residual` (what it still costs that they can).',
    );
  }
}
for (const name of declaredNames.sort()) {
  if (!passed.has(name)) {
    problems.push(
      `${REGISTER_REL} declares "${name}" and no workflow passes it. A pre-approved name is permission ` +
        'granted before the question is asked: somebody adds the define months later, finds the entry, and ' +
        'reads it as the review having already happened. It is also how a dead entry outlives the thing it ' +
        'justified. Delete it, or add the define it describes.',
    );
  }
}
for (const [name, entry] of Object.entries(declared)) {
  for (const field of ['reason', 'residual']) {
    if (typeof entry?.[field] !== 'string' || entry[field].trim() === '') {
      problems.push(
        `${REGISTER_REL} entry "${name}" has no \`${field}\`. An entry with a reason and no residual is ` +
          'the shape that gets waved through — the whole exercise is writing down what shipping it still costs.',
      );
    }
  }
}

// `--dart-define-from-file` names a path this guard cannot audit the contents
// of from a workflow alone. Reported every run rather than accepted silently:
// the file's whole content is compiled in exactly as hard as a flag would be.
for (const f of fromFiles) {
  notes.push(
    `${f} uses --dart-define-from-file. Every key in that file is compiled into the artifact and this ` +
      'guard can only see the filename, so the equality above does NOT cover it. Prefer explicit flags, or ' +
      'this register stops describing what ships.',
  );
}

if (problems.length) {
  console.error(`✗ publishable inputs — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline 9]R-12 — nothing is compiled into a shipped artifact that has not been');
  console.error(`  written down as safe to ship. The record is ${REGISTER_REL}.`);
  process.exit(1);
}

if (notes.length) {
  console.log('⬜ notes, printed not hidden:');
  for (const n of notes) console.log(`    ${n}`);
}

console.log(
  `ok  publishable inputs — ${workflows.length} workflow(s), ${foldedCount} \`--dart-define\` occurrence(s) ` +
    `over ${passed.size} distinct name(s); set equality holds against ${declaredNames.length} declared ` +
    `entr(ies) in ${REGISTER_REL}, each with a reason and a residual`,
);
