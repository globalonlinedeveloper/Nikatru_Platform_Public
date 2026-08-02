#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-e2e-legs.mjs — the nightly must have EXERCISED the legs it claims.
//
// [pipeline N-6, clause 4] company/pipeline/06-app-build.md
//
// A green tick is not coverage. `assert-e2e-proof-fresh.mjs` (clause 1/3) proves
// the nightly RAN, recently, on its timer. It cannot prove the suite it ran walks
// the golden path, and on 2026-07-29 it demonstrably did not: N-6 names a
// SIX-LEG path — anonymous → sign in → purchase (sandbox) → entitlement flips →
// feature unlocks → account delete purges — and the only implementation of it in
// the tree, apps/subly/integration_test/app_test.dart, declares two tests and
// proves two legs. A green, non-skipped, FRESH run still would not mean what N-6
// says. So freshness and coverage are two guards, because they are two claims.
//
// ── THE RELATIONSHIP, NOT A COUNT ───────────────────────────────────────────
// A count is a number somebody types, and this repo has already shipped a
// scanner that counted a name inside a comment. What is checked instead is an
// EQUALITY between a claim and the tree:
//
//   for every leg the register marks `asserted`, every one of its `anchors`
//   must resolve in the E2E's COMMENT-STRIPPED source
//     ⇒ legs-claimed-asserted == legs-the-suite-actually-proves
//
// Delete the onboarding leg from the suite and the register still says two; the
// anchors stop resolving and the equality breaks. That is the direction that
// matters, because overclaiming is what N-6 was doing.
//
// 🔴 COMMENT-STRIPPING IS LOAD-BEARING, NOT HOUSEKEEPING. app_test.dart's own
// header narrates the six-night outage and contains the literal string
// `tap('Skip')` inside a `///` comment describing the bug. A raw `includes()`
// would resolve the onboarding anchor against THE PROSE ABOUT THE FAILURE and
// report the leg proven on a suite with every test deleted. That is not a
// hypothetical: `assert-clone-contract.mjs` matched a template comment explaining
// why there was no r2_buckets, and `assert-seams-wired.mjs` shipped with its
// caller check matching the function's own declaration. Same family, third time.
//
// ── A BLOCKED LEG'S EXCUSE IS ITSELF CHECKED ────────────────────────────────
// Copied in intent from `assert-screen-set.mjs`'s BLOCKERS_STILL_REAL. A leg that
// is not asserted must name a blocker, and the blocker is a PREDICATE evaluated
// against the real tree on every run — not a string. If it has shipped, the build
// fails, because "blocked by the money rail" must not outlive the money rail. The
// four blocked legs also PRINT on every run: a gap nobody sees is a gap nobody
// closes, and four sixths of this requirement is currently a gap.
//
// ⚠️ STATED LIMIT, so nobody reads this as more than it is. This guard proves
// that a leg the register CLAIMS is really exercised, and that an excuse is
// really still true. It cannot prove the converse — that a leg quietly covered by
// the suite has been promoted in the register — because the only signal for that
// would be anchors written for tests nobody has written, and an anchor guessed in
// advance is satisfied or missed by coincidence. The blocker predicates are what
// close that direction instead: they are tied to the RAIL, so the day apps/subly
// ships a paywall or a delete-account call site, the excuse dies and this guard
// demands the leg be covered or restated. An assertion that could only pass by
// luck would inflate apparent coverage, which this repo deletes on sight.
//
// Usage:  node tooling/ci/assert-e2e-legs.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripSourceComments } from './text-reductions.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER_REL = 'tooling/e2e-leg-register.json';

/** N-6's golden path, verbatim, as an ORDERED FIXED SET.
 *
 *  Not a floor and not a minimum: the requirement names these six and only these
 *  six. A floor (`>= 2`) would let somebody delete the four inconvenient legs and
 *  pass; an exact set means a leg can only leave this file by the requirement
 *  changing. That is the `REQUIRED_COVERAGE` idea from `check-migrations.mjs`,
 *  which silently dropped from 5 files to 4 and reported PASS. */
const REQUIRED_LEGS = [
  'anonymous',
  'sign-in',
  'purchase-sandbox',
  'entitlement-flip',
  'feature-unlock',
  'account-delete-purges',
];

/** Blocker claims, each a PREDICATE over the real tree — never a string.
 *
 *  `true`  → the blocker is still real, the leg is legitimately uncovered.
 *  `false` → it has SHIPPED; the excuse is dead and any leg still claiming it
 *            fails the build.
 *
 *  Each reads COMMENT-STRIPPED source, for the reason in this file's header. */
const BLOCKERS_STILL_REAL = {
  // apps/subly declares `PaywallConfig(enabled: false)` — the app sells nothing,
  // so there is nothing to purchase, no entitlement to flip and no feature to
  // unlock. Three legs share this one blocker because they share one cause.
  //
  // The signal is the app's OWN declaration rather than an absence, deliberately:
  // "no paywall widget appears anywhere" is satisfied by a typo, whereas this
  // line has to be edited to `true` by somebody switching the rail on — and on
  // that day all three legs stop being excusable in the same run.
  '[5] apps/subly sells nothing': (src) => /PaywallConfig\(\s*enabled:\s*false/.test(src.subly),

  // `deleteAccount()` is DECLARED in apps/subly/lib/data/auth/*.dart and CALLED
  // from nowhere in the app — the exact "seam exists, nothing reaches it" defect
  // class this repo has now shipped four times (ConsentController.record with
  // zero call sites, PaywallGate with zero consumers, the delete dialog whose
  // confirm button only closed itself).
  //
  // 🔴 `.deleteAccount(` WITH THE LEADING DOT, and that dot is the whole check.
  // `assert-seams-wired.mjs` shipped broken because its caller check matched the
  // function's own DECLARATION, so deleting every real caller still passed, and
  // all six of its fixture tests passed against the broken version. A declaration
  // reads `Future<void> deleteAccount() async`; a call reads `repo.deleteAccount()`.
  // Verified on this tree: zero hits under apps/subly/lib, real hits under
  // packages/auth_supabase/test.
  '[6] apps/subly has no delete-account call site': (src) => !src.subly.includes('.deleteAccount('),
};

const problems = [];
const notes = [];

/** Structural failure — the scan itself is broken, so nothing below it means
 *  anything. Exits immediately rather than joining the problem list. */
const coverageLost = (lines) => {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
};

// ── the register ────────────────────────────────────────────────────────────
const registerPath = join(ROOT, REGISTER_REL);
if (!existsSync(registerPath)) {
  coverageLost([
    `${REGISTER_REL} does not exist.`,
    'It is the right-hand side of N-6\'s leg equality. Without it the requirement quantifies over',
    'nothing again, which is the state this guard was built to end.',
  ]);
}
let reg;
try {
  reg = JSON.parse(readFileSync(registerPath, 'utf8'));
} catch (e) {
  coverageLost([
    `${REGISTER_REL} could not be parsed (${e.message}).`,
    'An unreadable register is an undeclared one; every leg claim below would be checked against nothing.',
  ]);
}

const legs = Array.isArray(reg.legs) ? reg.legs : [];
const ids = legs.map((l) => l && l.id);
const missing = REQUIRED_LEGS.filter((r) => !ids.includes(r));
const extra = ids.filter((i) => !REQUIRED_LEGS.includes(i));
if (missing.length || extra.length) {
  coverageLost([
    `${REGISTER_REL} does not declare N-6's six legs exactly.`,
    ...(missing.length ? [`missing: ${missing.join(', ')}`] : []),
    ...(extra.length ? [`unexpected: ${extra.join(', ')}`] : []),
    'The requirement names six and only six. Trimming the list is how a coverage relationship becomes',
    'a tautology — the four uncovered legs are exactly the ones it would be convenient to delete.',
  ]);
}

// ── the suite under test ────────────────────────────────────────────────────
const testRel = reg.e2e?.test;
if (typeof testRel !== 'string' || testRel.length === 0) {
  coverageLost([`${REGISTER_REL} names no \`e2e.test\`, so there is no suite to resolve anchors against.`]);
}
const testPath = join(ROOT, testRel);
if (!existsSync(testPath)) {
  coverageLost([
    `the named E2E ${testRel} does not exist.`,
    'Every anchor below would fail to resolve for the same reason, so the message would blame the',
    'register for a missing file. Named separately so the real cause is the one printed.',
  ]);
}
const suite = stripSourceComments(readFileSync(testPath, 'utf8'), '.dart');

// RESOLVE, DO NOT MATCH. A file of comments is not a test suite: after stripping,
// the source must still declare at least one real `testWidgets(`. Without this,
// gutting app_test.dart down to its header would leave anchors unresolvable and
// the failure would read as a register problem rather than as a deleted suite.
if (!/\btestWidgets\s*\(/.test(suite)) {
  coverageLost([
    `${testRel} declares no \`testWidgets(\` once comments are stripped.`,
    'The named E2E is not a suite any more. Anchors cannot be resolved against a file that runs',
    'nothing, and a green nightly over it would prove only that Flutter started.',
  ]);
}

// The workflow must still be the one that runs this suite. The register names
// both; if they have drifted, "the leg is proven nightly" is proven by nothing.
const wfRel = reg.e2e?.workflow;
if (typeof wfRel !== 'string' || !existsSync(join(ROOT, wfRel))) {
  coverageLost([
    `${REGISTER_REL} names workflow ${JSON.stringify(wfRel)}, which does not exist.`,
    'The legs below are only proven if something runs them on a schedule.',
  ]);
}
const workflow = readFileSync(join(ROOT, wfRel), 'utf8')
  .split('\n')
  .filter((l) => !l.trim().startsWith('#'))
  .join('\n');
if (!workflow.includes(testRel.split('/').slice(-2).join('/'))) {
  coverageLost([
    `${wfRel} does not name ${testRel}.`,
    'The register claims this workflow runs this suite. It does not, so every leg marked asserted is',
    'proven by a test nothing schedules.',
  ]);
}

// ── the blocker predicates' inputs ──────────────────────────────────────────
// Read once, comment-stripped once, and handed to every predicate.
const APP_DIR = reg.e2e?.app ?? 'apps/subly';
const readDartTree = (dir) => {
  const out = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.dart')) out.push(stripSourceComments(readFileSync(p, 'utf8'), '.dart'));
    }
  };
  walk(join(ROOT, dir));
  return out.join('\n');
};

const sources = { subly: readDartTree(join(APP_DIR, 'lib')) };
if (sources.subly.trim().length === 0) {
  coverageLost([
    `no Dart source was read under ${APP_DIR}/lib.`,
    'Every blocker predicate below reads that tree, and a predicate over an empty string answers',
    '"still blocked" for reasons that have nothing to do with the blocker. A scan over nothing prints',
    'ok — this repo\'s single most repeated failure.',
  ]);
}

// ── the equality ────────────────────────────────────────────────────────────
let proven = 0;
const asserted = [];
const blocked = [];

for (const leg of legs) {
  if (leg.status === 'asserted') {
    asserted.push(leg);
    const anchors = Array.isArray(leg.anchors) ? leg.anchors : [];
    if (anchors.length === 0) {
      problems.push(
        `\`${leg.id}\` is marked asserted with no anchors. An unanchored claim is exactly the "the record ` +
          'names an E2E" acceptance that N-6 already had and that could not fail.',
      );
      continue;
    }
    const unresolved = anchors.filter((a) => !suite.includes(a));
    if (unresolved.length) {
      problems.push(
        `\`${leg.id}\` claims to be asserted, but ${unresolved.length} of its ${anchors.length} anchor(s) ` +
          `no longer resolve in ${testRel} (comment-stripped): ${unresolved.map((u) => JSON.stringify(u)).join(', ')}. ` +
          'The register claims more coverage than the suite carries — either the suite lost the leg, or ' +
          'the anchors were never what proved it.',
      );
      continue;
    }
    proven++;
  } else if (leg.status === 'blocked') {
    blocked.push(leg);
    if (!leg.blockedBy) {
      problems.push(`\`${leg.id}\` is BLOCKED with no \`blockedBy\`. An unexplained block is indistinguishable from work nobody did.`);
      continue;
    }
    const stillReal = BLOCKERS_STILL_REAL[leg.blockedBy];
    if (typeof stillReal !== 'function') {
      problems.push(
        `\`${leg.id}\` claims to be blocked by "${leg.blockedBy}", which has no predicate in ` +
          'BLOCKERS_STILL_REAL. A blocker nothing evaluates is a sentence, and it would sit here looking ' +
          'checked forever.',
      );
      continue;
    }
    if (!stillReal(sources)) {
      problems.push(
        `\`${leg.id}\` claims to be blocked by "${leg.blockedBy}", but that blocker has SHIPPED. ` +
          'Cover the leg in the E2E or restate the block — otherwise the excuse outlives its reason.',
      );
    }
  } else {
    problems.push(
      `\`${leg.id}\` has unknown status ${JSON.stringify(leg.status)} (expected asserted / blocked). ` +
        'A third state is a third place for a leg to hide.',
    );
  }
}

// THE EQUALITY, STATED. It follows from the per-leg checks above, and it is
// computed and printed anyway: the two numbers are what N-6 actually asks for,
// and a relationship nobody prints is one nobody can audit from a log.
if (proven !== asserted.length) {
  problems.push(
    `leg equality broken — ${asserted.length} leg(s) marked asserted, ${proven} proven by ${testRel}.`,
  );
}

if (problems.length) {
  console.error(`✗ assert-e2e-legs — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline N-6] The golden path is proven end to end only for the legs the suite really');
  console.error('  walks. A green nightly over a suite that skips four of six is not the requirement.');
  process.exit(1);
}

if (blocked.length) {
  notes.push(
    `⬜ ${blocked.length} of ${REQUIRED_LEGS.length} golden-path leg(s) are NOT proven by the nightly. ` +
      'Each blocker is re-evaluated every run, so the excuse cannot outlive its reason:',
  );
  for (const l of blocked) notes.push(`   · ${l.id} — ${l.blockedBy} (declared ${l.declaredOn ?? 'undated'})`);
}
notes.push(
  `⬜ web only, by policy, dated ${reg.e2e?.declaredOn ?? 'undated'} — Apple 3.1.1 / Play billing make a web ` +
    'checkout structurally invalid as the unlock path on iOS and Android; the other four platforms are a ' +
    'cost cut, not a tooling limit. (Guideline numbers COULD-NOT-ESTABLISH — carried from research, not re-read.)',
);
for (const n of notes) console.log(n);

console.log(
  `ok  e2e legs — ${asserted.length} of ${REQUIRED_LEGS.length} golden-path leg(s) claimed asserted and ` +
    `${proven} proven by ${testRel} (equality holds); ${blocked.length} blocked with a live blocker`,
);
