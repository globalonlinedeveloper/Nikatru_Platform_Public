#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-submission-safety.mjs — no submission endangers the store identity the
// whole portfolio depends on.
//
// [pipeline 10]D-6 "No submission endangers the store identity."
//
// ── WHY THIS IS PORTFOLIO-SCALE AND NOT PER-APP ──────────────────────────────
// L21 rests on ONE publisher identity carrying every app this factory ships. A
// takedown, a strike or a suspension attaches to the PUBLISHER, not to the app
// that earned it — so the twentieth app's listing can cost the other nineteen
// their distribution at once. That asymmetry is the whole requirement: the risk
// of a bad submission is not "this app gets rejected".
//
// 🔴 CITE MS STORE POLICY 10.1.4, NEVER 10.1.1, for the clone rule. 10.1.1
// carries the carve-out "unless the product is also published by you", so it
// does NOT bind our portfolio against itself; 10.1.4 ("distinct and informative
// metadata") has no carve-out. Being wrong here makes the real rule look
// optional.
//
// ── THE THREE LIMBS, AND WHY THEY HAVE DIFFERENT STRENGTHS ───────────────────
//
// 1. TAGLINE — BUILD-FAILING. Empty or duplicate (after normalising) across
//    `catalog/apps.json`. It is `tagline` and NOT `description`:
//    D-6's original criterion looked for a `description` key that does not
//    exist in that file, so it ranged over nothing and reported clean forever.
//    ⚠️ VACUOUS AT n=1 — apps.json has exactly ONE entry today, so the
//    comparison set is EMPTY. The guard therefore PRINTS the compared-pair
//    count on every run, so a domain that shrinks back to one is visible rather
//    than silently making the check inert. Empty-tagline is writable TODAY
//    (`brick.yaml`'s `description` still defaults to ""), which is why that
//    half fails on real input rather than only in principle.
//
// 2. STATUS — BUILD-FAILING, AND ONLY INSIDE A REAL SUBMISSION (`--submitting`).
//    The web-prove-first rule, mechanised: an app that is not `live` on the web
//    has not proved it converts a stranger, and spending the portfolio's only
//    store identity on it is the trade this stage exists to refuse. It is NOT
//    checked in the CI mode, because CI is not submitting anything and failing
//    every build over a `planned` app would be a guard that gets switched off.
//
// 3. CADENCE — PRINTS, and becomes build-failing on the first store record.
//    🔴 THE ≤2-PER-CALENDAR-MONTH RULE IS **OURS**, NOT VENDOR POLICY —
//    "NIKATRU cadence rule (`MASTER_PLAN.md:277,:281`)", printed verbatim in
//    the output. Written beside real Google and Microsoft rules it reads as
//    one, and somebody will eventually defend it as a policy nobody can find.
//    The count is read through tooling/ci/deployment-record.mjs's
//    `readSubmissions`, the same reader [10]D-10 limb (iii) uses, so there is
//    one notion of "a submission happened".
//
// ⚠️ THE "DISTINCT VISUAL IDENTITY" LIMB IS DELIBERATELY NOT A GUARD. apps.json
// carries no seed or palette field, so there is nothing to compare across apps;
// `brick.yaml`'s `seed_hex` default is stage 2's to fix. It PRINTS as an owner
// judgement rather than pretending to check something that has no data.
//
// Usage:
//   node tooling/ci/assert-submission-safety.mjs [repoRoot]
//   node tooling/ci/assert-submission-safety.mjs [repoRoot] --submitting --app <slug>
//   …            [--ledger <file>]   a JSON array of {environment, createdAt, description}
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSubmissions, calendarMonth } from './deployment-record.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i !== -1 && i + 1 < argv.length && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
};
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const ROOT = resolve(positional[0] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

const APPS_REL = 'catalog/apps.json';
const REGISTER_REL = 'tooling/channel-register.json';

/** 🔴 OURS, NOT A STORE'S. Printed verbatim beside the number on every run. */
// 🔴 CITED BY SECTION, NOT BY LINE, AND THAT IS THE FIX RATHER THAN A STYLE CHOICE.
// This label read `MASTER_PLAN.md:277,:281` until 2026-08-15, and it is PRINTED VERBATIM into CI
// (see the failure message below), so every operator who followed it was sent to the wrong place:
// measured, :277 is BLANK and :281 sits inside an unrelated count-mismatch note. The cadence
// material is under `## 10. AUTO-MODE execution operating model` (the weekly-cadence paragraph).
// Nothing flagged the drift because both numbers still landed on REAL lines — `assert-enforcers-exist`
// only reports a citation that lands on a blank line or a comment, which is the four-fifths of the
// damage CLAUDE.md already documents it missing.
// A line number is a pointer into a file other people edit; it is right until someone inserts above
// it, and nothing recomputes it. This corpus has broken 203 and 218 citations that way on two
// separate occasions. A section heading survives an insert.
const CADENCE_LABEL = 'NIKATRU cadence rule (`MASTER_PLAN.md` § 10, AUTO-MODE execution operating model)';
const CADENCE_MAX = 2;

const SUBMITTING = flag('submitting');
const APP = opt('app');
const LEDGER = opt('ledger');

const problems = [];
const prints = [];

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-submission-safety: FAILED');
  process.exit(1);
}

const readJson = (rel, required = true) => {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) {
    if (!required) return null;
    coverageLost([`${rel} does not exist, so every check below has no subject.`]);
  }
  try {
    return JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    coverageLost([`${rel} could not be parsed (${e.message}).`]);
  }
};

const apps = readJson(APPS_REL);
if (!Array.isArray(apps) || apps.length === 0) {
  coverageLost([
    `${APPS_REL} lists no app.`,
    'Every limb below quantifies over the portfolio. With none, "no submission endangers the store',
    'identity" is true of the empty set — which is the shape D-6 shipped in: its original criterion',
    'looked for a `description` key this file does not have, so it ranged over nothing and reported',
    'clean forever.',
  ]);
}

// ── 1. TAGLINE — the differentiation line, build-failing ─────────────────────
// Normalised so "Track Every Subscription In One Place" and "track every
// subscription in one place" are the SAME claim to a store reviewer, which is
// the only reading that matters under MS policy 10.1.4.
const normalise = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const taglines = new Map(); // normalised -> [slug]
let resolvedTaglines = 0;
for (const app of apps) {
  const slug = typeof app?.slug === 'string' ? app.slug : '(no slug)';
  const raw = app?.tagline;
  if (typeof raw !== 'string' || raw.trim() === '') {
    problems.push(
      `app "${slug}" has an empty \`tagline\` in ${APPS_REL}. It is the one line that says what this app is ` +
        'and no other app in the portfolio is — MS Store Policy 10.1.4 requires "distinct and informative ' +
        'metadata" and has NO carve-out for products by the same publisher (10.1.1 does; cite 10.1.4). ' +
        "A stamp can be born with an empty one today: brick.yaml's `description` still defaults to \"\".",
    );
    continue;
  }
  resolvedTaglines++;
  const key = normalise(raw);
  if (!taglines.has(key)) taglines.set(key, []);
  taglines.get(key).push(slug);
}

// 🔴 THE COVERAGE CLAUSE FOR THE WRONG-KEY DEFECT — and it is an ACCOUNTING
// IDENTITY, not "resolvedTaglines > 0".
//
// A `resolvedTaglines === 0 ⇒ COVERAGE LOST` check was written here first and
// DELETED, because it could not fail: the loop above either resolves a tagline
// or pushes a problem for that app, so zero resolved always means at least one
// problem, and the branch was unreachable. This repo's rule is that an
// assertion with no writable failing input is worse than none — it inflates
// apparent coverage — so it is re-pointed at something that CAN go wrong:
// every catalogue entry must have been ACCOUNTED FOR, either resolved or
// reported. A `continue` added above that skips an entry silently shrinks the
// domain, and this is what says so.
//
// (Mutation-recorded, 2026-08-03: renaming the `tagline` key to `description`
// — literally D-6's original defect — now reports "app X has an empty tagline"
// rather than "the scan is broken", which is the right way round. Blaming the
// scanner for a fault the scanner found is a real failure mode with its own
// record in assert-app-versioning.mjs's test header.)
const examined = resolvedTaglines + problems.length;
if (examined < apps.length) {
  coverageLost([
    `${apps.length} app(s) in ${APPS_REL} and only ${examined} were accounted for (${resolvedTaglines} resolved, ${problems.length} reported).`,
    'An entry that is neither resolved nor reported has silently left the domain, so the duplicate check',
    'below ranges over a smaller portfolio and still prints clean. That is the shape D-6 shipped with:',
    'its criterion named `description`, apps.json has no such key, and the whole limb was vacuous.',
  ]);
}

for (const [key, slugs] of taglines) {
  if (slugs.length > 1) {
    problems.push(
      `apps ${slugs.map((s) => `"${s}"`).join(' and ')} share a tagline (normalised: "${key}"). Under MS Store ` +
        'Policy 10.1.4 that is not two products, it is one product submitted twice — and the penalty ' +
        'attaches to the PUBLISHER, so the whole portfolio pays for it.',
    );
  }
}

const comparedPairs = (resolvedTaglines * (resolvedTaglines - 1)) / 2;
prints.push(
  `TAGLINE PAIRS COMPARED: ${comparedPairs} (from ${resolvedTaglines} resolved tagline(s) across ` +
    `${apps.length} app(s)). ⚠️ At one app this is ZERO — the duplicate limb is VACUOUS until app #2, and ` +
    'this line exists so that stays visible rather than reading as "no duplicates found".',
);

// ── 2. STATUS — the web-prove-first rule, only when really submitting ────────
if (SUBMITTING) {
  if (!APP) {
    coverageLost([
      '--submitting was given with no --app.',
      'The status rule is about ONE app being submitted; without knowing which, it would either check',
      'nothing or check all of them, and both are wrong answers to the question a submission asks.',
    ]);
  }
  const app = apps.find((a) => a?.slug === APP);
  if (!app) {
    problems.push(`--app "${APP}" is not in ${APPS_REL}, so nothing can say whether it has proved itself on the web.`);
  } else if (app.status !== 'live') {
    problems.push(
      `app "${APP}" has status "${app.status ?? '(absent)'}" and only "live" may be submitted to a store. ` +
        'The web-prove-first rule: an app that is not live has not shown it converts a stranger, and the ' +
        'thing being spent on it is the ONE publisher identity every other app in the portfolio ships ' +
        'under. A rejection or a strike earned here is charged to all of them.',
    );
  }
}

// ── 3. CADENCE — PRINTS, and becomes build-failing on the first record ───────
const register = readJson(REGISTER_REL);
let ledgerEntries = null;
if (LEDGER) {
  const abs = resolve(ROOT, LEDGER);
  if (!existsSync(abs)) {
    coverageLost([`--ledger ${LEDGER} does not exist. A cadence count over a ledger that is not there is a count of nothing reported as compliance.`]);
  }
  try {
    ledgerEntries = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    coverageLost([`--ledger ${LEDGER} could not be parsed (${e.message}).`]);
  }
}

if (ledgerEntries === null) {
  prints.push(
    `CADENCE UNREAD: no --ledger was supplied, so the running per-calendar-month submission count is ` +
      `UNKNOWN, not zero. ${CADENCE_LABEL} caps it at ${CADENCE_MAX}. This limb becomes build-failing the ` +
      'moment a real ledger is passed — which is the first submission, because [10]D-10 limb (iii) cannot ' +
      'be satisfied before then and no publisher account exists ([10]D-4).',
  );
} else {
  const { records, unreadable } = readSubmissions(ledgerEntries, register);
  for (const u of unreadable) {
    prints.push(`LEDGER ROW UNREADABLE: ${u.environment} — ${u.reason}`);
  }
  const byMonth = new Map();
  for (const r of records) {
    const m = calendarMonth(r.createdAt);
    if (m === null) {
      prints.push(`LEDGER ROW UNDATED: ${r.environment} carries no usable timestamp, so it counts towards no month.`);
      continue;
    }
    byMonth.set(m, (byMonth.get(m) ?? 0) + 1);
  }
  if (byMonth.size === 0) {
    prints.push(
      `CADENCE: 0 store submission(s) on record. ${CADENCE_LABEL} caps it at ${CADENCE_MAX} per calendar ` +
        'month. Zero is the honest count today — no publisher account exists, so no submission has happened.',
    );
  }
  for (const [month, n] of [...byMonth.entries()].sort()) {
    if (n > CADENCE_MAX) {
      problems.push(
        `${n} store submission(s) recorded in ${month}, and ${CADENCE_LABEL} caps it at ${CADENCE_MAX}. ` +
          '🔴 THIS IS OUR RULE, NOT A STORE POLICY — it exists because a burst of submissions from one ' +
          'publisher is what a review team reads as a content farm, and the penalty attaches to the ' +
          'publisher rather than to the app.',
      );
    } else {
      prints.push(`CADENCE ${month}: ${n}/${CADENCE_MAX} — ${CADENCE_LABEL}`);
    }
  }
}

// ── the limb that PRINTS because it has no data to check ─────────────────────
prints.push(
  'VISUAL IDENTITY: NOT CHECKED, and deliberately not. `catalog/apps.json` carries no seed, ' +
    "palette or icon field, so there is nothing to compare across apps; `brick.yaml`'s `seed_hex` default " +
    'is stage 2\'s to fix. This is an owner judgement before a submission, not an assertion — a guard that ' +
    'pretended to check it would always pass.',
);

if (problems.length) {
  console.error(`✗ submission safety — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline 10]D-6 — a strike attaches to the PUBLISHER, so one bad submission is charged');
  console.error('  to every app the factory ships. See the header of tooling/ci/assert-submission-safety.mjs.');
  process.exit(1);
}

for (const p of prints) console.log(`⬜ ${p}`);
console.log(
  `ok  submission safety — ${apps.length} app(s), ${resolvedTaglines} tagline(s) resolved and ` +
    `${comparedPairs} pair(s) compared${SUBMITTING ? `; --submitting --app ${APP} passed the web-prove-first rule` : ''}`,
);
